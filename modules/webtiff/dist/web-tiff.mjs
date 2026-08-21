class R extends Error {
  constructor(e, t) {
    super(e, t), this.name = "WebTiffError";
  }
}
class I extends R {
  constructor(e, { status: t = null, statusText: s = "", url: i = null, range: n = null, body: o = null, cause: a } = {}) {
    super(e, a ? { cause: a } : void 0), this.name = "WebTiffHttpError", this.status = t, this.statusText = s, this.url = i, this.range = n, this.body = o;
  }
}
class m extends R {
  constructor(e, { code: t = null, cause: s } = {}) {
    super(e, s ? { cause: s } : void 0), this.name = "WebTiffDecodeError", this.code = t;
  }
}
class Q extends R {
  constructor(e, { code: t = null } = {}) {
    super(e), this.name = "WebTiffUnsupportedError", this.code = t;
  }
}
class ie extends R {
  constructor(e = "aborted") {
    super(e), this.name = "AbortError";
  }
}
function oe(r, e) {
  const t = e || `web-tiff status ${r}`;
  switch (r) {
    case -4:
      return new Q(t, { code: r });
    case -7:
      return new ie(t);
    default:
      return new m(t, { code: r });
  }
}
const C = 0, L = 1, q = 0, ee = 1, B = 2, ae = {
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
}, le = 4294967295, O = 32;
class ce {
  #e;
  #t;
  #n = /* @__PURE__ */ new Map();
  #s = 1;
  constructor(e) {
    this.#e = e, e._wt_init(0), this.#t = {
      req: e._wt_read_req_size(),
      header: e._wt_result_header_size(),
      band: e._wt_result_band_size(),
      pack: e._wt_result_pack_size(),
      range: e._wt_range_size()
    };
  }
  get buildInfo() {
    return JSON.parse(this.#e.UTF8ToString(this.#e._wt_build_info()));
  }
  /** Ranges the decoder is waiting on, already block-aligned and coalesced. */
  #i(e) {
    const t = this.#e, s = t._wt_wants_count(e), i = t._wt_wants_ptr(e), n = [];
    for (let o = 0; o < s; o++) {
      const a = i + o * this.#t.range;
      n.push({
        offset: t.HEAPF64[a / 8],
        length: t.HEAPU32[(a + 8) / 4]
      });
    }
    return n;
  }
  async #r(e, t, s) {
    const i = this.#e;
    for (const { offset: n, length: o } of this.#i(e)) {
      const a = await t.read(n, o, s);
      if (!a.length) continue;
      const l = i._wt_cache_reserve(e, n, a.length);
      if (l === 0) throw new m("out of memory reserving a block");
      i.HEAPU8.set(a, l), i._wt_cache_commit(e, n, a.length);
    }
  }
  #o(e, t) {
    const s = this.#e.UTF8ToString(this.#e._wt_last_error(e));
    return oe(t, s);
  }
  /**
   * Open a file and parse every directory.
   *
   * @param {{getSize(): Promise<number>, read(offset, length, signal): Promise<Uint8Array>}} source
   */
  async open(e, { blockSize: t = 65536, cacheBytes: s = 32 * 1024 * 1024, signal: i } = {}) {
    const n = this.#e, o = await e.getSize(), a = n._wt_file_create(o, t, s);
    if (a <= 0) throw new m(`cannot open: status ${a}`);
    let l = n._wt_open(a), c = 0;
    for (; l === L; ) {
      if (await this.#r(a, e, i), ++c > O)
        throw n._wt_file_close(a), new m("the header did not resolve after 32 fetches");
      l = n._wt_open(a);
    }
    if (l !== C) {
      const u = this.#o(a, l);
      throw n._wt_file_close(a), u;
    }
    const h = this.#s++;
    return this.#n.set(h, { handle: a, source: e }), { id: h, meta: JSON.parse(n.UTF8ToString(n._wt_meta_json(a))) };
  }
  close(e) {
    const t = this.#n.get(e);
    t && (this.#e._wt_file_close(t.handle), this.#n.delete(e));
  }
  #a(e, t) {
    const s = this.#e, i = s.HEAPU32, n = s.HEAP32, o = s.HEAPF32, a = e / 4;
    s.HEAPU8.fill(0, e, e + this.#t.req), i[a + 0] = t.dir ?? 0, n[a + 1] = t.subifd ?? -1, i[a + 2] = t.sx0, i[a + 3] = t.sy0, i[a + 4] = t.sx1, i[a + 5] = t.sy1, i[a + 6] = t.outWidth ?? t.sx1 - t.sx0, i[a + 7] = t.outHeight ?? t.sy1 - t.sy0, i[a + 8] = t.resample ?? 0, i[a + 9] = t.interpretation ?? 0, i[a + 10] = t.packFlags ?? 0, i[a + 11] = t.output ?? q, o[a + 12] = t.padAlpha ?? 1;
    const l = t.channels ?? [];
    i[a + 13] = l.length;
    for (let c = 0; c < 16; c++) n[a + 14 + c] = l[c] ?? -1;
    for (let c = 0; c < 4; c++)
      i[a + 30 + c] = t.rgbaChannels?.[c] ?? le;
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
  #l(e, t) {
    const s = new ArrayBuffer(t);
    return new Uint8Array(s).set(this.#e.HEAPU8.subarray(e, e + t)), s;
  }
  #c(e) {
    const t = this.#e, s = t.HEAPU32, i = t.HEAP32, n = t.HEAPF64, o = t._wt_result_header_ptr(e) / 4, a = {
      width: s[o + 0],
      height: s[o + 1],
      mode: s[o + 2] === 0 ? "image" : "data",
      channelCount: s[o + 3],
      encodingVersion: s[o + 4],
      output: s[o + 5],
      packCount: s[o + 6],
      bandCount: s[o + 7],
      flags: s[o + 8]
    }, l = [], c = t._wt_result_bands_ptr(e), h = [];
    for (let d = 0; d < a.bandCount; d++) {
      const p = (c + d * this.#t.band) / 4, g = s[p + 0], T = s[p + 1], w = s[p + 2], _ = ae[w] ?? Uint8Array, S = this.#l(g, T);
      h.push({
        data: new _(S),
        sampleType: w,
        flags: s[p + 3],
        channel: i[p + 4]
      }), l.push(S);
    }
    const u = t._wt_result_packs_ptr(e), f = [];
    for (let d = 0; d < a.packCount; d++) {
      const p = u + d * this.#t.pack, g = p / 4, T = s[g + 0] === 0 ? "RGBA8" : "RGBA16F", w = s[g + 1], _ = s[g + 2], S = T === "RGBA8" ? Uint8Array : Uint16Array, x = this.#l(w, _), M = [];
      for (let b = 0; b < 4; b++) M.push(i[g + 4 + b]);
      const v = [], N = [];
      for (let b = 0; b < 4; b++)
        v.push(n[(p + 32) / 8 + b]), N.push(n[(p + 64) / 8 + b]);
      f.push({
        format: T,
        data: new S(x),
        channels: M,
        normalized: s[g + 3] === 1,
        scale: v,
        offset: N
      }), l.push(x);
    }
    return { header: a, bands: h, packs: f, transfer: l };
  }
  /** Read a window. Fetches whatever the decode needs first. */
  async read(e, t, { signal: s } = {}) {
    const i = this.#n.get(e);
    if (!i) throw new m(`unknown file ${e}`);
    const n = this.#e, o = n._malloc(this.#t.req), a = n._malloc(4);
    try {
      let l = 0;
      for (; ; ) {
        if (s?.aborted) throw new DOMException("aborted", "AbortError");
        this.#a(o, t), n._wt_plan_region(i.handle, o, 0), await this.#r(i.handle, i.source, s), this.#a(o, t);
        const h = n._wt_read(i.handle, o, a);
        if (h === C) break;
        if (h !== L) throw this.#o(i.handle, h);
        if (++l > O)
          throw new m("the tile did not resolve after 32 fetches");
      }
      const c = n.HEAPU32[a / 4];
      try {
        return this.#c(c);
      } finally {
        n._wt_result_free(c);
      }
    } finally {
      n._free(o), n._free(a);
    }
  }
  /** Warnings accumulated since the last drain, deduplicated by code. */
  drainWarnings() {
    const e = this.#e, t = e._malloc(4096);
    try {
      return e._wt_drain_warnings(t, 4096) > 0 ? JSON.parse(e.UTF8ToString(t)) : [];
    } finally {
      e._free(t);
    }
  }
}
const he = 1;
function fe(r) {
  const t = ((r?.imageDescription ?? "").split(`
`)[1] ?? "").toLowerCase();
  return t.includes("macro") || t.includes("label");
}
function $(r, e, t) {
  return {
    min: r / (e + t),
    max: e - t > 0 ? r / (e - t) : 1 / 0
  };
}
function ue(r, e, t, s, i = he) {
  const n = $(r, t, i), o = $(e, s, i);
  return n.min <= o.max && o.min <= n.max;
}
function D(r) {
  if (r.length < 2) return !1;
  for (let s = 1; s < r.length; s++)
    if (r[s].width >= r[s - 1].width || r[s].height >= r[s - 1].height) return !1;
  const { width: e, height: t } = r[0];
  return r.every((s, i) => i === 0 || ue(e, t, s.width, s.height));
}
function H(r) {
  const e = r.height ? r.width / r.height : 0;
  return [
    r.width,
    r.height,
    r.tileWidth ?? 0,
    r.tileHeight ?? 0,
    e.toFixed(6)
  ].join("|");
}
function de(r, e) {
  return e.width - r.width;
}
function z(r) {
  const e = /* @__PURE__ */ new Set();
  return [...r].sort(de).filter((t) => {
    const s = `${t.width}x${t.height}`;
    return e.has(s) ? !1 : (e.add(s), !0);
  });
}
function ge(r, e = {}) {
  const t = e.pyramid ?? "auto", s = e.planeIndex ?? 0, i = e.prefer ?? "pyramid", n = [];
  if (!r.length)
    return { strategy: "single", planes: [], chosenPlane: null, ifdLevels: [], warnings: n };
  const o = /* @__PURE__ */ new Map();
  for (const w of r) {
    const _ = H(w);
    o.has(_) || o.set(_, []), o.get(_).push(w);
  }
  const a = z(r), l = r.filter((w) => !fe(w)), c = z(l);
  let h = a;
  c.length !== a.length && D(c) && (h = c);
  const u = D(h), f = h[0] ?? a[0], d = o.get(H(f)) ?? [f], p = r.some((w) => (w.subIFDs?.length ?? 0) > 0);
  let g;
  t === "ifd" ? g = u ? "ifd" : "single" : t === "subifd" ? (g = p ? "subifd" : "single", p || n.push("subifd requested but the file declares none")) : g = u ? "ifd" : p ? "subifd" : "single", g === "ifd" && i === "stack" && d.length > 1 && (g = "single");
  const T = Math.min(Math.max(s, 0), d.length - 1);
  return {
    strategy: g,
    planes: d,
    chosenPlane: d[T],
    ifdLevels: h,
    warnings: n
  };
}
function pe(r, e) {
  const t = [...e.warnings];
  let s;
  if (e.strategy === "ifd")
    s = [...e.ifdLevels], e.planes.length > 1 && t.push(
      `the file has ${e.planes.length} directories of the largest size; showing the first. Set layout.prefer = 'stack' to treat them as planes.`
    );
  else if (e.strategy === "subifd") {
    const o = e.chosenPlane, a = (o.subIFDLevels ?? []).map((l) => ({
      ...l,
      index: o.index,
      subifdIndex: l.subifdIndex,
      imageDescription: o.imageDescription,
      subIFDs: []
    }));
    s = [o, ...a], a.length || t.push(
      "the file declares SubIFDs but none could be read; using the full-size directory only"
    );
  } else
    s = [e.chosenPlane], e.planes.length > 1 && t.push(
      `${e.planes.length} same-size directories; showing plane ${e.planes.indexOf(e.chosenPlane)}`
    );
  const i = s.reduce((o, a) => o.width >= a.width ? o : a);
  return { levels: s.map((o) => ({
    width: o.width,
    height: o.height,
    tileWidth: o.tileWidth || 256,
    tileHeight: o.tileHeight || 256,
    dir: o.index,
    // -1 means the directory itself; anything else indexes into its SubIFDs.
    subifd: o.subifdIndex ?? -1,
    // Every level here has its own directory at its own size, so a tile read
    // maps 1:1. A synthetic pyramid built over a file without levels would set
    // this to the ratio it has to scale by.
    scaleFactor: 1,
    directory: o
  })).sort((o, a) => o.width - a.width), full: i, warnings: t };
}
const j = {
  gpuTextureSet: q,
  tiffRaster: ee,
  rgba8: B,
  imageBitmap: B
}, G = { auto: 0, image: 1, data: 2 }, V = { auto: 0, nearest: 1, bilinear: 2, box: 3 }, we = 1, me = 2, ye = 4;
function K(r = {}) {
  const e = r.gpu ?? {};
  let t = 0;
  return e.preferRGBA8 !== !1 && (t |= we), e.forceRGBA16F && (t |= me), r.image?.strictGray && (t |= ye), t;
}
class be {
  #e;
  #t;
  #n;
  #s;
  #i;
  #r;
  constructor({ decoder: e, id: t, meta: s, options: i }) {
    this.#e = e, this.#t = t, this.#n = s, this.#r = i;
    const n = ge(s.directories, i.layout), o = pe(s.directories, n);
    this.#s = o.levels, this.#i = o.warnings, this.layout = n.strategy;
  }
  get meta() {
    return this.#n;
  }
  get directories() {
    return this.#n.directories;
  }
  /** Ascending: index 0 is the smallest. This is the order viewers index by. */
  get levels() {
    return this.#s;
  }
  get warnings() {
    return this.#i;
  }
  /** Full-resolution geometry and the encoding the samples carry. */
  get descriptor() {
    const t = this.#s[this.#s.length - 1].directory;
    return {
      width: t.width,
      height: t.height,
      samplesPerPixel: t.samplesPerPixel,
      bitsPerSample: t.bitsPerSample,
      sampleFormat: t.sampleFormat,
      photometricInterpretation: t.photometricInterpretation,
      hasColorMap: t.hasColorMap,
      channels: Array.from({ length: t.samplesPerPixel }, (s, i) => i),
      interpretationResolved: t.interpretationAuto,
      encoding: t.encoding
    };
  }
  /**
   * Whether tiles can be carried in 8 bits without losing anything.
   *
   * A renderer asks this before choosing a texture format. It mirrors what the
   * decoder decides per tile; guessing wrong only costs a format change, never
   * correctness, because the tile itself declares what it is.
   */
  precision() {
    const e = this.descriptor;
    return e.interpretationResolved === "image" || e.encoding.channels.every(
      (s) => s.bits === 8 && s.sampleFormat === 1 && s.scale === 255 && s.offset === 0
    ) ? "unorm8" : "float16";
  }
  /**
   * Read one tile of a level.
   *
   * The window is computed in the level's own pixel space and then scaled into the
   * source directory's, which is what lets a synthetic pyramid level read from a
   * directory that is not its own size. Edge tiles deliberately ask for a window
   * past the image; the decoder zero-fills the overhang.
   */
  async readTile(e, t, s, i = {}) {
    const n = this.#s[e];
    if (!n) throw new RangeError(`no level ${e} (have ${this.#s.length})`);
    const o = n.scaleFactor, a = {
      dir: n.dir,
      subifd: n.subifd,
      sx0: Math.round(t * n.tileWidth * o),
      sy0: Math.round(s * n.tileHeight * o),
      sx1: Math.round((t + 1) * n.tileWidth * o),
      sy1: Math.round((s + 1) * n.tileHeight * o),
      outWidth: n.tileWidth,
      outHeight: n.tileHeight,
      resample: V[i.resample ?? this.#r.resample ?? "auto"] ?? 0,
      output: j[i.output ?? "rgba8"] ?? B,
      channels: i.channels ?? this.#r.format?.channels ?? void 0,
      interpretation: G[i.interpretation ?? this.#r.format?.interpretation ?? "auto"] ?? 0,
      packFlags: K(this.#r.format),
      padAlpha: this.#r.format?.gpu?.padAlpha ?? 1
    };
    return this.#e.read(this.#t, a, { signal: i.signal });
  }
  /** Read an arbitrary window of a directory, in that directory's pixel space. */
  async readRegion({
    dir: e = 0,
    subifd: t = -1,
    x0: s,
    y0: i,
    x1: n,
    y1: o,
    outWidth: a,
    outHeight: l,
    output: c = "tiffRaster",
    signal: h,
    channels: u,
    resample: f,
    interpretation: d
  }) {
    return this.#e.read(
      this.#t,
      {
        dir: e,
        subifd: t,
        sx0: s,
        sy0: i,
        sx1: n,
        sy1: o,
        outWidth: a ?? n - s,
        outHeight: l ?? o - i,
        output: j[c] ?? ee,
        channels: u,
        resample: f ?? V[this.#r.resample ?? "auto"] ?? 0,
        interpretation: G[d ?? "auto"] ?? 0,
        packFlags: K(this.#r.format),
        padAlpha: this.#r.format?.gpu?.padAlpha ?? 1
      },
      { signal: h }
    );
  }
  close() {
    this.#e.close(this.#t);
  }
}
class _e {
  #e;
  constructor(e) {
    this.#e = e instanceof Uint8Array ? e : new Uint8Array(e);
  }
  async getSize() {
    return this.#e.length;
  }
  async read(e, t) {
    const s = Math.min(e, this.#e.length), i = Math.min(e + t, this.#e.length);
    return this.#e.subarray(s, i);
  }
}
class Ae {
  #e;
  constructor(e) {
    this.#e = e;
  }
  async getSize() {
    return this.#e.size;
  }
  async read(e, t, s) {
    if (s?.aborted) throw new DOMException("aborted", "AbortError");
    const i = Math.min(e + t, this.#e.size);
    if (i <= e) return new Uint8Array(0);
    const n = await this.#e.slice(e, i).arrayBuffer();
    return new Uint8Array(n);
  }
}
async function Te(r, e = {}) {
  if (r == null) throw new TypeError("openTiff needs a source");
  if (typeof r == "string" || r instanceof URL) {
    const { HttpSource: t } = await Promise.resolve().then(() => Oe);
    return new t(r, e);
  }
  if (typeof Blob < "u" && r instanceof Blob) return new Ae(r);
  if (r instanceof Uint8Array || r instanceof ArrayBuffer)
    return new _e(r);
  if (typeof r.getSize == "function" && typeof r.read == "function")
    return r;
  throw new TypeError(
    "openTiff needs a url, a Blob, a File, bytes, or an object with getSize() and read()"
  );
}
const P = {
  interpretation: "auto",
  channels: null,
  gpu: {
    preferRGBA8: !0,
    forceRGBA16F: !1,
    packMode: "packsOf4",
    padAlpha: 1
  },
  image: {
    rgbaChannels: null
  },
  hints: {
    layout: {
      pyramid: "auto",
      planeIndex: 0,
      prefer: "pyramid"
    }
  }
}, Ee = te(
  new URL(
    "./",
    import.meta.url
  ).href
);
function te(r) {
  return r.endsWith("/") ? r : `${r}/`;
}
function re(r, e) {
  const t = e ? te(String(e)) : Ee;
  return new URL(`webtiff-${r}.mjs`, t).href;
}
function Se() {
  return typeof SharedArrayBuffer == "function" && globalThis.crossOriginIsolated === !0 && typeof Atomics?.waitAsync == "function";
}
function ne(r = {}) {
  return r.threads === !0 && Se() ? "mt" : "st";
}
let F = null, k = null;
async function Pe(r) {
  if (F && !r.wasmBaseUrl) return F;
  const e = ne(r), t = re(e, r.wasmBaseUrl), { default: s } = await import(
    /* @vite-ignore */
    t
  ), i = await s(), n = new ce(i);
  return r.wasmBaseUrl || (F = n), n;
}
function ke(r, e) {
  return e.fetch ? !1 : typeof r == "string" || r instanceof URL || typeof Blob < "u" && r instanceof Blob || r instanceof Uint8Array || r instanceof ArrayBuffer;
}
async function Ie(r, e) {
  if (e.decoder) return { decoder: e.decoder, viaWorker: !1 };
  if (e.pool) return { decoder: e.pool, viaWorker: !0 };
  if (e.workers !== !1 && ke(r, e) && typeof Worker < "u") {
    if (!k) {
      const { createDecoderPool: t } = await Promise.resolve().then(() => Ke);
      k = await t(e);
    }
    if (k) return { decoder: k, viaWorker: !0 };
  }
  return { decoder: await Pe(e), viaWorker: !1 };
}
function Ue(r) {
  return r ? {
    ...P,
    ...r,
    gpu: { ...P.gpu, ...r.gpu },
    image: { ...P.image, ...r.image }
  } : P;
}
async function Re(r, e = {}) {
  const { decoder: t, viaWorker: s } = await Ie(r, e), i = s ? r : await Te(r, e), { id: n, meta: o } = await t.open(i, {
    blockSize: e.blockSize,
    cacheBytes: e.cacheBytes,
    signal: e.signal
  });
  return new be({
    decoder: t,
    id: n,
    meta: o,
    options: { ...e, format: Ue(e.format) }
  });
}
const Y = {};
function Fe(r, e, t = "warn") {
  Y[r] || (Y[r] = !0, console[t](e));
}
const We = 1, A = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, y = {
  UINT: 1,
  INT: 2,
  FLOAT: 3,
  UNDEFINED: 4,
  COMPLEX_INT: 5,
  COMPLEX_FLOAT: 6
};
function U(r, e, t) {
  if (r == null) return t;
  if (Array.isArray(r) || ArrayBuffer.isView(r)) {
    if (r.length === 0) return t;
    const s = e < r.length ? r[e] : r[0];
    return s ?? t;
  }
  return r;
}
function Ye(r) {
  const e = r || {}, t = (s) => s == null ? null : Array.isArray(s) ? s.length ? s : null : ArrayBuffer.isView(s) ? s.length ? Array.from(s) : null : [s];
  return {
    sMinSampleValue: t(e.SMinSampleValue),
    sMaxSampleValue: t(e.SMaxSampleValue)
  };
}
function W(r, e, t, s) {
  const i = U(r.sMinSampleValue, e, null), n = U(r.sMaxSampleValue, e, null);
  if (i === null || n === null) return null;
  const o = Number(i), a = Number(n);
  return !Number.isFinite(o) || !Number.isFinite(a) || a <= o || t !== null && (o < t || a > s) ? null : { min: o, max: a };
}
function X(r, e) {
  return e ? [-Math.pow(2, r - 1), Math.pow(2, r - 1) - 1] : [0, Math.pow(2, r) - 1];
}
function Xe(r) {
  const e = r || {}, t = e.bitsPerSample, s = e.sampleFormat;
  let i = e.samplesPerPixel;
  i > 0 || (i = Array.isArray(t) || ArrayBuffer.isView(t) ? t.length : 1), i = Math.max(1, i | 0);
  const n = [];
  for (let o = 0; o < i; o++) {
    const a = U(t, o, 8) || 8, l = U(s, o, y.UINT) || y.UINT;
    let c, h = 0, u = !1;
    switch (l) {
      case y.UINT: {
        const f = W(e, o, ...X(a, !1));
        f ? (c = f.max - f.min, h = f.min) : c = Math.pow(2, a) - 1;
        break;
      }
      case y.INT: {
        const f = W(e, o, ...X(a, !0));
        f ? (c = f.max - f.min, h = f.min) : (c = Math.pow(2, a - 1) - 1, u = !0);
        break;
      }
      case y.FLOAT: {
        const f = W(e, o, null, null);
        f ? (c = f.max - f.min, h = f.min) : (c = 1, u = !0);
        break;
      }
      default:
        throw new Error(
          `[web-tiff] Unsupported SampleFormat ${l} on channel ${o}; only 1 (unsigned int), 2 (signed int) and 3 (float) are supported.`
        );
    }
    c > 0 || (c = 1), n.push({ scale: c, offset: h, signed: u, bits: a, sampleFormat: l });
  }
  return { version: We, channels: n };
}
const Be = Object.freeze({
  scale: 1,
  offset: 0,
  signed: !1,
  bits: 8,
  sampleFormat: y.UINT
});
function xe(r, e) {
  const t = r && r.channels || [], s = t[e];
  return s ?? (Fe(
    `tiffEncoding_channel_${e}_of_${t.length}`,
    `[web-tiff] No sample encoding for channel ${e} (file declares ${t.length}); using an identity transform. Check format.channels against the file's SamplesPerPixel.`
  ), Be);
}
function Me(r, e) {
  if (r == null) return 0;
  const t = Number(r);
  return Number.isNaN(t) ? 0 : (t - e.offset) / e.scale;
}
function Ze(r, e) {
  const t = Me(r, e);
  return t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
}
function ve(r) {
  return r.bits === 8 && (r.sampleFormat === y.UINT || r.sampleFormat === y.INT);
}
function Je(r) {
  return r.bits === 8 && r.sampleFormat === y.UINT && r.scale === 255 && r.offset === 0;
}
function Qe(r, e) {
  const t = r || {}, s = t.photometricInterpretation, i = t.encoding;
  if (s === A.Palette && t.hasColorMap) return "image";
  const n = t.samplesPerPixel || i && i.channels.length || 1;
  return (s === A.RGB || s === A.YCbCr || s === A.CMYK || s === A.CIELab || (s === A.BlackIsZero || s === A.WhiteIsZero) && n === 1) && (Array.isArray(e) && e.length ? e.filter((c) => c != null && c >= 0) : i.channels.map((c, h) => h)).every((c) => ve(xe(i, c))) ? "image" : "data";
}
const Z = /\.(tiff?|qptiff|btf|svs|ndpi|scn)(\?|#|$)/i;
function Ne(r, e = {}) {
  let t = 0;
  class s extends r.TileSource {
    constructor(n, o = {}) {
      const a = typeof n == "object" && n !== null ? { ...n } : {}, l = typeof n == "string" ? n : a.url ?? n;
      super(typeof l == "string" ? l : `webtiff://${t}`), this._instance = t++, this._options = { ...e, ...a, ...o }, this._file = null, this.ready = !1;
      let c, h;
      this.promises = {
        ready: {
          promise: new Promise((u, f) => {
            c = u, h = f;
          })
        }
      }, this.promises.ready.resolve = c, this.promises.ready.reject = h, this.promises.ready.promise.catch(() => {
      }), this.#e(l);
    }
    async #e(n) {
      try {
        const o = await Re(n, this._options);
        this._file = o;
        const a = o.levels, l = a[a.length - 1];
        this.width = l.width, this.height = l.height, this.aspectRatio = this.width / this.height, this.dimensions = new r.Point(this.width, this.height), this.tileOverlap = 0, this.minLevel = 0, this.maxLevel = a.length - 1, this.levels = a, this.tileWidth = a[0].tileWidth, this.tileHeight = a[0].tileHeight, this.ready = !0, this._ready = !0, this.promises.ready.resolve(this), this.raiseEvent("ready", { tileSource: this });
      } catch (o) {
        this.promises.ready.reject(o), this.raiseEvent("open-failed", { message: o.message, source: n });
      }
    }
    /**
     * No-op by design.
     *
     * The base class would otherwise GET the image url expecting an info document
     * and download the whole slide to parse it as JSON.
     */
    getImageInfo() {
    }
    supports(n, o) {
      if (n?.type && /^(web|geo)?tiff$/i.test(n.type) || typeof n == "string" && Z.test(n) || typeof o == "string" && Z.test(o)) return !0;
      const a = n instanceof ArrayBuffer ? new Uint8Array(n) : ArrayBuffer.isView(n) ? new Uint8Array(n.buffer, n.byteOffset, n.byteLength) : null;
      if (a && a.length >= 4) {
        const l = a[0] === 73 && a[1] === 73, c = a[0] === 77 && a[1] === 77;
        if (l || c) {
          const h = l ? a[2] | a[3] << 8 : a[2] << 8 | a[3];
          return h === 42 || h === 43;
        }
      }
      return !1;
    }
    configure(n, o) {
      return typeof n == "string" ? { url: n } : { ...n, url: n.url ?? o };
    }
    getTileWidth(n) {
      return this.levels?.[n]?.tileWidth;
    }
    getTileHeight(n) {
      return this.levels?.[n]?.tileHeight;
    }
    getLevelScale(n) {
      const o = this.levels;
      return o?.[n] ? o[n].width / o[this.maxLevel].width : NaN;
    }
    /** Per-instance so two sources over one file keep separate cache entries. */
    getTileHashKey(n, o, a) {
      return `webtiff${this._instance}_${n}_${o}_${a}`;
    }
    /** Never fetched; it is only the identity string for the download request. */
    getTileUrl(n, o, a) {
      return `${n}/${o}_${a}`;
    }
    downloadTileStart(n) {
      const o = new AbortController();
      n.userData.abortController = o;
      const a = n.tile;
      this._file.readTile(a.level, a.x, a.y, {
        output: "rgba8",
        signal: o.signal
      }).then(async ({ header: l, packs: c }) => {
        const h = new ImageData(
          new Uint8ClampedArray(c[0].data.buffer),
          l.width,
          l.height
        ), u = await createImageBitmap(h);
        n.finish(u, `${n.src}`, "imageBitmap");
      }).catch((l) => {
        l?.name !== "AbortError" && n.fail(l.message, l);
      });
    }
    downloadTileAbort(n) {
      n.userData.abortController?.abort();
    }
    destroy() {
      this._file?.close(), this._file = null;
    }
  }
  return s;
}
function qe(r, e = {}) {
  if (!r?.TileSource)
    throw new TypeError("enableWebTiff needs the OpenSeadragon namespace");
  const t = r.version?.major ?? 0;
  if (t && t < 6)
    throw new Error(
      `web-tiff needs OpenSeadragon 6 or newer (found ${r.version.versionStr}). Use the geotiff-tilesource package for OpenSeadragon 4 and 5.`
    );
  if (r.WebTiffTileSource) return r.WebTiffTileSource;
  const s = Ne(r, e);
  return r.WebTiffTileSource = s, s;
}
const Ce = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
class Le {
  #e;
  #t;
  #n;
  #s;
  #i;
  #r = null;
  #o = null;
  // set when the server ignored Range and sent everything
  #a = /* @__PURE__ */ new Map();
  constructor(e, {
    fetch: t,
    headers: s = {},
    credentials: i,
    captureErrorBody: n = !1
  } = {}) {
    this.#e = String(e), this.#t = t ?? globalThis.fetch.bind(globalThis), this.#n = s, this.#s = i, this.#i = n;
  }
  get url() {
    return this.#e;
  }
  async #l(e, t) {
    const s = { ...this.#n };
    e && (s.Range = `bytes=${e.start}-${e.end - 1}`);
    let i;
    try {
      i = await this.#t(this.#e, {
        headers: s,
        signal: t,
        credentials: this.#s
      });
    } catch (n) {
      throw n?.name === "AbortError" ? n : new I(`[web-tiff] cannot reach ${this.#e}: ${n.message}`, {
        url: this.#e,
        range: e,
        cause: n
      });
    }
    if (!i.ok) {
      let n = null;
      if (this.#i)
        try {
          const o = await i.clone().text();
          n = o.replace(/\s+/g, " ").slice(0, 200), o.length > 200 && (n += "...");
        } catch {
        }
      throw new I(
        `[web-tiff] HTTP ${i.status} for ${this.#e}${n ? `: ${n}` : ""}`,
        {
          status: i.status,
          statusText: i.statusText,
          url: this.#e,
          range: e,
          body: n
        }
      );
    }
    return i;
  }
  async #c(e, t) {
    try {
      return await this.#l(e, t);
    } catch (s) {
      if (s?.name === "AbortError" || !(s.status == null || Ce.has(s.status))) throw s;
      return await new Promise((n) => setTimeout(n, 250)), this.#l(e, t);
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
    if (this.#r != null) return this.#r;
    const t = await this.#c({ start: 0, end: 65536 }, e);
    if (t.status === 200) {
      const n = new Uint8Array(await t.arrayBuffer());
      return this.#o = n, this.#r = n.length, this.#r;
    }
    const s = t.headers.get("Content-Range"), i = s ? Number(s.split("/")[1]) : NaN;
    if (!Number.isFinite(i))
      throw new I(
        `[web-tiff] ${this.#e} answered a range request without a usable Content-Range; the server must support byte ranges`,
        { status: t.status, url: this.#e }
      );
    return this.#r = i, this.#h = new Uint8Array(await t.arrayBuffer()), i;
  }
  #h = null;
  async read(e, t, s) {
    this.#r == null && await this.getSize(s);
    const i = Math.min(e, this.#r), n = Math.min(e + t, this.#r);
    if (n <= i) return new Uint8Array(0);
    if (this.#o) return this.#o.subarray(i, n);
    if (this.#h && n <= this.#h.length)
      return this.#h.subarray(i, n);
    const o = `${i}-${n}`, a = this.#a.get(o);
    if (a) return a;
    const l = this.#c({ start: i, end: n }, s).then(async (c) => new Uint8Array(await c.arrayBuffer())).finally(() => this.#a.delete(o));
    return this.#a.set(o, l), l;
  }
}
const Oe = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HttpSource: Le
}, Symbol.toStringTag, { value: "Module" })), E = {
  INIT: "init",
  OPEN: "open",
  READ: "read",
  CLOSE: "close",
  ABORT: "abort"
}, J = {
  READY: "ready",
  WARN: "warn"
};
function $e(r, e = {}) {
  if (typeof r == "string" || r instanceof URL)
    return {
      descriptor: {
        kind: "url",
        url: String(r),
        headers: e.headers,
        credentials: e.credentials,
        captureErrorBody: e.captureErrorBody
      },
      transfer: []
    };
  if (typeof Blob < "u" && r instanceof Blob)
    return { descriptor: { kind: "blob", blob: r }, transfer: [] };
  if (r instanceof Uint8Array)
    return {
      descriptor: { kind: "bytes", bytes: r },
      transfer: [r.buffer]
    };
  if (r instanceof ArrayBuffer)
    return {
      descriptor: { kind: "bytes", bytes: new Uint8Array(r) },
      transfer: [r]
    };
  throw new TypeError(
    "a worker source must be a Blob, a File, or bytes; custom sources only work with an in-process decoder"
  );
}
const De = "./decode.worker.mjs";
function He() {
  const r = new URL(De, import.meta.url);
  return new Worker(r, { type: "module" });
}
function ze() {
  const r = globalThis.navigator?.hardwareConcurrency ?? 4;
  return Math.min(4, Math.max(1, Math.ceil(r / 2)));
}
function je({ name: r, message: e, status: t, url: s, code: i }) {
  return r === "WebTiffHttpError" ? new I(e, { status: t, url: s }) : r === "WebTiffUnsupportedError" ? new Q(e, { code: i }) : r === "AbortError" ? new DOMException(e, "AbortError") : new m(e, { code: i });
}
class Ge {
  #e;
  #t = /* @__PURE__ */ new Map();
  #n = 1;
  ready;
  inFlight = 0;
  constructor(e, t) {
    this.#e = e, this.ready = new Promise((s) => {
      const i = (n) => {
        n.data?.kind === J.READY && (e.removeEventListener("message", i), s());
      };
      e.addEventListener("message", i);
    }), e.addEventListener("message", (s) => {
      const i = s.data;
      if (i?.kind === J.WARN) {
        t?.(i);
        return;
      }
      if (i?.kind) return;
      const n = this.#t.get(i.id);
      n && (this.#t.delete(i.id), this.inFlight--, i.ok ? n.resolve(i.result) : n.reject(je(i.error)));
    }), e.addEventListener("error", (s) => {
      const i = new m(s.message ?? "decode worker failed");
      for (const [, n] of this.#t) n.reject(i);
      this.#t.clear(), this.inFlight = 0;
    });
  }
  send(e, t = []) {
    const s = this.#n++;
    return this.inFlight++, new Promise((i, n) => {
      this.#t.set(s, { resolve: i, reject: n }), this.#e.postMessage({ ...e, id: s }, t);
    });
  }
  terminate() {
    this.#e.terminate();
  }
}
class se {
  #e = [];
  #t = /* @__PURE__ */ new Map();
  #n = 1;
  #s;
  constructor(e, t) {
    this.#e = e, this.#s = t;
  }
  /** The least busy worker; ties go to the earliest, which keeps warm caches warm. */
  #i() {
    let e = this.#e[0];
    for (const t of this.#e) t.inFlight < e.inFlight && (e = t);
    return e;
  }
  async open(e, t = {}) {
    const { descriptor: s, transfer: i } = $e(e, t), n = this.#i(), { id: o, meta: a } = await n.send(
      { op: E.OPEN, src: s, options: t },
      i
    ), l = this.#n++;
    return this.#t.set(l, { worker: n, remoteId: o }), { id: l, meta: a };
  }
  async read(e, t, { signal: s } = {}) {
    const i = this.#t.get(e);
    if (!i) throw new m(`unknown file ${e}`);
    const n = i.worker.send({ op: E.READ, file: i.remoteId, req: t });
    return s && s.addEventListener(
      "abort",
      () => i.worker.send({ op: E.ABORT, target: e }),
      { once: !0 }
    ), n;
  }
  close(e) {
    const t = this.#t.get(e);
    t && (t.worker.send({ op: E.CLOSE, file: t.remoteId }), this.#t.delete(e));
  }
  terminate() {
    for (const e of this.#e) e.terminate();
    this.#e = [], this.#t.clear();
  }
}
async function Ve(r = {}) {
  if (typeof Worker > "u") return null;
  const e = ne(r), t = re(e, r.wasmBaseUrl), s = r.size ?? ze(), i = r.createWorker ?? (r.workerUrl ? () => new Worker(r.workerUrl, { type: "module" }) : He), n = [];
  for (let o = 0; o < s; o++)
    n.push(new Ge(i(), r.onWarning));
  return await Promise.all(n.map((o) => o.ready)), await Promise.all(n.map((o) => o.send({ op: E.INIT, wasmUrl: t }))), new se(n, r.onWarning);
}
const Ke = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecoderPool: se,
  createDecoderPool: Ve
}, Symbol.toStringTag, { value: "Module" }));
export {
  Ae as BlobSource,
  _e as BytesSource,
  ce as Decoder,
  A as PHOTOMETRIC,
  We as SAMPLE_ENCODING_VERSION,
  y as SAMPLE_FORMAT,
  be as TiffFile,
  ie as WebTiffAbortError,
  m as WebTiffDecodeError,
  R as WebTiffError,
  I as WebTiffHttpError,
  Q as WebTiffUnsupportedError,
  pe as buildLevels,
  xe as channelEncodingAt,
  P as defaultFormat,
  qe as enableWebTiff,
  Qe as inferInterpretation,
  fe as isCompanionPage,
  ve as isDisplayReadyChannel,
  Je as isIdentityChannel,
  D as looksLikeIFDPyramid,
  Ne as makeTileSource,
  Re as openTiff,
  H as planeKey,
  Ye as readSampleRangeTags,
  ge as resolveLayout,
  Xe as resolveSampleEncoding,
  Ze as sampleToByte,
  Me as sampleToUnit,
  ne as selectBuild,
  Te as toSource
};
