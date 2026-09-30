/**
 * Custom themes: the user picks four colors per appearance (background,
 * sidebar, text, accent) and every other role is grown from them by blending
 * in Oklab, like CSS's `color-mix(in oklab, …)`. The web app stores them as the
 * synced ui preference "otter:custom-themes"; the iPhone app ports this math
 * (apps/ios's Theme/CustomTheme.swift, on Theme.swift's `RGB`) and must paint
 * the same hex for every role.
 */

import {
  OTTER_DARK_THEME_COLORS,
  OTTER_LIGHT_THEME_COLORS,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "./theme-palettes.ts";

export type ThemeSeeds = { background: string; sidebar: string; text: string; accent: string };

export type CustomTheme = { id: string; label: string; light: ThemeSeeds; dark: ThemeSeeds };

const SEED_KEYS = ["background", "sidebar", "text", "accent"] as const;

/** "#abc", "abc", "#ABCDEF" or "abcdef" as lowercase "#rrggbb"; null for anything else. */
export function normalizeHex(value: string): string | null {
  const digits = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(digits)) return `#${[...digits].map((d) => d + d).join("")}`;
  return /^[0-9a-f]{6}$/.test(digits) ? `#${digits}` : null;
}

// The color math mirrors Theme.swift's `RGB` step for step: sRGB channels in
// 0…1, Oklab through Björn Ottosson's matrices, channels clamped before gamma
// encoding, and hex by Math.round(channel * 255).

type Rgb = [number, number, number];
type Oklab = [number, number, number];

