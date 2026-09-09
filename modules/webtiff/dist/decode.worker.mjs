class F {
  /**
   * @param {object} init
   * @param {string} init.code stable identifier; the message may name an index,
   *   the code may not, because the code is what deduplication keys on
   * @param {string} init.message human-readable, already prefixed with [web-tiff]
   *   when it came from the decoder
   * @param {"warn"|"info"} [init.severity="warn"] `info` reports a decision that
   *   is correct but worth naming, such as a plane stack being read as channels
   * @param {number|null} [init.file=null] the file this was raised against, in
   *   whatever id space the caller holds; null for one raised before any file
   * @param {string|null} [init.label=null] a name for that file, for a host
   *   showing several slides at once
   */
  constructor({ code: t, message: e, severity: s = "warn", file: n = null, label: r = null }) {
    this.code = t, this.message = e, this.severity = s, this.file = n, this.label = r;
  }
  toString() {
    return this.message;
  }
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      severity: this.severity,
      file: this.file,
      label: this.label
    };
  }
}
class T extends Error {
  constructor(t, e) {
    super(t, e), this.name = "WebTiffError";
  }
}
class U extends T {
  constructor(t, { status: e = null, statusText: s = "", url: n = null, range: r = null, body: i = null, cause: a } = {}) {
    super(t, a ? { cause: a } : void 0), this.name = "WebTiffHttpError", this.status = e, this.statusText = s, this.url = n, this.range = r, this.body = i;
  }
}
class y extends T {
  constructor(t, { code: e = null, cause: s } = {}) {
    super(t, s ? { cause: s } : void 0), this.name = "WebTiffDecodeError", this.code = e;
  }
}
class I extends T {
  constructor(t, { code: e = null } = {}) {
    super(t), this.name = "WebTiffUnsupportedError", this.code = e;
  }
}
class L extends T {
  constructor(t = "aborted") {
    super(t), this.name = "AbortError";
  }
}
function j(o, t) {
  const e = t || `web-tiff status ${o}`;
  switch (o) {
    case -4:
      return new I(e, { code: o });
    case -7:
      return new L(e);
    default:
      return new y(e, { code: o });
  }
}
const O = 0, R = 1, J = 0, Y = {
  0: Uint8Array,
  1: Uint16Array,
  2: Uint32Array,
  3: Int8Array,
  4: Int16Array,
  5: Int32Array,
  6: Uint16Array,
  // half floats travel as raw bits
  7: Float32Array,
  8: Float64Array
}, K = 4294967295, k = 32, W = 32, H = 2, x = 8, z = 4096, C = 16384;
class X {
  #t;
  #s;
  #n = /* @__PURE__ */ new Map();
  /** Native handle -> the entry it belongs to, for attributing a drained record. */
  #r = /* @__PURE__ */ new Map();
  #i = /* @__PURE__ */ new Set();
  #e = 1;
  constructor(t) {
    this.#t = t, t._wt_init(0), this.#s = {
      req: t._wt_read_req_size(),
      header: t._wt_result_header_size(),
      band: t._wt_result_band_size(),
      pack: t._wt_result_pack_size(),
      range: t._wt_range_size()
    };
  }
  get buildInfo() {
    return JSON.parse(this.#t.UTF8ToString(this.#t._wt_build_info()));
  }
  /** Ranges the decoder is waiting on, already block-aligned and coalesced. */
  #a(t) {
    const e = this.#t, s = e._wt_wants_count(t), n = e._wt_wants_ptr(t), r = [];
    for (let i = 0; i < s; i++) {
      const a = n + i * this.#s.range;
      r.push({
        offset: e.HEAPF64[a / 8],
        length: e.HEAPU32[(a + 8) / 4]
      });
    }
    return r;
  }
  async #c(t, e, s) {
    const n = this.#t;
    for (const { offset: r, length: i } of this.#a(t)) {
      const a = await e.read(r, i, s);
      if (!a.length) continue;
      const c = n._wt_cache_reserve(t, r, a.length);
      if (c === 0) throw new y("out of memory reserving a block");
      n.HEAPU8.set(a, c), n._wt_cache_commit(t, r, a.length);
    }
  }
  #l(t, e) {
    const s = this.#t.UTF8ToString(this.#t._wt_last_error(t));
    return j(e, s);
  }
  /**
   * A number that grows while an operation is getting somewhere, and stops when
   * it is not.
   *
   * The decoder reports how many reads its last attempt served out of the cache.
   * An attempt is a full re-run over a warmer cache, so a round trip that let it
   * get further shows up as a larger count and one that changed nothing shows up
   * as the same count -- which is exactly the difference between a loop working
   * and a loop stuck.
   *
   * The fallback covers new JavaScript over an old .wasm, a combination this
   * library already ships into: with no counter to read, a round that ends
   * waiting on precisely the ranges it was already waiting on is the stalled one.
   */
  #h(t) {
    const e = this.#t;
    if (typeof e._wt_progress == "function")
      return () => e._wt_progress(t);
    let s = 0, n = null;
    return () => {
      const r = this.#a(t).map((i) => `${i.offset}:${i.length}`).join(",");
      return r !== n && (n = r, s++), s;
    };
  }
  /**
   * Bound the round trips that achieve nothing, and say which bound was hit.
   *
   * Returns a `step(progress)` to call once per round with the current progress
   * value; it throws when the operation has stopped resolving.
   */
  #o(t) {
    let e = -1, s = 0, n = 0;
    return (r) => {
      if (n++, r > e)
        e = r, s = 0;
      else if (++s > x)
        throw new y(
          `${t} stopped resolving: ${x} fetches in a row advanced nothing, after ${n} fetches in total. The source is not returning the ranges being asked for.`
        );
      if (n > z)
        throw new y(
          `${t} did not resolve within ${z} fetches, which is the runaway limit rather than a budget; the file is deeper than anything this library expects to see.`
        );
    };
  }
  /**
   * Open a file and parse every directory.
   *
   * @param {{getSize(): Promise<number>, read(offset, length, signal): Promise<Uint8Array>}} source
   * @param {object} [options]
   * @param {string|null} [options.label] a name for this file, carried on the
   *   diagnostics it raises
   */
  async open(t, { blockSize: e = 65536, cacheBytes: s = 32 * 1024 * 1024, signal: n, label: r = null } = {}) {
    const i = this.#t, a = await t.getSize(), c = i._wt_file_create(a, e, s);
    if (c <= 0) throw new y(`cannot open: status ${c}`);
    const f = this.#e++, d = { id: f, handle: c, source: t, label: r };
    this.#r.set(c, d);
    try {
      const w = this.#h(c), b = this.#o("the header");
      let h = i._wt_open(c);
      for (; h === R; )
        await this.#c(c, t, n), h = i._wt_open(c), b(w());
      if (h !== O) throw this.#l(c, h);
      const u = JSON.parse(i.UTF8ToString(i._wt_meta_json(c)));
      if (u.abi !== H)
        throw new y(
          `[web-tiff] this build speaks ABI ${H} but the WebAssembly module speaks ${u.abi}. The .mjs and the .wasm are versioned together; re-copy the whole folder rather than one file of it.`
        );
      return this.#n.set(f, d), { id: f, meta: u };
    } catch (w) {
      throw this.#u(), i._wt_file_close(c), this.#r.delete(c), w;
    } finally {
      this.#u();
    }
  }
  close(t) {
    const e = this.#n.get(t);
    e && (this.#t._wt_file_close(e.handle), this.#n.delete(t), this.#r.delete(e.handle));
  }
  #f(t, e) {
    const s = this.#t, n = s.HEAPU32, r = s.HEAP32, i = s.HEAPF32, a = t / 4;
    s.HEAPU8.fill(0, t, t + this.#s.req), n[a + 0] = e.dir ?? 0, r[a + 1] = e.subifd ?? -1, n[a + 2] = e.sx0, n[a + 3] = e.sy0, n[a + 4] = e.sx1, n[a + 5] = e.sy1, n[a + 6] = e.outWidth ?? e.sx1 - e.sx0, n[a + 7] = e.outHeight ?? e.sy1 - e.sy0, n[a + 8] = e.resample ?? 0, n[a + 9] = e.interpretation ?? 0, n[a + 10] = e.packFlags ?? 0, n[a + 11] = e.output ?? J, i[a + 12] = e.padAlpha ?? 1;
    const c = e.channels ?? [];
    n[a + 13] = Math.min(c.length, k);
    for (let l = 0; l < k; l++) r[a + 14 + l] = c[l] ?? -1;
    const f = a + 14 + k;
    for (let l = 0; l < 4; l++)
      n[f + l] = e.rgbaChannels?.[l] ?? K;
    const d = e.planes ?? [], w = Math.min(d.length, W), b = f + 4, h = b + 1, u = h + W;
    n[b] = w;
    for (let l = 0; l < w; l++)
      n[h + l] = d[l].dir ?? 0, r[u + l] = d[l].subifd ?? -1;
  }
  /**
   * Copy bytes out of the WebAssembly heap into a transferable ArrayBuffer.
   *
   * Not `HEAPU8.buffer.slice()`: under the pthreads build the heap is a
   * SharedArrayBuffer, and slicing one returns another SharedArrayBuffer, which
   * postMessage refuses to put in a transfer list. Allocating a plain ArrayBuffer
   * and filling it costs exactly the same copy and works for both builds.
   *
   * This copy is the one irreducible cost of the boundary: a view into the heap
   * cannot be transferred, and the heap itself must not be.
   */
  #d(t, e) {
    const s = new ArrayBuffer(e);
    return new Uint8Array(s).set(this.#t.HEAPU8.subarray(t, t + e)), s;
  }
  #w(t) {
    const e = this.#t, s = e.HEAPU32, n = e.HEAP32, r = e.HEAPF64, i = e._wt_result_header_ptr(t) / 4, a = {
      width: s[i + 0],
      height: s[i + 1],
      mode: s[i + 2] === 0 ? "image" : "data",
      channelCount: s[i + 3],
      encodingVersion: s[i + 4],
      output: s[i + 5],
      packCount: s[i + 6],
      bandCount: s[i + 7],
      flags: s[i + 8]
    }, c = [], f = e._wt_result_bands_ptr(t), d = [];
    for (let h = 0; h < a.bandCount; h++) {
      const u = (f + h * this.#s.band) / 4, l = s[u + 0], A = s[u + 1], m = s[u + 2], S = Y[m] ?? Uint8Array, E = this.#d(l, A);
      d.push({
        data: new S(E),
        sampleType: m,
        flags: s[u + 3],
        channel: n[u + 4]
      }), c.push(E);
    }
    const w = e._wt_result_packs_ptr(t), b = [];
    for (let h = 0; h < a.packCount; h++) {
      const u = w + h * this.#s.pack, l = u / 4, A = s[l + 0] === 0 ? "RGBA8" : "RGBA16F", m = s[l + 1], S = s[l + 2], E = A === "RGBA8" ? Uint8Array : Uint16Array, B = this.#d(m, S), $ = [];
      for (let _ = 0; _ < 4; _++) $.push(n[l + 4 + _]);
      const M = [], N = [];
      for (let _ = 0; _ < 4; _++)
        M.push(r[(u + 32) / 8 + _]), N.push(r[(u + 64) / 8 + _]);
      b.push({
        format: A,
        data: new E(B),
        channels: $,
        normalized: s[l + 3] === 1,
        scale: M,
        offset: N
      }), c.push(B);
    }
    return { header: a, bands: d, packs: b, transfer: c };
  }
  /** Read a window. Fetches whatever the decode needs first. */
  async read(t, e, { signal: s } = {}) {
    const n = this.#n.get(t);
    if (!n) throw new y(`unknown file ${t}`);
    const r = this.#t, i = r._malloc(this.#s.req), a = r._malloc(4);
    try {
      const c = this.#h(n.handle), f = this.#o("the tile");
      for (; ; ) {
        if (s?.aborted) throw new DOMException("aborted", "AbortError");
        this.#f(i, e), r._wt_plan_region(n.handle, i, 0), await this.#c(n.handle, n.source, s), this.#f(i, e);
        const w = r._wt_read(n.handle, i, a);
        if (w === O) break;
        if (w !== R) throw this.#l(n.handle, w);
        f(c());
      }
      const d = r.HEAPU32[a / 4];
      try {
        return this.#w(d);
      } finally {
        r._wt_result_free(d);
      }
    } finally {
      r._free(i), r._free(a), this.#u();
    }
  }
  /**
   * Subscribe to diagnostics. Returns an unsubscribe function.
   *
   * Subscribe or call `drainWarnings()` yourself, not both: the ring is drained
   * once, so whichever runs first is the only one that sees a given record.
   *
   * @param {(d: Diagnostic) => void} fn
   * @returns {() => void}
   */
  onWarning(t) {
    return this.#i.add(t), () => this.#i.delete(t);
  }
  /**
   * Deliver whatever is waiting.
   *
   * For a caller that subscribes after opening -- which is every caller, since
   * the file id it filters on does not exist until then. Without this, a host
   * that opens a file and only reads its metadata never hears what the parse
   * found.
   */
  flushWarnings() {
    this.#u();
  }
  /**
   * Drain and dispatch.
   *
   * Called in a `finally` around every entry point that can warn, which is what
   * makes the in-process decoder deliver diagnostics at all: draining used to
   * happen only in the worker, so a host without workers -- a custom source, a
   * caller-supplied fetch, Node -- saw none of them ever.
   *
   * With nobody listening it drains nothing, deliberately: the records stay in
   * the ring for a subscriber that has not attached yet. They are not unbounded
   * -- the ring holds 32, closing a file forgets its own, and an overflow is
   * reported rather than silent.
   */
  #u() {
    if (this.#i.size === 0) return;
    let t;
    try {
      t = this.drainWarnings();
    } catch {
      return;
    }
    for (const e of t)
      for (const s of this.#i) s(e);
  }
  /**
   * Diagnostics accumulated since the last drain, deduplicated by (file, code).
   *
   * The native handle each carries is translated into this decoder's file id and
   * label, because a handle is an implementation detail of the module and is
   * reused as files close.
   *
   * @returns {Diagnostic[]}
   */
  drainWarnings() {
    const t = this.#t, e = t._malloc(C);
    try {
      return t._wt_drain_warnings(e, C) <= 0 ? [] : JSON.parse(t.UTF8ToString(e)).map((r) => {
        const i = r.file ? this.#r.get(r.file) : void 0;
        return new F({
          code: r.code,
          message: r.message,
          // Defaulted rather than required: new JavaScript over an old .wasm is
          // a combination this library already ships into, and a diagnostic that
          // arrives without a severity is still worth showing.
          severity: r.severity ?? "warn",
          file: i?.id ?? null,
          label: i?.label ?? null
        });
      });
    } finally {
      t._free(e);
    }
  }
}
const g = {
  INIT: "init",
  OPEN: "open",
  READ: "read",
  CLOSE: "close",
  ABORT: "abort"
}, D = {
  READY: "ready",
  WARN: "warn"
};
async function G(o) {
  const { BlobSource: t, BytesSource: e } = await Promise.resolve().then(() => tt);
  switch (o.kind) {
    case "blob":
      return new t(o.blob);
    case "bytes":
      return new e(o.bytes);
    case "url": {
      const { HttpSource: s } = await Promise.resolve().then(() => nt);
      return new s(o.url, {
        headers: o.headers,
        credentials: o.credentials,
        captureErrorBody: o.captureErrorBody
      });
    }
    default:
      throw new TypeError(`unknown source kind: ${o.kind}`);
  }
}
let p = null;
const v = /* @__PURE__ */ new Map(), P = /* @__PURE__ */ new Map();
async function V({ wasmUrl: o }) {
  const { default: t } = await import(
    /* @vite-ignore */
    o
  ), e = await t();
  return p = new X(e), p.onWarning((s) => self.postMessage({ kind: D.WARN, ...s.toJSON() })), { buildInfo: p.buildInfo };
}
async function Q(o) {
  switch (o.op) {
    case g.INIT:
      return { result: await V(o) };
    case g.OPEN: {
      const t = await G(o.src), { id: e, meta: s } = await p.open(t, o.options ?? {});
      return v.set(e, t), { result: { id: e, meta: s } };
    }
    case g.READ: {
      const t = new AbortController();
      P.set(o.id, t);
      try {
        const { header: e, bands: s, packs: n, transfer: r } = await p.read(
          o.file,
          o.req,
          { signal: t.signal }
        );
        return { result: { header: e, bands: s, packs: n }, transfer: r };
      } finally {
        P.delete(o.id);
      }
    }
    case g.CLOSE:
      return p.close(o.file), v.delete(o.file), { result: null };
    case g.ABORT:
      return P.get(o.target)?.abort(), { result: null };
    default:
      throw new Error(`unknown op: ${o.op}`);
  }
}
self.onmessage = async (o) => {
  const t = o.data;
  try {
    const { result: e, transfer: s } = await Q(t);
    self.postMessage({ id: t.id, ok: !0, result: e }, s ?? []);
  } catch (e) {
    self.postMessage({
      id: t.id,
      ok: !1,
      // Errors do not survive structured cloning with their subclass intact, so
      // the fields the caller acts on are sent explicitly and rebuilt on arrival.
      error: {
        name: e?.name ?? "Error",
        message: e?.message ?? String(e),
        status: e?.status ?? null,
        url: e?.url ?? null,
        code: e?.code ?? null
      }
    });
  }
};
self.postMessage({ kind: D.READY });
class Z {
  #t;
  constructor(t) {
    this.#t = t instanceof Uint8Array ? t : new Uint8Array(t);
  }
  async getSize() {
    return this.#t.length;
  }
  async read(t, e) {
    const s = Math.min(t, this.#t.length), n = Math.min(t + e, this.#t.length);
    return this.#t.subarray(s, n);
  }
}
class q {
  #t;
  constructor(t) {
    this.#t = t;
  }
  async getSize() {
    return this.#t.size;
  }
  async read(t, e, s) {
    if (s?.aborted) throw new DOMException("aborted", "AbortError");
    const n = Math.min(t + e, this.#t.size);
    if (n <= t) return new Uint8Array(0);
    const r = await this.#t.slice(t, n).arrayBuffer();
    return new Uint8Array(r);
  }
}
const tt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BlobSource: q,
  BytesSource: Z
}, Symbol.toStringTag, { value: "Module" })), et = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
class st {
  #t;
  #s;
  #n;
  #r;
  #i;
  #e = null;
  #a = null;
  // set when the server ignored Range and sent everything
  #c = /* @__PURE__ */ new Map();
  constructor(t, {
    fetch: e,
    headers: s = {},
    credentials: n,
    captureErrorBody: r = !1
  } = {}) {
    this.#t = String(t), this.#s = e ?? globalThis.fetch.bind(globalThis), this.#n = s, this.#r = n, this.#i = r;
  }
  get url() {
    return this.#t;
  }
  async #l(t, e) {
    const s = { ...this.#n };
    t && (s.Range = `bytes=${t.start}-${t.end - 1}`);
    let n;
    try {
      n = await this.#s(this.#t, {
        headers: s,
        signal: e,
        credentials: this.#r
      });
    } catch (r) {
      throw r?.name === "AbortError" ? r : new U(`[web-tiff] cannot reach ${this.#t}: ${r.message}`, {
        url: this.#t,
        range: t,
        cause: r
      });
    }
    if (!n.ok) {
      let r = null;
      if (this.#i)
        try {
          const i = await n.clone().text();
          r = i.replace(/\s+/g, " ").slice(0, 200), i.length > 200 && (r += "...");
        } catch {
        }
      throw new U(
        `[web-tiff] HTTP ${n.status} for ${this.#t}${r ? `: ${r}` : ""}`,
        {
          status: n.status,
          statusText: n.statusText,
          url: this.#t,
          range: t,
          body: r
        }
      );
    }
    return n;
  }
  async #h(t, e) {
    try {
      return await this.#l(t, e);
    } catch (s) {
      if (s?.name === "AbortError" || !(s.status == null || et.has(s.status))) throw s;
      return await new Promise((r) => setTimeout(r, 250)), this.#l(t, e);
    }
  }
  /**
   * Learn the size, and get the first block in the same round trip.
   *
   * A HEAD would cost a request and answer only half the question. The first
   * range request answers both: `Content-Range` carries the total length, and the
   * bytes are exactly the header region that is about to be parsed.
   */
  async getSize(t) {
    if (this.#e != null) return this.#e;
    const e = await this.#h({ start: 0, end: 65536 }, t);
    if (e.status === 200) {
      const r = new Uint8Array(await e.arrayBuffer());
      return this.#a = r, this.#e = r.length, this.#e;
    }
    const s = e.headers.get("Content-Range"), n = s ? Number(s.split("/")[1]) : NaN;
    if (!Number.isFinite(n))
      throw new U(
        `[web-tiff] ${this.#t} answered a range request without a usable Content-Range; the server must support byte ranges`,
        { status: e.status, url: this.#t }
      );
    return this.#e = n, this.#o = new Uint8Array(await e.arrayBuffer()), n;
  }
  #o = null;
  async read(t, e, s) {
    this.#e == null && await this.getSize(s);
    const n = Math.min(t, this.#e), r = Math.min(t + e, this.#e);
    if (r <= n) return new Uint8Array(0);
    if (this.#a) return this.#a.subarray(n, r);
    if (this.#o && r <= this.#o.length)
      return this.#o.subarray(n, r);
    const i = `${n}-${r}`, a = this.#c.get(i);
    if (a) return a;
    const c = this.#h({ start: n, end: r }, s).then(async (f) => new Uint8Array(await f.arrayBuffer())).finally(() => this.#c.delete(i));
    return this.#c.set(i, c), c;
  }
}
const nt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HttpSource: st
}, Symbol.toStringTag, { value: "Module" }));
