/**
 * The Saber Studio console page (docs/design/SABER-STUDIO-GUI-DESIGN.md).
 *
 * Honest scope: this is the loopback supervisor console over the trusted
 * core, not the Code-OSS desktop IDE (design §12.2, §17). Every effect still
 * flows through `POST /api/run` → `saber-core run`, so policy, sandbox and
 * the encrypted audit trail are identical to the CLI. The renderer itself
 * holds no shell, git, network or secret access — it only renders what the
 * local console server and the core's own verdict lines report.
 *
 * The client script is embedded in a template literal, so it uses string
 * concatenation only (no backticks, no interpolation) on purpose.
 */
import { UI_STRINGS } from "./ui-i18n.js";
import { tokenCss } from "./ui-tokens.js";

/** Server facts injected into the page at build time of the response. */
export interface StudioBootState {
  readonly workspace: string;
  readonly branch: string;
  readonly store: string;
  readonly core: string;
  readonly platform: string;
  readonly sandboxBackend: string;
  readonly node: string;
  readonly version: string;
  readonly port: number;
  readonly startedAt: string;
}

/** JSON that is safe to inline into a `<script>` block. */
function inject(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const STUDIO_CSS = `
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--size-compact);
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-canvas);
  overflow: hidden;
}
.vh { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.skip { position: absolute; left: 8px; top: -40px; z-index: 60; background: var(--surface-raised);
  color: var(--text-primary); padding: 8px 12px; border-radius: var(--radius-control);
  border: 1px solid var(--line-spine); transition: top var(--motion-pane); }
.skip:focus { top: 8px; }
:focus-visible { outline: var(--border-focus) solid var(--signal-cognition); outline-offset: 1px; }
button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; }
input, textarea, select { font: inherit; color: var(--text-primary);
  background: var(--surface-nucleus); border: var(--border-hairline) solid var(--line-structure);
  border-radius: var(--radius-control); padding: 6px 8px; }
textarea { width: 100%; resize: vertical; }
a { color: var(--signal-cognition); }
.mono { font-family: var(--font-mono); font-size: var(--size-caption); }
.muted { color: var(--text-secondary); }
.faint { color: var(--text-muted); }

.app { height: 100vh; display: grid;
  grid-template-rows: var(--titlebar-height) 1fr var(--vitalbar-height);
  grid-template-columns: var(--rail-width) var(--sidebar-width) 1fr auto;
  grid-template-areas:
    "titlebar titlebar titlebar titlebar"
    "rail sidebar canvas drawer"
    "vitalbar vitalbar vitalbar vitalbar"; }

.titlebar { grid-area: titlebar; display: flex; align-items: center; gap: var(--space-md);
  padding: 0 var(--space-lg); background: var(--surface-chrome);
  border-bottom: var(--border-hairline) solid var(--line-structure); min-width: 0; }
.titlebar .brand { display: flex; align-items: baseline; gap: var(--space-sm);
  font-weight: 720; white-space: nowrap; }
.titlebar .brand small { font-weight: 400; color: var(--text-secondary); font-size: var(--size-caption); }
.tb-chips { display: flex; gap: var(--space-sm); flex: 1; min-width: 0; overflow: hidden; }
.tb-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px;
  border: var(--border-hairline) solid var(--line-structure); border-radius: var(--radius-round);
  color: var(--text-secondary); white-space: nowrap; max-width: 220px; overflow: hidden;
  text-overflow: ellipsis; font-size: var(--size-caption); }
.tb-chip svg { flex: none; }
.tb-chip .k { color: var(--text-muted); }
.tb-actions { display: flex; gap: var(--space-xs); margin-inline-start: auto; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: var(--radius-control); color: var(--text-secondary); }
.icon-btn:hover { background: var(--surface-hover); color: var(--text-primary); }

.rail { grid-area: rail; display: flex; flex-direction: column; gap: 2px; padding: var(--space-sm) 0;
  background: var(--surface-chrome); border-right: var(--border-hairline) solid var(--line-structure);
  overflow-y: auto; }
.rail .rail-label { font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); text-align: center; padding: var(--space-sm) 0 var(--space-xs); }
.rail button { display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 7px 2px; color: var(--text-secondary); border-radius: var(--radius-control);
  margin: 0 6px; position: relative; }
.rail button span { font-size: 9px; line-height: 1.2; }
.rail button:hover { background: var(--surface-hover); color: var(--text-primary); }
.rail button[aria-current="page"] { color: var(--signal-cognition); background: var(--surface-hover); }
.rail button[aria-current="page"]::before { content: ""; position: absolute; left: -6px; top: 6px;
  bottom: 6px; width: 3px; border-radius: 2px; background: var(--signal-cognition); }
.rail .badge { position: absolute; top: 2px; right: 8px; min-width: 14px; height: 14px;
  border-radius: 7px; background: var(--signal-approval); color: #14100a; font-size: 9px;
  font-weight: 720; display: flex; align-items: center; justify-content: center; padding: 0 3px; }

.sidebar { grid-area sidebar; background: var(--surface-nucleus);
  border-right: var(--border-hairline) solid var(--line-structure); overflow-y: auto;
  padding: var(--space-lg); transition: width var(--motion-pane); }
.sb-title { font-size: var(--size-caption); text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--text-muted); margin: 0 0 var(--space-sm); }
.sb-section { margin-bottom: var(--space-xl); }
.sb-item { display: flex; gap: var(--space-sm); padding: 6px 8px; border-radius: var(--radius-control);
  color: var(--text-secondary); cursor: default; align-items: flex-start; }
.sb-item:hover { background: var(--surface-hover); }
.sb-item svg { flex: none; margin-top: 2px; }

.canvas { grid-area canvas; overflow-y: auto; background: var(--surface-canvas); padding: var(--space-xl);
  min-width: 0; }
.page-head { margin-bottom: var(--space-xl); }
.page-head h1 { font-size: var(--size-title); font-weight: 650; margin: 0 0 4px; }
.page-head p { margin: 0; color: var(--text-secondary); max-width: 72ch; }
.cards { display: grid; gap: var(--space-lg); grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
.card { background: var(--surface-raised); border: var(--border-hairline) solid var(--line-structure);
  border-radius: var(--radius-pane); padding: var(--space-lg); min-width: 0; position: relative; }
.card h2 { font-size: var(--size-compact); font-weight: 650; margin: 0 0 var(--space-md);
  display: flex; align-items: center; gap: var(--space-sm); color: var(--text-primary); }
.card .hint { color: var(--text-muted); font-size: var(--size-caption); margin: var(--space-sm) 0 0; }
.card.spine { border-left: 3px solid var(--line-spine); }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--space-lg); font-size: var(--size-caption); }
.kv dt { color: var(--text-muted); }
.kv dd { margin: 0; word-break: break-all; }

.chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px;
  font-size: var(--size-caption); border: var(--border-hairline) solid var(--line-structure);
  color: var(--text-secondary); white-space: nowrap; }
.chip svg { flex: none; }
.chip.cognition { color: var(--signal-cognition); border-color: var(--signal-cognition); }
.chip.knowledge { color: var(--signal-knowledge); border-color: var(--signal-knowledge); }
.chip.verified { color: var(--signal-verified); border-color: var(--signal-verified); }
.chip.approval { color: var(--signal-approval); border-color: var(--signal-approval); }
.chip.incident { color: var(--signal-incident); border-color: var(--signal-incident); }
.chip.offline { color: var(--signal-offline); }

.btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px;
  border-radius: var(--radius-control); border: var(--border-hairline) solid var(--line-spine);
  color: var(--text-primary); background: var(--surface-raised); min-height: 32px; }
.btn:hover { background: var(--surface-hover); }
.btn.primary { background: var(--signal-cognition); border-color: var(--signal-cognition);
  color: #04121d; font-weight: 650; }
.btn.primary:hover { filter: brightness(1.08); }
.btn.danger { color: var(--signal-incident); border-color: var(--signal-incident); }
.btn.danger:hover { background: color-mix(in srgb, var(--signal-incident) 12%, transparent); }
.btn.ghost { border-color: transparent; color: var(--text-secondary); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }

.approval { border: var(--border-hairline) solid var(--signal-approval);
  background: color-mix(in srgb, var(--signal-approval) 7%, var(--surface-raised));
  border-radius: var(--radius-pane); padding: var(--space-lg); }
.approval.expired { border-color: var(--line-structure); opacity: 0.75; }
.approval h2 { color: var(--signal-approval); }
.ap-tier { margin: 0 0 var(--space-sm); }
.ap-tier .n { color: var(--text-muted); font-size: var(--size-caption); }
.ap-actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-lg); }
.ap-ttl { display: inline-flex; gap: 4px; align-items: center; color: var(--text-secondary);
  font-size: var(--size-caption); }

.timeline { list-style: none; margin: 0; padding: 0; }
.timeline li { position: relative; padding: var(--space-sm) 0 var(--space-sm) var(--space-xl);
  border-left: var(--border-continuity, 1px) solid var(--line-spine); margin-left: 8px; }
.timeline li::before { content: ""; position: absolute; left: -5px; top: 14px; width: 8px; height: 8px;
  border-radius: 50%; background: var(--surface-canvas); border: 2px solid var(--line-spine); }
.timeline li.hit::before { border-color: var(--signal-cognition); animation: pulse var(--motion-pulse) ease-out; }
@keyframes pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--signal-cognition) 60%, transparent); }
  to { box-shadow: 0 0 0 8px transparent; } }
.tl-row { display: flex; gap: var(--space-sm); align-items: baseline; flex-wrap: wrap; }
.tl-when { color: var(--text-muted); font-size: var(--size-caption); white-space: nowrap; }

pre.out { font-family: var(--font-mono); font-size: var(--size-caption); background: var(--surface-nucleus);
  border: var(--border-hairline) solid var(--line-structure); border-radius: var(--radius-control);
  padding: var(--space-md); overflow-x: auto; white-space: pre-wrap; word-break: break-all; margin: var(--space-sm) 0; }

.err { border: var(--border-hairline) solid var(--signal-incident); border-radius: var(--radius-pane);
  background: color-mix(in srgb, var(--signal-incident) 6%, var(--surface-raised)); padding: var(--space-lg); }
.err h2 { color: var(--signal-incident); margin: 0 0 var(--space-sm); font-size: var(--size-compact); }
.err dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px var(--space-lg); }
.err dt { color: var(--signal-incident); font-size: var(--size-caption); }
.err dd { margin: 0; }

.ladder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ladder li { display: flex; align-items: center; gap: var(--space-sm); padding: 6px 10px;
  border-radius: var(--radius-control); border: var(--border-hairline) solid var(--line-structure); }
.ladder li.locked { color: var(--text-muted); }
.ladder li.hit { border-color: var(--signal-verified); color: var(--signal-verified); }

.drawer { grid-area drawer; width: var(--drawer-width); background: var(--surface-nucleus);
  border-left: var(--border-hairline) solid var(--line-structure); overflow-y: auto;
  padding: var(--space-lg); }
.drawer .close { float: right; }
.drawer h2 { font-size: var(--size-compact); margin: 0 0 var(--space-md); }

.vitalbar { grid-area vitalbar; display: flex; align-items: center; gap: var(--space-lg);
  padding: 0 var(--space-lg); background: var(--surface-chrome);
  border-top: var(--border-hairline) solid var(--line-structure); overflow-x: auto; }
.vital { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary);
  font-size: var(--size-caption); white-space: nowrap; }
.vital svg { color: var(--text-muted); }
.vital.ok svg { color: var(--signal-verified); }
.vital.warn svg { color: var(--signal-approval); }
.vital.bad svg { color: var(--signal-incident); }
.vital b { color: var(--text-primary); font-weight: 560; }

.overlay { position: fixed; inset: 0; background: rgba(3, 7, 11, 0.55); z-index: 50;
  display: flex; align-items: flex-start; justify-content: center; padding-top: 12vh; }
.palette { width: min(560px, 92vw); background: var(--surface-raised);
  border: var(--border-hairline) solid var(--line-spine); border-radius: var(--radius-dialog);
  box-shadow: var(--elevation-dialog); overflow: hidden; }
.palette input { width: 100%; border: 0; border-bottom: var(--border-hairline) solid var(--line-structure);
  border-radius: 0; padding: 12px 16px; background: transparent; }
.palette ul { list-style: none; margin: 0; padding: 4px; max-height: 46vh; overflow-y: auto; }
.palette li { padding: 8px 12px; border-radius: var(--radius-control); display: flex; gap: var(--space-sm);
  align-items: center; color: var(--text-secondary); }
.palette li[aria-selected="true"] { background: var(--surface-hover); color: var(--text-primary); }
.palette li .k { margin-inline-start: auto; font-size: var(--size-caption); color: var(--text-muted); }

form.stack { display: flex; flex-direction: column; gap: var(--space-md); }
.field label { display: block; font-size: var(--size-caption); color: var(--text-secondary);
  margin-bottom: 4px; }
.rows { list-style: none; margin: 0; padding: 0; }
.rows li { display: flex; align-items: center; gap: var(--space-sm); min-height: var(--row-height);
  border-bottom: var(--border-hairline) solid var(--line-structure); padding: var(--space-xs) 0; }
.rows li:last-child { border-bottom: 0; }
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.filters { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
.filters button { padding: 3px 10px; border-radius: 999px; border: var(--border-hairline) solid var(--line-structure);
  color: var(--text-secondary); font-size: var(--size-caption); }
.filters button[aria-pressed="true"] { color: var(--signal-cognition); border-color: var(--signal-cognition); }
.note { border-left: 3px solid var(--line-spine); padding: var(--space-sm) var(--space-md);
  color: var(--text-secondary); background: var(--surface-nucleus); border-radius: 0 var(--radius-control) var(--radius-control) 0; }
.phil { font-size: var(--size-caption); color: var(--signal-knowledge); margin-top: var(--space-sm); }

@media (max-width: 1279px) {
  .app { grid-template-columns: var(--rail-width) var(--sidebar-width) 1fr 0; }
  .drawer { position: fixed; top: var(--titlebar-height); right: 0; bottom: var(--vitalbar-height);
    z-index: 40; box-shadow: var(--elevation-popover); }
}
@media (max-width: 899px) {
  .app { grid-template-columns: var(--rail-width) 1fr 0 0; }
  .sidebar { position: fixed; top: var(--titlebar-height); bottom: var(--vitalbar-height); left: var(--rail-width);
    z-index: 40; width: min(300px, 78vw); box-shadow: var(--elevation-popover); }
  .app[data-sidebar="closed"] .sidebar { display: none; }
  .tb-chips .tb-chip.optional { display: none; }
}
@media (max-width: 599px) {
  .app { grid-template-rows: var(--titlebar-height) 1fr auto var(--vitalbar-height);
    grid-template-areas: "titlebar titlebar" "canvas canvas" "rail rail" "vitalbar vitalbar"; }
  .rail { flex-direction: row; justify-content: space-around; border-right: 0;
    border-top: var(--border-hairline) solid var(--line-structure); padding: 2px; }
  .rail .rail-label, .rail button span { display: none; }
  .rail button { margin: 0; padding: 10px 14px; }
  .sidebar { left: 0; width: 100vw; }
  .canvas { padding: var(--space-md); }
  .cards { grid-template-columns: 1fr; }
  .tb-chips { display: none; }
}
`;

const STUDIO_JS = `
(function () {
  "use strict";
  var I18N = __I18N__;
  var BOOT = __BOOT__;
  var LS = "saber-studio-v1";
  var TTL_MS = 5 * 60 * 1000;

  var S = load();
  var RUNS = [];
  var ONLINE = null;
  var RUNNING = false;
  var PALETTE = { open: false, query: "", index: 0 };
  var live = document.getElementById("live");

  function defaults() {
    return {
      lang: (navigator.language || "en").indexOf("zh") === 0 ? "zh" : "en",
      theme: "dark", density: "compact", philosophy: false,
      page: "today", sidebar: window.innerWidth > 899, drawer: null,
      safeMode: false, draft: "", allow: "", tlFilter: "all",
      goal: { objective: "", acceptance: [], constraints: "", budget: "" },
      plan: [], memories: [], decisions: {}, reviews: {}
    };
  }
  function load() {
    var base = defaults();
    try {
      var raw = window.localStorage.getItem(LS);
      if (raw) { var saved = JSON.parse(raw); for (var k in base) {
        if (Object.prototype.hasOwnProperty.call(saved, k)) base[k] = saved[k]; } }
    } catch (e) { /* corrupted local drafts start fresh */ }
    return base;
  }
  function save() {
    try { window.localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* storage full: keep running */ }
  }

  function t(key) {
    var entry = I18N[key];
    if (!entry) return key;
    var value = entry[S.lang] || entry.en;
    return value || key;
  }
  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function icon(name, cls) {
    var paths = {
      compass: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2.2 5.2L7 16l2.2-5.2z"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/>',
      diff: '<path d="M7 3v14M7 21v-4M17 3v6M17 13v8M4 10h6M14 17h6"/>',
      pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
      book: '<path d="M5 4h6v16H5zM13 4h6v16h-6zM5 8h6M13 8h6"/>',
      shield: '<path d="M12 3l8 3v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6z"/>',
      seed: '<path d="M12 21V9M12 9c0-4 3-6 7-6 0 4-3 6-7 6zM12 13c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/>',
      heart: '<path d="M12 20s-7-4.3-9-8.5C1.6 8 3.7 5 6.8 5c2 0 3.6 1.2 5.2 3.4C13.6 6.2 15.2 5 17.2 5c3.1 0 5.2 3 3.8 6.5-2 4.2-9 8.5-9 8.5z"/>',
      gavel: '<path d="M4 20h10M8 5l6 6M5 8l6-6M14 10l5 5M11 13l-5 5"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M19.5 4.5l-1.4 1.4M5.9 18.1l-1.4 1.4"/>',
      moon: '<path d="M20 14A8.5 8.5 0 0 1 9.5 3.6 8.5 8.5 0 1 0 20 14z"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
      x: '<path d="M6 6l12 12M18 6L6 18"/>',
      check: '<path d="M4 12l5 5L20 6"/>',
      alert: '<path d="M12 3 2.5 20h19zM12 10v4M12 17.5v.5"/>',
      clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
      lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
      term: '<path d="M4 5h16v14H4zM7.5 9.5l3 2.5-3 2.5M12.5 15h4"/>',
      box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12 4 7.5M12 12v9"/>',
      copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
      down: '<path d="M12 4v12M6 12l6 6 6-6M5 21h14"/>',
      search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
      bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
      chevron: '<path d="m9 6 6 6-6 6"/>'
    };
    return '<svg class="' + (cls || "") + '" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[name] || "") + "</svg>";
  }

  var STATE_ICON = { waiting_user: "clock", policy_denied: "lock", contained: "shield",
    completed: "check", stale: "clock", offline: "x", streaming: "bolt", empty: "box" };
  function chip(stateKey, extra) {
    var cls = { waiting_user: "approval", policy_denied: "incident", contained: "incident",
      completed: "verified", verified: "verified", stale: "offline", offline: "offline",
      streaming: "cognition", cognition: "cognition", knowledge: "knowledge",
      incident: "incident", approval: "approval" }[stateKey] || "";
    return '<span class="chip ' + cls + " " + (extra || "") + '">' +
      icon(STATE_ICON[stateKey] || "box") + esc(t("state." + stateKey)) + "</span>";
  }

  function rtf() { return new Intl.RelativeTimeFormat(S.lang === "zh" ? "zh" : "en", { numeric: "auto" }); }
  function when(iso) {
    var ms = Date.now() - new Date(iso).getTime();
    var r = rtf();
    var label;
    if (ms < 60e3) label = r.format(-Math.round(ms / 1e3), "second");
    else if (ms < 3600e3) label = r.format(-Math.round(ms / 60e3), "minute");
    else label = r.format(-Math.round(ms / 3600e3), "hour");
    return '<time class="tl-when" datetime="' + esc(iso) + '" title="' +
      esc(new Date(iso).toLocaleString(S.lang === "zh" ? "zh" : "en")) + '">' + esc(label) + "</time>";
  }
  function dur(ms) { return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s"; }
  function progName(path) {
    var parts = String(path).split("/");
    var name = parts[parts.length - 1];
    return name.length > 0 ? name : path;
  }

  function announce(key) { if (live) live.textContent = t(key); }

  function api(path, options) {
    var init = { method: (options && options.method) || "GET" };
    if (options && options.body) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(options.body);
    }
    return fetch(path, init).then(function (response) {
      ONLINE = true;
      return response.json();
    }).catch(function (error) {
      ONLINE = false;
      throw error;
    });
  }
  function refreshHistory() {
    return api("/api/history").then(function (data) {
      if (data && data.runs) RUNS = data.runs;
    });
  }

  function pendingApprovals() {
    var out = [];
    for (var i = 0; i < RUNS.length; i++) {
      var run = RUNS[i];
      if (run.verdict !== "denied" || run.exitCode !== 2) continue;
      if (S.decisions[run.runId]) continue;
      out.push(run);
    }
    return out;
  }
  function approvalExpired(run) {
    return Date.now() - new Date(run.at).getTime() > TTL_MS;
  }
  function stats() {
    var executed = 0, denied = 0;
    for (var i = 0; i < RUNS.length; i++) {
      if (RUNS[i].verdict === "executed") executed++;
      if (RUNS[i].verdict === "denied") denied++;
    }
    return { total: RUNS.length, executed: executed, denied: denied };
  }
  function health() {
    if (ONLINE === false) return "offline";
    if (S.safeMode) return "contained";
    if (pendingApprovals().length > 0) return "watching";
    return "healthy";
  }

  // ---------- components ----------

  function errCard(prefix) {
    return '<section class="err"><h2>' + icon("alert") + " " + esc(t(prefix + ".what")) + "</h2><dl>" +
      "<dt>" + esc(t("err.impact")) + "</dt><dd>" + esc(t(prefix + ".impact")) + "</dd>" +
      "<dt>" + esc(t("err.done")) + "</dt><dd>" + esc(t(prefix + ".done")) + "</dd>" +
      "<dt>" + esc(t("err.next")) + "</dt><dd>" + esc(t(prefix + ".next")) + "</dd></dl></section>";
  }

  function verdictChip(run) {
    if (run.verdict === "executed") return chip("completed");
    if (run.verdict === "denied") return chip("policy_denied");
    if (run.exitCode === null || run.exitCode === undefined) return chip("offline");
    return chip("stale");
  }

  function receiptFields(run) {
    var dl = '<dl class="kv">' +
      "<dt>" + esc(t("receipt.runId")) + "</dt><dd class='mono'>" + esc(run.runId || "—") + "</dd>" +
      "<dt>" + esc(t("receipt.verdict")) + "</dt><dd>" + verdictChip(run) + "</dd>" +
      "<dt>" + esc(t("receipt.exit")) + "</dt><dd class='mono'>" + esc(run.exitCode === null ? "—" : String(run.exitCode)) + "</dd>" +
      "<dt>" + esc(t("receipt.events")) + "</dt><dd class='mono'>" + esc(run.events === null || run.events === undefined ? "—" : String(run.events)) + "</dd>" +
      "<dt>" + esc(t("receipt.hash")) + "</dt><dd>" + (run.hashChainVerified ? chip("verified") : chip("stale")) + "</dd>" +
      "<dt>" + esc(t("receipt.duration")) + "</dt><dd class='mono'>" + esc(run.durationMs === null || run.durationMs === undefined ? "—" : dur(run.durationMs)) + "</dd>" +
      "<dt>" + esc(t("receipt.store")) + "</dt><dd class='mono'>" + esc(run.store || BOOT.store) + "</dd></dl>";
    return dl;
  }

  function approvalCard(run) {
    var decided = S.decisions[run.runId];
    var expired = !decided && approvalExpired(run);
    var remaining = Math.max(0, TTL_MS - (Date.now() - new Date(run.at).getTime()));
    var head = '<section class="approval' + (expired ? " expired" : "") + '" data-run="' + esc(run.runId) + '">' +
      "<h2>" + icon("clock") + " " + esc(t("approval.title")) + "</h2>" +
      '<p class="ap-tier"><b>' + esc(t("approval.verb")) + "</b><br>" + esc(t("approval.risk")) + "</p>" +
      '<p class="ap-tier"><span class="n">' + esc(t("approval.resources")) + ":</span><br><span class='mono'>" +
      esc(run.argv.join(" ")) + "</span></p>" +
      '<p class="ap-tier"><span class="n">' + esc(t("approval.why")) + ":</span><br>" +
      (S.goal.objective ? esc(S.goal.objective) : esc(t("approval.why.none"))) + "</p>" +
      '<p class="ap-tier"><span class="n">' + esc(t("approval.boundaries")) + ":</span><br>" +
      esc(t("approval.sandbox")) + " · " + esc(t("approval.egress")) + " · " + esc(t("approval.audit")) +
      "<br>" + esc(t("approval.reversibility")) + "</p>";
    if (decided) {
      return head + '<p class="ap-ttl">' + icon("check") + " " +
        (decided.action === "allowed" ? esc(t("approval.decided.allow")) : esc(t("approval.decided.deny"))) +
        " · " + when(decided.at) + "</p></section>";
    }
    if (expired) {
      return head + '<p class="ap-ttl">' + icon("clock") + " " + esc(t("approval.expired")) + "</p></section>";
    }
    return head +
      '<p class="ap-ttl">' + icon("clock") + " " + esc(t("approval.scope")) + ' <span class="mono" data-ttl="' +
      esc(run.runId) + '">' + Math.ceil(remaining / 1000) + "s</span></p>" +
      '<div class="ap-actions">' +
      '<button class="btn danger" data-action="ap-deny" data-run="' + esc(run.runId) + '">' + esc(t("approval.deny")) + "</button>" +
      '<button class="btn primary" data-action="ap-allow" data-run="' + esc(run.runId) + '">' + esc(t("approval.allowOnce")) + "</button>" +
      '<button class="btn" data-action="ap-narrow" data-run="' + esc(run.runId) + '">' + esc(t("approval.narrow")) + "</button>" +
      "</div>" +
      '<form class="stack" id="narrow-' + esc(run.runId) + '" hidden data-run="' + esc(run.runId) + '">' +
      '<label>' + esc(t("approval.narrow.ph")) +
      '<input name="allow" value="' + esc(progName(run.argv[0] || "")) + '"></label>' +
      '<button class="btn" type="submit">' + esc(t("approval.narrow.run")) + "</button></form>" +
      "</section>";
  }

  function nutritionLabel() {
    var chars = S.draft.length;
    var excluded = 0, freshness = 0;
    for (var i = 0; i < S.memories.length; i++) {
      var m = S.memories[i];
      if (m.state === "accepted" && !m.attached) excluded++;
      if (m.state === "accepted" && m.attached && Date.now() - new Date(m.at).getTime() > 30 * 24 * 3600e3) freshness++;
    }
    return '<details class="card"><summary>' + icon("book") + " " + esc(t("conv.nutrition")) + "</summary>" +
      '<dl class="kv" style="margin-top:12px">' +
      "<dt>" + esc(t("conv.nutrition.chars")) + "</dt><dd class='mono'>" + chars + "</dd>" +
      "<dt>" + esc(t("conv.nutrition.dest")) + "</dt><dd>" + esc(t("conv.nutrition.dest.value")) + "</dd>" +
      "<dt>" + esc(t("conv.nutrition.sensitivity")) + "</dt><dd>" + esc(t("common.localOnly")) + "</dd>" +
      "<dt>" + esc(t("conv.nutrition.redacted")) + "</dt><dd class='mono'>0</dd>" +
      "<dt>" + esc(t("conv.nutrition.excluded")) + "</dt><dd class='mono'>" + excluded + "</dd>" +
      "<dt>" + esc(t("conv.nutrition.freshness")) + "</dt><dd class='mono'>" + freshness + "</dd></dl></details>";
  }

  function philosophy(key) {
    return S.philosophy ? '<p class="phil">' + icon("seed") + " " + esc(t(key)) + "</p>" : "";
  }

  // ---------- pages ----------

  var PAGES = ["today", "goal", "conversation", "changes", "runtime", "memory", "armor", "evolution", "health", "governance"];
  var WORKSPACES = ["goal", "conversation", "changes", "runtime", "memory"];

  function pageToday() {
    var st = stats();
    var last = RUNS[0];
    var pending = pendingApprovals();
    var continueCard = '<section class="card spine"><h2>' + icon("compass") + " " + esc(t("today.continue")) + "</h2>";
    if (last) {
      continueCard += receiptFields(last) +
        '<div class="ap-actions"><button class="btn" data-action="nav" data-page="conversation">' +
        esc(t("today.continue")) + " · " + esc(t("nav.conversation")) + "</button>" +
        '<button class="btn" data-action="receipt" data-run="' + esc(last.runId) + '">' +
        esc(t("receipt.open")) + "</button></div>";
    } else {
      continueCard += '<p class="muted">' + esc(t("today.continue.none")) + "</p>";
    }
    continueCard += philosophy("gov.phil.spine") + "</section>";

    var inbox = '<section class="card"><h2>' + icon("clock") + " " + esc(t("today.inbox")) + "</h2>";
    if (pending.length === 0) inbox += '<p class="muted">' + esc(t("today.inbox.none")) + "</p>";
    else for (var i = 0; i < pending.length; i++) inbox += approvalCard(pending[i]);
    inbox += "</section>";

    var active = '<section class="card"><h2>' + icon("pulse") + " " + esc(t("today.active")) + "</h2>";
    if (RUNNING) active += chip("streaming") + '<p class="hint mono">' + esc(t("conv.running")) + "</p>";
    else if (st.total === 0) active += '<p class="muted">' + esc(t("today.active.none")) + "</p>";
    else active += '<ul class="rows">' + RUNS.slice(0, 5).map(function (run) {
      return "<li>" + verdictChip(run) + '<span class="grow mono">' + esc(run.argv.join(" ")) + "</span>" +
        when(run.at) + "</li>";
    }).join("") + "</ul>";
    active += "</section>";

    var brief = '<section class="card"><h2>' + icon("book") + " " + esc(t("today.brief")) + "</h2>" +
      '<dl class="kv">' +
      "<dt>" + esc(t("today.brief.runs")) + "</dt><dd class='mono'>" + st.total + "</dd>" +
      "<dt>" + esc(t("today.brief.executed")) + "</dt><dd class='mono'>" + st.executed + "</dd>" +
      "<dt>" + esc(t("today.brief.denied")) + "</dt><dd class='mono'>" + st.denied + "</dd>" +
      "<dt>" + esc(t("today.brief.device")) + "</dt><dd>" + esc(BOOT.platform) + " · node " + esc(BOOT.node) + "</dd></dl>";
    var recovery = null;
    for (var r = 0; r < RUNS.length; r++) if (RUNS[r].hashChainVerified) { recovery = RUNS[r]; break; }
    brief += '<p class="hint">' + esc(t("today.brief.recovery")) + ": " +
      (recovery ? "<span class='mono'>" + esc(recovery.runId) + "</span> · " + when(recovery.at)
        : esc(t("common.never"))) + "</p>";
    brief += '<p class="hint">' + esc(t("common.sessionOnly")) + "</p></section>";

    return '<div class="page-head"><h1>' + esc(t("today.title")) + "</h1><p>" + esc(t("today.question")) +
      "</p></div>" + (ONLINE === false ? errCard("err.offline") : "") +
      '<div class="cards">' + continueCard + active + inbox + brief + "</div>";
  }

  function pageGoal() {
    var g = S.goal;
    var acceptance = g.acceptance.map(function (item, index) {
      return '<li><button class="icon-btn" data-action="ga-del" data-index="' + index + '" aria-label="' +
        esc(t("common.close")) + '">' + icon("x") + "</button><span class='grow'>" + esc(item) + "</span></li>";
    }).join("");
    var plan = S.plan.map(function (task, index) {
      var done = task.state === "done";
      return "<li>" +
        '<button class="icon-btn" data-action="plan-toggle" data-index="' + index + '" aria-pressed="' + done + '">' +
        icon(done ? "check" : "clock") + "</button>" +
        '<span class="grow' + (done ? " faint" : "") + '">' + esc(task.title) + "</span>" +
        '<button class="icon-btn" data-action="plan-del" data-index="' + index + '" aria-label="' +
        esc(t("common.close")) + '">' + icon("x") + "</button></li>";
    }).join("");
    return '<div class="page-head"><h1>' + esc(t("goal.title")) + '</h1><p>' + esc(t("goal.note")) + "</p></div>" +
      '<div class="cards"><section class="card"><h2>' + icon("target") + " " + esc(t("app.title")) + " · " + esc(t("goal.title")) + "</h2>" +
      '<form class="stack" id="goal-form">' +
      '<div class="field"><label for="g-objective">' + esc(t("goal.objective")) + "</label>" +
      '<input id="g-objective" name="objective" value="' + esc(g.objective) + '" placeholder="' + esc(t("goal.objective.ph")) + '"></div>' +
      '<div class="field"><label for="g-accept">' + esc(t("goal.acceptance")) + "</label>" +
      '<input id="g-accept" name="acceptance" placeholder="' + esc(t("goal.acceptance.ph")) + '"></div>' +
      '<ul class="rows">' + acceptance + "</ul>" +
      '<div class="field"><label for="g-constraints">' + esc(t("goal.constraints")) + "</label>" +
      '<input id="g-constraints" name="constraints" value="' + esc(g.constraints) + '" placeholder="' + esc(t("goal.constraints.ph")) + '"></div>' +
      '<div class="field"><label for="g-budget">' + esc(t("goal.budget")) + "</label>" +
      '<input id="g-budget" name="budget" value="' + esc(g.budget) + '"></div>' +
      '<button class="btn primary" type="submit">' + esc(t("goal.save")) + "</button></form>" +
      '<button class="btn" data-action="goal-start" style="margin-top:12px">' + esc(t("goal.start")) + "</button>" +
      "</section>" +
      '<section class="card"><h2>' + icon("diff") + " " + esc(t("goal.plan")) + "</h2>" +
      '<form class="stack" id="plan-form"><div class="field"><label for="plan-input">' + esc(t("goal.plan.add")) + "</label>" +
      '<input id="plan-input" name="title" placeholder="' + esc(t("goal.plan.ph")) + '"></div>' +
      '<button class="btn" type="submit">' + esc(t("goal.plan.add")) + "</button></form>" +
      '<ul class="rows">' + (plan || '<li class="muted">' + esc(t("goal.plan.empty")) + "</li>") + "</ul>" +
      '<h2 style="margin-top:20px">' + icon("clock") + " " + esc(t("goal.plan.timeline")) + "</h2>" +
      '<p class="hint">' + esc(t("goal.plan.timeline.note")) + "</p></section></div>";
  }

  function pageConversation() {
    var messages = "";
    for (var i = RUNS.length - 1; i >= 0; i--) {
      var run = RUNS[i];
      messages += '<section class="card spine"><h2>' + icon("term") + " " + esc(t("conv.msg.user")) + " · " +
        when(run.at) + "</h2>" +
        '<p class="mono">' + esc(run.argv.join(" ")) + "</p>" +
        "<p>" + verdictChip(run) + (run.denyReason ? ' <span class="mono faint">' + esc(run.denyReason) + "</span>" : "") + "</p>";
      if (run.stdout) messages += '<pre class="out">' + esc(run.stdout) + "</pre>";
      messages += '<button class="btn ghost" data-action="receipt" data-run="' + esc(run.runId) + '">' +
        esc(t("receipt.open")) + "</button></section>";
      if (run.verdict === "denied" && run.exitCode === 2) messages += approvalCard(run);
      else if (run.exitCode === null) messages += errCard("err.spawn");
    }
    var approveChecked = !S.safeMode ? " checked" : "";
    var approveDisabled = S.safeMode ? " disabled" : "";
    return '<div class="page-head"><h1>' + esc(t("conv.title")) + '</h1><p>' + esc(t("conv.note")) + "</p></div>" +
      (ONLINE === false ? errCard("err.offline") : "") +
      (RUNS.length === 0 && ONLINE !== false ? '<p class="note">' + esc(t("conv.empty")) + "</p>" : "") +
      '<div class="cards">' + messages +
      '<section class="card"><h2>' + icon("bolt") + " " + esc(t("conv.run")) + "</h2>" +
      '<form class="stack" id="run-form">' +
      '<div class="field"><label for="cmd">' + esc(t("conv.command")) + "</label>" +
      '<textarea id="cmd" name="command" rows="2">' + esc(S.draft) + "</textarea></div>" +
      '<div class="field"><label for="allow">' + esc(t("conv.allow")) + "</label>" +
      '<input id="allow" name="allow" value="' + esc(S.allow) + '"></div>' +
      '<label style="display:flex;gap:8px;align-items:center">' +
      '<input type="checkbox" name="approve" style="width:auto"' + approveChecked + approveDisabled + "> " +
      esc(t("conv.approve")) + "</label>" +
      '<button class="btn primary" type="submit"' + (RUNNING ? " disabled" : "") + ">" +
      (RUNNING ? esc(t("conv.running")) : esc(t("conv.run"))) + "</button></form>" +
      nutritionLabel() + "</section></div>";
  }

  function pageChanges() {
    var executed = RUNS.filter(function (run) { return run.verdict === "executed"; });
    if (executed.length === 0) {
      return '<div class="page-head"><h1>' + esc(t("changes.title")) + '</h1><p>' + esc(t("changes.note")) +
        '</p></div><p class="note">' + esc(t("changes.empty")) + "</p>";
    }
    var cards = executed.map(function (run) {
      var review = S.reviews[run.runId];
      return '<section class="card"><h2>' + icon("diff") + " <span class='mono'>" + esc(run.runId) + "</span> · " +
        when(run.at) + "</h2>" +
        '<p class="mono">' + esc(run.argv.join(" ")) + "</p>" +
        "<h2>" + esc(t("changes.ladder")) + "</h2><ol class='ladder'>" +
        "<li>" + icon("target") + " " + esc(t("changes.ladder.intent")) + "</li>" +
        "<li>" + icon("lock") + " " + esc(t("changes.ladder.policy")) + " · " + chip("verified") + "</li>" +
        "<li>" + icon("term") + " " + esc(t("changes.ladder.effect")) + " · " + chip("completed") + "</li>" +
        "<li>" + icon("check") + " " + esc(t("changes.ladder.verification")) + " · " +
        (run.hashChainVerified ? chip("verified") : chip("stale")) + "</li></ol>" +
        '<div class="ap-actions">' +
        (review === "accepted" ? chip("verified") + " " + esc(t("changes.review.accepted"))
          : review === "rejected" ? chip("incident") + " " + esc(t("changes.review.rejected"))
          : chip("waiting_user") + " " + esc(t("changes.review.pending")) + " " +
            '<button class="btn primary" data-action="review" data-run="' + esc(run.runId) + '" data-value="accepted">' + esc(t("changes.review.accept")) + "</button>" +
            '<button class="btn danger" data-action="review" data-run="' + esc(run.runId) + '" data-value="rejected">' + esc(t("changes.review.reject")) + "</button>") +
        '<button class="btn ghost" data-action="receipt" data-run="' + esc(run.runId) + '">' + esc(t("receipt.open")) + "</button>" +
        "</div></section>";
    }).join("");
    return '<div class="page-head"><h1>' + esc(t("changes.title")) + '</h1><p>' + esc(t("changes.note")) +
      "</p></div>" + (ONLINE === false ? errCard("err.offline") : "") + '<div class="cards">' + cards + "</div>";
  }

  function pageRuntime() {
    var filters = ["all", "executed", "denied", "waiting"].map(function (key) {
      return '<button data-action="tl-filter" data-filter="' + key + '" aria-pressed="' +
        (S.tlFilter === key) + '">' + esc(t("runtime.filter." + key)) + "</button>";
    }).join("");
    var items = "";
    for (var i = 0; i < RUNS.length; i++) {
      var run = RUNS[i];
      var match = S.tlFilter === "all" ||
        (S.tlFilter === "executed" && run.verdict === "executed") ||
        (S.tlFilter === "denied" && run.verdict === "denied") ||
        (S.tlFilter === "waiting" && run.verdict === "denied" && run.exitCode === 2 && !S.decisions[run.runId] && !approvalExpired(run));
      if (!match) continue;
      items += "<li class='hit'><div class='tl-row'>" + when(run.at) + verdictChip(run) +
        '<span class="grow mono">' + esc(run.argv.join(" ")) + "</span>" +
        '<span class="mono faint">' + esc(run.runId) + "</span>" +
        '<button class="btn ghost" data-action="receipt" data-run="' + esc(run.runId) + '">' + esc(t("receipt.open")) + "</button></div></li>";
    }
    var decided = 0;
    for (var key in S.decisions) if (Object.prototype.hasOwnProperty.call(S.decisions, key)) decided++;
    var waiting = pendingApprovals().length > 0;
    return '<div class="page-head"><h1>' + esc(t("runtime.title")) + "</h1></div>" +
      (ONLINE === false ? errCard("err.offline") : "") +
      '<section class="card"><h2>' + icon("pulse") + " " + esc(t("runtime.timeline")) + "</h2>" +
      '<div class="filters">' + filters + "</div>" +
      (items ? '<ul class="timeline">' + items + "</ul>" : '<p class="muted">' + esc(t("runtime.empty")) + "</p>") +
      "</section>" +
      '<section class="card spine" style="margin-top:16px"><h2>' + icon("shield") + " " + esc(t("runtime.agentmap")) + "</h2>" +
      '<dl class="kv">' +
      "<dt>Agent</dt><dd>" + esc(t("runtime.agent.core")) + "</dd>" +
      "<dt>" + esc(t("titlebar.realm")) + "</dt><dd>" + esc(t("titlebar.realm.value")) + "</dd>" +
      "<dt>Capabilities</dt><dd class='mono'>policy · approval · sandbox · audit</dd>" +
      "<dt>" + esc(t("runtime.agent.waiting")) + "</dt><dd>" +
      (waiting ? chip("waiting_user") + " " + esc(t("runtime.agent.waiting.approval"))
        : esc(t("runtime.agent.waiting.none"))) + "</dd></dl>" +
      philosophy("gov.phil.cell") + "</section>";
  }

  function pageMemory() {
    var rows = S.memories.map(function (m) {
      var stateChip = m.state === "accepted" ? chip("verified")
        : m.state === "rejected" ? chip("policy_denied")
        : m.state === "revoked" ? chip("offline") : chip("knowledge");
      return "<li>" + stateChip + '<span class="grow"><b>' + esc(m.title) + "</b><br>" +
        '<span class="muted">' + esc(m.body) + "</span></span>" +
        (m.state === "accepted" ? '<button class="btn ghost" data-action="mem-attach" data-id="' + esc(m.id) + '">' +
          esc(m.attached ? t("memory.detach") : t("memory.attach")) + "</button>" : "") +
        (m.state === "candidate" ? '<button class="btn" data-action="mem-state" data-id="' + esc(m.id) + '" data-value="accepted">' + esc(t("memory.accept")) + "</button>" : "") +
        (m.state !== "revoked" ? '<button class="btn ghost" data-action="mem-state" data-id="' + esc(m.id) + '" data-value="rejected">' + esc(t("memory.reject")) + "</button>" : "") +
        (m.state === "accepted" ? '<button class="btn danger" data-action="mem-state" data-id="' + esc(m.id) + '" data-value="revoked">' + esc(t("memory.revoke")) + "</button>" : "") +
        "</li>";
    }).join("");
    var usage = S.memories.filter(function (m) { return m.attached && m.state === "accepted"; });
    return '<div class="page-head"><h1>' + esc(t("memory.title")) + '</h1><p>' + esc(t("memory.note")) + "</p></div>" +
      '<div class="cards"><section class="card"><h2>' + icon("book") + " " + esc(t("memory.ledger")) + "</h2>" +
      '<form class="stack" id="memory-form">' +
      '<div class="field"><label for="mem-title">' + esc(t("memory.titleField")) + "</label>" +
      '<input id="mem-title" name="title" required></div>' +
      '<div class="field"><label for="mem-body">' + esc(t("memory.bodyField")) + "</label>" +
      '<textarea id="mem-body" name="body" rows="2" required></textarea></div>' +
      '<button class="btn" type="submit">' + esc(t("memory.add")) + "</button></form>" +
      '<ul class="rows">' + (rows || '<li class="muted">' + esc(t("common.empty")) + "</li>") + "</ul></section>" +
      '<section class="card"><h2>' + icon("globe") + " " + esc(t("memory.usage")) + "</h2>" +
      (usage.length === 0 ? '<p class="muted">' + esc(t("memory.usage.none")) + "</p>"
        : '<ul class="rows">' + usage.map(function (m) {
          return "<li>" + chip("knowledge") + '<span class="grow">' + esc(m.title) + "</span>" + when(m.at) + "</li>";
        }).join("") + "</ul>") +
      '<p class="hint">' + esc(t("conv.nutrition.dest.value")) + "</p></section></div>";
  }

  function pageArmor() {
    var card = function (title, name, detail, extra) {
      return '<section class="card"><h2>' + icon("shield") + " " + esc(title) + "</h2>" +
        '<dl class="kv">' +
        "<dt>" + esc(t("armor.trust")) + "</dt><dd>" + esc(t("armor.trust.verified")) + "</dd>" +
        "<dt>" + esc(t("armor.dataBoundary")) + "</dt><dd>" + esc(t("armor.dataBoundary.loopback")) + "</dd>" +
        (extra || "") + "</dl>" +
        '<p class="hint mono">' + esc(detail) + "</p></section>";
    };
    return '<div class="page-head"><h1>' + esc(t("armor.title")) + '</h1><p>' + esc(t("armor.note")) + "</p></div>" +
      '<h2 class="sb-title">' + esc(t("armor.local")) + "</h2>" +
      '<div class="cards">' +
      card(t("armor.core"), "core", BOOT.core + " · saber " + BOOT.version,
        "<dt>Realm</dt><dd>local</dd>") +
      card(t("armor.sandbox"), "sandbox", BOOT.sandboxBackend,
        "<dt>Egress</dt><dd>" + esc(t("vital.network.deny")) + "</dd>") +
      card(t("armor.node"), "node", "node " + BOOT.node + " · " + BOOT.platform) +
      "</div>" +
      '<div class="cards" style="margin-top:16px">' +
      ["models", "mcp", "plugins"].map(function (kind) {
        return '<section class="card"><h2>' + icon("box") + " " + esc(t("armor." + kind)) + "</h2>" +
          '<p class="muted">' + esc(t("armor.empty")) + "</p></section>";
      }).join("") + "</div>" + philosophy("gov.phil.vital");
  }

  function pageEvolution() {
    var levels = ["E0", "E1", "E2", "E3", "E4", "E5", "E6", "E7"];
    var achieved = 1; // E1: personal memory is achievable and reviewed locally.
    var ladder = levels.map(function (level, index) {
      var hit = index <= achieved;
      var locked = level === "E6" || level === "E7";
      return '<li class="' + (hit ? "hit" : "") + (locked ? " locked" : "") + '">' +
        icon(hit ? "check" : "lock") + esc(t("evo.level." + level)) + "</li>";
    }).join("");
    var candidates = S.memories.map(function (m) {
      var state = m.state === "accepted" ? "verified" : m.state === "rejected" ? "incident" : "knowledge";
      var label = m.state === "accepted" ? "evo.state.promoted" : m.state === "rejected" ? "evo.state.rejected"
        : m.state === "revoked" ? "evo.state.revoked" : "evo.state.proposed";
      return "<li>" + (m.state === "accepted" ? chip("verified") : chip(state)) +
        '<span class="grow"><b>' + esc(m.title) + "</b><br>" + esc(t(label)) + " · " +
        esc(t("memory.provenance.user")) + " · " + when(m.at) + "</span></li>";
    }).join("");
    return '<div class="page-head"><h1>' + esc(t("evo.title")) + '</h1><p>' + esc(t("evo.note")) + "</p></div>" +
      '<div class="cards"><section class="card"><h2>' + icon("seed") + " " + esc(t("evo.ladder")) + "</h2>" +
      '<ol class="ladder">' + ladder + "</ol>" +
      '<p class="hint">' + esc(t("evo.level.current")) + ": E1</p></section>" +
      '<section class="card"><h2>' + icon("book") + " " + esc(t("evo.candidates")) + "</h2>" +
      '<ul class="rows">' + (candidates || '<li class="muted">' + esc(t("evo.empty")) + "</li>") + "</ul></section></div>";
  }

  function pageHealth() {
    var h = health();
    var vitalChip = h === "healthy" ? chip("verified") : h === "watching" ? chip("waiting_user")
      : h === "contained" ? chip("contained") : chip("offline");
    var label = h === "healthy" ? "titlebar.health.healthy" : h === "watching" ? "titlebar.health.watching"
      : h === "contained" ? "titlebar.health.contained" : "state.offline";
    var incidents = "";
    for (var i = 0; i < RUNS.length; i++) {
      var run = RUNS[i];
      if (run.verdict === "denied") {
        incidents += "<li class='hit'><div class='tl-row'>" + when(run.at) + chip("contained") +
          '<span class="grow">' + esc(t("health.incident.denied")) + "</span></div>" +
          '<p class="hint mono">' + esc(run.argv.join(" ")) + " · " + esc(run.runId) + "</p></li>";
      }
    }
    var expiredCards = 0;
    for (var j = 0; j < RUNS.length; j++) {
      var r2 = RUNS[j];
      if (r2.verdict === "denied" && !S.decisions[r2.runId] && approvalExpired(r2)) expiredCards++;
    }
    if (expiredCards > 0) {
      incidents += "<li><div class='tl-row'>" + chip("stale") + '<span class="grow">' +
        esc(t("health.incident.expired")) + " ×" + expiredCards + "</span></div></li>";
    }
    var st = stats();
    return '<div class="page-head"><h1>' + esc(t("health.title")) + "</h1></div>" +
      (ONLINE === false ? errCard("err.offline") : "") +
      '<div class="cards"><section class="card spine"><h2>' + icon("heart") + " " + esc(t("health.vital")) + "</h2>" +
      "<p>" + vitalChip + " " + esc(t(label)) + "</p>" + philosophy("gov.phil.cell") + "</section>" +
      '<section class="card"><h2>' + icon("alert") + " " + esc(t("health.incidents")) + "</h2>" +
      (incidents ? '<ul class="timeline">' + incidents + "</ul>" : '<p class="muted">' + esc(t("health.incidents.none")) + "</p>") +
      "<h2 style='margin-top:20px'>" + esc(t("health.auto")) + "</h2>" +
      (st.denied > 0 ? "<p>" + chip("contained") + " " + esc(t("gov.policy.defaultdeny")) + " — " + st.denied + "</p>"
        : '<p class="muted">' + esc(t("health.auto.none")) + "</p>") + "</section>" +
      '<section class="card"><h2>' + icon("shield") + " " + esc(t("health.recovery")) + "</h2>" +
      '<p class="hint">' + esc(t("health.safemode")) + "</p>" +
      '<div class="ap-actions">' +
      (S.safeMode
        ? '<button class="btn primary" data-action="safe-mode" data-value="off">' + esc(t("health.safemode.off")) + "</button>"
        : '<button class="btn danger" data-action="safe-mode" data-value="on">' + esc(t("health.safemode.on")) + "</button>") +
      '<button class="btn" data-action="export">' + icon("down") + " " + esc(t("health.export")) + "</button>" +
      "</div></section></div>";
  }

  function pageGovernance() {
    var log = "";
    var ids = Object.keys(S.decisions);
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var d = S.decisions[id];
      var run = null;
      for (var j = 0; j < RUNS.length; j++) if (RUNS[j].runId === id) run = RUNS[j];
      log += "<li>" + (d.action === "allowed" ? chip("approval") : chip("incident")) +
        '<span class="grow mono">' + (run ? esc(run.argv.join(" ")) : esc(id)) + "</span>" + when(d.at) + "</li>";
    }
    var reviews = Object.keys(S.reviews).map(function (id) {
      return "<li>" + (S.reviews[id] === "accepted" ? chip("verified") : chip("incident")) +
        '<span class="grow mono">' + esc(id) + "</span></li>";
    }).join("");
    return '<div class="page-head"><h1>' + esc(t("gov.title")) + "</h1></div>" +
      '<div class="cards"><section class="card"><h2>' + icon("lock") + " " + esc(t("gov.policy")) + "</h2><ul>" +
      ["defaultdeny", "oneshot", "sandbox", "audit"].map(function (key) {
        return "<li>" + chip("verified") + " " + esc(t("gov.policy." + key)) + "</li>";
      }).join("") + "</ul></section>" +
      '<section class="card"><h2>' + icon("clock") + " " + esc(t("gov.approvallog")) + "</h2>" +
      '<ul class="rows">' + (log || '<li class="muted">' + esc(t("gov.approvallog.empty")) + "</li>") + "</ul>" +
      (reviews ? '<h2 style="margin-top:16px">' + esc(t("changes.review.pending")) + "</h2><ul class='rows'>" + reviews + "</ul>" : "") +
      "</section>" +
      '<section class="card"><h2>' + icon("gavel") + " " + esc(t("gov.settings")) + "</h2>" +
      '<div class="field"><label>' + esc(t("gov.lang")) + "</label>" +
      '<div class="filters"><button data-action="lang" data-value="zh" aria-pressed="' + (S.lang === "zh") + '">中文</button>' +
      '<button data-action="lang" data-value="en" aria-pressed="' + (S.lang === "en") + '">English</button></div></div>' +
      '<div class="field"><label>' + esc(t("gov.theme")) + "</label>" +
      '<div class="filters"><button data-action="theme" data-value="dark" aria-pressed="' + (S.theme === "dark") + '">' + esc(t("gov.theme.dark")) + "</button>" +
      '<button data-action="theme" data-value="light" aria-pressed="' + (S.theme === "light") + '">' + esc(t("gov.theme.light")) + "</button></div></div>" +
      '<div class="field"><label>' + esc(t("gov.density")) + "</label>" +
      '<div class="filters"><button data-action="density" data-value="compact" aria-pressed="' + (S.density === "compact") + '">' + esc(t("gov.density.compact")) + "</button>" +
      '<button data-action="density" data-value="comfortable" aria-pressed="' + (S.density === "comfortable") + '">' + esc(t("gov.density.comfortable")) + "</button></div></div>" +
      '<div class="field"><label>' + esc(t("gov.philosophy")) + "</label>" +
      '<div class="filters"><button data-action="philosophy" aria-pressed="' + S.philosophy + '">' +
      (S.philosophy ? esc(t("state.completed")) : esc(t("state.initial"))) + "</button></div>" +
      '<p class="hint">' + esc(t("gov.philosophy.note")) + "</p></div>" +
      '<h2 style="margin-top:20px">' + esc(t("gov.keys")) + "</h2><p class='hint'>" + esc(t("gov.keys.note")) + "</p>" +
      '<h2 style="margin-top:20px">' + esc(t("gov.enterprise")) + "</h2><p class='hint'>" + esc(t("gov.enterprise.note")) + "</p>" +
      "</section></div>";
  }

  function supervisorNotice(page) {
    return '<div class="page-head"><h1>' + esc(t("nav." + page)) + "</h1></div>" +
      '<p class="note">' + esc(t("app.console")) + " · " + esc(t("common.localOnly")) + "</p>";
  }

  var RENDERERS = { today: pageToday, goal: pageGoal, conversation: pageConversation,
    changes: pageChanges, runtime: pageRuntime, memory: pageMemory, armor: pageArmor,
    evolution: pageEvolution, health: pageHealth, governance: pageGovernance };

  // ---------- shell ----------

  function renderTitlebar() {
    var h = health();
    var autonomy = S.safeMode ? t("titlebar.autonomy.deny") : t("titlebar.autonomy.ask");
    var healthLabel = h === "healthy" ? t("titlebar.health.healthy")
      : h === "watching" ? t("titlebar.health.watching")
      : h === "contained" ? t("titlebar.health.contained") : t("state.offline");
    return '<header class="titlebar">' +
      '<span class="brand">' + icon("shield", "") + " Saber Studio <small>" + esc(t("app.console")) + "</small></span>" +
      '<div class="tb-chips">' +
      '<span class="tb-chip"><span class="k">' + esc(t("titlebar.workspace")) + "</span> " + esc(BOOT.workspace) + "</span>" +
      '<span class="tb-chip optional"><span class="k">' + esc(t("titlebar.branch")) + "</span> " + esc(BOOT.branch) + "</span>" +
      '<span class="tb-chip optional"><span class="k">' + esc(t("titlebar.realm")) + "</span> " + esc(t("titlebar.realm.value")) + "</span>" +
      '<span class="tb-chip optional"><span class="k">' + esc(t("titlebar.privacy")) + "</span> " + esc(t("titlebar.privacy.value")) + "</span>" +
      '<span class="tb-chip"><span class="k">' + esc(t("titlebar.autonomy")) + "</span> " + esc(autonomy) + "</span>" +
      '<span class="tb-chip"><span class="k">' + esc(t("titlebar.health")) + "</span> " + esc(healthLabel) + "</span>" +
      "</div>" +
      '<div class="tb-actions">' +
      '<button class="icon-btn" data-action="lang" aria-label="' + esc(t("titlebar.langToggle")) + '" data-value="' + (S.lang === "zh" ? "en" : "zh") + '">' + icon("globe") + "</button>" +
      '<button class="icon-btn" data-action="theme" aria-label="' + esc(t("titlebar.themeToggle")) + '" data-value="' + (S.theme === "dark" ? "light" : "dark") + '">' + icon(S.theme === "dark" ? "sun" : "moon") + "</button>" +
      '<button class="icon-btn" data-action="palette" aria-label="' + esc(t("palette.ph")) + '">' + icon("search") + "</button>" +
      "</div></header>";
  }

  function renderRail() {
    var order = PAGES;
    var icons = { today: "compass", goal: "target", conversation: "chat", changes: "diff",
      runtime: "pulse", memory: "book", armor: "shield", evolution: "seed", health: "heart", governance: "gavel" };
    var pending = pendingApprovals().length;
    var buttons = "";
    var workspaceSeen = false;
    for (var i = 0; i < order.length; i++) {
      var page = order[i];
      if (page === "goal" && !workspaceSeen) {
        workspaceSeen = true;
        buttons += '<div class="rail-label" role="presentation">' + esc(t("nav.group.workspace")) + "</div>";
      }
      if (page === "armor") {
        buttons += '<div class="rail-label" role="presentation">' + esc(t("nav.group.systems")) + "</div>";
      }
      buttons += '<button data-action="nav" data-page="' + page + '"' +
        (S.page === page ? ' aria-current="page"' : "") + ' aria-label="' + esc(t("nav." + page)) + '">' +
        icon(icons[page]) + "<span>" + esc(t("nav." + page)) + "</span>" +
        (page === "today" && pending > 0 ? '<span class="badge">' + pending + "</span>" : "") + "</button>";
    }
    return '<nav class="rail" aria-label="' + esc(t("app.title")) + '">' + buttons + "</nav>";
  }

  function renderSidebar() {
    var sections = "";
    if (S.page === "today" || S.page === "goal") {
      sections += '<div class="sb-section"><h2 class="sb-title">' + esc(t("goal.objective")) + "</h2>" +
        (S.goal.objective ? '<p class="sb-item">' + icon("target") + esc(S.goal.objective) + "</p>"
          : '<p class="faint">' + esc(t("goal.objective.ph")) + "</p>") +
        "<h2 class='sb-title' style='margin-top:16px'>" + esc(t("goal.acceptance")) + "</h2>" +
        '<ul class="rows">' + (S.goal.acceptance.map(function (item) {
          return "<li>" + icon("check") + '<span class="grow">' + esc(item) + "</span></li>";
        }).join("") || '<li class="faint">' + esc(t("common.empty")) + "</li>") + "</ul></div>";
    }
    if (S.page === "conversation") {
      var pending = pendingApprovals();
      sections += '<div class="sb-section"><h2 class="sb-title">' + esc(t("approval.queue")) + "</h2>" +
        '<ul class="rows">' + (pending.map(function (run) {
          return "<li>" + chip("waiting_user") + '<span class="grow mono">' + esc(run.argv.join(" ")) + "</span>" +
            '<button class="btn ghost" data-action="receipt" data-run="' + esc(run.runId) + '">' + esc(t("receipt.open")) + "</button></li>";
        }).join("") || '<li class="faint">' + esc(t("today.inbox.none")) + "</li>") + "</ul></div>" +
        '<div class="sb-section"><h2 class="sb-title">' + esc(t("conv.nutrition")) + "</h2>" +
        '<p class="sb-item">' + icon("book") + esc(t("conv.nutrition.dest.value")) + "</p></div>";
    }
    if (S.page === "changes" || S.page === "runtime") {
      sections += '<div class="sb-section"><h2 class="sb-title">' + esc(t("receipt.title")) + "</h2>" +
        '<ul class="rows">' + (RUNS.slice(0, 8).map(function (run) {
          return "<li>" + verdictChip(run) + '<span class="grow mono">' + esc(run.runId) + "</span>" +
            '<button class="btn ghost" data-action="receipt" data-run="' + esc(run.runId) + '">' + esc(t("receipt.open")) + "</button></li>";
        }).join("") || '<li class="faint">' + esc(t("common.empty")) + "</li>") + "</ul></div>";
    }
    if (S.page === "memory" || S.page === "evolution") {
      sections += '<div class="sb-section"><h2 class="sb-title">' + esc(t("memory.ledger")) + "</h2>" +
        '<ul class="rows">' + (S.memories.map(function (m) {
          return "<li>" + chip(m.state === "accepted" ? "verified" : "knowledge") +
            '<span class="grow">' + esc(m.title) + "</span></li>";
        }).join("") || '<li class="faint">' + esc(t("common.empty")) + "</li>") + "</ul></div>";
    }
    if (S.page === "health" || S.page === "armor" || S.page === "governance") {
      sections += '<div class="sb-section"><h2 class="sb-title">' + esc(t("titlebar.realm")) + "</h2>" +
        '<p class="sb-item">' + icon("shield") + esc(t("titlebar.realm.value")) + "</p>" +
        '<p class="sb-item">' + icon("lock") + esc(t("titlebar.privacy.value")) + "</p>" +
        '<p class="sb-item mono">' + icon("term") + esc(BOOT.core) + "</p></div>";
    }
    return '<aside class="sidebar" aria-label="' + esc(t("nav.group.workspace")) + '">' + sections + "</aside>";
  }

  function renderDrawer() {
    if (!S.drawer || S.drawer.type !== "receipt") return "";
    var run = null;
    for (var i = 0; i < RUNS.length; i++) if (RUNS[i].runId === S.drawer.runId) run = RUNS[i];
    if (!run) return "";
    return '<aside class="drawer" aria-label="' + esc(t("receipt.title")) + '">' +
      '<button class="icon-btn close" data-action="drawer-close" aria-label="' + esc(t("common.close")) + '">' + icon("x") + "</button>" +
      "<h2>" + icon("check") + " " + esc(t("receipt.title")) + "</h2>" +
      receiptFields(run) +
      "<h2>" + esc(t("receipt.digest")) + "</h2>" +
      '<p class="mono" data-digest="' + esc(run.runId) + '">' + esc(t("receipt.digest.pending")) + "</p>" +
      "<h2>" + esc(t("receipt.stdout")) + "</h2>" +
      '<pre class="out">' + esc(run.stdout || "—") + "</pre></aside>";
  }

  function renderVitalbar() {
    var st = stats();
    var pending = pendingApprovals().length;
    var h = health();
    var cls = h === "healthy" ? "ok" : h === "watching" || h === "offline" ? "warn" : "bad";
    var net = ONLINE === false ? '<span class="vital bad">' + icon("x") + " " + esc(t("vital.offline")) + "</span>"
      : '<span class="vital ok">' + icon("globe") + " " + esc(t("vital.network")) + ": " + esc(t("vital.network.deny")) + "</span>";
    return '<footer class="vitalbar">' +
      '<span class="vital ' + (RUNNING ? "warn" : "ok") + '">' + icon("pulse") + " " + esc(t("vital.run")) +
      " <b>" + (RUNNING ? esc(t("state.streaming")) : "0") + "</b> · " + st.total + "</span>" +
      '<span class="vital ' + (pending > 0 ? "warn" : "ok") + '">' + icon("clock") + " " + esc(t("vital.approval")) +
      " <b>" + pending + "</b></span>" +
      '<span class="vital">' + icon("shield") + " " + esc(t("vital.realm")) + " <b>local</b></span>" + net +
      '<span class="vital">' + icon("lock") + " " + esc(t("vital.policy.value")) + "</span>" +
      '<span class="vital">' + icon("box") + " " + esc(t("vital.sandbox")) + " <b>" + esc(BOOT.sandboxBackend) + "</b></span>" +
      '<span class="vital">' + icon("bolt") + " " + esc(t("vital.cost")) + " <b>" + esc(t("vital.cost.value")) + "</b></span>" +
      '<span class="vital ' + cls + '">' + icon("heart") + " " + esc(t("vital.online")) + "</span>" +
      "</footer>";
  }

  function render() {
    document.documentElement.lang = S.lang === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.theme = S.theme;
    document.documentElement.dataset.density = S.density;
    var isMobile = window.innerWidth < 600;
    var mobileAllowed = { today: true, conversation: true, runtime: true, health: true };
    var body = isMobile && !mobileAllowed[S.page] ? supervisorNotice(S.page) : (RENDERERS[S.page] || pageToday)();
    var app = document.getElementById("app");
    app.className = "app";
    app.dataset.sidebar = S.sidebar ? "open" : "closed";
    app.innerHTML = renderTitlebar() + renderRail() + renderSidebar() +
      '<main class="canvas" id="canvas" tabindex="-1">' + body + "</main>" + renderDrawer() +
      renderVitalbar();
    renderPaletteDom();
    computeDigests();
  }

  // ---------- palette ----------

  function paletteItems() {
    var items = PAGES.map(function (page) {
      return { key: "nav." + page, run: function () { go(page); } };
    });
    items.push({ key: "titlebar.langToggle", run: function () { setLang(S.lang === "zh" ? "en" : "zh"); } });
    items.push({ key: "titlebar.themeToggle", run: function () { setTheme(S.theme === "dark" ? "light" : "dark"); } });
    items.push({ key: S.safeMode ? "health.safemode.off" : "health.safemode.on",
      run: function () { setSafeMode(!S.safeMode); } });
    items.push({ key: "health.export", run: exportBundle });
    return items;
  }
  function renderPaletteDom() {
    var host = document.getElementById("palette");
    if (!PALETTE.open) { host.hidden = true; host.innerHTML = ""; return; }
    var q = PALETTE.query.toLowerCase();
    var items = paletteItems().filter(function (item) {
      return q === "" || t(item.key).toLowerCase().indexOf(q) >= 0 || item.key.indexOf(q) >= 0;
    });
    if (PALETTE.index >= items.length) PALETTE.index = 0;
    var list = items.map(function (item, index) {
      return '<li role="option" aria-selected="' + (index === PALETTE.index) + '" data-pi="' + index + '">' +
        icon("chevron") + esc(t(item.key)) + '<span class="k">' + esc(item.key) + "</span></li>";
    }).join("") || '<li class="muted">' + esc(t("palette.empty")) + "</li>";
    host.hidden = false;
    host.innerHTML = '<div class="overlay" data-action="palette-backdrop"><div class="palette" role="dialog" aria-label="command palette">' +
      '<input id="palette-input" placeholder="' + esc(t("palette.ph")) + '" value="' + esc(PALETTE.query) + '" autocomplete="off">' +
      '<ul role="listbox" id="palette-list">' + list + "</ul></div></div>";
    var input = document.getElementById("palette-input");
    if (input) {
      input.focus();
      input.selectionStart = input.value.length;
      input.addEventListener("input", function () {
        PALETTE.query = input.value; PALETTE.index = 0; renderPaletteDom();
      });
      input.addEventListener("keydown", function (event) {
        var items2 = paletteItems().filter(function (item) {
          var q2 = PALETTE.query.toLowerCase();
          return q2 === "" || t(item.key).toLowerCase().indexOf(q2) >= 0 || item.key.indexOf(q2) >= 0;
        });
        if (event.key === "ArrowDown") { PALETTE.index = Math.min(PALETTE.index + 1, items2.length - 1); renderPaletteDom(); event.preventDefault(); }
        if (event.key === "ArrowUp") { PALETTE.index = Math.max(PALETTE.index - 1, 0); renderPaletteDom(); event.preventDefault(); }
        if (event.key === "Enter") {
          var chosen = items2[PALETTE.index];
          if (chosen) { closePalette(); chosen.run(); }
          event.preventDefault();
        }
      });
    }
    var listEl = document.getElementById("palette-list");
    if (listEl) listEl.addEventListener("click", function (event) {
      var li = event.target.closest("li[data-pi]");
      if (!li) return;
      var index = parseInt(li.getAttribute("data-pi"), 10);
      var items3 = paletteItems().filter(function (item) {
        var q3 = PALETTE.query.toLowerCase();
        return q3 === "" || t(item.key).toLowerCase().indexOf(q3) >= 0 || item.key.indexOf(q3) >= 0;
      });
      var chosen = items3[index];
      if (chosen) { closePalette(); chosen.run(); }
    });
  }
  function openPalette() { PALETTE = { open: true, query: "", index: 0 }; render(); }
  function closePalette() { PALETTE.open = false; render(); }

  // ---------- actions ----------

  function go(page) {
    S.page = page;
    save();
    if (history.replaceState) history.replaceState(null, "", "#/" + page);
    render();
    var canvas = document.getElementById("canvas");
    if (canvas) canvas.scrollTop = 0;
  }
  function setLang(lang) { S.lang = lang; save(); render(); }
  function setTheme(theme) { S.theme = theme; save(); render(); }
  function setSafeMode(on) {
    S.safeMode = on;
    save();
    if (on) announce("live.contained");
    render();
  }

  function doRun(command, allow, approve) {
    RUNNING = true;
    render();
    api("/api/run", { method: "POST", body: { command: command, allow: allow, approve: approve } })
      .then(function (result) {
        RUNNING = false;
        if (result && result.error) { render(); return; }
        return refreshHistory().then(function () {
          var top = RUNS[0];
          if (top && top.verdict === "denied" && top.exitCode === 2 && !S.decisions[top.runId]) {
            announce("live.approval");
          } else if (top && (top.exitCode === null || top.exitCode === undefined)) {
            announce("live.contained");
          } else {
            announce("live.completed");
          }
          render();
        });
      })
      .catch(function () { RUNNING = false; render(); });
  }

  function findRun(runId) {
    for (var i = 0; i < RUNS.length; i++) if (RUNS[i].runId === runId) return RUNS[i];
    return null;
  }

  function exportBundle() {
    var bundle = {
      exportedAt: new Date().toISOString(),
      boot: BOOT,
      settings: { lang: S.lang, theme: S.theme, density: S.density, safeMode: S.safeMode },
      goal: S.goal, plan: S.plan, memories: S.memories,
      decisions: S.decisions, reviews: S.reviews,
      runs: RUNS
    };
    var blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "saber-support-bundle.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function computeDigests() {
    if (!window.crypto || !window.crypto.subtle) return;
    var nodes = document.querySelectorAll("[data-digest]");
    for (var i = 0; i < nodes.length; i++) {
      (function (node) {
        var run = findRun(node.getAttribute("data-digest"));
        if (!run) return;
        var bytes = new TextEncoder().encode(run.stdout || "");
        window.crypto.subtle.digest("SHA-256", bytes).then(function (digest) {
          var hex = Array.prototype.map.call(new Uint8Array(digest), function (b) {
            return ("0" + b.toString(16)).slice(-2);
          }).join("");
          node.textContent = hex.slice(0, 16) + "…" + hex.slice(-8) + " (sha-256)";
          node.title = hex;
        });
      })(nodes[i]);
    }
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;
    var el = target.closest("[data-action]");
    if (!el) return;
    var action = el.getAttribute("data-action");
    var run;
    if (action === "nav") go(el.getAttribute("data-page"));
    else if (action === "lang") setLang(el.getAttribute("data-value"));
    else if (action === "theme") setTheme(el.getAttribute("data-value"));
    else if (action === "density") { S.density = el.getAttribute("data-value"); save(); render(); }
    else if (action === "philosophy") { S.philosophy = !S.philosophy; save(); render(); }
    else if (action === "palette") openPalette();
    else if (action === "palette-backdrop") {
      if (event.target === el) closePalette();
    }
    else if (action === "drawer-close") { S.drawer = null; save(); render(); }
    else if (action === "receipt") {
      S.drawer = { type: "receipt", runId: el.getAttribute("data-run") };
      save(); render();
    }
    else if (action === "ap-deny") {
      run = findRun(el.getAttribute("data-run"));
      if (run && !S.decisions[run.runId]) {
        S.decisions[run.runId] = { action: "denied", at: new Date().toISOString() };
        save(); announce("live.contained"); render();
      }
    }
    else if (action === "ap-allow") {
      run = findRun(el.getAttribute("data-run"));
      if (run && !S.decisions[run.runId]) {
        S.decisions[run.runId] = { action: "allowed", at: new Date().toISOString() };
        save();
        doRun(run.command || run.argv.join(" "), [progName(run.argv[0] || "")], true);
      }
    }
    else if (action === "ap-narrow") {
      var form = document.getElementById("narrow-" + el.getAttribute("data-run"));
      if (form) form.hidden = !form.hidden;
    }
    else if (action === "review") {
      S.reviews[el.getAttribute("data-run")] = el.getAttribute("data-value");
      save(); render();
    }
    else if (action === "ga-del") {
      S.goal.acceptance.splice(parseInt(el.getAttribute("data-index"), 10), 1);
      save(); render();
    }
    else if (action === "plan-toggle") {
      var task = S.plan[parseInt(el.getAttribute("data-index"), 10)];
      if (task) { task.state = task.state === "done" ? "todo" : "done"; save(); render(); }
    }
    else if (action === "plan-del") {
      S.plan.splice(parseInt(el.getAttribute("data-index"), 10), 1);
      save(); render();
    }
    else if (action === "goal-start") { go("conversation"); }
    else if (action === "mem-state") {
      var memory = null;
      for (var i = 0; i < S.memories.length; i++) {
        if (S.memories[i].id === el.getAttribute("data-id")) memory = S.memories[i];
      }
      if (memory) {
        memory.state = el.getAttribute("data-value");
        if (memory.state !== "accepted") memory.attached = false;
        save(); render();
      }
    }
    else if (action === "mem-attach") {
      for (var j = 0; j < S.memories.length; j++) {
        if (S.memories[j].id === el.getAttribute("data-id")) S.memories[j].attached = !S.memories[j].attached;
      }
      save(); render();
    }
    else if (action === "tl-filter") { S.tlFilter = el.getAttribute("data-filter"); save(); render(); }
    else if (action === "safe-mode") setSafeMode(el.getAttribute("data-value") === "on");
    else if (action === "export") exportBundle();
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.id === "run-form") {
      event.preventDefault();
      var command = form.command.value.trim();
      if (!command) return;
      S.draft = form.command.value;
      S.allow = form.allow.value;
      save();
      var allow = form.allow.value.split(",").map(function (entry) { return entry.trim(); })
        .filter(function (entry) { return entry.length > 0; });
      doRun(command, allow, S.safeMode ? false : form.approve.checked);
      return;
    }
    if (form.id === "goal-form") {
      event.preventDefault();
      S.goal.objective = form.objective.value;
      S.goal.constraints = form.constraints.value;
      S.goal.budget = form.budget.value;
      var acceptance = form.acceptance.value.trim();
      if (acceptance) { S.goal.acceptance.push(acceptance); form.acceptance.value = ""; }
      save(); render(); announce("goal.saved");
      return;
    }
    if (form.id === "plan-form") {
      event.preventDefault();
      var title = form.title.value.trim();
      if (title) S.plan.push({ id: "t" + Date.now(), title: title, state: "todo", at: new Date().toISOString() });
      save(); render();
      return;
    }
    if (form.id === "memory-form") {
      event.preventDefault();
      S.memories.unshift({ id: "m" + Date.now(), title: form.title.value.trim(), body: form.body.value.trim(),
        state: "candidate", attached: false, at: new Date().toISOString() });
      form.title.value = ""; form.body.value = "";
      save(); render();
      return;
    }
    if (form.id && form.id.indexOf("narrow-") === 0) {
      event.preventDefault();
      var run2 = findRun(form.getAttribute("data-run"));
      if (!run2) return;
      var allow2 = form.allow.value.split(",").map(function (entry) { return entry.trim(); })
        .filter(function (entry) { return entry.length > 0; });
      S.decisions[run2.runId] = { action: "allowed", at: new Date().toISOString() };
      save();
      doRun(run2.command || run2.argv.join(" "), allow2, true);
    }
  });

  document.addEventListener("input", function (event) {
    if (event.target && event.target.id === "cmd") { S.draft = event.target.value; save(); }
    if (event.target && event.target.id === "allow") { S.allow = event.target.value; save(); }
  });

  document.addEventListener("keydown", function (event) {
    var mod = event.metaKey || event.ctrlKey;
    if (mod && event.key >= "1" && event.key <= "5" && !event.shiftKey) {
      go(WORKSPACES[parseInt(event.key, 10) - 1]);
      event.preventDefault();
      return;
    }
    if (mod && event.shiftKey && (event.key === "A" || event.key === "a")) { go("conversation"); event.preventDefault(); return; }
    if (mod && event.shiftKey && (event.key === "H" || event.key === "h")) { go("health"); event.preventDefault(); return; }
    if (mod && (event.key === "k" || event.key === "K")) { openPalette(); event.preventDefault(); return; }
    if (event.key === "Escape") {
      if (PALETTE.open) { closePalette(); event.preventDefault(); return; }
      if (S.drawer) { S.drawer = null; save(); render(); event.preventDefault(); }
    }
  });

  window.addEventListener("hashchange", function () {
    var page = (location.hash || "").replace("#/", "");
    if (PAGES.indexOf(page) >= 0 && page !== S.page) { S.page = page; save(); render(); }
  });

  var lastExpired = 0;
  window.setInterval(function () {
    var nodes = document.querySelectorAll("[data-ttl]");
    for (var i = 0; i < nodes.length; i++) {
      var run = findRun(nodes[i].getAttribute("data-ttl"));
      if (!run) continue;
      var remaining = Math.max(0, Math.ceil((TTL_MS - (Date.now() - new Date(run.at).getTime())) / 1000));
      nodes[i].textContent = remaining + "s";
    }
    var expiredNow = pendingApprovals().filter(approvalExpired).length;
    if (expiredNow !== lastExpired) { lastExpired = expiredNow; render(); }
  }, 1000);

  var initial = (location.hash || "").replace("#/", "");
  if (PAGES.indexOf(initial) >= 0) S.page = initial;
  refreshHistory().catch(function () { ONLINE = false; }).then(function () { render(); });
  render();
})();
`;

/** Build the full Studio console page for one server state. */
export function createUiPage(boot: StudioBootState): string {
  return `<!doctype html>
<html lang="zh-CN" data-theme="dark" data-density="compact">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2354B8FF' stroke-width='1.5'%3E%3Cpath d='M12 3l8 3v6c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V6z'/%3E%3C/svg%3E">
<title>Saber Studio — ${escHtml(boot.workspace)}</title>
<style>${tokenCss()}${STUDIO_CSS}</style>
</head>
<body>
<a class="skip" href="#canvas">跳到主内容 / Skip to content</a>
<div id="app" class="app"></div>
<div id="palette" hidden></div>
<div id="live" class="vh" aria-live="polite" role="status"></div>
<script>
${STUDIO_JS.replace("__I18N__", inject(UI_STRINGS)).replace("__BOOT__", inject(boot))}
</script>
</body>
</html>`;
}

function escHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
