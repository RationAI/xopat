#include <stdint.h>
#include <stdlib.h>
#include <emscripten.h>
#include <lcms2.h>

/*
 * ICC -> sRGB colour correction for xOpat tiles.
 *
 * Transforms are held per profile behind an integer handle rather than in a
 * single global slot. Several slides can be open at once, and their tiles
 * arrive interleaved — a single slot means tearing the transform down and
 * rebuilding it for every tile, which is far more expensive than the transform
 * itself.
 *
 * Two transforms are built per handle. Tile data reaches us either as 8-bit
 * RGBA (the ordinary raster path) or as 16-bit RGBA packs from the
 * high-precision tile sources; converting the latter down to 8 bits to correct
 * it would defeat the point of those sources.
 *
 * Alpha is an extra channel to lcms: `cmsFLAGS_COPY_ALPHA` passes it through
 * untouched instead of dropping it, which is what lets the caller hand us the
 * canvas/pack buffer directly with no repacking.
 */

#define MAX_PROFILES 16

typedef struct {
    cmsHPROFILE   profile;
    cmsHTRANSFORM xform8;
    cmsHTRANSFORM xform16;
} icc_slot;

static icc_slot g_slots[MAX_PROFILES];

static void release_slot(icc_slot* s) {
    if (s->xform8)  { cmsDeleteTransform(s->xform8);  s->xform8  = NULL; }
    if (s->xform16) { cmsDeleteTransform(s->xform16); s->xform16 = NULL; }
    if (s->profile) { cmsCloseProfile(s->profile);    s->profile = NULL; }
}

/**
 * Build the transforms for one profile.
 * @returns handle >= 1, or 0 if the profile is unusable or the table is full.
 */
EMSCRIPTEN_KEEPALIVE
int set_icc_profile(uint8_t* data, int len) {
    int index = -1;
    for (int i = 0; i < MAX_PROFILES; i++) {
        if (!g_slots[i].profile) { index = i; break; }
    }
    if (index < 0) return 0;

    icc_slot* s = &g_slots[index];

    s->profile = cmsOpenProfileFromMem(data, len);
    if (!s->profile) return 0;

    // Only RGB input profiles are handled; Gray/CMYK slides would need their own
    // pixel layout on the caller side, so refuse rather than mis-transform.
    if (cmsGetColorSpace(s->profile) != cmsSigRgbData) {
        release_slot(s);
        return 0;
    }

    cmsHPROFILE srgb = cmsCreate_sRGBProfile();

    // Direction is input -> sRGB. Relative colorimetric with black point
    // compensation is the right default for pathology: it preserves measured
    // colour relationships rather than re-rendering them for aesthetics.
    s->xform8 = cmsCreateTransform(
        s->profile, TYPE_RGBA_8,
        srgb,       TYPE_RGBA_8,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_COPY_ALPHA
    );
    s->xform16 = cmsCreateTransform(
        s->profile, TYPE_RGBA_16,
        srgb,       TYPE_RGBA_16,
        INTENT_RELATIVE_COLORIMETRIC,
        cmsFLAGS_BLACKPOINTCOMPENSATION | cmsFLAGS_COPY_ALPHA
    );

    cmsCloseProfile(srgb);

    if (!s->xform8 || !s->xform16) {
        release_slot(s);
        return 0;
    }
    return index + 1;   // 0 is reserved for "failed"
}

static icc_slot* slot_of(int handle) {
    if (handle < 1 || handle > MAX_PROFILES) return NULL;
    icc_slot* s = &g_slots[handle - 1];
    return s->profile ? s : NULL;
}

/** In-place RGBA8 correction of `pixel_count` pixels. */
EMSCRIPTEN_KEEPALIVE
void process_rgba8(int handle, uint8_t* img, int pixel_count) {
    icc_slot* s = slot_of(handle);
    if (!s || !s->xform8) return;
    cmsDoTransform(s->xform8, img, img, pixel_count);
}

/** In-place RGBA16 correction of `pixel_count` pixels. */
EMSCRIPTEN_KEEPALIVE
void process_rgba16(int handle, uint16_t* img, int pixel_count) {
    icc_slot* s = slot_of(handle);
    if (!s || !s->xform16) return;
    cmsDoTransform(s->xform16, img, img, pixel_count);
}

EMSCRIPTEN_KEEPALIVE
void release_icc_profile(int handle) {
    icc_slot* s = slot_of(handle);
    if (s) release_slot(s);
}
