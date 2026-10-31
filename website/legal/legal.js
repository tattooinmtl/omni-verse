// The legal page: language switch, read-to-the-end gates on both documents,
// and the accept / refuse choice. The choice lives in the gwn_legal cookie on
// .globalwarningnetworks.com, so every Omni site sees it; gwn-consent.js reads
// the same cookie to show or hide its banner.
(function () {
  "use strict";

  var VERSION = "2026-10-31";
  var COOKIE = "gwn_legal";
  var PARENT = "globalwarningnetworks.com";
  var YEAR = 60 * 60 * 24 * 365;

  var read = { eula: false, privacy: false };
  var lang = "en";

  // --- cookie -----------------------------------------------------------------

  function onParent() {
    var h = location.hostname;
    return h === PARENT || h.slice(-(PARENT.length + 1)) === "." + PARENT;
  }

  function saveChoice(state, cookies) {
    var v = "v:" + VERSION + "|s:" + state + "|c:" + cookies + "|t:" + new Date().toISOString().slice(0, 10);
    var c = COOKIE + "=" + encodeURIComponent(v) + "; Max-Age=" + YEAR + "; Path=/; SameSite=Lax";
    if (onParent()) c += "; Domain=." + PARENT;
    if (location.protocol === "https:") c += "; Secure";
    document.cookie = c;
  }

  function loadChoice() {
    var m = document.cookie.match(new RegExp("(?:^|; )" + COOKIE + "=([^;]*)"));
    if (!m) return null;
    var out = {};
    decodeURIComponent(m[1]).split("|").forEach(function (kv) {
      var i = kv.indexOf(":");
      if (i > 0) out[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return out.v && out.s ? out : null;
  }

  // Only send people back to an Omni site (or this one, for local previews).
  function returnUrl() {
    var r = new URLSearchParams(location.search).get("return");
    if (!r) return null;
    try {
      var u = new URL(r, location.href);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      var h = u.hostname;
      var ok = u.origin === location.origin || h === PARENT || h.slice(-(PARENT.length + 1)) === "." + PARENT;
      return ok ? u.href : null;
    } catch (e) {
      return null;
    }
  }

  // --- language -----------------------------------------------------------------

  // Shared with every Omni site through gwn-lang.js.
  function saveLang(l) {
    var c = "gwn_lang=" + l + "; Max-Age=" + YEAR + "; Path=/; SameSite=Lax";
    if (onParent()) c += "; Domain=." + PARENT;
    if (location.protocol === "https:") c += "; Secure";
    document.cookie = c;
  }

  function setLang(l) {
    lang = l === "fr" ? "fr" : "en";
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-lang]").forEach(function (el) {
      el.hidden = el.getAttribute("data-lang") !== lang;
    });
    document.querySelectorAll("[data-set-lang]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set-lang") === lang));
    });
    document.title = lang === "fr" ? "Mentions légales — série Omni" : "Legal — Omni series";
    showStatus();
  }

  // --- read-to-the-end gates ------------------------------------------------------

  var DONE = { en: "✓ Read to the end", fr: "✓ Lu jusqu’à la fin" };

  function markRead(part) {
    if (read[part]) return;
    read[part] = true;
    document.querySelectorAll('[data-check="' + part + '"]').forEach(function (cb) { cb.disabled = false; });
    document.querySelectorAll('[data-agree="' + part + '"]').forEach(function (l) { l.classList.remove("locked"); });
    document.querySelectorAll('[data-hint="' + part + '"]').forEach(function (h) { h.hidden = true; });
    document.querySelectorAll('[data-progress="' + part + '"]').forEach(function (p) {
      var inFr = p.closest('[data-lang="fr"]');
      p.textContent = inFr ? DONE.fr : DONE.en;
      p.classList.add("done");
    });
  }

  function checkScrolled(doc) {
    if (doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 24) markRead(doc.getAttribute("data-doc"));
  }

  function checked(part) {
    var boxes = document.querySelectorAll('[data-check="' + part + '"]');
    for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) return true;
    return false;
  }

  function syncButtons() {
    document.getElementById("btn-accept").disabled = !(checked("eula") && checked("privacy"));
  }

  // --- status line ------------------------------------------------------------------

  var T = {
    en: {
      accepted: "You accepted version {v} on {t}. Thank you: you may use the Omni products.",
      outdated: "You accepted an older version ({v}). Please read and accept the current version, {cur}.",
      refused: "You refused version {v} on {t}. You may keep reading these websites, but you may not create an account, download, install or use any Omni product. You can accept at any time on this page.",
      back: "Taking you back…",
      saved: "Your choice is saved."
    },
    fr: {
      accepted: "Vous avez accepté la version {v} le {t}. Merci : vous pouvez utiliser les produits Omni.",
      outdated: "Vous avez accepté une version antérieure ({v}). Veuillez lire et accepter la version actuelle, {cur}.",
      refused: "Vous avez refusé la version {v} le {t}. Vous pouvez continuer à consulter ces sites, mais vous ne pouvez pas créer de compte, ni télécharger, installer ou utiliser un produit Omni. Vous pouvez accepter en tout temps sur cette page.",
      back: "Retour à la page précédente…",
      saved: "Votre choix est enregistré."
    }
  };

  function showStatus(extra) {
    var box = document.getElementById("status");
    var c = loadChoice();
    if (!c) { box.hidden = true; return; }
    var key = c.s === "refused" ? "refused" : c.v === VERSION ? "accepted" : "outdated";
    var msg = T[lang][key].replace("{v}", c.v).replace("{t}", c.t || "").replace("{cur}", VERSION);
    box.textContent = extra ? msg + " " + T[lang][extra] : msg;
    box.className = "status " + (key === "accepted" ? "ok" : "bad");
    box.hidden = false;
  }

  function cookieChoice() {
    var r = document.querySelector('input[name="cookies"]:checked');
    return r && r.value === "all" ? "all" : "essential";
  }

  // --- wire up ------------------------------------------------------------------------

  document.querySelectorAll("[data-set-lang]").forEach(function (b) {
    b.addEventListener("click", function () { setLang(b.getAttribute("data-set-lang")); saveLang(lang); });
  });

  document.querySelectorAll(".doc").forEach(function (doc) {
    doc.addEventListener("scroll", function () { checkScrolled(doc); }, { passive: true });
  });

  document.querySelectorAll("[data-check]").forEach(function (cb) {
    cb.addEventListener("change", function () {
      // Ticking a box in one language ticks its twin in the other.
      document.querySelectorAll('[data-check="' + cb.getAttribute("data-check") + '"]').forEach(function (o) { o.checked = cb.checked; });
      syncButtons();
    });
  });

  document.getElementById("btn-accept").addEventListener("click", function () {
    if (!(checked("eula") && checked("privacy"))) return;
    saveChoice("accepted", cookieChoice());
    var back = returnUrl();
    showStatus(back ? "back" : "saved");
    if (back) setTimeout(function () { location.href = back; }, 1200);
  });

  document.getElementById("btn-refuse").addEventListener("click", function () {
    saveChoice("refused", "essential");
    showStatus();
  });

  var prev = loadChoice();
  if (prev && prev.c === "all") {
    var all = document.querySelector('input[name="cookies"][value="all"]');
    if (all) all.checked = true;
  }

  var qs = new URLSearchParams(location.search).get("lang");
  var saved = (document.cookie.match(/(?:^|; )gwn_lang=(fr|en)(?:;|$)/) || [])[1];
  var nav = (navigator.language || "").toLowerCase();
  setLang(qs || saved || (nav.indexOf("fr") === 0 ? "fr" : "en"));
  saveLang(lang);
  syncButtons();

  // /privacy and /cookies land on #privacy, /terms and /eula on #eula.
  var short = { "#privacy": "privacy", "#cookies": "privacy", "#eula": "eula", "#terms": "eula" }[location.hash];
  if (short) {
    var target = document.getElementById(lang + "-" + short);
    if (target) target.scrollIntoView();
  }
})();
