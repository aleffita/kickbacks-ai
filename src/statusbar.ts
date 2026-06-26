import * as vscode from "vscode";
import { buildLabel } from "./buildinfo";

export type SbState =
  | { kind: "signed-out" }
  | { kind: "active"; version: string; usd?: string; usdToday?: string }
  | { kind: "incompatible"; version: string }
  | { kind: "killed" }
  | { kind: "offline" }
  | { kind: "debug"; on: boolean; version?: string; usd?: string; usdToday?: string }
  | { kind: "ad"; adText: string; clickUrl?: string }
  | { kind: "needs-reload" };

const GREEN = "#2ea043";
const RED = "#f85149";
const AD_COLOR = "#dba110"; // amber/gold — distinct from earnings green

/**
 * Activity-aware status bar with TWO items:
 *   [Kickbacks ($X today · $Y)]  [✦  ad· Text... [✕]]
 *
 * Left item → debug menu (existing). Right item → opens ad URL.
 * Billing decay: sends view_tick less frequently during idle periods,
 * stops after 5 min AFK (Hermes-style).
 */
export class StatusBar {
  // Ad item (priority 1000 = right-most, ad visible first)
  private adItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 1000);
  // Earnings item (priority 999 = just left of ad)
  private item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 999);

  // ── Activity tracking ──────────────────────────────────────────────
  private lastActivityMs = Date.now();
  private tickInterval: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private _onTick: ((intervalMs: number) => void) | null = null;
  /** Called on every billing tick with the current interval. */
  set onTick(fn: ((intervalMs: number) => void) | null) { this._onTick = fn; }

  // Active ad info
  private _adText = "";
  private _adClickUrl = "";
  private _adIconUrl = "";
  private _marqueeOffset = 0;
  private _marqueeTimer: NodeJS.Timeout | null = null;
  /** Fixed width for the ad item so it never shifts other items. */
  private static readonly AD_WIDTH = 40;
  private static readonly MARQUEE_MS = 250;

  text = "";

  constructor() {
    this.item.command = "kickbacks.debugMenu";
    this.item.show();
    // Ad item starts hidden; shown via setAd()
    this.adItem.command = "kickbacks.openAdUrl";
    // Wire activity listener
    this.startActivityTracking();
    // Start billing tick loop
    this.startTicking();
  }

  /** Track user activity — resets the idle timer on any of these signals. */
  private startActivityTracking(): void {
    const reset = () => { this.lastActivityMs = Date.now(); };
    try { vscode.window.onDidChangeTextEditorSelection(reset); } catch {}
    try { vscode.window.onDidChangeActiveTextEditor(reset); } catch {}
    try { vscode.window.onDidChangeWindowState((e) => { if (e.focused) reset(); }); } catch {}
  }

  /** Billing tick loop with Hermes-style decay. Every 5s we check idle
   *  duration and adjust the tick interval:
   *    0-30s  → tick every 5s  (full rate)
   *    30-60s → tick every 10s
   *    1-2min → tick every 30s
   *    2-5min → tick every 60s
   *    >5min  → stop billing (ad still visible)
   */
  private startTicking(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      try {
        const idleMs = Date.now() - this.lastActivityMs;
        const idleSec = idleMs / 1000;

        let tickIntervalMs = 5000; // default
        let shouldTick = false;

        if (idleSec < 30) {
          tickIntervalMs = 5000;
          shouldTick = true;
        } else if (idleSec < 60) {
          tickIntervalMs = 10000;
          shouldTick = true;
        } else if (idleSec < 120) {
          tickIntervalMs = 30000;
          shouldTick = true;
        } else if (idleSec < 300) {
          tickIntervalMs = 60000;
          shouldTick = true;
        } else {
          // >5 min AFK: stop billing
          shouldTick = false;
        }

        if (shouldTick && this._onTick) {
          this.tickCount++;
          this._onTick(tickIntervalMs);
        }
      } catch { /* prime directive */ }
    }, 5000);
  }

  /** Show or update the ad item alongside the earnings. */
  setAd(text: string, clickUrl: string, iconUrl?: string): void {
    try { console.log("[Kickbacks] setAd called:", text.slice(0, 40)); } catch {}
    this._adText = text;
    this._adClickUrl = clickUrl;
    this._adIconUrl = iconUrl || "";
    this._marqueeOffset = 0;
    this._paintAd();
    this.adItem.color = AD_COLOR;
    this.adItem.show();
    // Start marquee scrolling for long text
    this._stopMarquee();
    if (text.length > StatusBar.AD_WIDTH) {
      this._marqueeTimer = setInterval(() => {
        this._marqueeOffset++;
        this._paintAd();
      }, StatusBar.MARQUEE_MS);
    }
  }

  /** Hide the ad item. */
  hideAd(): void {
    this._stopMarquee();
    this.adItem.hide();
    this._adText = "";
    this._adClickUrl = "";
    this._adIconUrl = "";
  }

  private _paintAd(): void {
    const raw = this._adText;
    const text = this.escape(raw);
    const w = StatusBar.AD_WIDTH;
    // Always produce exactly w characters of visible text. Use spaces for
    // padding (not special Unicode spaces, which render inconsistently).
    // This keeps the status bar slot at a stable pixel width.
    const prefix = "$(megaphone) ";
    if (raw.length <= w - prefix.length) {
      this.adItem.text = prefix + text.padEnd(w - prefix.length, " ");
      this.adItem.tooltip = `Open ${this._adClickUrl || raw}`;
      return;
    }
    // Marquee: always render exactly w characters. The sliding window
    // changes WHICH w characters are visible, not HOW MANY.
    const gap = "   >>   ";
    const content = prefix + raw;
    const padded = content + gap + content;
    const maxStart = Math.max(0, padded.length - w);
    const start = this._marqueeOffset % (maxStart + 1);
    const slice = padded.slice(start, start + w);
    this.adItem.text = this.escape(slice).padEnd(w, " ");
    this.adItem.tooltip = `Open ${this._adClickUrl || raw}\n${raw}`;
  }

  private _stopMarquee(): void {
    if (this._marqueeTimer) {
      clearInterval(this._marqueeTimer);
      this._marqueeTimer = null;
    }
  }

  private escape(s: string): string {
    // Status bar text uses $(icon) syntax — escape $ so ad text with $ doesn't break
    return s.replace(/\$/g, "\\$");
  }

  /** Get the current ad click URL (for the openAdUrl command). */
  get adClickUrl(): string { return this._adClickUrl; }

  private reloadLock = false;

  private static isRoutine(s: SbState): boolean {
    return s.kind === "ad" || s.kind === "active"
      || (s.kind === "debug" && s.on !== false);
  }

  /** True when there's a visible ad (used by onTick to decide state). */
  get hasAd(): boolean { return this.adItem.text !== ""; }
  get adText(): string { return this._adText; }

  set(s: SbState): boolean {
    if (this.reloadLock && s.kind !== "needs-reload") {
      if (StatusBar.isRoutine(s)) return false;
      this.reloadLock = false;
    }
    let color: string | undefined;
    let background: vscode.ThemeColor | undefined;
    let command = "kickbacks.debugMenu";
    let tooltip = "Kickbacks";
    switch (s.kind) {
      case "signed-out":
        this.text = "Kickbacks: Sign in";
        color = RED;
        tooltip = "Click to sign in to Kickbacks";
        break;
      case "active":
        this.text = `Kickbacks${this.earned(s.usd, s.usdToday)}`;
        color = GREEN;
        tooltip = `Kickbacks active${s.version ? ` · Claude Code ${s.version}` : ""}`
          + ` · $${s.usdToday ?? "0.00"} today · $${s.usd ?? "0.00"} earned`;
        break;
      case "debug":
        if (s.on === false) {
          this.text = "Kickbacks: Off";
          color = RED;
          tooltip = "Kickbacks is currently OFF — click to re-enable";
        } else {
          this.text = `Kickbacks${this.earned(s.usd, s.usdToday)}`;
          color = GREEN;
          tooltip = `Kickbacks active${s.version ? ` · Claude Code ${s.version}` : ""}`
            + ` · $${s.usdToday ?? "0.00"} today · $${s.usd ?? "0.00"} earned`;
        }
        break;
      case "incompatible":
        this.text = `Kickbacks incompatible (${s.version})`;
        break;
      case "killed":
        this.text = "Kickbacks killed";
        color = RED;
        break;
      case "offline":
        this.text = "Kickbacks offline";
        color = RED;
        break;
      case "ad":
        this.setAd(s.adText, s.clickUrl || "");
        return true;
      case "needs-reload":
        this.reloadLock = true;
        this.text = "$(warning) Kickbacks: RELOAD";
        background = new vscode.ThemeColor("statusBarItem.errorBackground");
        color = "#ffffff";
        command = "workbench.action.reloadWindow";
        tooltip = "Kickbacks won't earn until you reload — click to reload now";
        break;
    }
    this.item.command = command;
    this.item.backgroundColor = background;
    this.item.color = color;
    this.item.tooltip = `${tooltip} · ${buildLabel()}`;
    this.item.text = this.text;
    return true;
  }

  private earned(usd?: string, today?: string): string {
    return ` ($${today ?? "0.00"} today · $${usd ?? "0.00"})`;
  }

  dispose(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.item.dispose();
    this.adItem.dispose();
  }
}
