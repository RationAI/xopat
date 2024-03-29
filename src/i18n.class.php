<?php

/*
 * i18n interface for server side - simple translation without the need
 * to run the whole dinosaur
 * Edited for xOpat needs.
 *
 * https://github.com/Philipp15b/php-i18n
 * License: MIT
 */

class i18n {

    static function default($locale, $locale_root): i18n {
        $t = new i18n($locale, $locale_root . '{LANGUAGE}.json', NULL, 'en', 'T');
        $t->init();
        return $t;
    }

    static $debug = false;


    /**
     * Language to translate to
     * @var string
     */
    protected $lang = 'en';

    /**
     * Language file path
     * This is the path for the language files. You must use the '{LANGUAGE}' placeholder for the language or the script wont find any language files.
     *
     * @var string
     */
    protected $filePath = '{LANGUAGE}.json';

    /**
     * Cache file path
     * This is the path for all the cache files. Best is an empty directory with no other files in it.
     *
     * @var string
     */
    protected $cachePath = NULL;

    /**
     * Enable region variants
     * Allow region variants such as "en-us", "en-gb" etc. If set to false, "en" will be provided.
     * Defaults to false for backward compatibility.
     *
     * @var bool
     */
    protected $isLangVariantEnabled = false;

    /**
     * Fallback language
     * This is the language which is used when there is no language file for all other user languages. It has the lowest priority.
     * Remember to create a language file for the fallback!!
     *
     * @var string
     */
    protected $fallbackLang = 'en';

    /**
     * Merge in fallback language
     * Whether to merge current language's strings with the strings of the fallback language ($fallbackLang).
     *
     * @var bool
     */
    protected $mergeFallback = false;

    /**
     * The class name of the compiled class that contains the translated texts.
     * @var string
     */
    protected $prefix = 'L';

    /**
     * Forced language
     * If you want to force a specific language define it here.
     *
     * @var string
     */
    protected $forcedLang = NULL;

    /**
     * This is the separator used if you use sections in your ini-file.
     * For example, if you have a string 'greeting' in a section 'welcomepage' you will can access it via 'L::welcomepage_greeting'.
     * If you changed it to 'ABC' you could access your string via 'L::welcomepageABCgreeting'
     *
     * @var string
     */
    protected $sectionSeparator = '.';


    /*
     * The following properties are only available after calling init().
     */

    /**
     * User languages
     * These are the languages the user uses.
     * Normally, if you use the getUserLangs-method this array will be filled in like this:
     * 1. Forced language
     * 2. Language in $_GET['lang']
     * 3. Language in $_SESSION['lang']
     * 4. HTTP_ACCEPT_LANGUAGE
     * 5. Language in $_COOKIE['lang']
     * 6. Fallback language
     *
     * @var array
     */
    protected $userLangs = array();

    protected $appliedLang = NULL;
    protected $langFilePath = NULL;
    protected $isInitialized = false;

    private $data = array();
    private $raw = "{}";
    private $namespace = "translation";


    /**
     * Constructor
     * The constructor sets all important settings. All params are optional, you can set the options via extra functions too.
     *
     * @param string [$filePath] This is the path for the language files. You must use the '{LANGUAGE}' placeholder for the language.
     * @param string [$cachePath] This is the path for all the cache files. Best is an empty directory with no other files in it. No placeholders.
     * @param string [$fallbackLang] This is the language which is used when there is no language file for all other user languages. It has the lowest priority.
     * @param string [$prefix] The class name of the compiled class that contains the translated texts. Defaults to 'L'.
     */
    public function __construct($lang, $filePath = NULL, $namespace = "translation", $fallbackLang = NULL, $prefix = NULL) {
        // Apply settings
        $this->lang = $lang;

        if ($filePath != NULL) {
            $this->filePath = $filePath;
        }

        if ($fallbackLang != NULL) {
            $this->fallbackLang = $fallbackLang;
        }

        if ($prefix != NULL) {
            $this->prefix = $prefix;
        }

        if ($namespace) {
            $this->namespace = $namespace;
        }
    }

    public function init() {
        if ($this->isInitialized() && i18n::$debug) {
            throw new BadMethodCallException('This object from class ' . __CLASS__ . ' is already initialized. It is not possible to init one object twice!');
        }

        $this->isInitialized = true;

        $this->userLangs = $this->getUserLangs();

        // search for language file
        $this->appliedLang = NULL;
        foreach ($this->userLangs as $priority => $langcode) {
            $this->langFilePath = $this->getConfigFilename($langcode);
            if (file_exists($this->langFilePath)) {
                $this->appliedLang = $langcode;
                break;
            }
        }
        if ($this->appliedLang == NULL) {
            if (i18n::$debug) throw new RuntimeException('No language file was found.');
        }

        try {
            $config = $this->load($this->langFilePath);
            
            $fallback = $this->load($this->getConfigFilename($this->fallbackLang));
            if (count($fallback) > 0) {
                $config = array_replace_recursive($fallback, $config);
                $this->raw = json_encode($config);
            }
        } catch (Exception $e) {
            if (i18n::$debug) throw $e;
        }

        $this->data = $config[$this->namespace] ?? array(); //translation resides in namespace object
    }

    public function t($key, $args=NULL) {
        $keys = explode($this->sectionSeparator, $key);
        return $this->_t($key, $keys, 0, $this->data, $args);
    }

