class T extends Error {
  constructor(e, t) {
    super(e, t), this.name = "WebTiffError";
  }
}
class U extends T {
  constructor(e, { status: t = null, statusText: s = "", url: r = null, range: n = null, body: i = null, cause: o } = {}) {
    super(e, o ? { cause: o } : void 0), this.name = "WebTiffHttpError", this.status = t, this.statusText = s, this.url = r, this.range = n, this.body = i;
  }
}
class y extends T {
  constructor(e, { code: t = null, cause: s } = {}) {
    super(e, s ? { cause: s } : void 0), this.name = "WebTiffDecodeError", this.code = t;
  }
}
class I extends T {
  constructor(e, { code: t = null } = {}) {
    super(e), this.name = "WebTiffUnsupportedError", this.code = t;
  }
}
class D extends T {
  constructor(e = "aborted") {
    super(e), this.name = "AbortError";
  }
}
function v(a, e) {
  const t = e || `web-tiff status ${a}`;
  switch (a) {
    case -4:
      return new I(t, { code: a });
    case -7:
      return new D(t);
    default:
      return new y(t, { code: a });
  }
}
const N = 0, H = 1, L = 0, j = {
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
}, K = 4294967295, P = 32, W = 32, x = 2, $ = 32;
class Y {
  #t;
  #s;
  #r = /* @__PURE__ */ new Map();
  #i = 1;
  constructor(e) {
    this.#t = e, e._wt_init(0), this.#s = {
      req: e._wt_read_req_size(),
      header: e._wt_result_header_size(),
      band: e._wt_result_band_size(),
      pack: e._wt_result_pack_size(),
      range: e._wt_range_size()
    };
  }
  get buildInfo() {
    return JSON.parse(this.#t.UTF8ToString(this.#t._wt_build_info()));
  }
  /** Ranges the decoder is waiting on, already block-aligned and coalesced. */
  #c(e) {
    const t = this.#t, s = t._wt_wants_count(e), r = t._wt_wants_ptr(e), n = [];
    for (let i = 0; i < s; i++) {
      const o = r + i * this.#s.range;
      n.push({
        offset: t.HEAPF64[o / 8],
        length: t.HEAPU32[(o + 8) / 4]
      });
    }
    return n;
  }
  async #e(e, t, s) {
    const r = this.#t;
    for (const { offset: n, length: i } of this.#c(e)) {
      const o = await t.read(n, i, s);
      if (!o.length) continue;
      const l = r._wt_cache_reserve(e, n, o.length);
      if (l === 0) throw new y("out of memory reserving a block");
      r.HEAPU8.set(o, l), r._wt_cache_commit(e, n, o.length);
    }
  }
  #n(e, t) {
    const s = this.#t.UTF8ToString(this.#t._wt_last_error(e));
    return v(t, s);
  }
  /**
   * Open a file and parse every directory.
   *
   * @param {{getSize(): Promise<number>, read(offset, length, signal): Promise<Uint8Array>}} source
   */
  async open(e, { blockSize: t = 65536, cacheBytes: s = 32 * 1024 * 1024, signal: r } = {}) {
    const n = this.#t, i = await e.getSize(), o = n._wt_file_create(i, t, s);
    if (o <= 0) throw new y(`cannot open: status ${o}`);
    let l = n._wt_open(o), h = 0;
    for (; l === H; ) {
      if (await this.#e(o, e, r), ++h > $)
        throw n._wt_file_close(o), new y("the header did not resolve after 32 fetches");
      l = n._wt_open(o);
    }
    if (l !== N) {
      const b = this.#n(o, l);
      throw n._wt_file_close(o), b;
    }
    const u = JSON.parse(n.UTF8ToString(n._wt_meta_json(o)));
    if (u.abi !== x)
      throw n._wt_file_close(o), new y(
        `[web-tiff] this build speaks ABI ${x} but the WebAssembly module speaks ${u.abi}. The .mjs and the .wasm are versioned together; re-copy the whole folder rather than one file of it.`
      );
    const _ = this.#i++;
    return this.#r.set(_, { handle: o, source: e }), { id: _, meta: u };
  }
  close(e) {
    const t = this.#r.get(e);
    t && (this.#t._wt_file_close(t.handle), this.#r.delete(e));
  }
  #o(e, t) {
    const s = this.#t, r = s.HEAPU32, n = s.HEAP32, i = s.HEAPF32, o = e / 4;
    s.HEAPU8.fill(0, e, e + this.#s.req), r[o + 0] = t.dir ?? 0, n[o + 1] = t.subifd ?? -1, r[o + 2] = t.sx0, r[o + 3] = t.sy0, r[o + 4] = t.sx1, r[o + 5] = t.sy1, r[o + 6] = t.outWidth ?? t.sx1 - t.sx0, r[o + 7] = t.outHeight ?? t.sy1 - t.sy0, r[o + 8] = t.resample ?? 0, r[o + 9] = t.interpretation ?? 0, r[o + 10] = t.packFlags ?? 0, r[o + 11] = t.output ?? L, i[o + 12] = t.padAlpha ?? 1;
    const l = t.channels ?? [];
    r[o + 13] = Math.min(l.length, P);
    for (let c = 0; c < P; c++) n[o + 14 + c] = l[c] ?? -1;
    const h = o + 14 + P;
    for (let c = 0; c < 4; c++)
      r[h + c] = t.rgbaChannels?.[c] ?? K;
    const u = t.planes ?? [], _ = Math.min(u.length, W), b = h + 4, d = b + 1, f = d + W;
    r[b] = _;
    for (let c = 0; c < _; c++)
      r[d + c] = u[c].dir ?? 0, n[f + c] = u[c].subifd ?? -1;
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
  #a(e, t) {
    const s = new ArrayBuffer(t);
    return new Uint8Array(s).set(this.#t.HEAPU8.subarray(e, e + t)), s;
  }
  #l(e) {
    const t = this.#t, s = t.HEAPU32, r = t.HEAP32, n = t.HEAPF64, i = t._wt_result_header_ptr(e) / 4, o = {
      width: s[i + 0],
      height: s[i + 1],
      mode: s[i + 2] === 0 ? "image" : "data",
      channelCount: s[i + 3],
      encodingVersion: s[i + 4],
      output: s[i + 5],
      packCount: s[i + 6],
      bandCount: s[i + 7],
      flags: s[i + 8]
    }, l = [], h = t._wt_result_bands_ptr(e), u = [];
    for (let d = 0; d < o.bandCount; d++) {
      const f = (h + d * this.#s.band) / 4, c = s[f + 0], g = s[f + 1], E = s[f + 2], S = j[E] ?? Uint8Array, m = this.#a(c, g);
      u.push({
        data: new S(m),
        sampleType: E,
        flags: s[f + 3],
        channel: r[f + 4]
      }), l.push(m);
    }
    const _ = t._wt_result_packs_ptr(e), b = [];
    for (let d = 0; d < o.packCount; d++) {
      const f = _ + d * this.#s.pack, c = f / 4, g = s[c + 0] === 0 ? "RGBA8" : "RGBA16F", E = s[c + 1], S = s[c + 2], m = g === "RGBA8" ? Uint8Array : Uint16Array, B = this.#a(E, S), M = [];
      for (let w = 0; w < 4; w++) M.push(r[c + 4 + w]);
      const R = [], O = [];
      for (let w = 0; w < 4; w++)
        R.push(n[(f + 32) / 8 + w]), O.push(n[(f + 64) / 8 + w]);
      b.push({
        format: g,
        data: new m(B),
        channels: M,
        normalized: s[c + 3] === 1,
        scale: R,
        offset: O
      }), l.push(B);
    }
    return { header: o, bands: u, packs: b, transfer: l };
  }
  /** Read a window. Fetches whatever the decode needs first. */
  async read(e, t, { signal: s } = {}) {
    const r = this.#r.get(e);
    if (!r) throw new y(`unknown file ${e}`);
    const n = this.#t, i = n._malloc(this.#s.req), o = n._malloc(4);
    try {
      let l = 0;
      for (; ; ) {
        if (s?.aborted) throw new DOMException("aborted", "AbortError");
        this.#o(i, t), n._wt_plan_region(r.handle, i, 0), await this.#e(r.handle, r.source, s), this.#o(i, t);
        const u = n._wt_read(r.handle, i, o);
        if (u === N) break;
        if (u !== H) throw this.#n(r.handle, u);
        if (++l > $)
          throw new y("the tile did not resolve after 32 fetches");
      }
      const h = n.HEAPU32[o / 4];
      try {
        return this.#l(h);
      } finally {
        n._wt_result_free(h);
      }
    } finally {
      n._free(i), n._free(o);
    }
  }
  /** Warnings accumulated since the last drain, deduplicated by code. */
  drainWarnings() {
    const e = this.#t, t = e._malloc(4096);
    try {
      return e._wt_drain_warnings(t, 4096) > 0 ? JSON.parse(e.UTF8ToString(t)) : [];
    } finally {
      e._free(t);
    }
  }
}
const A = {
  INIT: "init",
  OPEN: "open",
  READ: "read",
  CLOSE: "close",
  ABORT: "abort"
}, F = {
  READY: "ready",
  WARN: "warn"
};
async function G(a) {
  const { BlobSource: e, BytesSource: t } = await Promise.resolve().then(() => Z);
  switch (a.kind) {
    case "blob":
      return new e(a.blob);
    case "bytes":
      return new t(a.bytes);
    case "url": {
      const { HttpSource: s } = await Promise.resolve().then(() => et);
      return new s(a.url, {
        headers: a.headers,
        credentials: a.credentials,
        captureErrorBody: a.captureErrorBody
      });
    }
    default:
      throw new TypeError(`unknown source kind: ${a.kind}`);
  }
}
let p = null;
const C = /* @__PURE__ */ new Map(), k = /* @__PURE__ */ new Map();
async function J({ wasmUrl: a }) {
  const { default: e } = await import(
    /* @vite-ignore */
    a
  ), t = await e();
  return p = new Y(t), { buildInfo: p.buildInfo };
}
function z() {
  if (p)
    for (const a of p.drainWarnings())
      self.postMessage({ kind: F.WARN, ...a });
}
async function X(a) {
  switch (a.op) {
    case A.INIT:
      return { result: await J(a) };
    case A.OPEN: {
      const e = await G(a.src), { id: t, meta: s } = await p.open(e, a.options ?? {});
      return C.set(t, e), { result: { id: t, meta: s } };
    }
    case A.READ: {
      const e = new AbortController();
      k.set(a.id, e);
      try {
        const { header: t, bands: s, packs: r, transfer: n } = await p.read(
          a.file,
          a.req,
          { signal: e.signal }
        );
        return { result: { header: t, bands: s, packs: r }, transfer: n };
      } finally {
        k.delete(a.id);
      }
    }
    case A.CLOSE:
      return p.close(a.file), C.delete(a.file), { result: null };
    case A.ABORT:
      return k.get(a.target)?.abort(), { result: null };
    default:
      throw new Error(`unknown op: ${a.op}`);
  }
}
self.onmessage = async (a) => {
  const e = a.data;
  try {
    const { result: t, transfer: s } = await X(e);
    z(), self.postMessage({ id: e.id, ok: !0, result: t }, s ?? []);
  } catch (t) {
    z(), self.postMessage({
      id: e.id,
      ok: !1,
      // Errors do not survive structured cloning with their subclass intact, so
      // the fields the caller acts on are sent explicitly and rebuilt on arrival.
      error: {
        name: t?.name ?? "Error",
        message: t?.message ?? String(t),
        status: t?.status ?? null,
        url: t?.url ?? null,
        code: t?.code ?? null
      }
    });
  }
};
self.postMessage({ kind: F.READY });
class V {
  #t;
  constructor(e) {
    this.#t = e instanceof Uint8Array ? e : new Uint8Array(e);
  }
  async getSize() {
    return this.#t.length;
  }
  async read(e, t) {
    const s = Math.min(e, this.#t.length), r = Math.min(e + t, this.#t.length);
    return this.#t.subarray(s, r);
  }
}
class Q {
  #t;
  constructor(e) {
    this.#t = e;
  }
  async getSize() {
    return this.#t.size;
  }
  async read(e, t, s) {
    if (s?.aborted) throw new DOMException("aborted", "AbortError");
    const r = Math.min(e + t, this.#t.size);
    if (r <= e) return new Uint8Array(0);
    const n = await this.#t.slice(e, r).arrayBuffer();
    return new Uint8Array(n);
  }
}
const Z = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BlobSource: Q,
  BytesSource: V
}, Symbol.toStringTag, { value: "Module" })), q = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
class tt {
  #t;
  #s;
  #r;
  #i;
  #c;
  #e = null;
  #n = null;
  // set when the server ignored Range and sent everything
  #o = /* @__PURE__ */ new Map();
  constructor(e, {
    fetch: t,
    headers: s = {},
    credentials: r,
    captureErrorBody: n = !1
  } = {}) {
    this.#t = String(e), this.#s = t ?? globalThis.fetch.bind(globalThis), this.#r = s, this.#i = r, this.#c = n;
  }
  get url() {
    return this.#t;
  }
  async #a(e, t) {
    const s = { ...this.#r };
    e && (s.Range = `bytes=${e.start}-${e.end - 1}`);
    let r;
    try {
      r = await this.#s(this.#t, {
        headers: s,
        signal: t,
        credentials: this.#i
      });
    } catch (n) {
      throw n?.name === "AbortError" ? n : new U(`[web-tiff] cannot reach ${this.#t}: ${n.message}`, {
        url: this.#t,
        range: e,
        cause: n
      });
    }
    if (!r.ok) {
      let n = null;
      if (this.#c)
        try {
          const i = await r.clone().text();
          n = i.replace(/\s+/g, " ").slice(0, 200), i.length > 200 && (n += "...");
        } catch {
        }
      throw new U(
        `[web-tiff] HTTP ${r.status} for ${this.#t}${n ? `: ${n}` : ""}`,
        {
          status: r.status,
          statusText: r.statusText,
          url: this.#t,
          range: e,
          body: n
        }
      );
    }
    return r;
  }
  async #l(e, t) {
    try {
      return await this.#a(e, t);
    } catch (s) {
      if (s?.name === "AbortError" || !(s.status == null || q.has(s.status))) throw s;
      return await new Promise((n) => setTimeout(n, 250)), this.#a(e, t);
    }
  }
  /**
   * Learn the size, and get the first block in the same round trip.
   *
   * A HEAD would cost a request and answer only half the question. The first
   * range request answers both: `Content-Range` carries the total length, and the
   * bytes are exactly the header region that is about to be parsed.
   */
  async getSize(e) {
    if (this.#e != null) return this.#e;
    const t = await this.#l({ start: 0, end: 65536 }, e);
    if (t.status === 200) {
      const n = new Uint8Array(await t.arrayBuffer());
      return this.#n = n, this.#e = n.length, this.#e;
    }
    const s = t.headers.get("Content-Range"), r = s ? Number(s.split("/")[1]) : NaN;
    if (!Number.isFinite(r))
      throw new U(
        `[web-tiff] ${this.#t} answered a range request without a usable Content-Range; the server must support byte ranges`,
        { status: t.status, url: this.#t }
      );
    return this.#e = r, this.#u = new Uint8Array(await t.arrayBuffer()), r;
  }
  #u = null;
  async read(e, t, s) {
    this.#e == null && await this.getSize(s);
    const r = Math.min(e, this.#e), n = Math.min(e + t, this.#e);
    if (n <= r) return new Uint8Array(0);
    if (this.#n) return this.#n.subarray(r, n);
    if (this.#u && n <= this.#u.length)
      return this.#u.subarray(r, n);
    const i = `${r}-${n}`, o = this.#o.get(i);
    if (o) return o;
    const l = this.#l({ start: r, end: n }, s).then(async (h) => new Uint8Array(await h.arrayBuffer())).finally(() => this.#o.delete(i));
    return this.#o.set(i, l), l;
  }
}
const et = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HttpSource: tt
}, Symbol.toStringTag, { value: "Module" }));
