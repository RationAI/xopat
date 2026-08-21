function C(t) {
  return (e, ...n) => Tt(t, e, n);
}
function $(t, e) {
  return C(
    ke(
      t,
      e
    ).get
  );
}
const {
  apply: Tt,
  getOwnPropertyDescriptor: ke,
  getPrototypeOf: ge,
  ownKeys: It
} = Reflect, {
  iterator: ee,
  toStringTag: St
} = Symbol, Bt = Object, {
  create: de,
  defineProperty: Pt
} = Bt, Ct = Array, Dt = Ct.prototype, _e = Dt[ee], Mt = C(_e), Le = ArrayBuffer, Gt = Le.prototype;
$(Gt, "byteLength");
const Ge = typeof SharedArrayBuffer < "u" ? SharedArrayBuffer : null;
Ge && $(Ge.prototype, "byteLength");
const Ve = ge(Uint8Array);
Ve.from;
const D = Ve.prototype;
D[ee];
C(D.keys);
C(
  D.values
);
C(
  D.entries
);
C(D.set);
C(
  D.reverse
);
C(D.fill);
C(
  D.copyWithin
);
C(D.sort);
C(D.slice);
C(
  D.subarray
);
$(
  D,
  "buffer"
);
$(
  D,
  "byteOffset"
);
$(
  D,
  "length"
);
$(
  D,
  St
);
const Ft = Uint8Array, Ke = Uint16Array, pe = Uint32Array, Rt = Float32Array, Q = ge([][ee]()), je = C(Q.next), Ot = C(function* () {
}().next), Et = ge(Q), Ut = DataView.prototype, Nt = C(
  Ut.getUint16
), ye = WeakMap, ve = ye.prototype, Ye = C(ve.get), kt = C(ve.set), $e = new ye(), _t = de(null, {
  next: {
    value: function() {
      const e = Ye($e, this);
      return je(e);
    }
  },
  [ee]: {
    value: function() {
      return this;
    }
  }
});
function Lt(t) {
  if (t[ee] === _e && Q.next === je)
    return t;
  const e = de(_t);
  return kt($e, e, Mt(t)), e;
}
const Vt = new ye(), Kt = de(Et, {
  next: {
    value: function() {
      const e = Ye(Vt, this);
      return Ot(e);
    },
    writable: !0,
    configurable: !0
  }
});
for (const t of It(Q))
  t !== "next" && Pt(Kt, t, ke(Q, t));
const Xe = new Le(4), jt = new Rt(Xe), vt = new pe(Xe), E = new Ke(512), U = new Ft(512);
for (let t = 0; t < 256; ++t) {
  const e = t - 127;
  e < -24 ? (E[t] = 0, E[t | 256] = 32768, U[t] = 24, U[t | 256] = 24) : e < -14 ? (E[t] = 1024 >> -e - 14, E[t | 256] = 1024 >> -e - 14 | 32768, U[t] = -e - 1, U[t | 256] = -e - 1) : e <= 15 ? (E[t] = e + 15 << 10, E[t | 256] = e + 15 << 10 | 32768, U[t] = 13, U[t | 256] = 13) : e < 128 ? (E[t] = 31744, E[t | 256] = 64512, U[t] = 24, U[t | 256] = 24) : (E[t] = 31744, E[t | 256] = 64512, U[t] = 13, U[t | 256] = 13);
}
const me = new pe(2048);
for (let t = 1; t < 1024; ++t) {
  let e = t << 13, n = 0;
  for (; !(e & 8388608); )
    e <<= 1, n -= 8388608;
  e &= -8388609, n += 947912704, me[t] = e | n;
}
for (let t = 1024; t < 2048; ++t)
  me[t] = 939524096 + (t - 1024 << 13);
const X = new pe(64);
for (let t = 1; t < 31; ++t)
  X[t] = t << 23;
X[31] = 1199570944;
X[32] = 2147483648;
for (let t = 33; t < 63; ++t)
  X[t] = 2147483648 + (t - 32 << 23);
X[63] = 3347054592;
const Ze = new Ke(64);
for (let t = 1; t < 64; ++t)
  t !== 32 && (Ze[t] = 1024);
