class x extends Error {
  constructor(e, t) {
    super(e, t), this.name = "WebTiffError";
  }
}
class R extends x {
  constructor(e, { status: t = null, statusText: s = "", url: i = null, range: r = null, body: a = null, cause: o } = {}) {
    super(e, o ? { cause: o } : void 0), this.name = "WebTiffHttpError", this.status = t, this.statusText = s, this.url = i, this.range = r, this.body = a;
  }
}
class w extends x {
  constructor(e, { code: t = null, cause: s } = {}) {
    super(e, s ? { cause: s } : void 0), this.name = "WebTiffDecodeError", this.code = t;
  }
}
class re extends x {
  constructor(e, { code: t = null } = {}) {
    super(e), this.name = "WebTiffUnsupportedError", this.code = t;
  }
}
class fe extends x {
  constructor(e = "aborted") {
    super(e), this.name = "AbortError";
  }
}
function de(n, e) {
  const t = e || `web-tiff status ${n}`;
  switch (n) {
    case -4:
      return new re(t, { code: n });
    case -7:
      return new fe(t);
    default:
      return new w(t, { code: n });
  }
}
const D = 0, H = 1, se = 0, ie = 1, C = 2, pe = {
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
}, me = 4294967295, M = 32, z = 32, j = 2, V = 32;
class ge {
  #e;
  #t;
  #r = /* @__PURE__ */ new Map();
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
    const t = this.#e, s = t._wt_wants_count(e), i = t._wt_wants_ptr(e), r = [];
    for (let a = 0; a < s; a++) {
      const o = i + a * this.#t.range;
      r.push({
        offset: t.HEAPF64[o / 8],
        length: t.HEAPU32[(o + 8) / 4]
      });
    }
    return r;
  }
  async #n(e, t, s) {
    const i = this.#e;
    for (const { offset: r, length: a } of this.#i(e)) {
      const o = await t.read(r, a, s);
      if (!o.length) continue;
      const l = i._wt_cache_reserve(e, r, o.length);
      if (l === 0) throw new w("out of memory reserving a block");
      i.HEAPU8.set(o, l), i._wt_cache_commit(e, r, o.length);
    }
  }
  #o(e, t) {
    const s = this.#e.UTF8ToString(this.#e._wt_last_error(e));
    return de(t, s);
  }
  /**
   * Open a file and parse every directory.
   *
   * @param {{getSize(): Promise<number>, read(offset, length, signal): Promise<Uint8Array>}} source
   */
  async open(e, { blockSize: t = 65536, cacheBytes: s = 32 * 1024 * 1024, signal: i } = {}) {
    const r = this.#e, a = await e.getSize(), o = r._wt_file_create(a, t, s);
    if (o <= 0) throw new w(`cannot open: status ${o}`);
    let l = r._wt_open(o), c = 0;
    for (; l === H; ) {
      if (await this.#n(o, e, i), ++c > V)
        throw r._wt_file_close(o), new w("the header did not resolve after 32 fetches");
      l = r._wt_open(o);
    }
    if (l !== D) {
      const u = this.#o(o, l);
      throw r._wt_file_close(o), u;
    }
    const h = JSON.parse(r.UTF8ToString(r._wt_meta_json(o)));
    if (h.abi !== j)
      throw r._wt_file_close(o), new w(
        `[web-tiff] this build speaks ABI ${j} but the WebAssembly module speaks ${h.abi}. The .mjs and the .wasm are versioned together; re-copy the whole folder rather than one file of it.`
      );
    const f = this.#s++;
    return this.#r.set(f, { handle: o, source: e }), { id: f, meta: h };
  }
  close(e) {
    const t = this.#r.get(e);
    t && (this.#e._wt_file_close(t.handle), this.#r.delete(e));
  }
  #a(e, t) {
    const s = this.#e, i = s.HEAPU32, r = s.HEAP32, a = s.HEAPF32, o = e / 4;
    s.HEAPU8.fill(0, e, e + this.#t.req), i[o + 0] = t.dir ?? 0, r[o + 1] = t.subifd ?? -1, i[o + 2] = t.sx0, i[o + 3] = t.sy0, i[o + 4] = t.sx1, i[o + 5] = t.sy1, i[o + 6] = t.outWidth ?? t.sx1 - t.sx0, i[o + 7] = t.outHeight ?? t.sy1 - t.sy0, i[o + 8] = t.resample ?? 0, i[o + 9] = t.interpretation ?? 0, i[o + 10] = t.packFlags ?? 0, i[o + 11] = t.output ?? se, a[o + 12] = t.padAlpha ?? 1;
    const l = t.channels ?? [];
    i[o + 13] = Math.min(l.length, M);
    for (let d = 0; d < M; d++) r[o + 14 + d] = l[d] ?? -1;
    const c = o + 14 + M;
    for (let d = 0; d < 4; d++)
      i[c + d] = t.rgbaChannels?.[d] ?? me;
    const h = t.planes ?? [], f = Math.min(h.length, z), u = c + 4, p = u + 1, m = p + z;
    i[u] = f;
    for (let d = 0; d < f; d++)
      i[p + d] = h[d].dir ?? 0, r[m + d] = h[d].subifd ?? -1;
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
    const t = this.#e, s = t.HEAPU32, i = t.HEAP32, r = t.HEAPF64, a = t._wt_result_header_ptr(e) / 4, o = {
      width: s[a + 0],
      height: s[a + 1],
      mode: s[a + 2] === 0 ? "image" : "data",
      channelCount: s[a + 3],
      encodingVersion: s[a + 4],
      output: s[a + 5],
      packCount: s[a + 6],
      bandCount: s[a + 7],
      flags: s[a + 8]
    }, l = [], c = t._wt_result_bands_ptr(e), h = [];
    for (let p = 0; p < o.bandCount; p++) {
      const m = (c + p * this.#t.band) / 4, d = s[m + 0], y = s[m + 1], g = s[m + 2], A = pe[g] ?? Uint8Array, P = this.#l(d, y);
      h.push({
        data: new A(P),
        sampleType: g,
        flags: s[m + 3],
        channel: i[m + 4]
      }), l.push(P);
    }
    const f = t._wt_result_packs_ptr(e), u = [];
    for (let p = 0; p < o.packCount; p++) {
      const m = f + p * this.#t.pack, d = m / 4, y = s[d + 0] === 0 ? "RGBA8" : "RGBA16F", g = s[d + 1], A = s[d + 2], P = y === "RGBA8" ? Uint8Array : Uint16Array, W = this.#l(g, A), L = [];
      for (let _ = 0; _ < 4; _++) L.push(i[d + 4 + _]);
      const $ = [], O = [];
      for (let _ = 0; _ < 4; _++)
        $.push(r[(m + 32) / 8 + _]), O.push(r[(m + 64) / 8 + _]);
      u.push({
        format: y,
        data: new P(W),
        channels: L,
        normalized: s[d + 3] === 1,
        scale: $,
        offset: O
      }), l.push(W);
    }
    return { header: o, bands: h, packs: u, transfer: l };
  }
  /** Read a window. Fetches whatever the decode needs first. */
  async read(e, t, { signal: s } = {}) {
    const i = this.#r.get(e);
    if (!i) throw new w(`unknown file ${e}`);
    const r = this.#e, a = r._malloc(this.#t.req), o = r._malloc(4);
    try {
      let l = 0;
      for (; ; ) {
        if (s?.aborted) throw new DOMException("aborted", "AbortError");
        this.#a(a, t), r._wt_plan_region(i.handle, a, 0), await this.#n(i.handle, i.source, s), this.#a(a, t);
        const h = r._wt_read(i.handle, a, o);
        if (h === D) break;
        if (h !== H) throw this.#o(i.handle, h);
        if (++l > V)
          throw new w("the tile did not resolve after 32 fetches");
      }
      const c = r.HEAPU32[o / 4];
      try {
        return this.#c(c);
      } finally {
        r._wt_result_free(c);
      }
    } finally {
      r._free(a), r._free(o);
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
function oe(n, e) {
  const t = new RegExp(`<(?:\\w+:)?${e}\\b([^>]*)>`, "g"), s = [];
  for (const i of n.matchAll(t)) s.push(i[1]);
  return s;
}
function S(n, e) {
  const t = new RegExp(`\\b${e}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(n);
  return t ? t[2] !== void 0 ? t[2] : t[3] : null;
}
function we(n) {
  if (n == null || n === "") return null;
  const e = Number(n);
  return Number.isFinite(e) ? `#${(e >>> 0 >>> 8 & 16777215).toString(16).padStart(6, "0")}` : null;
}
function ye(n) {
  const e = oe(n, "TiffData"), t = /* @__PURE__ */ new Map();
  for (const s of e) {
    const i = S(s, "IFD"), r = S(s, "FirstC");
    i === null || r === null || t.set(Number(i), Number(r));
  }
  return t.size ? t : null;
}
function ae(n) {
  if (typeof n != "string" || !/<(?:\w+:)?OME\b/.test(n)) return null;
  const e = /<(?:\w+:)?Image\b[\s\S]*?(?=<(?:\w+:)?Image\b|$)/.exec(
    n
  ), t = e ? e[0] : n, s = oe(t, "Channel").map((i) => ({
    name: S(i, "Name"),
    color: we(S(i, "Color")),
    samplesPerPixel: Number(S(i, "SamplesPerPixel") ?? 1) || 1
  }));
  return s.length ? { scope: t, channels: s } : null;
}
function st(n) {
  return ae(n)?.channels ?? null;
}
function be(n, e) {
  const t = ae(n);
  if (!t) return null;
  const s = t.channels, i = ye(t.scope), r = [];
  return e.forEach((a, o) => {
    const l = i?.get(a.index) ?? o, c = s[l] ?? null, h = a.samplesPerPixel || 1;
    for (let f = 0; f < h; f++)
      r.push(c ? { name: c.name, color: c.color } : null);
  }), r;
}
const _e = 1;
function Ae(n) {
  const t = ((n?.imageDescription ?? "").split(`
`)[1] ?? "").toLowerCase();
  return t.includes("macro") || t.includes("label");
}
function G(n, e, t) {
  return {
    min: n / (e + t),
    max: e - t > 0 ? n / (e - t) : 1 / 0
  };
}
function Te(n, e, t, s, i = _e) {
  const r = G(n, t, i), a = G(e, s, i);
  return r.min <= a.max && a.min <= r.max;
}
function K(n) {
  if (n.length < 2) return !1;
  for (let s = 1; s < n.length; s++)
    if (n[s].width >= n[s - 1].width || n[s].height >= n[s - 1].height) return !1;
  const { width: e, height: t } = n[0];
  return n.every((s, i) => i === 0 || Te(e, t, s.width, s.height));
}
function U(n) {
  const e = n.height ? n.width / n.height : 0;
  return [
    n.width,
    n.height,
    n.tileWidth ?? 0,
    n.tileHeight ?? 0,
    e.toFixed(6),
    n.samplesPerPixel ?? 0,
    n.bitsPerSample ?? 0,
    n.sampleFormat ?? 0
  ].join("|");
}
function Ee(n, e) {
  return e.width - n.width;
}
function Y(n) {
  const e = /* @__PURE__ */ new Set();
  return [...n].sort(Ee).filter((t) => {
    const s = `${t.width}x${t.height}`;
    return e.has(s) ? !1 : (e.add(s), !0);
  });
}
const F = 32;
function Se(n, e = {}) {
  const t = e.pyramid ?? "auto", s = e.planeIndex, i = [];
  if (e.prefer !== void 0 && i.push(
    "layout.prefer was removed: a pyramid and a plane stack are no longer alternatives, so every same-size plane is read as a channel and the pyramid is kept. Use layout.planeIndex to pin a single plane."
  ), !n.length)
    return {
      strategy: "single",
      planes: [],
      pinned: !1,
      chosenPlane: null,
      ifdLevels: [],
      warnings: i
    };
  const r = /* @__PURE__ */ new Map();
  for (const g of n) {
    const A = U(g);
    r.has(A) || r.set(A, []), r.get(A).push(g);
  }
  const a = Y(n), o = n.filter((g) => !Ae(g)), l = Y(o);
  let c = a;
  l.length !== a.length && K(l) && (c = l);
  const h = K(c), f = c[0] ?? a[0];
  let u = r.get(U(f)) ?? [f];
  const p = n.some((g) => (g.subIFDs?.length ?? 0) > 0);
  let m;
  t === "ifd" ? m = h ? "ifd" : "single" : t === "subifd" ? (m = p ? "subifd" : "single", p || i.push("subifd requested but the file declares none")) : m = h ? "ifd" : p ? "subifd" : "single";
  const d = s != null;
  let y = 0;
  return d ? (y = Math.min(Math.max(s, 0), u.length - 1), u.length > 1 && i.push(
    `layout.planeIndex pinned plane ${y} of ${u.length}; the other planes are not read. Leave it unset to read them as channels.`
  ), u = [u[y]]) : u.length > F && (i.push(
    `the file has ${u.length} same-size directories; only the first ${F} can be read as one stack and the rest are dropped.`
  ), u = u.slice(0, F)), {
    strategy: m,
    planes: u,
    pinned: d,
    // Which plane was pinned, kept because an IFD pyramid OF planes has a group
    // at every level and the same plane has to be chosen from each of them. 0
    // when nothing was pinned, where it is unused.
    planeIndex: y,
    // The plane whose SubIFDs and tags describe the level set. Plane 0 of the
    // stack, not a substitute for it.
    chosenPlane: u[0],
    ifdLevels: c,
    warnings: i
  };
}
function Pe(n, e) {
  const t = [...e.warnings], s = e.planes.length > 1, i = (o, l) => ({
    width: o.width,
    height: o.height,
    tileWidth: o.tileWidth || 256,
    tileHeight: o.tileHeight || 256,
    dir: l[0].dir,
    // -1 means the directory itself; anything else indexes into its SubIFDs.
    subifd: l[0].subifd,
    planes: l,
    // Every level here has its own directory at its own size, so a tile read
    // maps 1:1. A synthetic pyramid built over a file without levels would set
    // this to the ratio it has to scale by.
    scaleFactor: 1,
    directory: o
  });
  let r;
  if (e.strategy === "ifd") {
    const o = /* @__PURE__ */ new Map();
    for (const l of n) {
      const c = U(l);
      o.has(c) || o.set(c, []), o.get(c).push(l);
    }
    r = e.ifdLevels.map((l) => {
      const c = o.get(U(l)) ?? [l], h = e.pinned ? [c[Math.min(e.planeIndex, c.length - 1)]] : c.slice(0, F);
      return i(h[0], h.map((f) => ({ dir: f.index, subifd: -1 })));
    });
  } else if (e.strategy === "subifd") {
    const o = e.chosenPlane, l = o.subIFDLevels ?? [];
    l.length || t.push(
      "the file declares SubIFDs but none could be read; using the full-size directory only"
    );
    const c = (f) => e.planes.map((u) => {
      const p = (u.subIFDLevels ?? [])[f];
      return !p || p.width !== l[f].width ? null : { dir: u.index, subifd: f };
    });
    r = [i(o, e.planes.map((f) => ({ dir: f.index, subifd: -1 })))];
    let h = 0;
    l.forEach((f, u) => {
      const p = c(u);
      if (p.some((m) => m === null)) {
        h++;
        return;
      }
      r.push(
        i(
          {
            ...f,
            index: o.index,
            imageDescription: o.imageDescription,
            subIFDs: []
          },
          p
        )
      );
    }), h > 0 && t.push(
      `${h} SubIFD level(s) were dropped: not every one of the ${e.planes.length} planes has a matching level there.`
    );
  } else
    r = [
      i(e.chosenPlane, e.planes.map((o) => ({ dir: o.index, subifd: -1 })))
    ];
  if (s) {
    const o = e.planes.reduce(
      (l, c) => l + (c.samplesPerPixel || 1),
      0
    );
    t.push(
      `${e.planes.length} same-size directories are read as a stack of ${o} channel(s). Set layout.planeIndex to read one plane instead.`
    );
  }
  r.sort((o, l) => o.width - l.width);
  const a = r.reduce((o, l) => o.width >= l.width ? o : l).directory;
  return { levels: r, full: a, warnings: t };
}
const X = {
  gpuTextureSet: se,
  tiffRaster: ie,
  rgba8: C,
  imageBitmap: C
}, Z = { auto: 0, image: 1, data: 2 }, J = { auto: 0, nearest: 1, bilinear: 2, box: 3 }, Ie = 1, ke = 2, Re = 4;
function Q(n = {}) {
  const e = n.gpu ?? {};
  let t = 0;
  return e.preferRGBA8 !== !1 && (t |= Ie), e.forceRGBA16F && (t |= ke), n.image?.strictGray && (t |= Re), t;
}
class Fe {
  #e;
  #t;
  #r;
  #s;
  #i;
  #n;
  constructor({ decoder: e, id: t, meta: s, options: i }) {
    this.#e = e, this.#t = t, this.#r = s, this.#n = i;
    const r = Se(s.directories, i.layout), a = Pe(s.directories, r);
    this.#s = a.levels, this.#i = a.warnings, this.layout = r.strategy;
  }
  get meta() {
    return this.#r;
  }
  get directories() {
    return this.#r.directories;
  }
  /** Ascending: index 0 is the smallest. This is the order viewers index by. */
  get levels() {
    return this.#s;
  }
  get warnings() {
    return this.#i;
  }
  /**
   * Full-resolution geometry and the encoding the samples carry.
   *
   * Describes the STACK, not one directory of it: a five-channel slide reports
   * `samplesPerPixel: 5` with five entries in `encoding.channels`, because that is
   * what a tile of it contains. Everything that is a property of how the bytes were
   * stored rather than of what they mean -- photometric, compression, planar
   * configuration -- comes from plane 0 and describes plane 0 only.
   */
  get descriptor() {
    const e = this.#s[this.#s.length - 1], t = e.directory, s = e.planes.map((l) => this.#r.directories[l.dir]), i = s.length > 1, r = i ? s.flatMap((l) => l.encoding.channels) : t.encoding.channels, a = i ? r.length : t.samplesPerPixel, o = be(
      this.#r.directories[0]?.imageDescription,
      s
    );
    return {
      width: t.width,
      height: t.height,
      samplesPerPixel: a,
      bitsPerSample: t.bitsPerSample,
      sampleFormat: t.sampleFormat,
      photometricInterpretation: t.photometricInterpretation,
      // What the samples ARE once decoded. Differs from the tag above for
      // JPEG YCbCr, where libtiff upsamples and converts on the way out.
      photometricDecoded: t.photometricDecoded,
      // How the samples got there. A consumer diagnosing a file that renders
      // wrong needs these three, and reading them off `file.directories` meant
      // knowing that `descriptor` had quietly dropped them.
      compression: t.compression,
      planarConfiguration: t.planarConfiguration,
      ycbcrSubsampling: t.ycbcrSubsampling,
      hasColorMap: t.hasColorMap,
      channels: Array.from({ length: a }, (l, c) => c),
      /*
       * A stack is measurements, whatever plane 0's photometric says.
       *
       * Two stacked RGB planes flatten to SamplesPerPixel 6 with photometric RGB
       * and would otherwise pass for a picture, which is a lie -- lanes 3 to 5 are
       * a second exposure, not more colour. This mirrors what the decoder resolves
       * per tile; the two must agree or a consumer picks a texture format the tile
       * then contradicts.
       */
      interpretationResolved: i ? "data" : t.interpretationAuto,
      // A copy, decorated. The metadata is the file's own account of itself and
      // several descriptors are taken per session; mutating it would make the
      // second one differ from the first for no reason a caller could see.
      encoding: {
        ...i ? { version: t.encoding.version } : t.encoding,
        channels: r.map(
          (l, c) => o?.[c] ? { ...l, name: o[c].name, color: o[c].color } : { ...l }
        )
      }
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
    const r = this.#s[e];
    if (!r) throw new RangeError(`no level ${e} (have ${this.#s.length})`);
    const a = r.scaleFactor, o = {
      dir: r.dir,
      subifd: r.subifd,
      // Every directory carrying a channel of this level. One request, not one per
      // plane: the tile data live at N offsets either way, so the bytes cost the
      // same, but a single call avoids N decoder round trips and an N-way merge
      // here.
      planes: r.planes,
      sx0: Math.round(t * r.tileWidth * a),
      sy0: Math.round(s * r.tileHeight * a),
      sx1: Math.round((t + 1) * r.tileWidth * a),
      sy1: Math.round((s + 1) * r.tileHeight * a),
      outWidth: r.tileWidth,
      outHeight: r.tileHeight,
      resample: J[i.resample ?? this.#n.resample ?? "auto"] ?? 0,
      output: X[i.output ?? "rgba8"] ?? C,
      channels: i.channels ?? this.#n.format?.channels ?? void 0,
      interpretation: Z[i.interpretation ?? this.#n.format?.interpretation ?? "auto"] ?? 0,
      packFlags: Q(this.#n.format),
      padAlpha: this.#n.format?.gpu?.padAlpha ?? 1
    };
    return this.#e.read(this.#t, o, { signal: i.signal });
  }
  /**
   * Read an arbitrary window of a directory, in that directory's pixel space.
   *
   * `planes` names several directories to read as one channel stack, the way a
   * level does; `dir`/`subifd` are plane 0 and are enough on their own.
   */
  async readRegion({
    dir: e = 0,
    subifd: t = -1,
    planes: s,
    x0: i,
    y0: r,
    x1: a,
    y1: o,
    outWidth: l,
    outHeight: c,
    output: h = "tiffRaster",
    signal: f,
    channels: u,
    resample: p,
    interpretation: m
  }) {
    return this.#e.read(
      this.#t,
      {
        dir: e,
        subifd: t,
        planes: s,
        sx0: i,
        sy0: r,
        sx1: a,
        sy1: o,
        outWidth: l ?? a - i,
        outHeight: c ?? o - r,
        output: X[h] ?? ie,
        channels: u,
        resample: p ?? J[this.#n.resample ?? "auto"] ?? 0,
        interpretation: Z[m ?? "auto"] ?? 0,
        packFlags: Q(this.#n.format),
        padAlpha: this.#n.format?.gpu?.padAlpha ?? 1
      },
      { signal: f }
    );
  }
  close() {
    this.#e.close(this.#t);
  }
}
class Ue {
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
class ve {
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
    const r = await this.#e.slice(e, i).arrayBuffer();
    return new Uint8Array(r);
  }
}
async function xe(n, e = {}) {
  if (n == null) throw new TypeError("openTiff needs a source");
  if (typeof n == "string" || n instanceof URL) {
    const { HttpSource: t } = await Promise.resolve().then(() => Xe);
    return new t(n, e);
  }
  if (typeof Blob < "u" && n instanceof Blob) return new ve(n);
  if (n instanceof Uint8Array || n instanceof ArrayBuffer)
    return new Ue(n);
  if (typeof n.getSize == "function" && typeof n.read == "function")
    return n;
  throw new TypeError(
    "openTiff needs a url, a Blob, a File, bytes, or an object with getSize() and read()"
  );
}
const I = {
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
      // Deliberately absent rather than 0: unset reads every plane as a channel,
      // and 0 would pin plane 0 and hide the rest.
      planeIndex: void 0
    }
  }
}, Me = le(
  new URL(
    "./",
    import.meta.url
  ).href
);
function le(n) {
  return n.endsWith("/") ? n : `${n}/`;
}
function ce(n, e) {
  const t = e ? le(String(e)) : Me;
  return new URL(`webtiff-${n}.mjs`, t).href;
}
function Ne() {
  return typeof SharedArrayBuffer == "function" && globalThis.crossOriginIsolated === !0 && typeof Atomics?.waitAsync == "function";
}
function he(n = {}) {
  return n.threads === !0 && Ne() ? "mt" : "st";
}
let N = null, k = null;
async function Be(n) {
  if (N && !n.wasmBaseUrl) return N;
  const e = he(n), t = ce(e, n.wasmBaseUrl), { default: s } = await import(
    /* @vite-ignore */
    t
  ), i = await s(), r = new ge(i);
  return n.wasmBaseUrl || (N = r), r;
}
function Ce(n, e) {
  return e.fetch ? !1 : typeof n == "string" || n instanceof URL || typeof Blob < "u" && n instanceof Blob || n instanceof Uint8Array || n instanceof ArrayBuffer;
}
async function We(n, e) {
  if (e.decoder) return { decoder: e.decoder, viaWorker: !1 };
  if (e.pool) return { decoder: e.pool, viaWorker: !0 };
  if (e.workers !== !1 && Ce(n, e) && typeof Worker < "u") {
    if (!k) {
      const { createDecoderPool: t } = await Promise.resolve().then(() => rt);
      k = await t(e);
    }
    if (k) return { decoder: k, viaWorker: !0 };
  }
  return { decoder: await Be(e), viaWorker: !1 };
}
function Le(n) {
  return n ? {
    ...I,
    ...n,
    gpu: { ...I.gpu, ...n.gpu },
    image: { ...I.image, ...n.image }
  } : I;
}
async function $e(n, e = {}) {
  const { decoder: t, viaWorker: s } = await We(n, e), i = s ? n : await xe(n, e), { id: r, meta: a } = await t.open(i, {
    blockSize: e.blockSize,
    cacheBytes: e.cacheBytes,
    signal: e.signal
  });
  return new Fe({
    decoder: t,
    id: r,
    meta: a,
    options: { ...e, format: Le(e.format) }
  });
}
const q = {};
function Oe(n, e, t = "warn") {
  q[n] || (q[n] = !0, console[t](e));
}
const De = 1, T = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, b = {
  UINT: 1,
  INT: 2,
  FLOAT: 3,
  UNDEFINED: 4,
  COMPLEX_INT: 5,
  COMPLEX_FLOAT: 6
};
function v(n, e, t) {
  if (n == null) return t;
  if (Array.isArray(n) || ArrayBuffer.isView(n)) {
    if (n.length === 0) return t;
    const s = e < n.length ? n[e] : n[0];
    return s ?? t;
  }
  return n;
}
function it(n) {
  const e = n || {}, t = (s) => s == null ? null : Array.isArray(s) ? s.length ? s : null : ArrayBuffer.isView(s) ? s.length ? Array.from(s) : null : [s];
  return {
    sMinSampleValue: t(e.SMinSampleValue),
    sMaxSampleValue: t(e.SMaxSampleValue)
  };
}
function B(n, e, t, s) {
  const i = v(n.sMinSampleValue, e, null), r = v(n.sMaxSampleValue, e, null);
  if (i === null || r === null) return null;
  const a = Number(i), o = Number(r);
  return !Number.isFinite(a) || !Number.isFinite(o) || o <= a || t !== null && (a < t || o > s) ? null : { min: a, max: o };
}
function ee(n, e) {
  return e ? [-Math.pow(2, n - 1), Math.pow(2, n - 1) - 1] : [0, Math.pow(2, n) - 1];
}
function ot(n) {
  const e = n || {}, t = e.bitsPerSample, s = e.sampleFormat;
  let i = e.samplesPerPixel;
  i > 0 || (i = Array.isArray(t) || ArrayBuffer.isView(t) ? t.length : 1), i = Math.max(1, i | 0);
  const r = [];
  for (let a = 0; a < i; a++) {
    const o = v(t, a, 8) || 8, l = v(s, a, b.UINT) || b.UINT;
    let c, h = 0, f = !1;
    switch (l) {
      case b.UINT: {
        const u = B(e, a, ...ee(o, !1));
        u ? (c = u.max - u.min, h = u.min) : c = Math.pow(2, o) - 1;
        break;
      }
      case b.INT: {
        const u = B(e, a, ...ee(o, !0));
        u ? (c = u.max - u.min, h = u.min) : (c = Math.pow(2, o - 1) - 1, f = !0);
        break;
      }
      case b.FLOAT: {
        const u = B(e, a, null, null);
        u ? (c = u.max - u.min, h = u.min) : (c = 1, f = !0);
        break;
      }
      default:
        throw new Error(
          `[web-tiff] Unsupported SampleFormat ${l} on channel ${a}; only 1 (unsigned int), 2 (signed int) and 3 (float) are supported.`
        );
    }
    c > 0 || (c = 1), r.push({ scale: c, offset: h, signed: f, bits: o, sampleFormat: l });
  }
  return { version: De, channels: r };
}
const He = Object.freeze({
  scale: 1,
  offset: 0,
  signed: !1,
  bits: 8,
  sampleFormat: b.UINT
});
function ze(n, e) {
  const t = n && n.channels || [], s = t[e];
  return s ?? (Oe(
    `tiffEncoding_channel_${e}_of_${t.length}`,
    `[web-tiff] No sample encoding for channel ${e} (file declares ${t.length}); using an identity transform. Check format.channels against the file's SamplesPerPixel.`
  ), He);
}
function je(n, e) {
  if (n == null) return 0;
  const t = Number(n);
  return Number.isNaN(t) ? 0 : (t - e.offset) / e.scale;
}
function at(n, e) {
  const t = je(n, e);
  return t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
}
function Ve(n) {
  return n.bits === 8 && (n.sampleFormat === b.UINT || n.sampleFormat === b.INT);
}
function lt(n) {
  return n.bits === 8 && n.sampleFormat === b.UINT && n.scale === 255 && n.offset === 0;
}
function ct(n, e) {
  const t = n || {}, s = t.photometricInterpretation, i = t.encoding;
  if (s === T.Palette && t.hasColorMap) return "image";
  const r = t.samplesPerPixel || i && i.channels.length || 1;
  return (s === T.RGB || s === T.YCbCr || s === T.CMYK || s === T.CIELab || (s === T.BlackIsZero || s === T.WhiteIsZero) && r === 1) && (Array.isArray(e) && e.length ? e.filter((c) => c != null && c >= 0) : i.channels.map((c, h) => h)).every((c) => Ve(ze(i, c))) ? "image" : "data";
}
const ht = "0.1.0", te = /\.(tiff?|qptiff|btf|svs|ndpi|scn)(\?|#|$)/i;
function Ge(n, e = {}) {
  let t = 0;
  class s extends n.TileSource {
    constructor(r, a = {}) {
      const o = typeof r == "object" && r !== null ? { ...r } : {}, l = typeof r == "string" ? r : o.url ?? r;
      super(typeof l == "string" ? l : `webtiff://${t}`), this._instance = t++, this._options = { ...e, ...o, ...a }, this._file = null, this.ready = !1;
      let c, h;
      this.promises = {
        ready: {
          promise: new Promise((f, u) => {
            c = f, h = u;
          })
        }
      }, this.promises.ready.resolve = c, this.promises.ready.reject = h, this.promises.ready.promise.catch(() => {
      }), this.#e(l);
    }
    async #e(r) {
      try {
        const a = await $e(r, this._options);
        this._file = a;
        const o = a.levels, l = o[o.length - 1];
        this.width = l.width, this.height = l.height, this.aspectRatio = this.width / this.height, this.dimensions = new n.Point(this.width, this.height), this.tileOverlap = 0, this.minLevel = 0, this.maxLevel = o.length - 1, this.levels = o, this.tileWidth = o[0].tileWidth, this.tileHeight = o[0].tileHeight, this.ready = !0, this._ready = !0, this.promises.ready.resolve(this), this.raiseEvent("ready", { tileSource: this });
      } catch (a) {
        this.promises.ready.reject(a), this.raiseEvent("open-failed", { message: a.message, source: r });
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
    supports(r, a) {
      if (r?.type && /^(web|geo)?tiff$/i.test(r.type) || typeof r == "string" && te.test(r) || typeof a == "string" && te.test(a)) return !0;
      const o = r instanceof ArrayBuffer ? new Uint8Array(r) : ArrayBuffer.isView(r) ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : null;
      if (o && o.length >= 4) {
        const l = o[0] === 73 && o[1] === 73, c = o[0] === 77 && o[1] === 77;
        if (l || c) {
          const h = l ? o[2] | o[3] << 8 : o[2] << 8 | o[3];
          return h === 42 || h === 43;
        }
      }
      return !1;
    }
    configure(r, a) {
      return typeof r == "string" ? { url: r } : { ...r, url: r.url ?? a };
    }
    /**
     * OpenSeadragon pyramid level -> index into `this.levels`.
     *
     * The two numberings coincide only as long as nothing inserts an OSD level.
     * Consumers do: a viewer may prepend a synthetic single-tile level 0 built
     * from a thumbnail, which shifts every real level up by one. Measuring from
     * the FINEST end is correct either way, because `maxLevel` moves with the
     * insertion while `levels.length` does not.
     *
     * Indexing absolutely instead fails silently -- no error, no missing tile,
     * just a level too coarse, which reads as a resampling choice rather than a
     * bug. Every site below goes through here for that reason.
     */
    _decoderLevel(r) {
      return this.levels.length - 1 - (this.maxLevel - r);
    }
    getTileWidth(r) {
      return this.levels?.[this._decoderLevel(r)]?.tileWidth;
    }
    getTileHeight(r) {
      return this.levels?.[this._decoderLevel(r)]?.tileHeight;
    }
    getLevelScale(r) {
      const a = this.levels, o = this._decoderLevel(r);
      return a?.[o] ? a[o].width / a[a.length - 1].width : NaN;
    }
    /**
     * Per-instance so two sources over one file keep separate cache entries.
     *
     * Deliberately keyed by the OSD level, not the decoder level: an inserted
     * level and the level it displaced are different pictures and must not share
     * a cache entry.
     */
    getTileHashKey(r, a, o) {
      return `webtiff${this._instance}_${r}_${a}_${o}`;
    }
    /** Never fetched; it is only the identity string for the download request. */
    getTileUrl(r, a, o) {
      return `${r}/${a}_${o}`;
    }
    downloadTileStart(r) {
      const a = new AbortController();
      r.userData.abortController = a;
      const o = r.tile;
      this._file.readTile(this._decoderLevel(o.level), o.x, o.y, {
        output: "rgba8",
        signal: a.signal
      }).then(async ({ header: l, packs: c }) => {
        const h = new ImageData(
          new Uint8ClampedArray(c[0].data.buffer),
          l.width,
          l.height
        ), f = await createImageBitmap(h);
        r.finish(f, `${r.src}`, "imageBitmap");
      }).catch((l) => {
        l?.name !== "AbortError" && r.fail(l.message, l);
      });
    }
    downloadTileAbort(r) {
      r.userData.abortController?.abort();
    }
    destroy() {
      this._file?.close(), this._file = null;
    }
  }
  return s;
}
function ut(n, e = {}) {
  if (!n?.TileSource)
    throw new TypeError("enableWebTiff needs the OpenSeadragon namespace");
  const t = n.version?.major ?? 0;
  if (t && t < 6)
    throw new Error(
      `web-tiff needs OpenSeadragon 6 or newer (found ${n.version.versionStr}). Use the geotiff-tilesource package for OpenSeadragon 4 and 5.`
    );
  if (n.WebTiffTileSource) return n.WebTiffTileSource;
  const s = Ge(n, e);
  return n.WebTiffTileSource = s, s;
}
const Ke = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
class Ye {
  #e;
  #t;
  #r;
  #s;
  #i;
  #n = null;
  #o = null;
  // set when the server ignored Range and sent everything
  #a = /* @__PURE__ */ new Map();
  constructor(e, {
    fetch: t,
    headers: s = {},
    credentials: i,
    captureErrorBody: r = !1
  } = {}) {
    this.#e = String(e), this.#t = t ?? globalThis.fetch.bind(globalThis), this.#r = s, this.#s = i, this.#i = r;
  }
  get url() {
    return this.#e;
  }
  async #l(e, t) {
    const s = { ...this.#r };
    e && (s.Range = `bytes=${e.start}-${e.end - 1}`);
    let i;
    try {
      i = await this.#t(this.#e, {
        headers: s,
        signal: t,
        credentials: this.#s
      });
    } catch (r) {
      throw r?.name === "AbortError" ? r : new R(`[web-tiff] cannot reach ${this.#e}: ${r.message}`, {
        url: this.#e,
        range: e,
        cause: r
      });
    }
    if (!i.ok) {
      let r = null;
      if (this.#i)
        try {
          const a = await i.clone().text();
          r = a.replace(/\s+/g, " ").slice(0, 200), a.length > 200 && (r += "...");
        } catch {
        }
      throw new R(
        `[web-tiff] HTTP ${i.status} for ${this.#e}${r ? `: ${r}` : ""}`,
        {
          status: i.status,
          statusText: i.statusText,
          url: this.#e,
          range: e,
          body: r
        }
      );
    }
    return i;
  }
  async #c(e, t) {
    try {
      return await this.#l(e, t);
    } catch (s) {
      if (s?.name === "AbortError" || !(s.status == null || Ke.has(s.status))) throw s;
      return await new Promise((r) => setTimeout(r, 250)), this.#l(e, t);
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
    if (this.#n != null) return this.#n;
    const t = await this.#c({ start: 0, end: 65536 }, e);
    if (t.status === 200) {
      const r = new Uint8Array(await t.arrayBuffer());
      return this.#o = r, this.#n = r.length, this.#n;
    }
    const s = t.headers.get("Content-Range"), i = s ? Number(s.split("/")[1]) : NaN;
    if (!Number.isFinite(i))
      throw new R(
        `[web-tiff] ${this.#e} answered a range request without a usable Content-Range; the server must support byte ranges`,
        { status: t.status, url: this.#e }
      );
    return this.#n = i, this.#h = new Uint8Array(await t.arrayBuffer()), i;
  }
  #h = null;
  async read(e, t, s) {
    this.#n == null && await this.getSize(s);
    const i = Math.min(e, this.#n), r = Math.min(e + t, this.#n);
    if (r <= i) return new Uint8Array(0);
    if (this.#o) return this.#o.subarray(i, r);
    if (this.#h && r <= this.#h.length)
      return this.#h.subarray(i, r);
    const a = `${i}-${r}`, o = this.#a.get(a);
    if (o) return o;
    const l = this.#c({ start: i, end: r }, s).then(async (c) => new Uint8Array(await c.arrayBuffer())).finally(() => this.#a.delete(a));
    return this.#a.set(a, l), l;
  }
}
const Xe = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HttpSource: Ye
}, Symbol.toStringTag, { value: "Module" })), E = {
  INIT: "init",
  OPEN: "open",
  READ: "read",
  CLOSE: "close",
  ABORT: "abort"
}, ne = {
  READY: "ready",
  WARN: "warn"
};
function Ze(n, e = {}) {
  if (typeof n == "string" || n instanceof URL)
    return {
      descriptor: {
        kind: "url",
        url: String(n),
        headers: e.headers,
        credentials: e.credentials,
        captureErrorBody: e.captureErrorBody
      },
      transfer: []
    };
  if (typeof Blob < "u" && n instanceof Blob)
    return { descriptor: { kind: "blob", blob: n }, transfer: [] };
  if (n instanceof Uint8Array)
    return {
      descriptor: { kind: "bytes", bytes: n },
      transfer: [n.buffer]
    };
  if (n instanceof ArrayBuffer)
    return {
      descriptor: { kind: "bytes", bytes: new Uint8Array(n) },
      transfer: [n]
    };
  throw new TypeError(
    "a worker source must be a Blob, a File, or bytes; custom sources only work with an in-process decoder"
  );
}
const Je = "./decode.worker.mjs";
function Qe() {
  const n = new URL(Je, import.meta.url);
  return new Worker(n, { type: "module" });
}
function qe() {
  const n = globalThis.navigator?.hardwareConcurrency ?? 4;
  return Math.min(4, Math.max(1, Math.ceil(n / 2)));
}
function et({ name: n, message: e, status: t, url: s, code: i }) {
  return n === "WebTiffHttpError" ? new R(e, { status: t, url: s }) : n === "WebTiffUnsupportedError" ? new re(e, { code: i }) : n === "AbortError" ? new DOMException(e, "AbortError") : new w(e, { code: i });
}
class tt {
  #e;
  #t = /* @__PURE__ */ new Map();
  #r = 1;
  ready;
  inFlight = 0;
  constructor(e, t) {
    this.#e = e, this.ready = new Promise((s) => {
      const i = (r) => {
        r.data?.kind === ne.READY && (e.removeEventListener("message", i), s());
      };
      e.addEventListener("message", i);
    }), e.addEventListener("message", (s) => {
      const i = s.data;
      if (i?.kind === ne.WARN) {
        t?.(i);
        return;
      }
      if (i?.kind) return;
      const r = this.#t.get(i.id);
      r && (this.#t.delete(i.id), this.inFlight--, i.ok ? r.resolve(i.result) : r.reject(et(i.error)));
    }), e.addEventListener("error", (s) => {
      const i = new w(s.message ?? "decode worker failed");
      for (const [, r] of this.#t) r.reject(i);
      this.#t.clear(), this.inFlight = 0;
    });
  }
  send(e, t = []) {
    const s = this.#r++;
    return this.inFlight++, new Promise((i, r) => {
      this.#t.set(s, { resolve: i, reject: r }), this.#e.postMessage({ ...e, id: s }, t);
    });
  }
  terminate() {
    this.#e.terminate();
  }
}
class ue {
  #e = [];
  #t = /* @__PURE__ */ new Map();
  #r = 1;
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
    const { descriptor: s, transfer: i } = Ze(e, t), r = this.#i(), { id: a, meta: o } = await r.send(
      { op: E.OPEN, src: s, options: t },
      i
    ), l = this.#r++;
    return this.#t.set(l, { worker: r, remoteId: a }), { id: l, meta: o };
  }
  async read(e, t, { signal: s } = {}) {
    const i = this.#t.get(e);
    if (!i) throw new w(`unknown file ${e}`);
    const r = i.worker.send({ op: E.READ, file: i.remoteId, req: t });
    return s && s.addEventListener(
      "abort",
      () => i.worker.send({ op: E.ABORT, target: e }),
      { once: !0 }
    ), r;
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
async function nt(n = {}) {
  if (typeof Worker > "u") return null;
  const e = he(n), t = ce(e, n.wasmBaseUrl), s = n.size ?? qe(), i = n.createWorker ?? (n.workerUrl ? () => new Worker(n.workerUrl, { type: "module" }) : Qe), r = [];
  for (let a = 0; a < s; a++)
    r.push(new tt(i(), n.onWarning));
  return await Promise.all(r.map((a) => a.ready)), await Promise.all(r.map((a) => a.send({ op: E.INIT, wasmUrl: t }))), new ue(r, n.onWarning);
}
const rt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecoderPool: ue,
  createDecoderPool: nt
}, Symbol.toStringTag, { value: "Module" }));
export {
  ve as BlobSource,
  Ue as BytesSource,
  ge as Decoder,
  F as MAX_PLANES,
  T as PHOTOMETRIC,
  De as SAMPLE_ENCODING_VERSION,
  b as SAMPLE_FORMAT,
  Fe as TiffFile,
  ht as VERSION,
  fe as WebTiffAbortError,
  w as WebTiffDecodeError,
  x as WebTiffError,
  R as WebTiffHttpError,
  re as WebTiffUnsupportedError,
  Pe as buildLevels,
  ze as channelEncodingAt,
  I as defaultFormat,
  ut as enableWebTiff,
  ct as inferInterpretation,
  Ae as isCompanionPage,
  Ve as isDisplayReadyChannel,
  lt as isIdentityChannel,
  K as looksLikeIFDPyramid,
  Ge as makeTileSource,
  be as omeChannelsForPlanes,
  we as omeColorToHex,
  $e as openTiff,
  st as parseOmeChannels,
  U as planeKey,
  it as readSampleRangeTags,
  Se as resolveLayout,
  ot as resolveSampleEncoding,
  at as sampleToByte,
  je as sampleToUnit,
  he as selectBuild,
  xe as toSource
};
