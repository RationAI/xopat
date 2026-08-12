var ar = Object.defineProperty;
var sr = (t, e, A) => e in t ? ar(t, e, { enumerable: !0, configurable: !0, writable: !0, value: A }) : t[e] = A;
var ye = (t, e, A) => sr(t, typeof e != "symbol" ? e + "" : e, A);
function Z(t) {
  return (e, ...A) => gr(t, e, A);
}
function NA(t, e) {
  return Z(
    ti(
      t,
      e
    ).get
  );
}
const {
  apply: gr,
  getOwnPropertyDescriptor: ti,
  getPrototypeOf: ze,
  ownKeys: Ir
} = Reflect, {
  iterator: jA,
  toStringTag: Br
} = Symbol, lr = Object, {
  create: $e,
  defineProperty: fr
} = lr, cr = Array, Cr = cr.prototype, ii = Cr[jA], Er = Z(ii), ri = ArrayBuffer, Qr = ri.prototype;
NA(Qr, "byteLength");
const Ct = typeof SharedArrayBuffer < "u" ? SharedArrayBuffer : null;
Ct && NA(Ct.prototype, "byteLength");
const ni = ze(Uint8Array);
ni.from;
const AA = ni.prototype;
AA[jA];
Z(AA.keys);
Z(
  AA.values
);
Z(
  AA.entries
);
Z(AA.set);
Z(
  AA.reverse
);
Z(AA.fill);
Z(
  AA.copyWithin
);
Z(AA.sort);
Z(AA.slice);
Z(
  AA.subarray
);
NA(
  AA,
  "buffer"
);
NA(
  AA,
  "byteOffset"
);
NA(
  AA,
  "length"
);
NA(
  AA,
  Br
);
const hr = Uint8Array, oi = Uint16Array, At = Uint32Array, ur = Float32Array, _A = ze([][jA]()), ai = Z(_A.next), dr = Z(function* () {
}().next), wr = ze(_A), yr = DataView.prototype, Dr = Z(
  yr.getUint16
), et = WeakMap, si = et.prototype, gi = Z(si.get), mr = Z(si.set), Ii = new et(), pr = $e(null, {
  next: {
    value: function() {
      const e = gi(Ii, this);
      return ai(e);
    }
  },
  [jA]: {
    value: function() {
      return this;
    }
  }
});
function kr(t) {
  if (t[jA] === ii && _A.next === ai)
    return t;
  const e = $e(pr);
  return mr(Ii, e, Er(t)), e;
}
const Fr = new et(), Sr = $e(wr, {
  next: {
    value: function() {
      const e = gi(Fr, this);
      return dr(e);
    },
    writable: !0,
    configurable: !0
  }
});
for (const t of Ir(_A))
  t !== "next" && fr(Sr, t, ti(_A, t));
const Bi = new ri(4), Gr = new ur(Bi), xr = new At(Bi), aA = new oi(512), sA = new hr(512);
for (let t = 0; t < 256; ++t) {
  const e = t - 127;
  e < -24 ? (aA[t] = 0, aA[t | 256] = 32768, sA[t] = 24, sA[t | 256] = 24) : e < -14 ? (aA[t] = 1024 >> -e - 14, aA[t | 256] = 1024 >> -e - 14 | 32768, sA[t] = -e - 1, sA[t | 256] = -e - 1) : e <= 15 ? (aA[t] = e + 15 << 10, aA[t | 256] = e + 15 << 10 | 32768, sA[t] = 13, sA[t | 256] = 13) : e < 128 ? (aA[t] = 31744, aA[t | 256] = 64512, sA[t] = 24, sA[t | 256] = 24) : (aA[t] = 31744, aA[t | 256] = 64512, sA[t] = 13, sA[t | 256] = 13);
}
const tt = new At(2048);
for (let t = 1; t < 1024; ++t) {
  let e = t << 13, A = 0;
  for (; !(e & 8388608); )
    e <<= 1, A -= 8388608;
  e &= -8388609, A += 947912704, tt[t] = e | A;
}
for (let t = 1024; t < 2048; ++t)
  tt[t] = 939524096 + (t - 1024 << 13);
const TA = new At(64);
for (let t = 1; t < 31; ++t)
  TA[t] = t << 23;
TA[31] = 1199570944;
TA[32] = 2147483648;
for (let t = 33; t < 63; ++t)
  TA[t] = 2147483648 + (t - 32 << 23);
TA[63] = 3347054592;
const li = new oi(64);
for (let t = 1; t < 64; ++t)
  t !== 32 && (li[t] = 1024);
function br(t) {
  const e = t >> 10;
  return xr[0] = tt[li[e] + (t & 1023)] + TA[e], Gr[0];
}
function fi(t, e, ...A) {
  return br(
    Dr(t, e, ...kr(A))
  );
}
function it(t) {
  return t && t.__esModule && Object.prototype.hasOwnProperty.call(t, "default") ? t.default : t;
}
var rt = { exports: {} };
function ci(t, e, A) {
  const i = A && A.debug || !1;
  i && console.log("[xml-utils] getting " + e + " in " + t);
  const n = typeof t == "object" ? t.outer : t, o = n.slice(0, n.indexOf(">") + 1), I = ['"', "'"];
  for (let s = 0; s < I.length; s++) {
    const y = I[s], a = e + "\\=" + y + "([^" + y + "]*)" + y;
    i && console.log("[xml-utils] pattern:", a);
    const g = new RegExp(a).exec(o);
    if (i && console.log("[xml-utils] match:", g), g) return g[1];
  }
}
rt.exports = ci;
rt.exports.default = ci;
var Rr = rt.exports;
const De = /* @__PURE__ */ it(Rr);
var nt = { exports: {} }, ot = { exports: {} }, at = { exports: {} };
function Ci(t, e, A) {
  const n = new RegExp(e).exec(t.slice(A));
  return n ? A + n.index : -1;
}
at.exports = Ci;
at.exports.default = Ci;
var vr = at.exports, st = { exports: {} };
function Ei(t, e, A) {
  const n = new RegExp(e).exec(t.slice(A));
  return n ? A + n.index + n[0].length - 1 : -1;
}
st.exports = Ei;
st.exports.default = Ei;
var Ur = st.exports, gt = { exports: {} };
function Qi(t, e) {
  const A = new RegExp(e, "g"), i = t.match(A);
  return i ? i.length : 0;
}
gt.exports = Qi;
gt.exports.default = Qi;
var Lr = gt.exports;
const Mr = vr, me = Ur, Et = Lr;
function hi(t, e, A) {
  const i = A && A.debug || !1, n = !(A && typeof A.nested === !1), o = A && A.startIndex || 0;
  i && console.log("[xml-utils] starting findTagByName with", e, " and ", A);
  const I = Mr(t, `<${e}[ 
>/]`, o);
  if (i && console.log("[xml-utils] start:", I), I === -1) return;
  const s = t.slice(I + e.length);
  let y = me(s, "^[^<]*[ /]>", 0);
  const a = y !== -1 && s[y - 1] === "/";
  if (i && console.log("[xml-utils] selfClosing:", a), a === !1)
    if (n) {
      let B = 0, f = 1, c = 0;
      for (; (y = me(s, "[ /]" + e + ">", B)) !== -1; ) {
        const l = s.substring(B, y + 1);
        if (f += Et(l, "<" + e + `[ 
	>]`), c += Et(l, "</" + e + ">"), c >= f) break;
        B = y;
      }
    } else
      y = me(s, "[ /]" + e + ">", 0);
  const r = I + e.length + y + 1;
  if (i && console.log("[xml-utils] end:", r), r === -1) return;
  const g = t.slice(I, r);
  let E;
  return a ? E = null : E = g.slice(g.indexOf(">") + 1, g.lastIndexOf("<")), { inner: E, outer: g, start: I, end: r };
}
ot.exports = hi;
ot.exports.default = hi;
var Nr = ot.exports;
const Tr = Nr;
function ui(t, e, A) {
  const i = [], n = A && A.debug || !1, o = A && typeof A.nested == "boolean" ? A.nested : !0;
  let I = A && A.startIndex || 0, s;
  for (; s = Tr(t, e, { debug: n, startIndex: I }); )
    o ? I = s.start + 1 + e.length : I = s.end, i.push(s);
  return n && console.log("findTagsByName found", i.length, "tags"), i;
}
nt.exports = ui;
nt.exports.default = ui;
var qr = nt.exports;
const Jr = /* @__PURE__ */ it(qr), pA = {
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
}, rA = {};
for (const t in pA)
  pA.hasOwnProperty(t) && (rA[pA[t]] = parseInt(t, 10));
const fe = {
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
}, di = [
  rA.BitsPerSample,
  rA.ExtraSamples,
  rA.SampleFormat,
  rA.StripByteCounts,
  rA.StripOffsets,
  rA.StripRowCounts,
  rA.TileByteCounts,
  rA.TileOffsets,
  rA.SubIFDs
], HA = {
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
}, K = {};
for (const t in HA)
  HA.hasOwnProperty(t) && (K[HA[t]] = parseInt(t, 10));
const z = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  TransparencyMask: 4,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8,
  ICCLab: 9
}, wi = {
  Unspecified: 0,
  Assocalpha: 1,
  Unassalpha: 2
}, yi = {
  Version: 0,
  AddCompression: 1
}, Be = {
  None: 0,
  Deflate: 1,
  Zstandard: 2
}, vA = {
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
}, Di = {};
for (const t in vA)
  vA.hasOwnProperty(t) && (Di[vA[t]] = parseInt(t, 10));
const Yr = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ExtraSamplesValues: wi,
  LercAddCompression: Be,
  LercParameters: yi,
  arrayFields: di,
  fieldTagNames: pA,
  fieldTagTypes: fe,
  fieldTags: rA,
  fieldTypeNames: HA,
  fieldTypes: K,
  geoKeyNames: vA,
  geoKeys: Di,
  photometricInterpretations: z
}, Symbol.toStringTag, { value: "Module" }));
function mi(t, e) {
  const { width: A, height: i } = t, n = new Uint8Array(A * i * 3);
  let o;
  for (let I = 0, s = 0; I < t.length; ++I, s += 3)
    o = 256 - t[I] / e * 256, n[s] = o, n[s + 1] = o, n[s + 2] = o;
  return n;
}
function pi(t, e) {
  const { width: A, height: i } = t, n = new Uint8Array(A * i * 3);
  let o;
  for (let I = 0, s = 0; I < t.length; ++I, s += 3)
    o = t[I] / e * 256, n[s] = o, n[s + 1] = o, n[s + 2] = o;
  return n;
}
function ki(t, e) {
  const { width: A, height: i } = t, n = new Uint8Array(A * i * 3), o = e.length / 3, I = e.length / 3 * 2;
  for (let s = 0, y = 0; s < t.length; ++s, y += 3) {
    const a = t[s];
    n[y] = e[a] / 65536 * 256, n[y + 1] = e[a + o] / 65536 * 256, n[y + 2] = e[a + I] / 65536 * 256;
  }
  return n;
}
function Fi(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let n = 0, o = 0; n < t.length; n += 4, o += 3) {
    const I = t[n], s = t[n + 1], y = t[n + 2], a = t[n + 3];
    i[o] = 255 * ((255 - I) / 256) * ((255 - a) / 256), i[o + 1] = 255 * ((255 - s) / 256) * ((255 - a) / 256), i[o + 2] = 255 * ((255 - y) / 256) * ((255 - a) / 256);
  }
  return i;
}
function Si(t) {
  const { width: e, height: A } = t, i = new Uint8ClampedArray(e * A * 3);
  for (let n = 0, o = 0; n < t.length; n += 3, o += 3) {
    const I = t[n], s = t[n + 1], y = t[n + 2];
    i[o] = I + 1.402 * (y - 128), i[o + 1] = I - 0.34414 * (s - 128) - 0.71414 * (y - 128), i[o + 2] = I + 1.772 * (s - 128);
  }
  return i;
}
const Hr = 0.95047, Or = 1, Kr = 1.08883;
function Gi(t) {
  const { width: e, height: A } = t, i = new Uint8Array(e * A * 3);
  for (let n = 0, o = 0; n < t.length; n += 3, o += 3) {
    const I = t[n + 0], s = t[n + 1] << 24 >> 24, y = t[n + 2] << 24 >> 24;
    let a = (I + 16) / 116, r = s / 500 + a, g = a - y / 200, E, B, f;
    r = Hr * (r * r * r > 8856e-6 ? r * r * r : (r - 16 / 116) / 7.787), a = Or * (a * a * a > 8856e-6 ? a * a * a : (a - 16 / 116) / 7.787), g = Kr * (g * g * g > 8856e-6 ? g * g * g : (g - 16 / 116) / 7.787), E = r * 3.2406 + a * -1.5372 + g * -0.4986, B = r * -0.9689 + a * 1.8758 + g * 0.0415, f = r * 0.0557 + a * -0.204 + g * 1.057, E = E > 31308e-7 ? 1.055 * E ** (1 / 2.4) - 0.055 : 12.92 * E, B = B > 31308e-7 ? 1.055 * B ** (1 / 2.4) - 0.055 : 12.92 * B, f = f > 31308e-7 ? 1.055 * f ** (1 / 2.4) - 0.055 : 12.92 * f, i[o] = Math.max(0, Math.min(1, E)) * 255, i[o + 1] = Math.max(0, Math.min(1, B)) * 255, i[o + 2] = Math.max(0, Math.min(1, f)) * 255;
  }
  return i;
}
const _r = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  fromBlackIsZero: pi,
  fromCIELab: Gi,
  fromCMYK: Fi,
  fromPalette: ki,
  fromWhiteIsZero: mi,
  fromYCbCr: Si
}, Symbol.toStringTag, { value: "Module" })), xi = /* @__PURE__ */ new Map();
function CA(t, e) {
  Array.isArray(t) || (t = [t]), t.forEach((A) => xi.set(A, e));
}
async function It(t) {
  const e = xi.get(t.Compression);
  if (!e)
    throw new Error(`Unknown compression method identifier: ${t.Compression}`);
  const A = await e();
  return new A(t);
}
CA([void 0, 1], () => Promise.resolve().then(() => Eo).then((t) => t.default));
CA(5, () => Promise.resolve().then(() => yo).then((t) => t.default));
CA(6, () => {
  throw new Error("old style JPEG compression is not supported.");
});
CA(7, () => Promise.resolve().then(() => Fo).then((t) => t.default));
CA([8, 32946], () => Promise.resolve().then(() => Ha).then((t) => t.default));
CA(32773, () => Promise.resolve().then(() => Ka).then((t) => t.default));
CA(
  34887,
  () => Promise.resolve().then(() => Xa).then(async (t) => (await t.zstd.init(), t)).then((t) => t.default)
);
CA(50001, () => Promise.resolve().then(() => Za).then((t) => t.default));
function Ee(t, e, A, i = 1) {
  return new (Object.getPrototypeOf(t)).constructor(e * A * i);
}
function Pr(t, e, A, i, n) {
  const o = e / i, I = A / n;
  return t.map((s) => {
    const y = Ee(s, i, n);
    for (let a = 0; a < n; ++a) {
      const r = Math.min(Math.round(I * a), A - 1);
      for (let g = 0; g < i; ++g) {
        const E = Math.min(Math.round(o * g), e - 1), B = s[r * e + E];
        y[a * i + g] = B;
      }
    }
    return y;
  });
}
function UA(t, e, A) {
  return (1 - A) * t + A * e;
}
function Vr(t, e, A, i, n) {
  const o = e / i, I = A / n;
  return t.map((s) => {
    const y = Ee(s, i, n);
    for (let a = 0; a < n; ++a) {
      const r = I * a, g = Math.floor(r), E = Math.min(Math.ceil(r), A - 1);
      for (let B = 0; B < i; ++B) {
        const f = o * B, c = f % 1, l = Math.floor(f), u = Math.min(Math.ceil(f), e - 1), h = s[g * e + l], D = s[g * e + u], d = s[E * e + l], Q = s[E * e + u], C = UA(
          UA(h, D, c),
          UA(d, Q, c),
          r % 1
        );
        y[a * i + B] = C;
      }
    }
    return y;
  });
}
function jr(t, e, A, i, n, o = "nearest") {
  switch (o.toLowerCase()) {
    case "nearest":
      return Pr(t, e, A, i, n);
    case "bilinear":
    case "linear":
      return Vr(t, e, A, i, n);
    default:
      throw new Error(`Unsupported resampling method: '${o}'`);
  }
}
function Xr(t, e, A, i, n, o) {
  const I = e / i, s = A / n, y = Ee(t, i, n, o);
  for (let a = 0; a < n; ++a) {
    const r = Math.min(Math.round(s * a), A - 1);
    for (let g = 0; g < i; ++g) {
      const E = Math.min(Math.round(I * g), e - 1);
      for (let B = 0; B < o; ++B) {
        const f = t[r * e * o + E * o + B];
        y[a * i * o + g * o + B] = f;
      }
    }
  }
  return y;
}
function Wr(t, e, A, i, n, o) {
  const I = e / i, s = A / n, y = Ee(t, i, n, o);
  for (let a = 0; a < n; ++a) {
    const r = s * a, g = Math.floor(r), E = Math.min(Math.ceil(r), A - 1);
    for (let B = 0; B < i; ++B) {
      const f = I * B, c = f % 1, l = Math.floor(f), u = Math.min(Math.ceil(f), e - 1);
      for (let h = 0; h < o; ++h) {
        const D = t[g * e * o + l * o + h], d = t[g * e * o + u * o + h], Q = t[E * e * o + l * o + h], C = t[E * e * o + u * o + h], w = UA(
          UA(D, d, c),
          UA(Q, C, c),
          r % 1
        );
        y[a * i * o + B * o + h] = w;
      }
    }
  }
  return y;
}
function Zr(t, e, A, i, n, o, I = "nearest") {
  switch (I.toLowerCase()) {
    case "nearest":
      return Xr(
        t,
        e,
        A,
        i,
        n,
        o
      );
    case "bilinear":
    case "linear":
      return Wr(
        t,
        e,
        A,
        i,
        n,
        o
      );
    default:
      throw new Error(`Unsupported resampling method: '${I}'`);
  }
}
function zr(t, e, A) {
  let i = 0;
  for (let n = e; n < A; ++n)
    i += t[n];
  return i;
}
function qe(t, e, A) {
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
function $r(t, e) {
  return (t === 1 || t === 2) && e <= 32 && e % 8 === 0 ? !1 : !(t === 3 && (e === 16 || e === 32 || e === 64));
}
function An(t, e, A, i, n, o, I) {
  const s = new DataView(t), y = A === 2 ? I * o : I * o * i, a = A === 2 ? 1 : i, r = qe(e, n, y), g = parseInt("1".repeat(n), 2);
  if (e === 1) {
    let E;
    A === 1 ? E = i * n : E = n;
    let B = o * E;
    B & 7 && (B = B + 7 & -8);
    for (let f = 0; f < I; ++f) {
      const c = f * B;
      for (let l = 0; l < o; ++l) {
        const u = c + l * a * n;
        for (let h = 0; h < a; ++h) {
          const D = u + h * n, d = (f * o + l) * a + h, Q = Math.floor(D / 8), C = D % 8;
          if (C + n <= 8)
            r[d] = s.getUint8(Q) >> 8 - n - C & g;
          else if (C + n <= 16)
            r[d] = s.getUint16(Q) >> 16 - n - C & g;
          else if (C + n <= 24) {
            const w = s.getUint16(Q) << 8 | s.getUint8(Q + 2);
            r[d] = w >> 24 - n - C & g;
          } else
            r[d] = s.getUint32(Q) >> 32 - n - C & g;
        }
      }
    }
  }
  return r.buffer;
}
class Bt {
  /**
   * @constructor
   * @param {Object} fileDirectory The parsed file directory
   * @param {Object} geoKeys The parsed geo-keys
   * @param {DataView} dataView The DataView for the underlying file.
   * @param {Boolean} littleEndian Whether the file is encoded in little or big endian
   * @param {Boolean} cache Whether or not decoded tiles shall be cached
   * @param {import('./source/basesource').BaseSource} source The datasource to read from
   */
  constructor(e, A, i, n, o, I) {
    this.fileDirectory = e, this.geoKeys = A, this.dataView = i, this.littleEndian = n, this.tiles = o ? {} : null, this.isTiled = !e.StripOffsets;
    const s = e.PlanarConfiguration;
    if (this.planarConfiguration = typeof s > "u" ? 1 : s, this.planarConfiguration !== 1 && this.planarConfiguration !== 2)
      throw new Error("Invalid planar configuration.");
    this.source = I;
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
            return function(n, o) {
              return fi(this, n, o);
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
    const i = this.getSampleFormat(e), n = this.getBitsPerSample(e);
    return qe(i, n, A);
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
  async getTileOrStrip(e, A, i, n, o) {
    const I = Math.ceil(this.getWidth() / this.getTileWidth()), s = Math.ceil(this.getHeight() / this.getTileHeight());
    let y;
    const { tiles: a } = this;
    this.planarConfiguration === 1 ? y = A * I + e : this.planarConfiguration === 2 && (y = i * I * s + A * I + e);
    let r, g;
    this.isTiled ? (r = this.fileDirectory.TileOffsets[y], g = this.fileDirectory.TileByteCounts[y]) : (r = this.fileDirectory.StripOffsets[y], g = this.fileDirectory.StripByteCounts[y]);
    const E = (await this.source.fetch([{ offset: r, length: g }], o))[0];
    let B;
    return a === null || !a[y] ? (B = (async () => {
      let f = await n.decode(this.fileDirectory, E);
      const c = this.getSampleFormat(), l = this.getBitsPerSample();
      return $r(c, l) && (f = An(
        f,
        c,
        this.planarConfiguration,
        this.getSamplesPerPixel(),
        l,
        this.getTileWidth(),
        this.getBlockHeight(A)
      )), f;
    })(), a !== null && (a[y] = B)) : B = a[y], { x: e, y: A, sample: i, data: await B };
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
  async _readRaster(e, A, i, n, o, I, s, y, a) {
    const r = this.getTileWidth(), g = this.getTileHeight(), E = this.getWidth(), B = this.getHeight(), f = Math.max(Math.floor(e[0] / r), 0), c = Math.min(
      Math.ceil(e[2] / r),
      Math.ceil(E / r)
    ), l = Math.max(Math.floor(e[1] / g), 0), u = Math.min(
      Math.ceil(e[3] / g),
      Math.ceil(B / g)
    ), h = e[2] - e[0];
    let D = this.getBytesPerPixel();
    const d = [], Q = [];
    for (let m = 0; m < A.length; ++m)
      this.planarConfiguration === 1 ? d.push(zr(this.fileDirectory.BitsPerSample, 0, A[m]) / 8) : d.push(0), Q.push(this.getReaderForSample(A[m]));
    const C = [], { littleEndian: w } = this;
    for (let m = l; m < u; ++m)
      for (let F = f; F < c; ++F) {
        let k;
        this.planarConfiguration === 1 && (k = this.getTileOrStrip(F, m, 0, o, a));
        for (let p = 0; p < A.length; ++p) {
          const x = p, b = A[p];
          this.planarConfiguration === 2 && (D = this.getSampleByteSize(b), k = this.getTileOrStrip(F, m, b, o, a));
          const M = k.then((S) => {
            const G = S.data, U = new DataView(G), L = this.getBlockHeight(S.y), R = S.y * g, N = S.x * r, v = R + L, Y = (S.x + 1) * r, _ = Q[x], q = Math.min(L, L - (v - e[3]), B - R), T = Math.min(r, r - (Y - e[2]), E - N);
            for (let O = Math.max(0, e[1] - R); O < q; ++O)
              for (let J = Math.max(0, e[0] - N); J < T; ++J) {
                const H = (O * r + J) * D, P = _.call(
                  U,
                  H + d[x],
                  w
                );
                let j;
                n ? (j = (O + R - e[1]) * h * A.length + (J + N - e[0]) * A.length + x, i[j] = P) : (j = (O + R - e[1]) * h + J + N - e[0], i[x][j] = P);
              }
          });
          C.push(M);
        }
      }
    if (await Promise.all(C), I && e[2] - e[0] !== I || s && e[3] - e[1] !== s) {
      let m;
      return n ? m = Zr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        I,
        s,
        A.length,
        y
      ) : m = jr(
        i,
        e[2] - e[0],
        e[3] - e[1],
        I,
        s,
        y
      ), m.width = I, m.height = s, m;
    }
    return i.width = I || e[2] - e[0], i.height = s || e[3] - e[1], i;
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
    pool: n = null,
    width: o,
    height: I,
    resampleMethod: s,
    fillValue: y,
    signal: a
  } = {}) {
    const r = e || [0, 0, this.getWidth(), this.getHeight()];
    if (r[0] > r[2] || r[1] > r[3])
      throw new Error("Invalid subsets");
    const g = r[2] - r[0], E = r[3] - r[1], B = g * E, f = this.getSamplesPerPixel();
    if (!A || !A.length)
      for (let h = 0; h < f; ++h)
        A.push(h);
    else
      for (let h = 0; h < A.length; ++h)
        if (A[h] >= f)
          return Promise.reject(new RangeError(`Invalid sample index '${A[h]}'.`));
    let c;
    if (i) {
      const h = this.fileDirectory.SampleFormat ? Math.max.apply(null, this.fileDirectory.SampleFormat) : 1, D = Math.max.apply(null, this.fileDirectory.BitsPerSample);
      c = qe(h, D, B * A.length), y && c.fill(y);
    } else {
      c = [];
      for (let h = 0; h < A.length; ++h) {
        const D = this.getArrayForSample(A[h], B);
        Array.isArray(y) && h < y.length ? D.fill(y[h]) : y && !Array.isArray(y) && D.fill(y), c.push(D);
      }
    }
    const l = n || await It(this.fileDirectory);
    return await this._readRaster(
      r,
      A,
      c,
      i,
      l,
      o,
      I,
      s,
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
    width: n,
    height: o,
    resampleMethod: I,
    enableAlpha: s = !1,
    signal: y
  } = {}) {
    const a = e || [0, 0, this.getWidth(), this.getHeight()];
    if (a[0] > a[2] || a[1] > a[3])
      throw new Error("Invalid subsets");
    const r = this.fileDirectory.PhotometricInterpretation;
    if (r === z.RGB) {
      let u = [0, 1, 2];
      if (this.fileDirectory.ExtraSamples !== wi.Unspecified && s) {
        u = [];
        for (let h = 0; h < this.fileDirectory.BitsPerSample.length; h += 1)
          u.push(h);
      }
      return this.readRasters({
        window: e,
        interleave: A,
        samples: u,
        pool: i,
        width: n,
        height: o,
        resampleMethod: I,
        signal: y
      });
    }
    let g;
    switch (r) {
      case z.WhiteIsZero:
      case z.BlackIsZero:
      case z.Palette:
        g = [0];
        break;
      case z.CMYK:
        g = [0, 1, 2, 3];
        break;
      case z.YCbCr:
      case z.CIELab:
        g = [0, 1, 2];
        break;
      default:
        throw new Error("Invalid or unsupported photometric interpretation.");
    }
    const E = {
      window: a,
      interleave: !0,
      samples: g,
      pool: i,
      width: n,
      height: o,
      resampleMethod: I,
      signal: y
    }, { fileDirectory: B } = this, f = await this.readRasters(E), c = 2 ** this.fileDirectory.BitsPerSample[0];
    let l;
    switch (r) {
      case z.WhiteIsZero:
        l = mi(f, c);
        break;
      case z.BlackIsZero:
        l = pi(f, c);
        break;
      case z.Palette:
        l = ki(f, B.ColorMap);
        break;
      case z.CMYK:
        l = Fi(f);
        break;
      case z.YCbCr:
        l = Si(f);
        break;
      case z.CIELab:
        l = Gi(f);
        break;
      default:
        throw new Error("Unsupported photometric interpretation.");
    }
    if (!A) {
      const u = new Uint8Array(l.length / 3), h = new Uint8Array(l.length / 3), D = new Uint8Array(l.length / 3);
      for (let d = 0, Q = 0; d < l.length; d += 3, ++Q)
        u[Q] = l[d], h[Q] = l[d + 1], D[Q] = l[d + 2];
      l = [u, h, D];
    }
    return l.width = f.width, l.height = f.height, l;
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
    let n = Jr(i, "Item");
    e === null ? n = n.filter((o) => De(o, "sample") === void 0) : n = n.filter((o) => Number(De(o, "sample")) === e);
    for (let o = 0; o < n.length; ++o) {
      const I = n[o];
      A[De(I, "name")] = I.inner;
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
      const [n, o, I] = e.getResolution();
      return [
        n * e.getWidth() / this.getWidth(),
        o * e.getHeight() / this.getHeight(),
        I * e.getWidth() / this.getWidth()
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
      const [n, o, I, s, y, a, r, g] = this.fileDirectory.ModelTransformation, B = [
        [0, 0],
        [0, A],
        [i, 0],
        [i, A]
      ].map(([l, u]) => [
        s + n * l + o * u,
        g + y * l + a * u
      ]), f = B.map((l) => l[0]), c = B.map((l) => l[1]);
      return [
        Math.min(...f),
        Math.min(...c),
        Math.max(...f),
        Math.max(...c)
      ];
    } else {
      const n = this.getOrigin(), o = this.getResolution(), I = n[0], s = n[1], y = I + o[0] * i, a = s + o[1] * A;
      return [
        Math.min(I, y),
        Math.min(s, a),
        Math.max(I, y),
        Math.max(s, a)
      ];
    }
  }
}
class en {
  constructor(e) {
    this._dataView = new DataView(e);
  }
  get buffer() {
    return this._dataView.buffer;
  }
  getUint64(e, A) {
    const i = this.getUint32(e, A), n = this.getUint32(e + 4, A);
    let o;
    if (A) {
      if (o = i + 2 ** 32 * n, !Number.isSafeInteger(o))
        throw new Error(
          `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return o;
    }
    if (o = 2 ** 32 * i + n, !Number.isSafeInteger(o))
      throw new Error(
        `${o} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return o;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  getInt64(e, A) {
    let i = 0;
    const n = (this._dataView.getUint8(e + (A ? 7 : 0)) & 128) > 0;
    let o = !0;
    for (let I = 0; I < 8; I++) {
      let s = this._dataView.getUint8(e + (A ? I : 7 - I));
      n && (o ? s !== 0 && (s = ~(s - 1) & 255, o = !1) : s = ~s & 255), i += s * 256 ** I;
    }
    return n && (i = -i), i;
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
    return fi(this._dataView, e, A);
  }
  getFloat32(e, A) {
    return this._dataView.getFloat32(e, A);
  }
  getFloat64(e, A) {
    return this._dataView.getFloat64(e, A);
  }
}
class tn {
  constructor(e, A, i, n) {
    this._dataView = new DataView(e), this._sliceOffset = A, this._littleEndian = i, this._bigTiff = n;
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
    let n;
    if (this._littleEndian) {
      if (n = A + 2 ** 32 * i, !Number.isSafeInteger(n))
        throw new Error(
          `${n} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
        );
      return n;
    }
    if (n = 2 ** 32 * A + i, !Number.isSafeInteger(n))
      throw new Error(
        `${n} exceeds MAX_SAFE_INTEGER. Precision may be lost. Please report if you get this message to https://github.com/geotiffjs/geotiff.js/issues`
      );
    return n;
  }
  // adapted from https://stackoverflow.com/a/55338384/8060591
  readInt64(e) {
    let A = 0;
    const i = (this._dataView.getUint8(e + (this._littleEndian ? 7 : 0)) & 128) > 0;
    let n = !0;
    for (let o = 0; o < 8; o++) {
      let I = this._dataView.getUint8(
        e + (this._littleEndian ? o : 7 - o)
      );
      i && (n ? I !== 0 && (I = ~(I - 1) & 255, n = !1) : I = ~I & 255), A += I * 256 ** o;
    }
    return i && (A = -A), A;
  }
  readOffset(e) {
    return this._bigTiff ? this.readUint64(e) : this.readUint32(e);
  }
}
const rn = typeof navigator < "u" && navigator.hardwareConcurrency || 2;
class bi {
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
  constructor(e = rn, A) {
    this.workers = null, this._awaitingDecoder = null, this.size = e, this.messageId = 0, e && (this._awaitingDecoder = A ? Promise.resolve(A) : new Promise((i) => {
      Promise.resolve().then(() => As).then((n) => {
        i(n.create);
      });
    }), this._awaitingDecoder.then((i) => {
      this._awaitingDecoder = null, this.workers = [];
      for (let n = 0; n < e; n++)
        this.workers.push({ worker: i(), idle: !0 });
    }));
  }
  /**
   * Decode the given block of bytes with the set compression method.
   * @param {ArrayBuffer} buffer the array buffer of bytes to decode.
   * @returns {Promise<ArrayBuffer>} the decoded result as a `Promise`
   */
  async decode(e, A) {
    return this._awaitingDecoder && await this._awaitingDecoder, this.size === 0 ? It(e).then((i) => i.decode(e, A)) : new Promise((i) => {
      const n = this.workers.find((s) => s.idle) || this.workers[Math.floor(Math.random() * this.size)];
      n.idle = !1;
      const o = this.messageId++, I = (s) => {
        s.data.id === o && (n.idle = !0, i(s.data.decoded), n.worker.removeEventListener("message", I));
      };
      n.worker.addEventListener("message", I), n.worker.postMessage({ fileDirectory: e, buffer: A, id: o }, [A]);
    });
  }
  destroy() {
    this.workers && (this.workers.forEach((e) => {
      e.worker.terminate();
    }), this.workers = null);
  }
}
const Qt = `\r
\r
`;
function Ri(t) {
  if (typeof Object.fromEntries < "u")
    return Object.fromEntries(t);
  const e = {};
  for (const [A, i] of t)
    e[A.toLowerCase()] = i;
  return e;
}
function nn(t) {
  const e = t.split(`\r
`).map((A) => {
    const i = A.split(":").map((n) => n.trim());
    return i[0] = i[0].toLowerCase(), i;
  });
  return Ri(e);
}
function on(t) {
  const [e, ...A] = t.split(";").map((n) => n.trim()), i = A.map((n) => n.split("="));
  return { type: e, params: Ri(i) };
}
function Je(t) {
  let e, A, i;
  return t && ([, e, A, i] = t.match(/bytes (\d+)-(\d+)\/(\d+)/), e = parseInt(e, 10), A = parseInt(A, 10), i = parseInt(i, 10)), { start: e, end: A, total: i };
}
function an(t, e) {
  let A = null;
  const i = new TextDecoder("ascii"), n = [], o = `--${e}`, I = `${o}--`;
  for (let s = 0; s < 10; ++s)
    i.decode(
      new Uint8Array(t, s, o.length)
    ) === o && (A = s);
  if (A === null)
    throw new Error("Could not find initial boundary");
  for (; A < t.byteLength; ) {
    const s = i.decode(
      new Uint8Array(
        t,
        A,
        Math.min(o.length + 1024, t.byteLength - A)
      )
    );
    if (s.length === 0 || s.startsWith(I))
      break;
    if (!s.startsWith(o))
      throw new Error("Part does not start with boundary");
    const y = s.substr(o.length + 2);
    if (y.length === 0)
      break;
    const a = y.indexOf(Qt), r = nn(y.substr(0, a)), { start: g, end: E, total: B } = Je(r["content-range"]), f = A + o.length + a + Qt.length, c = parseInt(E, 10) + 1 - parseInt(g, 10);
    n.push({
      headers: r,
      data: t.slice(f, f + c),
      offset: g,
      length: c,
      fileSize: B
    }), A = f + c + 4;
  }
  return n;
}
class XA {
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
class sn extends Map {
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
    const n = typeof i == "number" && i !== Number.POSITIVE_INFINITY ? Date.now() + i : void 0;
    return this.cache.has(e) ? this.cache.set(e, {
      value: A,
      expiry: n
    }) : this._set(e, { value: A, expiry: n }), this;
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
      const i = e[A], [n, o] = i;
      this._deleteIfExpired(n, o) === !1 && (yield [n, o.value]);
    }
    e = [...this.oldCache];
    for (let A = e.length - 1; A >= 0; --A) {
      const i = e[A], [n, o] = i;
      this.cache.has(n) || this._deleteIfExpired(n, o) === !1 && (yield [n, o.value]);
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
    for (const [i, n] of this.entriesAscending())
      e.call(A, n, i, this);
  }
  get [Symbol.toStringTag]() {
    return JSON.stringify([...this.entriesAscending()]);
  }
}
function vi(t, e) {
  for (const A in e)
    e.hasOwnProperty(A) && (t[A] = e[A]);
}
function Ui(t, e) {
  return t.length < e.length ? !1 : t.substr(t.length - e.length) === e;
}
function gn(t, e) {
  const { length: A } = t;
  for (let i = 0; i < A; i++)
    e(t[i], i);
}
function lt(t) {
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
async function In(t) {
  return new Promise((e) => setTimeout(e, t));
}
function Bn(t, e) {
  const A = Array.isArray(t) ? t : Array.from(t), i = Array.isArray(e) ? e : Array.from(e);
  return A.map((n, o) => [n, i[o]]);
}
class kA extends Error {
  constructor(e) {
    super(e), Error.captureStackTrace && Error.captureStackTrace(this, kA), this.name = "AbortError";
  }
}
class ln extends Error {
  constructor(e, A) {
    super(A), this.errors = e, this.message = A, this.name = "AggregateError";
  }
}
const fn = ln;
class cn {
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
class ht {
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
class Cn extends XA {
  /**
   *
   * @param {BaseSource} source The underlying source that shall be blocked and cached
   * @param {object} options
   * @param {number} [options.blockSize]
   * @param {number} [options.cacheSize]
   */
  constructor(e, { blockSize: A = 65536, cacheSize: i = 100 } = {}) {
    super(), this.source = e, this.blockSize = A, this.blockCache = new sn({
      maxSize: i,
      onEviction: (n, o) => {
        this.evictedBlocks.set(n, o);
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
    const i = [], n = [], o = [];
    this.evictedBlocks.clear();
    for (const { offset: E, length: B } of e) {
      let f = E + B;
      const { fileSize: c } = this;
      c !== null && (f = Math.min(f, c));
      const l = Math.floor(E / this.blockSize) * this.blockSize;
      for (let u = l; u < f; u += this.blockSize) {
        const h = Math.floor(u / this.blockSize);
        !this.blockCache.has(h) && !this.blockRequests.has(h) && (this.blockIdsToFetch.add(h), n.push(h)), this.blockRequests.has(h) && i.push(this.blockRequests.get(h)), o.push(h);
      }
    }
    await In(), this.fetchBlocks(A);
    const I = [];
    for (const E of n)
      this.blockRequests.has(E) && I.push(this.blockRequests.get(E));
    await Promise.allSettled(i), await Promise.allSettled(I);
    const s = [], y = o.filter((E) => this.abortedBlockIds.has(E) || !this.blockCache.has(E));
    if (y.forEach((E) => this.blockIdsToFetch.add(E)), y.length > 0 && A && !A.aborted) {
      this.fetchBlocks(null);
      for (const E of y) {
        const B = this.blockRequests.get(E);
        if (!B)
          throw new Error(`Block ${E} is not in the block requests`);
        s.push(B);
      }
      await Promise.allSettled(s);
    }
    if (A && A.aborted)
      throw new kA("Request was aborted");
    const a = o.map((E) => this.blockCache.get(E) || this.evictedBlocks.get(E)), r = a.filter((E) => !E);
    if (r.length)
      throw new fn(r, "Request failed");
    const g = new Map(Bn(o, a));
    return this.readSliceData(e, g);
  }
  /**
   *
   * @param {AbortSignal} signal
   */
  fetchBlocks(e) {
    if (this.blockIdsToFetch.size > 0) {
      const A = this.groupBlocks(this.blockIdsToFetch), i = this.source.fetch(A, e);
      for (let n = 0; n < A.length; ++n) {
        const o = A[n];
        for (const I of o.blockIds)
          this.blockRequests.set(I, (async () => {
            try {
              const s = (await i)[n], y = I * this.blockSize, a = y - s.offset, r = Math.min(a + this.blockSize, s.data.byteLength), g = s.data.slice(a, r), E = new cn(
                y,
                g.byteLength,
                g,
                I
              );
              this.blockCache.set(I, E), this.abortedBlockIds.delete(I);
            } catch (s) {
              if (s.name === "AbortError")
                s.signal = e, this.blockCache.delete(I), this.abortedBlockIds.add(I);
              else
                throw s;
            } finally {
              this.blockRequests.delete(I);
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
    const A = Array.from(e).sort((I, s) => I - s);
    if (A.length === 0)
      return [];
    let i = [], n = null;
    const o = [];
    for (const I of A)
      n === null || n + 1 === I ? (i.push(I), n = I) : (o.push(new ht(
        i[0] * this.blockSize,
        i.length * this.blockSize,
        i
      )), i = [I], n = I);
    return o.push(new ht(
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
      let n = i.offset + i.length;
      this.fileSize !== null && (n = Math.min(this.fileSize, n));
      const o = Math.floor(i.offset / this.blockSize), I = Math.floor(n / this.blockSize), s = new ArrayBuffer(i.length), y = new Uint8Array(s);
      for (let a = o; a <= I; ++a) {
        const r = A.get(a), g = r.offset - i.offset, E = r.top - n;
        let B = 0, f = 0, c;
        g < 0 ? B = -g : g > 0 && (f = g), E < 0 ? c = r.length - B : c = n - r.offset - B;
        const l = new Uint8Array(r.data, B, c);
        y.set(l, f);
      }
      return s;
    });
  }
}
class WA {
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
class ZA {
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
class En extends WA {
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
class Qn extends ZA {
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
    return new En(i);
  }
}
class hn extends WA {
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
class un extends ZA {
  constructRequest(e, A) {
    return new Promise((i, n) => {
      const o = new XMLHttpRequest();
      o.open("GET", this.url), o.responseType = "arraybuffer";
      for (const [I, s] of Object.entries(e))
        o.setRequestHeader(I, s);
      o.onload = () => {
        const I = o.response;
        i(new hn(o, I));
      }, o.onerror = n, o.onabort = () => n(new kA("Request aborted")), o.send(), A && (A.aborted && o.abort(), A.addEventListener("abort", () => o.abort()));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
const LA = {};
class dn extends WA {
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
class wn extends ZA {
  constructor(e) {
    super(e), this.parsedUrl = LA.parse(this.url), this.httpApi = (this.parsedUrl.protocol === "http:", LA);
  }
  constructRequest(e, A) {
    return new Promise((i, n) => {
      const o = this.httpApi.get(
        {
          ...this.parsedUrl,
          headers: e
        },
        (I) => {
          const s = new Promise((y) => {
            const a = [];
            I.on("data", (r) => {
              a.push(r);
            }), I.on("end", () => {
              const r = Buffer.concat(a).buffer;
              y(r);
            }), I.on("error", n);
          });
          i(new dn(I, s));
        }
      );
      o.on("error", n), A && (A.aborted && o.destroy(new kA("Request aborted")), A.addEventListener("abort", () => o.destroy(new kA("Request aborted"))));
    });
  }
  async request({ headers: e, signal: A } = {}) {
    return await this.constructRequest(e, A);
  }
}
class Qe extends XA {
  /**
   *
   * @param {BaseClient} client
   * @param {object} headers
   * @param {numbers} maxRanges
   * @param {boolean} allowFullFile
   */
  constructor(e, A, i, n) {
    super(), this.client = e, this.headers = A, this.maxRanges = i, this.allowFullFile = n, this._fileSize = null;
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
        Range: `bytes=${e.map(({ offset: n, length: o }) => `${n}-${n + o}`).join(",")}`
      },
      signal: A
    });
    if (i.ok)
      if (i.status === 206) {
        const { type: n, params: o } = on(i.getHeader("content-type"));
        if (n === "multipart/byteranges") {
          const g = an(await i.getData(), o.boundary);
          return this._fileSize = g[0].fileSize || null, g;
        }
        const I = await i.getData(), { start: s, end: y, total: a } = Je(i.getHeader("content-range"));
        this._fileSize = a || null;
        const r = [{
          data: I,
          offset: s,
          length: y - s
        }];
        if (e.length > 1) {
          const g = await Promise.all(e.slice(1).map((E) => this.fetchSlice(E, A)));
          return r.concat(g);
        }
        return r;
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const n = await i.getData();
        return this._fileSize = n.byteLength, [{
          data: n,
          offset: 0,
          length: n.byteLength
        }];
      }
    else throw new Error("Error fetching data.");
  }
  async fetchSlice(e, A) {
    const { offset: i, length: n } = e, o = await this.client.request({
      headers: {
        ...this.headers,
        Range: `bytes=${i}-${i + n}`
      },
      signal: A
    });
    if (o.ok)
      if (o.status === 206) {
        const I = await o.getData(), { total: s } = Je(o.getHeader("content-range"));
        return this._fileSize = s || null, {
          data: I,
          offset: i,
          length: n
        };
      } else {
        if (!this.allowFullFile)
          throw new Error("Server responded with full file");
        const I = await o.getData();
        return this._fileSize = I.byteLength, {
          data: I,
          offset: 0,
          length: I.byteLength
        };
      }
    else throw new Error("Error fetching data.");
  }
  get fileSize() {
    return this._fileSize;
  }
}
function he(t, { blockSize: e, cacheSize: A }) {
  return e === null ? t : new Cn(t, { blockSize: e, cacheSize: A });
}
function yn(t, { headers: e = {}, credentials: A, maxRanges: i = 0, allowFullFile: n = !1, ...o } = {}) {
  const I = new Qn(t, A), s = new Qe(I, e, i, n);
  return he(s, o);
}
function Dn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...n } = {}) {
  const o = new un(t), I = new Qe(o, e, A, i);
  return he(I, n);
}
function mn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...n } = {}) {
  const o = new wn(t), I = new Qe(o, e, A, i);
  return he(I, n);
}
function pn(t, { headers: e = {}, maxRanges: A = 0, allowFullFile: i = !1, ...n } = {}) {
  const o = new Qe(t, e, A, i);
  return he(o, n);
}
function Ye(t, { forceXHR: e = !1, ...A } = {}) {
  return typeof fetch == "function" && !e ? yn(t, A) : typeof XMLHttpRequest < "u" ? Dn(t, A) : mn(t, A);
}
class kn extends XA {
  constructor(e) {
    super(), this.arrayBuffer = e;
  }
  fetchSlice(e, A) {
    if (A && A.aborted)
      throw new kA("Request aborted");
    return this.arrayBuffer.slice(e.offset, e.offset + e.length);
  }
}
function Fn(t) {
  return new kn(t);
}
class Sn extends XA {
  constructor(e) {
    super(), this.file = e;
  }
  async fetchSlice(e, A) {
    return new Promise((i, n) => {
      const o = this.file.slice(e.offset, e.offset + e.length), I = new FileReader();
      I.onload = (s) => i(s.target.result), I.onerror = n, I.onabort = n, I.readAsArrayBuffer(o), A && A.addEventListener("abort", () => I.abort());
    });
  }
}
function Gn(t) {
  return new Sn(t);
}
function xn(t) {
  return new Promise((e, A) => {
    LA.close(t, (i) => {
      i ? A(i) : e();
    });
  });
}
function bn(t, e, A = void 0) {
  return new Promise((i, n) => {
    LA.open(t, e, A, (o, I) => {
      o ? n(o) : i(I);
    });
  });
}
function Rn(...t) {
  return new Promise((e, A) => {
    LA.read(...t, (i, n, o) => {
      i ? A(i) : e({ bytesRead: n, buffer: o });
    });
  });
}
class vn extends XA {
  constructor(e) {
    super(), this.path = e, this.openRequest = bn(e, "r");
  }
  async fetchSlice(e) {
    const A = await this.openRequest, { buffer: i } = await Rn(
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
    await xn(e);
  }
}
function Un(t) {
  return new vn(t);
}
const Ln = lt(pA), Mn = lt(vA), IA = {};
vi(IA, Ln);
vi(IA, Mn);
const Nn = lt(HA), le = 1e3, $ = {
  nextZero: (t, e) => {
    let A = e;
    for (; t[A] !== 0; )
      A++;
    return A;
  },
  readUshort: (t, e) => t[e] << 8 | t[e + 1],
  readShort: (t, e) => {
    const A = $.ui8;
    return A[0] = t[e + 1], A[1] = t[e + 0], $.i16[0];
  },
  readInt: (t, e) => {
    const A = $.ui8;
    return A[0] = t[e + 3], A[1] = t[e + 2], A[2] = t[e + 1], A[3] = t[e + 0], $.i32[0];
  },
  readUint: (t, e) => {
    const A = $.ui8;
    return A[0] = t[e + 3], A[1] = t[e + 2], A[2] = t[e + 1], A[3] = t[e + 0], $.ui32[0];
  },
  readASCII: (t, e, A) => A.map((i) => String.fromCharCode(t[e + i])).join(""),
  readFloat: (t, e) => {
    const A = $.ui8;
    return eA(4, (i) => {
      A[i] = t[e + 3 - i];
    }), $.fl32[0];
  },
  readDouble: (t, e) => {
    const A = $.ui8;
    return eA(8, (i) => {
      A[i] = t[e + 7 - i];
    }), $.fl64[0];
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
$.fl64 = new Float64Array($.ui8.buffer);
$.writeDouble = (t, e, A) => {
  $.fl64[0] = A, eA(8, (i) => {
    t[e + i] = $.ui8[7 - i];
  });
};
const Tn = (t, e, A, i) => {
  let n = A;
  const o = Object.keys(i).filter((s) => s != null && s !== "undefined");
  t.writeUshort(e, n, o.length), n += 2;
  let I = n + 12 * o.length + 4;
  for (const s of o) {
    let y = null;
    typeof s == "number" ? y = s : typeof s == "string" && (y = parseInt(s, 10));
    const a = fe[y], r = Nn[a];
    if (a == null || a === void 0 || typeof a > "u")
      throw new Error(`unknown type of tag: ${y}`);
    let g = i[s];
    if (g === void 0)
      throw new Error(`failed to get value for key ${s}`);
    a === "ASCII" && typeof g == "string" && Ui(g, "\0") === !1 && (g += "\0");
    const E = g.length;
    t.writeUshort(e, n, y), n += 2, t.writeUshort(e, n, r), n += 2, t.writeUint(e, n, E), n += 4;
    let B = [-1, 1, 1, 2, 4, 8, 0, 0, 0, 0, 0, 0, 8][r] * E, f = n;
    B > 4 && (t.writeUint(e, n, I), f = I), a === "ASCII" ? t.writeASCII(e, f, g) : a === "SHORT" ? eA(E, (c) => {
      t.writeUshort(e, f + 2 * c, g[c]);
    }) : a === "LONG" ? eA(E, (c) => {
      t.writeUint(e, f + 4 * c, g[c]);
    }) : a === "RATIONAL" ? eA(E, (c) => {
      t.writeUint(e, f + 8 * c, Math.round(g[c] * 1e4)), t.writeUint(e, f + 8 * c + 4, 1e4);
    }) : a === "DOUBLE" && eA(E, (c) => {
      t.writeDouble(e, f + 8 * c, g[c]);
    }), B > 4 && (B += B & 1, I += B), n += 4;
  }
  return [n, I];
}, qn = (t) => {
  const e = new Uint8Array(le);
  let A = 4;
  const i = $;
  e[0] = 77, e[1] = 77, e[3] = 42;
  let n = 8;
  if (i.writeUint(e, A, n), A += 4, t.forEach((I, s) => {
    const y = Tn(i, e, n, I);
    n = y[1], s < t.length - 1 && i.writeUint(e, y[0], n);
  }), e.slice)
    return e.slice(0, n).buffer;
  const o = new Uint8Array(n);
  for (let I = 0; I < n; I++)
    o[I] = e[I];
  return o.buffer;
}, Jn = (t, e, A, i) => {
  if (A == null)
    throw new Error(`you passed into encodeImage a width of type ${A}`);
  if (e == null)
    throw new Error(`you passed into encodeImage a width of type ${e}`);
  const n = {
    256: [e],
    // ImageWidth
    257: [A],
    // ImageLength
    273: [le],
    // strips offset
    278: [A],
    // RowsPerStrip
    305: "geotiff.js"
    // no array for ASCII(Z)
  };
  if (i)
    for (const a in i)
      i.hasOwnProperty(a) && (n[a] = i[a]);
  const o = new Uint8Array(qn([n])), I = new Uint8Array(t), s = n[277], y = new Uint8Array(le + e * A * s);
  return eA(o.length, (a) => {
    y[a] = o[a];
  }), gn(I, (a, r) => {
    y[le + r] = a;
  }), y.buffer;
}, Yn = (t) => {
  const e = {};
  for (const A in t)
    A !== "StripOffsets" && (IA[A] || console.error(A, "not in name2code:", Object.keys(IA)), e[IA[A]] = t[A]);
  return e;
}, Hn = (t) => Array.isArray(t) ? t : [t], On = [
  ["Compression", 1],
  // no compression
  ["PlanarConfiguration", 1],
  ["ExtraSamples", 0]
];
function Kn(t, e) {
  const A = typeof t[0] == "number";
  let i, n, o, I;
  A ? (i = e.height || e.ImageLength, o = e.width || e.ImageWidth, n = t.length / (i * o), I = t) : (n = t.length, i = t[0].length, o = t[0][0].length, I = [], eA(i, (r) => {
    eA(o, (g) => {
      eA(n, (E) => {
        I.push(t[E][r][g]);
      });
    });
  })), e.ImageLength = i, delete e.height, e.ImageWidth = o, delete e.width, e.BitsPerSample || (e.BitsPerSample = eA(n, () => 8)), On.forEach((r) => {
    const g = r[0];
    if (!e[g]) {
      const E = r[1];
      e[g] = E;
    }
  }), e.PhotometricInterpretation || (e.PhotometricInterpretation = e.BitsPerSample.length === 3 ? 2 : 1), e.SamplesPerPixel || (e.SamplesPerPixel = [n]), e.StripByteCounts || (e.StripByteCounts = [n * i * o]), e.ModelPixelScale || (e.ModelPixelScale = [360 / o, 180 / i, 0]), e.SampleFormat || (e.SampleFormat = eA(n, () => 1)), !e.hasOwnProperty("GeographicTypeGeoKey") && !e.hasOwnProperty("ProjectedCSTypeGeoKey") && (e.GeographicTypeGeoKey = 4326, e.ModelTiepoint = [0, 0, 0, -180, 90, 0], e.GeogCitationGeoKey = "WGS 84", e.GTModelTypeGeoKey = 2);
  const s = Object.keys(e).filter((r) => Ui(r, "GeoKey")).sort((r, g) => IA[r] - IA[g]);
  if (!e.GeoAsciiParams) {
    let r = "";
    s.forEach((g) => {
      const E = Number(IA[g]);
      fe[E] === "ASCII" && (r += `${e[g].toString()}\0`);
    }), r.length > 0 && (e.GeoAsciiParams = r);
  }
  if (!e.GeoKeyDirectory) {
    const g = [1, 1, 0, s.length];
    s.forEach((E) => {
      const B = Number(IA[E]);
      g.push(B);
      let f, c, l;
      fe[B] === "SHORT" ? (f = 1, c = 0, l = e[E]) : E === "GeogCitationGeoKey" ? (f = e.GeoAsciiParams.length, c = Number(IA.GeoAsciiParams), l = 0) : console.log(`[geotiff.js] couldn't get TIFFTagLocation for ${E}`), g.push(c), g.push(f), g.push(l);
    }), e.GeoKeyDirectory = g;
  }
  for (const r of s)
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
    e[r] && (e[r] = Hn(e[r]));
  });
  const y = Yn(e);
  return Jn(I, o, i, y);
}
class _n {
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
function Pn(t = new _n()) {
}
function Vn(t, e) {
  let A = t.length - e, i = 0;
  do {
    for (let n = e; n > 0; n--)
      t[i + e] += t[i], i++;
    A -= e;
  } while (A > 0);
}
function jn(t, e, A) {
  let i = 0, n = t.length;
  const o = n / A;
  for (; n > e; ) {
    for (let s = e; s > 0; --s)
      t[i + e] += t[i], ++i;
    n -= e;
  }
  const I = t.slice();
  for (let s = 0; s < o; ++s)
    for (let y = 0; y < A; ++y)
      t[A * s + y] = I[(A - y - 1) * o + s];
}
function Xn(t, e, A, i, n, o) {
  if (e === 1)
    return t;
  for (let y = 0; y < n.length; ++y) {
    if (n[y] % 8 !== 0)
      throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");
    if (n[y] !== n[0])
      throw new Error("When decoding with predictor, all samples must have the same size.");
  }
  const I = n[0] / 8, s = o === 2 ? 1 : n.length;
  for (let y = 0; y < i && !(y * s * A * I >= t.byteLength); ++y) {
    let a;
    if (e === 2) {
      switch (n[0]) {
        case 8:
          a = new Uint8Array(
            t,
            y * s * A * I,
            s * A * I
          );
          break;
        case 16:
          a = new Uint16Array(
            t,
            y * s * A * I,
            s * A * I / 2
          );
          break;
        case 32:
          a = new Uint32Array(
            t,
            y * s * A * I,
            s * A * I / 4
          );
          break;
        default:
          throw new Error(`Predictor 2 not allowed with ${n[0]} bits per sample.`);
      }
      Vn(a, s);
    } else e === 3 && (a = new Uint8Array(
      t,
      y * s * A * I,
      s * A * I
    ), jn(a, s, I));
  }
  return t;
}
class dA {
  async decode(e, A) {
    const i = await this.decodeBlock(A), n = e.Predictor || 1;
    if (n !== 1) {
      const o = !e.StripOffsets, I = o ? e.TileWidth : e.ImageWidth, s = o ? e.TileLength : e.RowsPerStrip || e.ImageLength;
      return Xn(
        i,
        n,
        I,
        s,
        e.BitsPerSample,
        e.PlanarConfiguration
      );
    }
    return i;
  }
}
function He(t) {
  switch (t) {
    case K.BYTE:
    case K.ASCII:
    case K.SBYTE:
    case K.UNDEFINED:
      return 1;
    case K.SHORT:
    case K.SSHORT:
      return 2;
    case K.LONG:
    case K.SLONG:
    case K.FLOAT:
    case K.IFD:
      return 4;
    case K.RATIONAL:
    case K.SRATIONAL:
    case K.DOUBLE:
    case K.LONG8:
    case K.SLONG8:
    case K.IFD8:
      return 8;
    default:
      throw new RangeError(`Invalid field type: ${t}`);
  }
}
function Wn(t) {
  const e = t.GeoKeyDirectory;
  if (!e)
    return null;
  const A = {};
  for (let i = 4; i <= e[3] * 4; i += 4) {
    const n = vA[e[i]], o = e[i + 1] ? pA[e[i + 1]] : null, I = e[i + 2], s = e[i + 3];
    let y = null;
    if (!o)
      y = s;
    else {
      if (y = t[o], typeof y > "u" || y === null)
        throw new Error(`Could not get value of geoKey '${n}'.`);
      typeof y == "string" ? y = y.substring(s, s + I - 1) : y.subarray && (y = y.subarray(s, s + I), I === 1 && (y = y[0]));
    }
    A[n] = y;
  }
  return A;
}
function GA(t, e, A, i) {
  let n = null, o = null;
  const I = He(e);
  switch (e) {
    case K.BYTE:
    case K.ASCII:
    case K.UNDEFINED:
      n = new Uint8Array(A), o = t.readUint8;
      break;
    case K.SBYTE:
      n = new Int8Array(A), o = t.readInt8;
      break;
    case K.SHORT:
      n = new Uint16Array(A), o = t.readUint16;
      break;
    case K.SSHORT:
      n = new Int16Array(A), o = t.readInt16;
      break;
    case K.LONG:
    case K.IFD:
      n = new Uint32Array(A), o = t.readUint32;
      break;
    case K.SLONG:
      n = new Int32Array(A), o = t.readInt32;
      break;
    case K.LONG8:
    case K.IFD8:
      n = new Array(A), o = t.readUint64;
      break;
    case K.SLONG8:
      n = new Array(A), o = t.readInt64;
      break;
    case K.RATIONAL:
      n = new Uint32Array(A * 2), o = t.readUint32;
      break;
    case K.SRATIONAL:
      n = new Int32Array(A * 2), o = t.readInt32;
      break;
    case K.FLOAT:
      n = new Float32Array(A), o = t.readFloat32;
      break;
    case K.DOUBLE:
      n = new Float64Array(A), o = t.readFloat64;
      break;
    default:
      throw new RangeError(`Invalid field type: ${e}`);
  }
  if (e === K.RATIONAL || e === K.SRATIONAL)
    for (let s = 0; s < A; s += 2)
      n[s] = o.call(
        t,
        i + s * I
      ), n[s + 1] = o.call(
        t,
        i + (s * I + 4)
      );
  else
    for (let s = 0; s < A; ++s)
      n[s] = o.call(
        t,
        i + s * I
      );
  return e === K.ASCII ? new TextDecoder("utf-8").decode(n) : n;
}
class Zn {
  constructor(e, A, i) {
    this.fileDirectory = e, this.geoKeyDirectory = A, this.nextIFDByteOffset = i;
  }
}
class zA extends Error {
  constructor(e) {
    super(`No image at index ${e}`), this.index = e;
  }
}
class Li {
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
    const { window: A, width: i, height: n } = e;
    let { resX: o, resY: I, bbox: s } = e;
    const y = await this.getImage();
    let a = y;
    const r = await this.getImageCount(), g = y.getBoundingBox();
    if (A && s)
      throw new Error('Both "bbox" and "window" passed.');
    if (i || n) {
      if (A) {
        const [f, c] = y.getOrigin(), [l, u] = y.getResolution();
        s = [
          f + A[0] * l,
          c + A[1] * u,
          f + A[2] * l,
          c + A[3] * u
        ];
      }
      const B = s || g;
      if (i) {
        if (o)
          throw new Error("Both width and resX passed");
        o = (B[2] - B[0]) / i;
      }
      if (n) {
        if (I)
          throw new Error("Both width and resY passed");
        I = (B[3] - B[1]) / n;
      }
    }
    if (o || I) {
      const B = [];
      for (let f = 0; f < r; ++f) {
        const c = await this.getImage(f), { SubfileType: l, NewSubfileType: u } = c.fileDirectory;
        (f === 0 || l === 2 || u & 1) && B.push(c);
      }
      B.sort((f, c) => f.getWidth() - c.getWidth());
      for (let f = 0; f < B.length; ++f) {
        const c = B[f], l = (g[2] - g[0]) / c.getWidth(), u = (g[3] - g[1]) / c.getHeight();
        if (a = c, o && o > l || I && I > u)
          break;
      }
    }
    let E = A;
    if (s) {
      const [B, f] = y.getOrigin(), [c, l] = a.getResolution(y);
      E = [
        Math.round((s[0] - B) / c),
        Math.round((s[1] - f) / l),
        Math.round((s[2] - B) / c),
        Math.round((s[3] - f) / l)
      ], E = [
        Math.min(E[0], E[2]),
        Math.min(E[1], E[3]),
        Math.max(E[0], E[2]),
        Math.max(E[1], E[3])
      ];
    }
    return a.readRasters({ ...e, window: E });
  }
}
class nA extends Li {
  /**
   * @constructor
   * @param {*} source The datasource to read from.
   * @param {boolean} littleEndian Whether the image uses little endian.
   * @param {boolean} bigTiff Whether the image uses bigTIFF conventions.
   * @param {number} firstIFDOffset The numeric byte-offset from the start of the image
   *                                to the first IFD.
   * @param {GeoTIFFOptions} [options] further options.
   */
  constructor(e, A, i, n, o = {}) {
    super(), this.source = e, this.littleEndian = A, this.bigTiff = i, this.firstIFDOffset = n, this.cache = o.cache || !1, this.ifdRequests = [], this.ghostValues = null;
  }
  async getSlice(e, A) {
    const i = this.bigTiff ? 4048 : 1024;
    return new tn(
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
    let n = await this.getSlice(e);
    const o = this.bigTiff ? n.readUint64(e) : n.readUint16(e), I = o * A + (this.bigTiff ? 16 : 6);
    n.covers(e, I) || (n = await this.getSlice(e, I));
    const s = {};
    let y = e + (this.bigTiff ? 8 : 2);
    for (let g = 0; g < o; y += A, ++g) {
      const E = n.readUint16(y), B = n.readUint16(y + 2), f = this.bigTiff ? n.readUint64(y + 4) : n.readUint32(y + 4);
      let c, l;
      const u = He(B), h = y + (this.bigTiff ? 12 : 8);
      if (u * f <= (this.bigTiff ? 8 : 4))
        c = GA(n, B, f, h);
      else {
        const D = n.readOffset(h), d = He(B) * f;
        if (n.covers(D, d))
          c = GA(n, B, f, D);
        else {
          const Q = await this.getSlice(D, d);
          c = GA(Q, B, f, D);
        }
      }
      f === 1 && di.indexOf(E) === -1 && !(B === K.RATIONAL || B === K.SRATIONAL) ? l = c[0] : l = c, s[pA[E]] = l;
    }
    const a = Wn(s), r = n.readOffset(
      e + i + A * o
    );
    return new Zn(
      s,
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
        throw A instanceof zA ? new zA(e) : A;
      }
    return this.ifdRequests[e] = (async () => {
      const A = await this.ifdRequests[e - 1];
      if (A.nextIFDByteOffset === 0)
        throw new zA(e);
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
    return new Bt(
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
        if (i instanceof zA)
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
    let n = await this.getSlice(e, i);
    if (A === GA(n, K.ASCII, A.length, e)) {
      const I = GA(n, K.ASCII, i, e).split(`
`)[0], s = Number(I.split("=")[1].split(" ")[0]) + I.length;
      s > i && (n = await this.getSlice(e, s));
      const y = GA(n, K.ASCII, s, e);
      this.ghostValues = {}, y.split(`
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
    const n = (await e.fetch([{ offset: 0, length: 1024 }], i))[0], o = new en(n), I = o.getUint16(0, 0);
    let s;
    if (I === 18761)
      s = !0;
    else if (I === 19789)
      s = !1;
    else
      throw new TypeError("Invalid byte order value.");
    const y = o.getUint16(2, s);
    let a;
    if (y === 42)
      a = !1;
    else if (y === 43) {
      if (a = !0, o.getUint16(4, s) !== 8)
        throw new Error("Unsupported offset byte-size.");
    } else
      throw new TypeError("Invalid magic number.");
    const r = a ? o.getUint64(8, s) : o.getUint32(4, s);
    return new nA(e, s, a, r, A);
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
class Mi extends Li {
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
    for (let n = 0; n < this.imageFiles.length; n++) {
      const o = this.imageFiles[n];
      for (let I = 0; I < this.imageCounts[n]; I++) {
        if (e === A) {
          const s = await o.requestIFD(i);
          return new Bt(
            s.fileDirectory,
            s.geoKeyDirectory,
            o.dataView,
            o.littleEndian,
            o.cache,
            o.source
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
async function Ni(t, e = {}, A) {
  return nA.fromSource(Ye(t, e), A);
}
async function Ti(t, e = {}, A) {
  return nA.fromSource(pn(t, e), A);
}
async function Oe(t, e) {
  return nA.fromSource(Fn(t), e);
}
async function zn(t, e) {
  return nA.fromSource(Un(t), e);
}
async function MA(t, e) {
  return nA.fromSource(Gn(t), e);
}
async function $n(t, e = [], A = {}, i) {
  const n = await nA.fromSource(Ye(t, A), i), o = await Promise.all(
    e.map((I) => nA.fromSource(Ye(I, A)))
  );
  return new Mi(n, o);
}
function Ao(t, e) {
  return Kn(t, e);
}
const eo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BaseClient: ZA,
  BaseDecoder: dA,
  BaseResponse: WA,
  GeoTIFF: nA,
  GeoTIFFImage: Bt,
  MultiGeoTIFF: Mi,
  Pool: bi,
  addDecoder: CA,
  default: nA,
  fromArrayBuffer: Oe,
  fromBlob: MA,
  fromCustomClient: Ti,
  fromFile: zn,
  fromUrl: Ni,
  fromUrls: $n,
  getDecoder: It,
  globals: Yr,
  rgb: _r,
  setLogger: Pn,
  writeArrayBuffer: Ao
}, Symbol.toStringTag, { value: "Module" }));
class pe {
  constructor() {
    this.promise = new Promise((e, A) => {
      this.reject = A, this.resolve = e;
    });
  }
}
const ut = {};
function fA(t, e, A = "warn") {
  ut[t] || (ut[t] = !0, console[A](e));
}
const to = (t) => {
  var A, i, n;
  const e = /* @__PURE__ */ new Map();
  for (const o of t) {
    const I = new DOMParser().parseFromString(
      (A = o.fileDirectory) == null ? void 0 : A.ImageDescription,
      "text/xml"
    ), s = (i = I == null ? void 0 : I.querySelector("Name")) == null ? void 0 : i.textContent, y = (n = I == null ? void 0 : I.querySelector("Color")) == null ? void 0 : n.textContent;
    if (!s)
      continue;
    const a = y ? y.split(",").map((r) => parseInt(r)) : [255, 255, 255];
    e.has(s) || e.set(s, {
      name: s,
      color: a,
      images: []
    }), e.get(s).images.push(o);
  }
  return e;
};
class uA {
  static RGBAfromYCbCr(...e) {
    let A, i, n;
    if (e.length === 1) {
      const s = e[0], y = new Uint8ClampedArray(s.length * 4 / 3);
      for (let a = 0, r = 0; a < s.length; a += 3, r += 4)
        A = s[a], i = s[a + 1], n = s[a + 2], y[r] = A + 1.402 * (n - 128), y[r + 1] = A - 0.34414 * (i - 128) - 0.71414 * (n - 128), y[r + 2] = A + 1.772 * (i - 128), y[r + 3] = 255;
      return y;
    }
    [A, i, n] = e;
    const o = A.length, I = new Uint8ClampedArray(o * 4);
    for (let s = 0, y = 0; s < o; s++, y += 4) {
      const a = A[s], r = i[s], g = n[s];
      I[y] = a + 1.402 * (g - 128), I[y + 1] = a - 0.34414 * (r - 128) - 0.71414 * (g - 128), I[y + 2] = a + 1.772 * (r - 128), I[y + 3] = 255;
    }
    return I;
  }
  static RGBAfromRGB(...e) {
    if (e.length === 1) {
      const y = e[0], a = new Uint8ClampedArray(y.length * 4 / 3);
      for (let r = 0, g = 0; r < y.length; r += 3, g += 4)
        a[g] = y[r], a[g + 1] = y[r + 1], a[g + 2] = y[r + 2], a[g + 3] = 255;
      return a;
    }
    const A = e[0], i = e[1], n = e[2], o = e.length >= 4 ? e[3] : null, I = A.length, s = new Uint8ClampedArray(I * 4);
    for (let y = 0, a = 0; y < I; y++, a += 4)
      s[a] = A[y], s[a + 1] = i[y], s[a + 2] = n[y], s[a + 3] = o ? o[y] : 255;
    return s;
  }
  static RGBAfromWhiteIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let n;
    for (let o = 0, I = 0; o < e.length; ++o, I += 4)
      n = 256 - e[o] / A * 256, i[I] = n, i[I + 1] = n, i[I + 2] = n, i[I + 3] = 255;
    return i;
  }
  static RGBAfromBlackIsZero(e, A) {
    const i = new Uint8ClampedArray(e.length * 4);
    let n;
    for (let o = 0, I = 0; o < e.length; ++o, I += 4)
      n = e[o] / A * 256, i[I] = n, i[I + 1] = n, i[I + 2] = n, i[I + 3] = 255;
    return i;
  }
  static RGBAfromPalette(e, A) {
    const i = new Uint8ClampedArray(e.length * 4), n = A.length / 3, o = A.length / 3 * 2;
    for (let I = 0, s = 0; I < e.length; ++I, s += 4) {
      const y = e[I];
      i[s] = A[y] / 65536 * 256, i[s + 1] = A[y + n] / 65536 * 256, i[s + 2] = A[y + o] / 65536 * 256, i[s + 3] = 255;
    }
    return i;
  }
  static RGBAfromCMYK(...e) {
    if (e.length === 1) {
      const y = e[0], a = new Uint8ClampedArray(y.length);
      for (let r = 0, g = 0; r < y.length; r += 4, g += 4) {
        const E = y[r], B = y[r + 1], f = y[r + 2], c = y[r + 3];
        a[g] = 255 * ((255 - E) / 256) * ((255 - c) / 256), a[g + 1] = 255 * ((255 - B) / 256) * ((255 - c) / 256), a[g + 2] = 255 * ((255 - f) / 256) * ((255 - c) / 256), a[g + 3] = 255;
      }
      return a;
    }
    const A = e[0], i = e[1], n = e[2], o = e[3], I = A.length, s = new Uint8ClampedArray(I * 4);
    for (let y = 0, a = 0; y < I; y++, a += 4) {
      const r = A[y], g = i[y], E = n[y], B = o[y];
      s[a] = 255 * ((255 - r) / 256) * ((255 - B) / 256), s[a + 1] = 255 * ((255 - g) / 256) * ((255 - B) / 256), s[a + 2] = 255 * ((255 - E) / 256) * ((255 - B) / 256), s[a + 3] = 255;
    }
    return s;
  }
  static RGBAfromCIELab(...e) {
    const o = (g, E, B) => {
      const f = E << 24 >> 24, c = B << 24 >> 24;
      let l = (g + 16) / 116, u = f / 500 + l, h = l - c / 200;
      u = 0.95047 * (u * u * u > 8856e-6 ? u * u * u : (u - 0.13793103448275862) / 7.787), l = 1 * (l * l * l > 8856e-6 ? l * l * l : (l - 0.13793103448275862) / 7.787), h = 1.08883 * (h * h * h > 8856e-6 ? h * h * h : (h - 0.13793103448275862) / 7.787);
      let D = u * 3.2406 + l * -1.5372 + h * -0.4986, d = u * -0.9689 + l * 1.8758 + h * 0.0415, Q = u * 0.0557 + l * -0.204 + h * 1.057;
      return D = D > 31308e-7 ? 1.055 * D ** 0.4166666666666667 - 0.055 : 12.92 * D, d = d > 31308e-7 ? 1.055 * d ** 0.4166666666666667 - 0.055 : 12.92 * d, Q = Q > 31308e-7 ? 1.055 * Q ** 0.4166666666666667 - 0.055 : 12.92 * Q, [
        Math.max(0, Math.min(1, D)) * 255,
        Math.max(0, Math.min(1, d)) * 255,
        Math.max(0, Math.min(1, Q)) * 255
      ];
    };
    if (e.length === 1) {
      const g = e[0], E = new Uint8ClampedArray(g.length * 4 / 3);
      for (let B = 0, f = 0; B < g.length; B += 3, f += 4) {
        const [c, l, u] = o(g[B], g[B + 1], g[B + 2]);
        E[f] = c, E[f + 1] = l, E[f + 2] = u, E[f + 3] = 255;
      }
      return E;
    }
    const I = e[0], s = e[1], y = e[2], a = I.length, r = new Uint8ClampedArray(a * 4);
    for (let g = 0, E = 0; g < a; g++, E += 4) {
      const [B, f, c] = o(I[g], s[g], y[g]);
      r[E] = B, r[E + 1] = f, r[E + 2] = c, r[E + 3] = 255;
    }
    return r;
  }
}
const io = {
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
}, Ke = 1, yA = {
  WhiteIsZero: 0,
  BlackIsZero: 1,
  RGB: 2,
  Palette: 3,
  CMYK: 5,
  YCbCr: 6,
  CIELab: 8
}, mA = {
  UINT: 1,
  INT: 2,
  FLOAT: 3
};
function ce(t, e, A) {
  if (t == null) return A;
  if (Array.isArray(t) || ArrayBuffer.isView(t)) {
    if (t.length === 0) return A;
    const i = e < t.length ? t[e] : t[0];
    return i ?? A;
  }
  return t;
}
function qi(t) {
  const e = t || {}, A = (i) => i == null ? null : Array.isArray(i) ? i.length ? i : null : ArrayBuffer.isView(i) ? i.length ? Array.from(i) : null : [i];
  return {
    sMinSampleValue: A(e.SMinSampleValue),
    sMaxSampleValue: A(e.SMaxSampleValue)
  };
}
function ke(t, e, A, i) {
  const n = ce(t.sMinSampleValue, e, null), o = ce(t.sMaxSampleValue, e, null);
  if (n === null || o === null) return null;
  const I = Number(n), s = Number(o);
  return !Number.isFinite(I) || !Number.isFinite(s) || s <= I || A !== null && (I < A || s > i) ? null : { min: I, max: s };
}
function dt(t, e) {
  return e ? [-Math.pow(2, t - 1), Math.pow(2, t - 1) - 1] : [0, Math.pow(2, t) - 1];
}
function ft(t) {
  const e = t || {}, A = e.bitsPerSample, i = e.sampleFormat;
  let n = e.samplesPerPixel;
  n > 0 || (n = Array.isArray(A) || ArrayBuffer.isView(A) ? A.length : 1), n = Math.max(1, n | 0);
  const o = [];
  for (let I = 0; I < n; I++) {
    const s = ce(A, I, 8) || 8, y = ce(i, I, mA.UINT) || mA.UINT;
    let a, r = 0, g = !1;
    switch (y) {
      case mA.UINT: {
        const E = ke(e, I, ...dt(s, !1));
        E ? (a = E.max - E.min, r = E.min) : a = Math.pow(2, s) - 1;
        break;
      }
      case mA.INT: {
        const E = ke(e, I, ...dt(s, !0));
        E ? (a = E.max - E.min, r = E.min) : (a = Math.pow(2, s - 1) - 1, g = !0);
        break;
      }
      case mA.FLOAT: {
        const E = ke(e, I, null, null);
        E ? (a = E.max - E.min, r = E.min) : (a = 1, g = !0);
        break;
      }
      default:
        throw new Error(
          `[RawTiffPlugin] Unsupported SampleFormat ${y} on channel ${I}; only 1 (unsigned int), 2 (signed int) and 3 (float) are supported.`
        );
    }
    a > 0 || (a = 1), o.push({ scale: a, offset: r, signed: g, bits: s, sampleFormat: y });
  }
  return { version: Ke, channels: o };
}
function YA(t, e) {
  const A = t && t.channels || [];
  return A.length ? A[e] != null ? A[e] : A[0] : { scale: 1, offset: 0, signed: !1, bits: 8, sampleFormat: 1 };
}
function ro(t, e) {
  if (t == null) return 0;
  const A = Number(t);
  return Number.isNaN(A) ? 0 : (A - e.offset) / e.scale;
}
function wt(t, e) {
  const A = ro(t, e);
  return A <= 0 ? 0 : A >= 1 ? 255 : Math.round(A * 255);
}
function no(t) {
  return t.bits === 8 && (t.sampleFormat === mA.UINT || t.sampleFormat === mA.INT);
}
function oo(t, e) {
  const A = t || {}, i = A.photometricInterpretation, n = A.encoding;
  if (i === yA.Palette && A.hasColorMap) return "image";
  const o = A.samplesPerPixel || n && n.channels.length || 1;
  return (i === yA.RGB || i === yA.YCbCr || i === yA.CMYK || i === yA.CIELab || (i === yA.BlackIsZero || i === yA.WhiteIsZero) && o === 1) && (Array.isArray(e) && e.length ? e.filter((a) => a != null && a >= 0) : n.channels.map((a, r) => r)).every((a) => no(YA(n, a))) ? "image" : "data";
}
function Fe(t) {
  if (t.__encoding) return t.__encoding;
  const { sMinSampleValue: e, sMaxSampleValue: A } = qi(t.fileDirectory), i = ft({
    bitsPerSample: t.bitsPerSample,
    sampleFormat: t.sampleFormat,
    sMinSampleValue: e,
    sMaxSampleValue: A,
    samplesPerPixel: Math.max(
      t.samplesPerPixel || 0,
      t.bands ? t.bands.length : 0
    )
  });
  return t.__encoding = i, i;
}
function ao() {
  let t, e;
  return { promise: new Promise((i, n) => {
    t = i, e = n;
  }), resolve: t, reject: e };
}
function so(t) {
  try {
    return t ? typeof t == "string" ? t : t && typeof t.message == "string" ? t.message : JSON.stringify(t) : "Unknown error";
  } catch {
    return String(t);
  }
}
class _e {
  constructor(e) {
    Object.assign(this, e);
  }
  getType() {
    return "gpuTextureSet";
  }
}
class go {
  /**
   * @param {Object} params
   * @param {number} params.size
   * @param {() => Worker} params.createWorker
   */
  constructor({ size: e, createWorker: A }) {
    this.size = Math.max(1, e | 0), this.createWorker = A, this.workers = [], this._nextId = 1;
    for (let i = 0; i < this.size; i++) {
      const n = this.createWorker(), o = { worker: n, pending: 0, callbacks: /* @__PURE__ */ new Map() };
      n.onmessage = (I) => {
        const s = I.data || {};
        if (s.kind === "warn") {
          fA(
            s.code || "RawTiffWorker_warn",
            s.message || "[RawTiffWorker] warning",
            "warn"
          );
          return;
        }
        const y = s.id, a = o.callbacks.get(y);
        a && (o.callbacks.delete(y), o.pending = Math.max(0, o.pending - 1), s.ok ? a.resolve(s.result) : a.reject(new Error(so(s.error))));
      }, n.onerror = (I) => {
        for (const s of o.callbacks.values())
          s.reject(I instanceof Error ? I : new Error(String(I)));
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
    const n = this._nextId++, o = ao();
    let I = this.workers[0];
    for (const s of this.workers)
      s.pending < I.pending && (I = s);
    I.pending++, I.callbacks.set(n, o);
    try {
      i && i.length ? I.worker.postMessage({ id: n, op: e, payload: A }, i) : I.worker.postMessage({ id: n, op: e, payload: A });
    } catch (s) {
      I.callbacks.delete(n), I.pending = Math.max(0, I.pending - 1), o.reject(s);
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
function Io() {
  return new Worker(new URL(
    /* @vite-ignore */
    "/assets/tiff.worker-hM9BOsqI.js",
    import.meta.url
  ), { type: "module" });
}
class DA {
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
class Pe {
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
function RA(t, e) {
  const A = Array.isArray(t) ? t.slice() : Object.assign({}, t || {});
  if (!e || typeof e != "object") return A;
  for (const i of Object.keys(e)) {
    const n = e[i];
    n && typeof n == "object" && !Array.isArray(n) && A[i] && typeof A[i] == "object" && !Array.isArray(A[i]) ? A[i] = RA(A[i], n) : A[i] = n;
  }
  return A;
}
function $A(t, e) {
  const A = e && e.hints;
  if (A && A.formatResolved) return A.formatResolved;
  if (A && A.format) return A.format;
  if (e && e.meta && e.meta.format) return e.meta.format;
  if (t && t.format) return t.format;
  if (t && t.userData && t.userData.format) return t.userData.format;
  const i = t && (t.source || t.tileSource || t._tileSource || t.tiledImage && t.tiledImage.source);
  return i && i.format ? i.format : i && i.options && i.options.format ? i.options.format : null;
}
function Bo(t) {
  return Array.isArray(t) ? t.map((e) => {
    const A = typeof e.ctor == "string" && globalThis[e.ctor] ? globalThis[e.ctor] : Uint8Array;
    return new A(e.buffer, e.byteOffset || 0, e.length);
  }) : [];
}
function lo(t, e) {
  const A = Bo(t.bands);
  return new Pe({
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
function yt(t) {
  const e = (t.packs || []).map((A) => {
    const i = A.data, n = typeof i.ctor == "string" && globalThis[i.ctor] ? globalThis[i.ctor] : Uint8Array, o = new n(i.buffer, i.byteOffset || 0, i.length);
    return Object.assign({}, A, { data: o });
  });
  return new _e({
    width: t.width,
    height: t.height,
    mode: t.mode,
    channelCount: t.channelCount,
    encodingVersion: t.encodingVersion,
    encoding: t.encoding,
    packs: e
  });
}
function fo(t, e = {}) {
  const A = t;
  if (A.RawTiffPlugin && A.RawTiffPlugin.__installed) return A.RawTiffPlugin;
  const i = Object.assign({ toneMap: null }, e.defaults || {});
  i.format = RA(io, e.defaults && e.defaults.format || null);
  const n = Object.assign({
    enabled: !0,
    size: typeof navigator < "u" && navigator.hardwareConcurrency ? Math.max(1, Math.min(4, Math.ceil(navigator.hardwareConcurrency / 2))) : 2,
    createWorker: null,
    transferInput: !1,
    enableRawTiffToImageBitmap: !0
  }, e.workerPool || {}), o = A.RawTiffPluginShared = A.RawTiffPluginShared || {};
  function I() {
    var C, w;
    if (!n.enabled || typeof Worker > "u") return null;
    if (o.__rawTiffWorkerPool) return o.__rawTiffWorkerPool;
    const Q = n.createWorker || Io;
    try {
      return o.__rawTiffWorkerPool = new go({
        size: n.size,
        createWorker: Q
      }), o.__rawTiffWorkerPool;
    } catch (m) {
      return (w = (C = A.console) == null ? void 0 : C.warn) == null || w.call(C, "[RawTiffPlugin] Failed to create worker pool; falling back to main thread.", m), o.__rawTiffWorkerPool = null, null;
    }
  }
  async function s(Q) {
    if (Q == null) throw new Error("[RawTiffPlugin] rawTiff is null/undefined.");
    if (Q instanceof DA) return s(Q.source);
    if (typeof Q == "object") {
      if (typeof Q.arrayBuffer == "function") {
        const C = await Q.arrayBuffer();
        if (C instanceof ArrayBuffer) return C;
      }
      if (Q.bytes != null) return s(Q.bytes);
      if (Q.blob != null) return s(Q.blob);
    }
    if (typeof Blob < "u" && Q instanceof Blob) return await Q.arrayBuffer();
    if (Q instanceof ArrayBuffer) return Q;
    if (ArrayBuffer.isView(Q)) {
      const { buffer: C, byteOffset: w, byteLength: m } = Q;
      return C.slice(w, w + m);
    }
    throw new Error("[RawTiffPlugin] Unsupported rawTiff payload. Provide ArrayBuffer, TypedArray, Blob, or RawTiff wrapper.");
  }
  async function y(Q) {
    return typeof Q.getImageCount == "function" ? await Q.getImageCount() : typeof Q.getImages == "function" ? (await Q.getImages()).length : 1;
  }
  async function a(Q, C) {
    if (typeof Q.getImage == "function") return await Q.getImage(C);
    if (typeof Q.getImages == "function") return (await Q.getImages())[C];
    throw new Error("[RawTiffPlugin] geotiff instance does not expose getImage/getImages.");
  }
  async function r(Q, C) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const w = C && C.hints || (C instanceof DA ? C.hints : null) || {}, m = await s(C);
    let F;
    if (typeof Oe == "function")
      F = await Oe(m);
    else if (typeof MA == "function")
      F = await MA(new Blob([m], { type: "image/tiff" }));
    else
      throw new Error("[RawTiffPlugin] geotiff module does not provide fromArrayBuffer/fromBlob.");
    const k = await y(F);
    let p = w.imageIndex;
    if (k > 1) {
      if (typeof p != "number" || !Number.isFinite(p))
        throw new Error(`[RawTiffPlugin] TIFF contains ${k} images. Provide rawTiff.hints.imageIndex.`);
      if (p < 0 || p >= k)
        throw new Error(`[RawTiffPlugin] imageIndex ${p} out of range (0..${k - 1}).`);
    } else
      p = 0;
    const x = await a(F, p), b = typeof x.getWidth == "function" ? x.getWidth() : x.width, M = typeof x.getHeight == "function" ? x.getHeight() : x.height, S = typeof x.getSamplesPerPixel == "function" ? x.getSamplesPerPixel() : x.samplesPerPixel || 1, G = typeof x.getBitsPerSample == "function" ? x.getBitsPerSample() : x.bitsPerSample || [8], U = typeof x.getSampleFormat == "function" ? x.getSampleFormat() : x.sampleFormat || null, L = typeof x.getPhotometricInterpretation == "function" ? x.getPhotometricInterpretation() : x.fileDirectory ? x.fileDirectory.PhotometricInterpretation : void 0, R = x.fileDirectory || null, N = R && R.ColorMap ? R.ColorMap : null, v = Object.assign({ interleave: !1 }, w.decode || {}), Y = await x.readRasters(v), _ = Array.isArray(Y) ? Y : [Y], q = Math.max(S || 0, _.length);
    return new Pe({
      width: b,
      height: M,
      bands: _,
      samplesPerPixel: q,
      bitsPerSample: Array.isArray(G) ? G : [G],
      sampleFormat: Array.isArray(U) ? U : U ? [U] : null,
      photometricInterpretation: L,
      colorMap: N,
      fileDirectory: R,
      hints: w
    });
  }
  async function g(Q, C, w) {
    const m = C && C.hints || (C instanceof DA ? C.hints : null) || {}, F = await s(C), k = $A(Q, C), p = RA(i.format, k || null), x = Object.assign({}, m, { formatResolved: p }), b = n && n.transferInput ? [F] : [], M = await w.request("decodeRaster", { buffer: F, hints: x }, b);
    return lo(M, x);
  }
  async function E(Q, C) {
    if (!A.supportsAsync) throw new Error("[RawTiffPlugin] Not supported in sync mode.");
    const w = I();
    return w ? await g(Q, C, w) : await r(Q, C);
  }
  async function B(Q, C) {
    const w = C && C.hints || (C instanceof DA ? C.hints : null) || {}, m = I();
    if (m) {
      const k = await s(C), p = $A(Q, C), x = RA(i.format, p || null), b = Object.assign({}, w, { formatResolved: x }), M = n && n.transferInput ? [k] : [], S = await m.request("decodeAndRenderImageBitmap", { buffer: k, hints: b }, M);
      if (S && S.kind === "imageBitmap") return S.imageBitmap;
      if (S && S.kind === "rgba8") {
        if (typeof createImageBitmap != "function")
          throw new Error("[RawTiffPlugin] createImageBitmap is not available to build ImageBitmap fallback.");
        const G = new Uint8ClampedArray(S.rgbaBuffer, S.rgbaByteOffset || 0, S.rgbaLength), U = new ImageData(G, S.width, S.height);
        return await createImageBitmap(U);
      }
      throw new Error("[RawTiffPlugin] Worker did not return a supported output.");
    }
    const F = await r(Q, C);
    return await h(Q, F);
  }
  async function f(Q, C) {
    const w = C && C.hints || (C instanceof DA ? C.hints : null) || {}, m = I();
    if (!m) {
      const G = await r(Q, C);
      return await c(Q, G);
    }
    const F = await s(C), k = $A(Q, C), p = RA(i.format, k || null), x = Object.assign({}, w, { formatResolved: p }), b = n && n.transferInput ? [F] : [], M = await m.request("decodeAndPackGpuTextureSet", { buffer: F, hints: x }, b), S = yt(M.texSet);
    return S.hints = x, S;
  }
  async function c(Q, C) {
    var U;
    const w = C.hints || {}, m = $A(Q, C), F = RA(i.format, m || null), k = Object.assign({}, w, { formatResolved: F }), p = I();
    if (!p) {
      fA("gpuTextureSet_no_worker", "[RawTiffPlugin] No worker pool available; gpuTextureSet packing will fall back to worker-less path (slower).", "warn");
      const L = C.width, R = C.height, N = L * R, v = Fe(C), Y = ((U = F.gpu) == null ? void 0 : U.padAlpha) == null ? 1 : F.gpu.padAlpha, _ = new Uint8Array(N * 4), q = [0, 1, 2, 3].map((T) => C.bands[T] ? T : -1);
      for (let T = 0; T < 4; T++) {
        const O = C.bands[T];
        if (!O) {
          const H = Math.round((T === 3 ? Y : 0) * 255);
          if (H) for (let P = 0; P < N; P++) _[P * 4 + T] = H;
          continue;
        }
        const J = YA(v, T);
        for (let H = 0; H < N; H++) _[H * 4 + T] = wt(O[H], J);
      }
      return new _e({
        width: L,
        height: R,
        mode: "data",
        channelCount: C.bands ? C.bands.length : 0,
        encodingVersion: Ke,
        encoding: v,
        packs: [{
          format: "RGBA8",
          data: _,
          channels: q,
          normalized: !0,
          scale: q.map((T) => T >= 0 ? YA(v, T).scale : 1),
          offset: q.map((T) => T >= 0 ? YA(v, T).offset : 0)
        }]
      });
    }
    const x = C.bands.map((L) => {
      var R;
      return {
        ctor: ((R = L.constructor) == null ? void 0 : R.name) || "Uint8Array",
        buffer: L.buffer,
        byteOffset: L.byteOffset,
        length: L.length
      };
    }), b = {
      width: C.width,
      height: C.height,
      bands: x,
      samplesPerPixel: C.samplesPerPixel,
      bitsPerSample: C.bitsPerSample,
      sampleFormat: C.sampleFormat,
      photometricInterpretation: C.photometricInterpretation,
      colorMap: C.colorMap,
      fileDirectory: C.fileDirectory
    }, M = x.map((L) => L.buffer), S = await p.request("rasterToGpuTextureSet", { raster: b, hints: k }, M), G = yt(S);
    return G.hints = k, G;
  }
  function l(Q, C, w) {
    return Q == null || Number.isNaN(Q) ? 0 : wt(Q, YA(Fe(w), C));
  }
  function u(Q) {
    const C = i.toneMap || l, w = z || {}, m = Q.width, F = Q.height, k = m * F, p = Q.hints.renderChannels || Q.renderChannels || null, x = Q.samplesPerPixel || Q.bands.length || 1, b = (R, N) => C(Q.bands[R][N], R, Q), M = Q.photometricInterpretation;
    if (M === w.Palette && Q.colorMap) {
      const R = Q.bands[0];
      return uA.RGBAfromPalette(R, Q.colorMap);
    }
    if ((M === w.WhiteIsZero || M === w.BlackIsZero) && x >= 1) {
      const R = Q.bands[0], N = new Uint8ClampedArray(R.length);
      for (let v = 0; v < R.length; v++) N[v] = C(R[v], 0, Q);
      return M === w.WhiteIsZero ? uA.RGBAfromWhiteIsZero(N, 255) : uA.RGBAfromBlackIsZero(N, 255);
    }
    const S = p || (M === w.RGB || M === w.YCbCr || M === w.CIELab ? [0, 1, 2] : x >= 3 ? [0, 1, 2] : [0]);
    if (S.length > 4 && (fA(
      "renderChannels>4_to_RGBA",
      `[tiff] Requested ${S.length} channels for RGBA output; only 4 can be represented. Extra channels will be dropped.`,
      "warn"
    ), S.splice(4)), S.length === 1) {
      const R = S[0], N = new Uint8ClampedArray(k * 4);
      for (let v = 0, Y = 0; v < k; v++, Y += 4) {
        const _ = b(R, v);
        N[Y] = N[Y + 1] = N[Y + 2] = _, N[Y + 3] = 255;
      }
      return N;
    }
    const G = new Uint8ClampedArray(k * S.length);
    for (let R = 0; R < k; R++) {
      const N = R * S.length;
      for (let v = 0; v < S.length; v++) {
        const Y = S[v];
        G[N + v] = Y < Q.bands.length ? b(Y, R) : 0;
      }
    }
    if (M === w.YCbCr && S.length >= 3) return uA.RGBAfromYCbCr(G);
    if (M === w.CMYK && S.length >= 4) return uA.RGBAfromCMYK(G);
    if (M === w.CIELab && S.length >= 3) return uA.RGBAfromCIELab(G);
    if (S.length === 4) return G;
    if (S.length === 3) return uA.RGBAfromRGB(G);
    const U = new Uint8ClampedArray(k * 4), L = S.length >= 4;
    for (let R = 0, N = 0; R < k; R++, N += 4) {
      const v = R * S.length;
      U[N] = G[v], U[N + 1] = G[v + 1] || 0, U[N + 2] = G[v + 2] || 0, U[N + 3] = L ? G[v + 3] : 255;
    }
    return U;
  }
  async function h(Q, C) {
    if (typeof createImageBitmap != "function")
      throw new Error("[RawTiffPlugin] createImageBitmap is not available.");
    const w = u(C), m = new ImageData(w, C.width, C.height);
    return await createImageBitmap(m);
  }
  async function D(Q, C) {
    const w = await h(Q, C), m = document.createElement("canvas");
    m.width = w.width, m.height = w.height;
    const F = m.getContext("2d", { willReadFrequently: !0 });
    return F.drawImage(w, 0, 0), F;
  }
  A.converter ? (A.converter.learn("rawTiff", "tiffRaster", (Q, C) => E(Q, C), 2, 10), n.enableRawTiffToImageBitmap && A.converter.learn("rawTiff", "imageBitmap", (Q, C) => B(Q, C), 1, 5), A.converter.learn("tiffRaster", "context2d", (Q, C) => D(Q, C), 2, 10), A.converter.learn("tiffRaster", "imageBitmap", (Q, C) => h(Q, C), 1, 50), A.converter.learn("rawTiff", "gpuTextureSet", (Q, C) => f(Q, C), 1, 8), A.converter.learn("tiffRaster", "gpuTextureSet", (Q, C) => c(Q, C), 1, 12)) : A.console.warn("[RawTiffPlugin] OpenSeadragon.converter is missing. Load OSD v6+.");
  const d = {
    __installed: !0,
    RawTiff: DA,
    TiffRaster: Pe,
    GpuTextureSet: _e,
    Converters: uA,
    decodeRawTiff: E,
    rasterToRGBA8: u,
    rasterToContext2d: D,
    rasterToImageBitmap: h,
    // Sample encoding contract (see utils/tiffEncoding.js). A consumer can resolve the
    // same descriptor the packer used, without duplicating the rules.
    SAMPLE_ENCODING_VERSION: Ke,
    resolveSampleEncoding: ft,
    rasterEncoding: Fe,
    getWorkerPool: I,
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
    convert(Q, C, w, m) {
      if (!A.converter) throw new Error("[RawTiffPlugin] OpenSeadragon.converter is missing.");
      const F = m || A.converter.guessType(C);
      return A.converter.convert(Q, C, F, w);
    },
    /**
     * Wrap binary as a RawTiff object.
     * @param {*} source
     * @param {Object} [opts]
     * @returns {RawTiff}
     */
    wrap(Q, C) {
      return new DA(Q, C);
    },
    /**
     * Expose defaults (merged).
     */
    defaults: i
  };
  return A.RawTiffPlugin = d, d;
}
window.GeoTIFF = eo;
const co = (t, e = {}) => {
  if (t.version.major < 4 || t.version.major === 4 && t.version.minor < 1)
    throw new Error("Your current OpenSeadragon version is too low to support GeoTIFFTileSource");
  const {
    workerUrl: A,
    // optional: string or URL
    workerPool: i,
    // optional: { createWorker: () => Worker }
    httpAdapter: n,
    // optional: { fetch(url, init?) => Promise<Response> }
    defaults: o
    // optional: { format, toneMap }
  } = e, I = n ? /* @__PURE__ */ (() => {
    class f extends WA {
      constructor(l) {
        super(), this.res = l;
      }
      get status() {
        return this.res.status;
      }
      getHeader(l) {
        return this.res.headers.get(l);
      }
      async getData() {
        return this.res.arrayBuffer();
      }
    }
    return class extends ZA {
      async request({ headers: l, signal: u } = {}) {
        const h = await n.fetch(this.url, { headers: l, signal: u });
        return new f(h);
      }
    };
  })() : null, s = (f, c) => I ? Ti(new I(f), c) : Ni(f, c), a = i || {
    createWorker: () => A ? new Worker(A, { type: "module" }) : new Worker(new URL(
      /* @vite-ignore */
      "/assets/tiff.worker-hM9BOsqI.js",
      import.meta.url
    ), {
      type: "module"
    })
  }, r = t.RawTiffPlugin || fo(t, {
    workerPool: a,
    defaults: o
  });
  let g = 0;
  const B = class B extends t.TileSource {
    static get sharedPool() {
      return B._sharedPool || (B._sharedPool = new bi()), B._sharedPool;
    }
    static set sharedPool(c) {
      B._sharedPool = c;
    }
    constructor(c, l = { logLatency: !1 }) {
      const u = g++, h = typeof File < "u" && c instanceof File;
      c && typeof c == "object" && !h && !c.GeoTIFF && typeof c.url == "string" && (l = Object.assign({}, c, l), c = c.url), super(typeof c == "string" ? c : `geotiff://${u}`);
      let D = this;
      this.input = c, this.options = l, this.channel = (c == null ? void 0 : c.channel) ?? (l == null ? void 0 : l.channel) ?? null, this.format = (l == null ? void 0 : l.format) ?? (c == null ? void 0 : c.format) ?? null, this._ready = !1, this._pool = B.sharedPool, this._tileSize = 256, this._tsCounter = u, c.GeoTIFF && c.GeoTIFFImages ? (this.promises = {
        GeoTIFF: Promise.resolve(c.GeoTIFF),
        GeoTIFFImages: Promise.resolve(c.GeoTIFFImages),
        ready: new pe()
      }, this.GeoTIFF = c.GeoTIFF, this.imageCount = c.GeoTIFFImages.length, this.GeoTIFFImages = c.GeoTIFFImages, this.GeoTIFFAllImages = c.GeoTIFFAllImages ?? c.GeoTIFFImages, this.setupLevels()) : (this.promises = {
        GeoTIFF: c instanceof File ? MA(c, l.GeoTIFFOptions) : s(c, l.GeoTIFFOptions),
        GeoTIFFImages: new pe(),
        ready: new pe()
      }, this.promises.GeoTIFF.then((d) => (D.GeoTIFF = d, d.getImageCount())).then((d) => {
        D.imageCount = d;
        let Q = [...Array(d).keys()].map((C) => D.GeoTIFF.getImage(C));
        return Promise.all(Q);
      }).then((d) => {
        d = D.constructor.userDefinedImagesFilter(d, l), D.GeoTIFFImages = d, D.GeoTIFFAllImages = d, D.promises.GeoTIFFImages.resolve(d), this.setupLevels();
      }).catch((d) => {
        throw console.error("Re-throwing error with GeoTIFF:", d), D.promises.ready.promise.catch(() => {
        }), D.promises.ready.reject(d), D.raiseEvent("open-failed", {
          message: d && d.message ? d.message : String(d),
          source: D.url
        }), d;
      }));
    }
    /**
     * OpenSeadragon calls this from the url branch of TileSource to fetch an info document.
     * This source loads the TIFF header itself in the constructor, and the url points at
     * the image data -- downloading it as an info document would be catastrophic.
     */
    getImageInfo() {
    }
    /**
     * Autodetection entry point. Must live on the prototype: TileSource.determineType
     * calls `OpenSeadragon[Type].prototype.supports.call(...)`.
     *
     * Note `this` is the *viewer* here, not a tile source.
     *
     * @param {String|Object|ArrayBuffer|TypedArray} data
     * @param {String} [url]
     * @returns {Boolean}
     */
    supports(c, l) {
      if (c && typeof c == "object" && typeof c.type == "string" && /^(geo)?tiff$/i.test(c.type))
        return !0;
      const u = typeof c == "string" && c || c && typeof c == "object" && typeof c.url == "string" && c.url || l;
      if (typeof u == "string" && /\.(tiff?|qptiff|ome\.tiff?|btf|svs|ndpi|scn)(\?|#|$)/i.test(u))
        return !0;
      let h = null;
      if (c instanceof ArrayBuffer ? h = new Uint8Array(c, 0, Math.min(4, c.byteLength)) : ArrayBuffer.isView(c) && (h = new Uint8Array(c.buffer, c.byteOffset, Math.min(4, c.byteLength))), h && h.length >= 4) {
        const D = h[0] === 73 ? h[2] | h[3] << 8 : h[2] << 8 | h[3], d = D === 42 || D === 43;
        if (h[0] === 73 && h[1] === 73 && d || h[0] === 77 && h[1] === 77 && d) return !0;
      }
      return !1;
    }
    /**
     * Build constructor options from what autodetection matched. `this` is the viewer.
     *
     * @param {String|Object} data
     * @param {String} [url]
     * @returns {Object}
     */
    configure(c, l) {
      if (typeof c == "string") return { url: c };
      const u = Object.assign({}, c);
      return l && !u.url && (u.url = l), u;
    }
    static async getAllTileSources(c, l) {
      const u = c instanceof File ? c.name.split(".").pop() : c.split(".").pop();
      let h = await (c instanceof File ? MA(c, l.GeoTIFFOptions) : s(c, l.GeoTIFFOptions)), D = await h.getImageCount();
      const d = await Promise.all(
        Array.from({ length: D }, (k, p) => h.getImage(p))
      );
      let Q = this.userDefinedImagesFilter(d, l);
      Q = Q.filter(
        (k) => k.fileDirectory.photometricInterpretation !== z.TransparencyMask
      ), Q.sort((k, p) => p.getWidth() - k.getWidth());
      const C = 0.015, m = Q.reduce((k, p) => {
        const x = p.getWidth() / p.getHeight();
        let b = "";
        p.fileDirectory.ImageDescription && (b = p.fileDirectory.ImageDescription.split(`
`)[1] ?? "");
        const M = k.filter(
          (S) => Math.abs(1 - S.aspectRatio / x) < C && !(b != null && b.toLowerCase().includes("macro") || b != null && b.toLowerCase().includes("label"))
        );
        return M.length === 0 ? k.push({
          aspectRatio: x,
          images: [p]
        }) : M[0].images.push(p), k;
      }, []).map((k) => k.images), F = [];
      for (let k = 0; k < m.length; k++) {
        const p = m[k];
        if (k !== 0) {
          F.push(
            new t.GeoTIFFTileSource(
              {
                GeoTIFF: h,
                GeoTIFFImages: p,
                GeoTIFFAllImages: p
              },
              l
            )
          );
          continue;
        }
        if (u === "qptiff") {
          const M = to(p);
          for (const S of M.values())
            F.push(
              new t.GeoTIFFTileSource(
                {
                  GeoTIFF: h,
                  GeoTIFFImages: S.images,
                  GeoTIFFAllImages: S.images,
                  channel: {
                    name: S.name,
                    color: S.color
                  }
                },
                l
              )
            );
          continue;
        }
        const x = await this.resolveLayout(h, p, l.hints), b = await this.buildLevelImages(h, x, h);
        F.push(
          new t.GeoTIFFTileSource(
            {
              GeoTIFF: h,
              GeoTIFFImages: b,
              GeoTIFFAllImages: p
            },
            l
          )
        );
      }
      return F;
    }
    /**
     * Return the tileWidth for a given level.
     * @function
     * @param {Number} level
     */
    getTileWidth(c) {
      if (this.levels.length > c)
        return this.levels[c].tileWidth;
    }
    /**
     * Return the tileHeight for a given level.
     * @function
     * @param {Number} level
     */
    getTileHeight(c) {
      if (this.levels.length > c)
        return this.levels[c].tileHeight;
    }
    /**
     * @function
     * @param {Number} level
     */
    getLevelScale(c) {
      let l = NaN;
      return this.levels.length > 0 && c >= this.minLevel && c <= this.maxLevel && (l = this.levels[c].width / this.levels[this.maxLevel].width), l;
    }
    /**
     * Handle maintaining unique caches per channel in multi-channel images
     */
    getTileHashKey(c, l, u) {
      var h;
      return `geotiffTileSource${this._tsCounter}_${((h = this == null ? void 0 : this.channel) == null ? void 0 : h.name) ?? ""}_${c}_${l}_${u}`;
    }
    /**
     * Implement function here instead of as custom tile source in client code
     * @function
     * @param {Number} levelnum
     * @param {Number} x
     * @param {Number} y
     */
    getTileUrl(c, l, u) {
      return `${c}/${l}_${u}`;
    }
    downloadTileStart(c) {
      const l = !!t.converter && typeof c.fail == "function", u = "" + c.src, h = new AbortController();
      c.userData && (c.userData.abortController = h);
      const D = this.levels[c.tile.level];
      this.regionToTiffRaster(D, c.tile.x, c.tile.y, h.signal).then(async (d) => {
        if (l) {
          c.finish(d, u, d.getType());
          return;
        }
        const Q = await Promise.resolve(r.rasterToContext2d(c.tile, d));
        c.finish(Q.canvas);
      }).catch((d) => {
        const Q = d && d.message ? d.message : String(d);
        l ? c.fail(Q) : c.finish(null, u, Q);
      });
    }
    downloadTileAbort(c) {
      const l = c.userData && c.userData.abortController;
      l ? l.abort() : t.console.error("Could not abort download: controller not available.");
    }
    setupComplete() {
      this._ready = !0, this.promises.ready.resolve(), this.raiseEvent("ready", { tileSource: this });
    }
    setupLevels() {
      if (this._ready)
        return;
      let c = this.GeoTIFFImages.sort((Q, C) => C.getWidth() - Q.getWidth()), l = this._tileSize, u = this._tileSize, h = c[0].getWidth();
      this.width = h;
      let D = c[0].getHeight();
      if (this.height = D, this.tileOverlap = 0, this.minLevel = 0, this.aspectRatio = this.width / this.height, this.dimensions = new t.Point(this.width, this.height), c.reduce(
        (Q, C) => (Q.width !== -1 && (Q.valid = Q.valid && C.getWidth() < Q.width), Q.width = C.getWidth(), Q),
        { valid: !0, width: -1 }
      ).valid)
        this.levels = c.map((Q) => {
          let C = Q.getWidth(), w = Q.getHeight();
          return {
            width: C,
            height: w,
            tileWidth: this.options.tileWidth || Q.getTileWidth() || l,
            tileHeight: this.options.tileHeight || Q.getTileHeight() || u,
            image: Q,
            scaleFactor: 1
          };
        }), this.maxLevel = this.levels.length - 1;
      else {
        let Q = Math.ceil(
          Math.log2(Math.max(h / l, D / u))
        ), C = [...Array(Q).keys()].filter((w) => w % 2 == 0);
        this.levels = C.map((w) => {
          let m = Math.pow(2, w);
          const F = c.filter((p) => {
            const x = Math.pow(2, w - 1);
            return x >= 0 ? p.getWidth() * x < h && p.getWidth() * m >= h : p.getWidth() * m >= h;
          });
          if (F.length === 0)
            return null;
          const k = F[0];
          return {
            width: h / m,
            height: D / m,
            tileWidth: this.options.tileWidth || k.getTileWidth() || l,
            tileHeight: this.options.tileHeight || k.getTileHeight() || u,
            image: k,
            scaleFactor: m * k.getWidth() / h
          };
        }).filter((w) => w !== null), this.maxLevel = this.levels.length - 1;
      }
      this.levels = this.levels.sort((Q, C) => Q.width - C.width), this.tileWidth = this.levels[0].tileWidth, this.tileHeight = this.levels[0].tileHeight, this.setupComplete();
    }
    /**
     * Declared sample encoding of the displayed plane -- the contract the GPU packs obey.
     * Every component of a pack is (rawSample - offset) / scale, so it lands in [0,1],
     * or [-1,1] for signed sample formats.
     *
     * @returns {import("./utils/tiffEncoding.js").SampleEncoding}
     */
    getSampleEncoding() {
      return this.getTiffDescriptor().encoding;
    }
    /**
     * Everything a consumer needs to interpret this source's tiles, resolved from the
     * full-resolution plane's file directory. Available once the source is ready.
     *
     * @returns {Object}
     */
    getTiffDescriptor() {
      var k, p;
      if (this._descriptor) return this._descriptor;
      if (!this._ready)
        throw new Error(
          "[GeoTIFFTileSource] getTiffDescriptor() is unavailable until the header is parsed; await tileSource.promises.ready first."
        );
      const l = this.levels[this.maxLevel].image.fileDirectory || {}, u = Array.from(l.BitsPerSample || [8]), h = l.SampleFormat ? Array.from(l.SampleFormat) : null, D = Math.max(l.SamplesPerPixel || 0, u.length), { sMinSampleValue: d, sMaxSampleValue: Q } = qi(l), C = ft({
        bitsPerSample: u,
        sampleFormat: h,
        sMinSampleValue: d,
        sMaxSampleValue: Q,
        samplesPerPixel: D
      }), w = this.format && Array.isArray(this.format.channels) && this.format.channels.length ? this.format.channels.slice() : [...Array(D).keys()], m = this.format && this.format.interpretation, F = m && m !== "auto" ? m : oo({
        photometricInterpretation: l.PhotometricInterpretation,
        samplesPerPixel: D,
        hasColorMap: !!l.ColorMap,
        encoding: C
      }, w);
      return this._descriptor = {
        width: this.width,
        height: this.height,
        samplesPerPixel: D,
        bitsPerSample: u,
        sampleFormat: h,
        photometricInterpretation: l.PhotometricInterpretation,
        hasColorMap: !!l.ColorMap,
        channelNames: (k = this.channel) != null && k.name ? [this.channel.name] : [],
        channelColors: (p = this.channel) != null && p.color ? [this.channel.color] : [],
        channels: w,
        interpretationResolved: F,
        encoding: C
      }, this._descriptor;
    }
    static getGeoTiffFileDirectory(c) {
      var l;
      return ((l = c.getFileDirectory) == null ? void 0 : l.call(c)) ?? c.fileDirectory ?? {};
    }
    static getGeoTiffFileKey(c) {
      return [
        c.getWidth(),
        c.getHeight(),
        this.getGeoTiffFileDirectory(c).TileWidth ?? 0,
        this.getGeoTiffFileDirectory(c).TileLength ?? 0,
        (c.getWidth() / c.getHeight()).toFixed(6)
      ].join("|");
    }
    /**
     * Aperio-style companion pages (macro / label) use line 1 of ImageDescription; they must not
     * participate in IFD pyramid detection when mixed with the main slide.
     */
    static isSvsStyleCompanionPage(c) {
      var D;
      const l = (D = c.fileDirectory) == null ? void 0 : D.ImageDescription;
      if (typeof l != "string" || !l) return !1;
      const h = (l.split(`
`)[1] ?? "").toLowerCase();
      return h.includes("macro") || h.includes("label");
    }
    static _uniqueByDecreasingSize(c) {
      const l = c.map((D) => ({ im: D, w: D.getWidth(), h: D.getHeight() })).sort((D, d) => d.w - D.w), u = [], h = /* @__PURE__ */ new Set();
      for (const { im: D, w: d, h: Q } of l) {
        const C = `${d}x${Q}`;
        h.has(C) || (h.add(C), u.push(D));
      }
      return u;
    }
    static async resolveLayout(c, l, u = {}) {
      const h = u.layout || {}, D = h.pyramid || "auto", d = Number.isFinite(h.planeIndex) ? h.planeIndex : 0, Q = h.prefer === "stack" ? "stack" : "pyramid", C = /* @__PURE__ */ new Map();
      for (const J of l) {
        const H = this.getGeoTiffFileKey(J);
        J.__key = H;
        const P = C.get(H) || [];
        P.push(J), C.set(H, P);
      }
      const w = this._uniqueByDecreasingSize(l), m = l.filter((J) => !this.isSvsStyleCompanionPage(J)), F = this._uniqueByDecreasingSize(m), k = (J, H, P) => {
        const j = J / (H + P), V = H - P, W = V > 0 ? J / V : 1 / 0;
        return { min: j, max: W };
      }, p = (J, H) => Math.max(J.min, H.min) <= Math.min(J.max, H.max), x = (J, H, P, j, V) => {
        const W = k(J, P, V), EA = k(H, j, V);
        return p(W, EA);
      }, b = (J) => {
        if (J.length < 2) return !1;
        for (let V = 1; V < J.length; V++)
          if (J[V].getWidth() >= J[V - 1].getWidth() || J[V].getHeight() >= J[V - 1].getHeight()) return !1;
        const H = J[0].getWidth(), P = J[0].getHeight(), j = 1;
        for (const V of J) {
          const W = V.getWidth(), EA = V.getHeight();
          if (!x(H, P, W, EA, j)) return !1;
        }
        return !0;
      }, M = b(w), S = b(F), G = l.some(
        (J) => this.isSvsStyleCompanionPage(J)
      );
      let U = M, L = !U && S;
      G && S && (L = !0, U = !1);
      const R = U || L, N = U ? w : L ? F : w, v = l.some((J) => {
        const H = this.getGeoTiffFileDirectory(J).SubIFDs;
        return H && H.length;
      });
      let Y = "single";
      D === "ifd" ? Y = R ? "ifd" : "single" : D === "subifd" ? Y = v ? "subifd" : "single" : R ? Y = "ifd" : v ? Y = "subifd" : Y = "single";
      const _ = w[0], q = _.__key, T = C.get(q) || [_], O = T[Math.max(0, Math.min(T.length - 1, d))];
      return Q === "stack" && T.length > 1 && Y === "ifd" && (Y = "single"), Y === "subifd" && (fA(`${O.__key}-subifd-warn`, `[GeoTIFFTileSource] File was detected to contain SubIFD pyramids, 
however, geotiff.js does not support reading SubIFD files and is unable to display the pyramid. Only the
high-resolution lowest level will be shown. Note that loading such data can crash your browser due to memory consumption.`, "warn"), Y = "ifd"), { strategy: Y, planes: T, chosenPlane: O, ifdLevelsLargestToSmallest: N };
    }
    static async buildLevelImages(c, l, u) {
      const { strategy: h, chosenPlane: D, ifdLevelsLargestToSmallest: d, planes: Q } = l, C = (w) => {
        var m;
        return ((m = w.getFileDirectory) == null ? void 0 : m.call(w)) ?? w.fileDirectory ?? {};
      };
      if (h === "ifd") {
        const w = [...d].sort((m, F) => m.getWidth() - F.getWidth());
        return Q.length > 1 && fA(u, `[GeoTIFFTileSource] Detected a plane stack (${Q.length} same-size IFDs) AND a top-level pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose a different plane.`, "warn"), w;
      }
      if (h === "subifd") {
        const m = C(D).SubIFDs;
        if (!m || !m.length)
          return fA(u, "[GeoTIFFTileSource] SubIFD pyramid requested/detected but the chosen plane has no SubIFDs. Falling back to single level.", "warn"), [D];
        if (typeof D.getSubIFDs == "function") {
          const k = [...await D.getSubIFDs(), D].sort((p, x) => p.getWidth() - x.getWidth());
          return Q.length > 1 && fA(u, `[GeoTIFFTileSource] Detected a plane stack (${Q.length} same-size IFDs) with SubIFD pyramid. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), k;
        }
        return fA(u, "[GeoTIFFTileSource] SubIFDs are present but geotiff.js does not expose getSubIFDs() in this build. Using single level. (You can still render multi-plane data via your GPU pipeline.)", "warn"), [D];
      }
      return Q.length > 1 && fA(u, `[GeoTIFFTileSource] Detected ${Q.length} same-size IFD pages (likely channels/planes). No pyramid detected. Defaulting to planeIndex=0. Set hints.layout.planeIndex to choose plane.`, "warn"), [D];
    }
    regionToTiffRaster(c, l, u, h) {
      var k, p, x, b;
      const D = this.options.logLatency && Date.now(), d = c.tileWidth, Q = c.tileHeight, C = [l * d, u * Q, (l + 1) * d, (u + 1) * Q].map(
        (M) => M * c.scaleFactor
      ), w = c.image, m = (p = (k = w.fileDirectory) == null ? void 0 : k.Software) == null ? void 0 : p.startsWith("PerkinElmer-QPI");
      let F = null;
      if (m && ((x = w.fileDirectory) != null && x.ImageDescription))
        try {
          const S = (b = new DOMParser().parseFromString(w.fileDirectory.ImageDescription, "text/xml").querySelector("Color")) == null ? void 0 : b.textContent;
          F = S ? S.split(",").map((G) => parseInt(G, 10)) : null;
        } catch {
          F = null;
        }
      return w.readRasters({
        interleave: !1,
        window: C,
        pool: this._pool,
        width: d,
        height: Q,
        signal: h
      }).then((M) => {
        const S = Array.isArray(M) ? M : [M], G = w.fileDirectory || {}, U = new r.TiffRaster({
          width: d,
          height: Q,
          bands: S,
          samplesPerPixel: Math.max(G.SamplesPerPixel || 0, S.length),
          bitsPerSample: G.BitsPerSample || [8],
          sampleFormat: G.SampleFormat || null,
          photometricInterpretation: G.PhotometricInterpretation,
          colorMap: G.ColorMap || null,
          fileDirectory: G,
          hints: {
            ...this.channel ? { channel: this.channel } : {},
            ...F ? { tintRGB: F } : {},
            // Per-source format override. Deliberately `format`, not `formatResolved`:
            // the tile source does not own the plugin defaults, so the converter must
            // still merge this on top of them.
            ...this.format ? { format: this.format } : {}
          }
        });
        return this.options.logLatency && (typeof this.options.logLatency == "function" ? this.options.logLatency : console.log)(
          "Tile decode latency (ms):",
          Date.now() - D
        ), U;
      });
    }
  };
  /**
   * Create a shared GeoTIFF Pool for all GeoTIFFTileSources to use.
   *
   * If a shared pool is not created, every page of every GeoTIFF will create its own pool,
   * which can quickly lead to browser crashes.
   *
   * Created on first use: geotiff.js spawns its decoder workers in the Pool constructor,
   * and merely importing this library should not do that.
   *
   * @static sharedPool
   * @type {Pool}
   */
  ye(B, "_sharedPool", null), ye(B, "userDefinedImagesFilter", (c, l) => (typeof l.imagesFilter < "u" && l.imagesFilter && (Array.isArray(l.imagesFilter) ? c = c.filter((u, h) => l.imagesFilter.includes(h)) : typeof l.imagesFilter == "function" && (c = c.filter(l.imagesFilter)), l.imagesFilter = void 0), c));
  let E = B;
  E.openGeoTIFF = (f, c) => typeof Blob < "u" && f instanceof Blob ? MA(f, c) : s(f, c), t.GeoTIFFTileSource = E;
};
(function(t, e) {
  typeof exports > "u" || typeof t.OpenSeadragon < "u" && e(t.OpenSeadragon);
})(typeof window < "u" ? window : void 0, co);
class Co extends dA {
  decodeBlock(e) {
    return e;
  }
}
const Eo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Co
}, Symbol.toStringTag, { value: "Module" })), Dt = 9, Se = 256, Ve = 257, Qo = 12;
function ho(t, e, A) {
  const i = e % 8, n = Math.floor(e / 8), o = 8 - i, I = e + A - (n + 1) * 8;
  let s = 8 * (n + 2) - (e + A);
  const y = (n + 2) * 8 - e;
  if (s = Math.max(0, s), n >= t.length)
    return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"), Ve;
  let a = t[n] & 2 ** (8 - i) - 1;
  a <<= A - o;
  let r = a;
  if (n + 1 < t.length) {
    let g = t[n + 1] >>> s;
    g <<= Math.max(0, A - y), r += g;
  }
  if (I > 8 && n + 2 < t.length) {
    const g = (n + 3) * 8 - (e + A), E = t[n + 2] >>> g;
    r += E;
  }
  return r;
}
function Ge(t, e) {
  for (let A = e.length - 1; A >= 0; A--)
    t.push(e[A]);
  return t;
}
function uo(t) {
  const e = new Uint16Array(4093), A = new Uint8Array(4093);
  for (let f = 0; f <= 257; f++)
    e[f] = 4096, A[f] = f;
  let i = 258, n = Dt, o = 0;
  function I() {
    i = 258, n = Dt;
  }
  function s(f) {
    const c = ho(f, o, n);
    return o += n, c;
  }
  function y(f, c) {
    return A[i] = c, e[i] = f, i++, i - 1;
  }
  function a(f) {
    const c = [];
    for (let l = f; l !== 4096; l = e[l])
      c.push(A[l]);
    return c;
  }
  const r = [];
  I();
  const g = new Uint8Array(t);
  let E = s(g), B;
  for (; E !== Ve; ) {
    if (E === Se) {
      for (I(), E = s(g); E === Se; )
        E = s(g);
      if (E === Ve)
        break;
      if (E > Se)
        throw new Error(`corrupted code at scanline ${E}`);
      {
        const f = a(E);
        Ge(r, f), B = E;
      }
    } else if (E < i) {
      const f = a(E);
      Ge(r, f), y(B, f[f.length - 1]), B = E;
    } else {
      const f = a(B);
      if (!f)
        throw new Error(`Bogus entry. Not in dictionary, ${B} / ${i}, position: ${o}`);
      Ge(r, f), r.push(f[f.length - 1]), y(B, f[f.length - 1]), B = E;
    }
    i + 1 >= 2 ** n && (n === Qo ? B = void 0 : n++), E = s(g);
  }
  return new Uint8Array(r);
}
class wo extends dA {
  decodeBlock(e) {
    return uo(e).buffer;
  }
}
const yo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: wo
}, Symbol.toStringTag, { value: "Module" })), OA = new Int32Array([
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
]), Ae = 4017, ee = 799, te = 3406, ie = 2276, re = 1567, ne = 3784, xA = 5793, oe = 2896;
function mt(t, e) {
  let A = 0;
  const i = [];
  let n = 16;
  for (; n > 0 && !t[n - 1]; )
    --n;
  i.push({ children: [], index: 0 });
  let o = i[0], I;
  for (let s = 0; s < n; s++) {
    for (let y = 0; y < t[s]; y++) {
      for (o = i.pop(), o.children[o.index] = e[A]; o.index > 0; )
        o = i.pop();
      for (o.index++, i.push(o); i.length <= s; )
        i.push(I = { children: [], index: 0 }), o.children[o.index] = I.children, o = I;
      A++;
    }
    s + 1 < n && (i.push(I = { children: [], index: 0 }), o.children[o.index] = I.children, o = I);
  }
  return i[0].children;
}
function Do(t, e, A, i, n, o, I, s, y) {
  const { mcusPerLine: a, progressive: r } = A, g = e;
  let E = e, B = 0, f = 0;
  function c() {
    if (f > 0)
      return f--, B >> f & 1;
    if (B = t[E++], B === 255) {
      const q = t[E++];
      if (q)
        throw new Error(`unexpected marker: ${(B << 8 | q).toString(16)}`);
    }
    return f = 7, B >>> 7;
  }
  function l(q) {
    let T = q, O;
    for (; (O = c()) !== null; ) {
      if (T = T[O], typeof T == "number")
        return T;
      if (typeof T != "object")
        throw new Error("invalid huffman sequence");
    }
    return null;
  }
  function u(q) {
    let T = q, O = 0;
    for (; T > 0; ) {
      const J = c();
      if (J === null)
        return;
      O = O << 1 | J, --T;
    }
    return O;
  }
  function h(q) {
    const T = u(q);
    return T >= 1 << q - 1 ? T : T + (-1 << q) + 1;
  }
  function D(q, T) {
    const O = l(q.huffmanTableDC), J = O === 0 ? 0 : h(O);
    q.pred += J, T[0] = q.pred;
    let H = 1;
    for (; H < 64; ) {
      const P = l(q.huffmanTableAC), j = P & 15, V = P >> 4;
      if (j === 0) {
        if (V < 15)
          break;
        H += 16;
      } else {
        H += V;
        const W = OA[H];
        T[W] = h(j), H++;
      }
    }
  }
  function d(q, T) {
    const O = l(q.huffmanTableDC), J = O === 0 ? 0 : h(O) << y;
    q.pred += J, T[0] = q.pred;
  }
  function Q(q, T) {
    T[0] |= c() << y;
  }
  let C = 0;
  function w(q, T) {
    if (C > 0) {
      C--;
      return;
    }
    let O = o;
    const J = I;
    for (; O <= J; ) {
      const H = l(q.huffmanTableAC), P = H & 15, j = H >> 4;
      if (P === 0) {
        if (j < 15) {
          C = u(j) + (1 << j) - 1;
          break;
        }
        O += 16;
      } else {
        O += j;
        const V = OA[O];
        T[V] = h(P) * (1 << y), O++;
      }
    }
  }
  let m = 0, F;
  function k(q, T) {
    let O = o;
    const J = I;
    let H = 0;
    for (; O <= J; ) {
      const P = OA[O], j = T[P] < 0 ? -1 : 1;
      switch (m) {
        case 0: {
          const V = l(q.huffmanTableAC), W = V & 15;
          if (H = V >> 4, W === 0)
            H < 15 ? (C = u(H) + (1 << H), m = 4) : (H = 16, m = 1);
          else {
            if (W !== 1)
              throw new Error("invalid ACn encoding");
            F = h(W), m = H ? 2 : 3;
          }
          continue;
        }
        case 1:
        case 2:
          T[P] ? T[P] += (c() << y) * j : (H--, H === 0 && (m = m === 2 ? 3 : 0));
          break;
        case 3:
          T[P] ? T[P] += (c() << y) * j : (T[P] = F << y, m = 0);
          break;
        case 4:
          T[P] && (T[P] += (c() << y) * j);
          break;
      }
      O++;
    }
    m === 4 && (C--, C === 0 && (m = 0));
  }
  function p(q, T, O, J, H) {
    const P = O / a | 0, j = O % a, V = P * q.v + J, W = j * q.h + H;
    T(q, q.blocks[V][W]);
  }
  function x(q, T, O) {
    const J = O / q.blocksPerLine | 0, H = O % q.blocksPerLine;
    T(q, q.blocks[J][H]);
  }
  const b = i.length;
  let M, S, G, U, L, R;
  r ? o === 0 ? R = s === 0 ? d : Q : R = s === 0 ? w : k : R = D;
  let N = 0, v, Y;
  b === 1 ? Y = i[0].blocksPerLine * i[0].blocksPerColumn : Y = a * A.mcusPerColumn;
  const _ = n || Y;
  for (; N < Y; ) {
    for (S = 0; S < b; S++)
      i[S].pred = 0;
    if (C = 0, b === 1)
      for (M = i[0], L = 0; L < _; L++)
        x(M, R, N), N++;
    else
      for (L = 0; L < _; L++) {
        for (S = 0; S < b; S++) {
          M = i[S];
          const { h: q, v: T } = M;
          for (G = 0; G < T; G++)
            for (U = 0; U < q; U++)
              p(M, R, N, G, U);
        }
        if (N++, N === Y)
          break;
      }
    if (f = 0, v = t[E] << 8 | t[E + 1], v < 65280)
      throw new Error("marker was not found");
    if (v >= 65488 && v <= 65495)
      E += 2;
    else
      break;
  }
  return E - g;
}
function mo(t, e) {
  const A = [], { blocksPerLine: i, blocksPerColumn: n } = e, o = i << 3, I = new Int32Array(64), s = new Uint8Array(64);
  function y(a, r, g) {
    const E = e.quantizationTable;
    let B, f, c, l, u, h, D, d, Q;
    const C = g;
    let w;
    for (w = 0; w < 64; w++)
      C[w] = a[w] * E[w];
    for (w = 0; w < 8; ++w) {
      const m = 8 * w;
      if (C[1 + m] === 0 && C[2 + m] === 0 && C[3 + m] === 0 && C[4 + m] === 0 && C[5 + m] === 0 && C[6 + m] === 0 && C[7 + m] === 0) {
        Q = xA * C[0 + m] + 512 >> 10, C[0 + m] = Q, C[1 + m] = Q, C[2 + m] = Q, C[3 + m] = Q, C[4 + m] = Q, C[5 + m] = Q, C[6 + m] = Q, C[7 + m] = Q;
        continue;
      }
      B = xA * C[0 + m] + 128 >> 8, f = xA * C[4 + m] + 128 >> 8, c = C[2 + m], l = C[6 + m], u = oe * (C[1 + m] - C[7 + m]) + 128 >> 8, d = oe * (C[1 + m] + C[7 + m]) + 128 >> 8, h = C[3 + m] << 4, D = C[5 + m] << 4, Q = B - f + 1 >> 1, B = B + f + 1 >> 1, f = Q, Q = c * ne + l * re + 128 >> 8, c = c * re - l * ne + 128 >> 8, l = Q, Q = u - D + 1 >> 1, u = u + D + 1 >> 1, D = Q, Q = d + h + 1 >> 1, h = d - h + 1 >> 1, d = Q, Q = B - l + 1 >> 1, B = B + l + 1 >> 1, l = Q, Q = f - c + 1 >> 1, f = f + c + 1 >> 1, c = Q, Q = u * ie + d * te + 2048 >> 12, u = u * te - d * ie + 2048 >> 12, d = Q, Q = h * ee + D * Ae + 2048 >> 12, h = h * Ae - D * ee + 2048 >> 12, D = Q, C[0 + m] = B + d, C[7 + m] = B - d, C[1 + m] = f + D, C[6 + m] = f - D, C[2 + m] = c + h, C[5 + m] = c - h, C[3 + m] = l + u, C[4 + m] = l - u;
    }
    for (w = 0; w < 8; ++w) {
      const m = w;
      if (C[1 * 8 + m] === 0 && C[2 * 8 + m] === 0 && C[3 * 8 + m] === 0 && C[4 * 8 + m] === 0 && C[5 * 8 + m] === 0 && C[6 * 8 + m] === 0 && C[7 * 8 + m] === 0) {
        Q = xA * g[w + 0] + 8192 >> 14, C[0 * 8 + m] = Q, C[1 * 8 + m] = Q, C[2 * 8 + m] = Q, C[3 * 8 + m] = Q, C[4 * 8 + m] = Q, C[5 * 8 + m] = Q, C[6 * 8 + m] = Q, C[7 * 8 + m] = Q;
        continue;
      }
      B = xA * C[0 * 8 + m] + 2048 >> 12, f = xA * C[4 * 8 + m] + 2048 >> 12, c = C[2 * 8 + m], l = C[6 * 8 + m], u = oe * (C[1 * 8 + m] - C[7 * 8 + m]) + 2048 >> 12, d = oe * (C[1 * 8 + m] + C[7 * 8 + m]) + 2048 >> 12, h = C[3 * 8 + m], D = C[5 * 8 + m], Q = B - f + 1 >> 1, B = B + f + 1 >> 1, f = Q, Q = c * ne + l * re + 2048 >> 12, c = c * re - l * ne + 2048 >> 12, l = Q, Q = u - D + 1 >> 1, u = u + D + 1 >> 1, D = Q, Q = d + h + 1 >> 1, h = d - h + 1 >> 1, d = Q, Q = B - l + 1 >> 1, B = B + l + 1 >> 1, l = Q, Q = f - c + 1 >> 1, f = f + c + 1 >> 1, c = Q, Q = u * ie + d * te + 2048 >> 12, u = u * te - d * ie + 2048 >> 12, d = Q, Q = h * ee + D * Ae + 2048 >> 12, h = h * Ae - D * ee + 2048 >> 12, D = Q, C[0 * 8 + m] = B + d, C[7 * 8 + m] = B - d, C[1 * 8 + m] = f + D, C[6 * 8 + m] = f - D, C[2 * 8 + m] = c + h, C[5 * 8 + m] = c - h, C[3 * 8 + m] = l + u, C[4 * 8 + m] = l - u;
    }
    for (w = 0; w < 64; ++w) {
      const m = 128 + (C[w] + 8 >> 4);
      m < 0 ? r[w] = 0 : m > 255 ? r[w] = 255 : r[w] = m;
    }
  }
  for (let a = 0; a < n; a++) {
    const r = a << 3;
    for (let g = 0; g < 8; g++)
      A.push(new Uint8Array(o));
    for (let g = 0; g < i; g++) {
      y(e.blocks[a][g], s, I);
      let E = 0;
      const B = g << 3;
      for (let f = 0; f < 8; f++) {
        const c = A[r + f];
        for (let l = 0; l < 8; l++)
          c[B + l] = s[E++];
      }
    }
  }
  return A;
}
class po {
  constructor() {
    this.jfif = null, this.adobe = null, this.quantizationTables = [], this.huffmanTablesAC = [], this.huffmanTablesDC = [], this.resetFrames();
  }
  resetFrames() {
    this.frames = [];
  }
  parse(e) {
    let A = 0;
    function i() {
      const s = e[A] << 8 | e[A + 1];
      return A += 2, s;
    }
    function n() {
      const s = i(), y = e.subarray(A, A + s - 2);
      return A += y.length, y;
    }
    function o(s) {
      let y = 0, a = 0, r, g;
      for (g in s.components)
        s.components.hasOwnProperty(g) && (r = s.components[g], y < r.h && (y = r.h), a < r.v && (a = r.v));
      const E = Math.ceil(s.samplesPerLine / 8 / y), B = Math.ceil(s.scanLines / 8 / a);
      for (g in s.components)
        if (s.components.hasOwnProperty(g)) {
          r = s.components[g];
          const f = Math.ceil(Math.ceil(s.samplesPerLine / 8) * r.h / y), c = Math.ceil(Math.ceil(s.scanLines / 8) * r.v / a), l = E * r.h, u = B * r.v, h = [];
          for (let D = 0; D < u; D++) {
            const d = [];
            for (let Q = 0; Q < l; Q++)
              d.push(new Int32Array(64));
            h.push(d);
          }
          r.blocksPerLine = f, r.blocksPerColumn = c, r.blocks = h;
        }
      s.maxH = y, s.maxV = a, s.mcusPerLine = E, s.mcusPerColumn = B;
    }
    let I = i();
    if (I !== 65496)
      throw new Error("SOI not found");
    for (I = i(); I !== 65497; ) {
      switch (I) {
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
          const s = n();
          I === 65504 && s[0] === 74 && s[1] === 70 && s[2] === 73 && s[3] === 70 && s[4] === 0 && (this.jfif = {
            version: { major: s[5], minor: s[6] },
            densityUnits: s[7],
            xDensity: s[8] << 8 | s[9],
            yDensity: s[10] << 8 | s[11],
            thumbWidth: s[12],
            thumbHeight: s[13],
            thumbData: s.subarray(14, 14 + 3 * s[12] * s[13])
          }), I === 65518 && s[0] === 65 && s[1] === 100 && s[2] === 111 && s[3] === 98 && s[4] === 101 && s[5] === 0 && (this.adobe = {
            version: s[6],
            flags0: s[7] << 8 | s[8],
            flags1: s[9] << 8 | s[10],
            transformCode: s[11]
          });
          break;
        }
        case 65499: {
          const y = i() + A - 2;
          for (; A < y; ) {
            const a = e[A++], r = new Int32Array(64);
            if (a >> 4)
              if (a >> 4 === 1)
                for (let g = 0; g < 64; g++) {
                  const E = OA[g];
                  r[E] = i();
                }
              else
                throw new Error("DQT: invalid table spec");
            else for (let g = 0; g < 64; g++) {
              const E = OA[g];
              r[E] = e[A++];
            }
            this.quantizationTables[a & 15] = r;
          }
          break;
        }
        case 65472:
        case 65473:
        case 65474: {
          i();
          const s = {
            extended: I === 65473,
            progressive: I === 65474,
            precision: e[A++],
            scanLines: i(),
            samplesPerLine: i(),
            components: {},
            componentsOrder: []
          }, y = e[A++];
          let a;
          for (let r = 0; r < y; r++) {
            a = e[A];
            const g = e[A + 1] >> 4, E = e[A + 1] & 15, B = e[A + 2];
            s.componentsOrder.push(a), s.components[a] = {
              h: g,
              v: E,
              quantizationIdx: B
            }, A += 3;
          }
          o(s), this.frames.push(s);
          break;
        }
        case 65476: {
          const s = i();
          for (let y = 2; y < s; ) {
            const a = e[A++], r = new Uint8Array(16);
            let g = 0;
            for (let B = 0; B < 16; B++, A++)
              r[B] = e[A], g += r[B];
            const E = new Uint8Array(g);
            for (let B = 0; B < g; B++, A++)
              E[B] = e[A];
            y += 17 + g, a >> 4 ? this.huffmanTablesAC[a & 15] = mt(
              r,
              E
            ) : this.huffmanTablesDC[a & 15] = mt(
              r,
              E
            );
          }
          break;
        }
        case 65501:
          i(), this.resetInterval = i();
          break;
        case 65498: {
          i();
          const s = e[A++], y = [], a = this.frames[0];
          for (let f = 0; f < s; f++) {
            const c = a.components[e[A++]], l = e[A++];
            c.huffmanTableDC = this.huffmanTablesDC[l >> 4], c.huffmanTableAC = this.huffmanTablesAC[l & 15], y.push(c);
          }
          const r = e[A++], g = e[A++], E = e[A++], B = Do(
            e,
            A,
            a,
            y,
            this.resetInterval,
            r,
            g,
            E >> 4,
            E & 15
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
          throw new Error(`unknown JPEG marker ${I.toString(16)}`);
      }
      I = i();
    }
  }
  getResult() {
    const { frames: e } = this;
    if (this.frames.length === 0)
      throw new Error("no frames were decoded");
    this.frames.length > 1 && console.warn("more than one frame is not supported");
    for (let r = 0; r < this.frames.length; r++) {
      const g = this.frames[r].components;
      for (const E of Object.keys(g))
        g[E].quantizationTable = this.quantizationTables[g[E].quantizationIdx], delete g[E].quantizationIdx;
    }
    const A = e[0], { components: i, componentsOrder: n } = A, o = [], I = A.samplesPerLine, s = A.scanLines;
    for (let r = 0; r < n.length; r++) {
      const g = i[n[r]];
      o.push({
        lines: mo(A, g),
        scaleX: g.h / A.maxH,
        scaleY: g.v / A.maxV
      });
    }
    const y = new Uint8Array(I * s * o.length);
    let a = 0;
    for (let r = 0; r < s; ++r)
      for (let g = 0; g < I; ++g)
        for (let E = 0; E < o.length; ++E) {
          const B = o[E];
          y[a] = B.lines[0 | r * B.scaleY][0 | g * B.scaleX], ++a;
        }
    return y;
  }
}
class ko extends dA {
  constructor(e) {
    super(), this.reader = new po(), e.JPEGTables && this.reader.parse(e.JPEGTables);
  }
  decodeBlock(e) {
    return this.reader.resetFrames(), this.reader.parse(new Uint8Array(e)), this.reader.getResult().buffer;
  }
}
const Fo = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ko
}, Symbol.toStringTag, { value: "Module" }));
function qA(t) {
  let e = t.length;
  for (; --e >= 0; )
    t[e] = 0;
}
const So = 3, Go = 258, Ji = 29, xo = 256, bo = xo + 1 + Ji, Yi = 30, Ro = 512, vo = new Array((bo + 2) * 2);
qA(vo);
const Uo = new Array(Yi * 2);
qA(Uo);
const Lo = new Array(Ro);
qA(Lo);
const Mo = new Array(Go - So + 1);
qA(Mo);
const No = new Array(Ji);
qA(No);
const To = new Array(Yi);
qA(To);
const qo = (t, e, A, i) => {
  let n = t & 65535 | 0, o = t >>> 16 & 65535 | 0, I = 0;
  for (; A !== 0; ) {
    I = A > 2e3 ? 2e3 : A, A -= I;
    do
      n = n + e[i++] | 0, o = o + n | 0;
    while (--I);
    n %= 65521, o %= 65521;
  }
  return n | o << 16 | 0;
};
var je = qo;
const Jo = () => {
  let t, e = [];
  for (var A = 0; A < 256; A++) {
    t = A;
    for (var i = 0; i < 8; i++)
      t = t & 1 ? 3988292384 ^ t >>> 1 : t >>> 1;
    e[A] = t;
  }
  return e;
}, Yo = new Uint32Array(Jo()), Ho = (t, e, A, i) => {
  const n = Yo, o = i + A;
  t ^= -1;
  for (let I = i; I < o; I++)
    t = t >>> 8 ^ n[(t ^ e[I]) & 255];
  return t ^ -1;
};
var gA = Ho, Xe = {
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
}, Hi = {
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
const Oo = (t, e) => Object.prototype.hasOwnProperty.call(t, e);
var Ko = function(t) {
  const e = Array.prototype.slice.call(arguments, 1);
  for (; e.length; ) {
    const A = e.shift();
    if (A) {
      if (typeof A != "object")
        throw new TypeError(A + "must be non-object");
      for (const i in A)
        Oo(A, i) && (t[i] = A[i]);
    }
  }
  return t;
}, _o = (t) => {
  let e = 0;
  for (let i = 0, n = t.length; i < n; i++)
    e += t[i].length;
  const A = new Uint8Array(e);
  for (let i = 0, n = 0, o = t.length; i < o; i++) {
    let I = t[i];
    A.set(I, n), n += I.length;
  }
  return A;
}, Oi = {
  assign: Ko,
  flattenChunks: _o
};
let Ki = !0;
try {
  String.fromCharCode.apply(null, new Uint8Array(1));
} catch {
  Ki = !1;
}
const PA = new Uint8Array(256);
for (let t = 0; t < 256; t++)
  PA[t] = t >= 252 ? 6 : t >= 248 ? 5 : t >= 240 ? 4 : t >= 224 ? 3 : t >= 192 ? 2 : 1;
PA[254] = PA[254] = 1;
var Po = (t) => {
  if (typeof TextEncoder == "function" && TextEncoder.prototype.encode)
    return new TextEncoder().encode(t);
  let e, A, i, n, o, I = t.length, s = 0;
  for (n = 0; n < I; n++)
    A = t.charCodeAt(n), (A & 64512) === 55296 && n + 1 < I && (i = t.charCodeAt(n + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), n++)), s += A < 128 ? 1 : A < 2048 ? 2 : A < 65536 ? 3 : 4;
  for (e = new Uint8Array(s), o = 0, n = 0; o < s; n++)
    A = t.charCodeAt(n), (A & 64512) === 55296 && n + 1 < I && (i = t.charCodeAt(n + 1), (i & 64512) === 56320 && (A = 65536 + (A - 55296 << 10) + (i - 56320), n++)), A < 128 ? e[o++] = A : A < 2048 ? (e[o++] = 192 | A >>> 6, e[o++] = 128 | A & 63) : A < 65536 ? (e[o++] = 224 | A >>> 12, e[o++] = 128 | A >>> 6 & 63, e[o++] = 128 | A & 63) : (e[o++] = 240 | A >>> 18, e[o++] = 128 | A >>> 12 & 63, e[o++] = 128 | A >>> 6 & 63, e[o++] = 128 | A & 63);
  return e;
};
const Vo = (t, e) => {
  if (e < 65534 && t.subarray && Ki)
    return String.fromCharCode.apply(null, t.length === e ? t : t.subarray(0, e));
  let A = "";
  for (let i = 0; i < e; i++)
    A += String.fromCharCode(t[i]);
  return A;
};
var jo = (t, e) => {
  const A = e || t.length;
  if (typeof TextDecoder == "function" && TextDecoder.prototype.decode)
    return new TextDecoder().decode(t.subarray(0, e));
  let i, n;
  const o = new Array(A * 2);
  for (n = 0, i = 0; i < A; ) {
    let I = t[i++];
    if (I < 128) {
      o[n++] = I;
      continue;
    }
    let s = PA[I];
    if (s > 4) {
      o[n++] = 65533, i += s - 1;
      continue;
    }
    for (I &= s === 2 ? 31 : s === 3 ? 15 : 7; s > 1 && i < A; )
      I = I << 6 | t[i++] & 63, s--;
    if (s > 1) {
      o[n++] = 65533;
      continue;
    }
    I < 65536 ? o[n++] = I : (I -= 65536, o[n++] = 55296 | I >> 10 & 1023, o[n++] = 56320 | I & 1023);
  }
  return Vo(o, n);
}, Xo = (t, e) => {
  e = e || t.length, e > t.length && (e = t.length);
  let A = e - 1;
  for (; A >= 0 && (t[A] & 192) === 128; )
    A--;
  return A < 0 || A === 0 ? e : A + PA[t[A]] > e ? A : e;
}, We = {
  string2buf: Po,
  buf2string: jo,
  utf8border: Xo
};
function Wo() {
  this.input = null, this.next_in = 0, this.avail_in = 0, this.total_in = 0, this.output = null, this.next_out = 0, this.avail_out = 0, this.total_out = 0, this.msg = "", this.state = null, this.data_type = 2, this.adler = 0;
}
var Zo = Wo;
const ae = 16209, zo = 16191;
var $o = function(e, A) {
  let i, n, o, I, s, y, a, r, g, E, B, f, c, l, u, h, D, d, Q, C, w, m, F, k;
  const p = e.state;
  i = e.next_in, F = e.input, n = i + (e.avail_in - 5), o = e.next_out, k = e.output, I = o - (A - e.avail_out), s = o + (e.avail_out - 257), y = p.dmax, a = p.wsize, r = p.whave, g = p.wnext, E = p.window, B = p.hold, f = p.bits, c = p.lencode, l = p.distcode, u = (1 << p.lenbits) - 1, h = (1 << p.distbits) - 1;
  A:
    do {
      f < 15 && (B += F[i++] << f, f += 8, B += F[i++] << f, f += 8), D = c[B & u];
      e:
        for (; ; ) {
          if (d = D >>> 24, B >>>= d, f -= d, d = D >>> 16 & 255, d === 0)
            k[o++] = D & 65535;
          else if (d & 16) {
            Q = D & 65535, d &= 15, d && (f < d && (B += F[i++] << f, f += 8), Q += B & (1 << d) - 1, B >>>= d, f -= d), f < 15 && (B += F[i++] << f, f += 8, B += F[i++] << f, f += 8), D = l[B & h];
            t:
              for (; ; ) {
                if (d = D >>> 24, B >>>= d, f -= d, d = D >>> 16 & 255, d & 16) {
                  if (C = D & 65535, d &= 15, f < d && (B += F[i++] << f, f += 8, f < d && (B += F[i++] << f, f += 8)), C += B & (1 << d) - 1, C > y) {
                    e.msg = "invalid distance too far back", p.mode = ae;
                    break A;
                  }
                  if (B >>>= d, f -= d, d = o - I, C > d) {
                    if (d = C - d, d > r && p.sane) {
                      e.msg = "invalid distance too far back", p.mode = ae;
                      break A;
                    }
                    if (w = 0, m = E, g === 0) {
                      if (w += a - d, d < Q) {
                        Q -= d;
                        do
                          k[o++] = E[w++];
                        while (--d);
                        w = o - C, m = k;
                      }
                    } else if (g < d) {
                      if (w += a + g - d, d -= g, d < Q) {
                        Q -= d;
                        do
                          k[o++] = E[w++];
                        while (--d);
                        if (w = 0, g < Q) {
                          d = g, Q -= d;
                          do
                            k[o++] = E[w++];
                          while (--d);
                          w = o - C, m = k;
                        }
                      }
                    } else if (w += g - d, d < Q) {
                      Q -= d;
                      do
                        k[o++] = E[w++];
                      while (--d);
                      w = o - C, m = k;
                    }
                    for (; Q > 2; )
                      k[o++] = m[w++], k[o++] = m[w++], k[o++] = m[w++], Q -= 3;
                    Q && (k[o++] = m[w++], Q > 1 && (k[o++] = m[w++]));
                  } else {
                    w = o - C;
                    do
                      k[o++] = k[w++], k[o++] = k[w++], k[o++] = k[w++], Q -= 3;
                    while (Q > 2);
                    Q && (k[o++] = k[w++], Q > 1 && (k[o++] = k[w++]));
                  }
                } else if (d & 64) {
                  e.msg = "invalid distance code", p.mode = ae;
                  break A;
                } else {
                  D = l[(D & 65535) + (B & (1 << d) - 1)];
                  continue t;
                }
                break;
              }
          } else if (d & 64)
            if (d & 32) {
              p.mode = zo;
              break A;
            } else {
              e.msg = "invalid literal/length code", p.mode = ae;
              break A;
            }
          else {
            D = c[(D & 65535) + (B & (1 << d) - 1)];
            continue e;
          }
          break;
        }
    } while (i < n && o < s);
  Q = f >> 3, i -= Q, f -= Q << 3, B &= (1 << f) - 1, e.next_in = i, e.next_out = o, e.avail_in = i < n ? 5 + (n - i) : 5 - (i - n), e.avail_out = o < s ? 257 + (s - o) : 257 - (o - s), p.hold = B, p.bits = f;
};
const bA = 15, pt = 852, kt = 592, Ft = 0, xe = 1, St = 2, Aa = new Uint16Array([
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
]), ea = new Uint8Array([
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
]), ta = new Uint16Array([
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
]), ia = new Uint8Array([
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
]), ra = (t, e, A, i, n, o, I, s) => {
  const y = s.bits;
  let a = 0, r = 0, g = 0, E = 0, B = 0, f = 0, c = 0, l = 0, u = 0, h = 0, D, d, Q, C, w, m = null, F;
  const k = new Uint16Array(bA + 1), p = new Uint16Array(bA + 1);
  let x = null, b, M, S;
  for (a = 0; a <= bA; a++)
    k[a] = 0;
  for (r = 0; r < i; r++)
    k[e[A + r]]++;
  for (B = y, E = bA; E >= 1 && k[E] === 0; E--)
    ;
  if (B > E && (B = E), E === 0)
    return n[o++] = 1 << 24 | 64 << 16 | 0, n[o++] = 1 << 24 | 64 << 16 | 0, s.bits = 1, 0;
  for (g = 1; g < E && k[g] === 0; g++)
    ;
  for (B < g && (B = g), l = 1, a = 1; a <= bA; a++)
    if (l <<= 1, l -= k[a], l < 0)
      return -1;
  if (l > 0 && (t === Ft || E !== 1))
    return -1;
  for (p[1] = 0, a = 1; a < bA; a++)
    p[a + 1] = p[a] + k[a];
  for (r = 0; r < i; r++)
    e[A + r] !== 0 && (I[p[e[A + r]]++] = r);
  if (t === Ft ? (m = x = I, F = 20) : t === xe ? (m = Aa, x = ea, F = 257) : (m = ta, x = ia, F = 0), h = 0, r = 0, a = g, w = o, f = B, c = 0, Q = -1, u = 1 << B, C = u - 1, t === xe && u > pt || t === St && u > kt)
    return 1;
  for (; ; ) {
    b = a - c, I[r] + 1 < F ? (M = 0, S = I[r]) : I[r] >= F ? (M = x[I[r] - F], S = m[I[r] - F]) : (M = 96, S = 0), D = 1 << a - c, d = 1 << f, g = d;
    do
      d -= D, n[w + (h >> c) + d] = b << 24 | M << 16 | S | 0;
    while (d !== 0);
    for (D = 1 << a - 1; h & D; )
      D >>= 1;
    if (D !== 0 ? (h &= D - 1, h += D) : h = 0, r++, --k[a] === 0) {
      if (a === E)
        break;
      a = e[A + I[r]];
    }
    if (a > B && (h & C) !== Q) {
      for (c === 0 && (c = B), w += g, f = a - c, l = 1 << f; f + c < E && (l -= k[f + c], !(l <= 0)); )
        f++, l <<= 1;
      if (u += 1 << f, t === xe && u > pt || t === St && u > kt)
        return 1;
      Q = h & C, n[Q] = B << 24 | f << 16 | w - o | 0;
    }
  }
  return h !== 0 && (n[w + h] = a - c << 24 | 64 << 16 | 0), s.bits = B, 0;
};
var KA = ra;
const na = 0, _i = 1, Pi = 2, {
  Z_FINISH: Gt,
  Z_BLOCK: oa,
  Z_TREES: se,
  Z_OK: FA,
  Z_STREAM_END: aa,
  Z_NEED_DICT: sa,
  Z_STREAM_ERROR: iA,
  Z_DATA_ERROR: Vi,
  Z_MEM_ERROR: ji,
  Z_BUF_ERROR: ga,
  Z_DEFLATED: xt
} = Hi, ue = 16180, bt = 16181, Rt = 16182, vt = 16183, Ut = 16184, Lt = 16185, Mt = 16186, Nt = 16187, Tt = 16188, qt = 16189, Ce = 16190, BA = 16191, be = 16192, Jt = 16193, Re = 16194, Yt = 16195, Ht = 16196, Ot = 16197, Kt = 16198, ge = 16199, Ie = 16200, _t = 16201, Pt = 16202, Vt = 16203, jt = 16204, Xt = 16205, ve = 16206, Wt = 16207, Zt = 16208, X = 16209, Xi = 16210, Wi = 16211, Ia = 852, Ba = 592, la = 15, fa = la, zt = (t) => (t >>> 24 & 255) + (t >>> 8 & 65280) + ((t & 65280) << 8) + ((t & 255) << 24);
function ca() {
  this.strm = null, this.mode = 0, this.last = !1, this.wrap = 0, this.havedict = !1, this.flags = 0, this.dmax = 0, this.check = 0, this.total = 0, this.head = null, this.wbits = 0, this.wsize = 0, this.whave = 0, this.wnext = 0, this.window = null, this.hold = 0, this.bits = 0, this.length = 0, this.offset = 0, this.extra = 0, this.lencode = null, this.distcode = null, this.lenbits = 0, this.distbits = 0, this.ncode = 0, this.nlen = 0, this.ndist = 0, this.have = 0, this.next = null, this.lens = new Uint16Array(320), this.work = new Uint16Array(288), this.lendyn = null, this.distdyn = null, this.sane = 0, this.back = 0, this.was = 0;
}
const SA = (t) => {
  if (!t)
    return 1;
  const e = t.state;
  return !e || e.strm !== t || e.mode < ue || e.mode > Wi ? 1 : 0;
}, Zi = (t) => {
  if (SA(t))
    return iA;
  const e = t.state;
  return t.total_in = t.total_out = e.total = 0, t.msg = "", e.wrap && (t.adler = e.wrap & 1), e.mode = ue, e.last = 0, e.havedict = 0, e.flags = -1, e.dmax = 32768, e.head = null, e.hold = 0, e.bits = 0, e.lencode = e.lendyn = new Int32Array(Ia), e.distcode = e.distdyn = new Int32Array(Ba), e.sane = 1, e.back = -1, FA;
}, zi = (t) => {
  if (SA(t))
    return iA;
  const e = t.state;
  return e.wsize = 0, e.whave = 0, e.wnext = 0, Zi(t);
}, $i = (t, e) => {
  let A;
  if (SA(t))
    return iA;
  const i = t.state;
  return e < 0 ? (A = 0, e = -e) : (A = (e >> 4) + 5, e < 48 && (e &= 15)), e && (e < 8 || e > 15) ? iA : (i.window !== null && i.wbits !== e && (i.window = null), i.wrap = A, i.wbits = e, zi(t));
}, Ar = (t, e) => {
  if (!t)
    return iA;
  const A = new ca();
  t.state = A, A.strm = t, A.window = null, A.mode = ue;
  const i = $i(t, e);
  return i !== FA && (t.state = null), i;
}, Ca = (t) => Ar(t, fa);
let $t = !0, Ue, Le;
const Ea = (t) => {
  if ($t) {
    Ue = new Int32Array(512), Le = new Int32Array(32);
    let e = 0;
    for (; e < 144; )
      t.lens[e++] = 8;
    for (; e < 256; )
      t.lens[e++] = 9;
    for (; e < 280; )
      t.lens[e++] = 7;
    for (; e < 288; )
      t.lens[e++] = 8;
    for (KA(_i, t.lens, 0, 288, Ue, 0, t.work, { bits: 9 }), e = 0; e < 32; )
      t.lens[e++] = 5;
    KA(Pi, t.lens, 0, 32, Le, 0, t.work, { bits: 5 }), $t = !1;
  }
  t.lencode = Ue, t.lenbits = 9, t.distcode = Le, t.distbits = 5;
}, er = (t, e, A, i) => {
  let n;
  const o = t.state;
  return o.window === null && (o.wsize = 1 << o.wbits, o.wnext = 0, o.whave = 0, o.window = new Uint8Array(o.wsize)), i >= o.wsize ? (o.window.set(e.subarray(A - o.wsize, A), 0), o.wnext = 0, o.whave = o.wsize) : (n = o.wsize - o.wnext, n > i && (n = i), o.window.set(e.subarray(A - i, A - i + n), o.wnext), i -= n, i ? (o.window.set(e.subarray(A - i, A), 0), o.wnext = i, o.whave = o.wsize) : (o.wnext += n, o.wnext === o.wsize && (o.wnext = 0), o.whave < o.wsize && (o.whave += n))), 0;
}, Qa = (t, e) => {
  let A, i, n, o, I, s, y, a, r, g, E, B, f, c, l = 0, u, h, D, d, Q, C, w, m;
  const F = new Uint8Array(4);
  let k, p;
  const x = (
    /* permutation of code lengths */
    new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15])
  );
  if (SA(t) || !t.output || !t.input && t.avail_in !== 0)
    return iA;
  A = t.state, A.mode === BA && (A.mode = be), I = t.next_out, n = t.output, y = t.avail_out, o = t.next_in, i = t.input, s = t.avail_in, a = A.hold, r = A.bits, g = s, E = y, m = FA;
  A:
    for (; ; )
      switch (A.mode) {
        case ue:
          if (A.wrap === 0) {
            A.mode = be;
            break;
          }
          for (; r < 16; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if (A.wrap & 2 && a === 35615) {
            A.wbits === 0 && (A.wbits = 15), A.check = 0, F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = gA(A.check, F, 2, 0), a = 0, r = 0, A.mode = bt;
            break;
          }
          if (A.head && (A.head.done = !1), !(A.wrap & 1) || /* check if zlib header allowed */
          (((a & 255) << 8) + (a >> 8)) % 31) {
            t.msg = "incorrect header check", A.mode = X;
            break;
          }
          if ((a & 15) !== xt) {
            t.msg = "unknown compression method", A.mode = X;
            break;
          }
          if (a >>>= 4, r -= 4, w = (a & 15) + 8, A.wbits === 0 && (A.wbits = w), w > 15 || w > A.wbits) {
            t.msg = "invalid window size", A.mode = X;
            break;
          }
          A.dmax = 1 << A.wbits, A.flags = 0, t.adler = A.check = 1, A.mode = a & 512 ? qt : BA, a = 0, r = 0;
          break;
        case bt:
          for (; r < 16; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if (A.flags = a, (A.flags & 255) !== xt) {
            t.msg = "unknown compression method", A.mode = X;
            break;
          }
          if (A.flags & 57344) {
            t.msg = "unknown header flags set", A.mode = X;
            break;
          }
          A.head && (A.head.text = a >> 8 & 1), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = gA(A.check, F, 2, 0)), a = 0, r = 0, A.mode = Rt;
        case Rt:
          for (; r < 32; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          A.head && (A.head.time = a), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, F[2] = a >>> 16 & 255, F[3] = a >>> 24 & 255, A.check = gA(A.check, F, 4, 0)), a = 0, r = 0, A.mode = vt;
        case vt:
          for (; r < 16; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          A.head && (A.head.xflags = a & 255, A.head.os = a >> 8), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = gA(A.check, F, 2, 0)), a = 0, r = 0, A.mode = Ut;
        case Ut:
          if (A.flags & 1024) {
            for (; r < 16; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            A.length = a, A.head && (A.head.extra_len = a), A.flags & 512 && A.wrap & 4 && (F[0] = a & 255, F[1] = a >>> 8 & 255, A.check = gA(A.check, F, 2, 0)), a = 0, r = 0;
          } else A.head && (A.head.extra = null);
          A.mode = Lt;
        case Lt:
          if (A.flags & 1024 && (B = A.length, B > s && (B = s), B && (A.head && (w = A.head.extra_len - A.length, A.head.extra || (A.head.extra = new Uint8Array(A.head.extra_len)), A.head.extra.set(
            i.subarray(
              o,
              // extra field is limited to 65536 bytes
              // - no need for additional size check
              o + B
            ),
            /*len + copy > state.head.extra_max - len ? state.head.extra_max : copy,*/
            w
          )), A.flags & 512 && A.wrap & 4 && (A.check = gA(A.check, i, B, o)), s -= B, o += B, A.length -= B), A.length))
            break A;
          A.length = 0, A.mode = Mt;
        case Mt:
          if (A.flags & 2048) {
            if (s === 0)
              break A;
            B = 0;
            do
              w = i[o + B++], A.head && w && A.length < 65536 && (A.head.name += String.fromCharCode(w));
            while (w && B < s);
            if (A.flags & 512 && A.wrap & 4 && (A.check = gA(A.check, i, B, o)), s -= B, o += B, w)
              break A;
          } else A.head && (A.head.name = null);
          A.length = 0, A.mode = Nt;
        case Nt:
          if (A.flags & 4096) {
            if (s === 0)
              break A;
            B = 0;
            do
              w = i[o + B++], A.head && w && A.length < 65536 && (A.head.comment += String.fromCharCode(w));
            while (w && B < s);
            if (A.flags & 512 && A.wrap & 4 && (A.check = gA(A.check, i, B, o)), s -= B, o += B, w)
              break A;
          } else A.head && (A.head.comment = null);
          A.mode = Tt;
        case Tt:
          if (A.flags & 512) {
            for (; r < 16; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.check & 65535)) {
              t.msg = "header crc mismatch", A.mode = X;
              break;
            }
            a = 0, r = 0;
          }
          A.head && (A.head.hcrc = A.flags >> 9 & 1, A.head.done = !0), t.adler = A.check = 0, A.mode = BA;
          break;
        case qt:
          for (; r < 32; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          t.adler = A.check = zt(a), a = 0, r = 0, A.mode = Ce;
        case Ce:
          if (A.havedict === 0)
            return t.next_out = I, t.avail_out = y, t.next_in = o, t.avail_in = s, A.hold = a, A.bits = r, sa;
          t.adler = A.check = 1, A.mode = BA;
        case BA:
          if (e === oa || e === se)
            break A;
        case be:
          if (A.last) {
            a >>>= r & 7, r -= r & 7, A.mode = ve;
            break;
          }
          for (; r < 3; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          switch (A.last = a & 1, a >>>= 1, r -= 1, a & 3) {
            case 0:
              A.mode = Jt;
              break;
            case 1:
              if (Ea(A), A.mode = ge, e === se) {
                a >>>= 2, r -= 2;
                break A;
              }
              break;
            case 2:
              A.mode = Ht;
              break;
            case 3:
              t.msg = "invalid block type", A.mode = X;
          }
          a >>>= 2, r -= 2;
          break;
        case Jt:
          for (a >>>= r & 7, r -= r & 7; r < 32; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if ((a & 65535) !== (a >>> 16 ^ 65535)) {
            t.msg = "invalid stored block lengths", A.mode = X;
            break;
          }
          if (A.length = a & 65535, a = 0, r = 0, A.mode = Re, e === se)
            break A;
        case Re:
          A.mode = Yt;
        case Yt:
          if (B = A.length, B) {
            if (B > s && (B = s), B > y && (B = y), B === 0)
              break A;
            n.set(i.subarray(o, o + B), I), s -= B, o += B, y -= B, I += B, A.length -= B;
            break;
          }
          A.mode = BA;
          break;
        case Ht:
          for (; r < 14; ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if (A.nlen = (a & 31) + 257, a >>>= 5, r -= 5, A.ndist = (a & 31) + 1, a >>>= 5, r -= 5, A.ncode = (a & 15) + 4, a >>>= 4, r -= 4, A.nlen > 286 || A.ndist > 30) {
            t.msg = "too many length or distance symbols", A.mode = X;
            break;
          }
          A.have = 0, A.mode = Ot;
        case Ot:
          for (; A.have < A.ncode; ) {
            for (; r < 3; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            A.lens[x[A.have++]] = a & 7, a >>>= 3, r -= 3;
          }
          for (; A.have < 19; )
            A.lens[x[A.have++]] = 0;
          if (A.lencode = A.lendyn, A.lenbits = 7, k = { bits: A.lenbits }, m = KA(na, A.lens, 0, 19, A.lencode, 0, A.work, k), A.lenbits = k.bits, m) {
            t.msg = "invalid code lengths set", A.mode = X;
            break;
          }
          A.have = 0, A.mode = Kt;
        case Kt:
          for (; A.have < A.nlen + A.ndist; ) {
            for (; l = A.lencode[a & (1 << A.lenbits) - 1], u = l >>> 24, h = l >>> 16 & 255, D = l & 65535, !(u <= r); ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            if (D < 16)
              a >>>= u, r -= u, A.lens[A.have++] = D;
            else {
              if (D === 16) {
                for (p = u + 2; r < p; ) {
                  if (s === 0)
                    break A;
                  s--, a += i[o++] << r, r += 8;
                }
                if (a >>>= u, r -= u, A.have === 0) {
                  t.msg = "invalid bit length repeat", A.mode = X;
                  break;
                }
                w = A.lens[A.have - 1], B = 3 + (a & 3), a >>>= 2, r -= 2;
              } else if (D === 17) {
                for (p = u + 3; r < p; ) {
                  if (s === 0)
                    break A;
                  s--, a += i[o++] << r, r += 8;
                }
                a >>>= u, r -= u, w = 0, B = 3 + (a & 7), a >>>= 3, r -= 3;
              } else {
                for (p = u + 7; r < p; ) {
                  if (s === 0)
                    break A;
                  s--, a += i[o++] << r, r += 8;
                }
                a >>>= u, r -= u, w = 0, B = 11 + (a & 127), a >>>= 7, r -= 7;
              }
              if (A.have + B > A.nlen + A.ndist) {
                t.msg = "invalid bit length repeat", A.mode = X;
                break;
              }
              for (; B--; )
                A.lens[A.have++] = w;
            }
          }
          if (A.mode === X)
            break;
          if (A.lens[256] === 0) {
            t.msg = "invalid code -- missing end-of-block", A.mode = X;
            break;
          }
          if (A.lenbits = 9, k = { bits: A.lenbits }, m = KA(_i, A.lens, 0, A.nlen, A.lencode, 0, A.work, k), A.lenbits = k.bits, m) {
            t.msg = "invalid literal/lengths set", A.mode = X;
            break;
          }
          if (A.distbits = 6, A.distcode = A.distdyn, k = { bits: A.distbits }, m = KA(Pi, A.lens, A.nlen, A.ndist, A.distcode, 0, A.work, k), A.distbits = k.bits, m) {
            t.msg = "invalid distances set", A.mode = X;
            break;
          }
          if (A.mode = ge, e === se)
            break A;
        case ge:
          A.mode = Ie;
        case Ie:
          if (s >= 6 && y >= 258) {
            t.next_out = I, t.avail_out = y, t.next_in = o, t.avail_in = s, A.hold = a, A.bits = r, $o(t, E), I = t.next_out, n = t.output, y = t.avail_out, o = t.next_in, i = t.input, s = t.avail_in, a = A.hold, r = A.bits, A.mode === BA && (A.back = -1);
            break;
          }
          for (A.back = 0; l = A.lencode[a & (1 << A.lenbits) - 1], u = l >>> 24, h = l >>> 16 & 255, D = l & 65535, !(u <= r); ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if (h && !(h & 240)) {
            for (d = u, Q = h, C = D; l = A.lencode[C + ((a & (1 << d + Q) - 1) >> d)], u = l >>> 24, h = l >>> 16 & 255, D = l & 65535, !(d + u <= r); ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            a >>>= d, r -= d, A.back += d;
          }
          if (a >>>= u, r -= u, A.back += u, A.length = D, h === 0) {
            A.mode = Xt;
            break;
          }
          if (h & 32) {
            A.back = -1, A.mode = BA;
            break;
          }
          if (h & 64) {
            t.msg = "invalid literal/length code", A.mode = X;
            break;
          }
          A.extra = h & 15, A.mode = _t;
        case _t:
          if (A.extra) {
            for (p = A.extra; r < p; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            A.length += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          A.was = A.length, A.mode = Pt;
        case Pt:
          for (; l = A.distcode[a & (1 << A.distbits) - 1], u = l >>> 24, h = l >>> 16 & 255, D = l & 65535, !(u <= r); ) {
            if (s === 0)
              break A;
            s--, a += i[o++] << r, r += 8;
          }
          if (!(h & 240)) {
            for (d = u, Q = h, C = D; l = A.distcode[C + ((a & (1 << d + Q) - 1) >> d)], u = l >>> 24, h = l >>> 16 & 255, D = l & 65535, !(d + u <= r); ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            a >>>= d, r -= d, A.back += d;
          }
          if (a >>>= u, r -= u, A.back += u, h & 64) {
            t.msg = "invalid distance code", A.mode = X;
            break;
          }
          A.offset = D, A.extra = h & 15, A.mode = Vt;
        case Vt:
          if (A.extra) {
            for (p = A.extra; r < p; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            A.offset += a & (1 << A.extra) - 1, a >>>= A.extra, r -= A.extra, A.back += A.extra;
          }
          if (A.offset > A.dmax) {
            t.msg = "invalid distance too far back", A.mode = X;
            break;
          }
          A.mode = jt;
        case jt:
          if (y === 0)
            break A;
          if (B = E - y, A.offset > B) {
            if (B = A.offset - B, B > A.whave && A.sane) {
              t.msg = "invalid distance too far back", A.mode = X;
              break;
            }
            B > A.wnext ? (B -= A.wnext, f = A.wsize - B) : f = A.wnext - B, B > A.length && (B = A.length), c = A.window;
          } else
            c = n, f = I - A.offset, B = A.length;
          B > y && (B = y), y -= B, A.length -= B;
          do
            n[I++] = c[f++];
          while (--B);
          A.length === 0 && (A.mode = Ie);
          break;
        case Xt:
          if (y === 0)
            break A;
          n[I++] = A.length, y--, A.mode = Ie;
          break;
        case ve:
          if (A.wrap) {
            for (; r < 32; ) {
              if (s === 0)
                break A;
              s--, a |= i[o++] << r, r += 8;
            }
            if (E -= y, t.total_out += E, A.total += E, A.wrap & 4 && E && (t.adler = A.check = /*UPDATE_CHECK(state.check, put - _out, _out);*/
            A.flags ? gA(A.check, n, E, I - E) : je(A.check, n, E, I - E)), E = y, A.wrap & 4 && (A.flags ? a : zt(a)) !== A.check) {
              t.msg = "incorrect data check", A.mode = X;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = Wt;
        case Wt:
          if (A.wrap && A.flags) {
            for (; r < 32; ) {
              if (s === 0)
                break A;
              s--, a += i[o++] << r, r += 8;
            }
            if (A.wrap & 4 && a !== (A.total & 4294967295)) {
              t.msg = "incorrect length check", A.mode = X;
              break;
            }
            a = 0, r = 0;
          }
          A.mode = Zt;
        case Zt:
          m = aa;
          break A;
        case X:
          m = Vi;
          break A;
        case Xi:
          return ji;
        case Wi:
        default:
          return iA;
      }
  return t.next_out = I, t.avail_out = y, t.next_in = o, t.avail_in = s, A.hold = a, A.bits = r, (A.wsize || E !== t.avail_out && A.mode < X && (A.mode < ve || e !== Gt)) && er(t, t.output, t.next_out, E - t.avail_out), g -= t.avail_in, E -= t.avail_out, t.total_in += g, t.total_out += E, A.total += E, A.wrap & 4 && E && (t.adler = A.check = /*UPDATE_CHECK(state.check, strm.next_out - _out, _out);*/
  A.flags ? gA(A.check, n, E, t.next_out - E) : je(A.check, n, E, t.next_out - E)), t.data_type = A.bits + (A.last ? 64 : 0) + (A.mode === BA ? 128 : 0) + (A.mode === ge || A.mode === Re ? 256 : 0), (g === 0 && E === 0 || e === Gt) && m === FA && (m = ga), m;
}, ha = (t) => {
  if (SA(t))
    return iA;
  let e = t.state;
  return e.window && (e.window = null), t.state = null, FA;
}, ua = (t, e) => {
  if (SA(t))
    return iA;
  const A = t.state;
  return A.wrap & 2 ? (A.head = e, e.done = !1, FA) : iA;
}, da = (t, e) => {
  const A = e.length;
  let i, n, o;
  return SA(t) || (i = t.state, i.wrap !== 0 && i.mode !== Ce) ? iA : i.mode === Ce && (n = 1, n = je(n, e, A, 0), n !== i.check) ? Vi : (o = er(t, e, A, A), o ? (i.mode = Xi, ji) : (i.havedict = 1, FA));
};
var wa = zi, ya = $i, Da = Zi, ma = Ca, pa = Ar, ka = Qa, Fa = ha, Sa = ua, Ga = da, xa = "pako inflate (from Nodeca project)", cA = {
  inflateReset: wa,
  inflateReset2: ya,
  inflateResetKeep: Da,
  inflateInit: ma,
  inflateInit2: pa,
  inflate: ka,
  inflateEnd: Fa,
  inflateGetHeader: Sa,
  inflateSetDictionary: Ga,
  inflateInfo: xa
};
function ba() {
  this.text = 0, this.time = 0, this.xflags = 0, this.os = 0, this.extra = null, this.extra_len = 0, this.name = "", this.comment = "", this.hcrc = 0, this.done = !1;
}
var Ra = ba;
const tr = Object.prototype.toString, {
  Z_NO_FLUSH: va,
  Z_FINISH: Ua,
  Z_OK: VA,
  Z_STREAM_END: Me,
  Z_NEED_DICT: Ne,
  Z_STREAM_ERROR: La,
  Z_DATA_ERROR: Ai,
  Z_MEM_ERROR: Ma
} = Hi;
function de(t) {
  this.options = Oi.assign({
    chunkSize: 1024 * 64,
    windowBits: 15,
    to: ""
  }, t || {});
  const e = this.options;
  e.raw && e.windowBits >= 0 && e.windowBits < 16 && (e.windowBits = -e.windowBits, e.windowBits === 0 && (e.windowBits = -15)), e.windowBits >= 0 && e.windowBits < 16 && !(t && t.windowBits) && (e.windowBits += 32), e.windowBits > 15 && e.windowBits < 48 && (e.windowBits & 15 || (e.windowBits |= 15)), this.err = 0, this.msg = "", this.ended = !1, this.chunks = [], this.strm = new Zo(), this.strm.avail_out = 0;
  let A = cA.inflateInit2(
    this.strm,
    e.windowBits
  );
  if (A !== VA)
    throw new Error(Xe[A]);
  if (this.header = new Ra(), cA.inflateGetHeader(this.strm, this.header), e.dictionary && (typeof e.dictionary == "string" ? e.dictionary = We.string2buf(e.dictionary) : tr.call(e.dictionary) === "[object ArrayBuffer]" && (e.dictionary = new Uint8Array(e.dictionary)), e.raw && (A = cA.inflateSetDictionary(this.strm, e.dictionary), A !== VA)))
    throw new Error(Xe[A]);
}
de.prototype.push = function(t, e) {
  const A = this.strm, i = this.options.chunkSize, n = this.options.dictionary;
  let o, I, s;
  if (this.ended) return !1;
  for (e === ~~e ? I = e : I = e === !0 ? Ua : va, tr.call(t) === "[object ArrayBuffer]" ? A.input = new Uint8Array(t) : A.input = t, A.next_in = 0, A.avail_in = A.input.length; ; ) {
    for (A.avail_out === 0 && (A.output = new Uint8Array(i), A.next_out = 0, A.avail_out = i), o = cA.inflate(A, I), o === Ne && n && (o = cA.inflateSetDictionary(A, n), o === VA ? o = cA.inflate(A, I) : o === Ai && (o = Ne)); A.avail_in > 0 && o === Me && A.state.wrap > 0 && t[A.next_in] !== 0; )
      cA.inflateReset(A), o = cA.inflate(A, I);
    switch (o) {
      case La:
      case Ai:
      case Ne:
      case Ma:
        return this.onEnd(o), this.ended = !0, !1;
    }
    if (s = A.avail_out, A.next_out && (A.avail_out === 0 || o === Me))
      if (this.options.to === "string") {
        let y = We.utf8border(A.output, A.next_out), a = A.next_out - y, r = We.buf2string(A.output, y);
        A.next_out = a, A.avail_out = i - a, a && A.output.set(A.output.subarray(y, y + a), 0), this.onData(r);
      } else
        this.onData(A.output.length === A.next_out ? A.output : A.output.subarray(0, A.next_out));
    if (!(o === VA && s === 0)) {
      if (o === Me)
        return o = cA.inflateEnd(this.strm), this.onEnd(o), this.ended = !0, !0;
      if (A.avail_in === 0) break;
    }
  }
  return !0;
};
de.prototype.onData = function(t) {
  this.chunks.push(t);
};
de.prototype.onEnd = function(t) {
  t === VA && (this.options.to === "string" ? this.result = this.chunks.join("") : this.result = Oi.flattenChunks(this.chunks)), this.chunks = [], this.err = t, this.msg = this.strm.msg;
};
function Na(t, e) {
  const A = new de(e);
  if (A.push(t), A.err) throw A.msg || Xe[A.err];
  return A.result;
}
var Ta = Na, qa = {
  inflate: Ta
};
const { inflate: Ja } = qa;
var ir = Ja;
class Ya extends dA {
  decodeBlock(e) {
    return ir(new Uint8Array(e)).buffer;
  }
}
const Ha = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Ya
}, Symbol.toStringTag, { value: "Module" }));
class Oa extends dA {
  decodeBlock(e) {
    const A = new DataView(e), i = [];
    for (let n = 0; n < e.byteLength; ++n) {
      let o = A.getInt8(n);
      if (o < 0) {
        const I = A.getUint8(n + 1);
        o = -o;
        for (let s = 0; s <= o; ++s)
          i.push(I);
        n += 1;
      } else {
        for (let I = 0; I <= o; ++I)
          i.push(A.getUint8(n + I + 1));
        n += o + 1;
      }
    }
    return new Uint8Array(i).buffer;
  }
}
const Ka = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Oa
}, Symbol.toStringTag, { value: "Module" }));
var rr = { exports: {} };
(function(t) {
  /* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */
  (function() {
    var e = function() {
      var o = {};
      o.defaultNoDataValue = -34027999387901484e22, o.decode = function(g, E) {
        E = E || {};
        var B = E.encodedMaskData || E.encodedMaskData === null, f = a(g, E.inputOffset || 0, B), c = E.noDataValue !== null ? E.noDataValue : o.defaultNoDataValue, l = I(
          f,
          E.pixelType || Float32Array,
          E.encodedMaskData,
          c,
          E.returnMask
        ), u = {
          width: f.width,
          height: f.height,
          pixelData: l.resultPixels,
          minValue: l.minValue,
          maxValue: f.pixels.maxValue,
          noDataValue: c
        };
        return l.resultMask && (u.maskData = l.resultMask), E.returnEncodedMask && f.mask && (u.encodedMaskData = f.mask.bitset ? f.mask.bitset : null), E.returnFileInfo && (u.fileInfo = s(f), E.computeUsedBitDepths && (u.fileInfo.bitDepths = y(f))), u;
      };
      var I = function(g, E, B, f, c) {
        var l = 0, u = g.pixels.numBlocksX, h = g.pixels.numBlocksY, D = Math.floor(g.width / u), d = Math.floor(g.height / h), Q = 2 * g.maxZError, C = Number.MAX_VALUE, w;
        B = B || (g.mask ? g.mask.bitset : null);
        var m, F;
        m = new E(g.width * g.height), c && B && (F = new Uint8Array(g.width * g.height));
        for (var k = new Float32Array(D * d), p, x, b = 0; b <= h; b++) {
          var M = b !== h ? d : g.height % h;
          if (M !== 0)
            for (var S = 0; S <= u; S++) {
              var G = S !== u ? D : g.width % u;
              if (G !== 0) {
                var U = b * g.width * d + S * D, L = g.width - G, R = g.pixels.blocks[l], N, v, Y;
                R.encoding < 2 ? (R.encoding === 0 ? N = R.rawData : (r(R.stuffedData, R.bitsPerPixel, R.numValidPixels, R.offset, Q, k, g.pixels.maxValue), N = k), v = 0) : R.encoding === 2 ? Y = 0 : Y = R.offset;
                var _;
                if (B)
                  for (x = 0; x < M; x++) {
                    for (U & 7 && (_ = B[U >> 3], _ <<= U & 7), p = 0; p < G; p++)
                      U & 7 || (_ = B[U >> 3]), _ & 128 ? (F && (F[U] = 1), w = R.encoding < 2 ? N[v++] : Y, C = C > w ? w : C, m[U++] = w) : (F && (F[U] = 0), m[U++] = f), _ <<= 1;
                    U += L;
                  }
                else if (R.encoding < 2)
                  for (x = 0; x < M; x++) {
                    for (p = 0; p < G; p++)
                      w = N[v++], C = C > w ? w : C, m[U++] = w;
                    U += L;
                  }
                else
                  for (C = C > Y ? Y : C, x = 0; x < M; x++) {
                    for (p = 0; p < G; p++)
                      m[U++] = Y;
                    U += L;
                  }
                if (R.encoding === 1 && v !== R.numValidPixels)
                  throw "Block and Mask do not match";
                l++;
              }
            }
        }
        return {
          resultPixels: m,
          resultMask: F,
          minValue: C
        };
      }, s = function(g) {
        return {
          fileIdentifierString: g.fileIdentifierString,
          fileVersion: g.fileVersion,
          imageType: g.imageType,
          height: g.height,
          width: g.width,
          maxZError: g.maxZError,
          eofOffset: g.eofOffset,
          mask: g.mask ? {
            numBlocksX: g.mask.numBlocksX,
            numBlocksY: g.mask.numBlocksY,
            numBytes: g.mask.numBytes,
            maxValue: g.mask.maxValue
          } : null,
          pixels: {
            numBlocksX: g.pixels.numBlocksX,
            numBlocksY: g.pixels.numBlocksY,
            numBytes: g.pixels.numBytes,
            maxValue: g.pixels.maxValue,
            noDataValue: g.noDataValue
          }
        };
      }, y = function(g) {
        for (var E = g.pixels.numBlocksX * g.pixels.numBlocksY, B = {}, f = 0; f < E; f++) {
          var c = g.pixels.blocks[f];
          c.encoding === 0 ? B.float32 = !0 : c.encoding === 1 ? B[c.bitsPerPixel] = !0 : B[0] = !0;
        }
        return Object.keys(B);
      }, a = function(g, E, B) {
        var f = {}, c = new Uint8Array(g, E, 10);
        if (f.fileIdentifierString = String.fromCharCode.apply(null, c), f.fileIdentifierString.trim() !== "CntZImage")
          throw "Unexpected file identifier string: " + f.fileIdentifierString;
        E += 10;
        var l = new DataView(g, E, 24);
        if (f.fileVersion = l.getInt32(0, !0), f.imageType = l.getInt32(4, !0), f.height = l.getUint32(8, !0), f.width = l.getUint32(12, !0), f.maxZError = l.getFloat64(16, !0), E += 24, !B)
          if (l = new DataView(g, E, 16), f.mask = {}, f.mask.numBlocksY = l.getUint32(0, !0), f.mask.numBlocksX = l.getUint32(4, !0), f.mask.numBytes = l.getUint32(8, !0), f.mask.maxValue = l.getFloat32(12, !0), E += 16, f.mask.numBytes > 0) {
            var u = new Uint8Array(Math.ceil(f.width * f.height / 8));
            l = new DataView(g, E, f.mask.numBytes);
            var h = l.getInt16(0, !0), D = 2, d = 0;
            do {
              if (h > 0)
                for (; h--; )
                  u[d++] = l.getUint8(D++);
              else {
                var Q = l.getUint8(D++);
                for (h = -h; h--; )
                  u[d++] = Q;
              }
              h = l.getInt16(D, !0), D += 2;
            } while (D < f.mask.numBytes);
            if (h !== -32768 || d < u.length)
              throw "Unexpected end of mask RLE encoding";
            f.mask.bitset = u, E += f.mask.numBytes;
          } else f.mask.numBytes | f.mask.numBlocksY | f.mask.maxValue || (f.mask.bitset = new Uint8Array(Math.ceil(f.width * f.height / 8)));
        l = new DataView(g, E, 16), f.pixels = {}, f.pixels.numBlocksY = l.getUint32(0, !0), f.pixels.numBlocksX = l.getUint32(4, !0), f.pixels.numBytes = l.getUint32(8, !0), f.pixels.maxValue = l.getFloat32(12, !0), E += 16;
        var C = f.pixels.numBlocksX, w = f.pixels.numBlocksY, m = C + (f.width % C > 0 ? 1 : 0), F = w + (f.height % w > 0 ? 1 : 0);
        f.pixels.blocks = new Array(m * F);
        for (var k = 0, p = 0; p < F; p++)
          for (var x = 0; x < m; x++) {
            var b = 0, M = g.byteLength - E;
            l = new DataView(g, E, Math.min(10, M));
            var S = {};
            f.pixels.blocks[k++] = S;
            var G = l.getUint8(0);
            if (b++, S.encoding = G & 63, S.encoding > 3)
              throw "Invalid block encoding (" + S.encoding + ")";
            if (S.encoding === 2) {
              E++;
              continue;
            }
            if (G !== 0 && G !== 2) {
              if (G >>= 6, S.offsetType = G, G === 2)
                S.offset = l.getInt8(1), b++;
              else if (G === 1)
                S.offset = l.getInt16(1, !0), b += 2;
              else if (G === 0)
                S.offset = l.getFloat32(1, !0), b += 4;
              else
                throw "Invalid block offset type";
              if (S.encoding === 1)
                if (G = l.getUint8(b), b++, S.bitsPerPixel = G & 63, G >>= 6, S.numValidPixelsType = G, G === 2)
                  S.numValidPixels = l.getUint8(b), b++;
                else if (G === 1)
                  S.numValidPixels = l.getUint16(b, !0), b += 2;
                else if (G === 0)
                  S.numValidPixels = l.getUint32(b, !0), b += 4;
                else
                  throw "Invalid valid pixel count type";
            }
            if (E += b, S.encoding !== 3) {
              var U, L;
              if (S.encoding === 0) {
                var R = (f.pixels.numBytes - 1) / 4;
                if (R !== Math.floor(R))
                  throw "uncompressed block has invalid length";
                U = new ArrayBuffer(R * 4), L = new Uint8Array(U), L.set(new Uint8Array(g, E, R * 4));
                var N = new Float32Array(U);
                S.rawData = N, E += R * 4;
              } else if (S.encoding === 1) {
                var v = Math.ceil(S.numValidPixels * S.bitsPerPixel / 8), Y = Math.ceil(v / 4);
                U = new ArrayBuffer(Y * 4), L = new Uint8Array(U), L.set(new Uint8Array(g, E, v)), S.stuffedData = new Uint32Array(U), E += v;
              }
            }
          }
        return f.eofOffset = E, f;
      }, r = function(g, E, B, f, c, l, u) {
        var h = (1 << E) - 1, D = 0, d, Q = 0, C, w, m = Math.ceil((u - f) / c), F = g.length * 4 - Math.ceil(E * B / 8);
        for (g[g.length - 1] <<= 8 * F, d = 0; d < B; d++) {
          if (Q === 0 && (w = g[D++], Q = 32), Q >= E)
            C = w >>> Q - E & h, Q -= E;
          else {
            var k = E - Q;
            C = (w & h) << k & h, w = g[D++], Q = 32 - k, C += w >>> Q;
          }
          l[d] = C < m ? f + C * c : u;
        }
        return l;
      };
      return o;
    }(), A = /* @__PURE__ */ function() {
      var o = {
        //methods ending with 2 are for the new byte order used by Lerc2.3 and above.
        //originalUnstuff is used to unpack Huffman code table. code is duplicated to unstuffx for performance reasons.
        unstuff: function(a, r, g, E, B, f, c, l) {
          var u = (1 << g) - 1, h = 0, D, d = 0, Q, C, w, m, F = a.length * 4 - Math.ceil(g * E / 8);
          if (a[a.length - 1] <<= 8 * F, B)
            for (D = 0; D < E; D++)
              d === 0 && (C = a[h++], d = 32), d >= g ? (Q = C >>> d - g & u, d -= g) : (w = g - d, Q = (C & u) << w & u, C = a[h++], d = 32 - w, Q += C >>> d), r[D] = B[Q];
          else
            for (m = Math.ceil((l - f) / c), D = 0; D < E; D++)
              d === 0 && (C = a[h++], d = 32), d >= g ? (Q = C >>> d - g & u, d -= g) : (w = g - d, Q = (C & u) << w & u, C = a[h++], d = 32 - w, Q += C >>> d), r[D] = Q < m ? f + Q * c : l;
        },
        unstuffLUT: function(a, r, g, E, B, f) {
          var c = (1 << r) - 1, l = 0, u = 0, h = 0, D = 0, d = 0, Q, C = [], w = a.length * 4 - Math.ceil(r * g / 8);
          a[a.length - 1] <<= 8 * w;
          var m = Math.ceil((f - E) / B);
          for (u = 0; u < g; u++)
            D === 0 && (Q = a[l++], D = 32), D >= r ? (d = Q >>> D - r & c, D -= r) : (h = r - D, d = (Q & c) << h & c, Q = a[l++], D = 32 - h, d += Q >>> D), C[u] = d < m ? E + d * B : f;
          return C.unshift(E), C;
        },
        unstuff2: function(a, r, g, E, B, f, c, l) {
          var u = (1 << g) - 1, h = 0, D, d = 0, Q = 0, C, w, m;
          if (B)
            for (D = 0; D < E; D++)
              d === 0 && (w = a[h++], d = 32, Q = 0), d >= g ? (C = w >>> Q & u, d -= g, Q += g) : (m = g - d, C = w >>> Q & u, w = a[h++], d = 32 - m, C |= (w & (1 << m) - 1) << g - m, Q = m), r[D] = B[C];
          else {
            var F = Math.ceil((l - f) / c);
            for (D = 0; D < E; D++)
              d === 0 && (w = a[h++], d = 32, Q = 0), d >= g ? (C = w >>> Q & u, d -= g, Q += g) : (m = g - d, C = w >>> Q & u, w = a[h++], d = 32 - m, C |= (w & (1 << m) - 1) << g - m, Q = m), r[D] = C < F ? f + C * c : l;
          }
          return r;
        },
        unstuffLUT2: function(a, r, g, E, B, f) {
          var c = (1 << r) - 1, l = 0, u = 0, h = 0, D = 0, d = 0, Q = 0, C, w = [], m = Math.ceil((f - E) / B);
          for (u = 0; u < g; u++)
            D === 0 && (C = a[l++], D = 32, Q = 0), D >= r ? (d = C >>> Q & c, D -= r, Q += r) : (h = r - D, d = C >>> Q & c, C = a[l++], D = 32 - h, d |= (C & (1 << h) - 1) << r - h, Q = h), w[u] = d < m ? E + d * B : f;
          return w.unshift(E), w;
        },
        originalUnstuff: function(a, r, g, E) {
          var B = (1 << g) - 1, f = 0, c, l = 0, u, h, D, d = a.length * 4 - Math.ceil(g * E / 8);
          for (a[a.length - 1] <<= 8 * d, c = 0; c < E; c++)
            l === 0 && (h = a[f++], l = 32), l >= g ? (u = h >>> l - g & B, l -= g) : (D = g - l, u = (h & B) << D & B, h = a[f++], l = 32 - D, u += h >>> l), r[c] = u;
          return r;
        },
        originalUnstuff2: function(a, r, g, E) {
          var B = (1 << g) - 1, f = 0, c, l = 0, u = 0, h, D, d;
          for (c = 0; c < E; c++)
            l === 0 && (D = a[f++], l = 32, u = 0), l >= g ? (h = D >>> u & B, l -= g, u += g) : (d = g - l, h = D >>> u & B, D = a[f++], l = 32 - d, h |= (D & (1 << d) - 1) << g - d, u = d), r[c] = h;
          return r;
        }
      }, I = {
        HUFFMAN_LUT_BITS_MAX: 12,
        //use 2^12 lut, treat it like constant
        computeChecksumFletcher32: function(a) {
          for (var r = 65535, g = 65535, E = a.length, B = Math.floor(E / 2), f = 0; B; ) {
            var c = B >= 359 ? 359 : B;
            B -= c;
            do
              r += a[f++] << 8, g += r += a[f++];
            while (--c);
            r = (r & 65535) + (r >>> 16), g = (g & 65535) + (g >>> 16);
          }
          return E & 1 && (g += r += a[f] << 8), r = (r & 65535) + (r >>> 16), g = (g & 65535) + (g >>> 16), (g << 16 | r) >>> 0;
        },
        readHeaderInfo: function(a, r) {
          var g = r.ptr, E = new Uint8Array(a, g, 6), B = {};
          if (B.fileIdentifierString = String.fromCharCode.apply(null, E), B.fileIdentifierString.lastIndexOf("Lerc2", 0) !== 0)
            throw "Unexpected file identifier string (expect Lerc2 ): " + B.fileIdentifierString;
          g += 6;
          var f = new DataView(a, g, 8), c = f.getInt32(0, !0);
          B.fileVersion = c, g += 4, c >= 3 && (B.checksum = f.getUint32(4, !0), g += 4), f = new DataView(a, g, 12), B.height = f.getUint32(0, !0), B.width = f.getUint32(4, !0), g += 8, c >= 4 ? (B.numDims = f.getUint32(8, !0), g += 4) : B.numDims = 1, f = new DataView(a, g, 40), B.numValidPixel = f.getUint32(0, !0), B.microBlockSize = f.getInt32(4, !0), B.blobSize = f.getInt32(8, !0), B.imageType = f.getInt32(12, !0), B.maxZError = f.getFloat64(16, !0), B.zMin = f.getFloat64(24, !0), B.zMax = f.getFloat64(32, !0), g += 40, r.headerInfo = B, r.ptr = g;
          var l, u;
          if (c >= 3 && (u = c >= 4 ? 52 : 48, l = this.computeChecksumFletcher32(new Uint8Array(a, g - u, B.blobSize - 14)), l !== B.checksum))
            throw "Checksum failed.";
          return !0;
        },
        checkMinMaxRanges: function(a, r) {
          var g = r.headerInfo, E = this.getDataTypeArray(g.imageType), B = g.numDims * this.getDataTypeSize(g.imageType), f = this.readSubArray(a, r.ptr, E, B), c = this.readSubArray(a, r.ptr + B, E, B);
          r.ptr += 2 * B;
          var l, u = !0;
          for (l = 0; l < g.numDims; l++)
            if (f[l] !== c[l]) {
              u = !1;
              break;
            }
          return g.minValues = f, g.maxValues = c, u;
        },
        readSubArray: function(a, r, g, E) {
          var B;
          if (g === Uint8Array)
            B = new Uint8Array(a, r, E);
          else {
            var f = new ArrayBuffer(E), c = new Uint8Array(f);
            c.set(new Uint8Array(a, r, E)), B = new g(f);
          }
          return B;
        },
        readMask: function(a, r) {
          var g = r.ptr, E = r.headerInfo, B = E.width * E.height, f = E.numValidPixel, c = new DataView(a, g, 4), l = {};
          if (l.numBytes = c.getUint32(0, !0), g += 4, (f === 0 || B === f) && l.numBytes !== 0)
            throw "invalid mask";
          var u, h;
          if (f === 0)
            u = new Uint8Array(Math.ceil(B / 8)), l.bitset = u, h = new Uint8Array(B), r.pixels.resultMask = h, g += l.numBytes;
          else if (l.numBytes > 0) {
            u = new Uint8Array(Math.ceil(B / 8)), c = new DataView(a, g, l.numBytes);
            var D = c.getInt16(0, !0), d = 2, Q = 0, C = 0;
            do {
              if (D > 0)
                for (; D--; )
                  u[Q++] = c.getUint8(d++);
              else
                for (C = c.getUint8(d++), D = -D; D--; )
                  u[Q++] = C;
              D = c.getInt16(d, !0), d += 2;
            } while (d < l.numBytes);
            if (D !== -32768 || Q < u.length)
              throw "Unexpected end of mask RLE encoding";
            h = new Uint8Array(B);
            var w = 0, m = 0;
            for (m = 0; m < B; m++)
              m & 7 ? (w = u[m >> 3], w <<= m & 7) : w = u[m >> 3], w & 128 && (h[m] = 1);
            r.pixels.resultMask = h, l.bitset = u, g += l.numBytes;
          }
          return r.ptr = g, r.mask = l, !0;
        },
        readDataOneSweep: function(a, r, g, E) {
          var B = r.ptr, f = r.headerInfo, c = f.numDims, l = f.width * f.height, u = f.imageType, h = f.numValidPixel * I.getDataTypeSize(u) * c, D, d = r.pixels.resultMask;
          if (g === Uint8Array)
            D = new Uint8Array(a, B, h);
          else {
            var Q = new ArrayBuffer(h), C = new Uint8Array(Q);
            C.set(new Uint8Array(a, B, h)), D = new g(Q);
          }
          if (D.length === l * c)
            E ? r.pixels.resultPixels = I.swapDimensionOrder(D, l, c, g, !0) : r.pixels.resultPixels = D;
          else {
            r.pixels.resultPixels = new g(l * c);
            var w = 0, m = 0, F = 0, k = 0;
            if (c > 1) {
              if (E) {
                for (m = 0; m < l; m++)
                  if (d[m])
                    for (k = m, F = 0; F < c; F++, k += l)
                      r.pixels.resultPixels[k] = D[w++];
              } else
                for (m = 0; m < l; m++)
                  if (d[m])
                    for (k = m * c, F = 0; F < c; F++)
                      r.pixels.resultPixels[k + F] = D[w++];
            } else
              for (m = 0; m < l; m++)
                d[m] && (r.pixels.resultPixels[m] = D[w++]);
          }
          return B += h, r.ptr = B, !0;
        },
        readHuffmanTree: function(a, r) {
          var g = this.HUFFMAN_LUT_BITS_MAX, E = new DataView(a, r.ptr, 16);
          r.ptr += 16;
          var B = E.getInt32(0, !0);
          if (B < 2)
            throw "unsupported Huffman version";
          var f = E.getInt32(4, !0), c = E.getInt32(8, !0), l = E.getInt32(12, !0);
          if (c >= l)
            return !1;
          var u = new Uint32Array(l - c);
          I.decodeBits(a, r, u);
          var h = [], D, d, Q, C;
          for (D = c; D < l; D++)
            d = D - (D < f ? 0 : f), h[d] = { first: u[D - c], second: null };
          var w = a.byteLength - r.ptr, m = Math.ceil(w / 4), F = new ArrayBuffer(m * 4), k = new Uint8Array(F);
          k.set(new Uint8Array(a, r.ptr, w));
          var p = new Uint32Array(F), x = 0, b, M = 0;
          for (b = p[0], D = c; D < l; D++)
            d = D - (D < f ? 0 : f), C = h[d].first, C > 0 && (h[d].second = b << x >>> 32 - C, 32 - x >= C ? (x += C, x === 32 && (x = 0, M++, b = p[M])) : (x += C - 32, M++, b = p[M], h[d].second |= b >>> 32 - x));
          var S = 0, G = 0, U = new s();
          for (D = 0; D < h.length; D++)
            h[D] !== void 0 && (S = Math.max(S, h[D].first));
          S >= g ? G = g : G = S;
          var L = [], R, N, v, Y, _, q;
          for (D = c; D < l; D++)
            if (d = D - (D < f ? 0 : f), C = h[d].first, C > 0)
              if (R = [C, d], C <= G)
                for (N = h[d].second << G - C, v = 1 << G - C, Q = 0; Q < v; Q++)
                  L[N | Q] = R;
              else
                for (N = h[d].second, q = U, Y = C - 1; Y >= 0; Y--)
                  _ = N >>> Y & 1, _ ? (q.right || (q.right = new s()), q = q.right) : (q.left || (q.left = new s()), q = q.left), Y === 0 && !q.val && (q.val = R[1]);
          return {
            decodeLut: L,
            numBitsLUTQick: G,
            numBitsLUT: S,
            tree: U,
            stuffedData: p,
            srcPtr: M,
            bitPos: x
          };
        },
        readHuffman: function(a, r, g, E) {
          var B = r.headerInfo, f = B.numDims, c = r.headerInfo.height, l = r.headerInfo.width, u = l * c, h = this.readHuffmanTree(a, r), D = h.decodeLut, d = h.tree, Q = h.stuffedData, C = h.srcPtr, w = h.bitPos, m = h.numBitsLUTQick, F = h.numBitsLUT, k = r.headerInfo.imageType === 0 ? 128 : 0, p, x, b, M = r.pixels.resultMask, S, G, U, L, R, N, v, Y = 0;
          w > 0 && (C++, w = 0);
          var _ = Q[C], q = r.encodeMode === 1, T = new g(u * f), O = T, J;
          if (f < 2 || q) {
            for (J = 0; J < f; J++)
              if (f > 1 && (O = new g(T.buffer, u * J, u), Y = 0), r.headerInfo.numValidPixel === l * c)
                for (N = 0, L = 0; L < c; L++)
                  for (R = 0; R < l; R++, N++) {
                    if (x = 0, S = _ << w >>> 32 - m, G = S, 32 - w < m && (S |= Q[C + 1] >>> 64 - w - m, G = S), D[G])
                      x = D[G][1], w += D[G][0];
                    else
                      for (S = _ << w >>> 32 - F, G = S, 32 - w < F && (S |= Q[C + 1] >>> 64 - w - F, G = S), p = d, v = 0; v < F; v++)
                        if (U = S >>> F - v - 1 & 1, p = U ? p.right : p.left, !(p.left || p.right)) {
                          x = p.val, w = w + v + 1;
                          break;
                        }
                    w >= 32 && (w -= 32, C++, _ = Q[C]), b = x - k, q ? (R > 0 ? b += Y : L > 0 ? b += O[N - l] : b += Y, b &= 255, O[N] = b, Y = b) : O[N] = b;
                  }
              else
                for (N = 0, L = 0; L < c; L++)
                  for (R = 0; R < l; R++, N++)
                    if (M[N]) {
                      if (x = 0, S = _ << w >>> 32 - m, G = S, 32 - w < m && (S |= Q[C + 1] >>> 64 - w - m, G = S), D[G])
                        x = D[G][1], w += D[G][0];
                      else
                        for (S = _ << w >>> 32 - F, G = S, 32 - w < F && (S |= Q[C + 1] >>> 64 - w - F, G = S), p = d, v = 0; v < F; v++)
                          if (U = S >>> F - v - 1 & 1, p = U ? p.right : p.left, !(p.left || p.right)) {
                            x = p.val, w = w + v + 1;
                            break;
                          }
                      w >= 32 && (w -= 32, C++, _ = Q[C]), b = x - k, q ? (R > 0 && M[N - 1] ? b += Y : L > 0 && M[N - l] ? b += O[N - l] : b += Y, b &= 255, O[N] = b, Y = b) : O[N] = b;
                    }
          } else
            for (N = 0, L = 0; L < c; L++)
              for (R = 0; R < l; R++)
                if (N = L * l + R, !M || M[N])
                  for (J = 0; J < f; J++, N += u) {
                    if (x = 0, S = _ << w >>> 32 - m, G = S, 32 - w < m && (S |= Q[C + 1] >>> 64 - w - m, G = S), D[G])
                      x = D[G][1], w += D[G][0];
                    else
                      for (S = _ << w >>> 32 - F, G = S, 32 - w < F && (S |= Q[C + 1] >>> 64 - w - F, G = S), p = d, v = 0; v < F; v++)
                        if (U = S >>> F - v - 1 & 1, p = U ? p.right : p.left, !(p.left || p.right)) {
                          x = p.val, w = w + v + 1;
                          break;
                        }
                    w >= 32 && (w -= 32, C++, _ = Q[C]), b = x - k, O[N] = b;
                  }
          r.ptr = r.ptr + (C + 1) * 4 + (w > 0 ? 4 : 0), r.pixels.resultPixels = T, f > 1 && !E && (r.pixels.resultPixels = I.swapDimensionOrder(T, u, f, g));
        },
        decodeBits: function(a, r, g, E, B) {
          {
            var f = r.headerInfo, c = f.fileVersion, l = 0, u = a.byteLength - r.ptr >= 5 ? 5 : a.byteLength - r.ptr, h = new DataView(a, r.ptr, u), D = h.getUint8(0);
            l++;
            var d = D >> 6, Q = d === 0 ? 4 : 3 - d, C = (D & 32) > 0, w = D & 31, m = 0;
            if (Q === 1)
              m = h.getUint8(l), l++;
            else if (Q === 2)
              m = h.getUint16(l, !0), l += 2;
            else if (Q === 4)
              m = h.getUint32(l, !0), l += 4;
            else
              throw "Invalid valid pixel count type";
            var F = 2 * f.maxZError, k, p, x, b, M, S, G, U, L, R = f.numDims > 1 ? f.maxValues[B] : f.zMax;
            if (C) {
              for (r.counter.lut++, U = h.getUint8(l), l++, b = Math.ceil((U - 1) * w / 8), M = Math.ceil(b / 4), p = new ArrayBuffer(M * 4), x = new Uint8Array(p), r.ptr += l, x.set(new Uint8Array(a, r.ptr, b)), G = new Uint32Array(p), r.ptr += b, L = 0; U - 1 >>> L; )
                L++;
              b = Math.ceil(m * L / 8), M = Math.ceil(b / 4), p = new ArrayBuffer(M * 4), x = new Uint8Array(p), x.set(new Uint8Array(a, r.ptr, b)), k = new Uint32Array(p), r.ptr += b, c >= 3 ? S = o.unstuffLUT2(G, w, U - 1, E, F, R) : S = o.unstuffLUT(G, w, U - 1, E, F, R), c >= 3 ? o.unstuff2(k, g, L, m, S) : o.unstuff(k, g, L, m, S);
            } else
              r.counter.bitstuffer++, L = w, r.ptr += l, L > 0 && (b = Math.ceil(m * L / 8), M = Math.ceil(b / 4), p = new ArrayBuffer(M * 4), x = new Uint8Array(p), x.set(new Uint8Array(a, r.ptr, b)), k = new Uint32Array(p), r.ptr += b, c >= 3 ? E == null ? o.originalUnstuff2(k, g, L, m) : o.unstuff2(k, g, L, m, !1, E, F, R) : E == null ? o.originalUnstuff(k, g, L, m) : o.unstuff(k, g, L, m, !1, E, F, R));
          }
        },
        readTiles: function(a, r, g, E) {
          var B = r.headerInfo, f = B.width, c = B.height, l = f * c, u = B.microBlockSize, h = B.imageType, D = I.getDataTypeSize(h), d = Math.ceil(f / u), Q = Math.ceil(c / u);
          r.pixels.numBlocksY = Q, r.pixels.numBlocksX = d, r.pixels.ptr = 0;
          var C = 0, w = 0, m = 0, F = 0, k = 0, p = 0, x = 0, b = 0, M = 0, S = 0, G = 0, U = 0, L = 0, R = 0, N = 0, v = 0, Y, _, q, T, O, J, H = new g(u * u), P = c % u || u, j = f % u || u, V, W, EA = B.numDims, wA, oA = r.pixels.resultMask, tA = r.pixels.resultPixels, or = B.fileVersion, ct = or >= 5 ? 14 : 15, QA, we = B.zMax, hA;
          for (m = 0; m < Q; m++)
            for (k = m !== Q - 1 ? u : P, F = 0; F < d; F++)
              for (p = F !== d - 1 ? u : j, G = m * f * u + F * u, U = f - p, wA = 0; wA < EA; wA++) {
                if (EA > 1 ? (hA = tA, G = m * f * u + F * u, tA = new g(r.pixels.resultPixels.buffer, l * wA * D, l), we = B.maxValues[wA]) : hA = null, x = a.byteLength - r.ptr, Y = new DataView(a, r.ptr, Math.min(10, x)), _ = {}, v = 0, b = Y.getUint8(0), v++, QA = B.fileVersion >= 5 ? b & 4 : 0, M = b >> 6 & 255, S = b >> 2 & ct, S !== (F * u >> 3 & ct) || QA && wA === 0)
                  throw "integrity issue";
                if (J = b & 3, J > 3)
                  throw r.ptr += v, "Invalid block encoding (" + J + ")";
                if (J === 2) {
                  if (QA)
                    if (oA)
                      for (C = 0; C < k; C++)
                        for (w = 0; w < p; w++)
                          oA[G] && (tA[G] = hA[G]), G++;
                    else
                      for (C = 0; C < k; C++)
                        for (w = 0; w < p; w++)
                          tA[G] = hA[G], G++;
                  r.counter.constant++, r.ptr += v;
                  continue;
                } else if (J === 0) {
                  if (QA)
                    throw "integrity issue";
                  if (r.counter.uncompressed++, r.ptr += v, L = k * p * D, R = a.byteLength - r.ptr, L = L < R ? L : R, q = new ArrayBuffer(L % D === 0 ? L : L + D - L % D), T = new Uint8Array(q), T.set(new Uint8Array(a, r.ptr, L)), O = new g(q), N = 0, oA)
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        oA[G] && (tA[G] = O[N++]), G++;
                      G += U;
                    }
                  else
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        tA[G++] = O[N++];
                      G += U;
                    }
                  r.ptr += N * D;
                } else if (V = I.getDataTypeUsed(QA && h < 6 ? 4 : h, M), W = I.getOnePixel(_, v, V, Y), v += I.getDataTypeSize(V), J === 3)
                  if (r.ptr += v, r.counter.constantoffset++, oA)
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        oA[G] && (tA[G] = QA ? Math.min(we, hA[G] + W) : W), G++;
                      G += U;
                    }
                  else
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        tA[G] = QA ? Math.min(we, hA[G] + W) : W, G++;
                      G += U;
                    }
                else if (r.ptr += v, I.decodeBits(a, r, H, W, wA), v = 0, QA)
                  if (oA)
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        oA[G] && (tA[G] = H[v++] + hA[G]), G++;
                      G += U;
                    }
                  else
                    for (C = 0; C < k; C++) {
                      for (w = 0; w < p; w++)
                        tA[G] = H[v++] + hA[G], G++;
                      G += U;
                    }
                else if (oA)
                  for (C = 0; C < k; C++) {
                    for (w = 0; w < p; w++)
                      oA[G] && (tA[G] = H[v++]), G++;
                    G += U;
                  }
                else
                  for (C = 0; C < k; C++) {
                    for (w = 0; w < p; w++)
                      tA[G++] = H[v++];
                    G += U;
                  }
              }
          EA > 1 && !E && (r.pixels.resultPixels = I.swapDimensionOrder(r.pixels.resultPixels, l, EA, g));
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
            pixelType: I.getPixelType(a.headerInfo.imageType),
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
          var g = a.headerInfo.zMax, E = a.headerInfo.zMin, B = a.headerInfo.maxValues, f = a.headerInfo.numDims, c = a.headerInfo.height * a.headerInfo.width, l = 0, u = 0, h = 0, D = a.pixels.resultMask, d = a.pixels.resultPixels;
          if (D)
            if (f > 1) {
              if (r)
                for (l = 0; l < f; l++)
                  for (h = l * c, g = B[l], u = 0; u < c; u++)
                    D[u] && (d[h + u] = g);
              else
                for (u = 0; u < c; u++)
                  if (D[u])
                    for (h = u * f, l = 0; l < f; l++)
                      d[h + f] = B[l];
            } else
              for (u = 0; u < c; u++)
                D[u] && (d[u] = g);
          else if (f > 1 && E !== g)
            if (r)
              for (l = 0; l < f; l++)
                for (h = l * c, g = B[l], u = 0; u < c; u++)
                  d[h + u] = g;
            else
              for (u = 0; u < c; u++)
                for (h = u * f, l = 0; l < f; l++)
                  d[h + l] = B[l];
          else
            for (u = 0; u < c * f; u++)
              d[u] = g;
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
          var g;
          switch (a) {
            case 0:
              g = r >= -128 && r <= 127;
              break;
            case 1:
              g = r >= 0 && r <= 255;
              break;
            case 2:
              g = r >= -32768 && r <= 32767;
              break;
            case 3:
              g = r >= 0 && r <= 65536;
              break;
            case 4:
              g = r >= -2147483648 && r <= 2147483647;
              break;
            case 5:
              g = r >= 0 && r <= 4294967296;
              break;
            case 6:
              g = r >= -34027999387901484e22 && r <= 34027999387901484e22;
              break;
            case 7:
              g = r >= -17976931348623157e292 && r <= 17976931348623157e292;
              break;
            default:
              g = !1;
          }
          return g;
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
          var g = a;
          switch (a) {
            case 2:
            case 4:
              g = a - r;
              break;
            case 3:
            case 5:
              g = a - 2 * r;
              break;
            case 6:
              r === 0 ? g = a : r === 1 ? g = 2 : g = 1;
              break;
            case 7:
              r === 0 ? g = a : g = a - 2 * r + 1;
              break;
            default:
              g = a;
              break;
          }
          return g;
        },
        getOnePixel: function(a, r, g, E) {
          var B = 0;
          switch (g) {
            case 0:
              B = E.getInt8(r);
              break;
            case 1:
              B = E.getUint8(r);
              break;
            case 2:
              B = E.getInt16(r, !0);
              break;
            case 3:
              B = E.getUint16(r, !0);
              break;
            case 4:
              B = E.getInt32(r, !0);
              break;
            case 5:
              B = E.getUInt32(r, !0);
              break;
            case 6:
              B = E.getFloat32(r, !0);
              break;
            case 7:
              B = E.getFloat64(r, !0);
              break;
            default:
              throw "the decoder does not understand this pixel type";
          }
          return B;
        },
        swapDimensionOrder: function(a, r, g, E, B) {
          var f = 0, c = 0, l = 0, u = 0, h = a;
          if (g > 1)
            if (h = new E(r * g), B)
              for (f = 0; f < r; f++)
                for (u = f, l = 0; l < g; l++, u += r)
                  h[u] = a[c++];
            else
              for (f = 0; f < r; f++)
                for (u = f, l = 0; l < g; l++, u += r)
                  h[c++] = a[u];
          return h;
        }
      }, s = function(a, r, g) {
        this.val = a, this.left = r, this.right = g;
      }, y = {
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
          var g = r.noDataValue, E = 0, B = {};
          if (B.ptr = r.inputOffset || 0, B.pixels = {}, !!I.readHeaderInfo(a, B)) {
            var f = B.headerInfo, c = f.fileVersion, l = I.getDataTypeArray(f.imageType);
            if (c > 5)
              throw "unsupported lerc version 2." + c;
            I.readMask(a, B), f.numValidPixel !== f.width * f.height && !B.pixels.resultMask && (B.pixels.resultMask = r.maskData);
            var u = f.width * f.height;
            B.pixels.resultPixels = new l(u * f.numDims), B.counter = {
              onesweep: 0,
              uncompressed: 0,
              lut: 0,
              bitstuffer: 0,
              constant: 0,
              constantoffset: 0
            };
            var h = !r.returnPixelInterleavedDims;
            if (f.numValidPixel !== 0)
              if (f.zMax === f.zMin)
                I.constructConstantSurface(B, h);
              else if (c >= 4 && I.checkMinMaxRanges(a, B))
                I.constructConstantSurface(B, h);
              else {
                var D = new DataView(a, B.ptr, 2), d = D.getUint8(0);
                if (B.ptr++, d)
                  I.readDataOneSweep(a, B, l, h);
                else if (c > 1 && f.imageType <= 1 && Math.abs(f.maxZError - 0.5) < 1e-5) {
                  var Q = D.getUint8(1);
                  if (B.ptr++, B.encodeMode = Q, Q > 2 || c < 4 && Q > 1)
                    throw "Invalid Huffman flag " + Q;
                  Q ? I.readHuffman(a, B, l, h) : I.readTiles(a, B, l, h);
                } else
                  I.readTiles(a, B, l, h);
              }
            B.eofOffset = B.ptr;
            var C;
            r.inputOffset ? (C = B.headerInfo.blobSize + r.inputOffset - B.ptr, Math.abs(C) >= 1 && (B.eofOffset = r.inputOffset + B.headerInfo.blobSize)) : (C = B.headerInfo.blobSize - B.ptr, Math.abs(C) >= 1 && (B.eofOffset = B.headerInfo.blobSize));
            var w = {
              width: f.width,
              height: f.height,
              pixelData: B.pixels.resultPixels,
              minValue: f.zMin,
              maxValue: f.zMax,
              validPixelCount: f.numValidPixel,
              dimCount: f.numDims,
              dimStats: {
                minValues: f.minValues,
                maxValues: f.maxValues
              },
              maskData: B.pixels.resultMask
              //noDataValue: noDataValue
            };
            if (B.pixels.resultMask && I.isValidPixelValue(f.imageType, g)) {
              var m = B.pixels.resultMask;
              for (E = 0; E < u; E++)
                m[E] || (w.pixelData[E] = g);
              w.noDataValue = g;
            }
            return B.noDataValue = g, r.returnFileInfo && (w.fileInfo = I.formatFileInfo(B)), w;
          }
        },
        getBandCount: function(a) {
          var r = 0, g = 0, E = {};
          for (E.ptr = 0, E.pixels = {}; g < a.byteLength - 58; )
            I.readHeaderInfo(a, E), g += E.headerInfo.blobSize, r++, E.ptr = g;
          return r;
        }
      };
      return y;
    }(), i = function() {
      var o = new ArrayBuffer(4), I = new Uint8Array(o), s = new Uint32Array(o);
      return s[0] = 1, I[0] === 1;
    }(), n = {
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
      decode: function(o, I) {
        if (!i)
          throw "Big endian system is not supported.";
        I = I || {};
        var s = I.inputOffset || 0, y = new Uint8Array(o, s, 10), a = String.fromCharCode.apply(null, y), r, g;
        if (a.trim() === "CntZImage")
          r = e, g = 1;
        else if (a.substring(0, 5) === "Lerc2")
          r = A, g = 2;
        else
          throw "Unexpected file identifier string: " + a;
        for (var E = 0, B = o.byteLength - 10, f, c = [], l, u, h = {
          width: 0,
          height: 0,
          pixels: [],
          pixelType: I.pixelType,
          mask: null,
          statistics: []
        }, D = 0; s < B; ) {
          var d = r.decode(o, {
            inputOffset: s,
            //for both lerc1 and lerc2
            encodedMaskData: f,
            //lerc1 only
            maskData: u,
            //lerc2 only
            returnMask: E === 0,
            //lerc1 only
            returnEncodedMask: E === 0,
            //lerc1 only
            returnFileInfo: !0,
            //for both lerc1 and lerc2
            returnPixelInterleavedDims: I.returnPixelInterleavedDims,
            //for ndim lerc2 only
            pixelType: I.pixelType || null,
            //lerc1 only
            noDataValue: I.noDataValue || null
            //lerc1 only
          });
          s = d.fileInfo.eofOffset, u = d.maskData, E === 0 && (f = d.encodedMaskData, h.width = d.width, h.height = d.height, h.dimCount = d.dimCount || 1, h.pixelType = d.pixelType || d.fileInfo.pixelType, h.mask = u), g > 1 && (u && c.push(u), d.fileInfo.mask && d.fileInfo.mask.numBytes > 0 && D++), E++, h.pixels.push(d.pixelData), h.statistics.push({
            minValue: d.minValue,
            maxValue: d.maxValue,
            noDataValue: d.noDataValue,
            dimStats: d.dimStats
          });
        }
        var Q, C, w;
        if (g > 1 && D > 1) {
          for (w = h.width * h.height, h.bandMasks = c, u = new Uint8Array(w), u.set(c[0]), Q = 1; Q < c.length; Q++)
            for (l = c[Q], C = 0; C < w; C++)
              u[C] = u[C] & l[C];
          h.maskData = u;
        }
        return h;
      }
    };
    t.exports ? t.exports = n : this.Lerc = n;
  })();
})(rr);
var _a = rr.exports;
const Pa = /* @__PURE__ */ it(_a);
let JA, lA, Ze;
const Te = {
  env: {
    emscripten_notify_memory_growth: function(t) {
      Ze = new Uint8Array(lA.exports.memory.buffer);
    }
  }
};
class Va {
  init() {
    return JA || (typeof fetch < "u" ? JA = fetch("data:application/wasm;base64," + ei).then((e) => e.arrayBuffer()).then((e) => WebAssembly.instantiate(e, Te)).then(this._init) : JA = WebAssembly.instantiate(Buffer.from(ei, "base64"), Te).then(this._init), JA);
  }
  _init(e) {
    lA = e.instance, Te.env.emscripten_notify_memory_growth(0);
  }
  decode(e, A = 0) {
    if (!lA) throw new Error("ZSTDDecoder: Await .init() before decoding.");
    const i = e.byteLength, n = lA.exports.malloc(i);
    Ze.set(e, n), A = A || Number(lA.exports.ZSTD_findDecompressedSize(n, i));
    const o = lA.exports.malloc(A), I = lA.exports.ZSTD_decompress(o, A, n, i), s = Ze.slice(o, o + I);
    return lA.exports.free(n), lA.exports.free(o), s;
  }
}
const ei = "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IAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQh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ASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigCACACaiAAQQZ2IgFBAnRBsB5qKAIAaiAAQSBxIgBFaiABRSAAQQV2cWoFQbh/CwsdACAAKAKQ4gEQWiAAQQA2AqDiASAAQgA3A5DiAQu1AwEFfyMAQZACayIKJABBuH8hBgJAIAVFDQAgBCwAACIIQf8BcSEHAkAgCEF/TARAIAdBgn9qQQF2IgggBU8NAkFsIQYgB0GBf2oiBUGAAk8NAiAEQQFqIQdBACEGA0AgBiAFTwRAIAUhBiAIIQcMAwUgACAGaiAHIAZBAXZqIgQtAABBBHY6AAAgACAGQQFyaiAELQAAQQ9xOgAAIAZBAmohBgwBCwAACwALIAcgBU8NASAAIARBAWogByAKEFMiBhADDQELIAYhBEEAIQYgAUEAQTQQECEJQQAhBQNAIAQgBkcEQCAAIAZqIggtAAAiAUELSwRAQWwhBgwDBSAJIAFBAnRqIgEgASgCAEEBajYCACAGQQFqIQZBASAILQAAdEEBdSAFaiEFDAILAAsLQWwhBiAFRQ0AIAUQFEEBaiIBQQxLDQAgAyABNgIAQQFBASABdCAFayIDEBQiAXQgA0cNACAAIARqIAFBAWoiADoAACAJIABBAnRqIgAgACgCAEEBajYCACAJKAIEIgBBAkkgAEEBcXINACACIARBAWo2AgAgB0EBaiEGCyAKQZACaiQAIAYLxhEBDH8jAEHwAGsiBSQAQWwhCwJAIANBCkkNACACLwAAIQogAi8AAiEJIAIvAAQhByAFQQhqIAQQDgJAIAMgByAJIApqakEGaiIMSQ0AIAUtAAohCCAFQdgAaiACQQZqIgIgChAGIgsQAw0BIAVBQGsgAiAKaiICIAkQBiILEAMNASAFQShqIAIgCWoiAiAHEAYiCxADDQEgBUEQaiACIAdqIAMgDGsQBiILEAMNASAAIAFqIg9BfWohECAEQQRqIQZBASELIAAgAUEDakECdiIDaiIMIANqIgIgA2oiDiEDIAIhBCAMIQcDQCALIAMgEElxBEAgACAGIAVB2ABqIAgQAkECdGoiCS8BADsAACAFQdgAaiAJLQACEAEgCS0AAyELIAcgBiAFQUBrIAgQAkECdGoiCS8BADsAACAFQUBrIAktAAIQASAJLQADIQogBCAGIAVBKGogCBACQQJ0aiIJLwEAOwAAIAVBKGogCS0AAhABIAktAAMhCSADIAYgBUEQaiAIEAJBAnRqIg0vAQA7AAAgBUEQaiANLQACEAEgDS0AAyENIAAgC2oiCyAGIAVB2ABqIAgQAkECdGoiAC8BADsAACAFQdgAaiAALQACEAEgAC0AAyEAIAcgCmoiCiAGIAVBQGsgCBACQQJ0aiIHLwEAOwAAIAVBQGsgBy0AAhABIActAAMhByAEIAlqIgkgBiAFQShqIAgQAkECdGoiBC8BADsAACAFQShqIAQtAAIQASAELQADIQQgAyANaiIDIAYgBUEQaiAIEAJBAnRqIg0vAQA7AAAgBUEQaiANLQACEAEgACALaiEAIAcgCmohByAEIAlqIQQgAyANLQADaiEDIAVB2ABqEA0gBUFAaxANciAFQShqEA1yIAVBEGoQDXJFIQsMAQsLIAQgDksgByACS3INAEFsIQsgACAMSw0BIAxBfWohCQNAQQAgACAJSSAFQdgAahAEGwRAIAAgBiAFQdgAaiAIEAJBAnRqIgovAQA7AAAgBUHYAGogCi0AAhABIAAgCi0AA2oiACAGIAVB2ABqIAgQAkECdGoiCi8BADsAACAFQdgAaiAKLQACEAEgACAKLQADaiEADAEFIAxBfmohCgNAIAVB2ABqEAQgACAKS3JFBEAgACAGIAVB2ABqIAgQAkECdGoiCS8BADsAACAFQdgAaiAJLQACEAEgACAJLQADaiEADAELCwNAIAAgCk0EQCAAIAYgBUHYAGogCBACQQJ0aiIJLwEAOwAAIAVB2ABqIAktAAIQASAAIAktAANqIQAMAQsLAkAgACAMTw0AIAAgBiAFQdgAaiAIEAIiAEECdGoiDC0AADoAACAMLQADQQFGBEAgBUHYAGogDC0AAhABDAELIAUoAlxBH0sNACAFQdgAaiAGIABBAnRqLQACEAEgBSgCXEEhSQ0AIAVBIDYCXAsgAkF9aiEMA0BBACAHIAxJIAVBQGsQBBsEQCAHIAYgBUFAayAIEAJBAnRqIgAvAQA7AAAgBUFAayAALQACEAEgByAALQADaiIAIAYgBUFAayAIEAJBAnRqIgcvAQA7AAAgBUFAayAHLQACEAEgACAHLQADaiEHDAEFIAJBfmohDANAIAVBQGsQBCAHIAxLckUEQCAHIAYgBUFAayAIEAJBAnRqIgAvAQA7AAAgBUFAayAALQACEAEgByAALQADaiEHDAELCwNAIAcgDE0EQCAHIAYgBUFAayAIEAJBAnRqIgAvAQA7AAAgBUFAayAALQACEAEgByAALQADaiEHDAELCwJAIAcgAk8NACAHIAYgBUFAayAIEAIiAEECdGoiAi0AADoAACACLQADQQFGBEAgBUFAayACLQACEAEMAQsgBSgCREEfSw0AIAVBQGsgBiAAQQJ0ai0AAhABIAUoAkRBIUkNACAFQSA2AkQLIA5BfWohAgNAQQAgBCACSSAFQShqEAQbBEAgBCAGIAVBKGogCBACQQJ0aiIALwEAOwAAIAVBKGogAC0AAhABIAQgAC0AA2oiACAGIAVBKGogCBACQQJ0aiIELwEAOwAAIAVBKGogBC0AAhABIAAgBC0AA2ohBAwBBSAOQX5qIQIDQCAFQShqEAQgBCACS3JFBEAgBCAGIAVBKGogCBACQQJ0aiIALwEAOwAAIAVBKGogAC0AAhABIAQgAC0AA2ohBAwBCwsDQCAEIAJNBEAgBCAGIAVBKGogCBACQQJ0aiIALwEAOwAAIAVBKGogAC0AAhABIAQgAC0AA2ohBAwBCwsCQCAEIA5PDQAgBCAGIAVBKGogCBACIgBBAnRqIgItAAA6AAAgAi0AA0EBRgRAIAVBKGogAi0AAhABDAELIAUoAixBH0sNACAFQShqIAYgAEECdGotAAIQASAFKAIsQSFJDQAgBUEgNgIsCwNAQQAgAyAQSSAFQRBqEAQbBEAgAyAGIAVBEGogCBACQQJ0aiIALwEAOwAAIAVBEGogAC0AAhABIAMgAC0AA2oiACAGIAVBEGogCBACQQJ0aiICLwEAOwAAIAVBEGogAi0AAhABIAAgAi0AA2ohAwwBBSAPQX5qIQIDQCAFQRBqEAQgAyACS3JFBEAgAyAGIAVBEGogCBACQQJ0aiIALwEAOwAAIAVBEGogAC0AAhABIAMgAC0AA2ohAwwBCwsDQCADIAJNBEAgAyAGIAVBEGogCBACQQJ0aiIALwEAOwAAIAVBEGogAC0AAhABIAMgAC0AA2ohAwwBCwsCQCADIA9PDQAgAyAGIAVBEGogCBACIgBBAnRqIgItAAA6AAAgAi0AA0EBRgRAIAVBEGogAi0AAhABDAELIAUoAhRBH0sNACAFQRBqIAYgAEECdGotAAIQASAFKAIUQSFJDQAgBUEgNgIUCyABQWwgBUHYAGoQCiAFQUBrEApxIAVBKGoQCnEgBUEQahAKcRshCwwJCwAACwALAAALAAsAAAsACwAACwALQWwhCwsgBUHwAGokACALC7UEAQ5/IwBBEGsiBiQAIAZBBGogABAOQVQhBQJAIARB3AtJDQAgBi0ABCEHIANB8ARqQQBB7AAQECEIIAdBDEsNACADQdwJaiIJIAggBkEIaiAGQQxqIAEgAhAxIhAQA0UEQCAGKAIMIgQgB0sNASADQdwFaiEPIANBpAVqIREgAEEEaiESIANBqAVqIQEgBCEFA0AgBSICQX9qIQUgCCACQQJ0aigCAEUNAAsgAkEBaiEOQQEhBQNAIAUgDk9FBEAgCCAFQQJ0IgtqKAIAIQwgASALaiAKNgIAIAVBAWohBSAKIAxqIQoMAQsLIAEgCjYCAEEAIQUgBigCCCELA0AgBSALRkUEQCABIAUgCWotAAAiDEECdGoiDSANKAIAIg1BAWo2AgAgDyANQQF0aiINIAw6AAEgDSAFOgAAIAVBAWohBQwBCwtBACEBIANBADYCqAUgBEF/cyAHaiEJQQEhBQNAIAUgDk9FBEAgCCAFQQJ0IgtqKAIAIQwgAyALaiABNgIAIAwgBSAJanQgAWohASAFQQFqIQUMAQsLIAcgBEEBaiIBIAJrIgRrQQFqIQgDQEEBIQUgBCAIT0UEQANAIAUgDk9FBEAgBUECdCIJIAMgBEE0bGpqIAMgCWooAgAgBHY2AgAgBUEBaiEFDAELCyAEQQFqIQQMAQsLIBIgByAPIAogESADIAIgARBkIAZBAToABSAGIAc6AAYgACAGKAIENgIACyAQIQULIAZBEGokACAFC8ENAQt/IwBB8ABrIgUkAEFsIQkCQCADQQpJDQAgAi8AACEKIAIvAAIhDCACLwAEIQYgBUEIaiAEEA4CQCADIAYgCiAMampBBmoiDUkNACAFLQAKIQcgBUHYAGogAkEGaiICIAoQBiIJEAMNASAFQUBrIAIgCmoiAiAMEAYiCRADDQEgBUEoaiACIAxqIgIgBhAGIgkQAw0BIAVBEGogAiAGaiADIA1rEAYiCRADDQEgACABaiIOQX1qIQ8gBEEEaiEGQQEhCSAAIAFBA2pBAnYiAmoiCiACaiIMIAJqIg0hAyAMIQQgCiECA0AgCSADIA9JcQRAIAYgBUHYAGogBxACQQF0aiIILQAAIQsgBUHYAGogCC0AARABIAAgCzoAACAGIAVBQGsgBxACQQF0aiIILQAAIQsgBUFAayAILQABEAEgAiALOgAAIAYgBUEoaiAHEAJBAXRqIggtAAAhCyAFQShqIAgtAAEQASAEIAs6AAAgBiAFQRBqIAcQAkEBdGoiCC0AACELIAVBEGogCC0AARABIAMgCzoAACAGIAVB2ABqIAcQAkEBdGoiCC0AACELIAVB2ABqIAgtAAEQASAAIAs6AAEgBiAFQUBrIAcQAkEBdGoiCC0AACELIAVBQGsgCC0AARABIAIgCzoAASAGIAVBKGogBxACQQF0aiIILQAAIQsgBUEoaiAILQABEAEgBCALOgABIAYgBUEQaiAHEAJBAXRqIggtAAAhCyAFQRBqIAgtAAEQASADIAs6AAEgA0ECaiEDIARBAmohBCACQQJqIQIgAEECaiEAIAkgBUHYAGoQDUVxIAVBQGsQDUVxIAVBKGoQDUVxIAVBEGoQDUVxIQkMAQsLIAQgDUsgAiAMS3INAEFsIQkgACAKSw0BIApBfWohCQNAIAVB2ABqEAQgACAJT3JFBEAgBiAFQdgAaiAHEAJBAXRqIggtAAAhCyAFQdgAaiAILQABEAEgACALOgAAIAYgBUHYAGogBxACQQF0aiIILQAAIQsgBUHYAGogCC0AARABIAAgCzoAASAAQQJqIQAMAQsLA0AgBUHYAGoQBCAAIApPckUEQCAGIAVB2ABqIAcQAkEBdGoiCS0AACEIIAVB2ABqIAktAAEQASAAIAg6AAAgAEEBaiEADAELCwNAIAAgCkkEQCAGIAVB2ABqIAcQAkEBdGoiCS0AACEIIAVB2ABqIAktAAEQASAAIAg6AAAgAEEBaiEADAELCyAMQX1qIQADQCAFQUBrEAQgAiAAT3JFBEAgBiAFQUBrIAcQAkEBdGoiCi0AACEJIAVBQGsgCi0AARABIAIgCToAACAGIAVBQGsgBxACQQF0aiIKLQAAIQkgBUFAayAKLQABEAEgAiAJOgABIAJBAmohAgwBCwsDQCAFQUBrEAQgAiAMT3JFBEAgBiAFQUBrIAcQAkEBdGoiAC0AACEKIAVBQGsgAC0AARABIAIgCjoAACACQQFqIQIMAQsLA0AgAiAMSQRAIAYgBUFAayAHEAJBAXRqIgAtAAAhCiAFQUBrIAAtAAEQASACIAo6AAAgAkEBaiECDAELCyANQX1qIQADQCAFQShqEAQgBCAAT3JFBEAgBiAFQShqIAcQAkEBdGoiAi0AACEKIAVBKGogAi0AARABIAQgCjoAACAGIAVBKGogBxACQQF0aiICLQAAIQogBUEoaiACLQABEAEgBCAKOgABIARBAmohBAwBCwsDQCAFQShqEAQgBCANT3JFBEAgBiAFQShqIAcQAkEBdGoiAC0AACECIAVBKGogAC0AARABIAQgAjoAACAEQQFqIQQMAQsLA0AgBCANSQRAIAYgBUEoaiAHEAJBAXRqIgAtAAAhAiAFQShqIAAtAAEQASAEIAI6AAAgBEEBaiEEDAELCwNAIAVBEGoQBCADIA9PckUEQCAGIAVBEGogBxACQQF0aiIALQAAIQIgBUEQaiAALQABEAEgAyACOgAAIAYgBUEQaiAHEAJBAXRqIgAtAAAhAiAFQRBqIAAtAAEQASADIAI6AAEgA0ECaiEDDAELCwNAIAVBEGoQBCADIA5PckUEQCAGIAVBEGogBxACQQF0aiIALQAAIQIgBUEQaiAALQABEAEgAyACOgAAIANBAWohAwwBCwsDQCADIA5JBEAgBiAFQRBqIAcQAkEBdGoiAC0AACECIAVBEGogAC0AARABIAMgAjoAACADQQFqIQMMAQsLIAFBbCAFQdgAahAKIAVBQGsQCnEgBUEoahAKcSAFQRBqEApxGyEJDAELQWwhCQsgBUHwAGokACAJC8oCAQR/IwBBIGsiBSQAIAUgBBAOIAUtAAIhByAFQQhqIAIgAxAGIgIQA0UEQCAEQQRqIQIgACABaiIDQX1qIQQDQCAFQQhqEAQgACAET3JFBEAgAiAFQQhqIAcQAkEBdGoiBi0AACEIIAVBCGogBi0AARABIAAgCDoAACACIAVBCGogBxACQQF0aiIGLQAAIQggBUEIaiAGLQABEAEgACAIOgABIABBAmohAAwBCwsDQCAFQQhqEAQgACADT3JFBEAgAiAFQQhqIAcQAkEBdGoiBC0AACEGIAVBCGogBC0AARABIAAgBjoAACAAQQFqIQAMAQsLA0AgACADT0UEQCACIAVBCGogBxACQQF0aiIELQAAIQYgBUEIaiAELQABEAEgACAGOgAAIABBAWohAAwBCwsgAUFsIAVBCGoQChshAgsgBUEgaiQAIAILtgMBCX8jAEEQayIGJAAgBkEANgIMIAZBADYCCEFUIQQCQAJAIANBQGsiDCADIAZBCGogBkEMaiABIAIQMSICEAMNACAGQQRqIAAQDiAGKAIMIgcgBi0ABEEBaksNASAAQQRqIQogBkEAOgAFIAYgBzoABiAAIAYoAgQ2AgAgB0EBaiEJQQEhBANAIAQgCUkEQCADIARBAnRqIgEoAgAhACABIAU2AgAgACAEQX9qdCAFaiEFIARBAWohBAwBCwsgB0EBaiEHQQAhBSAGKAIIIQkDQCAFIAlGDQEgAyAFIAxqLQAAIgRBAnRqIgBBASAEdEEBdSILIAAoAgAiAWoiADYCACAHIARrIQhBACEEAkAgC0EDTQRAA0AgBCALRg0CIAogASAEakEBdGoiACAIOgABIAAgBToAACAEQQFqIQQMAAALAAsDQCABIABPDQEgCiABQQF0aiIEIAg6AAEgBCAFOgAAIAQgCDoAAyAEIAU6AAIgBCAIOgAFIAQgBToABCAEIAg6AAcgBCAFOgAGIAFBBGohAQwAAAsACyAFQQFqIQUMAAALAAsgAiEECyAGQRBqJAAgBAutAQECfwJAQYQgKAIAIABHIAAoAgBBAXYiAyABa0F4aiICQXhxQQhHcgR/IAIFIAMQJ0UNASACQQhqC0EQSQ0AIAAgACgCACICQQFxIAAgAWpBD2pBeHEiASAAa0EBdHI2AgAgASAANgIEIAEgASgCAEEBcSAAIAJBAXZqIAFrIgJBAXRyNgIAQYQgIAEgAkH/////B3FqQQRqQYQgKAIAIABGGyABNgIAIAEQJQsLygIBBX8CQAJAAkAgAEEIIABBCEsbZ0EfcyAAaUEBR2oiAUEESSAAIAF2cg0AIAFBAnRB/B5qKAIAIgJFDQADQCACQXhqIgMoAgBBAXZBeGoiBSAATwRAIAIgBUEIIAVBCEsbZ0Efc0ECdEGAH2oiASgCAEYEQCABIAIoAgQ2AgALDAMLIARBHksNASAEQQFqIQQgAigCBCICDQALC0EAIQMgAUEgTw0BA0AgAUECdEGAH2ooAgAiAkUEQCABQR5LIQIgAUEBaiEBIAJFDQEMAwsLIAIgAkF4aiIDKAIAQQF2QXhqIgFBCCABQQhLG2dBH3NBAnRBgB9qIgEoAgBGBEAgASACKAIENgIACwsgAigCACIBBEAgASACKAIENgIECyACKAIEIgEEQCABIAIoAgA2AgALIAMgAygCAEEBcjYCACADIAAQNwsgAwvhCwINfwV+IwBB8ABrIgckACAHIAAoAvDhASIINgJcIAEgAmohDSAIIAAoAoDiAWohDwJAAkAgBUUEQCABIQQMAQsgACgCxOABIRAgACgCwOABIREgACgCvOABIQ4gAEEBNgKM4QFBACEIA0AgCEEDRwRAIAcgCEECdCICaiAAIAJqQazQAWooAgA2AkQgCEEBaiEIDAELC0FsIQwgB0EYaiADIAQQBhADDQEgB0EsaiAHQRhqIAAoAgAQEyAHQTRqIAdBGGogACgCCBATIAdBPGogB0EYaiAAKAIEEBMgDUFgaiESIAEhBEEAIQwDQCAHKAIwIAcoAixBA3RqKQIAIhRCEIinQf8BcSEIIAcoAkAgBygCPEEDdGopAgAiFUIQiKdB/wFxIQsgBygCOCAHKAI0QQN0aikCACIWQiCIpyEJIBVCIIghFyAUQiCIpyECAkAgFkIQiKdB/wFxIgNBAk8EQAJAIAZFIANBGUlyRQRAIAkgB0EYaiADQSAgBygCHGsiCiAKIANLGyIKEAUgAyAKayIDdGohCSAHQRhqEAQaIANFDQEgB0EYaiADEAUgCWohCQwBCyAHQRhqIAMQBSAJaiEJIAdBGGoQBBoLIAcpAkQhGCAHIAk2AkQgByAYNwNIDAELAkAgA0UEQCACBEAgBygCRCEJDAMLIAcoAkghCQwBCwJAAkAgB0EYakEBEAUgCSACRWpqIgNBA0YEQCAHKAJEQX9qIgMgA0VqIQkMAQsgA0ECdCAHaigCRCIJIAlFaiEJIANBAUYNAQsgByAHKAJINgJMCwsgByAHKAJENgJIIAcgCTYCRAsgF6chAyALBEAgB0EYaiALEAUgA2ohAwsgCCALakEUTwRAIAdBGGoQBBoLIAgEQCAHQRhqIAgQBSACaiECCyAHQRhqEAQaIAcgB0EYaiAUQhiIp0H/AXEQCCAUp0H//wNxajYCLCAHIAdBGGogFUIYiKdB/wFxEAggFadB//8DcWo2AjwgB0EYahAEGiAHIAdBGGogFkIYiKdB/wFxEAggFqdB//8DcWo2AjQgByACNgJgIAcoAlwhCiAHIAk2AmggByADNgJkAkACQAJAIAQgAiADaiILaiASSw0AIAIgCmoiEyAPSw0AIA0gBGsgC0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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", nr = new Va();
class ja extends dA {
  constructor(e) {
    super(), this.planarConfiguration = typeof e.PlanarConfiguration < "u" ? e.PlanarConfiguration : 1, this.samplesPerPixel = typeof e.SamplesPerPixel < "u" ? e.SamplesPerPixel : 1, this.addCompression = e.LercParameters[yi.AddCompression];
  }
  decodeBlock(e) {
    switch (this.addCompression) {
      case Be.None:
        break;
      case Be.Deflate:
        e = ir(new Uint8Array(e)).buffer;
        break;
      case Be.Zstandard:
        e = nr.decode(new Uint8Array(e)).buffer;
        break;
      default:
        throw new Error(`Unsupported LERC additional compression method identifier: ${this.addCompression}`);
    }
    return Pa.decode(e, { returnPixelInterleavedDims: this.planarConfiguration === 1 }).pixels[0].buffer;
  }
}
const Xa = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ja,
  zstd: nr
}, Symbol.toStringTag, { value: "Module" }));
class Wa extends dA {
  constructor() {
    if (super(), typeof createImageBitmap > "u")
      throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");
    if (typeof document > "u" && typeof OffscreenCanvas > "u")
      throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");
  }
  async decode(e, A) {
    const i = new Blob([A]), n = await createImageBitmap(i);
    let o;
    typeof document < "u" ? (o = document.createElement("canvas"), o.width = n.width, o.height = n.height) : o = new OffscreenCanvas(n.width, n.height);
    const I = o.getContext("2d");
    return I.drawImage(n, 0, 0), I.getImageData(0, 0, n.width, n.height).data.buffer;
  }
}
const Za = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: Wa
}, Symbol.toStringTag, { value: "Module" })), za = Worker;
function $a() {
  const t = 'function A(A,e,t,i,r,I,g){try{var n=A[I](g),a=n.value}catch(A){return void t(A)}n.done?e(a):Promise.resolve(a).then(i,r)}function e(e){return function(){var t=this,i=arguments;return new Promise((function(r,I){var g=e.apply(t,i);function n(e){A(g,r,I,n,a,"next",e)}function a(e){A(g,r,I,n,a,"throw",e)}n(void 0)}))}}function t(A){return t="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(A){return typeof A}:function(A){return A&&"function"==typeof Symbol&&A.constructor===Symbol&&A!==Symbol.prototype?"symbol":typeof A},t(A)}var i={exports:{}};!function(A){var e=function(A){var e,i=Object.prototype,r=i.hasOwnProperty,I="function"==typeof Symbol?Symbol:{},g=I.iterator||"@@iterator",n=I.asyncIterator||"@@asyncIterator",a=I.toStringTag||"@@toStringTag";function o(A,e,t){return Object.defineProperty(A,e,{value:t,enumerable:!0,configurable:!0,writable:!0}),A[e]}try{o({},"")}catch(A){o=function(A,e,t){return A[e]=t}}function B(A,e,t,i){var r=e&&e.prototype instanceof h?e:h,I=Object.create(r.prototype),g=new S(i||[]);return I._invoke=function(A,e,t){var i=Q;return function(r,I){if(i===s)throw new Error("Generator is already running");if(i===f){if("throw"===r)throw I;return R()}for(t.method=r,t.arg=I;;){var g=t.delegate;if(g){var n=m(g,t);if(n){if(n===c)continue;return n}}if("next"===t.method)t.sent=t._sent=t.arg;else if("throw"===t.method){if(i===Q)throw i=f,t.arg;t.dispatchException(t.arg)}else"return"===t.method&&t.abrupt("return",t.arg);i=s;var a=C(A,e,t);if("normal"===a.type){if(i=t.done?f:E,a.arg===c)continue;return{value:a.arg,done:t.done}}"throw"===a.type&&(i=f,t.method="throw",t.arg=a.arg)}}}(A,t,g),I}function C(A,e,t){try{return{type:"normal",arg:A.call(e,t)}}catch(A){return{type:"throw",arg:A}}}A.wrap=B;var Q="suspendedStart",E="suspendedYield",s="executing",f="completed",c={};function h(){}function l(){}function u(){}var w={};o(w,g,(function(){return this}));var d=Object.getPrototypeOf,D=d&&d(d(v([])));D&&D!==i&&r.call(D,g)&&(w=D);var y=u.prototype=h.prototype=Object.create(w);function k(A){["next","throw","return"].forEach((function(e){o(A,e,(function(A){return this._invoke(e,A)}))}))}function p(A,e){function i(I,g,n,a){var o=C(A[I],A,g);if("throw"!==o.type){var B=o.arg,Q=B.value;return Q&&"object"===t(Q)&&r.call(Q,"__await")?e.resolve(Q.__await).then((function(A){i("next",A,n,a)}),(function(A){i("throw",A,n,a)})):e.resolve(Q).then((function(A){B.value=A,n(B)}),(function(A){return i("throw",A,n,a)}))}a(o.arg)}var I;this._invoke=function(A,t){function r(){return new e((function(e,r){i(A,t,e,r)}))}return I=I?I.then(r,r):r()}}function m(A,t){var i=A.iterator[t.method];if(i===e){if(t.delegate=null,"throw"===t.method){if(A.iterator.return&&(t.method="return",t.arg=e,m(A,t),"throw"===t.method))return c;t.method="throw",t.arg=new TypeError("The iterator does not provide a \'throw\' method")}return c}var r=C(i,A.iterator,t.arg);if("throw"===r.type)return t.method="throw",t.arg=r.arg,t.delegate=null,c;var I=r.arg;return I?I.done?(t[A.resultName]=I.value,t.next=A.nextLoc,"return"!==t.method&&(t.method="next",t.arg=e),t.delegate=null,c):I:(t.method="throw",t.arg=new TypeError("iterator result is not an object"),t.delegate=null,c)}function G(A){var e={tryLoc:A[0]};1 in A&&(e.catchLoc=A[1]),2 in A&&(e.finallyLoc=A[2],e.afterLoc=A[3]),this.tryEntries.push(e)}function F(A){var e=A.completion||{};e.type="normal",delete e.arg,A.completion=e}function S(A){this.tryEntries=[{tryLoc:"root"}],A.forEach(G,this),this.reset(!0)}function v(A){if(A){var t=A[g];if(t)return t.call(A);if("function"==typeof A.next)return A;if(!isNaN(A.length)){var i=-1,I=function t(){for(;++i<A.length;)if(r.call(A,i))return t.value=A[i],t.done=!1,t;return t.value=e,t.done=!0,t};return I.next=I}}return{next:R}}function R(){return{value:e,done:!0}}return l.prototype=u,o(y,"constructor",u),o(u,"constructor",l),l.displayName=o(u,a,"GeneratorFunction"),A.isGeneratorFunction=function(A){var e="function"==typeof A&&A.constructor;return!!e&&(e===l||"GeneratorFunction"===(e.displayName||e.name))},A.mark=function(A){return Object.setPrototypeOf?Object.setPrototypeOf(A,u):(A.__proto__=u,o(A,a,"GeneratorFunction")),A.prototype=Object.create(y),A},A.awrap=function(A){return{__await:A}},k(p.prototype),o(p.prototype,n,(function(){return this})),A.AsyncIterator=p,A.async=function(e,t,i,r,I){void 0===I&&(I=Promise);var g=new p(B(e,t,i,r),I);return A.isGeneratorFunction(t)?g:g.next().then((function(A){return A.done?A.value:g.next()}))},k(y),o(y,a,"Generator"),o(y,g,(function(){return this})),o(y,"toString",(function(){return"[object Generator]"})),A.keys=function(A){var e=[];for(var t in A)e.push(t);return e.reverse(),function t(){for(;e.length;){var i=e.pop();if(i in A)return t.value=i,t.done=!1,t}return t.done=!0,t}},A.values=v,S.prototype={constructor:S,reset:function(A){if(this.prev=0,this.next=0,this.sent=this._sent=e,this.done=!1,this.delegate=null,this.method="next",this.arg=e,this.tryEntries.forEach(F),!A)for(var t in this)"t"===t.charAt(0)&&r.call(this,t)&&!isNaN(+t.slice(1))&&(this[t]=e)},stop:function(){this.done=!0;var A=this.tryEntries[0].completion;if("throw"===A.type)throw A.arg;return this.rval},dispatchException:function(A){if(this.done)throw A;var t=this;function i(i,r){return n.type="throw",n.arg=A,t.next=i,r&&(t.method="next",t.arg=e),!!r}for(var I=this.tryEntries.length-1;I>=0;--I){var g=this.tryEntries[I],n=g.completion;if("root"===g.tryLoc)return i("end");if(g.tryLoc<=this.prev){var a=r.call(g,"catchLoc"),o=r.call(g,"finallyLoc");if(a&&o){if(this.prev<g.catchLoc)return i(g.catchLoc,!0);if(this.prev<g.finallyLoc)return i(g.finallyLoc)}else if(a){if(this.prev<g.catchLoc)return i(g.catchLoc,!0)}else{if(!o)throw new Error("try statement without catch or finally");if(this.prev<g.finallyLoc)return i(g.finallyLoc)}}}},abrupt:function(A,e){for(var t=this.tryEntries.length-1;t>=0;--t){var i=this.tryEntries[t];if(i.tryLoc<=this.prev&&r.call(i,"finallyLoc")&&this.prev<i.finallyLoc){var I=i;break}}I&&("break"===A||"continue"===A)&&I.tryLoc<=e&&e<=I.finallyLoc&&(I=null);var g=I?I.completion:{};return g.type=A,g.arg=e,I?(this.method="next",this.next=I.finallyLoc,c):this.complete(g)},complete:function(A,e){if("throw"===A.type)throw A.arg;return"break"===A.type||"continue"===A.type?this.next=A.arg:"return"===A.type?(this.rval=this.arg=A.arg,this.method="return",this.next="end"):"normal"===A.type&&e&&(this.next=e),c},finish:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.finallyLoc===A)return this.complete(t.completion,t.afterLoc),F(t),c}},catch:function(A){for(var e=this.tryEntries.length-1;e>=0;--e){var t=this.tryEntries[e];if(t.tryLoc===A){var i=t.completion;if("throw"===i.type){var r=i.arg;F(t)}return r}}throw new Error("illegal catch attempt")},delegateYield:function(A,t,i){return this.delegate={iterator:v(A),resultName:t,nextLoc:i},"next"===this.method&&(this.arg=e),c}},A}(A.exports);try{regeneratorRuntime=e}catch(A){"object"===("undefined"==typeof globalThis?"undefined":t(globalThis))?globalThis.regeneratorRuntime=e:Function("r","regeneratorRuntime = r")(e)}}(i);var r=i.exports,I=new Map;function g(A,e){Array.isArray(A)||(A=[A]),A.forEach((function(A){return I.set(A,e)}))}function n(A){return a.apply(this,arguments)}function a(){return(a=e(r.mark((function A(e){var t,i;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:if(t=I.get(e.Compression)){A.next=3;break}throw new Error("Unknown compression method identifier: ".concat(e.Compression));case 3:return A.next=5,t();case 5:return i=A.sent,A.abrupt("return",new i(e));case 7:case"end":return A.stop()}}),A)})))).apply(this,arguments)}g([void 0,1],(function(){return Promise.resolve().then((function(){return y})).then((function(A){return A.default}))})),g(5,(function(){return Promise.resolve().then((function(){return F})).then((function(A){return A.default}))})),g(6,(function(){throw new Error("old style JPEG compression is not supported.")})),g(7,(function(){return Promise.resolve().then((function(){return N})).then((function(A){return A.default}))})),g([8,32946],(function(){return Promise.resolve().then((function(){return OA})).then((function(A){return A.default}))})),g(32773,(function(){return Promise.resolve().then((function(){return _A})).then((function(A){return A.default}))})),g(34887,(function(){return Promise.resolve().then((function(){return le})).then(function(){var A=e(r.mark((function A(e){return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,e.zstd.init();case 2:return A.abrupt("return",e);case 3:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}()).then((function(A){return A.default}))})),g(50001,(function(){return Promise.resolve().then((function(){return de})).then((function(A){return A.default}))}));var o=globalThis;function B(A,e){if(!(A instanceof e))throw new TypeError("Cannot call a class as a function")}function C(A,e){for(var t=0;t<e.length;t++){var i=e[t];i.enumerable=i.enumerable||!1,i.configurable=!0,"value"in i&&(i.writable=!0),Object.defineProperty(A,i.key,i)}}function Q(A,e,t){return e&&C(A.prototype,e),t&&C(A,t),A}function E(A,e){return E=Object.setPrototypeOf||function(A,e){return A.__proto__=e,A},E(A,e)}function s(A,e){if("function"!=typeof e&&null!==e)throw new TypeError("Super expression must either be null or a function");A.prototype=Object.create(e&&e.prototype,{constructor:{value:A,writable:!0,configurable:!0}}),e&&E(A,e)}function f(A,e){if(e&&("object"===t(e)||"function"==typeof e))return e;if(void 0!==e)throw new TypeError("Derived constructors may only return object or undefined");return function(A){if(void 0===A)throw new ReferenceError("this hasn\'t been initialised - super() hasn\'t been called");return A}(A)}function c(A){return c=Object.setPrototypeOf?Object.getPrototypeOf:function(A){return A.__proto__||Object.getPrototypeOf(A)},c(A)}function h(A,e){var t=A.length-e,i=0;do{for(var r=e;r>0;r--)A[i+e]+=A[i],i++;t-=e}while(t>0)}function l(A,e,t){for(var i=0,r=A.length,I=r/t;r>e;){for(var g=e;g>0;--g)A[i+e]+=A[i],++i;r-=e}for(var n=A.slice(),a=0;a<I;++a)for(var o=0;o<t;++o)A[t*a+o]=n[(t-o-1)*I+a]}function u(A,e,t,i,r,I){if(!e||1===e)return A;for(var g=0;g<r.length;++g){if(r[g]%8!=0)throw new Error("When decoding with predictor, only multiple of 8 bits are supported.");if(r[g]!==r[0])throw new Error("When decoding with predictor, all samples must have the same size.")}for(var n=r[0]/8,a=2===I?1:r.length,o=0;o<i&&!(o*a*t*n>=A.byteLength);++o){var B=void 0;if(2===e){switch(r[0]){case 8:B=new Uint8Array(A,o*a*t*n,a*t*n);break;case 16:B=new Uint16Array(A,o*a*t*n,a*t*n/2);break;case 32:B=new Uint32Array(A,o*a*t*n,a*t*n/4);break;default:throw new Error("Predictor 2 not allowed with ".concat(r[0]," bits per sample."))}h(B,a)}else 3===e&&l(B=new Uint8Array(A,o*a*t*n,a*t*n),a,n)}return A}o.addEventListener("message",function(){var A=e(r.mark((function A(e){var t,i,I,g,a,B;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return t=e.data,i=t.id,I=t.fileDirectory,g=t.buffer,A.next=3,n(I);case 3:return a=A.sent,A.next=6,a.decode(I,g);case 6:B=A.sent,o.postMessage({decoded:B,id:i},[B]);case 8:case"end":return A.stop()}}),A)})));return function(e){return A.apply(this,arguments)}}());var w=function(){function A(){B(this,A)}var t;return Q(A,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n,a;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return A.next=2,this.decodeBlock(t);case 2:if(i=A.sent,1===(I=e.Predictor||1)){A.next=9;break}return g=!e.StripOffsets,n=g?e.TileWidth:e.ImageWidth,a=g?e.TileLength:e.RowsPerStrip||e.ImageLength,A.abrupt("return",u(i,I,n,a,e.BitsPerSample,e.PlanarConfiguration));case 9:return A.abrupt("return",i);case 10:case"end":return A.stop()}}),A,this)}))),function(A,e){return t.apply(this,arguments)})}]),A}();function d(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var D=function(A){s(t,w);var e=d(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return A}}]),t}(),y=Object.freeze({__proto__:null,default:D});function k(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}function p(A,e){for(var t=e.length-1;t>=0;t--)A.push(e[t]);return A}function m(A){for(var e=new Uint16Array(4093),t=new Uint8Array(4093),i=0;i<=257;i++)e[i]=4096,t[i]=i;var r=258,I=9,g=0;function n(){r=258,I=9}function a(A){var e=function(A,e,t){var i=e%8,r=Math.floor(e/8),I=8-i,g=e+t-8*(r+1),n=8*(r+2)-(e+t),a=8*(r+2)-e;if(n=Math.max(0,n),r>=A.length)return console.warn("ran off the end of the buffer before finding EOI_CODE (end on input code)"),257;var o=A[r]&Math.pow(2,8-i)-1,B=o<<=t-I;if(r+1<A.length){var C=A[r+1]>>>n;B+=C<<=Math.max(0,t-a)}if(g>8&&r+2<A.length){var Q=8*(r+3)-(e+t);B+=A[r+2]>>>Q}return B}(A,g,I);return g+=I,e}function o(A,i){return t[r]=i,e[r]=A,++r-1}function B(A){for(var i=[],r=A;4096!==r;r=e[r])i.push(t[r]);return i}var C=[];n();for(var Q,E=new Uint8Array(A),s=a(E);257!==s;){if(256===s){for(n(),s=a(E);256===s;)s=a(E);if(257===s)break;if(s>256)throw new Error("corrupted code at scanline ".concat(s));p(C,B(s)),Q=s}else if(s<r){var f=B(s);p(C,f),o(Q,f[f.length-1]),Q=s}else{var c=B(Q);if(!c)throw new Error("Bogus entry. Not in dictionary, ".concat(Q," / ").concat(r,", position: ").concat(g));p(C,c),C.push(c[c.length-1]),o(Q,c[c.length-1]),Q=s}r+1>=Math.pow(2,I)&&(12===I?Q=void 0:I++),s=a(E)}return new Uint8Array(C)}var G=function(A){s(t,w);var e=k(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return m(A).buffer}}]),t}(),F=Object.freeze({__proto__:null,default:G});function S(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var v=new Int32Array([0,1,8,16,9,2,3,10,17,24,32,25,18,11,4,5,12,19,26,33,40,48,41,34,27,20,13,6,7,14,21,28,35,42,49,56,57,50,43,36,29,22,15,23,30,37,44,51,58,59,52,45,38,31,39,46,53,60,61,54,47,55,62,63]);function R(A,e){for(var t=0,i=[],r=16;r>0&&!A[r-1];)--r;i.push({children:[],index:0});for(var I,g=i[0],n=0;n<r;n++){for(var a=0;a<A[n];a++){for((g=i.pop()).children[g.index]=e[t];g.index>0;)g=i.pop();for(g.index++,i.push(g);i.length<=n;)i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I;t++}n+1<r&&(i.push(I={children:[],index:0}),g.children[g.index]=I.children,g=I)}return i[0].children}function U(A,e,i,r,I,g,n,a,o){var B=i.mcusPerLine,C=i.progressive,Q=e,E=e,s=0,f=0;function c(){if(f>0)return f--,s>>f&1;if(255===(s=A[E++])){var e=A[E++];if(e)throw new Error("unexpected marker: ".concat((s<<8|e).toString(16)))}return f=7,s>>>7}function h(A){for(var e,i=A;null!==(e=c());){if("number"==typeof(i=i[e]))return i;if("object"!==t(i))throw new Error("invalid huffman sequence")}return null}function l(A){for(var e=A,t=0;e>0;){var i=c();if(null===i)return;t=t<<1|i,--e}return t}function u(A){var e=l(A);return e>=1<<A-1?e:e+(-1<<A)+1}var w=0;var d,D=0;function y(A,e,t,i,r){var I=t%B,g=(t/B|0)*A.v+i,n=I*A.h+r;e(A,A.blocks[g][n])}function k(A,e,t){var i=t/A.blocksPerLine|0,r=t%A.blocksPerLine;e(A,A.blocks[i][r])}var p,m,G,F,S,R,U=r.length;R=C?0===g?0===a?function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t)<<o;A.pred+=i,e[0]=A.pred}:function(A,e){e[0]|=c()<<o}:0===a?function(A,e){if(w>0)w--;else for(var t=g,i=n;t<=i;){var r=h(A.huffmanTableAC),I=15&r,a=r>>4;if(0===I){if(a<15){w=l(a)+(1<<a)-1;break}t+=16}else e[v[t+=a]]=u(I)*(1<<o),t++}}:function(A,e){for(var t=g,i=n,r=0;t<=i;){var I=v[t],a=e[I]<0?-1:1;switch(D){case 0:var B=h(A.huffmanTableAC),C=15&B;if(r=B>>4,0===C)r<15?(w=l(r)+(1<<r),D=4):(r=16,D=1);else{if(1!==C)throw new Error("invalid ACn encoding");d=u(C),D=r?2:3}continue;case 1:case 2:e[I]?e[I]+=(c()<<o)*a:0==--r&&(D=2===D?3:0);break;case 3:e[I]?e[I]+=(c()<<o)*a:(e[I]=d<<o,D=0);break;case 4:e[I]&&(e[I]+=(c()<<o)*a)}t++}4===D&&0==--w&&(D=0)}:function(A,e){var t=h(A.huffmanTableDC),i=0===t?0:u(t);A.pred+=i,e[0]=A.pred;for(var r=1;r<64;){var I=h(A.huffmanTableAC),g=15&I,n=I>>4;if(0===g){if(n<15)break;r+=16}else e[v[r+=n]]=u(g),r++}};var L,b,M=0;b=1===U?r[0].blocksPerLine*r[0].blocksPerColumn:B*i.mcusPerColumn;for(var N=I||b;M<b;){for(m=0;m<U;m++)r[m].pred=0;if(w=0,1===U)for(p=r[0],S=0;S<N;S++)k(p,R,M),M++;else for(S=0;S<N;S++){for(m=0;m<U;m++){var x=p=r[m],J=x.h,q=x.v;for(G=0;G<q;G++)for(F=0;F<J;F++)y(p,R,M,G,F)}if(++M===b)break}if(f=0,(L=A[E]<<8|A[E+1])<65280)throw new Error("marker was not found");if(!(L>=65488&&L<=65495))break;E+=2}return E-Q}function L(A,e){var t=[],i=e.blocksPerLine,r=e.blocksPerColumn,I=i<<3,g=new Int32Array(64),n=new Uint8Array(64);function a(A,t,i){var r,I,g,n,a,o,B,C,Q,E,s=e.quantizationTable,f=i;for(E=0;E<64;E++)f[E]=A[E]*s[E];for(E=0;E<8;++E){var c=8*E;0!==f[1+c]||0!==f[2+c]||0!==f[3+c]||0!==f[4+c]||0!==f[5+c]||0!==f[6+c]||0!==f[7+c]?(r=5793*f[0+c]+128>>8,I=5793*f[4+c]+128>>8,g=f[2+c],n=f[6+c],a=2896*(f[1+c]-f[7+c])+128>>8,C=2896*(f[1+c]+f[7+c])+128>>8,o=f[3+c]<<4,Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+128>>8,g=1567*g-3784*n+128>>8,n=Q,Q=a-(B=f[5+c]<<4)+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+c]=r+C,f[7+c]=r-C,f[1+c]=I+B,f[6+c]=I-B,f[2+c]=g+o,f[5+c]=g-o,f[3+c]=n+a,f[4+c]=n-a):(Q=5793*f[0+c]+512>>10,f[0+c]=Q,f[1+c]=Q,f[2+c]=Q,f[3+c]=Q,f[4+c]=Q,f[5+c]=Q,f[6+c]=Q,f[7+c]=Q)}for(E=0;E<8;++E){var h=E;0!==f[8+h]||0!==f[16+h]||0!==f[24+h]||0!==f[32+h]||0!==f[40+h]||0!==f[48+h]||0!==f[56+h]?(r=5793*f[0+h]+2048>>12,I=5793*f[32+h]+2048>>12,g=f[16+h],n=f[48+h],a=2896*(f[8+h]-f[56+h])+2048>>12,C=2896*(f[8+h]+f[56+h])+2048>>12,o=f[24+h],Q=r-I+1>>1,r=r+I+1>>1,I=Q,Q=3784*g+1567*n+2048>>12,g=1567*g-3784*n+2048>>12,n=Q,Q=a-(B=f[40+h])+1>>1,a=a+B+1>>1,B=Q,Q=C+o+1>>1,o=C-o+1>>1,C=Q,Q=r-n+1>>1,r=r+n+1>>1,n=Q,Q=I-g+1>>1,I=I+g+1>>1,g=Q,Q=2276*a+3406*C+2048>>12,a=3406*a-2276*C+2048>>12,C=Q,Q=799*o+4017*B+2048>>12,o=4017*o-799*B+2048>>12,B=Q,f[0+h]=r+C,f[56+h]=r-C,f[8+h]=I+B,f[48+h]=I-B,f[16+h]=g+o,f[40+h]=g-o,f[24+h]=n+a,f[32+h]=n-a):(Q=5793*i[E+0]+8192>>14,f[0+h]=Q,f[8+h]=Q,f[16+h]=Q,f[24+h]=Q,f[32+h]=Q,f[40+h]=Q,f[48+h]=Q,f[56+h]=Q)}for(E=0;E<64;++E){var l=128+(f[E]+8>>4);t[E]=l<0?0:l>255?255:l}}for(var o=0;o<r;o++){for(var B=o<<3,C=0;C<8;C++)t.push(new Uint8Array(I));for(var Q=0;Q<i;Q++){a(e.blocks[o][Q],n,g);for(var E=0,s=Q<<3,f=0;f<8;f++)for(var c=t[B+f],h=0;h<8;h++)c[s+h]=n[E++]}}return t}var b=function(){function A(){B(this,A),this.jfif=null,this.adobe=null,this.quantizationTables=[],this.huffmanTablesAC=[],this.huffmanTablesDC=[],this.resetFrames()}return Q(A,[{key:"resetFrames",value:function(){this.frames=[]}},{key:"parse",value:function(A){var e=0;function t(){var t=A[e]<<8|A[e+1];return e+=2,t}function i(A){var e,t,i=0,r=0;for(t in A.components)A.components.hasOwnProperty(t)&&(i<(e=A.components[t]).h&&(i=e.h),r<e.v&&(r=e.v));var I=Math.ceil(A.samplesPerLine/8/i),g=Math.ceil(A.scanLines/8/r);for(t in A.components)if(A.components.hasOwnProperty(t)){e=A.components[t];for(var n=Math.ceil(Math.ceil(A.samplesPerLine/8)*e.h/i),a=Math.ceil(Math.ceil(A.scanLines/8)*e.v/r),o=I*e.h,B=g*e.v,C=[],Q=0;Q<B;Q++){for(var E=[],s=0;s<o;s++)E.push(new Int32Array(64));C.push(E)}e.blocksPerLine=n,e.blocksPerColumn=a,e.blocks=C}A.maxH=i,A.maxV=r,A.mcusPerLine=I,A.mcusPerColumn=g}var r,I,g=t();if(65496!==g)throw new Error("SOI not found");for(g=t();65497!==g;){switch(g){case 65280:break;case 65504:case 65505:case 65506:case 65507:case 65508:case 65509:case 65510:case 65511:case 65512:case 65513:case 65514:case 65515:case 65516:case 65517:case 65518:case 65519:case 65534:var n=(r=void 0,I=void 0,r=t(),I=A.subarray(e,e+r-2),e+=I.length,I);65504===g&&74===n[0]&&70===n[1]&&73===n[2]&&70===n[3]&&0===n[4]&&(this.jfif={version:{major:n[5],minor:n[6]},densityUnits:n[7],xDensity:n[8]<<8|n[9],yDensity:n[10]<<8|n[11],thumbWidth:n[12],thumbHeight:n[13],thumbData:n.subarray(14,14+3*n[12]*n[13])}),65518===g&&65===n[0]&&100===n[1]&&111===n[2]&&98===n[3]&&101===n[4]&&0===n[5]&&(this.adobe={version:n[6],flags0:n[7]<<8|n[8],flags1:n[9]<<8|n[10],transformCode:n[11]});break;case 65499:for(var a=t()+e-2;e<a;){var o=A[e++],B=new Int32Array(64);if(o>>4==0)for(var C=0;C<64;C++){B[v[C]]=A[e++]}else{if(o>>4!=1)throw new Error("DQT: invalid table spec");for(var Q=0;Q<64;Q++){B[v[Q]]=t()}}this.quantizationTables[15&o]=B}break;case 65472:case 65473:case 65474:t();for(var E={extended:65473===g,progressive:65474===g,precision:A[e++],scanLines:t(),samplesPerLine:t(),components:{},componentsOrder:[]},s=A[e++],f=void 0,c=0;c<s;c++){f=A[e];var h=A[e+1]>>4,l=15&A[e+1],u=A[e+2];E.componentsOrder.push(f),E.components[f]={h:h,v:l,quantizationIdx:u},e+=3}i(E),this.frames.push(E);break;case 65476:for(var w=t(),d=2;d<w;){for(var D=A[e++],y=new Uint8Array(16),k=0,p=0;p<16;p++,e++)y[p]=A[e],k+=y[p];for(var m=new Uint8Array(k),G=0;G<k;G++,e++)m[G]=A[e];d+=17+k,D>>4==0?this.huffmanTablesDC[15&D]=R(y,m):this.huffmanTablesAC[15&D]=R(y,m)}break;case 65501:t(),this.resetInterval=t();break;case 65498:t();for(var F=A[e++],S=[],L=this.frames[0],b=0;b<F;b++){var M=L.components[A[e++]],N=A[e++];M.huffmanTableDC=this.huffmanTablesDC[N>>4],M.huffmanTableAC=this.huffmanTablesAC[15&N],S.push(M)}var x=A[e++],J=A[e++],q=A[e++],Y=U(A,e,L,S,this.resetInterval,x,J,q>>4,15&q);e+=Y;break;case 65535:255!==A[e]&&e--;break;default:if(255===A[e-3]&&A[e-2]>=192&&A[e-2]<=254){e-=3;break}throw new Error("unknown JPEG marker ".concat(g.toString(16)))}g=t()}}},{key:"getResult",value:function(){var A=this.frames;if(0===this.frames.length)throw new Error("no frames were decoded");this.frames.length>1&&console.warn("more than one frame is not supported");for(var e=0;e<this.frames.length;e++)for(var t=this.frames[e].components,i=0,r=Object.keys(t);i<r.length;i++){var I=r[i];t[I].quantizationTable=this.quantizationTables[t[I].quantizationIdx],delete t[I].quantizationIdx}for(var g=A[0],n=g.components,a=g.componentsOrder,o=[],B=g.samplesPerLine,C=g.scanLines,Q=0;Q<a.length;Q++){var E=n[a[Q]];o.push({lines:L(0,E),scaleX:E.h/g.maxH,scaleY:E.v/g.maxV})}for(var s=new Uint8Array(B*C*o.length),f=0,c=0;c<C;++c)for(var h=0;h<B;++h)for(var l=0;l<o.length;++l){var u=o[l];s[f]=u.lines[0|c*u.scaleY][0|h*u.scaleX],++f}return s}}]),A}(),M=function(A){s(t,w);var e=S(t);function t(A){var i;return B(this,t),(i=e.call(this)).reader=new b,A.JPEGTables&&i.reader.parse(A.JPEGTables),i}return Q(t,[{key:"decodeBlock",value:function(A){return this.reader.resetFrames(),this.reader.parse(new Uint8Array(A)),this.reader.getResult().buffer}}]),t}(),N=Object.freeze({__proto__:null,default:M});function x(A){for(var e=A.length;--e>=0;)A[e]=0}x(new Array(576)),x(new Array(60)),x(new Array(512)),x(new Array(256)),x(new Array(29)),x(new Array(30));var J=function(A,e,t,i){for(var r=65535&A|0,I=A>>>16&65535|0,g=0;0!==t;){t-=g=t>2e3?2e3:t;do{I=I+(r=r+e[i++]|0)|0}while(--g);r%=65521,I%=65521}return r|I<<16|0},q=new Uint32Array(function(){for(var A,e=[],t=0;t<256;t++){A=t;for(var i=0;i<8;i++)A=1&A?3988292384^A>>>1:A>>>1;e[t]=A}return e}()),Y=function(A,e,t,i){var r=q,I=i+t;A^=-1;for(var g=i;g<I;g++)A=A>>>8^r[255&(A^e[g])];return-1^A},K={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"},H={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_MEM_ERROR:-4,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8},O=function(A,e){return Object.prototype.hasOwnProperty.call(A,e)},P=function(A){for(var e=Array.prototype.slice.call(arguments,1);e.length;){var i=e.shift();if(i){if("object"!==t(i))throw new TypeError(i+"must be non-object");for(var r in i)O(i,r)&&(A[r]=i[r])}}return A},T=function(A){for(var e=0,t=0,i=A.length;t<i;t++)e+=A[t].length;for(var r=new Uint8Array(e),I=0,g=0,n=A.length;I<n;I++){var a=A[I];r.set(a,g),g+=a.length}return r},V=!0;try{String.fromCharCode.apply(null,new Uint8Array(1))}catch(A){V=!1}for(var _=new Uint8Array(256),X=0;X<256;X++)_[X]=X>=252?6:X>=248?5:X>=240?4:X>=224?3:X>=192?2:1;_[254]=_[254]=1;var Z=function(A){if("function"==typeof TextEncoder&&TextEncoder.prototype.encode)return(new TextEncoder).encode(A);var e,t,i,r,I,g=A.length,n=0;for(r=0;r<g;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),n+=t<128?1:t<2048?2:t<65536?3:4;for(e=new Uint8Array(n),I=0,r=0;I<n;r++)55296==(64512&(t=A.charCodeAt(r)))&&r+1<g&&56320==(64512&(i=A.charCodeAt(r+1)))&&(t=65536+(t-55296<<10)+(i-56320),r++),t<128?e[I++]=t:t<2048?(e[I++]=192|t>>>6,e[I++]=128|63&t):t<65536?(e[I++]=224|t>>>12,e[I++]=128|t>>>6&63,e[I++]=128|63&t):(e[I++]=240|t>>>18,e[I++]=128|t>>>12&63,e[I++]=128|t>>>6&63,e[I++]=128|63&t);return e},j=function(A,e){var t,i,r=e||A.length;if("function"==typeof TextDecoder&&TextDecoder.prototype.decode)return(new TextDecoder).decode(A.subarray(0,e));var I=new Array(2*r);for(i=0,t=0;t<r;){var g=A[t++];if(g<128)I[i++]=g;else{var n=_[g];if(n>4)I[i++]=65533,t+=n-1;else{for(g&=2===n?31:3===n?15:7;n>1&&t<r;)g=g<<6|63&A[t++],n--;n>1?I[i++]=65533:g<65536?I[i++]=g:(g-=65536,I[i++]=55296|g>>10&1023,I[i++]=56320|1023&g)}}}return function(A,e){if(e<65534&&A.subarray&&V)return String.fromCharCode.apply(null,A.length===e?A:A.subarray(0,e));for(var t="",i=0;i<e;i++)t+=String.fromCharCode(A[i]);return t}(I,i)},W=function(A,e){(e=e||A.length)>A.length&&(e=A.length);for(var t=e-1;t>=0&&128==(192&A[t]);)t--;return t<0||0===t?e:t+_[A[t]]>e?t:e};var z=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0},$=function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=A.state;t=A.next_in,k=A.input,i=t+(A.avail_in-5),r=A.next_out,p=A.output,I=r-(e-A.avail_out),g=r+(A.avail_out-257),n=m.dmax,a=m.wsize,o=m.whave,B=m.wnext,C=m.window,Q=m.hold,E=m.bits,s=m.lencode,f=m.distcode,c=(1<<m.lenbits)-1,h=(1<<m.distbits)-1;A:do{E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=s[Q&c];e:for(;;){if(Q>>>=u=l>>>24,E-=u,0===(u=l>>>16&255))p[r++]=65535&l;else{if(!(16&u)){if(0==(64&u)){l=s[(65535&l)+(Q&(1<<u)-1)];continue e}if(32&u){m.mode=12;break A}A.msg="invalid literal/length code",m.mode=30;break A}w=65535&l,(u&=15)&&(E<u&&(Q+=k[t++]<<E,E+=8),w+=Q&(1<<u)-1,Q>>>=u,E-=u),E<15&&(Q+=k[t++]<<E,E+=8,Q+=k[t++]<<E,E+=8),l=f[Q&h];t:for(;;){if(Q>>>=u=l>>>24,E-=u,!(16&(u=l>>>16&255))){if(0==(64&u)){l=f[(65535&l)+(Q&(1<<u)-1)];continue t}A.msg="invalid distance code",m.mode=30;break A}if(d=65535&l,E<(u&=15)&&(Q+=k[t++]<<E,(E+=8)<u&&(Q+=k[t++]<<E,E+=8)),(d+=Q&(1<<u)-1)>n){A.msg="invalid distance too far back",m.mode=30;break A}if(Q>>>=u,E-=u,d>(u=r-I)){if((u=d-u)>o&&m.sane){A.msg="invalid distance too far back",m.mode=30;break A}if(D=0,y=C,0===B){if(D+=a-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}else if(B<u){if(D+=a+B-u,(u-=B)<w){w-=u;do{p[r++]=C[D++]}while(--u);if(D=0,B<w){w-=u=B;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}}}else if(D+=B-u,u<w){w-=u;do{p[r++]=C[D++]}while(--u);D=r-d,y=p}for(;w>2;)p[r++]=y[D++],p[r++]=y[D++],p[r++]=y[D++],w-=3;w&&(p[r++]=y[D++],w>1&&(p[r++]=y[D++]))}else{D=r-d;do{p[r++]=p[D++],p[r++]=p[D++],p[r++]=p[D++],w-=3}while(w>2);w&&(p[r++]=p[D++],w>1&&(p[r++]=p[D++]))}break}}break}}while(t<i&&r<g);t-=w=E>>3,Q&=(1<<(E-=w<<3))-1,A.next_in=t,A.next_out=r,A.avail_in=t<i?i-t+5:5-(t-i),A.avail_out=r<g?g-r+257:257-(r-g),m.hold=Q,m.bits=E},AA=new Uint16Array([3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0]),eA=new Uint8Array([16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78]),tA=new Uint16Array([1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0]),iA=new Uint8Array([16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64]),rA=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E,s,f,c,h=n.bits,l=0,u=0,w=0,d=0,D=0,y=0,k=0,p=0,m=0,G=0,F=null,S=0,v=new Uint16Array(16),R=new Uint16Array(16),U=null,L=0;for(l=0;l<=15;l++)v[l]=0;for(u=0;u<i;u++)v[e[t+u]]++;for(D=h,d=15;d>=1&&0===v[d];d--);if(D>d&&(D=d),0===d)return r[I++]=20971520,r[I++]=20971520,n.bits=1,0;for(w=1;w<d&&0===v[w];w++);for(D<w&&(D=w),p=1,l=1;l<=15;l++)if(p<<=1,(p-=v[l])<0)return-1;if(p>0&&(0===A||1!==d))return-1;for(R[1]=0,l=1;l<15;l++)R[l+1]=R[l]+v[l];for(u=0;u<i;u++)0!==e[t+u]&&(g[R[e[t+u]]++]=u);if(0===A?(F=U=g,E=19):1===A?(F=AA,S-=257,U=eA,L-=257,E=256):(F=tA,U=iA,E=-1),G=0,u=0,l=w,Q=I,y=D,k=0,B=-1,C=(m=1<<D)-1,1===A&&m>852||2===A&&m>592)return 1;for(;;){s=l-k,g[u]<E?(f=0,c=g[u]):g[u]>E?(f=U[L+g[u]],c=F[S+g[u]]):(f=96,c=0),a=1<<l-k,w=o=1<<y;do{r[Q+(G>>k)+(o-=a)]=s<<24|f<<16|c|0}while(0!==o);for(a=1<<l-1;G&a;)a>>=1;if(0!==a?(G&=a-1,G+=a):G=0,u++,0==--v[l]){if(l===d)break;l=e[t+g[u]]}if(l>D&&(G&C)!==B){for(0===k&&(k=D),Q+=w,p=1<<(y=l-k);y+k<d&&!((p-=v[y+k])<=0);)y++,p<<=1;if(m+=1<<y,1===A&&m>852||2===A&&m>592)return 1;r[B=G&C]=D<<24|y<<16|Q-I|0}}return 0!==G&&(r[Q+G]=l-k<<24|64<<16|0),n.bits=D,0},IA=H.Z_FINISH,gA=H.Z_BLOCK,nA=H.Z_TREES,aA=H.Z_OK,oA=H.Z_STREAM_END,BA=H.Z_NEED_DICT,CA=H.Z_STREAM_ERROR,QA=H.Z_DATA_ERROR,EA=H.Z_MEM_ERROR,sA=H.Z_BUF_ERROR,fA=H.Z_DEFLATED,cA=function(A){return(A>>>24&255)+(A>>>8&65280)+((65280&A)<<8)+((255&A)<<24)};function hA(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new Uint16Array(320),this.work=new Uint16Array(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}var lA,uA,wA=function(A){if(!A||!A.state)return CA;var e=A.state;return A.total_in=A.total_out=e.total=0,A.msg="",e.wrap&&(A.adler=1&e.wrap),e.mode=1,e.last=0,e.havedict=0,e.dmax=32768,e.head=null,e.hold=0,e.bits=0,e.lencode=e.lendyn=new Int32Array(852),e.distcode=e.distdyn=new Int32Array(592),e.sane=1,e.back=-1,aA},dA=function(A){if(!A||!A.state)return CA;var e=A.state;return e.wsize=0,e.whave=0,e.wnext=0,wA(A)},DA=function(A,e){var t;if(!A||!A.state)return CA;var i=A.state;return e<0?(t=0,e=-e):(t=1+(e>>4),e<48&&(e&=15)),e&&(e<8||e>15)?CA:(null!==i.window&&i.wbits!==e&&(i.window=null),i.wrap=t,i.wbits=e,dA(A))},yA=function(A,e){if(!A)return CA;var t=new hA;A.state=t,t.window=null;var i=DA(A,e);return i!==aA&&(A.state=null),i},kA=!0,pA=function(A){if(kA){lA=new Int32Array(512),uA=new Int32Array(32);for(var e=0;e<144;)A.lens[e++]=8;for(;e<256;)A.lens[e++]=9;for(;e<280;)A.lens[e++]=7;for(;e<288;)A.lens[e++]=8;for(rA(1,A.lens,0,288,lA,0,A.work,{bits:9}),e=0;e<32;)A.lens[e++]=5;rA(2,A.lens,0,32,uA,0,A.work,{bits:5}),kA=!1}A.lencode=lA,A.lenbits=9,A.distcode=uA,A.distbits=5},mA=function(A,e,t,i){var r,I=A.state;return null===I.window&&(I.wsize=1<<I.wbits,I.wnext=0,I.whave=0,I.window=new Uint8Array(I.wsize)),i>=I.wsize?(I.window.set(e.subarray(t-I.wsize,t),0),I.wnext=0,I.whave=I.wsize):((r=I.wsize-I.wnext)>i&&(r=i),I.window.set(e.subarray(t-i,t-i+r),I.wnext),(i-=r)?(I.window.set(e.subarray(t-i,t),0),I.wnext=i,I.whave=I.wsize):(I.wnext+=r,I.wnext===I.wsize&&(I.wnext=0),I.whave<I.wsize&&(I.whave+=r))),0},GA={inflateReset:dA,inflateReset2:DA,inflateResetKeep:wA,inflateInit:function(A){return yA(A,15)},inflateInit2:yA,inflate:function(A,e){var t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c,h,l,u,w,d,D,y,k,p,m=0,G=new Uint8Array(4),F=new Uint8Array([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]);if(!A||!A.state||!A.output||!A.input&&0!==A.avail_in)return CA;12===(t=A.state).mode&&(t.mode=13),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,C=n,Q=a,y=aA;A:for(;;)switch(t.mode){case 1:if(0===t.wrap){t.mode=13;break}for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(2&t.wrap&&35615===o){t.check=0,G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0),o=0,B=0,t.mode=2;break}if(t.flags=0,t.head&&(t.head.done=!1),!(1&t.wrap)||(((255&o)<<8)+(o>>8))%31){A.msg="incorrect header check",t.mode=30;break}if((15&o)!==fA){A.msg="unknown compression method",t.mode=30;break}if(B-=4,D=8+(15&(o>>>=4)),0===t.wbits)t.wbits=D;else if(D>t.wbits){A.msg="invalid window size",t.mode=30;break}t.dmax=1<<t.wbits,A.adler=t.check=1,t.mode=512&o?10:12,o=0,B=0;break;case 2:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.flags=o,(255&t.flags)!==fA){A.msg="unknown compression method",t.mode=30;break}if(57344&t.flags){A.msg="unknown header flags set",t.mode=30;break}t.head&&(t.head.text=o>>8&1),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=3;case 3:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.time=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,G[2]=o>>>16&255,G[3]=o>>>24&255,t.check=Y(t.check,G,4,0)),o=0,B=0,t.mode=4;case 4:for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.head&&(t.head.xflags=255&o,t.head.os=o>>8),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0,t.mode=5;case 5:if(1024&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length=o,t.head&&(t.head.extra_len=o),512&t.flags&&(G[0]=255&o,G[1]=o>>>8&255,t.check=Y(t.check,G,2,0)),o=0,B=0}else t.head&&(t.head.extra=null);t.mode=6;case 6:if(1024&t.flags&&((E=t.length)>n&&(E=n),E&&(t.head&&(D=t.head.extra_len-t.length,t.head.extra||(t.head.extra=new Uint8Array(t.head.extra_len)),t.head.extra.set(i.subarray(I,I+E),D)),512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,t.length-=E),t.length))break A;t.length=0,t.mode=7;case 7:if(2048&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.name+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.name=null);t.length=0,t.mode=8;case 8:if(4096&t.flags){if(0===n)break A;E=0;do{D=i[I+E++],t.head&&D&&t.length<65536&&(t.head.comment+=String.fromCharCode(D))}while(D&&E<n);if(512&t.flags&&(t.check=Y(t.check,i,E,I)),n-=E,I+=E,D)break A}else t.head&&(t.head.comment=null);t.mode=9;case 9:if(512&t.flags){for(;B<16;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(65535&t.check)){A.msg="header crc mismatch",t.mode=30;break}o=0,B=0}t.head&&(t.head.hcrc=t.flags>>9&1,t.head.done=!0),A.adler=t.check=0,t.mode=12;break;case 10:for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}A.adler=t.check=cA(o),o=0,B=0,t.mode=11;case 11:if(0===t.havedict)return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,BA;A.adler=t.check=1,t.mode=12;case 12:if(e===gA||e===nA)break A;case 13:if(t.last){o>>>=7&B,B-=7&B,t.mode=27;break}for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}switch(t.last=1&o,B-=1,3&(o>>>=1)){case 0:t.mode=14;break;case 1:if(pA(t),t.mode=20,e===nA){o>>>=2,B-=2;break A}break;case 2:t.mode=17;break;case 3:A.msg="invalid block type",t.mode=30}o>>>=2,B-=2;break;case 14:for(o>>>=7&B,B-=7&B;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if((65535&o)!=(o>>>16^65535)){A.msg="invalid stored block lengths",t.mode=30;break}if(t.length=65535&o,o=0,B=0,t.mode=15,e===nA)break A;case 15:t.mode=16;case 16:if(E=t.length){if(E>n&&(E=n),E>a&&(E=a),0===E)break A;r.set(i.subarray(I,I+E),g),n-=E,I+=E,a-=E,g+=E,t.length-=E;break}t.mode=12;break;case 17:for(;B<14;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(t.nlen=257+(31&o),o>>>=5,B-=5,t.ndist=1+(31&o),o>>>=5,B-=5,t.ncode=4+(15&o),o>>>=4,B-=4,t.nlen>286||t.ndist>30){A.msg="too many length or distance symbols",t.mode=30;break}t.have=0,t.mode=18;case 18:for(;t.have<t.ncode;){for(;B<3;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.lens[F[t.have++]]=7&o,o>>>=3,B-=3}for(;t.have<19;)t.lens[F[t.have++]]=0;if(t.lencode=t.lendyn,t.lenbits=7,k={bits:t.lenbits},y=rA(0,t.lens,0,19,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid code lengths set",t.mode=30;break}t.have=0,t.mode=19;case 19:for(;t.have<t.nlen+t.ndist;){for(;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(l<16)o>>>=c,B-=c,t.lens[t.have++]=l;else{if(16===l){for(p=c+2;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o>>>=c,B-=c,0===t.have){A.msg="invalid bit length repeat",t.mode=30;break}D=t.lens[t.have-1],E=3+(3&o),o>>>=2,B-=2}else if(17===l){for(p=c+3;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=3+(7&(o>>>=c)),o>>>=3,B-=3}else{for(p=c+7;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}B-=c,D=0,E=11+(127&(o>>>=c)),o>>>=7,B-=7}if(t.have+E>t.nlen+t.ndist){A.msg="invalid bit length repeat",t.mode=30;break}for(;E--;)t.lens[t.have++]=D}}if(30===t.mode)break;if(0===t.lens[256]){A.msg="invalid code -- missing end-of-block",t.mode=30;break}if(t.lenbits=9,k={bits:t.lenbits},y=rA(1,t.lens,0,t.nlen,t.lencode,0,t.work,k),t.lenbits=k.bits,y){A.msg="invalid literal/lengths set",t.mode=30;break}if(t.distbits=6,t.distcode=t.distdyn,k={bits:t.distbits},y=rA(2,t.lens,t.nlen,t.ndist,t.distcode,0,t.work,k),t.distbits=k.bits,y){A.msg="invalid distances set",t.mode=30;break}if(t.mode=20,e===nA)break A;case 20:t.mode=21;case 21:if(n>=6&&a>=258){A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,$(A,Q),g=A.next_out,r=A.output,a=A.avail_out,I=A.next_in,i=A.input,n=A.avail_in,o=t.hold,B=t.bits,12===t.mode&&(t.back=-1);break}for(t.back=0;h=(m=t.lencode[o&(1<<t.lenbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(h&&0==(240&h)){for(u=c,w=h,d=l;h=(m=t.lencode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,t.length=l,0===h){t.mode=26;break}if(32&h){t.back=-1,t.mode=12;break}if(64&h){A.msg="invalid literal/length code",t.mode=30;break}t.extra=15&h,t.mode=22;case 22:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.length+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}t.was=t.length,t.mode=23;case 23:for(;h=(m=t.distcode[o&(1<<t.distbits)-1])>>>16&255,l=65535&m,!((c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(0==(240&h)){for(u=c,w=h,d=l;h=(m=t.distcode[d+((o&(1<<u+w)-1)>>u)])>>>16&255,l=65535&m,!(u+(c=m>>>24)<=B);){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}o>>>=u,B-=u,t.back+=u}if(o>>>=c,B-=c,t.back+=c,64&h){A.msg="invalid distance code",t.mode=30;break}t.offset=l,t.extra=15&h,t.mode=24;case 24:if(t.extra){for(p=t.extra;B<p;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}t.offset+=o&(1<<t.extra)-1,o>>>=t.extra,B-=t.extra,t.back+=t.extra}if(t.offset>t.dmax){A.msg="invalid distance too far back",t.mode=30;break}t.mode=25;case 25:if(0===a)break A;if(E=Q-a,t.offset>E){if((E=t.offset-E)>t.whave&&t.sane){A.msg="invalid distance too far back",t.mode=30;break}E>t.wnext?(E-=t.wnext,s=t.wsize-E):s=t.wnext-E,E>t.length&&(E=t.length),f=t.window}else f=r,s=g-t.offset,E=t.length;E>a&&(E=a),a-=E,t.length-=E;do{r[g++]=f[s++]}while(--E);0===t.length&&(t.mode=21);break;case 26:if(0===a)break A;r[g++]=t.length,a--,t.mode=21;break;case 27:if(t.wrap){for(;B<32;){if(0===n)break A;n--,o|=i[I++]<<B,B+=8}if(Q-=a,A.total_out+=Q,t.total+=Q,Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,g-Q):J(t.check,r,Q,g-Q)),Q=a,(t.flags?o:cA(o))!==t.check){A.msg="incorrect data check",t.mode=30;break}o=0,B=0}t.mode=28;case 28:if(t.wrap&&t.flags){for(;B<32;){if(0===n)break A;n--,o+=i[I++]<<B,B+=8}if(o!==(4294967295&t.total)){A.msg="incorrect length check",t.mode=30;break}o=0,B=0}t.mode=29;case 29:y=oA;break A;case 30:y=QA;break A;case 31:return EA;default:return CA}return A.next_out=g,A.avail_out=a,A.next_in=I,A.avail_in=n,t.hold=o,t.bits=B,(t.wsize||Q!==A.avail_out&&t.mode<30&&(t.mode<27||e!==IA))&&mA(A,A.output,A.next_out,Q-A.avail_out),C-=A.avail_in,Q-=A.avail_out,A.total_in+=C,A.total_out+=Q,t.total+=Q,t.wrap&&Q&&(A.adler=t.check=t.flags?Y(t.check,r,Q,A.next_out-Q):J(t.check,r,Q,A.next_out-Q)),A.data_type=t.bits+(t.last?64:0)+(12===t.mode?128:0)+(20===t.mode||15===t.mode?256:0),(0===C&&0===Q||e===IA)&&y===aA&&(y=sA),y},inflateEnd:function(A){if(!A||!A.state)return CA;var e=A.state;return e.window&&(e.window=null),A.state=null,aA},inflateGetHeader:function(A,e){if(!A||!A.state)return CA;var t=A.state;return 0==(2&t.wrap)?CA:(t.head=e,e.done=!1,aA)},inflateSetDictionary:function(A,e){var t,i=e.length;return A&&A.state?0!==(t=A.state).wrap&&11!==t.mode?CA:11===t.mode&&J(1,e,i,0)!==t.check?QA:mA(A,e,i,i)?(t.mode=31,EA):(t.havedict=1,aA):CA},inflateInfo:"pako inflate (from Nodeca project)"};var FA=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1},SA=Object.prototype.toString,vA=H.Z_NO_FLUSH,RA=H.Z_FINISH,UA=H.Z_OK,LA=H.Z_STREAM_END,bA=H.Z_NEED_DICT,MA=H.Z_STREAM_ERROR,NA=H.Z_DATA_ERROR,xA=H.Z_MEM_ERROR;function JA(A){this.options=P({chunkSize:65536,windowBits:15,to:""},A||{});var e=this.options;e.raw&&e.windowBits>=0&&e.windowBits<16&&(e.windowBits=-e.windowBits,0===e.windowBits&&(e.windowBits=-15)),!(e.windowBits>=0&&e.windowBits<16)||A&&A.windowBits||(e.windowBits+=32),e.windowBits>15&&e.windowBits<48&&0==(15&e.windowBits)&&(e.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new z,this.strm.avail_out=0;var t=GA.inflateInit2(this.strm,e.windowBits);if(t!==UA)throw new Error(K[t]);if(this.header=new FA,GA.inflateGetHeader(this.strm,this.header),e.dictionary&&("string"==typeof e.dictionary?e.dictionary=Z(e.dictionary):"[object ArrayBuffer]"===SA.call(e.dictionary)&&(e.dictionary=new Uint8Array(e.dictionary)),e.raw&&(t=GA.inflateSetDictionary(this.strm,e.dictionary))!==UA))throw new Error(K[t])}function qA(A,e){var t=new JA(e);if(t.push(A),t.err)throw t.msg||K[t.err];return t.result}JA.prototype.push=function(A,e){var t,i,r,I=this.strm,g=this.options.chunkSize,n=this.options.dictionary;if(this.ended)return!1;for(i=e===~~e?e:!0===e?RA:vA,"[object ArrayBuffer]"===SA.call(A)?I.input=new Uint8Array(A):I.input=A,I.next_in=0,I.avail_in=I.input.length;;){for(0===I.avail_out&&(I.output=new Uint8Array(g),I.next_out=0,I.avail_out=g),(t=GA.inflate(I,i))===bA&&n&&((t=GA.inflateSetDictionary(I,n))===UA?t=GA.inflate(I,i):t===NA&&(t=bA));I.avail_in>0&&t===LA&&I.state.wrap>0&&0!==A[I.next_in];)GA.inflateReset(I),t=GA.inflate(I,i);switch(t){case MA:case NA:case bA:case xA:return this.onEnd(t),this.ended=!0,!1}if(r=I.avail_out,I.next_out&&(0===I.avail_out||t===LA))if("string"===this.options.to){var a=W(I.output,I.next_out),o=I.next_out-a,B=j(I.output,a);I.next_out=o,I.avail_out=g-o,o&&I.output.set(I.output.subarray(a,a+o),0),this.onData(B)}else this.onData(I.output.length===I.next_out?I.output:I.output.subarray(0,I.next_out));if(t!==UA||0!==r){if(t===LA)return t=GA.inflateEnd(this.strm),this.onEnd(t),this.ended=!0,!0;if(0===I.avail_in)break}}return!0},JA.prototype.onData=function(A){this.chunks.push(A)},JA.prototype.onEnd=function(A){A===UA&&("string"===this.options.to?this.result=this.chunks.join(""):this.result=T(this.chunks)),this.chunks=[],this.err=A,this.msg=this.strm.msg};var YA={Inflate:JA,inflate:qA,inflateRaw:function(A,e){return(e=e||{}).raw=!0,qA(A,e)},ungzip:qA,constants:H}.inflate;function KA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var HA=function(A){s(t,w);var e=KA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){return YA(new Uint8Array(A)).buffer}}]),t}(),OA=Object.freeze({__proto__:null,default:HA});function PA(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var TA,VA=function(A){s(t,w);var e=PA(t);function t(){return B(this,t),e.apply(this,arguments)}return Q(t,[{key:"decodeBlock",value:function(A){for(var e=new DataView(A),t=[],i=0;i<A.byteLength;++i){var r=e.getInt8(i);if(r<0){var I=e.getUint8(i+1);r=-r;for(var g=0;g<=r;++g)t.push(I);i+=1}else{for(var n=0;n<=r;++n)t.push(e.getUint8(i+n+1));i+=r+1}}return new Uint8Array(t).buffer}}]),t}(),_A=Object.freeze({__proto__:null,default:VA}),XA={exports:{}};TA=XA,\n/* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */\nfunction(){var A,e,t,i,r,I,g,n,a,o,B,C,Q,E,s,f,c=(A={defaultNoDataValue:-34027999387901484e22,decode:function(I,g){var n=(g=g||{}).encodedMaskData||null===g.encodedMaskData,a=r(I,g.inputOffset||0,n),o=null!==g.noDataValue?g.noDataValue:A.defaultNoDataValue,B=e(a,g.pixelType||Float32Array,g.encodedMaskData,o,g.returnMask),C={width:a.width,height:a.height,pixelData:B.resultPixels,minValue:B.minValue,maxValue:a.pixels.maxValue,noDataValue:o};return B.resultMask&&(C.maskData=B.resultMask),g.returnEncodedMask&&a.mask&&(C.encodedMaskData=a.mask.bitset?a.mask.bitset:null),g.returnFileInfo&&(C.fileInfo=t(a),g.computeUsedBitDepths&&(C.fileInfo.bitDepths=i(a))),C}},e=function(A,e,t,i,r){var g,n,a,o=0,B=A.pixels.numBlocksX,C=A.pixels.numBlocksY,Q=Math.floor(A.width/B),E=Math.floor(A.height/C),s=2*A.maxZError,f=Number.MAX_VALUE;t=t||(A.mask?A.mask.bitset:null),n=new e(A.width*A.height),r&&t&&(a=new Uint8Array(A.width*A.height));for(var c,h,l=new Float32Array(Q*E),u=0;u<=C;u++){var w=u!==C?E:A.height%C;if(0!==w)for(var d=0;d<=B;d++){var D=d!==B?Q:A.width%B;if(0!==D){var y,k,p,m,G=u*A.width*E+d*Q,F=A.width-D,S=A.pixels.blocks[o];if(S.encoding<2?(0===S.encoding?y=S.rawData:(I(S.stuffedData,S.bitsPerPixel,S.numValidPixels,S.offset,s,l,A.pixels.maxValue),y=l),k=0):p=2===S.encoding?0:S.offset,t)for(h=0;h<w;h++){for(7&G&&(m=t[G>>3],m<<=7&G),c=0;c<D;c++)7&G||(m=t[G>>3]),128&m?(a&&(a[G]=1),f=f>(g=S.encoding<2?y[k++]:p)?g:f,n[G++]=g):(a&&(a[G]=0),n[G++]=i),m<<=1;G+=F}else if(S.encoding<2)for(h=0;h<w;h++){for(c=0;c<D;c++)f=f>(g=y[k++])?g:f,n[G++]=g;G+=F}else for(f=f>p?p:f,h=0;h<w;h++){for(c=0;c<D;c++)n[G++]=p;G+=F}if(1===S.encoding&&k!==S.numValidPixels)throw"Block and Mask do not match";o++}}}return{resultPixels:n,resultMask:a,minValue:f}},t=function(A){return{fileIdentifierString:A.fileIdentifierString,fileVersion:A.fileVersion,imageType:A.imageType,height:A.height,width:A.width,maxZError:A.maxZError,eofOffset:A.eofOffset,mask:A.mask?{numBlocksX:A.mask.numBlocksX,numBlocksY:A.mask.numBlocksY,numBytes:A.mask.numBytes,maxValue:A.mask.maxValue}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,numBytes:A.pixels.numBytes,maxValue:A.pixels.maxValue,noDataValue:A.noDataValue}}},i=function(A){for(var e=A.pixels.numBlocksX*A.pixels.numBlocksY,t={},i=0;i<e;i++){var r=A.pixels.blocks[i];0===r.encoding?t.float32=!0:1===r.encoding?t[r.bitsPerPixel]=!0:t[0]=!0}return Object.keys(t)},r=function(A,e,t){var i={},r=new Uint8Array(A,e,10);if(i.fileIdentifierString=String.fromCharCode.apply(null,r),"CntZImage"!==i.fileIdentifierString.trim())throw"Unexpected file identifier string: "+i.fileIdentifierString;e+=10;var I=new DataView(A,e,24);if(i.fileVersion=I.getInt32(0,!0),i.imageType=I.getInt32(4,!0),i.height=I.getUint32(8,!0),i.width=I.getUint32(12,!0),i.maxZError=I.getFloat64(16,!0),e+=24,!t)if(I=new DataView(A,e,16),i.mask={},i.mask.numBlocksY=I.getUint32(0,!0),i.mask.numBlocksX=I.getUint32(4,!0),i.mask.numBytes=I.getUint32(8,!0),i.mask.maxValue=I.getFloat32(12,!0),e+=16,i.mask.numBytes>0){var g=new Uint8Array(Math.ceil(i.width*i.height/8)),n=(I=new DataView(A,e,i.mask.numBytes)).getInt16(0,!0),a=2,o=0;do{if(n>0)for(;n--;)g[o++]=I.getUint8(a++);else{var B=I.getUint8(a++);for(n=-n;n--;)g[o++]=B}n=I.getInt16(a,!0),a+=2}while(a<i.mask.numBytes);if(-32768!==n||o<g.length)throw"Unexpected end of mask RLE encoding";i.mask.bitset=g,e+=i.mask.numBytes}else 0==(i.mask.numBytes|i.mask.numBlocksY|i.mask.maxValue)&&(i.mask.bitset=new Uint8Array(Math.ceil(i.width*i.height/8)));I=new DataView(A,e,16),i.pixels={},i.pixels.numBlocksY=I.getUint32(0,!0),i.pixels.numBlocksX=I.getUint32(4,!0),i.pixels.numBytes=I.getUint32(8,!0),i.pixels.maxValue=I.getFloat32(12,!0),e+=16;var C=i.pixels.numBlocksX,Q=i.pixels.numBlocksY,E=C+(i.width%C>0?1:0),s=Q+(i.height%Q>0?1:0);i.pixels.blocks=new Array(E*s);for(var f=0,c=0;c<s;c++)for(var h=0;h<E;h++){var l=0,u=A.byteLength-e;I=new DataView(A,e,Math.min(10,u));var w={};i.pixels.blocks[f++]=w;var d=I.getUint8(0);if(l++,w.encoding=63&d,w.encoding>3)throw"Invalid block encoding ("+w.encoding+")";if(2!==w.encoding){if(0!==d&&2!==d){if(d>>=6,w.offsetType=d,2===d)w.offset=I.getInt8(1),l++;else if(1===d)w.offset=I.getInt16(1,!0),l+=2;else{if(0!==d)throw"Invalid block offset type";w.offset=I.getFloat32(1,!0),l+=4}if(1===w.encoding)if(d=I.getUint8(l),l++,w.bitsPerPixel=63&d,d>>=6,w.numValidPixelsType=d,2===d)w.numValidPixels=I.getUint8(l),l++;else if(1===d)w.numValidPixels=I.getUint16(l,!0),l+=2;else{if(0!==d)throw"Invalid valid pixel count type";w.numValidPixels=I.getUint32(l,!0),l+=4}}var D;if(e+=l,3!==w.encoding)if(0===w.encoding){var y=(i.pixels.numBytes-1)/4;if(y!==Math.floor(y))throw"uncompressed block has invalid length";D=new ArrayBuffer(4*y),new Uint8Array(D).set(new Uint8Array(A,e,4*y));var k=new Float32Array(D);w.rawData=k,e+=4*y}else if(1===w.encoding){var p=Math.ceil(w.numValidPixels*w.bitsPerPixel/8),m=Math.ceil(p/4);D=new ArrayBuffer(4*m),new Uint8Array(D).set(new Uint8Array(A,e,p)),w.stuffedData=new Uint32Array(D),e+=p}}else e++}return i.eofOffset=e,i},I=function(A,e,t,i,r,I,g){var n,a,o,B=(1<<e)-1,C=0,Q=0,E=Math.ceil((g-i)/r),s=4*A.length-Math.ceil(e*t/8);for(A[A.length-1]<<=8*s,n=0;n<t;n++){if(0===Q&&(o=A[C++],Q=32),Q>=e)a=o>>>Q-e&B,Q-=e;else{var f=e-Q;a=(o&B)<<f&B,a+=(o=A[C++])>>>(Q=32-f)}I[n]=a<E?i+a*r:g}return I},A),h=(g=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q,E=(1<<t)-1,s=0,f=0,c=4*A.length-Math.ceil(t*i/8);if(A[A.length-1]<<=8*c,r)for(a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=r[o];else for(Q=Math.ceil((n-I)/g),a=0;a<i;a++)0===f&&(B=A[s++],f=32),f>=t?(o=B>>>f-t&E,f-=t):(o=(B&E)<<(C=t-f)&E,o+=(B=A[s++])>>>(f=32-C)),e[a]=o<Q?I+o*g:n},n=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=[],s=4*A.length-Math.ceil(e*t/8);A[A.length-1]<<=8*s;var f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32),C>=e?(Q=g>>>C-e&n,C-=e):(Q=(g&n)<<(B=e-C)&n,Q+=(g=A[a++])>>>(C=32-B)),E[o]=Q<f?i+Q*r:I;return E.unshift(i),E},a=function(A,e,t,i,r,I,g,n){var a,o,B,C,Q=(1<<t)-1,E=0,s=0,f=0;if(r)for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=r[o];else{var c=Math.ceil((n-I)/g);for(a=0;a<i;a++)0===s&&(B=A[E++],s=32,f=0),s>=t?(o=B>>>f&Q,s-=t,f+=t):(o=B>>>f&Q,s=32-(C=t-s),o|=((B=A[E++])&(1<<C)-1)<<t-C,f=C),e[a]=o<c?I+o*g:n}return e},o=function(A,e,t,i,r,I){var g,n=(1<<e)-1,a=0,o=0,B=0,C=0,Q=0,E=0,s=[],f=Math.ceil((I-i)/r);for(o=0;o<t;o++)0===C&&(g=A[a++],C=32,E=0),C>=e?(Q=g>>>E&n,C-=e,E+=e):(Q=g>>>E&n,C=32-(B=e-C),Q|=((g=A[a++])&(1<<B)-1)<<e-B,E=B),s[o]=Q<f?i+Q*r:I;return s.unshift(i),s},B=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=4*A.length-Math.ceil(t*i/8);for(A[A.length-1]<<=8*C,r=0;r<i;r++)0===B&&(g=A[o++],B=32),B>=t?(I=g>>>B-t&a,B-=t):(I=(g&a)<<(n=t-B)&a,I+=(g=A[o++])>>>(B=32-n)),e[r]=I;return e},C=function(A,e,t,i){var r,I,g,n,a=(1<<t)-1,o=0,B=0,C=0;for(r=0;r<i;r++)0===B&&(g=A[o++],B=32,C=0),B>=t?(I=g>>>C&a,B-=t,C+=t):(I=g>>>C&a,B=32-(n=t-B),I|=((g=A[o++])&(1<<n)-1)<<t-n,C=n),e[r]=I;return e},Q={HUFFMAN_LUT_BITS_MAX:12,computeChecksumFletcher32:function(A){for(var e=65535,t=65535,i=A.length,r=Math.floor(i/2),I=0;r;){var g=r>=359?359:r;r-=g;do{e+=A[I++]<<8,t+=e+=A[I++]}while(--g);e=(65535&e)+(e>>>16),t=(65535&t)+(t>>>16)}return 1&i&&(t+=e+=A[I]<<8),((t=(65535&t)+(t>>>16))<<16|(e=(65535&e)+(e>>>16)))>>>0},readHeaderInfo:function(A,e){var t=e.ptr,i=new Uint8Array(A,t,6),r={};if(r.fileIdentifierString=String.fromCharCode.apply(null,i),0!==r.fileIdentifierString.lastIndexOf("Lerc2",0))throw"Unexpected file identifier string (expect Lerc2 ): "+r.fileIdentifierString;t+=6;var I,g=new DataView(A,t,8),n=g.getInt32(0,!0);if(r.fileVersion=n,t+=4,n>=3&&(r.checksum=g.getUint32(4,!0),t+=4),g=new DataView(A,t,12),r.height=g.getUint32(0,!0),r.width=g.getUint32(4,!0),t+=8,n>=4?(r.numDims=g.getUint32(8,!0),t+=4):r.numDims=1,g=new DataView(A,t,40),r.numValidPixel=g.getUint32(0,!0),r.microBlockSize=g.getInt32(4,!0),r.blobSize=g.getInt32(8,!0),r.imageType=g.getInt32(12,!0),r.maxZError=g.getFloat64(16,!0),r.zMin=g.getFloat64(24,!0),r.zMax=g.getFloat64(32,!0),t+=40,e.headerInfo=r,e.ptr=t,n>=3&&(I=n>=4?52:48,this.computeChecksumFletcher32(new Uint8Array(A,t-I,r.blobSize-14))!==r.checksum))throw"Checksum failed.";return!0},checkMinMaxRanges:function(A,e){var t=e.headerInfo,i=this.getDataTypeArray(t.imageType),r=t.numDims*this.getDataTypeSize(t.imageType),I=this.readSubArray(A,e.ptr,i,r),g=this.readSubArray(A,e.ptr+r,i,r);e.ptr+=2*r;var n,a=!0;for(n=0;n<t.numDims;n++)if(I[n]!==g[n]){a=!1;break}return t.minValues=I,t.maxValues=g,a},readSubArray:function(A,e,t,i){var r;if(t===Uint8Array)r=new Uint8Array(A,e,i);else{var I=new ArrayBuffer(i);new Uint8Array(I).set(new Uint8Array(A,e,i)),r=new t(I)}return r},readMask:function(A,e){var t,i,r=e.ptr,I=e.headerInfo,g=I.width*I.height,n=I.numValidPixel,a=new DataView(A,r,4),o={};if(o.numBytes=a.getUint32(0,!0),r+=4,(0===n||g===n)&&0!==o.numBytes)throw"invalid mask";if(0===n)t=new Uint8Array(Math.ceil(g/8)),o.bitset=t,i=new Uint8Array(g),e.pixels.resultMask=i,r+=o.numBytes;else if(o.numBytes>0){t=new Uint8Array(Math.ceil(g/8));var B=(a=new DataView(A,r,o.numBytes)).getInt16(0,!0),C=2,Q=0,E=0;do{if(B>0)for(;B--;)t[Q++]=a.getUint8(C++);else for(E=a.getUint8(C++),B=-B;B--;)t[Q++]=E;B=a.getInt16(C,!0),C+=2}while(C<o.numBytes);if(-32768!==B||Q<t.length)throw"Unexpected end of mask RLE encoding";i=new Uint8Array(g);var s=0,f=0;for(f=0;f<g;f++)7&f?(s=t[f>>3],s<<=7&f):s=t[f>>3],128&s&&(i[f]=1);e.pixels.resultMask=i,o.bitset=t,r+=o.numBytes}return e.ptr=r,e.mask=o,!0},readDataOneSweep:function(A,e,t,i){var r,I=e.ptr,g=e.headerInfo,n=g.numDims,a=g.width*g.height,o=g.imageType,B=g.numValidPixel*Q.getDataTypeSize(o)*n,C=e.pixels.resultMask;if(t===Uint8Array)r=new Uint8Array(A,I,B);else{var E=new ArrayBuffer(B);new Uint8Array(E).set(new Uint8Array(A,I,B)),r=new t(E)}if(r.length===a*n)e.pixels.resultPixels=i?Q.swapDimensionOrder(r,a,n,t,!0):r;else{e.pixels.resultPixels=new t(a*n);var s=0,f=0,c=0,h=0;if(n>1){if(i){for(f=0;f<a;f++)if(C[f])for(h=f,c=0;c<n;c++,h+=a)e.pixels.resultPixels[h]=r[s++]}else for(f=0;f<a;f++)if(C[f])for(h=f*n,c=0;c<n;c++)e.pixels.resultPixels[h+c]=r[s++]}else for(f=0;f<a;f++)C[f]&&(e.pixels.resultPixels[f]=r[s++])}return I+=B,e.ptr=I,!0},readHuffmanTree:function(A,e){var t=this.HUFFMAN_LUT_BITS_MAX,i=new DataView(A,e.ptr,16);if(e.ptr+=16,i.getInt32(0,!0)<2)throw"unsupported Huffman version";var r=i.getInt32(4,!0),I=i.getInt32(8,!0),g=i.getInt32(12,!0);if(I>=g)return!1;var n=new Uint32Array(g-I);Q.decodeBits(A,e,n);var a,o,B,C,s=[];for(a=I;a<g;a++)s[o=a-(a<r?0:r)]={first:n[a-I],second:null};var f=A.byteLength-e.ptr,c=Math.ceil(f/4),h=new ArrayBuffer(4*c);new Uint8Array(h).set(new Uint8Array(A,e.ptr,f));var l,u=new Uint32Array(h),w=0,d=0;for(l=u[0],a=I;a<g;a++)(C=s[o=a-(a<r?0:r)].first)>0&&(s[o].second=l<<w>>>32-C,32-w>=C?32===(w+=C)&&(w=0,l=u[++d]):(w+=C-32,l=u[++d],s[o].second|=l>>>32-w));var D=0,y=0,k=new E;for(a=0;a<s.length;a++)void 0!==s[a]&&(D=Math.max(D,s[a].first));y=D>=t?t:D;var p,m,G,F,S,v=[];for(a=I;a<g;a++)if((C=s[o=a-(a<r?0:r)].first)>0)if(p=[C,o],C<=y)for(m=s[o].second<<y-C,G=1<<y-C,B=0;B<G;B++)v[m|B]=p;else for(m=s[o].second,S=k,F=C-1;F>=0;F--)m>>>F&1?(S.right||(S.right=new E),S=S.right):(S.left||(S.left=new E),S=S.left),0!==F||S.val||(S.val=p[1]);return{decodeLut:v,numBitsLUTQick:y,numBitsLUT:D,tree:k,stuffedData:u,srcPtr:d,bitPos:w}},readHuffman:function(A,e,t,i){var r,I,g,n,a,o,B,C,E,s=e.headerInfo.numDims,f=e.headerInfo.height,c=e.headerInfo.width,h=c*f,l=this.readHuffmanTree(A,e),u=l.decodeLut,w=l.tree,d=l.stuffedData,D=l.srcPtr,y=l.bitPos,k=l.numBitsLUTQick,p=l.numBitsLUT,m=0===e.headerInfo.imageType?128:0,G=e.pixels.resultMask,F=0;y>0&&(D++,y=0);var S,v=d[D],R=1===e.encodeMode,U=new t(h*s),L=U;if(s<2||R){for(S=0;S<s;S++)if(s>1&&(L=new t(U.buffer,h*S,h),F=0),e.headerInfo.numValidPixel===c*f)for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(g+=B>0?F:o>0?L[C-c]:F,g&=255,L[C]=g,F=g):L[C]=g}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++,C++)if(G[C]){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,R?(B>0&&G[C-1]?g+=F:o>0&&G[C-c]?g+=L[C-c]:g+=F,g&=255,L[C]=g,F=g):L[C]=g}}else for(C=0,o=0;o<f;o++)for(B=0;B<c;B++)if(C=o*c+B,!G||G[C])for(S=0;S<s;S++,C+=h){if(I=0,a=n=v<<y>>>32-k,32-y<k&&(a=n|=d[D+1]>>>64-y-k),u[a])I=u[a][1],y+=u[a][0];else for(a=n=v<<y>>>32-p,32-y<p&&(a=n|=d[D+1]>>>64-y-p),r=w,E=0;E<p;E++)if(!(r=n>>>p-E-1&1?r.right:r.left).left&&!r.right){I=r.val,y=y+E+1;break}y>=32&&(y-=32,v=d[++D]),g=I-m,L[C]=g}e.ptr=e.ptr+4*(D+1)+(y>0?4:0),e.pixels.resultPixels=U,s>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(U,h,s,t))},decodeBits:function(A,e,t,i,r){var I=e.headerInfo,Q=I.fileVersion,E=0,s=A.byteLength-e.ptr>=5?5:A.byteLength-e.ptr,f=new DataView(A,e.ptr,s),c=f.getUint8(0);E++;var h=c>>6,l=0===h?4:3-h,u=(32&c)>0,w=31&c,d=0;if(1===l)d=f.getUint8(E),E++;else if(2===l)d=f.getUint16(E,!0),E+=2;else{if(4!==l)throw"Invalid valid pixel count type";d=f.getUint32(E,!0),E+=4}var D,y,k,p,m,G,F,S,v,R=2*I.maxZError,U=I.numDims>1?I.maxValues[r]:I.zMax;if(u){for(e.counter.lut++,S=f.getUint8(E),E++,p=Math.ceil((S-1)*w/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),k=new Uint8Array(y),e.ptr+=E,k.set(new Uint8Array(A,e.ptr,p)),F=new Uint32Array(y),e.ptr+=p,v=0;S-1>>>v;)v++;p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,G=Q>=3?o(F,w,S-1,i,R,U):n(F,w,S-1,i,R,U),Q>=3?a(D,t,v,d,G):g(D,t,v,d,G)}else e.counter.bitstuffer++,v=w,e.ptr+=E,v>0&&(p=Math.ceil(d*v/8),m=Math.ceil(p/4),y=new ArrayBuffer(4*m),(k=new Uint8Array(y)).set(new Uint8Array(A,e.ptr,p)),D=new Uint32Array(y),e.ptr+=p,Q>=3?null==i?C(D,t,v,d):a(D,t,v,d,!1,i,R,U):null==i?B(D,t,v,d):g(D,t,v,d,!1,i,R,U))},readTiles:function(A,e,t,i){var r=e.headerInfo,I=r.width,g=r.height,n=I*g,a=r.microBlockSize,o=r.imageType,B=Q.getDataTypeSize(o),C=Math.ceil(I/a),E=Math.ceil(g/a);e.pixels.numBlocksY=E,e.pixels.numBlocksX=C,e.pixels.ptr=0;var s,f,c,h,l,u,w,d,D,y,k=0,p=0,m=0,G=0,F=0,S=0,v=0,R=0,U=0,L=0,b=0,M=0,N=0,x=0,J=0,q=new t(a*a),Y=g%a||a,K=I%a||a,H=r.numDims,O=e.pixels.resultMask,P=e.pixels.resultPixels,T=r.fileVersion>=5?14:15,V=r.zMax;for(m=0;m<E;m++)for(F=m!==E-1?a:Y,G=0;G<C;G++)for(L=m*I*a+G*a,b=I-(S=G!==C-1?a:K),d=0;d<H;d++){if(H>1?(y=P,L=m*I*a+G*a,P=new t(e.pixels.resultPixels.buffer,n*d*B,n),V=r.maxValues[d]):y=null,v=A.byteLength-e.ptr,f={},J=0,R=(s=new DataView(A,e.ptr,Math.min(10,v))).getUint8(0),J++,D=r.fileVersion>=5?4&R:0,U=R>>6&255,(R>>2&T)!=(G*a>>3&T))throw"integrity issue";if(D&&0===d)throw"integrity issue";if((l=3&R)>3)throw e.ptr+=J,"Invalid block encoding ("+l+")";if(2!==l)if(0===l){if(D)throw"integrity issue";if(e.counter.uncompressed++,e.ptr+=J,M=(M=F*S*B)<(N=A.byteLength-e.ptr)?M:N,c=new ArrayBuffer(M%B==0?M:M+B-M%B),new Uint8Array(c).set(new Uint8Array(A,e.ptr,M)),h=new t(c),x=0,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=h[x++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=h[x++];L+=b}e.ptr+=x*B}else if(u=Q.getDataTypeUsed(D&&o<6?4:o,U),w=Q.getOnePixel(f,J,u,s),J+=Q.getDataTypeSize(u),3===l)if(e.ptr+=J,e.counter.constantoffset++,O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=D?Math.min(V,y[L]+w):w),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=D?Math.min(V,y[L]+w):w,L++;L+=b}else if(e.ptr+=J,Q.decodeBits(A,e,q,w,d),J=0,D)if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]+y[L]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L]=q[J++]+y[L],L++;L+=b}else if(O)for(k=0;k<F;k++){for(p=0;p<S;p++)O[L]&&(P[L]=q[J++]),L++;L+=b}else for(k=0;k<F;k++){for(p=0;p<S;p++)P[L++]=q[J++];L+=b}else{if(D)if(O)for(k=0;k<F;k++)for(p=0;p<S;p++)O[L]&&(P[L]=y[L]),L++;else for(k=0;k<F;k++)for(p=0;p<S;p++)P[L]=y[L],L++;e.counter.constant++,e.ptr+=J}}H>1&&!i&&(e.pixels.resultPixels=Q.swapDimensionOrder(e.pixels.resultPixels,n,H,t))},formatFileInfo:function(A){return{fileIdentifierString:A.headerInfo.fileIdentifierString,fileVersion:A.headerInfo.fileVersion,imageType:A.headerInfo.imageType,height:A.headerInfo.height,width:A.headerInfo.width,numValidPixel:A.headerInfo.numValidPixel,microBlockSize:A.headerInfo.microBlockSize,blobSize:A.headerInfo.blobSize,maxZError:A.headerInfo.maxZError,pixelType:Q.getPixelType(A.headerInfo.imageType),eofOffset:A.eofOffset,mask:A.mask?{numBytes:A.mask.numBytes}:null,pixels:{numBlocksX:A.pixels.numBlocksX,numBlocksY:A.pixels.numBlocksY,maxValue:A.headerInfo.zMax,minValue:A.headerInfo.zMin,noDataValue:A.noDataValue}}},constructConstantSurface:function(A,e){var t=A.headerInfo.zMax,i=A.headerInfo.zMin,r=A.headerInfo.maxValues,I=A.headerInfo.numDims,g=A.headerInfo.height*A.headerInfo.width,n=0,a=0,o=0,B=A.pixels.resultMask,C=A.pixels.resultPixels;if(B)if(I>1){if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)B[a]&&(C[o+a]=t);else for(a=0;a<g;a++)if(B[a])for(o=a*I,n=0;n<I;n++)C[o+I]=r[n]}else for(a=0;a<g;a++)B[a]&&(C[a]=t);else if(I>1&&i!==t)if(e)for(n=0;n<I;n++)for(o=n*g,t=r[n],a=0;a<g;a++)C[o+a]=t;else for(a=0;a<g;a++)for(o=a*I,n=0;n<I;n++)C[o+n]=r[n];else for(a=0;a<g*I;a++)C[a]=t},getDataTypeArray:function(A){var e;switch(A){case 0:e=Int8Array;break;case 1:e=Uint8Array;break;case 2:e=Int16Array;break;case 3:e=Uint16Array;break;case 4:e=Int32Array;break;case 5:e=Uint32Array;break;case 6:default:e=Float32Array;break;case 7:e=Float64Array}return e},getPixelType:function(A){var e;switch(A){case 0:e="S8";break;case 1:e="U8";break;case 2:e="S16";break;case 3:e="U16";break;case 4:e="S32";break;case 5:e="U32";break;case 6:default:e="F32";break;case 7:e="F64"}return e},isValidPixelValue:function(A,e){if(null==e)return!1;var t;switch(A){case 0:t=e>=-128&&e<=127;break;case 1:t=e>=0&&e<=255;break;case 2:t=e>=-32768&&e<=32767;break;case 3:t=e>=0&&e<=65536;break;case 4:t=e>=-2147483648&&e<=2147483647;break;case 5:t=e>=0&&e<=4294967296;break;case 6:t=e>=-34027999387901484e22&&e<=34027999387901484e22;break;case 7:t=e>=-17976931348623157e292&&e<=17976931348623157e292;break;default:t=!1}return t},getDataTypeSize:function(A){var e=0;switch(A){case 0:case 1:e=1;break;case 2:case 3:e=2;break;case 4:case 5:case 6:e=4;break;case 7:e=8;break;default:e=A}return e},getDataTypeUsed:function(A,e){var t=A;switch(A){case 2:case 4:t=A-e;break;case 3:case 5:t=A-2*e;break;case 6:t=0===e?A:1===e?2:1;break;case 7:t=0===e?A:A-2*e+1;break;default:t=A}return t},getOnePixel:function(A,e,t,i){var r=0;switch(t){case 0:r=i.getInt8(e);break;case 1:r=i.getUint8(e);break;case 2:r=i.getInt16(e,!0);break;case 3:r=i.getUint16(e,!0);break;case 4:r=i.getInt32(e,!0);break;case 5:r=i.getUInt32(e,!0);break;case 6:r=i.getFloat32(e,!0);break;case 7:r=i.getFloat64(e,!0);break;default:throw"the decoder does not understand this pixel type"}return r},swapDimensionOrder:function(A,e,t,i,r){var I=0,g=0,n=0,a=0,o=A;if(t>1)if(o=new i(e*t),r)for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[a]=A[g++];else for(I=0;I<e;I++)for(a=I,n=0;n<t;n++,a+=e)o[g++]=A[a];return o}},E=function(A,e,t){this.val=A,this.left=e,this.right=t},{decode:function(A,e){var t=(e=e||{}).noDataValue,i=0,r={};r.ptr=e.inputOffset||0,r.pixels={},Q.readHeaderInfo(A,r);var I=r.headerInfo,g=I.fileVersion,n=Q.getDataTypeArray(I.imageType);if(g>5)throw"unsupported lerc version 2."+g;Q.readMask(A,r),I.numValidPixel===I.width*I.height||r.pixels.resultMask||(r.pixels.resultMask=e.maskData);var a=I.width*I.height;r.pixels.resultPixels=new n(a*I.numDims),r.counter={onesweep:0,uncompressed:0,lut:0,bitstuffer:0,constant:0,constantoffset:0};var o,B=!e.returnPixelInterleavedDims;if(0!==I.numValidPixel)if(I.zMax===I.zMin)Q.constructConstantSurface(r,B);else if(g>=4&&Q.checkMinMaxRanges(A,r))Q.constructConstantSurface(r,B);else{var C=new DataView(A,r.ptr,2),E=C.getUint8(0);if(r.ptr++,E)Q.readDataOneSweep(A,r,n,B);else if(g>1&&I.imageType<=1&&Math.abs(I.maxZError-.5)<1e-5){var s=C.getUint8(1);if(r.ptr++,r.encodeMode=s,s>2||g<4&&s>1)throw"Invalid Huffman flag "+s;s?Q.readHuffman(A,r,n,B):Q.readTiles(A,r,n,B)}else Q.readTiles(A,r,n,B)}r.eofOffset=r.ptr,e.inputOffset?(o=r.headerInfo.blobSize+e.inputOffset-r.ptr,Math.abs(o)>=1&&(r.eofOffset=e.inputOffset+r.headerInfo.blobSize)):(o=r.headerInfo.blobSize-r.ptr,Math.abs(o)>=1&&(r.eofOffset=r.headerInfo.blobSize));var f={width:I.width,height:I.height,pixelData:r.pixels.resultPixels,minValue:I.zMin,maxValue:I.zMax,validPixelCount:I.numValidPixel,dimCount:I.numDims,dimStats:{minValues:I.minValues,maxValues:I.maxValues},maskData:r.pixels.resultMask};if(r.pixels.resultMask&&Q.isValidPixelValue(I.imageType,t)){var c=r.pixels.resultMask;for(i=0;i<a;i++)c[i]||(f.pixelData[i]=t);f.noDataValue=t}return r.noDataValue=t,e.returnFileInfo&&(f.fileInfo=Q.formatFileInfo(r)),f},getBandCount:function(A){for(var e=0,t=0,i={ptr:0,pixels:{}};t<A.byteLength-58;)Q.readHeaderInfo(A,i),t+=i.headerInfo.blobSize,e++,i.ptr=t;return e}}),l=(s=new ArrayBuffer(4),f=new Uint8Array(s),new Uint32Array(s)[0]=1,1===f[0]),u={decode:function(A,e){if(!l)throw"Big endian system is not supported.";var t,i,r=(e=e||{}).inputOffset||0,I=new Uint8Array(A,r,10),g=String.fromCharCode.apply(null,I);if("CntZImage"===g.trim())t=c,i=1;else{if("Lerc2"!==g.substring(0,5))throw"Unexpected file identifier string: "+g;t=h,i=2}for(var n,a,o,B,C,Q,E=0,s=A.byteLength-10,f=[],u={width:0,height:0,pixels:[],pixelType:e.pixelType,mask:null,statistics:[]},w=0;r<s;){var d=t.decode(A,{inputOffset:r,encodedMaskData:n,maskData:o,returnMask:0===E,returnEncodedMask:0===E,returnFileInfo:!0,returnPixelInterleavedDims:e.returnPixelInterleavedDims,pixelType:e.pixelType||null,noDataValue:e.noDataValue||null});r=d.fileInfo.eofOffset,o=d.maskData,0===E&&(n=d.encodedMaskData,u.width=d.width,u.height=d.height,u.dimCount=d.dimCount||1,u.pixelType=d.pixelType||d.fileInfo.pixelType,u.mask=o),i>1&&(o&&f.push(o),d.fileInfo.mask&&d.fileInfo.mask.numBytes>0&&w++),E++,u.pixels.push(d.pixelData),u.statistics.push({minValue:d.minValue,maxValue:d.maxValue,noDataValue:d.noDataValue,dimStats:d.dimStats})}if(i>1&&w>1){for(Q=u.width*u.height,u.bandMasks=f,(o=new Uint8Array(Q)).set(f[0]),B=1;B<f.length;B++)for(a=f[B],C=0;C<Q;C++)o[C]=o[C]&a[C];u.maskData=o}return u}};TA.exports?TA.exports=u:this.Lerc=u}();var ZA,jA,WA,zA=XA.exports,$A={env:{emscripten_notify_memory_growth:function(A){WA=new Uint8Array(jA.exports.memory.buffer)}}},Ae=function(){function A(){B(this,A)}return Q(A,[{key:"init",value:function(){return ZA||(ZA="undefined"!=typeof fetch?fetch("data:application/wasm;base64,"+ee).then((function(A){return A.arrayBuffer()})).then((function(A){return WebAssembly.instantiate(A,$A)})).then(this._init):WebAssembly.instantiate(Buffer.from(ee,"base64"),$A).then(this._init))}},{key:"_init",value:function(A){jA=A.instance,$A.env.emscripten_notify_memory_growth(0)}},{key:"decode",value:function(A){var e=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0;if(!jA)throw new Error("ZSTDDecoder: Await .init() before decoding.");var t=A.byteLength,i=jA.exports.malloc(t);WA.set(A,i),e=e||Number(jA.exports.ZSTD_findDecompressedSize(i,t));var r=jA.exports.malloc(e),I=jA.exports.ZSTD_decompress(r,e,i,t),g=WA.slice(r,r+I);return jA.exports.free(i),jA.exports.free(r),g}}]),A}(),ee="AGFzbQEAAAABpQEVYAF/AX9gAn9/AGADf39/AX9gBX9/f39/AX9gAX8AYAJ/fwF/YAR/f39/AX9gA39/fwBgBn9/f39/fwF/YAd/f39/f39/AX9gAn9/AX5gAn5+AX5gAABgBX9/f39/AGAGf39/f39/AGAIf39/f39/f38AYAl/f39/f39/f38AYAABf2AIf39/f39/f38Bf2ANf39/f39/f39/f39/fwF/YAF/AX4CJwEDZW52H2Vtc2NyaXB0ZW5fbm90aWZ5X21lbW9yeV9ncm93dGgABANpaAEFAAAFAgEFCwACAQABAgIFBQcAAwABDgsBAQcAEhMHAAUBDAQEAAANBwQCAgYCBAgDAwMDBgEACQkHBgICAAYGAgQUBwYGAwIGAAMCAQgBBwUGCgoEEQAEBAEIAwgDBQgDEA8IAAcABAUBcAECAgUEAQCAAgYJAX8BQaCgwAILB2AHBm1lbW9yeQIABm1hbGxvYwAoBGZyZWUAJgxaU1REX2lzRXJyb3IAaBlaU1REX2ZpbmREZWNvbXByZXNzZWRTaXplAFQPWlNURF9kZWNvbXByZXNzAEoGX3N0YXJ0ACQJBwEAQQELASQKussBaA8AIAAgACgCBCABajYCBAsZACAAKAIAIAAoAgRBH3F0QQAgAWtBH3F2CwgAIABBiH9LC34BBH9BAyEBIAAoAgQiA0EgTQRAIAAoAggiASAAKAIQTwRAIAAQDQ8LIAAoAgwiAiABRgRAQQFBAiADQSBJGw8LIAAgASABIAJrIANBA3YiBCABIARrIAJJIgEbIgJrIgQ2AgggACADIAJBA3RrNgIEIAAgBCgAADYCAAsgAQsUAQF/IAAgARACIQIgACABEAEgAgv3AQECfyACRQRAIABCADcCACAAQQA2AhAgAEIANwIIQbh/DwsgACABNgIMIAAgAUEEajYCECACQQRPBEAgACABIAJqIgFBfGoiAzYCCCAAIAMoAAA2AgAgAUF/ai0AACIBBEAgAEEIIAEQFGs2AgQgAg8LIABBADYCBEF/DwsgACABNgIIIAAgAS0AACIDNgIAIAJBfmoiBEEBTQRAIARBAWtFBEAgACABLQACQRB0IANyIgM2AgALIAAgAS0AAUEIdCADajYCAAsgASACakF/ai0AACIBRQRAIABBADYCBEFsDwsgAEEoIAEQFCACQQN0ams2AgQgAgsWACAAIAEpAAA3AAAgACABKQAINwAICy8BAX8gAUECdEGgHWooAgAgACgCAEEgIAEgACgCBGprQR9xdnEhAiAAIAEQASACCyEAIAFCz9bTvtLHq9lCfiAAfEIfiUKHla+vmLbem55/fgsdAQF/IAAoAgggACgCDEYEfyAAKAIEQSBGBUEACwuCBAEDfyACQYDAAE8EQCAAIAEgAhBnIAAPCyAAIAJqIQMCQCAAIAFzQQNxRQRAAkAgAkEBSARAIAAhAgwBCyAAQQNxRQRAIAAhAgwBCyAAIQIDQCACIAEtAAA6AAAgAUEBaiEBIAJBAWoiAiADTw0BIAJBA3ENAAsLAkAgA0F8cSIEQcAASQ0AIAIgBEFAaiIFSw0AA0AgAiABKAIANgIAIAIgASgCBDYCBCACIAEoAgg2AgggAiABKAIMNgIMIAIgASgCEDYCECACIAEoAhQ2AhQgAiABKAIYNgIYIAIgASgCHDYCHCACIAEoAiA2AiAgAiABKAIkNgIkIAIgASgCKDYCKCACIAEoAiw2AiwgAiABKAIwNgIwIAIgASgCNDYCNCACIAEoAjg2AjggAiABKAI8NgI8IAFBQGshASACQUBrIgIgBU0NAAsLIAIgBE8NAQNAIAIgASgCADYCACABQQRqIQEgAkEEaiICIARJDQALDAELIANBBEkEQCAAIQIMAQsgA0F8aiIEIABJBEAgACECDAELIAAhAgNAIAIgAS0AADoAACACIAEtAAE6AAEgAiABLQACOgACIAIgAS0AAzoAAyABQQRqIQEgAkEEaiICIARNDQALCyACIANJBEADQCACIAEtAAA6AAAgAUEBaiEBIAJBAWoiAiADRw0ACwsgAAsMACAAIAEpAAA3AAALQQECfyAAKAIIIgEgACgCEEkEQEEDDwsgACAAKAIEIgJBB3E2AgQgACABIAJBA3ZrIgE2AgggACABKAAANgIAQQALDAAgACABKAIANgAAC/cCAQJ/AkAgACABRg0AAkAgASACaiAASwRAIAAgAmoiBCABSw0BCyAAIAEgAhALDwsgACABc0EDcSEDAkACQCAAIAFJBEAgAwRAIAAhAwwDCyAAQQNxRQRAIAAhAwwCCyAAIQMDQCACRQ0EIAMgAS0AADoAACABQQFqIQEgAkF/aiECIANBAWoiA0EDcQ0ACwwBCwJAIAMNACAEQQNxBEADQCACRQ0FIAAgAkF/aiICaiIDIAEgAmotAAA6AAAgA0EDcQ0ACwsgAkEDTQ0AA0AgACACQXxqIgJqIAEgAmooAgA2AgAgAkEDSw0ACwsgAkUNAgNAIAAgAkF/aiICaiABIAJqLQAAOgAAIAINAAsMAgsgAkEDTQ0AIAIhBANAIAMgASgCADYCACABQQRqIQEgA0EEaiEDIARBfGoiBEEDSw0ACyACQQNxIQILIAJFDQADQCADIAEtAAA6AAAgA0EBaiEDIAFBAWohASACQX9qIgINAAsLIAAL8wICAn8BfgJAIAJFDQAgACACaiIDQX9qIAE6AAAgACABOgAAIAJBA0kNACADQX5qIAE6AAAgACABOgABIANBfWogAToAACAAIAE6AAIgAkEHSQ0AIANBfGogAToAACAAIAE6AAMgAkEJSQ0AIABBACAAa0EDcSIEaiIDIAFB/wFxQYGChAhsIgE2AgAgAyACIARrQXxxIgRqIgJBfGogATYCACAEQQlJDQAgAyABNgIIIAMgATYCBCACQXhqIAE2AgAgAkF0aiABNgIAIARBGUkNACADIAE2AhggAyABNgIUIAMgATYCECADIAE2AgwgAkFwaiABNgIAIAJBbGogATYCACACQWhqIAE2AgAgAkFkaiABNgIAIAQgA0EEcUEYciIEayICQSBJDQAgAa0iBUIghiAFhCEFIAMgBGohAQNAIAEgBTcDGCABIAU3AxAgASAFNwMIIAEgBTcDACABQSBqIQEgAkFgaiICQR9LDQALCyAACy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAIajYCACADCy8BAn8gACgCBCAAKAIAQQJ0aiICLQACIQMgACACLwEAIAEgAi0AAxAFajYCACADCx8AIAAgASACKAIEEAg2AgAgARAEGiAAIAJBCGo2AgQLCAAgAGdBH3MLugUBDX8jAEEQayIKJAACfyAEQQNNBEAgCkEANgIMIApBDGogAyAEEAsaIAAgASACIApBDGpBBBAVIgBBbCAAEAMbIAAgACAESxsMAQsgAEEAIAEoAgBBAXRBAmoQECENQVQgAygAACIGQQ9xIgBBCksNABogAiAAQQVqNgIAIAMgBGoiAkF8aiEMIAJBeWohDiACQXtqIRAgAEEGaiELQQQh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ASIDNgLE4AEgACgCvOABIQQgACABNgK84AEgACABIAJqNgK44AEgACABIAQgA2tqNgLA4AELpgEBAX8gACAAKALs4QEQFjYCyOABIABCADcD+OABIABCADcDuOABIABBwOABakIANwMAIABBqNAAaiIBQYyAgOAANgIAIABBADYCmOIBIABCADcDiOEBIABCAzcDgOEBIABBrNABakHgEikCADcCACAAQbTQAWpB6BIoAgA2AgAgACABNgIMIAAgAEGYIGo2AgggACAAQaAwajYCBCAAIABBEGo2AgALYQEBf0G4fyEDAkAgAUEDSQ0AIAIgABAhIgFBA3YiADYCCCACIAFBAXE2AgQgAiABQQF2QQNxIgM2AgACQCADQX9qIgFBAksNAAJAIAFBAWsOAgEAAgtBbA8LIAAhAwsgAwsMACAAIAEgAkEAEC4LiAQCA38CfiADEBYhBCAAQQBBKBAQIQAgBCACSwRAIAQPCyABRQRAQX8PCwJAAkAgA0EBRg0AIAEoAAAiBkGo6r5pRg0AQXYhAyAGQXBxQdDUtMIBRw0BQQghAyACQQhJDQEgAEEAQSgQECEAIAEoAAQhASAAQQE2AhQgACABrTcDAEEADwsgASACIAMQLyIDIAJLDQAgACADNgIYQXIhAyABIARqIgVBf2otAAAiAkEIcQ0AIAJBIHEiBkUEQEFwIQMgBS0AACIFQacBSw0BIAVBB3GtQgEgBUEDdkEKaq2GIgdCA4h+IAd8IQggBEEBaiEECyACQQZ2IQMgAkECdiEFAkAgAkEDcUF/aiICQQJLBEBBACECDAELAkACQAJAIAJBAWsOAgECAAsgASAEai0AACECIARBAWohBAwCCyABIARqLwAAIQIgBEECaiEEDAELIAEgBGooAAAhAiAEQQRqIQQLIAVBAXEhBQJ+AkACQAJAIANBf2oiA0ECTQRAIANBAWsOAgIDAQtCfyAGRQ0DGiABIARqMQAADAMLIAEgBGovAACtQoACfAwCCyABIARqKAAArQwBCyABIARqKQAACyEHIAAgBTYCICAAIAI2AhwgACAHNwMAQQAhAyAAQQA2AhQgACAHIAggBhsiBzcDCCAAIAdCgIAIIAdCgIAIVBs+AhALIAMLWwEBf0G4fyEDIAIQFiICIAFNBH8gACACakF/ai0AACIAQQNxQQJ0QaAeaigC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C0Egak8NAQsgByAHKQNoNwMQIAcgBykDYDcDCCAEIA0gB0EIaiAHQdwAaiAPIA4gESAQEB4hCwwBCyACIARqIQggBCAKEAcgAkERTwRAIARBEGohAgNAIAIgCkEQaiIKEAcgAkEQaiICIAhJDQALCyAIIAlrIQIgByATNgJcIAkgCCAOa0sEQCAJIAggEWtLBEBBbCELDAILIBAgAiAOayICaiIKIANqIBBNBEAgCCAKIAMQDxoMAgsgCCAKQQAgAmsQDyEIIAcgAiADaiIDNgJkIAggAmshCCAOIQILIAlBEE8EQCADIAhqIQMDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALDAELAkAgCUEHTQRAIAggAi0AADoAACAIIAItAAE6AAEgCCACLQACOgACIAggAi0AAzoAAyAIQQRqIAIgCUECdCIDQcAeaigCAGoiAhAXIAIgA0HgHmooAgBrIQIgBygCZCEDDAELIAggAhAMCyADQQlJDQAgAyAIaiEDIAhBCGoiCCACQQhqIgJrQQ9MBEADQCAIIAIQDCACQQhqIQIgCEEIaiIIIANJDQAMAgALAAsDQCAIIAIQByACQRBqIQIgCEEQaiIIIANJDQALCyAHQRhqEAQaIAsgDCALEAMiAhshDCAEIAQgC2ogAhshBCAFQX9qIgUNAAsgDBADDQFBbCEMIAdBGGoQBEECSQ0BQQAhCANAIAhBA0cEQCAAIAhBAnQiAmpBrNABaiACIAdqKAJENgIAIAhBAWohCAwBCwsgBygCXCEIC0G6fyEMIA8gCGsiACANIARrSw0AIAQEfyAEIAggABALIABqBUEACyABayEMCyAHQfAAaiQAIAwLkRcCFn8FfiMAQdABayIHJAAgByAAKALw4QEiCDYCvAEgASACaiESIAggACgCgOIBaiETAkACQCAFRQRAIAEhAwwBCyAAKALE4AEhESAAKALA4AEhFSAAKAK84AEhDyAAQQE2AozhAUEAIQgDQCAIQQNHBEAgByAIQQJ0IgJqIAAgAmpBrNABaigCADYCVCAIQQFqIQgMAQsLIAcgETYCZCAHIA82AmAgByABIA9rNgJoQWwhECAHQShqIAMgBBAGEAMNASAFQQQgBUEESBshFyAHQTxqIAdBKGogACgCABATIAdBxABqIAdBKGogACgCCBATIAdBzABqIAdB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IAdB0AFqJAAgEAslACAAQgA3AgAgAEEAOwEIIABBADoACyAAIAE2AgwgACACOgAKC7QFAQN/IwBBMGsiBCQAIABB/wFqIgVBfWohBgJAIAMvAQIEQCAEQRhqIAEgAhAGIgIQAw0BIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahASOgAAIAMgBEEIaiAEQRhqEBI6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0FIAEgBEEQaiAEQRhqEBI6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBSABIARBCGogBEEYahASOgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEjoAACABIAJqIABrIQIMAwsgAyAEQRBqIARBGGoQEjoAAiADIARBCGogBEEYahASOgADIANBBGohAwwAAAsACyAEQRhqIAEgAhAGIgIQAw0AIARBEGogBEEYaiADEBwgBEEIaiAEQRhqIAMQHCAAIQMDQAJAIARBGGoQBCADIAZPckUEQCADIARBEGogBEEYahAROgAAIAMgBEEIaiAEQRhqEBE6AAEgBEEYahAERQ0BIANBAmohAwsgBUF+aiEFAn8DQEG6fyECIAMiASAFSw0EIAEgBEEQaiAEQRhqEBE6AAAgAUEBaiEDIARBGGoQBEEDRgRAQQIhAiAEQQhqDAILIAMgBUsNBCABIARBCGogBEEYahAROgABIAFBAmohA0EDIQIgBEEYahAEQQNHDQALIARBEGoLIQUgAyAFIARBGGoQEToAACABIAJqIABrIQIMAgsgAyAEQRBqIARBGGoQEToAAiADIARBCGogBEEYahAROgADIANBBGohAwwAAAsACyAEQTBqJAAgAgtpAQF/An8CQAJAIAJBB00NACABKAAAQbfIwuF+Rw0AIAAgASgABDYCmOIBQWIgAEEQaiABIAIQPiIDEAMNAhogAEKBgICAEDcDiOEBIAAgASADaiACIANrECoMAQsgACABIAIQKgtBAAsLrQMBBn8jAEGAAWsiAyQAQWIhCAJAIAJBCUkNACAAQZjQAGogAUEIaiIEIAJBeGogAEGY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wOABCwutAgIEfwF+IwBBQGoiBCQAAkACQCACQQhJDQAgASgAAEFwcUHQ1LTCAUcNACABIAIQIiEBIABCADcDCCAAQQA2AgQgACABNgIADAELIARBGGogASACEC0iAxADBEAgACADEBoMAQsgAwRAIABBuH8QGgwBCyACIAQoAjAiA2shAiABIANqIQMDQAJAIAAgAyACIARBCGoQLCIFEAMEfyAFBSACIAVBA2oiBU8NAUG4fwsQGgwCCyAGQQFqIQYgAiAFayECIAMgBWohAyAEKAIMRQ0ACyAEKAI4BEAgAkEDTQRAIABBuH8QGgwCCyADQQRqIQMLIAQoAighAiAEKQMYIQcgAEEANgIEIAAgAyABazYCACAAIAIgBmytIAcgB0J/URs3AwgLIARBQGskAAslAQF/IwBBEGsiAiQAIAIgACABEFEgAigCACEAIAJBEGokACAAC30BBH8jAEGQBGsiBCQAIARB/wE2AggCQCAEQRBqIARBCGogBEEMaiABIAIQFSIGEAMEQCAGIQUMAQtBVCEFIAQoAgwiB0EGSw0AIAMgBEEQaiAEKAIIIAcQQSIFEAMNACAAIAEgBmogAiAGayADEDwhBQsgBEGQBGokACAFC4cBAgJ/An5BABAWIQMCQANAIAEgA08EQAJAIAAoAABBcHFB0NS0wgFGBEAgACABECIiAhADRQ0BQn4PCyAAIAEQVSIEQn1WDQMgBCAFfCIFIARUIQJCfiEEIAINAyAAIAEQUiICEAMNAwsgASACayEBIAAgAmohAAwBCwtCfiAFIAEbIQQLIAQLPwIBfwF+IwBBMGsiAiQAAn5CfiACQQhqIAAgARAtDQAaQgAgAigCHEEBRg0AGiACKQMICyEDIAJBMGokACADC40BAQJ/IwBBMGsiASQAAkAgAEUNACAAKAKI4gENACABIABB/OEBaigCADYCKCABIAApAvThATcDICAAEDAgACgCqOIBIQIgASABKAIoNgIYIAEgASkDIDcDECACIAFBEGoQGyAAQQA2AqjiASABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALKgECfyMAQRBrIgAkACAAQQA2AgggAEIANwMAIAAQWCEBIABBEGokACABC4cBAQN/IwBBEGsiAiQAAkAgACgCAEUgACgCBEVzDQAgAiAAKAIINgIIIAIgACkCADcDAAJ/IAIoAgAiAQRAIAIoAghBqOMJIAERBQAMAQtBqOMJECgLIgFFDQAgASAAKQIANwL04QEgAUH84QFqIAAoAgg2AgAgARBZIAEhAwsgAkEQaiQAIAMLywEBAn8jAEEgayIBJAAgAEGBgIDAADYCtOIBIABBADYCiOIBIABBADYC7OEBIABCADcDkOIBIABBADYCpOMJIABBADYC3OIBIABCADcCzOIBIABBADYCvOIBIABBADYCxOABIABCADcCnOIBIABBpOIBakIANwIAIABBrOIBakEANgIAIAFCADcCECABQgA3AhggASABKQMYNwMIIAEgASkDEDcDACABKAIIQQh2QQFxIQIgAEEANgLg4gEgACACNgKM4gEgAUEgaiQAC3YBA38jAEEwayIBJAAgAARAIAEgAEHE0AFqIgIoAgA2AiggASAAKQK80AE3AyAgACgCACEDIAEgAigCADYCGCABIAApArzQATcDECADIAFBEGoQGyABIAEoAig2AgggASABKQMgNwMAIAAgARAbCyABQTBqJAALzAEBAX8gACABKAK00AE2ApjiASAAIAEoAgQiAjYCwOABIAAgAjYCvOABIAAgAiABKAIIaiICNgK44AEgACACNgLE4AEgASgCuNABBEAgAEKBgICAEDcDiOEBIAAgAUGk0ABqNgIMIAAgAUGUIGo2AgggACABQZwwajYCBCAAIAFBDGo2AgAgAEGs0AFqIAFBqNABaigCADYCACAAQbDQAWogAUGs0AFqKAIANgIAIABBtNABaiABQbDQAWooAgA2AgAPCyAAQgA3A4jhAQs7ACACRQRAQbp/DwsgBEUEQEFsDwsgAiAEEGAEQCAAIAEgAiADIAQgBRBhDwsgACABIAIgAyAEIAUQZQtGAQF/IwBBEGsiBSQAIAVBCGogBBAOAn8gBS0ACQRAIAAgASACIAMgBBAyDAELIAAgASACIAMgBBA0CyEAIAVBEGokACAACzQAIAAgAyAEIAUQNiIFEAMEQCAFDwsgBSAESQR/IAEgAiADIAVqIAQgBWsgABA1BUG4fwsLRgEBfyMAQRBrIgUkACAFQQhqIAQQDgJ/IAUtAAkEQCAAIAEgAiADIAQQYgwBCyAAIAEgAiADIAQQNQshACAFQRBqJAAgAAtZAQF/QQ8hAiABIABJBEAgAUEE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",te={315:"Artist",258:"BitsPerSample",265:"CellLength",264:"CellWidth",320:"ColorMap",259:"Compression",33432:"Copyright",306:"DateTime",338:"ExtraSamples",266:"FillOrder",289:"FreeByteCounts",288:"FreeOffsets",291:"GrayResponseCurve",290:"GrayResponseUnit",316:"HostComputer",270:"ImageDescription",257:"ImageLength",256:"ImageWidth",271:"Make",281:"MaxSampleValue",280:"MinSampleValue",272:"Model",254:"NewSubfileType",274:"Orientation",262:"PhotometricInterpretation",284:"PlanarConfiguration",296:"ResolutionUnit",278:"RowsPerStrip",277:"SamplesPerPixel",305:"Software",279:"StripByteCounts",273:"StripOffsets",255:"SubfileType",263:"Threshholding",282:"XResolution",283:"YResolution",326:"BadFaxLines",327:"CleanFaxData",343:"ClipPath",328:"ConsecutiveBadFaxLines",433:"Decode",434:"DefaultImageColor",269:"DocumentName",336:"DotRange",321:"HalftoneHints",346:"Indexed",347:"JPEGTables",285:"PageName",297:"PageNumber",317:"Predictor",319:"PrimaryChromaticities",532:"ReferenceBlackWhite",339:"SampleFormat",340:"SMinSampleValue",341:"SMaxSampleValue",559:"StripRowCounts",330:"SubIFDs",292:"T4Options",293:"T6Options",325:"TileByteCounts",323:"TileLength",324:"TileOffsets",322:"TileWidth",301:"TransferFunction",318:"WhitePoint",344:"XClipPathUnits",286:"XPosition",529:"YCbCrCoefficients",531:"YCbCrPositioning",530:"YCbCrSubSampling",345:"YClipPathUnits",287:"YPosition",37378:"ApertureValue",40961:"ColorSpace",36868:"DateTimeDigitized",36867:"DateTimeOriginal",34665:"Exif IFD",36864:"ExifVersion",33434:"ExposureTime",41728:"FileSource",37385:"Flash",40960:"FlashpixVersion",33437:"FNumber",42016:"ImageUniqueID",37384:"LightSource",37500:"MakerNote",37377:"ShutterSpeedValue",37510:"UserComment",33723:"IPTC",34675:"ICC Profile",700:"XMP",42112:"GDAL_METADATA",42113:"GDAL_NODATA",34377:"Photoshop",33550:"ModelPixelScale",33922:"ModelTiepoint",34264:"ModelTransformation",34735:"GeoKeyDirectory",34736:"GeoDoubleParams",34737:"GeoAsciiParams",50674:"LercParameters"},ie={};for(var re in te)te.hasOwnProperty(re)&&(ie[te[re]]=parseInt(re,10));ie.BitsPerSample,ie.ExtraSamples,ie.SampleFormat,ie.StripByteCounts,ie.StripOffsets,ie.StripRowCounts,ie.TileByteCounts,ie.TileOffsets,ie.SubIFDs;var Ie={1:"BYTE",2:"ASCII",3:"SHORT",4:"LONG",5:"RATIONAL",6:"SBYTE",7:"UNDEFINED",8:"SSHORT",9:"SLONG",10:"SRATIONAL",11:"FLOAT",12:"DOUBLE",13:"IFD",16:"LONG8",17:"SLONG8",18:"IFD8"},ge={};for(var ne in Ie)Ie.hasOwnProperty(ne)&&(ge[Ie[ne]]=parseInt(ne,10));var ae=1,oe=0,Be=1,Ce=2,Qe={1024:"GTModelTypeGeoKey",1025:"GTRasterTypeGeoKey",1026:"GTCitationGeoKey",2048:"GeographicTypeGeoKey",2049:"GeogCitationGeoKey",2050:"GeogGeodeticDatumGeoKey",2051:"GeogPrimeMeridianGeoKey",2052:"GeogLinearUnitsGeoKey",2053:"GeogLinearUnitSizeGeoKey",2054:"GeogAngularUnitsGeoKey",2055:"GeogAngularUnitSizeGeoKey",2056:"GeogEllipsoidGeoKey",2057:"GeogSemiMajorAxisGeoKey",2058:"GeogSemiMinorAxisGeoKey",2059:"GeogInvFlatteningGeoKey",2060:"GeogAzimuthUnitsGeoKey",2061:"GeogPrimeMeridianLongGeoKey",2062:"GeogTOWGS84GeoKey",3072:"ProjectedCSTypeGeoKey",3073:"PCSCitationGeoKey",3074:"ProjectionGeoKey",3075:"ProjCoordTransGeoKey",3076:"ProjLinearUnitsGeoKey",3077:"ProjLinearUnitSizeGeoKey",3078:"ProjStdParallel1GeoKey",3079:"ProjStdParallel2GeoKey",3080:"ProjNatOriginLongGeoKey",3081:"ProjNatOriginLatGeoKey",3082:"ProjFalseEastingGeoKey",3083:"ProjFalseNorthingGeoKey",3084:"ProjFalseOriginLongGeoKey",3085:"ProjFalseOriginLatGeoKey",3086:"ProjFalseOriginEastingGeoKey",3087:"ProjFalseOriginNorthingGeoKey",3088:"ProjCenterLongGeoKey",3089:"ProjCenterLatGeoKey",3090:"ProjCenterEastingGeoKey",3091:"ProjCenterNorthingGeoKey",3092:"ProjScaleAtNatOriginGeoKey",3093:"ProjScaleAtCenterGeoKey",3094:"ProjAzimuthAngleGeoKey",3095:"ProjStraightVertPoleLongGeoKey",3096:"ProjRectifiedGridAngleGeoKey",4096:"VerticalCSTypeGeoKey",4097:"VerticalCitationGeoKey",4098:"VerticalDatumGeoKey",4099:"VerticalUnitsGeoKey"},Ee={};for(var se in Qe)Qe.hasOwnProperty(se)&&(Ee[Qe[se]]=parseInt(se,10));function fe(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var ce=new Ae,he=function(A){s(t,w);var e=fe(t);function t(A){var i;return B(this,t),(i=e.call(this)).planarConfiguration=void 0!==A.PlanarConfiguration?A.PlanarConfiguration:1,i.samplesPerPixel=void 0!==A.SamplesPerPixel?A.SamplesPerPixel:1,i.addCompression=A.LercParameters[ae],i}return Q(t,[{key:"decodeBlock",value:function(A){switch(this.addCompression){case oe:break;case Be:A=YA(new Uint8Array(A)).buffer;break;case Ce:A=ce.decode(new Uint8Array(A)).buffer;break;default:throw new Error("Unsupported LERC additional compression method identifier: ".concat(this.addCompression))}return zA.decode(A,{returnPixelInterleavedDims:1===this.planarConfiguration}).pixels[0].buffer}}]),t}(),le=Object.freeze({__proto__:null,zstd:ce,default:he});function ue(A){var e=function(){if("undefined"==typeof Reflect||!Reflect.construct)return!1;if(Reflect.construct.sham)return!1;if("function"==typeof Proxy)return!0;try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],(function(){}))),!0}catch(A){return!1}}();return function(){var t,i=c(A);if(e){var r=c(this).constructor;t=Reflect.construct(i,arguments,r)}else t=i.apply(this,arguments);return f(this,t)}}var we=function(A){s(I,w);var t,i=ue(I);function I(){var A;if(B(this,I),A=i.call(this),"undefined"==typeof createImageBitmap)throw new Error("Cannot decode WebImage as `createImageBitmap` is not available");if("undefined"==typeof document&&"undefined"==typeof OffscreenCanvas)throw new Error("Cannot decode WebImage as neither `document` nor `OffscreenCanvas` is not available");return A}return Q(I,[{key:"decode",value:(t=e(r.mark((function A(e,t){var i,I,g,n;return r.wrap((function(A){for(;;)switch(A.prev=A.next){case 0:return i=new Blob([t]),A.next=3,createImageBitmap(i);case 3:return I=A.sent,"undefined"!=typeof document?((g=document.createElement("canvas")).width=I.width,g.height=I.height):g=new OffscreenCanvas(I.width,I.height),(n=g.getContext("2d")).drawImage(I,0,0),A.abrupt("return",n.getImageData(0,0,I.width,I.height).data.buffer);case 8:case"end":return A.stop()}}),A)}))),function(A,e){return t.apply(this,arguments)})}]),I}(),de=Object.freeze({__proto__:null,default:we});';
  return new za(typeof Buffer < "u" ? "data:application/javascript;base64," + Buffer.from(t, "binary").toString("base64") : URL.createObjectURL(new Blob([t], { type: "application/javascript" })));
}
const As = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  create: $a
}, Symbol.toStringTag, { value: "Module" }));
export {
  co as enableGeoTIFFTileSource
};
