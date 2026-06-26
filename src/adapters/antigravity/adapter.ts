import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { TargetAdapter, PreflightResult, OpResult, RestoreResult, PatchParams, AdapterDiagnostics } from "../types";
import { dlog } from "../../log";
import { sha256 } from "../../util/crypto";
import { resolveAsset } from "../../util/asset";

/**
 * Antigravity IDE — Jetski Agent Adapter
 *
 * Patches the Antigravity IDE's native Cascade/jetskiAgent webview to inject
 * Kickbacks.ai ad creative into the thinking/agent spinner.
 *
 * Target: /Applications/Antigravity IDE.app/Contents/Resources/app/out/jetskiAgent/main.js
 *
 * The jetskiAgent is a 12MB webview bundle rendered inside the Cascade panel.
 * We locate the thinking/processing indicator and inject our block the same
 * way the Claude Code adapter works — find-and-replace on the verb array or
 * equivalent spinner DOM anchor.
 *
 * TODO: Identify the exact verb/spinner anchor in jetskiAgent/main.js
 * TODO: Adjust CSP patch (if needed) for the antigravity extension
 */

export class AntigravityAdapter implements TargetAdapter {
  readonly name = "antigravity";
  private readonly target: string;
  constructor(target: string) { this.target = resolve(target); }

  private backupPath(): string { return this.target + ".kickbacks-backup"; }

  version(): string | null {
    // Read version from the antigravity extension's package.json
    try {
      const extDir = dirname(dirname(dirname(dirname(this.target))));
      const pkgPath = join(extDir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        return pkg.version || "unknown";
      }
    } catch { /* fall through */ }
    return "unknown";
  }

  preflight(): PreflightResult {
    try {
      if (!existsSync(this.target))
        return { ok: true, compatible: false, version: null, reason: "jetskiAgent target not found" };
      return { ok: true, compatible: true, version: this.version() };
    } catch (e) {
      return { ok: false, compatible: false, version: null, reason: String(e) };
    }
  }

  isPatched(): boolean {
    try {
      return existsSync(this.target) &&
        readFileSync(this.target, "utf8").includes("/* VIBE-ADS-START */");
    } catch { return false; }
  }

  applyPatch(p: PatchParams): OpResult {
    try {
      if (!existsSync(this.target))
        return { ok: false, reason: "target not found" };
      
      // TODO: Implement the actual patch logic for jetskiAgent
      // 1. Find the animating spinner/thinking indicator in the bundle
      // 2. Inject the ad overlay block
      // 3. Add CSP relaxation if needed
      
      return { ok: false, reason: "not yet implemented" };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  restore(opts?: { keepCsp?: boolean }): RestoreResult {
    try {
      const bak = this.backupPath();
      if (!existsSync(bak))
        return { ok: true, restored: false, reason: "no backup present" };
      
      const pristine = readFileSync(bak);
      writeFileSync(this.target, pristine);
      unlinkSync(bak);
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
