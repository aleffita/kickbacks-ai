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
const AD_COLOR = "#dba110";         // amber — billando normalmente
const AD_PAUSED = "#88888866";      // cinza — billing pausado (janela sem foco / dúvida)

/**
 * Activity-aware status bar with TWO items:
 *   [Kickbacks ($X today · $Y)]  [$(megaphone) ad· Text...]
 *
 * Billing architecture (two-level):
 *   Mestre → window.onDidChangeWindowState: perdeu foco → corta IMEDIATAMENTE
 *   Contador → 5min sem nenhum evento mesmo com foco → "dúvida" → corta
 *   Qualquer evento → reseta contador → volta a billar
 */
export class StatusBar {
  // Ad item (priority 1000 = right-most, ad visible first)
  private adItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 1000);
  // Earnings item (priority 999 = just left of ad)
  private item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 999);

  // ── Billing state ─────────────────────────────────────────────────
  private _windowFocused = true;    // mestre: VS Code tem foco do SO
  private lastActivityMs = Date.now();
  private tickInterval: NodeJS.Timeout | null = null;
  private _onTick: ((intervalMs: number) => void) | null = null;
  set onTick(fn: ((intervalMs: number) => void) | null) { this._onTick = fn; }

  // Active ad info
  private _adText = "";
  private _adClickUrl = "";
  private _marqueeOffset = 0;
  private _marqueeTimer: NodeJS.Timeout | null = null;
  private static readonly AD_WIDTH = 40;
  private static readonly MARQUEE_MS = 250;

  text = "";

  constructor() {
    this.item.command = "kickbacks.debugMenu";
    this.item.show();
    this.adItem.command = "kickbacks.openAdUrl";
    this.startActivityTracking();
    this.startTicking();
  }

  // ── Activity tracking ────────────────────────────────────────────
  // Qualquer evento reseta o contador regressivo de idle.
  private startActivityTracking(): void {
    const reset = () => { this.lastActivityMs = Date.now(); };
    try { vscode.window.onDidChangeTextEditorSelection(reset); } catch {}
    try { vscode.window.onDidChangeActiveTextEditor(reset); } catch {}
    try { vscode.window.onDidChangeTextEditorVisibleRanges(reset); } catch {}  // scroll
    // Window focus: mestre do billing
    try {
      vscode.window.onDidChangeWindowState((e) => {
        this._windowFocused = e.focused;
        if (this._windowFocused) reset();  // voltou → reseta contador
      });
    } catch {}
  }

  // ── Billing tick ─────────────────────────────────────────────────
  // Dois níveis:
  //   1. Mestre: se _windowFocused === false → nunca billing (nem avalia idle)
  //   2. Contador: 5min sem eventos mesmo com foco → "dúvida" → para billing
  // Cor do banner reflete o estado (amarelo = billando, cinza = pausado).
  private startTicking(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      try {
        const idleMs = Date.now() - this.lastActivityMs;
        const idleSec = idleMs / 1000;

        // Master switch
        let billable = this._windowFocused;
        let tickIntervalMs = 5000;

        if (billable) {
          // Contador regressivo com decay
          if (idleSec >= 300) {
            billable = false;   // >5min idle com foco → dúvida → corta
          } else if (idleSec >= 120) {
            tickIntervalMs = 60000;
          } else if (idleSec >= 60) {
            tickIntervalMs = 30000;
          } else if (idleSec >= 30) {
            tickIntervalMs = 10000;
          }
          // <30s: tickIntervalMs = 5000 (padrão)
        }

        // Banner color reflects billing state + força visível
        this.adItem.color = billable ? AD_COLOR : AD_PAUSED;
        this.adItem.show();

        if (billable && this._onTick) {
          this._onTick(tickIntervalMs);
        }
      } catch { /* prime directive */ }
    }, 5000);
  }

  // ── Ad display ───────────────────────────────────────────────────
  setAd(text: string, clickUrl: string, _iconUrl?: string): void {
    this._adText = text;
    this._adClickUrl = clickUrl;
    this._marqueeOffset = 0;
    this._paintAd();
    this.adItem.color = AD_COLOR;
    this.adItem.show();
    this._stopMarquee();
    if (text.length > StatusBar.AD_WIDTH) {
      this._marqueeTimer = setInterval(() => {
        this._marqueeOffset++;
        this._paintAd();
      }, StatusBar.MARQUEE_MS);
    }
  }

  hideAd(): void {
    this._stopMarquee();
    this.adItem.hide();
    this._adText = "";
    this._adClickUrl = "";
  }

  private _paintAd(): void {
    this.adItem.show();  // reexibe em cada pintura (marquee, fetch, tick)
    const raw = this._adText;
    const text = this.escape(raw);
    const w = StatusBar.AD_WIDTH;
    const prefix = "📣 ";  // megaphone emoji
    if (raw.length <= w - prefix.length) {
      this.adItem.text = prefix + text.padEnd(w - prefix.length, " ");
      this.adItem.tooltip = `Open ${this._adClickUrl || raw}`;
      return;
    }
    const gap = "   >>   ";
    const availW = w - prefix.length;
    const padded = raw + gap + raw;
    const maxStart = Math.max(0, padded.length - availW);
    const start = this._marqueeOffset % (maxStart + 1);
    const slice = padded.slice(start, start + availW);
    this.adItem.text = prefix + this.escape(slice).padEnd(availW, " ");
    this.adItem.tooltip = `Open ${this._adClickUrl || raw}\n${raw}`;
  }

  private _stopMarquee(): void {
    if (this._marqueeTimer) {
      clearInterval(this._marqueeTimer);
      this._marqueeTimer = null;
    }
  }

  /** Escape $ for status bar text so ad text like \"$30/month\" isn't
   *  interpreted as a VS Code $(codicon). */
  private escape(s: string): string {
    return s.replace(/\$/g, "\\$");
  }

  get adClickUrl(): string { return this._adClickUrl; }

  // ── Earnings item ────────────────────────────────────────────────
  private reloadLock = false;

  private static isRoutine(s: SbState): boolean {
    return s.kind === "ad" || s.kind === "active"
      || (s.kind === "debug" && s.on !== false);
  }

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
