class P {
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
  constructor({ code: e, message: t, severity: r = "warn", file: i = null, label: s = null }) {
    this.code = e, this.message = t, this.severity = r, this.file = i, this.label = s;
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
function S(n, e, t = "warn", r = {}) {
  return new P({ code: n, message: e, severity: t, ...r });
}
const L = /* @__PURE__ */ new Set(), Pe = /* @__PURE__ */ new Set(), ue = /* @__PURE__ */ new WeakMap(), de = /* @__PURE__ */ new WeakMap();
function pe(n, e) {
  let t = n.get(e);
  return t === void 0 && (t = /* @__PURE__ */ new Set(), n.set(e, t)), t;
}
function Ie(n, e) {
  if (e) {
    const t = pe(ue, e);
    return t.add(n), () => t.delete(n);
  }
  return L.add(n), () => L.delete(n);
}
function ge(n, e) {
  if (typeof e?.report == "function") {
    e.report(n);
    return;
  }
  const t = e ? pe(de, e) : Pe, r = e ? n.code : `${n.file ?? n.label ?? ""} ${n.code}`;
  if (t.has(r)) return;
  t.add(r);
  const s = [...(e ? ue.get(e) : void 0) ?? [], ...L];
  if (s.length === 0) {
    console[n.severity === "info" ? "info" : "warn"](n.message);
    return;
  }
  for (const a of s) a(n);
}
function ke(n) {
  n && de.delete(n);
}
class b extends Error {
  constructor(e, t) {
    super(e, t), this.name = "WebTiffError";
  }
}
class U extends b {
  constructor(e, { status: t = null, statusText: r = "", url: i = null, range: s = null, body: a = null, cause: o } = {}) {
    super(e, o ? { cause: o } : void 0), this.name = "WebTiffHttpError", this.status = t, this.statusText = r, this.url = i, this.range = s, this.body = a;
  }
}
class w extends b {
  constructor(e, { code: t = null, cause: r } = {}) {
    super(e, r ? { cause: r } : void 0), this.name = "WebTiffDecodeError", this.code = t;
  }
}
class me extends b {
  constructor(e, { code: t = null } = {}) {
    super(e), this.name = "WebTiffUnsupportedError", this.code = t;
  }
}
class We extends b {
  constructor(e = "aborted") {
    super(e), this.name = "AbortError";
  }
}
function Re(n, e) {
  const t = e || `web-tiff status ${n}`;
  switch (n) {
    case -4:
      return new me(t, { code: n });
    case -7:
      return new We(t);
    default:
      return new w(t, { code: n });
  }
}
const G = 0, V = 1, we = 0, ye = 1, B = 2, $e = {
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
}, Ue = 4294967295, v = 32, K = 32, X = 2, Y = 8, Z = 4096, J = 16384;
class Fe {
  #e;
  #t;
  #r = /* @__PURE__ */ new Map();
  /** Native handle -> the entry it belongs to, for attributing a drained record. */
  #s = /* @__PURE__ */ new Map();
  #i = /* @__PURE__ */ new Set();
  #n = 1;
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
  #o(e) {
    const t = this.#e, r = t._wt_wants_count(e), i = t._wt_wants_ptr(e), s = [];
    for (let a = 0; a < r; a++) {
      const o = i + a * this.#t.range;
      s.push({
        offset: t.HEAPF64[o / 8],
        length: t.HEAPU32[(o + 8) / 4]
      });
    }
    return s;
  }
  async #a(e, t, r) {
    const i = this.#e;
    for (const { offset: s, length: a } of this.#o(e)) {
      const o = await t.read(s, a, r);
      if (!o.length) continue;
      const l = i._wt_cache_reserve(e, s, o.length);
      if (l === 0) throw new w("out of memory reserving a block");
      i.HEAPU8.set(o, l), i._wt_cache_commit(e, s, o.length);
    }
  }
  #l(e, t) {
    const r = this.#e.UTF8ToString(this.#e._wt_last_error(e));
    return Re(t, r);
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
  #c(e) {
    const t = this.#e;
    if (typeof t._wt_progress == "function")
      return () => t._wt_progress(e);
    let r = 0, i = null;
    return () => {
      const s = this.#o(e).map((a) => `${a.offset}:${a.length}`).join(",");
      return s !== i && (i = s, r++), r;
    };
  }
  /**
   * Bound the round trips that achieve nothing, and say which bound was hit.
   *
   * Returns a `step(progress)` to call once per round with the current progress
   * value; it throws when the operation has stopped resolving.
   */
  #h(e) {
    let t = -1, r = 0, i = 0;
    return (s) => {
      if (i++, s > t)
        t = s, r = 0;
      else if (++r > Y)
        throw new w(
          `${e} stopped resolving: ${Y} fetches in a row advanced nothing, after ${i} fetches in total. The source is not returning the ranges being asked for.`
        );
      if (i > Z)
        throw new w(
          `${e} did not resolve within ${Z} fetches, which is the runaway limit rather than a budget; the file is deeper than anything this library expects to see.`
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
  async open(e, { blockSize: t = 65536, cacheBytes: r = 32 * 1024 * 1024, signal: i, label: s = null } = {}) {
    const a = this.#e, o = await e.getSize(), l = a._wt_file_create(o, t, r);
    if (l <= 0) throw new w(`cannot open: status ${l}`);
    const c = this.#n++, h = { id: c, handle: l, source: e, label: s };
    this.#s.set(l, h);
    try {
      const f = this.#c(l), u = this.#h("the header");
      let d = a._wt_open(l);
      for (; d === V; )
        await this.#a(l, e, i), d = a._wt_open(l), u(f());
      if (d !== G) throw this.#l(l, d);
      const g = JSON.parse(a.UTF8ToString(a._wt_meta_json(l)));
      if (g.abi !== X)
        throw new w(
          `[web-tiff] this build speaks ABI ${X} but the WebAssembly module speaks ${g.abi}. The .mjs and the .wasm are versioned together; re-copy the whole folder rather than one file of it.`
        );
      return this.#r.set(c, h), { id: c, meta: g };
    } catch (f) {
      throw this.#f(), a._wt_file_close(l), this.#s.delete(l), f;
    } finally {
      this.#f();
    }
  }
  close(e) {
    const t = this.#r.get(e);
    t && (this.#e._wt_file_close(t.handle), this.#r.delete(e), this.#s.delete(t.handle));
  }
  #u(e, t) {
    const r = this.#e, i = r.HEAPU32, s = r.HEAP32, a = r.HEAPF32, o = e / 4;
    r.HEAPU8.fill(0, e, e + this.#t.req), i[o + 0] = t.dir ?? 0, s[o + 1] = t.subifd ?? -1, i[o + 2] = t.sx0, i[o + 3] = t.sy0, i[o + 4] = t.sx1, i[o + 5] = t.sy1, i[o + 6] = t.outWidth ?? t.sx1 - t.sx0, i[o + 7] = t.outHeight ?? t.sy1 - t.sy0, i[o + 8] = t.resample ?? 0, i[o + 9] = t.interpretation ?? 0, i[o + 10] = t.packFlags ?? 0, i[o + 11] = t.output ?? we, a[o + 12] = t.padAlpha ?? 1;
    const l = t.channels ?? [];
    i[o + 13] = Math.min(l.length, v);
    for (let p = 0; p < v; p++) s[o + 14 + p] = l[p] ?? -1;
    const c = o + 14 + v;
    for (let p = 0; p < 4; p++)
      i[c + p] = t.rgbaChannels?.[p] ?? Ue;
    const h = t.planes ?? [], f = Math.min(h.length, K), u = c + 4, d = u + 1, g = d + K;
    i[u] = f;
    for (let p = 0; p < f; p++)
      i[d + p] = h[p].dir ?? 0, s[g + p] = h[p].subifd ?? -1;
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
  #d(e, t) {
    const r = new ArrayBuffer(t);
    return new Uint8Array(r).set(this.#e.HEAPU8.subarray(e, e + t)), r;
  }
  #p(e) {
    const t = this.#e, r = t.HEAPU32, i = t.HEAP32, s = t.HEAPF64, a = t._wt_result_header_ptr(e) / 4, o = {
      width: r[a + 0],
      height: r[a + 1],
      mode: r[a + 2] === 0 ? "image" : "data",
      channelCount: r[a + 3],
      encodingVersion: r[a + 4],
      output: r[a + 5],
      packCount: r[a + 6],
      bandCount: r[a + 7],
      flags: r[a + 8]
    }, l = [], c = t._wt_result_bands_ptr(e), h = [];
    for (let d = 0; d < o.bandCount; d++) {
      const g = (c + d * this.#t.band) / 4, p = r[g + 0], y = r[g + 1], m = r[g + 2], T = $e[m] ?? Uint8Array, W = this.#d(p, y);
      h.push({
        data: new T(W),
        sampleType: m,
        flags: r[g + 3],
        channel: i[g + 4]
      }), l.push(W);
    }
    const f = t._wt_result_packs_ptr(e), u = [];
    for (let d = 0; d < o.packCount; d++) {
      const g = f + d * this.#t.pack, p = g / 4, y = r[p + 0] === 0 ? "RGBA8" : "RGBA16F", m = r[p + 1], T = r[p + 2], W = y === "RGBA8" ? Uint8Array : Uint16Array, D = this.#d(m, T), z = [];
      for (let A = 0; A < 4; A++) z.push(i[p + 4 + A]);
      const H = [], j = [];
      for (let A = 0; A < 4; A++)
        H.push(s[(g + 32) / 8 + A]), j.push(s[(g + 64) / 8 + A]);
      u.push({
        format: y,
        data: new W(D),
        channels: z,
        normalized: r[p + 3] === 1,
        scale: H,
        offset: j
      }), l.push(D);
    }
    return { header: o, bands: h, packs: u, transfer: l };
  }
  /** Read a window. Fetches whatever the decode needs first. */
  async read(e, t, { signal: r } = {}) {
    const i = this.#r.get(e);
    if (!i) throw new w(`unknown file ${e}`);
    const s = this.#e, a = s._malloc(this.#t.req), o = s._malloc(4);
    try {
      const l = this.#c(i.handle), c = this.#h("the tile");
      for (; ; ) {
        if (r?.aborted) throw new DOMException("aborted", "AbortError");
        this.#u(a, t), s._wt_plan_region(i.handle, a, 0), await this.#a(i.handle, i.source, r), this.#u(a, t);
        const f = s._wt_read(i.handle, a, o);
        if (f === G) break;
        if (f !== V) throw this.#l(i.handle, f);
        c(l());
      }
      const h = s.HEAPU32[o / 4];
      try {
        return this.#p(h);
      } finally {
        s._wt_result_free(h);
      }
    } finally {
      s._free(a), s._free(o), this.#f();
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
  onWarning(e) {
    return this.#i.add(e), () => this.#i.delete(e);
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
    this.#f();
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
  #f() {
    if (this.#i.size === 0) return;
    let e;
    try {
      e = this.drainWarnings();
    } catch {
      return;
    }
    for (const t of e)
      for (const r of this.#i) r(t);
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
    const e = this.#e, t = e._malloc(J);
    try {
      return e._wt_drain_warnings(t, J) <= 0 ? [] : JSON.parse(e.UTF8ToString(t)).map((s) => {
        const a = s.file ? this.#s.get(s.file) : void 0;
        return new P({
          code: s.code,
          message: s.message,
          // Defaulted rather than required: new JavaScript over an old .wasm is
          // a combination this library already ships into, and a diagnostic that
          // arrives without a severity is still worth showing.
          severity: s.severity ?? "warn",
          file: a?.id ?? null,
          label: a?.label ?? null
        });
      });
    } finally {
      e._free(t);
    }
  }
}
function be(n, e) {
  const t = new RegExp(`<(?:\\w+:)?${e}\\b([^>]*)>`, "g"), r = [];
  for (const i of n.matchAll(t)) r.push(i[1]);
  return r;
}
function k(n, e) {
  const t = new RegExp(`\\b${e}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(n);
  return t ? t[2] !== void 0 ? t[2] : t[3] : null;
}
function Me(n) {
  if (n == null || n === "") return null;
  const e = Number(n);
  return Number.isFinite(e) ? `#${(e >>> 0 >>> 8 & 16777215).toString(16).padStart(6, "0")}` : null;
}
function Ne(n) {
  const e = be(n, "TiffData"), t = /* @__PURE__ */ new Map();
  for (const r of e) {
    const i = k(r, "IFD"), s = k(r, "FirstC");
    i === null || s === null || t.set(Number(i), Number(s));
  }
  return t.size ? t : null;
}
function _e(n) {
  if (typeof n != "string" || !/<(?:\w+:)?OME\b/.test(n)) return null;
  const e = /<(?:\w+:)?Image\b[\s\S]*?(?=<(?:\w+:)?Image\b|$)/.exec(
    n
  ), t = e ? e[0] : n, r = be(t, "Channel").map((i) => ({
    name: k(i, "Name"),
    color: Me(k(i, "Color")),
    samplesPerPixel: Number(k(i, "SamplesPerPixel") ?? 1) || 1
  }));
  return r.length ? { scope: t, channels: r } : null;
}
function _t(n) {
  return _e(n)?.channels ?? null;
}
function ve(n, e) {
  const t = _e(n);
  if (!t) return null;
  const r = t.channels, i = Ne(t.scope), s = [];
  return e.forEach((a, o) => {
    const l = i?.get(a.index) ?? o, c = r[l] ?? null, h = a.samplesPerPixel || 1;
    for (let f = 0; f < h; f++)
      s.push(c ? { name: c.name, color: c.color } : null);
  }), s;
}
const R = {
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
}, Q = 32, q = { r: 0, g: 1, b: 2, a: 3, x: -1 }, ee = 4;
function O(n, e) {
  if (n == null) return null;
  if (typeof n == "string") {
    const t = n.trim().toLowerCase();
    if (t === "all")
      return ge(
        new P({
          code: "channels_all",
          message: '[web-tiff] format.channels: "all" is accepted as an alias for null (every channel). Prefer null, or omit the option.',
          severity: "info",
          file: e?.file ?? null,
          label: e?.label ?? null
        }),
        e
      ), null;
    if (t.length === 0 || t.length > ee)
      throw new b(
        `[web-tiff] format.channels: a swizzle names 1 to ${ee} lanes; got ${JSON.stringify(n)}. Use an array to name more.`
      );
    const r = [];
    for (const i of t) {
      if (!(i in q))
        throw new b(
          `[web-tiff] format.channels: ${JSON.stringify(n)} is not a channel swizzle. Letters are r g b a x (0 1 2 3 padding), or use "all", null, or an array of indices.`
        );
      r.push(q[i]);
    }
    return r;
  }
  if (!Array.isArray(n))
    throw new b(
      `[web-tiff] format.channels must be an array of indices, a swizzle string, "all", or null; got ${typeof n}.`
    );
  if (n.length === 0) return null;
  if (n.length > Q)
    throw new b(
      `[web-tiff] format.channels names ${n.length} channels; at most ${Q} can be read in one request.`
    );
  for (let t = 0; t < n.length; t++) {
    const r = n[t];
    if (!Number.isInteger(r) || r < -1)
      throw new b(
        `[web-tiff] format.channels[${t}] must be a channel index, or -1 for a padding lane; got ${JSON.stringify(r)}.`
      );
  }
  return n;
}
const xe = 1;
function Ce(n) {
  const t = ((n?.imageDescription ?? "").split(`
`)[1] ?? "").toLowerCase();
  return t.includes("macro") || t.includes("label");
}
function te(n, e, t) {
  return {
    min: n / (e + t),
    max: e - t > 0 ? n / (e - t) : 1 / 0
  };
}
function Le(n, e, t, r, i = xe) {
  const s = te(n, t, i), a = te(e, r, i);
  return s.min <= a.max && a.min <= s.max;
}
function ne(n) {
  if (n.length < 2) return !1;
  for (let r = 1; r < n.length; r++)
    if (n[r].width >= n[r - 1].width || n[r].height >= n[r - 1].height) return !1;
  const { width: e, height: t } = n[0];
  return n.every((r, i) => i === 0 || Le(e, t, r.width, r.height));
}
function M(n) {
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
function Be(n, e) {
  return e.width - n.width;
}
function re(n) {
  const e = /* @__PURE__ */ new Set();
  return [...n].sort(Be).filter((t) => {
    const r = `${t.width}x${t.height}`;
    return e.has(r) ? !1 : (e.add(r), !0);
  });
}
const F = 32;
function Oe(n, e = {}) {
  const t = e.pyramid ?? "auto", r = e.planeIndex, i = [];
  if (e.prefer !== void 0 && i.push(
    S(
      "layout_prefer_removed",
      "layout.prefer was removed: a pyramid and a plane stack are no longer alternatives, so every same-size plane is read as a channel and the pyramid is kept. Use layout.planeIndex to pin a single plane."
    )
  ), !n.length)
    return {
      strategy: "single",
      planes: [],
      pinned: !1,
      chosenPlane: null,
      ifdLevels: [],
      warnings: i
    };
  const s = /* @__PURE__ */ new Map();
  for (const m of n) {
    const T = M(m);
    s.has(T) || s.set(T, []), s.get(T).push(m);
  }
  const a = re(n), o = n.filter((m) => !Ce(m)), l = re(o);
  let c = a;
  l.length !== a.length && ne(l) && (c = l);
  const h = ne(c), f = c[0] ?? a[0];
  let u = s.get(M(f)) ?? [f];
  const d = n.some((m) => (m.subIFDs?.length ?? 0) > 0);
  let g;
  t === "ifd" ? g = h ? "ifd" : "single" : t === "subifd" ? (g = d ? "subifd" : "single", d || i.push(
    S("layout_subifd_none", "subifd requested but the file declares none")
  )) : g = h ? "ifd" : d ? "subifd" : "single";
  const p = r != null;
  let y = 0;
  return p ? (y = Math.min(Math.max(r, 0), u.length - 1), u.length > 1 && i.push(
    S(
      "layout_plane_pinned",
      `layout.planeIndex pinned plane ${y} of ${u.length}; the other planes are not read. Leave it unset to read them as channels.`,
      "info"
    )
  ), u = [u[y]]) : u.length > F && (i.push(
    S(
      "layout_plane_cap",
      `the file has ${u.length} same-size directories; only the first ${F} can be read as one stack and the rest are dropped.`
    )
  ), u = u.slice(0, F)), {
    strategy: g,
    planes: u,
    pinned: p,
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
function De(n, e) {
  const t = [...e.warnings], r = e.planes.length > 1, i = (o, l) => ({
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
  let s;
  if (e.strategy === "ifd") {
    const o = /* @__PURE__ */ new Map();
    for (const l of n) {
      const c = M(l);
      o.has(c) || o.set(c, []), o.get(c).push(l);
    }
    s = e.ifdLevels.map((l) => {
      const c = o.get(M(l)) ?? [l], h = e.pinned ? [c[Math.min(e.planeIndex, c.length - 1)]] : c.slice(0, F);
      return i(h[0], h.map((f) => ({ dir: f.index, subifd: -1 })));
    });
  } else if (e.strategy === "subifd") {
    const o = e.chosenPlane, l = o.subIFDLevels ?? [];
    l.length || t.push(
      S(
        "subifd_levels_unreadable",
        "the file declares SubIFDs but none could be read; using the full-size directory only"
      )
    );
    const c = (f) => e.planes.map((u) => {
      const d = (u.subIFDLevels ?? [])[f];
      return !d || d.width !== l[f].width ? null : { dir: u.index, subifd: f };
    });
    s = [i(o, e.planes.map((f) => ({ dir: f.index, subifd: -1 })))];
    let h = 0;
    l.forEach((f, u) => {
      const d = c(u);
      if (d.some((g) => g === null)) {
        h++;
        return;
      }
      s.push(
        i(
          {
            ...f,
            index: o.index,
            imageDescription: o.imageDescription,
            subIFDs: []
          },
          d
        )
      );
    }), h > 0 && t.push(
      S(
        "subifd_levels_dropped",
        `${h} SubIFD level(s) were dropped: not every one of the ${e.planes.length} planes has a matching level there.`
      )
    );
  } else
    s = [
      i(e.chosenPlane, e.planes.map((o) => ({ dir: o.index, subifd: -1 })))
    ];
  if (r) {
    const o = e.planes.reduce(
      (l, c) => l + (c.samplesPerPixel || 1),
      0
    );
    t.push(
      S(
        "layout_stack",
        `${e.planes.length} same-size directories are read as a stack of ${o} channel(s). Set layout.planeIndex to read one plane instead.`,
        "info"
      )
    );
  }
  s.sort((o, l) => o.width - l.width);
  const a = s.reduce((o, l) => o.width >= l.width ? o : l).directory;
  return { levels: s, full: a, warnings: t };
}
const se = {
  gpuTextureSet: we,
  tiffRaster: ye,
  rgba8: B,
  imageBitmap: B
}, ie = { auto: 0, image: 1, data: 2 }, oe = { auto: 0, nearest: 1, bilinear: 2, box: 3 }, ze = 1, He = 2, je = 4;
function ae(n = {}) {
  const e = n.gpu ?? {};
  let t = 0;
  return e.preferRGBA8 !== !1 && (t |= ze), e.forceRGBA16F && (t |= He), n.image?.strictGray && (t |= je), t;
}
class Ge {
  #e;
  #t;
  #r;
  #s;
  #i;
  #n;
  #o;
  #a = /* @__PURE__ */ new Set();
  constructor({ decoder: e, id: t, meta: r, options: i, diagnostics: s = [] }) {
    this.#e = e, this.#t = t, this.#r = r, this.#n = i, this.#o = { file: t, label: i.label ?? null };
    const a = Oe(r.directories, i.layout), o = De(r.directories, a);
    this.#s = o.levels, this.#i = [...s, ...o.warnings].map(
      (l) => new P({ ...l, file: t, label: i.label ?? null })
    ), this.layout = a.strategy;
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
  /**
   * What the layout resolver decided, as {@link Diagnostic}s.
   *
   * A snapshot taken when the file opened, not a log that grows: everything here
   * is a property of the directory structure, which does not change. Runtime
   * diagnostics arrive through `onWarning`.
   *
   * Each stringifies to its message, so joining or interpolating these reads the
   * same as it did when they were plain strings. Check `severity` before showing
   * them as problems -- a plane stack read as channels is reported here and is
   * the correct outcome.
   *
   * @returns {import("./diagnostics.js").Diagnostic[]}
   */
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
    const e = this.#s[this.#s.length - 1], t = e.directory, r = e.planes.map((l) => this.#r.directories[l.dir]), i = r.length > 1, s = i ? r.flatMap((l) => l.encoding.channels) : t.encoding.channels, a = i ? s.length : t.samplesPerPixel, o = ve(
      this.#r.directories[0]?.imageDescription,
      r
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
        channels: s.map(
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
      (r) => r.bits === 8 && r.sampleFormat === 1 && r.scale === 255 && r.offset === 0
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
  async readTile(e, t, r, i = {}) {
    const s = this.#s[e];
    if (!s) throw new RangeError(`no level ${e} (have ${this.#s.length})`);
    const a = s.scaleFactor, o = {
      dir: s.dir,
      subifd: s.subifd,
      // Every directory carrying a channel of this level. One request, not one per
      // plane: the tile data live at N offsets either way, so the bytes cost the
      // same, but a single call avoids N decoder round trips and an N-way merge
      // here.
      planes: s.planes,
      sx0: Math.round(t * s.tileWidth * a),
      sy0: Math.round(r * s.tileHeight * a),
      sx1: Math.round((t + 1) * s.tileWidth * a),
      sy1: Math.round((r + 1) * s.tileHeight * a),
      outWidth: s.tileWidth,
      outHeight: s.tileHeight,
      resample: oe[i.resample ?? this.#n.resample ?? "auto"] ?? 0,
      output: se[i.output ?? "rgba8"] ?? B,
      // A per-read override never passed through mergeFormat, so it is validated
      // here; the file-level default already was.
      channels: i.channels !== void 0 ? O(i.channels, this.#o) : this.#n.format?.channels ?? void 0,
      interpretation: ie[i.interpretation ?? this.#n.format?.interpretation ?? "auto"] ?? 0,
      packFlags: ae(this.#n.format),
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
    planes: r,
    x0: i,
    y0: s,
    x1: a,
    y1: o,
    outWidth: l,
    outHeight: c,
    output: h = "tiffRaster",
    signal: f,
    channels: u,
    resample: d,
    interpretation: g
  }) {
    return this.#e.read(
      this.#t,
      {
        dir: e,
        subifd: t,
        planes: r,
        sx0: i,
        sy0: s,
        sx1: a,
        sy1: o,
        outWidth: l ?? a - i,
        outHeight: c ?? o - s,
        output: se[h] ?? ye,
        channels: O(u, this.#o),
        resample: d ?? oe[this.#n.resample ?? "auto"] ?? 0,
        interpretation: ie[g ?? "auto"] ?? 0,
        packFlags: ae(this.#n.format),
        padAlpha: this.#n.format?.gpu?.padAlpha ?? 1
      },
      { signal: f }
    );
  }
  /**
   * Subscribe to the diagnostics this file produces while it is open.
   *
   * Filtered to this file, so a host with several slides open gets each one's
   * own. Returns an unsubscribe function; `close()` calls every outstanding one,
   * because a callback that outlives its file would fire against an id that has
   * been handed to something else.
   *
   * The open-time layout diagnostics are on `warnings` rather than here: they
   * were produced before a caller could have subscribed.
   *
   * @param {(d: import("./diagnostics.js").Diagnostic) => void} fn
   * @returns {() => void}
   */
  onWarning(e) {
    const t = [Ie(e, this.#o)];
    typeof this.#e.onWarning == "function" && t.push(
      this.#e.onWarning((i) => {
        i.file === this.#t && e(i);
      })
    );
    const r = () => {
      for (const i of t) i();
    };
    return this.#a.add(r), () => {
      this.#a.delete(r), r();
    };
  }
  close() {
    for (const e of this.#a) e();
    this.#a.clear(), ke(this.#o), this.#e.close(this.#t);
  }
}
class Ve {
  #e;
  constructor(e) {
    this.#e = e instanceof Uint8Array ? e : new Uint8Array(e);
  }
  async getSize() {
    return this.#e.length;
  }
  async read(e, t) {
    const r = Math.min(e, this.#e.length), i = Math.min(e + t, this.#e.length);
    return this.#e.subarray(r, i);
  }
}
class Ke {
  #e;
  constructor(e) {
    this.#e = e;
  }
  async getSize() {
    return this.#e.size;
  }
  async read(e, t, r) {
    if (r?.aborted) throw new DOMException("aborted", "AbortError");
    const i = Math.min(e + t, this.#e.size);
    if (i <= e) return new Uint8Array(0);
    const s = await this.#e.slice(e, i).arrayBuffer();
    return new Uint8Array(s);
  }
}
async function Xe(n, e = {}) {
  if (n == null) throw new TypeError("openTiff needs a source");
  if (typeof n == "string" || n instanceof URL) {
    const { HttpSource: t } = await Promise.resolve().then(() => ht);
    return new t(n, e);
  }
  if (typeof Blob < "u" && n instanceof Blob) return new Ke(n);
  if (n instanceof Uint8Array || n instanceof ArrayBuffer)
    return new Ve(n);
  if (typeof n.getSize == "function" && typeof n.read == "function")
    return n;
  throw new TypeError(
    "openTiff needs a url, a Blob, a File, bytes, or an object with getSize() and read()"
  );
}
const Ye = Ae(
  new URL(
    "./",
    import.meta.url
  ).href
);
function Ae(n) {
  return n.endsWith("/") ? n : `${n}/`;
}
function Te(n, e) {
  const t = e ? Ae(String(e)) : Ye;
  return new URL(`webtiff-${n}.mjs`, t).href;
}
function Ze() {
  return typeof SharedArrayBuffer == "function" && globalThis.crossOriginIsolated === !0 && typeof Atomics?.waitAsync == "function";
}
function Ee(n = {}) {
  return n.threads === !0 && Ze() ? "mt" : "st";
}
let x = null, $ = null;
async function Je(n) {
  if (x && !n.wasmBaseUrl) return x;
  const e = Ee(n), t = Te(e, n.wasmBaseUrl), { default: r } = await import(
    /* @vite-ignore */
    t
  ), i = await r(), s = new Fe(i);
  return n.wasmBaseUrl || (x = s), s;
}
function Qe(n, e) {
  return e.fetch ? !1 : typeof n == "string" || n instanceof URL || typeof Blob < "u" && n instanceof Blob || n instanceof Uint8Array || n instanceof ArrayBuffer;
}
async function qe(n, e) {
  if (e.decoder) return { decoder: e.decoder, viaWorker: !1 };
  if (e.pool) return { decoder: e.pool, viaWorker: !0 };
  if (e.workers !== !1 && Qe(n, e) && typeof Worker < "u") {
    if (!$) {
      const { createDecoderPool: t } = await Promise.resolve().then(() => bt);
      $ = await t(e);
    }
    if ($) return { decoder: $, viaWorker: !0 };
  }
  return { decoder: await Je(e), viaWorker: !1 };
}
function et(n, e) {
  return n ? {
    ...R,
    ...n,
    channels: O(n.channels, e),
    gpu: { ...R.gpu, ...n.gpu },
    image: { ...R.image, ...n.image }
  } : R;
}
async function tt(n, e = {}) {
  const t = e.label ?? nt(n), r = [], i = { file: null, label: t, report: (u) => r.push(u) }, s = et(e.format, i), { decoder: a, viaWorker: o } = await qe(n, e), l = o ? n : await Xe(n, e), { id: c, meta: h } = await a.open(l, {
    blockSize: e.blockSize,
    cacheBytes: e.cacheBytes,
    signal: e.signal,
    label: t
  }), f = new Ge({
    decoder: a,
    id: c,
    meta: h,
    options: { ...e, label: t, format: s },
    diagnostics: r
  });
  return e.onWarning && (f.onWarning(e.onWarning), a.flushWarnings?.()), f;
}
function nt(n) {
  if (typeof n == "string" || n instanceof URL)
    try {
      const e = new URL(String(n), "http://localhost/").pathname;
      return decodeURIComponent(e.split("/").filter(Boolean).pop() ?? "") || String(n);
    } catch {
      return String(n);
    }
  return typeof n?.name == "string" && n.name ? n.name : null;
}
const rt = 1, E = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, _ = {
  UINT: 1,
  INT: 2,
  FLOAT: 3,
  UNDEFINED: 4,
  COMPLEX_INT: 5,
  COMPLEX_FLOAT: 6
};
function N(n, e, t) {
  if (n == null) return t;
  if (Array.isArray(n) || ArrayBuffer.isView(n)) {
    if (n.length === 0) return t;
    const r = e < n.length ? n[e] : n[0];
    return r ?? t;
  }
  return n;
}
function At(n) {
  const e = n || {}, t = (r) => r == null ? null : Array.isArray(r) ? r.length ? r : null : ArrayBuffer.isView(r) ? r.length ? Array.from(r) : null : [r];
  return {
    sMinSampleValue: t(e.SMinSampleValue),
    sMaxSampleValue: t(e.SMaxSampleValue)
  };
}
function C(n, e, t, r) {
  const i = N(n.sMinSampleValue, e, null), s = N(n.sMaxSampleValue, e, null);
  if (i === null || s === null) return null;
  const a = Number(i), o = Number(s);
  return !Number.isFinite(a) || !Number.isFinite(o) || o <= a || t !== null && (a < t || o > r) ? null : { min: a, max: o };
}
function le(n, e) {
  return e ? [-Math.pow(2, n - 1), Math.pow(2, n - 1) - 1] : [0, Math.pow(2, n) - 1];
}
function Tt(n) {
  const e = n || {}, t = e.bitsPerSample, r = e.sampleFormat;
  let i = e.samplesPerPixel;
  i > 0 || (i = Array.isArray(t) || ArrayBuffer.isView(t) ? t.length : 1), i = Math.max(1, i | 0);
  const s = [];
  for (let a = 0; a < i; a++) {
    const o = N(t, a, 8) || 8, l = N(r, a, _.UINT) || _.UINT;
    let c, h = 0, f = !1;
    switch (l) {
      case _.UINT: {
        const u = C(e, a, ...le(o, !1));
        u ? (c = u.max - u.min, h = u.min) : c = Math.pow(2, o) - 1;
        break;
      }
      case _.INT: {
        const u = C(e, a, ...le(o, !0));
        u ? (c = u.max - u.min, h = u.min) : (c = Math.pow(2, o - 1) - 1, f = !0);
        break;
      }
      case _.FLOAT: {
        const u = C(e, a, null, null);
        u ? (c = u.max - u.min, h = u.min) : (c = 1, f = !0);
        break;
      }
      default:
        throw new Error(
          `[web-tiff] Unsupported SampleFormat ${l} on channel ${a}; only 1 (unsigned int), 2 (signed int) and 3 (float) are supported.`
        );
    }
    c > 0 || (c = 1), s.push({ scale: c, offset: h, signed: f, bits: o, sampleFormat: l });
  }
  return { version: rt, channels: s };
}
const ce = Object.freeze({
  scale: 1,
  offset: 0,
  signed: !1,
  bits: 8,
  sampleFormat: _.UINT
});
function st(n, e, t) {
  const r = n && n.channels || [], i = r[e];
  return i ?? (r.length === 0 || ge(
    new P({
      code: `encoding_channel_${e}_of_${r.length}`,
      message: `[web-tiff] Channel ${e} has no entry in this read's encoding table, which has ${r.length}; an identity transform was used. For a stacked read that count is every plane's channels combined, not one directory's SamplesPerPixel.`,
      file: t?.file ?? null,
      label: t?.label ?? null
    }),
    t
  ), ce);
}
function it(n, e) {
  if (n == null) return 0;
  const t = Number(n);
  return Number.isNaN(t) ? 0 : (t - e.offset) / e.scale;
}
function Et(n, e) {
  const t = it(n, e);
  return t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
}
function ot(n) {
  return n.bits === 8 && (n.sampleFormat === _.UINT || n.sampleFormat === _.INT);
}
function St(n) {
  return n.bits === 8 && n.sampleFormat === _.UINT && n.scale === 255 && n.offset === 0;
}
function Pt(n, e, t) {
  const r = n || {}, i = r.photometricInterpretation, s = r.encoding;
  if (i === E.Palette && r.hasColorMap) return "image";
  const a = r.samplesPerPixel || s && s.channels.length || 1;
  return (i === E.RGB || i === E.YCbCr || i === E.CMYK || i === E.CIELab || (i === E.BlackIsZero || i === E.WhiteIsZero) && a === 1) && (Array.isArray(e) && e.length ? e.filter((h) => h != null && h >= 0) : s.channels.map((h, f) => f)).every(
    (h) => ot(st(s, h, t))
  ) ? "image" : "data";
}
const It = "0.1.0", he = /\.(tiff?|qptiff|btf|svs|ndpi|scn)(\?|#|$)/i;
function at(n, e = {}) {
  let t = 0;
  class r extends n.TileSource {
    constructor(s, a = {}) {
      const o = typeof s == "object" && s !== null ? { ...s } : {}, l = typeof s == "string" ? s : o.url ?? s;
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
    async #e(s) {
      try {
        const a = await tt(s, this._options);
        this._file = a;
        const o = a.levels, l = o[o.length - 1];
        this.width = l.width, this.height = l.height, this.aspectRatio = this.width / this.height, this.dimensions = new n.Point(this.width, this.height), this.tileOverlap = 0, this.minLevel = 0, this.maxLevel = o.length - 1, this.levels = o, this.tileWidth = o[0].tileWidth, this.tileHeight = o[0].tileHeight, this.ready = !0, this._ready = !0, this.promises.ready.resolve(this), this.raiseEvent("ready", { tileSource: this });
      } catch (a) {
        this.promises.ready.reject(a), this.raiseEvent("open-failed", { message: a.message, source: s });
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
    supports(s, a) {
      if (s?.type && /^(web|geo)?tiff$/i.test(s.type) || typeof s == "string" && he.test(s) || typeof a == "string" && he.test(a)) return !0;
      const o = s instanceof ArrayBuffer ? new Uint8Array(s) : ArrayBuffer.isView(s) ? new Uint8Array(s.buffer, s.byteOffset, s.byteLength) : null;
      if (o && o.length >= 4) {
        const l = o[0] === 73 && o[1] === 73, c = o[0] === 77 && o[1] === 77;
        if (l || c) {
          const h = l ? o[2] | o[3] << 8 : o[2] << 8 | o[3];
          return h === 42 || h === 43;
        }
      }
      return !1;
    }
    configure(s, a) {
      return typeof s == "string" ? { url: s } : { ...s, url: s.url ?? a };
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
    _decoderLevel(s) {
      return this.levels.length - 1 - (this.maxLevel - s);
    }
    getTileWidth(s) {
      return this.levels?.[this._decoderLevel(s)]?.tileWidth;
    }
    getTileHeight(s) {
      return this.levels?.[this._decoderLevel(s)]?.tileHeight;
    }
    getLevelScale(s) {
      const a = this.levels, o = this._decoderLevel(s);
      return a?.[o] ? a[o].width / a[a.length - 1].width : NaN;
    }
    /**
     * Per-instance so two sources over one file keep separate cache entries.
     *
     * Deliberately keyed by the OSD level, not the decoder level: an inserted
     * level and the level it displaced are different pictures and must not share
     * a cache entry.
     */
    getTileHashKey(s, a, o) {
      return `webtiff${this._instance}_${s}_${a}_${o}`;
    }
    /** Never fetched; it is only the identity string for the download request. */
    getTileUrl(s, a, o) {
      return `${s}/${a}_${o}`;
    }
    downloadTileStart(s) {
      const a = new AbortController();
      s.userData.abortController = a;
      const o = s.tile;
      this._file.readTile(this._decoderLevel(o.level), o.x, o.y, {
        output: "rgba8",
        signal: a.signal
      }).then(async ({ header: l, packs: c }) => {
        const h = new ImageData(
          new Uint8ClampedArray(c[0].data.buffer),
          l.width,
          l.height
        ), f = await createImageBitmap(h);
        s.finish(f, `${s.src}`, "imageBitmap");
      }).catch((l) => {
        l?.name !== "AbortError" && s.fail(l.message, l);
      });
    }
    downloadTileAbort(s) {
      s.userData.abortController?.abort();
    }
    destroy() {
      this._file?.close(), this._file = null;
    }
  }
  return r;
}
function kt(n, e = {}) {
  if (!n?.TileSource)
    throw new TypeError("enableWebTiff needs the OpenSeadragon namespace");
  const t = n.version?.major ?? 0;
  if (t && t < 6)
    throw new Error(
      `web-tiff needs OpenSeadragon 6 or newer (found ${n.version.versionStr}). Use the geotiff-tilesource package for OpenSeadragon 4 and 5.`
    );
  if (n.WebTiffTileSource) return n.WebTiffTileSource;
  const r = at(n, e);
  return n.WebTiffTileSource = r, r;
}
const lt = /* @__PURE__ */ new Set([408, 429, 500, 502, 503, 504]);
class ct {
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
    headers: r = {},
    credentials: i,
    captureErrorBody: s = !1
  } = {}) {
    this.#e = String(e), this.#t = t ?? globalThis.fetch.bind(globalThis), this.#r = r, this.#s = i, this.#i = s;
  }
  get url() {
    return this.#e;
  }
  async #l(e, t) {
    const r = { ...this.#r };
    e && (r.Range = `bytes=${e.start}-${e.end - 1}`);
    let i;
    try {
      i = await this.#t(this.#e, {
        headers: r,
        signal: t,
        credentials: this.#s
      });
    } catch (s) {
      throw s?.name === "AbortError" ? s : new U(`[web-tiff] cannot reach ${this.#e}: ${s.message}`, {
        url: this.#e,
        range: e,
        cause: s
      });
    }
    if (!i.ok) {
      let s = null;
      if (this.#i)
        try {
          const a = await i.clone().text();
          s = a.replace(/\s+/g, " ").slice(0, 200), a.length > 200 && (s += "...");
        } catch {
        }
      throw new U(
        `[web-tiff] HTTP ${i.status} for ${this.#e}${s ? `: ${s}` : ""}`,
        {
          status: i.status,
          statusText: i.statusText,
          url: this.#e,
          range: e,
          body: s
        }
      );
    }
    return i;
  }
  async #c(e, t) {
    try {
      return await this.#l(e, t);
    } catch (r) {
      if (r?.name === "AbortError" || !(r.status == null || lt.has(r.status))) throw r;
      return await new Promise((s) => setTimeout(s, 250)), this.#l(e, t);
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
      const s = new Uint8Array(await t.arrayBuffer());
      return this.#o = s, this.#n = s.length, this.#n;
    }
    const r = t.headers.get("Content-Range"), i = r ? Number(r.split("/")[1]) : NaN;
    if (!Number.isFinite(i))
      throw new U(
        `[web-tiff] ${this.#e} answered a range request without a usable Content-Range; the server must support byte ranges`,
        { status: t.status, url: this.#e }
      );
    return this.#n = i, this.#h = new Uint8Array(await t.arrayBuffer()), i;
  }
  #h = null;
  async read(e, t, r) {
    this.#n == null && await this.getSize(r);
    const i = Math.min(e, this.#n), s = Math.min(e + t, this.#n);
    if (s <= i) return new Uint8Array(0);
    if (this.#o) return this.#o.subarray(i, s);
    if (this.#h && s <= this.#h.length)
      return this.#h.subarray(i, s);
    const a = `${i}-${s}`, o = this.#a.get(a);
    if (o) return o;
    const l = this.#c({ start: i, end: s }, r).then(async (c) => new Uint8Array(await c.arrayBuffer())).finally(() => this.#a.delete(a));
    return this.#a.set(a, l), l;
  }
}
const ht = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  HttpSource: ct
}, Symbol.toStringTag, { value: "Module" })), I = {
  INIT: "init",
  OPEN: "open",
  READ: "read",
  CLOSE: "close",
  ABORT: "abort"
}, fe = {
  READY: "ready",
  WARN: "warn"
};
function ft(n, e = {}) {
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
const ut = "./decode.worker.mjs";
function dt() {
  const n = new URL(ut, import.meta.url);
  return new Worker(n, { type: "module" });
}
function pt() {
  const n = globalThis.navigator?.hardwareConcurrency ?? 4;
  return Math.min(4, Math.max(1, Math.ceil(n / 2)));
}
const gt = 32;
function mt({ name: n, message: e, status: t, url: r, code: i }) {
  return n === "WebTiffHttpError" ? new U(e, { status: t, url: r }) : n === "WebTiffUnsupportedError" ? new me(e, { code: i }) : n === "AbortError" ? new DOMException(e, "AbortError") : new w(e, { code: i });
}
class wt {
  #e;
  #t = /* @__PURE__ */ new Map();
  #r = 1;
  ready;
  inFlight = 0;
  /**
   * Set by the pool once it owns this worker.
   *
   * Receives the raw WARN message, whose `file` is this worker's own file id.
   * Only the pool can turn that into the id the caller holds, so the translation
   * lives there rather than here.
   *
   * @type {((msg: object) => void) | undefined}
   */
  onWarning;
  constructor(e) {
    this.#e = e, this.ready = new Promise((t) => {
      const r = (i) => {
        i.data?.kind === fe.READY && (e.removeEventListener("message", r), t());
      };
      e.addEventListener("message", r);
    }), e.addEventListener("message", (t) => {
      const r = t.data;
      if (r?.kind === fe.WARN) {
        this.onWarning?.(r);
        return;
      }
      if (r?.kind) return;
      const i = this.#t.get(r.id);
      i && (this.#t.delete(r.id), this.inFlight--, r.ok ? i.resolve(r.result) : i.reject(mt(r.error)));
    }), e.addEventListener("error", (t) => {
      const r = new w(t.message ?? "decode worker failed");
      for (const [, i] of this.#t) i.reject(r);
      this.#t.clear(), this.inFlight = 0;
    });
  }
  send(e, t = []) {
    const r = this.#r++;
    return this.inFlight++, new Promise((i, s) => {
      this.#t.set(r, { resolve: i, reject: s }), this.#e.postMessage({ ...e, id: r }, t);
    });
  }
  terminate() {
    this.#e.terminate();
  }
}
class Se {
  #e = [];
  #t = /* @__PURE__ */ new Map();
  /** `${workerIndex}:${remoteId}` -> the caller's file id. */
  #r = /* @__PURE__ */ new Map();
  /** Warnings that arrived before that mapping existed, by the same key. */
  #s = /* @__PURE__ */ new Map();
  /** Mapped, waiting for a subscriber. Released by flushWarnings. */
  #i = [];
  #n = 1;
  #o = /* @__PURE__ */ new Set();
  constructor(e) {
    this.#e = e;
    for (const t of e) t.onWarning = (r) => this.#a(t, r);
  }
  /**
   * Subscribe to diagnostics from every file on this pool. Returns an
   * unsubscribe function.
   *
   * A set rather than one callback captured at construction: the pool is shared
   * and memoized across every `openTiff` call in the process, so a single slot
   * would keep the first caller's callback forever and silently drop the rest.
   *
   * @param {(d: Diagnostic) => void} fn
   * @returns {() => void}
   */
  onWarning(e) {
    return this.#o.add(e), () => this.#o.delete(e);
  }
  /** Retranslate a worker-local file id into the one the caller was given. */
  #a(e, t) {
    const r = `${this.#e.indexOf(e)}:${t.file}`;
    if (!this.#r.has(r)) {
      const i = this.#s.get(r) ?? [];
      i.length < gt && i.push(t), this.#s.set(r, i);
      return;
    }
    this.#l(new P({ ...t, file: this.#r.get(r) }));
  }
  #l(e) {
    for (const t of this.#o) t(e);
  }
  /**
   * Deliver what was raised while opening.
   *
   * The mirror of Decoder.flushWarnings, and called the same way: a caller
   * subscribes once it has the file id, and this hands over what could not be
   * delivered before that existed.
   */
  flushWarnings() {
    const e = this.#i;
    this.#i = [];
    for (const t of e) this.#l(t);
  }
  /** The least busy worker; ties go to the earliest, which keeps warm caches warm. */
  #c() {
    let e = this.#e[0];
    for (const t of this.#e) t.inFlight < e.inFlight && (e = t);
    return e;
  }
  async open(e, t = {}) {
    const { descriptor: r, transfer: i } = ft(e, t), s = this.#c(), { id: a, meta: o } = await s.send(
      { op: I.OPEN, src: r, options: t },
      i
    ), l = this.#n++, c = `${this.#e.indexOf(s)}:${a}`;
    this.#t.set(l, { worker: s, remoteId: a }), this.#r.set(c, l);
    const h = this.#s.get(c);
    if (h) {
      this.#s.delete(c);
      for (const f of h) this.#i.push(new P({ ...f, file: l }));
    }
    return { id: l, meta: o };
  }
  async read(e, t, { signal: r } = {}) {
    const i = this.#t.get(e);
    if (!i) throw new w(`unknown file ${e}`);
    const s = i.worker.send({ op: I.READ, file: i.remoteId, req: t });
    return r && r.addEventListener(
      "abort",
      () => i.worker.send({ op: I.ABORT, target: e }),
      { once: !0 }
    ), s;
  }
  close(e) {
    const t = this.#t.get(e);
    if (!t) return;
    t.worker.send({ op: I.CLOSE, file: t.remoteId }), this.#t.delete(e);
    const r = `${this.#e.indexOf(t.worker)}:${t.remoteId}`;
    this.#r.delete(r), this.#s.delete(r), this.#i = this.#i.filter((i) => i.file !== e);
  }
  terminate() {
    for (const e of this.#e) e.terminate();
    this.#e = [], this.#t.clear(), this.#r.clear(), this.#s.clear(), this.#i = [], this.#o.clear();
  }
}
async function yt(n = {}) {
  if (typeof Worker > "u") return null;
  const e = Ee(n), t = Te(e, n.wasmBaseUrl), r = n.size ?? pt(), i = n.createWorker ?? (n.workerUrl ? () => new Worker(n.workerUrl, { type: "module" }) : dt), s = [];
  for (let o = 0; o < r; o++) s.push(new wt(i()));
  await Promise.all(s.map((o) => o.ready)), await Promise.all(s.map((o) => o.send({ op: I.INIT, wasmUrl: t })));
  const a = new Se(s);
  return n.onWarning && a.onWarning(n.onWarning), a;
}
const bt = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  DecoderPool: Se,
  createDecoderPool: yt
}, Symbol.toStringTag, { value: "Module" }));
export {
  Ke as BlobSource,
  Ve as BytesSource,
  Fe as Decoder,
  P as Diagnostic,
  Q as MAX_CHANNELS,
  F as MAX_PLANES,
  E as PHOTOMETRIC,
  rt as SAMPLE_ENCODING_VERSION,
  _ as SAMPLE_FORMAT,
  Ge as TiffFile,
  It as VERSION,
  We as WebTiffAbortError,
  w as WebTiffDecodeError,
  b as WebTiffError,
  U as WebTiffHttpError,
  me as WebTiffUnsupportedError,
  De as buildLevels,
  st as channelEncodingAt,
  R as defaultFormat,
  kt as enableWebTiff,
  Pt as inferInterpretation,
  Ce as isCompanionPage,
  ot as isDisplayReadyChannel,
  St as isIdentityChannel,
  ne as looksLikeIFDPyramid,
  at as makeTileSource,
  O as normalizeChannels,
  ve as omeChannelsForPlanes,
  Me as omeColorToHex,
  Ie as onDiagnostic,
  tt as openTiff,
  _t as parseOmeChannels,
  M as planeKey,
  At as readSampleRangeTags,
  Oe as resolveLayout,
  Tt as resolveSampleEncoding,
  Et as sampleToByte,
  it as sampleToUnit,
  Ee as selectBuild,
  Xe as toSource
};
