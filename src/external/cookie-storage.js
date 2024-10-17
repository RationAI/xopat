(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
    "use strict";

    function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

    function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

    function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.CookieStorage = void 0;

    var format_cookie_1 = require("./format-cookie");

    var parse_cookies_1 = require("./parse-cookies");

    var CookieStorage = /*#__PURE__*/function () {
      function CookieStorage(defaultOptions) {
        _classCallCheck(this, CookieStorage);

        this._defaultOptions = Object.assign({
          domain: null,
          expires: null,
          path: null,
          secure: false
        }, defaultOptions);
        if (typeof Proxy !== "undefined") return new Proxy(this, cookieStorageHandler);
      }

      _createClass(CookieStorage, [{
        key: "length",
        get: function get() {
          var parsed = parse_cookies_1.parseCookies(this._getCookie());
          var keys = Object.keys(parsed);
          return keys.length;
        }
      }, {
        key: "clear",
        value: function clear() {
          var _this = this;

          var parsed = parse_cookies_1.parseCookies(this._getCookie());
          var keys = Object.keys(parsed);
          keys.forEach(function (key) {
            return _this.removeItem(key);
          });
        }
      }, {
        key: "getItem",
        value: function getItem(key) {
          var parsed = parse_cookies_1.parseCookies(this._getCookie());
          return Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : null;
        }
      }, {
        key: "key",
        value: function key(index) {
          var parsed = parse_cookies_1.parseCookies(this._getCookie());
          var sortedKeys = Object.keys(parsed).sort();
          return index < sortedKeys.length ? sortedKeys[index] : null;
        }
      }, {
        key: "removeItem",
        value: function removeItem(key, cookieOptions) {
          var data = "";
          var options = Object.assign(Object.assign(Object.assign({}, this._defaultOptions), cookieOptions), {
            expires: new Date(0)
          });
          var formatted = format_cookie_1.formatCookie(key, data, options);

          this._setCookie(formatted);
        }
      }, {
        key: "setItem",
        value: function setItem(key, data, options) {
          var opts = Object.assign(Object.assign({}, this._defaultOptions), options);
          var formatted = format_cookie_1.formatCookie(key, data, opts);

          this._setCookie(formatted);
        }
      }, {
        key: "_getCookie",
        value: function _getCookie() {
          return typeof document === "undefined" ? "" : typeof document.cookie === "undefined" ? "" : document.cookie;
        }
      }, {
        key: "_setCookie",
        value: function _setCookie(value) {
          document.cookie = value;
        }
      }]);

      return CookieStorage;
    }();

    exports.CookieStorage = CookieStorage;
    var cookieStorageHandler = {
      defineProperty: function defineProperty(target, p, attributes) {
        target.setItem(p.toString(), String(attributes.value));
        return true;
      },
      deleteProperty: function deleteProperty(target, p) {
        target.removeItem(p.toString());
        return true;
      },
      get: function get(target, p, _receiver) {
        if (typeof p === "string" && p in target) return target[p];
        var result = target.getItem(p.toString());
        return result !== null ? result : undefined;
      },
      getOwnPropertyDescriptor: function getOwnPropertyDescriptor(target, p) {
        if (p in target) return undefined;
        return {
          configurable: true,
          enumerable: true,
          value: target.getItem(p.toString()),
          writable: true
        };
      },
      has: function has(target, p) {
        if (typeof p === "string" && p in target) return true;
        return target.getItem(p.toString()) !== null;
      },
      ownKeys: function ownKeys(target) {
        var keys = [];

        for (var i = 0; i < target.length; i++) {
          var key = target.key(i);
          if (key !== null) keys.push(key);
        }

        return keys;
      },
      preventExtensions: function preventExtensions(_) {
        throw new TypeError("can't prevent extensions on this proxy object");
      },
      set: function set(target, p, value, _) {
        target.setItem(p.toString(), String(value));
        return true;
      }
    };
  },{"./format-cookie":2,"./parse-cookies":4}],2:[function(require,module,exports){
    "use strict";

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.formatCookie = void 0;

    var getSameSiteValue = function getSameSiteValue(o) {
      var sameSite = o.sameSite;
      if (typeof sameSite === "undefined") return null;
      if (["none", "lax", "strict"].indexOf(sameSite.toLowerCase()) >= 0) return sameSite;
      return null;
    };

    var formatOptions = function formatOptions(o) {
      var path = o.path,
          domain = o.domain,
          expires = o.expires,
          secure = o.secure;
      var sameSiteValue = getSameSiteValue(o);
      return [typeof path === "undefined" || path === null ? "" : ";path=" + path, typeof domain === "undefined" || domain === null ? "" : ";domain=" + domain, typeof expires === "undefined" || expires === null ? "" : ";expires=" + expires.toUTCString(), typeof secure === "undefined" || secure === false ? "" : ";secure", sameSiteValue === null ? "" : ";SameSite=" + sameSiteValue].join("");
    };

    var formatCookie = function formatCookie(k, d, o) {
      return [encodeURIComponent(k), "=", encodeURIComponent(d), formatOptions(o)].join("");
    };

    exports.formatCookie = formatCookie;
  },{}],3:[function(require,module,exports){
    "use strict";

    Object.defineProperty(exports, "__esModule", {
      value: true
    });

    window.CookieStorage = require("./cookie-storage").CookieStorage;


  },{"./cookie-storage":1}],4:[function(require,module,exports){
    "use strict";

    function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _unsupportedIterableToArray(arr, i) || _nonIterableRest(); }

    function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method."); }

    function _unsupportedIterableToArray(o, minLen) { if (!o) return; if (typeof o === "string") return _arrayLikeToArray(o, minLen); var n = Object.prototype.toString.call(o).slice(8, -1); if (n === "Object" && o.constructor) n = o.constructor.name; if (n === "Map" || n === "Set") return Array.from(o); if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen); }

    function _arrayLikeToArray(arr, len) { if (len == null || len > arr.length) len = arr.length; for (var i = 0, arr2 = new Array(len); i < len; i++) { arr2[i] = arr[i]; } return arr2; }

    function _iterableToArrayLimit(arr, i) { var _i = arr && (typeof Symbol !== "undefined" && arr[Symbol.iterator] || arr["@@iterator"]); if (_i == null) return; var _arr = []; var _n = true; var _d = false; var _s, _e; try { for (_i = _i.call(arr); !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

    function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }

    Object.defineProperty(exports, "__esModule", {
      value: true
    });
    exports.parseCookies = void 0;

    var parseCookies = function parseCookies(s) {
      if (s.length === 0) return {};
      var parsed = {};
      var pattern = new RegExp("\\s*;\\s*");
      s.split(pattern).forEach(function (i) {
        var _i$split = i.split("="),
            _i$split2 = _slicedToArray(_i$split, 2),
            encodedKey = _i$split2[0],
            encodedValue = _i$split2[1];

        var key = decodeURIComponent(encodedKey);
        var value = decodeURIComponent(encodedValue);
        parsed[key] = value;
      });
      return parsed;
    };

    exports.parseCookies = parseCookies;
  },{}]},{},[3]);
