/**
 * The slide-download driver's two load-bearing decisions.
 *
 * 1. **Which transport.** A whole-slide image is routinely tens of gigabytes, so
 *    the buffered path is the exception, not the rule. Getting this backwards is
 *    not a cosmetic bug — it is an out-of-memory tab on a real slide (streaming
 *    something that could have gone to the browser's download manager) or a
 *    silent 401 (handing an authenticated URL to an `<a download>`, which cannot
 *    carry headers).
 * 2. **Which file name.** `<a download="x">` OVERRIDES `Content-Disposition`, so
 *    a synthesized guess would replace the server's correct `biopsy-42.ndpi`
 *    with `slide.bin`. The precedence below is what keeps that from happening.
 */
import { test, expect } from "@xopat/test-harness";

globalThis.window = globalThis.window ?? globalThis;

globalThis.window.location = globalThis.window.location
    ?? { href: "https://viewer.example.org/xopat/", origin: "https://viewer.example.org" };

const { requiresHeaderTransport, resolveFileName, fileNameFromDisposition, isSameOriginUrl } =
    await import("../../../src/classes/app/slide-file-download.ts");

const headers = (map) => ({ get: (k) => map[String(k).toLowerCase()] ?? null });
const response = (map) => ({ headers: headers(map) });

test("no client means the browser downloads it directly @unit", async () => {
    expect(await requiresHeaderTransport(undefined, "/data/WSI_original/x.svs")).toBe(false);
});

test("a client injecting auth headers forces the streamed transport @unit", async () => {
    const client = { _authHeaders: async () => ({ Authorization: "Bearer x" }) };
    expect(await requiresHeaderTransport(client, "https://wsi/v3/slides/download")).toBe(true);
});

test("a client with no secrets still allows the browser path @unit", async () => {
    const client = { _authHeaders: async () => ({}) };
    expect(await requiresHeaderTransport(client, "https://wsi/v3/slides/download")).toBe(false);
});

test("a proxied client always streams — it also injects session/CSRF headers @unit", async () => {
    // `usingProxy` short-circuits before `_authHeaders`: empty auth headers do
    // NOT mean an anchor navigation would carry the same request.
    const client = { usingProxy: true, _authHeaders: async () => ({}) };
    expect(await requiresHeaderTransport(client, "/iipsrv/download")).toBe(true);
});

test("an unusable client degrades to streaming, never to a silent 401 @unit", async () => {
    const client = { _authHeaders: async () => { throw new Error("context never settled"); } };
    expect(await requiresHeaderTransport(client, "https://wsi/download")).toBe(true);
});

/**
 * Origin decides which browser-native mechanism is used. A false "same-origin"
 * verdict is the bug this pins: `<a download>` is ignored across origins, so the
 * click becomes a real top-level navigation, which fires `beforeunload` and
 * raises xOpat's "Leave site?" guard for an action that never meant to leave.
 */
test("only genuinely same-origin URLs take the anchor path @unit", () => {
    expect(isSameOriginUrl("/data/WSI_original/12-1.svs"), "relative").toBe(true);
    expect(isSameOriginUrl("https://viewer.example.org/v3/slides/download"), "absolute, same host").toBe(true);

    // The ordinary dev deployment: viewer and wsi-service on different ports.
    expect(isSameOriginUrl("https://viewer.example.org:8080/v3/slides/download"), "other port").toBe(false);
    expect(isSameOriginUrl("https://images.example.org/v3/slides/download"), "other host").toBe(false);
    expect(isSameOriginUrl("http://viewer.example.org/v3/slides/download"), "other scheme").toBe(false);

    // Degrades to the path that cannot navigate, never to the one that can.
    expect(isSameOriginUrl("http://"), "unparsable").toBe(false);
});

test("Content-Disposition parsing covers the three shapes servers send @unit", () => {
    expect(fileNameFromDisposition('attachment; filename="biopsy 42.ndpi"')).toBe("biopsy 42.ndpi");
    expect(fileNameFromDisposition("attachment; filename=biopsy-42.svs")).toBe("biopsy-42.svs");
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''bi%C3%B6psy.mrxs")).toBe("biöpsy.mrxs");
    expect(fileNameFromDisposition(null)).toBe(undefined);
});

test("the server's name outranks the descriptor's, which outranks the slide name @unit", () => {
    const dl = { url: "https://wsi/v3/slides/download", fileName: "from-descriptor.svs" };

    expect(resolveFileName(dl, response({ "content-disposition": 'attachment; filename="from-server.svs"' }), "Slide 1"))
        .toBe("from-server.svs");
    expect(resolveFileName(dl, response({}), "Slide 1")).toBe("from-descriptor.svs");
    expect(resolveFileName({ url: dl.url }, response({ "content-type": "image/tiff" }), "Slide 1"))
        .toBe("Slide 1.tiff");
});

test("the synthesized name is filesystem-safe and never double-extended @unit", () => {
    const dl = { url: "https://wsi/download" };
    expect(resolveFileName(dl, response({ "content-type": "application/zip" }), "case/42:a"))
        .toBe("case_42_a.zip");
    // Already carries an extension — do not append a guessed one.
    expect(resolveFileName(dl, response({}), "slide.ndpi")).toBe("slide.ndpi");
});

test("an unknown type falls back to the URL's own extension @unit", () => {
    expect(resolveFileName({ url: "https://mixture/data/WSI_original/12-1.svs" }, response({}), "Slide"))
        .toBe("Slide.svs");
});
