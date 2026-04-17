const {base64UrlToBuffer} = require("./utils");

const proxyAuthVerifiers = Object.create(null);
const rpcAuthVerifiers = Object.create(null);

function registerProxyAuthVerifier(name, fn) {
    proxyAuthVerifiers[name] = fn;
}

function registerRpcAuthVerifier(name, fn) {
    rpcAuthVerifiers[name] = fn;
}

function getVerifierEntries(verifiers) {
    if (!verifiers) return [];
    if (Array.isArray(verifiers)) return verifiers.map(name => [name, {}]);
    if (typeof verifiers === "object") return Object.entries(verifiers);
    return [];
}

async function runVerifierSet(verifierRegistry, verifierEntries, mode, contextBuilder) {
    let passedCount = 0;
    let firstError = null;

    for (const [name, verifierConfig] of verifierEntries) {
        const verifier = verifierRegistry[name];
        if (!verifier) {
            firstError = firstError || new Error(`Unknown auth verifier '${name}'`);
            if (mode === "all") break;
            continue;
        }
        try {
            const result = await verifier(contextBuilder(name, verifierConfig || {}));
            const ok = result === undefined ? true : !!(result.ok === undefined ? result : result.ok);
            if (ok) {
                passedCount += 1;
                if (mode === "any") {
                    return { ok: true, result };
                }
            } else {
                firstError = firstError || new Error(`Verifier '${name}' failed`);
                if (mode === "all") break;
            }
        } catch (e) {
            firstError = firstError || e;
            if (mode === "all") break;
        }
    }

    const shouldPass =
        (mode === "all" && passedCount === verifierEntries.length) ||
        (mode === "any" && passedCount > 0);

    return { ok: shouldPass, error: firstError };
}

async function verifyProxyAuth(req, res, core, alias, proxyConfig, upstream) {
    const authCfg = proxyConfig.auth;
    if (!authCfg || authCfg.enabled === false) {
        return true;
    }

    const verifierEntries = getVerifierEntries(authCfg.verifiers);
    const mode = authCfg.mode === "any" ? "any" : "all";

    if (!verifierEntries.length) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Proxy '${alias}' auth misconfigured: auth.enabled=true but no verifiers specified.`);
        return false;
    }

    const result = await runVerifierSet(proxyAuthVerifiers, verifierEntries, mode, (name, verifierConfig) => ({
        req, core, alias, proxyConfig, upstream, verifierName: name, verifierConfig
    }));
    if (!result.ok) {
        console.warn(`Proxy auth failed for alias '${alias}':`, result.error || "all verifiers failed");
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(`Unauthorized: proxy auth failed for '${alias}'`);
        return false;
    }

    return true;
}

async function verifyRpcAuth(req, res, core, verifierContextCfg, meta = {}) {
    if (!verifierContextCfg || verifierContextCfg.enabled === false) {
        return { ok: true, user: req.user || null };
    }

    const verifierEntries = getVerifierEntries(verifierContextCfg.verifiers);
    if (!verifierEntries.length) {
        return { ok: true, user: req.user || null };
    }

    const mode = verifierContextCfg.mode === "any" ? "any" : "all";
    const result = await runVerifierSet(rpcAuthVerifiers, verifierEntries, mode, (name, verifierConfig) => ({
        req,
        res,
        core,
        verifierContextCfg,
        verifierName: name,
        verifierConfig,
        meta,
    }));
    if (!result.ok) {
        console.warn(
            `[rpc-auth] failed for ${meta.kind || "unknown"}/${meta.item?.id || meta.itemId || "unknown"}/${meta.method || "unknown"}:`,
            result.error || "all verifiers failed"
        );
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Unauthorized: RPC auth failed`, code: "RPC_AUTH_FAILED" }));
        return { ok: false };
    }

    return { ok: true, user: req.user || result.result?.user || null };
}

function verifyJwtToken(token, jwtCfg = {}) {
    if (!token) {
        throw new Error("Missing Bearer token");
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
    }

    const [hB64, pB64, sB64] = parts;
    let header, payload;
    try {
        header = JSON.parse(base64UrlToBuffer(hB64).toString("utf8"));
        payload = JSON.parse(base64UrlToBuffer(pB64).toString("utf8"));
    } catch (e) {
        throw new Error("Failed to parse JWT header/payload");
    }

    if (!header || header.typ !== "JWT") {
        throw new Error("Invalid JWT header typ");
    }
    if (!header.alg || header.alg !== "HS256") {
        throw new Error(`Unsupported JWT alg '${header.alg}', expected HS256`);
    }

    let secret = jwtCfg.secret;
    if (!secret && jwtCfg.secretEnv) {
        secret = process.env[jwtCfg.secretEnv];
    }
    if (!secret) {
        throw new Error(`JWT verification requires secret or secretEnv`);
    }

    const crypto = require("node:crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${hB64}.${pB64}`);
    const expectedSig = hmac.digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (expectedSig !== sB64) {
        throw new Error("Invalid JWT signature");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const skew = typeof jwtCfg.clockSkewSec === "number" ? jwtCfg.clockSkewSec : 60;
    if (typeof payload.exp === "number" && nowSec > payload.exp + skew) throw new Error("JWT has expired");
    if (typeof payload.nbf === "number" && nowSec < payload.nbf - skew) throw new Error("JWT not yet valid");
    if (jwtCfg.issuer && payload.iss && payload.iss !== jwtCfg.issuer) throw new Error(`Unexpected JWT issuer '${payload.iss}'`);
    if (jwtCfg.audience && payload.aud) {
        const expectedAud = jwtCfg.audience;
        if (Array.isArray(payload.aud)) {
            if (!payload.aud.includes(expectedAud)) throw new Error("JWT audience does not include expected value");
        } else if (payload.aud !== expectedAud) {
            throw new Error(`Unexpected JWT audience '${payload.aud}'`);
        }
    }
    return payload;
}

registerProxyAuthVerifier("jwt", async ({ req, core, proxyConfig, upstream, verifierConfig }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token for JWT verifier");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const globalJwt = (core.CORE.server && core.CORE.server.auth && core.CORE.server.auth.jwt) || {};
    const payload = verifyJwtToken(token, { ...globalJwt, ...(verifierConfig || {}) });
    req.user = payload;
    const jwtForward = ((verifierConfig || {}).forward ?? globalJwt.forward) === true;
    if (!jwtForward) {
        delete upstream.headers["authorization"];
        delete upstream.headers["Authorization"];
    }
    const userClaimHeader = (verifierConfig || {}).userClaimHeader || globalJwt.userClaimHeader;
    if (userClaimHeader && payload.sub) {
        upstream.headers[String(userClaimHeader).toLowerCase()] = String(payload.sub);
    }
    return true;
});

registerRpcAuthVerifier("bearer", async ({ req }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token");
    }
    return { ok: true };
});

registerRpcAuthVerifier("jwt", async ({ req, core, verifierConfig }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    const globalJwt = (core.CORE.server && core.CORE.server.auth && core.CORE.server.auth.jwt) || {};
    const payload = verifyJwtToken(token, { ...globalJwt, ...(verifierConfig || {}) });
    req.user = payload;
    return { ok: true, user: payload };
});

module.exports = {
    registerProxyAuthVerifier,
    verifyProxyAuth,
    registerRpcAuthVerifier,
    verifyRpcAuth,
    verifyJwtToken,
};
