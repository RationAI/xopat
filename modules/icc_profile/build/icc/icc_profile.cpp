#include <vector>
#include <string>
#include <emscripten.h>
#include <lcms2.h>

static cmsHPROFILE g_profile = nullptr;
static cmsHTRANSFORM g_transform = nullptr;

// Store profile from JS
extern "C" EMSCRIPTEN_KEEPALIVE
void set_icc_profile(uint8_t* profile_data, int length) {
    if (g_profile) {
        cmsCloseProfile(g_profile);
        g_profile = nullptr;
    }
    if (g_transform) {
        cmsDeleteTransform(g_transform);
        g_transform = nullptr;
    }

    g_profile = cmsOpenProfileFromMem(profile_data, length);
    if (!g_profile) {
        printf("Failed to load ICC profile\n");
        return;
    }

    // Assuming sRGB input, RGB8 format
    cmsHPROFILE srgb = cmsCreate_sRGBProfile();
    g_transform = cmsCreateTransform(
        srgb, TYPE_RGB_8,
        g_profile, TYPE_RGB_8,
        INTENT_PERCEPTUAL, 0
    );
    cmsCloseProfile(srgb);

    if (!g_transform) {
        printf("Failed to create transform\n");
    }
}

// Process image using cached profile
extern "C" EMSCRIPTEN_KEEPALIVE
void process_image(uint8_t* img_data, int pixel_count) {
    if (!g_transform) {
        printf("No ICC profile set\n");
        return;
    }
    cmsDoTransform(g_transform, img_data, img_data, pixel_count);
}
