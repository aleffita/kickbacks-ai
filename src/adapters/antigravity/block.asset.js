/* VIBE-ADS-START */
(function () {
  "use strict";

  // ── Debug ─────────────────────────────────────────────────────────
  // console.log is visible in the Cascade panel's webview DevTools.
  // Open via: Help → Toggle Developer Tools, or Cmd+Shift+I on the
  // Cascade panel. Filter by "[Kickbacks]" to see our logs.
  var DB = function () {
    try { console.log("[Kickbacks]", Array.prototype.join.call(arguments, " ")); }
    catch (e) {}
  };
  DB("block loading on", location.href);

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

  DB("AD:", AD, "PORT:", PORT, "BASE:", BASE);

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

  // ── Agent status text detection ───────────────────────────────────
  // We look for textContent containing status keywords inside #react-app.
  // The Cascade panel shows: "Working..." → "Thinking for Xs" → "Thought"

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

  // Full-document scan (not just #react-app) in case the status is
  // rendered outside the React root.
  function findThinkingIndicator() {
    // Strategy 1: look inside #react-app (the Cascade mount point)
    var container = document.getElementById("react-app");
    if (!container) {
      DB("no #react-app yet");
      // Strategy 2: fallback to full-document scan
      container = document.body || document.documentElement;
      if (!container) return null;
    }
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var text = (node.textContent || "").trim();
      if (text && isAgentActive(text)) {
        var el = node.parentElement;
        if (el && el.offsetParent !== null) {
          DB("found thinking indicator:", text.slice(0, 60));
          return el;
        }
      }
    }
    // No match found — check if any visible text exists at all
    if (container && container.textContent && container.textContent.trim()) {
      // DB("container has text but no keyword match");
    }
    return null;
  }

  // ── Overlay ────────────────────────────────────────────────────────

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
    return '<span style="display:flex;align-items:center;gap:6px;width:100%;' +
      'box-sizing:border-box;padding:0 16px;white-space:nowrap;overflow:hidden">' +
      '<span style="color:' + fg + ';font-size:11px;margin-right:6px">ad·</span>' +
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
        "visibility:hidden;border:1px solid var(--vscode-widget-border,#444);" +
        "border-radius:4px;padding:2px 0";
      document.body.appendChild(_overlay);
      DB("overlay element created");
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
        DB("overlay placed at", key);
      }
    } else {
      DB("target has no layout rect");
    }
  }

  function dropOverlay() {
    if (_overlay && _overlay.parentNode)
      _overlay.parentNode.removeChild(_overlay);
    _overlay = null;
    _active = false;
    _sig = "";
    _sentRender = false;
    DB("overlay dropped");
  }

  // ── Evaluation Loop ────────────────────────────────────────────────

  var _noReactLogged = false;

  function evaluate() {
    try {
      var indicator = findThinkingIndicator();
      if (indicator) {
        if (!_sentRender) {
          ping("impression_rendered?surface=overlay&ad=" + encodeURIComponent(AD)
            + "&event_uuid=" + encodeURIComponent(newEventUuid()));
          _sentRender = true;
          DB("impression_rendered sent");
        }
        placeOverlay(indicator);
        _active = true;
      } else {
        if (_active) {
          DB("agent went idle, dropping overlay");
          if (_overlay) dropOverlay();
          _active = false;
        }
      }
    } catch (e) {
      DB("evaluate error:", e.message);
    }
  }

  // ── Ad rotation poll ──────────────────────────────────────────────

  function pollAd() {
    try {
      fetch(BASE + "/ad").then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j || !j.adText) return;
          if (j.adText !== AD || j.clickUrl !== CLICKURL) {
            DB("ad rotated:", j.adText);
            AD = j.adText;
            CLICKURL = j.clickUrl || "";
            _sig = "";
            _sentRender = false;
          }
        }).catch(function () {});
    } catch (e) {}
  }

  // ── Start ──────────────────────────────────────────────────────────

  DB("block.start");

  // MutationObserver on #react-app (or body as fallback)
  var appContainer = document.getElementById("react-app") || document.body;
  if (appContainer) {
    var observer = new MutationObserver(function () { evaluate(); });
    observer.observe(appContainer, {
      childList: true, subtree: true, characterData: true
    });
    DB("observer attached to", appContainer.id || appContainer.tagName);
  } else {
    DB("no container for observer");
  }

  setInterval(evaluate, 500);
  setInterval(pollAd, 10000);
  setTimeout(pollAd, 5000);
  setTimeout(evaluate, 100);
  setTimeout(evaluate, 1000);
  setTimeout(evaluate, 3000);

  // Frame-based position refresh (keeps overlay glued to element)
  function frame() {
    if (_active && _overlay) {
      var ind = findThinkingIndicator();
      if (ind) placeOverlay(ind);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  DB("block fully loaded");
})();
/* VIBE-ADS-END */
