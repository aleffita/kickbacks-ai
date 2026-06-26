import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams, AdapterDiagnostics } from "../types";
import { dlog } from "../../log";
import { sha256 } from "../../util/crypto";
import { resolveAsset } from "../../util/asset";

/**
 * Antigravity IDE — Jetski Agent (Cascade) Adapter
 *
 * Patches the Antigravity IDE's native Cascade/jetskiAgent webview bundle
 * to inject Kickbacks.ai ad creative into the agent thinking indicator.
 *
 * Target: /Applications/Antigravity IDE.app/Contents/Resources/app/out/jetskiAgent/main.js
 *
 * Also patches the sibling cascade-panel.html to relax the webview CSP
 * (add connect-src for the loopback), mirroring the Claude Code adapter's
 * approach of patching extension.js.
 *
 * Detection anchor: text-content matching for status strings like
 * "Thinking", "Working", "Processing", "RUNNING". The injected block
 * uses a MutationObserver + text-content matching to find the thinking
 * indicator at runtime and positions an ad overlay below it.
 */

const ANCHORS = [
  '"Thinking"', '"Working"', '"Processing"',
  '"RUNNING"', '"GENERATING"',
];

const BLOCK_START = "/* VIBE-ADS-START */";
const BLOCK_RE = /\/\* VIB(?:E-)?ADS-START \*\/[\s\S]*?\/\* VIB(?:E-)?ADS-END \*\//g;

export function resolveBlockAsset(baseDir: string): string {
  return resolveAsset(baseDir, "adapters/antigravity", "block.asset.js");
}

function atomicWriteFile(target: string, data: Buffer): void {
  const tmp = target + ".kickbacks-tmp-" + process.pid + "-" + Date.now();
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, target);
  } catch {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    writeFileSync(target, data);
  }
}

export class AntigravityAdapter implements TargetAdapter {
  readonly name = "antigravity";
  private readonly target: string;

  constructor(target: string) { this.target = resolve(target); }

  private backupPath(): string { return this.target + ".kickbacks-backup"; }

  private cascadePanelHtmlPath(): string {
    return join(dirname(dirname(dirname(this.target))), "extensions", "antigravity", "cascade-panel.html");
  }

  private cspBackupPath(): string {
    return this.cascadePanelHtmlPath() + ".kickbacks-csp-backup";
  }

  private readonly CSP_MARK = "kickbacks-csp-connect";
  private readonly CSP_CONNECT = "connect-src http://127.0.0.1:* http://localhost:*";

