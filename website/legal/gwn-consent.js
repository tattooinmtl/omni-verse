// The legal notice on every Omni website (Omni, OmniBots, OmniOne, OmniVerse).
//
// Until the visitor accepts the current version of the EULA, terms and privacy
// policy on the legal page, a bar at the bottom of the page says what the
// products are and links there. Download and installer links go to the legal
// page first. The choice is the gwn_legal cookie on .globalwarningnetworks.com,
// written by /legal/ on omniverse.globalwarningnetworks.com.
//
// Each site serves its own copy of this file (OmniOne only allows same-origin
// scripts), so keep the copies identical: the master is
// ~/.omni-verse/website/legal/gwn-consent.js.
(function () {
  "use strict";

  var VERSION = "2026-10-31";
  var LEGAL = "https://omniverse.globalwarningnetworks.com/legal/";
  var COOKIE = "gwn_legal";
  var PARENT = "globalwarningnetworks.com";

  if (/^\/legal(\/|$)/.test(location.pathname)) return;

  function onParent() {
    var h = location.hostname;
    return h === PARENT || h.slice(-(PARENT.length + 1)) === "." + PARENT;
  }

  function choice() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]*)"));
    if (!m) return null;
    var out = {};
    decodeURIComponent(m[1]).split("|").forEach(function (kv) {
      var i = kv.indexOf(":");
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return out;
  }

  var c = choice();
  if (c && c.s === "accepted" && c.v === VERSION) return;

  var refused = !!(c && c.s === "refused" && c.v === VERSION);

  // The language is the gwn_lang cookie that gwn-lang.js keeps, else the browser's.
  function isFrench() {
    if (window.GWN_LANG) return window.GWN_LANG.lang === "fr";
    var m = document.cookie.match(/(?:^|; )gwn_lang=(fr|en)(?:;|$)/);
    if (m) return m[1] === "fr";
    return (navigator.language || "").toLowerCase().indexOf("fr") === 0;
  }
  var fr, legalUrl, TEXT;
  function words() {
    fr = isFrench();
    legalUrl = LEGAL + "?return=" + encodeURIComponent(location.href) + (fr ? "&lang=fr" : "&lang=en");
    TEXT = fr ? {
    lead: "Logiciels d’IA expérimentaux pour utilisateurs avancés.",
    body: "Omni, OmniBots, OmniOne et OmniVerse font fonctionner des agents d’IA autonomes. Utilisation à vos propres risques : aucune garantie, aucune responsabilité pour la perte de données. En utilisant ces sites, en créant un compte ou en téléchargeant, vous acceptez le CLUF, les conditions d’utilisation et la politique de confidentialité et de témoins. Seuls des témoins essentiels sont utilisés.",
    refused: "Vous avez refusé les conditions : vous ne pouvez pas créer de compte, ni télécharger ou utiliser les produits Omni.",
    read: "Lire et accepter",
    refuse: "Refuser",
    later: "Plus tard"
  } : {
    lead: "Experimental AI software for advanced users.",
    body: "Omni, OmniBots, OmniOne and OmniVerse run autonomous AI agents. Use at your own risk: no warranty, no liability for data loss. By using these sites, creating an account or downloading, you agree to the EULA, Terms of Use and Privacy & Cookie Policy. Only essential cookies are used.",
    refused: "You refused the terms, so you may not create an account, download or use the Omni products.",
    read: "Read and accept",
    refuse: "Refuse",
    later: "Later"
  };
  }
  words();

  function saveRefusal() {
    var v = "v:" + VERSION + "|s:refused|c:essential|t:" + new Date().toISOString().slice(0, 10);
    var ck = COOKIE + "=" + encodeURIComponent(v) + "; Max-Age=31536000; Path=/; SameSite=Lax";
    if (onParent()) ck += "; Domain=." + PARENT;
    if (location.protocol === "https:") ck += "; Secure";
    document.cookie = ck;
  }

  var CSS =
    ":host{all:initial}" +
    ".bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;box-sizing:border-box;" +
    "padding:14px max(16px,env(safe-area-inset-right)) calc(14px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left));" +
    "background:#0b0f14;color:#e6edf3;border-top:2px solid #f59e0b;box-shadow:0 -8px 24px rgba(0,0,0,.45);" +
    "font:14px/1.5 'Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif}" +
    ".in{max-width:1100px;margin:0 auto;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center}" +
    ".txt{flex:1 1 420px;min-width:0}" +
    ".txt b{color:#fbbf24}" +
    ".btns{display:flex;flex-wrap:wrap;gap:8px}" +
    "a,button{font:inherit;font-weight:700;border-radius:8px;padding:9px 16px;cursor:pointer;text-decoration:none;border:1px solid #3a4654;background:transparent;color:#e6edf3}" +
    "a.primary{background:#fbbf24;border-color:#fbbf24;color:#1a1200}" +
    "a:focus-visible,button:focus-visible{outline:2px solid #fbbf24;outline-offset:2px}";

  function render() {
    if (document.getElementById("gwn-legal-bar")) return;
    var host = document.createElement("div");
    host.id = "gwn-legal-bar";
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    var bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", fr ? "Avis juridique" : "Legal notice");
    var inner = document.createElement("div");
    inner.className = "in";

    var txt = document.createElement("div");
    txt.className = "txt";
    var lead = document.createElement("b");
    lead.textContent = "⚠ " + (refused ? TEXT.refused : TEXT.lead) + " ";
    txt.appendChild(lead);
    if (!refused) txt.appendChild(document.createTextNode(TEXT.body));

    var btns = document.createElement("div");
    btns.className = "btns";
    var read = document.createElement("a");
    read.className = "primary";
    read.href = legalUrl;
    read.textContent = TEXT.read;
    btns.appendChild(read);
    if (!refused) {
      var no = document.createElement("button");
      no.type = "button";
      no.textContent = TEXT.refuse;
      no.addEventListener("click", function () { saveRefusal(); refused = true; host.remove(); render(); });
      btns.appendChild(no);
    }
    var later = document.createElement("button");
    later.type = "button";
    later.textContent = TEXT.later;
    // Hides the bar for this page only; it comes back on the next page.
    later.addEventListener("click", function () { host.remove(); });
    btns.appendChild(later);

    inner.appendChild(txt);
    inner.appendChild(btns);
    bar.appendChild(inner);
    root.appendChild(bar);
    document.body.appendChild(host);
  }

  // Downloads and installers go through the legal page until the terms are accepted.
  var DOWNLOAD = /\.(exe|msi|zip|7z|ps1|dmg|appimage|deb|rpm)([?#]|$)|\/releases(\/|$)|\/(setup|download|install)\.php([?#]|$)/i;
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    if (!(a.hasAttribute("download") || DOWNLOAD.test(a.href))) return;
    e.preventDefault();
    location.href = legalUrl;
  }, true);

  window.addEventListener("gwn:lang", function () {
    var bar = document.getElementById("gwn-legal-bar");
    words();
    if (bar) { bar.remove(); render(); }
  });

  if (document.body) render();
  else document.addEventListener("DOMContentLoaded", render);
})();
