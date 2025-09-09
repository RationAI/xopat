#include <stdint.h>
#include <emscripten.h>
#include <lcms2.h>

static cmsHPROFILE   g_in  = NULL;
static cmsHTRANSFORM g_xform = NULL;

EMSCRIPTEN_KEEPALIVE
int set_icc_profile(uint8_t* data, int len) {
  if (g_xform) { cmsDeleteTransform(g_xform); g_xform = NULL; }
  if (g_in)     { cmsCloseProfile(g_in);       g_in = NULL;   }

  g_in = cmsOpenProfileFromMem(data, len);
  if (!g_in) return 0;

  // Ensure input is RGB; otherwise bail (you can extend to Gray/CMYK later)
  if (cmsGetColorSpace(g_in) != cmsSigRgbData) {
    cmsCloseProfile(g_in); g_in = NULL;
    return 0;
  }

  cmsHPROFILE srgb = cmsCreate_sRGBProfile();

  // *** Correct direction: input → sRGB ***
  g_xform = cmsCreateTransform(
      g_in,  TYPE_RGB_8,
      srgb,  TYPE_RGB_8,
      INTENT_RELATIVE_COLORIMETRIC,  // or INTENT_PERCEPTUAL if you prefer
      cmsFLAGS_BLACKPOINTCOMPENSATION
  );

  cmsCloseProfile(srgb);
  return g_xform != NULL;
}

EMSCRIPTEN_KEEPALIVE
void process_image(uint8_t* img, int pixel_count) {
  if (!g_xform) return;
  cmsDoTransform(g_xform, img, img, pixel_count); // in-place
}