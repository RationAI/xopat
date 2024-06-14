<?php
if (!defined( 'ABSPATH' )) {
    exit;
}
/*
 * i18mock interface fallback
 */
class i18n_mock {

    static function default($locale, $locale_root): i18n_mock {
        return new i18n_mock($locale);
    }

    static $debug = false;

    public function __construct($lang, $filePath = NULL, $namespace = NULL, $fallbackLang = NULL, $prefix = NULL) {
        //noop
    }

    public function init() {
        //noop
    }

    public function t($key, $args=NULL) {
        return $key;
    }

    public function isInitialized() {
        return true;
    }

    public function getAppliedLang() {
        return "";
    }

    public function getCachePath() {
        return NULL;
    }

    public function getLangVariantEnabled() {
        return false;
    }

    public function getFallbackLang() {
        return "";
    }

    public function setFilePath($filePath) {
        //noop
    }

    public function setCachePath($cachePath) {
        //noop
    }

    public function setLangVariantEnabled($isLangVariantEnabled) {
        //noop
    }

    public function setFallbackLang($fallbackLang) {
        //noop
    }

    public function setMergeFallback($mergeFallback) {
        //noop
    }

    public function setPrefix($prefix) {
        //noop
    }

    public function setForcedLang($forcedLang) {
        //noop
    }

    public function setSectionSeparator($sectionSeparator) {
        //noop
    }

    public function getRawData() {
        return "{}";
    }

    public function getUserLangs() {
        return array();
    }
}
