import * as vscode from "vscode";
import { buildLabel } from "./buildinfo";

export type SbState =
  | { kind: "signed-out" }
  | { kind: "active"; version: string; usd?: string; usdToday?: string }
  | { kind: "incompatible"; version: string }
  | { kind: "killed" }
  | { kind: "offline" }
  | { kind: "debug"; on: boolean; version?: string; usd?: string; usdToday?: string }
  | { kind: "ad"; adText: string; clickUrl?: string; adId?: string; campaignId?: string; sessionToken?: string; sessionNonce?: string; visibleMs?: number }
  | { kind: "needs-reload" };

const GREEN = "#2ea043";
const RED = "#f85149";
const AD_COLOR = "#dba110";         // amber — billando normalmente
const AD_PAUSED = "#88888866";      // cinza — billing pausado (janela sem foco / dúvida)

/**
 * Status bar com TWO items independentes:
 *   [Kickbacks ($X today · $Y)]  [📣 ad· Text...]
 *
 * Billing simplificado (só window focus — igual overlay):
 *   VS Code em foco → billando (🟡)
 *   Alt+Tab / perdeu foco → pausado (🔘)
 *   Sem idle decay, sem eventos de editor, sem contador regressivo.
 *   O servidor já faz cooldown por superfície + daily cap + threshold.
 */
export class StatusBar {
  // Ad item (lado esquerdo, prioridade negativa = mais estável, menos concorrência)
  private adItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, -100);
  // Earnings item (priority 999 = just left of ad)
  private item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right, 999);

  // ── Billing state ─────────────────────────────────────────────────
  private _windowFocused = true;    // único gate: VS Code tem foco do SO
  private tickInterval: NodeJS.Timeout | null = null;
  private _onTick: ((intervalMs: number) => void) | null = null;
  set onTick(fn: ((intervalMs: number) => void) | null) { this._onTick = fn; }

  // Active ad info (para o click command + cor gradiente)
  private _adText = "";
  private _adClickUrl = "";
  private _adId = "";
  private _campaignId = "";
  private _sessionToken = "";
  private _sessionNonce = "";
  private _bannerVisibleMs = 0;
  get adId(): string { return this._adId; }
  get campaignId(): string { return this._campaignId; }
  get sessionToken(): string { return this._sessionToken; }
  get sessionNonce(): string { return this._sessionNonce; }
  get bannerVisibleMs(): number { return this._bannerVisibleMs; }
  /** Sincronizado do onTick (extension.ts) a cada 5s pra cor gradiente. */
  set bannerVisibleMs(ms: number) { this._bannerVisibleMs = ms; }

  private _marqueeOffset = 0;
  private _marqueeTimer: NodeJS.Timeout | null = null;
  private static readonly AD_WIDTH = 36;
  // News ticker: 500ms = 2 passos/s (suave, sem jank)
  private static readonly MARQUEE_MS = 500;

  text = "";

  constructor() {
    this.item.command = "kickbacks.debugMenu";
    this.item.show();
    this.adItem.command = "kickbacks.openAdUrl";
    // Window focus: único gate de billing (igual overlay)
    try {
      vscode.window.onDidChangeWindowState((e) => {
        this._windowFocused = e.focused;
      });
    } catch {}
    this.startTicking();
  }

  // ── Billing tick (simplificado + gradiente) ──────────────────────
  // Só window focus. Cor do banner reflete o visibleMs acumulado:
  //   0s  → #888 (cinza, acabou de aparecer)
  //   5s  → warm gray-beige
  //   10s → golden beige
  //   12s → #f0ecd0 (quase branco, "quase lá")
  //   15s → #dba110 (âmbar, threshold batido → click liberado!)
  //   Sem idle decay, sem eventos de editor, sem contador.
  private startTicking(): void {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => {
      try {
        const billable = this._windowFocused;
        this.adItem.color = billable
          ? this._adColor(this._bannerVisibleMs)
          : AD_PAUSED;
        this.adItem.show();
        if (billable && this._onTick) this._onTick(5000);
      } catch { /* prime directive */ }
    }, 5000);
  }

  /** Gradiente multi-estágio: cinza → branco quente → âmbar conforme
   *  visibleMs avança em direção ao threshold de 15s. */
  private static readonly COLOR_STOPS = [
    { pos: 0.00, r: 0x88, g: 0x88, b: 0x88 },
    { pos: 0.33, r: 0xcc, g: 0xc8, b: 0xaa },
    { pos: 0.67, r: 0xf0, g: 0xe8, b: 0xbb },
    { pos: 1.00, r: 0xdb, g: 0xa1, b: 0x10 },
  ];
  private _adColor(vms: number): string {
    if (vms >= 15000) return AD_COLOR;
    const t = Math.min(vms / 15000, 1.0);
    const stops = StatusBar.COLOR_STOPS;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (t >= a.pos && t <= b.pos) {
        const s = (t - a.pos) / (b.pos - a.pos);
        const r = Math.round(a.r + (b.r - a.r) * s);
        const g = Math.round(a.g + (b.g - a.g) * s);
        const bl = Math.round(a.b + (b.b - a.b) * s);
        return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${bl.toString(16).padStart(2,'0')}`;
      }
    }
    return AD_COLOR;
  }

  // ── Ad display ───────────────────────────────────────────────────
  setAd(text: string, clickUrl: string, _iconUrl?: string): void {
    // Só reseta marquee se o texto mudou — mesmo texto = scroll suave
    if (text !== this._adText) this._marqueeOffset = 0;
    this._adText = text;
    this._adClickUrl = clickUrl;
    // Marquee SEMPRE rodando (todo texto scrolla)
    this._stopMarquee();
    this._marqueeTimer = setInterval(() => {
      this._marqueeOffset++;
      this._paintAd();
    }, StatusBar.MARQUEE_MS);
    this._paintAd();
    // Cor começa de onde o visibleMs está (gray se 0, gradiente se acumulou)
    this.adItem.color = this._adColor(this._bannerVisibleMs);
    this.adItem.show();
  }

  /** Reseta a sessão do banner (pós-clique): visibleMs → 0, cor → cinza.
   *  O próximo fetch/onTick vai reacumulando naturalmente. */
  resetAdSession(): void {
    this._bannerVisibleMs = 0;
    this.adItem.color = this._adColor(0);
  }

  /** Setter pra extensão.ts conectar o refresh do banner (portfolio +
   *  re-fetch) ao comando de clique. */
  private _refreshAd: (() => Promise<void>) | null = null;
  set refreshAd(fn: (() => Promise<void>) | null) { this._refreshAd = fn; }
  /** Chamado pelo comando openAdUrl após enviar o click metric. */
  refreshAdNow(): Promise<void> {
    return this._refreshAd ? this._refreshAd() : Promise.resolve();
  }

  hideAd(): void {
    this._stopMarquee();
    this.adItem.hide();
    this._adText = "";
    this._adClickUrl = "";
    this._adId = "";
    this._campaignId = "";
    this._sessionToken = "";
    this._sessionNonce = "";
    this._bannerVisibleMs = 0;
  }

  private _paintAd(): void {
    // SEM show() aqui — o billing tick (5s) já mantém visibilidade
    const raw = this._adText;
    const w = StatusBar.AD_WIDTH;
    const prefix = "📣 ";  // megaphone emoji
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
        this._adId = s.adId || "";
        this._campaignId = s.campaignId || "";
        this._sessionToken = s.sessionToken || "";
        this._sessionNonce = s.sessionNonce || "";
        this._bannerVisibleMs = s.visibleMs ?? 0;
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