    private function _t($key, $keys, $i, $node, $args) {
        $len = count($keys);
        if ($i >= $len || !isset($node[$keys[$i]])) return $key;
        $node = $node[$keys[$i]];
        if ($i == $len - 1 && gettype($node) === "string") {
            return $args ? $this->_sub($node, $args) : $node;
        };
        return $this->_t($key, $keys, $i+1, $node, $args);
    }

    private function _sub($str, $args) {
        foreach ($args as $key=>$value) {
            $str = str_replace("{{{$key}}}", $value ?? "undefined", $str);
        }
        return $str;
    }

    public function isInitialized() {
        return $this->isInitialized;
    }

    public function getAppliedLang() {
        return $this->appliedLang;
    }

    public function getCachePath() {
        return $this->cachePath;
    }

    public function getLangVariantEnabled() {
        return $this->isLangVariantEnabled;
    }

    public function getFallbackLang() {
        return $this->fallbackLang;
    }

    public function setFilePath($filePath) {
        $this->fail_after_init();
        $this->filePath = $filePath;
    }

    public function setCachePath($cachePath) {
        $this->fail_after_init();
        $this->cachePath = $cachePath;
    }

    public function setLangVariantEnabled($isLangVariantEnabled) {
        $this->fail_after_init();
        $this->isLangVariantEnabled = $isLangVariantEnabled;
    }

    public function setFallbackLang($fallbackLang) {
        $this->fail_after_init();
        $this->fallbackLang = $fallbackLang;
    }

    public function setMergeFallback($mergeFallback) {
        $this->fail_after_init();
        $this->mergeFallback = $mergeFallback;
    }

    public function setPrefix($prefix) {
        $this->fail_after_init();
        $this->prefix = $prefix;
    }

    public function setForcedLang($forcedLang) {
        $this->fail_after_init();
        $this->forcedLang = $forcedLang;
    }

    public function setSectionSeparator($sectionSeparator) {
        $this->fail_after_init();
        $this->sectionSeparator = $sectionSeparator;
    }

    public function getRawData() {
        return $this->raw;
    }

    /**
     * getUserLangs()
     * Re-implemented to only work with set up languages
     *
     * @return array with the user languages sorted by priority.
     */
    public function getUserLangs() {
//        $userLangs = array();
//
//        // Highest priority: forced language
//        if ($this->forcedLang != NULL) {
//            $userLangs[] = $this->forcedLang;
//        }
//
//        // 2nd highest priority: GET parameter 'lang'
//        if (isset($_GET['lang']) && is_string($_GET['lang'])) {
//            $userLangs[] = $_GET['lang'];
//        }
//
//        // 3rd highest priority: SESSION parameter 'lang'
//        if (isset($_SESSION['lang']) && is_string($_SESSION['lang'])) {
//            $userLangs[] = $_SESSION['lang'];
//        }
//
//        // 4th highest priority: HTTP_ACCEPT_LANGUAGE
//        if (isset($_SERVER['HTTP_ACCEPT_LANGUAGE'])) {
//            foreach (explode(',', $_SERVER['HTTP_ACCEPT_LANGUAGE']) as $part) {
//                $userLang = strtolower(explode(';q=', $part)[0]);
//
//                // Trim language variant section if not configured to allow
//                if (!$this->isLangVariantEnabled)
//                    $userLang = explode('-', $userLang)[0];
//
//                $userLangs[] = $userLang;
//            }
//        }
//
//        // 5th highest priority: COOKIE
//        if (isset($_COOKIE['lang'])) {
//            $userLangs[] = $_COOKIE['lang'];
//        }
//
//        // Lowest priority: fallback
//        $userLangs[] = $this->fallbackLang;
//
//        // remove duplicate elements
//        $userLangs = array_unique($userLangs);
//
//        // remove illegal userLangs
//        $userLangs2 = array();
//        foreach ($userLangs as $key => $value) {
//            // only allow a-z, A-Z and 0-9 and _ and -
//            if (preg_match('/^[a-zA-Z0-9_-]+$/', $value) === 1)
//                $userLangs2[$key] = $value;
//        }
//
//        return $userLangs2;
        return array($this->lang, $this->fallbackLang);
    }

    protected function getConfigFilename($langcode) {
        return str_replace('{LANGUAGE}', $langcode, $this->filePath);
    }

    protected function load($filename) {
        $ext = substr(strrchr($filename, '.'), 1);
        switch ($ext) {
//            case 'properties':
//            case 'ini':
//                $config = parse_ini_file($filename, true);
//                break;
//            case 'yml':
//            case 'yaml':
//                $config = spyc_load_file($filename);
//                break;
            case 'json':
                $config = file_get_contents($filename);
                $this->raw = $config;
                $config = json_decode($config, true);
                if ($config == NULL) {
                    if (i18n::$debug) throw new InvalidArgumentException("Provided file for the language translation failed to load: " . json_last_error_msg());
                    $config = array();
                }
                break;
            default:
                if (i18n::$debug) throw new InvalidArgumentException($ext . " is not a valid extension!");
                $config = array();
                break;
        }
        return $config;
    }

    protected function fail_after_init() {
        if ($this->isInitialized()) {
            if (i18n::$debug) throw new BadMethodCallException('This ' . __CLASS__ . ' object is already initalized, so you can not change any settings.');
        }
    }
}
