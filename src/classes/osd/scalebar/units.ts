// @ts-nocheck -- mechanical port of the former `src/external/scalebar.js`.
// Split out of the single 3388-line IIFE and moved into the core TS build so
// esbuild inlines it into `dist/app.js` instead of shipping it as a separate
// startup <script>. Bodies are unchanged JS; typing them is deliberate
// follow-up work and must not be mixed into a behaviour-identical move.

const OSD: any = (window as any).OpenSeadragon;

OSD.ScalebarSizeAndTextRenderer = {
    /**
     * Metric length. From nano meters to kilometers.
     */
    METRIC_LENGTH: function(ppm, minSize) {
        return getScalebarSizeAndTextForMetric("m", ppm, minSize);
    },
    /**
     * Imperial length. Choosing the best unit from thou, inch, foot and mile.
     */
    IMPERIAL_LENGTH: function(ppm, minSize) {
        var maxSize = minSize * 2;
        var ppi = ppm * 0.0254;
        if (maxSize < ppi * 12) {
            if (maxSize < ppi) {
                var ppt = ppi / 1000;
                return getScalebarSizeAndText("th", ppt, minSize);
            }
            return getScalebarSizeAndText("in", ppi, minSize);
        }
        var ppf = ppi * 12;
        if (maxSize < ppf * 2000) {
            return getScalebarSizeAndText("ft", ppf, minSize);
        }
        var ppmi = ppf * 5280;
        return getScalebarSizeAndText("mi", ppmi, minSize);
    },
    /**
     * Astronomy units. Choosing the best unit from arcsec, arcminute, and degree
     */
    ASTRONOMY: function(ppa, minSize) {
        var maxSize = minSize * 2;
        if (maxSize < ppa * 60) {
            return getScalebarSizeAndText("\"", ppa, minSize, false, '');
        }
        var ppminutes = ppa * 60;
        if (maxSize < ppminutes * 60) {
            return getScalebarSizeAndText("\'", ppminutes, minSize, false, '');
        }
        var ppd = ppminutes * 60;
        return getScalebarSizeAndText("&#176", ppd, minSize, false, '');
    },
    /**
     * Standard time. Choosing the best unit from second (and metric divisions),
     * minute, hour, day and year.
     */
    STANDARD_TIME: function(pps, minSize) {
        var maxSize = minSize * 2;
        if (maxSize < pps * 60) {
            return getScalebarSizeAndTextForMetric("s", pps, minSize);
        }
        var ppminutes = pps * 60;
        if (maxSize < ppminutes * 60) {
            return getScalebarSizeAndText("minute", ppminutes, minSize, true);
        }
        var pph = ppminutes * 60;
        if (maxSize < pph * 24) {
            return getScalebarSizeAndText("hour", pph, minSize, true);
        }
        var ppd = pph * 24;
        if (maxSize < ppd * 365.25) {
            return getScalebarSizeAndText("day", ppd, minSize, true);
        }
        var ppy = ppd * 365.25;
        return getScalebarSizeAndText("year", ppy, minSize, true);
    },
    /**
     * Generic metric unit. One can use this function to create a new metric
     * scale. For example, here is an implementation of energy levels:
     * function(ppeV, minSize) {
     * return OpenSeadragon.ScalebarSizeAndTextRenderer.METRIC_GENERIC("eV", ppeV, minSize);
     * }
     */
    METRIC_GENERIC: getScalebarSizeAndTextForMetric
};

// Missing TiledImage.viewportToImageZoom function in OSD 2.0.0
function tiledImageViewportToImageZoom(tiledImage, viewportZoom) {
    var ratio = tiledImage._scaleSpring.current.value *
        tiledImage.viewport._containerInnerSize.x /
        tiledImage.source.dimensions.x;
    return ratio * viewportZoom;
}

function getScalebarSizeAndText(unitSuffix, ppm, minSize, handlePlural, spacer) {
    spacer = spacer === undefined ? ' ' : spacer;
    var value = normalize(ppm, minSize);
    var factor = roundSignificand(value / ppm * minSize, 3);
    var size = value * minSize;
    var plural = handlePlural && factor > 1 ? "s" : "";
    return {
        size: size,
        text: factor + spacer + unitSuffix + plural
    };
}

function getScalebarSizeAndTextForMetric(unitSuffix, ppm, minSize, shouldFactorizeUnit=true) {
    var value = normalize(ppm, minSize);
    var factor = roundSignificand(value / ppm * minSize, 3);
    var size = value * minSize;
    var valueWithUnit = shouldFactorizeUnit ? getWithUnit(factor, unitSuffix) : getWithSpaces(factor, unitSuffix);
    return {
        size: size,
        text: valueWithUnit
    };
}

