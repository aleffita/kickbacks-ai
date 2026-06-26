/* VIBE-ADS-START */
try {
  // Ultra-simple proof of life: change background to green for 3 seconds
  var KBPROOF = document.createElement("div");
  KBPROOF.id = "kb-proof";
  KBPROOF.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999999;" +
    "background:#22c55e;color:#fff;text-align:center;padding:8px;font-size:14px;" +
    "font-family:monospace;font-weight:bold;border-bottom:3px solid #16a34a";
  KBPROOF.textContent = "Kickbacks loaded ✓ - Ad: REPLACE_ME";
  var target = document.body || document.documentElement;
  if (target) {
    target.insertBefore(KBPROOF, target.firstChild);
    // Remove after 10s
    setTimeout(function() {
      try { if (KBPROOF.parentNode) KBPROOF.parentNode.removeChild(KBPROOF); } catch(e) {}
    }, 10000);
  }

  // Also change the document title
  try { document.title = "[Kickbacks] " + document.title; } catch(e) {}

  // Log to console
  try { console.log("[Kickbacks] BLOCK EXECUTED", new Date().toISOString()); } catch(e) {}

  // Fetch to a distinctive URL we can spot in the network tab
  try {
    var KBPORT = __VIBE_ADS_PORT__;
    var KBTOKEN = __VIBE_ADS_LBTOKEN__;
    var KBAD = __VIBE_ADS_AD__;
    KBPROOF.textContent = "Kickbacks loaded ✓ - Port: " + KBPORT + " - Ad: " + KBAD;
    fetch("http://127.0.0.1:" + KBPORT + "/vibe-ads/" + KBTOKEN + "/activity")
      .catch(function() {});
  } catch(e) {
    try { KBPROOF.textContent = "Kickbacks loaded ✓ - ERROR: " + e.message; } catch(e2) {}
  }
} catch(e) {
  try { console.error("[Kickbacks] FATAL:", e); } catch(e2) {}
}
/* VIBE-ADS-END */
