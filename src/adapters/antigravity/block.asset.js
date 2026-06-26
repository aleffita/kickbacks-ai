/* VIBE-ADS-START */
(function () {
  "use strict";

  var TIER = __VIBE_ADS_TIER__;
  var AD = __VIBE_ADS_AD__;
  var ICON_REF = __VIBE_ADS_ICON__;
  var ICON_URL = __VIBE_ADS_ICON_URL__;
  var PORT = __VIBE_ADS_PORT__;
  var LBTOKEN = __VIBE_ADS_LBTOKEN__;
  var CLICKTOKEN = __VIBE_ADS_CLICKTOKEN__;
  var CLICKURL = __VIBE_ADS_CLICKURL__;
  var CORR = __VIBE_ADS_CORR__;
  var AD_ID = CORR.substring(0, CORR.lastIndexOf("."));
  var BASE = __VIBE_ADS_BASE__ || ("http://127.0.0.1:" + PORT + "/vibe-ads/" + LBTOKEN);
  var DEBUG = __VIBE_ADS_DEBUG__;

  function DB() { try { console.log("[Kickbacks]", Array.prototype.join.call(arguments, " ")); } catch (e) {} }
  DB("block.loading");

  // ── Helpers ──────────────────────────────────────────────────────────
  function newEventUuid() {
    try { if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID(); } catch (e) {}
    return "evt-" + Date.now() + "-" + Math.random();
  }
  function ping(kind) {
    try {
      var url = BASE + "/" + kind;
      if (navigator && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(url, new Blob([], { type: "application/x-www-form-urlencoded" }))) return;
      }
      fetch(url, { method: "POST", keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ── DOM Detection ───────────────────────────────────────────────────
  // The Cascade panel renders each thinking step as:
  //   <div class="flex flex-col gap-0.5">     ← step container
  //     <div class="relative">                  ← header
  //       <button><span class="text-secondary-foreground">Thinking for Xs</span></button>
  //     </div>
  //     <div class="px-2 py-1">...response...</div>  ← response
  //   </div>

  function isActiveStep(text) {
    if (!text) return false;
    var t = text.toLowerCase();
    return t.indexOf("thinking") !== -1 || t.indexOf("working") !== -1;
  }

  /** Find the active thinking step container.
   *  Returns the flex container element, or null if agent is idle. */
  function findActiveStep() {
    // Cached counts for debug
    var allSpans = document.querySelectorAll('span');
    DB("total spans:", allSpans.length);

    // Strategy 1: class-based — look for span with class text-secondary-foreground
    var spans = document.querySelectorAll('span.text-secondary-foreground');
    DB("spans with text-secondary-foreground class:", spans.length);
    for (var i = 0; i < spans.length; i++) {
      var text = spans[i].textContent || "";
      DB("  span[" + i + "]:", text.trim().slice(0, 50));
      if (isActiveStep(text)) {
        // Walk up to the flex container
        var step = spans[i].closest('div.flex');
        if (step) {
          DB("found via class, container classes:", step.className);
          return step;
        }
        // Fallback: walk up looking for a flex div
        var el = spans[i].parentElement;
        for (var j = 0; j < 10 && el; j++) {
          if (el.tagName === "DIV" && (el.className || "").indexOf("flex") !== -1) {
            DB("found via class+fallback, container:", el.className.slice(0, 60));
            return el;
          }
          el = el.parentElement;
        }
      }
    }

    // Strategy 2: text-based — scan ALL elements for "Thinking"/"Working" text
    DB("trying text-based scan...");
    var all = document.querySelectorAll('span, div, button');
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].textContent || "").toLowerCase().trim();
      if (t.indexOf("thinking") !== -1 || t.indexOf("working") !== -1) {
        DB("text match:", all[i].tagName, (all[i].className || "").slice(0, 40),
            "text:", t.slice(0, 40));
        var container = all[i].closest('div.flex');
        if (container) {
          DB("found via text, container:", container.className.slice(0, 60));
          return container;
        }
      }
    }

    DB("no active step found");
    return null;
  }

  // ── Ad Element ───────────────────────────────────────────────────────
  var _adEl = null;
  var _active = false;
  var _sentRender = false;

  function buildAdHtml() {
    var href = CLICKURL ? esc(CLICKURL) : "#";
    var fg = "var(--vscode-foreground,currentColor)";
    var border = "var(--vscode-widget-border,#333)";
    var bg = "var(--vscode-editor-background,#1e1e1e)";
    return '<div data-vb-ad="1" style="display:flex;align-items:center;justify-content:space-between;' +
      'padding:6px 12px;margin:2px 8px;border-radius:6px;border:1px solid ' + border + ';' +
      'background:' + bg + ';font-size:12px;gap:8px">' +
      '<span style="color:' + fg + ';opacity:0.7;white-space:nowrap">ad·</span>' +
      '<a href="' + href + '" target="_blank" rel="noopener noreferrer" style="color:' + fg + ';' +
      'text-decoration:underline;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;flex:1">' +
      esc(AD) + '</a>' +
      '<span style="color:' + fg + ';opacity:0.4;font-size:10px;white-space:nowrap;cursor:pointer" ' +
      'onclick="this.parentElement.remove()">✕</span></div>';
  }

  function insertAd(step) {
    if (_adEl && _adEl.parentNode === step) return; // already inserted
    removeAd();
    var temp = document.createElement("div");
    temp.innerHTML = buildAdHtml();
    _adEl = temp.firstElementChild;
    // Insert between the header (first child) and response (second child)
    var header = step.children[0];
    if (header && header.nextSibling) {
      step.insertBefore(_adEl, header.nextSibling);
    } else {
      step.appendChild(_adEl);
    }
    DB("ad inserted");
    if (!_sentRender) {
      ping("impression_rendered?surface=overlay&ad=" + encodeURIComponent(AD)
        + "&event_uuid=" + encodeURIComponent(newEventUuid()));
      _sentRender = true;
      DB("impression sent");
    }
    _active = true;
  }

  function removeAd() {
    if (_adEl && _adEl.parentNode) {
      _adEl.parentNode.removeChild(_adEl);
      DB("ad removed");
    }
    _adEl = null;
    _active = false;
  }

  // ── Evaluation ──────────────────────────────────────────────────────
  function evaluate() {
    try {
      var step = findActiveStep();
      if (step) {
        insertAd(step);
      } else if (_active) {
        removeAd();
      }
    } catch (e) { DB("error:", e.message); }
  }

  // ── Poll Ad Rotation ────────────────────────────────────────────────
  function pollAd() {
    try {
      fetch(BASE + "/ad").then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.adText) return;
          if (j.adText !== AD || j.clickUrl !== CLICKURL) {
            DB("ad rotated:", j.adText);
            AD = j.adText;
            CLICKURL = j.clickUrl || "";
            _sentRender = false;
            if (_adEl) { removeAd(); }
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // ── Visual Proof of Life ──────────────────────────────────────────────
  // Add a small indicator at the top of the page so we can tell the block
  // is running, even if findActiveStep() isn't working yet.
  (function showPulse() {
    try {
      var pulse = document.createElement("div");
      pulse.id = "kb-pulse";
      pulse.style.cssText = "position:fixed;top:2px;right:2px;z-index:2147483647;" +
        "width:8px;height:8px;border-radius:50%;background:#4ade80;" +
        "box-shadow:0 0 4px #4ade80;transition:opacity 1s";
      pulse.title = "Kickbacks loaded: " + AD;
      (document.body || document.documentElement).appendChild(pulse);
      DB("pulse indicator added");
    } catch (e) { DB("pulse error:", e.message); }
  })();

  // ── Start ────────────────────────────────────────────────────────────
  DB("block.start");

  // Observe the entire document for new step containers
  var observer = new MutationObserver(function () { evaluate(); });
  var target = document.body || document.documentElement;
  if (target) {
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    DB("observer attached");
  }

  setInterval(evaluate, 250);
  setInterval(pollAd, 10000);
  setTimeout(pollAd, 5000);
  setTimeout(evaluate, 100);
  setTimeout(evaluate, 1000);
  setTimeout(evaluate, 3000);

  // Keep ad glued even during re-renders
  function frame() {
    if (!_active) { requestAnimationFrame(frame); return; }
    try {
      var step = findActiveStep();
      if (step && (!_adEl || _adEl.parentNode !== step)) {
        insertAd(step);
      }
    } catch (e) { DB("frame error:", e.message); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  DB("block.ready");
})();
/* VIBE-ADS-END */
