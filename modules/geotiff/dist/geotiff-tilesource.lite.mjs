var ki = Object.defineProperty;
var Fi = (t, e, A) => e in t ? ki(t, e, { enumerable: !0, configurable: !0, writable: !0, value: A }) : t[e] = A;
var oe = (t, e, A) => Fi(t, typeof e != "symbol" ? e + "" : e, A);
function j(t) {
  return (e, ...A) => Gi(t, e, A);
}
function FA(t, e) {
  return j(
    qt(
      t,
      e
    ).get
  );
}
const {
  apply: Gi,
  getOwnPropertyDescriptor: qt,
  getPrototypeOf: Le,
  ownKeys: Si
} = Reflect, {
  iterator: qA,
  toStringTag: xi
} = Symbol, bi = Object, {
  create: Me,
  defineProperty: Ri
} = bi, vi = Array, Ui = vi.prototype, Tt = Ui[qA], Li = j(Tt), Jt = ArrayBuffer, Mi = Jt.prototype;
FA(Mi, "byteLength");
const ze = typeof SharedArrayBuffer < "u" ? SharedArrayBuffer : null;
ze && FA(ze.prototype, "byteLength");
const Yt = Le(Uint8Array);
Yt.from;
const Z = Yt.prototype;
Z[qA];
j(Z.keys);
j(
  Z.values
);
j(
  Z.entries
);
j(Z.set);
j(
  Z.reverse
);
j(Z.fill);
j(
  Z.copyWithin
);
j(Z.sort);
j(Z.slice);
j(
  Z.subarray
);
FA(
  Z,
  "buffer"
);
FA(
  Z,
  "byteOffset"
);
FA(
  Z,
  "length"
);
FA(
  Z,
  xi
);
const Ni = Uint8Array, Ht = Uint16Array, Ne = Uint32Array, qi = Float32Array, LA = Le([][qA]()), Kt = j(LA.next), Ti = j(function* () {
}().next), Ji = Le(LA), Yi = DataView.prototype, Hi = j(
  Yi.getUint16
), qe = WeakMap, Ot = qe.prototype, _t = j(Ot.get), Ki = j(Ot.set), Pt = new qe(), Oi = Me(null, {
  next: {
    value: function() {
      const e = _t(Pt, this);
      return Kt(e);
    }
  },
  [qA]: {
    value: function() {
      return this;
    }
  }
});
function _i(t) {
  if (t[qA] === Tt && LA.next === Kt)
    return t;
  const e = Me(Oi);
  return Ki(Pt, e, Li(t)), e;
}
const Pi = new qe(), Vi = Me(Ji, {
  next: {
    value: function() {
      const e = _t(Pi, this);
      return Ti(e);
    },
    writable: !0,
    configurable: !0
  }
});
for (const t of Si(LA))
  t !== "next" && Ri(Vi, t, qt(LA, t));
const Vt = new Jt(4), Xi = new qi(Vt), ji = new Ne(Vt), rA = new Ht(512), nA = new Ni(512);
for (let t = 0; t < 256; ++t) {
  const e = t - 127;
  e < -24 ? (rA[t] = 0, rA[t | 256] = 32768, nA[t] = 24, nA[t | 256] = 24) : e < -14 ? (rA[t] = 1024 >> -e - 14, rA[t | 256] = 1024 >> -e - 14 | 32768, nA[t] = -e - 1, nA[t | 256] = -e - 1) : e <= 15 ? (rA[t] = e + 15 << 10, rA[t | 256] = e + 15 << 10 | 32768, nA[t] = 13, nA[t | 256] = 13) : e < 128 ? (rA[t] = 31744, rA[t | 256] = 64512, nA[t] = 24, nA[t | 256] = 24) : (rA[t] = 31744, rA[t | 256] = 64512, nA[t] = 13, nA[t | 256] = 13);
}
const Te = new Ne(2048);
for (let t = 1; t < 1024; ++t) {
  let e = t << 13, A = 0;
  for (; !(e & 8388608); )
    e <<= 1, A -= 8388608;
  e &= -8388609, A += 947912704, Te[t] = e | A;
}
for (let t = 1024; t < 2048; ++t)
  Te[t] = 939524096 + (t - 1024 << 13);
const GA = new Ne(64);
for (let t = 1; t < 31; ++t)
  GA[t] = t << 23;
GA[31] = 1199570944;
GA[32] = 2147483648;
for (let t = 33; t < 63; ++t)
  GA[t] = 2147483648 + (t - 32 << 23);
GA[63] = 3347054592;
const Xt = new Ht(64);
for (let t = 1; t < 64; ++t)
  t !== 32 && (Xt[t] = 1024);
function Wi(t) {
  const e = t >> 10;
  return ji[0] = Te[Xt[e] + (t & 1023)] + GA[e], Xi[0];
}
function jt(t, e, ...A) {
  return Wi(
    Hi(t, e, ..._i(A))
  );
}
function Je(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var Ye = { exports: {} };
function Wt(t, e, A) {
  const i = A && A.debug || !1;
  i && console.log("[xml-utils] getting " + e + " in " + t);
  const s = typeof t == "object" ? t.outer : t, o = s.slice(0, s.indexOf(">") + 1), C = ['"', "'"];
  for (let g = 0; g < C.length; g++) {
    const w = C[g], a = e + "\\=" + w + "([^" + w + "]*)" + w;
    i && console.log("[xml-utils] pattern:", a);
    const n = new RegExp(a).exec(o);
    if (i && console.log("[xml-utils] match:", n), n) return n[1];
  }
}
Ye.exports = Wt;
Ye.exports.default = Wt;
var Zi = Ye.exports;
const ae = /* @__PURE__ */ Je(Zi);
var He = { exports: {} }, Ke = { exports: {} }, Oe = { exports: {} };
function Zt(t, e, A) {
  const s = new RegExp(e).exec(t.slice(A));
  return s ? A + s.index : -1;
}
Oe.exports = Zt;
Oe.exports.default = Zt;
var zi = Oe.exports, _e = { exports: {} };
function zt(t, e, A) {
  const s = new RegExp(e).exec(t.slice(A));
  return s ? A + s.index + s[0].length - 1 : -1;
}
_e.exports = zt;
_e.exports.default = zt;
var $i = _e.exports, Pe = { exports: {} };
function $t(t, e) {
  const A = new RegExp(e, "g"), i = t.match(A);
  return i ? i.length : 0;
}
Pe.exports = $t;
Pe.exports.default = $t;
var Ar = Pe.exports;
const er = zi, se = $i, $e = Ar;
function Ai(t, e, A) {
  const i = A && A.debug || !1, s = !(A && typeof A.nested === !1), o = A && A.startIndex || 0;
  i && console.log("[xml-utils] starting findTagByName with", e, " and ", A);
  const C = er(t, `<${e}[ 
>/]`, o);
  if (i && console.log("[xml-utils] start:", C), C === -1) return;
  const g = t.slice(C + e.length);
  let w = se(g, "^[^<]*[ /]>", 0);
  const a = w !== -1 && g[w - 1] === "/";
  if (i && console.log("[xml-utils] selfClosing:", a), a === !1)
    if (s) {
      let I = 0, B = 1, y = 0;
      for (; (w = se(g, "[ /]" + e + ">", I)) !== -1; ) {
        const c = g.substring(I, w + 1);
        if (B += $e(c, "<" + e + `[ 
	>]`), y += $e(c, "</" + e + ">"), y >= B) break;
        I = w;
      }
    } else
      w = se(g, "[ /]" + e + ">", 0);
  const r = C + e.length + w + 1;
  if (i && console.log("[xml-utils] end:", r), r === -1) return;
  const n = t.slice(C, r);
  let f;
  return a ? f = null : f = n.slice(n.indexOf(">") + 1, n.lastIndexOf("<")), { inner: f, outer: n, start: C, end: r };
}
Ke.exports = Ai;
Ke.exports.default = Ai;
var tr = Ke.exports;
const ir = tr;
function ei(t, e, A) {
  const i = [], s = A && A.debug || !1, o = A && typeof A.nested == "boolean" ? A.nested : !0;
  let C = A && A.startIndex || 0, g;
  for (; g = ir(t, e, { debug: s, startIndex: C }); )
    o ? C = g.start + 1 + e.length : C = g.end, i.push(g);
  return s && console.log("findTagsByName found", i.length, "tags"), i;
}
He.exports = ei;
He.exports.default = ei;
var rr = He.exports;
const nr = /* @__PURE__ */ Je(rr), bA = {
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
}, aA = {};
for (const t in bA)
  bA.hasOwnProperty(t) && (aA[bA[t]] = parseInt(t, 10));
const or = [
  aA.BitsPerSample,
  aA.ExtraSamples,
  aA.SampleFormat,
  aA.StripByteCounts,
  aA.StripOffsets,
  aA.StripRowCounts,
  aA.TileByteCounts,
  aA.TileOffsets,
  aA.SubIFDs
], ge = {
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
}, H = {};
for (const t in ge)
  ge.hasOwnProperty(t) && (H[ge[t]] = parseInt(t, 10));
const W = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, ar = {
  Unspecified: 0
}, sr = {
  AddCompression: 1
}, Ie = {
  None: 0,
  Deflate: 1,
  Zstandard: 2
}, gr = {
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
function Ir(t, e) {
  const { width: A, height: i } = t, s = new Uint8Array(A * i * 3);
  let o;
  for (let C = 0, g = 0; C < t.length; ++C, g += 3)
    o = 256 - t[C] / e * 256, s[g] = o, s[g + 1] = o, s[g + 2] = o;
  return s;
}
function Br(t, e) {
  const { width: A, height: i } = t, s = new Uint8Array(A * i * 3);
  let o;
  for (let C = 0, g = 0; C < t.length; ++C, g += 3)
    o = t[C] / e * 256, s[g] = o, s[g + 1] = o, s[g + 2] = o;
  return s;
}
function Cr(t, e) {
  const { width: A, height: i } = t, s = new Uint8Array(A * i * 3), o = e.length / 3, C = e.length / 3 * 2;
  for (let g = 0, w = 0; g < t.length; ++g, w += 3) {
    const a = t[g];
    s[w] = e[a] / 65536 * 256, s[w + 1] = e[a + o] / 65536 * 256, s[w + 2] = e[a + C] / 65536 * 256;
  }
  return s;
}
function fr(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let s = 0, o = 0; s < t.length; s += 4, o += 3) {
    const C = t[s], g = t[s + 1], w = t[s + 2], a = t[s + 3];
    i[o] = 255 * ((255 - C) / 256) * ((255 - a) / 256), i[o + 1] = 255 * ((255 - g) / 256) * ((255 - a) / 256), i[o + 2] = 255 * ((255 - w) / 256) * ((255 - a) / 256);
  }
  return i;
}
function lr(t) {
  const { width: e, height: A } = t, i = new Uint8ClampedArray(e * A * 3);
  for (let s = 0, o = 0; s < t.length; s += 3, o += 3) {
    const C = t[s], g = t[s + 1], w = t[s + 2];
    i[o] = C + 1.402 * (w - 128), i[o + 1] = C - 0.34414 * (g - 128) - 0.71414 * (w - 128), i[o + 2] = C + 1.772 * (g - 128);
  }
  return i;
}
const cr = 0.95047, Qr = 1, Er = 1.08883;
function hr(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let s = 0, o = 0; s < t.length; s += 3, o += 3) {
    const C = t[s + 0], g = t[s + 1] << 24 >> 24, w = t[s + 2] << 24 >> 24;
    let a = (C + 16) / 116, r = g / 500 + a, n = a - w / 200, f, I, B;
    r = cr * (r * r * r > 8856e-6 ? r * r * r : (r - 16 / 116) / 7.787), a = Qr * (a * a * a > 8856e-6 ? a * a * a : (a - 16 / 116) / 7.787), n = Er * (n * n * n > 8856e-6 ? n * n * n : (n - 16 / 116) / 7.787), f = r * 3.2406 + a * -1.5372 + n * -0.4986, I = r * -0.9689 + a * 1.8758 + n * 0.0415, B = r * 0.0557 + a * -0.204 + n * 1.057, f = f > 31308e-7 ? 1.055 * f ** (1 / 2.4) - 0.055 : 12.92 * f, I = I > 31308e-7 ? 1.055 * I ** (1 / 2.4) - 0.055 : 12.92 * I, B = B > 31308e-7 ? 1.055 * B ** (1 / 2.4) - 0.055 : 12.92 * B, i[o] = Math.max(0, Math.min(1, f)) * 255, i[o + 1] = Math.max(0, Math.min(1, I)) * 255, i[o + 2] = Math.max(0, Math.min(1, B)) * 255;
  }
  return i;
}
const ti = /* @__PURE__ */ new Map();
function cA(t, e) {
  Array.isArray(t) || (t = [t]), t.forEach((A) => ti.set(A, e));
}
async function ii(t) {
  const e = ti.get(t.Compression);
  if (!e)
    throw new Error(`Unknown compression method identifier: ${t.Compression}`);
  const A = await e();
  return new A(t);
}
cA([void 0, 1], () => Promise.resolve().then(() => wn).then((t) => t.default));
cA(5, () => Promise.resolve().then(() => kn).then((t) => t.default));
cA(6, () => {
  throw new Error("old style JPEG compression is not supported.");
});
cA(7, () => Promise.resolve().then(() => bn).then((t) => t.default));
cA([8, 32946], () => Promise.resolve().then(() => Vo).then((t) => t.default));
cA(32773, () => Promise.resolve().then(() => jo).then((t) => t.default));
cA(
  34887,
  () => Promise.resolve().then(() => Aa).then(async (t) => (await t.zstd.init(), t)).then((t) => t.default)
);
cA(50001, () => Promise.resolve().then(() => ta).then((t) => t.default));
function ee(t, e, A, i = 1) {
  return new (Object.getPrototypeOf(t)).constructor(e * A * i);
}
function ur(t, e, A, i, s) {
  const o = e / i, C = A / s;
  return t.map((g) => {
    const w = ee(g, i, s);
    for (let a = 0; a < s; ++a) {
      const r = Math.min(Math.round(C * a), A - 1);
      for (let n = 0; n < i; ++n) {
        const f = Math.min(Math.round(o * n), e - 1), I = g[r * e + f];
        w[a * i + n] = I;
      }
    }
    return w;
  });
}
function kA(t, e, A) {
  return (1 - A) * t + A * e;
}
function dr(t, e, A, i, s) {
  const o = e / i, C = A / s;
  return t.map((g) => {
    const w = ee(g, i, s);
    for (let a = 0; a < s; ++a) {
      const r = C * a, n = Math.floor(r), f = Math.min(Math.ceil(r), A - 1);
      for (let I = 0; I < i; ++I) {
        const B = o * I, y = B % 1, c = Math.floor(B), E = Math.min(Math.ceil(B), e - 1), d = g[n * e + c], p = g[n * e + E], u = g[f * e + c], Q = g[f * e + E], l = kA(
          kA(d, p, y),
          kA(u, Q, y),
          r % 1
        );
        w[a * i + I] = l;
      }
    }
    return w;
  });
}
function wr(t, e, A, i, s, o = "nearest") {
  switch (o.toLowerCase()) {
    case "nearest":
      return ur(t, e, A, i, s);
    case "bilinear":
    case "linear":
      return dr(t, e, A, i, s);
    default:
      throw new Error(`Unsupported resampling method: '${o}'`);
  }
}
function yr(t, e, A, i, s, o) {
  const C = e / i, g = A / s, w = ee(t, i, s, o);
  for (let a = 0; a < s; ++a) {
    const r = Math.min(Math.round(g * a), A - 1);
    for (let n = 0; n < i; ++n) {
      const f = Math.min(Math.round(C * n), e - 1);
      for (let I = 0; I < o; ++I) {
        const B = t[r * e * o + f * o + I];
        w[a * i * o + n * o + I] = B;
      }
    }
  }
  return w;
}
function Dr(t, e, A, i, s, o) {
  const C = e / i, g = A / s, w = ee(t, i, s, o);
  for (let a = 0; a < s; ++a) {
    const r = g * a, n = Math.floor(r), f = Math.min(Math.ceil(r), A - 1);
    for (let I = 0; I < i; ++I) {
      const B = C * I, y = B % 1, c = Math.floor(B), E = Math.min(Math.ceil(B), e - 1);
      for (let d = 0; d < o; ++d) {
        const p = t[n * e * o + c * o + d], u = t[n * e * o + E * o + d], Q = t[f * e * o + c * o + d], l = t[f * e * o + E * o + d], h = kA(
          kA(p, u, y),
          kA(Q, l, y),
          r % 1
        );
        w[a * i * o + I * o + d] = h;
      }
    }
  }
  return w;
}
function pr(t, e, A, i, s, o, C = "nearest") {
  switch (C.toLowerCase()) {
    case "nearest":
      return yr(
        t,
        e,
        A,
        i,
        s,
        o
      );
    case "bilinear":
    case "linear":
      return Dr(
        t,
        e,
        A,
        i,
        s,
        o
      );
    default:
      throw new Error(`Unsupported resampling method: '${C}'`);
  }
}
function mr(t, e, A) {
  let i = 0;
  for (let s = e; s < A; ++s)
    i += t[s];
  return i;
}
function me(t, e, A) {
  switch (t) {
    case 1:
      if (e <= 8)
        return new Uint8Array(A);
      if (e <= 16)
        return new Uint16Array(A);
      if (e <= 32)
        return new Uint32Array(A);
      break;
    case 2:
      if (e === 8)
        return new Int8Array(A);
      if (e === 16)
        return new Int16Array(A);
      if (e === 32)
        return new Int32Array(A);
      break;
    case 3:
      switch (e) {
        case 16:
        case 32:
          return new Float32Array(A);
        case 64:
          return new Float64Array(A);
      }
      break;
  }
  throw Error("Unsupported data format/bitsPerSample");
}
function kr(t, e) {
  return (t === 1 || t === 2) && e <= 32 && e % 8 === 0 ? !1 : !(t === 3 && (e === 16 || e === 32 || e === 64));
}
function Fr(t, e, A, i, s, o, C) {
  const g = new DataView(t), w = A === 2 ? C * o : C * o * i, a = A === 2 ? 1 : i, r = me(e, s, w), n = parseInt("1".repeat(s), 2);
  if (e === 1) {
    let f;
    A === 1 ? f = i * s : f = s;
    let I = o * f;
    I & 7 && (I = I + 7 & -8);
    for (let B = 0; B < C; ++B) {
      const y = B * I;
      for (let c = 0; c < o; ++c) {
        const E = y + c * a * s;
        for (let d = 0; d < a; ++d) {
          const p = E + d * s, u = (B * o + c) * a + d, Q = Math.floor(p / 8), l = p % 8;
          if (l + s <= 8)
            r[u] = g.getUint8(Q) >> 8 - s - l & n;
          else if (l + s <= 16)
            r[u] = g.getUint16(Q) >> 16 - s - l & n;
          else if (l + s <= 24) {
            const h = g.getUint16(Q) << 8 | g.getUint8(Q + 2);
            r[u] = h >> 24 - s - l & n;
          } else
            r[u] = g.getUint32(Q) >> 32 - s - l & n;
        }
      }
    }
  }
  return r.buffer;
}
class Gr {
  /**
   * @constructor
   * @param {Object} fileDirectory The parsed file directory
   * @param {Object} geoKeys The parsed geo-keys
   * @param {DataView} dataView The DataView for the underlying file.
   * @param {Boolean} littleEndian Whether the file is encoded in little or big endian
   * @param {Boolean} cache Whether or not decoded tiles shall be cached
   * @param {import('./source/basesource').BaseSource} source The datasource to read from
   */
  constructor(e, A, i, s, o, C) {
    this.fileDirectory = e, this.geoKeys = A, this.dataView = i, this.littleEndian = s, this.tiles = o ? {} : null, this.isTiled = !e.StripOffsets;
    const g = e.PlanarConfiguration;
    if (this.planarConfiguration = typeof g > "u" ? 1 : g, this.planarConfiguration !== 1 && this.planarConfiguration !== 2)
      throw new Error("Invalid planar configuration.");
    this.source = C;
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
    for (let A = 0; A < this.fileDirectory.BitsPerSample.length; ++A)
      e += this.getSampleByteSize(A);
    return e;
  }
  getSampleByteSize(e) {
    if (e >= this.fileDirectory.BitsPerSample.length)
      throw new RangeError(`Sample index ${e} is out of range.`);
    return Math.ceil(this.fileDirectory.BitsPerSample[e] / 8);
  }
  getReaderForSample(e) {
    const A = this.fileDirectory.SampleFormat ? this.fileDirectory.SampleFormat[e] : 1, i = this.fileDirectory.BitsPerSample[e];
    switch (A) {
      case 1:
        if (i <= 8)
          return DataView.prototype.getUint8;
        if (i <= 16)
          return DataView.prototype.getUint16;
        if (i <= 32)
          return DataView.prototype.getUint32;
        break;
      case 2:
        if (i <= 8)
          return DataView.prototype.getInt8;
        if (i <= 16)
          return DataView.prototype.getInt16;
        if (i <= 32)
          return DataView.prototype.getInt32;
        break;
      case 3:
        switch (i) {
          case 16:
            return function(s, o) {
              return jt(this, s, o);
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
  getArrayForSample(e, A) {
    const i = this.getSampleFormat(e), s = this.getBitsPerSample(e);
    return me(i, s, A);
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
  async getTileOrStrip(e, A, i, s, o) {
    const C = Math.ceil(this.getWidth() / this.getTileWidth()), g = Math.ceil(this.getHeight() / this.getTileHeight());
    let w;
    const { tiles: a } = this;
    this.planarConfiguration === 1 ? w = A * C + e : this.planarConfiguration === 2 && (w = i * C * g + A * C + e);
    let r, n;
    this.isTiled ? (r = this.fileDirectory.TileOffsets[w], n = this.fileDirectory.TileByteCounts[w]) : (r = this.fileDirectory.StripOffsets[w], n = this.fileDirectory.StripByteCounts[w]);
    const f = (await this.source.fetch([{ offset: r, length: n }], o))[0];
    let I;
    return a === null || !a[w] ? (I = (async () => {
      let B = await s.decode(this.fileDirectory, f);
      const y = this.getSampleFormat(), c = this.getBitsPerSample();
      return kr(y, c) && (B = Fr(
        B,
        y,
        this.planarConfiguration,
        this.getSamplesPerPixel(),
        c,
        this.getTileWidth(),
        this.getBlockHeight(A)
      )), B;
    })(), a !== null && (a[w] = I)) : I = a[w], { x: e, y: A, sample: i, data: await I };
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
  async _readRaster(e, A, i, s, o, C, g, w, a) {
    const r = this.getTileWidth(), n = this.getTileHeight(), f = this.getWidth(), I = this.getHeight(), B = Math.max(Math.floor(e[0] / r), 0), y = Math.min(
      Math.ceil(e[2] / r),
      Math.ceil(f / r)
    ), c = Math.max(Math.floor(e[1] / n), 0), E = Math.min(
      Math.ceil(e[3] / n),
      Math.ceil(I / n)
    ), d = e[2] - e[0];
    let p = this.getBytesPerPixel();
    const u = [], Q = [];
    for (let D = 0; D < A.length; ++D)
      this.planarConfiguration === 1 ? u.push(mr(this.fileDirectory.BitsPerSample, 0, A[D]) / 8) : u.push(0), Q.push(this.getReaderForSample(A[D]));
    const l = [], { littleEndian: h } = this;
    for (let D = c; D < E; ++D)
      for (let k = B; k < y; ++k) {
        let S;
        this.planarConfiguration === 1 && (S = this.getTileOrStrip(k, D, 0, o, a));
        for (let G = 0; G < A.length; ++G) {
          const x = G, b = A[G];
          this.planarConfiguration === 2 && (p = this.getSampleByteSize(b), S = this.getTileOrStrip(k, D, b, o, a));
          const R = S.then((F) => {
            const m = F.data, U = new DataView(m), N = this.getBlockHeight(F.y), v = F.y * n, M = F.x * r, L = v + N, T = (F.x + 1) * r, K = Q[x], q = Math.min(N, N - (L - e[3]), I - v), J = Math.min(r, r - (T - e[2]), f - M);
            for (let Y = Math.max(0, e[1] - v); Y < q; ++Y)
              for (let O = Math.max(0, e[0] - M); O < J; ++O) {
                const _ = (Y * r + O) * p, V = K.call(
                  U,
                  _ + u[x],
                  h
                );
                let X;
                s ? (X = (Y + v - e[1]) * d * A.length + (O + M - e[0]) * A.length + x, i[X] = V) : (X = (Y + v - e[1]) * d + O + M - e[0], i[x][X] = V);
              }
          });
          l.push(R);
        }
      }
    if (await Promise.all(l), C && e[2] - e[0] !== C || g && e[3] - e[1] !== g) {
      let D;
      return s ? D = pr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        C,
        g,
        A.length,
        w
      ) : D = wr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        C,
        g,
        w
      ), D.width = C, D.height = g, D;
    }
    return i.width = C || e[2] - e[0], i.height = g || e[3] - e[1], i;
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
    samples: A = [],
    interleave: i,
    pool: s = null,
    width: o,
    height: C,
    resampleMethod: g,
    fillValue: w,
    signal: a
  } = {}) {
    const r = e || [0, 0, this.getWidth(), this.getHeight()];
    if (r[0] > r[2] || r[1] > r[3])
      throw new Error("Invalid subsets");
    const n = r[2] - r[0], f = r[3] - r[1], I = n * f, B = this.getSamplesPerPixel();
    if (!A || !A.length)
      for (let d = 0; d < B; ++d)
        A.push(d);
    else
      for (let d = 0; d < A.length; ++d)
        if (A[d] >= B)
          return Promise.reject(new RangeError(`Invalid sample index '${A[d]}'.`));
    let y;
    if (i) {
      const d = this.fileDirectory.SampleFormat ? Math.max.apply(null, this.fileDirectory.SampleFormat) : 1, p = Math.max.apply(null, this.fileDirectory.BitsPerSample);
      y = me(d, p, I * A.length), w && y.fill(w);
    } else {
      y = [];
      for (let d = 0; d < A.length; ++d) {
        const p = this.getArrayForSample(A[d], I);
        Array.isArray(w) && d < w.length ? p.fill(w[d]) : w && !Array.isArray(w) && p.fill(w), y.push(p);
      }
    }
    const c = s || await ii(this.fileDirectory);
    return await this._readRaster(
      r,
      A,
      y,
      i,
      c,
      o,
      C,
      g,
      a
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
    interleave: A = !0,
    pool: i = null,
    width: s,
    height: o,
    resampleMethod: C,
    enableAlpha: g = !1,
    signal: w
  } = {}) {
    const a = e || [0, 0, this.getWidth(), this.getHeight()];
    if (a[0] > a[2] || a[1] > a[3])
      throw new Error("Invalid subsets");
    const r = this.fileDirectory.PhotometricInterpretation;
    if (r === W.RGB) {
      let E = [0, 1, 2];
      if (this.fileDirectory.ExtraSamples !== ar.Unspecified && g) {
        E = [];
        for (let d = 0; d < this.fileDirectory.BitsPerSample.length; d += 1)
          E.push(d);
      }
      return this.readRasters({
        window: e,
        interleave: A,
        samples: E,
        pool: i,
        width: s,
        height: o,
        resampleMethod: C,
        signal: w
      });
    }
    let n;
    switch (r) {
      case W.WhiteIsZero:
      case W.BlackIsZero:
      case W.Palette:
        n = [0];
        break;
      case W.CMYK:
        n = [0, 1, 2, 3];
        break;
      case W.YCbCr:
      case W.CIELab:
        n = [0, 1, 2];
        break;
      default:
        throw new Error("Invalid or unsupported photometric interpretation.");
    }
    const f = {
      window: a,
      interleave: !0,
      samples: n,
      pool: i,
      width: s,
      height: o,
      resampleMethod: C,
      signal: w
    }, { fileDirectory: I } = this, B = await this.readRasters(f), y = 2 ** this.fileDirectory.BitsPerSample[0];
    let c;
    switch (r) {
      case W.WhiteIsZero:
        c = Ir(B, y);
        break;
      case W.BlackIsZero:
        c = Br(B, y);
        break;
      case W.Palette:
        c = Cr(B, I.ColorMap);
        break;
      case W.CMYK:
        c = fr(B);
        break;
      case W.YCbCr:
        c = lr(B);
        break;
      case W.CIELab:
        c = hr(B);
        break;
      default:
        throw new Error("Unsupported photometric interpretation.");
    }
    if (!A) {
      const E = new Uint8Array(c.length / 3), d = new Uint8Array(c.length / 3), p = new Uint8Array(c.length / 3);
      for (let u = 0, Q = 0; u < c.length; u += 3, ++Q)
        E[Q] = c[u], d[Q] = c[u + 1], p[Q] = c[u + 2];
      c = [E, d, p];
    }
    return c.width = B.width, c.height = B.height, c;
  }
  /**
   * Returns an array of tiepoints.
   * @returns {Object[]}
   */
  getTiePoints() {
    if (!this.fileDirectory.ModelTiepoint)
      return [];
    const e = [];
    for (let A = 0; A < this.fileDirectory.ModelTiepoint.length; A += 6)
      e.push({
        i: this.fileDirectory.ModelTiepoint[A],
        j: this.fileDirectory.ModelTiepoint[A + 1],
        k: this.fileDirectory.ModelTiepoint[A + 2],
        x: this.fileDirectory.ModelTiepoint[A + 3],
        y: this.fileDirectory.ModelTiepoint[A + 4],
        z: this.fileDirectory.ModelTiepoint[A + 5]
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
    const A = {};
    if (!this.fileDirectory.GDAL_METADATA)
      return null;
    const i = this.fileDirectory.GDAL_METADATA;
    let s = nr(i, "Item");
    e === null ? s = s.filter((o) => ae(o, "sample") === void 0) : s = s.filter((o) => Number(ae(o, "sample")) === e);
    for (let o = 0; o < s.length; ++o) {
      const C = s[o];
      A[ae(C, "name")] = C.inner;
    }
    return A;
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
    const e = this.fileDirectory.ModelTiepoint, A = this.fileDirectory.ModelTransformation;
    if (e && e.length === 6)
      return [
        e[3],
        e[4],
        e[5]
      ];
    if (A)
      return [
        A[3],
        A[7],
        A[11]
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
    const A = this.fileDirectory.ModelPixelScale, i = this.fileDirectory.ModelTransformation;
    if (A)
      return [
        A[0],
        -A[1],
        A[2]
      ];
    if (i)
      return i[1] === 0 && i[4] === 0 ? [
        i[0],
        -i[5],
        i[10]
      ] : [
        Math.sqrt(i[0] * i[0] + i[4] * i[4]),
        -Math.sqrt(i[1] * i[1] + i[5] * i[5]),
        i[10]
      ];
    if (e) {
      const [s, o, C] = e.getResolution();
      return [
        s * e.getWidth() / this.getWidth(),
        o * e.getHeight() / this.getHeight(),
        C * e.getWidth() / this.getWidth()
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
    const A = this.getHeight(), i = this.getWidth();
    if (this.fileDirectory.ModelTransformation && !e) {
      const [s, o, C, g, w, a, r, n] = this.fileDirectory.ModelTransformation, I = [
        [0, 0],
        [0, A],
        [i, 0],
        [i, A]
      ].map(([c, E]) => [
        g + s * c + o * E,
        n + w * c + a * E
      ]), B = I.map((c) => c[0]), y = I.map((c) => c[1]);
      return [
        Math.min(...B),
        Math.min(...y),
        Math.max(...B),
        Math.max(...y)
      ];
    } else {
      const s = this.getOrigin(), o = this.getResolution(), C = s[0], g = s[1], w = C + o[0] * i, a = g + o[1] * A;
      return [
        Math.min(C, w),
        Math.min(g, a),
        Math.max(C, w),
        Math.max(g, a)
      ];
    }
  }
}
class Sr {
  constructor(e) {
    this._dataView = new DataView(e);
  }
  get buffer() {
    return this._dataView.buffer;
  }
  getUint64(e, A) {
    const i = this.getUint32(e, A), s = this.getUint32(e + 4, A);
    let o;
    if (A) {
      if (o = i + 2 ** 32 * s, !Number.isSafeInteger(o))
        throw new Error(
          `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return o;
    }
    if (o = 2 ** 32 * i + s, !Number.isSafeInteger(o))
      throw new Error(
        `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return o;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  getInt64(e, A) {
    let i = 0;
    const s = (this._dataView.getUint8(e + (A ? 7 : 0)) & 128) > 0;
    let o = !0;
    for (let C = 0; C < 8; C++) {
      let g = this._dataView.getUint8(e + (A ? C : 7 - C));
      s && (o ? g !== 0 && (g = ~(g - 1) & 255, o = !1) : g = ~g & 255), i += g * 256 ** C;
    }
    return s && (i = -i), i;
  }
  getUint8(e, A) {
    return this._dataView.getUint8(e, A);
  }
  getInt8(e, A) {
    return this._dataView.getInt8(e, A);
  }
  getUint16(e, A) {
    return this._dataView.getUint16(e, A);
  }
  getInt16(e, A) {
    return this._dataView.getInt16(e, A);
  }
  getUint32(e, A) {
    return this._dataView.getUint32(e, A);
  }
  getInt32(e, A) {
    return this._dataView.getInt32(e, A);
  }
  getFloat16(e, A) {
    return jt(this._dataView, e, A);
  }
  getFloat32(e, A) {
    return this._dataView.getFloat32(e, A);
  }
  getFloat64(e, A) {
    return this._dataView.getFloat64(e, A);
  }
}
class xr {
  constructor(e, A, i, s) {
    this._dataView = new DataView(e), this._sliceOffset = A, this._littleEndian = i, this._bigTiff = s;
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
  covers(e, A) {
    return this.sliceOffset <= e && this.sliceTop >= e + A;
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
    const A = this.readUint32(e), i = this.readUint32(e + 4);
    let s;
    if (this._littleEndian) {
      if (s = A + 2 ** 32 * i, !Number.isSafeInteger(s))
        throw new Error(
          `${s} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return s;
    }
    if (s = 2 ** 32 * A + i, !Number.isSafeInteger(s))
      throw new Error(
        `${s} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return s;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  readInt64(e) {
    let A = 0;
    const i = (this._dataView.getUint8(e + (this._littleEndian ? 7 : 0)) & 128) > 0;
    let s = !0;
    for (let o = 0; o < 8; o++) {
      let C = this._dataView.getUint8(
        e + (this._littleEndian ? o : 7 - o)
      );
      i && (s ? C !== 0 && (C = ~(C - 1) & 255, s = !1) : C = ~C & 255), A += C * 256 ** o;
    }
    return i && (A = -A), A;
  }
  readOffset(e) {
    return this._bigTiff ? this.readUint64(e) : this.readUint32(e);
  }
}
const br = typeof navigator < "u" && navigator.hardwareConcurrency || 2;
class Rr {
  /**
   * @constructor
   * @param {Number} [size] The size of the pool. Defaults to the number of CPUs
   *                      available. When this parameter is `null` or 0, then the
   *                      decoding will be done in the main thread.
   * @param {function(): Worker} [createWorker] A function that creates the decoder worker.
   * Defaults to a worker with all decoders that ship with geotiff.js. The `createWorker()`
   * function is expected to return a `Worker` compatible with Web Workers. For code that
   * runs in Node, [web-worker](https://www.npmjs.com/package/web-worker) is a good choice.
   *
   * A worker that uses a custom lzw decoder would look like this `my-custom-worker.js` file:
   * ```js
   * import { addDecoder, getDecoder } from 'geotiff';
   * addDecoder(5, () => import ('./my-custom-lzw').then((m) => m.default));
   * self.addEventListener('message', async (e) => {
   *   const { id, fileDirectory, buffer } = e.data;
   *   const decoder = await getDecoder(fileDirectory);
   *   const decoded = await decoder.decode(fileDirectory, buffer);
   *   self.postMessage({ decoded, id }, [decoded]);
   * });
   * ```
   * The way the above code is built into a worker by the `createWorker()` function
   * depends on the used bundler. For most bundlers, something like this will work:
   * ```js
   * function createWorker() {
   *   return new Worker(new URL('./my-custom-worker.js', import.meta.url));
   * }
   * ```
   */
  constructor(e = br, A) {
    this.workers = null, this._awaitingDecoder = null, this.size = e, this.messageId = 0, e && (this._awaitingDecoder = A ? Promise.resolve(A) : new Promise((i) => {
      Promise.resolve().then(() => na).then((s) => {
        i(s.create);
      });
    }), this._awaitingDecoder.then((i) => {
      this._awaitingDecoder = null, this.workers = [];
      for (let s = 0; s < e; s++)
        this.workers.push({ worker: i(), idle: !0 });
    }));
  }
  /**
   * Decode the given block of bytes with the set compression method.
   * @param {ArrayBuffer} buffer the array buffer of bytes to decode.
   * @returns {Promise<ArrayBuffer>} the decoded result as a `Promise`
   */
  async decode(e, A) {
    return this._awaitingDecoder && await this._awaitingDecoder, this.size === 0 ? ii(e).then((i) => i.decode(e, A)) : new Promise((i) => {
      const s = this.workers.find((g) => g.idle) || this.workers[Math.floor(Math.random() * this.size)];
      s.idle = !1;
      const o = this.messageId++, C = (g) => {
        g.data.id === o && (s.idle = !0, i(g.data.decoded), s.worker.removeEventListener("message", C));
      };
      s.worker.addEventListener("message", C), s.worker.postMessage({ fileDirectory: e, buffer: A, id: o }, [A]);
    });
  }
  destroy() {
    this.workers && (this.workers.forEach((e) => {
      e.worker.terminate();
    }), this.workers = null);
  }
}
const At = `\r
\r
`;
function ri(t) {
  if (typeof Object.fromEntries < "u")
    return Object.fromEntries(t);
  const e = {};
  for (const [A, i] of t)
    e[A.toLowerCase()] = i;
  return e;
}
function vr(t) {
  const e = t.split(`\r
`).map((A) => {
    const i = A.split(":").map((s) => s.trim());
    return i[0] = i[0].toLowerCase(), i;
  });
  return ri(e);
}
function Ur(t) {
  const [e, ...A] = t.split(";").map((s) => s.trim()), i = A.map((s) => s.split("="));
  return { type: e, params: ri(i) };
}
function ke(t) {
  let e, A, i;
  return t && ([, e, A, i] = t.match(/bytes (\d+)-(\d+)\/(\d+)/), e = parseInt(e, 10), A = parseInt(A, 10), i = parseInt(i, 10)), { start: e, end: A, total: i };
}
function Lr(t, e) {
  let A = null;
  const i = new TextDecoder("ascii"), s = [], o = `--${e}`, C = `${o}--`;
  for (let g = 0; g < 10; ++g)
    i.decode(
      new Uint8Array(t, g, o.length)
    ) === o && (A = g);
  if (A === null)
    throw new Error("Could not find initial boundary");
  for (; A < t.byteLength; ) {
    const g = i.decode(
      new Uint8Array(
        t,
        A,
        Math.min(o.length + 1024, t.byteLength - A)
      )
    );
    if (g.length === 0 || g.startsWith(C))
      break;
    if (!g.startsWith(o))
      throw new Error("Part does not start with boundary");
    const w = g.substr(o.length + 2);
    if (w.length === 0)
      break;
    const a = w.indexOf(At), r = vr(w.substr(0, a)), { start: n, end: f, total: I } = ke(r["content-range"]), B = A + o.length + a + At.length, y = parseInt(f, 10) + 1 - parseInt(n, 10);
    s.push({
      headers: r,
      data: t.slice(B, B + y),
      offset: n,
      length: y,
      fileSize: I
    }), A = B + y + 4;
  }
  return s;
}
class te {
  /**
   *
   * @param {Slice[]} slices
   * @returns {ArrayBuffer[]}
   */
  async fetch(e, A = void 0) {
    return Promise.all(
      e.map((i) => this.fetchSlice(i, A))
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
class Mr extends Map {
  constructor(e = {}) {
    if (super(), !(e.maxSize && e.maxSize > 0))
      throw new TypeError("`maxSize` must be a number greater than 0");
    if (typeof e.maxAge == "number" && e.maxAge === 0)
      throw new TypeError("`maxAge` must be a number greater than 0");
    this.maxSize = e.maxSize, this.maxAge = e.maxAge || Number.POSITIVE_INFINITY, this.onEviction = e.onEviction, this.cache = /* @__PURE__ */ new Map(), this.oldCache = /* @__PURE__ */ new Map(), this._size = 0;
  }
  // TODO: Use private class methods when targeting Node.js 16.
  _emitEvictions(e) {
    if (typeof this.onEviction == "function")
      for (const [A, i] of e)
        this.onEviction(A, i.value);
  }
  _deleteIfExpired(e, A) {
    return typeof A.expiry == "number" && A.expiry <= Date.now() ? (typeof this.onEviction == "function" && this.onEviction(e, A.value), this.delete(e)) : !1;
  }
  _getOrDeleteIfExpired(e, A) {
    if (this._deleteIfExpired(e, A) === !1)
      return A.value;
  }
  _getItemValue(e, A) {
    return A.expiry ? this._getOrDeleteIfExpired(e, A) : A.value;
  }
  _peek(e, A) {
    const i = A.get(e);
    return this._getItemValue(e, i);
  }
  _set(e, A) {
    this.cache.set(e, A), this._size++, this._size >= this.maxSize && (this._size = 0, this._emitEvictions(this.oldCache), this.oldCache = this.cache, this.cache = /* @__PURE__ */ new Map());
  }
  _moveToRecent(e, A) {
    this.oldCache.delete(e), this._set(e, A);
  }
  *_entriesAscending() {
    for (const e of this.oldCache) {
      const [A, i] = e;
      this.cache.has(A) || this._deleteIfExpired(A, i) === !1 && (yield e);
    }
    for (const e of this.cache) {
      const [A, i] = e;
      this._deleteIfExpired(A, i) === !1 && (yield e);
    }
  }
  get(e) {
    if (this.cache.has(e)) {
      const A = this.cache.get(e);
      return this._getItemValue(e, A);
    }
    if (this.oldCache.has(e)) {
      const A = this.oldCache.get(e);
      if (this._deleteIfExpired(e, A) === !1)
        return this._moveToRecent(e, A), A.value;
    }
  }
  set(e, A, { maxAge: i = this.maxAge } = {}) {
    const s = typeof i == "number" && i !== Number.POSITIVE_INFINITY ? Date.now() + i : void 0;
    return this.cache.has(e) ? this.cache.set(e, {
      value: A,
      expiry: s
    }) : this._set(e, { value: A, expiry: s }), this;
  }
  has(e) {
    return this.cache.has(e) ? !this._deleteIfExpired(e, this.cache.get(e)) : this.oldCache.has(e) ? !this._deleteIfExpired(e, this.oldCache.get(e)) : !1;
  }
  peek(e) {
    if (this.cache.has(e))
      return this._peek(e, this.cache);
    if (this.oldCache.has(e))
      return this._peek(e, this.oldCache);
  }
  delete(e) {
    const A = this.cache.delete(e);
    return A && this._size--, this.oldCache.delete(e) || A;
  }
  clear() {
    this.cache.clear(), this.oldCache.clear(), this._size = 0;
  }
  resize(e) {
    if (!(e && e > 0))
      throw new TypeError("`maxSize` must be a number greater than 0");
    const A = [...this._entriesAscending()], i = A.length - e;
    i < 0 ? (this.cache = new Map(A), this.oldCache = /* @__PURE__ */ new Map(), this._size = A.length) : (i > 0 && this._emitEvictions(A.slice(0, i)), this.oldCache = new Map(A.slice(i)), this.cache = /* @__PURE__ */ new Map(), this._size = 0), this.maxSize = e;
  }
  *keys() {
    for (const [e] of this)
      yield e;
  }
  *values() {
    for (const [, e] of this)
      yield e;
  }
  *[Symbol.iterator]() {
    for (const e of this.cache) {
      const [A, i] = e;
      this._deleteIfExpired(A, i) === !1 && (yield [A, i.value]);
    }
    for (const e of this.oldCache) {
      const [A, i] = e;
      this.cache.has(A) || this._deleteIfExpired(A, i) === !1 && (yield [A, i.value]);
    }
  }
  *entriesDescending() {
    let e = [...this.cache];
    for (let A = e.length - 1; A >= 0; --A) {
      const i = e[A], [s, o] = i;
      this._deleteIfExpired(s, o) === !1 && (yield [s, o.value]);
    }
    e = [...this.oldCache];
    for (let A = e.length - 1; A >= 0; --A) {
      const i = e[A], [s, o] = i;
      this.cache.has(s) || this._deleteIfExpired(s, o) === !1 && (yield [s, o.value]);
    }
  }
  *entriesAscending() {
    for (const [e, A] of this._entriesAscending())
      yield [e, A.value];
  }
  get size() {
    if (!this._size)
      return this.oldCache.size;
    let e = 0;
    for (const A of this.oldCache.keys())
      this.cache.has(A) || e++;
    return Math.min(this._size + e, this.maxSize);
  }
  entries() {
    return this.entriesAscending();
  }
  forEach(e, A = this) {
    for (const [i, s] of this.entriesAscending())
      e.call(A, s, i, this);
  }
  get [Symbol.toStringTag]() {
    return JSON.stringify([...this.entriesAscending()]);
  }
}
async function Nr(t) {
  return new Promise((e) => setTimeout(e, t));
}
function qr(t, e) {
  const A = Array.isArray(t) ? t : Array.from(t), i = Array.isArray(e) ? e : Array.from(e);
  return A.map((s, o) => [s, i[o]]);
}
class hA extends Error {
  constructor(e) {
    super(e), Error.captureStackTrace && Error.captureStackTrace(this, hA), this.name = "AbortError";
  }
}
class Tr extends Error {
  constructor(e, A) {
    super(A), this.errors = e, this.message = A, this.name = "AggregateError";
  }
}
const Jr = Tr;
class Yr {
  /**
   *
   * @param {number} offset
   * @param {number} length
   * @param {ArrayBuffer} [data]
   */
  constructor(e, A, i = null) {
    this.offset = e, this.length = A, this.data = i;
  }
  /**
   * @returns {number} the top byte border
   */
  get top() {
    return this.offset + this.length;
  }
}
class et {
  /**
   *
   * @param {number} offset
   * @param {number} length
   * @param {number[]} blockIds
   */
  constructor(e, A, i) {
    this.offset = e, this.length = A, this.blockIds = i;
  }
}
class Hr extends te {
  /**
   *
   * @param {BaseSource} source The underlying source that shall be blocked and cached
   * @param {object} options
   * @param {number} [options.blockSize]
   * @param {number} [options.cacheSize]
   */
  constructor(e, { blockSize: A = 65536, cacheSize: i = 100 } = {}) {
    super(), this.source = e, this.blockSize = A, this.blockCache = new Mr({
      maxSize: i,
      onEviction: (s, o) => {
        this.evictedBlocks.set(s, o);
      }
    }), this.evictedBlocks = /* @__PURE__ */ new Map(), this.blockRequests = /* @__PURE__ */ new Map(), this.blockIdsToFetch = /* @__PURE__ */ new Set(), this.abortedBlockIds = /* @__PURE__ */ new Set();
  }
  get fileSize() {
    return this.source.fileSize;
  }
  /**
   *
   * @param {import("./basesource").Slice[]} slices
   */
  async fetch(e, A) {
    const i = [], s = [], o = [];
    this.evictedBlocks.clear();
    for (const { offset: f, length: I } of e) {
      let B = f + I;
      const { fileSize: y } = this;
      y !== null && (B = Math.min(B, y));
      const c = Math.floor(f / this.blockSize) * this.blockSize;
      for (let E = c; E < B; E += this.blockSize) {
        const d = Math.floor(E / this.blockSize);
        !this.blockCache.has(d) && !this.blockRequests.has(d) && (this.blockIdsToFetch.add(d), s.push(d)), this.blockRequests.has(d) && i.push(this.blockRequests.get(d)), o.push(d);
      }
    }
    await Nr(), this.fetchBlocks(A);
    const C = [];
    for (const f of s)
      this.blockRequests.has(f) && C.push(this.blockRequests.get(f));
    await Promise.allSettled(i), await Promise.allSettled(C);
    const g = [], w = o.filter((f) => this.abortedBlockIds.has(f) || !this.blockCache.has(f));
    if (w.forEach((f) => this.blockIdsToFetch.add(f)), w.length > 0 && A && !A.aborted) {
      this.fetchBlocks(null);
      for (const f of w) {
        const I = this.blockRequests.get(f);
        if (!I)
          throw new Error(`Block ${f} is not in the block requests`);
        g.push(I);
      }
      await Promise.allSettled(g);
    }
    if (A && A.aborted)
      throw new hA("Request was aborted");
    const a = o.map((f) => this.blockCache.get(f) || this.evictedBlocks.get(f)), r = a.filter((f) => !f);
    if (r.length)
      throw new Jr(r, "Request failed");
    const n = new Map(qr(o, a));
    return this.readSliceData(e, n);
  }
  /**
   *
   * @param {AbortSignal} signal
   */
  fetchBlocks(e) {
    if (this.blockIdsToFetch.size > 0) {
      const A = this.groupBlocks(this.blockIdsToFetch), i = this.source.fetch(A, e);
      for (let s = 0; s < A.length; ++s) {
        const o = A[s];
        for (const C of o.blockIds)
          this.blockRequests.set(C, (async () => {
            try {
              const g = (await i)[s], w = C * this.blockSize, a = w - g.offset, r = Math.min(a + this.blockSize, g.data.byteLength), n = g.data.slice(a, r), f = new Yr(
                w,
                n.byteLength,
                n,
                C
              );
              this.blockCache.set(C, f), this.abortedBlockIds.delete(C);
            } catch (g) {
              if (g.name === "AbortError")
                g.signal = e, this.blockCache.delete(C), this.abortedBlockIds.add(C);
              else
                throw g;
            } finally {
              this.blockRequests.delete(C);
            }
          })());
      }
      this.blockIdsToFetch.clear();
    }
  }
  /**
   *
   * @param {Set} blockIds
   * @returns {BlockGroup[]}
   */
  groupBlocks(e) {
    const A = Array.from(e).sort((C, g) => C - g);
    if (A.length === 0)
      return [];
    let i = [], s = null;
    const o = [];
    for (const C of A)
      s === null || s + 1 === C ? (i.push(C), s = C) : (o.push(new et(
        i[0] * this.blockSize,
        i.length * this.blockSize,
        i
      )), i = [C], s = C);
    return o.push(new et(
      i[0] * this.blockSize,
      i.length * this.blockSize,
      i
    )), o;
  }
  /**
   *
   * @param {import("./basesource").Slice[]} slices
   * @param {Map} blocks
   */
  readSliceData(e, A) {
    return e.map((i) => {
      let s = i.offset + i.length;
      this.fileSize !== null && (s = Math.min(this.fileSize, s));
      const o = Math.floor(i.offset / this.blockSize), C = Math.floor(s / this.blockSize), g = new ArrayBuffer(i.length), w = new Uint8Array(g);
      for (let a = o; a <= C; ++a) {
        const r = A.get(a), n = r.offset - i.offset, f = r.top - s;
        let I = 0, B = 0, y;
        n < 0 ? I = -n : n > 0 && (B = n), f < 0 ? y = r.length - I : y = s - r.offset - I;
        const c = new Uint8Array(r.data, I, y);
        w.set(c, B);
      }
      return g;
    });
  }
}
class Ve {
  /**
   * Returns whether the response has an ok'ish status code
   */
  get ok() {
    return this.status >= 200 && this.status <= 299;
  }
  /**
   * Returns the status code of the response
   */
  get status() {
    throw new Error("not implemented");
  }
  /**
   * Returns the value of the specified header
   * @param {string} headerName the header name
   * @returns {string} the header value
   */
  getHeader(e) {
    throw new Error("not implemented");
  }
  /**
   * @returns {ArrayBuffer} the response data of the request
   */
  async getData() {
    throw new Error("not implemented");
  }
}
class Xe {
  constructor(e) {
    this.url = e;
  }
  /**
   * Send a request with the options
   * @param {{headers: HeadersInit, signal: AbortSignal}} [options={}]
   * @returns {Promise<BaseResponse>}
   */
  async request({ headers: e, signal: A } = {}) {
    throw new Error("request is not implemented");
  }
}
class Kr extends Ve {
  /**
   * BaseResponse facade for fetch API Response
   * @param {Response} response
   */
  constructor(e) {
    super(), this.response = e;
  }
  get status() {
    return this.response.status;
  }
  getHeader(e) {
    return this.response.headers.get(e);
  }
  async getData() {
    return this.response.arrayBuffer ? await this.response.arrayBuffer() : (await this.response.buffer()).buffer;
  }
}
class Or extends Xe {
  constructor(e, A) {
    super(e), this.credentials = A;
  }
  /**
   * @param {{headers: HeadersInit, signal: AbortSignal}} [options={}]
   * @returns {Promise<FetchResponse>}
   */
  async request({ headers: e, signal: A } = {}) {
    const i = await fetch(this.url, {
      headers: e,
      credentials: this.credentials,
      signal: A
    });
    return new Kr(i);
  }
}
class _r extends Ve {
  /**
   * BaseResponse facade for XMLHttpRequest
   * @param {XMLHttpRequest} xhr
   * @param {ArrayBuffer} data
   */
  constructor(e, A) {
    super(), this.xhr = e, this.data = A;
  }
  get status() {
    return this.xhr.status;
  }
  getHeader(e) {
    return this.xhr.getResponseHeader(e);
  }
  async getData() {
    return this.data;
  }
}
class Pr extends Xe {
  constructRequest(e, A) {
    return new Promise((i, s) => {
      const o = new XMLHttpRequest();
      o.open("GET", this.url), o.responseType = "arraybuffer";
      for (const [C, g] of Object.entries(e))
        o.setRequestHeader(C, g);
      o.onload = () => {
        const C = o.response;
        i(new _r(o, C));
      }, o.onerror = s, o.onabort = () => s(new hA("Request aborted")), o.send(), A && (A.aborted && o.abort(), A.addEventListener("abort", () => o.abort()));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
const Be = {};
class Vr extends Ve {
  /**
   * BaseResponse facade for node HTTP/HTTPS API Response
   * @param {http.ServerResponse} response
   */
  constructor(e, A) {
    super(), this.response = e, this.dataPromise = A;
  }
  get status() {
    return this.response.statusCode;
  }
  getHeader(e) {
    return this.response.headers[e];
  }
  async getData() {
    return await this.dataPromise;
  }
}
class Xr extends Xe {
  constructor(e) {
    super(e), this.parsedUrl = Be.parse(this.url), this.httpApi = (this.parsedUrl.protocol === "http:", Be);
  }
  constructRequest(e, A) {
    return new Promise((i, s) => {
      const o = this.httpApi.get(
        {
          ...this.parsedUrl,
          headers: e
        },
        (C) => {
          const g = new Promise((w) => {
            const a = [];
            C.on("data", (r) => {
              a.push(r);
            }), C.on("end", () => {
              const r = Buffer.concat(a).buffer;
              w(r);
            }), C.on("error", s);
          });
          i(new Vr(C, g));
        }
      );
      o.on("error", s), A && (A.aborted && o.destroy(new hA("Request aborted")), A.addEventListener("abort", () => o.destroy(new hA("Request aborted"))));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
class je extends te {
  /**
   *
   * @param {BaseClient} client
   * @param {object} headers
   * @param {numbers} maxRanges
   * @param {boolean} allowFullFile
   */
  constructor(e, A, i, s) {
    super(), this.client = e, this.headers = A, this.maxRanges = i, this.allowFullFile = s, this._fileSize = null;
  }
  /**
   *
   * @param {Slice[]} slices
   */
  async fetch(e, A) {
    return this.maxRanges >= e.length ? this.fetchSlices(e, A) : (this.maxRanges > 0 && e.length > 1, Promise.all(
      e.map((i) => this.fetchSlice(i, A))
    ));
  }
  async fetchSlices(e, A) {
    const i = await this.client.request({
      headers: {
        ...this.headers,
        Range: `bytes=${e.map(({ offset: s, length: o }) => `${s}-${s + o}`).join(",")}`
      },
      signal: A
    });
    if (i.ok)
      if (i.status === 206) {
        const { type: s, params: o } = Ur(i.getHeader("content-type"));
        if (s === "multipart/byteranges") {
          const n = Lr(await i.getData(), o.boundary);
          return this._fileSize = n[0].fileSize || null, n;
        }
        const C = await i.getData(), { start: g, end: w, total: a } = ke(i.getHeader("content-range"));
        this._fileSize = a || null;
        const r = [{
          data: C,
          offset: g,
          length: w - g
        }];
        if (e.length > 1) {
          const n = await Promise.all(e.slice(1).map((f) => this.fetchSlice(f, A)));
          return r.concat(n);
        }
        return r;
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const s = await i.getData();
        return this._fileSize = s.byteLength, [{
          data: s,
          offset: 0,
          length: s.byteLength
        }];
      }
    else throw new Error("Error fetching data.");
  }
  async fetchSlice(e, A) {
    const { offset: i, length: s } = e, o = await this.client.request({
      headers: {
        ...this.headers,
        Range: `bytes=${i}-${i + s}`
      },
      signal: A
    });
    if (o.ok)
      if (o.status === 206) {
        const C = await o.getData(), { total: g } = ke(o.getHeader("content-range"));
        return this._fileSize = g || null, {
          data: C,
          offset: i,
          length: s
        };
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const C = await o.getData();
        return this._fileSize = C.byteLength, {
          data: C,
          offset: 0,
          length: C.byteLength
        };
      }
    else throw new Error("Error fetching data.");
  }
  get fileSize() {
    return this._fileSize;
  }
}
function We(t, { blockSize: e, cacheSize: A }) {
  return e === null ? t : new Hr(t, { blockSize: e, cacheSize: A });
}
function jr(t, { headers: e = {}, credentials: A, maxRanges: i = 0, allowFullFile: s = !1, ...o } = {}) {
  const C = new Or(t, A), g = new je(C, e, i, s);
  return We(g, o);
}
function Wr(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...s } = {}) {
  const o = new Pr(t), C = new je(o, e, A, i);
  return We(C, s);
}
function Zr(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...s } = {}) {
  const o = new Xr(t), C = new je(o, e, A, i);
  return We(C, s);
}
function zr(t, { forceXHR: e = !1, ...A } = {}) {
  return typeof fetch == "function" && !e ? jr(t, A) : typeof XMLHttpRequest < "u" ? Wr(t, A) : Zr(t, A);
}
class $r extends te {
  constructor(e) {
    super(), this.arrayBuffer = e;
  }
  fetchSlice(e, A) {
    if (A && A.aborted)
      throw new hA("Request aborted");
    return this.arrayBuffer.slice(e.offset, e.offset + e.length);
  }
}
function An(t) {
  return new $r(t);
}
class en extends te {
  constructor(e) {
    super(), this.file = e;
  }
  async fetchSlice(e, A) {
    return new Promise((i, s) => {
      const o = this.file.slice(e.offset, e.offset + e.length), C = new FileReader();
      C.onload = (g) => i(g.target.result), C.onerror = s, C.onabort = s, C.readAsArrayBuffer(o), A && A.addEventListener("abort", () => C.abort());
    });
  }
}
function tn(t) {
  return new en(t);
}
function rn(t, e) {
  let A = t.length - e, i = 0;
  do {
    for (let s = e; s > 0; s--)
      t[i + e] += t[i], i++;
    A -= e;
  } while (A > 0);
}
function nn(t, e, A) {
  let i = 0, s = t.length;
  const o = s / A;
  for (; s > e; ) {
    for (let g = e; g > 0; --g)
      t[i + e] += t[i], ++i;
    s -= e;
  }
  const C = t.slice();
  for (let g = 0; g < o; ++g)
    for (let w = 0; w < A; ++w)
      t[A * g + w] = C[(A - w - 1) * o + g];
}
function on(t, e, A, i, s, o) {
  if (e === 1)
    return t;
  for (let w = 0; w < s.length; ++w) {
    if (s[w] % 8 !== 0)
      throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");
    if (s[w] !== s[0])
      throw new Error("When decoding with predictor, all samples must have the same size.");
  }
  const C = s[0] / 8, g = o === 2 ? 1 : s.length;
  for (let w = 0; w < i && !(w * g * A * C >= t.byteLength); ++w) {
    let a;
    if (e === 2) {
      switch (s[0]) {
        case 8:
          a = new Uint8Array(
            t,
            w * g * A * C,
            g * A * C
          );
          break;
        case 16:
          a = new Uint16Array(
            t,
            w * g * A * C,
            g * A * C / 2
          );
          break;
        case 32:
          a = new Uint32Array(
            t,
            w * g * A * C,
            g * A * C / 4
          );
          break;
        default:
          throw new Error(`Predictor 2 not allowed with ${s[0]} bits per sample.`);
      }
      rn(a, g);
    } else e === 3 && (a = new Uint8Array(
      t,
      w * g * A * C,
      g * A * C
    ), nn(a, g, C));
  }
  return t;
}
class dA {
  async decode(e, A) {
    const i = await this.decodeBlock(A), s = e.Predictor || 1;
    if (s !== 1) {
      const o = !e.StripOffsets, C = o ? e.TileWidth : e.ImageWidth, g = o ? e.TileLength : e.RowsPerStrip || e.ImageLength;
      return on(
        i,
        s,
        C,
        g,
        e.BitsPerSample,
        e.PlanarConfiguration
      );
    }
    return i;
  }
}
function Fe(t) {
  switch (t) {
    case H.BYTE:
    case H.ASCII:
    case H.SBYTE:
    case H.UNDEFINED:
      return 1;
    case H.SHORT:
    case H.SSHORT:
      return 2;
    case H.LONG:
    case H.SLONG:
    case H.FLOAT:
    case H.IFD:
      return 4;
    case H.RATIONAL:
    case H.SRATIONAL:
    case H.DOUBLE:
    case H.LONG8:
    case H.SLONG8:
    case H.IFD8:
      return 8;
    default:
      throw new RangeError(`Invalid field type: ${t}`);
  }
}
function an(t) {
  const e = t.GeoKeyDirectory;
  if (!e)
    return null;
  const A = {};
  for (let i = 4; i <= e[3] * 4; i += 4) {
    const s = gr[e[i]], o = e[i + 1] ? bA[e[i + 1]] : null, C = e[i + 2], g = e[i + 3];
    let w = null;
    if (!o)
      w = g;
    else {
      if (w = t[o], typeof w > "u" || w === null)
        throw new Error(`Could not get value of geoKey '${s}'.`);
      typeof w == "string" ? w = w.substring(g, g + C - 1) : w.subarray && (w = w.subarray(g, g + C), C === 1 && (w = w[0]));
    }
    A[s] = w;
  }
  return A;
}
function yA(t, e, A, i) {
  let s = null, o = null;
  const C = Fe(e);
  switch (e) {
    case H.BYTE:
    case H.ASCII:
    case H.UNDEFINED:
      s = new Uint8Array(A), o = t.readUint8;
      break;
    case H.SBYTE:
      s = new Int8Array(A), o = t.readInt8;
      break;
    case H.SHORT:
      s = new Uint16Array(A), o = t.readUint16;
      break;
    case H.SSHORT:
      s = new Int16Array(A), o = t.readInt16;
      break;
    case H.LONG:
    case H.IFD:
      s = new Uint32Array(A), o = t.readUint32;
      break;
    case H.SLONG:
      s = new Int32Array(A), o = t.readInt32;
      break;
    case H.LONG8:
    case H.IFD8:
      s = new Array(A), o = t.readUint64;
      break;
    case H.SLONG8:
      s = new Array(A), o = t.readInt64;
      break;
    case H.RATIONAL:
      s = new Uint32Array(A * 2), o = t.readUint32;
      break;
    case H.SRATIONAL:
      s = new Int32Array(A * 2), o = t.readInt32;
      break;
    case H.FLOAT:
      s = new Float32Array(A), o = t.readFloat32;
      break;
    case H.DOUBLE:
      s = new Float64Array(A), o = t.readFloat64;
      break;
    default:
      throw new RangeError(`Invalid field type: ${e}`);
  }
  if (e === H.RATIONAL || e === H.SRATIONAL)
    for (let g = 0; g < A; g += 2)
      s[g] = o.call(
        t,
        i + g * C
      ), s[g + 1] = o.call(
        t,
        i + (g * C + 4)
      );
  else
    for (let g = 0; g < A; ++g)
      s[g] = o.call(
        t,
        i + g * C
      );
  return e === H.ASCII ? new TextDecoder("utf-8").decode(s) : s;
}
class sn {
  constructor(e, A, i) {
    this.fileDirectory = e, this.geoKeyDirectory = A, this.nextIFDByteOffset = i;
  }
}
class YA extends Error {
  constructor(e) {
    super(`No image at index ${e}`), this.index = e;
  }
}
class gn {
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
    const { window: A, width: i, height: s } = e;
    let { resX: o, resY: C, bbox: g } = e;
    const w = await this.getImage();
    let a = w;
    const r = await this.getImageCount(), n = w.getBoundingBox();
    if (A && g)
      throw new Error('Both "bbox" and "window" passed.');
    if (i || s) {
      if (A) {
        const [B, y] = w.getOrigin(), [c, E] = w.getResolution();
        g = [
          B + A[0] * c,
          y + A[1] * E,
          B + A[2] * c,
          y + A[3] * E
        ];
      }
      const I = g || n;
      if (i) {
        if (o)
          throw new Error("Both width and resX passed");
        o = (I[2] - I[0]) / i;
      }
      if (s) {
        if (C)
          throw new Error("Both width and resY passed");
        C = (I[3] - I[1]) / s;
      }
    }
    if (o || C) {
      const I = [];
      for (let B = 0; B < r; ++B) {
        const y = await this.getImage(B), { SubfileType: c, NewSubfileType: E } = y.fileDirectory;
        (B === 0 || c === 2 || E & 1) && I.push(y);
      }
      I.sort((B, y) => B.getWidth() - y.getWidth());
      for (let B = 0; B < I.length; ++B) {
        const y = I[B], c = (n[2] - n[0]) / y.getWidth(), E = (n[3] - n[1]) / y.getHeight();
        if (a = y, o && o > c || C && C > E)
          break;
      }
    }
    let f = A;
    if (g) {
      const [I, B] = w.getOrigin(), [y, c] = a.getResolution(w);
      f = [
        Math.round((g[0] - I) / y),
        Math.round((g[1] - B) / c),
        Math.round((g[2] - I) / y),
        Math.round((g[3] - B) / c)
      ], f = [
        Math.min(f[0], f[2]),
        Math.min(f[1], f[3]),
        Math.max(f[0], f[2]),
        Math.max(f[1], f[3])
      ];
    }
    return a.readRasters({ ...e, window: f });
  }
}
class TA extends gn {
  /**
   * @constructor
   * @param {*} source The datasource to read from.
   * @param {boolean} littleEndian Whether the image uses little endian.
   * @param {boolean} bigTiff Whether the image uses bigTIFF conventions.
   * @param {number} firstIFDOffset The numeric byte-offset from the start of the image
   *                                to the first IFD.
   * @param {GeoTIFFOptions} [options] further options.
   */
  constructor(e, A, i, s, o = {}) {
    super(), this.source = e, this.littleEndian = A, this.bigTiff = i, this.firstIFDOffset = s, this.cache = o.cache || !1, this.ifdRequests = [], this.ghostValues = null;
  }
  async getSlice(e, A) {
    const i = this.bigTiff ? 4048 : 1024;
    return new xr(
      (await this.source.fetch([{
        offset: e,
        length: typeof A < "u" ? A : i
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
    const A = this.bigTiff ? 20 : 12, i = this.bigTiff ? 8 : 2;
    let s = await this.getSlice(e);
    const o = this.bigTiff ? s.readUint64(e) : s.readUint16(e), C = o * A + (this.bigTiff ? 16 : 6);
    s.covers(e, C) || (s = await this.getSlice(e, C));
    const g = {};
    let w = e + (this.bigTiff ? 8 : 2);
    for (let n = 0; n < o; w += A, ++n) {
      const f = s.readUint16(w), I = s.readUint16(w + 2), B = this.bigTiff ? s.readUint64(w + 4) : s.readUint32(w + 4);
      let y, c;
      const E = Fe(I), d = w + (this.bigTiff ? 12 : 8);
      if (E * B <= (this.bigTiff ? 8 : 4))
        y = yA(s, I, B, d);
      else {
        const p = s.readOffset(d), u = Fe(I) * B;
        if (s.covers(p, u))
          y = yA(s, I, B, p);
        else {
          const Q = await this.getSlice(p, u);
          y = yA(Q, I, B, p);
        }
      }
      B === 1 && or.indexOf(f) === -1 && !(I === H.RATIONAL || I === H.SRATIONAL) ? c = y[0] : c = y, g[bA[f]] = c;
    }
    const a = an(g), r = s.readOffset(
      e + i + A * o
    );
    return new sn(
      g,
      a,
      r
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
      } catch (A) {
        throw A instanceof YA ? new YA(e) : A;
      }
    return this.ifdRequests[e] = (async () => {
      const A = await this.ifdRequests[e - 1];
      if (A.nextIFDByteOffset === 0)
        throw new YA(e);
      return this.parseFileDirectoryAt(A.nextIFDByteOffset);
    })(), this.ifdRequests[e];
  }
  /**
   * Get the n-th internal subfile of an image. By default, the first is returned.
   *
   * @param {number} [index=0] the index of the image to return.
   * @returns {Promise<GeoTIFFImage>} the image at the given index
   */
  async getImage(e = 0) {
    const A = await this.requestIFD(e);
    return new Gr(
      A.fileDirectory,
      A.geoKeyDirectory,
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
    let e = 0, A = !0;
    for (; A; )
      try {
        await this.requestIFD(e), ++e;
      } catch (i) {
        if (i instanceof YA)
          A = !1;
        else
          throw i;
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
    const A = "GDAL_STRUCTURAL_METADATA_SIZE=", i = A.length + 100;
    let s = await this.getSlice(e, i);
    if (A === yA(s, H.ASCII, A.length, e)) {
      const C = yA(s, H.ASCII, i, e).split(`
`)[0], g = Number(C.split("=")[1].split(" ")[0]) + C.length;
      g > i && (s = await this.getSlice(e, g));
      const w = yA(s, H.ASCII, g, e);
      this.ghostValues = {}, w.split(`
`).filter((a) => a.length > 0).map((a) => a.split("=")).forEach(([a, r]) => {
        this.ghostValues[a] = r;
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
  static async fromSource(e, A, i) {
    const s = (await e.fetch([{ offset: 0, length: 1024 }], i))[0], o = new Sr(s), C = o.getUint16(0, 0);
    let g;
    if (C === 18761)
      g = !0;
    else if (C === 19789)
      g = !1;
    else
      throw new TypeError("Invalid byte order value.");
    const w = o.getUint16(2, g);
    let a;
    if (w === 42)
      a = !1;
    else if (w === 43) {
      if (a = !0, o.getUint16(4, g) !== 8)
        throw new Error("Unsupported offset byte-size.");
    } else
      throw new TypeError("Invalid magic number.");
    const r = a ? o.getUint64(8, g) : o.getUint32(4, g);
    return new TA(e, g, a, r, A);
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
async function Ce(t, e = {}, A) {
  return TA.fromSource(zr(t, e), A);
}
async function tt(t, e) {
  return TA.fromSource(An(t), e);
}
async function RA(t, e) {
  return TA.fromSource(tn(t), e);
}
class fe {
  constructor() {
    this.promise = new Promise((e, A) => {
      this.reject = A, this.resolve = e;
    });
  }
}
const it = {};
function IA(t, e, A = "warn") {
  it[t] || (it[t] = !0, console[A](e));
}
const In = (t) => {
  var A, i, s;
  const e = /* @__PURE__ */ new Map();
  for (const o of t) {
    const C = new DOMParser().parseFromString(
      (A = o.fileDirectory) == null ? void 0 : A.ImageDescription,
      "text/xml"
    ), g = (i = C == null ? void 0 : C.querySelector("Name")) == null ? void 0 : i.textContent, w = (s = C == null ? void 0 : C.querySelector("Color")) == null ? void 0 : s.textContent;
    if (!g)
      continue;
    const a = w ? w.split(",").map((r) => parseInt(r)) : [255, 255, 255];
    e.has(g) || e.set(g, {
      name: g,
      color: a,
      images: []
    }), e.get(g).images.push(o);
  }
  return e;
};
class lA {
  static RGBAfromYCbCr(...e) {
    let A, i, s;
    if (e.length === 1) {
      const g = e[0], w = new Uint8ClampedArray(g.length * 4 / 3);
      for (let a = 0, r = 0; a < g.length; a += 3, r += 4)
        A = g[a], i = g[a + 1], s = g[a + 2], w[r] = A + 1.402 * (s - 128), w[r + 1] = A - 0.34414 * (i - 128) - 0.71414 * (s - 128), w[r + 2] = A + 1.772 * (i - 128), w[r + 3] = 255;
      return w;
    }
    [A, i, s] = e;
    const o = A.length, C = new Uint8ClampedArray(o * 4);
    for (let g = 0, w = 0; g < o; g++, w += 4) {
      const a = A[g], r = i[g], n = s[g];
      C[w] = a + 1.402 * (n - 128), C[w + 1] = a - 0.34414 * (r - 128) - 0.71414 * (n - 128), C[w + 2] = a + 1.772 * (r - 128), C[w + 3] = 255;
    }
    return C;
  }
  static RGBAfromRGB(...e) {
    if (e.length === 1) {
      const w = e[0], a = new Uint8ClampedArray(w.length * 4 / 3);
      for (let r = 0, n = 0; r < w.length; r += 3, n += 4)
        a[n] = w[r], a[n + 1] = w[r + 1], a[n + 2] = w[r + 2], a[n + 3] = 255;
      return a;
    }
    const A = e[0], i = e[1], s = e[2], o = e.length >= 4 ? e[3] : null, C = A.length, g = new Uint8ClampedArray(C * 4);
    for (let w = 0, a = 0; w < C; w++, a += 4)
      g[a] = A[w], g[a + 1] = i[w], g[a + 2] = s[w], g[a + 3] = o ? o[w] : 255;
    return g;
  }
  static RGBAfromWhiteIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let s;
    for (let o = 0, C = 0; o < e.length; ++o, C += 4)
      s = 256 - e[o] / A * 256, i[C] = s, i[C + 1] = s, i[C + 2] = s, i[C + 3] = 255;
    return i;
  }
  static RGBAfromBlackIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let s;
    for (let o = 0, C = 0; o < e.length; ++o, C += 4)
      s = e[o] / A * 256, i[C] = s, i[C + 1] = s, i[C + 2] = s, i[C + 3] = 255;
    return i;
  }
  static RGBAfromPalette(e, A) {
    const i = new Uint8ClampedArray(e.length * 4), s = A.length / 3, o = A.length / 3 * 2;
    for (let C = 0, g = 0; C < e.length; ++C, g += 4) {
      const w = e[C];
      i[g] = A[w] / 65536 * 256, i[g + 1] = A[w + s] / 65536 * 256, i[g + 2] = A[w + o] / 65536 * 256, i[g + 3] = 255;
    }
    return i;
  }
  static RGBAfromCMYK(...e) {
    if (e.length === 1) {
      const w = e[0], a = new Uint8ClampedArray(w.length);
      for (let r = 0, n = 0; r < w.length; r += 4, n += 4) {
        const f = w[r], I = w[r + 1], B = w[r + 2], y = w[r + 3];
        a[n] = 255 * ((255 - f) / 256) * ((255 - y) / 256), a[n + 1] = 255 * ((255 - I) / 256) * ((255 - y) / 256), a[n + 2] = 255 * ((255 - B) / 256) * ((255 - y) / 256), a[n + 3] = 255;
      }
      return a;
    }
    const A = e[0], i = e[1], s = e[2], o = e[3], C = A.length, g = new Uint8ClampedArray(C * 4);
    for (let w = 0, a = 0; w < C; w++, a += 4) {
      const r = A[w], n = i[w], f = s[w], I = o[w];
      g[a] = 255 * ((255 - r) / 256) * ((255 - I) / 256), g[a + 1] = 255 * ((255 - n) / 256) * ((255 - I) / 256), g[a + 2] = 255 * ((255 - f) / 256) * ((255 - I) / 256), g[a + 3] = 255;
    }
    return g;
  }
  static RGBAfromCIELab(...e) {
    const o = (n, f, I) => {
      const B = f << 24 >> 24, y = I << 24 >> 24;
      let c = (n + 16) / 116, E = B / 500 + c, d = c - y / 200;
      E = 0.95047 * (E * E * E > 8856e-6 ? E * E * E : (E - 0.13793103448275862) / 7.787), c = 1 * (c * c * c > 8856e-6 ? c * c * c : (c - 0.13793103448275862) / 7.787), d = 1.08883 * (d * d * d > 8856e-6 ? d * d * d : (d - 0.13793103448275862) / 7.787);
      let p = E * 3.2406 + c * -1.5372 + d * -0.4986, u = E * -0.9689 + c * 1.8758 + d * 0.0415, Q = E * 0.0557 + c * -0.204 + d * 1.057;
      return p = p > 31308e-7 ? 1.055 * p ** 0.4166666666666667 - 0.055 : 12.92 * p, u = u > 31308e-7 ? 1.055 * u ** 0.4166666666666667 - 0.055 : 12.92 * u, Q = Q > 31308e-7 ? 1.055 * Q ** 0.4166666666666667 - 0.055 : 12.92 * Q, [
        Math.max(0, Math.min(1, p)) * 255,
        Math.max(0, Math.min(1, u)) * 255,
        Math.max(0, Math.min(1, Q)) * 255
      ];
    };
    if (e.length === 1) {
      const n = e[0], f = new Uint8ClampedArray(n.length * 4 / 3);
      for (let I = 0, B = 0; I < n.length; I += 3, B += 4) {
        const [y, c, E] = o(n[I], n[I + 1], n[I + 2]);
        f[B] = y, f[B + 1] = c, f[B + 2] = E, f[B + 3] = 255;
      }
      return f;
    }
    const C = e[0], g = e[1], w = e[2], a = C.length, r = new Uint8ClampedArray(a * 4);
    for (let n = 0, f = 0; n < a; n++, f += 4) {
      const [I, B, y] = o(C[n], g[n], w[n]);
      r[f] = I, r[f + 1] = B, r[f + 2] = y, r[f + 3] = 255;
    }
    return r;
  }
}
const Bn = {
  interpretation: "auto",
  channels: null,
  gpu: {
    preferRGBA8: !0,
    forceRGBA16F: !1,
    packMode: "packsOf4"
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
};
function Cn() {
  let t, e;
  return { promise: new Promise((i, s) => {
    t = i, e = s;
  }), resolve: t, reject: e };
}
function fn(t) {
  try {
    return t ? typeof t == "string" ? t : t && typeof t.message == "string" ? t.message : JSON.stringify(t) : "Unknown error";
  } catch {
    return String(t);
  }
}
class Ge {
  constructor(e) {
    Object.assign(this, e);
  }
  getType() {
    return "gpuTextureSet";
  }
}
class ln {
  /**
   * @param {Object} params
   * @param {number} params.size
   * @param {() => Worker} params.createWorker
   */
  constructor({ size: e, createWorker: A }) {
    this.size = Math.max(1, e | 0), this.createWorker = A, this.workers = [], this._nextId = 1;
    for (let i = 0; i < this.size; i++) {
      const s = this.createWorker(), o = { worker: s, pending: 0, callbacks: /* @__PURE__ */ new Map() };
      s.onmessage = (C) => {
        const g = C.data || {};
        if (g.kind === "warn") {
          IA(
            g.code || "RawTiffWorker_warn",
            g.message || "[RawTiffWorker] warning",
            "warn"
          );
          return;
        }
        const w = g.id, a = o.callbacks.get(w);
        a && (o.callbacks.delete(w), o.pending = Math.max(0, o.pending - 1), g.ok ? a.resolve(g.result) : a.reject(new Error(fn(g.error))));
      }, s.onerror = (C) => {
        for (const g of o.callbacks.values())
          g.reject(C instanceof Error ? C : new Error(String(C)));
        o.callbacks.clear(), o.pending = 0;
      }, this.workers.push(o);
    }
  }
  /**
   * @param {string} op
   * @param {any} payload
   * @param {Transferable[]} [transfer]
   * @returns {Promise<any>}
   */
  request(e, A, i) {
    const s = this._nextId++, o = Cn();
    let C = this.workers[0];
    for (const g of this.workers)
      g.pending < C.pending && (C = g);
    C.pending++, C.callbacks.set(s, o);
    try {
      i && i.length ? C.worker.postMessage({ id: s, op: e, payload: A }, i) : C.worker.postMessage({ id: s, op: e, payload: A });
    } catch (g) {
      C.callbacks.delete(s), C.pending = Math.max(0, C.pending - 1), o.reject(g);
    }
    return o.promise;
  }
  terminate() {
    for (const e of this.workers) {
      try {
        e.worker.terminate();
      } catch {
      }
      e.callbacks.clear(), e.pending = 0;
    }
    this.workers.length = 0;
  }
}
function cn() {
  return new Worker(new URL(
    /* @vite-ignore */
    "/assets/tiff.worker-BPpoNmhb.js",
    import.meta.url
  ), { type: "module" });
}
class EA {
  /**
   * @param {ArrayBuffer|Uint8Array|Blob|{bytes?:any, blob?:Blob, arrayBuffer?:Function}} source
   * @param {Object} [opts]
   * @param {RawTiffHints} [opts.hints]
   * @param {*} [opts.meta]
   */
  constructor(e, A = {}) {
    this.source = e, this.hints = A.hints || {}, this.meta = A.meta;
  }
  getType() {
    return "rawTiff";
  }
}
class Se {
  /**
   * @param {Object} params
   * @param {number} params.width
   * @param {number} params.height
   * @param {TypedArray[]} params.bands
   * @param {number} params.samplesPerPixel
   * @param {number[]} params.bitsPerSample
   * @param {number[]} [params.sampleFormat]
   * @param {number} [params.photometricInterpretation]
   * @param {any} [params.colorMap]
   * @param {any} [params.fileDirectory]
   * @param {RawTiffHints} [params.hints]
   */
  constructor(e) {
    Object.assign(this, e), this.hints = e.hints || {};
  }
  getType() {
    return "tiffRaster";
  }
}
function mA(t, e) {
  const A = Array.isArray(t) ? t.slice() : Object.assign({}, t || {});
  if (!e || typeof e != "object") return A;
  for (const i of Object.keys(e)) {
    const s = e[i];
    s && typeof s == "object" && !Array.isArray(s) && A[i] && typeof A[i] == "object" && !Array.isArray(A[i]) ? A[i] = mA(A[i], s) : A[i] = s;
  }
  return A;
}
function HA(t, e) {
  const A = e && e.hints;
  if (A && A.formatResolved) return A.formatResolved;
  if (A && A.format) return A.format;
  if (e && e.meta && e.meta.format) return e.meta.format;
  if (t && t.format) return t.format;
  if (t && t.userData && t.userData.format) return t.userData.format;
  const i = t && (t.source || t.tileSource || t._tileSource);
  return i && i.format ? i.format : i && i.options && i.options.format ? i.options.format : null;
}
function Qn(t) {
  return Array.isArray(t) ? t.map((e) => {
    const A = typeof e.ctor == "string" && globalThis[e.ctor] ? globalThis[e.ctor] : Uint8Array;
    return new A(e.buffer, e.byteOffset || 0, e.length);
  }) : [];
}
function En(t, e) {
  const A = Qn(t.bands);
  return new Se({
    width: t.width,
    height: t.height,
    bands: A,
    samplesPerPixel: t.samplesPerPixel,
    bitsPerSample: t.bitsPerSample,
    sampleFormat: t.sampleFormat,
    photometricInterpretation: t.photometricInterpretation,
    colorMap: t.colorMap,
    fileDirectory: t.fileDirectory,
    hints: e || {}
  });
}
function rt(t) {
  const e = (t.packs || []).map((A) => {
    const i = A.data, s = typeof i.ctor == "string" && globalThis[i.ctor] ? globalThis[i.ctor] : Uint8Array, o = new s(i.buffer, i.byteOffset || 0, i.length);
    return Object.assign({}, A, { data: o });
  });
  return new Ge({
    width: t.width,
    height: t.height,
    mode: t.mode,
    channelCount: t.channelCount,
    packs: e
  });
}
function hn(t, e = {}) {
  const A = t;
  if (A.RawTiffPlugin && A.RawTiffPlugin.__installed) return A.RawTiffPlugin;
  const i = Object.assign({
    toneMap: null,
    format: mA(Bn, e.defaults && e.defaults.format || null)
  }, e.defaults || {}), s = Object.assign({
    enabled: !0,
    size: typeof navigator < "u" && navigator.hardwareConcurrency ? Math.max(1, Math.min(4, Math.ceil(navigator.hardwareConcurrency / 2))) : 2,
    createWorker: null,
    transferInput: !1,
    enableRawTiffToImageBitmap: !0
  }, e.workerPool || {}), o = A.RawTiffPluginShared = A.RawTiffPluginShared || {};
  function C() {
    var l, h;
    if (!s.enabled || typeof Worker > "u") return null;
    if (o.__rawTiffWorkerPool) return o.__rawTiffWorkerPool;
    const Q = s.createWorker || cn;
    try {
      return o.__rawTiffWorkerPool = new ln({
        size: s.size,
        createWorker: Q
      }), o.__rawTiffWorkerPool;
    } catch (D) {
      return (h = (l = A.console) == null ? void 0 : l.warn) == null || h.call(l, "[RawTiffPlugin] Failed to create worker pool; falling back to main thread.", D), o.__rawTiffWorkerPool = null, null;
    }
  }
  async function g(Q) {
    if (Q == null) throw new Error("[RawTiffPlugin] rawTiff is null/undefined.");
    if (Q instanceof EA) return g(Q.source);
    if (typeof Q == "object") {
      if (typeof Q.arrayBuffer == "function") {
        const l = await Q.arrayBuffer();
        if (l instanceof ArrayBuffer) return l;
      }
      if (Q.bytes != null) return g(Q.bytes);
      if (Q.blob != null) return g(Q.blob);
    }
    if (typeof Blob < "u" && Q instanceof Blob) return await Q.arrayBuffer();
    if (Q instanceof ArrayBuffer) return Q;
    if (ArrayBuffer.isView(Q)) {
      const { buffer: l, byteOffset: h, byteLength: D } = Q;
      return l.slice(h, h + D);
    }
    throw new Error("[RawTiffPlugin] Unsupported rawTiff payload. Provide ArrayBuffer, TypedArray, Blob, or RawTiff wrapper.");
  }
  async function w(Q) {
    return typeof Q.getImageCount == "function" ? await Q.getImageCount() : typeof Q.getImages == "function" ? (await Q.getImages()).length : 1;
  }
  async function a(Q, l) {
    if (typeof Q.getImage == "function") return await Q.getImage(l);
    if (typeof Q.getImages == "function") return (await Q.getImages())[l];
    throw new Error("[RawTiffPlugin] geotiff instance does not expose getImage/getImages.");
  }
  async function r(Q, l) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const h = l && l.hints || (l instanceof EA ? l.hints : null) || {}, D = await g(l);
    let k;
    if (typeof tt == "function")
      k = await tt(D);
    else if (typeof RA == "function")
      k = await RA(new Blob([D], { type: "image/tiff" }));
    else
      throw new Error("[RawTiffPlugin] geotiff module does not provide fromArrayBuffer/fromBlob.");
    const S = await w(k);
    let G = h.imageIndex;
    if (S > 1) {
      if (typeof G != "number" || !Number.isFinite(G))
        throw new Error(`[RawTiffPlugin] TIFF contains ${S} images. Provide rawTiff.hints.imageIndex.`);
      if (G < 0 || G >= S)
        throw new Error(`[RawTiffPlugin] imageIndex ${G} out of range (0..${S - 1}).`);
    } else
      G = 0;
    const x = await a(k, G), b = typeof x.getWidth == "function" ? x.getWidth() : x.width, R = typeof x.getHeight == "function" ? x.getHeight() : x.height, F = typeof x.getSamplesPerPixel == "function" ? x.getSamplesPerPixel() : x.samplesPerPixel || 1, m = typeof x.getBitsPerSample == "function" ? x.getBitsPerSample() : x.bitsPerSample || [8], U = typeof x.getSampleFormat == "function" ? x.getSampleFormat() : x.sampleFormat || null, N = typeof x.getPhotometricInterpretation == "function" ? x.getPhotometricInterpretation() : x.fileDirectory ? x.fileDirectory.PhotometricInterpretation : void 0, v = x.fileDirectory || null, M = v && v.ColorMap ? v.ColorMap : null, L = Object.assign({ interleave: !1 }, h.decode || {}), T = await x.readRasters(L), K = Array.isArray(T) ? T : [T], q = Math.max(F || 0, K.length);
    return new Se({
      width: b,
      height: R,
      bands: K,
      samplesPerPixel: q,
      bitsPerSample: Array.isArray(m) ? m : [m],
      sampleFormat: Array.isArray(U) ? U : U ? [U] : null,
      photometricInterpretation: N,
      colorMap: M,
      fileDirectory: v,
      hints: h
    });
  }
  async function n(Q, l, h) {
    const D = l && l.hints || (l instanceof EA ? l.hints : null) || {}, k = await g(l), S = HA(Q, l), G = mA(i.format, S || null), x = Object.assign({}, D, { formatResolved: G }), b = s && s.transferInput ? [k] : [], R = await h.request("decodeRaster", { buffer: k, hints: x }, b);
    return En(R, x);
  }
  async function f(Q, l) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const h = C();
    return h ? await n(Q, l, h) : await r(Q, l);
  }
  async function I(Q, l) {
    const h = l && l.hints || (l instanceof EA ? l.hints : null) || {}, D = C();
    if (D) {
      const S = await g(l), G = HA(Q, l), x = mA(i.format, G || null), b = Object.assign({}, h, { formatResolved: x }), R = s && s.transferInput ? [S] : [], F = await D.request("decodeAndRenderImageBitmap", { buffer: S, hints: b }, R);
      if (F && F.kind === "imageBitmap") return F.imageBitmap;
      if (F && F.kind === "rgba8") {
        if (typeof createImageBitmap != "function")
          throw new Error("[RawTiffPlugin] createImageBitmap is not available to build ImageBitmap fallback.");
        const m = new Uint8ClampedArray(F.rgbaBuffer, F.rgbaByteOffset || 0, F.rgbaLength), U = new ImageData(m, F.width, F.height);
        return await createImageBitmap(U);
      }
      throw new Error("[RawTiffPlugin] Worker did not return a supported output.");
    }
    const k = await r(Q, l);
    return await d(Q, k);
  }
  async function B(Q, l) {
    const h = l && l.hints || (l instanceof EA ? l.hints : null) || {}, D = C();
    if (!D) {
      const m = await r(Q, l);
      return await y(Q, m);
    }
    const k = await g(l), S = HA(Q, l), G = mA(i.format, S || null), x = Object.assign({}, h, { formatResolved: G }), b = s && s.transferInput ? [k] : [], R = await D.request("decodeAndPackGpuTextureSet", { buffer: k, hints: x }, b), F = rt(R.texSet);
    return F.hints = x, F;
  }
  async function y(Q, l) {
    const h = C();
    if (!h) {
      IA("gpuTextureSet_no_worker", "[RawTiffPlugin] No worker pool available; gpuTextureSet packing will fall back to worker-less path (slower).", "warn");
      const U = l.width, N = l.height, v = U * N, M = new Uint8Array(v * 4);
      for (let L = 0, T = 0; L < v; L++, T += 4)
        M[T] = l.bands[0] ? l.bands[0][L] : 0, M[T + 1] = l.bands[1] ? l.bands[1][L] : 0, M[T + 2] = l.bands[2] ? l.bands[2][L] : 0, M[T + 3] = l.bands[3] ? l.bands[3][L] : 255;
      return new Ge({
        width: U,
        height: N,
        mode: "data",
        channelCount: l.bands ? l.bands.length : 0,
        packs: [{ format: "RGBA8", data: M, channels: [0, 1, 2, 3], normalized: !1, scale: [1, 1, 1, 1], offset: [0, 0, 0, 0] }]
      });
    }
    const D = l.hints || {}, k = HA(Q, l), S = mA(i.format, k || null), G = Object.assign({}, D, { formatResolved: S }), x = l.bands.map((U) => {
      var N;
      return {
        ctor: ((N = U.constructor) == null ? void 0 : N.name) || "Uint8Array",
        buffer: U.buffer,
        byteOffset: U.byteOffset,
        length: U.length
      };
    }), b = {
      width: l.width,
      height: l.height,
      bands: x,
      samplesPerPixel: l.samplesPerPixel,
      bitsPerSample: l.bitsPerSample,
      sampleFormat: l.sampleFormat,
      photometricInterpretation: l.photometricInterpretation,
      colorMap: l.colorMap,
      fileDirectory: l.fileDirectory
    }, R = x.map((U) => U.buffer), F = await h.request("rasterToGpuTextureSet", { raster: b, hints: G }, R), m = rt(F);
    return m.hints = G, m;
  }
  function c(Q, l, h) {
    if (Q == null || Number.isNaN(Q)) return 0;
    const D = h.bands[l];
    if (D instanceof Float32Array || D instanceof Float64Array) {
      const x = Math.max(0, Math.min(1, Q));
      return Math.round(x * 255);
    }
    const S = h.bitsPerSample && h.bitsPerSample[l] != null ? h.bitsPerSample[l] : h.bitsPerSample ? h.bitsPerSample[0] : 8, G = S <= 0 ? 255 : Math.pow(2, S) - 1;
    return G <= 255 ? Math.max(0, Math.min(255, Q)) : Math.round(Math.max(0, Math.min(1, Q / G)) * 255);
  }
  function E(Q) {
    const l = i.toneMap || c, h = W || {}, D = Q.width, k = Q.height, S = D * k, G = Q.hints.renderChannels || Q.renderChannels || null, x = Q.samplesPerPixel || Q.bands.length || 1, b = (v, M) => l(Q.bands[v][M], v, Q), R = Q.photometricInterpretation;
    if (R === h.Palette && Q.colorMap) {
      const v = Q.bands[0];
      return lA.RGBAfromPalette(v, Q.colorMap);
    }
    if ((R === h.WhiteIsZero || R === h.BlackIsZero) && x >= 1) {
      const v = Q.bands[0], M = Q.bitsPerSample && Q.bitsPerSample[0] != null ? Q.bitsPerSample[0] : 8, L = Math.pow(2, M) - 1;
      if (R === h.WhiteIsZero) return lA.RGBAfromWhiteIsZero(v, L);
      if (R === h.BlackIsZero) return lA.RGBAfromBlackIsZero(v, L);
      const T = new Uint8ClampedArray(S * 4);
      for (let K = 0, q = 0; K < S; K++, q += 4) {
        let J = l(v[K], 0, Q);
        R === h.WhiteIsZero && (J = 255 - J), T[q] = T[q + 1] = T[q + 2] = J, T[q + 3] = 255;
      }
      return T;
    }
    const F = G || (R === h.RGB || R === h.YCbCr || R === h.CIELab ? [0, 1, 2] : x >= 3 ? [0, 1, 2] : [0]);
    if (F.length > 4 && (IA(
      "renderChannels>4_to_RGBA",
      `[tiff] Requested ${F.length} channels for RGBA output; only 4 can be represented. Extra channels will be dropped.`,
      "warn"
    ), F.splice(4)), F.length === 1) {
      const v = F[0], M = new Uint8ClampedArray(S * 4);
      for (let L = 0, T = 0; L < S; L++, T += 4) {
        const K = b(v, L);
        M[T] = M[T + 1] = M[T + 2] = K, M[T + 3] = 255;
      }
      return M;
    }
    const m = new Uint8ClampedArray(S * F.length);
    for (let v = 0; v < S; v++) {
      const M = v * F.length;
      for (let L = 0; L < F.length; L++) {
        const T = F[L];
        m[M + L] = T < Q.bands.length ? b(T, v) : 0;
      }
    }
    if (R === h.YCbCr && F.length >= 3) return lA.RGBAfromYCbCr(m);
    if (R === h.CMYK && F.length >= 4) return lA.RGBAfromCMYK(m);
    if (R === h.CIELab && F.length >= 3) return lA.RGBAfromCIELab(m);
    if (F.length === 4) return m;
    if (F.length === 3) return lA.RGBAfromRGB(m);
    const U = new Uint8ClampedArray(S * 4), N = F.length >= 4;
    for (let v = 0, M = 0; v < S; v++, M += 4) {
      const L = v * F.length;
      U[M] = m[L], U[M + 1] = m[L + 1] || 0, U[M + 2] = m[L + 2] || 0, U[M + 3] = N ? m[L + 3] : 255;
    }
    return U;
  }
  async function d(Q, l) {
    if (typeof createImageBitmap != "function")
      throw new Error("[RawTiffPlugin] createImageBitmap is not available.");
    const h = E(l), D = new ImageData(h, l.width, l.height);
    return await createImageBitmap(D);
  }
  async function p(Q, l) {
    const h = await d(Q, l), D = document.createElement("canvas");
    D.width = h.width, D.height = h.height;
    const k = D.getContext("2d", { willReadFrequently: !0 });
    return k.drawImage(h, 0, 0), k;
  }
  A.converter ? (A.converter.learn("rawTiff", "tiffRaster", (Q, l) => f(Q, l), 2, 10), s.enableRawTiffToImageBitmap && A.converter.learn("rawTiff", "imageBitmap", (Q, l) => I(Q, l), 1, 5), A.converter.learn("tiffRaster", "context2d", (Q, l) => p(Q, l), 2, 10), A.converter.learn("tiffRaster", "imageBitmap", (Q, l) => d(Q, l), 1, 50), A.converter.learn("rawTiff", "gpuTextureSet", (Q, l) => B(Q, l), 1, 8), A.converter.learn("tiffRaster", "gpuTextureSet", (Q, l) => y(Q, l), 1, 12)) : A.console.warn("[RawTiffPlugin] OpenSeadragon.converter is missing. Load OSD v6+.");
  const u = {
    __installed: !0,
    RawTiff: EA,
    TiffRaster: Se,
    GpuTextureSet: Ge,
    Converters: lA,
    decodeRawTiff: f,
    rasterToRGBA8: E,
    rasterToContext2d: p,
    rasterToImageBitmap: d,
    getWorkerPool: C,
    terminateWorkerPool() {
      const Q = A.RawTiffPluginShared;
      Q && Q.__rawTiffWorkerPool && (Q.__rawTiffWorkerPool.terminate(), Q.__rawTiffWorkerPool = null);
    },
    /**
     * Convert using OpenSeadragon.converter.
     * @param {*} tile
     * @param {*} data
     * @param {string} toType
     * @param {string} [fromType]
     */
    convert(Q, l, h, D) {
      if (!A.converter) throw new Error("[RawTiffPlugin] OpenSeadragon.converter is missing.");
      const k = D || A.converter.guessType(l);
      return A.converter.convert(Q, l, k, h);
    },
    /**
     * Wrap binary as a RawTiff object.
     * @param {*} source
     * @param {Object} [opts]
     * @returns {RawTiff}
     */
    wrap(Q, l) {
      return new EA(Q, l);
    },
    /**
     * Expose defaults (merged).
     */
    defaults: i
  };
  return A.RawTiffPlugin = u, u;
}
const un = (t, e = {}) => {
  if (t.version.major < 4 || t.version.major === 4 && t.version.minor < 1)
    throw new Error("Your current OpenSeadragon version is too low to support GeoTIFFTileSource");
  const {
    workerUrl: A,
    // optional: string or URL
    workerPool: i
    // optional: { createWorker: () => Worker }
  } = e, o = i || {
    createWorker: () => A ? new Worker(A, { type: "module" }) : new Worker(new URL(
      /* @vite-ignore */
      "/assets/tiff.worker-BPpoNmhb.js",
      import.meta.url
    ), {
      type: "module"
    })
  }, C = t.RawTiffPlugin || hn(t, {
    workerPool: o
  });
  let g = 0;
  const a = class a extends t.TileSource {
    constructor(n, f = { logLatency: !1 }) {
      super();
      let I = this;
      this.input = n, this.options = f, this.channel = (n == null ? void 0 : n.channel) ?? null, this._ready = !1, this._pool = a.sharedPool, this._tileSize = 256, this._tsCounter = g, g += 1, n.GeoTIFF && n.GeoTIFFImages ? (this.promises = {
        GeoTIFF: Promise.resolve(n.GeoTIFF),
        GeoTIFFImages: Promise.resolve(n.GeoTIFFImages),
        ready: new fe()
      }, this.GeoTIFF = n.GeoTIFF, this.imageCount = n.GeoTIFFImages.length, this.GeoTIFFImages = n.GeoTIFFImages, this.setupLevels()) : (this.promises = {
        GeoTIFF: n instanceof File ? RA(n, f.GeoTIFFOptions) : Ce(n, f.GeoTIFFOptions),
        GeoTIFFImages: new fe(),
        ready: new fe()
      }, this.promises.GeoTIFF.then((B) => (I.GeoTIFF = B, B.getImageCount())).then((B) => {
        I.imageCount = B;
        let y = [...Array(B).keys()].map((c) => I.GeoTIFF.getImage(c));
        return Promise.all(y);
      }).then((B) => {
        B = I.constructor.userDefinedImagesFilter(B, f), I.GeoTIFFImages = B, I.promises.GeoTIFFImages.resolve(B), this.setupLevels();
      }).catch((B) => {
        throw console.error("Re-throwing error with GeoTIFF:", B), B;
      }));
    }
    static async getAllTileSources(n, f) {
      const I = n instanceof File ? n.name.split(".").pop() : n.split(".").pop();
      let B = await (n instanceof File ? RA(n, f.GeoTIFFOptions) : Ce(n, f.GeoTIFFOptions)), y = await B.getImageCount();
      return Promise.all(
        Array.from({ length: y }, (c, E) => B.getImage(E))
      ).then((c) => {
        let E = n instanceof File ? RA(n) : Ce(n);
        return c = this.userDefinedImagesFilter(c, f), c = c.filter(
          (d) => d.fileDirectory.photometricInterpretation !== W.TransparencyMask
        ), this.resolveLayout(E, c, f.hints);
      }).then((c) => this.buildLevelImages(B, c, B)).then((c) => {
        c.sort((u, Q) => Q.getWidth() - u.getWidth());
        const E = 0.015;
        return c.reduce((u, Q) => {
          const l = Q.getWidth() / Q.getHeight();
          let h = "";
          Q.fileDirectory.ImageDescription && (h = Q.fileDirectory.ImageDescription.split(`
`)[1] ?? "");
          const D = u.filter(
            (k) => Math.abs(1 - k.aspectRatio / l) < E && !(h != null && h.includes("macro") || h != null && h.includes("label"))
            // Separate out macro thumbnails and labels
          );
          if (D.length === 0) {
            let k = {
              aspectRatio: l,
              images: [Q]
            };
            u.push(k);
          } else
            D[0].images.push(Q);
          return u;
        }, []).map((u) => u.images).map((u, Q) => {
          if (Q !== 0)
            return new t.GeoTIFFTileSource(
              {
                GeoTIFF: B,
                GeoTIFFImages: u
              },
              f
            );
          switch (I) {
            case "qptiff":
              const l = In(u);
              return Array.from(l.values()).map((h, D) => new t.GeoTIFFTileSource(
                {
                  GeoTIFF: B,
                  GeoTIFFImages: h.images,
                  channel: {
                    name: h.name,
                    color: h.color
                  }
                },
                f
              ));
            default:
              return new t.GeoTIFFTileSource(
                {
                  GeoTIFF: B,
                  GeoTIFFImages: u
                },
                f
              );
          }
        });
      });
    }
    /**
     * Return the tileWidth for a given level.
     * @function
     * @param {Number} level
     */
    getTileWidth(n) {
      if (this.levels.length > n)
        return this.levels[n].tileWidth;
    }
    /**
     * Return the tileHeight for a given level.
     * @function
     * @param {Number} level
     */
    getTileHeight(n) {
      if (this.levels.length > n)
        return this.levels[n].tileHeight;
    }
    /**
     * @function
     * @param {Number} level
     */
    getLevelScale(n) {
      let f = NaN;
      return this.levels.length > 0 && n >= this.minLevel && n <= this.maxLevel && (f = this.levels[n].width / this.levels[this.maxLevel].width), f;
    }
    /**
     * Handle maintaining unique caches per channel in multi-channel images
     */
    getTileHashKey(n, f, I) {
      var B;
      return `geotiffTileSource${this._tsCounter}_${((B = this == null ? void 0 : this.channel) == null ? void 0 : B.name) ?? ""}_${n}_${f}_${I}`;
    }
    /**
     * Implement function here instead of as custom tile source in client code
     * @function
     * @param {Number} levelnum
     * @param {Number} x
     * @param {Number} y
     */
    getTileUrl(n, f, I) {
      return `${n}/${f}_${I}`;
    }
    downloadTileStart(n) {
      const f = !!t.converter && typeof n.fail == "function", I = "" + n.src, B = new AbortController();
      n.userData && (n.userData.abortController = B);
      const y = this.levels[n.tile.level];
      this.regionToTiffRaster(y, n.tile.x, n.tile.y, B.signal).then(async (c) => {
        if (f) {
          n.finish(c, I, c.getType());
          return;
        }
        const E = await Promise.resolve(C.rasterToContext2d(n.tile, c));
        n.finish(E.canvas);
      }).catch((c) => {
        const E = c && c.message ? c.message : String(c);
        f ? n.fail(E) : n.finish(null, I, E);
      });
    }
    downloadTileAbort(n) {
      const f = n.userData && n.userData.abortController;
      f ? f.abort() : $.console.error("Could not abort download: controller not available.");
    }
    setupComplete() {
      this._ready = !0, this.promises.ready.resolve(), this.raiseEvent("ready", { tileSource: this });
    }
    setupLevels() {
      if (this._ready)
        return;
      let n = this.GeoTIFFImages.sort((E, d) => d.getWidth() - E.getWidth()), f = this._tileSize, I = this._tileSize, B = n[0].getWidth();
      this.width = B;
      let y = n[0].getHeight();
      if (this.height = y, this.tileOverlap = 0, this.minLevel = 0, this.aspectRatio = this.width / this.height, this.dimensions = new t.Point(this.width, this.height), n.reduce(
        (E, d) => (E.width !== -1 && (E.valid = E.valid && d.getWidth() < E.width), E.width = d.getWidth(), E),
        { valid: !0, width: -1 }
      ).valid)
        this.levels = n.map((E) => {
          let d = E.getWidth(), p = E.getHeight();
          return {
            width: d,
            height: p,
            tileWidth: this.options.tileWidth || E.getTileWidth() || f,
            tileHeight: this.options.tileHeight || E.getTileHeight() || I,
            image: E,
            scaleFactor: 1
          };
        }), this.maxLevel = this.levels.length - 1;
      else {
        let E = Math.ceil(
          Math.log2(Math.max(B / f, y / I))
        ), d = [...Array(E).keys()].filter((p) => p % 2 == 0);
        this.levels = d.map((p) => {
          let u = Math.pow(2, p);
          const Q = n.filter((h) => {
            const D = Math.pow(2, p - 1);
            return D >= 0 ? h.getWidth() * D < B && h.getWidth() * u >= B : h.getWidth() * u >= B;
          });
          if (Q.length === 0)
            return null;
          const l = Q[0];
          return {
            width: B / u,
            height: y / u,
            tileWidth: this.options.tileWidth || l.getTileWidth() || f,
            tileHeight: this.options.tileHeight || l.getTileHeight() || I,
            image: l,
            scaleFactor: u * l.getWidth() / B
          };
        }).filter((p) => p !== null), this.maxLevel = this.levels.length - 1;
      }
      this.levels = this.levels.sort((E, d) => E.width - d.width), this._tileWidth = this.levels[0].tileWidth, this._tileHeight = this.levels[0].tileHeight, this.setupComplete();
    }
    static getGeoTiffFileDirectory(n) {
      var f;
      return ((f = n.getFileDirectory) == null ? void 0 : f.call(n)) ?? n.fileDirectory ?? {};
    }
    static getGeoTiffFileKey(n) {
      return [
        n.getWidth(),
        n.getHeight(),
        this.getGeoTiffFileDirectory(n).TileWidth ?? 0,
        this.getGeoTiffFileDirectory(n).TileLength ?? 0,
        (n.getWidth() / n.getHeight()).toFixed(6)
      ].join("|");
    }
    static async resolveLayout(n, f, I = {}) {
      const B = I.layout || {}, y = B.pyramid || "auto", c = Number.isFinite(B.planeIndex) ? B.planeIndex : 0, E = /* @__PURE__ */ new Map();
      for (const R of f) {
        const F = this.getGeoTiffFileKey(R);
        R.__key = F, this.getGeoTiffFileDirectory(R);
        const m = E.get(F) || [];
        m.push(R), E.set(F, m);
      }
      const d = f.map((R) => ({ im: R, w: R.getWidth(), h: R.getHeight() })).sort((R, F) => F.w - R.w), p = [], u = /* @__PURE__ */ new Set();
      for (const { im: R, w: F, h: m } of d) {
        const U = `${F}x${m}`;
        u.has(U) || (u.add(U), p.push(R));
      }
      const Q = (R) => {
        if (R.length < 2) return !1;
        for (let m = 1; m < R.length; m++)
          if (R[m].getWidth() >= R[m - 1].getWidth() || R[m].getHeight() >= R[m - 1].getHeight()) return !1;
        const F = R[0].getWidth() / R[0].getHeight();
        for (const m of R) {
          const U = m.getWidth() / m.getHeight();
          if (Math.abs(U - F) > 0.01) return !1;
        }
        return !0;
      }, l = p, h = Q(l), D = f.some((R) => {
        const F = this.getGeoTiffFileDirectory(R).SubIFDs;
        return F && F.length;
      });
      let k = "single";
      y === "ifd" ? k = h ? "ifd" : "single" : y === "subifd" ? k = D ? "subifd" : "single" : h ? k = "ifd" : D ? k = "subifd" : k = "single";
      const S = l[0], G = S.__key, x = E.get(G) || [S], b = x[Math.max(0, Math.min(x.length - 1, c))];
      return k === "subifd" && (IA(`${b.__key}-subifd-warn`, `[GeoTIFFTileSource] File was detected to contain SubIFD pyramids, 
however, geotiff.js does not support reading SubIFD files and is unable to display the pyramid. Only the
high-resolution lowest level will be shown`, "warn"), k = "ifd"), { strategy: k, planes: x, chosenPlane: b, ifdLevelsLargestToSmallest: l };
    }
    static async buildLevelImages(n, f, I) {
      const { strategy: B, chosenPlane: y, ifdLevelsLargestToSmallest: c, planes: E } = f, d = (p) => {
        var u;
        return ((u = p.getFileDirectory) == null ? void 0 : u.call(p)) ?? p.fileDirectory ?? {};
      };
      if (B === "ifd") {
        const p = [...c].sort((u, Q) => u.getWidth() - Q.getWidth());
        return E.length > 1 && IA(I, `[GeoTIFFTileSource] Detected a plane stack (${E.length} same-size IFDs) AND a top-level pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose a different plane.`, "warn"), p;
      }
      if (B === "subifd") {
        const u = d(y).SubIFDs;
        if (!u || !u.length)
          return IA(I, "[GeoTIFFTileSource] SubIFD pyramid requested/detected but the chosen plane has no SubIFDs. Falling back to single level.", "warn"), [y];
        if (typeof y.getSubIFDs == "function") {
          const l = [...await y.getSubIFDs(), y].sort((h, D) => h.getWidth() - D.getWidth());
          return E.length > 1 && IA(I, `[GeoTIFFTileSource] Detected a plane stack (${E.length} same-size IFDs) with SubIFD pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), l;
        }
        return IA(I, "[GeoTIFFTileSource] SubIFDs are present but geotiff.js does not expose getSubIFDs() in this build. Using single level. (You can still render multi-plane data via your GPU pipeline.)", "warn"), [y];
      }
      return E.length > 1 && IA(I, `[GeoTIFFTileSource] Detected ${E.length} same-size IFD pages (likely channels/planes). No pyramid detected. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), [y];
    }
    regionToTiffRaster(n, f, I, B) {
      var l, h, D, k;
      const y = this.options.logLatency && Date.now(), c = n.tileWidth, E = n.tileHeight, d = [f * c, I * E, (f + 1) * c, (I + 1) * E].map(
        (S) => S * n.scaleFactor
      ), p = n.image, u = (h = (l = p.fileDirectory) == null ? void 0 : l.Software) == null ? void 0 : h.startsWith("PerkinElmer-QPI");
      let Q = null;
      if (u && ((D = p.fileDirectory) != null && D.ImageDescription))
        try {
          const G = (k = new DOMParser().parseFromString(p.fileDirectory.ImageDescription, "text/xml").querySelector("Color")) == null ? void 0 : k.textContent;
          Q = G ? G.split(",").map((x) => parseInt(x, 10)) : null;
        } catch {
          Q = null;
        }
      return p.readRasters({
        interleave: !1,
        window: d,
        pool: this._pool,
        width: c,
        height: E,
        signal: B
      }).then((S) => {
        const G = Array.isArray(S) ? S : [S], x = p.fileDirectory || {}, b = new C.TiffRaster({
          width: c,
          height: E,
          bands: G,
          samplesPerPixel: Math.max(x.SamplesPerPixel || 0, G.length),
          bitsPerSample: x.BitsPerSample || [8],
          sampleFormat: x.SampleFormat || null,
          photometricInterpretation: x.PhotometricInterpretation,
          colorMap: x.ColorMap || null,
          fileDirectory: x,
          hints: {
            ...this.channel ? { channel: this.channel } : {},
            ...Q ? { tintRGB: Q } : {}
          }
        });
        return this.options.logLatency && (typeof this.options.logLatency == "function" ? this.options.logLatency : console.log)(
          "Tile decode latency (ms):",
          Date.now() - y
        ), b;
      });
    }
  };
  /**
   * Create a shared GeoTIFF Pool for all GeoTIFFTileSources to use.
   *
   * If a shared pool is not created, every page of every GeoTIFF will create its own pool,
   * which can quickly lead to browser crashes.
   *
   * @static sharedPool
   * @type {Pool}
   */
  oe(a, "sharedPool", new Rr()), oe(a, "userDefinedImagesFilter", (n, f) => (typeof f.imagesFilter < "u" && f.imagesFilter && (Array.isArray(f.imagesFilter) ? n = n.filter((I, B) => f.imagesFilter.includes(B)) : typeof f.imagesFilter == "function" && (n = n.filter(f.imagesFilter)), f.imagesFilter = void 0), n));
  let w = a;
  t.GeoTIFFTileSource = w;
};
(function(t, e) {
  typeof exports > "u" || typeof t.OpenSeadragon < "u" && e(t.OpenSeadragon);
})(typeof window < "u" ? window : void 0, un);
class dn extends dA {
  decodeBlock(e) {
    return e;
  }
}
const wn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: dn
}, Symbol.toStringTag, { value: "Module" })), nt = 9, le = 256, xe = 257, yn = 12;
function Dn(t, e, A) {
  const i = e % 8, s = Math.floor(e / 8), o = 8 - i, C = e + A - (s + 1) * 8;
  let g = 8 * (s + 2) - (e + A);
  const w = (s + 2) * 8 - e;
  if (g = Math.max(0, g), s >= t.length)
    return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"), xe;
  let a = t[s] & 2 ** (8 - i) - 1;
  a <<= A - o;
  let r = a;
  if (s + 1 < t.length) {
    let n = t[s + 1] >>> g;
    n <<= Math.max(0, A - w), r += n;
  }
  if (C > 8 && s + 2 < t.length) {
    const n = (s + 3) * 8 - (e + A), f = t[s + 2] >>> n;
    r += f;
  }
  return r;
}
function ce(t, e) {
  for (let A = e.length - 1; A >= 0; A--)
    t.push(e[A]);
  return t;
}
function pn(t) {
  const e = new Uint16Array(4093), A = new Uint8Array(4093);
  for (let B = 0; B <= 257; B++)
    e[B] = 4096, A[B] = B;
  let i = 258, s = nt, o = 0;
  function C() {
    i = 258, s = nt;
  }
  function g(B) {
    const y = Dn(B, o, s);
    return o += s, y;
  }
  function w(B, y) {
    return A[i] = y, e[i] = B, i++, i - 1;
  }
  function a(B) {
    const y = [];
    for (let c = B; c !== 4096; c = e[c])
      y.push(A[c]);
    return y;
  }
  const r = [];
  C();
  const n = new Uint8Array(t);
  let f = g(n), I;
  for (; f !== xe; ) {
    if (f === le) {
      for (C(), f = g(n); f === le; )
        f = g(n);
      if (f === xe)
        break;
      if (f > le)
        throw new Error(`corrupted code at scanline ${f}`);
      {
        const B = a(f);
        ce(r, B), I = f;
      }
    } else if (f < i) {
      const B = a(f);
      ce(r, B), w(I, B[B.length - 1]), I = f;
    } else {
      const B = a(I);
      if (!B)
        throw new Error(`Bogus entry. Not in dictionary, ${I} / ${i}, position: ${o}`);
      ce(r, B), r.push(B[B.length - 1]), w(I, B[B.length - 1]), I = f;
    }
    i + 1 >= 2 ** s && (s === yn ? I = void 0 : s++), f = g(n);
  }
  return new Uint8Array(r);
}
class mn extends dA {
  decodeBlock(e) {
    return pn(e).buffer;
  }
}
const kn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: mn
}, Symbol.toStringTag, { value: "Module" })), vA = new Int32Array([
  0,
  1,
  8,
  16,
  9,
  2,
  3,
  10,
  17,
  24,
  32,
  25,
  18,
  11,
  4,
  5,
  12,
  19,
  26,
  33,
  40,
  48,
  41,
  34,
  27,
  20,
  13,
  6,
  7,
  14,
  21,
  28,
  35,
  42,
  49,
  56,
  57,
  50,
  43,
  36,
  29,
  22,
  15,
  23,
  30,
  37,
  44,
  51,
  58,
  59,
  52,
  45,
  38,
  31,
  39,
  46,
  53,
  60,
  61,
  54,
  47,
  55,
  62,
  63
]), KA = 4017, OA = 799, _A = 3406, PA = 2276, VA = 1567, XA = 3784, DA = 5793, jA = 2896;
function ot(t, e) {
  let A = 0;
  const i = [];
  let s = 16;
  for (; s > 0 && !t[s - 1]; )
    --s;
  i.push({ children: [], index: 0 });
  let o = i[0], C;
  for (let g = 0; g < s; g++) {
    for (let w = 0; w < t[g]; w++) {
      for (o = i.pop(), o.children[o.index] = e[A]; o.index > 0; )
        o = i.pop();
      for (o.index++, i.push(o); i.length <= g; )
        i.push(C = { children: [], index: 0 }), o.children[o.index] = C.children, o = C;
      A++;
    }
    g + 1 < s && (i.push(C = { children: [], index: 0 }), o.children[o.index] = C.children, o = C);
  }
  return i[0].children;
}
function Fn(t, e, A, i, s, o, C, g, w) {
  const { mcusPerLine: a, progressive: r } = A, n = e;
  let f = e, I = 0, B = 0;
  function y() {
    if (B > 0)
      return B--, I >> B & 1;
    if (I = t[f++], I === 255) {
      const q = t[f++];
      if (q)
        throw new Error(`unexpected marker: ${(I << 8 | q).toString(16)}`);
    }
    return B = 7, I >>> 7;
  }
  function c(q) {
    let J = q, Y;
    for (; (Y = y()) !== null; ) {
      if (J = J[Y], typeof J == "number")
        return J;
      if (typeof J != "object")
        throw new Error("invalid huffman sequence");
    }
    return null;
  }
  function E(q) {
    let J = q, Y = 0;
    for (; J > 0; ) {
      const O = y();
      if (O === null)
        return;
      Y = Y << 1 | O, --J;
    }
    return Y;
  }
  function d(q) {
    const J = E(q);
    return J >= 1 << q - 1 ? J : J + (-1 << q) + 1;
  }
  function p(q, J) {
    const Y = c(q.huffmanTableDC), O = Y === 0 ? 0 : d(Y);
    q.pred += O, J[0] = q.pred;
    let _ = 1;
    for (; _ < 64; ) {
      const V = c(q.huffmanTableAC), X = V & 15, AA = V >> 4;
      if (X === 0) {
        if (AA < 15)
          break;
        _ += 16;
      } else {
        _ += AA;
        const z = vA[_];
        J[z] = d(X), _++;
      }
    }
  }
  function u(q, J) {
    const Y = c(q.huffmanTableDC), O = Y === 0 ? 0 : d(Y) << w;
    q.pred += O, J[0] = q.pred;
  }
  function Q(q, J) {
    J[0] |= y() << w;
  }
  let l = 0;
  function h(q, J) {
    if (l > 0) {
      l--;
      return;
    }
    let Y = o;
    const O = C;
    for (; Y <= O; ) {
      const _ = c(q.huffmanTableAC), V = _ & 15, X = _ >> 4;
      if (V === 0) {
        if (X < 15) {
          l = E(X) + (1 << X) - 1;
          break;
        }
        Y += 16;
      } else {
        Y += X;
        const AA = vA[Y];
        J[AA] = d(V) * (1 << w), Y++;
      }
    }
  }
  let D = 0, k;
  function S(q, J) {
    let Y = o;
    const O = C;
    let _ = 0;
    for (; Y <= O; ) {
      const V = vA[Y], X = J[V] < 0 ? -1 : 1;
      switch (D) {
        case 0: {
          const AA = c(q.huffmanTableAC), z = AA & 15;
          if (_ = AA >> 4, z === 0)
            _ < 15 ? (l = E(_) + (1 << _), D = 4) : (_ = 16, D = 1);
          else {
            if (z !== 1)
              throw new Error("invalid ACn encoding");
            k = d(z), D = _ ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          J[V] ? J[V] += (y() << w) * X : (_--, _ === 0 && (D = D === 2 ? 3 : 0));
          break;
        case 3:
          J[V] ? J[V] += (y() << w) * X : (J[V] = k << w, D = 0);
          break;
        case 4:
          J[V] && (J[V] += (y() << w) * X);
          break;
      }
      Y++;
    }
    D === 4 && (l--, l === 0 && (D = 0));
  }
  function G(q, J, Y, O, _) {
    const V = Y / a | 0, X = Y % a, AA = V * q.v + O, z = X * q.h + _;
    J(q, q.blocks[AA][z]);
  }
  function x(q, J, Y) {
    const O = Y / q.blocksPerLine | 0, _ = Y % q.blocksPerLine;
    J(q, q.blocks[O][_]);
  }
  const b = i.length;
  let R, F, m, U, N, v;
  r ? o === 0 ? v = g === 0 ? u : Q : v = g === 0 ? h : S : v = p;
  let M = 0, L, T;
  b === 1 ? T = i[0].blocksPerLine * i[0].blocksPerColumn : T = a * A.mcusPerColumn;
  const K = s || T;
  for (; M < T; ) {
    for (F = 0; F < b; F++)
      i[F].pred = 0;
    if (l = 0, b === 1)
      for (R = i[0], N = 0; N < K; N++)
        x(R, v, M), M++;
    else
      for (N = 0; N < K; N++) {
        for (F = 0; F < b; F++) {
          R = i[F];
          const { h: q, v: J } = R;
          for (m = 0; m < J; m++)
            for (U = 0; U < q; U++)
              G(R, v, M, m, U);
        }
        if (M++, M === T)
          break;
      }
    if (B = 0, L = t[f] << 8 | t[f + 1], L < 65280)
      throw new Error("marker was not found");
    if (L >= 65488 && L <= 65495)
      f += 2;
    else
      break;
  }
  return f - n;
}
function Gn(t, e) {
  const A = [], { blocksPerLine: i, blocksPerColumn: s } = e, o = i << 3, C = new Int32Array(64), g = new Uint8Array(64);
  function w(a, r, n) {
    const f = e.quantizationTable;
    let I, B, y, c, E, d, p, u, Q;
    const l = n;
    let h;
    for (h = 0; h < 64; h++)
      l[h] = a[h] * f[h];
    for (h = 0; h < 8; ++h) {
      const D = 8 * h;
      if (l[1 + D] === 0 && l[2 + D] === 0 && l[3 + D] === 0 && l[4 + D] === 0 && l[5 + D] === 0 && l[6 + D] === 0 && l[7 + D] === 0) {
        Q = DA * l[0 + D] + 512 >> 10, l[0 + D] = Q, l[1 + D] = Q, l[2 + D] = Q, l[3 + D] = Q, l[4 + D] = Q, l[5 + D] = Q, l[6 + D] = Q, l[7 + D] = Q;
        continue;
      }
      I = DA * l[0 + D] + 128 >> 8, B = DA * l[4 + D] + 128 >> 8, y = l[2 + D], c = l[6 + D], E = jA * (l[1 + D] - l[7 + D]) + 128 >> 8, u = jA * (l[1 + D] + l[7 + D]) + 128 >> 8, d = l[3 + D] << 4, p = l[5 + D] << 4, Q = I - B + 1 >> 1, I = I + B + 1 >> 1, B = Q, Q = y * XA + c * VA + 128 >> 8, y = y * VA - c * XA + 128 >> 8, c = Q, Q = E - p + 1 >> 1, E = E + p + 1 >> 1, p = Q, Q = u + d + 1 >> 1, d = u - d + 1 >> 1, u = Q, Q = I - c + 1 >> 1, I = I + c + 1 >> 1, c = Q, Q = B - y + 1 >> 1, B = B + y + 1 >> 1, y = Q, Q = E * PA + u * _A + 2048 >> 12, E = E * _A - u * PA + 2048 >> 12, u = Q, Q = d * OA + p * KA + 2048 >> 12, d = d * KA - p * OA + 2048 >> 12, p = Q, l[0 + D] = I + u, l[7 + D] = I - u, l[1 + D] = B + p, l[6 + D] = B - p, l[2 + D] = y + d, l[5 + D] = y - d, l[3 + D] = c + E, l[4 + D] = c - E;
    }
    for (h = 0; h < 8; ++h) {
      const D = h;
      if (l[1 * 8 + D] === 0 && l[2 * 8 + D] === 0 && l[3 * 8 + D] === 0 && l[4 * 8 + D] === 0 && l[5 * 8 + D] === 0 && l[6 * 8 + D] === 0 && l[7 * 8 + D] === 0) {
        Q = DA * n[h + 0] + 8192 >> 14, l[0 * 8 + D] = Q, l[1 * 8 + D] = Q, l[2 * 8 + D] = Q, l[3 * 8 + D] = Q, l[4 * 8 + D] = Q, l[5 * 8 + D] = Q, l[6 * 8 + D] = Q, l[7 * 8 + D] = Q;
        continue;
      }
      I = DA * l[0 * 8 + D] + 2048 >> 12, B = DA * l[4 * 8 + D] + 2048 >> 12, y = l[2 * 8 + D], c = l[6 * 8 + D], E = jA * (l[1 * 8 + D] - l[7 * 8 + D]) + 2048 >> 12, u = jA * (l[1 * 8 + D] + l[7 * 8 + D]) + 2048 >> 12, d = l[3 * 8 + D], p = l[5 * 8 + D], Q = I - B + 1 >> 1, I = I + B + 1 >> 1, B = Q, Q = y * XA + c * VA + 2048 >> 12, y = y * VA - c * XA + 2048 >> 12, c = Q, Q = E - p + 1 >> 1, E = E + p + 1 >> 1, p = Q, Q = u + d + 1 >> 1, d = u - d + 1 >> 1, u = Q, Q = I - c + 1 >> 1, I = I + c + 1 >> 1, c = Q, Q = B - y + 1 >> 1, B = B + y + 1 >> 1, y = Q, Q = E * PA + u * _A + 2048 >> 12, E = E * _A - u * PA + 2048 >> 12, u = Q, Q = d * OA + p * KA + 2048 >> 12, d = d * KA - p * OA + 2048 >> 12, p = Q, l[0 * 8 + D] = I + u, l[7 * 8 + D] = I - u, l[1 * 8 + D] = B + p, l[6 * 8 + D] = B - p, l[2 * 8 + D] = y + d, l[5 * 8 + D] = y - d, l[3 * 8 + D] = c + E, l[4 * 8 + D] = c - E;
    }
    for (h = 0; h < 64; ++h) {
      const D = 128 + (l[h] + 8 >> 4);
      D < 0 ? r[h] = 0 : D > 255 ? r[h] = 255 : r[h] = D;
    }
  }
  for (let a = 0; a < s; a++) {
    const r = a << 3;
    for (let n = 0; n < 8; n++)
      A.push(new Uint8Array(o));
    for (let n = 0; n < i; n++) {
      w(e.blocks[a][n], g, C);
      let f = 0;
      const I = n << 3;
      for (let B = 0; B < 8; B++) {
        const y = A[r + B];
        for (let c = 0; c < 8; c++)
          y[I + c] = g[f++];
      }
    }
  }
  return A;
}
class Sn {
  constructor() {
    this.jfif = null, this.adobe = null, this.quantizationTables = [], this.huffmanTablesAC = [], this.huffmanTablesDC = [], this.resetFrames();
  }
  resetFrames() {
    this.frames = [];
  }
  parse(e) {
    let A = 0;
    function i() {
      const g = e[A] << 8 | e[A + 1];
      return A += 2, g;
    }
    function s() {
      const g = i(), w = e.subarray(A, A + g - 2);
      return A += w.length, w;
    }
    function o(g) {
      let w = 0, a = 0, r, n;
      for (n in g.components)
        g.components.hasOwnProperty(n) && (r = g.components[n], w < r.h && (w = r.h), a < r.v && (a = r.v));
      const f = Math.ceil(g.samplesPerLine / 8 / w), I = Math.ceil(g.scanLines / 8 / a);
      for (n in g.components)
        if (g.components.hasOwnProperty(n)) {
          r = g.components[n];
          const B = Math.ceil(Math.ceil(g.samplesPerLine / 8) * r.h / w), y = Math.ceil(Math.ceil(g.scanLines / 8) * r.v / a), c = f * r.h, E = I * r.v, d = [];
          for (let p = 0; p < E; p++) {
            const u = [];
            for (let Q = 0; Q < c; Q++)
              u.push(new Int32Array(64));
            d.push(u);
          }
          r.blocksPerLine = B, r.blocksPerColumn = y, r.blocks = d;
        }
      g.maxH = w, g.maxV = a, g.mcusPerLine = f, g.mcusPerColumn = I;
    }
    let C = i();
    if (C !== 65496)
      throw new Error("SOI not found");
    for (C = i(); C !== 65497; ) {
      switch (C) {
        case 65280:
          break;
        case 65504:
        case 65505:
        case 65506:
        case 65507:
        case 65508:
        case 65509:
        case 65510:
        case 65511:
        case 65512:
        case 65513:
        case 65514:
        case 65515:
        case 65516:
        case 65517:
        case 65518:
        case 65519:
        case 65534: {
          const g = s();
          C === 65504 && g[0] === 74 && g[1] === 70 && g[2] === 73 && g[3] === 70 && g[4] === 0 && (this.jfif = {
            version: { major: g[5], minor: g[6] },
            densityUnits: g[7],
            xDensity: g[8] << 8 | g[9],
            yDensity: g[10] << 8 | g[11],
            thumbWidth: g[12],
            thumbHeight: g[13],
            thumbData: g.subarray(14, 14 + 3 * g[12] * g[13])
          }), C === 65518 && g[0] === 65 && g[1] === 100 && g[2] === 111 && g[3] === 98 && g[4] === 101 && g[5] === 0 && (this.adobe = {
            version: g[6],
            flags0: g[7] << 8 | g[8],
            flags1: g[9] << 8 | g[10],
            transformCode: g[11]
          });
          break;
        }
        case 65499: {
          const w = i() + A - 2;
          for (; A < w; ) {
            const a = e[A++], r = new Int32Array(64);
            if (a >> 4)
              if (a >> 4 === 1)
                for (let n = 0; n < 64; n++) {
                  const f = vA[n];
                  r[f] = i();
                }
              else
                throw new Error("DQT: invalid table spec");
            else for (let n = 0; n < 64; n++) {
              const f = vA[n];
              r[f] = e[A++];
            }
            this.quantizationTables[a & 15] = r;
          }
          break;
        }
        case 65472:
        case 65473:
        case 65474: {
          i();
          const g = {
            extended: C === 65473,
            progressive: C === 65474,
            precision: e[A++],
            scanLines: i(),
            samplesPerLine: i(),
            components: {},
            componentsOrder: []
          }, w = e[A++];
          let a;
          for (let r = 0; r < w; r++) {
            a = e[A];
            const n = e[A + 1] >> 4, f = e[A + 1] & 15, I = e[A + 2];
            g.componentsOrder.push(a), g.components[a] = {
              h: n,
              v: f,
              quantizationIdx: I
            }, A += 3;
          }
          o(g), this.frames.push(g);
          break;
        }
        case 65476: {
          const g = i();
          for (let w = 2; w < g; ) {
            const a = e[A++], r = new Uint8Array(16);
            let n = 0;
            for (let I = 0; I < 16; I++, A++)
              r[I] = e[A], n += r[I];
            const f = new Uint8Array(n);
            for (let I = 0; I < n; I++, A++)
              f[I] = e[A];
            w += 17 + n, a >> 4 ? this.huffmanTablesAC[a & 15] = ot(
              r,
              f
            ) : this.huffmanTablesDC[a & 15] = ot(
              r,
              f
            );
          }
          break;
        }
        case 65501:
          i(), this.resetInterval = i();
          break;
        case 65498: {
          i();
          const g = e[A++], w = [], a = this.frames[0];
          for (let B = 0; B < g; B++) {
            const y = a.components[e[A++]], c = e[A++];
            y.huffmanTableDC = this.huffmanTablesDC[c >> 4], y.huffmanTableAC = this.huffmanTablesAC[c & 15], w.push(y);
          }
          const r = e[A++], n = e[A++], f = e[A++], I = Fn(
            e,
            A,
            a,
            w,
            this.resetInterval,
            r,
            n,
            f >> 4,
            f & 15
          );
          A += I;
          break;
        }
        case 65535:
          e[A] !== 255 && A--;
          break;
        default:
          if (e[A - 3] === 255 && e[A - 2] >= 192 && e[A - 2] <= 254) {
            A -= 3;
            break;
          }
          throw new Error(`unknown JPEG marker ${C.toString(16)}`);
      }
      C = i();
    }
  }
  getResult() {
    const { frames: e } = this;
    if (this.frames.length === 0)
      throw new Error("no frames were decoded");
    this.frames.length > 1 && console.warn("more than one frame is not supported");
    for (let r = 0; r < this.frames.length; r++) {
      const n = this.frames[r].components;
      for (const f of Object.keys(n))
        n[f].quantizationTable = this.quantizationTables[n[f].quantizationIdx], delete n[f].quantizationIdx;
    }
    const A = e[0], { components: i, componentsOrder: s } = A, o = [], C = A.samplesPerLine, g = A.scanLines;
    for (let r = 0; r < s.length; r++) {
      const n = i[s[r]];
      o.push({
        lines: Gn(A, n),
        scaleX: n.h / A.maxH,
        scaleY: n.v / A.maxV
      });
    }
    const w = new Uint8Array(C * g * o.length);
    let a = 0;
    for (let r = 0; r < g; ++r)
      for (let n = 0; n < C; ++n)
        for (let f = 0; f < o.length; ++f) {
          const I = o[f];
          w[a] = I.lines[0 | r * I.scaleY][0 | n * I.scaleX], ++a;
        }
    return w;
  }
}
class xn extends dA {
  constructor(e) {
    super(), this.reader = new Sn(), e.JPEGTables && this.reader.parse(e.JPEGTables);
  }
  decodeBlock(e) {
    return this.reader.resetFrames(), this.reader.parse(new Uint8Array(e)), this.reader.getResult().buffer;
  }
}
const bn = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: xn
}, Symbol.toStringTag, { value: "Module" }));
function SA(t) {
  let e = t.length;
  for (; --e >= 0; )
    t[e] = 0;
}
const Rn = 3, vn = 258, ni = 29, Un = 256, Ln = Un + 1 + ni, oi = 30, Mn = 512, Nn = new Array((Ln + 2) * 2);
SA(Nn);
const qn = new Array(oi * 2);
SA(qn);
const Tn = new Array(Mn);
SA(Tn);
const Jn = new Array(vn - Rn + 1);
SA(Jn);
const Yn = new Array(ni);
SA(Yn);
const Hn = new Array(oi);
SA(Hn);
const Kn = (t, e, A, i) => {
  let s = t & 65535 | 0, o = t >>> 16 & 65535 | 0, C = 0;
  for (; A !== 0; ) {
    C = A > 2e3 ? 2e3 : A, A -= C;
    do
      s = s + e[i++] | 0, o = o + s | 0;
    while (--C);
    s %= 65521, o %= 65521;
  }
  return s | o << 16 | 0;
};
var be = Kn;
const On = () => {
  let t, e = [];
  for (var A = 0; A < 256; A++) {
    t = A;
    for (var i = 0; i < 8; i++)
      t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
    e[A] = t;
  }
  return e;
}, _n = new Uint32Array(On()), Pn = (t, e, A, i) => {
  const s = _n, o = i + A;
  t ^= -1;
  for (let C = i; C < o; C++)
    t = t >>> 8 ^ s[(t ^ e[C]) & 255];
  return t ^ -1;
};
var oA = Pn, Re = {
  2: "need dictionary",
  /* Z_NEED_DICT       2  */
  1: "stream end",
  /* Z_STREAM_END      1  */
  0: "",
  /* Z_OK              0  */
  "-1": "file error",
  /* Z_ERRNO         (-1) */
  "-2": "stream error",
  /* Z_STREAM_ERROR  (-2) */
  "-3": "data error",
  /* Z_DATA_ERROR    (-3) */
  "-4": "insufficient memory",
  /* Z_MEM_ERROR     (-4) */
  "-5": "buffer error",
  /* Z_BUF_ERROR     (-5) */
  "-6": "incompatible version"
  /* Z_VERSION_ERROR (-6) */
}, ai = {
  /* Allowed flush values; see deflate() and inflate() below for details */
  Z_NO_FLUSH: 0,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_TREES: 6,
  /* Return codes for the compression/decompression functions. Negative values
  * are errors, positive values are used for special but normal events.
  */
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  /* The deflate compression method */
  Z_DEFLATED: 8
  //Z_NULL:                 null // Use -1 or null inline, depending on var type
};
const Vn = (t, e) => Object.prototype.hasOwnProperty.call(t, e);
var Xn = function(t) {
  const e = Array.prototype.slice.call(arguments, 1);
  for (; e.length; ) {
    const A = e.shift();
    if (A) {
      if (typeof A != "object")
        throw new TypeError(A + "must be non-object");
      for (const i in A)
        Vn(A, i) && (t[i] = A[i]);
    }
  }
  return t;
}, jn = (t) => {
  let e = 0;
  for (let i = 0, s = t.length; i < s; i++)
    e += t[i].length;
  const A = new Uint8Array(e);
  for (let i = 0, s = 0, o = t.length; i < o; i++) {
    let C = t[i];
    A.set(C, s), s += C.length;
  }
  return A;
}, si = {
  assign: Xn,
  flattenChunks: jn
};
let gi = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  gi = !1;
}
const MA = new Uint8Array(256);
for (let t = 0; t < 256; t++)
  MA[t] = t >= 252 ? 6 : t >= 248 ? 5 : t >= 240 ? 4 : t >= 224 ? 3 : t >= 192 ? 2 : 1;
MA[254] = MA[254] = 1;
var Wn = (t) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(t);
  let e, A, i, s, o, C = t.length, g = 0;
  for (s = 0; s < C; s++)
    A = t.charCodeAt(s), (A & 64512) === 55296 && s + 1 < C && (i = t.charCodeAt(s + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), s++)), g += A < 128 ? 1 : A < 2048 ? 2 : A < 65536 ? 3 : 4;
  for (e = new Uint8Array(g), o = 0, s = 0; o < g; s++)
    A = t.charCodeAt(s), (A & 64512) === 55296 && s + 1 < C && (i = t.charCodeAt(s + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), s++)), A < 128 ? e[o++] = A : A < 2048 ? (e[o++] = 192 | A >>> 6, e[o++] = 128 | A & 63) : A < 65536 ? (e[o++] = 224 | A >>> 12, e[o++] = 128 | A >>> 6 & 63, e[o++] = 128 | A & 63) : (e[o++] = 240 | A >>> 18, e[o++] = 128 | A >>> 12 & 63, e[o++] = 128 | A >>> 6 & 63, e[o++] = 128 | A & 63);
  return e;
};
const Zn = (t, e) => {
  if (e < 65534 && t.subarray && gi)
    return String.fromCharCode.apply(null, t.length === e ? t : t.subarray(0, e));
  let A = "";
  for (let i = 0; i < e; i++)
    A += String.fromCharCode(t[i]);
  return A;
};
var zn = (t, e) => {
  const A = e || t.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(t.subarray(0, e));
  let i, s;
  const o = new Array(A * 2);
  for (s = 0, i = 0; i < A; ) {
    let C = t[i++];
    if (C < 128) {
      o[s++] = C;
      continue;
    }
    let g = MA[C];
    if (g > 4) {
      o[s++] = 65533, i += g - 1;
      continue;
    }
    for (C &= g === 2 ? 31 : g === 3 ? 15 : 7; g > 1 && i < A; )
      C = C << 6 | t[i++] & 63, g--;
    if (g > 1) {
      o[s++] = 65533;
      continue;
    }
    C < 65536 ? o[s++] = C : (C -= 65536, o[s++] = 55296 | C >> 10 & 1023, o[s++] = 56320 | C & 1023);
  }
  return Zn(o, s);
}, $n = (t, e) => {
  e = e || t.length, e > t.length && (e = t.length);
  let A = e - 1;
  for (; A >= 0 && (t[A] & 192) === 128; )
    A--;
  return A < 0 || A === 0 ? e : A + MA[t[A]] > e ? A : e;
}, ve = {
  string2buf: Wn,
  buf2string: zn,
  utf8border: $n
};
function Ao() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var eo = Ao;
const WA = 16209, to = 16191;
var io = function(e, A) {
  let i, s, o, C, g, w, a, r, n, f, I, B, y, c, E, d, p, u, Q, l, h, D, k, S;
  const G = e.state;
  i = e.next_in, k = e.input, s = i + (e.avail_in - 5), o = e.next_out, S = e.output, C = o - (A - e.avail_out), g = o + (e.avail_out - 257), w = G.dmax, a = G.wsize, r = G.whave, n = G.wnext, f = G.window, I = G.hold, B = G.bits, y = G.lencode, c = G.distcode, E = (1 << G.lenbits) - 1, d = (1 << G.distbits) - 1;
  A:
    do {
      B < 15 && (I += k[i++] << B, B += 8, I += k[i++] << B, B += 8), p = y[I & E];
      e:
        for (; ; ) {
          if (u = p >>> 24, I >>>= u, B -= u, u = p >>> 16 & 255, u === 0)
            S[o++] = p & 65535;
          else if (u & 16) {
            Q = p & 65535, u &= 15, u && (B < u && (I += k[i++] << B, B += 8), Q += I & (1 << u) - 1, I >>>= u, B -= u), B < 15 && (I += k[i++] << B, B += 8, I += k[i++] << B, B += 8), p = c[I & d];
            t:
              for (; ; ) {
                if (u = p >>> 24, I >>>= u, B -= u, u = p >>> 16 & 255, u & 16) {
                  if (l = p & 65535, u &= 15, B < u && (I += k[i++] << B, B += 8, B < u && (I += k[i++] << B, B += 8)), l += I & (1 << u) - 1, l > w) {
                    e.msg = "invalid distance too far back", G.mode = WA;
                    break A;
                  }
                  if (I >>>= u, B -= u, u = o - C, l > u) {
                    if (u = l - u, u > r && G.sane) {
                      e.msg = "invalid distance too far back", G.mode = WA;
                      break A;
                    }
                    if (h = 0, D = f, n === 0) {
                      if (h += a - u, u < Q) {
                        Q -= u;
                        do
                          S[o++] = f[h++];
                        while (--u);
                        h = o - l, D = S;
                      }
                    } else if (n < u) {
                      if (h += a + n - u, u -= n, u < Q) {
                        Q -= u;
                        do
                          S[o++] = f[h++];
                        while (--u);
                        if (h = 0, n < Q) {
                          u = n, Q -= u;
                          do
                            S[o++] = f[h++];
                          while (--u);
                          h = o - l, D = S;
                        }
                      }
                    } else if (h += n - u, u < Q) {
                      Q -= u;
                      do
                        S[o++] = f[h++];
                      while (--u);
                      h = o - l, D = S;
                    }
                    for (; Q > 2; )
                      S[o++] = D[h++], S[o++] = D[h++], S[o++] = D[h++], Q -= 3;
                    Q && (S[o++] = D[h++], Q > 1 && (S[o++] = D[h++]));
                  } else {
                    h = o - l;
                    do
                      S[o++] = S[h++], S[o++] = S[h++], S[o++] = S[h++], Q -= 3;
                    while (Q > 2);
                    Q && (S[o++] = S[h++], Q > 1 && (S[o++] = S[h++]));
                  }
                } else if (u & 64) {
                  e.msg = "invalid distance code", G.mode = WA;
                  break A;
                } else {
                  p = c[(p & 65535) + (I & (1 << u) - 1)];
                  continue t;
                }
                break;
              }
          } else if (u & 64)
            if (u & 32) {
              G.mode = to;
              break A;
            } else {
              e.msg = "invalid literal/length code", G.mode = WA;
              break A;
            }
          else {
            p = y[(p & 65535) + (I & (1 << u) - 1)];
            continue e;
          }
          break;
        }
    } while (i < s && o < g);
  Q = B >> 3, i -= Q, B -= Q << 3, I &= (1 << B) - 1, e.next_in = i, e.next_out = o, e.avail_in = i < s ? 5 + (s - i) : 5 - (i - s), e.avail_out = o < g ? 257 + (g - o) : 257 - (o - g), G.hold = I, G.bits = B;
};
const pA = 15, at = 852, st = 592, gt = 0, Qe = 1, It = 2, ro = new Uint16Array([
  /* Length codes 257..285 base */
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  13,
  15,
  17,
  19,
  23,
  27,
  31,
  35,
  43,
  51,
  59,
  67,
  83,
  99,
  115,
  131,
  163,
  195,
  227,
  258,
  0,
  0
]), no = new Uint8Array([
  /* Length codes 257..285 extra */
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  16,
  17,
  17,
  17,
  17,
  18,
  18,
  18,
  18,
  19,
  19,
  19,
  19,
  20,
  20,
  20,
  20,
  21,
  21,
  21,
  21,
  16,
  72,
  78
]), oo = new Uint16Array([
  /* Distance codes 0..29 base */
  1,
  2,
  3,
  4,
  5,
  7,
  9,
  13,
  17,
  25,
  33,
  49,
  65,
  97,
  129,
  193,
  257,
  385,
  513,
  769,
  1025,
  1537,
  2049,
  3073,
  4097,
  6145,
  8193,
  12289,
  16385,
  24577,
  0,
  0
]), ao = new Uint8Array([
  /* Distance codes 0..29 extra */
  16,
  16,
  16,
  16,
  17,
  17,
  18,
  18,
  19,
  19,
  20,
  20,
  21,
  21,
  22,
  22,
  23,
  23,
  24,
  24,
  25,
  25,
  26,
  26,
  27,
  27,
  28,
  28,
  29,
  29,
  64,
  64
]), so = (t, e, A, i, s, o, C, g) => {
  const w = g.bits;
  let a = 0, r = 0, n = 0, f = 0, I = 0, B = 0, y = 0, c = 0, E = 0, d = 0, p, u, Q, l, h, D = null, k;
  const S = new Uint16Array(pA + 1), G = new Uint16Array(pA + 1);
  let x = null, b, R, F;
  for (a = 0; a <= pA; a++)
    S[a] = 0;
  for (r = 0; r < i; r++)
    S[e[A + r]]++;
  for (I = w, f = pA; f >= 1 && S[f] === 0; f--)
    ;
  if (I > f && (I = f), f === 0)
    return s[o++] = 1 << 24 | 64 << 16 | 0, s[o++] = 1 << 24 | 64 << 16 | 0, g.bits = 1, 0;
  for (n = 1; n < f && S[n] === 0; n++)
    ;
  for (I < n && (I = n), c = 1, a = 1; a <= pA; a++)
    if (c <<= 1, c -= S[a], c < 0)
      return -1;
  if (c > 0 && (t === gt || f !== 1))
    return -1;
  for (G[1] = 0, a = 1; a < pA; a++)
    G[a + 1] = G[a] + S[a];
  for (r = 0; r < i; r++)
    e[A + r] !== 0 && (C[G[e[A + r]]++] = r);
  if (t === gt ? (D = x = C, k = 20) : t === Qe ? (D = ro, x = no, k = 257) : (D = oo, x = ao, k = 0), d = 0, r = 0, a = n, h = o, B = I, y = 0, Q = -1, E = 1 << I, l = E - 1, t === Qe && E > at || t === It && E > st)
    return 1;
  for (; ; ) {
    b = a - y, C[r] + 1 < k ? (R = 0, F = C[r]) : C[r] >= k ? (R = x[C[r] - k], F = D[C[r] - k]) : (R = 96, F = 0), p = 1 << a - y, u = 1 << B, n = u;
    do
      u -= p, s[h + (d >> y) + u] = b << 24 | R << 16 | F | 0;
    while (u !== 0);
    for (p = 1 << a - 1; d & p; )
      p >>= 1;
    if (p !== 0 ? (d &= p - 1, d += p) : d = 0, r++, --S[a] === 0) {
      if (a === f)
        break;
      a = e[A + C[r]];
    }
    if (a > I && (d & l) !== Q) {
      for (y === 0 && (y = I), h += n, B = a - y, c = 1 << B; B + y < f && (c -= S[B + y], !(c <= 0)); )
        B++, c <<= 1;
      if (E += 1 << B, t === Qe && E > at || t === It && E > st)
        return 1;
      Q = d & l, s[Q] = I << 24 | B << 16 | h - o | 0;
    }
  }
  return d !== 0 && (s[h + d] = a - y << 24 | 64 << 16 | 0), g.bits = I, 0;
};
var UA = so;
const go = 0, Ii = 1, Bi = 2, {
  Z_FINISH: Bt,
  Z_BLOCK: Io,
  Z_TREES: ZA,
  Z_OK: uA,
  Z_STREAM_END: Bo,
  Z_NEED_DICT: Co,
  Z_STREAM_ERROR: tA,
  Z_DATA_ERROR: Ci,
  Z_MEM_ERROR: fi,
  Z_BUF_ERROR: fo,
  Z_DEFLATED: Ct
} = ai, ie = 16180, ft = 16181, lt = 16182, ct = 16183, Qt = 16184, Et = 16185, ht = 16186, ut = 16187, dt = 16188, wt = 16189, Ae = 16190, sA = 16191, Ee = 16192, yt = 16193, he = 16194, Dt = 16195, pt = 16196, mt = 16197, kt = 16198, zA = 16199, $A = 16200, Ft = 16201, Gt = 16202, St = 16203, xt = 16204, bt = 16205, ue = 16206, Rt = 16207, vt = 16208, P = 16209, li = 16210, ci = 16211, lo = 852, co = 592, Qo = 15, Eo = Qo, Ut = (t) => (t >>> 24 & 255) + (t >>> 8 & 65280) + ((t & 65280) << 8) + ((t & 255) << 24);
function ho() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const wA = (t) => {
  if (!t)
    return 1;
  const e = t.state;
  return !e || e.strm !== t || e.mode < ie || e.mode > ci ? 1 : 0;
}, Qi = (t) => {
  if (wA(t))
    return tA;
  const e = t.state;
  return t.total_in = t.total_out = e.total = 0, t.msg = "", e.wrap && (t.adler = e.wrap & 1), e.mode = ie, e.last = 0, e.havedict = 0, e.flags = -1, e.dmax = 32768, e.head = null, e.hold = 0, e.bits = 0, e.lencode = e.lendyn = new Int32Array(lo), e.distcode = e.distdyn = new Int32Array(co), e.sane = 1, e.back = -1, uA;
}, Ei = (t) => {
  if (wA(t))
    return tA;
  const e = t.state;
  return e.wsize = 0, e.whave = 0, e.wnext = 0, Qi(t);
}, hi = (t, e) => {
  let A;
  if (wA(t))
    return tA;
  const i = t.state;
  return e < 0 ? (A = 0, e = -e) : (A = (e >> 4) + 5, e < 48 && (e &= 15)), e && (e < 8 || e > 15) ? tA : (i.window !== null && i.wbits !== e && (i.window = null), i.wrap = A, i.wbits = e, Ei(t));
}, ui = (t, e) => {
  if (!t)
    return tA;
  const A = new ho();
  t.state = A, A.strm = t, A.window = null, A.mode = ie;
  const i = hi(t, e);
  return i !== uA && (t.state = null), i;
}, uo = (t) => ui(t, Eo);
let Lt = !0, de, we;
const wo = (t) => {
  if (Lt) {
    de = new Int32Array(512), we = new Int32Array(32);
    let e = 0;
    for (; e < 144; )
      t.lens[e++] = 8;
    for (; e < 256; )
      t.lens[e++] = 9;
    for (; e < 280; )
      t.lens[e++] = 7;
    for (; e < 288; )
      t.lens[e++] = 8;
    for (UA(Ii, t.lens, 0, 288, de, 0, t.work, { bits: 9 }), e = 0; e < 32; )
      t.lens[e++] = 5;
    UA(Bi, t.lens, 0, 32, we, 0, t.work, { bits: 5 }), Lt = !1;
  }
  t.lencode = de, t.lenbits = 9, t.distcode = we, t.distbits = 5;
}, di = (t, e, A, i) => {
  let s;
  const o = t.state;
  return o.window === null && (o.wsize = 1 << o.wbits, o.wnext = 0, o.whave = 0, o.window = new Uint8Array(o.wsize)), i >= o.wsize ? (o.window.set(e.subarray(A - o.wsize, A), 0), o.wnext = 0, o.whave = o.wsize) : (s = o.wsize - o.wnext, s > i && (s = i), o.window.set(e.subarray(A - i, A - i + s), o.wnext), i -= s, i ? (o.window.set(e.subarray(A - i, A), 0), o.wnext = i, o.whave = o.wsize) : (o.wnext += s, o.wnext === o.wsize && (o.wnext = 0), o.whave < o.wsize && (o.whave += s))), 0;
}, yo = (t, e) => {
  let A, i, s, o, C, g, w, a, r, n, f, I, B, y, c = 0, E, d, p, u, Q, l, h, D;
  const k = new Uint8Array(4);
  let S, G;
  const x = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (wA(t) || !t.output || !t.input && t.avail_in !== 0)
    return tA;
  A = t.state, A.mode === sA && (A.mode = Ee), C = t.next_out, s = t.output, w = t.avail_out, o = t.next_in, i = t.input, g = t.avail_in, a = A.hold, r = A.bits, n = g, f = w, D = uA;
  A:
    for (; ; )
      switch (A.mode) {
        case ie:
          if (A.wrap === 0) {
            A.mode = Ee;
            break;
          }
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if (A.wrap & 2 && a === 35615) {
            A.wbits === 0 && (A.wbits = 15), A.check = 0, k[0] = a & 255, k[1] = a >>> 8 & 255, A.check = oA(A.check, k, 2, 0), a = 0, r = 0, A.mode = ft;
            break;
          }
          if (A.head && (A.head.done = !1), !(A.wrap & 1) || /* check if zlib header allowed */
          (((a & 255) << 8) + (a >> 8)) % 31) {
            t.msg = "incorrect header check", A.mode = P;
            break;
          }
          if ((a & 15) !== Ct) {
            t.msg = "unknown compression method", A.mode = P;
            break;
          }
          if (a >>>= 4, r -= 4, h = (a & 15) + 8, A.wbits === 0 && (A.wbits = h), h > 15 || h > A.wbits) {
            t.msg = "invalid window size", A.mode = P;
            break;
          }
          A.dmax = 1 << A.wbits, A.flags = 0, t.adler = A.check = 1, A.mode = a & 512 ? wt : sA, a = 0, r = 0;
          break;
        case ft:
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if (A.flags = a, (A.flags & 255) !== Ct) {
            t.msg = "unknown compression method", A.mode = P;
            break;
          }
          if (A.flags & 57344) {
            t.msg = "unknown header flags set", A.mode = P;
            break;
          }
          A.head && (A.head.text = a >> 8 & 1), A.flags & 512 && A.wrap & 4 && (k[0] = a & 255, k[1] = a >>> 8 & 255, A.check = oA(A.check, k, 2, 0)), a = 0, r = 0, A.mode = lt;
        case lt:
          for (; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          A.head && (A.head.time = a), A.flags & 512 && A.wrap & 4 && (k[0] = a & 255, k[1] = a >>> 8 & 255, k[2] = a >>> 16 & 255, k[3] = a >>> 24 & 255, A.check = oA(A.check, k, 4, 0)), a = 0, r = 0, A.mode = ct;
        case ct:
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          A.head && (A.head.xflags = a & 255, A.head.os = a >> 8), A.flags & 512 && A.wrap & 4 && (k[0] = a & 255, k[1] = a >>> 8 & 255, A.check = oA(A.check, k, 2, 0)), a = 0, r = 0, A.mode = Qt;
        case Qt:
          if (A.flags & 1024) {
            for (; r < 16; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            A.length = a, A.head && (A.head.extra_len = a), A.flags & 512 && A.wrap & 4 && (k[0] = a & 255, k[1] = a >>> 8 & 255, A.check = oA(A.check, k, 2, 0)), a = 0, r = 0;
          } else A.head && (A.head.extra = null);
          A.mode = Et;
        case Et:
          if (A.flags & 1024 && (I = A.length, I > g && (I = g), I && (A.head && (h = A.head.extra_len - A.length, A.head.extra || (A.head.extra = new Uint8Array(A.head.extra_len)), A.head.extra.set(
            i.subarray(
              o,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              o + I
            ),
            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
            h
          )), A.flags & 512 && A.wrap & 4 && (A.check = oA(A.check, i, I, o)), g -= I, o += I, A.length -= I), A.length))
            break A;
          A.length = 0, A.mode = ht;
        case ht:
          if (A.flags & 2048) {
            if (g === 0)
              break A;
            I = 0;
            do
              h = i[o + I++], A.head && h && A.length < 65536 && (A.head.name += String.fromCharCode(h));
            while (h && I < g);
            if (A.flags & 512 && A.wrap & 4 && (A.check = oA(A.check, i, I, o)), g -= I, o += I, h)
              break A;
          } else A.head && (A.head.name = null);
          A.length = 0, A.mode = ut;
        case ut:
          if (A.flags & 4096) {
            if (g === 0)
              break A;
            I = 0;
            do
              h = i[o + I++], A.head && h && A.length < 65536 && (A.head.comment += String.fromCharCode(h));
            while (h && I < g);
            if (A.flags & 512 && A.wrap & 4 && (A.check = oA(A.check, i, I, o)), g -= I, o += I, h)
              break A;
          } else A.head && (A.head.comment = null);
          A.mode = dt;
        case dt:
          if (A.flags & 512) {
            for (; r < 16; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.check & 65535)) {
              t.msg = "header crc mismatch", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.head && (A.head.hcrc = A.flags >> 9 & 1, A.head.done = !0), t.adler = A.check = 0, A.mode = sA;
          break;
        case wt:
          for (; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          t.adler = A.check = Ut(a), a = 0, r = 0, A.mode = Ae;
        case Ae:
          if (A.havedict === 0)
            return t.next_out = C, t.avail_out = w, t.next_in = o, t.avail_in = g, A.hold = a, A.bits = r, Co;
          t.adler = A.check = 1, A.mode = sA;
        case sA:
          if (e === Io || e === ZA)
            break A;
        case Ee:
          if (A.last) {
            a >>>= r & 7, r -= r & 7, A.mode = ue;
            break;
          }
          for (; r < 3; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          switch (A.last = a & 1, a >>>= 1, r -= 1, a & 3) {
            case 0:
              A.mode = yt;
              break;
            case 1:
              if (wo(A), A.mode = zA, e === ZA) {
                a >>>= 2, r -= 2;
                break A;
              }
              break;
            case 2:
              A.mode = pt;
              break;
            case 3:
              t.msg = "invalid block type", A.mode = P;
          }
          a >>>= 2, r -= 2;
          break;
        case yt:
          for (a >>>= r & 7, r -= r & 7; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if ((a & 65535) !== (a >>> 16 ^ 65535)) {
            t.msg = "invalid stored block lengths", A.mode = P;
            break;
          }
          if (A.length = a & 65535, a = 0, r = 0, A.mode = he, e === ZA)
            break A;
        case he:
          A.mode = Dt;
        case Dt:
          if (I = A.length, I) {
            if (I > g && (I = g), I > w && (I = w), I === 0)
              break A;
            s.set(i.subarray(o, o + I), C), g -= I, o += I, w -= I, C += I, A.length -= I;
            break;
          }
          A.mode = sA;
          break;
        case pt:
          for (; r < 14; ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if (A.nlen = (a & 31) + 257, a >>>= 5, r -= 5, A.ndist = (a & 31) + 1, a >>>= 5, r -= 5, A.ncode = (a & 15) + 4, a >>>= 4, r -= 4, A.nlen > 286 || A.ndist > 30) {
            t.msg = "too many length or distance symbols", A.mode = P;
            break;
          }
          A.have = 0, A.mode = mt;
        case mt:
          for (; A.have < A.ncode; ) {
            for (; r < 3; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            A.lens[x[A.have++]] = a & 7, a >>>= 3, r -= 3;
          }
          for (; A.have < 19; )
            A.lens[x[A.have++]] = 0;
          if (A.lencode = A.lendyn, A.lenbits = 7, S = { bits: A.lenbits }, D = UA(go, A.lens, 0, 19, A.lencode, 0, A.work, S), A.lenbits = S.bits, D) {
            t.msg = "invalid code lengths set", A.mode = P;
            break;
          }
          A.have = 0, A.mode = kt;
        case kt:
          for (; A.have < A.nlen + A.ndist; ) {
            for (; c = A.lencode[a & (1 << A.lenbits) - 1], E = c >>> 24, d = c >>> 16 & 255, p = c & 65535, !(E <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            if (p < 16)
              a >>>= E, r -= E, A.lens[A.have++] = p;
            else {
              if (p === 16) {
                for (G = E + 2; r < G; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[o++] << r, r += 8;
                }
                if (a >>>= E, r -= E, A.have === 0) {
                  t.msg = "invalid bit length repeat", A.mode = P;
                  break;
                }
                h = A.lens[A.have - 1], I = 3 + (a & 3), a >>>= 2, r -= 2;
              } else if (p === 17) {
                for (G = E + 3; r < G; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[o++] << r, r += 8;
                }
                a >>>= E, r -= E, h = 0, I = 3 + (a & 7), a >>>= 3, r -= 3;
              } else {
                for (G = E + 7; r < G; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[o++] << r, r += 8;
                }
                a >>>= E, r -= E, h = 0, I = 11 + (a & 127), a >>>= 7, r -= 7;
              }
              if (A.have + I > A.nlen + A.ndist) {
                t.msg = "invalid bit length repeat", A.mode = P;
                break;
              }
              for (; I--; )
                A.lens[A.have++] = h;
            }
          }
          if (A.mode === P)
            break;
          if (A.lens[256] === 0) {
            t.msg = "invalid code -- missing end-of-block", A.mode = P;
            break;
          }
          if (A.lenbits = 9, S = { bits: A.lenbits }, D = UA(Ii, A.lens, 0, A.nlen, A.lencode, 0, A.work, S), A.lenbits = S.bits, D) {
            t.msg = "invalid literal/lengths set", A.mode = P;
            break;
          }
          if (A.distbits = 6, A.distcode = A.distdyn, S = { bits: A.distbits }, D = UA(Bi, A.lens, A.nlen, A.ndist, A.distcode, 0, A.work, S), A.distbits = S.bits, D) {
            t.msg = "invalid distances set", A.mode = P;
            break;
          }
          if (A.mode = zA, e === ZA)
            break A;
        case zA:
          A.mode = $A;
        case $A:
          if (g >= 6 && w >= 258) {
            t.next_out = C, t.avail_out = w, t.next_in = o, t.avail_in = g, A.hold = a, A.bits = r, io(t, f), C = t.next_out, s = t.output, w = t.avail_out, o = t.next_in, i = t.input, g = t.avail_in, a = A.hold, r = A.bits, A.mode === sA && (A.back = -1);
            break;
          }
          for (A.back = 0; c = A.lencode[a & (1 << A.lenbits) - 1], E = c >>> 24, d = c >>> 16 & 255, p = c & 65535, !(E <= r); ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if (d && !(d & 240)) {
            for (u = E, Q = d, l = p; c = A.lencode[l + ((a & (1 << u + Q) - 1) >> u)], E = c >>> 24, d = c >>> 16 & 255, p = c & 65535, !(u + E <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            a >>>= u, r -= u, A.back += u;
          }
          if (a >>>= E, r -= E, A.back += E, A.length = p, d === 0) {
            A.mode = bt;
            break;
          }
          if (d & 32) {
            A.back = -1, A.mode = sA;
            break;
          }
          if (d & 64) {
            t.msg = "invalid literal/length code", A.mode = P;
            break;
          }
          A.extra = d & 15, A.mode = Ft;
        case Ft:
          if (A.extra) {
            for (G = A.extra; r < G; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            A.length += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          A.was = A.length, A.mode = Gt;
        case Gt:
          for (; c = A.distcode[a & (1 << A.distbits) - 1], E = c >>> 24, d = c >>> 16 & 255, p = c & 65535, !(E <= r); ) {
            if (g === 0)
              break A;
            g--, a += i[o++] << r, r += 8;
          }
          if (!(d & 240)) {
            for (u = E, Q = d, l = p; c = A.distcode[l + ((a & (1 << u + Q) - 1) >> u)], E = c >>> 24, d = c >>> 16 & 255, p = c & 65535, !(u + E <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            a >>>= u, r -= u, A.back += u;
          }
          if (a >>>= E, r -= E, A.back += E, d & 64) {
            t.msg = "invalid distance code", A.mode = P;
            break;
          }
          A.offset = p, A.extra = d & 15, A.mode = St;
        case St:
          if (A.extra) {
            for (G = A.extra; r < G; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            A.offset += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          if (A.offset > A.dmax) {
            t.msg = "invalid distance too far back", A.mode = P;
            break;
          }
          A.mode = xt;
        case xt:
          if (w === 0)
            break A;
          if (I = f - w, A.offset > I) {
            if (I = A.offset - I, I > A.whave && A.sane) {
              t.msg = "invalid distance too far back", A.mode = P;
              break;
            }
            I > A.wnext ? (I -= A.wnext, B = A.wsize - I) : B = A.wnext - I, I > A.length && (I = A.length), y = A.window;
          } else
            y = s, B = C - A.offset, I = A.length;
          I > w && (I = w), w -= I, A.length -= I;
          do
            s[C++] = y[B++];
          while (--I);
          A.length === 0 && (A.mode = $A);
          break;
        case bt:
          if (w === 0)
            break A;
          s[C++] = A.length, w--, A.mode = $A;
          break;
        case ue:
          if (A.wrap) {
            for (; r < 32; ) {
              if (g === 0)
                break A;
              g--, a |= i[o++] << r, r += 8;
            }
            if (f -= w, t.total_out += f, A.total += f, A.wrap & 4 && f && (t.adler = A.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
            A.flags ? oA(A.check, s, f, C - f) : be(A.check, s, f, C - f)), f = w, A.wrap & 4 && (A.flags ? a : Ut(a)) !== A.check) {
              t.msg = "incorrect data check", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = Rt;
        case Rt:
          if (A.wrap && A.flags) {
            for (; r < 32; ) {
              if (g === 0)
                break A;
              g--, a += i[o++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.total & 4294967295)) {
              t.msg = "incorrect length check", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = vt;
        case vt:
          D = Bo;
          break A;
        case P:
          D = Ci;
          break A;
        case li:
          return fi;
        case ci:
        default:
          return tA;
      }
  return t.next_out = C, t.avail_out = w, t.next_in = o, t.avail_in = g, A.hold = a, A.bits = r, (A.wsize || f !== t.avail_out && A.mode < P && (A.mode < ue || e !== Bt)) && di(t, t.output, t.next_out, f - t.avail_out), n -= t.avail_in, f -= t.avail_out, t.total_in += n, t.total_out += f, A.total += f, A.wrap & 4 && f && (t.adler = A.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
  A.flags ? oA(A.check, s, f, t.next_out - f) : be(A.check, s, f, t.next_out - f)), t.data_type = A.bits + (A.last ? 64 : 0) + (A.mode === sA ? 128 : 0) + (A.mode === zA || A.mode === he ? 256 : 0), (n === 0 && f === 0 || e === Bt) && D === uA && (D = fo), D;
}, Do = (t) => {
  if (wA(t))
    return tA;
  let e = t.state;
  return e.window && (e.window = null), t.state = null, uA;
}, po = (t, e) => {
  if (wA(t))
    return tA;
  const A = t.state;
  return A.wrap & 2 ? (A.head = e, e.done = !1, uA) : tA;
}, mo = (t, e) => {
  const A = e.length;
  let i, s, o;
  return wA(t) || (i = t.state, i.wrap !== 0 && i.mode !== Ae) ? tA : i.mode === Ae && (s = 1, s = be(s, e, A, 0), s !== i.check) ? Ci : (o = di(t, e, A, A), o ? (i.mode = li, fi) : (i.havedict = 1, uA));
};
var ko = Ei, Fo = hi, Go = Qi, So = uo, xo = ui, bo = yo, Ro = Do, vo = po, Uo = mo, Lo = "pako inflate (from Nodeca project)", BA = {
  inflateReset: ko,
  inflateReset2: Fo,
  inflateResetKeep: Go,
  inflateInit: So,
  inflateInit2: xo,
  inflate: bo,
  inflateEnd: Ro,
  inflateGetHeader: vo,
  inflateSetDictionary: Uo,
  inflateInfo: Lo
};
function Mo() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var No = Mo;
const wi = Object.prototype.toString, {
  Z_NO_FLUSH: qo,
  Z_FINISH: To,
  Z_OK: NA,
  Z_STREAM_END: ye,
  Z_NEED_DICT: De,
  Z_STREAM_ERROR: Jo,
  Z_DATA_ERROR: Mt,
  Z_MEM_ERROR: Yo
} = ai;
function re(t) {
  this.options = si.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, t || {});
  const e = this.options;
  e.raw && e.windowBits >= 0 && e.windowBits < 16 && (e.windowBits = -e.windowBits, e.windowBits === 0 && (e.windowBits = -15)), e.windowBits >= 0 && e.windowBits < 16 && !(t && t.windowBits) && (e.windowBits += 32), e.windowBits > 15 && e.windowBits < 48 && (e.windowBits & 15 || (e.windowBits |= 15)), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new eo(), this.strm.avail_out = 0;
  let A = BA.inflateInit2(
    this.strm,
    e.windowBits
  );
  if (A !== NA)
    throw new Error(Re[A]);
  if (this.header = new No(), BA.inflateGetHeader(this.strm, this.header), e.dictionary && (typeof e.dictionary == "string" ? e.dictionary = ve.string2buf(e.dictionary) : wi.call(e.dictionary) === "[object ArrayBuffer]" && (e.dictionary = new Uint8Array(e.dictionary)), e.raw && (A = BA.inflateSetDictionary(this.strm, e.dictionary), A !== NA)))
    throw new Error(Re[A]);
}
re.prototype.push = function(t, e) {
  const A = this.strm, i = this.options.chunkSize, s = this.options.dictionary;
  let o, C, g;
  if (this.ended) return !1;
  for (e === ~~e ? C = e : C = e === !0 ? To : qo, wi.call(t) === "[object ArrayBuffer]" ? A.input = new Uint8Array(t) : A.input = t, A.next_in = 0, A.avail_in = A.input.length; ; ) {
    for (A.avail_out === 0 && (A.output = new Uint8Array(i), A.next_out = 0, A.avail_out = i), o = BA.inflate(A, C), o === De && s && (o = BA.inflateSetDictionary(A, s), o === NA ? o = BA.inflate(A, C) : o === Mt && (o = De)); A.avail_in > 0 && o === ye && A.state.wrap > 0 && t[A.next_in] !== 0; )
      BA.inflateReset(A), o = BA.inflate(A, C);
    switch (o) {
      case Jo:
      case Mt:
      case De:
      case Yo:
        return this.onEnd(o), this.ended = !0, !1;
    }
    if (g = A.avail_out, A.next_out && (A.avail_out === 0 || o === ye))
      if (this.options.to === "string") {
        let w = ve.utf8border(A.output, A.next_out), a = A.next_out - w, r = ve.buf2string(A.output, w);
        A.next_out = a, A.avail_out = i - a, a && A.output.set(A.output.subarray(w, w + a), 0), this.onData(r);
      } else
        this.onData(A.output.length === A.next_out ? A.output : A.output.subarray(0, A.next_out));
    if (!(o === NA && g === 0)) {
      if (o === ye)
        return o = BA.inflateEnd(this.strm), this.onEnd(o), this.ended = !0, !0;
      if (A.avail_in === 0) break;
    }
  }
  return !0;
};
re.prototype.onData = function(t) {
  this.chunks.push(t);
};
re.prototype.onEnd = function(t) {
  t === NA && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = si.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
function Ho(t, e) {
  const A = new re(e);
  if (A.push(t), A.err) throw A.msg || Re[A.err];
  return A.result;
}
var Ko = Ho, Oo = {
  inflate: Ko
};
const { inflate: _o } = Oo;
var yi = _o;
class Po extends dA {
  decodeBlock(e) {
    return yi(new Uint8Array(e)).buffer;
  }
}
const Vo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Po
}, Symbol.toStringTag, { value: "Module" }));
class Xo extends dA {
  decodeBlock(e) {
    const A = new DataView(e), i = [];
    for (let s = 0; s < e.byteLength; ++s) {
      let o = A.getInt8(s);
      if (o < 0) {
        const C = A.getUint8(s + 1);
        o = -o;
        for (let g = 0; g <= o; ++g)
          i.push(C);
        s += 1;
      } else {
        for (let C = 0; C <= o; ++C)
          i.push(A.getUint8(s + C + 1));
        s += o + 1;
      }
    }
    return new Uint8Array(i).buffer;
  }
}
const jo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Xo
}, Symbol.toStringTag, { value: "Module" }));
var Di = { exports: {} };
(function(t) {
  /* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */
  (function() {
    var e = function() {
      var o = {};
      o.defaultNoDataValue = -34027999387901484e22, o.decode = function(n, f) {
        f = f || {};
        var I = f.encodedMaskData || f.encodedMaskData === null, B = a(n, f.inputOffset || 0, I), y = f.noDataValue !== null ? f.noDataValue : o.defaultNoDataValue, c = C(
          B,
          f.pixelType || Float32Array,
          f.encodedMaskData,
          y,
          f.returnMask
        ), E = {
          width: B.width,
          height: B.height,
          pixelData: c.resultPixels,
          minValue: c.minValue,
          maxValue: B.pixels.maxValue,
          noDataValue: y
        };
        return c.resultMask && (E.maskData = c.resultMask), f.returnEncodedMask && B.mask && (E.encodedMaskData = B.mask.bitset ? B.mask.bitset : null), f.returnFileInfo && (E.fileInfo = g(B), f.computeUsedBitDepths && (E.fileInfo.bitDepths = w(B))), E;
      };
      var C = function(n, f, I, B, y) {
        var c = 0, E = n.pixels.numBlocksX, d = n.pixels.numBlocksY, p = Math.floor(n.width / E), u = Math.floor(n.height / d), Q = 2 * n.maxZError, l = Number.MAX_VALUE, h;
        I = I || (n.mask ? n.mask.bitset : null);
        var D, k;
        D = new f(n.width * n.height), y && I && (k = new Uint8Array(n.width * n.height));
        for (var S = new Float32Array(p * u), G, x, b = 0; b <= d; b++) {
          var R = b !== d ? u : n.height % d;
          if (R !== 0)
            for (var F = 0; F <= E; F++) {
              var m = F !== E ? p : n.width % E;
              if (m !== 0) {
                var U = b * n.width * u + F * p, N = n.width - m, v = n.pixels.blocks[c], M, L, T;
                v.encoding < 2 ? (v.encoding === 0 ? M = v.rawData : (r(v.stuffedData, v.bitsPerPixel, v.numValidPixels, v.offset, Q, S, n.pixels.maxValue), M = S), L = 0) : v.encoding === 2 ? T = 0 : T = v.offset;
                var K;
                if (I)
                  for (x = 0; x < R; x++) {
                    for (U & 7 && (K = I[U >> 3], K <<= U & 7), G = 0; G < m; G++)
                      U & 7 || (K = I[U >> 3]), K & 128 ? (k && (k[U] = 1), h = v.encoding < 2 ? M[L++] : T, l = l > h ? h : l, D[U++] = h) : (k && (k[U] = 0), D[U++] = B), K <<= 1;
                    U += N;
                  }
                else if (v.encoding < 2)
                  for (x = 0; x < R; x++) {
                    for (G = 0; G < m; G++)
                      h = M[L++], l = l > h ? h : l, D[U++] = h;
                    U += N;
                  }
                else
                  for (l = l > T ? T : l, x = 0; x < R; x++) {
                    for (G = 0; G < m; G++)
                      D[U++] = T;
                    U += N;
                  }
                if (v.encoding === 1 && L !== v.numValidPixels)
                  throw "Block and Mask do not match";
                c++;
              }
            }
        }
        return {
          resultPixels: D,
          resultMask: k,
          minValue: l
        };
      }, g = function(n) {
        return {
          fileIdentifierString: n.fileIdentifierString,
          fileVersion: n.fileVersion,
          imageType: n.imageType,
          height: n.height,
          width: n.width,
          maxZError: n.maxZError,
          eofOffset: n.eofOffset,
          mask: n.mask ? {
            numBlocksX: n.mask.numBlocksX,
            numBlocksY: n.mask.numBlocksY,
            numBytes: n.mask.numBytes,
            maxValue: n.mask.maxValue
          } : null,
          pixels: {
            numBlocksX: n.pixels.numBlocksX,
            numBlocksY: n.pixels.numBlocksY,
            numBytes: n.pixels.numBytes,
            maxValue: n.pixels.maxValue,
            noDataValue: n.noDataValue
          }
        };
      }, w = function(n) {
        for (var f = n.pixels.numBlocksX * n.pixels.numBlocksY, I = {}, B = 0; B < f; B++) {
          var y = n.pixels.blocks[B];
          y.encoding === 0 ? I.float32 = !0 : y.encoding === 1 ? I[y.bitsPerPixel] = !0 : I[0] = !0;
        }
        return Object.keys(I);
      }, a = function(n, f, I) {
        var B = {}, y = new Uint8Array(n, f, 10);
        if (B.fileIdentifierString = String.fromCharCode.apply(null, y), B.fileIdentifierString.trim() !== "CntZImage")
          throw "Unexpected file identifier string: " + B.fileIdentifierString;
        f += 10;
        var c = new DataView(n, f, 24);
        if (B.fileVersion = c.getInt32(0, !0), B.imageType = c.getInt32(4, !0), B.height = c.getUint32(8, !0), B.width = c.getUint32(12, !0), B.maxZError = c.getFloat64(16, !0), f += 24, !I)
          if (c = new DataView(n, f, 16), B.mask = {}, B.mask.numBlocksY = c.getUint32(0, !0), B.mask.numBlocksX = c.getUint32(4, !0), B.mask.numBytes = c.getUint32(8, !0), B.mask.maxValue = c.getFloat32(12, !0), f += 16, B.mask.numBytes > 0) {
            var E = new Uint8Array(Math.ceil(B.width * B.height / 8));
            c = new DataView(n, f, B.mask.numBytes);
            var d = c.getInt16(0, !0), p = 2, u = 0;
            do {
              if (d > 0)
                for (; d--; )
                  E[u++] = c.getUint8(p++);
              else {
                var Q = c.getUint8(p++);
                for (d = -d; d--; )
                  E[u++] = Q;
              }
              d = c.getInt16(p, !0), p += 2;
            } while (p < B.mask.numBytes);
            if (d !== -32768 || u < E.length)
              throw "Unexpected end of mask RLE encoding";
            B.mask.bitset = E, f += B.mask.numBytes;
          } else B.mask.numBytes | B.mask.numBlocksY | B.mask.maxValue || (B.mask.bitset = new Uint8Array(Math.ceil(B.width * B.height / 8)));
        c = new DataView(n, f, 16), B.pixels = {}, B.pixels.numBlocksY = c.getUint32(0, !0), B.pixels.numBlocksX = c.getUint32(4, !0), B.pixels.numBytes = c.getUint32(8, !0), B.pixels.maxValue = c.getFloat32(12, !0), f += 16;
        var l = B.pixels.numBlocksX, h = B.pixels.numBlocksY, D = l + (B.width % l > 0 ? 1 : 0), k = h + (B.height % h > 0 ? 1 : 0);
        B.pixels.blocks = new Array(D * k);
        for (var S = 0, G = 0; G < k; G++)
          for (var x = 0; x < D; x++) {
            var b = 0, R = n.byteLength - f;
            c = new DataView(n, f, Math.min(10, R));
            var F = {};
            B.pixels.blocks[S++] = F;
            var m = c.getUint8(0);
            if (b++, F.encoding = m & 63, F.encoding > 3)
              throw "Invalid block encoding (" + F.encoding + ")";
            if (F.encoding === 2) {
              f++;
              continue;
            }
            if (m !== 0 && m !== 2) {
              if (m >>= 6, F.offsetType = m, m === 2)
                F.offset = c.getInt8(1), b++;
              else if (m === 1)
                F.offset = c.getInt16(1, !0), b += 2;
              else if (m === 0)
                F.offset = c.getFloat32(1, !0), b += 4;
              else
                throw "Invalid block offset type";
              if (F.encoding === 1)
                if (m = c.getUint8(b), b++, F.bitsPerPixel = m & 63, m >>= 6, F.numValidPixelsType = m, m === 2)
                  F.numValidPixels = c.getUint8(b), b++;
                else if (m === 1)
                  F.numValidPixels = c.getUint16(b, !0), b += 2;
                else if (m === 0)
                  F.numValidPixels = c.getUint32(b, !0), b += 4;
                else
                  throw "Invalid valid pixel count type";
            }
            if (f += b, F.encoding !== 3) {
              var U, N;
              if (F.encoding === 0) {
                var v = (B.pixels.numBytes - 1) / 4;
                if (v !== Math.floor(v))
                  throw "uncompressed block has invalid length";
                U = new ArrayBuffer(v * 4), N = new Uint8Array(U), N.set(new Uint8Array(n, f, v * 4));
                var M = new Float32Array(U);
                F.rawData = M, f += v * 4;
              } else if (F.encoding === 1) {
                var L = Math.ceil(F.numValidPixels * F.bitsPerPixel / 8), T = Math.ceil(L / 4);
                U = new ArrayBuffer(T * 4), N = new Uint8Array(U), N.set(new Uint8Array(n, f, L)), F.stuffedData = new Uint32Array(U), f += L;
              }
            }
          }
        return B.eofOffset = f, B;
      }, r = function(n, f, I, B, y, c, E) {
        var d = (1 << f) - 1, p = 0, u, Q = 0, l, h, D = Math.ceil((E - B) / y), k = n.length * 4 - Math.ceil(f * I / 8);
        for (n[n.length - 1] <<= 8 * k, u = 0; u < I; u++) {
          if (Q === 0 && (h = n[p++], Q = 32), Q >= f)
            l = h >>> Q - f & d, Q -= f;
          else {
            var S = f - Q;
            l = (h & d) << S & d, h = n[p++], Q = 32 - S, l += h >>> Q;
          }
          c[u] = l < D ? B + l * y : E;
        }
        return c;
      };
      return o;
    }(), A = /* @__PURE__ */ function() {
      var o = {
        //methods ending with 2 are for the new byte order used by Lerc2.3 and above.
        //originalUnstuff is used to unpack Huffman code table. code is duplicated to unstuffx for performance reasons.
        unstuff: function(a, r, n, f, I, B, y, c) {
          var E = (1 << n) - 1, d = 0, p, u = 0, Q, l, h, D, k = a.length * 4 - Math.ceil(n * f / 8);
          if (a[a.length - 1] <<= 8 * k, I)
            for (p = 0; p < f; p++)
              u === 0 && (l = a[d++], u = 32), u >= n ? (Q = l >>> u - n & E, u -= n) : (h = n - u, Q = (l & E) << h & E, l = a[d++], u = 32 - h, Q += l >>> u), r[p] = I[Q];
          else
            for (D = Math.ceil((c - B) / y), p = 0; p < f; p++)
              u === 0 && (l = a[d++], u = 32), u >= n ? (Q = l >>> u - n & E, u -= n) : (h = n - u, Q = (l & E) << h & E, l = a[d++], u = 32 - h, Q += l >>> u), r[p] = Q < D ? B + Q * y : c;
        },
        unstuffLUT: function(a, r, n, f, I, B) {
          var y = (1 << r) - 1, c = 0, E = 0, d = 0, p = 0, u = 0, Q, l = [], h = a.length * 4 - Math.ceil(r * n / 8);
          a[a.length - 1] <<= 8 * h;
          var D = Math.ceil((B - f) / I);
          for (E = 0; E < n; E++)
            p === 0 && (Q = a[c++], p = 32), p >= r ? (u = Q >>> p - r & y, p -= r) : (d = r - p, u = (Q & y) << d & y, Q = a[c++], p = 32 - d, u += Q >>> p), l[E] = u < D ? f + u * I : B;
          return l.unshift(f), l;
        },
        unstuff2: function(a, r, n, f, I, B, y, c) {
          var E = (1 << n) - 1, d = 0, p, u = 0, Q = 0, l, h, D;
          if (I)
            for (p = 0; p < f; p++)
              u === 0 && (h = a[d++], u = 32, Q = 0), u >= n ? (l = h >>> Q & E, u -= n, Q += n) : (D = n - u, l = h >>> Q & E, h = a[d++], u = 32 - D, l |= (h & (1 << D) - 1) << n - D, Q = D), r[p] = I[l];
          else {
            var k = Math.ceil((c - B) / y);
            for (p = 0; p < f; p++)
              u === 0 && (h = a[d++], u = 32, Q = 0), u >= n ? (l = h >>> Q & E, u -= n, Q += n) : (D = n - u, l = h >>> Q & E, h = a[d++], u = 32 - D, l |= (h & (1 << D) - 1) << n - D, Q = D), r[p] = l < k ? B + l * y : c;
          }
          return r;
        },
        unstuffLUT2: function(a, r, n, f, I, B) {
          var y = (1 << r) - 1, c = 0, E = 0, d = 0, p = 0, u = 0, Q = 0, l, h = [], D = Math.ceil((B - f) / I);
          for (E = 0; E < n; E++)
            p === 0 && (l = a[c++], p = 32, Q = 0), p >= r ? (u = l >>> Q & y, p -= r, Q += r) : (d = r - p, u = l >>> Q & y, l = a[c++], p = 32 - d, u |= (l & (1 << d) - 1) << r - d, Q = d), h[E] = u < D ? f + u * I : B;
          return h.unshift(f), h;
        },
        originalUnstuff: function(a, r, n, f) {
          var I = (1 << n) - 1, B = 0, y, c = 0, E, d, p, u = a.length * 4 - Math.ceil(n * f / 8);
          for (a[a.length - 1] <<= 8 * u, y = 0; y < f; y++)
            c === 0 && (d = a[B++], c = 32), c >= n ? (E = d >>> c - n & I, c -= n) : (p = n - c, E = (d & I) << p & I, d = a[B++], c = 32 - p, E += d >>> c), r[y] = E;
          return r;
        },
        originalUnstuff2: function(a, r, n, f) {
          var I = (1 << n) - 1, B = 0, y, c = 0, E = 0, d, p, u;
          for (y = 0; y < f; y++)
            c === 0 && (p = a[B++], c = 32, E = 0), c >= n ? (d = p >>> E & I, c -= n, E += n) : (u = n - c, d = p >>> E & I, p = a[B++], c = 32 - u, d |= (p & (1 << u) - 1) << n - u, E = u), r[y] = d;
          return r;
        }
      }, C = {
        HUFFMAN_LUT_BITS_MAX: 12,
        //use 2^12 lut, treat it like constant
        computeChecksumFletcher32: function(a) {
          for (var r = 65535, n = 65535, f = a.length, I = Math.floor(f / 2), B = 0; I; ) {
            var y = I >= 359 ? 359 : I;
            I -= y;
            do
              r += a[B++] << 8, n += r += a[B++];
            while (--y);
            r = (r & 65535) + (r >>> 16), n = (n & 65535) + (n >>> 16);
          }
          return f & 1 && (n += r += a[B] << 8), r = (r & 65535) + (r >>> 16), n = (n & 65535) + (n >>> 16), (n << 16 | r) >>> 0;
        },
        readHeaderInfo: function(a, r) {
          var n = r.ptr, f = new Uint8Array(a, n, 6), I = {};
          if (I.fileIdentifierString = String.fromCharCode.apply(null, f), I.fileIdentifierString.lastIndexOf("Lerc2", 0) !== 0)
            throw "Unexpected file identifier string (expect Lerc2 ): " + I.fileIdentifierString;
          n += 6;
          var B = new DataView(a, n, 8), y = B.getInt32(0, !0);
          I.fileVersion = y, n += 4, y >= 3 && (I.checksum = B.getUint32(4, !0), n += 4), B = new DataView(a, n, 12), I.height = B.getUint32(0, !0), I.width = B.getUint32(4, !0), n += 8, y >= 4 ? (I.numDims = B.getUint32(8, !0), n += 4) : I.numDims = 1, B = new DataView(a, n, 40), I.numValidPixel = B.getUint32(0, !0), I.microBlockSize = B.getInt32(4, !0), I.blobSize = B.getInt32(8, !0), I.imageType = B.getInt32(12, !0), I.maxZError = B.getFloat64(16, !0), I.zMin = B.getFloat64(24, !0), I.zMax = B.getFloat64(32, !0), n += 40, r.headerInfo = I, r.ptr = n;
          var c, E;
          if (y >= 3 && (E = y >= 4 ? 52 : 48, c = this.computeChecksumFletcher32(new Uint8Array(a, n - E, I.blobSize - 14)), c !== I.checksum))
            throw "Checksum failed.";
          return !0;
        },
        checkMinMaxRanges: function(a, r) {
          var n = r.headerInfo, f = this.getDataTypeArray(n.imageType), I = n.numDims * this.getDataTypeSize(n.imageType), B = this.readSubArray(a, r.ptr, f, I), y = this.readSubArray(a, r.ptr + I, f, I);
          r.ptr += 2 * I;
          var c, E = !0;
          for (c = 0; c < n.numDims; c++)
            if (B[c] !== y[c]) {
              E = !1;
              break;
            }
          return n.minValues = B, n.maxValues = y, E;
        },
        readSubArray: function(a, r, n, f) {
          var I;
          if (n === Uint8Array)
            I = new Uint8Array(a, r, f);
          else {
            var B = new ArrayBuffer(f), y = new Uint8Array(B);
            y.set(new Uint8Array(a, r, f)), I = new n(B);
          }
          return I;
        },
        readMask: function(a, r) {
          var n = r.ptr, f = r.headerInfo, I = f.width * f.height, B = f.numValidPixel, y = new DataView(a, n, 4), c = {};
          if (c.numBytes = y.getUint32(0, !0), n += 4, (B === 0 || I === B) && c.numBytes !== 0)
            throw "invalid mask";
          var E, d;
          if (B === 0)
            E = new Uint8Array(Math.ceil(I / 8)), c.bitset = E, d = new Uint8Array(I), r.pixels.resultMask = d, n += c.numBytes;
          else if (c.numBytes > 0) {
            E = new Uint8Array(Math.ceil(I / 8)), y = new DataView(a, n, c.numBytes);
            var p = y.getInt16(0, !0), u = 2, Q = 0, l = 0;
            do {
              if (p > 0)
                for (; p--; )
                  E[Q++] = y.getUint8(u++);
              else
                for (l = y.getUint8(u++), p = -p; p--; )
                  E[Q++] = l;
              p = y.getInt16(u, !0), u += 2;
            } while (u < c.numBytes);
            if (p !== -32768 || Q < E.length)
              throw "Unexpected end of mask RLE encoding";
            d = new Uint8Array(I);
            var h = 0, D = 0;
            for (D = 0; D < I; D++)
              D & 7 ? (h = E[D >> 3], h <<= D & 7) : h = E[D >> 3], h & 128 && (d[D] = 1);
            r.pixels.resultMask = d, c.bitset = E, n += c.numBytes;
          }
          return r.ptr = n, r.mask = c, !0;
        },
        readDataOneSweep: function(a, r, n, f) {
          var I = r.ptr, B = r.headerInfo, y = B.numDims, c = B.width * B.height, E = B.imageType, d = B.numValidPixel * C.getDataTypeSize(E) * y, p, u = r.pixels.resultMask;
          if (n === Uint8Array)
            p = new Uint8Array(a, I, d);
          else {
            var Q = new ArrayBuffer(d), l = new Uint8Array(Q);
            l.set(new Uint8Array(a, I, d)), p = new n(Q);
          }
          if (p.length === c * y)
            f ? r.pixels.resultPixels = C.swapDimensionOrder(p, c, y, n, !0) : r.pixels.resultPixels = p;
          else {
            r.pixels.resultPixels = new n(c * y);
            var h = 0, D = 0, k = 0, S = 0;
            if (y > 1) {
              if (f) {
                for (D = 0; D < c; D++)
                  if (u[D])
                    for (S = D, k = 0; k < y; k++, S += c)
                      r.pixels.resultPixels[S] = p[h++];
              } else
                for (D = 0; D < c; D++)
                  if (u[D])
                    for (S = D * y, k = 0; k < y; k++)
                      r.pixels.resultPixels[S + k] = p[h++];
            } else
              for (D = 0; D < c; D++)
                u[D] && (r.pixels.resultPixels[D] = p[h++]);
          }
          return I += d, r.ptr = I, !0;
        },
        readHuffmanTree: function(a, r) {
          var n = this.HUFFMAN_LUT_BITS_MAX, f = new DataView(a, r.ptr, 16);
          r.ptr += 16;
          var I = f.getInt32(0, !0);
          if (I < 2)
            throw "unsupported Huffman version";
          var B = f.getInt32(4, !0), y = f.getInt32(8, !0), c = f.getInt32(12, !0);
          if (y >= c)
            return !1;
          var E = new Uint32Array(c - y);
          C.decodeBits(a, r, E);
          var d = [], p, u, Q, l;
          for (p = y; p < c; p++)
            u = p - (p < B ? 0 : B), d[u] = { first: E[p - y], second: null };
          var h = a.byteLength - r.ptr, D = Math.ceil(h / 4), k = new ArrayBuffer(D * 4), S = new Uint8Array(k);
          S.set(new Uint8Array(a, r.ptr, h));
          var G = new Uint32Array(k), x = 0, b, R = 0;
          for (b = G[0], p = y; p < c; p++)
            u = p - (p < B ? 0 : B), l = d[u].first, l > 0 && (d[u].second = b << x >>> 32 - l, 32 - x >= l ? (x += l, x === 32 && (x = 0, R++, b = G[R])) : (x += l - 32, R++, b = G[R], d[u].second |= b >>> 32 - x));
          var F = 0, m = 0, U = new g();
          for (p = 0; p < d.length; p++)
            d[p] !== void 0 && (F = Math.max(F, d[p].first));
          F >= n ? m = n : m = F;
          var N = [], v, M, L, T, K, q;
          for (p = y; p < c; p++)
            if (u = p - (p < B ? 0 : B), l = d[u].first, l > 0)
              if (v = [l, u], l <= m)
                for (M = d[u].second << m - l, L = 1 << m - l, Q = 0; Q < L; Q++)
                  N[M | Q] = v;
              else
                for (M = d[u].second, q = U, T = l - 1; T >= 0; T--)
                  K = M >>> T & 1, K ? (q.right || (q.right = new g()), q = q.right) : (q.left || (q.left = new g()), q = q.left), T === 0 && !q.val && (q.val = v[1]);
          return {
            decodeLut: N,
            numBitsLUTQick: m,
            numBitsLUT: F,
            tree: U,
            stuffedData: G,
            srcPtr: R,
            bitPos: x
          };
        },
        readHuffman: function(a, r, n, f) {
          var I = r.headerInfo, B = I.numDims, y = r.headerInfo.height, c = r.headerInfo.width, E = c * y, d = this.readHuffmanTree(a, r), p = d.decodeLut, u = d.tree, Q = d.stuffedData, l = d.srcPtr, h = d.bitPos, D = d.numBitsLUTQick, k = d.numBitsLUT, S = r.headerInfo.imageType === 0 ? 128 : 0, G, x, b, R = r.pixels.resultMask, F, m, U, N, v, M, L, T = 0;
          h > 0 && (l++, h = 0);
          var K = Q[l], q = r.encodeMode === 1, J = new n(E * B), Y = J, O;
          if (B < 2 || q) {
            for (O = 0; O < B; O++)
              if (B > 1 && (Y = new n(J.buffer, E * O, E), T = 0), r.headerInfo.numValidPixel === c * y)
                for (M = 0, N = 0; N < y; N++)
                  for (v = 0; v < c; v++, M++) {
                    if (x = 0, F = K << h >>> 32 - D, m = F, 32 - h < D && (F |= Q[l + 1] >>> 64 - h - D, m = F), p[m])
                      x = p[m][1], h += p[m][0];
                    else
                      for (F = K << h >>> 32 - k, m = F, 32 - h < k && (F |= Q[l + 1] >>> 64 - h - k, m = F), G = u, L = 0; L < k; L++)
                        if (U = F >>> k - L - 1 & 1, G = U ? G.right : G.left, !(G.left || G.right)) {
                          x = G.val, h = h + L + 1;
                          break;
                        }
                    h >= 32 && (h -= 32, l++, K = Q[l]), b = x - S, q ? (v > 0 ? b += T : N > 0 ? b += Y[M - c] : b += T, b &= 255, Y[M] = b, T = b) : Y[M] = b;
                  }
              else
                for (M = 0, N = 0; N < y; N++)
                  for (v = 0; v < c; v++, M++)
                    if (R[M]) {
                      if (x = 0, F = K << h >>> 32 - D, m = F, 32 - h < D && (F |= Q[l + 1] >>> 64 - h - D, m = F), p[m])
                        x = p[m][1], h += p[m][0];
                      else
                        for (F = K << h >>> 32 - k, m = F, 32 - h < k && (F |= Q[l + 1] >>> 64 - h - k, m = F), G = u, L = 0; L < k; L++)
                          if (U = F >>> k - L - 1 & 1, G = U ? G.right : G.left, !(G.left || G.right)) {
                            x = G.val, h = h + L + 1;
                            break;
                          }
                      h >= 32 && (h -= 32, l++, K = Q[l]), b = x - S, q ? (v > 0 && R[M - 1] ? b += T : N > 0 && R[M - c] ? b += Y[M - c] : b += T, b &= 255, Y[M] = b, T = b) : Y[M] = b;
                    }
          } else
            for (M = 0, N = 0; N < y; N++)
              for (v = 0; v < c; v++)
                if (M = N * c + v, !R || R[M])
                  for (O = 0; O < B; O++, M += E) {
                    if (x = 0, F = K << h >>> 32 - D, m = F, 32 - h < D && (F |= Q[l + 1] >>> 64 - h - D, m = F), p[m])
                      x = p[m][1], h += p[m][0];
                    else
                      for (F = K << h >>> 32 - k, m = F, 32 - h < k && (F |= Q[l + 1] >>> 64 - h - k, m = F), G = u, L = 0; L < k; L++)
                        if (U = F >>> k - L - 1 & 1, G = U ? G.right : G.left, !(G.left || G.right)) {
                          x = G.val, h = h + L + 1;
                          break;
                        }
                    h >= 32 && (h -= 32, l++, K = Q[l]), b = x - S, Y[M] = b;
                  }
          r.ptr = r.ptr + (l + 1) * 4 + (h > 0 ? 4 : 0), r.pixels.resultPixels = J, B > 1 && !f && (r.pixels.resultPixels = C.swapDimensionOrder(J, E, B, n));
        },
        decodeBits: function(a, r, n, f, I) {
          {
            var B = r.headerInfo, y = B.fileVersion, c = 0, E = a.byteLength - r.ptr >= 5 ? 5 : a.byteLength - r.ptr, d = new DataView(a, r.ptr, E), p = d.getUint8(0);
            c++;
            var u = p >> 6, Q = u === 0 ? 4 : 3 - u, l = (p & 32) > 0, h = p & 31, D = 0;
            if (Q === 1)
              D = d.getUint8(c), c++;
            else if (Q === 2)
              D = d.getUint16(c, !0), c += 2;
            else if (Q === 4)
              D = d.getUint32(c, !0), c += 4;
            else
              throw "Invalid valid pixel count type";
            var k = 2 * B.maxZError, S, G, x, b, R, F, m, U, N, v = B.numDims > 1 ? B.maxValues[I] : B.zMax;
            if (l) {
              for (r.counter.lut++, U = d.getUint8(c), c++, b = Math.ceil((U - 1) * h / 8), R = Math.ceil(b / 4), G = new ArrayBuffer(R * 4), x = new Uint8Array(G), r.ptr += c, x.set(new Uint8Array(a, r.ptr, b)), m = new Uint32Array(G), r.ptr += b, N = 0; U - 1 >>> N; )
                N++;
              b = Math.ceil(D * N / 8), R = Math.ceil(b / 4), G = new ArrayBuffer(R * 4), x = new Uint8Array(G), x.set(new Uint8Array(a, r.ptr, b)), S = new Uint32Array(G), r.ptr += b, y >= 3 ? F = o.unstuffLUT2(m, h, U - 1, f, k, v) : F = o.unstuffLUT(m, h, U - 1, f, k, v), y >= 3 ? o.unstuff2(S, n, N, D, F) : o.unstuff(S, n, N, D, F);
            } else
              r.counter.bitstuffer++, N = h, r.ptr += c, N > 0 && (b = Math.ceil(D * N / 8), R = Math.ceil(b / 4), G = new ArrayBuffer(R * 4), x = new Uint8Array(G), x.set(new Uint8Array(a, r.ptr, b)), S = new Uint32Array(G), r.ptr += b, y >= 3 ? f == null ? o.originalUnstuff2(S, n, N, D) : o.unstuff2(S, n, N, D, !1, f, k, v) : f == null ? o.originalUnstuff(S, n, N, D) : o.unstuff(S, n, N, D, !1, f, k, v));
          }
        },
        readTiles: function(a, r, n, f) {
          var I = r.headerInfo, B = I.width, y = I.height, c = B * y, E = I.microBlockSize, d = I.imageType, p = C.getDataTypeSize(d), u = Math.ceil(B / E), Q = Math.ceil(y / E);
          r.pixels.numBlocksY = Q, r.pixels.numBlocksX = u, r.pixels.ptr = 0;
          var l = 0, h = 0, D = 0, k = 0, S = 0, G = 0, x = 0, b = 0, R = 0, F = 0, m = 0, U = 0, N = 0, v = 0, M = 0, L = 0, T, K, q, J, Y, O, _ = new n(E * E), V = y % E || E, X = B % E || E, AA, z, JA = I.numDims, QA, iA = r.pixels.resultMask, eA = r.pixels.resultPixels, mi = I.fileVersion, Ze = mi >= 5 ? 14 : 15, CA, ne = I.zMax, fA;
          for (D = 0; D < Q; D++)
            for (S = D !== Q - 1 ? E : V, k = 0; k < u; k++)
              for (G = k !== u - 1 ? E : X, m = D * B * E + k * E, U = B - G, QA = 0; QA < JA; QA++) {
                if (JA > 1 ? (fA = eA, m = D * B * E + k * E, eA = new n(r.pixels.resultPixels.buffer, c * QA * p, c), ne = I.maxValues[QA]) : fA = null, x = a.byteLength - r.ptr, T = new DataView(a, r.ptr, Math.min(10, x)), K = {}, L = 0, b = T.getUint8(0), L++, CA = I.fileVersion >= 5 ? b & 4 : 0, R = b >> 6 & 255, F = b >> 2 & Ze, F !== (k * E >> 3 & Ze) || CA && QA === 0)
                  throw "integrity issue";
                if (O = b & 3, O > 3)
                  throw r.ptr += L, "Invalid block encoding (" + O + ")";
                if (O === 2) {
                  if (CA)
                    if (iA)
                      for (l = 0; l < S; l++)
                        for (h = 0; h < G; h++)
                          iA[m] && (eA[m] = fA[m]), m++;
                    else
                      for (l = 0; l < S; l++)
                        for (h = 0; h < G; h++)
                          eA[m] = fA[m], m++;
                  r.counter.constant++, r.ptr += L;
                  continue;
                } else if (O === 0) {
                  if (CA)
                    throw "integrity issue";
                  if (r.counter.uncompressed++, r.ptr += L, N = S * G * p, v = a.byteLength - r.ptr, N = N < v ? N : v, q = new ArrayBuffer(N % p === 0 ? N : N + p - N % p), J = new Uint8Array(q), J.set(new Uint8Array(a, r.ptr, N)), Y = new n(q), M = 0, iA)
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        iA[m] && (eA[m] = Y[M++]), m++;
                      m += U;
                    }
                  else
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        eA[m++] = Y[M++];
                      m += U;
                    }
                  r.ptr += M * p;
                } else if (AA = C.getDataTypeUsed(CA && d < 6 ? 4 : d, R), z = C.getOnePixel(K, L, AA, T), L += C.getDataTypeSize(AA), O === 3)
                  if (r.ptr += L, r.counter.constantoffset++, iA)
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        iA[m] && (eA[m] = CA ? Math.min(ne, fA[m] + z) : z), m++;
                      m += U;
                    }
                  else
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        eA[m] = CA ? Math.min(ne, fA[m] + z) : z, m++;
                      m += U;
                    }
                else if (r.ptr += L, C.decodeBits(a, r, _, z, QA), L = 0, CA)
                  if (iA)
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        iA[m] && (eA[m] = _[L++] + fA[m]), m++;
                      m += U;
                    }
                  else
                    for (l = 0; l < S; l++) {
                      for (h = 0; h < G; h++)
                        eA[m] = _[L++] + fA[m], m++;
                      m += U;
                    }
                else if (iA)
                  for (l = 0; l < S; l++) {
                    for (h = 0; h < G; h++)
                      iA[m] && (eA[m] = _[L++]), m++;
                    m += U;
                  }
                else
                  for (l = 0; l < S; l++) {
                    for (h = 0; h < G; h++)
                      eA[m++] = _[L++];
                    m += U;
                  }
              }
          JA > 1 && !f && (r.pixels.resultPixels = C.swapDimensionOrder(r.pixels.resultPixels, c, JA, n));
        },
        /*****************
        *  private methods (helper methods)
        *****************/
        formatFileInfo: function(a) {
          return {
            fileIdentifierString: a.headerInfo.fileIdentifierString,
            fileVersion: a.headerInfo.fileVersion,
            imageType: a.headerInfo.imageType,
            height: a.headerInfo.height,
            width: a.headerInfo.width,
            numValidPixel: a.headerInfo.numValidPixel,
            microBlockSize: a.headerInfo.microBlockSize,
            blobSize: a.headerInfo.blobSize,
            maxZError: a.headerInfo.maxZError,
            pixelType: C.getPixelType(a.headerInfo.imageType),
            eofOffset: a.eofOffset,
            mask: a.mask ? {
              numBytes: a.mask.numBytes
            } : null,
            pixels: {
              numBlocksX: a.pixels.numBlocksX,
              numBlocksY: a.pixels.numBlocksY,
              //"numBytes": data.pixels.numBytes,
              maxValue: a.headerInfo.zMax,
              minValue: a.headerInfo.zMin,
              noDataValue: a.noDataValue
            }
          };
        },
        constructConstantSurface: function(a, r) {
          var n = a.headerInfo.zMax, f = a.headerInfo.zMin, I = a.headerInfo.maxValues, B = a.headerInfo.numDims, y = a.headerInfo.height * a.headerInfo.width, c = 0, E = 0, d = 0, p = a.pixels.resultMask, u = a.pixels.resultPixels;
          if (p)
            if (B > 1) {
              if (r)
                for (c = 0; c < B; c++)
                  for (d = c * y, n = I[c], E = 0; E < y; E++)
                    p[E] && (u[d + E] = n);
              else
                for (E = 0; E < y; E++)
                  if (p[E])
                    for (d = E * B, c = 0; c < B; c++)
                      u[d + B] = I[c];
            } else
              for (E = 0; E < y; E++)
                p[E] && (u[E] = n);
          else if (B > 1 && f !== n)
            if (r)
              for (c = 0; c < B; c++)
                for (d = c * y, n = I[c], E = 0; E < y; E++)
                  u[d + E] = n;
            else
              for (E = 0; E < y; E++)
                for (d = E * B, c = 0; c < B; c++)
                  u[d + c] = I[c];
          else
            for (E = 0; E < y * B; E++)
              u[E] = n;
        },
        getDataTypeArray: function(a) {
          var r;
          switch (a) {
            case 0:
              r = Int8Array;
              break;
            case 1:
              r = Uint8Array;
              break;
            case 2:
              r = Int16Array;
              break;
            case 3:
              r = Uint16Array;
              break;
            case 4:
              r = Int32Array;
              break;
            case 5:
              r = Uint32Array;
              break;
            case 6:
              r = Float32Array;
              break;
            case 7:
              r = Float64Array;
              break;
            default:
              r = Float32Array;
          }
          return r;
        },
        getPixelType: function(a) {
          var r;
          switch (a) {
            case 0:
              r = "S8";
              break;
            case 1:
              r = "U8";
              break;
            case 2:
              r = "S16";
              break;
            case 3:
              r = "U16";
              break;
            case 4:
              r = "S32";
              break;
            case 5:
              r = "U32";
              break;
            case 6:
              r = "F32";
              break;
            case 7:
              r = "F64";
              break;
            default:
              r = "F32";
          }
          return r;
        },
        isValidPixelValue: function(a, r) {
          if (r == null)
            return !1;
          var n;
          switch (a) {
            case 0:
              n = r >= -128 && r <= 127;
              break;
            case 1:
              n = r >= 0 && r <= 255;
              break;
            case 2:
              n = r >= -32768 && r <= 32767;
              break;
            case 3:
              n = r >= 0 && r <= 65536;
              break;
            case 4:
              n = r >= -2147483648 && r <= 2147483647;
              break;
            case 5:
              n = r >= 0 && r <= 4294967296;
              break;
            case 6:
              n = r >= -34027999387901484e22 && r <= 34027999387901484e22;
              break;
            case 7:
              n = r >= -17976931348623157e292 && r <= 17976931348623157e292;
              break;
            default:
              n = !1;
          }
          return n;
        },
        getDataTypeSize: function(a) {
          var r = 0;
          switch (a) {
            case 0:
            case 1:
              r = 1;
              break;
            case 2:
            case 3:
              r = 2;
              break;
            case 4:
            case 5:
            case 6:
              r = 4;
              break;
            case 7:
              r = 8;
              break;
            default:
              r = a;
          }
          return r;
        },
        getDataTypeUsed: function(a, r) {
          var n = a;
          switch (a) {
            case 2:
            case 4:
              n = a - r;
              break;
            case 3:
            case 5:
              n = a - 2 * r;
              break;
            case 6:
              r === 0 ? n = a : r === 1 ? n = 2 : n = 1;
              break;
            case 7:
              r === 0 ? n = a : n = a - 2 * r + 1;
              break;
            default:
              n = a;
              break;
          }
          return n;
        },
        getOnePixel: function(a, r, n, f) {
          var I = 0;
          switch (n) {
            case 0:
              I = f.getInt8(r);
              break;
            case 1:
              I = f.getUint8(r);
              break;
            case 2:
              I = f.getInt16(r, !0);
              break;
            case 3:
              I = f.getUint16(r, !0);
              break;
            case 4:
              I = f.getInt32(r, !0);
              break;
            case 5:
              I = f.getUInt32(r, !0);
              break;
            case 6:
              I = f.getFloat32(r, !0);
              break;
            case 7:
              I = f.getFloat64(r, !0);
              break;
            default:
              throw "the decoder does not understand this pixel type";
          }
          return I;
        },
        swapDimensionOrder: function(a, r, n, f, I) {
          var B = 0, y = 0, c = 0, E = 0, d = a;
          if (n > 1)
            if (d = new f(r * n), I)
              for (B = 0; B < r; B++)
                for (E = B, c = 0; c < n; c++, E += r)
                  d[E] = a[y++];
            else
              for (B = 0; B < r; B++)
                for (E = B, c = 0; c < n; c++, E += r)
                  d[y++] = a[E];
          return d;
        }
      }, g = function(a, r, n) {
        this.val = a, this.left = r, this.right = n;
      }, w = {
        /*
        * ********removed options compared to LERC1. We can bring some of them back if needed.
         * removed pixel type. LERC2 is typed and doesn't require user to give pixel type
         * changed encodedMaskData to maskData. LERC2 's js version make it faster to use maskData directly.
         * removed returnMask. mask is used by LERC2 internally and is cost free. In case of user input mask, it's returned as well and has neglible cost.
         * removed nodatavalue. Because LERC2 pixels are typed, nodatavalue will sacrify a useful value for many types (8bit, 16bit) etc,
         *       user has to be knowledgable enough about raster and their data to avoid usability issues. so nodata value is simply removed now.
         *       We can add it back later if their's a clear requirement.
         * removed encodedMask. This option was not implemented in LercDecode. It can be done after decoding (less efficient)
         * removed computeUsedBitDepths.
         *
         *
         * response changes compared to LERC1
         * 1. encodedMaskData is not available
         * 2. noDataValue is optional (returns only if user's noDataValue is with in the valid data type range)
         * 3. maskData is always available
        */
        /*****************
        *  public properties
        ******************/
        //HUFFMAN_LUT_BITS_MAX: 12, //use 2^12 lut, not configurable
        /*****************
        *  public methods
        *****************/
        /**
         * Decode a LERC2 byte stream and return an object containing the pixel data and optional metadata.
         *
         * @param {ArrayBuffer} input The LERC input byte stream
         * @param {object} [options] options Decoding options
         * @param {number} [options.inputOffset] The number of bytes to skip in the input byte stream. A valid LERC file is expected at that position
         * @param {boolean} [options.returnFileInfo] If true, the return value will have a fileInfo property that contains metadata obtained from the LERC headers and the decoding process
         * @param {boolean} [options.returnPixelInterleavedDims]  If true, returned dimensions are pixel-interleaved, a.k.a [p1_dim0, p1_dim1, p1_dimn, p2_dim0...], default is [p1_dim0, p2_dim0, ..., p1_dim1, p2_dim1...]
         */
        decode: function(a, r) {
          r = r || {};
          var n = r.noDataValue, f = 0, I = {};
          if (I.ptr = r.inputOffset || 0, I.pixels = {}, !!C.readHeaderInfo(a, I)) {
            var B = I.headerInfo, y = B.fileVersion, c = C.getDataTypeArray(B.imageType);
            if (y > 5)
              throw "unsupported lerc version 2." + y;
            C.readMask(a, I), B.numValidPixel !== B.width * B.height && !I.pixels.resultMask && (I.pixels.resultMask = r.maskData);
            var E = B.width * B.height;
            I.pixels.resultPixels = new c(E * B.numDims), I.counter = {
              onesweep: 0,
              uncompressed: 0,
              lut: 0,
              bitstuffer: 0,
              constant: 0,
              constantoffset: 0
            };
            var d = !r.returnPixelInterleavedDims;
            if (B.numValidPixel !== 0)
              if (B.zMax === B.zMin)
                C.constructConstantSurface(I, d);
              else if (y >= 4 && C.checkMinMaxRanges(a, I))
                C.constructConstantSurface(I, d);
              else {
                var p = new DataView(a, I.ptr, 2), u = p.getUint8(0);
                if (I.ptr++, u)
                  C.readDataOneSweep(a, I, c, d);
                else if (y > 1 && B.imageType <= 1 && Math.abs(B.maxZError - 0.5) < 1e-5) {
                  var Q = p.getUint8(1);
                  if (I.ptr++, I.encodeMode = Q, Q > 2 || y < 4 && Q > 1)
                    throw "Invalid Huffman flag " + Q;
                  Q ? C.readHuffman(a, I, c, d) : C.readTiles(a, I, c, d);
                } else
                  C.readTiles(a, I, c, d);
              }
            I.eofOffset = I.ptr;
            var l;
            r.inputOffset ? (l = I.headerInfo.blobSize + r.inputOffset - I.ptr, Math.abs(l) >= 1 && (I.eofOffset = r.inputOffset + I.headerInfo.blobSize)) : (l = I.headerInfo.blobSize - I.ptr, Math.abs(l) >= 1 && (I.eofOffset = I.headerInfo.blobSize));
            var h = {
              width: B.width,
              height: B.height,
              pixelData: I.pixels.resultPixels,
              minValue: B.zMin,
              maxValue: B.zMax,
              validPixelCount: B.numValidPixel,
              dimCount: B.numDims,
              dimStats: {
                minValues: B.minValues,
                maxValues: B.maxValues
              },
              maskData: I.pixels.resultMask
              //noDataValue: noDataValue
            };
            if (I.pixels.resultMask && C.isValidPixelValue(B.imageType, n)) {
              var D = I.pixels.resultMask;
              for (f = 0; f < E; f++)
                D[f] || (h.pixelData[f] = n);
              h.noDataValue = n;
            }
            return I.noDataValue = n, r.returnFileInfo && (h.fileInfo = C.formatFileInfo(I)), h;
          }
        },
        getBandCount: function(a) {
          var r = 0, n = 0, f = {};
          for (f.ptr = 0, f.pixels = {}; n < a.byteLength - 58; )
            C.readHeaderInfo(a, f), n += f.headerInfo.blobSize, r++, f.ptr = n;
          return r;
        }
      };
      return w;
    }(), i = function() {
      var o = new ArrayBuffer(4), C = new Uint8Array(o), g = new Uint32Array(o);
      return g[0] = 1, C[0] === 1;
    }(), s = {
      /************wrapper**********************************************/
      /**
       * A wrapper for decoding both LERC1 and LERC2 byte streams capable of handling multiband pixel blocks for various pixel types.
       *
       * @alias module:Lerc
       * @param {ArrayBuffer} input The LERC input byte stream
       * @param {object} [options] The decoding options below are optional.
       * @param {number} [options.inputOffset] The number of bytes to skip in the input byte stream. A valid Lerc file is expected at that position.
       * @param {string} [options.pixelType] (LERC1 only) Default value is F32. Valid pixel types for input are U8/S8/S16/U16/S32/U32/F32.
       * @param {number} [options.noDataValue] (LERC1 only). It is recommended to use the returned mask instead of setting this value.
       * @param {boolean} [options.returnPixelInterleavedDims] (nDim LERC2 only) If true, returned dimensions are pixel-interleaved, a.k.a [p1_dim0, p1_dim1, p1_dimn, p2_dim0...], default is [p1_dim0, p2_dim0, ..., p1_dim1, p2_dim1...]
       * @returns {{width, height, pixels, pixelType, mask, statistics}}
         * @property {number} width Width of decoded image.
         * @property {number} height Height of decoded image.
         * @property {array} pixels [band1, band2, …] Each band is a typed array of width*height.
         * @property {string} pixelType The type of pixels represented in the output.
         * @property {mask} mask Typed array with a size of width*height, or null if all pixels are valid.
         * @property {array} statistics [statistics_band1, statistics_band2, …] Each element is a statistics object representing min and max values
      **/
      decode: function(o, C) {
        if (!i)
          throw "Big endian system is not supported.";
        C = C || {};
        var g = C.inputOffset || 0, w = new Uint8Array(o, g, 10), a = String.fromCharCode.apply(null, w), r, n;
        if (a.trim() === "CntZImage")
          r = e, n = 1;
        else if (a.substring(0, 5) === "Lerc2")
          r = A, n = 2;
        else
          throw "Unexpected file identifier string: " + a;
        for (var f = 0, I = o.byteLength - 10, B, y = [], c, E, d = {
          width: 0,
          height: 0,
          pixels: [],
          pixelType: C.pixelType,
          mask: null,
          statistics: []
        }, p = 0; g < I; ) {
          var u = r.decode(o, {
            inputOffset: g,
            //for both lerc1 and lerc2
            encodedMaskData: B,
            //lerc1 only
            maskData: E,
            //lerc2 only
            returnMask: f === 0,
            //lerc1 only
            returnEncodedMask: f === 0,
            //lerc1 only
            returnFileInfo: !0,
            //for both lerc1 and lerc2
            returnPixelInterleavedDims: C.returnPixelInterleavedDims,
            //for ndim lerc2 only
            pixelType: C.pixelType || null,
            //lerc1 only
            noDataValue: C.noDataValue || null
            //lerc1 only
          });
          g = u.fileInfo.eofOffset, E = u.maskData, f === 0 && (B = u.encodedMaskData, d.width = u.width, d.height = u.height, d.dimCount = u.dimCount || 1, d.pixelType = u.pixelType || u.fileInfo.pixelType, d.mask = E), n > 1 && (E && y.push(E), u.fileInfo.mask && u.fileInfo.mask.numBytes > 0 && p++), f++, d.pixels.push(u.pixelData), d.statistics.push({
            minValue: u.minValue,
            maxValue: u.maxValue,
            noDataValue: u.noDataValue,
            dimStats: u.dimStats
          });
        }
        var Q, l, h;
        if (n > 1 && p > 1) {
          for (h = d.width * d.height, d.bandMasks = y, E = new Uint8Array(h), E.set(y[0]), Q = 1; Q < y.length; Q++)
            for (c = y[Q], l = 0; l < h; l++)
              E[l] = E[l] & c[l];
          d.maskData = E;
        }
        return d;
      }
    };
    t.exports ? t.exports = s : this.Lerc = s;
  })();
})(Di);
var Wo = Di.exports;
const Zo = /* @__PURE__ */ Je(Wo);
let xA, gA, Ue;
const pe = {
  env: {
    emscripten_notify_memory_growth: function(t) {
      Ue = new Uint8Array(gA.exports.memory.buffer);
    }
  }
};
class zo {
  init() {
    return xA || (typeof fetch < "u" ? xA = fetch("data:application/wasm;base64," + Nt).then((e) => e.arrayBuffer()).then((e) => WebAssembly.instantiate(e, pe)).then(this._init) : xA = WebAssembly.instantiate(Buffer.from(Nt, "base64"), pe).then(this._init), xA);
  }
  _init(e) {
    gA = e.instance, pe.env.emscripten_notify_memory_growth(0);
  }
  decode(e, A = 0) {
    if (!gA) throw new Error("ZSTDDecoder: Await .init() before decoding.");
    const i = e.byteLength, s = gA.exports.malloc(i);
    Ue.set(e, s), A = A || Number(gA.exports.ZSTD_findDecompressedSize(s, i));
    const o = gA.exports.malloc(A), C = gA.exports.ZSTD_decompress(o, A, s, i), g = Ue.slice(o, o + C);
    return gA.exports.free(s), gA.exports.free(o), g;
  }
}
const Nt = "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IAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQh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ASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigC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C0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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", pi = new zo();
class $o extends dA {
  constructor(e) {
    super(), this.planarConfiguration = typeof e.PlanarConfiguration < "u" ? e.PlanarConfiguration : 1, this.samplesPerPixel = typeof e.SamplesPerPixel < "u" ? e.SamplesPerPixel : 1, this.addCompression = e.LercParameters[sr.AddCompression];
  }
  decodeBlock(e) {
    switch (this.addCompression) {
      case Ie.None:
        break;
      case Ie.Deflate:
        e = yi(new Uint8Array(e)).buffer;
        break;
      case Ie.Zstandard:
        e = pi.decode(new Uint8Array(e)).buffer;
        break;
      default:
        throw new Error(`Unsupported LERC additional compression method identifier: ${this.addCompression}`);
    }
    return Zo.decode(e, { returnPixelInterleavedDims: this.planarConfiguration === 1 }).pixels[0].buffer;
  }
}
const Aa = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: $o,
  zstd: pi
}, Symbol.toStringTag, { value: "Module" }));
class ea extends dA {
  constructor() {
    if (super(), typeof createImageBitmap > "u")
      throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");
    if (typeof document > "u" && typeof OffscreenCanvas > "u")
      throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");
  }
  async decode(e, A) {
    const i = new Blob([A]), s = await createImageBitmap(i);
    let o;
    typeof document < "u" ? (o = document.createElement("canvas"), o.width = s.width, o.height = s.height) : o = new OffscreenCanvas(s.width, s.height);
    const C = o.getContext("2d");
    return C.drawImage(s, 0, 0), C.getImageData(0, 0, s.width, s.height).data.buffer;
  }
}
const ta = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ea
}, Symbol.toStringTag, { value: "Module" })), ia = Worker;
function ra() {
  const t = 'function A(A,e,t,i,r,I,g){try{var n=A[I](g),a=n.value}catch(A){return void t(A)}n.done?e(a):Promise.resolve(a).then(i,r)}function e(e){return function(){var t=this,i=arguments;return new Promise((function(r,I){var g=e.apply(t,i);function n(e){A(g,r,I,n,a,"next",e)}function a(e){A(g,r,I,n,a,"throw",e)}n(void 0)}))}}function t(A){return t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(A){return typeof A}:function(A){return A&&"function"==typeof Symbol&&A.constructor===Symbol&&A!==Symbol.prototype?"symbol":typeof A},t(A)}var i={exports:{}};!function(A){var e=function(A){var e,i=Object.prototype,r=i.hasOwnProperty,I="function"==typeof Symbol?Symbol:{},g=I.iterator||"@@iterator",n=I.asyncIterator||"@@asyncIterator",a=I.toStringTag||"@@toStringTag";function o(A,e,t){return Object.defineProperty(A,e,{value:t,enumerable:!0,configurable:!0,writable:!0}),A[e]}try{o({},"")}catch(A){o=function(A,e,t){return A[e]=t}}function B(A,e,t,i){var r=e&&e.prototype instanceof h?e:h,I=Object.create(r.prototype),g=new S(i||[]);return I._invoke=function(A,e,t){var i=Q;return function(r,I){if(i===s)throw new Error("Generator is already running");if(i===f){if("throw"===r)throw I;return R()}for(t.method=r,t.arg=I;;){var g=t.delegate;if(g){var n=m(g,t);if(n){if(n===c)continue;return n}}if("next"===t.method)t.sent=t._sent=t.arg;else if("throw"===t.method){if(i===Q)throw i=f,t.arg;t.dispatchException(t.arg)}else"return"===t.method&&t.abrupt("return",t.arg);i=s;var a=C(A,e,t);if("normal"===a.type){if(i=t.done?f:E,a.arg===c)continue;return{value:a.arg,done:t.done}}"throw"===a.type&&(i=f,t.method="throw",t.arg=a.arg)}}}(A,t,g),I}function C(A,e,t){try{return{type:"normal",arg:A.call(e,t)}}catch(A){return{type:"throw",arg:A}}}A.wrap=B;var Q="suspendedStart",E="suspendedYield",s="executing",f="completed",c={};function h(){}function l(){}function u(){}var w={};o(w,g,(function(){return this}));var d=Object.getPrototypeOf,D=d&&d(d(v([])));D&&D!==i&&r.call(D,g)&&(w=D);var y=u.prototype=h.prototype=Object.create(w);function k(A){["next","throw","return"].forEach((function(e){o(A,e,(function(A){return this._invoke(e,A)}))}))}function p(A,e){function i(I,g,n,a){var o=C(A[I],A,g);if("throw"!==o.type){var B=o.arg,Q=B.value;return Q&&"object"===t(Q)&&r.call(Q,"__await")?e.resolve(Q.__await).then((function(A){i("next",A,n,a)}),(function(A){i("throw",A,n,a)})):e.resolve(Q).then((function(A){B.value=A,n(B)}),(function(A){return i("throw",A,n,a)}))}a(o.arg)}var I;this._invoke=function(A,t){function r(){return new e((function(e,r){i(A,t,e,r)}))}return I=I?I.then(r,r):r()}}function m(A,t){var i=A.iterator[t.method];if(i===e){if(t.delegate=null,"throw"===t.method){if(A.iterator.return&&(t.method="return",t.arg=e,m(A,t),"throw"===t.method))return c;t.method="throw",t.arg=new TypeError("The iterator does not provide a \'throw\' method")}return c}var r=C(i,A.iterator,t.arg);if("throw"===r.type)return t.method="throw",t.arg=r.arg,t.delegate=null,c;var I=r.arg;return I?I.done?(t[A.resultName]=I.value,t.next=A.nextLoc,"return"!==t.method&&(t.method="next",t.arg=e),t.delegate=null,c):I:(t.method="throw",t.arg=new TypeError("iterator result is not an object"),t.delegate=null,c)}function G(A){var e={tryLoc:A[0]};1 in A&&(e.catchLoc=A[1]),2 in A&&(e.finallyLoc=A[2],e.afterLoc=A[3]),this.tryEntries.push(e)}function F(A){var e=A.completion||{};e.type="normal",delete e.arg,A.completion=e}function S(A){this.tryEntries=[{tryLoc:"root"}],A.forEach(G,this),this.reset(!0)}function v(A){if(A){var t=A[g];if(t)return t.call(A);if("function"==typeof A.next)return A;if(!isNaN(A.length)){var i=-1,I=function t(){for(;++i<A.length;)if(r.call(A,i))return t.value=A[i],t.done=!1,t;return t.value=e,t.done=!0,t};return I.next=I}}return{next:R}}function R(){return{value:e,done:!0}}return l.prototype=u,o(y,"constructor",u),o(u,"constructor",l),l.displayName=o(u,a,"GeneratorFunction"),A.isGeneratorFunction=function(A){var e="function"==typeof A&&A.constructor;return!!e&&(e===l||"GeneratorFunction"===(e.displayName||e.name))},A.mark=function(A){return Object.setPrototypeOf?Object.setPrototypeOf(A,u):(A.__proto__=u,o(A,a,"GeneratorFunction")),A.prototype=Object.create(y),A},A.awrap=function(A){return{__await:A}},k(p.prototype),o(p.prototype,n,(function(){return this})),A.AsyncIterator=p,A.async=function(e,t,i,r,I){void 0===I&&(I=Promise);var g=new p(B(e,t,i,r),I);return A.isGeneratorFunction(t)?g:g.next().then((function(A){return A.done?A.value:g.next()}))},k(y),o(y,a,"Generator"),o(y,g,(function(){return this})),o(y,"toString",(function(){return"[object Generator]"})),A.keys=function(A){var e=[];for(var t in A)e.push(t);return e.reverse(),function t(){for(;e.length;){var i=e.pop();if(i in A)return t.value=i,t.done=!1,t}return t.done=!0,t}},A.values=v,S.prototype={constructor:S,reset:function(A){if(this.prev=0,this.next=0,this.sent=this._sent=e,this.done=!1,this.delegate=null,this.method="next",this.arg=e,this.tryEntries.forEach(F),!A)for(var t in this)"t"===t.charAt(0)&&r.call(this,t)&&!isNaN(+t.slice(1))&&(this[t]=e)},stop:function(){this.done=!0;var A=this.tryEntries[0].completion;if("throw"===A.type)throw A.arg;return this.rval},dispatchException:function(A){if(this.done)throw A;var t=this;function i(i,r){return n.type="throw",n.arg=A,t.next=i,r&&(t.method="next",t.arg=e),!!r}for(var I=this.tryEntries.length-1;I>=0;--I){var g=this.tryEntries[I],n=g.completion;if("root"===g.tryLoc)return i("end");if(g.tryLoc<=this.prev){var a=r.call(g,"catchLoc"),o=r.call(g,"finallyLoc");if(a&&o){if(this.prev<g.catchLoc)return i(g.catchLoc,!0);if(this.prev<g.finallyLoc)return i(g.finallyLoc)}else if(a){if(this.prev<g.catchLoc)return i(g.catchLoc,!0)}else{if(!o)throw new Error("try statement without catch or finally");if(this.prev<g.finallyLoc)return i(g.finallyLoc)}}}},abrupt:function(A,e){for(var t=this.tryEntries.length-1;t>=0;--t){var i=this.tryEntries[t];if(i.tryLoc<=this.prev&&r.call(i,"finallyLoc")&&this.prev<i.finallyLoc){var I=i;break}}I&&("break"===A||"continue"===A)&&I.tryLoc<=e&&e<=I.finallyLoc&&(I=null);var g=I?I.completion:{};return g.type=A,g.arg=e,I?(this.method="next",this.next=I.finallyLoc,c):this.complete(g)},complete:function(A,e){if("throw"===A.type)throw A.arg;return"break"===A.type||"continue"===A.type?this.next=A.arg:"return"===A.type?(this.rval=this.arg=A.arg,this.method="return",this.next="end"):"normal"===A.type&&e&&(this.next=e),c},finish:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.finallyLoc===A)return this.complete(t.completion,t.afterLoc),F(t),c}},catch:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.tryLoc===A){var i=t.completion;if("throw"===i.type){var r=i.arg;F(t)}return r}}throw new Error("illegal catch attempt")},delegateYield:function(A,t,i){return this.delegate={iterator:v(A),resultName:t,nextLoc:i},"next"===this.method&&(this.arg=e),c}},A}(A.exports);try{regeneratorRuntime=e}catch(A){"object"===("undefined"==typeof globalThis?"undefined":t(globalThis))?globalThis.regeneratorRuntime=e:Function("r","regeneratorRuntime = r")(e)}}(i);var r=i.exports,I=new Map;function g(A,e){Array.isArray(A)||(A=[A]),A.forEach((function(A){return I.set(A,e)}))}function n(A){return a.apply(this,arguments)}function a(){return(a=e(r.mark((function A(e){var t,i;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:if(t=I.get(e.Compression)){A.next=3;break}throw new Error("Unknown compression method identifier: ".concat(e.Compression));case 3:return A.next=5,t();case 5:return i=A.sent,A.abrupt("return",new i(e));case 7:case"end":return A.stop()}}),A)})))).apply(this,arguments)}g([void 0,1],(function(){return Promise.resolve().then((function(){return y})).then((function(A){return A.default}))})),g(5,(function(){return Promise.resolve().then((function(){return F})).then((function(A){return A.default}))})),g(6,(function(){throw new Error("old style JPEG compression is not supported.")})),g(7,(function(){return Promise.resolve().then((function(){return N})).then((function(A){return A.default}))})),g([8,32946],(function(){return Promise.resolve().then((function(){return OA})).then((function(A){return A.default}))})),g(32773,(function(){return Promise.resolve().then((function(){return _A})).then((function(A){return A.default}))})),g(34887,(function(){return Promise.resolve().then((function(){return le})).then(function(){var A=e(r.mark((function A(e){return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,e.zstd.init();case 2:return A.abrupt("return",e);case 3:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}()).then((function(A){return A.default}))})),g(50001,(function(){return Promise.resolve().then((function(){return de})).then((function(A){return A.default}))}));var o=globalThis;function B(A,e){if(!(A instanceof e))throw new TypeError("Cannot call a class as a function")}function C(A,e){for(var t=0;t<e.length;t++){var i=e[t];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(A,i.key,i)}}function Q(A,e,t){return e&&C(A.prototype,e),t&&C(A,t),A}function E(A,e){return E=Object.setPrototypeOf||function(A,e){return A.__proto__=e,A},E(A,e)}function s(A,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");A.prototype=Object.create(e&&e.prototype,{constructor:{value:A,writable:!0,configurable:!0}}),e&&E(A,e)}function f(A,e){if(e&&("object"===t(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(A){if(void 0===A)throw new ReferenceError("this hasn\'t been initialised - super() hasn\'t been called");return A}(A)}function c(A){return c=Object.setPrototypeOf?Object.getPrototypeOf:function(A){return A.__proto__||Object.getPrototypeOf(A)},c(A)}function h(A,e){var t=A.length-e,i=0;do{for(var r=e;r>0;r--)A[i+e]+=A[i],i++;t-=e}while(t>0)}function l(A,e,t){for(var i=0,r=A.length,I=r/t;r>e;){for(var g=e;g>0;--g)A[i+e]+=A[i],++i;r-=e}for(var n=A.slice(),a=0;a<I;++a)for(var o=0;o<t;++o)A[t*a+o]=n[(t-o-1)*I+a]}function u(A,e,t,i,r,I){if(!e||1===e)return A;for(var g=0;g<r.length;++g){if(r[g]%8!=0)throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");if(r[g]!==r[0])throw new Error("When decoding with predictor, all samples must have the same size.")}for(var n=r[0]/8,a=2===I?1:r.length,o=0;o<i&&!(o*a*t*n>=A.byteLength);++o){var B=void 0;if(2===e){switch(r[0]){case 8:B=new Uint8Array(A,o*a*t*n,a*t*n);break;case 16:B=new Uint16Array(A,o*a*t*n,a*t*n/2);break;case 32:B=new Uint32Array(A,o*a*t*n,a*t*n/4);break;default:throw new Error("Predictor 2 not allowed with ".concat(r[0]," bits per sample."))}h(B,a)}else 3===e&&l(B=new Uint8Array(A,o*a*t*n,a*t*n),a,n)}return A}o.addEventListener("message",function(){var A=e(r.mark((function A(e){var t,i,I,g,a,B;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return t=e.data,i=t.id,I=t.fileDirectory,g=t.buffer,A.next=3,n(I);case 3:return a=A.sent,A.next=6,a.decode(I,g);case 6:B=A.sent,o.postMessage({decoded:B,id:i},[B]);case 8:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}());var w=function(){function A(){B(this,A)}var t;return Q(A,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n,a;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,this.decodeBlock(t);case 2:if(i=A.sent,1===(I=e.Predictor||1)){A.next=9;break}return g=!e.StripOffsets,n=g?e.TileWidth:e.ImageWidth,a=g?e.TileLength:e.RowsPerStrip||e.ImageLength,A.abrupt("return",u(i,I,n,a,e.BitsPerSample,e.PlanarConfiguration));case 9:return A.abrupt("return",i);case 10:case"end":return A.stop()}}),A,this)}))),function(A,e){return t.apply(this,arguments)})}]),A}();function d(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var D=function(A){s(t,w);var e=d(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return A}}]),t}(),y=Object.freeze({__proto__:null,default:D});function k(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}function p(A,e){for(var t=e.length-1;t>=0;t--)A.push(e[t]);return A}function m(A){for(var e=new Uint16Array(4093),t=new Uint8Array(4093),i=0;i<=257;i++)e[i]=4096,t[i]=i;var r=258,I=9,g=0;function n(){r=258,I=9}function a(A){var e=function(A,e,t){var i=e%8,r=Math.floor(e/8),I=8-i,g=e+t-8*(r+1),n=8*(r+2)-(e+t),a=8*(r+2)-e;if(n=Math.max(0,n),r>=A.length)return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"),257;var o=A[r]&Math.pow(2,8-i)-1,B=o<<=t-I;if(r+1<A.length){var C=A[r+1]>>>n;B+=C<<=Math.max(0,t-a)}if(g>8&&r+2<A.length){var Q=8*(r+3)-(e+t);B+=A[r+2]>>>Q}return B}(A,g,I);return g+=I,e}function o(A,i){return t[r]=i,e[r]=A,++r-1}function B(A){for(var i=[],r=A;4096!==r;r=e[r])i.push(t[r]);return i}var C=[];n();for(var Q,E=new Uint8Array(A),s=a(E);257!==s;){if(256===s){for(n(),s=a(E);256===s;)s=a(E);if(257===s)break;if(s>256)throw new Error("corrupted code at scanline ".concat(s));p(C,B(s)),Q=s}else if(s<r){var f=B(s);p(C,f),o(Q,f[f.length-1]),Q=s}else{var c=B(Q);if(!c)throw new Error("Bogus entry. Not in dictionary, ".concat(Q," / ").concat(r,", position: ").concat(g));p(C,c),C.push(c[c.length-1]),o(Q,c[c.length-1]),Q=s}r+1>=Math.pow(2,I)&&(12===I?Q=void 0:I++),s=a(E)}return new Uint8Array(C)}var G=function(A){s(t,w);var e=k(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return m(A).buffer}}]),t}(),F=Object.freeze({__proto__:null,default:G});function S(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var v=new Int32Array([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]);function R(A,e){for(var t=0,i=[],r=16;r>0&&!A[r-1];)--r;i.push({children:[],index:0});for(var I,g=i[0],n=0;n<r;n++){for(var a=0;a<A[n];a++){for((g=i.pop()).children[g.index]=e[t];g.index>0;)g=i.pop();for(g.index++,i.push(g);i.length<=n;)i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I;t++}n+1<r&&(i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I)}return i[0].children}function U(A,e,i,r,I,g,n,a,o){var B=i.mcusPerLine,C=i.progressive,Q=e,E=e,s=0,f=0;function c(){if(f>0)return f--,s>>f&1;if(255===(s=A[E++])){var e=A[E++];if(e)throw new Error("unexpected marker: ".concat((s<<8|e).toString(16)))}return f=7,s>>>7}function h(A){for(var e,i=A;null!==(e=c());){if("number"==typeof(i=i[e]))return i;if("object"!==t(i))throw new Error("invalid huffman sequence")}return null}function l(A){for(var e=A,t=0;e>0;){var i=c();if(null===i)return;t=t<<1|i,--e}return t}function u(A){var e=l(A);return e>=1<<A-1?e:e+(-1<<A)+1}var w=0;var d,D=0;function y(A,e,t,i,r){var I=t%B,g=(t/B|0)*A.v+i,n=I*A.h+r;e(A,A.blocks[g][n])}function k(A,e,t){var i=t/A.blocksPerLine|0,r=t%A.blocksPerLine;e(A,A.blocks[i][r])}var p,m,G,F,S,R,U=r.length;R=C?0===g?0===a?function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t)<<o;A.pred+=i,e[0]=A.pred}:function(A,e){e[0]|=c()<<o}:0===a?function(A,e){if(w>0)w--;else for(var t=g,i=n;t<=i;){var r=h(A.huffmanTableAC),I=15&r,a=r>>4;if(0===I){if(a<15){w=l(a)+(1<<a)-1;break}t+=16}else e[v[t+=a]]=u(I)*(1<<o),t++}}:function(A,e){for(var t=g,i=n,r=0;t<=i;){var I=v[t],a=e[I]<0?-1:1;switch(D){case 0:var B=h(A.huffmanTableAC),C=15&B;if(r=B>>4,0===C)r<15?(w=l(r)+(1<<r),D=4):(r=16,D=1);else{if(1!==C)throw new Error("invalid ACn encoding");d=u(C),D=r?2:3}continue;case 1:case 2:e[I]?e[I]+=(c()<<o)*a:0==--r&&(D=2===D?3:0);break;case 3:e[I]?e[I]+=(c()<<o)*a:(e[I]=d<<o,D=0);break;case 4:e[I]&&(e[I]+=(c()<<o)*a)}t++}4===D&&0==--w&&(D=0)}:function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t);A.pred+=i,e[0]=A.pred;for(var r=1;r<64;){var I=h(A.huffmanTableAC),g=15&I,n=I>>4;if(0===g){if(n<15)break;r+=16}else e[v[r+=n]]=u(g),r++}};var L,b,M=0;b=1===U?r[0].blocksPerLine*r[0].blocksPerColumn:B*i.mcusPerColumn;for(var N=I||b;M<b;){for(m=0;m<U;m++)r[m].pred=0;if(w=0,1===U)for(p=r[0],S=0;S<N;S++)k(p,R,M),M++;else for(S=0;S<N;S++){for(m=0;m<U;m++){var x=p=r[m],J=x.h,q=x.v;for(G=0;G<q;G++)for(F=0;F<J;F++)y(p,R,M,G,F)}if(++M===b)break}if(f=0,(L=A[E]<<8|A[E+1])<65280)throw new Error("marker was not found");if(!(L>=65488&&L<=65495))break;E+=2}return E-Q}function L(A,e){var t=[],i=e.blocksPerLine,r=e.blocksPerColumn,I=i<<3,g=new Int32Array(64),n=new Uint8Array(64);function a(A,t,i){var r,I,g,n,a,o,B,C,Q,E,s=e.quantizationTable,f=i;for(E=0;E<64;E++)f[E]=A[E]*s[E];for(E=0;E<8;++E){var c=8*E;0!==f[1+c]||0!==f[2+c]||0!==f[3+c]||0!==f[4+c]||0!==f[5+c]||0!==f[6+c]||0!==f[7+c]?(r=5793*f[0+c]+128>>8,I=5793*f[4+c]+128>>8,g=f[2+c],n=f[6+c],a=2896*(f[1+c]-f[7+c])+128>>8,C=2896*(f[1+c]+f[7+c])+128>>8,o=f[3+c]<<4,Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+128>>8,g=1567*g-3784*n+128>>8,n=Q,Q=a-(B=f[5+c]<<4)+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+c]=r+C,f[7+c]=r-C,f[1+c]=I+B,f[6+c]=I-B,f[2+c]=g+o,f[5+c]=g-o,f[3+c]=n+a,f[4+c]=n-a):(Q=5793*f[0+c]+512>>10,f[0+c]=Q,f[1+c]=Q,f[2+c]=Q,f[3+c]=Q,f[4+c]=Q,f[5+c]=Q,f[6+c]=Q,f[7+c]=Q)}for(E=0;E<8;++E){var h=E;0!==f[8+h]||0!==f[16+h]||0!==f[24+h]||0!==f[32+h]||0!==f[40+h]||0!==f[48+h]||0!==f[56+h]?(r=5793*f[0+h]+2048>>12,I=5793*f[32+h]+2048>>12,g=f[16+h],n=f[48+h],a=2896*(f[8+h]-f[56+h])+2048>>12,C=2896*(f[8+h]+f[56+h])+2048>>12,o=f[24+h],Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+2048>>12,g=1567*g-3784*n+2048>>12,n=Q,Q=a-(B=f[40+h])+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+h]=r+C,f[56+h]=r-C,f[8+h]=I+B,f[48+h]=I-B,f[16+h]=g+o,f[40+h]=g-o,f[24+h]=n+a,f[32+h]=n-a):(Q=5793*i[E+0]+8192>>14,f[0+h]=Q,f[8+h]=Q,f[16+h]=Q,f[24+h]=Q,f[32+h]=Q,f[40+h]=Q,f[48+h]=Q,f[56+h]=Q)}for(E=0;E<64;++E){var l=128+(f[E]+8>>4);t[E]=l<0?0:l>255?255:l}}for(var o=0;o<r;o++){for(var B=o<<3,C=0;C<8;C++)t.push(new Uint8Array(I));for(var Q=0;Q<i;Q++){a(e.blocks[o][Q],n,g);for(var E=0,s=Q<<3,f=0;f<8;f++)for(var c=t[B+f],h=0;h<8;h++)c[s+h]=n[E++]}}return t}var b=function(){function A(){B(this,A),this.jfif=null,this.adobe=null,this.quantizationTables=[],this.huffmanTablesAC=[],this.huffmanTablesDC=[],this.resetFrames()}return Q(A,[{key:"resetFrames",value:function(){this.frames=[]}},{key:"parse",value:function(A){var e=0;function t(){var t=A[e]<<8|A[e+1];return e+=2,t}function i(A){var e,t,i=0,r=0;for(t in A.components)A.components.hasOwnProperty(t)&&(i<(e=A.components[t]).h&&(i=e.h),r<e.v&&(r=e.v));var I=Math.ceil(A.samplesPerLine/8/i),g=Math.ceil(A.scanLines/8/r);for(t in A.components)if(A.components.hasOwnProperty(t)){e=A.components[t];for(var n=Math.ceil(Math.ceil(A.samplesPerLine/8)*e.h/i),a=Math.ceil(Math.ceil(A.scanLines/8)*e.v/r),o=I*e.h,B=g*e.v,C=[],Q=0;Q<B;Q++){for(var E=[],s=0;s<o;s++)E.push(new Int32Array(64));C.push(E)}e.blocksPerLine=n,e.blocksPerColumn=a,e.blocks=C}A.maxH=i,A.maxV=r,A.mcusPerLine=I,A.mcusPerColumn=g}var r,I,g=t();if(65496!==g)throw new Error("SOI not found");for(g=t();65497!==g;){switch(g){case 65280:break;case 65504:case 65505:case 65506:case 65507:case 65508:case 65509:case 65510:case 65511:case 65512:case 65513:case 65514:case 65515:case 65516:case 65517:case 65518:case 65519:case 65534:var n=(r=void 0,I=void 0,r=t(),I=A.subarray(e,e+r-2),e+=I.length,I);65504===g&&74===n[0]&&70===n[1]&&73===n[2]&&70===n[3]&&0===n[4]&&(this.jfif={version:{major:n[5],minor:n[6]},densityUnits:n[7],xDensity:n[8]<<8|n[9],yDensity:n[10]<<8|n[11],thumbWidth:n[12],thumbHeight:n[13],thumbData:n.subarray(14,14+3*n[12]*n[13])}),65518===g&&65===n[0]&&100===n[1]&&111===n[2]&&98===n[3]&&101===n[4]&&0===n[5]&&(this.adobe={version:n[6],flags0:n[7]<<8|n[8],flags1:n[9]<<8|n[10],transformCode:n[11]});break;case 65499:for(var a=t()+e-2;e<a;){var o=A[e++],B=new Int32Array(64);if(o>>4==0)for(var C=0;C<64;C++){B[v[C]]=A[e++]}else{if(o>>4!=1)throw new Error("DQT: invalid table spec");for(var Q=0;Q<64;Q++){B[v[Q]]=t()}}this.quantizationTables[15&o]=B}break;case 65472:case 65473:case 65474:t();for(var E={extended:65473===g,progressive:65474===g,precision:A[e++],scanLines:t(),samplesPerLine:t(),components:{},componentsOrder:[]},s=A[e++],f=void 0,c=0;c<s;c++){f=A[e];var h=A[e+1]>>4,l=15&A[e+1],u=A[e+2];E.componentsOrder.push(f),E.components[f]={h:h,v:l,quantizationIdx:u},e+=3}i(E),this.frames.push(E);break;case 65476:for(var w=t(),d=2;d<w;){for(var D=A[e++],y=new Uint8Array(16),k=0,p=0;p<16;p++,e++)y[p]=A[e],k+=y[p];for(var m=new Uint8Array(k),G=0;G<k;G++,e++)m[G]=A[e];d+=17+k,D>>4==0?this.huffmanTablesDC[15&D]=R(y,m):this.huffmanTablesAC[15&D]=R(y,m)}break;case 65501:t(),this.resetInterval=t();break;case 65498:t();for(var F=A[e++],S=[],L=this.frames[0],b=0;b<F;b++){var M=L.components[A[e++]],N=A[e++];M.huffmanTableDC=this.huffmanTablesDC[N>>4],M.huffmanTableAC=this.huffmanTablesAC[15&N],S.push(M)}var x=A[e++],J=A[e++],q=A[e++],Y=U(A,e,L,S,this.resetInterval,x,J,q>>4,15&q);e+=Y;break;case 65535:255!==A[e]&&e--;break;default:if(255===A[e-3]&&A[e-2]>=192&&A[e-2]<=254){e-=3;break}throw new Error("unknown JPEG marker ".concat(g.toString(16)))}g=t()}}},{key:"getResult",value:function(){var A=this.frames;if(0===this.frames.length)throw new Error("no frames were decoded");this.frames.length>1&&console.warn("more than one frame is not supported");for(var e=0;e<this.frames.length;e++)for(var t=this.frames[e].components,i=0,r=Object.keys(t);i<r.length;i++){var I=r[i];t[I].quantizationTable=this.quantizationTables[t[I].quantizationIdx],delete t[I].quantizationIdx}for(var g=A[0],n=g.components,a=g.componentsOrder,o=[],B=g.samplesPerLine,C=g.scanLines,Q=0;Q<a.length;Q++){var E=n[a[Q]];o.push({lines:L(0,E),scaleX:E.h/g.maxH,scaleY:E.v/g.maxV})}for(var s=new Uint8Array(B*C*o.length),f=0,c=0;c<C;++c)for(var h=0;h<B;++h)for(var l=0;l<o.length;++l){var u=o[l];s[f]=u.lines[0|c*u.scaleY][0|h*u.scaleX],++f}return s}}]),A}(),M=function(A){s(t,w);var e=S(t);function t(A){var i;return B(this,t),(i=e.call(this)).reader=new b,A.JPEGTables&&i.reader.parse(A.JPEGTables),i}return Q(t,[{key:"decodeBlock",value:function(A){return this.reader.resetFrames(),this.reader.parse(new Uint8Array(A)),this.reader.getResult().buffer}}]),t}(),N=Object.freeze({__proto__:null,default:M});function x(A){for(var e=A.length;--e>=0;)A[e]=0}x(new Array(576)),x(new Array(60)),x(new Array(512)),x(new Array(256)),x(new Array(29)),x(new Array(30));var J=function(A,e,t,i){for(var r=65535&A|0,I=A>>>16&65535|0,g=0;0!==t;){t-=g=t>2e3?2e3:t;do{I=I+(r=r+e[i++]|0)|0}while(--g);r%=65521,I%=65521}return r|I<<16|0},q=new Uint32Array(function(){for(var A,e=[],t=0;t<256;t++){A=t;for(var i=0;i<8;i++)A=1&A?3988292384^A>>>1:A>>>1;e[t]=A}return e}()),Y=function(A,e,t,i){var r=q,I=i+t;A^=-1;for(var g=i;g<I;g++)A=A>>>8^r[255&(A^e[g])];return-1^A},K={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"},H={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8},O=function(A,e){return Object.prototype.hasOwnProperty.call(A,e)},P=function(A){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var i=e.shift();if(i){if("object"!==t(i))throw new TypeError(i+"must be non-object");for(var r in i)O(i,r)&&(A[r]=i[r])}}return A},T=function(A){for(var e=0,t=0,i=A.length;t<i;t++)e+=A[t].length;for(var r=new Uint8Array(e),I=0,g=0,n=A.length;I<n;I++){var a=A[I];r.set(a,g),g+=a.length}return r},V=!0;try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(A){V=!1}for(var _=new Uint8Array(256),X=0;X<256;X++)_[X]=X>=252?6:X>=248?5:X>=240?4:X>=224?3:X>=192?2:1;_[254]=_[254]=1;var Z=function(A){if("function"==typeof TextEncoder&&TextEncoder.prototype.encode)return(new TextEncoder).encode(A);var e,t,i,r,I,g=A.length,n=0;for(r=0;r<g;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),n+=t<128?1:t<2048?2:t<65536?3:4;for(e=new Uint8Array(n),I=0,r=0;I<n;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),t<128?e[I++]=t:t<2048?(e[I++]=192|t>>>6,e[I++]=128|63&t):t<65536?(e[I++]=224|t>>>12,e[I++]=128|t>>>6&63,e[I++]=128|63&t):(e[I++]=240|t>>>18,e[I++]=128|t>>>12&63,e[I++]=128|t>>>6&63,e[I++]=128|63&t);return e},j=function(A,e){var t,i,r=e||A.length;if("function"==typeof TextDecoder&&TextDecoder.prototype.decode)return(new TextDecoder).decode(A.subarray(0,e));var I=new Array(2*r);for(i=0,t=0;t<r;){var g=A[t++];if(g<128)I[i++]=g;else{var n=_[g];if(n>4)I[i++]=65533,t+=n-1;else{for(g&=2===n?31:3===n?15:7;n>1&&t<r;)g=g<<6|63&A[t++],n--;n>1?I[i++]=65533:g<65536?I[i++]=g:(g-=65536,I[i++]=55296|g>>10&1023,I[i++]=56320|1023&g)}}}return function(A,e){if(e<65534&&A.subarray&&V)return String.fromCharCode.apply(null,A.length===e?A:A.subarray(0,e));for(var t="",i=0;i<e;i++)t+=String.fromCharCode(A[i]);return t}(I,i)},W=function(A,e){(e=e||A.length)>A.length&&(e=A.length);for(var t=e-1;t>=0&&128==(192&A[t]);)t--;return t<0||0===t?e:t+_[A[t]]>e?t:e};var z=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0},$=function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=A.state;t=A.next_in,k=A.input,i=t+(A.avail_in-5),r=A.next_out,p=A.output,I=r-(e-A.avail_out),g=r+(A.avail_out-257),n=m.dmax,a=m.wsize,o=m.whave,B=m.wnext,C=m.window,Q=m.hold,E=m.bits,s=m.lencode,f=m.distcode,c=(1<<m.lenbits)-1,h=(1<<m.distbits)-1;A:do{E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=s[Q&c];e:for(;;){if(Q>>>=u=l>>>24,E-=u,0===(u=l>>>16&255))p[r++]=65535&l;else{if(!(16&u)){if(0==(64&u)){l=s[(65535&l)+(Q&(1<<u)-1)];continue e}if(32&u){m.mode=12;break A}A.msg="invalid literal/length code",m.mode=30;break A}w=65535&l,(u&=15)&&(E<u&&(Q+=k[t++]<<E,E+=8),w+=Q&(1<<u)-1,Q>>>=u,E-=u),E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=f[Q&h];t:for(;;){if(Q>>>=u=l>>>24,E-=u,!(16&(u=l>>>16&255))){if(0==(64&u)){l=f[(65535&l)+(Q&(1<<u)-1)];continue t}A.msg="invalid distance code",m.mode=30;break A}if(d=65535&l,E<(u&=15)&&(Q+=k[t++]<<E,(E+=8)<u&&(Q+=k[t++]<<E,E+=8)),(d+=Q&(1<<u)-1)>n){A.msg="invalid distance too far back",m.mode=30;break A}if(Q>>>=u,E-=u,d>(u=r-I)){if((u=d-u)>o&&m.sane){A.msg="invalid distance too far back",m.mode=30;break A}if(D=0,y=C,0===B){if(D+=a-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}else if(B<u){if(D+=a+B-u,(u-=B)<w){w-=u;do{p[r++]=C[D++]}while(--u);if(D=0,B<w){w-=u=B;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}}else if(D+=B-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}for(;w>2;)p[r++]=y[D++],p[r++]=y[D++],p[r++]=y[D++],w-=3;w&&(p[r++]=y[D++],w>1&&(p[r++]=y[D++]))}else{D=r-d;do{p[r++]=p[D++],p[r++]=p[D++],p[r++]=p[D++],w-=3}while(w>2);w&&(p[r++]=p[D++],w>1&&(p[r++]=p[D++]))}break}}break}}while(t<i&&r<g);t-=w=E>>3,Q&=(1<<(E-=w<<3))-1,A.next_in=t,A.next_out=r,A.avail_in=t<i?i-t+5:5-(t-i),A.avail_out=r<g?g-r+257:257-(r-g),m.hold=Q,m.bits=E},AA=new Uint16Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0]),eA=new Uint8Array([16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78]),tA=new Uint16Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0]),iA=new Uint8Array([16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64]),rA=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E,s,f,c,h=n.bits,l=0,u=0,w=0,d=0,D=0,y=0,k=0,p=0,m=0,G=0,F=null,S=0,v=new Uint16Array(16),R=new Uint16Array(16),U=null,L=0;for(l=0;l<=15;l++)v[l]=0;for(u=0;u<i;u++)v[e[t+u]]++;for(D=h,d=15;d>=1&&0===v[d];d--);if(D>d&&(D=d),0===d)return r[I++]=20971520,r[I++]=20971520,n.bits=1,0;for(w=1;w<d&&0===v[w];w++);for(D<w&&(D=w),p=1,l=1;l<=15;l++)if(p<<=1,(p-=v[l])<0)return-1;if(p>0&&(0===A||1!==d))return-1;for(R[1]=0,l=1;l<15;l++)R[l+1]=R[l]+v[l];for(u=0;u<i;u++)0!==e[t+u]&&(g[R[e[t+u]]++]=u);if(0===A?(F=U=g,E=19):1===A?(F=AA,S-=257,U=eA,L-=257,E=256):(F=tA,U=iA,E=-1),G=0,u=0,l=w,Q=I,y=D,k=0,B=-1,C=(m=1<<D)-1,1===A&&m>852||2===A&&m>592)return 1;for(;;){s=l-k,g[u]<E?(f=0,c=g[u]):g[u]>E?(f=U[L+g[u]],c=F[S+g[u]]):(f=96,c=0),a=1<<l-k,w=o=1<<y;do{r[Q+(G>>k)+(o-=a)]=s<<24|f<<16|c|0}while(0!==o);for(a=1<<l-1;G&a;)a>>=1;if(0!==a?(G&=a-1,G+=a):G=0,u++,0==--v[l]){if(l===d)break;l=e[t+g[u]]}if(l>D&&(G&C)!==B){for(0===k&&(k=D),Q+=w,p=1<<(y=l-k);y+k<d&&!((p-=v[y+k])<=0);)y++,p<<=1;if(m+=1<<y,1===A&&m>852||2===A&&m>592)return 1;r[B=G&C]=D<<24|y<<16|Q-I|0}}return 0!==G&&(r[Q+G]=l-k<<24|64<<16|0),n.bits=D,0},IA=H.Z_FINISH,gA=H.Z_BLOCK,nA=H.Z_TREES,aA=H.Z_OK,oA=H.Z_STREAM_END,BA=H.Z_NEED_DICT,CA=H.Z_STREAM_ERROR,QA=H.Z_DATA_ERROR,EA=H.Z_MEM_ERROR,sA=H.Z_BUF_ERROR,fA=H.Z_DEFLATED,cA=function(A){return(A>>>24&255)+(A>>>8&65280)+((65280&A)<<8)+((255&A)<<24)};function hA(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new Uint16Array(320),this.work=new Uint16Array(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}var lA,uA,wA=function(A){if(!A||!A.state)return CA;var e=A.state;return A.total_in=A.total_out=e.total=0,A.msg="",e.wrap&&(A.adler=1&e.wrap),e.mode=1,e.last=0,e.havedict=0,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new Int32Array(852),e.distcode=e.distdyn=new Int32Array(592),e.sane=1,e.back=-1,aA},dA=function(A){if(!A||!A.state)return CA;var e=A.state;return e.wsize=0,e.whave=0,e.wnext=0,wA(A)},DA=function(A,e){var t;if(!A||!A.state)return CA;var i=A.state;return e<0?(t=0,e=-e):(t=1+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?CA:(null!==i.window&&i.wbits!==e&&(i.window=null),i.wrap=t,i.wbits=e,dA(A))},yA=function(A,e){if(!A)return CA;var t=new hA;A.state=t,t.window=null;var i=DA(A,e);return i!==aA&&(A.state=null),i},kA=!0,pA=function(A){if(kA){lA=new Int32Array(512),uA=new Int32Array(32);for(var e=0;e<144;)A.lens[e++]=8;for(;e<256;)A.lens[e++]=9;for(;e<280;)A.lens[e++]=7;for(;e<288;)A.lens[e++]=8;for(rA(1,A.lens,0,288,lA,0,A.work,{bits:9}),e=0;e<32;)A.lens[e++]=5;rA(2,A.lens,0,32,uA,0,A.work,{bits:5}),kA=!1}A.lencode=lA,A.lenbits=9,A.distcode=uA,A.distbits=5},mA=function(A,e,t,i){var r,I=A.state;return null===I.window&&(I.wsize=1<<I.wbits,I.wnext=0,I.whave=0,I.window=new Uint8Array(I.wsize)),i>=I.wsize?(I.window.set(e.subarray(t-I.wsize,t),0),I.wnext=0,I.whave=I.wsize):((r=I.wsize-I.wnext)>i&&(r=i),I.window.set(e.subarray(t-i,t-i+r),I.wnext),(i-=r)?(I.window.set(e.subarray(t-i,t),0),I.wnext=i,I.whave=I.wsize):(I.wnext+=r,I.wnext===I.wsize&&(I.wnext=0),I.whave<I.wsize&&(I.whave+=r))),0},GA={inflateReset:dA,inflateReset2:DA,inflateResetKeep:wA,inflateInit:function(A){return yA(A,15)},inflateInit2:yA,inflate:function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=0,G=new Uint8Array(4),F=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);if(!A||!A.state||!A.output||!A.input&&0!==A.avail_in)return CA;12===(t=A.state).mode&&(t.mode=13),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,C=n,Q=a,y=aA;A:for(;;)switch(t.mode){case 1:if(0===t.wrap){t.mode=13;break}for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(2&t.wrap&&35615===o){t.check=0,G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0),o=0,B=0,t.mode=2;break}if(t.flags=0,t.head&&(t.head.done=!1),!(1&t.wrap)||(((255&o)<<8)+(o>>8))%31){A.msg="incorrect header check",t.mode=30;break}if((15&o)!==fA){A.msg="unknown compression method",t.mode=30;break}if(B-=4,D=8+(15&(o>>>=4)),0===t.wbits)t.wbits=D;else if(D>t.wbits){A.msg="invalid window size",t.mode=30;break}t.dmax=1<<t.wbits,A.adler=t.check=1,t.mode=512&o?10:12,o=0,B=0;break;case 2:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.flags=o,(255&t.flags)!==fA){A.msg="unknown compression method",t.mode=30;break}if(57344&t.flags){A.msg="unknown header flags set",t.mode=30;break}t.head&&(t.head.text=o>>8&1),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=3;case 3:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.time=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,G[2]=o>>>16&255,G[3]=o>>>24&255,t.check=Y(t.check,G,4,0)),o=0,B=0,t.mode=4;case 4:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.xflags=255&o,t.head.os=o>>8),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=5;case 5:if(1024&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length=o,t.head&&(t.head.extra_len=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0}else t.head&&(t.head.extra=null);t.mode=6;case 6:if(1024&t.flags&&((E=t.length)>n&&(E=n),E&&(t.head&&(D=t.head.extra_len-t.length,t.head.extra||(t.head.extra=new Uint8Array(t.head.extra_len)),t.head.extra.set(i.subarray(I,I+E),D)),512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,t.length-=E),t.length))break A;t.length=0,t.mode=7;case 7:if(2048&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.name+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.name=null);t.length=0,t.mode=8;case 8:if(4096&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.comment+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.comment=null);t.mode=9;case 9:if(512&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(65535&t.check)){A.msg="header crc mismatch",t.mode=30;break}o=0,B=0}t.head&&(t.head.hcrc=t.flags>>9&1,t.head.done=!0),A.adler=t.check=0,t.mode=12;break;case 10:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}A.adler=t.check=cA(o),o=0,B=0,t.mode=11;case 11:if(0===t.havedict)return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,BA;A.adler=t.check=1,t.mode=12;case 12:if(e===gA||e===nA)break A;case 13:if(t.last){o>>>=7&B,B-=7&B,t.mode=27;break}for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}switch(t.last=1&o,B-=1,3&(o>>>=1)){case 0:t.mode=14;break;case 1:if(pA(t),t.mode=20,e===nA){o>>>=2,B-=2;break A}break;case 2:t.mode=17;break;case 3:A.msg="invalid block type",t.mode=30}o>>>=2,B-=2;break;case 14:for(o>>>=7&B,B-=7&B;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if((65535&o)!=(o>>>16^65535)){A.msg="invalid stored block lengths",t.mode=30;break}if(t.length=65535&o,o=0,B=0,t.mode=15,e===nA)break A;case 15:t.mode=16;case 16:if(E=t.length){if(E>n&&(E=n),E>a&&(E=a),0===E)break A;r.set(i.subarray(I,I+E),g),n-=E,I+=E,a-=E,g+=E,t.length-=E;break}t.mode=12;break;case 17:for(;B<14;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.nlen=257+(31&o),o>>>=5,B-=5,t.ndist=1+(31&o),o>>>=5,B-=5,t.ncode=4+(15&o),o>>>=4,B-=4,t.nlen>286||t.ndist>30){A.msg="too many length or distance symbols",t.mode=30;break}t.have=0,t.mode=18;case 18:for(;t.have<t.ncode;){for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.lens[F[t.have++]]=7&o,o>>>=3,B-=3}for(;t.have<19;)t.lens[F[t.have++]]=0;if(t.lencode=t.lendyn,t.lenbits=7,k={bits:t.lenbits},y=rA(0,t.lens,0,19,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid code lengths set",t.mode=30;break}t.have=0,t.mode=19;case 19:for(;t.have<t.nlen+t.ndist;){for(;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(l<16)o>>>=c,B-=c,t.lens[t.have++]=l;else{if(16===l){for(p=c+2;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o>>>=c,B-=c,0===t.have){A.msg="invalid bit length repeat",t.mode=30;break}D=t.lens[t.have-1],E=3+(3&o),o>>>=2,B-=2}else if(17===l){for(p=c+3;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=3+(7&(o>>>=c)),o>>>=3,B-=3}else{for(p=c+7;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=11+(127&(o>>>=c)),o>>>=7,B-=7}if(t.have+E>t.nlen+t.ndist){A.msg="invalid bit length repeat",t.mode=30;break}for(;E--;)t.lens[t.have++]=D}}if(30===t.mode)break;if(0===t.lens[256]){A.msg="invalid code -- missing end-of-block",t.mode=30;break}if(t.lenbits=9,k={bits:t.lenbits},y=rA(1,t.lens,0,t.nlen,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid literal/lengths set",t.mode=30;break}if(t.distbits=6,t.distcode=t.distdyn,k={bits:t.distbits},y=rA(2,t.lens,t.nlen,t.ndist,t.distcode,0,t.work,k),t.distbits=k.bits,y){A.msg="invalid distances set",t.mode=30;break}if(t.mode=20,e===nA)break A;case 20:t.mode=21;case 21:if(n>=6&&a>=258){A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,$(A,Q),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,12===t.mode&&(t.back=-1);break}for(t.back=0;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(h&&0==(240&h)){for(u=c,w=h,d=l;h=(m=t.lencode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,t.length=l,0===h){t.mode=26;break}if(32&h){t.back=-1,t.mode=12;break}if(64&h){A.msg="invalid literal/length code",t.mode=30;break}t.extra=15&h,t.mode=22;case 22:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}t.was=t.length,t.mode=23;case 23:for(;h=(m=t.distcode[o&(1<<t.distbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(0==(240&h)){for(u=c,w=h,d=l;h=(m=t.distcode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,64&h){A.msg="invalid distance code",t.mode=30;break}t.offset=l,t.extra=15&h,t.mode=24;case 24:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.offset+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}if(t.offset>t.dmax){A.msg="invalid distance too far back",t.mode=30;break}t.mode=25;case 25:if(0===a)break A;if(E=Q-a,t.offset>E){if((E=t.offset-E)>t.whave&&t.sane){A.msg="invalid distance too far back",t.mode=30;break}E>t.wnext?(E-=t.wnext,s=t.wsize-E):s=t.wnext-E,E>t.length&&(E=t.length),f=t.window}else f=r,s=g-t.offset,E=t.length;E>a&&(E=a),a-=E,t.length-=E;do{r[g++]=f[s++]}while(--E);0===t.length&&(t.mode=21);break;case 26:if(0===a)break A;r[g++]=t.length,a--,t.mode=21;break;case 27:if(t.wrap){for(;B<32;){if(0===n)break A;n--,o|=i[I++]<<B,B+=8}if(Q-=a,A.total_out+=Q,t.total+=Q,Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,g-Q):J(t.check,r,Q,g-Q)),Q=a,(t.flags?o:cA(o))!==t.check){A.msg="incorrect data check",t.mode=30;break}o=0,B=0}t.mode=28;case 28:if(t.wrap&&t.flags){for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(4294967295&t.total)){A.msg="incorrect length check",t.mode=30;break}o=0,B=0}t.mode=29;case 29:y=oA;break A;case 30:y=QA;break A;case 31:return EA;default:return CA}return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,(t.wsize||Q!==A.avail_out&&t.mode<30&&(t.mode<27||e!==IA))&&mA(A,A.output,A.next_out,Q-A.avail_out),C-=A.avail_in,Q-=A.avail_out,A.total_in+=C,A.total_out+=Q,t.total+=Q,t.wrap&&Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,A.next_out-Q):J(t.check,r,Q,A.next_out-Q)),A.data_type=t.bits+(t.last?64:0)+(12===t.mode?128:0)+(20===t.mode||15===t.mode?256:0),(0===C&&0===Q||e===IA)&&y===aA&&(y=sA),y},inflateEnd:function(A){if(!A||!A.state)return CA;var e=A.state;return e.window&&(e.window=null),A.state=null,aA},inflateGetHeader:function(A,e){if(!A||!A.state)return CA;var t=A.state;return 0==(2&t.wrap)?CA:(t.head=e,e.done=!1,aA)},inflateSetDictionary:function(A,e){var t,i=e.length;return A&&A.state?0!==(t=A.state).wrap&&11!==t.mode?CA:11===t.mode&&J(1,e,i,0)!==t.check?QA:mA(A,e,i,i)?(t.mode=31,EA):(t.havedict=1,aA):CA},inflateInfo:"pako inflate (from Nodeca project)"};var FA=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1},SA=Object.prototype.toString,vA=H.Z_NO_FLUSH,RA=H.Z_FINISH,UA=H.Z_OK,LA=H.Z_STREAM_END,bA=H.Z_NEED_DICT,MA=H.Z_STREAM_ERROR,NA=H.Z_DATA_ERROR,xA=H.Z_MEM_ERROR;function JA(A){this.options=P({chunkSize:65536,windowBits:15,to:""},A||{});var e=this.options;e.raw&&e.windowBits>=0&&e.windowBits<16&&(e.windowBits=-e.windowBits,0===e.windowBits&&(e.windowBits=-15)),!(e.windowBits>=0&&e.windowBits<16)||A&&A.windowBits||(e.windowBits+=32),e.windowBits>15&&e.windowBits<48&&0==(15&e.windowBits)&&(e.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new z,this.strm.avail_out=0;var t=GA.inflateInit2(this.strm,e.windowBits);if(t!==UA)throw new Error(K[t]);if(this.header=new FA,GA.inflateGetHeader(this.strm,this.header),e.dictionary&&("string"==typeof e.dictionary?e.dictionary=Z(e.dictionary):"[object ArrayBuffer]"===SA.call(e.dictionary)&&(e.dictionary=new Uint8Array(e.dictionary)),e.raw&&(t=GA.inflateSetDictionary(this.strm,e.dictionary))!==UA))throw new Error(K[t])}function qA(A,e){var t=new JA(e);if(t.push(A),t.err)throw t.msg||K[t.err];return t.result}JA.prototype.push=function(A,e){var t,i,r,I=this.strm,g=this.options.chunkSize,n=this.options.dictionary;if(this.ended)return!1;for(i=e===~~e?e:!0===e?RA:vA,"[object ArrayBuffer]"===SA.call(A)?I.input=new Uint8Array(A):I.input=A,I.next_in=0,I.avail_in=I.input.length;;){for(0===I.avail_out&&(I.output=new Uint8Array(g),I.next_out=0,I.avail_out=g),(t=GA.inflate(I,i))===bA&&n&&((t=GA.inflateSetDictionary(I,n))===UA?t=GA.inflate(I,i):t===NA&&(t=bA));I.avail_in>0&&t===LA&&I.state.wrap>0&&0!==A[I.next_in];)GA.inflateReset(I),t=GA.inflate(I,i);switch(t){case MA:case NA:case bA:case xA:return this.onEnd(t),this.ended=!0,!1}if(r=I.avail_out,I.next_out&&(0===I.avail_out||t===LA))if("string"===this.options.to){var a=W(I.output,I.next_out),o=I.next_out-a,B=j(I.output,a);I.next_out=o,I.avail_out=g-o,o&&I.output.set(I.output.subarray(a,a+o),0),this.onData(B)}else this.onData(I.output.length===I.next_out?I.output:I.output.subarray(0,I.next_out));if(t!==UA||0!==r){if(t===LA)return t=GA.inflateEnd(this.strm),this.onEnd(t),this.ended=!0,!0;if(0===I.avail_in)break}}return!0},JA.prototype.onData=function(A){this.chunks.push(A)},JA.prototype.onEnd=function(A){A===UA&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=T(this.chunks)),this.chunks=[],this.err=A,this.msg=this.strm.msg};var YA={Inflate:JA,inflate:qA,inflateRaw:function(A,e){return(e=e||{}).raw=!0,qA(A,e)},ungzip:qA,constants:H}.inflate;function KA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var HA=function(A){s(t,w);var e=KA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return YA(new Uint8Array(A)).buffer}}]),t}(),OA=Object.freeze({__proto__:null,default:HA});function PA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var TA,VA=function(A){s(t,w);var e=PA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){for(var e=new DataView(A),t=[],i=0;i<A.byteLength;++i){var r=e.getInt8(i);if(r<0){var I=e.getUint8(i+1);r=-r;for(var g=0;g<=r;++g)t.push(I);i+=1}else{for(var n=0;n<=r;++n)t.push(e.getUint8(i+n+1));i+=r+1}}return new Uint8Array(t).buffer}}]),t}(),_A=Object.freeze({__proto__:null,default:VA}),XA={exports:{}};TA=XA,\n/* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */\nfunction(){var A,e,t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c=(A={defaultNoDataValue:-34027999387901484e22,decode:function(I,g){var n=(g=g||{}).encodedMaskData||null===g.encodedMaskData,a=r(I,g.inputOffset||0,n),o=null!==g.noDataValue?g.noDataValue:A.defaultNoDataValue,B=e(a,g.pixelType||Float32Array,g.encodedMaskData,o,g.returnMask),C={width:a.width,height:a.height,pixelData:B.resultPixels,minValue:B.minValue,maxValue:a.pixels.maxValue,noDataValue:o};return B.resultMask&&(C.maskData=B.resultMask),g.returnEncodedMask&&a.mask&&(C.encodedMaskData=a.mask.bitset?a.mask.bitset:null),g.returnFileInfo&&(C.fileInfo=t(a),g.computeUsedBitDepths&&(C.fileInfo.bitDepths=i(a))),C}},e=function(A,e,t,i,r){var g,n,a,o=0,B=A.pixels.numBlocksX,C=A.pixels.numBlocksY,Q=Math.floor(A.width/B),E=Math.floor(A.height/C),s=2*A.maxZError,f=Number.MAX_VALUE;t=t||(A.mask?A.mask.bitset:null),n=new e(A.width*A.height),r&&t&&(a=new Uint8Array(A.width*A.height));for(var c,h,l=new Float32Array(Q*E),u=0;u<=C;u++){var w=u!==C?E:A.height%C;if(0!==w)for(var d=0;d<=B;d++){var D=d!==B?Q:A.width%B;if(0!==D){var y,k,p,m,G=u*A.width*E+d*Q,F=A.width-D,S=A.pixels.blocks[o];if(S.encoding<2?(0===S.encoding?y=S.rawData:(I(S.stuffedData,S.bitsPerPixel,S.numValidPixels,S.offset,s,l,A.pixels.maxValue),y=l),k=0):p=2===S.encoding?0:S.offset,t)for(h=0;h<w;h++){for(7&G&&(m=t[G>>3],m<<=7&G),c=0;c<D;c++)7&G||(m=t[G>>3]),128&m?(a&&(a[G]=1),f=f>(g=S.encoding<2?y[k++]:p)?g:f,n[G++]=g):(a&&(a[G]=0),n[G++]=i),m<<=1;G+=F}else if(S.encoding<2)for(h=0;h<w;h++){for(c=0;c<D;c++)f=f>(g=y[k++])?g:f,n[G++]=g;G+=F}else for(f=f>p?p:f,h=0;h<w;h++){for(c=0;c<D;c++)n[G++]=p;G+=F}if(1===S.encoding&&k!==S.numValidPixels)throw"Block and Mask do not match";o++}}}return{resultPixels:n,resultMask:a,minValue:f}},t=function(A){return{fileIdentifierString:A.fileIdentifierString,fileVersion:A.fileVersion,imageType:A.imageType,height:A.height,width:A.width,maxZError:A.maxZError,eofOffset:A.eofOffset,mask:A.mask?{numBlocksX:A.mask.numBlocksX,numBlocksY:A.mask.numBlocksY,numBytes:A.mask.numBytes,maxValue:A.mask.maxValue}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,numBytes:A.pixels.numBytes,maxValue:A.pixels.maxValue,noDataValue:A.noDataValue}}},i=function(A){for(var e=A.pixels.numBlocksX*A.pixels.numBlocksY,t={},i=0;i<e;i++){var r=A.pixels.blocks[i];0===r.encoding?t.float32=!0:1===r.encoding?t[r.bitsPerPixel]=!0:t[0]=!0}return Object.keys(t)},r=function(A,e,t){var i={},r=new Uint8Array(A,e,10);if(i.fileIdentifierString=String.fromCharCode.apply(null,r),"CntZImage"!==i.fileIdentifierString.trim())throw"Unexpected file identifier string: "+i.fileIdentifierString;e+=10;var I=new DataView(A,e,24);if(i.fileVersion=I.getInt32(0,!0),i.imageType=I.getInt32(4,!0),i.height=I.getUint32(8,!0),i.width=I.getUint32(12,!0),i.maxZError=I.getFloat64(16,!0),e+=24,!t)if(I=new DataView(A,e,16),i.mask={},i.mask.numBlocksY=I.getUint32(0,!0),i.mask.numBlocksX=I.getUint32(4,!0),i.mask.numBytes=I.getUint32(8,!0),i.mask.maxValue=I.getFloat32(12,!0),e+=16,i.mask.numBytes>0){var g=new Uint8Array(Math.ceil(i.width*i.height/8)),n=(I=new DataView(A,e,i.mask.numBytes)).getInt16(0,!0),a=2,o=0;do{if(n>0)for(;n--;)g[o++]=I.getUint8(a++);else{var B=I.getUint8(a++);for(n=-n;n--;)g[o++]=B}n=I.getInt16(a,!0),a+=2}while(a<i.mask.numBytes);if(-32768!==n||o<g.length)throw"Unexpected end of mask RLE encoding";i.mask.bitset=g,e+=i.mask.numBytes}else 0==(i.mask.numBytes|i.mask.numBlocksY|i.mask.maxValue)&&(i.mask.bitset=new Uint8Array(Math.ceil(i.width*i.height/8)));I=new DataView(A,e,16),i.pixels={},i.pixels.numBlocksY=I.getUint32(0,!0),i.pixels.numBlocksX=I.getUint32(4,!0),i.pixels.numBytes=I.getUint32(8,!0),i.pixels.maxValue=I.getFloat32(12,!0),e+=16;var C=i.pixels.numBlocksX,Q=i.pixels.numBlocksY,E=C+(i.width%C>0?1:0),s=Q+(i.height%Q>0?1:0);i.pixels.blocks=new Array(E*s);for(var f=0,c=0;c<s;c++)for(var h=0;h<E;h++){var l=0,u=A.byteLength-e;I=new DataView(A,e,Math.min(10,u));var w={};i.pixels.blocks[f++]=w;var d=I.getUint8(0);if(l++,w.encoding=63&d,w.encoding>3)throw"Invalid block encoding ("+w.encoding+")";if(2!==w.encoding){if(0!==d&&2!==d){if(d>>=6,w.offsetType=d,2===d)w.offset=I.getInt8(1),l++;else if(1===d)w.offset=I.getInt16(1,!0),l+=2;else{if(0!==d)throw"Invalid block offset type";w.offset=I.getFloat32(1,!0),l+=4}if(1===w.encoding)if(d=I.getUint8(l),l++,w.bitsPerPixel=63&d,d>>=6,w.numValidPixelsType=d,2===d)w.numValidPixels=I.getUint8(l),l++;else if(1===d)w.numValidPixels=I.getUint16(l,!0),l+=2;else{if(0!==d)throw"Invalid valid pixel count type";w.numValidPixels=I.getUint32(l,!0),l+=4}}var D;if(e+=l,3!==w.encoding)if(0===w.encoding){var y=(i.pixels.numBytes-1)/4;if(y!==Math.floor(y))throw"uncompressed block has invalid length";D=new ArrayBuffer(4*y),new Uint8Array(D).set(new Uint8Array(A,e,4*y));var k=new Float32Array(D);w.rawData=k,e+=4*y}else if(1===w.encoding){var p=Math.ceil(w.numValidPixels*w.bitsPerPixel/8),m=Math.ceil(p/4);D=new ArrayBuffer(4*m),new Uint8Array(D).set(new Uint8Array(A,e,p)),w.stuffedData=new Uint32Array(D),e+=p}}else e++}return i.eofOffset=e,i},I=function(A,e,t,i,r,I,g){var n,a,o,B=(1<<e)-1,C=0,Q=0,E=Math.ceil((g-i)/r),s=4*A.length-Math.ceil(e*t/8);for(A[A.length-1]<<=8*s,n=0;n<t;n++){if(0===Q&&(o=A[C++],Q=32),Q>=e)a=o>>>Q-e&B,Q-=e;else{var f=e-Q;a=(o&B)<<f&B,a+=(o=A[C++])>>>(Q=32-f)}I[n]=a<E?i+a*r:g}return I},A),h=(g=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E=(1<<t)-1,s=0,f=0,c=4*A.length-Math.ceil(t*i/8);if(A[A.length-1]<<=8*c,r)for(a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=r[o];else for(Q=Math.ceil((n-I)/g),a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=o<Q?I+o*g:n},n=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=[],s=4*A.length-Math.ceil(e*t/8);A[A.length-1]<<=8*s;var f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32),C>=e?(Q=g>>>C-e&n,C-=e):(Q=(g&n)<<(B=e-C)&n,Q+=(g=A[a++])>>>(C=32-B)),E[o]=Q<f?i+Q*r:I;return E.unshift(i),E},a=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q=(1<<t)-1,E=0,s=0,f=0;if(r)for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=r[o];else{var c=Math.ceil((n-I)/g);for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=o<c?I+o*g:n}return e},o=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=0,s=[],f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32,E=0),C>=e?(Q=g>>>E&n,C-=e,E+=e):(Q=g>>>E&n,C=32-(B=e-C),Q|=((g=A[a++])&(1<<B)-1)<<e-B,E=B),s[o]=Q<f?i+Q*r:I;return s.unshift(i),s},B=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=4*A.length-Math.ceil(t*i/8);for(A[A.length-1]<<=8*C,r=0;r<i;r++)0===B&&(g=A[o++],B=32),B>=t?(I=g>>>B-t&a,B-=t):(I=(g&a)<<(n=t-B)&a,I+=(g=A[o++])>>>(B=32-n)),e[r]=I;return e},C=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=0;for(r=0;r<i;r++)0===B&&(g=A[o++],B=32,C=0),B>=t?(I=g>>>C&a,B-=t,C+=t):(I=g>>>C&a,B=32-(n=t-B),I|=((g=A[o++])&(1<<n)-1)<<t-n,C=n),e[r]=I;return e},Q={HUFFMAN_LUT_BITS_MAX:12,computeChecksumFletcher32:function(A){for(var e=65535,t=65535,i=A.length,r=Math.floor(i/2),I=0;r;){var g=r>=359?359:r;r-=g;do{e+=A[I++]<<8,t+=e+=A[I++]}while(--g);e=(65535&e)+(e>>>16),t=(65535&t)+(t>>>16)}return 1&i&&(t+=e+=A[I]<<8),((t=(65535&t)+(t>>>16))<<16|(e=(65535&e)+(e>>>16)))>>>0},readHeaderInfo:function(A,e){var t=e.ptr,i=new Uint8Array(A,t,6),r={};if(r.fileIdentifierString=String.fromCharCode.apply(null,i),0!==r.fileIdentifierString.lastIndexOf("Lerc2",0))throw"Unexpected file identifier string (expect Lerc2 ): "+r.fileIdentifierString;t+=6;var I,g=new DataView(A,t,8),n=g.getInt32(0,!0);if(r.fileVersion=n,t+=4,n>=3&&(r.checksum=g.getUint32(4,!0),t+=4),g=new DataView(A,t,12),r.height=g.getUint32(0,!0),r.width=g.getUint32(4,!0),t+=8,n>=4?(r.numDims=g.getUint32(8,!0),t+=4):r.numDims=1,g=new DataView(A,t,40),r.numValidPixel=g.getUint32(0,!0),r.microBlockSize=g.getInt32(4,!0),r.blobSize=g.getInt32(8,!0),r.imageType=g.getInt32(12,!0),r.maxZError=g.getFloat64(16,!0),r.zMin=g.getFloat64(24,!0),r.zMax=g.getFloat64(32,!0),t+=40,e.headerInfo=r,e.ptr=t,n>=3&&(I=n>=4?52:48,this.computeChecksumFletcher32(new Uint8Array(A,t-I,r.blobSize-14))!==r.checksum))throw"Checksum failed.";return!0},checkMinMaxRanges:function(A,e){var t=e.headerInfo,i=this.getDataTypeArray(t.imageType),r=t.numDims*this.getDataTypeSize(t.imageType),I=this.readSubArray(A,e.ptr,i,r),g=this.readSubArray(A,e.ptr+r,i,r);e.ptr+=2*r;var n,a=!0;for(n=0;n<t.numDims;n++)if(I[n]!==g[n]){a=!1;break}return t.minValues=I,t.maxValues=g,a},readSubArray:function(A,e,t,i){var r;if(t===Uint8Array)r=new Uint8Array(A,e,i);else{var I=new ArrayBuffer(i);new Uint8Array(I).set(new Uint8Array(A,e,i)),r=new t(I)}return r},readMask:function(A,e){var t,i,r=e.ptr,I=e.headerInfo,g=I.width*I.height,n=I.numValidPixel,a=new DataView(A,r,4),o={};if(o.numBytes=a.getUint32(0,!0),r+=4,(0===n||g===n)&&0!==o.numBytes)throw"invalid mask";if(0===n)t=new Uint8Array(Math.ceil(g/8)),o.bitset=t,i=new Uint8Array(g),e.pixels.resultMask=i,r+=o.numBytes;else if(o.numBytes>0){t=new Uint8Array(Math.ceil(g/8));var B=(a=new DataView(A,r,o.numBytes)).getInt16(0,!0),C=2,Q=0,E=0;do{if(B>0)for(;B--;)t[Q++]=a.getUint8(C++);else for(E=a.getUint8(C++),B=-B;B--;)t[Q++]=E;B=a.getInt16(C,!0),C+=2}while(C<o.numBytes);if(-32768!==B||Q<t.length)throw"Unexpected end of mask RLE encoding";i=new Uint8Array(g);var s=0,f=0;for(f=0;f<g;f++)7&f?(s=t[f>>3],s<<=7&f):s=t[f>>3],128&s&&(i[f]=1);e.pixels.resultMask=i,o.bitset=t,r+=o.numBytes}return e.ptr=r,e.mask=o,!0},readDataOneSweep:function(A,e,t,i){var r,I=e.ptr,g=e.headerInfo,n=g.numDims,a=g.width*g.height,o=g.imageType,B=g.numValidPixel*Q.getDataTypeSize(o)*n,C=e.pixels.resultMask;if(t===Uint8Array)r=new Uint8Array(A,I,B);else{var E=new ArrayBuffer(B);new Uint8Array(E).set(new Uint8Array(A,I,B)),r=new t(E)}if(r.length===a*n)e.pixels.resultPixels=i?Q.swapDimensionOrder(r,a,n,t,!0):r;else{e.pixels.resultPixels=new t(a*n);var s=0,f=0,c=0,h=0;if(n>1){if(i){for(f=0;f<a;f++)if(C[f])for(h=f,c=0;c<n;c++,h+=a)e.pixels.resultPixels[h]=r[s++]}else for(f=0;f<a;f++)if(C[f])for(h=f*n,c=0;c<n;c++)e.pixels.resultPixels[h+c]=r[s++]}else for(f=0;f<a;f++)C[f]&&(e.pixels.resultPixels[f]=r[s++])}return I+=B,e.ptr=I,!0},readHuffmanTree:function(A,e){var t=this.HUFFMAN_LUT_BITS_MAX,i=new DataView(A,e.ptr,16);if(e.ptr+=16,i.getInt32(0,!0)<2)throw"unsupported Huffman version";var r=i.getInt32(4,!0),I=i.getInt32(8,!0),g=i.getInt32(12,!0);if(I>=g)return!1;var n=new Uint32Array(g-I);Q.decodeBits(A,e,n);var a,o,B,C,s=[];for(a=I;a<g;a++)s[o=a-(a<r?0:r)]={first:n[a-I],second:null};var f=A.byteLength-e.ptr,c=Math.ceil(f/4),h=new ArrayBuffer(4*c);new Uint8Array(h).set(new Uint8Array(A,e.ptr,f));var l,u=new Uint32Array(h),w=0,d=0;for(l=u[0],a=I;a<g;a++)(C=s[o=a-(a<r?0:r)].first)>0&&(s[o].second=l<<w>>>32-C,32-w>=C?32===(w+=C)&&(w=0,l=u[++d]):(w+=C-32,l=u[++d],s[o].second|=l>>>32-w));var D=0,y=0,k=new E;for(a=0;a<s.length;a++)void 0!==s[a]&&(D=Math.max(D,s[a].first));y=D>=t?t:D;var p,m,G,F,S,v=[];for(a=I;a<g;a++)if((C=s[o=a-(a<r?0:r)].first)>0)if(p=[C,o],C<=y)for(m=s[o].second<<y-C,G=1<<y-C,B=0;B<G;B++)v[m|B]=p;else for(m=s[o].second,S=k,F=C-1;F>=0;F--)m>>>F&1?(S.right||(S.right=new E),S=S.right):(S.left||(S.left=new E),S=S.left),0!==F||S.val||(S.val=p[1]);return{decodeLut:v,numBitsLUTQick:y,numBitsLUT:D,tree:k,stuffedData:u,srcPtr:d,bitPos:w}},readHuffman:function(A,e,t,i){var r,I,g,n,a,o,B,C,E,s=e.headerInfo.numDims,f=e.headerInfo.height,c=e.headerInfo.width,h=c*f,l=this.readHuffmanTree(A,e),u=l.decodeLut,w=l.tree,d=l.stuffedData,D=l.srcPtr,y=l.bitPos,k=l.numBitsLUTQick,p=l.numBitsLUT,m=0===e.headerInfo.imageType?128:0,G=e.pixels.resultMask,F=0;y>0&&(D++,y=0);var S,v=d[D],R=1===e.encodeMode,U=new t(h*s),L=U;if(s<2||R){for(S=0;S<s;S++)if(s>1&&(L=new t(U.buffer,h*S,h),F=0),e.headerInfo.numValidPixel===c*f)for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(g+=B>0?F:o>0?L[C-c]:F,g&=255,L[C]=g,F=g):L[C]=g}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++)if(G[C]){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(B>0&&G[C-1]?g+=F:o>0&&G[C-c]?g+=L[C-c]:g+=F,g&=255,L[C]=g,F=g):L[C]=g}}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++)if(C=o*c+B,!G||G[C])for(S=0;S<s;S++,C+=h){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,L[C]=g}e.ptr=e.ptr+4*(D+1)+(y>0?4:0),e.pixels.resultPixels=U,s>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(U,h,s,t))},decodeBits:function(A,e,t,i,r){var I=e.headerInfo,Q=I.fileVersion,E=0,s=A.byteLength-e.ptr>=5?5:A.byteLength-e.ptr,f=new DataView(A,e.ptr,s),c=f.getUint8(0);E++;var h=c>>6,l=0===h?4:3-h,u=(32&c)>0,w=31&c,d=0;if(1===l)d=f.getUint8(E),E++;else if(2===l)d=f.getUint16(E,!0),E+=2;else{if(4!==l)throw"Invalid valid pixel count type";d=f.getUint32(E,!0),E+=4}var D,y,k,p,m,G,F,S,v,R=2*I.maxZError,U=I.numDims>1?I.maxValues[r]:I.zMax;if(u){for(e.counter.lut++,S=f.getUint8(E),E++,p=Math.ceil((S-1)*w/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),k=new Uint8Array(y),e.ptr+=E,k.set(new Uint8Array(A,e.ptr,p)),F=new Uint32Array(y),e.ptr+=p,v=0;S-1>>>v;)v++;p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,G=Q>=3?o(F,w,S-1,i,R,U):n(F,w,S-1,i,R,U),Q>=3?a(D,t,v,d,G):g(D,t,v,d,G)}else e.counter.bitstuffer++,v=w,e.ptr+=E,v>0&&(p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,Q>=3?null==i?C(D,t,v,d):a(D,t,v,d,!1,i,R,U):null==i?B(D,t,v,d):g(D,t,v,d,!1,i,R,U))},readTiles:function(A,e,t,i){var r=e.headerInfo,I=r.width,g=r.height,n=I*g,a=r.microBlockSize,o=r.imageType,B=Q.getDataTypeSize(o),C=Math.ceil(I/a),E=Math.ceil(g/a);e.pixels.numBlocksY=E,e.pixels.numBlocksX=C,e.pixels.ptr=0;var s,f,c,h,l,u,w,d,D,y,k=0,p=0,m=0,G=0,F=0,S=0,v=0,R=0,U=0,L=0,b=0,M=0,N=0,x=0,J=0,q=new t(a*a),Y=g%a||a,K=I%a||a,H=r.numDims,O=e.pixels.resultMask,P=e.pixels.resultPixels,T=r.fileVersion>=5?14:15,V=r.zMax;for(m=0;m<E;m++)for(F=m!==E-1?a:Y,G=0;G<C;G++)for(L=m*I*a+G*a,b=I-(S=G!==C-1?a:K),d=0;d<H;d++){if(H>1?(y=P,L=m*I*a+G*a,P=new t(e.pixels.resultPixels.buffer,n*d*B,n),V=r.maxValues[d]):y=null,v=A.byteLength-e.ptr,f={},J=0,R=(s=new DataView(A,e.ptr,Math.min(10,v))).getUint8(0),J++,D=r.fileVersion>=5?4&R:0,U=R>>6&255,(R>>2&T)!=(G*a>>3&T))throw"integrity issue";if(D&&0===d)throw"integrity issue";if((l=3&R)>3)throw e.ptr+=J,"Invalid block encoding ("+l+")";if(2!==l)if(0===l){if(D)throw"integrity issue";if(e.counter.uncompressed++,e.ptr+=J,M=(M=F*S*B)<(N=A.byteLength-e.ptr)?M:N,c=new ArrayBuffer(M%B==0?M:M+B-M%B),new Uint8Array(c).set(new Uint8Array(A,e.ptr,M)),h=new t(c),x=0,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=h[x++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=h[x++];L+=b}e.ptr+=x*B}else if(u=Q.getDataTypeUsed(D&&o<6?4:o,U),w=Q.getOnePixel(f,J,u,s),J+=Q.getDataTypeSize(u),3===l)if(e.ptr+=J,e.counter.constantoffset++,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=D?Math.min(V,y[L]+w):w),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=D?Math.min(V,y[L]+w):w,L++;L+=b}else if(e.ptr+=J,Q.decodeBits(A,e,q,w,d),J=0,D)if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]+y[L]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=q[J++]+y[L],L++;L+=b}else if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=q[J++];L+=b}else{if(D)if(O)for(k=0;k<F;k++)for(p=0;p<S;p++)O[L]&&(P[L]=y[L]),L++;else for(k=0;k<F;k++)for(p=0;p<S;p++)P[L]=y[L],L++;e.counter.constant++,e.ptr+=J}}H>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(e.pixels.resultPixels,n,H,t))},formatFileInfo:function(A){return{fileIdentifierString:A.headerInfo.fileIdentifierString,fileVersion:A.headerInfo.fileVersion,imageType:A.headerInfo.imageType,height:A.headerInfo.height,width:A.headerInfo.width,numValidPixel:A.headerInfo.numValidPixel,microBlockSize:A.headerInfo.microBlockSize,blobSize:A.headerInfo.blobSize,maxZError:A.headerInfo.maxZError,pixelType:Q.getPixelType(A.headerInfo.imageType),eofOffset:A.eofOffset,mask:A.mask?{numBytes:A.mask.numBytes}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,maxValue:A.headerInfo.zMax,minValue:A.headerInfo.zMin,noDataValue:A.noDataValue}}},constructConstantSurface:function(A,e){var t=A.headerInfo.zMax,i=A.headerInfo.zMin,r=A.headerInfo.maxValues,I=A.headerInfo.numDims,g=A.headerInfo.height*A.headerInfo.width,n=0,a=0,o=0,B=A.pixels.resultMask,C=A.pixels.resultPixels;if(B)if(I>1){if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)B[a]&&(C[o+a]=t);else for(a=0;a<g;a++)if(B[a])for(o=a*I,n=0;n<I;n++)C[o+I]=r[n]}else for(a=0;a<g;a++)B[a]&&(C[a]=t);else if(I>1&&i!==t)if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)C[o+a]=t;else for(a=0;a<g;a++)for(o=a*I,n=0;n<I;n++)C[o+n]=r[n];else for(a=0;a<g*I;a++)C[a]=t},getDataTypeArray:function(A){var e;switch(A){case 0:e=Int8Array;break;case 1:e=Uint8Array;break;case 2:e=Int16Array;break;case 3:e=Uint16Array;break;case 4:e=Int32Array;break;case 5:e=Uint32Array;break;case 6:default:e=Float32Array;break;case 7:e=Float64Array}return e},getPixelType:function(A){var e;switch(A){case 0:e="S8";break;case 1:e="U8";break;case 2:e="S16";break;case 3:e="U16";break;case 4:e="S32";break;case 5:e="U32";break;case 6:default:e="F32";break;case 7:e="F64"}return e},isValidPixelValue:function(A,e){if(null==e)return!1;var t;switch(A){case 0:t=e>=-128&&e<=127;break;case 1:t=e>=0&&e<=255;break;case 2:t=e>=-32768&&e<=32767;break;case 3:t=e>=0&&e<=65536;break;case 4:t=e>=-2147483648&&e<=2147483647;break;case 5:t=e>=0&&e<=4294967296;break;case 6:t=e>=-34027999387901484e22&&e<=34027999387901484e22;break;case 7:t=e>=-17976931348623157e292&&e<=17976931348623157e292;break;default:t=!1}return t},getDataTypeSize:function(A){var e=0;switch(A){case 0:case 1:e=1;break;case 2:case 3:e=2;break;case 4:case 5:case 6:e=4;break;case 7:e=8;break;default:e=A}return e},getDataTypeUsed:function(A,e){var t=A;switch(A){case 2:case 4:t=A-e;break;case 3:case 5:t=A-2*e;break;case 6:t=0===e?A:1===e?2:1;break;case 7:t=0===e?A:A-2*e+1;break;default:t=A}return t},getOnePixel:function(A,e,t,i){var r=0;switch(t){case 0:r=i.getInt8(e);break;case 1:r=i.getUint8(e);break;case 2:r=i.getInt16(e,!0);break;case 3:r=i.getUint16(e,!0);break;case 4:r=i.getInt32(e,!0);break;case 5:r=i.getUInt32(e,!0);break;case 6:r=i.getFloat32(e,!0);break;case 7:r=i.getFloat64(e,!0);break;default:throw"the decoder does not understand this pixel type"}return r},swapDimensionOrder:function(A,e,t,i,r){var I=0,g=0,n=0,a=0,o=A;if(t>1)if(o=new i(e*t),r)for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[a]=A[g++];else for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[g++]=A[a];return o}},E=function(A,e,t){this.val=A,this.left=e,this.right=t},{decode:function(A,e){var t=(e=e||{}).noDataValue,i=0,r={};r.ptr=e.inputOffset||0,r.pixels={},Q.readHeaderInfo(A,r);var I=r.headerInfo,g=I.fileVersion,n=Q.getDataTypeArray(I.imageType);if(g>5)throw"unsupported lerc version 2."+g;Q.readMask(A,r),I.numValidPixel===I.width*I.height||r.pixels.resultMask||(r.pixels.resultMask=e.maskData);var a=I.width*I.height;r.pixels.resultPixels=new n(a*I.numDims),r.counter={onesweep:0,uncompressed:0,lut:0,bitstuffer:0,constant:0,constantoffset:0};var o,B=!e.returnPixelInterleavedDims;if(0!==I.numValidPixel)if(I.zMax===I.zMin)Q.constructConstantSurface(r,B);else if(g>=4&&Q.checkMinMaxRanges(A,r))Q.constructConstantSurface(r,B);else{var C=new DataView(A,r.ptr,2),E=C.getUint8(0);if(r.ptr++,E)Q.readDataOneSweep(A,r,n,B);else if(g>1&&I.imageType<=1&&Math.abs(I.maxZError-.5)<1e-5){var s=C.getUint8(1);if(r.ptr++,r.encodeMode=s,s>2||g<4&&s>1)throw"Invalid Huffman flag "+s;s?Q.readHuffman(A,r,n,B):Q.readTiles(A,r,n,B)}else Q.readTiles(A,r,n,B)}r.eofOffset=r.ptr,e.inputOffset?(o=r.headerInfo.blobSize+e.inputOffset-r.ptr,Math.abs(o)>=1&&(r.eofOffset=e.inputOffset+r.headerInfo.blobSize)):(o=r.headerInfo.blobSize-r.ptr,Math.abs(o)>=1&&(r.eofOffset=r.headerInfo.blobSize));var f={width:I.width,height:I.height,pixelData:r.pixels.resultPixels,minValue:I.zMin,maxValue:I.zMax,validPixelCount:I.numValidPixel,dimCount:I.numDims,dimStats:{minValues:I.minValues,maxValues:I.maxValues},maskData:r.pixels.resultMask};if(r.pixels.resultMask&&Q.isValidPixelValue(I.imageType,t)){var c=r.pixels.resultMask;for(i=0;i<a;i++)c[i]||(f.pixelData[i]=t);f.noDataValue=t}return r.noDataValue=t,e.returnFileInfo&&(f.fileInfo=Q.formatFileInfo(r)),f},getBandCount:function(A){for(var e=0,t=0,i={ptr:0,pixels:{}};t<A.byteLength-58;)Q.readHeaderInfo(A,i),t+=i.headerInfo.blobSize,e++,i.ptr=t;return e}}),l=(s=new ArrayBuffer(4),f=new Uint8Array(s),new Uint32Array(s)[0]=1,1===f[0]),u={decode:function(A,e){if(!l)throw"Big endian system is not supported.";var t,i,r=(e=e||{}).inputOffset||0,I=new Uint8Array(A,r,10),g=String.fromCharCode.apply(null,I);if("CntZImage"===g.trim())t=c,i=1;else{if("Lerc2"!==g.substring(0,5))throw"Unexpected file identifier string: "+g;t=h,i=2}for(var n,a,o,B,C,Q,E=0,s=A.byteLength-10,f=[],u={width:0,height:0,pixels:[],pixelType:e.pixelType,mask:null,statistics:[]},w=0;r<s;){var d=t.decode(A,{inputOffset:r,encodedMaskData:n,maskData:o,returnMask:0===E,returnEncodedMask:0===E,returnFileInfo:!0,returnPixelInterleavedDims:e.returnPixelInterleavedDims,pixelType:e.pixelType||null,noDataValue:e.noDataValue||null});r=d.fileInfo.eofOffset,o=d.maskData,0===E&&(n=d.encodedMaskData,u.width=d.width,u.height=d.height,u.dimCount=d.dimCount||1,u.pixelType=d.pixelType||d.fileInfo.pixelType,u.mask=o),i>1&&(o&&f.push(o),d.fileInfo.mask&&d.fileInfo.mask.numBytes>0&&w++),E++,u.pixels.push(d.pixelData),u.statistics.push({minValue:d.minValue,maxValue:d.maxValue,noDataValue:d.noDataValue,dimStats:d.dimStats})}if(i>1&&w>1){for(Q=u.width*u.height,u.bandMasks=f,(o=new Uint8Array(Q)).set(f[0]),B=1;B<f.length;B++)for(a=f[B],C=0;C<Q;C++)o[C]=o[C]&a[C];u.maskData=o}return u}};TA.exports?TA.exports=u:this.Lerc=u}();var ZA,jA,WA,zA=XA.exports,$A={env:{emscripten_notify_memory_growth:function(A){WA=new Uint8Array(jA.exports.memory.buffer)}}},Ae=function(){function A(){B(this,A)}return Q(A,[{key:"init",value:function(){return ZA||(ZA="undefined"!=typeof fetch?fetch("data:application/wasm;base64,"+ee).then((function(A){return A.arrayBuffer()})).then((function(A){return WebAssembly.instantiate(A,$A)})).then(this._init):WebAssembly.instantiate(Buffer.from(ee,"base64"),$A).then(this._init))}},{key:"_init",value:function(A){jA=A.instance,$A.env.emscripten_notify_memory_growth(0)}},{key:"decode",value:function(A){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0;if(!jA)throw new Error("ZSTDDecoder: Await .init() before decoding.");var t=A.byteLength,i=jA.exports.malloc(t);WA.set(A,i),e=e||Number(jA.exports.ZSTD_findDecompressedSize(i,t));var r=jA.exports.malloc(e),I=jA.exports.ZSTD_decompress(r,e,i,t),g=WA.slice(r,r+I);return jA.exports.free(i),jA.exports.free(r),g}}]),A}(),ee="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IAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQhBSAGQQR2IQRBICAAdCIAQQFyIQkgASgCACEPQQAhAiADIQYCQANAIAlBAkggAiAPS3JFBEAgAiEHAkAgCARAA0AgBEH//wNxQf//A0YEQCAHQRhqIQcgBiAQSQR/IAZBAmoiBigAACAFdgUgBUEQaiEFIARBEHYLIQQMAQsLA0AgBEEDcSIIQQNGBEAgBUECaiEFIARBAnYhBCAHQQNqIQcMAQsLIAcgCGoiByAPSw0EIAVBAmohBQNAIAIgB0kEQCANIAJBAXRqQQA7AQAgAkEBaiECDAELCyAGIA5LQQAgBiAFQQN1aiIHIAxLG0UEQCAHKAAAIAVBB3EiBXYhBAwCCyAEQQJ2IQQLIAYhBwsCfyALQX9qIAQgAEF/anEiBiAAQQF0QX9qIgggCWsiEUkNABogBCAIcSIEQQAgESAEIABIG2shBiALCyEIIA0gAkEBdGogBkF/aiIEOwEAIAlBASAGayAEIAZBAUgbayEJA0AgCSAASARAIABBAXUhACALQX9qIQsMAQsLAn8gByAOS0EAIAcgBSAIaiIFQQN1aiIGIAxLG0UEQCAFQQdxDAELIAUgDCIGIAdrQQN0awshBSACQQFqIQIgBEUhCCAGKAAAIAVBH3F2IQQMAQsLQWwgCUEBRyAFQSBKcg0BGiABIAJBf2o2AgAgBiAFQQdqQQN1aiADawwBC0FQCyEAIApBEGokACAACwkAQQFBBSAAGwsMACAAIAEoAAA2AAALqgMBCn8jAEHwAGsiCiQAIAJBAWohDiAAQQhqIQtBgIAEIAVBf2p0QRB1IQxBACECQQEhBkEBIAV0IglBf2oiDyEIA0AgAiAORkUEQAJAIAEgAkEBdCINai8BACIHQf//A0YEQCALIAhBA3RqIAI2AgQgCEF/aiEIQQEhBwwBCyAGQQAgDCAHQRB0QRB1ShshBgsgCiANaiAHOwEAIAJBAWohAgwBCwsgACAFNgIEIAAgBjYCACAJQQN2IAlBAXZqQQNqIQxBACEAQQAhBkEAIQIDQCAGIA5GBEADQAJAIAAgCUYNACAKIAsgAEEDdGoiASgCBCIGQQF0aiICIAIvAQAiAkEBajsBACABIAUgAhAUayIIOgADIAEgAiAIQf8BcXQgCWs7AQAgASAEIAZBAnQiAmooAgA6AAIgASACIANqKAIANgIEIABBAWohAAwBCwsFIAEgBkEBdGouAQAhDUEAIQcDQCAHIA1ORQRAIAsgAkEDdGogBjYCBANAIAIgDGogD3EiAiAISw0ACyAHQQFqIQcMAQsLIAZBAWohBgwBCwsgCkHwAGokAAsjAEIAIAEQCSAAhUKHla+vmLbem55/fkLj3MqV/M7y9YV/fAsQACAAQn43AwggACABNgIACyQBAX8gAARAIAEoAgQiAgRAIAEoAgggACACEQEADwsgABAmCwsfACAAIAEgAi8BABAINgIAIAEQBBogACACQQRqNgIEC0oBAX9BoCAoAgAiASAAaiIAQX9MBEBBiCBBMDYCAEF/DwsCQCAAPwBBEHRNDQAgABBmDQBBiCBBMDYCAEF/DwtBoCAgADYCACABC9cBAQh/Qbp/IQoCQCACKAIEIgggAigCACIJaiIOIAEgAGtLDQBBbCEKIAkgBCADKAIAIgtrSw0AIAAgCWoiBCACKAIIIgxrIQ0gACABQWBqIg8gCyAJQQAQKSADIAkgC2o2AgACQAJAIAwgBCAFa00EQCANIQUMAQsgDCAEIAZrSw0CIAcgDSAFayIAaiIBIAhqIAdNBEAgBCABIAgQDxoMAgsgBCABQQAgAGsQDyEBIAIgACAIaiIINgIEIAEgAGshBAsgBCAPIAUgCEEBECkLIA4hCgsgCgubAgEBfyMAQYABayINJAAgDSADNgJ8AkAgAkEDSwRAQX8hCQwBCwJAAkACQAJAIAJBAWsOAwADAgELIAZFBEBBuH8hCQwEC0FsIQkgBS0AACICIANLDQMgACAHIAJBAnQiAmooAgAgAiAIaigCABA7IAEgADYCAEEBIQkMAwsgASAJNgIAQQAhCQwCCyAKRQRAQWwhCQwCC0EAIQkgC0UgDEEZSHINAUEIIAR0QQhqIQBBACECA0AgAiAATw0CIAJBQGshAgwAAAsAC0FsIQkgDSANQfwAaiANQfgAaiAFIAYQFSICEAMNACANKAJ4IgMgBEsNACAAIA0gDSgCfCAHIAggAxAYIAEgADYCACACIQkLIA1BgAFqJAAgCQsLACAAIAEgAhALGgsQACAALwAAIAAtAAJBEHRyCy8AAn9BuH8gAUEISQ0AGkFyIAAoAAQiAEF3Sw0AGkG4fyAAQQhqIgAgACABSxsLCwkAIAAgATsAAAsDAAELigYBBX8gACAAKAIAIgVBfnE2AgBBACAAIAVBAXZqQYQgKAIAIgQgAEYbIQECQAJAIAAoAgQiAkUNACACKAIAIgNBAXENACACQQhqIgUgA0EBdkF4aiIDQQggA0EISxtnQR9zQQJ0QYAfaiIDKAIARgRAIAMgAigCDDYCAAsgAigCCCIDBEAgAyACKAIMNgIECyACKAIMIgMEQCADIAIoAgg2AgALIAIgAigCACAAKAIAQX5xajYCAEGEICEAAkACQCABRQ0AIAEgAjYCBCABKAIAIgNBAXENASADQQF2QXhqIgNBCCADQQhLG2dBH3NBAnRBgB9qIgMoAgAgAUEIakYEQCADIAEoAgw2AgALIAEoAggiAwRAIAMgASgCDDYCBAsgASgCDCIDBEAgAyABKAIINgIAQYQgKAIAIQQLIAIgAigCACABKAIAQX5xajYCACABIARGDQAgASABKAIAQQF2akEEaiEACyAAIAI2AgALIAIoAgBBAXZBeGoiAEEIIABBCEsbZ0Efc0ECdEGAH2oiASgCACEAIAEgBTYCACACIAA2AgwgAkEANgIIIABFDQEgACAFNgIADwsCQCABRQ0AIAEoAgAiAkEBcQ0AIAJBAXZBeGoiAkEIIAJBCEsbZ0Efc0ECdEGAH2oiAigCACABQQhqRgRAIAIgASgCDDYCAAsgASgCCCICBEAgAiABKAIMNgIECyABKAIMIgIEQCACIAEoAgg2AgBBhCAoAgAhBAsgACAAKAIAIAEoAgBBfnFqIgI2AgACQCABIARHBEAgASABKAIAQQF2aiAANgIEIAAoAgAhAgwBC0GEICAANgIACyACQQF2QXhqIgFBCCABQQhLG2dBH3NBAnRBgB9qIgIoAgAhASACIABBCGoiAjYCACAAIAE2AgwgAEEANgIIIAFFDQEgASACNgIADwsgBUEBdkF4aiIBQQggAUEISxtnQR9zQQJ0QYAfaiICKAIAIQEgAiAAQQhqIgI2AgAgACABNgIMIABBADYCCCABRQ0AIAEgAjYCAAsLDgAgAARAIABBeGoQJQsLgAIBA38CQCAAQQ9qQXhxQYQgKAIAKAIAQQF2ayICEB1Bf0YNAAJAQYQgKAIAIgAoAgAiAUEBcQ0AIAFBAXZBeGoiAUEIIAFBCEsbZ0Efc0ECdEGAH2oiASgCACAAQQhqRgRAIAEgACgCDDYCAAsgACgCCCIBBEAgASAAKAIMNgIECyAAKAIMIgFFDQAgASAAKAIINgIAC0EBIQEgACAAKAIAIAJBAXRqIgI2AgAgAkEBcQ0AIAJBAXZBeGoiAkEIIAJBCEsbZ0Efc0ECdEGAH2oiAygCACECIAMgAEEIaiIDNgIAIAAgAjYCDCAAQQA2AgggAkUNACACIAM2AgALIAELtwIBA38CQAJAIABBASAAGyICEDgiAA0AAkACQEGEICgCACIARQ0AIAAoAgAiA0EBcQ0AIAAgA0EBcjYCACADQQF2QXhqIgFBCCABQQhLG2dBH3NBAnRBgB9qIgEoAgAgAEEIakYEQCABIAAoAgw2AgALIAAoAggiAQRAIAEgACgCDDYCBAsgACgCDCIBBEAgASAAKAIINgIACyACECchAkEAIQFBhCAoAgAhACACDQEgACAAKAIAQX5xNgIAQQAPCyACQQ9qQXhxIgMQHSICQX9GDQIgAkEHakF4cSIAIAJHBEAgACACaxAdQX9GDQMLAkBBhCAoAgAiAUUEQEGAICAANgIADAELIAAgATYCBAtBhCAgADYCACAAIANBAXRBAXI2AgAMAQsgAEUNAQsgAEEIaiEBCyABC7kDAQJ/IAAgA2ohBQJAIANBB0wEQANAIAAgBU8NAiAAIAItAAA6AAAgAEEBaiEAIAJBAWohAgwAAAsACyAEQQFGBEACQCAAIAJrIgZBB00EQCAAIAItAAA6AAAgACACLQABOgABIAAgAi0AAjoAAiAAIAItAAM6AAMgAEEEaiACIAZBAnQiBkHAHmooAgBqIgIQFyACIAZB4B5qKAIAayECDAELIAAgAhAMCyACQQhqIQIgAEEIaiEACwJAAkACQAJAIAUgAU0EQCAAIANqIQEgBEEBRyAAIAJrQQ9Kcg0BA0AgACACEAwgAkEIaiECIABBCGoiACABSQ0ACwwFCyAAIAFLBEAgACEBDAQLIARBAUcgACACa0EPSnINASAAIQMgAiEEA0AgAyAEEAwgBEEIaiEEIANBCGoiAyABSQ0ACwwCCwNAIAAgAhAHIAJBEGohAiAAQRBqIgAgAUkNAAsMAwsgACEDIAIhBANAIAMgBBAHIARBEGohBCADQRBqIgMgAUkNAAsLIAIgASAAa2ohAgsDQCABIAVPDQEgASACLQAAOgAAIAFBAWohASACQQFqIQIMAAALAAsLQQECfyAAIAAoArjgASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigC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C0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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",te={315:"Artist",258:"BitsPerSample",265:"CellLength",264:"CellWidth",320:"ColorMap",259:"Compression",33432:"Copyright",306:"DateTime",338:"ExtraSamples",266:"FillOrder",289:"FreeByteCounts",288:"FreeOffsets",291:"GrayResponseCurve",290:"GrayResponseUnit",316:"HostComputer",270:"ImageDescription",257:"ImageLength",256:"ImageWidth",271:"Make",281:"MaxSampleValue",280:"MinSampleValue",272:"Model",254:"NewSubfileType",274:"Orientation",262:"PhotometricInterpretation",284:"PlanarConfiguration",296:"ResolutionUnit",278:"RowsPerStrip",277:"SamplesPerPixel",305:"Software",279:"StripByteCounts",273:"StripOffsets",255:"SubfileType",263:"Threshholding",282:"XResolution",283:"YResolution",326:"BadFaxLines",327:"CleanFaxData",343:"ClipPath",328:"ConsecutiveBadFaxLines",433:"Decode",434:"DefaultImageColor",269:"DocumentName",336:"DotRange",321:"HalftoneHints",346:"Indexed",347:"JPEGTables",285:"PageName",297:"PageNumber",317:"Predictor",319:"PrimaryChromaticities",532:"ReferenceBlackWhite",339:"SampleFormat",340:"SMinSampleValue",341:"SMaxSampleValue",559:"StripRowCounts",330:"SubIFDs",292:"T4Options",293:"T6Options",325:"TileByteCounts",323:"TileLength",324:"TileOffsets",322:"TileWidth",301:"TransferFunction",318:"WhitePoint",344:"XClipPathUnits",286:"XPosition",529:"YCbCrCoefficients",531:"YCbCrPositioning",530:"YCbCrSubSampling",345:"YClipPathUnits",287:"YPosition",37378:"ApertureValue",40961:"ColorSpace",36868:"DateTimeDigitized",36867:"DateTimeOriginal",34665:"Exif IFD",36864:"ExifVersion",33434:"ExposureTime",41728:"FileSource",37385:"Flash",40960:"FlashpixVersion",33437:"FNumber",42016:"ImageUniqueID",37384:"LightSource",37500:"MakerNote",37377:"ShutterSpeedValue",37510:"UserComment",33723:"IPTC",34675:"ICC Profile",700:"XMP",42112:"GDAL_METADATA",42113:"GDAL_NODATA",34377:"Photoshop",33550:"ModelPixelScale",33922:"ModelTiepoint",34264:"ModelTransformation",34735:"GeoKeyDirectory",34736:"GeoDoubleParams",34737:"GeoAsciiParams",50674:"LercParameters"},ie={};for(var re in te)te.hasOwnProperty(re)&&(ie[te[re]]=parseInt(re,10));ie.BitsPerSample,ie.ExtraSamples,ie.SampleFormat,ie.StripByteCounts,ie.StripOffsets,ie.StripRowCounts,ie.TileByteCounts,ie.TileOffsets,ie.SubIFDs;var Ie={1:"BYTE",2:"ASCII",3:"SHORT",4:"LONG",5:"RATIONAL",6:"SBYTE",7:"UNDEFINED",8:"SSHORT",9:"SLONG",10:"SRATIONAL",11:"FLOAT",12:"DOUBLE",13:"IFD",16:"LONG8",17:"SLONG8",18:"IFD8"},ge={};for(var ne in Ie)Ie.hasOwnProperty(ne)&&(ge[Ie[ne]]=parseInt(ne,10));var ae=1,oe=0,Be=1,Ce=2,Qe={1024:"GTModelTypeGeoKey",1025:"GTRasterTypeGeoKey",1026:"GTCitationGeoKey",2048:"GeographicTypeGeoKey",2049:"GeogCitationGeoKey",2050:"GeogGeodeticDatumGeoKey",2051:"GeogPrimeMeridianGeoKey",2052:"GeogLinearUnitsGeoKey",2053:"GeogLinearUnitSizeGeoKey",2054:"GeogAngularUnitsGeoKey",2055:"GeogAngularUnitSizeGeoKey",2056:"GeogEllipsoidGeoKey",2057:"GeogSemiMajorAxisGeoKey",2058:"GeogSemiMinorAxisGeoKey",2059:"GeogInvFlatteningGeoKey",2060:"GeogAzimuthUnitsGeoKey",2061:"GeogPrimeMeridianLongGeoKey",2062:"GeogTOWGS84GeoKey",3072:"ProjectedCSTypeGeoKey",3073:"PCSCitationGeoKey",3074:"ProjectionGeoKey",3075:"ProjCoordTransGeoKey",3076:"ProjLinearUnitsGeoKey",3077:"ProjLinearUnitSizeGeoKey",3078:"ProjStdParallel1GeoKey",3079:"ProjStdParallel2GeoKey",3080:"ProjNatOriginLongGeoKey",3081:"ProjNatOriginLatGeoKey",3082:"ProjFalseEastingGeoKey",3083:"ProjFalseNorthingGeoKey",3084:"ProjFalseOriginLongGeoKey",3085:"ProjFalseOriginLatGeoKey",3086:"ProjFalseOriginEastingGeoKey",3087:"ProjFalseOriginNorthingGeoKey",3088:"ProjCenterLongGeoKey",3089:"ProjCenterLatGeoKey",3090:"ProjCenterEastingGeoKey",3091:"ProjCenterNorthingGeoKey",3092:"ProjScaleAtNatOriginGeoKey",3093:"ProjScaleAtCenterGeoKey",3094:"ProjAzimuthAngleGeoKey",3095:"ProjStraightVertPoleLongGeoKey",3096:"ProjRectifiedGridAngleGeoKey",4096:"VerticalCSTypeGeoKey",4097:"VerticalCitationGeoKey",4098:"VerticalDatumGeoKey",4099:"VerticalUnitsGeoKey"},Ee={};for(var se in Qe)Qe.hasOwnProperty(se)&&(Ee[Qe[se]]=parseInt(se,10));function fe(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var ce=new Ae,he=function(A){s(t,w);var e=fe(t);function t(A){var i;return B(this,t),(i=e.call(this)).planarConfiguration=void 0!==A.PlanarConfiguration?A.PlanarConfiguration:1,i.samplesPerPixel=void 0!==A.SamplesPerPixel?A.SamplesPerPixel:1,i.addCompression=A.LercParameters[ae],i}return Q(t,[{key:"decodeBlock",value:function(A){switch(this.addCompression){case oe:break;case Be:A=YA(new Uint8Array(A)).buffer;break;case Ce:A=ce.decode(new Uint8Array(A)).buffer;break;default:throw new Error("Unsupported LERC additional compression method identifier: ".concat(this.addCompression))}return zA.decode(A,{returnPixelInterleavedDims:1===this.planarConfiguration}).pixels[0].buffer}}]),t}(),le=Object.freeze({__proto__:null,zstd:ce,default:he});function ue(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var we=function(A){s(I,w);var t,i=ue(I);function I(){var A;if(B(this,I),A=i.call(this),"undefined"==typeof createImageBitmap)throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");if("undefined"==typeof document&&"undefined"==typeof OffscreenCanvas)throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");return A}return Q(I,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return i=new Blob([t]),A.next=3,createImageBitmap(i);case 3:return I=A.sent,"undefined"!=typeof document?((g=document.createElement("canvas")).width=I.width,g.height=I.height):g=new OffscreenCanvas(I.width,I.height),(n=g.getContext("2d")).drawImage(I,0,0),A.abrupt("return",n.getImageData(0,0,I.width,I.height).data.buffer);case 8:case"end":return A.stop()}}),A)}))),function(A,e){return t.apply(this,arguments)})}]),I}(),de=Object.freeze({__proto__:null,default:we});';
  return new ia(typeof Buffer < "u" ? "data:application/javascript;base64," + Buffer.from(t, "binary").toString("base64") : URL.createObjectURL(new Blob([t], { type: "application/javascript" })));
}
const na = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  create: ra
}, Symbol.toStringTag, { value: "Module" }));
export {
  un as enableGeoTIFFTileSource
};
