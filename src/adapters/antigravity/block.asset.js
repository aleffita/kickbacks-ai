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
  var VIEW_THRESHOLD_MS = __VIBE_ADS_VIEW_THRESHOLD_MS__;

  var _seq = 0;
  function dlog(evt, data) {
    if (!DEBUG) return;
    try {
      var o = { n: ++_seq, evt: evt, corr: CORR };
      if (data) for (var k in data) o[k] = data[k];
      fetch(BASE + "/log", { method: "POST", keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(o) }).catch(function () {});
    } catch (e) {}
  }

  function ping(kind) {
    try {
      var url = BASE + "/" + kind;
      if (navigator && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(url, new Blob([],
          { type: "application/x-www-form-urlencoded" }))) return;
      }
      fetch(url, { method: "POST", keepalive: true }).catch(function () {});
    } catch (e) {}
  }

  function newEventUuid() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
        return crypto.randomUUID();
    } catch (e) {}
    return "evt-" + Date.now() + "-" + Math.random();
  }

  // ── JetskiAgent / Cascade Panel ──────────────────────────────────────
  // The Cascade panel renders inside #react-app. When the agent is
  // running/thinking it shows status text like "Thinking", "Working",
  // "Processing", "Running", etc. We observe the DOM for these text
  // patterns and position our overlay over the thinking indicator.

  var STATUS_KEYWORDS = ["thinking", "working", "processing", "running",
    "generating", "waiting", "analyzing", "executing task"];

  function isAgentActive(text) {
    if (!text) return false;
    var t = text.toLowerCase().trim();
    if (t === "") return false;
    for (var i = 0; i < STATUS_KEYWORDS.length; i++) {
      if (t.indexOf(STATUS_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }

  // Find the most specific element that indicates agent thinking.
  // We look for leaf-ish elements (few children) whose text content
  // matches a status keyword AND whose visible parent can be used
  // for positioning.
  function findThinkingIndicator() {
    var container = document.getElementById("react-app");
    if (!container) return null;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var text = (node.textContent || "").trim();
      if (isAgentActive(text)) {
        var el = node.parentElement;
        if (el && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  // ── Overlay ──────────────────────────────────────────────────────────

  var _overlay = null;
  var _active = false;
  var _sig = "";
  var _sentRender = false;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function buildAdHtml() {
    var href = CLICKURL ? esc(CLICKURL) : "#";
    var fg = "var(--vscode-foreground,currentColor)";
    var dim = "var(--vscode-descriptionForeground,currentColor)";
    return '<span style="display:flex;align-items:center;gap:6px;width:100%;' +
      'box-sizing:border-box;padding:0 16px;white-space:nowrap;overflow:hidden">' +
      '<a href="' + href + '" target="_blank" rel="noopener noreferrer" ' +
      'data-vb-ad="1" style="color:' + fg + ';text-decoration:underline;' +
      'overflow:hidden;white-space:nowrap">' + esc(AD) + '</a></span>';
  }

  function placeOverlay(target) {
    if (!_overlay) {
      _overlay = document.createElement("div");
      _overlay.setAttribute("data-vb", "1");
      _overlay.style.cssText =
        "position:fixed;z-index:2147483646;pointer-events:auto;" +
        "display:flex;align-items:center;box-sizing:border-box;" +
        "background:var(--vscode-editor-background,#1e1e1e);" +
        "visibility:hidden;border-radius:4px;padding:2px 0";
      document.body.appendChild(_overlay);
    }
    var r = target.getBoundingClientRect();
    if (r && (r.width > 0 || r.height > 0)) {
      var key = r.left + "," + r.top + "," + r.width + "," + r.height;
      if (key !== _sig) {
        _sig = key;
        _overlay.style.left = (r.left) + "px";
        _overlay.style.top = (r.top + r.height + 4) + "px";
        _overlay.style.minWidth = Math.min(r.width, 400) + "px";
        _overlay.style.visibility = "visible";
        _overlay.innerHTML = buildAdHtml();
      }
    }
  }

  function dropOverlay() {
    if (_overlay && _overlay.parentNode)
      _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    _active = false;
    _sig = "";
    _sentRender = false;
  }

  // ── Evaluation Loop ──────────────────────────────────────────────────
  // Periodically check if the agent is running/thinking. When active,
  // render the ad overlay positioned below the thinking indicator.
  // The same pattern as the Claude Code block but with text-content
  // detection instead of glyph/spinnerRow_ class detection.

  function evaluate() {
    try {
      var indicator = findThinkingIndicator();
      if (indicator) {
        if (!_sentRender) {
          ping("impression_rendered?surface=overlay&ad=" + encodeURIComponent(AD)
            + "&event_uuid=" + encodeURIComponent(newEventUuid()));
          _sentRender = true;
        }
        placeOverlay(indicator);
        _active = true;
      } else {
        if (_active) {
          ping("view_threshold_met?surface=overlay&ad=" + encodeURIComponent(AD)
            + "&visible_ms=1&event_uuid=" + encodeURIComponent(newEventUuid()));
        }
        if (_overlay) dropOverlay();
        _active = false;
      }
    } catch (e) { /* prime directive */ }
  }

  // ── Poll Ad (rotation) ───────────────────────────────────────────────
  function pollAd() {
    try {
      fetch(BASE + "/ad").then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.adText) return;
          if (j.adText !== AD || j.clickUrl !== CLICKURL) {
            AD = j.adText;
            CLICKURL = j.clickUrl || "";
            _sig = ""; // force rebuild
            _sentRender = false;
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // ── Start ────────────────────────────────────────────────────────────
  dlog("block.start", { base: BASE, tier: TIER });

  // Use MutationObserver on #react-app for fast reactivity
  var appContainer = document.getElementById("react-app");
  if (appContainer) {
    var observer = new MutationObserver(function () { evaluate(); });
    observer.observe(appContainer, { childList: true, subtree: true, characterData: true });
  }

  setInterval(evaluate, 500);
  setInterval(pollAd, 10000);
  setTimeout(pollAd, 5000);
  setTimeout(evaluate, 100);

  // Frame-based position refresh
  function frame() {
    if (_active && _overlay) {
      var ind = findThinkingIndicator();
      if (ind) placeOverlay(ind);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
/* VIBE-ADS-END */
