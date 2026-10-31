// French / English for every Omni website (Omni, OmniBots, OmniOne, OmniVerse).
//
// The language is the gwn_lang cookie on .globalwarningnetworks.com, so a
// choice made on one site holds on all four. With no cookie yet, the browser's
// preferred language decides (French if it starts with "fr", else English),
// and that choice is saved.
//
// Pages keep their English in the HTML. A site's French dictionary
// (window.GWN_I18N_FR, loaded before this file) replaces it:
//   data-i18n="key"        textContent
//   data-i18n-html="key"   innerHTML (the dictionaries are ours, never user text)
//   data-i18n-attr="aria-label:key; title:key2"
//   keys "_title" and "_description" for the page title and meta description.
// Server-rendered pages (<html data-gwn-server>) already come in the right
// language from PHP, so switching there saves the cookie and reloads.
// Long static pages can instead have a whole translated twin (page mode,
// see twin() below): the switch then moves between the two files.
//
// Scripts read GWN_LANG.lang / GWN_LANG.t(key, english) and listen for the
// "gwn:lang" event to redraw text they set themselves.
//
// Each site serves its own copy (OmniOne only allows same-origin scripts);
// the master is ~/.omni-verse/website/legal/gwn-lang.js.
(function () {
  "use strict";

  var COOKIE = "gwn_lang";
  var PARENT = "globalwarningnetworks.com";
  var html = document.documentElement;
  var server = html.hasAttribute("data-gwn-server");
  var originals = new WeakMap();

  function onParent() {
    var h = location.hostname;
    return h === PARENT || h.slice(-(PARENT.length + 1)) === "." + PARENT;
  }

  function readCookie() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=(fr|en)(?:;|$)"));
    return m ? m[1] : null;
  }

  function saveCookie(l) {
    var c = COOKIE + "=" + l + "; Max-Age=31536000; Path=/; SameSite=Lax";
    if (onParent()) c += "; Domain=." + PARENT;
    if (location.protocol === "https:") c += "; Secure";
    document.cookie = c;
  }

  function browserLang() {
    var list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "en"];
    return String(list[0]).toLowerCase().indexOf("fr") === 0 ? "fr" : "en";
  }

  var lang = readCookie();
  if (!lang) { lang = browserLang(); saveCookie(lang); }

  // Page mode: a page with a translated twin lists it as
  // <link rel="alternate" hreflang="fr" href="index-fr.html"> (and the twin
  // links back with hreflang="en"). Load this file in <head> on such pages, so
  // the wrong-language page is left before it is drawn.
  var pageLang = html.getAttribute("lang") === "fr" ? "fr" : "en";
  function twin(l) {
    var link = document.querySelector('link[rel="alternate"][hreflang="' + l + '"]');
    return link ? link.href : null;
  }
  if (lang !== pageLang && twin(lang)) {
    location.replace(twin(lang) + location.hash);
    return;
  }

  var dict = function () { return window.GWN_I18N_FR || {}; };

  function t(key, en) {
    if (lang !== "fr") return en;
    var v = dict()[key];
    return v == null ? en : v;
  }

  function keep(el, slot, value) {
    var o = originals.get(el);
    if (!o) { o = {}; originals.set(el, o); }
    if (!(slot in o)) o[slot] = value;
    return o[slot];
  }

  function apply() {
    html.lang = lang;
    var d = dict();
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var en = keep(el, "text", el.textContent);
      var k = el.getAttribute("data-i18n");
      el.textContent = lang === "fr" && d[k] != null ? d[k] : en;
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var en = keep(el, "html", el.innerHTML);
      var k = el.getAttribute("data-i18n-html");
      el.innerHTML = lang === "fr" && d[k] != null ? d[k] : en;
    });
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      el.getAttribute("data-i18n-attr").split(";").forEach(function (pair) {
        var p = pair.split(":");
        if (p.length !== 2) return;
        var attr = p[0].trim(), k = p[1].trim();
        var en = keep(el, "attr:" + attr, el.getAttribute(attr) || "");
        el.setAttribute(attr, lang === "fr" && d[k] != null ? d[k] : en);
      });
    });
    if (d._title) {
      var enTitle = keep(html, "title", document.title);
      document.title = lang === "fr" ? d._title : enTitle;
    }
    var meta = document.querySelector('meta[name="description"]');
    if (meta && d._description) {
      var enDesc = keep(meta, "content", meta.getAttribute("content"));
      meta.setAttribute("content", lang === "fr" ? d._description : enDesc);
    }
    document.querySelectorAll(".gwn-lang-switch button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === lang));
    });
  }

  function set(l) {
    l = l === "fr" ? "fr" : "en";
    saveCookie(l);
    if (l === lang) return;
    lang = l;
    if (twin(l)) { location.href = twin(l) + location.hash; return; }
    if (server) { location.reload(); return; }
    apply();
    window.dispatchEvent(new CustomEvent("gwn:lang", { detail: { lang: lang } }));
  }

  // The switch goes where the page puts <span data-gwn-lang-switch></span>;
  // pages without one get a small pill in the top corner.
  var SWITCH_CSS =
    ".gwn-lang-switch{display:inline-flex;border:1px solid currentColor;border-radius:999px;overflow:hidden;vertical-align:middle;font:600 12px/1 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;opacity:.9}" +
    ".gwn-lang-switch button{all:unset;cursor:pointer;padding:5px 9px;letter-spacing:.06em;opacity:.55}" +
    ".gwn-lang-switch button[aria-pressed=true]{opacity:1;font-weight:800;background:rgba(127,127,127,.3)}" +
    ".gwn-lang-switch button:focus-visible{outline:2px solid currentColor;outline-offset:-3px}" +
    ".gwn-lang-float{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:10px;z-index:2147482000;background:rgba(0,0,0,.6);color:#fff;border-radius:999px}";

  function buildSwitch() {
    var box = document.createElement("span");
    box.className = "gwn-lang-switch";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Langue / Language");
    [["fr", "FR", "Français"], ["en", "EN", "English"]].forEach(function (o) {
      var b = document.createElement("button");
      b.type = "button";
      b.setAttribute("data-lang", o[0]);
      b.setAttribute("lang", o[0]);
      b.title = o[2];
      var s = document.createElement("span");
      s.textContent = o[1];
      b.appendChild(s);
      b.addEventListener("click", function () { set(o[0]); });
      box.appendChild(b);
    });
    return box;
  }

  function mountSwitch() {
    var style = document.createElement("style");
    style.textContent = SWITCH_CSS;
    document.head.appendChild(style);
    var spots = document.querySelectorAll("[data-gwn-lang-switch]");
    if (spots.length) {
      spots.forEach(function (s) { s.appendChild(buildSwitch()); });
    } else {
      var f = buildSwitch();
      f.classList.add("gwn-lang-float");
      document.body.appendChild(f);
    }
  }

  window.GWN_LANG = { get lang() { return lang; }, t: t, set: set };

  function start() { mountSwitch(); apply(); }
  html.lang = lang;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
