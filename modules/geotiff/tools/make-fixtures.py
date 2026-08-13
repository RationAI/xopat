#!/usr/bin/env python3
"""
TODO: consider replacing script with data commited

Generate the TIFF fixtures the geotiff module is verified against.

Public high-bit-depth WSI-like TIFFs are scarce, and the ones that exist rarely
carry the combination that matters here (tiled + pyramidal + a declared sample
format). Generating them locally is faster than hunting, and makes the test
matrix reproducible.

    pip install numpy tifffile imagecodecs
    python test/geotiff/make-fixtures.py [outdir]

Each file is tiled and carries several full-IFD pyramid levels — SubIFD
pyramids are deliberately avoided because the bundled geotiff.js cannot read
them (see modules/geotiff/README.md "Limits").
"""

import sys
import pathlib

import numpy as np
import tifffile

# SMinSampleValue / SMaxSampleValue, written as doubles.
TAG_S_MIN = 340
TAG_S_MAX = 341

SIZE = 4096
LEVELS = 4


def write_pyramid(path, data, levels=LEVELS, **kwargs):
    """Write `data` plus `levels` halved copies as plain IFDs."""
    options = dict(tile=(256, 256), compression="deflate", **kwargs)
    with tifffile.TiffWriter(path, bigtiff=True) as tif:
        current = data
        tif.write(current, **options)
        for _ in range(levels):
            current = current[::2, ::2] if current.ndim == 2 else current[::2, ::2, :]
            tif.write(current, **options)
    print(f"  {path.name}: {data.shape} {data.dtype}")


def main(outdir):
    outdir.mkdir(parents=True, exist_ok=True)
    yy, xx = np.mgrid[0:SIZE, 0:SIZE]
    ramp = xx / SIZE

    print(f"writing fixtures to {outdir}")

    # Baseline: must render exactly as it does today, on `identity`.
    write_pyramid(
        outdir / "rgb8.tif",
        np.stack([ramp * 255, (yy / SIZE) * 255, np.full((SIZE, SIZE), 120)], -1).astype("uint8"),
        photometric="rgb",
    )

    # 16-bit RGB: the "renders white" case.
    write_pyramid(
        outdir / "rgb16.tif",
        np.stack([ramp * 65535, (yy / SIZE) * 65535, np.full((SIZE, SIZE), 30000)], -1).astype("uint16"),
        photometric="rgb",
    )

    # 16-bit grayscale: the packer normalizes this one, so it is the case that
    # also has to look right after an RGBA8 fallback.
    write_pyramid(outdir / "gray16.tif", (ramp * 65535).astype("uint16"), photometric="minisblack")

    # Same, non-square: a square slide hides bounds bugs, because the aspect
    # ratio the viewer derives is 1 either way.
    write_pyramid(
        outdir / "gray16-wide.tif",
        (ramp[: SIZE // 2, :] * 65535).astype("uint16"),
        photometric="minisblack",
    )

    # 12-bit range stored in uint16: raw counts reach the shader, so the emitted
    # GLSL must divide by 4095.
    write_pyramid(outdir / "gray12.tif", (ramp * 4095).astype("uint16"), photometric="minisblack")

    # float32 with a declared range: the "renders black" case.
    values = (np.sin(xx / 200.0) * 500.0 - 100.0).astype("float32")
    write_pyramid(
        outdir / "float32.tif",
        values,
        photometric="minisblack",
        extratags=[
            (TAG_S_MIN, 12, 1, (float(values.min()),), True),
            (TAG_S_MAX, 12, 1, (float(values.max()),), True),
        ],
    )

    # float32 without the range tags: exercises the unknown-range fallback.
    write_pyramid(outdir / "float32-norange.tif", values, photometric="minisblack")

    # Palette: a lookup table is a display transform, not data — must stay on the
    # 8-bit path.
    colormap = np.zeros((3, 256), "uint16")
    colormap[0] = np.arange(256) * 257
    colormap[2] = (255 - np.arange(256)) * 257
    write_pyramid(
        outdir / "palette8.tif",
        (xx % 256).astype("uint8"),
        photometric="palette",
        colormap=colormap,
    )

    # Six 16-bit channels: the multi-channel fan-out.
    channels = np.stack(
        [((np.sin((xx + yy * (i + 1)) / (150.0 + 40 * i)) + 1) * 0.5 * 65535) for i in range(6)],
        -1,
    ).astype("uint16")
    write_pyramid(outdir / "multi16.tif", channels, photometric="minisblack", planarconfig="contig")

    print("done")


if __name__ == "__main__":
    main(pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "test/geotiff/fixtures"))