  /** Add a CSP meta tag to cascade-panel.html so the injected block can
   *  reach the loopback. Idempotent; reversible via restoreCsp. */
  private patchCspWithReason(): { ok: boolean; reason?: string } {
    try {
      const html = this.cascadePanelHtmlPath();
      if (!existsSync(html)) return { ok: false, reason: "no-sibling" };
      let src = readFileSync(html, "utf8");
      if (src.includes(this.CSP_MARK)) return { ok: true, reason: "already" };
      const bak = this.cspBackupPath();
      if (!existsSync(bak)) writeFileSync(bak, src);
      const cspTag = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ${this.CSP_CONNECT};" data-kickbacks="${this.CSP_MARK}">\n`;
      const headEnd = src.indexOf("</head>");
      if (headEnd !== -1) {
        src = src.slice(0, headEnd) + "  " + cspTag + src.slice(headEnd);
      } else {
        const htmlOpen = src.indexOf("<html");
        if (htmlOpen !== -1) {
          const closeTag = src.indexOf(">", htmlOpen);
          src = src.slice(0, closeTag + 1) + "\n  " + cspTag + src.slice(closeTag + 1);
        } else {
          src = cspTag + src;
        }
      }
      writeFileSync(html, src);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "io-err" };
    }
  }

  /** Revert the CSP HTML patch from pristine backup. */
  private restoreCsp(): void {
    try {
      const bak = this.cspBackupPath();
      if (!existsSync(bak)) return;
      const pristine = readFileSync(bak);
      writeFileSync(this.cascadePanelHtmlPath(), pristine);
      if (sha256(readFileSync(this.cascadePanelHtmlPath())) === sha256(pristine))
        unlinkSync(bak);
    } catch { /* best-effort */ }
  }

  version(): string | null {
    try {
      const pkgPath = resolve(this.target, "../../../../../package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        return pkg.version || "unknown";
      }
    } catch { /* fall through */ }
    return "jetski-agent";
  }

  preflight(): PreflightResult {
    try {
      if (!existsSync(this.target))
        return { ok: true, compatible: false, version: null,
          reason: "jetskiAgent target not found" };
      const src = readFileSync(this.target, "utf8");
      const hasAnchor = ANCHORS.some((a) => src.includes(a));
      if (!hasAnchor) {
        return { ok: true, compatible: false, version: this.version(),
          reason: "no status-text anchor found (incompatible build)" };
      }
      return { ok: true, compatible: true, version: this.version() };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  isPatched(): boolean {
    try {
      return existsSync(this.target) &&
        readFileSync(this.target, "utf8").includes(BLOCK_START);
    } catch { return false; }
  }

  private ensureBackup(): Buffer | null {
    const bak = this.backupPath();
    if (existsSync(bak)) {
      const buf = readFileSync(bak);
      const tainted = buf.indexOf(BLOCK_START) !== -1;
      if (tainted) {
        try { unlinkSync(bak); } catch { /* fall through */ }
      } else {
        return buf;
      }
    }
    const raw = readFileSync(this.target);
    if (raw.indexOf(BLOCK_START) !== -1) {
      dlog("ext", "antigravity.backup.refused", { reason: "live file already patched" });
      return null;
    }
    writeFileSync(bak, raw);
    return raw;
  }

  private renderBlock(p: PatchParams): string {
    const assetPath = resolveBlockAsset(dirname(__filename));
    let src = readFileSync(assetPath, "utf8");
    const subs: Record<string, string> = {
      __VIBE_ADS_TIER__: String(p.tier),
      __VIBE_ADS_AD__: JSON.stringify(p.adText),
      __VIBE_ADS_ICON__: JSON.stringify(p.iconRef),
      __VIBE_ADS_ICON_URL__: JSON.stringify(p.iconUrl),
      __VIBE_ADS_PORT__: String(p.loopbackPort),
      __VIBE_ADS_LBTOKEN__: JSON.stringify(p.loopbackToken),
      __VIBE_ADS_BASE__: JSON.stringify(p.loopbackBase ?? ""),
      __VIBE_ADS_DEBUG__: p.debug ? "true" : "false",
      __VIBE_ADS_CLICKTOKEN__: JSON.stringify(p.clickToken),
      __VIBE_ADS_CLICKURL__: JSON.stringify(p.clickUrl),
      __VIBE_ADS_CORR__: JSON.stringify(p.corr),
      __VIBE_ADS_VIEW_THRESHOLD_MS__:
        String(typeof p.viewThresholdMs === "number"
          && p.viewThresholdMs > 0 ? p.viewThresholdMs : 15000),
    };
    for (const [k, v] of Object.entries(subs))
      src = src.split(k).join(v);
    return src.trim();
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      if (!existsSync(this.target))
        return { ok: false, reason: "target not found" };

      const pristineBuf = this.ensureBackup();
      if (pristineBuf === null)
        return { ok: true, reason: "already patched; no pristine backup" };

      const existing = readFileSync(this.target, "utf8");
      const cleaned = existing.replace(BLOCK_RE, "").replace(/\s+$/, "");
      const block = this.renderBlock(p);
      const out = cleaned + "\n" + block + "\n";
      const outBuf = Buffer.from(out, "utf8");
      if (sha256(outBuf) !== sha256(readFileSync(this.target)))
        atomicWriteFile(this.target, outBuf);

      // Relax the webview CSP so the loopback is reachable
      const cspResult = this.patchCspWithReason();
      dlog("ext", "antigravity.csp", { ok: cspResult.ok, reason: cspResult.reason || "ok" });

      dlog("ext", "antigravity.patch", { target: this.target });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(opts?: { keepCsp?: boolean }): RestoreResult {
    // Revert the visible block from main.js
    try {
      const bak = this.backupPath();
      if (!existsSync(bak)) {
        // No JS backup — still revert the CSP if requested
        if (!opts?.keepCsp) this.restoreCsp();
        return { ok: true, restored: false, reason: "no backup present" };
      }
      const pristine = readFileSync(bak);
      let out = pristine;
      if (pristine.indexOf(BLOCK_START) !== -1) {
        out = Buffer.from(
          pristine.toString("utf8").replace(BLOCK_RE, ""), "utf8");
      }
      writeFileSync(this.target, out);
      const now = sha256(readFileSync(this.target));
      if (now !== sha256(out))
        return { ok: false, restored: false, reason: "sha256 mismatch after restore" };
      unlinkSync(bak);
      // Revert the HTML CSP patch
      if (!opts?.keepCsp) this.restoreCsp();
      return { ok: true, restored: true };
    } catch (e) {
      return { ok: false, restored: false, reason: String(e) };
    }
  }

  diagnose(): AdapterDiagnostics {
    return {
      name: this.name,
      target: this.target,
      targetExists: existsSync(this.target),
      version: this.version(),
      compatible: false,
      isPatched: this.isPatched(),
      backup: { exists: existsSync(this.backupPath()), path: this.backupPath(), hasArray: false, hasBlock: false },
      live: { hasArray: false, bareVerbPresent: false },
    };
  }
}