function Yt(t) {
  const e = t >> 10;
  return vt[0] = me[Ze[e] + (t & 1023)] + X[e], jt[0];
}
function ze(t, e, ...n) {
  return Yt(
    Nt(t, e, ...Lt(n))
  );
}
function qe(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var xe = { exports: {} };
function He(t, e, n) {
  const r = n && n.debug || !1;
  r && console.log("[xml-utils] getting " + e + " in " + t);
  const i = typeof t == "object" ? t.outer : t, o = i.slice(0, i.indexOf(">") + 1), a = ['"', "'"];
  for (let s = 0; s < a.length; s++) {
    const l = a[s], c = e + "\\=" + l + "([^" + l + "]*)" + l;
    r && console.log("[xml-utils] pattern:", c);
    const f = new RegExp(c).exec(o);
    if (r && console.log("[xml-utils] match:", f), f) return f[1];
  }
}
xe.exports = He;
xe.exports.default = He;
var $t = xe.exports, ae = /* @__PURE__ */ qe($t), we = { exports: {} }, be = { exports: {} }, Ae = { exports: {} };
function Je(t, e, n) {
  const i = new RegExp(e).exec(t.slice(n));
  return i ? n + i.index : -1;
}
Ae.exports = Je;
Ae.exports.default = Je;
var Xt = Ae.exports, Te = { exports: {} };
function Qe(t, e, n) {
  const i = new RegExp(e).exec(t.slice(n));
  return i ? n + i.index + i[0].length - 1 : -1;
}
Te.exports = Qe;
Te.exports.default = Qe;
var Zt = Te.exports, Ie = { exports: {} };
function We(t, e) {
  const n = new RegExp(e, "g"), r = t.match(n);
  return r ? r.length : 0;
}
Ie.exports = We;
Ie.exports.default = We;
var zt = Ie.exports;
const qt = Xt, le = Zt, Fe = zt;
function et(t, e, n) {
  const r = n && n.debug || !1, i = !(n && typeof n.nested === !1), o = n && n.startIndex || 0;
  r && console.log("[xml-utils] starting findTagByName with", e, " and ", n);
  const a = qt(t, `<${e}[ 
>/]`, o);
  if (r && console.log("[xml-utils] start:", a), a === -1) return;
  const s = t.slice(a + e.length);
  let l = le(s, "^[^<]*[ /]>", 0);
  const c = l !== -1 && s[l - 1] === "/";
  if (r && console.log("[xml-utils] selfClosing:", c), c === !1)
    if (i) {
      let d = 0, g = 1, y = 0;
      for (; (l = le(s, "[ /]" + e + ">", d)) !== -1; ) {
        const h = s.substring(d, l + 1);
        if (g += Fe(h, "<" + e + `[ 
	>]`), y += Fe(h, "</" + e + ">"), y >= g) break;
        d = l;
      }
    } else
      l = le(s, "[ /]" + e + ">", 0);
  const u = a + e.length + l + 1;
  if (r && console.log("[xml-utils] end:", u), u === -1) return;
  const f = t.slice(a, u);
  let p;
  return c ? p = null : p = f.slice(f.indexOf(">") + 1, f.lastIndexOf("<")), { inner: p, outer: f, start: a, end: u };
}
be.exports = et;
be.exports.default = et;
var Ht = be.exports;
const Jt = Ht;
function tt(t, e, n) {
  const r = [], i = n && n.debug || !1, o = n && typeof n.nested == "boolean" ? n.nested : !0;
  let a = n && n.startIndex || 0, s;
  for (; s = Jt(t, e, { debug: i, startIndex: a }); )
    o ? a = s.start + 1 + e.length : a = s.end, r.push(s);
  return i && console.log("findTagsByName found", r.length, "tags"), r;
}
we.exports = tt;
we.exports.default = tt;
var Qt = we.exports, Wt = /* @__PURE__ */ qe(Qt);
const J = {
  // TIFF Baseline
  315: "Artist",
  258: "BitsPerSample",
  265: "CellLength",
  264: "CellWidth",
  320: "ColorMap",
  259: "Compression",
  33432: "Copyright",
  306: "DateTime",
  338: "ExtraSamples",
  266: "FillOrder",
  289: "FreeByteCounts",
  288: "FreeOffsets",
  291: "GrayResponseCurve",
  290: "GrayResponseUnit",
  316: "HostComputer",
  270: "ImageDescription",
  257: "ImageLength",
  256: "ImageWidth",
  271: "Make",
  281: "MaxSampleValue",
  280: "MinSampleValue",
  272: "Model",
  254: "NewSubfileType",
  274: "Orientation",
  262: "PhotometricInterpretation",
  284: "PlanarConfiguration",
  296: "ResolutionUnit",
  278: "RowsPerStrip",
  277: "SamplesPerPixel",
  305: "Software",
  279: "StripByteCounts",
  273: "StripOffsets",
  255: "SubfileType",
  263: "Threshholding",
  282: "XResolution",
  283: "YResolution",
  // TIFF Extended
  326: "BadFaxLines",
  327: "CleanFaxData",
  343: "ClipPath",
  328: "ConsecutiveBadFaxLines",
  433: "Decode",
  434: "DefaultImageColor",
  269: "DocumentName",
  336: "DotRange",
  321: "HalftoneHints",
  346: "Indexed",
  347: "JPEGTables",
  285: "PageName",
  297: "PageNumber",
  317: "Predictor",
  319: "PrimaryChromaticities",
  532: "ReferenceBlackWhite",
  339: "SampleFormat",
  340: "SMinSampleValue",
  341: "SMaxSampleValue",
  559: "StripRowCounts",
  330: "SubIFDs",
  292: "T4Options",
  293: "T6Options",
  325: "TileByteCounts",
  323: "TileLength",
  324: "TileOffsets",
  322: "TileWidth",
  301: "TransferFunction",
  318: "WhitePoint",
  344: "XClipPathUnits",
  286: "XPosition",
  529: "YCbCrCoefficients",
  531: "YCbCrPositioning",
  530: "YCbCrSubSampling",
  345: "YClipPathUnits",
  287: "YPosition",
  // EXIF
  37378: "ApertureValue",
  40961: "ColorSpace",
  36868: "DateTimeDigitized",
  36867: "DateTimeOriginal",
  34665: "Exif IFD",
  36864: "ExifVersion",
  33434: "ExposureTime",
  41728: "FileSource",
  37385: "Flash",
  40960: "FlashpixVersion",
  33437: "FNumber",
  42016: "ImageUniqueID",
  37384: "LightSource",
  37500: "MakerNote",
  37377: "ShutterSpeedValue",
  37510: "UserComment",
  // IPTC
  33723: "IPTC",
  // ICC
  34675: "ICC Profile",
  // XMP
  700: "XMP",
  // GDAL
  42112: "GDAL_METADATA",
  42113: "GDAL_NODATA",
  // Photoshop
  34377: "Photoshop",
  // GeoTiff
  33550: "ModelPixelScale",
  33922: "ModelTiepoint",
  34264: "ModelTransformation",
  34735: "GeoKeyDirectory",
  34736: "GeoDoubleParams",
  34737: "GeoAsciiParams",
  // LERC
  50674: "LercParameters"
}, N = {};
for (const t in J)
  J.hasOwnProperty(t) && (N[J[t]] = parseInt(t, 10));
const en = [
  N.BitsPerSample,
  N.ExtraSamples,
  N.SampleFormat,
  N.StripByteCounts,
  N.StripOffsets,
  N.StripRowCounts,
  N.TileByteCounts,
  N.TileOffsets,
  N.SubIFDs
], ce = {
  1: "BYTE",
  2: "ASCII",
  3: "SHORT",
  4: "LONG",
  5: "RATIONAL",
  6: "SBYTE",
  7: "UNDEFINED",
  8: "SSHORT",
  9: "SLONG",
  10: "SRATIONAL",
  11: "FLOAT",
  12: "DOUBLE",
  // IFD offset, suggested by https://owl.phy.queensu.ca/~phil/exiftool/standards.html
  13: "IFD",
  // introduced by BigTIFF
  16: "LONG8",
  17: "SLONG8",
  18: "IFD8"
}, w = {};
for (const t in ce)
  ce.hasOwnProperty(t) && (w[ce[t]] = parseInt(t, 10));
const R = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, tn = {
  Unspecified: 0
}, Xn = {
  AddCompression: 1
}, Zn = {
  None: 0,
  Deflate: 1,
  Zstandard: 2
}, nn = {
  1024: "GTModelTypeGeoKey",
  1025: "GTRasterTypeGeoKey",
  1026: "GTCitationGeoKey",
  2048: "GeographicTypeGeoKey",
  2049: "GeogCitationGeoKey",
  2050: "GeogGeodeticDatumGeoKey",
  2051: "GeogPrimeMeridianGeoKey",
  2052: "GeogLinearUnitsGeoKey",
  2053: "GeogLinearUnitSizeGeoKey",
  2054: "GeogAngularUnitsGeoKey",
  2055: "GeogAngularUnitSizeGeoKey",
  2056: "GeogEllipsoidGeoKey",
  2057: "GeogSemiMajorAxisGeoKey",
  2058: "GeogSemiMinorAxisGeoKey",
  2059: "GeogInvFlatteningGeoKey",
  2060: "GeogAzimuthUnitsGeoKey",
  2061: "GeogPrimeMeridianLongGeoKey",
  2062: "GeogTOWGS84GeoKey",
  3072: "ProjectedCSTypeGeoKey",
  3073: "PCSCitationGeoKey",
  3074: "ProjectionGeoKey",
  3075: "ProjCoordTransGeoKey",
  3076: "ProjLinearUnitsGeoKey",
  3077: "ProjLinearUnitSizeGeoKey",
  3078: "ProjStdParallel1GeoKey",
  3079: "ProjStdParallel2GeoKey",
  3080: "ProjNatOriginLongGeoKey",
  3081: "ProjNatOriginLatGeoKey",
  3082: "ProjFalseEastingGeoKey",
  3083: "ProjFalseNorthingGeoKey",
  3084: "ProjFalseOriginLongGeoKey",
  3085: "ProjFalseOriginLatGeoKey",
  3086: "ProjFalseOriginEastingGeoKey",
  3087: "ProjFalseOriginNorthingGeoKey",
  3088: "ProjCenterLongGeoKey",
  3089: "ProjCenterLatGeoKey",
  3090: "ProjCenterEastingGeoKey",
  3091: "ProjCenterNorthingGeoKey",
  3092: "ProjScaleAtNatOriginGeoKey",
  3093: "ProjScaleAtCenterGeoKey",
  3094: "ProjAzimuthAngleGeoKey",
  3095: "ProjStraightVertPoleLongGeoKey",
  3096: "ProjRectifiedGridAngleGeoKey",
  4096: "VerticalCSTypeGeoKey",
  4097: "VerticalCitationGeoKey",
  4098: "VerticalDatumGeoKey",
  4099: "VerticalUnitsGeoKey"
};
function rn(t, e) {
  const { width: n, height: r } = t, i = new Uint8Array(n * r * 3);
  let o;
  for (let a = 0, s = 0; a < t.length; ++a, s += 3)
    o = 256 - t[a] / e * 256, i[s] = o, i[s + 1] = o, i[s + 2] = o;
  return i;
}
function on(t, e) {
  const { width: n, height: r } = t, i = new Uint8Array(n * r * 3);
  let o;
  for (let a = 0, s = 0; a < t.length; ++a, s += 3)
    o = t[a] / e * 256, i[s] = o, i[s + 1] = o, i[s + 2] = o;
  return i;
}
function sn(t, e) {
  const { width: n, height: r } = t, i = new Uint8Array(n * r * 3), o = e.length / 3, a = e.length / 3 * 2;
  for (let s = 0, l = 0; s < t.length; ++s, l += 3) {
    const c = t[s];
    i[l] = e[c] / 65536 * 256, i[l + 1] = e[c + o] / 65536 * 256, i[l + 2] = e[c + a] / 65536 * 256;
  }
  return i;
}
function an(t) {
  const { width: e, height: n } = t, r = new Uint8Array(e * n * 3);
  for (let i = 0, o = 0; i < t.length; i += 4, o += 3) {
    const a = t[i], s = t[i + 1], l = t[i + 2], c = t[i + 3];
    r[o] = 255 * ((255 - a) / 256) * ((255 - c) / 256), r[o + 1] = 255 * ((255 - s) / 256) * ((255 - c) / 256), r[o + 2] = 255 * ((255 - l) / 256) * ((255 - c) / 256);
  }
  return r;
}
function ln(t) {
  const { width: e, height: n } = t, r = new Uint8ClampedArray(e * n * 3);
  for (let i = 0, o = 0; i < t.length; i += 3, o += 3) {
    const a = t[i], s = t[i + 1], l = t[i + 2];
    r[o] = a + 1.402 * (l - 128), r[o + 1] = a - 0.34414 * (s - 128) - 0.71414 * (l - 128), r[o + 2] = a + 1.772 * (s - 128);
  }
  return r;
}
const cn = 0.95047, fn = 1, un = 1.08883;
function hn(t) {
  const { width: e, height: n } = t, r = new Uint8Array(e * n * 3);
  for (let i = 0, o = 0; i < t.length; i += 3, o += 3) {
    const a = t[i + 0], s = t[i + 1] << 24 >> 24, l = t[i + 2] << 24 >> 24;
    let c = (a + 16) / 116, u = s / 500 + c, f = c - l / 200, p, d, g;
    u = cn * (u * u * u > 8856e-6 ? u * u * u : (u - 16 / 116) / 7.787), c = fn * (c * c * c > 8856e-6 ? c * c * c : (c - 16 / 116) / 7.787), f = un * (f * f * f > 8856e-6 ? f * f * f : (f - 16 / 116) / 7.787), p = u * 3.2406 + c * -1.5372 + f * -0.4986, d = u * -0.9689 + c * 1.8758 + f * 0.0415, g = u * 0.0557 + c * -0.204 + f * 1.057, p = p > 31308e-7 ? 1.055 * p ** (1 / 2.4) - 0.055 : 12.92 * p, d = d > 31308e-7 ? 1.055 * d ** (1 / 2.4) - 0.055 : 12.92 * d, g = g > 31308e-7 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g, r[o] = Math.max(0, Math.min(1, p)) * 255, r[o + 1] = Math.max(0, Math.min(1, d)) * 255, r[o + 2] = Math.max(0, Math.min(1, g)) * 255;
  }
  return r;
}
const nt = /* @__PURE__ */ new Map();
function K(t, e) {
  Array.isArray(t) || (t = [t]), t.forEach((n) => nt.set(n, e));
}
async function gn(t) {
  const e = nt.get(t.Compression);
  if (!e)
    throw new Error(`Unknown compression method identifier: ${t.Compression}`);
  const n = await e();
  return new n(t);
}
K([void 0, 1], () => import("./raw-CaSL8pVO.js").then((t) => t.default));
K(5, () => import("./lzw-DQ6ibF74.js").then((t) => t.default));
K(6, () => {
  throw new Error("old style JPEG compression is not supported.");
});
K(7, () => import("./jpeg-BpvZRbzr.js").then((t) => t.default));
K([8, 32946], () => import("./deflate-DARM-wVe.js").then((t) => t.default));
K(32773, () => import("./packbits-BuzK6gM3.js").then((t) => t.default));
K(
  34887,
  () => import("./lerc-D8ciyOV8.js").then(async (t) => (await t.zstd.init(), t)).then((t) => t.default)
);
K(50001, () => import("./webimage--SJddlky.js").then((t) => t.default));
function oe(t, e, n, r = 1) {
  return new (Object.getPrototypeOf(t)).constructor(e * n * r);
}
function dn(t, e, n, r, i) {
  const o = e / r, a = n / i;
  return t.map((s) => {
    const l = oe(s, r, i);
    for (let c = 0; c < i; ++c) {
      const u = Math.min(Math.round(a * c), n - 1);
      for (let f = 0; f < r; ++f) {
        const p = Math.min(Math.round(o * f), e - 1), d = s[u * e + p];
        l[c * r + f] = d;
      }
    }
    return l;
  });
}
function Y(t, e, n) {
  return (1 - n) * t + n * e;
}
function pn(t, e, n, r, i) {
  const o = e / r, a = n / i;
  return t.map((s) => {
    const l = oe(s, r, i);
    for (let c = 0; c < i; ++c) {
      const u = a * c, f = Math.floor(u), p = Math.min(Math.ceil(u), n - 1);
      for (let d = 0; d < r; ++d) {
        const g = o * d, y = g % 1, h = Math.floor(g), x = Math.min(Math.ceil(g), e - 1), m = s[f * e + h], b = s[f * e + x], T = s[p * e + h], I = s[p * e + x], B = Y(
          Y(m, b, y),
          Y(T, I, y),
          u % 1
        );
        l[c * r + d] = B;
      }
    }
    return l;
  });
}
function yn(t, e, n, r, i, o = "nearest") {
  switch (o.toLowerCase()) {
    case "nearest":
      return dn(t, e, n, r, i);
    case "bilinear":
    case "linear":
      return pn(t, e, n, r, i);
    default:
      throw new Error(`Unsupported resampling method: '${o}'`);
  }
}
function mn(t, e, n, r, i, o) {
  const a = e / r, s = n / i, l = oe(t, r, i, o);
  for (let c = 0; c < i; ++c) {
    const u = Math.min(Math.round(s * c), n - 1);
    for (let f = 0; f < r; ++f) {
      const p = Math.min(Math.round(a * f), e - 1);
      for (let d = 0; d < o; ++d) {
        const g = t[u * e * o + p * o + d];
        l[c * r * o + f * o + d] = g;
      }
    }
  }
  return l;
}
function xn(t, e, n, r, i, o) {
  const a = e / r, s = n / i, l = oe(t, r, i, o);
  for (let c = 0; c < i; ++c) {
    const u = s * c, f = Math.floor(u), p = Math.min(Math.ceil(u), n - 1);
    for (let d = 0; d < r; ++d) {
      const g = a * d, y = g % 1, h = Math.floor(g), x = Math.min(Math.ceil(g), e - 1);
      for (let m = 0; m < o; ++m) {
        const b = t[f * e * o + h * o + m], T = t[f * e * o + x * o + m], I = t[p * e * o + h * o + m], B = t[p * e * o + x * o + m], _ = Y(
          Y(b, T, y),
          Y(I, B, y),
          u % 1
        );
        l[c * r * o + d * o + m] = _;
      }
    }
  }
  return l;
}
function wn(t, e, n, r, i, o, a = "nearest") {
  switch (a.toLowerCase()) {
    case "nearest":
      return mn(
        t,
        e,
        n,
        r,
        i,
        o
      );
    case "bilinear":
    case "linear":
      return xn(
        t,
        e,
        n,
        r,
        i,
        o
      );
    default:
      throw new Error(`Unsupported resampling method: '${a}'`);
  }
}
function bn(t, e, n) {
  let r = 0;
  for (let i = e; i < n; ++i)
    r += t[i];
  return r;
}
function ue(t, e, n) {
  switch (t) {
    case 1:
      if (e <= 8)
        return new Uint8Array(n);
      if (e <= 16)
        return new Uint16Array(n);
      if (e <= 32)
        return new Uint32Array(n);
      break;
    case 2:
      if (e === 8)
        return new Int8Array(n);
      if (e === 16)
        return new Int16Array(n);
      if (e === 32)
        return new Int32Array(n);
      break;
    case 3:
      switch (e) {
        case 16:
        case 32:
          return new Float32Array(n);
        case 64:
          return new Float64Array(n);
      }
      break;
  }
  throw Error("Unsupported data format/bitsPerSample");
}
function An(t, e) {
  return (t === 1 || t === 2) && e <= 32 && e % 8 === 0 ? !1 : !(t === 3 && (e === 16 || e === 32 || e === 64));
}
function Tn(t, e, n, r, i, o, a) {
  const s = new DataView(t), l = n === 2 ? a * o : a * o * r, c = n === 2 ? 1 : r, u = ue(e, i, l), f = parseInt("1".repeat(i), 2);
  if (e === 1) {
    let p;
    n === 1 ? p = r * i : p = i;
    let d = o * p;
    d & 7 && (d = d + 7 & -8);
    for (let g = 0; g < a; ++g) {
      const y = g * d;
      for (let h = 0; h < o; ++h) {
        const x = y + h * c * i;
        for (let m = 0; m < c; ++m) {
          const b = x + m * i, T = (g * o + h) * c + m, I = Math.floor(b / 8), B = b % 8;
          if (B + i <= 8)
            u[T] = s.getUint8(I) >> 8 - i - B & f;
          else if (B + i <= 16)
            u[T] = s.getUint16(I) >> 16 - i - B & f;
          else if (B + i <= 24) {
            const _ = s.getUint16(I) << 8 | s.getUint8(I + 2);
            u[T] = _ >> 24 - i - B & f;
          } else
            u[T] = s.getUint32(I) >> 32 - i - B & f;
        }
      }
    }
  }
  return u.buffer;
}
class In {
  /**
   * @constructor
   * @param {Object} fileDirectory The parsed file directory
   * @param {Object} geoKeys The parsed geo-keys
   * @param {DataView} dataView The DataView for the underlying file.
   * @param {Boolean} littleEndian Whether the file is encoded in little or big endian
   * @param {Boolean} cache Whether or not decoded tiles shall be cached
   * @param {import('./source/basesource').BaseSource} source The datasource to read from
   */
  constructor(e, n, r, i, o, a) {
    this.fileDirectory = e, this.geoKeys = n, this.dataView = r, this.littleEndian = i, this.tiles = o ? {} : null, this.isTiled = !e.StripOffsets;
    const s = e.PlanarConfiguration;
    if (this.planarConfiguration = typeof s > "u" ? 1 : s, this.planarConfiguration !== 1 && this.planarConfiguration !== 2)
      throw new Error("Invalid planar configuration.");
    this.source = a;
  }
  /**
   * Returns the associated parsed file directory.
   * @returns {Object} the parsed file directory
   */
  getFileDirectory() {
    return this.fileDirectory;
  }
  /**
   * Returns the associated parsed geo keys.
   * @returns {Object} the parsed geo keys
   */
  getGeoKeys() {
    return this.geoKeys;
  }
  /**
   * Returns the width of the image.
   * @returns {Number} the width of the image
   */
  getWidth() {
    return this.fileDirectory.ImageWidth;
  }
  /**
   * Returns the height of the image.
   * @returns {Number} the height of the image
   */
  getHeight() {
    return this.fileDirectory.ImageLength;
  }
  /**
   * Returns the number of samples per pixel.
   * @returns {Number} the number of samples per pixel
   */
  getSamplesPerPixel() {
    return typeof this.fileDirectory.SamplesPerPixel < "u" ? this.fileDirectory.SamplesPerPixel : 1;
  }
  /**
   * Returns the width of each tile.
   * @returns {Number} the width of each tile
   */
  getTileWidth() {
    return this.isTiled ? this.fileDirectory.TileWidth : this.getWidth();
  }
  /**
   * Returns the height of each tile.
   * @returns {Number} the height of each tile
   */
  getTileHeight() {
    return this.isTiled ? this.fileDirectory.TileLength : typeof this.fileDirectory.RowsPerStrip < "u" ? Math.min(this.fileDirectory.RowsPerStrip, this.getHeight()) : this.getHeight();
  }
  getBlockWidth() {
    return this.getTileWidth();
  }
  getBlockHeight(e) {
    return this.isTiled || (e + 1) * this.getTileHeight() <= this.getHeight() ? this.getTileHeight() : this.getHeight() - e * this.getTileHeight();
  }
  /**
   * Calculates the number of bytes for each pixel across all samples. Only full
   * bytes are supported, an exception is thrown when this is not the case.
   * @returns {Number} the bytes per pixel
   */
  getBytesPerPixel() {
    let e = 0;
    for (let n = 0; n < this.fileDirectory.BitsPerSample.length; ++n)
      e += this.getSampleByteSize(n);
    return e;
  }
  getSampleByteSize(e) {
    if (e >= this.fileDirectory.BitsPerSample.length)
      throw new RangeError(`Sample index ${e} is out of range.`);
    return Math.ceil(this.fileDirectory.BitsPerSample[e] / 8);
  }
  getReaderForSample(e) {
    const n = this.fileDirectory.SampleFormat ? this.fileDirectory.SampleFormat[e] : 1, r = this.fileDirectory.BitsPerSample[e];
    switch (n) {
      case 1:
        if (r <= 8)
          return DataView.prototype.getUint8;
        if (r <= 16)
          return DataView.prototype.getUint16;
        if (r <= 32)
          return DataView.prototype.getUint32;
        break;
      case 2:
        if (r <= 8)
          return DataView.prototype.getInt8;
        if (r <= 16)
          return DataView.prototype.getInt16;
        if (r <= 32)
          return DataView.prototype.getInt32;
        break;
      case 3:
        switch (r) {
          case 16:
            return function(i, o) {
              return ze(this, i, o);
            };
          case 32:
            return DataView.prototype.getFloat32;
          case 64:
            return DataView.prototype.getFloat64;
        }
        break;
    }
    throw Error("Unsupported data format/bitsPerSample");
  }
  getSampleFormat(e = 0) {
    return this.fileDirectory.SampleFormat ? this.fileDirectory.SampleFormat[e] : 1;
  }
  getBitsPerSample(e = 0) {
    return this.fileDirectory.BitsPerSample[e];
  }
  getArrayForSample(e, n) {
    const r = this.getSampleFormat(e), i = this.getBitsPerSample(e);
    return ue(r, i, n);
  }
  /**
   * Returns the decoded strip or tile.
   * @param {Number} x the strip or tile x-offset
   * @param {Number} y the tile y-offset (0 for stripped images)
   * @param {Number} sample the sample to get for separated samples
   * @param {import("./geotiff").Pool|import("./geotiff").BaseDecoder} poolOrDecoder the decoder or decoder pool
   * @param {AbortSignal} [signal] An AbortSignal that may be signalled if the request is
   *                               to be aborted
   * @returns {Promise.<ArrayBuffer>}
   */
  async getTileOrStrip(e, n, r, i, o) {
    const a = Math.ceil(this.getWidth() / this.getTileWidth()), s = Math.ceil(this.getHeight() / this.getTileHeight());
    let l;
    const { tiles: c } = this;
    this.planarConfiguration === 1 ? l = n * a + e : this.planarConfiguration === 2 && (l = r * a * s + n * a + e);
    let u, f;
    this.isTiled ? (u = this.fileDirectory.TileOffsets[l], f = this.fileDirectory.TileByteCounts[l]) : (u = this.fileDirectory.StripOffsets[l], f = this.fileDirectory.StripByteCounts[l]);
    const p = (await this.source.fetch([{ offset: u, length: f }], o))[0];
    let d;
    return c === null || !c[l] ? (d = (async () => {
      let g = await i.decode(this.fileDirectory, p);
      const y = this.getSampleFormat(), h = this.getBitsPerSample();
      return An(y, h) && (g = Tn(
        g,
        y,
        this.planarConfiguration,
        this.getSamplesPerPixel(),
        h,
        this.getTileWidth(),
        this.getBlockHeight(n)
      )), g;
    })(), c !== null && (c[l] = d)) : d = c[l], { x: e, y: n, sample: r, data: await d };
  }
  /**
   * Internal read function.
   * @private
   * @param {Array} imageWindow The image window in pixel coordinates
   * @param {Array} samples The selected samples (0-based indices)
   * @param {TypedArray|TypedArray[]} valueArrays The array(s) to write into
   * @param {Boolean} interleave Whether or not to write in an interleaved manner
   * @param {import("./geotiff").Pool|AbstractDecoder} poolOrDecoder the decoder or decoder pool
   * @param {number} width the width of window to be read into
   * @param {number} height the height of window to be read into
   * @param {number} resampleMethod the resampling method to be used when interpolating
   * @param {AbortSignal} [signal] An AbortSignal that may be signalled if the request is
   *                               to be aborted
   * @returns {Promise<ReadRasterResult>}
   */
  async _readRaster(e, n, r, i, o, a, s, l, c) {
    const u = this.getTileWidth(), f = this.getTileHeight(), p = this.getWidth(), d = this.getHeight(), g = Math.max(Math.floor(e[0] / u), 0), y = Math.min(
      Math.ceil(e[2] / u),
      Math.ceil(p / u)
    ), h = Math.max(Math.floor(e[1] / f), 0), x = Math.min(
      Math.ceil(e[3] / f),
      Math.ceil(d / f)
    ), m = e[2] - e[0];
    let b = this.getBytesPerPixel();
    const T = [], I = [];
    for (let A = 0; A < n.length; ++A)
      this.planarConfiguration === 1 ? T.push(bn(this.fileDirectory.BitsPerSample, 0, n[A]) / 8) : T.push(0), I.push(this.getReaderForSample(n[A]));
    const B = [], { littleEndian: _ } = this;
    for (let A = h; A < x; ++A)
      for (let S = g; S < y; ++S) {
        let P;
        this.planarConfiguration === 1 && (P = this.getTileOrStrip(S, A, 0, o, c));
        for (let M = 0; M < n.length; ++M) {
          const G = M, De = n[M];
          this.planarConfiguration === 2 && (b = this.getSampleByteSize(De), P = this.getTileOrStrip(S, A, De, o, c));
          const gt = P.then((Z) => {
            const dt = Z.data, pt = new DataView(dt), se = this.getBlockHeight(Z.y), z = Z.y * f, te = Z.x * u, yt = z + se, mt = (Z.x + 1) * u, xt = I[G], wt = Math.min(se, se - (yt - e[3]), d - z), bt = Math.min(u, u - (mt - e[2]), p - te);
            for (let q = Math.max(0, e[1] - z); q < wt; ++q)
              for (let H = Math.max(0, e[0] - te); H < bt; ++H) {
                const At = (q * u + H) * b, Me = xt.call(
                  pt,
                  At + T[G],
                  _
                );
                let ne;
                i ? (ne = (q + z - e[1]) * m * n.length + (H + te - e[0]) * n.length + G, r[ne] = Me) : (ne = (q + z - e[1]) * m + H + te - e[0], r[G][ne] = Me);
              }
          });
          B.push(gt);
        }
      }
    if (await Promise.all(B), a && e[2] - e[0] !== a || s && e[3] - e[1] !== s) {
      let A;
      return i ? A = wn(
        r,
        e[2] - e[0],
        e[3] - e[1],
        a,
        s,
        n.length,
        l
      ) : A = yn(
        r,
        e[2] - e[0],
        e[3] - e[1],
        a,
        s,
        l
      ), A.width = a, A.height = s, A;
    }
    return r.width = a || e[2] - e[0], r.height = s || e[3] - e[1], r;
  }
  /**
   * Reads raster data from the image. This function reads all selected samples
   * into separate arrays of the correct type for that sample or into a single
   * combined array when `interleave` is set. When provided, only a subset
   * of the raster is read for each sample.
   *
   * @param {ReadRasterOptions} [options={}] optional parameters
   * @returns {Promise<ReadRasterResult>} the decoded arrays as a promise
   */
  async readRasters({
    window: e,
    samples: n = [],
    interleave: r,
    pool: i = null,
    width: o,
    height: a,
    resampleMethod: s,
    fillValue: l,
    signal: c
  } = {}) {
    const u = e || [0, 0, this.getWidth(), this.getHeight()];
    if (u[0] > u[2] || u[1] > u[3])
      throw new Error("Invalid subsets");
    const f = u[2] - u[0], p = u[3] - u[1], d = f * p, g = this.getSamplesPerPixel();
    if (!n || !n.length)
      for (let m = 0; m < g; ++m)
        n.push(m);
    else
      for (let m = 0; m < n.length; ++m)
        if (n[m] >= g)
          return Promise.reject(new RangeError(`Invalid sample index '${n[m]}'.`));
    let y;
    if (r) {
      const m = this.fileDirectory.SampleFormat ? Math.max.apply(null, this.fileDirectory.SampleFormat) : 1, b = Math.max.apply(null, this.fileDirectory.BitsPerSample);
      y = ue(m, b, d * n.length), l && y.fill(l);
    } else {
      y = [];
      for (let m = 0; m < n.length; ++m) {
        const b = this.getArrayForSample(n[m], d);
        Array.isArray(l) && m < l.length ? b.fill(l[m]) : l && !Array.isArray(l) && b.fill(l), y.push(b);
      }
    }
    const h = i || await gn(this.fileDirectory);
    return await this._readRaster(
      u,
      n,
      y,
      r,
      h,
      o,
      a,
      s,
      c
    );
  }
  /**
   * Reads raster data from the image as RGB. The result is always an
   * interleaved typed array.
   * Colorspaces other than RGB will be transformed to RGB, color maps expanded.
   * When no other method is applicable, the first sample is used to produce a
   * grayscale image.
   * When provided, only a subset of the raster is read for each sample.
   *
   * @param {Object} [options] optional parameters
   * @param {Array<number>} [options.window] the subset to read data from in pixels.
   * @param {boolean} [options.interleave=true] whether the data shall be read
   *                                             in one single array or separate
   *                                             arrays.
   * @param {import("./geotiff").Pool} [options.pool=null] The optional decoder pool to use.
   * @param {number} [options.width] The desired width of the output. When the width is no the
   *                                 same as the images, resampling will be performed.
   * @param {number} [options.height] The desired height of the output. When the width is no the
   *                                  same as the images, resampling will be performed.
   * @param {string} [options.resampleMethod='nearest'] The desired resampling method.
   * @param {boolean} [options.enableAlpha=false] Enable reading alpha channel if present.
   * @param {AbortSignal} [options.signal] An AbortSignal that may be signalled if the request is
   *                                       to be aborted
   * @returns {Promise<ReadRasterResult>} the RGB array as a Promise
   */
  async readRGB({
    window: e,
    interleave: n = !0,
    pool: r = null,
    width: i,
    height: o,
    resampleMethod: a,
    enableAlpha: s = !1,
    signal: l
  } = {}) {
    const c = e || [0, 0, this.getWidth(), this.getHeight()];
    if (c[0] > c[2] || c[1] > c[3])
      throw new Error("Invalid subsets");
    const u = this.fileDirectory.PhotometricInterpretation;
    if (u === R.RGB) {
      let x = [0, 1, 2];
      if (this.fileDirectory.ExtraSamples !== tn.Unspecified && s) {
        x = [];
        for (let m = 0; m < this.fileDirectory.BitsPerSample.length; m += 1)
          x.push(m);
      }
      return this.readRasters({
        window: e,
        interleave: n,
        samples: x,
        pool: r,
        width: i,
        height: o,
        resampleMethod: a,
        signal: l
      });
    }
    let f;
    switch (u) {
      case R.WhiteIsZero:
      case R.BlackIsZero:
      case R.Palette:
        f = [0];
        break;
      case R.CMYK:
        f = [0, 1, 2, 3];
        break;
      case R.YCbCr:
      case R.CIELab:
        f = [0, 1, 2];
        break;
      default:
        throw new Error("Invalid or unsupported photometric interpretation.");
    }
    const p = {
      window: c,
      interleave: !0,
      samples: f,
      pool: r,
      width: i,
      height: o,
      resampleMethod: a,
      signal: l
    }, { fileDirectory: d } = this, g = await this.readRasters(p), y = 2 ** this.fileDirectory.BitsPerSample[0];
    let h;
    switch (u) {
      case R.WhiteIsZero:
        h = rn(g, y);
        break;
      case R.BlackIsZero:
        h = on(g, y);
        break;
      case R.Palette:
        h = sn(g, d.ColorMap);
        break;
      case R.CMYK:
        h = an(g);
        break;
      case R.YCbCr:
        h = ln(g);
        break;
      case R.CIELab:
        h = hn(g);
        break;
      default:
        throw new Error("Unsupported photometric interpretation.");
    }
    if (!n) {
      const x = new Uint8Array(h.length / 3), m = new Uint8Array(h.length / 3), b = new Uint8Array(h.length / 3);
      for (let T = 0, I = 0; T < h.length; T += 3, ++I)
        x[I] = h[T], m[I] = h[T + 1], b[I] = h[T + 2];
      h = [x, m, b];
    }
    return h.width = g.width, h.height = g.height, h;
  }
  /**
   * Returns an array of tiepoints.
   * @returns {Object[]}
   */
  getTiePoints() {
    if (!this.fileDirectory.ModelTiepoint)
      return [];
    const e = [];
    for (let n = 0; n < this.fileDirectory.ModelTiepoint.length; n += 6)
      e.push({
        i: this.fileDirectory.ModelTiepoint[n],
        j: this.fileDirectory.ModelTiepoint[n + 1],
        k: this.fileDirectory.ModelTiepoint[n + 2],
        x: this.fileDirectory.ModelTiepoint[n + 3],
        y: this.fileDirectory.ModelTiepoint[n + 4],
        z: this.fileDirectory.ModelTiepoint[n + 5]
      });
    return e;
  }
  /**
   * Returns the parsed GDAL metadata items.
   *
   * If sample is passed to null, dataset-level metadata will be returned.
   * Otherwise only metadata specific to the provided sample will be returned.
   *
   * @param {number} [sample=null] The sample index.
   * @returns {Object}
   */
  getGDALMetadata(e = null) {
    const n = {};
    if (!this.fileDirectory.GDAL_METADATA)
      return null;
    const r = this.fileDirectory.GDAL_METADATA;
    let i = Wt(r, "Item");
    e === null ? i = i.filter((o) => ae(o, "sample") === void 0) : i = i.filter((o) => Number(ae(o, "sample")) === e);
    for (let o = 0; o < i.length; ++o) {
      const a = i[o];
      n[ae(a, "name")] = a.inner;
    }
    return n;
  }
  /**
   * Returns the GDAL nodata value
   * @returns {number|null}
   */
  getGDALNoData() {
    if (!this.fileDirectory.GDAL_NODATA)
      return null;
    const e = this.fileDirectory.GDAL_NODATA;
    return Number(e.substring(0, e.length - 1));
  }
  /**
   * Returns the image origin as a XYZ-vector. When the image has no affine
   * transformation, then an exception is thrown.
   * @returns {Array<number>} The origin as a vector
   */
  getOrigin() {
    const e = this.fileDirectory.ModelTiepoint, n = this.fileDirectory.ModelTransformation;
    if (e && e.length === 6)
      return [
        e[3],
        e[4],
        e[5]
      ];
    if (n)
      return [
        n[3],
        n[7],
        n[11]
      ];
    throw new Error("The image does not have an affine transformation.");
  }
  /**
   * Returns the image resolution as a XYZ-vector. When the image has no affine
   * transformation, then an exception is thrown.
   * @param {GeoTIFFImage} [referenceImage=null] A reference image to calculate the resolution from
   *                                             in cases when the current image does not have the
   *                                             required tags on its own.
   * @returns {Array<number>} The resolution as a vector
   */
  getResolution(e = null) {
    const n = this.fileDirectory.ModelPixelScale, r = this.fileDirectory.ModelTransformation;
    if (n)
      return [
        n[0],
        -n[1],
        n[2]
      ];
    if (r)
      return r[1] === 0 && r[4] === 0 ? [
        r[0],
        -r[5],
        r[10]
      ] : [
        Math.sqrt(r[0] * r[0] + r[4] * r[4]),
        -Math.sqrt(r[1] * r[1] + r[5] * r[5]),
        r[10]
      ];
    if (e) {
      const [i, o, a] = e.getResolution();
      return [
        i * e.getWidth() / this.getWidth(),
        o * e.getHeight() / this.getHeight(),
        a * e.getWidth() / this.getWidth()
      ];
    }
    throw new Error("The image does not have an affine transformation.");
  }
  /**
   * Returns whether or not the pixels of the image depict an area (or point).
   * @returns {Boolean} Whether the pixels are a point
   */
  pixelIsArea() {
    return this.geoKeys.GTRasterTypeGeoKey === 1;
  }
  /**
   * Returns the image bounding box as an array of 4 values: min-x, min-y,
   * max-x and max-y. When the image has no affine transformation, then an
   * exception is thrown.
   * @param {boolean} [tilegrid=false] If true return extent for a tilegrid
   *                                   without adjustment for ModelTransformation.
   * @returns {Array<number>} The bounding box
   */
  getBoundingBox(e = !1) {
    const n = this.getHeight(), r = this.getWidth();
    if (this.fileDirectory.ModelTransformation && !e) {
      const [i, o, a, s, l, c, u, f] = this.fileDirectory.ModelTransformation, d = [
        [0, 0],
        [0, n],
        [r, 0],
        [r, n]
      ].map(([h, x]) => [
        s + i * h + o * x,
        f + l * h + c * x
      ]), g = d.map((h) => h[0]), y = d.map((h) => h[1]);
      return [
        Math.min(...g),
        Math.min(...y),
        Math.max(...g),
        Math.max(...y)
      ];
    } else {
      const i = this.getOrigin(), o = this.getResolution(), a = i[0], s = i[1], l = a + o[0] * r, c = s + o[1] * n;
      return [
        Math.min(a, l),
        Math.min(s, c),
        Math.max(a, l),
        Math.max(s, c)
      ];
    }
  }
}
class Sn {
  constructor(e) {
    this._dataView = new DataView(e);
  }
  get buffer() {
    return this._dataView.buffer;
  }
  getUint64(e, n) {
    const r = this.getUint32(e, n), i = this.getUint32(e + 4, n);
    let o;
    if (n) {
      if (o = r + 2 ** 32 * i, !Number.isSafeInteger(o))
        throw new Error(
          `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return o;
    }
    if (o = 2 ** 32 * r + i, !Number.isSafeInteger(o))
      throw new Error(
        `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return o;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  getInt64(e, n) {
    let r = 0;
    const i = (this._dataView.getUint8(e + (n ? 7 : 0)) & 128) > 0;
    let o = !0;
    for (let a = 0; a < 8; a++) {
      let s = this._dataView.getUint8(e + (n ? a : 7 - a));
      i && (o ? s !== 0 && (s = ~(s - 1) & 255, o = !1) : s = ~s & 255), r += s * 256 ** a;
    }
    return i && (r = -r), r;
  }
  getUint8(e, n) {
    return this._dataView.getUint8(e, n);
  }
  getInt8(e, n) {
    return this._dataView.getInt8(e, n);
  }
  getUint16(e, n) {
    return this._dataView.getUint16(e, n);
  }
  getInt16(e, n) {
    return this._dataView.getInt16(e, n);
  }
  getUint32(e, n) {
    return this._dataView.getUint32(e, n);
  }
  getInt32(e, n) {
    return this._dataView.getInt32(e, n);
  }
  getFloat16(e, n) {
    return ze(this._dataView, e, n);
  }
  getFloat32(e, n) {
    return this._dataView.getFloat32(e, n);
  }
  getFloat64(e, n) {
    return this._dataView.getFloat64(e, n);
  }
}
class Bn {
  constructor(e, n, r, i) {
    this._dataView = new DataView(e), this._sliceOffset = n, this._littleEndian = r, this._bigTiff = i;
  }
  get sliceOffset() {
    return this._sliceOffset;
  }
  get sliceTop() {
    return this._sliceOffset + this.buffer.byteLength;
  }
  get littleEndian() {
    return this._littleEndian;
  }
  get bigTiff() {
    return this._bigTiff;
  }
  get buffer() {
    return this._dataView.buffer;
  }
  covers(e, n) {
    return this.sliceOffset <= e && this.sliceTop >= e + n;
  }
  readUint8(e) {
    return this._dataView.getUint8(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readInt8(e) {
    return this._dataView.getInt8(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readUint16(e) {
    return this._dataView.getUint16(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readInt16(e) {
    return this._dataView.getInt16(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readUint32(e) {
    return this._dataView.getUint32(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readInt32(e) {
    return this._dataView.getInt32(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readFloat32(e) {
    return this._dataView.getFloat32(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readFloat64(e) {
    return this._dataView.getFloat64(
      e - this._sliceOffset,
      this._littleEndian
    );
  }
  readUint64(e) {
    const n = this.readUint32(e), r = this.readUint32(e + 4);
    let i;
    if (this._littleEndian) {
      if (i = n + 2 ** 32 * r, !Number.isSafeInteger(i))
        throw new Error(
          `${i} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return i;
    }
    if (i = 2 ** 32 * n + r, !Number.isSafeInteger(i))
      throw new Error(
        `${i} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return i;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  readInt64(e) {
    let n = 0;
    const r = (this._dataView.getUint8(e + (this._littleEndian ? 7 : 0)) & 128) > 0;
    let i = !0;
    for (let o = 0; o < 8; o++) {
      let a = this._dataView.getUint8(
        e + (this._littleEndian ? o : 7 - o)
      );
      r && (i ? a !== 0 && (a = ~(a - 1) & 255, i = !1) : a = ~a & 255), n += a * 256 ** o;
    }
    return r && (n = -n), n;
  }
  readOffset(e) {
    return this._bigTiff ? this.readUint64(e) : this.readUint32(e);
  }
}
class Pn {
  /**
   *
   * @param {Slice[]} slices
   * @returns {ArrayBuffer[]}
   */
  async fetch(e, n = void 0) {
    return Promise.all(
      e.map((r) => this.fetchSlice(r, n))
    );
  }
  /**
   *
   * @param {Slice} slice
   * @returns {ArrayBuffer}
   */
  async fetchSlice(e) {
    throw new Error(`fetching of slice ${e} not possible, not implemented`);
  }
  /**
   * Returns the filesize if already determined and null otherwise
   */
  get fileSize() {
    return null;
  }
  async close() {
  }
}
class Se extends Error {
  constructor(e) {
    super(e), Error.captureStackTrace && Error.captureStackTrace(this, Se), this.name = "AbortError";
  }
}
class Cn extends Pn {
  constructor(e) {
    super(), this.arrayBuffer = e;
  }
  fetchSlice(e, n) {
    if (n && n.aborted)
      throw new Se("Request aborted");
    return this.arrayBuffer.slice(e.offset, e.offset + e.length);
  }
}
function Dn(t) {
  return new Cn(t);
}
function he(t) {
  switch (t) {
    case w.BYTE:
    case w.ASCII:
    case w.SBYTE:
    case w.UNDEFINED:
      return 1;
    case w.SHORT:
    case w.SSHORT:
      return 2;
    case w.LONG:
    case w.SLONG:
    case w.FLOAT:
    case w.IFD:
      return 4;
    case w.RATIONAL:
    case w.SRATIONAL:
    case w.DOUBLE:
    case w.LONG8:
    case w.SLONG8:
    case w.IFD8:
      return 8;
    default:
      throw new RangeError(`Invalid field type: ${t}`);
  }
}
function Mn(t) {
  const e = t.GeoKeyDirectory;
  if (!e)
    return null;
  const n = {};
  for (let r = 4; r <= e[3] * 4; r += 4) {
    const i = nn[e[r]], o = e[r + 1] ? J[e[r + 1]] : null, a = e[r + 2], s = e[r + 3];
    let l = null;
    if (!o)
      l = s;
    else {
      if (l = t[o], typeof l > "u" || l === null)
        throw new Error(`Could not get value of geoKey '${i}'.`);
      typeof l == "string" ? l = l.substring(s, s + a - 1) : l.subarray && (l = l.subarray(s, s + a), a === 1 && (l = l[0]));
    }
    n[i] = l;
  }
  return n;
}
function v(t, e, n, r) {
  let i = null, o = null;
  const a = he(e);
  switch (e) {
    case w.BYTE:
    case w.ASCII:
    case w.UNDEFINED:
      i = new Uint8Array(n), o = t.readUint8;
      break;
    case w.SBYTE:
      i = new Int8Array(n), o = t.readInt8;
      break;
    case w.SHORT:
      i = new Uint16Array(n), o = t.readUint16;
      break;
    case w.SSHORT:
      i = new Int16Array(n), o = t.readInt16;
      break;
    case w.LONG:
    case w.IFD:
      i = new Uint32Array(n), o = t.readUint32;
      break;
    case w.SLONG:
      i = new Int32Array(n), o = t.readInt32;
      break;
    case w.LONG8:
    case w.IFD8:
      i = new Array(n), o = t.readUint64;
      break;
    case w.SLONG8:
      i = new Array(n), o = t.readInt64;
      break;
    case w.RATIONAL:
      i = new Uint32Array(n * 2), o = t.readUint32;
      break;
    case w.SRATIONAL:
      i = new Int32Array(n * 2), o = t.readInt32;
      break;
    case w.FLOAT:
      i = new Float32Array(n), o = t.readFloat32;
      break;
    case w.DOUBLE:
      i = new Float64Array(n), o = t.readFloat64;
      break;
    default:
      throw new RangeError(`Invalid field type: ${e}`);
  }
  if (e === w.RATIONAL || e === w.SRATIONAL)
    for (let s = 0; s < n; s += 2)
      i[s] = o.call(
        t,
        r + s * a
      ), i[s + 1] = o.call(
        t,
        r + (s * a + 4)
      );
  else
    for (let s = 0; s < n; ++s)
      i[s] = o.call(
        t,
        r + s * a
      );
  return e === w.ASCII ? new TextDecoder("utf-8").decode(i) : i;
}
class Gn {
  constructor(e, n, r) {
    this.fileDirectory = e, this.geoKeyDirectory = n, this.nextIFDByteOffset = r;
  }
}
class re extends Error {
  constructor(e) {
    super(`No image at index ${e}`), this.index = e;
  }
}
class Fn {
  /**
   * (experimental) Reads raster data from the best fitting image. This function uses
   * the image with the lowest resolution that is still a higher resolution than the
   * requested resolution.
   * When specified, the `bbox` option is translated to the `window` option and the
   * `resX` and `resY` to `width` and `height` respectively.
   * Then, the [readRasters]{@link GeoTIFFImage#readRasters} method of the selected
   * image is called and the result returned.
   * @see GeoTIFFImage.readRasters
   * @param {import('./geotiffimage').ReadRasterOptions} [options={}] optional parameters
   * @returns {Promise<ReadRasterResult>} the decoded array(s), with `height` and `width`, as a promise
   */
  async readRasters(e = {}) {
    const { window: n, width: r, height: i } = e;
    let { resX: o, resY: a, bbox: s } = e;
    const l = await this.getImage();
    let c = l;
    const u = await this.getImageCount(), f = l.getBoundingBox();
    if (n && s)
      throw new Error('Both "bbox" and "window" passed.');
    if (r || i) {
      if (n) {
        const [g, y] = l.getOrigin(), [h, x] = l.getResolution();
        s = [
          g + n[0] * h,
          y + n[1] * x,
          g + n[2] * h,
          y + n[3] * x
        ];
      }
      const d = s || f;
      if (r) {
        if (o)
          throw new Error("Both width and resX passed");
        o = (d[2] - d[0]) / r;
      }
      if (i) {
        if (a)
          throw new Error("Both width and resY passed");
        a = (d[3] - d[1]) / i;
      }
    }
    if (o || a) {
      const d = [];
      for (let g = 0; g < u; ++g) {
        const y = await this.getImage(g), { SubfileType: h, NewSubfileType: x } = y.fileDirectory;
        (g === 0 || h === 2 || x & 1) && d.push(y);
      }
      d.sort((g, y) => g.getWidth() - y.getWidth());
      for (let g = 0; g < d.length; ++g) {
        const y = d[g], h = (f[2] - f[0]) / y.getWidth(), x = (f[3] - f[1]) / y.getHeight();
        if (c = y, o && o > h || a && a > x)
          break;
      }
    }
    let p = n;
    if (s) {
      const [d, g] = l.getOrigin(), [y, h] = c.getResolution(l);
      p = [
        Math.round((s[0] - d) / y),
        Math.round((s[1] - g) / h),
        Math.round((s[2] - d) / y),
        Math.round((s[3] - g) / h)
      ], p = [
        Math.min(p[0], p[2]),
        Math.min(p[1], p[3]),
        Math.max(p[0], p[2]),
        Math.max(p[1], p[3])
      ];
    }
    return c.readRasters({ ...e, window: p });
  }
}
class Be extends Fn {
  /**
   * @constructor
   * @param {*} source The datasource to read from.
   * @param {boolean} littleEndian Whether the image uses little endian.
   * @param {boolean} bigTiff Whether the image uses bigTIFF conventions.
   * @param {number} firstIFDOffset The numeric byte-offset from the start of the image
   *                                to the first IFD.
   * @param {GeoTIFFOptions} [options] further options.
   */
  constructor(e, n, r, i, o = {}) {
    super(), this.source = e, this.littleEndian = n, this.bigTiff = r, this.firstIFDOffset = i, this.cache = o.cache || !1, this.ifdRequests = [], this.ghostValues = null;
  }
  async getSlice(e, n) {
    const r = this.bigTiff ? 4048 : 1024;
    return new Bn(
      (await this.source.fetch([{
        offset: e,
        length: typeof n < "u" ? n : r
      }]))[0],
      e,
      this.littleEndian,
      this.bigTiff
    );
  }
  /**
   * Instructs to parse an image file directory at the given file offset.
   * As there is no way to ensure that a location is indeed the start of an IFD,
   * this function must be called with caution (e.g only using the IFD offsets from
   * the headers or other IFDs).
   * @param {number} offset the offset to parse the IFD at
   * @returns {Promise<ImageFileDirectory>} the parsed IFD
   */
  async parseFileDirectoryAt(e) {
    const n = this.bigTiff ? 20 : 12, r = this.bigTiff ? 8 : 2;
    let i = await this.getSlice(e);
    const o = this.bigTiff ? i.readUint64(e) : i.readUint16(e), a = o * n + (this.bigTiff ? 16 : 6);
    i.covers(e, a) || (i = await this.getSlice(e, a));
    const s = {};
    let l = e + (this.bigTiff ? 8 : 2);
    for (let f = 0; f < o; l += n, ++f) {
      const p = i.readUint16(l), d = i.readUint16(l + 2), g = this.bigTiff ? i.readUint64(l + 4) : i.readUint32(l + 4);
      let y, h;
      const x = he(d), m = l + (this.bigTiff ? 12 : 8);
      if (x * g <= (this.bigTiff ? 8 : 4))
        y = v(i, d, g, m);
      else {
        const b = i.readOffset(m), T = he(d) * g;
        if (i.covers(b, T))
          y = v(i, d, g, b);
        else {
          const I = await this.getSlice(b, T);
          y = v(I, d, g, b);
        }
      }
      g === 1 && en.indexOf(p) === -1 && !(d === w.RATIONAL || d === w.SRATIONAL) ? h = y[0] : h = y, s[J[p]] = h;
    }
    const c = Mn(s), u = i.readOffset(
      e + r + n * o
    );
    return new Gn(
      s,
      c,
      u
    );
  }
  async requestIFD(e) {
    if (this.ifdRequests[e])
      return this.ifdRequests[e];
    if (e === 0)
      return this.ifdRequests[e] = this.parseFileDirectoryAt(this.firstIFDOffset), this.ifdRequests[e];
    if (!this.ifdRequests[e - 1])
      try {
        this.ifdRequests[e - 1] = this.requestIFD(e - 1);
      } catch (n) {
        throw n instanceof re ? new re(e) : n;
      }
    return this.ifdRequests[e] = (async () => {
      const n = await this.ifdRequests[e - 1];
      if (n.nextIFDByteOffset === 0)
        throw new re(e);
      return this.parseFileDirectoryAt(n.nextIFDByteOffset);
    })(), this.ifdRequests[e];
  }
  /**
   * Get the n-th internal subfile of an image. By default, the first is returned.
   *
   * @param {number} [index=0] the index of the image to return.
   * @returns {Promise<GeoTIFFImage>} the image at the given index
   */
  async getImage(e = 0) {
    const n = await this.requestIFD(e);
    return new In(
      n.fileDirectory,
      n.geoKeyDirectory,
      this.dataView,
      this.littleEndian,
      this.cache,
      this.source
    );
  }
  /**
   * Returns the count of the internal subfiles.
   *
   * @returns {Promise<number>} the number of internal subfile images
   */
  async getImageCount() {
    let e = 0, n = !0;
    for (; n; )
      try {
        await this.requestIFD(e), ++e;
      } catch (r) {
        if (r instanceof re)
          n = !1;
        else
          throw r;
      }
    return e;
  }
  /**
   * Get the values of the COG ghost area as a parsed map.
   * See https://gdal.org/drivers/raster/cog.html#header-ghost-area for reference
   * @returns {Promise<Object>} the parsed ghost area or null, if no such area was found
   */
  async getGhostValues() {
    const e = this.bigTiff ? 16 : 8;
    if (this.ghostValues)
      return this.ghostValues;
    const n = "GDAL_STRUCTURAL_METADATA_SIZE=", r = n.length + 100;
    let i = await this.getSlice(e, r);
    if (n === v(i, w.ASCII, n.length, e)) {
      const a = v(i, w.ASCII, r, e).split(`
`)[0], s = Number(a.split("=")[1].split(" ")[0]) + a.length;
      s > r && (i = await this.getSlice(e, s));
      const l = v(i, w.ASCII, s, e);
      this.ghostValues = {}, l.split(`
`).filter((c) => c.length > 0).map((c) => c.split("=")).forEach(([c, u]) => {
        this.ghostValues[c] = u;
      });
    }
    return this.ghostValues;
  }
  /**
   * Parse a (Geo)TIFF file from the given source.
   *
   * @param {*} source The source of data to parse from.
   * @param {GeoTIFFOptions} [options] Additional options.
   * @param {AbortSignal} [signal] An AbortSignal that may be signalled if the request is
   *                               to be aborted
   */
  static async fromSource(e, n, r) {
    const i = (await e.fetch([{ offset: 0, length: 1024 }], r))[0], o = new Sn(i), a = o.getUint16(0, 0);
    let s;
    if (a === 18761)
      s = !0;
    else if (a === 19789)
      s = !1;
    else
      throw new TypeError("Invalid byte order value.");
    const l = o.getUint16(2, s);
    let c;
    if (l === 42)
      c = !1;
    else if (l === 43) {
      if (c = !0, o.getUint16(4, s) !== 8)
        throw new Error("Unsupported offset byte-size.");
    } else
      throw new TypeError("Invalid magic number.");
    const u = c ? o.getUint64(8, s) : o.getUint32(4, s);
    return new Be(e, s, c, u, n);
  }
  /**
   * Closes the underlying file buffer
   * N.B. After the GeoTIFF has been completely processed it needs
   * to be closed but only if it has been constructed from a file.
   */
  close() {
    return typeof this.source.close == "function" ? this.source.close() : !1;
  }
}
async function Rn(t, e) {
  return Be.fromSource(Dn(t), e);
}
class O {
  static RGBAfromYCbCr(...e) {
    let n, r, i;
    if (e.length === 1) {
      const s = e[0], l = new Uint8ClampedArray(s.length * 4 / 3);
      for (let c = 0, u = 0; c < s.length; c += 3, u += 4)
        n = s[c], r = s[c + 1], i = s[c + 2], l[u] = n + 1.402 * (i - 128), l[u + 1] = n - 0.34414 * (r - 128) - 0.71414 * (i - 128), l[u + 2] = n + 1.772 * (r - 128), l[u + 3] = 255;
      return l;
    }
    [n, r, i] = e;
    const o = n.length, a = new Uint8ClampedArray(o * 4);
    for (let s = 0, l = 0; s < o; s++, l += 4) {
      const c = n[s], u = r[s], f = i[s];
      a[l] = c + 1.402 * (f - 128), a[l + 1] = c - 0.34414 * (u - 128) - 0.71414 * (f - 128), a[l + 2] = c + 1.772 * (u - 128), a[l + 3] = 255;
    }
    return a;
  }
  static RGBAfromRGB(...e) {
    if (e.length === 1) {
      const l = e[0], c = new Uint8ClampedArray(l.length * 4 / 3);
      for (let u = 0, f = 0; u < l.length; u += 3, f += 4)
        c[f] = l[u], c[f + 1] = l[u + 1], c[f + 2] = l[u + 2], c[f + 3] = 255;
      return c;
    }
    const n = e[0], r = e[1], i = e[2], o = e.length >= 4 ? e[3] : null, a = n.length, s = new Uint8ClampedArray(a * 4);
    for (let l = 0, c = 0; l < a; l++, c += 4)
      s[c] = n[l], s[c + 1] = r[l], s[c + 2] = i[l], s[c + 3] = o ? o[l] : 255;
    return s;
  }
  static RGBAfromWhiteIsZero(e, n) {
    const r = new Uint8ClampedArray(e.length * 4);
    let i;
    for (let o = 0, a = 0; o < e.length; ++o, a += 4)
      i = 256 - e[o] / n * 256, r[a] = i, r[a + 1] = i, r[a + 2] = i, r[a + 3] = 255;
    return r;
  }
  static RGBAfromBlackIsZero(e, n) {
    const r = new Uint8ClampedArray(e.length * 4);
    let i;
    for (let o = 0, a = 0; o < e.length; ++o, a += 4)
      i = e[o] / n * 256, r[a] = i, r[a + 1] = i, r[a + 2] = i, r[a + 3] = 255;
    return r;
  }
  static RGBAfromPalette(e, n) {
    const r = new Uint8ClampedArray(e.length * 4), i = n.length / 3, o = n.length / 3 * 2;
    for (let a = 0, s = 0; a < e.length; ++a, s += 4) {
      const l = e[a];
      r[s] = n[l] / 65536 * 256, r[s + 1] = n[l + i] / 65536 * 256, r[s + 2] = n[l + o] / 65536 * 256, r[s + 3] = 255;
    }
    return r;
  }
  static RGBAfromCMYK(...e) {
    if (e.length === 1) {
      const l = e[0], c = new Uint8ClampedArray(l.length);
      for (let u = 0, f = 0; u < l.length; u += 4, f += 4) {
        const p = l[u], d = l[u + 1], g = l[u + 2], y = l[u + 3];
        c[f] = 255 * ((255 - p) / 256) * ((255 - y) / 256), c[f + 1] = 255 * ((255 - d) / 256) * ((255 - y) / 256), c[f + 2] = 255 * ((255 - g) / 256) * ((255 - y) / 256), c[f + 3] = 255;
      }
      return c;
    }
    const n = e[0], r = e[1], i = e[2], o = e[3], a = n.length, s = new Uint8ClampedArray(a * 4);
    for (let l = 0, c = 0; l < a; l++, c += 4) {
      const u = n[l], f = r[l], p = i[l], d = o[l];
      s[c] = 255 * ((255 - u) / 256) * ((255 - d) / 256), s[c + 1] = 255 * ((255 - f) / 256) * ((255 - d) / 256), s[c + 2] = 255 * ((255 - p) / 256) * ((255 - d) / 256), s[c + 3] = 255;
    }
    return s;
  }
  static RGBAfromCIELab(...e) {
    const o = (f, p, d) => {
      const g = p << 24 >> 24, y = d << 24 >> 24;
      let h = (f + 16) / 116, x = g / 500 + h, m = h - y / 200;
      x = 0.95047 * (x * x * x > 8856e-6 ? x * x * x : (x - 0.13793103448275862) / 7.787), h = 1 * (h * h * h > 8856e-6 ? h * h * h : (h - 0.13793103448275862) / 7.787), m = 1.08883 * (m * m * m > 8856e-6 ? m * m * m : (m - 0.13793103448275862) / 7.787);
      let b = x * 3.2406 + h * -1.5372 + m * -0.4986, T = x * -0.9689 + h * 1.8758 + m * 0.0415, I = x * 0.0557 + h * -0.204 + m * 1.057;
      return b = b > 31308e-7 ? 1.055 * b ** 0.4166666666666667 - 0.055 : 12.92 * b, T = T > 31308e-7 ? 1.055 * T ** 0.4166666666666667 - 0.055 : 12.92 * T, I = I > 31308e-7 ? 1.055 * I ** 0.4166666666666667 - 0.055 : 12.92 * I, [
        Math.max(0, Math.min(1, b)) * 255,
        Math.max(0, Math.min(1, T)) * 255,
        Math.max(0, Math.min(1, I)) * 255
      ];
    };
    if (e.length === 1) {
      const f = e[0], p = new Uint8ClampedArray(f.length * 4 / 3);
      for (let d = 0, g = 0; d < f.length; d += 3, g += 4) {
        const [y, h, x] = o(f[d], f[d + 1], f[d + 2]);
        p[g] = y, p[g + 1] = h, p[g + 2] = x, p[g + 3] = 255;
      }
      return p;
    }
    const a = e[0], s = e[1], l = e[2], c = a.length, u = new Uint8ClampedArray(c * 4);
    for (let f = 0, p = 0; f < c; f++, p += 4) {
      const [d, g, y] = o(a[f], s[f], l[f]);
      u[p] = d, u[p + 1] = g, u[p + 2] = y, u[p + 3] = 255;
    }
    return u;
  }
}
const W = 1, L = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, V = {
  UINT: 1,
  INT: 2,
  FLOAT: 3
};
function ie(t, e, n) {
  if (t == null) return n;
  if (Array.isArray(t) || ArrayBuffer.isView(t)) {
    if (t.length === 0) return n;
    const r = e < t.length ? t[e] : t[0];
    return r ?? n;
  }
  return t;
}
function rt(t) {
  const e = t || {}, n = (r) => r == null ? null : Array.isArray(r) ? r.length ? r : null : ArrayBuffer.isView(r) ? r.length ? Array.from(r) : null : [r];
  return {
    sMinSampleValue: n(e.SMinSampleValue),
    sMaxSampleValue: n(e.SMaxSampleValue)
  };
}
function fe(t, e, n, r) {
  const i = ie(t.sMinSampleValue, e, null), o = ie(t.sMaxSampleValue, e, null);
  if (i === null || o === null) return null;
  const a = Number(i), s = Number(o);
  return !Number.isFinite(a) || !Number.isFinite(s) || s <= a || n !== null && (a < n || s > r) ? null : { min: a, max: s };
}
function Re(t, e) {
  return e ? [-Math.pow(2, t - 1), Math.pow(2, t - 1) - 1] : [0, Math.pow(2, t) - 1];
}
function it(t) {
  const e = t || {}, n = e.bitsPerSample, r = e.sampleFormat;
  let i = e.samplesPerPixel;
  i > 0 || (i = Array.isArray(n) || ArrayBuffer.isView(n) ? n.length : 1), i = Math.max(1, i | 0);
  const o = [];
  for (let a = 0; a < i; a++) {
    const s = ie(n, a, 8) || 8, l = ie(r, a, V.UINT) || V.UINT;
    let c, u = 0, f = !1;
    switch (l) {
      case V.UINT: {
        const p = fe(e, a, ...Re(s, !1));
        p ? (c = p.max - p.min, u = p.min) : c = Math.pow(2, s) - 1;
        break;
      }
      case V.INT: {
        const p = fe(e, a, ...Re(s, !0));
        p ? (c = p.max - p.min, u = p.min) : (c = Math.pow(2, s - 1) - 1, f = !0);
        break;
      }
      case V.FLOAT: {
        const p = fe(e, a, null, null);
        p ? (c = p.max - p.min, u = p.min) : (c = 1, f = !0);
        break;
      }
      default:
        throw new Error(
          `[RawTiffPlugin] Unsupported SampleFormat ${l} on channel ${a}; only 1 (unsigned int), 2 (signed int) and 3 (float) are supported.`
        );
    }
    c > 0 || (c = 1), o.push({ scale: c, offset: u, signed: f, bits: s, sampleFormat: l });
  }
  return { version: W, channels: o };
}
function j(t, e) {
  const n = t && t.channels || [];
  return n.length ? n[e] != null ? n[e] : n[0] : { scale: 1, offset: 0, signed: !1, bits: 8, sampleFormat: 1 };
}
function ot(t, e) {
  if (t == null) return 0;
  const n = Number(t);
  return Number.isNaN(n) ? 0 : (n - e.offset) / e.scale;
}
function Oe(t, e) {
  const n = ot(t, e);
  return n <= 0 ? 0 : n >= 1 ? 255 : Math.round(n * 255);
}
function st(t) {
  return t.bits === 8 && (t.sampleFormat === V.UINT || t.sampleFormat === V.INT);
}
function On(t, e) {
  const n = t || {}, r = n.photometricInterpretation, i = n.encoding;
  if (r === L.Palette && n.hasColorMap) return "image";
  const o = n.samplesPerPixel || i && i.channels.length || 1;
  return (r === L.RGB || r === L.YCbCr || r === L.CMYK || r === L.CIELab || (r === L.BlackIsZero || r === L.WhiteIsZero) && o === 1) && (Array.isArray(e) && e.length ? e.filter((c) => c != null && c >= 0) : i.channels.map((c, u) => u)).every((c) => st(j(i, c))) ? "image" : "data";
}
const k = self || globalThis;
function at(t, e) {
  k.postMessage({
    kind: "warn",
    code: t,
    message: e
  });
}
const F = L;
function En(t) {
  try {
    return t ? typeof t == "string" ? t : t.message || JSON.stringify(t) : "Unknown error";
  } catch {
    return String(t);
  }
}
function Un(t) {
  return Array.isArray(t) ? t : [t];
}
function Nn(t) {
  return t && typeof t.PhotometricInterpretation == "number" ? t.PhotometricInterpretation : void 0;
}
function kn(t) {
  return t && t.ColorMap || null;
}
function _n(t) {
  try {
    if (typeof t.getBitsPerSample == "function") return t.getBitsPerSample();
  } catch {
  }
  return t && t.fileDirectory && t.fileDirectory.BitsPerSample || [8];
}
function Ln(t) {
  try {
    if (typeof t.getSamplesPerPixel == "function") return t.getSamplesPerPixel();
  } catch {
  }
  return t && t.fileDirectory && t.fileDirectory.SamplesPerPixel || 1;
}
function Vn(t) {
  const e = t && t.fileDirectory;
  return e && e.SampleFormat ? e.SampleFormat : null;
}
function lt(t) {
  return t.map((e) => {
    const n = typeof e.ctor == "string" && k[e.ctor] ? k[e.ctor] : Uint8Array;
    return new n(e.buffer, e.byteOffset || 0, e.length);
  });
}
function Pe(t) {
  if (t.__encoding) return t.__encoding;
  const { sMinSampleValue: e, sMaxSampleValue: n } = rt(t.fileDirectory), r = it({
    bitsPerSample: t.bitsPerSample,
    sampleFormat: t.sampleFormat,
    sMinSampleValue: e,
    sMaxSampleValue: n,
    samplesPerPixel: Math.max(
      t.samplesPerPixel || 0,
      t.bands ? t.bands.length : 0
    )
  });
  return t.__encoding = r, r;
}
function Kn(t, e) {
  const n = e && Array.isArray(e.channels) && e.channels.length ? e.channels : null;
  return On({
    photometricInterpretation: t.photometricInterpretation,
    samplesPerPixel: t.samplesPerPixel || (t.bands ? t.bands.length : 1),
    hasColorMap: !!t.colorMap,
    encoding: Pe(t)
  }, n);
}
function ct(t) {
  const e = new Float32Array(1), n = new Uint32Array(e.buffer);
  e[0] = t;
  const r = n[0], i = r >> 31 & 1;
  let o = r >> 23 & 255, a = r & 8388607;
  return o === 255 ? a !== 0 ? i << 15 | 32256 : i << 15 | 31744 : o === 0 ? i << 15 : (o = o - 127 + 15, o >= 31 ? i << 15 | 31744 : o <= 0 ? i << 15 : (a = a + 4096, a & 8388608 && (a = 0, o += 1, o >= 31) ? i << 15 | 31744 : i << 15 | o << 10 | a >> 13));
}
function ft(t) {
  return t && (t.formatResolved || t.format) || null;
}
function ut(t, e, n) {
  const r = t.samplesPerPixel || (t.bands ? t.bands.length : 1), i = t.photometricInterpretation, o = Pe(t), a = (l) => {
    const c = t.bands[l];
    if (!c) return null;
    const u = j(o, l);
    if (st(u) && (c instanceof Uint8Array || c instanceof Uint8ClampedArray))
      return c;
    const f = new Uint8ClampedArray(c.length);
    for (let p = 0; p < c.length; p++) f[p] = Oe(c[p], u);
    return f;
  };
  let s = null;
  if (n && n.image && Array.isArray(n.image.rgbaChannels) ? s = n.image.rgbaChannels.slice() : e && Array.isArray(e.renderChannels) && (s = e.renderChannels.slice()), s && s.length > 4 && (at(
    "renderChannels>4_to_RGBA_worker",
    `[tiff-worker] Requested ${s.length} channels for RGBA output; only 4 can be represented. Extra channels will be dropped.`
  ), s.splice(4)), i === F.Palette && t.colorMap) {
    const l = t.bands[0];
    return O.RGBAfromPalette(l, t.colorMap);
  }
  if ((i === F.WhiteIsZero || i === F.BlackIsZero) && r >= 1) {
    const l = a(0);
    return i === F.WhiteIsZero ? O.RGBAfromWhiteIsZero(l, 255) : O.RGBAfromBlackIsZero(l, 255);
  }
  if (s && s.length >= 1) {
    const l = t.width, c = t.height, u = l * c;
    if (s.length === 1)
      return O.RGBAfromBlackIsZero(a(s[0]), 255);
    const f = new Uint8ClampedArray(u * s.length), p = s.map((g) => j(o, g));
    for (let g = 0; g < u; g++) {
      const y = g * s.length;
      for (let h = 0; h < s.length; h++) {
        const x = s[h];
        f[y + h] = x != null && x >= 0 && x < t.bands.length ? Oe(t.bands[x][g], p[h]) : 0;
      }
    }
    if (s.length === 4 && i !== F.YCbCr && i !== F.CMYK && i !== F.CIELab)
      return f;
    if (i === F.YCbCr && s.length >= 3) return O.RGBAfromYCbCr(f);
    if (i === F.CMYK && s.length >= 4) return O.RGBAfromCMYK(f);
    if (i === F.CIELab && s.length >= 3) return O.RGBAfromCIELab(f);
    if (s.length === 3) return O.RGBAfromRGB(f);
    const d = new Uint8ClampedArray(u * 4);
    for (let g = 0, y = 0; g < u; g++, y += 4) {
      const h = g * s.length;
      d[y] = f[h] || 0, d[y + 1] = f[h + 1] || 0, d[y + 2] = f[h + 2] || 0, d[y + 3] = s.length >= 4 && f[h + 3] || 255;
    }
    return d;
  }
  return i === F.RGB && r >= 3 ? O.RGBAfromRGB(
    a(0),
    a(1),
    a(2),
    r >= 4 ? a(3) : null
  ) : i === F.YCbCr && r >= 3 ? O.RGBAfromYCbCr(a(0), a(1), a(2)) : i === F.CMYK && r >= 4 ? O.RGBAfromCMYK(a(0), a(1), a(2), a(3)) : i === F.CIELab && r >= 3 ? O.RGBAfromCIELab(a(0), a(1), a(2)) : O.RGBAfromBlackIsZero(a(0), 255);
}
const Ee = {
  version: W,
  channels: [0, 1, 2, 3].map(() => ({
    scale: 255,
    offset: 0,
    signed: !1,
    bits: 8,
    sampleFormat: 1
  }))
};
function jn(t, e, n, r) {
  const i = r && r.gpu || {}, o = i.preferRGBA8 !== !1, a = !!i.forceRGBA16F;
  if (o && !a) {
    const c = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
    return {
      width: e,
      height: n,
      mode: "image",
      channelCount: 4,
      encodingVersion: W,
      encoding: Ee,
      packs: [{
        format: "RGBA8",
        data: {
          ctor: "Uint8Array",
          buffer: c.buffer,
          byteOffset: c.byteOffset,
          length: c.length
        },
        channels: [0, 1, 2, 3],
        normalized: !0,
        scale: [255, 255, 255, 255],
        offset: [0, 0, 0, 0]
      }]
    };
  }
  const s = e * n, l = new Uint16Array(s * 4);
  for (let c = 0; c < l.length; c++)
    l[c] = ct(t[c] / 255);
  return {
    width: e,
    height: n,
    mode: "image",
    channelCount: 4,
    encodingVersion: W,
    encoding: Ee,
    packs: [{
      format: "RGBA16F",
      data: {
        ctor: "Uint16Array",
        buffer: l.buffer,
        byteOffset: 0,
        length: l.length
      },
      channels: [0, 1, 2, 3],
      normalized: !0,
      scale: [255, 255, 255, 255],
      offset: [0, 0, 0, 0]
    }]
  };
}
function vn(t, e) {
  const n = e && e.gpu || {}, r = n.preferRGBA8 !== !1, i = !!n.forceRGBA16F, o = n.padAlpha == null ? 1 : n.padAlpha, a = Pe(t), s = t.width, l = t.height, c = s * l, u = t.bands ? t.bands.length : 0, f = e && Array.isArray(e.channels) && e.channels.length ? e.channels.slice() : [...Array(u).keys()], p = f.filter((h) => h != null && h >= 0).length, d = f.every((h) => {
    if (h == null || h < 0) return !0;
    const x = j(a, h), m = t.bands[h];
    return x.bits === 8 && x.sampleFormat === V.UINT && (m instanceof Uint8Array || m instanceof Uint8ClampedArray);
  }), g = r && !i && d, y = [];
  for (let h = 0; h < f.length; h += 4) {
    const x = [
      f[h] ?? -1,
      f[h + 1] ?? -1,
      f[h + 2] ?? -1,
      f[h + 3] ?? -1
    ], m = (A) => A === 3 ? o : 0;
    if (g) {
      const A = new Uint8Array(c * 4);
      for (let S = 0, P = 0; S < c; S++, P += 4)
        for (let M = 0; M < 4; M++) {
          const G = x[M];
          A[P + M] = G >= 0 && G < t.bands.length ? t.bands[G][S] : Math.round(m(M) * 255);
        }
      y.push({
        format: "RGBA8",
        data: { ctor: "Uint8Array", buffer: A.buffer, byteOffset: 0, length: A.length },
        channels: x,
        normalized: !0,
        scale: x.map((S) => S >= 0 ? j(a, S).scale : 1),
        offset: x.map((S) => S >= 0 ? j(a, S).offset : 0)
      });
      continue;
    }
    const b = new Uint16Array(c * 4), T = [1, 1, 1, 1], I = [0, 0, 0, 0], B = [null, null, null, null];
    for (let A = 0; A < 4; A++) {
      const S = x[A];
      if (S < 0 || S >= t.bands.length) continue;
      const P = j(a, S);
      B[A] = P, T[A] = P.scale, I[A] = P.offset;
    }
    let _ = !1;
    for (let A = 0, S = 0; A < c; A++, S += 4)
      for (let P = 0; P < 4; P++) {
        const M = x[P];
        let G = M >= 0 && M < t.bands.length ? ot(t.bands[M][A], B[P]) : m(P);
        G > 65504 ? (G = 65504, _ = !0) : G < -65504 && (G = -65504, _ = !0), b[S + P] = ct(G);
      }
    _ && at(
      "gpuPack_f16_clamp_worker",
      "[tiff-worker] Some values exceeded RGBA16F finite range after normalization and were clamped. Check SMinSampleValue/SMaxSampleValue on the file."
    ), y.push({
      format: "RGBA16F",
      data: { ctor: "Uint16Array", buffer: b.buffer, byteOffset: 0, length: b.length },
      channels: x,
      normalized: !0,
      scale: T,
      offset: I
    });
  }
  return {
    width: s,
    height: l,
    mode: "data",
    channelCount: p,
    encodingVersion: W,
    encoding: a,
    packs: y
  };
}
async function Ce(t, e) {
  const n = await Rn(t), r = await n.getImageCount();
  let i = e && typeof e.imageIndex == "number" ? e.imageIndex : null;
  if (r !== 1) {
    if (i == null)
      throw new Error(`[RawTiffPlugin] TIFF has ${r} images; provide rawTiff.hints.imageIndex to decode.`);
    if (i < 0 || i >= r)
      throw new Error(`[RawTiffPlugin] imageIndex ${i} out of range (0..${r - 1}).`);
  } else
    i = 0;
  const o = await n.getImage(i), a = o.getWidth(), s = o.getHeight(), l = o.fileDirectory || {}, c = Ln(o), u = _n(o), f = Vn(o), p = Nn(l), d = kn(l), { sMinSampleValue: g, sMaxSampleValue: y } = rt(l);
  it({
    bitsPerSample: u,
    sampleFormat: f,
    sMinSampleValue: g,
    sMaxSampleValue: y,
    samplesPerPixel: c
  });
  const h = Object.assign({ interleave: !1 }, e && e.decode || {}), m = Un(await o.readRasters({
    ...h,
    pool: null
    // already in worker, do not nest
  })).map((b) => ({
    ctor: b.constructor && b.constructor.name ? b.constructor.name : "Uint8Array",
    buffer: b.buffer,
    byteOffset: b.byteOffset,
    length: b.length
  }));
  return {
    width: a,
    height: s,
    bands: m,
    samplesPerPixel: Math.max(c || 0, m.length),
    bitsPerSample: Array.isArray(u) ? u : [u],
    sampleFormat: f || null,
    photometricInterpretation: p,
    colorMap: d,
    fileDirectory: l
  };
}
async function Yn(t, e) {
  const n = await Ce(t, e), r = Object.assign({}, n, { bands: lt(n.bands) }), i = ft(e), o = ut(r, e, i);
  if (typeof OffscreenCanvas == "function") {
    const a = new OffscreenCanvas(r.width, r.height), s = a.getContext("2d", { willReadFrequently: !0 }), l = new ImageData(o, r.width, r.height);
    return s.putImageData(l, 0, 0), { kind: "imageBitmap", imageBitmap: a.transferToImageBitmap() };
  }
  return {
    kind: "rgba8",
    width: r.width,
    height: r.height,
    rgbaBuffer: o.buffer,
    rgbaByteOffset: o.byteOffset,
    rgbaLength: o.length
  };
}
function ht(t, e) {
  const n = Object.assign({}, t, { bands: lt(t.bands) }), r = ft(e) || {}, i = r.interpretation || "auto";
  if ((i === "auto" ? Kn(n, r) : i) === "image") {
    const a = ut(n, e, r);
    return jn(a, n.width, n.height, r);
  }
  return vn(n, r);
}
async function $n(t, e) {
  const n = await Ce(t, e), r = ht(n, e);
  return { rasterPayload: n, texSet: r };
}
function Ue(t) {
  return t.bands.map((e) => e.buffer);
}
function Ne(t) {
  const e = [];
  for (const n of t.packs)
    e.push(n.data.buffer);
  return e;
}
k.onmessage = async (t) => {
  const e = t.data || {}, n = e.id, r = e.op, i = e.payload || {};
  try {
    if (r === "decodeRaster") {
      const o = i.buffer, a = i.hints || {}, s = await Ce(o, a);
      k.postMessage({ id: n, ok: !0, result: s }, Ue(s));
      return;
    }
    if (r === "decodeAndRenderImageBitmap") {
      const o = i.buffer, a = i.hints || {}, s = await Yn(o, a);
      s.kind === "imageBitmap" ? k.postMessage({ id: n, ok: !0, result: s }, [s.imageBitmap]) : k.postMessage({ id: n, ok: !0, result: s }, [s.rgbaBuffer]);
      return;
    }
    if (r === "decodeAndPackGpuTextureSet") {
      const o = i.buffer, a = i.hints || {}, s = await $n(o, a), l = [
        ...Ue(s.rasterPayload),
        ...Ne(s.texSet)
      ];
      k.postMessage({ id: n, ok: !0, result: s }, l);
      return;
    }
    if (r === "rasterToGpuTextureSet") {
      const o = i.raster, a = i.hints || {}, s = ht(o, a);
      k.postMessage({ id: n, ok: !0, result: s }, Ne(s));
      return;
    }
    throw new Error(`[RawTiffPlugin] Unknown worker op: ${r}`);
  } catch (o) {
    k.postMessage({ id: n, ok: !1, error: En(o) });
  }
};
export {
  Xn as L,
  Zn as a,
  qe as g
};