/** "#rrggbb" (or "#rgb"), or "oklch(L C H)" as some themes are written. */
function rgb(css: string): Rgb {
  if (css.startsWith("oklch(")) {
    const parts = css
      .slice(6, -1)
      .split(" ")
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    const [l, c, h] =
      parts.length === 3 ? [parts[0]!, parts[1]!, (parts[2]! * Math.PI) / 180] : [0.5, 0, 0];
    return fromOklab([l, c * Math.cos(h), c * Math.sin(h)]);
  }
  const value = Number.parseInt(normalizeHex(css)?.slice(1) ?? "808080", 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

function gamma(c: number): number {
  c = Math.min(Math.max(c, 0), 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function oklab([red, green, blue]: Rgb): Oklab {
  const [r, g, b] = [linear(red), linear(green), linear(blue)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Oklab): Rgb {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    gamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function hex(color: Rgb): string {
  return `#${color
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Keeps `keep` of `x`, the rest `y`, blended in Oklab. */
function mix(x: string, y: string, keep: number): string {
  const [a, o] = [oklab(rgb(x)), oklab(rgb(y))];
  const blend = (i: number) => a[i]! * keep + o[i]! * (1 - keep);
  return hex(fromOklab([blend(0), blend(1), blend(2)]));
}

const lightness = (css: string) => oklab(rgb(css))[0];

/** Any theme color (hex or oklch) as "#rrggbb". */
export function toHex(css: string): string {
  return hex(rgb(css));
}

/** The stored "otter:custom-themes" list; entries that don't hold up are dropped. */
export function parseCustomThemes(raw: string | null): CustomTheme[] {
  let list: unknown;
  try {
    list = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): CustomTheme[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { id, label, light, dark } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id.startsWith("custom-")) return [];
    if (typeof label !== "string" || !label) return [];
    const [lightSeeds, darkSeeds] = [parseSeeds(light), parseSeeds(dark)];
    return lightSeeds && darkSeeds ? [{ id, label, light: lightSeeds, dark: darkSeeds }] : [];
  });
}

function parseSeeds(value: unknown): ThemeSeeds | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const seeds: Partial<ThemeSeeds> = {};
  for (const key of SEED_KEYS) {
    const seed = typeof record[key] === "string" ? normalizeHex(record[key]) : null;
    if (!seed) return null;
    seeds[key] = seed;
  }
  return seeds as ThemeSeeds;
}

/** The four seeds a palette would start a custom theme from. */
export function seedsFrom(colors: ThemeColors): ThemeSeeds {
  return {
    background: toHex(colors.canvas),
    sidebar: toHex(colors.sidebar),
    text: toHex(colors.text),
    accent: toHex(colors.messageAction),
  };
}

/** Every role, as "#rrggbb", grown from the four seeds. */
export function customThemeColors(seeds: ThemeSeeds, mode: ThemeAppearance): ThemeColors {
  const [B, S, T, A] = [
    toHex(seeds.background),
    toHex(seeds.sidebar),
    toHex(seeds.text),
    toHex(seeds.accent),
  ];
  const stock = mode === "light" ? OTTER_LIGHT_THEME_COLORS : OTTER_DARK_THEME_COLORS;
  // The preferred color, unless it is too close in lightness to what it sits on.
  const readable = (on: string, preferred: string) =>
    Math.abs(lightness(on) - lightness(preferred)) >= 0.4
      ? preferred
      : lightness(on) > 0.6
        ? "#111111"
        : "#ffffff";
  const ink = (keep: number) => mix(T, B, keep);
  const sidebarText = readable(S, T);
  const sidebarInk = (keep: number) => mix(sidebarText, S, keep);
  const onAccent = readable(A, "#ffffff");

  return {
    // The background and the text itself.
    canvas: B,
    chrome: B,
    toolbar: B,
    terminalBackground: B,
    text: T,
    toolbarForeground: T,
    toolbarControlForeground: T,
    secondaryForeground: T,
    accentSurfaceForeground: T,
    messageForeground: T,
    codeForeground: T,
    terminalForeground: T,
    terminalCursor: T,
    // Quieter text.
    textMuted: ink(0.62),
    mutedForeground: ink(0.62),
    secondaryLabel: ink(0.62),
    iconMuted: ink(0.55),
    placeholder: ink(0.46),
    // Surfaces: a touch of text over the background.
    muted: ink(0.04),
    surface: ink(0.03),
    toolbarControl: ink(0.03),
    surfaceRaised: ink(0.05),
    secondary: ink(0.05),
    codeBackground: ink(0.05),
    surfaceOverlay: mode === "light" ? B : ink(0.06),
    accentSurface: ink(0.07),
    toolbarControlHover: ink(0.07),
    messageSurface: ink(0.08),
    // Lines.
    border: ink(0.1),
    toolbarBorder: ink(0.1),
    input: ink(0.16),
    terminalScrollbar: ink(0.15),
    terminalScrollbarHover: ink(0.25),
    // The accent.
    accent: A,
    focus: A,
    messageAction: A,
    update: A,
    updateForeground: A,
    accentForeground: onAccent,
    messageActionForeground: onAccent,
    messageActionHover: mix(A, B, 0.88),
    updateSurface: mix(A, B, 0.14),
    terminalSelection: mix(A, B, 0.25),
    // Errors and warnings keep Otter's colors, on this background.
    error: toHex(stock.error),
    errorForeground: toHex(stock.errorForeground),
    errorSurface: mix(stock.error, B, 0.12),
    warning: toHex(stock.warning),
    warningForeground: toHex(stock.warningForeground),
    warningSurface: mix(stock.warning, B, 0.1),
    // The sidebar, with text that reads on it.
    sidebar: S,
    sidebarForeground: sidebarText,
    sidebarMutedForeground: sidebarInk(0.62),
    sidebarRowHover: sidebarInk(0.04),
    sidebarControlSurface: sidebarInk(0.06),
    sidebarRowSelected: sidebarInk(0.06),
    sidebarRowActive: sidebarInk(0.08),
    sidebarBorder: sidebarInk(0.07),
  };
}

export function customThemeDefinition(theme: CustomTheme): ThemeDefinition {
  const light = customThemeColors(theme.light, "light");
  return {
    id: theme.id,
    label: theme.label,
    appearance: "light",
    colors: light,
    variants: { light, dark: customThemeColors(theme.dark, "dark") },
    exact: true,
    monochrome: true,
  };
}
