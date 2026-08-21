// Structural validation of a SAML context's configuration.
//
// Deliberately its OWN file, with no imports at all: `saml-flow.ts` loads node-saml
// through `createRequire(import.meta.url)` (see the long comment there — it must not
// become a static import), which makes that module unloadable outside the server
// bundle. Keeping this pure means it can be unit-tested directly, and means nothing
// has to pull in an XML stack to answer "is this context configured?".

/**
 * Why this context cannot serve a login, or `null` when it structurally can.
 *
 * STRUCTURAL ONLY — no network, no `new SAML(...)`. The point is to answer before
 * anything is advertised: `listContexts` used to publish every declared key as a
 * usable context, so a context with an incomplete config was announced with
 * `autoLogin: true`, and core (which now DRIVES the automatic login) navigated the
 * whole viewer into a bare 400 page on the first load. A provider must not claim a
 * capability it cannot deliver; this is how it finds out.
 *
 * Whether `idpMetadataUrl` is reachable, and whether the key material actually
 * parses, cannot be settled without a request — those stay request-time failures.
 */
export function contextConfigProblem(cfg: any): string | null {
    if (!cfg || typeof cfg !== "object") return "no configuration";
    if (!cfg.issuer) return "missing 'issuer' (the SP entityID)";
    // `idpMetadataUrl` supplies entryPoint AND the signing certs, so it satisfies
    // both — that is exactly the trade the config comments describe.
    if (!cfg.idpMetadataUrl) {
        if (!cfg.entryPoint) return "missing 'entryPoint' (and no 'idpMetadataUrl' to supply it)";
        if (!cfg.idpCert || (Array.isArray(cfg.idpCert) && !cfg.idpCert.length)) {
            return "missing 'idpCert' (and no 'idpMetadataUrl' to supply it)";
        }
    }
    // Resolve it exactly the way `tokenSecret` will: `secretEnv` wins unconditionally
    // once present, so an UNSET variable is a failure and not a fallback to `.secret`.
    // That asymmetry is what made an empty `XOPAT_SAML_JWT_SECRET` fail `/login`
    // outright — before any token was minted — with nothing on screen to say so.
    const token = cfg.token || {};
    const secret = token.secretEnv ? process.env[token.secretEnv] : token.secret;
    if (!secret) {
        return token.secretEnv
            ? `token signing secret is empty — environment variable '${token.secretEnv}' is not set`
            : "missing a token signing secret (set token.secretEnv or token.secret)";
    }
    return null;
}
