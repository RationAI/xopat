/**
 * `.env` values that parse but cannot have been meant.
 *
 * The shape this exists for: appending `KEY=value` to a file whose last line has
 * no trailing newline concatenates the two, giving
 * `WSI_PORT=9002"WSI_PORT=9002"`. The key is valid and the value is a non-empty
 * string, so nothing rejected it — it resolved through `<% WSI_PORT %>` into a
 * plugin's base URL and surfaced as
 * `TypeError: Failed to construct 'URL': Invalid URL`, three debugging rounds
 * away from the file that caused it.
 *
 * The lint is deliberately narrow. A check that flagged "values that look odd"
 * would be turned off, and `.env` legitimately holds keys, PEM bodies and URLs
 * full of punctuation.
 */
import { test, expect } from "@xopat/test-harness";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const require_ = createRequire(import.meta.url);
const { parseDotEnv, findSuspectValues } = require_(path.join(REPO, "server/utils/node/dotenv.js"));

const suspects = (text) => findSuspectValues(parseDotEnv(text));

test("the append-without-newline collision is reported @unit", () => {
    // Verbatim the value that cost the debugging session.
    const found = suspects('WSI_PORT=9002"WSI_PORT=9002"');
    expect(found).toHaveLength(1);
    expect(found[0].key).toBe("WSI_PORT");
    expect(found[0].reason).toMatch(/second assignment to WSI_PORT/);
});

test("an embedded quote is reported @unit", () => {
    const found = suspects('GITHUB_SINK_REPO=owner/repo"');
    expect(found.map(f => f.key)).toEqual(["GITHUB_SINK_REPO"]);
});

test("ordinary secrets are left alone @unit", () => {
    // Every one of these is a real shape from env/.env.example. A lint that
    // fires on any of them is worse than no lint.
    const found = suspects([
        "WSI_PORT=9002",
        "ANTHROPIC_API_KEY=sk-ant-abcdef0123456789",
        "CERIT_BASE_URL=https://llm.ai.e-infra.cz/v1",
        "GITHUB_SINK_REPO=owner/repository",
        "TIFF_FILESERVER=http://127.0.0.1:9100/files",
        "XOPAT_SSRF_ALLOWED_CIDRS=127.0.0.0/8,10.0.0.0/8",
        "MEDGEMMA_MODEL=medgemma-4b-it",
        "# a comment",
        "",
    ].join("\n"));
    expect(found).toEqual([]);
});

test("a quoted value keeps its punctuation without being flagged @unit", () => {
    // The parser strips the surrounding quotes, so what reaches the check is a
    // clean value — quoting is how you legitimately carry spaces and `#`.
    const parsed = parseDotEnv('GREETING="hello # world"');
    expect(parsed.GREETING).toBe("hello # world");
    expect(findSuspectValues(parsed)).toEqual([]);
});

test("a base64/JWT-ish value is not mistaken for an assignment @unit", () => {
    // Caught a false positive in the first version of this lint: a generic
    // `\w+=` pattern matches the `d=` at the end of base64 padding. The check is
    // keyed on names the file actually declares for exactly this reason.
    const found = suspects("XOPAT_SAML_JWT_SECRET=aGVsbG8gd29ybGQ=");
    expect(found).toEqual([]);
});

test("an uppercase query parameter in a URL is not an assignment @unit", () => {
    // Same class of false positive, and the reason the rule is data-driven: this
    // is a perfectly ordinary value.
    const found = suspects("GOOGLE_DICOM_SERVICE_URL=https://example.org/dicomWeb?STUDY=1.2.3");
    expect(found).toEqual([]);
});

test("a collision with a DIFFERENT key in the same file is caught @unit", () => {
    // An append does not have to duplicate the key it lands on.
    const found = suspects(["MEDGEMMA_MODEL=medgemma-4b-itWSI_PORT=9002", "WSI_PORT=9002"].join("\n"));
    expect(found.map(f => f.key)).toEqual(["MEDGEMMA_MODEL"]);
    expect(found[0].reason).toMatch(/second assignment to WSI_PORT/);
});
