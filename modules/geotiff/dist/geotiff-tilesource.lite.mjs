var Zi = Object.defineProperty;
var zi = (t, e, A) => e in t ? Zi(t, e, { enumerable: !0, configurable: !0, writable: !0, value: A }) : t[e] = A;
var ue = (t, e, A) => zi(t, typeof e != "symbol" ? e + "" : e, A);
function X(t) {
  return (e, ...A) => $i(t, e, A);
}
function LA(t, e) {
  return X(
    jt(
      t,
      e
    ).get
  );
}
const {
  apply: $i,
  getOwnPropertyDescriptor: jt,
  getPrototypeOf: Ve,
  ownKeys: Ar
} = Reflect, {
  iterator: _A,
  toStringTag: er
} = Symbol, tr = Object, {
  create: je,
  defineProperty: ir
} = tr, rr = Array, nr = rr.prototype, Xt = nr[_A], or = X(Xt), Wt = ArrayBuffer, ar = Wt.prototype;
LA(ar, "byteLength");
const gt = typeof SharedArrayBuffer < "u" ? SharedArrayBuffer : null;
gt && LA(gt.prototype, "byteLength");
const Zt = Ve(Uint8Array);
Zt.from;
const z = Zt.prototype;
z[_A];
X(z.keys);
X(
  z.values
);
X(
  z.entries
);
X(z.set);
X(
  z.reverse
);
X(z.fill);
X(
  z.copyWithin
);
X(z.sort);
X(z.slice);
X(
  z.subarray
);
LA(
  z,
  "buffer"
);
LA(
  z,
  "byteOffset"
);
LA(
  z,
  "length"
);
LA(
  z,
  er
);
const sr = Uint8Array, zt = Uint16Array, Xe = Uint32Array, gr = Float32Array, YA = Ve([][_A]()), $t = X(YA.next), Ir = X(function* () {
}().next), Br = Ve(YA), lr = DataView.prototype, fr = X(
  lr.getUint16
), We = WeakMap, Ai = We.prototype, ei = X(Ai.get), Cr = X(Ai.set), ti = new We(), cr = je(null, {
  next: {
    value: function() {
      const e = ei(ti, this);
      return $t(e);
    }
  },
  [_A]: {
    value: function() {
      return this;
    }
  }
});
function Er(t) {
  if (t[_A] === Xt && YA.next === $t)
    return t;
  const e = je(cr);
  return Cr(ti, e, or(t)), e;
}
const Qr = new We(), hr = je(Br, {
  next: {
    value: function() {
      const e = ei(Qr, this);
      return Ir(e);
    },
    writable: !0,
    configurable: !0
  }
});
for (const t of Ar(YA))
  t !== "next" && ir(hr, t, jt(YA, t));
const ii = new Wt(4), ur = new gr(ii), dr = new Xe(ii), sA = new zt(512), gA = new sr(512);
for (let t = 0; t < 256; ++t) {
  const e = t - 127;
  e < -24 ? (sA[t] = 0, sA[t | 256] = 32768, gA[t] = 24, gA[t | 256] = 24) : e < -14 ? (sA[t] = 1024 >> -e - 14, sA[t | 256] = 1024 >> -e - 14 | 32768, gA[t] = -e - 1, gA[t | 256] = -e - 1) : e <= 15 ? (sA[t] = e + 15 << 10, sA[t | 256] = e + 15 << 10 | 32768, gA[t] = 13, gA[t | 256] = 13) : e < 128 ? (sA[t] = 31744, sA[t | 256] = 64512, gA[t] = 24, gA[t | 256] = 24) : (sA[t] = 31744, sA[t | 256] = 64512, gA[t] = 13, gA[t | 256] = 13);
}
const Ze = new Xe(2048);
for (let t = 1; t < 1024; ++t) {
  let e = t << 13, A = 0;
  for (; !(e & 8388608); )
    e <<= 1, A -= 8388608;
  e &= -8388609, A += 947912704, Ze[t] = e | A;
}
for (let t = 1024; t < 2048; ++t)
  Ze[t] = 939524096 + (t - 1024 << 13);
const MA = new Xe(64);
for (let t = 1; t < 31; ++t)
  MA[t] = t << 23;
MA[31] = 1199570944;
MA[32] = 2147483648;
for (let t = 33; t < 63; ++t)
  MA[t] = 2147483648 + (t - 32 << 23);
MA[63] = 3347054592;
const ri = new zt(64);
for (let t = 1; t < 64; ++t)
  t !== 32 && (ri[t] = 1024);
function wr(t) {
  const e = t >> 10;
  return dr[0] = Ze[ri[e] + (t & 1023)] + MA[e], ur[0];
}
function ni(t, e, ...A) {
  return wr(
    fr(t, e, ...Er(A))
  );
}
function ze(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var $e = { exports: {} };
function oi(t, e, A) {
  const i = A && A.debug || !1;
  i && console.log("[xml-utils] getting " + e + " in " + t);
  const o = typeof t == "object" ? t.outer : t, n = o.slice(0, o.indexOf(">") + 1), l = ['"', "'"];
  for (let g = 0; g < l.length; g++) {
    const w = l[g], a = e + "\\=" + w + "([^" + w + "]*)" + w;
    i && console.log("[xml-utils] pattern:", a);
    const I = new RegExp(a).exec(n);
    if (i && console.log("[xml-utils] match:", I), I) return I[1];
  }
}
$e.exports = oi;
$e.exports.default = oi;
var yr = $e.exports;
const de = /* @__PURE__ */ ze(yr);
var At = { exports: {} }, et = { exports: {} }, tt = { exports: {} };
function ai(t, e, A) {
  const o = new RegExp(e).exec(t.slice(A));
  return o ? A + o.index : -1;
}
tt.exports = ai;
tt.exports.default = ai;
var Dr = tt.exports, it = { exports: {} };
function si(t, e, A) {
  const o = new RegExp(e).exec(t.slice(A));
  return o ? A + o.index + o[0].length - 1 : -1;
}
it.exports = si;
it.exports.default = si;
var pr = it.exports, rt = { exports: {} };
function gi(t, e) {
  const A = new RegExp(e, "g"), i = t.match(A);
  return i ? i.length : 0;
}
rt.exports = gi;
rt.exports.default = gi;
var mr = rt.exports;
const kr = Dr, we = pr, It = mr;
function Ii(t, e, A) {
  const i = A && A.debug || !1, o = !(A && typeof A.nested === !1), n = A && A.startIndex || 0;
  i && console.log("[xml-utils] starting findTagByName with", e, " and ", A);
  const l = kr(t, `<${e}[ 
>/]`, n);
  if (i && console.log("[xml-utils] start:", l), l === -1) return;
  const g = t.slice(l + e.length);
  let w = we(g, "^[^<]*[ /]>", 0);
  const a = w !== -1 && g[w - 1] === "/";
  if (i && console.log("[xml-utils] selfClosing:", a), a === !1)
    if (o) {
      let B = 0, s = 1, E = 0;
      for (; (w = we(g, "[ /]" + e + ">", B)) !== -1; ) {
        const C = g.substring(B, w + 1);
        if (s += It(C, "<" + e + `[ 
	>]`), E += It(C, "</" + e + ">"), E >= s) break;
        B = w;
      }
    } else
      w = we(g, "[ /]" + e + ">", 0);
  const r = l + e.length + w + 1;
  if (i && console.log("[xml-utils] end:", r), r === -1) return;
  const I = t.slice(l, r);
  let c;
  return a ? c = null : c = I.slice(I.indexOf(">") + 1, I.lastIndexOf("<")), { inner: c, outer: I, start: l, end: r };
}
et.exports = Ii;
et.exports.default = Ii;
var Fr = et.exports;
const Sr = Fr;
function Bi(t, e, A) {
  const i = [], o = A && A.debug || !1, n = A && typeof A.nested == "boolean" ? A.nested : !0;
  let l = A && A.startIndex || 0, g;
  for (; g = Sr(t, e, { debug: o, startIndex: l }); )
    n ? l = g.start + 1 + e.length : l = g.end, i.push(g);
  return o && console.log("findTagsByName found", i.length, "tags"), i;
}
At.exports = Bi;
At.exports.default = Bi;
var Gr = At.exports;
const xr = /* @__PURE__ */ ze(Gr), DA = {
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
}, nA = {};
for (const t in DA)
  DA.hasOwnProperty(t) && (nA[DA[t]] = parseInt(t, 10));
const Be = {
  256: "SHORT",
  257: "SHORT",
  258: "SHORT",
  259: "SHORT",
  262: "SHORT",
  273: "LONG",
  274: "SHORT",
  277: "SHORT",
  278: "LONG",
  279: "LONG",
  282: "RATIONAL",
  283: "RATIONAL",
  284: "SHORT",
  286: "SHORT",
  287: "RATIONAL",
  296: "SHORT",
  297: "SHORT",
  305: "ASCII",
  306: "ASCII",
  338: "SHORT",
  339: "SHORT",
  513: "LONG",
  514: "LONG",
  1024: "SHORT",
  1025: "SHORT",
  2048: "SHORT",
  2049: "ASCII",
  3072: "SHORT",
  3073: "ASCII",
  33550: "DOUBLE",
  33922: "DOUBLE",
  34264: "DOUBLE",
  34665: "LONG",
  34735: "SHORT",
  34736: "DOUBLE",
  34737: "ASCII",
  42113: "ASCII"
}, li = [
  nA.BitsPerSample,
  nA.ExtraSamples,
  nA.SampleFormat,
  nA.StripByteCounts,
  nA.StripOffsets,
  nA.StripRowCounts,
  nA.TileByteCounts,
  nA.TileOffsets,
  nA.SubIFDs
], qA = {
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
}, Y = {};
for (const t in qA)
  qA.hasOwnProperty(t) && (Y[qA[t]] = parseInt(t, 10));
const W = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8,
  ICCLab: 9
}, fi = {
  Unspecified: 0,
  Assocalpha: 1,
  Unassalpha: 2
}, Ci = {
  Version: 0,
  AddCompression: 1
}, ge = {
  None: 0,
  Deflate: 1,
  Zstandard: 2
}, bA = {
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
}, ci = {};
for (const t in bA)
  bA.hasOwnProperty(t) && (ci[bA[t]] = parseInt(t, 10));