function normalize(value, minSize) {
    var significand = getSignificand(value);
    var minSizeSign = getSignificand(minSize);
    var result = getSignificand(significand / minSizeSign);
    if (result >= 5) {
        result /= 5;
    }
    if (result >= 4) {
        result /= 4;
    }
    if (result >= 2) {
        result /= 2;
    }
    return result;
}

function getSignificand(x) {
    return x * Math.pow(10, Math.ceil(-log10(x)));
}

function roundSignificand(x, decimalPlaces) {
    var exponent = -Math.ceil(-log10(x));
    var power = decimalPlaces - exponent;
    var significand = x * Math.pow(10, power);
    // To avoid rounding problems, always work with integers
    if (power < 0) {
        return Math.round(significand) * Math.pow(10, -power);
    }
    return Math.round(significand) / Math.pow(10, power);
}

function log10(x) {
    return Math.log(x) / Math.log(10);
}

function getWithUnit(value, unitSuffix) {
    const negative = value < 0;
    value = Math.abs(value);
    if (value < 0.000001) {
        return (negative ? "-" : "") + value * 1000000000 + " n" + unitSuffix;
    }
    if (value < 0.001) {
        return (negative ? "-" : "") + value * 1000000 + " μ" + unitSuffix;
    }
    if (value < 1) {
        return (negative ? "-" : "") + value * 1000 + " m" + unitSuffix;
    }
    if (value < 1000) {
        return (negative ? "-" : "") + value + unitSuffix;
    }
    if (value >= 1000) {
        return (negative ? "-" : "") + value / 1000 + " k" + unitSuffix;
    }
    return (negative ? "-" : "") + getWithSpaces(value / 1000, "k" + unitSuffix);
}

function getWithUnitRounded(value, unitSuffix) {
    const negative = value < 0;
    value = Math.abs(value);
    if (value < 0.000001) {
        return (negative ? "-" : "") + (Math.round(value * 100000000000) / 100) + " n" + unitSuffix;
    }
    if (value < 0.001) {
        return (negative ? "-" : "") + (Math.round(value * 100000000) / 100) + " μ" + unitSuffix;
    }
    if (value < 1) {
        return (negative ? "-" : "") + (Math.round(value * 100000) / 100) + " m" + unitSuffix;
    }
    if (value < 1000) {
        return (negative ? "-" : "") + (Math.round(value * 100) / 100) + unitSuffix;
    }
    if (value >= 1000) {
        return (negative ? "-" : "") + (Math.round(value / 10) / 100) + " k" + unitSuffix;
    }
    return (negative ? "-" : "") + getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
}

function getWithSquareUnitRounded(value, unitSuffix) {
    const negative = value < 0;
    value = Math.abs(value);
    // No support for NM
    if (value < 0.000001) {
        return (negative ? "-" : "") + getWithSpaces(Math.round(value * 100000000000000) / 100, " μ" + unitSuffix);
    }
    if (value < 1) {
        return (negative ? "-" : "") + getWithSpaces(Math.round(value * 100000000) / 100, " m" + unitSuffix);
    }
    if (value < 1000000) {
        return (negative ? "-" : "") + getWithSpaces(Math.round(value * 100) / 100, unitSuffix);
    }
    if (value >= 1000000) {
        return (negative ? "-" : "") + getWithSpaces(Math.round(value / 10) / 100, " k" + unitSuffix);
    }
    return (negative ? "-" : "") + getWithSpaces(Math.round(value) / 1000, "k" + unitSuffix);
}

function getWithSpaces(value, unitSuffix) {
    if (value < 0) return "Negative!";
    //https://gist.github.com/MSerj/ad23c73f65e3610bbad96a5ac06d4924
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " " + unitSuffix;
}

function isDefined(variable) {
    return typeof (variable) !== "undefined";
}

// Map an OpenSeadragon rotation (which OSD keeps as 0..360) onto a signed
// -180..+180 range, which reads more intuitively in the rotation UI.
function toSignedRotation(deg) {
    const d = ((deg % 360) + 360) % 360;
    return d > 180 ? d - 360 : d;
}

export {
    tiledImageViewportToImageZoom,
    getWithUnitRounded,
    getWithSquareUnitRounded,
    isDefined,
    toSignedRotation,
};
