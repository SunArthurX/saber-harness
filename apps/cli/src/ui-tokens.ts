/**
 * Saber Studio design tokens (docs/design/saber-studio.tokens.json, v1.0.0)
 * expressed as CSS custom properties. Dark is the default surface; light is
 * an explicit `[data-theme="light"]` override. Color never carries state
 * alone — every state chip pairs the signal color with an icon and text.
 */

interface ThemeColors {
  readonly "surface.canvas": string;
  readonly "surface.nucleus": string;
  readonly "surface.chrome": string;
  readonly "surface.raised": string;
  readonly "surface.hover": string;
  readonly "text.primary": string;
  readonly "text.secondary": string;
  readonly "text.muted": string;
  readonly "line.structure": string;
  readonly "line.spine": string;
  readonly "signal.cognition": string;
  readonly "signal.knowledge": string;
  readonly "signal.verified": string;
  readonly "signal.approval": string;
  readonly "signal.incident": string;
  readonly "signal.offline": string;
}

const DARK: ThemeColors = {
  "surface.canvas": "#080C11",
  "surface.nucleus": "#0C1117",
  "surface.chrome": "#111821",
  "surface.raised": "#141B23",
  "surface.hover": "#18212B",
  "text.primary": "#DCE5EE",
  "text.secondary": "#93A4B7",
  "text.muted": "#7F92A5",
  "line.structure": "#25313D",
  "line.spine": "#334252",
  "signal.cognition": "#54B8FF",
  "signal.knowledge": "#A78BFA",
  "signal.verified": "#55C896",
  "signal.approval": "#F0B35A",
  "signal.incident": "#FF6B78",
  "signal.offline": "#93A4B7",
};

const LIGHT: ThemeColors = {
  "surface.canvas": "#EEF2F6",
  "surface.nucleus": "#F7F9FB",
  "surface.chrome": "#FFFFFF",
  "surface.raised": "#FFFFFF",
  "surface.hover": "#E8EEF3",
  "text.primary": "#17212B",
  "text.secondary": "#526170",
  "text.muted": "#738291",
  "line.structure": "#DBE3EA",
  "line.spine": "#CBD5DF",
  "signal.cognition": "#0069A8",
  "signal.knowledge": "#6D46C7",
  "signal.verified": "#087A52",
  "signal.approval": "#925500",
  "signal.incident": "#B42334",
  "signal.offline": "#5A6878",
};

function colorProperties(colors: ThemeColors): string {
  return Object.entries(colors)
    .map(([token, value]) => `  --${token.replaceAll(".", "-")}: ${value};`)
    .join("\n");
}

/** The Quiet Armor token block: `:root` (dark) plus the light override. */
export function tokenCss(): string {
  return `:root {
${colorProperties(DARK)}
  --font-ui: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  --font-mono: "IBM Plex Mono", SFMono-Regular, Consolas, monospace;
  --size-caption: 11px;
  --size-compact: 13px;
  --size-body: 14px;
  --size-title: 18px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 24px;
  --space-2xl: 32px;
  --radius-control: 6px;
  --radius-pane: 8px;
  --radius-dialog: 12px;
  --border-hairline: 1px;
  --border-focus: 2px;
  --border-continuity: 1px;
  --titlebar-height: 48px;
  --rail-width: 58px;
  --sidebar-width: 288px;
  --drawer-width: 320px;
  --vitalbar-height: 46px;
  --row-height: 28px;
  --motion-pulse: 180ms;
  --motion-pane: 150ms;
  --motion-drawer: 180ms;
  --elevation-popover: 0 12px 36px rgba(4, 10, 16, 0.26);
  --elevation-dialog: 0 24px 80px rgba(0, 0, 0, 0.38);
}
[data-theme="light"] {
${colorProperties(LIGHT)}
}
[data-density="comfortable"] {
  --size-compact: 14px;
  --row-height: 34px;
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}`;
}