const br = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ExtraSamplesValues: fi,
  LercAddCompression: ge,
  LercParameters: Ci,
  arrayFields: li,
  fieldTagNames: DA,
  fieldTagTypes: Be,
  fieldTags: nA,
  fieldTypeNames: qA,
  fieldTypes: Y,
  geoKeyNames: bA,
  geoKeys: ci,
  photometricInterpretations: W
}, Symbol.toStringTag, { value: "Module" }));
function Ei(t, e) {
  const { width: A, height: i } = t, o = new Uint8Array(A * i * 3);
  let n;
  for (let l = 0, g = 0; l < t.length; ++l, g += 3)
    n = 256 - t[l] / e * 256, o[g] = n, o[g + 1] = n, o[g + 2] = n;
  return o;
}
function Qi(t, e) {
  const { width: A, height: i } = t, o = new Uint8Array(A * i * 3);
  let n;
  for (let l = 0, g = 0; l < t.length; ++l, g += 3)
    n = t[l] / e * 256, o[g] = n, o[g + 1] = n, o[g + 2] = n;
  return o;
}
function hi(t, e) {
  const { width: A, height: i } = t, o = new Uint8Array(A * i * 3), n = e.length / 3, l = e.length / 3 * 2;
  for (let g = 0, w = 0; g < t.length; ++g, w += 3) {
    const a = t[g];
    o[w] = e[a] / 65536 * 256, o[w + 1] = e[a + n] / 65536 * 256, o[w + 2] = e[a + l] / 65536 * 256;
  }
  return o;
}
function ui(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let o = 0, n = 0; o < t.length; o += 4, n += 3) {
    const l = t[o], g = t[o + 1], w = t[o + 2], a = t[o + 3];
    i[n] = 255 * ((255 - l) / 256) * ((255 - a) / 256), i[n + 1] = 255 * ((255 - g) / 256) * ((255 - a) / 256), i[n + 2] = 255 * ((255 - w) / 256) * ((255 - a) / 256);
  }
  return i;
}
function di(t) {
  const { width: e, height: A } = t, i = new Uint8ClampedArray(e * A * 3);
  for (let o = 0, n = 0; o < t.length; o += 3, n += 3) {
    const l = t[o], g = t[o + 1], w = t[o + 2];
    i[n] = l + 1.402 * (w - 128), i[n + 1] = l - 0.34414 * (g - 128) - 0.71414 * (w - 128), i[n + 2] = l + 1.772 * (g - 128);
  }
  return i;
}
const Rr = 0.95047, vr = 1, Ur = 1.08883;
function wi(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let o = 0, n = 0; o < t.length; o += 3, n += 3) {
    const l = t[o + 0], g = t[o + 1] << 24 >> 24, w = t[o + 2] << 24 >> 24;
    let a = (l + 16) / 116, r = g / 500 + a, I = a - w / 200, c, B, s;
    r = Rr * (r * r * r > 8856e-6 ? r * r * r : (r - 16 / 116) / 7.787), a = vr * (a * a * a > 8856e-6 ? a * a * a : (a - 16 / 116) / 7.787), I = Ur * (I * I * I > 8856e-6 ? I * I * I : (I - 16 / 116) / 7.787), c = r * 3.2406 + a * -1.5372 + I * -0.4986, B = r * -0.9689 + a * 1.8758 + I * 0.0415, s = r * 0.0557 + a * -0.204 + I * 1.057, c = c > 31308e-7 ? 1.055 * c ** (1 / 2.4) - 0.055 : 12.92 * c, B = B > 31308e-7 ? 1.055 * B ** (1 / 2.4) - 0.055 : 12.92 * B, s = s > 31308e-7 ? 1.055 * s ** (1 / 2.4) - 0.055 : 12.92 * s, i[n] = Math.max(0, Math.min(1, c)) * 255, i[n + 1] = Math.max(0, Math.min(1, B)) * 255, i[n + 2] = Math.max(0, Math.min(1, s)) * 255;
  }
  return i;
}
const Lr = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  fromBlackIsZero: Qi,
  fromCIELab: wi,
  fromCMYK: ui,
  fromPalette: hi,
  fromWhiteIsZero: Ei,
  fromYCbCr: di
}, Symbol.toStringTag, { value: "Module" })), yi = /* @__PURE__ */ new Map();
function EA(t, e) {
  Array.isArray(t) || (t = [t]), t.forEach((A) => yi.set(A, e));
}
async function nt(t) {
  const e = yi.get(t.Compression);
  if (!e)
    throw new Error(`Unknown compression method identifier: ${t.Compression}`);
  const A = await e();
  return new A(t);
}
EA([void 0, 1], () => Promise.resolve().then(() => io).then((t) => t.default));
EA(5, () => Promise.resolve().then(() => so).then((t) => t.default));
EA(6, () => {
  throw new Error("old style JPEG compression is not supported.");
});
EA(7, () => Promise.resolve().then(() => fo).then((t) => t.default));
EA([8, 32946], () => Promise.resolve().then(() => Ga).then((t) => t.default));
EA(32773, () => Promise.resolve().then(() => ba).then((t) => t.default));
EA(
  34887,
  () => Promise.resolve().then(() => Ma).then(async (t) => (await t.zstd.init(), t)).then((t) => t.default)
);
EA(50001, () => Promise.resolve().then(() => Ta).then((t) => t.default));
function fe(t, e, A, i = 1) {
  return new (Object.getPrototypeOf(t)).constructor(e * A * i);
}
function Mr(t, e, A, i, o) {
  const n = e / i, l = A / o;
  return t.map((g) => {
    const w = fe(g, i, o);
    for (let a = 0; a < o; ++a) {
      const r = Math.min(Math.round(l * a), A - 1);
      for (let I = 0; I < i; ++I) {
        const c = Math.min(Math.round(n * I), e - 1), B = g[r * e + c];
        w[a * i + I] = B;
      }
    }
    return w;
  });
}
function RA(t, e, A) {
  return (1 - A) * t + A * e;
}
function Nr(t, e, A, i, o) {
  const n = e / i, l = A / o;
  return t.map((g) => {
    const w = fe(g, i, o);
    for (let a = 0; a < o; ++a) {
      const r = l * a, I = Math.floor(r), c = Math.min(Math.ceil(r), A - 1);
      for (let B = 0; B < i; ++B) {
        const s = n * B, E = s % 1, C = Math.floor(s), h = Math.min(Math.ceil(s), e - 1), y = g[I * e + C], p = g[I * e + h], d = g[c * e + C], Q = g[c * e + h], f = RA(
          RA(y, p, E),
          RA(d, Q, E),
          r % 1
        );
        w[a * i + B] = f;
      }
    }
    return w;
  });
}
function Tr(t, e, A, i, o, n = "nearest") {
  switch (n.toLowerCase()) {
    case "nearest":
      return Mr(t, e, A, i, o);
    case "bilinear":
    case "linear":
      return Nr(t, e, A, i, o);
    default:
      throw new Error(`Unsupported resampling method: '${n}'`);
  }
}
function qr(t, e, A, i, o, n) {
  const l = e / i, g = A / o, w = fe(t, i, o, n);
  for (let a = 0; a < o; ++a) {
    const r = Math.min(Math.round(g * a), A - 1);
    for (let I = 0; I < i; ++I) {
      const c = Math.min(Math.round(l * I), e - 1);
      for (let B = 0; B < n; ++B) {
        const s = t[r * e * n + c * n + B];
        w[a * i * n + I * n + B] = s;
      }
    }
  }
  return w;
}
function Jr(t, e, A, i, o, n) {
  const l = e / i, g = A / o, w = fe(t, i, o, n);
  for (let a = 0; a < o; ++a) {
    const r = g * a, I = Math.floor(r), c = Math.min(Math.ceil(r), A - 1);
    for (let B = 0; B < i; ++B) {
      const s = l * B, E = s % 1, C = Math.floor(s), h = Math.min(Math.ceil(s), e - 1);
      for (let y = 0; y < n; ++y) {
        const p = t[I * e * n + C * n + y], d = t[I * e * n + h * n + y], Q = t[c * e * n + C * n + y], f = t[c * e * n + h * n + y], u = RA(
          RA(p, d, E),
          RA(Q, f, E),
          r % 1
        );
        w[a * i * n + B * n + y] = u;
      }
    }
  }
  return w;
}
function Hr(t, e, A, i, o, n, l = "nearest") {
  switch (l.toLowerCase()) {
    case "nearest":
      return qr(
        t,
        e,
        A,
        i,
        o,
        n
      );
    case "bilinear":
    case "linear":
      return Jr(
        t,
        e,
        A,
        i,
        o,
        n
      );
    default:
      throw new Error(`Unsupported resampling method: '${l}'`);
  }
}
function Yr(t, e, A) {
  let i = 0;
  for (let o = e; o < A; ++o)
    i += t[o];
  return i;
}
function Ue(t, e, A) {
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
function Or(t, e) {
  return (t === 1 || t === 2) && e <= 32 && e % 8 === 0 ? !1 : !(t === 3 && (e === 16 || e === 32 || e === 64));
}
function Kr(t, e, A, i, o, n, l) {
  const g = new DataView(t), w = A === 2 ? l * n : l * n * i, a = A === 2 ? 1 : i, r = Ue(e, o, w), I = parseInt("1".repeat(o), 2);
  if (e === 1) {
    let c;
    A === 1 ? c = i * o : c = o;
    let B = n * c;
    B & 7 && (B = B + 7 & -8);
    for (let s = 0; s < l; ++s) {
      const E = s * B;
      for (let C = 0; C < n; ++C) {
        const h = E + C * a * o;
        for (let y = 0; y < a; ++y) {
          const p = h + y * o, d = (s * n + C) * a + y, Q = Math.floor(p / 8), f = p % 8;
          if (f + o <= 8)
            r[d] = g.getUint8(Q) >> 8 - o - f & I;
          else if (f + o <= 16)
            r[d] = g.getUint16(Q) >> 16 - o - f & I;
          else if (f + o <= 24) {
            const u = g.getUint16(Q) << 8 | g.getUint8(Q + 2);
            r[d] = u >> 24 - o - f & I;
          } else
            r[d] = g.getUint32(Q) >> 32 - o - f & I;
        }
      }
    }
  }
  return r.buffer;
}
class ot {
  /**
   * @constructor
   * @param {Object} fileDirectory The parsed file directory
   * @param {Object} geoKeys The parsed geo-keys
   * @param {DataView} dataView The DataView for the underlying file.
   * @param {Boolean} littleEndian Whether the file is encoded in little or big endian
   * @param {Boolean} cache Whether or not decoded tiles shall be cached
   * @param {import('./source/basesource').BaseSource} source The datasource to read from
   */
  constructor(e, A, i, o, n, l) {
    this.fileDirectory = e, this.geoKeys = A, this.dataView = i, this.littleEndian = o, this.tiles = n ? {} : null, this.isTiled = !e.StripOffsets;
    const g = e.PlanarConfiguration;
    if (this.planarConfiguration = typeof g > "u" ? 1 : g, this.planarConfiguration !== 1 && this.planarConfiguration !== 2)
      throw new Error("Invalid planar configuration.");
    this.source = l;
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
            return function(o, n) {
              return ni(this, o, n);
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
    const i = this.getSampleFormat(e), o = this.getBitsPerSample(e);
    return Ue(i, o, A);
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
  async getTileOrStrip(e, A, i, o, n) {
    const l = Math.ceil(this.getWidth() / this.getTileWidth()), g = Math.ceil(this.getHeight() / this.getTileHeight());
    let w;
    const { tiles: a } = this;
    this.planarConfiguration === 1 ? w = A * l + e : this.planarConfiguration === 2 && (w = i * l * g + A * l + e);
    let r, I;
    this.isTiled ? (r = this.fileDirectory.TileOffsets[w], I = this.fileDirectory.TileByteCounts[w]) : (r = this.fileDirectory.StripOffsets[w], I = this.fileDirectory.StripByteCounts[w]);
    const c = (await this.source.fetch([{ offset: r, length: I }], n))[0];
    let B;
    return a === null || !a[w] ? (B = (async () => {
      let s = await o.decode(this.fileDirectory, c);
      const E = this.getSampleFormat(), C = this.getBitsPerSample();
      return Or(E, C) && (s = Kr(
        s,
        E,
        this.planarConfiguration,
        this.getSamplesPerPixel(),
        C,
        this.getTileWidth(),
        this.getBlockHeight(A)
      )), s;
    })(), a !== null && (a[w] = B)) : B = a[w], { x: e, y: A, sample: i, data: await B };
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
  async _readRaster(e, A, i, o, n, l, g, w, a) {
    const r = this.getTileWidth(), I = this.getTileHeight(), c = this.getWidth(), B = this.getHeight(), s = Math.max(Math.floor(e[0] / r), 0), E = Math.min(
      Math.ceil(e[2] / r),
      Math.ceil(c / r)
    ), C = Math.max(Math.floor(e[1] / I), 0), h = Math.min(
      Math.ceil(e[3] / I),
      Math.ceil(B / I)
    ), y = e[2] - e[0];
    let p = this.getBytesPerPixel();
    const d = [], Q = [];
    for (let D = 0; D < A.length; ++D)
      this.planarConfiguration === 1 ? d.push(Yr(this.fileDirectory.BitsPerSample, 0, A[D]) / 8) : d.push(0), Q.push(this.getReaderForSample(A[D]));
    const f = [], { littleEndian: u } = this;
    for (let D = C; D < h; ++D)
      for (let F = s; F < E; ++F) {
        let k;
        this.planarConfiguration === 1 && (k = this.getTileOrStrip(F, D, 0, n, a));
        for (let m = 0; m < A.length; ++m) {
          const x = m, v = A[m];
          this.planarConfiguration === 2 && (p = this.getSampleByteSize(v), k = this.getTileOrStrip(F, D, v, n, a));
          const N = k.then((S) => {
            const G = S.data, b = new DataView(G), U = this.getBlockHeight(S.y), R = S.y * I, L = S.x * r, M = R + U, q = (S.x + 1) * r, O = Q[x], T = Math.min(U, U - (M - e[3]), B - R), J = Math.min(r, r - (q - e[2]), c - L);
            for (let H = Math.max(0, e[1] - R); H < T; ++H)
              for (let K = Math.max(0, e[0] - L); K < J; ++K) {
                const _ = (H * r + K) * p, V = O.call(
                  b,
                  _ + d[x],
                  u
                );
                let j;
                o ? (j = (H + R - e[1]) * y * A.length + (K + L - e[0]) * A.length + x, i[j] = V) : (j = (H + R - e[1]) * y + K + L - e[0], i[x][j] = V);
              }
          });
          f.push(N);
        }
      }
    if (await Promise.all(f), l && e[2] - e[0] !== l || g && e[3] - e[1] !== g) {
      let D;
      return o ? D = Hr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        l,
        g,
        A.length,
        w
      ) : D = Tr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        l,
        g,
        w
      ), D.width = l, D.height = g, D;
    }
    return i.width = l || e[2] - e[0], i.height = g || e[3] - e[1], i;
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
    pool: o = null,
    width: n,
    height: l,
    resampleMethod: g,
    fillValue: w,
    signal: a
  } = {}) {
    const r = e || [0, 0, this.getWidth(), this.getHeight()];
    if (r[0] > r[2] || r[1] > r[3])
      throw new Error("Invalid subsets");
    const I = r[2] - r[0], c = r[3] - r[1], B = I * c, s = this.getSamplesPerPixel();
    if (!A || !A.length)
      for (let y = 0; y < s; ++y)
        A.push(y);
    else
      for (let y = 0; y < A.length; ++y)
        if (A[y] >= s)
          return Promise.reject(new RangeError(`Invalid sample index '${A[y]}'.`));
    let E;
    if (i) {
      const y = this.fileDirectory.SampleFormat ? Math.max.apply(null, this.fileDirectory.SampleFormat) : 1, p = Math.max.apply(null, this.fileDirectory.BitsPerSample);
      E = Ue(y, p, B * A.length), w && E.fill(w);
    } else {
      E = [];
      for (let y = 0; y < A.length; ++y) {
        const p = this.getArrayForSample(A[y], B);
        Array.isArray(w) && y < w.length ? p.fill(w[y]) : w && !Array.isArray(w) && p.fill(w), E.push(p);
      }
    }
    const C = o || await nt(this.fileDirectory);
    return await this._readRaster(
      r,
      A,
      E,
      i,
      C,
      n,
      l,
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
    width: o,
    height: n,
    resampleMethod: l,
    enableAlpha: g = !1,
    signal: w
  } = {}) {
    const a = e || [0, 0, this.getWidth(), this.getHeight()];
    if (a[0] > a[2] || a[1] > a[3])
      throw new Error("Invalid subsets");
    const r = this.fileDirectory.PhotometricInterpretation;
    if (r === W.RGB) {
      let h = [0, 1, 2];
      if (this.fileDirectory.ExtraSamples !== fi.Unspecified && g) {
        h = [];
        for (let y = 0; y < this.fileDirectory.BitsPerSample.length; y += 1)
          h.push(y);
      }
      return this.readRasters({
        window: e,
        interleave: A,
        samples: h,
        pool: i,
        width: o,
        height: n,
        resampleMethod: l,
        signal: w
      });
    }
    let I;
    switch (r) {
      case W.WhiteIsZero:
      case W.BlackIsZero:
      case W.Palette:
        I = [0];
        break;
      case W.CMYK:
        I = [0, 1, 2, 3];
        break;
      case W.YCbCr:
      case W.CIELab:
        I = [0, 1, 2];
        break;
      default:
        throw new Error("Invalid or unsupported photometric interpretation.");
    }
    const c = {
      window: a,
      interleave: !0,
      samples: I,
      pool: i,
      width: o,
      height: n,
      resampleMethod: l,
      signal: w
    }, { fileDirectory: B } = this, s = await this.readRasters(c), E = 2 ** this.fileDirectory.BitsPerSample[0];
    let C;
    switch (r) {
      case W.WhiteIsZero:
        C = Ei(s, E);
        break;
      case W.BlackIsZero:
        C = Qi(s, E);
        break;
      case W.Palette:
        C = hi(s, B.ColorMap);
        break;
      case W.CMYK:
        C = ui(s);
        break;
      case W.YCbCr:
        C = di(s);
        break;
      case W.CIELab:
        C = wi(s);
        break;
      default:
        throw new Error("Unsupported photometric interpretation.");
    }
    if (!A) {
      const h = new Uint8Array(C.length / 3), y = new Uint8Array(C.length / 3), p = new Uint8Array(C.length / 3);
      for (let d = 0, Q = 0; d < C.length; d += 3, ++Q)
        h[Q] = C[d], y[Q] = C[d + 1], p[Q] = C[d + 2];
      C = [h, y, p];
    }
    return C.width = s.width, C.height = s.height, C;
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
    let o = xr(i, "Item");
    e === null ? o = o.filter((n) => de(n, "sample") === void 0) : o = o.filter((n) => Number(de(n, "sample")) === e);
    for (let n = 0; n < o.length; ++n) {
      const l = o[n];
      A[de(l, "name")] = l.inner;
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
      const [o, n, l] = e.getResolution();
      return [
        o * e.getWidth() / this.getWidth(),
        n * e.getHeight() / this.getHeight(),
        l * e.getWidth() / this.getWidth()
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
      const [o, n, l, g, w, a, r, I] = this.fileDirectory.ModelTransformation, B = [
        [0, 0],
        [0, A],
        [i, 0],
        [i, A]
      ].map(([C, h]) => [
        g + o * C + n * h,
        I + w * C + a * h
      ]), s = B.map((C) => C[0]), E = B.map((C) => C[1]);
      return [
        Math.min(...s),
        Math.min(...E),
        Math.max(...s),
        Math.max(...E)
      ];
    } else {
      const o = this.getOrigin(), n = this.getResolution(), l = o[0], g = o[1], w = l + n[0] * i, a = g + n[1] * A;
      return [
        Math.min(l, w),
        Math.min(g, a),
        Math.max(l, w),
        Math.max(g, a)
      ];
    }
  }
}
class _r {
  constructor(e) {
    this._dataView = new DataView(e);
  }
  get buffer() {
    return this._dataView.buffer;
  }
  getUint64(e, A) {
    const i = this.getUint32(e, A), o = this.getUint32(e + 4, A);
    let n;
    if (A) {
      if (n = i + 2 ** 32 * o, !Number.isSafeInteger(n))
        throw new Error(
          `${n} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return n;
    }
    if (n = 2 ** 32 * i + o, !Number.isSafeInteger(n))
      throw new Error(
        `${n} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return n;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  getInt64(e, A) {
    let i = 0;
    const o = (this._dataView.getUint8(e + (A ? 7 : 0)) & 128) > 0;
    let n = !0;
    for (let l = 0; l < 8; l++) {
      let g = this._dataView.getUint8(e + (A ? l : 7 - l));
      o && (n ? g !== 0 && (g = ~(g - 1) & 255, n = !1) : g = ~g & 255), i += g * 256 ** l;
    }
    return o && (i = -i), i;
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
    return ni(this._dataView, e, A);
  }
  getFloat32(e, A) {
    return this._dataView.getFloat32(e, A);
  }
  getFloat64(e, A) {
    return this._dataView.getFloat64(e, A);
  }
}
class Pr {
  constructor(e, A, i, o) {
    this._dataView = new DataView(e), this._sliceOffset = A, this._littleEndian = i, this._bigTiff = o;
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
    let o;
    if (this._littleEndian) {
      if (o = A + 2 ** 32 * i, !Number.isSafeInteger(o))
        throw new Error(
          `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return o;
    }
    if (o = 2 ** 32 * A + i, !Number.isSafeInteger(o))
      throw new Error(
        `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return o;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  readInt64(e) {
    let A = 0;
    const i = (this._dataView.getUint8(e + (this._littleEndian ? 7 : 0)) & 128) > 0;
    let o = !0;
    for (let n = 0; n < 8; n++) {
      let l = this._dataView.getUint8(
        e + (this._littleEndian ? n : 7 - n)
      );
      i && (o ? l !== 0 && (l = ~(l - 1) & 255, o = !1) : l = ~l & 255), A += l * 256 ** n;
    }
    return i && (A = -A), A;
  }
  readOffset(e) {
    return this._bigTiff ? this.readUint64(e) : this.readUint32(e);
  }
}
const Vr = typeof navigator < "u" && navigator.hardwareConcurrency || 2;
class Di {
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
  constructor(e = Vr, A) {
    this.workers = null, this._awaitingDecoder = null, this.size = e, this.messageId = 0, e && (this._awaitingDecoder = A ? Promise.resolve(A) : new Promise((i) => {
      Promise.resolve().then(() => Ha).then((o) => {
        i(o.create);
      });
    }), this._awaitingDecoder.then((i) => {
      this._awaitingDecoder = null, this.workers = [];
      for (let o = 0; o < e; o++)
        this.workers.push({ worker: i(), idle: !0 });
    }));
  }
  /**
   * Decode the given block of bytes with the set compression method.
   * @param {ArrayBuffer} buffer the array buffer of bytes to decode.
   * @returns {Promise<ArrayBuffer>} the decoded result as a `Promise`
   */
  async decode(e, A) {
    return this._awaitingDecoder && await this._awaitingDecoder, this.size === 0 ? nt(e).then((i) => i.decode(e, A)) : new Promise((i) => {
      const o = this.workers.find((g) => g.idle) || this.workers[Math.floor(Math.random() * this.size)];
      o.idle = !1;
      const n = this.messageId++, l = (g) => {
        g.data.id === n && (o.idle = !0, i(g.data.decoded), o.worker.removeEventListener("message", l));
      };
      o.worker.addEventListener("message", l), o.worker.postMessage({ fileDirectory: e, buffer: A, id: n }, [A]);
    });
  }
  destroy() {
    this.workers && (this.workers.forEach((e) => {
      e.worker.terminate();
    }), this.workers = null);
  }
}
const Bt = `\r
\r
`;
function pi(t) {
  if (typeof Object.fromEntries < "u")
    return Object.fromEntries(t);
  const e = {};
  for (const [A, i] of t)
    e[A.toLowerCase()] = i;
  return e;
}
function jr(t) {
  const e = t.split(`\r
`).map((A) => {
    const i = A.split(":").map((o) => o.trim());
    return i[0] = i[0].toLowerCase(), i;
  });
  return pi(e);
}
function Xr(t) {
  const [e, ...A] = t.split(";").map((o) => o.trim()), i = A.map((o) => o.split("="));
  return { type: e, params: pi(i) };
}
function Le(t) {
  let e, A, i;
  return t && ([, e, A, i] = t.match(/bytes (\d+)-(\d+)\/(\d+)/), e = parseInt(e, 10), A = parseInt(A, 10), i = parseInt(i, 10)), { start: e, end: A, total: i };
}
function Wr(t, e) {
  let A = null;
  const i = new TextDecoder("ascii"), o = [], n = `--${e}`, l = `${n}--`;
  for (let g = 0; g < 10; ++g)
    i.decode(
      new Uint8Array(t, g, n.length)
    ) === n && (A = g);
  if (A === null)
    throw new Error("Could not find initial boundary");
  for (; A < t.byteLength; ) {
    const g = i.decode(
      new Uint8Array(
        t,
        A,
        Math.min(n.length + 1024, t.byteLength - A)
      )
    );
    if (g.length === 0 || g.startsWith(l))
      break;
    if (!g.startsWith(n))
      throw new Error("Part does not start with boundary");
    const w = g.substr(n.length + 2);
    if (w.length === 0)
      break;
    const a = w.indexOf(Bt), r = jr(w.substr(0, a)), { start: I, end: c, total: B } = Le(r["content-range"]), s = A + n.length + a + Bt.length, E = parseInt(c, 10) + 1 - parseInt(I, 10);
    o.push({
      headers: r,
      data: t.slice(s, s + E),
      offset: I,
      length: E,
      fileSize: B
    }), A = s + E + 4;
  }
  return o;
}
class PA {
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
class Zr extends Map {
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
    const o = typeof i == "number" && i !== Number.POSITIVE_INFINITY ? Date.now() + i : void 0;
    return this.cache.has(e) ? this.cache.set(e, {
      value: A,
      expiry: o
    }) : this._set(e, { value: A, expiry: o }), this;
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
      const i = e[A], [o, n] = i;
      this._deleteIfExpired(o, n) === !1 && (yield [o, n.value]);
    }
    e = [...this.oldCache];
    for (let A = e.length - 1; A >= 0; --A) {
      const i = e[A], [o, n] = i;
      this.cache.has(o) || this._deleteIfExpired(o, n) === !1 && (yield [o, n.value]);
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
    for (const [i, o] of this.entriesAscending())
      e.call(A, o, i, this);
  }
  get [Symbol.toStringTag]() {
    return JSON.stringify([...this.entriesAscending()]);
  }
}
function mi(t, e) {
  for (const A in e)
    e.hasOwnProperty(A) && (t[A] = e[A]);
}
function ki(t, e) {
  return t.length < e.length ? !1 : t.substr(t.length - e.length) === e;
}
function zr(t, e) {
  const { length: A } = t;
  for (let i = 0; i < A; i++)
    e(t[i], i);
}
function at(t) {
  const e = {};
  for (const A in t)
    if (t.hasOwnProperty(A)) {
      const i = t[A];
      e[i] = A;
    }
  return e;
}
function eA(t, e) {
  const A = [];
  for (let i = 0; i < t; i++)
    A.push(e(i));
  return A;
}
async function $r(t) {
  return new Promise((e) => setTimeout(e, t));
}
function An(t, e) {
  const A = Array.isArray(t) ? t : Array.from(t), i = Array.isArray(e) ? e : Array.from(e);
  return A.map((o, n) => [o, i[n]]);
}
class pA extends Error {
  constructor(e) {
    super(e), Error.captureStackTrace && Error.captureStackTrace(this, pA), this.name = "AbortError";
  }
}
class en extends Error {
  constructor(e, A) {
    super(A), this.errors = e, this.message = A, this.name = "AggregateError";
  }
}
const tn = en;
class rn {
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
class lt {
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
class nn extends PA {
  /**
   *
   * @param {BaseSource} source The underlying source that shall be blocked and cached
   * @param {object} options
   * @param {number} [options.blockSize]
   * @param {number} [options.cacheSize]
   */
  constructor(e, { blockSize: A = 65536, cacheSize: i = 100 } = {}) {
    super(), this.source = e, this.blockSize = A, this.blockCache = new Zr({
      maxSize: i,
      onEviction: (o, n) => {
        this.evictedBlocks.set(o, n);
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
    const i = [], o = [], n = [];
    this.evictedBlocks.clear();
    for (const { offset: c, length: B } of e) {
      let s = c + B;
      const { fileSize: E } = this;
      E !== null && (s = Math.min(s, E));
      const C = Math.floor(c / this.blockSize) * this.blockSize;
      for (let h = C; h < s; h += this.blockSize) {
        const y = Math.floor(h / this.blockSize);
        !this.blockCache.has(y) && !this.blockRequests.has(y) && (this.blockIdsToFetch.add(y), o.push(y)), this.blockRequests.has(y) && i.push(this.blockRequests.get(y)), n.push(y);
      }
    }
    await $r(), this.fetchBlocks(A);
    const l = [];
    for (const c of o)
      this.blockRequests.has(c) && l.push(this.blockRequests.get(c));
    await Promise.allSettled(i), await Promise.allSettled(l);
    const g = [], w = n.filter((c) => this.abortedBlockIds.has(c) || !this.blockCache.has(c));
    if (w.forEach((c) => this.blockIdsToFetch.add(c)), w.length > 0 && A && !A.aborted) {
      this.fetchBlocks(null);
      for (const c of w) {
        const B = this.blockRequests.get(c);
        if (!B)
          throw new Error(`Block ${c} is not in the block requests`);
        g.push(B);
      }
      await Promise.allSettled(g);
    }
    if (A && A.aborted)
      throw new pA("Request was aborted");
    const a = n.map((c) => this.blockCache.get(c) || this.evictedBlocks.get(c)), r = a.filter((c) => !c);
    if (r.length)
      throw new tn(r, "Request failed");
    const I = new Map(An(n, a));
    return this.readSliceData(e, I);
  }
  /**
   *
   * @param {AbortSignal} signal
   */
  fetchBlocks(e) {
    if (this.blockIdsToFetch.size > 0) {
      const A = this.groupBlocks(this.blockIdsToFetch), i = this.source.fetch(A, e);
      for (let o = 0; o < A.length; ++o) {
        const n = A[o];
        for (const l of n.blockIds)
          this.blockRequests.set(l, (async () => {
            try {
              const g = (await i)[o], w = l * this.blockSize, a = w - g.offset, r = Math.min(a + this.blockSize, g.data.byteLength), I = g.data.slice(a, r), c = new rn(
                w,
                I.byteLength,
                I,
                l
              );
              this.blockCache.set(l, c), this.abortedBlockIds.delete(l);
            } catch (g) {
              if (g.name === "AbortError")
                g.signal = e, this.blockCache.delete(l), this.abortedBlockIds.add(l);
              else
                throw g;
            } finally {
              this.blockRequests.delete(l);
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
    const A = Array.from(e).sort((l, g) => l - g);
    if (A.length === 0)
      return [];
    let i = [], o = null;
    const n = [];
    for (const l of A)
      o === null || o + 1 === l ? (i.push(l), o = l) : (n.push(new lt(
        i[0] * this.blockSize,
        i.length * this.blockSize,
        i
      )), i = [l], o = l);
    return n.push(new lt(
      i[0] * this.blockSize,
      i.length * this.blockSize,
      i
    )), n;
  }
  /**
   *
   * @param {import("./basesource").Slice[]} slices
   * @param {Map} blocks
   */
  readSliceData(e, A) {
    return e.map((i) => {
      let o = i.offset + i.length;
      this.fileSize !== null && (o = Math.min(this.fileSize, o));
      const n = Math.floor(i.offset / this.blockSize), l = Math.floor(o / this.blockSize), g = new ArrayBuffer(i.length), w = new Uint8Array(g);
      for (let a = n; a <= l; ++a) {
        const r = A.get(a), I = r.offset - i.offset, c = r.top - o;
        let B = 0, s = 0, E;
        I < 0 ? B = -I : I > 0 && (s = I), c < 0 ? E = r.length - B : E = o - r.offset - B;
        const C = new Uint8Array(r.data, B, E);
        w.set(C, s);
      }
      return g;
    });
  }
}
class VA {
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
class jA {
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
class on extends VA {
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
class an extends jA {
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
    return new on(i);
  }
}
class sn extends VA {
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
class gn extends jA {
  constructRequest(e, A) {
    return new Promise((i, o) => {
      const n = new XMLHttpRequest();
      n.open("GET", this.url), n.responseType = "arraybuffer";
      for (const [l, g] of Object.entries(e))
        n.setRequestHeader(l, g);
      n.onload = () => {
        const l = n.response;
        i(new sn(n, l));
      }, n.onerror = o, n.onabort = () => o(new pA("Request aborted")), n.send(), A && (A.aborted && n.abort(), A.addEventListener("abort", () => n.abort()));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
const vA = {};
class In extends VA {
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
class Bn extends jA {
  constructor(e) {
    super(e), this.parsedUrl = vA.parse(this.url), this.httpApi = (this.parsedUrl.protocol === "http:", vA);
  }
  constructRequest(e, A) {
    return new Promise((i, o) => {
      const n = this.httpApi.get(
        {
          ...this.parsedUrl,
          headers: e
        },
        (l) => {
          const g = new Promise((w) => {
            const a = [];
            l.on("data", (r) => {
              a.push(r);
            }), l.on("end", () => {
              const r = Buffer.concat(a).buffer;
              w(r);
            }), l.on("error", o);
          });
          i(new In(l, g));
        }
      );
      n.on("error", o), A && (A.aborted && n.destroy(new pA("Request aborted")), A.addEventListener("abort", () => n.destroy(new pA("Request aborted"))));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
class Ce extends PA {
  /**
   *
   * @param {BaseClient} client
   * @param {object} headers
   * @param {numbers} maxRanges
   * @param {boolean} allowFullFile
   */
  constructor(e, A, i, o) {
    super(), this.client = e, this.headers = A, this.maxRanges = i, this.allowFullFile = o, this._fileSize = null;
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
        Range: `bytes=${e.map(({ offset: o, length: n }) => `${o}-${o + n}`).join(",")}`
      },
      signal: A
    });
    if (i.ok)
      if (i.status === 206) {
        const { type: o, params: n } = Xr(i.getHeader("content-type"));
        if (o === "multipart/byteranges") {
          const I = Wr(await i.getData(), n.boundary);
          return this._fileSize = I[0].fileSize || null, I;
        }
        const l = await i.getData(), { start: g, end: w, total: a } = Le(i.getHeader("content-range"));
        this._fileSize = a || null;
        const r = [{
          data: l,
          offset: g,
          length: w - g
        }];
        if (e.length > 1) {
          const I = await Promise.all(e.slice(1).map((c) => this.fetchSlice(c, A)));
          return r.concat(I);
        }
        return r;
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const o = await i.getData();
        return this._fileSize = o.byteLength, [{
          data: o,
          offset: 0,
          length: o.byteLength
        }];
      }
    else throw new Error("Error fetching data.");
  }
  async fetchSlice(e, A) {
    const { offset: i, length: o } = e, n = await this.client.request({
      headers: {
        ...this.headers,
        Range: `bytes=${i}-${i + o}`
      },
      signal: A
    });
    if (n.ok)
      if (n.status === 206) {
        const l = await n.getData(), { total: g } = Le(n.getHeader("content-range"));
        return this._fileSize = g || null, {
          data: l,
          offset: i,
          length: o
        };
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const l = await n.getData();
        return this._fileSize = l.byteLength, {
          data: l,
          offset: 0,
          length: l.byteLength
        };
      }
    else throw new Error("Error fetching data.");
  }
  get fileSize() {
    return this._fileSize;
  }
}
function ce(t, { blockSize: e, cacheSize: A }) {
  return e === null ? t : new nn(t, { blockSize: e, cacheSize: A });
}
function ln(t, { headers: e = {}, credentials: A, maxRanges: i = 0, allowFullFile: o = !1, ...n } = {}) {
  const l = new an(t, A), g = new Ce(l, e, i, o);
  return ce(g, n);
}
function fn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...o } = {}) {
  const n = new gn(t), l = new Ce(n, e, A, i);
  return ce(l, o);
}
function Cn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...o } = {}) {
  const n = new Bn(t), l = new Ce(n, e, A, i);
  return ce(l, o);
}
function cn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...o } = {}) {
  const n = new Ce(t, e, A, i);
  return ce(n, o);
}
function Me(t, { forceXHR: e = !1, ...A } = {}) {
  return typeof fetch == "function" && !e ? ln(t, A) : typeof XMLHttpRequest < "u" ? fn(t, A) : Cn(t, A);
}
class En extends PA {
  constructor(e) {
    super(), this.arrayBuffer = e;
  }
  fetchSlice(e, A) {
    if (A && A.aborted)
      throw new pA("Request aborted");
    return this.arrayBuffer.slice(e.offset, e.offset + e.length);
  }
}
function Qn(t) {
  return new En(t);
}
class hn extends PA {
  constructor(e) {
    super(), this.file = e;
  }
  async fetchSlice(e, A) {
    return new Promise((i, o) => {
      const n = this.file.slice(e.offset, e.offset + e.length), l = new FileReader();
      l.onload = (g) => i(g.target.result), l.onerror = o, l.onabort = o, l.readAsArrayBuffer(n), A && A.addEventListener("abort", () => l.abort());
    });
  }
}
function un(t) {
  return new hn(t);
}
function dn(t) {
  return new Promise((e, A) => {
    vA.close(t, (i) => {
      i ? A(i) : e();
    });
  });
}
function wn(t, e, A = void 0) {
  return new Promise((i, o) => {
    vA.open(t, e, A, (n, l) => {
      n ? o(n) : i(l);
    });
  });
}
function yn(...t) {
  return new Promise((e, A) => {
    vA.read(...t, (i, o, n) => {
      i ? A(i) : e({ bytesRead: o, buffer: n });
    });
  });
}
class Dn extends PA {
  constructor(e) {
    super(), this.path = e, this.openRequest = wn(e, "r");
  }
  async fetchSlice(e) {
    const A = await this.openRequest, { buffer: i } = await yn(
      A,
      Buffer.alloc(e.length),
      0,
      e.length,
      e.offset
    );
    return i.buffer;
  }
  async close() {
    const e = await this.openRequest;
    await dn(e);
  }
}
function pn(t) {
  return new Dn(t);
}
const mn = at(DA), kn = at(bA), BA = {};
mi(BA, mn);
mi(BA, kn);
const Fn = at(qA), Ie = 1e3, Z = {
  nextZero: (t, e) => {
    let A = e;
    for (; t[A] !== 0; )
      A++;
    return A;
  },
  readUshort: (t, e) => t[e] << 8 | t[e + 1],
  readShort: (t, e) => {
    const A = Z.ui8;
    return A[0] = t[e + 1], A[1] = t[e + 0], Z.i16[0];
  },
  readInt: (t, e) => {
    const A = Z.ui8;
    return A[0] = t[e + 3], A[1] = t[e + 2], A[2] = t[e + 1], A[3] = t[e + 0], Z.i32[0];
  },
  readUint: (t, e) => {
    const A = Z.ui8;
    return A[0] = t[e + 3], A[1] = t[e + 2], A[2] = t[e + 1], A[3] = t[e + 0], Z.ui32[0];
  },
  readASCII: (t, e, A) => A.map((i) => String.fromCharCode(t[e + i])).join(""),
  readFloat: (t, e) => {
    const A = Z.ui8;
    return eA(4, (i) => {
      A[i] = t[e + 3 - i];
    }), Z.fl32[0];
  },
  readDouble: (t, e) => {
    const A = Z.ui8;
    return eA(8, (i) => {
      A[i] = t[e + 7 - i];
    }), Z.fl64[0];
  },
  writeUshort: (t, e, A) => {
    t[e] = A >> 8 & 255, t[e + 1] = A & 255;
  },
  writeUint: (t, e, A) => {
    t[e] = A >> 24 & 255, t[e + 1] = A >> 16 & 255, t[e + 2] = A >> 8 & 255, t[e + 3] = A >> 0 & 255;
  },
  writeASCII: (t, e, A) => {
    eA(A.length, (i) => {
      t[e + i] = A.charCodeAt(i);
    });
  },
  ui8: new Uint8Array(8)
};
Z.fl64 = new Float64Array(Z.ui8.buffer);
Z.writeDouble = (t, e, A) => {
  Z.fl64[0] = A, eA(8, (i) => {
    t[e + i] = Z.ui8[7 - i];
  });
};
const Sn = (t, e, A, i) => {
  let o = A;
  const n = Object.keys(i).filter((g) => g != null && g !== "undefined");
  t.writeUshort(e, o, n.length), o += 2;
  let l = o + 12 * n.length + 4;
  for (const g of n) {
    let w = null;
    typeof g == "number" ? w = g : typeof g == "string" && (w = parseInt(g, 10));
    const a = Be[w], r = Fn[a];
    if (a == null || a === void 0 || typeof a > "u")
      throw new Error(`unknown type of tag: ${w}`);
    let I = i[g];
    if (I === void 0)
      throw new Error(`failed to get value for key ${g}`);
    a === "ASCII" && typeof I == "string" && ki(I, "\0") === !1 && (I += "\0");
    const c = I.length;
    t.writeUshort(e, o, w), o += 2, t.writeUshort(e, o, r), o += 2, t.writeUint(e, o, c), o += 4;
    let B = [-1, 1, 1, 2, 4, 8, 0, 0, 0, 0, 0, 0, 8][r] * c, s = o;
    B > 4 && (t.writeUint(e, o, l), s = l), a === "ASCII" ? t.writeASCII(e, s, I) : a === "SHORT" ? eA(c, (E) => {
      t.writeUshort(e, s + 2 * E, I[E]);
    }) : a === "LONG" ? eA(c, (E) => {
      t.writeUint(e, s + 4 * E, I[E]);
    }) : a === "RATIONAL" ? eA(c, (E) => {
      t.writeUint(e, s + 8 * E, Math.round(I[E] * 1e4)), t.writeUint(e, s + 8 * E + 4, 1e4);
    }) : a === "DOUBLE" && eA(c, (E) => {
      t.writeDouble(e, s + 8 * E, I[E]);
    }), B > 4 && (B += B & 1, l += B), o += 4;
  }
  return [o, l];
}, Gn = (t) => {
  const e = new Uint8Array(Ie);
  let A = 4;
  const i = Z;
  e[0] = 77, e[1] = 77, e[3] = 42;
  let o = 8;
  if (i.writeUint(e, A, o), A += 4, t.forEach((l, g) => {
    const w = Sn(i, e, o, l);
    o = w[1], g < t.length - 1 && i.writeUint(e, w[0], o);
  }), e.slice)
    return e.slice(0, o).buffer;
  const n = new Uint8Array(o);
  for (let l = 0; l < o; l++)
    n[l] = e[l];
  return n.buffer;
}, xn = (t, e, A, i) => {
  if (A == null)
    throw new Error(`you passed into encodeImage a width of type ${A}`);
  if (e == null)
    throw new Error(`you passed into encodeImage a width of type ${e}`);
  const o = {
    256: [e],
    // ImageWidth
    257: [A],
    // ImageLength
    273: [Ie],
    // strips offset
    278: [A],
    // RowsPerStrip
    305: "geotiff.js"
    // no array for ASCII(Z)
  };
  if (i)
    for (const a in i)
      i.hasOwnProperty(a) && (o[a] = i[a]);
  const n = new Uint8Array(Gn([o])), l = new Uint8Array(t), g = o[277], w = new Uint8Array(Ie + e * A * g);
  return eA(n.length, (a) => {
    w[a] = n[a];
  }), zr(l, (a, r) => {
    w[Ie + r] = a;
  }), w.buffer;
}, bn = (t) => {
  const e = {};
  for (const A in t)
    A !== "StripOffsets" && (BA[A] || console.error(A, "not in name2code:", Object.keys(BA)), e[BA[A]] = t[A]);
  return e;
}, Rn = (t) => Array.isArray(t) ? t : [t], vn = [
  ["Compression", 1],
  // no compression
  ["PlanarConfiguration", 1],
  ["ExtraSamples", 0]
];
function Un(t, e) {
  const A = typeof t[0] == "number";
  let i, o, n, l;
  A ? (i = e.height || e.ImageLength, n = e.width || e.ImageWidth, o = t.length / (i * n), l = t) : (o = t.length, i = t[0].length, n = t[0][0].length, l = [], eA(i, (r) => {
    eA(n, (I) => {
      eA(o, (c) => {
        l.push(t[c][r][I]);
      });
    });
  })), e.ImageLength = i, delete e.height, e.ImageWidth = n, delete e.width, e.BitsPerSample || (e.BitsPerSample = eA(o, () => 8)), vn.forEach((r) => {
    const I = r[0];
    if (!e[I]) {
      const c = r[1];
      e[I] = c;
    }
  }), e.PhotometricInterpretation || (e.PhotometricInterpretation = e.BitsPerSample.length === 3 ? 2 : 1), e.SamplesPerPixel || (e.SamplesPerPixel = [o]), e.StripByteCounts || (e.StripByteCounts = [o * i * n]), e.ModelPixelScale || (e.ModelPixelScale = [360 / n, 180 / i, 0]), e.SampleFormat || (e.SampleFormat = eA(o, () => 1)), !e.hasOwnProperty("GeographicTypeGeoKey") && !e.hasOwnProperty("ProjectedCSTypeGeoKey") && (e.GeographicTypeGeoKey = 4326, e.ModelTiepoint = [0, 0, 0, -180, 90, 0], e.GeogCitationGeoKey = "WGS 84", e.GTModelTypeGeoKey = 2);
  const g = Object.keys(e).filter((r) => ki(r, "GeoKey")).sort((r, I) => BA[r] - BA[I]);
  if (!e.GeoAsciiParams) {
    let r = "";
    g.forEach((I) => {
      const c = Number(BA[I]);
      Be[c] === "ASCII" && (r += `${e[I].toString()}\0`);
    }), r.length > 0 && (e.GeoAsciiParams = r);
  }
  if (!e.GeoKeyDirectory) {
    const I = [1, 1, 0, g.length];
    g.forEach((c) => {
      const B = Number(BA[c]);
      I.push(B);
      let s, E, C;
      Be[B] === "SHORT" ? (s = 1, E = 0, C = e[c]) : c === "GeogCitationGeoKey" ? (s = e.GeoAsciiParams.length, E = Number(BA.GeoAsciiParams), C = 0) : console.log(`[geotiff.js] couldn't get TIFFTagLocation for ${c}`), I.push(E), I.push(s), I.push(C);
    }), e.GeoKeyDirectory = I;
  }
  for (const r of g)
    e.hasOwnProperty(r) && delete e[r];
  [
    "Compression",
    "ExtraSamples",
    "GeographicTypeGeoKey",
    "GTModelTypeGeoKey",
    "GTRasterTypeGeoKey",
    "ImageLength",
    // synonym of ImageHeight
    "ImageWidth",
    "Orientation",
    "PhotometricInterpretation",
    "ProjectedCSTypeGeoKey",
    "PlanarConfiguration",
    "ResolutionUnit",
    "SamplesPerPixel",
    "XPosition",
    "YPosition",
    "RowsPerStrip"
  ].forEach((r) => {
    e[r] && (e[r] = Rn(e[r]));
  });
  const w = bn(e);
  return xn(l, n, i, w);
}
class Ln {
  log() {
  }
  debug() {
  }
  info() {
  }
  warn() {
  }
  error() {
  }
  time() {
  }
  timeEnd() {
  }
}
function Mn(t = new Ln()) {
}
function Nn(t, e) {
  let A = t.length - e, i = 0;
  do {
    for (let o = e; o > 0; o--)
      t[i + e] += t[i], i++;
    A -= e;
  } while (A > 0);
}
function Tn(t, e, A) {
  let i = 0, o = t.length;
  const n = o / A;
  for (; o > e; ) {
    for (let g = e; g > 0; --g)
      t[i + e] += t[i], ++i;
    o -= e;
  }
  const l = t.slice();
  for (let g = 0; g < n; ++g)
    for (let w = 0; w < A; ++w)
      t[A * g + w] = l[(A - w - 1) * n + g];
}
function qn(t, e, A, i, o, n) {
  if (e === 1)
    return t;
  for (let w = 0; w < o.length; ++w) {
    if (o[w] % 8 !== 0)
      throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");
    if (o[w] !== o[0])
      throw new Error("When decoding with predictor, all samples must have the same size.");
  }
  const l = o[0] / 8, g = n === 2 ? 1 : o.length;
  for (let w = 0; w < i && !(w * g * A * l >= t.byteLength); ++w) {
    let a;
    if (e === 2) {
      switch (o[0]) {
        case 8:
          a = new Uint8Array(
            t,
            w * g * A * l,
            g * A * l
          );
          break;
        case 16:
          a = new Uint16Array(
            t,
            w * g * A * l,
            g * A * l / 2
          );
          break;
        case 32:
          a = new Uint32Array(
            t,
            w * g * A * l,
            g * A * l / 4
          );
          break;
        default:
          throw new Error(`Predictor 2 not allowed with ${o[0]} bits per sample.`);
      }
      Nn(a, g);
    } else e === 3 && (a = new Uint8Array(
      t,
      w * g * A * l,
      g * A * l
    ), Tn(a, g, l));
  }
  return t;
}
class dA {
  async decode(e, A) {
    const i = await this.decodeBlock(A), o = e.Predictor || 1;
    if (o !== 1) {
      const n = !e.StripOffsets, l = n ? e.TileWidth : e.ImageWidth, g = n ? e.TileLength : e.RowsPerStrip || e.ImageLength;
      return qn(
        i,
        o,
        l,
        g,
        e.BitsPerSample,
        e.PlanarConfiguration
      );
    }
    return i;
  }
}
function Ne(t) {
  switch (t) {
    case Y.BYTE:
    case Y.ASCII:
    case Y.SBYTE:
    case Y.UNDEFINED:
      return 1;
    case Y.SHORT:
    case Y.SSHORT:
      return 2;
    case Y.LONG:
    case Y.SLONG:
    case Y.FLOAT:
    case Y.IFD:
      return 4;
    case Y.RATIONAL:
    case Y.SRATIONAL:
    case Y.DOUBLE:
    case Y.LONG8:
    case Y.SLONG8:
    case Y.IFD8:
      return 8;
    default:
      throw new RangeError(`Invalid field type: ${t}`);
  }
}
function Jn(t) {
  const e = t.GeoKeyDirectory;
  if (!e)
    return null;
  const A = {};
  for (let i = 4; i <= e[3] * 4; i += 4) {
    const o = bA[e[i]], n = e[i + 1] ? DA[e[i + 1]] : null, l = e[i + 2], g = e[i + 3];
    let w = null;
    if (!n)
      w = g;
    else {
      if (w = t[n], typeof w > "u" || w === null)
        throw new Error(`Could not get value of geoKey '${o}'.`);
      typeof w == "string" ? w = w.substring(g, g + l - 1) : w.subarray && (w = w.subarray(g, g + l), l === 1 && (w = w[0]));
    }
    A[o] = w;
  }
  return A;
}
function FA(t, e, A, i) {
  let o = null, n = null;
  const l = Ne(e);
  switch (e) {
    case Y.BYTE:
    case Y.ASCII:
    case Y.UNDEFINED:
      o = new Uint8Array(A), n = t.readUint8;
      break;
    case Y.SBYTE:
      o = new Int8Array(A), n = t.readInt8;
      break;
    case Y.SHORT:
      o = new Uint16Array(A), n = t.readUint16;
      break;
    case Y.SSHORT:
      o = new Int16Array(A), n = t.readInt16;
      break;
    case Y.LONG:
    case Y.IFD:
      o = new Uint32Array(A), n = t.readUint32;
      break;
    case Y.SLONG:
      o = new Int32Array(A), n = t.readInt32;
      break;
    case Y.LONG8:
    case Y.IFD8:
      o = new Array(A), n = t.readUint64;
      break;
    case Y.SLONG8:
      o = new Array(A), n = t.readInt64;
      break;
    case Y.RATIONAL:
      o = new Uint32Array(A * 2), n = t.readUint32;
      break;
    case Y.SRATIONAL:
      o = new Int32Array(A * 2), n = t.readInt32;
      break;
    case Y.FLOAT:
      o = new Float32Array(A), n = t.readFloat32;
      break;
    case Y.DOUBLE:
      o = new Float64Array(A), n = t.readFloat64;
      break;
    default:
      throw new RangeError(`Invalid field type: ${e}`);
  }
  if (e === Y.RATIONAL || e === Y.SRATIONAL)
    for (let g = 0; g < A; g += 2)
      o[g] = n.call(
        t,
        i + g * l
      ), o[g + 1] = n.call(
        t,
        i + (g * l + 4)
      );
  else
    for (let g = 0; g < A; ++g)
      o[g] = n.call(
        t,
        i + g * l
      );
  return e === Y.ASCII ? new TextDecoder("utf-8").decode(o) : o;
}
class Hn {
  constructor(e, A, i) {
    this.fileDirectory = e, this.geoKeyDirectory = A, this.nextIFDByteOffset = i;
  }
}
class WA extends Error {
  constructor(e) {
    super(`No image at index ${e}`), this.index = e;
  }
}
class Fi {
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
    const { window: A, width: i, height: o } = e;
    let { resX: n, resY: l, bbox: g } = e;
    const w = await this.getImage();
    let a = w;
    const r = await this.getImageCount(), I = w.getBoundingBox();
    if (A && g)
      throw new Error('Both "bbox" and "window" passed.');
    if (i || o) {
      if (A) {
        const [s, E] = w.getOrigin(), [C, h] = w.getResolution();
        g = [
          s + A[0] * C,
          E + A[1] * h,
          s + A[2] * C,
          E + A[3] * h
        ];
      }
      const B = g || I;
      if (i) {
        if (n)
          throw new Error("Both width and resX passed");
        n = (B[2] - B[0]) / i;
      }
      if (o) {
        if (l)
          throw new Error("Both width and resY passed");
        l = (B[3] - B[1]) / o;
      }
    }
    if (n || l) {
      const B = [];
      for (let s = 0; s < r; ++s) {
        const E = await this.getImage(s), { SubfileType: C, NewSubfileType: h } = E.fileDirectory;
        (s === 0 || C === 2 || h & 1) && B.push(E);
      }
      B.sort((s, E) => s.getWidth() - E.getWidth());
      for (let s = 0; s < B.length; ++s) {
        const E = B[s], C = (I[2] - I[0]) / E.getWidth(), h = (I[3] - I[1]) / E.getHeight();
        if (a = E, n && n > C || l && l > h)
          break;
      }
    }
    let c = A;
    if (g) {
      const [B, s] = w.getOrigin(), [E, C] = a.getResolution(w);
      c = [
        Math.round((g[0] - B) / E),
        Math.round((g[1] - s) / C),
        Math.round((g[2] - B) / E),
        Math.round((g[3] - s) / C)
      ], c = [
        Math.min(c[0], c[2]),
        Math.min(c[1], c[3]),
        Math.max(c[0], c[2]),
        Math.max(c[1], c[3])
      ];
    }
    return a.readRasters({ ...e, window: c });
  }
}
class oA extends Fi {
  /**
   * @constructor
   * @param {*} source The datasource to read from.
   * @param {boolean} littleEndian Whether the image uses little endian.
   * @param {boolean} bigTiff Whether the image uses bigTIFF conventions.
   * @param {number} firstIFDOffset The numeric byte-offset from the start of the image
   *                                to the first IFD.
   * @param {GeoTIFFOptions} [options] further options.
   */
  constructor(e, A, i, o, n = {}) {
    super(), this.source = e, this.littleEndian = A, this.bigTiff = i, this.firstIFDOffset = o, this.cache = n.cache || !1, this.ifdRequests = [], this.ghostValues = null;
  }
  async getSlice(e, A) {
    const i = this.bigTiff ? 4048 : 1024;
    return new Pr(
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
    let o = await this.getSlice(e);
    const n = this.bigTiff ? o.readUint64(e) : o.readUint16(e), l = n * A + (this.bigTiff ? 16 : 6);
    o.covers(e, l) || (o = await this.getSlice(e, l));
    const g = {};
    let w = e + (this.bigTiff ? 8 : 2);
    for (let I = 0; I < n; w += A, ++I) {
      const c = o.readUint16(w), B = o.readUint16(w + 2), s = this.bigTiff ? o.readUint64(w + 4) : o.readUint32(w + 4);
      let E, C;
      const h = Ne(B), y = w + (this.bigTiff ? 12 : 8);
      if (h * s <= (this.bigTiff ? 8 : 4))
        E = FA(o, B, s, y);
      else {
        const p = o.readOffset(y), d = Ne(B) * s;
        if (o.covers(p, d))
          E = FA(o, B, s, p);
        else {
          const Q = await this.getSlice(p, d);
          E = FA(Q, B, s, p);
        }
      }
      s === 1 && li.indexOf(c) === -1 && !(B === Y.RATIONAL || B === Y.SRATIONAL) ? C = E[0] : C = E, g[DA[c]] = C;
    }
    const a = Jn(g), r = o.readOffset(
      e + i + A * n
    );
    return new Hn(
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
        throw A instanceof WA ? new WA(e) : A;
      }
    return this.ifdRequests[e] = (async () => {
      const A = await this.ifdRequests[e - 1];
      if (A.nextIFDByteOffset === 0)
        throw new WA(e);
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
    return new ot(
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
        if (i instanceof WA)
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
    let o = await this.getSlice(e, i);
    if (A === FA(o, Y.ASCII, A.length, e)) {
      const l = FA(o, Y.ASCII, i, e).split(`
`)[0], g = Number(l.split("=")[1].split(" ")[0]) + l.length;
      g > i && (o = await this.getSlice(e, g));
      const w = FA(o, Y.ASCII, g, e);
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
    const o = (await e.fetch([{ offset: 0, length: 1024 }], i))[0], n = new _r(o), l = n.getUint16(0, 0);
    let g;
    if (l === 18761)
      g = !0;
    else if (l === 19789)
      g = !1;
    else
      throw new TypeError("Invalid byte order value.");
    const w = n.getUint16(2, g);
    let a;
    if (w === 42)
      a = !1;
    else if (w === 43) {
      if (a = !0, n.getUint16(4, g) !== 8)
        throw new Error("Unsupported offset byte-size.");
    } else
      throw new TypeError("Invalid magic number.");
    const r = a ? n.getUint64(8, g) : n.getUint32(4, g);
    return new oA(e, g, a, r, A);
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
class Si extends Fi {
  /**
   * Construct a new MultiGeoTIFF from a main and several overview files.
   * @param {GeoTIFF} mainFile The main GeoTIFF file.
   * @param {GeoTIFF[]} overviewFiles An array of overview files.
   */
  constructor(e, A) {
    super(), this.mainFile = e, this.overviewFiles = A, this.imageFiles = [e].concat(A), this.fileDirectoriesPerFile = null, this.fileDirectoriesPerFileParsing = null, this.imageCount = null;
  }
  async parseFileDirectoriesPerFile() {
    const e = [this.mainFile.parseFileDirectoryAt(this.mainFile.firstIFDOffset)].concat(this.overviewFiles.map((A) => A.parseFileDirectoryAt(A.firstIFDOffset)));
    return this.fileDirectoriesPerFile = await Promise.all(e), this.fileDirectoriesPerFile;
  }
  /**
   * Get the n-th internal subfile of an image. By default, the first is returned.
   *
   * @param {number} [index=0] the index of the image to return.
   * @returns {Promise<GeoTIFFImage>} the image at the given index
   */
  async getImage(e = 0) {
    await this.getImageCount(), await this.parseFileDirectoriesPerFile();
    let A = 0, i = 0;
    for (let o = 0; o < this.imageFiles.length; o++) {
      const n = this.imageFiles[o];
      for (let l = 0; l < this.imageCounts[o]; l++) {
        if (e === A) {
          const g = await n.requestIFD(i);
          return new ot(
            g.fileDirectory,
            g.geoKeyDirectory,
            n.dataView,
            n.littleEndian,
            n.cache,
            n.source
          );
        }
        A++, i++;
      }
      i = 0;
    }
    throw new RangeError("Invalid image index");
  }
  /**
   * Returns the count of the internal subfiles.
   *
   * @returns {Promise<number>} the number of internal subfile images
   */
  async getImageCount() {
    if (this.imageCount !== null)
      return this.imageCount;
    const e = [this.mainFile.getImageCount()].concat(this.overviewFiles.map((A) => A.getImageCount()));
    return this.imageCounts = await Promise.all(e), this.imageCount = this.imageCounts.reduce((A, i) => A + i, 0), this.imageCount;
  }
}
async function Te(t, e = {}, A) {
  return oA.fromSource(Me(t, e), A);
}
async function Gi(t, e = {}, A) {
  return oA.fromSource(cn(t, e), A);
}
async function qe(t, e) {
  return oA.fromSource(Qn(t), e);
}
async function Yn(t, e) {
  return oA.fromSource(pn(t), e);
}
async function UA(t, e) {
  return oA.fromSource(un(t), e);
}
async function On(t, e = [], A = {}, i) {
  const o = await oA.fromSource(Me(t, A), i), n = await Promise.all(
    e.map((l) => oA.fromSource(Me(l, A)))
  );
  return new Si(o, n);
}
function Kn(t, e) {
  return Un(t, e);
}
const _n = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BaseClient: jA,
  BaseDecoder: dA,
  BaseResponse: VA,
  GeoTIFF: oA,
  GeoTIFFImage: ot,
  MultiGeoTIFF: Si,
  Pool: Di,
  addDecoder: EA,
  default: oA,
  fromArrayBuffer: qe,
  fromBlob: UA,
  fromCustomClient: Gi,
  fromFile: Yn,
  fromUrl: Te,
  fromUrls: On,
  getDecoder: nt,
  globals: br,
  rgb: Lr,
  setLogger: Mn,
  writeArrayBuffer: Kn
}, Symbol.toStringTag, { value: "Module" }));
class ye {
  constructor() {
    this.promise = new Promise((e, A) => {
      this.reject = A, this.resolve = e;
    });
  }
}
const ft = {};
function CA(t, e, A = "warn") {
  ft[t] || (ft[t] = !0, console[A](e));
}
const Pn = (t) => {
  var A, i, o;
  const e = /* @__PURE__ */ new Map();
  for (const n of t) {
    const l = new DOMParser().parseFromString(
      (A = n.fileDirectory) == null ? void 0 : A.ImageDescription,
      "text/xml"
    ), g = (i = l == null ? void 0 : l.querySelector("Name")) == null ? void 0 : i.textContent, w = (o = l == null ? void 0 : l.querySelector("Color")) == null ? void 0 : o.textContent;
    if (!g)
      continue;
    const a = w ? w.split(",").map((r) => parseInt(r)) : [255, 255, 255];
    e.has(g) || e.set(g, {
      name: g,
      color: a,
      images: []
    }), e.get(g).images.push(n);
  }
  return e;
};
class uA {
  static RGBAfromYCbCr(...e) {
    let A, i, o;
    if (e.length === 1) {
      const g = e[0], w = new Uint8ClampedArray(g.length * 4 / 3);
      for (let a = 0, r = 0; a < g.length; a += 3, r += 4)
        A = g[a], i = g[a + 1], o = g[a + 2], w[r] = A + 1.402 * (o - 128), w[r + 1] = A - 0.34414 * (i - 128) - 0.71414 * (o - 128), w[r + 2] = A + 1.772 * (i - 128), w[r + 3] = 255;
      return w;
    }
    [A, i, o] = e;
    const n = A.length, l = new Uint8ClampedArray(n * 4);
    for (let g = 0, w = 0; g < n; g++, w += 4) {
      const a = A[g], r = i[g], I = o[g];
      l[w] = a + 1.402 * (I - 128), l[w + 1] = a - 0.34414 * (r - 128) - 0.71414 * (I - 128), l[w + 2] = a + 1.772 * (r - 128), l[w + 3] = 255;
    }
    return l;
  }
  static RGBAfromRGB(...e) {
    if (e.length === 1) {
      const w = e[0], a = new Uint8ClampedArray(w.length * 4 / 3);
      for (let r = 0, I = 0; r < w.length; r += 3, I += 4)
        a[I] = w[r], a[I + 1] = w[r + 1], a[I + 2] = w[r + 2], a[I + 3] = 255;
      return a;
    }
    const A = e[0], i = e[1], o = e[2], n = e.length >= 4 ? e[3] : null, l = A.length, g = new Uint8ClampedArray(l * 4);
    for (let w = 0, a = 0; w < l; w++, a += 4)
      g[a] = A[w], g[a + 1] = i[w], g[a + 2] = o[w], g[a + 3] = n ? n[w] : 255;
    return g;
  }
  static RGBAfromWhiteIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let o;
    for (let n = 0, l = 0; n < e.length; ++n, l += 4)
      o = 256 - e[n] / A * 256, i[l] = o, i[l + 1] = o, i[l + 2] = o, i[l + 3] = 255;
    return i;
  }
  static RGBAfromBlackIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let o;
    for (let n = 0, l = 0; n < e.length; ++n, l += 4)
      o = e[n] / A * 256, i[l] = o, i[l + 1] = o, i[l + 2] = o, i[l + 3] = 255;
    return i;
  }
  static RGBAfromPalette(e, A) {
    const i = new Uint8ClampedArray(e.length * 4), o = A.length / 3, n = A.length / 3 * 2;
    for (let l = 0, g = 0; l < e.length; ++l, g += 4) {
      const w = e[l];
      i[g] = A[w] / 65536 * 256, i[g + 1] = A[w + o] / 65536 * 256, i[g + 2] = A[w + n] / 65536 * 256, i[g + 3] = 255;
    }
    return i;
  }
  static RGBAfromCMYK(...e) {
    if (e.length === 1) {
      const w = e[0], a = new Uint8ClampedArray(w.length);
      for (let r = 0, I = 0; r < w.length; r += 4, I += 4) {
        const c = w[r], B = w[r + 1], s = w[r + 2], E = w[r + 3];
        a[I] = 255 * ((255 - c) / 256) * ((255 - E) / 256), a[I + 1] = 255 * ((255 - B) / 256) * ((255 - E) / 256), a[I + 2] = 255 * ((255 - s) / 256) * ((255 - E) / 256), a[I + 3] = 255;
      }
      return a;
    }
    const A = e[0], i = e[1], o = e[2], n = e[3], l = A.length, g = new Uint8ClampedArray(l * 4);
    for (let w = 0, a = 0; w < l; w++, a += 4) {
      const r = A[w], I = i[w], c = o[w], B = n[w];
      g[a] = 255 * ((255 - r) / 256) * ((255 - B) / 256), g[a + 1] = 255 * ((255 - I) / 256) * ((255 - B) / 256), g[a + 2] = 255 * ((255 - c) / 256) * ((255 - B) / 256), g[a + 3] = 255;
    }
    return g;
  }
  static RGBAfromCIELab(...e) {
    const n = (I, c, B) => {
      const s = c << 24 >> 24, E = B << 24 >> 24;
      let C = (I + 16) / 116, h = s / 500 + C, y = C - E / 200;
      h = 0.95047 * (h * h * h > 8856e-6 ? h * h * h : (h - 0.13793103448275862) / 7.787), C = 1 * (C * C * C > 8856e-6 ? C * C * C : (C - 0.13793103448275862) / 7.787), y = 1.08883 * (y * y * y > 8856e-6 ? y * y * y : (y - 0.13793103448275862) / 7.787);
      let p = h * 3.2406 + C * -1.5372 + y * -0.4986, d = h * -0.9689 + C * 1.8758 + y * 0.0415, Q = h * 0.0557 + C * -0.204 + y * 1.057;
      return p = p > 31308e-7 ? 1.055 * p ** 0.4166666666666667 - 0.055 : 12.92 * p, d = d > 31308e-7 ? 1.055 * d ** 0.4166666666666667 - 0.055 : 12.92 * d, Q = Q > 31308e-7 ? 1.055 * Q ** 0.4166666666666667 - 0.055 : 12.92 * Q, [
        Math.max(0, Math.min(1, p)) * 255,
        Math.max(0, Math.min(1, d)) * 255,
        Math.max(0, Math.min(1, Q)) * 255
      ];
    };
    if (e.length === 1) {
      const I = e[0], c = new Uint8ClampedArray(I.length * 4 / 3);
      for (let B = 0, s = 0; B < I.length; B += 3, s += 4) {
        const [E, C, h] = n(I[B], I[B + 1], I[B + 2]);
        c[s] = E, c[s + 1] = C, c[s + 2] = h, c[s + 3] = 255;
      }
      return c;
    }
    const l = e[0], g = e[1], w = e[2], a = l.length, r = new Uint8ClampedArray(a * 4);
    for (let I = 0, c = 0; I < a; I++, c += 4) {
      const [B, s, E] = n(l[I], g[I], w[I]);
      r[c] = B, r[c + 1] = s, r[c + 2] = E, r[c + 3] = 255;
    }
    return r;
  }
}
const Vn = {
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
function jn() {
  let t, e;
  return { promise: new Promise((i, o) => {
    t = i, e = o;
  }), resolve: t, reject: e };
}
function Xn(t) {
  try {
    return t ? typeof t == "string" ? t : t && typeof t.message == "string" ? t.message : JSON.stringify(t) : "Unknown error";
  } catch {
    return String(t);
  }
}
class Je {
  constructor(e) {
    Object.assign(this, e);
  }
  getType() {
    return "gpuTextureSet";
  }
}
class Wn {
  /**
   * @param {Object} params
   * @param {number} params.size
   * @param {() => Worker} params.createWorker
   */
  constructor({ size: e, createWorker: A }) {
    this.size = Math.max(1, e | 0), this.createWorker = A, this.workers = [], this._nextId = 1;
    for (let i = 0; i < this.size; i++) {
      const o = this.createWorker(), n = { worker: o, pending: 0, callbacks: /* @__PURE__ */ new Map() };
      o.onmessage = (l) => {
        const g = l.data || {};
        if (g.kind === "warn") {
          CA(
            g.code || "RawTiffWorker_warn",
            g.message || "[RawTiffWorker] warning",
            "warn"
          );
          return;
        }
        const w = g.id, a = n.callbacks.get(w);
        a && (n.callbacks.delete(w), n.pending = Math.max(0, n.pending - 1), g.ok ? a.resolve(g.result) : a.reject(new Error(Xn(g.error))));
      }, o.onerror = (l) => {
        for (const g of n.callbacks.values())
          g.reject(l instanceof Error ? l : new Error(String(l)));
        n.callbacks.clear(), n.pending = 0;
      }, this.workers.push(n);
    }
  }
  /**
   * @param {string} op
   * @param {any} payload
   * @param {Transferable[]} [transfer]
   * @returns {Promise<any>}
   */
  request(e, A, i) {
    const o = this._nextId++, n = jn();
    let l = this.workers[0];
    for (const g of this.workers)
      g.pending < l.pending && (l = g);
    l.pending++, l.callbacks.set(o, n);
    try {
      i && i.length ? l.worker.postMessage({ id: o, op: e, payload: A }, i) : l.worker.postMessage({ id: o, op: e, payload: A });
    } catch (g) {
      l.callbacks.delete(o), l.pending = Math.max(0, l.pending - 1), n.reject(g);
    }
    return n.promise;
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
function Zn() {
  return new Worker(new URL(
    /* @vite-ignore */
    "/assets/tiff.worker-BPpoNmhb.js",
    import.meta.url
  ), { type: "module" });
}
class yA {
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
class He {
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
function xA(t, e) {
  const A = Array.isArray(t) ? t.slice() : Object.assign({}, t || {});
  if (!e || typeof e != "object") return A;
  for (const i of Object.keys(e)) {
    const o = e[i];
    o && typeof o == "object" && !Array.isArray(o) && A[i] && typeof A[i] == "object" && !Array.isArray(A[i]) ? A[i] = xA(A[i], o) : A[i] = o;
  }
  return A;
}
function ZA(t, e) {
  const A = e && e.hints;
  if (A && A.formatResolved) return A.formatResolved;
  if (A && A.format) return A.format;
  if (e && e.meta && e.meta.format) return e.meta.format;
  if (t && t.format) return t.format;
  if (t && t.userData && t.userData.format) return t.userData.format;
  const i = t && (t.source || t.tileSource || t._tileSource);
  return i && i.format ? i.format : i && i.options && i.options.format ? i.options.format : null;
}
function zn(t) {
  return Array.isArray(t) ? t.map((e) => {
    const A = typeof e.ctor == "string" && globalThis[e.ctor] ? globalThis[e.ctor] : Uint8Array;
    return new A(e.buffer, e.byteOffset || 0, e.length);
  }) : [];
}
function $n(t, e) {
  const A = zn(t.bands);
  return new He({
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
function Ct(t) {
  const e = (t.packs || []).map((A) => {
    const i = A.data, o = typeof i.ctor == "string" && globalThis[i.ctor] ? globalThis[i.ctor] : Uint8Array, n = new o(i.buffer, i.byteOffset || 0, i.length);
    return Object.assign({}, A, { data: n });
  });
  return new Je({
    width: t.width,
    height: t.height,
    mode: t.mode,
    channelCount: t.channelCount,
    packs: e
  });
}
function Ao(t, e = {}) {
  const A = t;
  if (A.RawTiffPlugin && A.RawTiffPlugin.__installed) return A.RawTiffPlugin;
  const i = Object.assign({
    toneMap: null,
    format: xA(Vn, e.defaults && e.defaults.format || null)
  }, e.defaults || {}), o = Object.assign({
    enabled: !0,
    size: typeof navigator < "u" && navigator.hardwareConcurrency ? Math.max(1, Math.min(4, Math.ceil(navigator.hardwareConcurrency / 2))) : 2,
    createWorker: null,
    transferInput: !1,
    enableRawTiffToImageBitmap: !0
  }, e.workerPool || {}), n = A.RawTiffPluginShared = A.RawTiffPluginShared || {};
  function l() {
    var f, u;
    if (!o.enabled || typeof Worker > "u") return null;
    if (n.__rawTiffWorkerPool) return n.__rawTiffWorkerPool;
    const Q = o.createWorker || Zn;
    try {
      return n.__rawTiffWorkerPool = new Wn({
        size: o.size,
        createWorker: Q
      }), n.__rawTiffWorkerPool;
    } catch (D) {
      return (u = (f = A.console) == null ? void 0 : f.warn) == null || u.call(f, "[RawTiffPlugin] Failed to create worker pool; falling back to main thread.", D), n.__rawTiffWorkerPool = null, null;
    }
  }
  async function g(Q) {
    if (Q == null) throw new Error("[RawTiffPlugin] rawTiff is null/undefined.");
    if (Q instanceof yA) return g(Q.source);
    if (typeof Q == "object") {
      if (typeof Q.arrayBuffer == "function") {
        const f = await Q.arrayBuffer();
        if (f instanceof ArrayBuffer) return f;
      }
      if (Q.bytes != null) return g(Q.bytes);
      if (Q.blob != null) return g(Q.blob);
    }
    if (typeof Blob < "u" && Q instanceof Blob) return await Q.arrayBuffer();
    if (Q instanceof ArrayBuffer) return Q;
    if (ArrayBuffer.isView(Q)) {
      const { buffer: f, byteOffset: u, byteLength: D } = Q;
      return f.slice(u, u + D);
    }
    throw new Error("[RawTiffPlugin] Unsupported rawTiff payload. Provide ArrayBuffer, TypedArray, Blob, or RawTiff wrapper.");
  }
  async function w(Q) {
    return typeof Q.getImageCount == "function" ? await Q.getImageCount() : typeof Q.getImages == "function" ? (await Q.getImages()).length : 1;
  }
  async function a(Q, f) {
    if (typeof Q.getImage == "function") return await Q.getImage(f);
    if (typeof Q.getImages == "function") return (await Q.getImages())[f];
    throw new Error("[RawTiffPlugin] geotiff instance does not expose getImage/getImages.");
  }
  async function r(Q, f) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const u = f && f.hints || (f instanceof yA ? f.hints : null) || {}, D = await g(f);
    let F;
    if (typeof qe == "function")
      F = await qe(D);
    else if (typeof UA == "function")
      F = await UA(new Blob([D], { type: "image/tiff" }));
    else
      throw new Error("[RawTiffPlugin] geotiff module does not provide fromArrayBuffer/fromBlob.");
    const k = await w(F);
    let m = u.imageIndex;
    if (k > 1) {
      if (typeof m != "number" || !Number.isFinite(m))
        throw new Error(`[RawTiffPlugin] TIFF contains ${k} images. Provide rawTiff.hints.imageIndex.`);
      if (m < 0 || m >= k)
        throw new Error(`[RawTiffPlugin] imageIndex ${m} out of range (0..${k - 1}).`);
    } else
      m = 0;
    const x = await a(F, m), v = typeof x.getWidth == "function" ? x.getWidth() : x.width, N = typeof x.getHeight == "function" ? x.getHeight() : x.height, S = typeof x.getSamplesPerPixel == "function" ? x.getSamplesPerPixel() : x.samplesPerPixel || 1, G = typeof x.getBitsPerSample == "function" ? x.getBitsPerSample() : x.bitsPerSample || [8], b = typeof x.getSampleFormat == "function" ? x.getSampleFormat() : x.sampleFormat || null, U = typeof x.getPhotometricInterpretation == "function" ? x.getPhotometricInterpretation() : x.fileDirectory ? x.fileDirectory.PhotometricInterpretation : void 0, R = x.fileDirectory || null, L = R && R.ColorMap ? R.ColorMap : null, M = Object.assign({ interleave: !1 }, u.decode || {}), q = await x.readRasters(M), O = Array.isArray(q) ? q : [q], T = Math.max(S || 0, O.length);
    return new He({
      width: v,
      height: N,
      bands: O,
      samplesPerPixel: T,
      bitsPerSample: Array.isArray(G) ? G : [G],
      sampleFormat: Array.isArray(b) ? b : b ? [b] : null,
      photometricInterpretation: U,
      colorMap: L,
      fileDirectory: R,
      hints: u
    });
  }
  async function I(Q, f, u) {
    const D = f && f.hints || (f instanceof yA ? f.hints : null) || {}, F = await g(f), k = ZA(Q, f), m = xA(i.format, k || null), x = Object.assign({}, D, { formatResolved: m }), v = o && o.transferInput ? [F] : [], N = await u.request("decodeRaster", { buffer: F, hints: x }, v);
    return $n(N, x);
  }
  async function c(Q, f) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const u = l();
    return u ? await I(Q, f, u) : await r(Q, f);
  }
  async function B(Q, f) {
    const u = f && f.hints || (f instanceof yA ? f.hints : null) || {}, D = l();
    if (D) {
      const k = await g(f), m = ZA(Q, f), x = xA(i.format, m || null), v = Object.assign({}, u, { formatResolved: x }), N = o && o.transferInput ? [k] : [], S = await D.request("decodeAndRenderImageBitmap", { buffer: k, hints: v }, N);
      if (S && S.kind === "imageBitmap") return S.imageBitmap;
      if (S && S.kind === "rgba8") {
        if (typeof createImageBitmap != "function")
          throw new Error("[RawTiffPlugin] createImageBitmap is not available to build ImageBitmap fallback.");
        const G = new Uint8ClampedArray(S.rgbaBuffer, S.rgbaByteOffset || 0, S.rgbaLength), b = new ImageData(G, S.width, S.height);
        return await createImageBitmap(b);
      }
      throw new Error("[RawTiffPlugin] Worker did not return a supported output.");
    }
    const F = await r(Q, f);
    return await y(Q, F);
  }
  async function s(Q, f) {
    const u = f && f.hints || (f instanceof yA ? f.hints : null) || {}, D = l();
    if (!D) {
      const G = await r(Q, f);
      return await E(Q, G);
    }
    const F = await g(f), k = ZA(Q, f), m = xA(i.format, k || null), x = Object.assign({}, u, { formatResolved: m }), v = o && o.transferInput ? [F] : [], N = await D.request("decodeAndPackGpuTextureSet", { buffer: F, hints: x }, v), S = Ct(N.texSet);
    return S.hints = x, S;
  }
  async function E(Q, f) {
    const u = l();
    if (!u) {
      CA("gpuTextureSet_no_worker", "[RawTiffPlugin] No worker pool available; gpuTextureSet packing will fall back to worker-less path (slower).", "warn");
      const b = f.width, U = f.height, R = b * U, L = new Uint8Array(R * 4);
      for (let M = 0, q = 0; M < R; M++, q += 4)
        L[q] = f.bands[0] ? f.bands[0][M] : 0, L[q + 1] = f.bands[1] ? f.bands[1][M] : 0, L[q + 2] = f.bands[2] ? f.bands[2][M] : 0, L[q + 3] = f.bands[3] ? f.bands[3][M] : 255;
      return new Je({
        width: b,
        height: U,
        mode: "data",
        channelCount: f.bands ? f.bands.length : 0,
        packs: [{ format: "RGBA8", data: L, channels: [0, 1, 2, 3], normalized: !1, scale: [1, 1, 1, 1], offset: [0, 0, 0, 0] }]
      });
    }
    const D = f.hints || {}, F = ZA(Q, f), k = xA(i.format, F || null), m = Object.assign({}, D, { formatResolved: k }), x = f.bands.map((b) => {
      var U;
      return {
        ctor: ((U = b.constructor) == null ? void 0 : U.name) || "Uint8Array",
        buffer: b.buffer,
        byteOffset: b.byteOffset,
        length: b.length
      };
    }), v = {
      width: f.width,
      height: f.height,
      bands: x,
      samplesPerPixel: f.samplesPerPixel,
      bitsPerSample: f.bitsPerSample,
      sampleFormat: f.sampleFormat,
      photometricInterpretation: f.photometricInterpretation,
      colorMap: f.colorMap,
      fileDirectory: f.fileDirectory
    }, N = x.map((b) => b.buffer), S = await u.request("rasterToGpuTextureSet", { raster: v, hints: m }, N), G = Ct(S);
    return G.hints = m, G;
  }
  function C(Q, f, u) {
    if (Q == null || Number.isNaN(Q)) return 0;
    const D = u.bands[f];
    if (D instanceof Float32Array || D instanceof Float64Array) {
      const x = Math.max(0, Math.min(1, Q));
      return Math.round(x * 255);
    }
    const k = u.bitsPerSample && u.bitsPerSample[f] != null ? u.bitsPerSample[f] : u.bitsPerSample ? u.bitsPerSample[0] : 8, m = k <= 0 ? 255 : Math.pow(2, k) - 1;
    return m <= 255 ? Math.max(0, Math.min(255, Q)) : Math.round(Math.max(0, Math.min(1, Q / m)) * 255);
  }
  function h(Q) {
    const f = i.toneMap || C, u = W || {}, D = Q.width, F = Q.height, k = D * F, m = Q.hints.renderChannels || Q.renderChannels || null, x = Q.samplesPerPixel || Q.bands.length || 1, v = (R, L) => f(Q.bands[R][L], R, Q), N = Q.photometricInterpretation;
    if (N === u.Palette && Q.colorMap) {
      const R = Q.bands[0];
      return uA.RGBAfromPalette(R, Q.colorMap);
    }
    if ((N === u.WhiteIsZero || N === u.BlackIsZero) && x >= 1) {
      const R = Q.bands[0], L = Q.bitsPerSample && Q.bitsPerSample[0] != null ? Q.bitsPerSample[0] : 8, M = Math.pow(2, L) - 1;
      if (N === u.WhiteIsZero) return uA.RGBAfromWhiteIsZero(R, M);
      if (N === u.BlackIsZero) return uA.RGBAfromBlackIsZero(R, M);
      const q = new Uint8ClampedArray(k * 4);
      for (let O = 0, T = 0; O < k; O++, T += 4) {
        let J = f(R[O], 0, Q);
        N === u.WhiteIsZero && (J = 255 - J), q[T] = q[T + 1] = q[T + 2] = J, q[T + 3] = 255;
      }
      return q;
    }
    const S = m || (N === u.RGB || N === u.YCbCr || N === u.CIELab ? [0, 1, 2] : x >= 3 ? [0, 1, 2] : [0]);
    if (S.length > 4 && (CA(
      "renderChannels>4_to_RGBA",
      `[tiff] Requested ${S.length} channels for RGBA output; only 4 can be represented. Extra channels will be dropped.`,
      "warn"
    ), S.splice(4)), S.length === 1) {
      const R = S[0], L = new Uint8ClampedArray(k * 4);
      for (let M = 0, q = 0; M < k; M++, q += 4) {
        const O = v(R, M);
        L[q] = L[q + 1] = L[q + 2] = O, L[q + 3] = 255;
      }
      return L;
    }
    const G = new Uint8ClampedArray(k * S.length);
    for (let R = 0; R < k; R++) {
      const L = R * S.length;
      for (let M = 0; M < S.length; M++) {
        const q = S[M];
        G[L + M] = q < Q.bands.length ? v(q, R) : 0;
      }
    }
    if (N === u.YCbCr && S.length >= 3) return uA.RGBAfromYCbCr(G);
    if (N === u.CMYK && S.length >= 4) return uA.RGBAfromCMYK(G);
    if (N === u.CIELab && S.length >= 3) return uA.RGBAfromCIELab(G);
    if (S.length === 4) return G;
    if (S.length === 3) return uA.RGBAfromRGB(G);
    const b = new Uint8ClampedArray(k * 4), U = S.length >= 4;
    for (let R = 0, L = 0; R < k; R++, L += 4) {
      const M = R * S.length;
      b[L] = G[M], b[L + 1] = G[M + 1] || 0, b[L + 2] = G[M + 2] || 0, b[L + 3] = U ? G[M + 3] : 255;
    }
    return b;
  }
  async function y(Q, f) {
    if (typeof createImageBitmap != "function")
      throw new Error("[RawTiffPlugin] createImageBitmap is not available.");
    const u = h(f), D = new ImageData(u, f.width, f.height);
    return await createImageBitmap(D);
  }
  async function p(Q, f) {
    const u = await y(Q, f), D = document.createElement("canvas");
    D.width = u.width, D.height = u.height;
    const F = D.getContext("2d", { willReadFrequently: !0 });
    return F.drawImage(u, 0, 0), F;
  }
  A.converter ? (A.converter.learn("rawTiff", "tiffRaster", (Q, f) => c(Q, f), 2, 10), o.enableRawTiffToImageBitmap && A.converter.learn("rawTiff", "imageBitmap", (Q, f) => B(Q, f), 1, 5), A.converter.learn("tiffRaster", "context2d", (Q, f) => p(Q, f), 2, 10), A.converter.learn("tiffRaster", "imageBitmap", (Q, f) => y(Q, f), 1, 50), A.converter.learn("rawTiff", "gpuTextureSet", (Q, f) => s(Q, f), 1, 8), A.converter.learn("tiffRaster", "gpuTextureSet", (Q, f) => E(Q, f), 1, 12)) : A.console.warn("[RawTiffPlugin] OpenSeadragon.converter is missing. Load OSD v6+.");
  const d = {
    __installed: !0,
    RawTiff: yA,
    TiffRaster: He,
    GpuTextureSet: Je,
    Converters: uA,
    decodeRawTiff: c,
    rasterToRGBA8: h,
    rasterToContext2d: p,
    rasterToImageBitmap: y,
    getWorkerPool: l,
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
    convert(Q, f, u, D) {
      if (!A.converter) throw new Error("[RawTiffPlugin] OpenSeadragon.converter is missing.");
      const F = D || A.converter.guessType(f);
      return A.converter.convert(Q, f, F, u);
    },
    /**
     * Wrap binary as a RawTiff object.
     * @param {*} source
     * @param {Object} [opts]
     * @returns {RawTiff}
     */
    wrap(Q, f) {
      return new yA(Q, f);
    },
    /**
     * Expose defaults (merged).
     */
    defaults: i
  };
  return A.RawTiffPlugin = d, d;
}
window.GeoTIFF = _n;
const eo = (t, e = {}) => {
  if (t.version.major < 4 || t.version.major === 4 && t.version.minor < 1)
    throw new Error("Your current OpenSeadragon version is too low to support GeoTIFFTileSource");
  const {
    workerUrl: A,
    // optional: string or URL
    workerPool: i,
    // optional: { createWorker: () => Worker }
    httpAdapter: o
    // optional: { fetch(url, init?) => Promise<Response> }
  } = e, n = o ? /* @__PURE__ */ (() => {
    class B extends VA {
      constructor(E) {
        super(), this.res = E;
      }
      get status() {
        return this.res.status;
      }
      getHeader(E) {
        return this.res.headers.get(E);
      }
      async getData() {
        return this.res.arrayBuffer();
      }
    }
    return class extends jA {
      async request({ headers: E, signal: C } = {}) {
        const h = await o.fetch(this.url, { headers: E, signal: C });
        return new B(h);
      }
    };
  })() : null, l = (B, s) => n ? Gi(new n(B), s) : Te(B, s), w = i || {
    createWorker: () => A ? new Worker(A, { type: "module" }) : new Worker(new URL(
      /* @vite-ignore */
      "/assets/tiff.worker-BPpoNmhb.js",
      import.meta.url
    ), {
      type: "module"
    })
  }, a = t.RawTiffPlugin || Ao(t, {
    workerPool: w
  });
  let r = 0;
  const c = class c extends t.TileSource {
    constructor(s, E = { logLatency: !1 }) {
      super();
      let C = this;
      this.input = s, this.options = E, this.channel = (s == null ? void 0 : s.channel) ?? null, this._ready = !1, this._pool = c.sharedPool, this._tileSize = 256, this._tsCounter = r, r += 1, s.GeoTIFF && s.GeoTIFFImages ? (this.promises = {
        GeoTIFF: Promise.resolve(s.GeoTIFF),
        GeoTIFFImages: Promise.resolve(s.GeoTIFFImages),
        ready: new ye()
      }, this.GeoTIFF = s.GeoTIFF, this.imageCount = s.GeoTIFFImages.length, this.GeoTIFFImages = s.GeoTIFFImages, this.setupLevels()) : (this.promises = {
        GeoTIFF: s instanceof File ? UA(s, E.GeoTIFFOptions) : l(s, E.GeoTIFFOptions),
        GeoTIFFImages: new ye(),
        ready: new ye()
      }, this.promises.GeoTIFF.then((h) => (C.GeoTIFF = h, h.getImageCount())).then((h) => {
        C.imageCount = h;
        let y = [...Array(h).keys()].map((p) => C.GeoTIFF.getImage(p));
        return Promise.all(y);
      }).then((h) => {
        h = C.constructor.userDefinedImagesFilter(h, E), C.GeoTIFFImages = h, C.promises.GeoTIFFImages.resolve(h), this.setupLevels();
      }).catch((h) => {
        throw console.error("Re-throwing error with GeoTIFF:", h), h;
      }));
    }
    static async getAllTileSources(s, E) {
      const C = s instanceof File ? s.name.split(".").pop() : s.split(".").pop();
      let h = await (s instanceof File ? UA(s, E.GeoTIFFOptions) : l(s, E.GeoTIFFOptions)), y = await h.getImageCount();
      return Promise.all(
        Array.from({ length: y }, (p, d) => h.getImage(d))
      ).then((p) => {
        let d = s instanceof File ? UA(s) : Te(s);
        return p = this.userDefinedImagesFilter(p, E), p = p.filter(
          (Q) => Q.fileDirectory.photometricInterpretation !== W.TransparencyMask
        ), this.resolveLayout(d, p, E.hints);
      }).then((p) => this.buildLevelImages(h, p, h)).then((p) => {
        p.sort((u, D) => D.getWidth() - u.getWidth());
        const d = 0.015;
        return p.reduce((u, D) => {
          const F = D.getWidth() / D.getHeight();
          let k = "";
          D.fileDirectory.ImageDescription && (k = D.fileDirectory.ImageDescription.split(`
`)[1] ?? "");
          const m = u.filter(
            (x) => Math.abs(1 - x.aspectRatio / F) < d && !(k != null && k.includes("macro") || k != null && k.includes("label"))
            // Separate out macro thumbnails and labels
          );
          if (m.length === 0) {
            let x = {
              aspectRatio: F,
              images: [D]
            };
            u.push(x);
          } else
            m[0].images.push(D);
          return u;
        }, []).map((u) => u.images).map((u, D) => {
          if (D !== 0)
            return new t.GeoTIFFTileSource(
              {
                GeoTIFF: h,
                GeoTIFFImages: u
              },
              E
            );
          switch (C) {
            case "qptiff":
              const F = Pn(u);
              return Array.from(F.values()).map((k, m) => new t.GeoTIFFTileSource(
                {
                  GeoTIFF: h,
                  GeoTIFFImages: k.images,
                  channel: {
                    name: k.name,
                    color: k.color
                  }
                },
                E
              ));
            default:
              return new t.GeoTIFFTileSource(
                {
                  GeoTIFF: h,
                  GeoTIFFImages: u
                },
                E
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
    getTileWidth(s) {
      if (this.levels.length > s)
        return this.levels[s].tileWidth;
    }
    /**
     * Return the tileHeight for a given level.
     * @function
     * @param {Number} level
     */
    getTileHeight(s) {
      if (this.levels.length > s)
        return this.levels[s].tileHeight;
    }
    /**
     * @function
     * @param {Number} level
     */
    getLevelScale(s) {
      let E = NaN;
      return this.levels.length > 0 && s >= this.minLevel && s <= this.maxLevel && (E = this.levels[s].width / this.levels[this.maxLevel].width), E;
    }
    /**
     * Handle maintaining unique caches per channel in multi-channel images
     */
    getTileHashKey(s, E, C) {
      var h;
      return `geotiffTileSource${this._tsCounter}_${((h = this == null ? void 0 : this.channel) == null ? void 0 : h.name) ?? ""}_${s}_${E}_${C}`;
    }
    /**
     * Implement function here instead of as custom tile source in client code
     * @function
     * @param {Number} levelnum
     * @param {Number} x
     * @param {Number} y
     */
    getTileUrl(s, E, C) {
      return `${s}/${E}_${C}`;
    }
    downloadTileStart(s) {
      const E = !!t.converter && typeof s.fail == "function", C = "" + s.src, h = new AbortController();
      s.userData && (s.userData.abortController = h);
      const y = this.levels[s.tile.level];
      this.regionToTiffRaster(y, s.tile.x, s.tile.y, h.signal).then(async (p) => {
        if (E) {
          s.finish(p, C, p.getType());
          return;
        }
        const d = await Promise.resolve(a.rasterToContext2d(s.tile, p));
        s.finish(d.canvas);
      }).catch((p) => {
        const d = p && p.message ? p.message : String(p);
        E ? s.fail(d) : s.finish(null, C, d);
      });
    }
    downloadTileAbort(s) {
      const E = s.userData && s.userData.abortController;
      E ? E.abort() : $.console.error("Could not abort download: controller not available.");
    }
    setupComplete() {
      this._ready = !0, this.promises.ready.resolve(), this.raiseEvent("ready", { tileSource: this });
    }
    setupLevels() {
      if (this._ready)
        return;
      let s = this.GeoTIFFImages.sort((d, Q) => Q.getWidth() - d.getWidth()), E = this._tileSize, C = this._tileSize, h = s[0].getWidth();
      this.width = h;
      let y = s[0].getHeight();
      if (this.height = y, this.tileOverlap = 0, this.minLevel = 0, this.aspectRatio = this.width / this.height, this.dimensions = new t.Point(this.width, this.height), s.reduce(
        (d, Q) => (d.width !== -1 && (d.valid = d.valid && Q.getWidth() < d.width), d.width = Q.getWidth(), d),
        { valid: !0, width: -1 }
      ).valid)
        this.levels = s.map((d) => {
          let Q = d.getWidth(), f = d.getHeight();
          return {
            width: Q,
            height: f,
            tileWidth: this.options.tileWidth || d.getTileWidth() || E,
            tileHeight: this.options.tileHeight || d.getTileHeight() || C,
            image: d,
            scaleFactor: 1
          };
        }), this.maxLevel = this.levels.length - 1;
      else {
        let d = Math.ceil(
          Math.log2(Math.max(h / E, y / C))
        ), Q = [...Array(d).keys()].filter((f) => f % 2 == 0);
        this.levels = Q.map((f) => {
          let u = Math.pow(2, f);
          const D = s.filter((k) => {
            const m = Math.pow(2, f - 1);
            return m >= 0 ? k.getWidth() * m < h && k.getWidth() * u >= h : k.getWidth() * u >= h;
          });
          if (D.length === 0)
            return null;
          const F = D[0];
          return {
            width: h / u,
            height: y / u,
            tileWidth: this.options.tileWidth || F.getTileWidth() || E,
            tileHeight: this.options.tileHeight || F.getTileHeight() || C,
            image: F,
            scaleFactor: u * F.getWidth() / h
          };
        }).filter((f) => f !== null), this.maxLevel = this.levels.length - 1;
      }
      this.levels = this.levels.sort((d, Q) => d.width - Q.width), this._tileWidth = this.levels[0].tileWidth, this._tileHeight = this.levels[0].tileHeight, this.setupComplete();
    }
    static getGeoTiffFileDirectory(s) {
      var E;
      return ((E = s.getFileDirectory) == null ? void 0 : E.call(s)) ?? s.fileDirectory ?? {};
    }
    static getGeoTiffFileKey(s) {
      return [
        s.getWidth(),
        s.getHeight(),
        this.getGeoTiffFileDirectory(s).TileWidth ?? 0,
        this.getGeoTiffFileDirectory(s).TileLength ?? 0,
        (s.getWidth() / s.getHeight()).toFixed(6)
      ].join("|");
    }
    static async resolveLayout(s, E, C = {}) {
      const h = C.layout || {}, y = h.pyramid || "auto", p = Number.isFinite(h.planeIndex) ? h.planeIndex : 0, d = /* @__PURE__ */ new Map();
      for (const b of E) {
        const U = this.getGeoTiffFileKey(b);
        b.__key = U, this.getGeoTiffFileDirectory(b);
        const R = d.get(U) || [];
        R.push(b), d.set(U, R);
      }
      const Q = E.map((b) => ({ im: b, w: b.getWidth(), h: b.getHeight() })).sort((b, U) => U.w - b.w), f = [], u = /* @__PURE__ */ new Set();
      for (const { im: b, w: U, h: R } of Q) {
        const L = `${U}x${R}`;
        u.has(L) || (u.add(L), f.push(b));
      }
      const D = (b) => {
        if (b.length < 2) return !1;
        for (let R = 1; R < b.length; R++)
          if (b[R].getWidth() >= b[R - 1].getWidth() || b[R].getHeight() >= b[R - 1].getHeight()) return !1;
        const U = b[0].getWidth() / b[0].getHeight();
        for (const R of b) {
          const L = R.getWidth() / R.getHeight();
          if (Math.abs(L - U) > 0.01) return !1;
        }
        return !0;
      }, F = f, k = D(F), m = E.some((b) => {
        const U = this.getGeoTiffFileDirectory(b).SubIFDs;
        return U && U.length;
      });
      let x = "single";
      y === "ifd" ? x = k ? "ifd" : "single" : y === "subifd" ? x = m ? "subifd" : "single" : k ? x = "ifd" : m ? x = "subifd" : x = "single";
      const v = F[0], N = v.__key, S = d.get(N) || [v], G = S[Math.max(0, Math.min(S.length - 1, p))];
      return x === "subifd" && (CA(`${G.__key}-subifd-warn`, `[GeoTIFFTileSource] File was detected to contain SubIFD pyramids, 
however, geotiff.js does not support reading SubIFD files and is unable to display the pyramid. Only the
high-resolution lowest level will be shown. Note that loading such data can crash your browser due to memory consumption.`, "warn"), x = "ifd"), { strategy: x, planes: S, chosenPlane: G, ifdLevelsLargestToSmallest: F };
    }
    static async buildLevelImages(s, E, C) {
      const { strategy: h, chosenPlane: y, ifdLevelsLargestToSmallest: p, planes: d } = E, Q = (f) => {
        var u;
        return ((u = f.getFileDirectory) == null ? void 0 : u.call(f)) ?? f.fileDirectory ?? {};
      };
      if (h === "ifd") {
        const f = [...p].sort((u, D) => u.getWidth() - D.getWidth());
        return d.length > 1 && CA(C, `[GeoTIFFTileSource] Detected a plane stack (${d.length} same-size IFDs) AND a top-level pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose a different plane.`, "warn"), f;
      }
      if (h === "subifd") {
        const u = Q(y).SubIFDs;
        if (!u || !u.length)
          return CA(C, "[GeoTIFFTileSource] SubIFD pyramid requested/detected but the chosen plane has no SubIFDs. Falling back to single level.", "warn"), [y];
        if (typeof y.getSubIFDs == "function") {
          const F = [...await y.getSubIFDs(), y].sort((k, m) => k.getWidth() - m.getWidth());
          return d.length > 1 && CA(C, `[GeoTIFFTileSource] Detected a plane stack (${d.length} same-size IFDs) with SubIFD pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), F;
        }
        return CA(C, "[GeoTIFFTileSource] SubIFDs are present but geotiff.js does not expose getSubIFDs() in this build. Using single level. (You can still render multi-plane data via your GPU pipeline.)", "warn"), [y];
      }
      return d.length > 1 && CA(C, `[GeoTIFFTileSource] Detected ${d.length} same-size IFD pages (likely channels/planes). No pyramid detected. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), [y];
    }
    regionToTiffRaster(s, E, C, h) {
      var F, k, m, x;
      const y = this.options.logLatency && Date.now(), p = s.tileWidth, d = s.tileHeight, Q = [E * p, C * d, (E + 1) * p, (C + 1) * d].map(
        (v) => v * s.scaleFactor
      ), f = s.image, u = (k = (F = f.fileDirectory) == null ? void 0 : F.Software) == null ? void 0 : k.startsWith("PerkinElmer-QPI");
      let D = null;
      if (u && ((m = f.fileDirectory) != null && m.ImageDescription))
        try {
          const N = (x = new DOMParser().parseFromString(f.fileDirectory.ImageDescription, "text/xml").querySelector("Color")) == null ? void 0 : x.textContent;
          D = N ? N.split(",").map((S) => parseInt(S, 10)) : null;
        } catch {
          D = null;
        }
      return f.readRasters({
        interleave: !1,
        window: Q,
        pool: this._pool,
        width: p,
        height: d,
        signal: h
      }).then((v) => {
        const N = Array.isArray(v) ? v : [v], S = f.fileDirectory || {}, G = new a.TiffRaster({
          width: p,
          height: d,
          bands: N,
          samplesPerPixel: Math.max(S.SamplesPerPixel || 0, N.length),
          bitsPerSample: S.BitsPerSample || [8],
          sampleFormat: S.SampleFormat || null,
          photometricInterpretation: S.PhotometricInterpretation,
          colorMap: S.ColorMap || null,
          fileDirectory: S,
          hints: {
            ...this.channel ? { channel: this.channel } : {},
            ...D ? { tintRGB: D } : {}
          }
        });
        return this.options.logLatency && (typeof this.options.logLatency == "function" ? this.options.logLatency : console.log)(
          "Tile decode latency (ms):",
          Date.now() - y
        ), G;
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
  ue(c, "sharedPool", new Di()), ue(c, "userDefinedImagesFilter", (s, E) => (typeof E.imagesFilter < "u" && E.imagesFilter && (Array.isArray(E.imagesFilter) ? s = s.filter((C, h) => E.imagesFilter.includes(h)) : typeof E.imagesFilter == "function" && (s = s.filter(E.imagesFilter)), E.imagesFilter = void 0), s));
  let I = c;
  t.GeoTIFFTileSource = I;
};
(function(t, e) {
  typeof exports > "u" || typeof t.OpenSeadragon < "u" && e(t.OpenSeadragon);
})(typeof window < "u" ? window : void 0, eo);
class to extends dA {
  decodeBlock(e) {
    return e;
  }
}
const io = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: to
}, Symbol.toStringTag, { value: "Module" })), ct = 9, De = 256, Ye = 257, ro = 12;
function no(t, e, A) {
  const i = e % 8, o = Math.floor(e / 8), n = 8 - i, l = e + A - (o + 1) * 8;
  let g = 8 * (o + 2) - (e + A);
  const w = (o + 2) * 8 - e;
  if (g = Math.max(0, g), o >= t.length)
    return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"), Ye;
  let a = t[o] & 2 ** (8 - i) - 1;
  a <<= A - n;
  let r = a;
  if (o + 1 < t.length) {
    let I = t[o + 1] >>> g;
    I <<= Math.max(0, A - w), r += I;
  }
  if (l > 8 && o + 2 < t.length) {
    const I = (o + 3) * 8 - (e + A), c = t[o + 2] >>> I;
    r += c;
  }
  return r;
}
function pe(t, e) {
  for (let A = e.length - 1; A >= 0; A--)
    t.push(e[A]);
  return t;
}
function oo(t) {
  const e = new Uint16Array(4093), A = new Uint8Array(4093);
  for (let s = 0; s <= 257; s++)
    e[s] = 4096, A[s] = s;
  let i = 258, o = ct, n = 0;
  function l() {
    i = 258, o = ct;
  }
  function g(s) {
    const E = no(s, n, o);
    return n += o, E;
  }
  function w(s, E) {
    return A[i] = E, e[i] = s, i++, i - 1;
  }
  function a(s) {
    const E = [];
    for (let C = s; C !== 4096; C = e[C])
      E.push(A[C]);
    return E;
  }
  const r = [];
  l();
  const I = new Uint8Array(t);
  let c = g(I), B;
  for (; c !== Ye; ) {
    if (c === De) {
      for (l(), c = g(I); c === De; )
        c = g(I);
      if (c === Ye)
        break;
      if (c > De)
        throw new Error(`corrupted code at scanline ${c}`);
      {
        const s = a(c);
        pe(r, s), B = c;
      }
    } else if (c < i) {
      const s = a(c);
      pe(r, s), w(B, s[s.length - 1]), B = c;
    } else {
      const s = a(B);
      if (!s)
        throw new Error(`Bogus entry. Not in dictionary, ${B} / ${i}, position: ${n}`);
      pe(r, s), r.push(s[s.length - 1]), w(B, s[s.length - 1]), B = c;
    }
    i + 1 >= 2 ** o && (o === ro ? B = void 0 : o++), c = g(I);
  }
  return new Uint8Array(r);
}
class ao extends dA {
  decodeBlock(e) {
    return oo(e).buffer;
  }
}
const so = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ao
}, Symbol.toStringTag, { value: "Module" })), JA = new Int32Array([
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
]), zA = 4017, $A = 799, Ae = 3406, ee = 2276, te = 1567, ie = 3784, SA = 5793, re = 2896;
function Et(t, e) {
  let A = 0;
  const i = [];
  let o = 16;
  for (; o > 0 && !t[o - 1]; )
    --o;
  i.push({ children: [], index: 0 });
  let n = i[0], l;
  for (let g = 0; g < o; g++) {
    for (let w = 0; w < t[g]; w++) {
      for (n = i.pop(), n.children[n.index] = e[A]; n.index > 0; )
        n = i.pop();
      for (n.index++, i.push(n); i.length <= g; )
        i.push(l = { children: [], index: 0 }), n.children[n.index] = l.children, n = l;
      A++;
    }
    g + 1 < o && (i.push(l = { children: [], index: 0 }), n.children[n.index] = l.children, n = l);
  }
  return i[0].children;
}
function go(t, e, A, i, o, n, l, g, w) {
  const { mcusPerLine: a, progressive: r } = A, I = e;
  let c = e, B = 0, s = 0;
  function E() {
    if (s > 0)
      return s--, B >> s & 1;
    if (B = t[c++], B === 255) {
      const T = t[c++];
      if (T)
        throw new Error(`unexpected marker: ${(B << 8 | T).toString(16)}`);
    }
    return s = 7, B >>> 7;
  }
  function C(T) {
    let J = T, H;
    for (; (H = E()) !== null; ) {
      if (J = J[H], typeof J == "number")
        return J;
      if (typeof J != "object")
        throw new Error("invalid huffman sequence");
    }
    return null;
  }
  function h(T) {
    let J = T, H = 0;
    for (; J > 0; ) {
      const K = E();
      if (K === null)
        return;
      H = H << 1 | K, --J;
    }
    return H;
  }
  function y(T) {
    const J = h(T);
    return J >= 1 << T - 1 ? J : J + (-1 << T) + 1;
  }
  function p(T, J) {
    const H = C(T.huffmanTableDC), K = H === 0 ? 0 : y(H);
    T.pred += K, J[0] = T.pred;
    let _ = 1;
    for (; _ < 64; ) {
      const V = C(T.huffmanTableAC), j = V & 15, tA = V >> 4;
      if (j === 0) {
        if (tA < 15)
          break;
        _ += 16;
      } else {
        _ += tA;
        const AA = JA[_];
        J[AA] = y(j), _++;
      }
    }
  }
  function d(T, J) {
    const H = C(T.huffmanTableDC), K = H === 0 ? 0 : y(H) << w;
    T.pred += K, J[0] = T.pred;
  }
  function Q(T, J) {
    J[0] |= E() << w;
  }
  let f = 0;
  function u(T, J) {
    if (f > 0) {
      f--;
      return;
    }
    let H = n;
    const K = l;
    for (; H <= K; ) {
      const _ = C(T.huffmanTableAC), V = _ & 15, j = _ >> 4;
      if (V === 0) {
        if (j < 15) {
          f = h(j) + (1 << j) - 1;
          break;
        }
        H += 16;
      } else {
        H += j;
        const tA = JA[H];
        J[tA] = y(V) * (1 << w), H++;
      }
    }
  }
  let D = 0, F;
  function k(T, J) {
    let H = n;
    const K = l;
    let _ = 0;
    for (; H <= K; ) {
      const V = JA[H], j = J[V] < 0 ? -1 : 1;
      switch (D) {
        case 0: {
          const tA = C(T.huffmanTableAC), AA = tA & 15;
          if (_ = tA >> 4, AA === 0)
            _ < 15 ? (f = h(_) + (1 << _), D = 4) : (_ = 16, D = 1);
          else {
            if (AA !== 1)
              throw new Error("invalid ACn encoding");
            F = y(AA), D = _ ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          J[V] ? J[V] += (E() << w) * j : (_--, _ === 0 && (D = D === 2 ? 3 : 0));
          break;
        case 3:
          J[V] ? J[V] += (E() << w) * j : (J[V] = F << w, D = 0);
          break;
        case 4:
          J[V] && (J[V] += (E() << w) * j);
          break;
      }
      H++;
    }
    D === 4 && (f--, f === 0 && (D = 0));
  }
  function m(T, J, H, K, _) {
    const V = H / a | 0, j = H % a, tA = V * T.v + K, AA = j * T.h + _;
    J(T, T.blocks[tA][AA]);
  }
  function x(T, J, H) {
    const K = H / T.blocksPerLine | 0, _ = H % T.blocksPerLine;
    J(T, T.blocks[K][_]);
  }
  const v = i.length;
  let N, S, G, b, U, R;
  r ? n === 0 ? R = g === 0 ? d : Q : R = g === 0 ? u : k : R = p;
  let L = 0, M, q;
  v === 1 ? q = i[0].blocksPerLine * i[0].blocksPerColumn : q = a * A.mcusPerColumn;
  const O = o || q;
  for (; L < q; ) {
    for (S = 0; S < v; S++)
      i[S].pred = 0;
    if (f = 0, v === 1)
      for (N = i[0], U = 0; U < O; U++)
        x(N, R, L), L++;
    else
      for (U = 0; U < O; U++) {
        for (S = 0; S < v; S++) {
          N = i[S];
          const { h: T, v: J } = N;
          for (G = 0; G < J; G++)
            for (b = 0; b < T; b++)
              m(N, R, L, G, b);
        }
        if (L++, L === q)
          break;
      }
    if (s = 0, M = t[c] << 8 | t[c + 1], M < 65280)
      throw new Error("marker was not found");
    if (M >= 65488 && M <= 65495)
      c += 2;
    else
      break;
  }
  return c - I;
}
function Io(t, e) {
  const A = [], { blocksPerLine: i, blocksPerColumn: o } = e, n = i << 3, l = new Int32Array(64), g = new Uint8Array(64);
  function w(a, r, I) {
    const c = e.quantizationTable;
    let B, s, E, C, h, y, p, d, Q;
    const f = I;
    let u;
    for (u = 0; u < 64; u++)
      f[u] = a[u] * c[u];
    for (u = 0; u < 8; ++u) {
      const D = 8 * u;
      if (f[1 + D] === 0 && f[2 + D] === 0 && f[3 + D] === 0 && f[4 + D] === 0 && f[5 + D] === 0 && f[6 + D] === 0 && f[7 + D] === 0) {
        Q = SA * f[0 + D] + 512 >> 10, f[0 + D] = Q, f[1 + D] = Q, f[2 + D] = Q, f[3 + D] = Q, f[4 + D] = Q, f[5 + D] = Q, f[6 + D] = Q, f[7 + D] = Q;
        continue;
      }
      B = SA * f[0 + D] + 128 >> 8, s = SA * f[4 + D] + 128 >> 8, E = f[2 + D], C = f[6 + D], h = re * (f[1 + D] - f[7 + D]) + 128 >> 8, d = re * (f[1 + D] + f[7 + D]) + 128 >> 8, y = f[3 + D] << 4, p = f[5 + D] << 4, Q = B - s + 1 >> 1, B = B + s + 1 >> 1, s = Q, Q = E * ie + C * te + 128 >> 8, E = E * te - C * ie + 128 >> 8, C = Q, Q = h - p + 1 >> 1, h = h + p + 1 >> 1, p = Q, Q = d + y + 1 >> 1, y = d - y + 1 >> 1, d = Q, Q = B - C + 1 >> 1, B = B + C + 1 >> 1, C = Q, Q = s - E + 1 >> 1, s = s + E + 1 >> 1, E = Q, Q = h * ee + d * Ae + 2048 >> 12, h = h * Ae - d * ee + 2048 >> 12, d = Q, Q = y * $A + p * zA + 2048 >> 12, y = y * zA - p * $A + 2048 >> 12, p = Q, f[0 + D] = B + d, f[7 + D] = B - d, f[1 + D] = s + p, f[6 + D] = s - p, f[2 + D] = E + y, f[5 + D] = E - y, f[3 + D] = C + h, f[4 + D] = C - h;
    }
    for (u = 0; u < 8; ++u) {
      const D = u;
      if (f[1 * 8 + D] === 0 && f[2 * 8 + D] === 0 && f[3 * 8 + D] === 0 && f[4 * 8 + D] === 0 && f[5 * 8 + D] === 0 && f[6 * 8 + D] === 0 && f[7 * 8 + D] === 0) {
        Q = SA * I[u + 0] + 8192 >> 14, f[0 * 8 + D] = Q, f[1 * 8 + D] = Q, f[2 * 8 + D] = Q, f[3 * 8 + D] = Q, f[4 * 8 + D] = Q, f[5 * 8 + D] = Q, f[6 * 8 + D] = Q, f[7 * 8 + D] = Q;
        continue;
      }
      B = SA * f[0 * 8 + D] + 2048 >> 12, s = SA * f[4 * 8 + D] + 2048 >> 12, E = f[2 * 8 + D], C = f[6 * 8 + D], h = re * (f[1 * 8 + D] - f[7 * 8 + D]) + 2048 >> 12, d = re * (f[1 * 8 + D] + f[7 * 8 + D]) + 2048 >> 12, y = f[3 * 8 + D], p = f[5 * 8 + D], Q = B - s + 1 >> 1, B = B + s + 1 >> 1, s = Q, Q = E * ie + C * te + 2048 >> 12, E = E * te - C * ie + 2048 >> 12, C = Q, Q = h - p + 1 >> 1, h = h + p + 1 >> 1, p = Q, Q = d + y + 1 >> 1, y = d - y + 1 >> 1, d = Q, Q = B - C + 1 >> 1, B = B + C + 1 >> 1, C = Q, Q = s - E + 1 >> 1, s = s + E + 1 >> 1, E = Q, Q = h * ee + d * Ae + 2048 >> 12, h = h * Ae - d * ee + 2048 >> 12, d = Q, Q = y * $A + p * zA + 2048 >> 12, y = y * zA - p * $A + 2048 >> 12, p = Q, f[0 * 8 + D] = B + d, f[7 * 8 + D] = B - d, f[1 * 8 + D] = s + p, f[6 * 8 + D] = s - p, f[2 * 8 + D] = E + y, f[5 * 8 + D] = E - y, f[3 * 8 + D] = C + h, f[4 * 8 + D] = C - h;
    }
    for (u = 0; u < 64; ++u) {
      const D = 128 + (f[u] + 8 >> 4);
      D < 0 ? r[u] = 0 : D > 255 ? r[u] = 255 : r[u] = D;
    }
  }
  for (let a = 0; a < o; a++) {
    const r = a << 3;
    for (let I = 0; I < 8; I++)
      A.push(new Uint8Array(n));
    for (let I = 0; I < i; I++) {
      w(e.blocks[a][I], g, l);
      let c = 0;
      const B = I << 3;
      for (let s = 0; s < 8; s++) {
        const E = A[r + s];
        for (let C = 0; C < 8; C++)
          E[B + C] = g[c++];
      }
    }
  }
  return A;
}
class Bo {
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
    function o() {
      const g = i(), w = e.subarray(A, A + g - 2);
      return A += w.length, w;
    }
    function n(g) {
      let w = 0, a = 0, r, I;
      for (I in g.components)
        g.components.hasOwnProperty(I) && (r = g.components[I], w < r.h && (w = r.h), a < r.v && (a = r.v));
      const c = Math.ceil(g.samplesPerLine / 8 / w), B = Math.ceil(g.scanLines / 8 / a);
      for (I in g.components)
        if (g.components.hasOwnProperty(I)) {
          r = g.components[I];
          const s = Math.ceil(Math.ceil(g.samplesPerLine / 8) * r.h / w), E = Math.ceil(Math.ceil(g.scanLines / 8) * r.v / a), C = c * r.h, h = B * r.v, y = [];
          for (let p = 0; p < h; p++) {
            const d = [];
            for (let Q = 0; Q < C; Q++)
              d.push(new Int32Array(64));
            y.push(d);
          }
          r.blocksPerLine = s, r.blocksPerColumn = E, r.blocks = y;
        }
      g.maxH = w, g.maxV = a, g.mcusPerLine = c, g.mcusPerColumn = B;
    }
    let l = i();
    if (l !== 65496)
      throw new Error("SOI not found");
    for (l = i(); l !== 65497; ) {
      switch (l) {
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
          const g = o();
          l === 65504 && g[0] === 74 && g[1] === 70 && g[2] === 73 && g[3] === 70 && g[4] === 0 && (this.jfif = {
            version: { major: g[5], minor: g[6] },
            densityUnits: g[7],
            xDensity: g[8] << 8 | g[9],
            yDensity: g[10] << 8 | g[11],
            thumbWidth: g[12],
            thumbHeight: g[13],
            thumbData: g.subarray(14, 14 + 3 * g[12] * g[13])
          }), l === 65518 && g[0] === 65 && g[1] === 100 && g[2] === 111 && g[3] === 98 && g[4] === 101 && g[5] === 0 && (this.adobe = {
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
                for (let I = 0; I < 64; I++) {
                  const c = JA[I];
                  r[c] = i();
                }
              else
                throw new Error("DQT: invalid table spec");
            else for (let I = 0; I < 64; I++) {
              const c = JA[I];
              r[c] = e[A++];
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
            extended: l === 65473,
            progressive: l === 65474,
            precision: e[A++],
            scanLines: i(),
            samplesPerLine: i(),
            components: {},
            componentsOrder: []
          }, w = e[A++];
          let a;
          for (let r = 0; r < w; r++) {
            a = e[A];
            const I = e[A + 1] >> 4, c = e[A + 1] & 15, B = e[A + 2];
            g.componentsOrder.push(a), g.components[a] = {
              h: I,
              v: c,
              quantizationIdx: B
            }, A += 3;
          }
          n(g), this.frames.push(g);
          break;
        }
        case 65476: {
          const g = i();
          for (let w = 2; w < g; ) {
            const a = e[A++], r = new Uint8Array(16);
            let I = 0;
            for (let B = 0; B < 16; B++, A++)
              r[B] = e[A], I += r[B];
            const c = new Uint8Array(I);
            for (let B = 0; B < I; B++, A++)
              c[B] = e[A];
            w += 17 + I, a >> 4 ? this.huffmanTablesAC[a & 15] = Et(
              r,
              c
            ) : this.huffmanTablesDC[a & 15] = Et(
              r,
              c
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
          for (let s = 0; s < g; s++) {
            const E = a.components[e[A++]], C = e[A++];
            E.huffmanTableDC = this.huffmanTablesDC[C >> 4], E.huffmanTableAC = this.huffmanTablesAC[C & 15], w.push(E);
          }
          const r = e[A++], I = e[A++], c = e[A++], B = go(
            e,
            A,
            a,
            w,
            this.resetInterval,
            r,
            I,
            c >> 4,
            c & 15
          );
          A += B;
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
          throw new Error(`unknown JPEG marker ${l.toString(16)}`);
      }
      l = i();
    }
  }
  getResult() {
    const { frames: e } = this;
    if (this.frames.length === 0)
      throw new Error("no frames were decoded");
    this.frames.length > 1 && console.warn("more than one frame is not supported");
    for (let r = 0; r < this.frames.length; r++) {
      const I = this.frames[r].components;
      for (const c of Object.keys(I))
        I[c].quantizationTable = this.quantizationTables[I[c].quantizationIdx], delete I[c].quantizationIdx;
    }
    const A = e[0], { components: i, componentsOrder: o } = A, n = [], l = A.samplesPerLine, g = A.scanLines;
    for (let r = 0; r < o.length; r++) {
      const I = i[o[r]];
      n.push({
        lines: Io(A, I),
        scaleX: I.h / A.maxH,
        scaleY: I.v / A.maxV
      });
    }
    const w = new Uint8Array(l * g * n.length);
    let a = 0;
    for (let r = 0; r < g; ++r)
      for (let I = 0; I < l; ++I)
        for (let c = 0; c < n.length; ++c) {
          const B = n[c];
          w[a] = B.lines[0 | r * B.scaleY][0 | I * B.scaleX], ++a;
        }
    return w;
  }
}
class lo extends dA {
  constructor(e) {
    super(), this.reader = new Bo(), e.JPEGTables && this.reader.parse(e.JPEGTables);
  }
  decodeBlock(e) {
    return this.reader.resetFrames(), this.reader.parse(new Uint8Array(e)), this.reader.getResult().buffer;
  }
}
const fo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: lo
}, Symbol.toStringTag, { value: "Module" }));
function NA(t) {
  let e = t.length;
  for (; --e >= 0; )
    t[e] = 0;
}
const Co = 3, co = 258, xi = 29, Eo = 256, Qo = Eo + 1 + xi, bi = 30, ho = 512, uo = new Array((Qo + 2) * 2);
NA(uo);
const wo = new Array(bi * 2);
NA(wo);
const yo = new Array(ho);
NA(yo);
const Do = new Array(co - Co + 1);
NA(Do);
const po = new Array(xi);
NA(po);
const mo = new Array(bi);
NA(mo);
const ko = (t, e, A, i) => {
  let o = t & 65535 | 0, n = t >>> 16 & 65535 | 0, l = 0;
  for (; A !== 0; ) {
    l = A > 2e3 ? 2e3 : A, A -= l;
    do
      o = o + e[i++] | 0, n = n + o | 0;
    while (--l);
    o %= 65521, n %= 65521;
  }
  return o | n << 16 | 0;
};
var Oe = ko;
const Fo = () => {
  let t, e = [];
  for (var A = 0; A < 256; A++) {
    t = A;
    for (var i = 0; i < 8; i++)
      t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
    e[A] = t;
  }
  return e;
}, So = new Uint32Array(Fo()), Go = (t, e, A, i) => {
  const o = So, n = i + A;
  t ^= -1;
  for (let l = i; l < n; l++)
    t = t >>> 8 ^ o[(t ^ e[l]) & 255];
  return t ^ -1;
};
var IA = Go, Ke = {
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
}, Ri = {
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
const xo = (t, e) => Object.prototype.hasOwnProperty.call(t, e);
var bo = function(t) {
  const e = Array.prototype.slice.call(arguments, 1);
  for (; e.length; ) {
    const A = e.shift();
    if (A) {
      if (typeof A != "object")
        throw new TypeError(A + "must be non-object");
      for (const i in A)
        xo(A, i) && (t[i] = A[i]);
    }
  }
  return t;
}, Ro = (t) => {
  let e = 0;
  for (let i = 0, o = t.length; i < o; i++)
    e += t[i].length;
  const A = new Uint8Array(e);
  for (let i = 0, o = 0, n = t.length; i < n; i++) {
    let l = t[i];
    A.set(l, o), o += l.length;
  }
  return A;
}, vi = {
  assign: bo,
  flattenChunks: Ro
};
let Ui = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  Ui = !1;
}
const OA = new Uint8Array(256);
for (let t = 0; t < 256; t++)
  OA[t] = t >= 252 ? 6 : t >= 248 ? 5 : t >= 240 ? 4 : t >= 224 ? 3 : t >= 192 ? 2 : 1;
OA[254] = OA[254] = 1;
var vo = (t) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(t);
  let e, A, i, o, n, l = t.length, g = 0;
  for (o = 0; o < l; o++)
    A = t.charCodeAt(o), (A & 64512) === 55296 && o + 1 < l && (i = t.charCodeAt(o + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), o++)), g += A < 128 ? 1 : A < 2048 ? 2 : A < 65536 ? 3 : 4;
  for (e = new Uint8Array(g), n = 0, o = 0; n < g; o++)
    A = t.charCodeAt(o), (A & 64512) === 55296 && o + 1 < l && (i = t.charCodeAt(o + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), o++)), A < 128 ? e[n++] = A : A < 2048 ? (e[n++] = 192 | A >>> 6, e[n++] = 128 | A & 63) : A < 65536 ? (e[n++] = 224 | A >>> 12, e[n++] = 128 | A >>> 6 & 63, e[n++] = 128 | A & 63) : (e[n++] = 240 | A >>> 18, e[n++] = 128 | A >>> 12 & 63, e[n++] = 128 | A >>> 6 & 63, e[n++] = 128 | A & 63);
  return e;
};
const Uo = (t, e) => {
  if (e < 65534 && t.subarray && Ui)
    return String.fromCharCode.apply(null, t.length === e ? t : t.subarray(0, e));
  let A = "";
  for (let i = 0; i < e; i++)
    A += String.fromCharCode(t[i]);
  return A;
};
var Lo = (t, e) => {
  const A = e || t.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(t.subarray(0, e));
  let i, o;
  const n = new Array(A * 2);
  for (o = 0, i = 0; i < A; ) {
    let l = t[i++];
    if (l < 128) {
      n[o++] = l;
      continue;
    }
    let g = OA[l];
    if (g > 4) {
      n[o++] = 65533, i += g - 1;
      continue;
    }
    for (l &= g === 2 ? 31 : g === 3 ? 15 : 7; g > 1 && i < A; )
      l = l << 6 | t[i++] & 63, g--;
    if (g > 1) {
      n[o++] = 65533;
      continue;
    }
    l < 65536 ? n[o++] = l : (l -= 65536, n[o++] = 55296 | l >> 10 & 1023, n[o++] = 56320 | l & 1023);
  }
  return Uo(n, o);
}, Mo = (t, e) => {
  e = e || t.length, e > t.length && (e = t.length);
  let A = e - 1;
  for (; A >= 0 && (t[A] & 192) === 128; )
    A--;
  return A < 0 || A === 0 ? e : A + OA[t[A]] > e ? A : e;
}, _e = {
  string2buf: vo,
  buf2string: Lo,
  utf8border: Mo
};
function No() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var To = No;
const ne = 16209, qo = 16191;
var Jo = function(e, A) {
  let i, o, n, l, g, w, a, r, I, c, B, s, E, C, h, y, p, d, Q, f, u, D, F, k;
  const m = e.state;
  i = e.next_in, F = e.input, o = i + (e.avail_in - 5), n = e.next_out, k = e.output, l = n - (A - e.avail_out), g = n + (e.avail_out - 257), w = m.dmax, a = m.wsize, r = m.whave, I = m.wnext, c = m.window, B = m.hold, s = m.bits, E = m.lencode, C = m.distcode, h = (1 << m.lenbits) - 1, y = (1 << m.distbits) - 1;
  A:
    do {
      s < 15 && (B += F[i++] << s, s += 8, B += F[i++] << s, s += 8), p = E[B & h];
      e:
        for (; ; ) {
          if (d = p >>> 24, B >>>= d, s -= d, d = p >>> 16 & 255, d === 0)
            k[n++] = p & 65535;
          else if (d & 16) {
            Q = p & 65535, d &= 15, d && (s < d && (B += F[i++] << s, s += 8), Q += B & (1 << d) - 1, B >>>= d, s -= d), s < 15 && (B += F[i++] << s, s += 8, B += F[i++] << s, s += 8), p = C[B & y];
            t:
              for (; ; ) {
                if (d = p >>> 24, B >>>= d, s -= d, d = p >>> 16 & 255, d & 16) {
                  if (f = p & 65535, d &= 15, s < d && (B += F[i++] << s, s += 8, s < d && (B += F[i++] << s, s += 8)), f += B & (1 << d) - 1, f > w) {
                    e.msg = "invalid distance too far back", m.mode = ne;
                    break A;
                  }
                  if (B >>>= d, s -= d, d = n - l, f > d) {
                    if (d = f - d, d > r && m.sane) {
                      e.msg = "invalid distance too far back", m.mode = ne;
                      break A;
                    }
                    if (u = 0, D = c, I === 0) {
                      if (u += a - d, d < Q) {
                        Q -= d;
                        do
                          k[n++] = c[u++];
                        while (--d);
                        u = n - f, D = k;
                      }
                    } else if (I < d) {
                      if (u += a + I - d, d -= I, d < Q) {
                        Q -= d;
                        do
                          k[n++] = c[u++];
                        while (--d);
                        if (u = 0, I < Q) {
                          d = I, Q -= d;
                          do
                            k[n++] = c[u++];
                          while (--d);
                          u = n - f, D = k;
                        }
                      }
                    } else if (u += I - d, d < Q) {
                      Q -= d;
                      do
                        k[n++] = c[u++];
                      while (--d);
                      u = n - f, D = k;
                    }
                    for (; Q > 2; )
                      k[n++] = D[u++], k[n++] = D[u++], k[n++] = D[u++], Q -= 3;
                    Q && (k[n++] = D[u++], Q > 1 && (k[n++] = D[u++]));
                  } else {
                    u = n - f;
                    do
                      k[n++] = k[u++], k[n++] = k[u++], k[n++] = k[u++], Q -= 3;
                    while (Q > 2);
                    Q && (k[n++] = k[u++], Q > 1 && (k[n++] = k[u++]));
                  }
                } else if (d & 64) {
                  e.msg = "invalid distance code", m.mode = ne;
                  break A;
                } else {
                  p = C[(p & 65535) + (B & (1 << d) - 1)];
                  continue t;
                }
                break;
              }
          } else if (d & 64)
            if (d & 32) {
              m.mode = qo;
              break A;
            } else {
              e.msg = "invalid literal/length code", m.mode = ne;
              break A;
            }
          else {
            p = E[(p & 65535) + (B & (1 << d) - 1)];
            continue e;
          }
          break;
        }
    } while (i < o && n < g);
  Q = s >> 3, i -= Q, s -= Q << 3, B &= (1 << s) - 1, e.next_in = i, e.next_out = n, e.avail_in = i < o ? 5 + (o - i) : 5 - (i - o), e.avail_out = n < g ? 257 + (g - n) : 257 - (n - g), m.hold = B, m.bits = s;
};
const GA = 15, Qt = 852, ht = 592, ut = 0, me = 1, dt = 2, Ho = new Uint16Array([
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
]), Yo = new Uint8Array([
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
]), Oo = new Uint16Array([
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
]), Ko = new Uint8Array([
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
]), _o = (t, e, A, i, o, n, l, g) => {
  const w = g.bits;
  let a = 0, r = 0, I = 0, c = 0, B = 0, s = 0, E = 0, C = 0, h = 0, y = 0, p, d, Q, f, u, D = null, F;
  const k = new Uint16Array(GA + 1), m = new Uint16Array(GA + 1);
  let x = null, v, N, S;
  for (a = 0; a <= GA; a++)
    k[a] = 0;
  for (r = 0; r < i; r++)
    k[e[A + r]]++;
  for (B = w, c = GA; c >= 1 && k[c] === 0; c--)
    ;
  if (B > c && (B = c), c === 0)
    return o[n++] = 1 << 24 | 64 << 16 | 0, o[n++] = 1 << 24 | 64 << 16 | 0, g.bits = 1, 0;
  for (I = 1; I < c && k[I] === 0; I++)
    ;
  for (B < I && (B = I), C = 1, a = 1; a <= GA; a++)
    if (C <<= 1, C -= k[a], C < 0)
      return -1;
  if (C > 0 && (t === ut || c !== 1))
    return -1;
  for (m[1] = 0, a = 1; a < GA; a++)
    m[a + 1] = m[a] + k[a];
  for (r = 0; r < i; r++)
    e[A + r] !== 0 && (l[m[e[A + r]]++] = r);
  if (t === ut ? (D = x = l, F = 20) : t === me ? (D = Ho, x = Yo, F = 257) : (D = Oo, x = Ko, F = 0), y = 0, r = 0, a = I, u = n, s = B, E = 0, Q = -1, h = 1 << B, f = h - 1, t === me && h > Qt || t === dt && h > ht)
    return 1;
  for (; ; ) {
    v = a - E, l[r] + 1 < F ? (N = 0, S = l[r]) : l[r] >= F ? (N = x[l[r] - F], S = D[l[r] - F]) : (N = 96, S = 0), p = 1 << a - E, d = 1 << s, I = d;
    do
      d -= p, o[u + (y >> E) + d] = v << 24 | N << 16 | S | 0;
    while (d !== 0);
    for (p = 1 << a - 1; y & p; )
      p >>= 1;
    if (p !== 0 ? (y &= p - 1, y += p) : y = 0, r++, --k[a] === 0) {
      if (a === c)
        break;
      a = e[A + l[r]];
    }
    if (a > B && (y & f) !== Q) {
      for (E === 0 && (E = B), u += I, s = a - E, C = 1 << s; s + E < c && (C -= k[s + E], !(C <= 0)); )
        s++, C <<= 1;
      if (h += 1 << s, t === me && h > Qt || t === dt && h > ht)
        return 1;
      Q = y & f, o[Q] = B << 24 | s << 16 | u - n | 0;
    }
  }
  return y !== 0 && (o[u + y] = a - E << 24 | 64 << 16 | 0), g.bits = B, 0;
};
var HA = _o;
const Po = 0, Li = 1, Mi = 2, {
  Z_FINISH: wt,
  Z_BLOCK: Vo,
  Z_TREES: oe,
  Z_OK: mA,
  Z_STREAM_END: jo,
  Z_NEED_DICT: Xo,
  Z_STREAM_ERROR: rA,
  Z_DATA_ERROR: Ni,
  Z_MEM_ERROR: Ti,
  Z_BUF_ERROR: Wo,
  Z_DEFLATED: yt
} = Ri, Ee = 16180, Dt = 16181, pt = 16182, mt = 16183, kt = 16184, Ft = 16185, St = 16186, Gt = 16187, xt = 16188, bt = 16189, le = 16190, lA = 16191, ke = 16192, Rt = 16193, Fe = 16194, vt = 16195, Ut = 16196, Lt = 16197, Mt = 16198, ae = 16199, se = 16200, Nt = 16201, Tt = 16202, qt = 16203, Jt = 16204, Ht = 16205, Se = 16206, Yt = 16207, Ot = 16208, P = 16209, qi = 16210, Ji = 16211, Zo = 852, zo = 592, $o = 15, Aa = $o, Kt = (t) => (t >>> 24 & 255) + (t >>> 8 & 65280) + ((t & 65280) << 8) + ((t & 255) << 24);
function ea() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const kA = (t) => {
  if (!t)
    return 1;
  const e = t.state;
  return !e || e.strm !== t || e.mode < Ee || e.mode > Ji ? 1 : 0;
}, Hi = (t) => {
  if (kA(t))
    return rA;
  const e = t.state;
  return t.total_in = t.total_out = e.total = 0, t.msg = "", e.wrap && (t.adler = e.wrap & 1), e.mode = Ee, e.last = 0, e.havedict = 0, e.flags = -1, e.dmax = 32768, e.head = null, e.hold = 0, e.bits = 0, e.lencode = e.lendyn = new Int32Array(Zo), e.distcode = e.distdyn = new Int32Array(zo), e.sane = 1, e.back = -1, mA;
}, Yi = (t) => {
  if (kA(t))
    return rA;
  const e = t.state;
  return e.wsize = 0, e.whave = 0, e.wnext = 0, Hi(t);
}, Oi = (t, e) => {
  let A;
  if (kA(t))
    return rA;
  const i = t.state;
  return e < 0 ? (A = 0, e = -e) : (A = (e >> 4) + 5, e < 48 && (e &= 15)), e && (e < 8 || e > 15) ? rA : (i.window !== null && i.wbits !== e && (i.window = null), i.wrap = A, i.wbits = e, Yi(t));
}, Ki = (t, e) => {
  if (!t)
    return rA;
  const A = new ea();
  t.state = A, A.strm = t, A.window = null, A.mode = Ee;
  const i = Oi(t, e);
  return i !== mA && (t.state = null), i;
}, ta = (t) => Ki(t, Aa);
let _t = !0, Ge, xe;
const ia = (t) => {
  if (_t) {
    Ge = new Int32Array(512), xe = new Int32Array(32);
    let e = 0;
    for (; e < 144; )
      t.lens[e++] = 8;
    for (; e < 256; )
      t.lens[e++] = 9;
    for (; e < 280; )
      t.lens[e++] = 7;
    for (; e < 288; )
      t.lens[e++] = 8;
    for (HA(Li, t.lens, 0, 288, Ge, 0, t.work, { bits: 9 }), e = 0; e < 32; )
      t.lens[e++] = 5;
    HA(Mi, t.lens, 0, 32, xe, 0, t.work, { bits: 5 }), _t = !1;
  }
  t.lencode = Ge, t.lenbits = 9, t.distcode = xe, t.distbits = 5;
}, _i = (t, e, A, i) => {
  let o;
  const n = t.state;
  return n.window === null && (n.wsize = 1 << n.wbits, n.wnext = 0, n.whave = 0, n.window = new Uint8Array(n.wsize)), i >= n.wsize ? (n.window.set(e.subarray(A - n.wsize, A), 0), n.wnext = 0, n.whave = n.wsize) : (o = n.wsize - n.wnext, o > i && (o = i), n.window.set(e.subarray(A - i, A - i + o), n.wnext), i -= o, i ? (n.window.set(e.subarray(A - i, A), 0), n.wnext = i, n.whave = n.wsize) : (n.wnext += o, n.wnext === n.wsize && (n.wnext = 0), n.whave < n.wsize && (n.whave += o))), 0;
}, ra = (t, e) => {
  let A, i, o, n, l, g, w, a, r, I, c, B, s, E, C = 0, h, y, p, d, Q, f, u, D;
  const F = new Uint8Array(4);
  let k, m;
  const x = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (kA(t) || !t.output || !t.input && t.avail_in !== 0)
    return rA;
  A = t.state, A.mode === lA && (A.mode = ke), l = t.next_out, o = t.output, w = t.avail_out, n = t.next_in, i = t.input, g = t.avail_in, a = A.hold, r = A.bits, I = g, c = w, D = mA;
  A:
    for (; ; )
      switch (A.mode) {
        case Ee:
          if (A.wrap === 0) {
            A.mode = ke;
            break;
          }
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if (A.wrap & 2 && a === 35615) {
            A.wbits === 0 && (A.wbits = 15), A.check = 0, F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = IA(A.check, F, 2, 0), a = 0, r = 0, A.mode = Dt;
            break;
          }
          if (A.head && (A.head.done = !1), !(A.wrap & 1) || /* check if zlib header allowed */
          (((a & 255) << 8) + (a >> 8)) % 31) {
            t.msg = "incorrect header check", A.mode = P;
            break;
          }
          if ((a & 15) !== yt) {
            t.msg = "unknown compression method", A.mode = P;
            break;
          }
          if (a >>>= 4, r -= 4, u = (a & 15) + 8, A.wbits === 0 && (A.wbits = u), u > 15 || u > A.wbits) {
            t.msg = "invalid window size", A.mode = P;
            break;
          }
          A.dmax = 1 << A.wbits, A.flags = 0, t.adler = A.check = 1, A.mode = a & 512 ? bt : lA, a = 0, r = 0;
          break;
        case Dt:
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if (A.flags = a, (A.flags & 255) !== yt) {
            t.msg = "unknown compression method", A.mode = P;
            break;
          }
          if (A.flags & 57344) {
            t.msg = "unknown header flags set", A.mode = P;
            break;
          }
          A.head && (A.head.text = a >> 8 & 1), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = IA(A.check, F, 2, 0)), a = 0, r = 0, A.mode = pt;
        case pt:
          for (; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          A.head && (A.head.time = a), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, F[2] = a >>> 16 & 255, F[3] = a >>> 24 & 255, A.check = IA(A.check, F, 4, 0)), a = 0, r = 0, A.mode = mt;
        case mt:
          for (; r < 16; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          A.head && (A.head.xflags = a & 255, A.head.os = a >> 8), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = IA(A.check, F, 2, 0)), a = 0, r = 0, A.mode = kt;
        case kt:
          if (A.flags & 1024) {
            for (; r < 16; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            A.length = a, A.head && (A.head.extra_len = a), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = IA(A.check, F, 2, 0)), a = 0, r = 0;
          } else A.head && (A.head.extra = null);
          A.mode = Ft;
        case Ft:
          if (A.flags & 1024 && (B = A.length, B > g && (B = g), B && (A.head && (u = A.head.extra_len - A.length, A.head.extra || (A.head.extra = new Uint8Array(A.head.extra_len)), A.head.extra.set(
            i.subarray(
              n,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              n + B
            ),
            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
            u
          )), A.flags & 512 && A.wrap & 4 && (A.check = IA(A.check, i, B, n)), g -= B, n += B, A.length -= B), A.length))
            break A;
          A.length = 0, A.mode = St;
        case St:
          if (A.flags & 2048) {
            if (g === 0)
              break A;
            B = 0;
            do
              u = i[n + B++], A.head && u && A.length < 65536 && (A.head.name += String.fromCharCode(u));
            while (u && B < g);
            if (A.flags & 512 && A.wrap & 4 && (A.check = IA(A.check, i, B, n)), g -= B, n += B, u)
              break A;
          } else A.head && (A.head.name = null);
          A.length = 0, A.mode = Gt;
        case Gt:
          if (A.flags & 4096) {
            if (g === 0)
              break A;
            B = 0;
            do
              u = i[n + B++], A.head && u && A.length < 65536 && (A.head.comment += String.fromCharCode(u));
            while (u && B < g);
            if (A.flags & 512 && A.wrap & 4 && (A.check = IA(A.check, i, B, n)), g -= B, n += B, u)
              break A;
          } else A.head && (A.head.comment = null);
          A.mode = xt;
        case xt:
          if (A.flags & 512) {
            for (; r < 16; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.check & 65535)) {
              t.msg = "header crc mismatch", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.head && (A.head.hcrc = A.flags >> 9 & 1, A.head.done = !0), t.adler = A.check = 0, A.mode = lA;
          break;
        case bt:
          for (; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          t.adler = A.check = Kt(a), a = 0, r = 0, A.mode = le;
        case le:
          if (A.havedict === 0)
            return t.next_out = l, t.avail_out = w, t.next_in = n, t.avail_in = g, A.hold = a, A.bits = r, Xo;
          t.adler = A.check = 1, A.mode = lA;
        case lA:
          if (e === Vo || e === oe)
            break A;
        case ke:
          if (A.last) {
            a >>>= r & 7, r -= r & 7, A.mode = Se;
            break;
          }
          for (; r < 3; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          switch (A.last = a & 1, a >>>= 1, r -= 1, a & 3) {
            case 0:
              A.mode = Rt;
              break;
            case 1:
              if (ia(A), A.mode = ae, e === oe) {
                a >>>= 2, r -= 2;
                break A;
              }
              break;
            case 2:
              A.mode = Ut;
              break;
            case 3:
              t.msg = "invalid block type", A.mode = P;
          }
          a >>>= 2, r -= 2;
          break;
        case Rt:
          for (a >>>= r & 7, r -= r & 7; r < 32; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if ((a & 65535) !== (a >>> 16 ^ 65535)) {
            t.msg = "invalid stored block lengths", A.mode = P;
            break;
          }
          if (A.length = a & 65535, a = 0, r = 0, A.mode = Fe, e === oe)
            break A;
        case Fe:
          A.mode = vt;
        case vt:
          if (B = A.length, B) {
            if (B > g && (B = g), B > w && (B = w), B === 0)
              break A;
            o.set(i.subarray(n, n + B), l), g -= B, n += B, w -= B, l += B, A.length -= B;
            break;
          }
          A.mode = lA;
          break;
        case Ut:
          for (; r < 14; ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if (A.nlen = (a & 31) + 257, a >>>= 5, r -= 5, A.ndist = (a & 31) + 1, a >>>= 5, r -= 5, A.ncode = (a & 15) + 4, a >>>= 4, r -= 4, A.nlen > 286 || A.ndist > 30) {
            t.msg = "too many length or distance symbols", A.mode = P;
            break;
          }
          A.have = 0, A.mode = Lt;
        case Lt:
          for (; A.have < A.ncode; ) {
            for (; r < 3; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            A.lens[x[A.have++]] = a & 7, a >>>= 3, r -= 3;
          }
          for (; A.have < 19; )
            A.lens[x[A.have++]] = 0;
          if (A.lencode = A.lendyn, A.lenbits = 7, k = { bits: A.lenbits }, D = HA(Po, A.lens, 0, 19, A.lencode, 0, A.work, k), A.lenbits = k.bits, D) {
            t.msg = "invalid code lengths set", A.mode = P;
            break;
          }
          A.have = 0, A.mode = Mt;
        case Mt:
          for (; A.have < A.nlen + A.ndist; ) {
            for (; C = A.lencode[a & (1 << A.lenbits) - 1], h = C >>> 24, y = C >>> 16 & 255, p = C & 65535, !(h <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            if (p < 16)
              a >>>= h, r -= h, A.lens[A.have++] = p;
            else {
              if (p === 16) {
                for (m = h + 2; r < m; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[n++] << r, r += 8;
                }
                if (a >>>= h, r -= h, A.have === 0) {
                  t.msg = "invalid bit length repeat", A.mode = P;
                  break;
                }
                u = A.lens[A.have - 1], B = 3 + (a & 3), a >>>= 2, r -= 2;
              } else if (p === 17) {
                for (m = h + 3; r < m; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[n++] << r, r += 8;
                }
                a >>>= h, r -= h, u = 0, B = 3 + (a & 7), a >>>= 3, r -= 3;
              } else {
                for (m = h + 7; r < m; ) {
                  if (g === 0)
                    break A;
                  g--, a += i[n++] << r, r += 8;
                }
                a >>>= h, r -= h, u = 0, B = 11 + (a & 127), a >>>= 7, r -= 7;
              }
              if (A.have + B > A.nlen + A.ndist) {
                t.msg = "invalid bit length repeat", A.mode = P;
                break;
              }
              for (; B--; )
                A.lens[A.have++] = u;
            }
          }
          if (A.mode === P)
            break;
          if (A.lens[256] === 0) {
            t.msg = "invalid code -- missing end-of-block", A.mode = P;
            break;
          }
          if (A.lenbits = 9, k = { bits: A.lenbits }, D = HA(Li, A.lens, 0, A.nlen, A.lencode, 0, A.work, k), A.lenbits = k.bits, D) {
            t.msg = "invalid literal/lengths set", A.mode = P;
            break;
          }
          if (A.distbits = 6, A.distcode = A.distdyn, k = { bits: A.distbits }, D = HA(Mi, A.lens, A.nlen, A.ndist, A.distcode, 0, A.work, k), A.distbits = k.bits, D) {
            t.msg = "invalid distances set", A.mode = P;
            break;
          }
          if (A.mode = ae, e === oe)
            break A;
        case ae:
          A.mode = se;
        case se:
          if (g >= 6 && w >= 258) {
            t.next_out = l, t.avail_out = w, t.next_in = n, t.avail_in = g, A.hold = a, A.bits = r, Jo(t, c), l = t.next_out, o = t.output, w = t.avail_out, n = t.next_in, i = t.input, g = t.avail_in, a = A.hold, r = A.bits, A.mode === lA && (A.back = -1);
            break;
          }
          for (A.back = 0; C = A.lencode[a & (1 << A.lenbits) - 1], h = C >>> 24, y = C >>> 16 & 255, p = C & 65535, !(h <= r); ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if (y && !(y & 240)) {
            for (d = h, Q = y, f = p; C = A.lencode[f + ((a & (1 << d + Q) - 1) >> d)], h = C >>> 24, y = C >>> 16 & 255, p = C & 65535, !(d + h <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            a >>>= d, r -= d, A.back += d;
          }
          if (a >>>= h, r -= h, A.back += h, A.length = p, y === 0) {
            A.mode = Ht;
            break;
          }
          if (y & 32) {
            A.back = -1, A.mode = lA;
            break;
          }
          if (y & 64) {
            t.msg = "invalid literal/length code", A.mode = P;
            break;
          }
          A.extra = y & 15, A.mode = Nt;
        case Nt:
          if (A.extra) {
            for (m = A.extra; r < m; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            A.length += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          A.was = A.length, A.mode = Tt;
        case Tt:
          for (; C = A.distcode[a & (1 << A.distbits) - 1], h = C >>> 24, y = C >>> 16 & 255, p = C & 65535, !(h <= r); ) {
            if (g === 0)
              break A;
            g--, a += i[n++] << r, r += 8;
          }
          if (!(y & 240)) {
            for (d = h, Q = y, f = p; C = A.distcode[f + ((a & (1 << d + Q) - 1) >> d)], h = C >>> 24, y = C >>> 16 & 255, p = C & 65535, !(d + h <= r); ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            a >>>= d, r -= d, A.back += d;
          }
          if (a >>>= h, r -= h, A.back += h, y & 64) {
            t.msg = "invalid distance code", A.mode = P;
            break;
          }
          A.offset = p, A.extra = y & 15, A.mode = qt;
        case qt:
          if (A.extra) {
            for (m = A.extra; r < m; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            A.offset += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          if (A.offset > A.dmax) {
            t.msg = "invalid distance too far back", A.mode = P;
            break;
          }
          A.mode = Jt;
        case Jt:
          if (w === 0)
            break A;
          if (B = c - w, A.offset > B) {
            if (B = A.offset - B, B > A.whave && A.sane) {
              t.msg = "invalid distance too far back", A.mode = P;
              break;
            }
            B > A.wnext ? (B -= A.wnext, s = A.wsize - B) : s = A.wnext - B, B > A.length && (B = A.length), E = A.window;
          } else
            E = o, s = l - A.offset, B = A.length;
          B > w && (B = w), w -= B, A.length -= B;
          do
            o[l++] = E[s++];
          while (--B);
          A.length === 0 && (A.mode = se);
          break;
        case Ht:
          if (w === 0)
            break A;
          o[l++] = A.length, w--, A.mode = se;
          break;
        case Se:
          if (A.wrap) {
            for (; r < 32; ) {
              if (g === 0)
                break A;
              g--, a |= i[n++] << r, r += 8;
            }
            if (c -= w, t.total_out += c, A.total += c, A.wrap & 4 && c && (t.adler = A.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
            A.flags ? IA(A.check, o, c, l - c) : Oe(A.check, o, c, l - c)), c = w, A.wrap & 4 && (A.flags ? a : Kt(a)) !== A.check) {
              t.msg = "incorrect data check", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = Yt;
        case Yt:
          if (A.wrap && A.flags) {
            for (; r < 32; ) {
              if (g === 0)
                break A;
              g--, a += i[n++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.total & 4294967295)) {
              t.msg = "incorrect length check", A.mode = P;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = Ot;
        case Ot:
          D = jo;
          break A;
        case P:
          D = Ni;
          break A;
        case qi:
          return Ti;
        case Ji:
        default:
          return rA;
      }
  return t.next_out = l, t.avail_out = w, t.next_in = n, t.avail_in = g, A.hold = a, A.bits = r, (A.wsize || c !== t.avail_out && A.mode < P && (A.mode < Se || e !== wt)) && _i(t, t.output, t.next_out, c - t.avail_out), I -= t.avail_in, c -= t.avail_out, t.total_in += I, t.total_out += c, A.total += c, A.wrap & 4 && c && (t.adler = A.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
  A.flags ? IA(A.check, o, c, t.next_out - c) : Oe(A.check, o, c, t.next_out - c)), t.data_type = A.bits + (A.last ? 64 : 0) + (A.mode === lA ? 128 : 0) + (A.mode === ae || A.mode === Fe ? 256 : 0), (I === 0 && c === 0 || e === wt) && D === mA && (D = Wo), D;
}, na = (t) => {
  if (kA(t))
    return rA;
  let e = t.state;
  return e.window && (e.window = null), t.state = null, mA;
}, oa = (t, e) => {
  if (kA(t))
    return rA;
  const A = t.state;
  return A.wrap & 2 ? (A.head = e, e.done = !1, mA) : rA;
}, aa = (t, e) => {
  const A = e.length;
  let i, o, n;
  return kA(t) || (i = t.state, i.wrap !== 0 && i.mode !== le) ? rA : i.mode === le && (o = 1, o = Oe(o, e, A, 0), o !== i.check) ? Ni : (n = _i(t, e, A, A), n ? (i.mode = qi, Ti) : (i.havedict = 1, mA));
};
var sa = Yi, ga = Oi, Ia = Hi, Ba = ta, la = Ki, fa = ra, Ca = na, ca = oa, Ea = aa, Qa = "pako inflate (from Nodeca project)", cA = {
  inflateReset: sa,
  inflateReset2: ga,
  inflateResetKeep: Ia,
  inflateInit: Ba,
  inflateInit2: la,
  inflate: fa,
  inflateEnd: Ca,
  inflateGetHeader: ca,
  inflateSetDictionary: Ea,
  inflateInfo: Qa
};
function ha() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var ua = ha;
const Pi = Object.prototype.toString, {
  Z_NO_FLUSH: da,
  Z_FINISH: wa,
  Z_OK: KA,
  Z_STREAM_END: be,
  Z_NEED_DICT: Re,
  Z_STREAM_ERROR: ya,
  Z_DATA_ERROR: Pt,
  Z_MEM_ERROR: Da
} = Ri;
function Qe(t) {
  this.options = vi.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, t || {});
  const e = this.options;
  e.raw && e.windowBits >= 0 && e.windowBits < 16 && (e.windowBits = -e.windowBits, e.windowBits === 0 && (e.windowBits = -15)), e.windowBits >= 0 && e.windowBits < 16 && !(t && t.windowBits) && (e.windowBits += 32), e.windowBits > 15 && e.windowBits < 48 && (e.windowBits & 15 || (e.windowBits |= 15)), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new To(), this.strm.avail_out = 0;
  let A = cA.inflateInit2(
    this.strm,
    e.windowBits
  );
  if (A !== KA)
    throw new Error(Ke[A]);
  if (this.header = new ua(), cA.inflateGetHeader(this.strm, this.header), e.dictionary && (typeof e.dictionary == "string" ? e.dictionary = _e.string2buf(e.dictionary) : Pi.call(e.dictionary) === "[object ArrayBuffer]" && (e.dictionary = new Uint8Array(e.dictionary)), e.raw && (A = cA.inflateSetDictionary(this.strm, e.dictionary), A !== KA)))
    throw new Error(Ke[A]);
}
Qe.prototype.push = function(t, e) {
  const A = this.strm, i = this.options.chunkSize, o = this.options.dictionary;
  let n, l, g;
  if (this.ended) return !1;
  for (e === ~~e ? l = e : l = e === !0 ? wa : da, Pi.call(t) === "[object ArrayBuffer]" ? A.input = new Uint8Array(t) : A.input = t, A.next_in = 0, A.avail_in = A.input.length; ; ) {
    for (A.avail_out === 0 && (A.output = new Uint8Array(i), A.next_out = 0, A.avail_out = i), n = cA.inflate(A, l), n === Re && o && (n = cA.inflateSetDictionary(A, o), n === KA ? n = cA.inflate(A, l) : n === Pt && (n = Re)); A.avail_in > 0 && n === be && A.state.wrap > 0 && t[A.next_in] !== 0; )
      cA.inflateReset(A), n = cA.inflate(A, l);
    switch (n) {
      case ya:
      case Pt:
      case Re:
      case Da:
        return this.onEnd(n), this.ended = !0, !1;
    }
    if (g = A.avail_out, A.next_out && (A.avail_out === 0 || n === be))
      if (this.options.to === "string") {
        let w = _e.utf8border(A.output, A.next_out), a = A.next_out - w, r = _e.buf2string(A.output, w);
        A.next_out = a, A.avail_out = i - a, a && A.output.set(A.output.subarray(w, w + a), 0), this.onData(r);
      } else
        this.onData(A.output.length === A.next_out ? A.output : A.output.subarray(0, A.next_out));
    if (!(n === KA && g === 0)) {
      if (n === be)
        return n = cA.inflateEnd(this.strm), this.onEnd(n), this.ended = !0, !0;
      if (A.avail_in === 0) break;
    }
  }
  return !0;
};
Qe.prototype.onData = function(t) {
  this.chunks.push(t);
};
Qe.prototype.onEnd = function(t) {
  t === KA && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = vi.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
function pa(t, e) {
  const A = new Qe(e);
  if (A.push(t), A.err) throw A.msg || Ke[A.err];
  return A.result;
}
var ma = pa, ka = {
  inflate: ma
};
const { inflate: Fa } = ka;
var Vi = Fa;
class Sa extends dA {
  decodeBlock(e) {
    return Vi(new Uint8Array(e)).buffer;
  }
}
const Ga = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Sa
}, Symbol.toStringTag, { value: "Module" }));
class xa extends dA {
  decodeBlock(e) {
    const A = new DataView(e), i = [];
    for (let o = 0; o < e.byteLength; ++o) {
      let n = A.getInt8(o);
      if (n < 0) {
        const l = A.getUint8(o + 1);
        n = -n;
        for (let g = 0; g <= n; ++g)
          i.push(l);
        o += 1;
      } else {
        for (let l = 0; l <= n; ++l)
          i.push(A.getUint8(o + l + 1));
        o += n + 1;
      }
    }
    return new Uint8Array(i).buffer;
  }
}
const ba = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: xa
}, Symbol.toStringTag, { value: "Module" }));
var ji = { exports: {} };
(function(t) {
  /* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */
  (function() {
    var e = function() {
      var n = {};
      n.defaultNoDataValue = -34027999387901484e22, n.decode = function(I, c) {
        c = c || {};
        var B = c.encodedMaskData || c.encodedMaskData === null, s = a(I, c.inputOffset || 0, B), E = c.noDataValue !== null ? c.noDataValue : n.defaultNoDataValue, C = l(
          s,
          c.pixelType || Float32Array,
          c.encodedMaskData,
          E,
          c.returnMask
        ), h = {
          width: s.width,
          height: s.height,
          pixelData: C.resultPixels,
          minValue: C.minValue,
          maxValue: s.pixels.maxValue,
          noDataValue: E
        };
        return C.resultMask && (h.maskData = C.resultMask), c.returnEncodedMask && s.mask && (h.encodedMaskData = s.mask.bitset ? s.mask.bitset : null), c.returnFileInfo && (h.fileInfo = g(s), c.computeUsedBitDepths && (h.fileInfo.bitDepths = w(s))), h;
      };
      var l = function(I, c, B, s, E) {
        var C = 0, h = I.pixels.numBlocksX, y = I.pixels.numBlocksY, p = Math.floor(I.width / h), d = Math.floor(I.height / y), Q = 2 * I.maxZError, f = Number.MAX_VALUE, u;
        B = B || (I.mask ? I.mask.bitset : null);
        var D, F;
        D = new c(I.width * I.height), E && B && (F = new Uint8Array(I.width * I.height));
        for (var k = new Float32Array(p * d), m, x, v = 0; v <= y; v++) {
          var N = v !== y ? d : I.height % y;
          if (N !== 0)
            for (var S = 0; S <= h; S++) {
              var G = S !== h ? p : I.width % h;
              if (G !== 0) {
                var b = v * I.width * d + S * p, U = I.width - G, R = I.pixels.blocks[C], L, M, q;
                R.encoding < 2 ? (R.encoding === 0 ? L = R.rawData : (r(R.stuffedData, R.bitsPerPixel, R.numValidPixels, R.offset, Q, k, I.pixels.maxValue), L = k), M = 0) : R.encoding === 2 ? q = 0 : q = R.offset;
                var O;
                if (B)
                  for (x = 0; x < N; x++) {
                    for (b & 7 && (O = B[b >> 3], O <<= b & 7), m = 0; m < G; m++)
                      b & 7 || (O = B[b >> 3]), O & 128 ? (F && (F[b] = 1), u = R.encoding < 2 ? L[M++] : q, f = f > u ? u : f, D[b++] = u) : (F && (F[b] = 0), D[b++] = s), O <<= 1;
                    b += U;
                  }
                else if (R.encoding < 2)
                  for (x = 0; x < N; x++) {
                    for (m = 0; m < G; m++)
                      u = L[M++], f = f > u ? u : f, D[b++] = u;
                    b += U;
                  }
                else
                  for (f = f > q ? q : f, x = 0; x < N; x++) {
                    for (m = 0; m < G; m++)
                      D[b++] = q;
                    b += U;
                  }
                if (R.encoding === 1 && M !== R.numValidPixels)
                  throw "Block and Mask do not match";
                C++;
              }
            }
        }
        return {
          resultPixels: D,
          resultMask: F,
          minValue: f
        };
      }, g = function(I) {
        return {
          fileIdentifierString: I.fileIdentifierString,
          fileVersion: I.fileVersion,
          imageType: I.imageType,
          height: I.height,
          width: I.width,
          maxZError: I.maxZError,
          eofOffset: I.eofOffset,
          mask: I.mask ? {
            numBlocksX: I.mask.numBlocksX,
            numBlocksY: I.mask.numBlocksY,
            numBytes: I.mask.numBytes,
            maxValue: I.mask.maxValue
          } : null,
          pixels: {
            numBlocksX: I.pixels.numBlocksX,
            numBlocksY: I.pixels.numBlocksY,
            numBytes: I.pixels.numBytes,
            maxValue: I.pixels.maxValue,
            noDataValue: I.noDataValue
          }
        };
      }, w = function(I) {
        for (var c = I.pixels.numBlocksX * I.pixels.numBlocksY, B = {}, s = 0; s < c; s++) {
          var E = I.pixels.blocks[s];
          E.encoding === 0 ? B.float32 = !0 : E.encoding === 1 ? B[E.bitsPerPixel] = !0 : B[0] = !0;
        }
        return Object.keys(B);
      }, a = function(I, c, B) {
        var s = {}, E = new Uint8Array(I, c, 10);
        if (s.fileIdentifierString = String.fromCharCode.apply(null, E), s.fileIdentifierString.trim() !== "CntZImage")
          throw "Unexpected file identifier string: " + s.fileIdentifierString;
        c += 10;
        var C = new DataView(I, c, 24);
        if (s.fileVersion = C.getInt32(0, !0), s.imageType = C.getInt32(4, !0), s.height = C.getUint32(8, !0), s.width = C.getUint32(12, !0), s.maxZError = C.getFloat64(16, !0), c += 24, !B)
          if (C = new DataView(I, c, 16), s.mask = {}, s.mask.numBlocksY = C.getUint32(0, !0), s.mask.numBlocksX = C.getUint32(4, !0), s.mask.numBytes = C.getUint32(8, !0), s.mask.maxValue = C.getFloat32(12, !0), c += 16, s.mask.numBytes > 0) {
            var h = new Uint8Array(Math.ceil(s.width * s.height / 8));
            C = new DataView(I, c, s.mask.numBytes);
            var y = C.getInt16(0, !0), p = 2, d = 0;
            do {
              if (y > 0)
                for (; y--; )
                  h[d++] = C.getUint8(p++);
              else {
                var Q = C.getUint8(p++);
                for (y = -y; y--; )
                  h[d++] = Q;
              }
              y = C.getInt16(p, !0), p += 2;
            } while (p < s.mask.numBytes);
            if (y !== -32768 || d < h.length)
              throw "Unexpected end of mask RLE encoding";
            s.mask.bitset = h, c += s.mask.numBytes;
          } else s.mask.numBytes | s.mask.numBlocksY | s.mask.maxValue || (s.mask.bitset = new Uint8Array(Math.ceil(s.width * s.height / 8)));
        C = new DataView(I, c, 16), s.pixels = {}, s.pixels.numBlocksY = C.getUint32(0, !0), s.pixels.numBlocksX = C.getUint32(4, !0), s.pixels.numBytes = C.getUint32(8, !0), s.pixels.maxValue = C.getFloat32(12, !0), c += 16;
        var f = s.pixels.numBlocksX, u = s.pixels.numBlocksY, D = f + (s.width % f > 0 ? 1 : 0), F = u + (s.height % u > 0 ? 1 : 0);
        s.pixels.blocks = new Array(D * F);
        for (var k = 0, m = 0; m < F; m++)
          for (var x = 0; x < D; x++) {
            var v = 0, N = I.byteLength - c;
            C = new DataView(I, c, Math.min(10, N));
            var S = {};
            s.pixels.blocks[k++] = S;
            var G = C.getUint8(0);
            if (v++, S.encoding = G & 63, S.encoding > 3)
              throw "Invalid block encoding (" + S.encoding + ")";
            if (S.encoding === 2) {
              c++;
              continue;
            }
            if (G !== 0 && G !== 2) {
              if (G >>= 6, S.offsetType = G, G === 2)
                S.offset = C.getInt8(1), v++;
              else if (G === 1)
                S.offset = C.getInt16(1, !0), v += 2;
              else if (G === 0)
                S.offset = C.getFloat32(1, !0), v += 4;
              else
                throw "Invalid block offset type";
              if (S.encoding === 1)
                if (G = C.getUint8(v), v++, S.bitsPerPixel = G & 63, G >>= 6, S.numValidPixelsType = G, G === 2)
                  S.numValidPixels = C.getUint8(v), v++;
                else if (G === 1)
                  S.numValidPixels = C.getUint16(v, !0), v += 2;
                else if (G === 0)
                  S.numValidPixels = C.getUint32(v, !0), v += 4;
                else
                  throw "Invalid valid pixel count type";
            }
            if (c += v, S.encoding !== 3) {
              var b, U;
              if (S.encoding === 0) {
                var R = (s.pixels.numBytes - 1) / 4;
                if (R !== Math.floor(R))
                  throw "uncompressed block has invalid length";
                b = new ArrayBuffer(R * 4), U = new Uint8Array(b), U.set(new Uint8Array(I, c, R * 4));
                var L = new Float32Array(b);
                S.rawData = L, c += R * 4;
              } else if (S.encoding === 1) {
                var M = Math.ceil(S.numValidPixels * S.bitsPerPixel / 8), q = Math.ceil(M / 4);
                b = new ArrayBuffer(q * 4), U = new Uint8Array(b), U.set(new Uint8Array(I, c, M)), S.stuffedData = new Uint32Array(b), c += M;
              }
            }
          }
        return s.eofOffset = c, s;
      }, r = function(I, c, B, s, E, C, h) {
        var y = (1 << c) - 1, p = 0, d, Q = 0, f, u, D = Math.ceil((h - s) / E), F = I.length * 4 - Math.ceil(c * B / 8);
        for (I[I.length - 1] <<= 8 * F, d = 0; d < B; d++) {
          if (Q === 0 && (u = I[p++], Q = 32), Q >= c)
            f = u >>> Q - c & y, Q -= c;
          else {
            var k = c - Q;
            f = (u & y) << k & y, u = I[p++], Q = 32 - k, f += u >>> Q;
          }
          C[d] = f < D ? s + f * E : h;
        }
        return C;
      };
      return n;
    }(), A = /* @__PURE__ */ function() {
      var n = {
        //methods ending with 2 are for the new byte order used by Lerc2.3 and above.
        //originalUnstuff is used to unpack Huffman code table. code is duplicated to unstuffx for performance reasons.
        unstuff: function(a, r, I, c, B, s, E, C) {
          var h = (1 << I) - 1, y = 0, p, d = 0, Q, f, u, D, F = a.length * 4 - Math.ceil(I * c / 8);
          if (a[a.length - 1] <<= 8 * F, B)
            for (p = 0; p < c; p++)
              d === 0 && (f = a[y++], d = 32), d >= I ? (Q = f >>> d - I & h, d -= I) : (u = I - d, Q = (f & h) << u & h, f = a[y++], d = 32 - u, Q += f >>> d), r[p] = B[Q];
          else
            for (D = Math.ceil((C - s) / E), p = 0; p < c; p++)
              d === 0 && (f = a[y++], d = 32), d >= I ? (Q = f >>> d - I & h, d -= I) : (u = I - d, Q = (f & h) << u & h, f = a[y++], d = 32 - u, Q += f >>> d), r[p] = Q < D ? s + Q * E : C;
        },
        unstuffLUT: function(a, r, I, c, B, s) {
          var E = (1 << r) - 1, C = 0, h = 0, y = 0, p = 0, d = 0, Q, f = [], u = a.length * 4 - Math.ceil(r * I / 8);
          a[a.length - 1] <<= 8 * u;
          var D = Math.ceil((s - c) / B);
          for (h = 0; h < I; h++)
            p === 0 && (Q = a[C++], p = 32), p >= r ? (d = Q >>> p - r & E, p -= r) : (y = r - p, d = (Q & E) << y & E, Q = a[C++], p = 32 - y, d += Q >>> p), f[h] = d < D ? c + d * B : s;
          return f.unshift(c), f;
        },
        unstuff2: function(a, r, I, c, B, s, E, C) {
          var h = (1 << I) - 1, y = 0, p, d = 0, Q = 0, f, u, D;
          if (B)
            for (p = 0; p < c; p++)
              d === 0 && (u = a[y++], d = 32, Q = 0), d >= I ? (f = u >>> Q & h, d -= I, Q += I) : (D = I - d, f = u >>> Q & h, u = a[y++], d = 32 - D, f |= (u & (1 << D) - 1) << I - D, Q = D), r[p] = B[f];
          else {
            var F = Math.ceil((C - s) / E);
            for (p = 0; p < c; p++)
              d === 0 && (u = a[y++], d = 32, Q = 0), d >= I ? (f = u >>> Q & h, d -= I, Q += I) : (D = I - d, f = u >>> Q & h, u = a[y++], d = 32 - D, f |= (u & (1 << D) - 1) << I - D, Q = D), r[p] = f < F ? s + f * E : C;
          }
          return r;
        },
        unstuffLUT2: function(a, r, I, c, B, s) {
          var E = (1 << r) - 1, C = 0, h = 0, y = 0, p = 0, d = 0, Q = 0, f, u = [], D = Math.ceil((s - c) / B);
          for (h = 0; h < I; h++)
            p === 0 && (f = a[C++], p = 32, Q = 0), p >= r ? (d = f >>> Q & E, p -= r, Q += r) : (y = r - p, d = f >>> Q & E, f = a[C++], p = 32 - y, d |= (f & (1 << y) - 1) << r - y, Q = y), u[h] = d < D ? c + d * B : s;
          return u.unshift(c), u;
        },
        originalUnstuff: function(a, r, I, c) {
          var B = (1 << I) - 1, s = 0, E, C = 0, h, y, p, d = a.length * 4 - Math.ceil(I * c / 8);
          for (a[a.length - 1] <<= 8 * d, E = 0; E < c; E++)
            C === 0 && (y = a[s++], C = 32), C >= I ? (h = y >>> C - I & B, C -= I) : (p = I - C, h = (y & B) << p & B, y = a[s++], C = 32 - p, h += y >>> C), r[E] = h;
          return r;
        },
        originalUnstuff2: function(a, r, I, c) {
          var B = (1 << I) - 1, s = 0, E, C = 0, h = 0, y, p, d;
          for (E = 0; E < c; E++)
            C === 0 && (p = a[s++], C = 32, h = 0), C >= I ? (y = p >>> h & B, C -= I, h += I) : (d = I - C, y = p >>> h & B, p = a[s++], C = 32 - d, y |= (p & (1 << d) - 1) << I - d, h = d), r[E] = y;
          return r;
        }
      }, l = {
        HUFFMAN_LUT_BITS_MAX: 12,
        //use 2^12 lut, treat it like constant
        computeChecksumFletcher32: function(a) {
          for (var r = 65535, I = 65535, c = a.length, B = Math.floor(c / 2), s = 0; B; ) {
            var E = B >= 359 ? 359 : B;
            B -= E;
            do
              r += a[s++] << 8, I += r += a[s++];
            while (--E);
            r = (r & 65535) + (r >>> 16), I = (I & 65535) + (I >>> 16);
          }
          return c & 1 && (I += r += a[s] << 8), r = (r & 65535) + (r >>> 16), I = (I & 65535) + (I >>> 16), (I << 16 | r) >>> 0;
        },
        readHeaderInfo: function(a, r) {
          var I = r.ptr, c = new Uint8Array(a, I, 6), B = {};
          if (B.fileIdentifierString = String.fromCharCode.apply(null, c), B.fileIdentifierString.lastIndexOf("Lerc2", 0) !== 0)
            throw "Unexpected file identifier string (expect Lerc2 ): " + B.fileIdentifierString;
          I += 6;
          var s = new DataView(a, I, 8), E = s.getInt32(0, !0);
          B.fileVersion = E, I += 4, E >= 3 && (B.checksum = s.getUint32(4, !0), I += 4), s = new DataView(a, I, 12), B.height = s.getUint32(0, !0), B.width = s.getUint32(4, !0), I += 8, E >= 4 ? (B.numDims = s.getUint32(8, !0), I += 4) : B.numDims = 1, s = new DataView(a, I, 40), B.numValidPixel = s.getUint32(0, !0), B.microBlockSize = s.getInt32(4, !0), B.blobSize = s.getInt32(8, !0), B.imageType = s.getInt32(12, !0), B.maxZError = s.getFloat64(16, !0), B.zMin = s.getFloat64(24, !0), B.zMax = s.getFloat64(32, !0), I += 40, r.headerInfo = B, r.ptr = I;
          var C, h;
          if (E >= 3 && (h = E >= 4 ? 52 : 48, C = this.computeChecksumFletcher32(new Uint8Array(a, I - h, B.blobSize - 14)), C !== B.checksum))
            throw "Checksum failed.";
          return !0;
        },
        checkMinMaxRanges: function(a, r) {
          var I = r.headerInfo, c = this.getDataTypeArray(I.imageType), B = I.numDims * this.getDataTypeSize(I.imageType), s = this.readSubArray(a, r.ptr, c, B), E = this.readSubArray(a, r.ptr + B, c, B);
          r.ptr += 2 * B;
          var C, h = !0;
          for (C = 0; C < I.numDims; C++)
            if (s[C] !== E[C]) {
              h = !1;
              break;
            }
          return I.minValues = s, I.maxValues = E, h;
        },
        readSubArray: function(a, r, I, c) {
          var B;
          if (I === Uint8Array)
            B = new Uint8Array(a, r, c);
          else {
            var s = new ArrayBuffer(c), E = new Uint8Array(s);
            E.set(new Uint8Array(a, r, c)), B = new I(s);
          }
          return B;
        },
        readMask: function(a, r) {
          var I = r.ptr, c = r.headerInfo, B = c.width * c.height, s = c.numValidPixel, E = new DataView(a, I, 4), C = {};
          if (C.numBytes = E.getUint32(0, !0), I += 4, (s === 0 || B === s) && C.numBytes !== 0)
            throw "invalid mask";
          var h, y;
          if (s === 0)
            h = new Uint8Array(Math.ceil(B / 8)), C.bitset = h, y = new Uint8Array(B), r.pixels.resultMask = y, I += C.numBytes;
          else if (C.numBytes > 0) {
            h = new Uint8Array(Math.ceil(B / 8)), E = new DataView(a, I, C.numBytes);
            var p = E.getInt16(0, !0), d = 2, Q = 0, f = 0;
            do {
              if (p > 0)
                for (; p--; )
                  h[Q++] = E.getUint8(d++);
              else
                for (f = E.getUint8(d++), p = -p; p--; )
                  h[Q++] = f;
              p = E.getInt16(d, !0), d += 2;
            } while (d < C.numBytes);
            if (p !== -32768 || Q < h.length)
              throw "Unexpected end of mask RLE encoding";
            y = new Uint8Array(B);
            var u = 0, D = 0;
            for (D = 0; D < B; D++)
              D & 7 ? (u = h[D >> 3], u <<= D & 7) : u = h[D >> 3], u & 128 && (y[D] = 1);
            r.pixels.resultMask = y, C.bitset = h, I += C.numBytes;
          }
          return r.ptr = I, r.mask = C, !0;
        },
        readDataOneSweep: function(a, r, I, c) {
          var B = r.ptr, s = r.headerInfo, E = s.numDims, C = s.width * s.height, h = s.imageType, y = s.numValidPixel * l.getDataTypeSize(h) * E, p, d = r.pixels.resultMask;
          if (I === Uint8Array)
            p = new Uint8Array(a, B, y);
          else {
            var Q = new ArrayBuffer(y), f = new Uint8Array(Q);
            f.set(new Uint8Array(a, B, y)), p = new I(Q);
          }
          if (p.length === C * E)
            c ? r.pixels.resultPixels = l.swapDimensionOrder(p, C, E, I, !0) : r.pixels.resultPixels = p;
          else {
            r.pixels.resultPixels = new I(C * E);
            var u = 0, D = 0, F = 0, k = 0;
            if (E > 1) {
              if (c) {
                for (D = 0; D < C; D++)
                  if (d[D])
                    for (k = D, F = 0; F < E; F++, k += C)
                      r.pixels.resultPixels[k] = p[u++];
              } else
                for (D = 0; D < C; D++)
                  if (d[D])
                    for (k = D * E, F = 0; F < E; F++)
                      r.pixels.resultPixels[k + F] = p[u++];
            } else
              for (D = 0; D < C; D++)
                d[D] && (r.pixels.resultPixels[D] = p[u++]);
          }
          return B += y, r.ptr = B, !0;
        },
        readHuffmanTree: function(a, r) {
          var I = this.HUFFMAN_LUT_BITS_MAX, c = new DataView(a, r.ptr, 16);
          r.ptr += 16;
          var B = c.getInt32(0, !0);
          if (B < 2)
            throw "unsupported Huffman version";
          var s = c.getInt32(4, !0), E = c.getInt32(8, !0), C = c.getInt32(12, !0);
          if (E >= C)
            return !1;
          var h = new Uint32Array(C - E);
          l.decodeBits(a, r, h);
          var y = [], p, d, Q, f;
          for (p = E; p < C; p++)
            d = p - (p < s ? 0 : s), y[d] = { first: h[p - E], second: null };
          var u = a.byteLength - r.ptr, D = Math.ceil(u / 4), F = new ArrayBuffer(D * 4), k = new Uint8Array(F);
          k.set(new Uint8Array(a, r.ptr, u));
          var m = new Uint32Array(F), x = 0, v, N = 0;
          for (v = m[0], p = E; p < C; p++)
            d = p - (p < s ? 0 : s), f = y[d].first, f > 0 && (y[d].second = v << x >>> 32 - f, 32 - x >= f ? (x += f, x === 32 && (x = 0, N++, v = m[N])) : (x += f - 32, N++, v = m[N], y[d].second |= v >>> 32 - x));
          var S = 0, G = 0, b = new g();
          for (p = 0; p < y.length; p++)
            y[p] !== void 0 && (S = Math.max(S, y[p].first));
          S >= I ? G = I : G = S;
          var U = [], R, L, M, q, O, T;
          for (p = E; p < C; p++)
            if (d = p - (p < s ? 0 : s), f = y[d].first, f > 0)
              if (R = [f, d], f <= G)
                for (L = y[d].second << G - f, M = 1 << G - f, Q = 0; Q < M; Q++)
                  U[L | Q] = R;
              else
                for (L = y[d].second, T = b, q = f - 1; q >= 0; q--)
                  O = L >>> q & 1, O ? (T.right || (T.right = new g()), T = T.right) : (T.left || (T.left = new g()), T = T.left), q === 0 && !T.val && (T.val = R[1]);
          return {
            decodeLut: U,
            numBitsLUTQick: G,
            numBitsLUT: S,
            tree: b,
            stuffedData: m,
            srcPtr: N,
            bitPos: x
          };
        },
        readHuffman: function(a, r, I, c) {
          var B = r.headerInfo, s = B.numDims, E = r.headerInfo.height, C = r.headerInfo.width, h = C * E, y = this.readHuffmanTree(a, r), p = y.decodeLut, d = y.tree, Q = y.stuffedData, f = y.srcPtr, u = y.bitPos, D = y.numBitsLUTQick, F = y.numBitsLUT, k = r.headerInfo.imageType === 0 ? 128 : 0, m, x, v, N = r.pixels.resultMask, S, G, b, U, R, L, M, q = 0;
          u > 0 && (f++, u = 0);
          var O = Q[f], T = r.encodeMode === 1, J = new I(h * s), H = J, K;
          if (s < 2 || T) {
            for (K = 0; K < s; K++)
              if (s > 1 && (H = new I(J.buffer, h * K, h), q = 0), r.headerInfo.numValidPixel === C * E)
                for (L = 0, U = 0; U < E; U++)
                  for (R = 0; R < C; R++, L++) {
                    if (x = 0, S = O << u >>> 32 - D, G = S, 32 - u < D && (S |= Q[f + 1] >>> 64 - u - D, G = S), p[G])
                      x = p[G][1], u += p[G][0];
                    else
                      for (S = O << u >>> 32 - F, G = S, 32 - u < F && (S |= Q[f + 1] >>> 64 - u - F, G = S), m = d, M = 0; M < F; M++)
                        if (b = S >>> F - M - 1 & 1, m = b ? m.right : m.left, !(m.left || m.right)) {
                          x = m.val, u = u + M + 1;
                          break;
                        }
                    u >= 32 && (u -= 32, f++, O = Q[f]), v = x - k, T ? (R > 0 ? v += q : U > 0 ? v += H[L - C] : v += q, v &= 255, H[L] = v, q = v) : H[L] = v;
                  }
              else
                for (L = 0, U = 0; U < E; U++)
                  for (R = 0; R < C; R++, L++)
                    if (N[L]) {
                      if (x = 0, S = O << u >>> 32 - D, G = S, 32 - u < D && (S |= Q[f + 1] >>> 64 - u - D, G = S), p[G])
                        x = p[G][1], u += p[G][0];
                      else
                        for (S = O << u >>> 32 - F, G = S, 32 - u < F && (S |= Q[f + 1] >>> 64 - u - F, G = S), m = d, M = 0; M < F; M++)
                          if (b = S >>> F - M - 1 & 1, m = b ? m.right : m.left, !(m.left || m.right)) {
                            x = m.val, u = u + M + 1;
                            break;
                          }
                      u >= 32 && (u -= 32, f++, O = Q[f]), v = x - k, T ? (R > 0 && N[L - 1] ? v += q : U > 0 && N[L - C] ? v += H[L - C] : v += q, v &= 255, H[L] = v, q = v) : H[L] = v;
                    }
          } else
            for (L = 0, U = 0; U < E; U++)
              for (R = 0; R < C; R++)
                if (L = U * C + R, !N || N[L])
                  for (K = 0; K < s; K++, L += h) {
                    if (x = 0, S = O << u >>> 32 - D, G = S, 32 - u < D && (S |= Q[f + 1] >>> 64 - u - D, G = S), p[G])
                      x = p[G][1], u += p[G][0];
                    else
                      for (S = O << u >>> 32 - F, G = S, 32 - u < F && (S |= Q[f + 1] >>> 64 - u - F, G = S), m = d, M = 0; M < F; M++)
                        if (b = S >>> F - M - 1 & 1, m = b ? m.right : m.left, !(m.left || m.right)) {
                          x = m.val, u = u + M + 1;
                          break;
                        }
                    u >= 32 && (u -= 32, f++, O = Q[f]), v = x - k, H[L] = v;
                  }
          r.ptr = r.ptr + (f + 1) * 4 + (u > 0 ? 4 : 0), r.pixels.resultPixels = J, s > 1 && !c && (r.pixels.resultPixels = l.swapDimensionOrder(J, h, s, I));
        },
        decodeBits: function(a, r, I, c, B) {
          {
            var s = r.headerInfo, E = s.fileVersion, C = 0, h = a.byteLength - r.ptr >= 5 ? 5 : a.byteLength - r.ptr, y = new DataView(a, r.ptr, h), p = y.getUint8(0);
            C++;
            var d = p >> 6, Q = d === 0 ? 4 : 3 - d, f = (p & 32) > 0, u = p & 31, D = 0;
            if (Q === 1)
              D = y.getUint8(C), C++;
            else if (Q === 2)
              D = y.getUint16(C, !0), C += 2;
            else if (Q === 4)
              D = y.getUint32(C, !0), C += 4;
            else
              throw "Invalid valid pixel count type";
            var F = 2 * s.maxZError, k, m, x, v, N, S, G, b, U, R = s.numDims > 1 ? s.maxValues[B] : s.zMax;
            if (f) {
              for (r.counter.lut++, b = y.getUint8(C), C++, v = Math.ceil((b - 1) * u / 8), N = Math.ceil(v / 4), m = new ArrayBuffer(N * 4), x = new Uint8Array(m), r.ptr += C, x.set(new Uint8Array(a, r.ptr, v)), G = new Uint32Array(m), r.ptr += v, U = 0; b - 1 >>> U; )
                U++;
              v = Math.ceil(D * U / 8), N = Math.ceil(v / 4), m = new ArrayBuffer(N * 4), x = new Uint8Array(m), x.set(new Uint8Array(a, r.ptr, v)), k = new Uint32Array(m), r.ptr += v, E >= 3 ? S = n.unstuffLUT2(G, u, b - 1, c, F, R) : S = n.unstuffLUT(G, u, b - 1, c, F, R), E >= 3 ? n.unstuff2(k, I, U, D, S) : n.unstuff(k, I, U, D, S);
            } else
              r.counter.bitstuffer++, U = u, r.ptr += C, U > 0 && (v = Math.ceil(D * U / 8), N = Math.ceil(v / 4), m = new ArrayBuffer(N * 4), x = new Uint8Array(m), x.set(new Uint8Array(a, r.ptr, v)), k = new Uint32Array(m), r.ptr += v, E >= 3 ? c == null ? n.originalUnstuff2(k, I, U, D) : n.unstuff2(k, I, U, D, !1, c, F, R) : c == null ? n.originalUnstuff(k, I, U, D) : n.unstuff(k, I, U, D, !1, c, F, R));
          }
        },
        readTiles: function(a, r, I, c) {
          var B = r.headerInfo, s = B.width, E = B.height, C = s * E, h = B.microBlockSize, y = B.imageType, p = l.getDataTypeSize(y), d = Math.ceil(s / h), Q = Math.ceil(E / h);
          r.pixels.numBlocksY = Q, r.pixels.numBlocksX = d, r.pixels.ptr = 0;
          var f = 0, u = 0, D = 0, F = 0, k = 0, m = 0, x = 0, v = 0, N = 0, S = 0, G = 0, b = 0, U = 0, R = 0, L = 0, M = 0, q, O, T, J, H, K, _ = new I(h * h), V = E % h || h, j = s % h || h, tA, AA, XA = B.numDims, wA, aA = r.pixels.resultMask, iA = r.pixels.resultPixels, Wi = B.fileVersion, st = Wi >= 5 ? 14 : 15, QA, he = B.zMax, hA;
          for (D = 0; D < Q; D++)
            for (k = D !== Q - 1 ? h : V, F = 0; F < d; F++)
              for (m = F !== d - 1 ? h : j, G = D * s * h + F * h, b = s - m, wA = 0; wA < XA; wA++) {
                if (XA > 1 ? (hA = iA, G = D * s * h + F * h, iA = new I(r.pixels.resultPixels.buffer, C * wA * p, C), he = B.maxValues[wA]) : hA = null, x = a.byteLength - r.ptr, q = new DataView(a, r.ptr, Math.min(10, x)), O = {}, M = 0, v = q.getUint8(0), M++, QA = B.fileVersion >= 5 ? v & 4 : 0, N = v >> 6 & 255, S = v >> 2 & st, S !== (F * h >> 3 & st) || QA && wA === 0)
                  throw "integrity issue";
                if (K = v & 3, K > 3)
                  throw r.ptr += M, "Invalid block encoding (" + K + ")";
                if (K === 2) {
                  if (QA)
                    if (aA)
                      for (f = 0; f < k; f++)
                        for (u = 0; u < m; u++)
                          aA[G] && (iA[G] = hA[G]), G++;
                    else
                      for (f = 0; f < k; f++)
                        for (u = 0; u < m; u++)
                          iA[G] = hA[G], G++;
                  r.counter.constant++, r.ptr += M;
                  continue;
                } else if (K === 0) {
                  if (QA)
                    throw "integrity issue";
                  if (r.counter.uncompressed++, r.ptr += M, U = k * m * p, R = a.byteLength - r.ptr, U = U < R ? U : R, T = new ArrayBuffer(U % p === 0 ? U : U + p - U % p), J = new Uint8Array(T), J.set(new Uint8Array(a, r.ptr, U)), H = new I(T), L = 0, aA)
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        aA[G] && (iA[G] = H[L++]), G++;
                      G += b;
                    }
                  else
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        iA[G++] = H[L++];
                      G += b;
                    }
                  r.ptr += L * p;
                } else if (tA = l.getDataTypeUsed(QA && y < 6 ? 4 : y, N), AA = l.getOnePixel(O, M, tA, q), M += l.getDataTypeSize(tA), K === 3)
                  if (r.ptr += M, r.counter.constantoffset++, aA)
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        aA[G] && (iA[G] = QA ? Math.min(he, hA[G] + AA) : AA), G++;
                      G += b;
                    }
                  else
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        iA[G] = QA ? Math.min(he, hA[G] + AA) : AA, G++;
                      G += b;
                    }
                else if (r.ptr += M, l.decodeBits(a, r, _, AA, wA), M = 0, QA)
                  if (aA)
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        aA[G] && (iA[G] = _[M++] + hA[G]), G++;
                      G += b;
                    }
                  else
                    for (f = 0; f < k; f++) {
                      for (u = 0; u < m; u++)
                        iA[G] = _[M++] + hA[G], G++;
                      G += b;
                    }
                else if (aA)
                  for (f = 0; f < k; f++) {
                    for (u = 0; u < m; u++)
                      aA[G] && (iA[G] = _[M++]), G++;
                    G += b;
                  }
                else
                  for (f = 0; f < k; f++) {
                    for (u = 0; u < m; u++)
                      iA[G++] = _[M++];
                    G += b;
                  }
              }
          XA > 1 && !c && (r.pixels.resultPixels = l.swapDimensionOrder(r.pixels.resultPixels, C, XA, I));
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
            pixelType: l.getPixelType(a.headerInfo.imageType),
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
          var I = a.headerInfo.zMax, c = a.headerInfo.zMin, B = a.headerInfo.maxValues, s = a.headerInfo.numDims, E = a.headerInfo.height * a.headerInfo.width, C = 0, h = 0, y = 0, p = a.pixels.resultMask, d = a.pixels.resultPixels;
          if (p)
            if (s > 1) {
              if (r)
                for (C = 0; C < s; C++)
                  for (y = C * E, I = B[C], h = 0; h < E; h++)
                    p[h] && (d[y + h] = I);
              else
                for (h = 0; h < E; h++)
                  if (p[h])
                    for (y = h * s, C = 0; C < s; C++)
                      d[y + s] = B[C];
            } else
              for (h = 0; h < E; h++)
                p[h] && (d[h] = I);
          else if (s > 1 && c !== I)
            if (r)
              for (C = 0; C < s; C++)
                for (y = C * E, I = B[C], h = 0; h < E; h++)
                  d[y + h] = I;
            else
              for (h = 0; h < E; h++)
                for (y = h * s, C = 0; C < s; C++)
                  d[y + C] = B[C];
          else
            for (h = 0; h < E * s; h++)
              d[h] = I;
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
          var I;
          switch (a) {
            case 0:
              I = r >= -128 && r <= 127;
              break;
            case 1:
              I = r >= 0 && r <= 255;
              break;
            case 2:
              I = r >= -32768 && r <= 32767;
              break;
            case 3:
              I = r >= 0 && r <= 65536;
              break;
            case 4:
              I = r >= -2147483648 && r <= 2147483647;
              break;
            case 5:
              I = r >= 0 && r <= 4294967296;
              break;
            case 6:
              I = r >= -34027999387901484e22 && r <= 34027999387901484e22;
              break;
            case 7:
              I = r >= -17976931348623157e292 && r <= 17976931348623157e292;
              break;
            default:
              I = !1;
          }
          return I;
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
          var I = a;
          switch (a) {
            case 2:
            case 4:
              I = a - r;
              break;
            case 3:
            case 5:
              I = a - 2 * r;
              break;
            case 6:
              r === 0 ? I = a : r === 1 ? I = 2 : I = 1;
              break;
            case 7:
              r === 0 ? I = a : I = a - 2 * r + 1;
              break;
            default:
              I = a;
              break;
          }
          return I;
        },
        getOnePixel: function(a, r, I, c) {
          var B = 0;
          switch (I) {
            case 0:
              B = c.getInt8(r);
              break;
            case 1:
              B = c.getUint8(r);
              break;
            case 2:
              B = c.getInt16(r, !0);
              break;
            case 3:
              B = c.getUint16(r, !0);
              break;
            case 4:
              B = c.getInt32(r, !0);
              break;
            case 5:
              B = c.getUInt32(r, !0);
              break;
            case 6:
              B = c.getFloat32(r, !0);
              break;
            case 7:
              B = c.getFloat64(r, !0);
              break;
            default:
              throw "the decoder does not understand this pixel type";
          }
          return B;
        },
        swapDimensionOrder: function(a, r, I, c, B) {
          var s = 0, E = 0, C = 0, h = 0, y = a;
          if (I > 1)
            if (y = new c(r * I), B)
              for (s = 0; s < r; s++)
                for (h = s, C = 0; C < I; C++, h += r)
                  y[h] = a[E++];
            else
              for (s = 0; s < r; s++)
                for (h = s, C = 0; C < I; C++, h += r)
                  y[E++] = a[h];
          return y;
        }
      }, g = function(a, r, I) {
        this.val = a, this.left = r, this.right = I;
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
          var I = r.noDataValue, c = 0, B = {};
          if (B.ptr = r.inputOffset || 0, B.pixels = {}, !!l.readHeaderInfo(a, B)) {
            var s = B.headerInfo, E = s.fileVersion, C = l.getDataTypeArray(s.imageType);
            if (E > 5)
              throw "unsupported lerc version 2." + E;
            l.readMask(a, B), s.numValidPixel !== s.width * s.height && !B.pixels.resultMask && (B.pixels.resultMask = r.maskData);
            var h = s.width * s.height;
            B.pixels.resultPixels = new C(h * s.numDims), B.counter = {
              onesweep: 0,
              uncompressed: 0,
              lut: 0,
              bitstuffer: 0,
              constant: 0,
              constantoffset: 0
            };
            var y = !r.returnPixelInterleavedDims;
            if (s.numValidPixel !== 0)
              if (s.zMax === s.zMin)
                l.constructConstantSurface(B, y);
              else if (E >= 4 && l.checkMinMaxRanges(a, B))
                l.constructConstantSurface(B, y);
              else {
                var p = new DataView(a, B.ptr, 2), d = p.getUint8(0);
                if (B.ptr++, d)
                  l.readDataOneSweep(a, B, C, y);
                else if (E > 1 && s.imageType <= 1 && Math.abs(s.maxZError - 0.5) < 1e-5) {
                  var Q = p.getUint8(1);
                  if (B.ptr++, B.encodeMode = Q, Q > 2 || E < 4 && Q > 1)
                    throw "Invalid Huffman flag " + Q;
                  Q ? l.readHuffman(a, B, C, y) : l.readTiles(a, B, C, y);
                } else
                  l.readTiles(a, B, C, y);
              }
            B.eofOffset = B.ptr;
            var f;
            r.inputOffset ? (f = B.headerInfo.blobSize + r.inputOffset - B.ptr, Math.abs(f) >= 1 && (B.eofOffset = r.inputOffset + B.headerInfo.blobSize)) : (f = B.headerInfo.blobSize - B.ptr, Math.abs(f) >= 1 && (B.eofOffset = B.headerInfo.blobSize));
            var u = {
              width: s.width,
              height: s.height,
              pixelData: B.pixels.resultPixels,
              minValue: s.zMin,
              maxValue: s.zMax,
              validPixelCount: s.numValidPixel,
              dimCount: s.numDims,
              dimStats: {
                minValues: s.minValues,
                maxValues: s.maxValues
              },
              maskData: B.pixels.resultMask
              //noDataValue: noDataValue
            };
            if (B.pixels.resultMask && l.isValidPixelValue(s.imageType, I)) {
              var D = B.pixels.resultMask;
              for (c = 0; c < h; c++)
                D[c] || (u.pixelData[c] = I);
              u.noDataValue = I;
            }
            return B.noDataValue = I, r.returnFileInfo && (u.fileInfo = l.formatFileInfo(B)), u;
          }
        },
        getBandCount: function(a) {
          var r = 0, I = 0, c = {};
          for (c.ptr = 0, c.pixels = {}; I < a.byteLength - 58; )
            l.readHeaderInfo(a, c), I += c.headerInfo.blobSize, r++, c.ptr = I;
          return r;
        }
      };
      return w;
    }(), i = function() {
      var n = new ArrayBuffer(4), l = new Uint8Array(n), g = new Uint32Array(n);
      return g[0] = 1, l[0] === 1;
    }(), o = {
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
      decode: function(n, l) {
        if (!i)
          throw "Big endian system is not supported.";
        l = l || {};
        var g = l.inputOffset || 0, w = new Uint8Array(n, g, 10), a = String.fromCharCode.apply(null, w), r, I;
        if (a.trim() === "CntZImage")
          r = e, I = 1;
        else if (a.substring(0, 5) === "Lerc2")
          r = A, I = 2;
        else
          throw "Unexpected file identifier string: " + a;
        for (var c = 0, B = n.byteLength - 10, s, E = [], C, h, y = {
          width: 0,
          height: 0,
          pixels: [],
          pixelType: l.pixelType,
          mask: null,
          statistics: []
        }, p = 0; g < B; ) {
          var d = r.decode(n, {
            inputOffset: g,
            //for both lerc1 and lerc2
            encodedMaskData: s,
            //lerc1 only
            maskData: h,
            //lerc2 only
            returnMask: c === 0,
            //lerc1 only
            returnEncodedMask: c === 0,
            //lerc1 only
            returnFileInfo: !0,
            //for both lerc1 and lerc2
            returnPixelInterleavedDims: l.returnPixelInterleavedDims,
            //for ndim lerc2 only
            pixelType: l.pixelType || null,
            //lerc1 only
            noDataValue: l.noDataValue || null
            //lerc1 only
          });
          g = d.fileInfo.eofOffset, h = d.maskData, c === 0 && (s = d.encodedMaskData, y.width = d.width, y.height = d.height, y.dimCount = d.dimCount || 1, y.pixelType = d.pixelType || d.fileInfo.pixelType, y.mask = h), I > 1 && (h && E.push(h), d.fileInfo.mask && d.fileInfo.mask.numBytes > 0 && p++), c++, y.pixels.push(d.pixelData), y.statistics.push({
            minValue: d.minValue,
            maxValue: d.maxValue,
            noDataValue: d.noDataValue,
            dimStats: d.dimStats
          });
        }
        var Q, f, u;
        if (I > 1 && p > 1) {
          for (u = y.width * y.height, y.bandMasks = E, h = new Uint8Array(u), h.set(E[0]), Q = 1; Q < E.length; Q++)
            for (C = E[Q], f = 0; f < u; f++)
              h[f] = h[f] & C[f];
          y.maskData = h;
        }
        return y;
      }
    };
    t.exports ? t.exports = o : this.Lerc = o;
  })();
})(ji);
var Ra = ji.exports;
const va = /* @__PURE__ */ ze(Ra);
let TA, fA, Pe;
const ve = {
  env: {
    emscripten_notify_memory_growth: function(t) {
      Pe = new Uint8Array(fA.exports.memory.buffer);
    }
  }
};
class Ua {
  init() {
    return TA || (typeof fetch < "u" ? TA = fetch("data:application/wasm;base64," + Vt).then((e) => e.arrayBuffer()).then((e) => WebAssembly.instantiate(e, ve)).then(this._init) : TA = WebAssembly.instantiate(Buffer.from(Vt, "base64"), ve).then(this._init), TA);
  }
  _init(e) {
    fA = e.instance, ve.env.emscripten_notify_memory_growth(0);
  }
  decode(e, A = 0) {
    if (!fA) throw new Error("ZSTDDecoder: Await .init() before decoding.");
    const i = e.byteLength, o = fA.exports.malloc(i);
    Pe.set(e, o), A = A || Number(fA.exports.ZSTD_findDecompressedSize(o, i));
    const n = fA.exports.malloc(A), l = fA.exports.ZSTD_decompress(n, A, o, i), g = Pe.slice(n, n + l);
    return fA.exports.free(o), fA.exports.free(n), g;
  }
}
const Vt = "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IAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQh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ASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigC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C0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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", Xi = new Ua();
class La extends dA {
  constructor(e) {
    super(), this.planarConfiguration = typeof e.PlanarConfiguration < "u" ? e.PlanarConfiguration : 1, this.samplesPerPixel = typeof e.SamplesPerPixel < "u" ? e.SamplesPerPixel : 1, this.addCompression = e.LercParameters[Ci.AddCompression];
  }
  decodeBlock(e) {
    switch (this.addCompression) {
      case ge.None:
        break;
      case ge.Deflate:
        e = Vi(new Uint8Array(e)).buffer;
        break;
      case ge.Zstandard:
        e = Xi.decode(new Uint8Array(e)).buffer;
        break;
      default:
        throw new Error(`Unsupported LERC additional compression method identifier: ${this.addCompression}`);
    }
    return va.decode(e, { returnPixelInterleavedDims: this.planarConfiguration === 1 }).pixels[0].buffer;
  }
}
const Ma = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: La,
  zstd: Xi
}, Symbol.toStringTag, { value: "Module" }));
class Na extends dA {
  constructor() {
    if (super(), typeof createImageBitmap > "u")
      throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");
    if (typeof document > "u" && typeof OffscreenCanvas > "u")
      throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");
  }
  async decode(e, A) {
    const i = new Blob([A]), o = await createImageBitmap(i);
    let n;
    typeof document < "u" ? (n = document.createElement("canvas"), n.width = o.width, n.height = o.height) : n = new OffscreenCanvas(o.width, o.height);
    const l = n.getContext("2d");
    return l.drawImage(o, 0, 0), l.getImageData(0, 0, o.width, o.height).data.buffer;
  }
}
const Ta = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Na
}, Symbol.toStringTag, { value: "Module" })), qa = Worker;
function Ja() {
  const t = 'function A(A,e,t,i,r,I,g){try{var n=A[I](g),a=n.value}catch(A){return void t(A)}n.done?e(a):Promise.resolve(a).then(i,r)}function e(e){return function(){var t=this,i=arguments;return new Promise((function(r,I){var g=e.apply(t,i);function n(e){A(g,r,I,n,a,"next",e)}function a(e){A(g,r,I,n,a,"throw",e)}n(void 0)}))}}function t(A){return t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(A){return typeof A}:function(A){return A&&"function"==typeof Symbol&&A.constructor===Symbol&&A!==Symbol.prototype?"symbol":typeof A},t(A)}var i={exports:{}};!function(A){var e=function(A){var e,i=Object.prototype,r=i.hasOwnProperty,I="function"==typeof Symbol?Symbol:{},g=I.iterator||"@@iterator",n=I.asyncIterator||"@@asyncIterator",a=I.toStringTag||"@@toStringTag";function o(A,e,t){return Object.defineProperty(A,e,{value:t,enumerable:!0,configurable:!0,writable:!0}),A[e]}try{o({},"")}catch(A){o=function(A,e,t){return A[e]=t}}function B(A,e,t,i){var r=e&&e.prototype instanceof h?e:h,I=Object.create(r.prototype),g=new S(i||[]);return I._invoke=function(A,e,t){var i=Q;return function(r,I){if(i===s)throw new Error("Generator is already running");if(i===f){if("throw"===r)throw I;return R()}for(t.method=r,t.arg=I;;){var g=t.delegate;if(g){var n=m(g,t);if(n){if(n===c)continue;return n}}if("next"===t.method)t.sent=t._sent=t.arg;else if("throw"===t.method){if(i===Q)throw i=f,t.arg;t.dispatchException(t.arg)}else"return"===t.method&&t.abrupt("return",t.arg);i=s;var a=C(A,e,t);if("normal"===a.type){if(i=t.done?f:E,a.arg===c)continue;return{value:a.arg,done:t.done}}"throw"===a.type&&(i=f,t.method="throw",t.arg=a.arg)}}}(A,t,g),I}function C(A,e,t){try{return{type:"normal",arg:A.call(e,t)}}catch(A){return{type:"throw",arg:A}}}A.wrap=B;var Q="suspendedStart",E="suspendedYield",s="executing",f="completed",c={};function h(){}function l(){}function u(){}var w={};o(w,g,(function(){return this}));var d=Object.getPrototypeOf,D=d&&d(d(v([])));D&&D!==i&&r.call(D,g)&&(w=D);var y=u.prototype=h.prototype=Object.create(w);function k(A){["next","throw","return"].forEach((function(e){o(A,e,(function(A){return this._invoke(e,A)}))}))}function p(A,e){function i(I,g,n,a){var o=C(A[I],A,g);if("throw"!==o.type){var B=o.arg,Q=B.value;return Q&&"object"===t(Q)&&r.call(Q,"__await")?e.resolve(Q.__await).then((function(A){i("next",A,n,a)}),(function(A){i("throw",A,n,a)})):e.resolve(Q).then((function(A){B.value=A,n(B)}),(function(A){return i("throw",A,n,a)}))}a(o.arg)}var I;this._invoke=function(A,t){function r(){return new e((function(e,r){i(A,t,e,r)}))}return I=I?I.then(r,r):r()}}function m(A,t){var i=A.iterator[t.method];if(i===e){if(t.delegate=null,"throw"===t.method){if(A.iterator.return&&(t.method="return",t.arg=e,m(A,t),"throw"===t.method))return c;t.method="throw",t.arg=new TypeError("The iterator does not provide a \'throw\' method")}return c}var r=C(i,A.iterator,t.arg);if("throw"===r.type)return t.method="throw",t.arg=r.arg,t.delegate=null,c;var I=r.arg;return I?I.done?(t[A.resultName]=I.value,t.next=A.nextLoc,"return"!==t.method&&(t.method="next",t.arg=e),t.delegate=null,c):I:(t.method="throw",t.arg=new TypeError("iterator result is not an object"),t.delegate=null,c)}function G(A){var e={tryLoc:A[0]};1 in A&&(e.catchLoc=A[1]),2 in A&&(e.finallyLoc=A[2],e.afterLoc=A[3]),this.tryEntries.push(e)}function F(A){var e=A.completion||{};e.type="normal",delete e.arg,A.completion=e}function S(A){this.tryEntries=[{tryLoc:"root"}],A.forEach(G,this),this.reset(!0)}function v(A){if(A){var t=A[g];if(t)return t.call(A);if("function"==typeof A.next)return A;if(!isNaN(A.length)){var i=-1,I=function t(){for(;++i<A.length;)if(r.call(A,i))return t.value=A[i],t.done=!1,t;return t.value=e,t.done=!0,t};return I.next=I}}return{next:R}}function R(){return{value:e,done:!0}}return l.prototype=u,o(y,"constructor",u),o(u,"constructor",l),l.displayName=o(u,a,"GeneratorFunction"),A.isGeneratorFunction=function(A){var e="function"==typeof A&&A.constructor;return!!e&&(e===l||"GeneratorFunction"===(e.displayName||e.name))},A.mark=function(A){return Object.setPrototypeOf?Object.setPrototypeOf(A,u):(A.__proto__=u,o(A,a,"GeneratorFunction")),A.prototype=Object.create(y),A},A.awrap=function(A){return{__await:A}},k(p.prototype),o(p.prototype,n,(function(){return this})),A.AsyncIterator=p,A.async=function(e,t,i,r,I){void 0===I&&(I=Promise);var g=new p(B(e,t,i,r),I);return A.isGeneratorFunction(t)?g:g.next().then((function(A){return A.done?A.value:g.next()}))},k(y),o(y,a,"Generator"),o(y,g,(function(){return this})),o(y,"toString",(function(){return"[object Generator]"})),A.keys=function(A){var e=[];for(var t in A)e.push(t);return e.reverse(),function t(){for(;e.length;){var i=e.pop();if(i in A)return t.value=i,t.done=!1,t}return t.done=!0,t}},A.values=v,S.prototype={constructor:S,reset:function(A){if(this.prev=0,this.next=0,this.sent=this._sent=e,this.done=!1,this.delegate=null,this.method="next",this.arg=e,this.tryEntries.forEach(F),!A)for(var t in this)"t"===t.charAt(0)&&r.call(this,t)&&!isNaN(+t.slice(1))&&(this[t]=e)},stop:function(){this.done=!0;var A=this.tryEntries[0].completion;if("throw"===A.type)throw A.arg;return this.rval},dispatchException:function(A){if(this.done)throw A;var t=this;function i(i,r){return n.type="throw",n.arg=A,t.next=i,r&&(t.method="next",t.arg=e),!!r}for(var I=this.tryEntries.length-1;I>=0;--I){var g=this.tryEntries[I],n=g.completion;if("root"===g.tryLoc)return i("end");if(g.tryLoc<=this.prev){var a=r.call(g,"catchLoc"),o=r.call(g,"finallyLoc");if(a&&o){if(this.prev<g.catchLoc)return i(g.catchLoc,!0);if(this.prev<g.finallyLoc)return i(g.finallyLoc)}else if(a){if(this.prev<g.catchLoc)return i(g.catchLoc,!0)}else{if(!o)throw new Error("try statement without catch or finally");if(this.prev<g.finallyLoc)return i(g.finallyLoc)}}}},abrupt:function(A,e){for(var t=this.tryEntries.length-1;t>=0;--t){var i=this.tryEntries[t];if(i.tryLoc<=this.prev&&r.call(i,"finallyLoc")&&this.prev<i.finallyLoc){var I=i;break}}I&&("break"===A||"continue"===A)&&I.tryLoc<=e&&e<=I.finallyLoc&&(I=null);var g=I?I.completion:{};return g.type=A,g.arg=e,I?(this.method="next",this.next=I.finallyLoc,c):this.complete(g)},complete:function(A,e){if("throw"===A.type)throw A.arg;return"break"===A.type||"continue"===A.type?this.next=A.arg:"return"===A.type?(this.rval=this.arg=A.arg,this.method="return",this.next="end"):"normal"===A.type&&e&&(this.next=e),c},finish:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.finallyLoc===A)return this.complete(t.completion,t.afterLoc),F(t),c}},catch:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.tryLoc===A){var i=t.completion;if("throw"===i.type){var r=i.arg;F(t)}return r}}throw new Error("illegal catch attempt")},delegateYield:function(A,t,i){return this.delegate={iterator:v(A),resultName:t,nextLoc:i},"next"===this.method&&(this.arg=e),c}},A}(A.exports);try{regeneratorRuntime=e}catch(A){"object"===("undefined"==typeof globalThis?"undefined":t(globalThis))?globalThis.regeneratorRuntime=e:Function("r","regeneratorRuntime = r")(e)}}(i);var r=i.exports,I=new Map;function g(A,e){Array.isArray(A)||(A=[A]),A.forEach((function(A){return I.set(A,e)}))}function n(A){return a.apply(this,arguments)}function a(){return(a=e(r.mark((function A(e){var t,i;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:if(t=I.get(e.Compression)){A.next=3;break}throw new Error("Unknown compression method identifier: ".concat(e.Compression));case 3:return A.next=5,t();case 5:return i=A.sent,A.abrupt("return",new i(e));case 7:case"end":return A.stop()}}),A)})))).apply(this,arguments)}g([void 0,1],(function(){return Promise.resolve().then((function(){return y})).then((function(A){return A.default}))})),g(5,(function(){return Promise.resolve().then((function(){return F})).then((function(A){return A.default}))})),g(6,(function(){throw new Error("old style JPEG compression is not supported.")})),g(7,(function(){return Promise.resolve().then((function(){return N})).then((function(A){return A.default}))})),g([8,32946],(function(){return Promise.resolve().then((function(){return OA})).then((function(A){return A.default}))})),g(32773,(function(){return Promise.resolve().then((function(){return _A})).then((function(A){return A.default}))})),g(34887,(function(){return Promise.resolve().then((function(){return le})).then(function(){var A=e(r.mark((function A(e){return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,e.zstd.init();case 2:return A.abrupt("return",e);case 3:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}()).then((function(A){return A.default}))})),g(50001,(function(){return Promise.resolve().then((function(){return de})).then((function(A){return A.default}))}));var o=globalThis;function B(A,e){if(!(A instanceof e))throw new TypeError("Cannot call a class as a function")}function C(A,e){for(var t=0;t<e.length;t++){var i=e[t];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(A,i.key,i)}}function Q(A,e,t){return e&&C(A.prototype,e),t&&C(A,t),A}function E(A,e){return E=Object.setPrototypeOf||function(A,e){return A.__proto__=e,A},E(A,e)}function s(A,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");A.prototype=Object.create(e&&e.prototype,{constructor:{value:A,writable:!0,configurable:!0}}),e&&E(A,e)}function f(A,e){if(e&&("object"===t(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(A){if(void 0===A)throw new ReferenceError("this hasn\'t been initialised - super() hasn\'t been called");return A}(A)}function c(A){return c=Object.setPrototypeOf?Object.getPrototypeOf:function(A){return A.__proto__||Object.getPrototypeOf(A)},c(A)}function h(A,e){var t=A.length-e,i=0;do{for(var r=e;r>0;r--)A[i+e]+=A[i],i++;t-=e}while(t>0)}function l(A,e,t){for(var i=0,r=A.length,I=r/t;r>e;){for(var g=e;g>0;--g)A[i+e]+=A[i],++i;r-=e}for(var n=A.slice(),a=0;a<I;++a)for(var o=0;o<t;++o)A[t*a+o]=n[(t-o-1)*I+a]}function u(A,e,t,i,r,I){if(!e||1===e)return A;for(var g=0;g<r.length;++g){if(r[g]%8!=0)throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");if(r[g]!==r[0])throw new Error("When decoding with predictor, all samples must have the same size.")}for(var n=r[0]/8,a=2===I?1:r.length,o=0;o<i&&!(o*a*t*n>=A.byteLength);++o){var B=void 0;if(2===e){switch(r[0]){case 8:B=new Uint8Array(A,o*a*t*n,a*t*n);break;case 16:B=new Uint16Array(A,o*a*t*n,a*t*n/2);break;case 32:B=new Uint32Array(A,o*a*t*n,a*t*n/4);break;default:throw new Error("Predictor 2 not allowed with ".concat(r[0]," bits per sample."))}h(B,a)}else 3===e&&l(B=new Uint8Array(A,o*a*t*n,a*t*n),a,n)}return A}o.addEventListener("message",function(){var A=e(r.mark((function A(e){var t,i,I,g,a,B;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return t=e.data,i=t.id,I=t.fileDirectory,g=t.buffer,A.next=3,n(I);case 3:return a=A.sent,A.next=6,a.decode(I,g);case 6:B=A.sent,o.postMessage({decoded:B,id:i},[B]);case 8:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}());var w=function(){function A(){B(this,A)}var t;return Q(A,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n,a;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,this.decodeBlock(t);case 2:if(i=A.sent,1===(I=e.Predictor||1)){A.next=9;break}return g=!e.StripOffsets,n=g?e.TileWidth:e.ImageWidth,a=g?e.TileLength:e.RowsPerStrip||e.ImageLength,A.abrupt("return",u(i,I,n,a,e.BitsPerSample,e.PlanarConfiguration));case 9:return A.abrupt("return",i);case 10:case"end":return A.stop()}}),A,this)}))),function(A,e){return t.apply(this,arguments)})}]),A}();function d(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var D=function(A){s(t,w);var e=d(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return A}}]),t}(),y=Object.freeze({__proto__:null,default:D});function k(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}function p(A,e){for(var t=e.length-1;t>=0;t--)A.push(e[t]);return A}function m(A){for(var e=new Uint16Array(4093),t=new Uint8Array(4093),i=0;i<=257;i++)e[i]=4096,t[i]=i;var r=258,I=9,g=0;function n(){r=258,I=9}function a(A){var e=function(A,e,t){var i=e%8,r=Math.floor(e/8),I=8-i,g=e+t-8*(r+1),n=8*(r+2)-(e+t),a=8*(r+2)-e;if(n=Math.max(0,n),r>=A.length)return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"),257;var o=A[r]&Math.pow(2,8-i)-1,B=o<<=t-I;if(r+1<A.length){var C=A[r+1]>>>n;B+=C<<=Math.max(0,t-a)}if(g>8&&r+2<A.length){var Q=8*(r+3)-(e+t);B+=A[r+2]>>>Q}return B}(A,g,I);return g+=I,e}function o(A,i){return t[r]=i,e[r]=A,++r-1}function B(A){for(var i=[],r=A;4096!==r;r=e[r])i.push(t[r]);return i}var C=[];n();for(var Q,E=new Uint8Array(A),s=a(E);257!==s;){if(256===s){for(n(),s=a(E);256===s;)s=a(E);if(257===s)break;if(s>256)throw new Error("corrupted code at scanline ".concat(s));p(C,B(s)),Q=s}else if(s<r){var f=B(s);p(C,f),o(Q,f[f.length-1]),Q=s}else{var c=B(Q);if(!c)throw new Error("Bogus entry. Not in dictionary, ".concat(Q," / ").concat(r,", position: ").concat(g));p(C,c),C.push(c[c.length-1]),o(Q,c[c.length-1]),Q=s}r+1>=Math.pow(2,I)&&(12===I?Q=void 0:I++),s=a(E)}return new Uint8Array(C)}var G=function(A){s(t,w);var e=k(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return m(A).buffer}}]),t}(),F=Object.freeze({__proto__:null,default:G});function S(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var v=new Int32Array([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]);function R(A,e){for(var t=0,i=[],r=16;r>0&&!A[r-1];)--r;i.push({children:[],index:0});for(var I,g=i[0],n=0;n<r;n++){for(var a=0;a<A[n];a++){for((g=i.pop()).children[g.index]=e[t];g.index>0;)g=i.pop();for(g.index++,i.push(g);i.length<=n;)i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I;t++}n+1<r&&(i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I)}return i[0].children}function U(A,e,i,r,I,g,n,a,o){var B=i.mcusPerLine,C=i.progressive,Q=e,E=e,s=0,f=0;function c(){if(f>0)return f--,s>>f&1;if(255===(s=A[E++])){var e=A[E++];if(e)throw new Error("unexpected marker: ".concat((s<<8|e).toString(16)))}return f=7,s>>>7}function h(A){for(var e,i=A;null!==(e=c());){if("number"==typeof(i=i[e]))return i;if("object"!==t(i))throw new Error("invalid huffman sequence")}return null}function l(A){for(var e=A,t=0;e>0;){var i=c();if(null===i)return;t=t<<1|i,--e}return t}function u(A){var e=l(A);return e>=1<<A-1?e:e+(-1<<A)+1}var w=0;var d,D=0;function y(A,e,t,i,r){var I=t%B,g=(t/B|0)*A.v+i,n=I*A.h+r;e(A,A.blocks[g][n])}function k(A,e,t){var i=t/A.blocksPerLine|0,r=t%A.blocksPerLine;e(A,A.blocks[i][r])}var p,m,G,F,S,R,U=r.length;R=C?0===g?0===a?function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t)<<o;A.pred+=i,e[0]=A.pred}:function(A,e){e[0]|=c()<<o}:0===a?function(A,e){if(w>0)w--;else for(var t=g,i=n;t<=i;){var r=h(A.huffmanTableAC),I=15&r,a=r>>4;if(0===I){if(a<15){w=l(a)+(1<<a)-1;break}t+=16}else e[v[t+=a]]=u(I)*(1<<o),t++}}:function(A,e){for(var t=g,i=n,r=0;t<=i;){var I=v[t],a=e[I]<0?-1:1;switch(D){case 0:var B=h(A.huffmanTableAC),C=15&B;if(r=B>>4,0===C)r<15?(w=l(r)+(1<<r),D=4):(r=16,D=1);else{if(1!==C)throw new Error("invalid ACn encoding");d=u(C),D=r?2:3}continue;case 1:case 2:e[I]?e[I]+=(c()<<o)*a:0==--r&&(D=2===D?3:0);break;case 3:e[I]?e[I]+=(c()<<o)*a:(e[I]=d<<o,D=0);break;case 4:e[I]&&(e[I]+=(c()<<o)*a)}t++}4===D&&0==--w&&(D=0)}:function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t);A.pred+=i,e[0]=A.pred;for(var r=1;r<64;){var I=h(A.huffmanTableAC),g=15&I,n=I>>4;if(0===g){if(n<15)break;r+=16}else e[v[r+=n]]=u(g),r++}};var L,b,M=0;b=1===U?r[0].blocksPerLine*r[0].blocksPerColumn:B*i.mcusPerColumn;for(var N=I||b;M<b;){for(m=0;m<U;m++)r[m].pred=0;if(w=0,1===U)for(p=r[0],S=0;S<N;S++)k(p,R,M),M++;else for(S=0;S<N;S++){for(m=0;m<U;m++){var x=p=r[m],J=x.h,q=x.v;for(G=0;G<q;G++)for(F=0;F<J;F++)y(p,R,M,G,F)}if(++M===b)break}if(f=0,(L=A[E]<<8|A[E+1])<65280)throw new Error("marker was not found");if(!(L>=65488&&L<=65495))break;E+=2}return E-Q}function L(A,e){var t=[],i=e.blocksPerLine,r=e.blocksPerColumn,I=i<<3,g=new Int32Array(64),n=new Uint8Array(64);function a(A,t,i){var r,I,g,n,a,o,B,C,Q,E,s=e.quantizationTable,f=i;for(E=0;E<64;E++)f[E]=A[E]*s[E];for(E=0;E<8;++E){var c=8*E;0!==f[1+c]||0!==f[2+c]||0!==f[3+c]||0!==f[4+c]||0!==f[5+c]||0!==f[6+c]||0!==f[7+c]?(r=5793*f[0+c]+128>>8,I=5793*f[4+c]+128>>8,g=f[2+c],n=f[6+c],a=2896*(f[1+c]-f[7+c])+128>>8,C=2896*(f[1+c]+f[7+c])+128>>8,o=f[3+c]<<4,Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+128>>8,g=1567*g-3784*n+128>>8,n=Q,Q=a-(B=f[5+c]<<4)+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+c]=r+C,f[7+c]=r-C,f[1+c]=I+B,f[6+c]=I-B,f[2+c]=g+o,f[5+c]=g-o,f[3+c]=n+a,f[4+c]=n-a):(Q=5793*f[0+c]+512>>10,f[0+c]=Q,f[1+c]=Q,f[2+c]=Q,f[3+c]=Q,f[4+c]=Q,f[5+c]=Q,f[6+c]=Q,f[7+c]=Q)}for(E=0;E<8;++E){var h=E;0!==f[8+h]||0!==f[16+h]||0!==f[24+h]||0!==f[32+h]||0!==f[40+h]||0!==f[48+h]||0!==f[56+h]?(r=5793*f[0+h]+2048>>12,I=5793*f[32+h]+2048>>12,g=f[16+h],n=f[48+h],a=2896*(f[8+h]-f[56+h])+2048>>12,C=2896*(f[8+h]+f[56+h])+2048>>12,o=f[24+h],Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+2048>>12,g=1567*g-3784*n+2048>>12,n=Q,Q=a-(B=f[40+h])+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+h]=r+C,f[56+h]=r-C,f[8+h]=I+B,f[48+h]=I-B,f[16+h]=g+o,f[40+h]=g-o,f[24+h]=n+a,f[32+h]=n-a):(Q=5793*i[E+0]+8192>>14,f[0+h]=Q,f[8+h]=Q,f[16+h]=Q,f[24+h]=Q,f[32+h]=Q,f[40+h]=Q,f[48+h]=Q,f[56+h]=Q)}for(E=0;E<64;++E){var l=128+(f[E]+8>>4);t[E]=l<0?0:l>255?255:l}}for(var o=0;o<r;o++){for(var B=o<<3,C=0;C<8;C++)t.push(new Uint8Array(I));for(var Q=0;Q<i;Q++){a(e.blocks[o][Q],n,g);for(var E=0,s=Q<<3,f=0;f<8;f++)for(var c=t[B+f],h=0;h<8;h++)c[s+h]=n[E++]}}return t}var b=function(){function A(){B(this,A),this.jfif=null,this.adobe=null,this.quantizationTables=[],this.huffmanTablesAC=[],this.huffmanTablesDC=[],this.resetFrames()}return Q(A,[{key:"resetFrames",value:function(){this.frames=[]}},{key:"parse",value:function(A){var e=0;function t(){var t=A[e]<<8|A[e+1];return e+=2,t}function i(A){var e,t,i=0,r=0;for(t in A.components)A.components.hasOwnProperty(t)&&(i<(e=A.components[t]).h&&(i=e.h),r<e.v&&(r=e.v));var I=Math.ceil(A.samplesPerLine/8/i),g=Math.ceil(A.scanLines/8/r);for(t in A.components)if(A.components.hasOwnProperty(t)){e=A.components[t];for(var n=Math.ceil(Math.ceil(A.samplesPerLine/8)*e.h/i),a=Math.ceil(Math.ceil(A.scanLines/8)*e.v/r),o=I*e.h,B=g*e.v,C=[],Q=0;Q<B;Q++){for(var E=[],s=0;s<o;s++)E.push(new Int32Array(64));C.push(E)}e.blocksPerLine=n,e.blocksPerColumn=a,e.blocks=C}A.maxH=i,A.maxV=r,A.mcusPerLine=I,A.mcusPerColumn=g}var r,I,g=t();if(65496!==g)throw new Error("SOI not found");for(g=t();65497!==g;){switch(g){case 65280:break;case 65504:case 65505:case 65506:case 65507:case 65508:case 65509:case 65510:case 65511:case 65512:case 65513:case 65514:case 65515:case 65516:case 65517:case 65518:case 65519:case 65534:var n=(r=void 0,I=void 0,r=t(),I=A.subarray(e,e+r-2),e+=I.length,I);65504===g&&74===n[0]&&70===n[1]&&73===n[2]&&70===n[3]&&0===n[4]&&(this.jfif={version:{major:n[5],minor:n[6]},densityUnits:n[7],xDensity:n[8]<<8|n[9],yDensity:n[10]<<8|n[11],thumbWidth:n[12],thumbHeight:n[13],thumbData:n.subarray(14,14+3*n[12]*n[13])}),65518===g&&65===n[0]&&100===n[1]&&111===n[2]&&98===n[3]&&101===n[4]&&0===n[5]&&(this.adobe={version:n[6],flags0:n[7]<<8|n[8],flags1:n[9]<<8|n[10],transformCode:n[11]});break;case 65499:for(var a=t()+e-2;e<a;){var o=A[e++],B=new Int32Array(64);if(o>>4==0)for(var C=0;C<64;C++){B[v[C]]=A[e++]}else{if(o>>4!=1)throw new Error("DQT: invalid table spec");for(var Q=0;Q<64;Q++){B[v[Q]]=t()}}this.quantizationTables[15&o]=B}break;case 65472:case 65473:case 65474:t();for(var E={extended:65473===g,progressive:65474===g,precision:A[e++],scanLines:t(),samplesPerLine:t(),components:{},componentsOrder:[]},s=A[e++],f=void 0,c=0;c<s;c++){f=A[e];var h=A[e+1]>>4,l=15&A[e+1],u=A[e+2];E.componentsOrder.push(f),E.components[f]={h:h,v:l,quantizationIdx:u},e+=3}i(E),this.frames.push(E);break;case 65476:for(var w=t(),d=2;d<w;){for(var D=A[e++],y=new Uint8Array(16),k=0,p=0;p<16;p++,e++)y[p]=A[e],k+=y[p];for(var m=new Uint8Array(k),G=0;G<k;G++,e++)m[G]=A[e];d+=17+k,D>>4==0?this.huffmanTablesDC[15&D]=R(y,m):this.huffmanTablesAC[15&D]=R(y,m)}break;case 65501:t(),this.resetInterval=t();break;case 65498:t();for(var F=A[e++],S=[],L=this.frames[0],b=0;b<F;b++){var M=L.components[A[e++]],N=A[e++];M.huffmanTableDC=this.huffmanTablesDC[N>>4],M.huffmanTableAC=this.huffmanTablesAC[15&N],S.push(M)}var x=A[e++],J=A[e++],q=A[e++],Y=U(A,e,L,S,this.resetInterval,x,J,q>>4,15&q);e+=Y;break;case 65535:255!==A[e]&&e--;break;default:if(255===A[e-3]&&A[e-2]>=192&&A[e-2]<=254){e-=3;break}throw new Error("unknown JPEG marker ".concat(g.toString(16)))}g=t()}}},{key:"getResult",value:function(){var A=this.frames;if(0===this.frames.length)throw new Error("no frames were decoded");this.frames.length>1&&console.warn("more than one frame is not supported");for(var e=0;e<this.frames.length;e++)for(var t=this.frames[e].components,i=0,r=Object.keys(t);i<r.length;i++){var I=r[i];t[I].quantizationTable=this.quantizationTables[t[I].quantizationIdx],delete t[I].quantizationIdx}for(var g=A[0],n=g.components,a=g.componentsOrder,o=[],B=g.samplesPerLine,C=g.scanLines,Q=0;Q<a.length;Q++){var E=n[a[Q]];o.push({lines:L(0,E),scaleX:E.h/g.maxH,scaleY:E.v/g.maxV})}for(var s=new Uint8Array(B*C*o.length),f=0,c=0;c<C;++c)for(var h=0;h<B;++h)for(var l=0;l<o.length;++l){var u=o[l];s[f]=u.lines[0|c*u.scaleY][0|h*u.scaleX],++f}return s}}]),A}(),M=function(A){s(t,w);var e=S(t);function t(A){var i;return B(this,t),(i=e.call(this)).reader=new b,A.JPEGTables&&i.reader.parse(A.JPEGTables),i}return Q(t,[{key:"decodeBlock",value:function(A){return this.reader.resetFrames(),this.reader.parse(new Uint8Array(A)),this.reader.getResult().buffer}}]),t}(),N=Object.freeze({__proto__:null,default:M});function x(A){for(var e=A.length;--e>=0;)A[e]=0}x(new Array(576)),x(new Array(60)),x(new Array(512)),x(new Array(256)),x(new Array(29)),x(new Array(30));var J=function(A,e,t,i){for(var r=65535&A|0,I=A>>>16&65535|0,g=0;0!==t;){t-=g=t>2e3?2e3:t;do{I=I+(r=r+e[i++]|0)|0}while(--g);r%=65521,I%=65521}return r|I<<16|0},q=new Uint32Array(function(){for(var A,e=[],t=0;t<256;t++){A=t;for(var i=0;i<8;i++)A=1&A?3988292384^A>>>1:A>>>1;e[t]=A}return e}()),Y=function(A,e,t,i){var r=q,I=i+t;A^=-1;for(var g=i;g<I;g++)A=A>>>8^r[255&(A^e[g])];return-1^A},K={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"},H={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8},O=function(A,e){return Object.prototype.hasOwnProperty.call(A,e)},P=function(A){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var i=e.shift();if(i){if("object"!==t(i))throw new TypeError(i+"must be non-object");for(var r in i)O(i,r)&&(A[r]=i[r])}}return A},T=function(A){for(var e=0,t=0,i=A.length;t<i;t++)e+=A[t].length;for(var r=new Uint8Array(e),I=0,g=0,n=A.length;I<n;I++){var a=A[I];r.set(a,g),g+=a.length}return r},V=!0;try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(A){V=!1}for(var _=new Uint8Array(256),X=0;X<256;X++)_[X]=X>=252?6:X>=248?5:X>=240?4:X>=224?3:X>=192?2:1;_[254]=_[254]=1;var Z=function(A){if("function"==typeof TextEncoder&&TextEncoder.prototype.encode)return(new TextEncoder).encode(A);var e,t,i,r,I,g=A.length,n=0;for(r=0;r<g;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),n+=t<128?1:t<2048?2:t<65536?3:4;for(e=new Uint8Array(n),I=0,r=0;I<n;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),t<128?e[I++]=t:t<2048?(e[I++]=192|t>>>6,e[I++]=128|63&t):t<65536?(e[I++]=224|t>>>12,e[I++]=128|t>>>6&63,e[I++]=128|63&t):(e[I++]=240|t>>>18,e[I++]=128|t>>>12&63,e[I++]=128|t>>>6&63,e[I++]=128|63&t);return e},j=function(A,e){var t,i,r=e||A.length;if("function"==typeof TextDecoder&&TextDecoder.prototype.decode)return(new TextDecoder).decode(A.subarray(0,e));var I=new Array(2*r);for(i=0,t=0;t<r;){var g=A[t++];if(g<128)I[i++]=g;else{var n=_[g];if(n>4)I[i++]=65533,t+=n-1;else{for(g&=2===n?31:3===n?15:7;n>1&&t<r;)g=g<<6|63&A[t++],n--;n>1?I[i++]=65533:g<65536?I[i++]=g:(g-=65536,I[i++]=55296|g>>10&1023,I[i++]=56320|1023&g)}}}return function(A,e){if(e<65534&&A.subarray&&V)return String.fromCharCode.apply(null,A.length===e?A:A.subarray(0,e));for(var t="",i=0;i<e;i++)t+=String.fromCharCode(A[i]);return t}(I,i)},W=function(A,e){(e=e||A.length)>A.length&&(e=A.length);for(var t=e-1;t>=0&&128==(192&A[t]);)t--;return t<0||0===t?e:t+_[A[t]]>e?t:e};var z=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0},$=function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=A.state;t=A.next_in,k=A.input,i=t+(A.avail_in-5),r=A.next_out,p=A.output,I=r-(e-A.avail_out),g=r+(A.avail_out-257),n=m.dmax,a=m.wsize,o=m.whave,B=m.wnext,C=m.window,Q=m.hold,E=m.bits,s=m.lencode,f=m.distcode,c=(1<<m.lenbits)-1,h=(1<<m.distbits)-1;A:do{E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=s[Q&c];e:for(;;){if(Q>>>=u=l>>>24,E-=u,0===(u=l>>>16&255))p[r++]=65535&l;else{if(!(16&u)){if(0==(64&u)){l=s[(65535&l)+(Q&(1<<u)-1)];continue e}if(32&u){m.mode=12;break A}A.msg="invalid literal/length code",m.mode=30;break A}w=65535&l,(u&=15)&&(E<u&&(Q+=k[t++]<<E,E+=8),w+=Q&(1<<u)-1,Q>>>=u,E-=u),E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=f[Q&h];t:for(;;){if(Q>>>=u=l>>>24,E-=u,!(16&(u=l>>>16&255))){if(0==(64&u)){l=f[(65535&l)+(Q&(1<<u)-1)];continue t}A.msg="invalid distance code",m.mode=30;break A}if(d=65535&l,E<(u&=15)&&(Q+=k[t++]<<E,(E+=8)<u&&(Q+=k[t++]<<E,E+=8)),(d+=Q&(1<<u)-1)>n){A.msg="invalid distance too far back",m.mode=30;break A}if(Q>>>=u,E-=u,d>(u=r-I)){if((u=d-u)>o&&m.sane){A.msg="invalid distance too far back",m.mode=30;break A}if(D=0,y=C,0===B){if(D+=a-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}else if(B<u){if(D+=a+B-u,(u-=B)<w){w-=u;do{p[r++]=C[D++]}while(--u);if(D=0,B<w){w-=u=B;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}}else if(D+=B-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}for(;w>2;)p[r++]=y[D++],p[r++]=y[D++],p[r++]=y[D++],w-=3;w&&(p[r++]=y[D++],w>1&&(p[r++]=y[D++]))}else{D=r-d;do{p[r++]=p[D++],p[r++]=p[D++],p[r++]=p[D++],w-=3}while(w>2);w&&(p[r++]=p[D++],w>1&&(p[r++]=p[D++]))}break}}break}}while(t<i&&r<g);t-=w=E>>3,Q&=(1<<(E-=w<<3))-1,A.next_in=t,A.next_out=r,A.avail_in=t<i?i-t+5:5-(t-i),A.avail_out=r<g?g-r+257:257-(r-g),m.hold=Q,m.bits=E},AA=new Uint16Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0]),eA=new Uint8Array([16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78]),tA=new Uint16Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0]),iA=new Uint8Array([16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64]),rA=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E,s,f,c,h=n.bits,l=0,u=0,w=0,d=0,D=0,y=0,k=0,p=0,m=0,G=0,F=null,S=0,v=new Uint16Array(16),R=new Uint16Array(16),U=null,L=0;for(l=0;l<=15;l++)v[l]=0;for(u=0;u<i;u++)v[e[t+u]]++;for(D=h,d=15;d>=1&&0===v[d];d--);if(D>d&&(D=d),0===d)return r[I++]=20971520,r[I++]=20971520,n.bits=1,0;for(w=1;w<d&&0===v[w];w++);for(D<w&&(D=w),p=1,l=1;l<=15;l++)if(p<<=1,(p-=v[l])<0)return-1;if(p>0&&(0===A||1!==d))return-1;for(R[1]=0,l=1;l<15;l++)R[l+1]=R[l]+v[l];for(u=0;u<i;u++)0!==e[t+u]&&(g[R[e[t+u]]++]=u);if(0===A?(F=U=g,E=19):1===A?(F=AA,S-=257,U=eA,L-=257,E=256):(F=tA,U=iA,E=-1),G=0,u=0,l=w,Q=I,y=D,k=0,B=-1,C=(m=1<<D)-1,1===A&&m>852||2===A&&m>592)return 1;for(;;){s=l-k,g[u]<E?(f=0,c=g[u]):g[u]>E?(f=U[L+g[u]],c=F[S+g[u]]):(f=96,c=0),a=1<<l-k,w=o=1<<y;do{r[Q+(G>>k)+(o-=a)]=s<<24|f<<16|c|0}while(0!==o);for(a=1<<l-1;G&a;)a>>=1;if(0!==a?(G&=a-1,G+=a):G=0,u++,0==--v[l]){if(l===d)break;l=e[t+g[u]]}if(l>D&&(G&C)!==B){for(0===k&&(k=D),Q+=w,p=1<<(y=l-k);y+k<d&&!((p-=v[y+k])<=0);)y++,p<<=1;if(m+=1<<y,1===A&&m>852||2===A&&m>592)return 1;r[B=G&C]=D<<24|y<<16|Q-I|0}}return 0!==G&&(r[Q+G]=l-k<<24|64<<16|0),n.bits=D,0},IA=H.Z_FINISH,gA=H.Z_BLOCK,nA=H.Z_TREES,aA=H.Z_OK,oA=H.Z_STREAM_END,BA=H.Z_NEED_DICT,CA=H.Z_STREAM_ERROR,QA=H.Z_DATA_ERROR,EA=H.Z_MEM_ERROR,sA=H.Z_BUF_ERROR,fA=H.Z_DEFLATED,cA=function(A){return(A>>>24&255)+(A>>>8&65280)+((65280&A)<<8)+((255&A)<<24)};function hA(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new Uint16Array(320),this.work=new Uint16Array(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}var lA,uA,wA=function(A){if(!A||!A.state)return CA;var e=A.state;return A.total_in=A.total_out=e.total=0,A.msg="",e.wrap&&(A.adler=1&e.wrap),e.mode=1,e.last=0,e.havedict=0,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new Int32Array(852),e.distcode=e.distdyn=new Int32Array(592),e.sane=1,e.back=-1,aA},dA=function(A){if(!A||!A.state)return CA;var e=A.state;return e.wsize=0,e.whave=0,e.wnext=0,wA(A)},DA=function(A,e){var t;if(!A||!A.state)return CA;var i=A.state;return e<0?(t=0,e=-e):(t=1+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?CA:(null!==i.window&&i.wbits!==e&&(i.window=null),i.wrap=t,i.wbits=e,dA(A))},yA=function(A,e){if(!A)return CA;var t=new hA;A.state=t,t.window=null;var i=DA(A,e);return i!==aA&&(A.state=null),i},kA=!0,pA=function(A){if(kA){lA=new Int32Array(512),uA=new Int32Array(32);for(var e=0;e<144;)A.lens[e++]=8;for(;e<256;)A.lens[e++]=9;for(;e<280;)A.lens[e++]=7;for(;e<288;)A.lens[e++]=8;for(rA(1,A.lens,0,288,lA,0,A.work,{bits:9}),e=0;e<32;)A.lens[e++]=5;rA(2,A.lens,0,32,uA,0,A.work,{bits:5}),kA=!1}A.lencode=lA,A.lenbits=9,A.distcode=uA,A.distbits=5},mA=function(A,e,t,i){var r,I=A.state;return null===I.window&&(I.wsize=1<<I.wbits,I.wnext=0,I.whave=0,I.window=new Uint8Array(I.wsize)),i>=I.wsize?(I.window.set(e.subarray(t-I.wsize,t),0),I.wnext=0,I.whave=I.wsize):((r=I.wsize-I.wnext)>i&&(r=i),I.window.set(e.subarray(t-i,t-i+r),I.wnext),(i-=r)?(I.window.set(e.subarray(t-i,t),0),I.wnext=i,I.whave=I.wsize):(I.wnext+=r,I.wnext===I.wsize&&(I.wnext=0),I.whave<I.wsize&&(I.whave+=r))),0},GA={inflateReset:dA,inflateReset2:DA,inflateResetKeep:wA,inflateInit:function(A){return yA(A,15)},inflateInit2:yA,inflate:function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=0,G=new Uint8Array(4),F=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);if(!A||!A.state||!A.output||!A.input&&0!==A.avail_in)return CA;12===(t=A.state).mode&&(t.mode=13),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,C=n,Q=a,y=aA;A:for(;;)switch(t.mode){case 1:if(0===t.wrap){t.mode=13;break}for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(2&t.wrap&&35615===o){t.check=0,G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0),o=0,B=0,t.mode=2;break}if(t.flags=0,t.head&&(t.head.done=!1),!(1&t.wrap)||(((255&o)<<8)+(o>>8))%31){A.msg="incorrect header check",t.mode=30;break}if((15&o)!==fA){A.msg="unknown compression method",t.mode=30;break}if(B-=4,D=8+(15&(o>>>=4)),0===t.wbits)t.wbits=D;else if(D>t.wbits){A.msg="invalid window size",t.mode=30;break}t.dmax=1<<t.wbits,A.adler=t.check=1,t.mode=512&o?10:12,o=0,B=0;break;case 2:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.flags=o,(255&t.flags)!==fA){A.msg="unknown compression method",t.mode=30;break}if(57344&t.flags){A.msg="unknown header flags set",t.mode=30;break}t.head&&(t.head.text=o>>8&1),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=3;case 3:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.time=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,G[2]=o>>>16&255,G[3]=o>>>24&255,t.check=Y(t.check,G,4,0)),o=0,B=0,t.mode=4;case 4:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.xflags=255&o,t.head.os=o>>8),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=5;case 5:if(1024&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length=o,t.head&&(t.head.extra_len=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0}else t.head&&(t.head.extra=null);t.mode=6;case 6:if(1024&t.flags&&((E=t.length)>n&&(E=n),E&&(t.head&&(D=t.head.extra_len-t.length,t.head.extra||(t.head.extra=new Uint8Array(t.head.extra_len)),t.head.extra.set(i.subarray(I,I+E),D)),512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,t.length-=E),t.length))break A;t.length=0,t.mode=7;case 7:if(2048&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.name+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.name=null);t.length=0,t.mode=8;case 8:if(4096&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.comment+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.comment=null);t.mode=9;case 9:if(512&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(65535&t.check)){A.msg="header crc mismatch",t.mode=30;break}o=0,B=0}t.head&&(t.head.hcrc=t.flags>>9&1,t.head.done=!0),A.adler=t.check=0,t.mode=12;break;case 10:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}A.adler=t.check=cA(o),o=0,B=0,t.mode=11;case 11:if(0===t.havedict)return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,BA;A.adler=t.check=1,t.mode=12;case 12:if(e===gA||e===nA)break A;case 13:if(t.last){o>>>=7&B,B-=7&B,t.mode=27;break}for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}switch(t.last=1&o,B-=1,3&(o>>>=1)){case 0:t.mode=14;break;case 1:if(pA(t),t.mode=20,e===nA){o>>>=2,B-=2;break A}break;case 2:t.mode=17;break;case 3:A.msg="invalid block type",t.mode=30}o>>>=2,B-=2;break;case 14:for(o>>>=7&B,B-=7&B;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if((65535&o)!=(o>>>16^65535)){A.msg="invalid stored block lengths",t.mode=30;break}if(t.length=65535&o,o=0,B=0,t.mode=15,e===nA)break A;case 15:t.mode=16;case 16:if(E=t.length){if(E>n&&(E=n),E>a&&(E=a),0===E)break A;r.set(i.subarray(I,I+E),g),n-=E,I+=E,a-=E,g+=E,t.length-=E;break}t.mode=12;break;case 17:for(;B<14;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.nlen=257+(31&o),o>>>=5,B-=5,t.ndist=1+(31&o),o>>>=5,B-=5,t.ncode=4+(15&o),o>>>=4,B-=4,t.nlen>286||t.ndist>30){A.msg="too many length or distance symbols",t.mode=30;break}t.have=0,t.mode=18;case 18:for(;t.have<t.ncode;){for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.lens[F[t.have++]]=7&o,o>>>=3,B-=3}for(;t.have<19;)t.lens[F[t.have++]]=0;if(t.lencode=t.lendyn,t.lenbits=7,k={bits:t.lenbits},y=rA(0,t.lens,0,19,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid code lengths set",t.mode=30;break}t.have=0,t.mode=19;case 19:for(;t.have<t.nlen+t.ndist;){for(;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(l<16)o>>>=c,B-=c,t.lens[t.have++]=l;else{if(16===l){for(p=c+2;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o>>>=c,B-=c,0===t.have){A.msg="invalid bit length repeat",t.mode=30;break}D=t.lens[t.have-1],E=3+(3&o),o>>>=2,B-=2}else if(17===l){for(p=c+3;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=3+(7&(o>>>=c)),o>>>=3,B-=3}else{for(p=c+7;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=11+(127&(o>>>=c)),o>>>=7,B-=7}if(t.have+E>t.nlen+t.ndist){A.msg="invalid bit length repeat",t.mode=30;break}for(;E--;)t.lens[t.have++]=D}}if(30===t.mode)break;if(0===t.lens[256]){A.msg="invalid code -- missing end-of-block",t.mode=30;break}if(t.lenbits=9,k={bits:t.lenbits},y=rA(1,t.lens,0,t.nlen,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid literal/lengths set",t.mode=30;break}if(t.distbits=6,t.distcode=t.distdyn,k={bits:t.distbits},y=rA(2,t.lens,t.nlen,t.ndist,t.distcode,0,t.work,k),t.distbits=k.bits,y){A.msg="invalid distances set",t.mode=30;break}if(t.mode=20,e===nA)break A;case 20:t.mode=21;case 21:if(n>=6&&a>=258){A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,$(A,Q),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,12===t.mode&&(t.back=-1);break}for(t.back=0;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(h&&0==(240&h)){for(u=c,w=h,d=l;h=(m=t.lencode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,t.length=l,0===h){t.mode=26;break}if(32&h){t.back=-1,t.mode=12;break}if(64&h){A.msg="invalid literal/length code",t.mode=30;break}t.extra=15&h,t.mode=22;case 22:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}t.was=t.length,t.mode=23;case 23:for(;h=(m=t.distcode[o&(1<<t.distbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(0==(240&h)){for(u=c,w=h,d=l;h=(m=t.distcode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,64&h){A.msg="invalid distance code",t.mode=30;break}t.offset=l,t.extra=15&h,t.mode=24;case 24:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.offset+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}if(t.offset>t.dmax){A.msg="invalid distance too far back",t.mode=30;break}t.mode=25;case 25:if(0===a)break A;if(E=Q-a,t.offset>E){if((E=t.offset-E)>t.whave&&t.sane){A.msg="invalid distance too far back",t.mode=30;break}E>t.wnext?(E-=t.wnext,s=t.wsize-E):s=t.wnext-E,E>t.length&&(E=t.length),f=t.window}else f=r,s=g-t.offset,E=t.length;E>a&&(E=a),a-=E,t.length-=E;do{r[g++]=f[s++]}while(--E);0===t.length&&(t.mode=21);break;case 26:if(0===a)break A;r[g++]=t.length,a--,t.mode=21;break;case 27:if(t.wrap){for(;B<32;){if(0===n)break A;n--,o|=i[I++]<<B,B+=8}if(Q-=a,A.total_out+=Q,t.total+=Q,Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,g-Q):J(t.check,r,Q,g-Q)),Q=a,(t.flags?o:cA(o))!==t.check){A.msg="incorrect data check",t.mode=30;break}o=0,B=0}t.mode=28;case 28:if(t.wrap&&t.flags){for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(4294967295&t.total)){A.msg="incorrect length check",t.mode=30;break}o=0,B=0}t.mode=29;case 29:y=oA;break A;case 30:y=QA;break A;case 31:return EA;default:return CA}return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,(t.wsize||Q!==A.avail_out&&t.mode<30&&(t.mode<27||e!==IA))&&mA(A,A.output,A.next_out,Q-A.avail_out),C-=A.avail_in,Q-=A.avail_out,A.total_in+=C,A.total_out+=Q,t.total+=Q,t.wrap&&Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,A.next_out-Q):J(t.check,r,Q,A.next_out-Q)),A.data_type=t.bits+(t.last?64:0)+(12===t.mode?128:0)+(20===t.mode||15===t.mode?256:0),(0===C&&0===Q||e===IA)&&y===aA&&(y=sA),y},inflateEnd:function(A){if(!A||!A.state)return CA;var e=A.state;return e.window&&(e.window=null),A.state=null,aA},inflateGetHeader:function(A,e){if(!A||!A.state)return CA;var t=A.state;return 0==(2&t.wrap)?CA:(t.head=e,e.done=!1,aA)},inflateSetDictionary:function(A,e){var t,i=e.length;return A&&A.state?0!==(t=A.state).wrap&&11!==t.mode?CA:11===t.mode&&J(1,e,i,0)!==t.check?QA:mA(A,e,i,i)?(t.mode=31,EA):(t.havedict=1,aA):CA},inflateInfo:"pako inflate (from Nodeca project)"};var FA=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1},SA=Object.prototype.toString,vA=H.Z_NO_FLUSH,RA=H.Z_FINISH,UA=H.Z_OK,LA=H.Z_STREAM_END,bA=H.Z_NEED_DICT,MA=H.Z_STREAM_ERROR,NA=H.Z_DATA_ERROR,xA=H.Z_MEM_ERROR;function JA(A){this.options=P({chunkSize:65536,windowBits:15,to:""},A||{});var e=this.options;e.raw&&e.windowBits>=0&&e.windowBits<16&&(e.windowBits=-e.windowBits,0===e.windowBits&&(e.windowBits=-15)),!(e.windowBits>=0&&e.windowBits<16)||A&&A.windowBits||(e.windowBits+=32),e.windowBits>15&&e.windowBits<48&&0==(15&e.windowBits)&&(e.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new z,this.strm.avail_out=0;var t=GA.inflateInit2(this.strm,e.windowBits);if(t!==UA)throw new Error(K[t]);if(this.header=new FA,GA.inflateGetHeader(this.strm,this.header),e.dictionary&&("string"==typeof e.dictionary?e.dictionary=Z(e.dictionary):"[object ArrayBuffer]"===SA.call(e.dictionary)&&(e.dictionary=new Uint8Array(e.dictionary)),e.raw&&(t=GA.inflateSetDictionary(this.strm,e.dictionary))!==UA))throw new Error(K[t])}function qA(A,e){var t=new JA(e);if(t.push(A),t.err)throw t.msg||K[t.err];return t.result}JA.prototype.push=function(A,e){var t,i,r,I=this.strm,g=this.options.chunkSize,n=this.options.dictionary;if(this.ended)return!1;for(i=e===~~e?e:!0===e?RA:vA,"[object ArrayBuffer]"===SA.call(A)?I.input=new Uint8Array(A):I.input=A,I.next_in=0,I.avail_in=I.input.length;;){for(0===I.avail_out&&(I.output=new Uint8Array(g),I.next_out=0,I.avail_out=g),(t=GA.inflate(I,i))===bA&&n&&((t=GA.inflateSetDictionary(I,n))===UA?t=GA.inflate(I,i):t===NA&&(t=bA));I.avail_in>0&&t===LA&&I.state.wrap>0&&0!==A[I.next_in];)GA.inflateReset(I),t=GA.inflate(I,i);switch(t){case MA:case NA:case bA:case xA:return this.onEnd(t),this.ended=!0,!1}if(r=I.avail_out,I.next_out&&(0===I.avail_out||t===LA))if("string"===this.options.to){var a=W(I.output,I.next_out),o=I.next_out-a,B=j(I.output,a);I.next_out=o,I.avail_out=g-o,o&&I.output.set(I.output.subarray(a,a+o),0),this.onData(B)}else this.onData(I.output.length===I.next_out?I.output:I.output.subarray(0,I.next_out));if(t!==UA||0!==r){if(t===LA)return t=GA.inflateEnd(this.strm),this.onEnd(t),this.ended=!0,!0;if(0===I.avail_in)break}}return!0},JA.prototype.onData=function(A){this.chunks.push(A)},JA.prototype.onEnd=function(A){A===UA&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=T(this.chunks)),this.chunks=[],this.err=A,this.msg=this.strm.msg};var YA={Inflate:JA,inflate:qA,inflateRaw:function(A,e){return(e=e||{}).raw=!0,qA(A,e)},ungzip:qA,constants:H}.inflate;function KA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var HA=function(A){s(t,w);var e=KA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return YA(new Uint8Array(A)).buffer}}]),t}(),OA=Object.freeze({__proto__:null,default:HA});function PA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var TA,VA=function(A){s(t,w);var e=PA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){for(var e=new DataView(A),t=[],i=0;i<A.byteLength;++i){var r=e.getInt8(i);if(r<0){var I=e.getUint8(i+1);r=-r;for(var g=0;g<=r;++g)t.push(I);i+=1}else{for(var n=0;n<=r;++n)t.push(e.getUint8(i+n+1));i+=r+1}}return new Uint8Array(t).buffer}}]),t}(),_A=Object.freeze({__proto__:null,default:VA}),XA={exports:{}};TA=XA,\n/* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */\nfunction(){var A,e,t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c=(A={defaultNoDataValue:-34027999387901484e22,decode:function(I,g){var n=(g=g||{}).encodedMaskData||null===g.encodedMaskData,a=r(I,g.inputOffset||0,n),o=null!==g.noDataValue?g.noDataValue:A.defaultNoDataValue,B=e(a,g.pixelType||Float32Array,g.encodedMaskData,o,g.returnMask),C={width:a.width,height:a.height,pixelData:B.resultPixels,minValue:B.minValue,maxValue:a.pixels.maxValue,noDataValue:o};return B.resultMask&&(C.maskData=B.resultMask),g.returnEncodedMask&&a.mask&&(C.encodedMaskData=a.mask.bitset?a.mask.bitset:null),g.returnFileInfo&&(C.fileInfo=t(a),g.computeUsedBitDepths&&(C.fileInfo.bitDepths=i(a))),C}},e=function(A,e,t,i,r){var g,n,a,o=0,B=A.pixels.numBlocksX,C=A.pixels.numBlocksY,Q=Math.floor(A.width/B),E=Math.floor(A.height/C),s=2*A.maxZError,f=Number.MAX_VALUE;t=t||(A.mask?A.mask.bitset:null),n=new e(A.width*A.height),r&&t&&(a=new Uint8Array(A.width*A.height));for(var c,h,l=new Float32Array(Q*E),u=0;u<=C;u++){var w=u!==C?E:A.height%C;if(0!==w)for(var d=0;d<=B;d++){var D=d!==B?Q:A.width%B;if(0!==D){var y,k,p,m,G=u*A.width*E+d*Q,F=A.width-D,S=A.pixels.blocks[o];if(S.encoding<2?(0===S.encoding?y=S.rawData:(I(S.stuffedData,S.bitsPerPixel,S.numValidPixels,S.offset,s,l,A.pixels.maxValue),y=l),k=0):p=2===S.encoding?0:S.offset,t)for(h=0;h<w;h++){for(7&G&&(m=t[G>>3],m<<=7&G),c=0;c<D;c++)7&G||(m=t[G>>3]),128&m?(a&&(a[G]=1),f=f>(g=S.encoding<2?y[k++]:p)?g:f,n[G++]=g):(a&&(a[G]=0),n[G++]=i),m<<=1;G+=F}else if(S.encoding<2)for(h=0;h<w;h++){for(c=0;c<D;c++)f=f>(g=y[k++])?g:f,n[G++]=g;G+=F}else for(f=f>p?p:f,h=0;h<w;h++){for(c=0;c<D;c++)n[G++]=p;G+=F}if(1===S.encoding&&k!==S.numValidPixels)throw"Block and Mask do not match";o++}}}return{resultPixels:n,resultMask:a,minValue:f}},t=function(A){return{fileIdentifierString:A.fileIdentifierString,fileVersion:A.fileVersion,imageType:A.imageType,height:A.height,width:A.width,maxZError:A.maxZError,eofOffset:A.eofOffset,mask:A.mask?{numBlocksX:A.mask.numBlocksX,numBlocksY:A.mask.numBlocksY,numBytes:A.mask.numBytes,maxValue:A.mask.maxValue}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,numBytes:A.pixels.numBytes,maxValue:A.pixels.maxValue,noDataValue:A.noDataValue}}},i=function(A){for(var e=A.pixels.numBlocksX*A.pixels.numBlocksY,t={},i=0;i<e;i++){var r=A.pixels.blocks[i];0===r.encoding?t.float32=!0:1===r.encoding?t[r.bitsPerPixel]=!0:t[0]=!0}return Object.keys(t)},r=function(A,e,t){var i={},r=new Uint8Array(A,e,10);if(i.fileIdentifierString=String.fromCharCode.apply(null,r),"CntZImage"!==i.fileIdentifierString.trim())throw"Unexpected file identifier string: "+i.fileIdentifierString;e+=10;var I=new DataView(A,e,24);if(i.fileVersion=I.getInt32(0,!0),i.imageType=I.getInt32(4,!0),i.height=I.getUint32(8,!0),i.width=I.getUint32(12,!0),i.maxZError=I.getFloat64(16,!0),e+=24,!t)if(I=new DataView(A,e,16),i.mask={},i.mask.numBlocksY=I.getUint32(0,!0),i.mask.numBlocksX=I.getUint32(4,!0),i.mask.numBytes=I.getUint32(8,!0),i.mask.maxValue=I.getFloat32(12,!0),e+=16,i.mask.numBytes>0){var g=new Uint8Array(Math.ceil(i.width*i.height/8)),n=(I=new DataView(A,e,i.mask.numBytes)).getInt16(0,!0),a=2,o=0;do{if(n>0)for(;n--;)g[o++]=I.getUint8(a++);else{var B=I.getUint8(a++);for(n=-n;n--;)g[o++]=B}n=I.getInt16(a,!0),a+=2}while(a<i.mask.numBytes);if(-32768!==n||o<g.length)throw"Unexpected end of mask RLE encoding";i.mask.bitset=g,e+=i.mask.numBytes}else 0==(i.mask.numBytes|i.mask.numBlocksY|i.mask.maxValue)&&(i.mask.bitset=new Uint8Array(Math.ceil(i.width*i.height/8)));I=new DataView(A,e,16),i.pixels={},i.pixels.numBlocksY=I.getUint32(0,!0),i.pixels.numBlocksX=I.getUint32(4,!0),i.pixels.numBytes=I.getUint32(8,!0),i.pixels.maxValue=I.getFloat32(12,!0),e+=16;var C=i.pixels.numBlocksX,Q=i.pixels.numBlocksY,E=C+(i.width%C>0?1:0),s=Q+(i.height%Q>0?1:0);i.pixels.blocks=new Array(E*s);for(var f=0,c=0;c<s;c++)for(var h=0;h<E;h++){var l=0,u=A.byteLength-e;I=new DataView(A,e,Math.min(10,u));var w={};i.pixels.blocks[f++]=w;var d=I.getUint8(0);if(l++,w.encoding=63&d,w.encoding>3)throw"Invalid block encoding ("+w.encoding+")";if(2!==w.encoding){if(0!==d&&2!==d){if(d>>=6,w.offsetType=d,2===d)w.offset=I.getInt8(1),l++;else if(1===d)w.offset=I.getInt16(1,!0),l+=2;else{if(0!==d)throw"Invalid block offset type";w.offset=I.getFloat32(1,!0),l+=4}if(1===w.encoding)if(d=I.getUint8(l),l++,w.bitsPerPixel=63&d,d>>=6,w.numValidPixelsType=d,2===d)w.numValidPixels=I.getUint8(l),l++;else if(1===d)w.numValidPixels=I.getUint16(l,!0),l+=2;else{if(0!==d)throw"Invalid valid pixel count type";w.numValidPixels=I.getUint32(l,!0),l+=4}}var D;if(e+=l,3!==w.encoding)if(0===w.encoding){var y=(i.pixels.numBytes-1)/4;if(y!==Math.floor(y))throw"uncompressed block has invalid length";D=new ArrayBuffer(4*y),new Uint8Array(D).set(new Uint8Array(A,e,4*y));var k=new Float32Array(D);w.rawData=k,e+=4*y}else if(1===w.encoding){var p=Math.ceil(w.numValidPixels*w.bitsPerPixel/8),m=Math.ceil(p/4);D=new ArrayBuffer(4*m),new Uint8Array(D).set(new Uint8Array(A,e,p)),w.stuffedData=new Uint32Array(D),e+=p}}else e++}return i.eofOffset=e,i},I=function(A,e,t,i,r,I,g){var n,a,o,B=(1<<e)-1,C=0,Q=0,E=Math.ceil((g-i)/r),s=4*A.length-Math.ceil(e*t/8);for(A[A.length-1]<<=8*s,n=0;n<t;n++){if(0===Q&&(o=A[C++],Q=32),Q>=e)a=o>>>Q-e&B,Q-=e;else{var f=e-Q;a=(o&B)<<f&B,a+=(o=A[C++])>>>(Q=32-f)}I[n]=a<E?i+a*r:g}return I},A),h=(g=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E=(1<<t)-1,s=0,f=0,c=4*A.length-Math.ceil(t*i/8);if(A[A.length-1]<<=8*c,r)for(a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=r[o];else for(Q=Math.ceil((n-I)/g),a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=o<Q?I+o*g:n},n=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=[],s=4*A.length-Math.ceil(e*t/8);A[A.length-1]<<=8*s;var f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32),C>=e?(Q=g>>>C-e&n,C-=e):(Q=(g&n)<<(B=e-C)&n,Q+=(g=A[a++])>>>(C=32-B)),E[o]=Q<f?i+Q*r:I;return E.unshift(i),E},a=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q=(1<<t)-1,E=0,s=0,f=0;if(r)for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=r[o];else{var c=Math.ceil((n-I)/g);for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=o<c?I+o*g:n}return e},o=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=0,s=[],f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32,E=0),C>=e?(Q=g>>>E&n,C-=e,E+=e):(Q=g>>>E&n,C=32-(B=e-C),Q|=((g=A[a++])&(1<<B)-1)<<e-B,E=B),s[o]=Q<f?i+Q*r:I;return s.unshift(i),s},B=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=4*A.length-Math.ceil(t*i/8);for(A[A.length-1]<<=8*C,r=0;r<i;r++)0===B&&(g=A[o++],B=32),B>=t?(I=g>>>B-t&a,B-=t):(I=(g&a)<<(n=t-B)&a,I+=(g=A[o++])>>>(B=32-n)),e[r]=I;return e},C=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=0;for(r=0;r<i;r++)0===B&&(g=A[o++],B=32,C=0),B>=t?(I=g>>>C&a,B-=t,C+=t):(I=g>>>C&a,B=32-(n=t-B),I|=((g=A[o++])&(1<<n)-1)<<t-n,C=n),e[r]=I;return e},Q={HUFFMAN_LUT_BITS_MAX:12,computeChecksumFletcher32:function(A){for(var e=65535,t=65535,i=A.length,r=Math.floor(i/2),I=0;r;){var g=r>=359?359:r;r-=g;do{e+=A[I++]<<8,t+=e+=A[I++]}while(--g);e=(65535&e)+(e>>>16),t=(65535&t)+(t>>>16)}return 1&i&&(t+=e+=A[I]<<8),((t=(65535&t)+(t>>>16))<<16|(e=(65535&e)+(e>>>16)))>>>0},readHeaderInfo:function(A,e){var t=e.ptr,i=new Uint8Array(A,t,6),r={};if(r.fileIdentifierString=String.fromCharCode.apply(null,i),0!==r.fileIdentifierString.lastIndexOf("Lerc2",0))throw"Unexpected file identifier string (expect Lerc2 ): "+r.fileIdentifierString;t+=6;var I,g=new DataView(A,t,8),n=g.getInt32(0,!0);if(r.fileVersion=n,t+=4,n>=3&&(r.checksum=g.getUint32(4,!0),t+=4),g=new DataView(A,t,12),r.height=g.getUint32(0,!0),r.width=g.getUint32(4,!0),t+=8,n>=4?(r.numDims=g.getUint32(8,!0),t+=4):r.numDims=1,g=new DataView(A,t,40),r.numValidPixel=g.getUint32(0,!0),r.microBlockSize=g.getInt32(4,!0),r.blobSize=g.getInt32(8,!0),r.imageType=g.getInt32(12,!0),r.maxZError=g.getFloat64(16,!0),r.zMin=g.getFloat64(24,!0),r.zMax=g.getFloat64(32,!0),t+=40,e.headerInfo=r,e.ptr=t,n>=3&&(I=n>=4?52:48,this.computeChecksumFletcher32(new Uint8Array(A,t-I,r.blobSize-14))!==r.checksum))throw"Checksum failed.";return!0},checkMinMaxRanges:function(A,e){var t=e.headerInfo,i=this.getDataTypeArray(t.imageType),r=t.numDims*this.getDataTypeSize(t.imageType),I=this.readSubArray(A,e.ptr,i,r),g=this.readSubArray(A,e.ptr+r,i,r);e.ptr+=2*r;var n,a=!0;for(n=0;n<t.numDims;n++)if(I[n]!==g[n]){a=!1;break}return t.minValues=I,t.maxValues=g,a},readSubArray:function(A,e,t,i){var r;if(t===Uint8Array)r=new Uint8Array(A,e,i);else{var I=new ArrayBuffer(i);new Uint8Array(I).set(new Uint8Array(A,e,i)),r=new t(I)}return r},readMask:function(A,e){var t,i,r=e.ptr,I=e.headerInfo,g=I.width*I.height,n=I.numValidPixel,a=new DataView(A,r,4),o={};if(o.numBytes=a.getUint32(0,!0),r+=4,(0===n||g===n)&&0!==o.numBytes)throw"invalid mask";if(0===n)t=new Uint8Array(Math.ceil(g/8)),o.bitset=t,i=new Uint8Array(g),e.pixels.resultMask=i,r+=o.numBytes;else if(o.numBytes>0){t=new Uint8Array(Math.ceil(g/8));var B=(a=new DataView(A,r,o.numBytes)).getInt16(0,!0),C=2,Q=0,E=0;do{if(B>0)for(;B--;)t[Q++]=a.getUint8(C++);else for(E=a.getUint8(C++),B=-B;B--;)t[Q++]=E;B=a.getInt16(C,!0),C+=2}while(C<o.numBytes);if(-32768!==B||Q<t.length)throw"Unexpected end of mask RLE encoding";i=new Uint8Array(g);var s=0,f=0;for(f=0;f<g;f++)7&f?(s=t[f>>3],s<<=7&f):s=t[f>>3],128&s&&(i[f]=1);e.pixels.resultMask=i,o.bitset=t,r+=o.numBytes}return e.ptr=r,e.mask=o,!0},readDataOneSweep:function(A,e,t,i){var r,I=e.ptr,g=e.headerInfo,n=g.numDims,a=g.width*g.height,o=g.imageType,B=g.numValidPixel*Q.getDataTypeSize(o)*n,C=e.pixels.resultMask;if(t===Uint8Array)r=new Uint8Array(A,I,B);else{var E=new ArrayBuffer(B);new Uint8Array(E).set(new Uint8Array(A,I,B)),r=new t(E)}if(r.length===a*n)e.pixels.resultPixels=i?Q.swapDimensionOrder(r,a,n,t,!0):r;else{e.pixels.resultPixels=new t(a*n);var s=0,f=0,c=0,h=0;if(n>1){if(i){for(f=0;f<a;f++)if(C[f])for(h=f,c=0;c<n;c++,h+=a)e.pixels.resultPixels[h]=r[s++]}else for(f=0;f<a;f++)if(C[f])for(h=f*n,c=0;c<n;c++)e.pixels.resultPixels[h+c]=r[s++]}else for(f=0;f<a;f++)C[f]&&(e.pixels.resultPixels[f]=r[s++])}return I+=B,e.ptr=I,!0},readHuffmanTree:function(A,e){var t=this.HUFFMAN_LUT_BITS_MAX,i=new DataView(A,e.ptr,16);if(e.ptr+=16,i.getInt32(0,!0)<2)throw"unsupported Huffman version";var r=i.getInt32(4,!0),I=i.getInt32(8,!0),g=i.getInt32(12,!0);if(I>=g)return!1;var n=new Uint32Array(g-I);Q.decodeBits(A,e,n);var a,o,B,C,s=[];for(a=I;a<g;a++)s[o=a-(a<r?0:r)]={first:n[a-I],second:null};var f=A.byteLength-e.ptr,c=Math.ceil(f/4),h=new ArrayBuffer(4*c);new Uint8Array(h).set(new Uint8Array(A,e.ptr,f));var l,u=new Uint32Array(h),w=0,d=0;for(l=u[0],a=I;a<g;a++)(C=s[o=a-(a<r?0:r)].first)>0&&(s[o].second=l<<w>>>32-C,32-w>=C?32===(w+=C)&&(w=0,l=u[++d]):(w+=C-32,l=u[++d],s[o].second|=l>>>32-w));var D=0,y=0,k=new E;for(a=0;a<s.length;a++)void 0!==s[a]&&(D=Math.max(D,s[a].first));y=D>=t?t:D;var p,m,G,F,S,v=[];for(a=I;a<g;a++)if((C=s[o=a-(a<r?0:r)].first)>0)if(p=[C,o],C<=y)for(m=s[o].second<<y-C,G=1<<y-C,B=0;B<G;B++)v[m|B]=p;else for(m=s[o].second,S=k,F=C-1;F>=0;F--)m>>>F&1?(S.right||(S.right=new E),S=S.right):(S.left||(S.left=new E),S=S.left),0!==F||S.val||(S.val=p[1]);return{decodeLut:v,numBitsLUTQick:y,numBitsLUT:D,tree:k,stuffedData:u,srcPtr:d,bitPos:w}},readHuffman:function(A,e,t,i){var r,I,g,n,a,o,B,C,E,s=e.headerInfo.numDims,f=e.headerInfo.height,c=e.headerInfo.width,h=c*f,l=this.readHuffmanTree(A,e),u=l.decodeLut,w=l.tree,d=l.stuffedData,D=l.srcPtr,y=l.bitPos,k=l.numBitsLUTQick,p=l.numBitsLUT,m=0===e.headerInfo.imageType?128:0,G=e.pixels.resultMask,F=0;y>0&&(D++,y=0);var S,v=d[D],R=1===e.encodeMode,U=new t(h*s),L=U;if(s<2||R){for(S=0;S<s;S++)if(s>1&&(L=new t(U.buffer,h*S,h),F=0),e.headerInfo.numValidPixel===c*f)for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(g+=B>0?F:o>0?L[C-c]:F,g&=255,L[C]=g,F=g):L[C]=g}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++)if(G[C]){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(B>0&&G[C-1]?g+=F:o>0&&G[C-c]?g+=L[C-c]:g+=F,g&=255,L[C]=g,F=g):L[C]=g}}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++)if(C=o*c+B,!G||G[C])for(S=0;S<s;S++,C+=h){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,L[C]=g}e.ptr=e.ptr+4*(D+1)+(y>0?4:0),e.pixels.resultPixels=U,s>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(U,h,s,t))},decodeBits:function(A,e,t,i,r){var I=e.headerInfo,Q=I.fileVersion,E=0,s=A.byteLength-e.ptr>=5?5:A.byteLength-e.ptr,f=new DataView(A,e.ptr,s),c=f.getUint8(0);E++;var h=c>>6,l=0===h?4:3-h,u=(32&c)>0,w=31&c,d=0;if(1===l)d=f.getUint8(E),E++;else if(2===l)d=f.getUint16(E,!0),E+=2;else{if(4!==l)throw"Invalid valid pixel count type";d=f.getUint32(E,!0),E+=4}var D,y,k,p,m,G,F,S,v,R=2*I.maxZError,U=I.numDims>1?I.maxValues[r]:I.zMax;if(u){for(e.counter.lut++,S=f.getUint8(E),E++,p=Math.ceil((S-1)*w/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),k=new Uint8Array(y),e.ptr+=E,k.set(new Uint8Array(A,e.ptr,p)),F=new Uint32Array(y),e.ptr+=p,v=0;S-1>>>v;)v++;p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,G=Q>=3?o(F,w,S-1,i,R,U):n(F,w,S-1,i,R,U),Q>=3?a(D,t,v,d,G):g(D,t,v,d,G)}else e.counter.bitstuffer++,v=w,e.ptr+=E,v>0&&(p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,Q>=3?null==i?C(D,t,v,d):a(D,t,v,d,!1,i,R,U):null==i?B(D,t,v,d):g(D,t,v,d,!1,i,R,U))},readTiles:function(A,e,t,i){var r=e.headerInfo,I=r.width,g=r.height,n=I*g,a=r.microBlockSize,o=r.imageType,B=Q.getDataTypeSize(o),C=Math.ceil(I/a),E=Math.ceil(g/a);e.pixels.numBlocksY=E,e.pixels.numBlocksX=C,e.pixels.ptr=0;var s,f,c,h,l,u,w,d,D,y,k=0,p=0,m=0,G=0,F=0,S=0,v=0,R=0,U=0,L=0,b=0,M=0,N=0,x=0,J=0,q=new t(a*a),Y=g%a||a,K=I%a||a,H=r.numDims,O=e.pixels.resultMask,P=e.pixels.resultPixels,T=r.fileVersion>=5?14:15,V=r.zMax;for(m=0;m<E;m++)for(F=m!==E-1?a:Y,G=0;G<C;G++)for(L=m*I*a+G*a,b=I-(S=G!==C-1?a:K),d=0;d<H;d++){if(H>1?(y=P,L=m*I*a+G*a,P=new t(e.pixels.resultPixels.buffer,n*d*B,n),V=r.maxValues[d]):y=null,v=A.byteLength-e.ptr,f={},J=0,R=(s=new DataView(A,e.ptr,Math.min(10,v))).getUint8(0),J++,D=r.fileVersion>=5?4&R:0,U=R>>6&255,(R>>2&T)!=(G*a>>3&T))throw"integrity issue";if(D&&0===d)throw"integrity issue";if((l=3&R)>3)throw e.ptr+=J,"Invalid block encoding ("+l+")";if(2!==l)if(0===l){if(D)throw"integrity issue";if(e.counter.uncompressed++,e.ptr+=J,M=(M=F*S*B)<(N=A.byteLength-e.ptr)?M:N,c=new ArrayBuffer(M%B==0?M:M+B-M%B),new Uint8Array(c).set(new Uint8Array(A,e.ptr,M)),h=new t(c),x=0,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=h[x++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=h[x++];L+=b}e.ptr+=x*B}else if(u=Q.getDataTypeUsed(D&&o<6?4:o,U),w=Q.getOnePixel(f,J,u,s),J+=Q.getDataTypeSize(u),3===l)if(e.ptr+=J,e.counter.constantoffset++,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=D?Math.min(V,y[L]+w):w),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=D?Math.min(V,y[L]+w):w,L++;L+=b}else if(e.ptr+=J,Q.decodeBits(A,e,q,w,d),J=0,D)if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]+y[L]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=q[J++]+y[L],L++;L+=b}else if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=q[J++];L+=b}else{if(D)if(O)for(k=0;k<F;k++)for(p=0;p<S;p++)O[L]&&(P[L]=y[L]),L++;else for(k=0;k<F;k++)for(p=0;p<S;p++)P[L]=y[L],L++;e.counter.constant++,e.ptr+=J}}H>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(e.pixels.resultPixels,n,H,t))},formatFileInfo:function(A){return{fileIdentifierString:A.headerInfo.fileIdentifierString,fileVersion:A.headerInfo.fileVersion,imageType:A.headerInfo.imageType,height:A.headerInfo.height,width:A.headerInfo.width,numValidPixel:A.headerInfo.numValidPixel,microBlockSize:A.headerInfo.microBlockSize,blobSize:A.headerInfo.blobSize,maxZError:A.headerInfo.maxZError,pixelType:Q.getPixelType(A.headerInfo.imageType),eofOffset:A.eofOffset,mask:A.mask?{numBytes:A.mask.numBytes}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,maxValue:A.headerInfo.zMax,minValue:A.headerInfo.zMin,noDataValue:A.noDataValue}}},constructConstantSurface:function(A,e){var t=A.headerInfo.zMax,i=A.headerInfo.zMin,r=A.headerInfo.maxValues,I=A.headerInfo.numDims,g=A.headerInfo.height*A.headerInfo.width,n=0,a=0,o=0,B=A.pixels.resultMask,C=A.pixels.resultPixels;if(B)if(I>1){if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)B[a]&&(C[o+a]=t);else for(a=0;a<g;a++)if(B[a])for(o=a*I,n=0;n<I;n++)C[o+I]=r[n]}else for(a=0;a<g;a++)B[a]&&(C[a]=t);else if(I>1&&i!==t)if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)C[o+a]=t;else for(a=0;a<g;a++)for(o=a*I,n=0;n<I;n++)C[o+n]=r[n];else for(a=0;a<g*I;a++)C[a]=t},getDataTypeArray:function(A){var e;switch(A){case 0:e=Int8Array;break;case 1:e=Uint8Array;break;case 2:e=Int16Array;break;case 3:e=Uint16Array;break;case 4:e=Int32Array;break;case 5:e=Uint32Array;break;case 6:default:e=Float32Array;break;case 7:e=Float64Array}return e},getPixelType:function(A){var e;switch(A){case 0:e="S8";break;case 1:e="U8";break;case 2:e="S16";break;case 3:e="U16";break;case 4:e="S32";break;case 5:e="U32";break;case 6:default:e="F32";break;case 7:e="F64"}return e},isValidPixelValue:function(A,e){if(null==e)return!1;var t;switch(A){case 0:t=e>=-128&&e<=127;break;case 1:t=e>=0&&e<=255;break;case 2:t=e>=-32768&&e<=32767;break;case 3:t=e>=0&&e<=65536;break;case 4:t=e>=-2147483648&&e<=2147483647;break;case 5:t=e>=0&&e<=4294967296;break;case 6:t=e>=-34027999387901484e22&&e<=34027999387901484e22;break;case 7:t=e>=-17976931348623157e292&&e<=17976931348623157e292;break;default:t=!1}return t},getDataTypeSize:function(A){var e=0;switch(A){case 0:case 1:e=1;break;case 2:case 3:e=2;break;case 4:case 5:case 6:e=4;break;case 7:e=8;break;default:e=A}return e},getDataTypeUsed:function(A,e){var t=A;switch(A){case 2:case 4:t=A-e;break;case 3:case 5:t=A-2*e;break;case 6:t=0===e?A:1===e?2:1;break;case 7:t=0===e?A:A-2*e+1;break;default:t=A}return t},getOnePixel:function(A,e,t,i){var r=0;switch(t){case 0:r=i.getInt8(e);break;case 1:r=i.getUint8(e);break;case 2:r=i.getInt16(e,!0);break;case 3:r=i.getUint16(e,!0);break;case 4:r=i.getInt32(e,!0);break;case 5:r=i.getUInt32(e,!0);break;case 6:r=i.getFloat32(e,!0);break;case 7:r=i.getFloat64(e,!0);break;default:throw"the decoder does not understand this pixel type"}return r},swapDimensionOrder:function(A,e,t,i,r){var I=0,g=0,n=0,a=0,o=A;if(t>1)if(o=new i(e*t),r)for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[a]=A[g++];else for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[g++]=A[a];return o}},E=function(A,e,t){this.val=A,this.left=e,this.right=t},{decode:function(A,e){var t=(e=e||{}).noDataValue,i=0,r={};r.ptr=e.inputOffset||0,r.pixels={},Q.readHeaderInfo(A,r);var I=r.headerInfo,g=I.fileVersion,n=Q.getDataTypeArray(I.imageType);if(g>5)throw"unsupported lerc version 2."+g;Q.readMask(A,r),I.numValidPixel===I.width*I.height||r.pixels.resultMask||(r.pixels.resultMask=e.maskData);var a=I.width*I.height;r.pixels.resultPixels=new n(a*I.numDims),r.counter={onesweep:0,uncompressed:0,lut:0,bitstuffer:0,constant:0,constantoffset:0};var o,B=!e.returnPixelInterleavedDims;if(0!==I.numValidPixel)if(I.zMax===I.zMin)Q.constructConstantSurface(r,B);else if(g>=4&&Q.checkMinMaxRanges(A,r))Q.constructConstantSurface(r,B);else{var C=new DataView(A,r.ptr,2),E=C.getUint8(0);if(r.ptr++,E)Q.readDataOneSweep(A,r,n,B);else if(g>1&&I.imageType<=1&&Math.abs(I.maxZError-.5)<1e-5){var s=C.getUint8(1);if(r.ptr++,r.encodeMode=s,s>2||g<4&&s>1)throw"Invalid Huffman flag "+s;s?Q.readHuffman(A,r,n,B):Q.readTiles(A,r,n,B)}else Q.readTiles(A,r,n,B)}r.eofOffset=r.ptr,e.inputOffset?(o=r.headerInfo.blobSize+e.inputOffset-r.ptr,Math.abs(o)>=1&&(r.eofOffset=e.inputOffset+r.headerInfo.blobSize)):(o=r.headerInfo.blobSize-r.ptr,Math.abs(o)>=1&&(r.eofOffset=r.headerInfo.blobSize));var f={width:I.width,height:I.height,pixelData:r.pixels.resultPixels,minValue:I.zMin,maxValue:I.zMax,validPixelCount:I.numValidPixel,dimCount:I.numDims,dimStats:{minValues:I.minValues,maxValues:I.maxValues},maskData:r.pixels.resultMask};if(r.pixels.resultMask&&Q.isValidPixelValue(I.imageType,t)){var c=r.pixels.resultMask;for(i=0;i<a;i++)c[i]||(f.pixelData[i]=t);f.noDataValue=t}return r.noDataValue=t,e.returnFileInfo&&(f.fileInfo=Q.formatFileInfo(r)),f},getBandCount:function(A){for(var e=0,t=0,i={ptr:0,pixels:{}};t<A.byteLength-58;)Q.readHeaderInfo(A,i),t+=i.headerInfo.blobSize,e++,i.ptr=t;return e}}),l=(s=new ArrayBuffer(4),f=new Uint8Array(s),new Uint32Array(s)[0]=1,1===f[0]),u={decode:function(A,e){if(!l)throw"Big endian system is not supported.";var t,i,r=(e=e||{}).inputOffset||0,I=new Uint8Array(A,r,10),g=String.fromCharCode.apply(null,I);if("CntZImage"===g.trim())t=c,i=1;else{if("Lerc2"!==g.substring(0,5))throw"Unexpected file identifier string: "+g;t=h,i=2}for(var n,a,o,B,C,Q,E=0,s=A.byteLength-10,f=[],u={width:0,height:0,pixels:[],pixelType:e.pixelType,mask:null,statistics:[]},w=0;r<s;){var d=t.decode(A,{inputOffset:r,encodedMaskData:n,maskData:o,returnMask:0===E,returnEncodedMask:0===E,returnFileInfo:!0,returnPixelInterleavedDims:e.returnPixelInterleavedDims,pixelType:e.pixelType||null,noDataValue:e.noDataValue||null});r=d.fileInfo.eofOffset,o=d.maskData,0===E&&(n=d.encodedMaskData,u.width=d.width,u.height=d.height,u.dimCount=d.dimCount||1,u.pixelType=d.pixelType||d.fileInfo.pixelType,u.mask=o),i>1&&(o&&f.push(o),d.fileInfo.mask&&d.fileInfo.mask.numBytes>0&&w++),E++,u.pixels.push(d.pixelData),u.statistics.push({minValue:d.minValue,maxValue:d.maxValue,noDataValue:d.noDataValue,dimStats:d.dimStats})}if(i>1&&w>1){for(Q=u.width*u.height,u.bandMasks=f,(o=new Uint8Array(Q)).set(f[0]),B=1;B<f.length;B++)for(a=f[B],C=0;C<Q;C++)o[C]=o[C]&a[C];u.maskData=o}return u}};TA.exports?TA.exports=u:this.Lerc=u}();var ZA,jA,WA,zA=XA.exports,$A={env:{emscripten_notify_memory_growth:function(A){WA=new Uint8Array(jA.exports.memory.buffer)}}},Ae=function(){function A(){B(this,A)}return Q(A,[{key:"init",value:function(){return ZA||(ZA="undefined"!=typeof fetch?fetch("data:application/wasm;base64,"+ee).then((function(A){return A.arrayBuffer()})).then((function(A){return WebAssembly.instantiate(A,$A)})).then(this._init):WebAssembly.instantiate(Buffer.from(ee,"base64"),$A).then(this._init))}},{key:"_init",value:function(A){jA=A.instance,$A.env.emscripten_notify_memory_growth(0)}},{key:"decode",value:function(A){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0;if(!jA)throw new Error("ZSTDDecoder: Await .init() before decoding.");var t=A.byteLength,i=jA.exports.malloc(t);WA.set(A,i),e=e||Number(jA.exports.ZSTD_findDecompressedSize(i,t));var r=jA.exports.malloc(e),I=jA.exports.ZSTD_decompress(r,e,i,t),g=WA.slice(r,r+I);return jA.exports.free(i),jA.exports.free(r),g}}]),A}(),ee="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IAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQh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ASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigC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C0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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",te={315:"Artist",258:"BitsPerSample",265:"CellLength",264:"CellWidth",320:"ColorMap",259:"Compression",33432:"Copyright",306:"DateTime",338:"ExtraSamples",266:"FillOrder",289:"FreeByteCounts",288:"FreeOffsets",291:"GrayResponseCurve",290:"GrayResponseUnit",316:"HostComputer",270:"ImageDescription",257:"ImageLength",256:"ImageWidth",271:"Make",281:"MaxSampleValue",280:"MinSampleValue",272:"Model",254:"NewSubfileType",274:"Orientation",262:"PhotometricInterpretation",284:"PlanarConfiguration",296:"ResolutionUnit",278:"RowsPerStrip",277:"SamplesPerPixel",305:"Software",279:"StripByteCounts",273:"StripOffsets",255:"SubfileType",263:"Threshholding",282:"XResolution",283:"YResolution",326:"BadFaxLines",327:"CleanFaxData",343:"ClipPath",328:"ConsecutiveBadFaxLines",433:"Decode",434:"DefaultImageColor",269:"DocumentName",336:"DotRange",321:"HalftoneHints",346:"Indexed",347:"JPEGTables",285:"PageName",297:"PageNumber",317:"Predictor",319:"PrimaryChromaticities",532:"ReferenceBlackWhite",339:"SampleFormat",340:"SMinSampleValue",341:"SMaxSampleValue",559:"StripRowCounts",330:"SubIFDs",292:"T4Options",293:"T6Options",325:"TileByteCounts",323:"TileLength",324:"TileOffsets",322:"TileWidth",301:"TransferFunction",318:"WhitePoint",344:"XClipPathUnits",286:"XPosition",529:"YCbCrCoefficients",531:"YCbCrPositioning",530:"YCbCrSubSampling",345:"YClipPathUnits",287:"YPosition",37378:"ApertureValue",40961:"ColorSpace",36868:"DateTimeDigitized",36867:"DateTimeOriginal",34665:"Exif IFD",36864:"ExifVersion",33434:"ExposureTime",41728:"FileSource",37385:"Flash",40960:"FlashpixVersion",33437:"FNumber",42016:"ImageUniqueID",37384:"LightSource",37500:"MakerNote",37377:"ShutterSpeedValue",37510:"UserComment",33723:"IPTC",34675:"ICC Profile",700:"XMP",42112:"GDAL_METADATA",42113:"GDAL_NODATA",34377:"Photoshop",33550:"ModelPixelScale",33922:"ModelTiepoint",34264:"ModelTransformation",34735:"GeoKeyDirectory",34736:"GeoDoubleParams",34737:"GeoAsciiParams",50674:"LercParameters"},ie={};for(var re in te)te.hasOwnProperty(re)&&(ie[te[re]]=parseInt(re,10));ie.BitsPerSample,ie.ExtraSamples,ie.SampleFormat,ie.StripByteCounts,ie.StripOffsets,ie.StripRowCounts,ie.TileByteCounts,ie.TileOffsets,ie.SubIFDs;var Ie={1:"BYTE",2:"ASCII",3:"SHORT",4:"LONG",5:"RATIONAL",6:"SBYTE",7:"UNDEFINED",8:"SSHORT",9:"SLONG",10:"SRATIONAL",11:"FLOAT",12:"DOUBLE",13:"IFD",16:"LONG8",17:"SLONG8",18:"IFD8"},ge={};for(var ne in Ie)Ie.hasOwnProperty(ne)&&(ge[Ie[ne]]=parseInt(ne,10));var ae=1,oe=0,Be=1,Ce=2,Qe={1024:"GTModelTypeGeoKey",1025:"GTRasterTypeGeoKey",1026:"GTCitationGeoKey",2048:"GeographicTypeGeoKey",2049:"GeogCitationGeoKey",2050:"GeogGeodeticDatumGeoKey",2051:"GeogPrimeMeridianGeoKey",2052:"GeogLinearUnitsGeoKey",2053:"GeogLinearUnitSizeGeoKey",2054:"GeogAngularUnitsGeoKey",2055:"GeogAngularUnitSizeGeoKey",2056:"GeogEllipsoidGeoKey",2057:"GeogSemiMajorAxisGeoKey",2058:"GeogSemiMinorAxisGeoKey",2059:"GeogInvFlatteningGeoKey",2060:"GeogAzimuthUnitsGeoKey",2061:"GeogPrimeMeridianLongGeoKey",2062:"GeogTOWGS84GeoKey",3072:"ProjectedCSTypeGeoKey",3073:"PCSCitationGeoKey",3074:"ProjectionGeoKey",3075:"ProjCoordTransGeoKey",3076:"ProjLinearUnitsGeoKey",3077:"ProjLinearUnitSizeGeoKey",3078:"ProjStdParallel1GeoKey",3079:"ProjStdParallel2GeoKey",3080:"ProjNatOriginLongGeoKey",3081:"ProjNatOriginLatGeoKey",3082:"ProjFalseEastingGeoKey",3083:"ProjFalseNorthingGeoKey",3084:"ProjFalseOriginLongGeoKey",3085:"ProjFalseOriginLatGeoKey",3086:"ProjFalseOriginEastingGeoKey",3087:"ProjFalseOriginNorthingGeoKey",3088:"ProjCenterLongGeoKey",3089:"ProjCenterLatGeoKey",3090:"ProjCenterEastingGeoKey",3091:"ProjCenterNorthingGeoKey",3092:"ProjScaleAtNatOriginGeoKey",3093:"ProjScaleAtCenterGeoKey",3094:"ProjAzimuthAngleGeoKey",3095:"ProjStraightVertPoleLongGeoKey",3096:"ProjRectifiedGridAngleGeoKey",4096:"VerticalCSTypeGeoKey",4097:"VerticalCitationGeoKey",4098:"VerticalDatumGeoKey",4099:"VerticalUnitsGeoKey"},Ee={};for(var se in Qe)Qe.hasOwnProperty(se)&&(Ee[Qe[se]]=parseInt(se,10));function fe(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var ce=new Ae,he=function(A){s(t,w);var e=fe(t);function t(A){var i;return B(this,t),(i=e.call(this)).planarConfiguration=void 0!==A.PlanarConfiguration?A.PlanarConfiguration:1,i.samplesPerPixel=void 0!==A.SamplesPerPixel?A.SamplesPerPixel:1,i.addCompression=A.LercParameters[ae],i}return Q(t,[{key:"decodeBlock",value:function(A){switch(this.addCompression){case oe:break;case Be:A=YA(new Uint8Array(A)).buffer;break;case Ce:A=ce.decode(new Uint8Array(A)).buffer;break;default:throw new Error("Unsupported LERC additional compression method identifier: ".concat(this.addCompression))}return zA.decode(A,{returnPixelInterleavedDims:1===this.planarConfiguration}).pixels[0].buffer}}]),t}(),le=Object.freeze({__proto__:null,zstd:ce,default:he});function ue(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var we=function(A){s(I,w);var t,i=ue(I);function I(){var A;if(B(this,I),A=i.call(this),"undefined"==typeof createImageBitmap)throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");if("undefined"==typeof document&&"undefined"==typeof OffscreenCanvas)throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");return A}return Q(I,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return i=new Blob([t]),A.next=3,createImageBitmap(i);case 3:return I=A.sent,"undefined"!=typeof document?((g=document.createElement("canvas")).width=I.width,g.height=I.height):g=new OffscreenCanvas(I.width,I.height),(n=g.getContext("2d")).drawImage(I,0,0),A.abrupt("return",n.getImageData(0,0,I.width,I.height).data.buffer);case 8:case"end":return A.stop()}}),A)}))),function(A,e){return t.apply(this,arguments)})}]),I}(),de=Object.freeze({__proto__:null,default:we});';
  return new qa(typeof Buffer < "u" ? "data:application/javascript;base64," + Buffer.from(t, "binary").toString("base64") : URL.createObjectURL(new Blob([t], { type: "application/javascript" })));
}
const Ha = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  create: Ja
}, Symbol.toStringTag, { value: "Module" }));
export {
  eo as enableGeoTIFFTileSource
};
