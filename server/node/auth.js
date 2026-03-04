const {base64UrlToBuffer} = require("./utils");

/**
 * Registry of server-side proxy auth verifiers.
 * Keys = verifier names (e.g., "jwt"), values = async functions.
 *
 *  verifier({ req, core, alias, proxyConfig }) => void|boolean
 *    - Throw or return false to fail authentication.
 *    - Return true or nothing to accept.
 */
const proxyAuthVerifiers = Object.create(null);

/**
 * Register a new proxy auth verifier.
 * @param {string} name
 * @param {(ctx: {req: IncomingMessage, core: any, alias: string, proxyConfig: any}) => Promise<boolean|void>|boolean|void} fn
 */
function registerProxyAuthVerifier(name, fn) {
    proxyAuthVerifiers[name] = fn;
}

/**
 * Verify proxy-level auth based on proxyConfig.auth{enabled, verifiers, mode}.
 * Throws or writes a response and returns false on failure.
 */
async function verifyProxyAuth(req, res, core, alias, proxyConfig, upstream) {
    const authCfg = proxyConfig.auth;
    if (!authCfg || authCfg.enabled === false) {
        // No viewer-level auth required for this proxy.
        return true;
    }

    const verifiers = Array.isArray(authCfg.verifiers) ? authCfg.verifiers : [];
    const mode = authCfg.mode === "any" ? "any" : "all"; // default "all"

    if (!verifiers.length) {
        // Misconfiguration: auth enabled but no verifiers.
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Proxy '${alias}' auth misconfigured: auth.enabled=true but no verifiers specified.`);
        return false;
    }

    let passedCount = 0;
    let firstError = null;

    for (const name of verifiers) {
        const verifier = proxyAuthVerifiers[name];
        if (!verifier) {
            // Unknown verifier -> treat as config error
            firstError = new Error(`Unknown proxy auth verifier '${name}' for alias '${alias}'`);
            continue;
        }
        try {
            const result = await verifier({ req, core, alias, proxyConfig, upstream });
            const ok = result === undefined ? true : !!result;

            if (ok) {
                passedCount += 1;
                if (mode === "any") {
                    // one success is enough
                    return true;
                }
            } else {
                if (!firstError) firstError = new Error(`Verifier '${name}' failed`);
                if (mode === "all") {
                    // fail fast
                    break;
                }
            }
        } catch (e) {
            if (!firstError) firstError = e;
            if (mode === "all") break;
        }
    }

    const shouldPass =
        (mode === "all" && passedCount === verifiers.length) ||
        (mode === "any" && passedCount > 0);

    if (!shouldPass) {
        console.warn(`Proxy auth failed for alias '${alias}':`, firstError || "all verifiers failed");

        // For now, treat all failures as 401 Unauthorized. You could refine:
        // - config errors -> 500,
        // - auth failures -> 401/403.
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(`Unauthorized: proxy auth failed for '${alias}'`);
        return false;
    }

    return true;
}

// ---------------------- Default JWT verifier ----------------------
registerProxyAuthVerifier("jwt", async ({ req, core, alias, proxyConfig, upstream }) => {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Missing Bearer token for JWT verifier");
    }
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
        throw new Error("Empty Bearer token");
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
        // For simplicity, we support HS256 only here.
        throw new Error(`Unsupported JWT alg '${header.alg}', expected HS256`);
    }

    // Resolve JWT config: per-proxy overrides global
    const globalJwt = (core.CORE.server && core.CORE.server.auth && core.CORE.server.auth.jwt) || {};
    const proxyJwt = (proxyConfig.auth && proxyConfig.auth.jwt) || {};
    const jwtCfg = { ...globalJwt, ...proxyJwt };

    let secret = jwtCfg.secret;
    if (!secret) {
        throw new Error(
            `JWT verifier for alias '${alias}' requires a secret or secretEnv in config`
        );
    }

    // Verify signature (HS256)
    const crypto = require("node:crypto");
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(`${hB64}.${pB64}`);
    const expectedSig = hmac
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    if (expectedSig !== sB64) {
        throw new Error("Invalid JWT signature");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const skew = typeof jwtCfg.clockSkewSec === "number" ? jwtCfg.clockSkewSec : 60;

    // exp (expiry)
    if (typeof payload.exp === "number" && nowSec > payload.exp + skew) {
        throw new Error("JWT has expired");
    }

    // nbf (not before)
    if (typeof payload.nbf === "number" && nowSec < payload.nbf - skew) {
        throw new Error("JWT not yet valid");
    }

    // iss (issuer)
    if (jwtCfg.issuer && payload.iss && payload.iss !== jwtCfg.issuer) {
        throw new Error(`Unexpected JWT issuer '${payload.iss}'`);
    }

    // aud (audience)
    if (jwtCfg.audience && payload.aud) {
        const expectedAud = jwtCfg.audience;
        if (Array.isArray(payload.aud)) {
            if (!payload.aud.includes(expectedAud)) {
                throw new Error("JWT audience does not include expected value");
            }
        } else if (payload.aud !== expectedAud) {
            throw new Error(`Unexpected JWT audience '${payload.aud}'`);
        }
    }

    // At this point, the token is structurally valid and signature/claims checked.
    // We can optionally:
    //  - attach the decoded payload to the request for downstream use
    //  - clean up or transform headers for the upstream

    // Attach user payload for potential use by other verifiers / logging
    req.user = payload;

    const jwtForward = jwtCfg.forward === true;
    if (!jwtForward) {
        // Remove Authorization from upstream headers so the upstream service
        // does not see the viewer's JWT (only configured API keys etc.).
        delete upstream.headers["authorization"];
        delete upstream.headers["Authorization"];
    }

    // Optional: forward user ID/subject in a custom header
    if (jwtCfg.userClaimHeader && payload.sub) {
        upstream.headers[jwtCfg.userClaimHeader.toLowerCase()] = String(payload.sub);
    }

    // All good
    return true;
});

module.exports = {
    registerProxyAuthVerifier,
    verifyProxyAuth,
};