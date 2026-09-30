import { describe, expect, it } from "vite-plus/test";
import {
  customThemeColors,
  customThemeDefinition,
  normalizeHex,
  parseCustomThemes,
  seedsFrom,
  toHex,
  type ThemeSeeds,
} from "./custom-themes.ts";
import { OTTER_LIGHT_THEME_COLORS, THEME_COLOR_ROLES } from "./theme-palettes.ts";

const light: ThemeSeeds = {
  background: "#fbf8f3",
  sidebar: "#f1ece4",
  text: "#2b2622",
  accent: "#c2410c",
};
const dark: ThemeSeeds = {
  background: "#1b1917",
  sidebar: "#141210",
  text: "#ece6df",
  accent: "#fb923c",
};

describe("toHex", () => {
  it("reads oklch and hex", () => {
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("#ABCDEF")).toBe("#abcdef");
  });
});

describe("normalizeHex", () => {
  it("accepts short and long hex, with or without #", () => {
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" #ABCDEF ")).toBe("#abcdef");
    expect(normalizeHex("abcdef")).toBe("#abcdef");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("parseCustomThemes", () => {
  it("never throws", () => {
    expect(parseCustomThemes(null)).toEqual([]);
    expect(parseCustomThemes("nope")).toEqual([]);
    expect(parseCustomThemes("{}")).toEqual([]);
  });

  it("drops invalid entries and normalizes seeds", () => {
    const raw = JSON.stringify([
      { id: "custom-aaaa", label: "Sand", light: { ...light, accent: "#C2410C" }, dark },
      { id: "sand", label: "No prefix", light, dark },
      { id: "custom-bbbb", label: "", light, dark },
      { id: "custom-cccc", label: "No dark", light },
      { id: "custom-dddd", label: "Bad seed", light: { ...light, text: "#12345" }, dark },
      null,
      "custom-eeee",
    ]);
    expect(parseCustomThemes(raw)).toEqual([{ id: "custom-aaaa", label: "Sand", light, dark }]);
  });
});

describe("customThemeColors", () => {
  it("paints every role as #rrggbb in both modes", () => {
    for (const [seeds, mode] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const colors = customThemeColors(seeds, mode);
      for (const role of THEME_COLOR_ROLES) expect(colors[role]).toMatch(/^#[0-9a-f]{6}$/);
      expect(colors.canvas).toBe(seeds.background);
      expect(colors.sidebar).toBe(seeds.sidebar);
      expect(colors.text).toBe(seeds.text);
      expect(colors.messageAction).toBe(seeds.accent);
    }
  });

  it("puts readable text on the accent", () => {
    expect(
      customThemeColors({ ...light, accent: "#1b4ed8" }, "light").messageActionForeground,
    ).toBe("#ffffff");
    expect(
      customThemeColors({ ...light, accent: "#fe9a00" }, "light").messageActionForeground,
    ).toBe("#111111");
  });

  it("lightens the sidebar's text on a dark sidebar", () => {
    const colors = customThemeColors({ ...light, sidebar: "#1b1917" }, "light");
    expect(colors.sidebarForeground).toBe("#ffffff");
  });

  it("matches the reference palette the iPhone app ports", () => {
    expect(customThemeColors(light, "light")).toEqual({
      accent: "#c2410c",
      accentForeground: "#ffffff",
      accentSurface: "#ebe7e3",
      accentSurfaceForeground: "#2b2622",
      border: "#e4e0dc",
      canvas: "#fbf8f3",
      chrome: "#fbf8f3",
      codeBackground: "#efece7",
      codeForeground: "#2b2622",
      error: "#fb2c36",
      errorForeground: "#c10007",
      errorSurface: "#ffe4dc",
      focus: "#c2410c",
      iconMuted: "#817d78",
      input: "#d6d3ce",
      messageAction: "#c2410c",
      messageActionForeground: "#ffffff",
      messageActionHover: "#cc5a34",
      messageForeground: "#2b2622",
      messageSurface: "#e8e5e0",
      muted: "#f2efea",
      mutedForeground: "#736e6a",
      placeholder: "#94908b",
      secondary: "#efece7",
      secondaryForeground: "#2b2622",
      secondaryLabel: "#736e6a",
      sidebar: "#f1ece4",
      sidebarBorder: "#e2dcd5",
      sidebarControlSurface: "#e4dfd7",
      sidebarForeground: "#2b2622",
      sidebarMutedForeground: "#706a65",
      sidebarRowActive: "#dfdad3",
      sidebarRowHover: "#e8e3db",
      sidebarRowSelected: "#e4dfd7",
      surface: "#f4f1ec",
      surfaceOverlay: "#fbf8f3",
      surfaceRaised: "#efece7",
      terminalBackground: "#fbf8f3",
      terminalCursor: "#2b2622",
      terminalForeground: "#2b2622",
      terminalScrollbar: "#d8d5d0",
      terminalScrollbarHover: "#c2beb9",
      terminalSelection: "#f2ccbd",
      text: "#2b2622",
      textMuted: "#736e6a",
      toolbar: "#fbf8f3",
      toolbarBorder: "#e4e0dc",
      toolbarControl: "#f4f1ec",
      toolbarControlForeground: "#2b2622",
      toolbarControlHover: "#ebe7e3",
      toolbarForeground: "#2b2622",
      update: "#c2410c",
      updateForeground: "#c2410c",
      updateSurface: "#f6dfd5",
      warning: "#fe9a00",
      warningForeground: "#bb4d00",
      warningSurface: "#fcefe1",
    });
    expect(customThemeColors(dark, "dark")).toEqual({
      accent: "#fb923c",
      accentForeground: "#111111",
      accentSurface: "#272522",
      accentSurfaceForeground: "#ece6df",
      border: "#2c2a27",
      canvas: "#1b1917",
      chrome: "#1b1917",
      codeBackground: "#23211f",
      codeForeground: "#ece6df",
      error: "#fb414a",
      errorForeground: "#ff6467",
      errorSurface: "#33201d",
      focus: "#fb923c",
      iconMuted: "#86817d",
      input: "#373532",
      messageAction: "#fb923c",
      messageActionForeground: "#111111",
      messageActionHover: "#dd823a",
      messageForeground: "#ece6df",
      messageSurface: "#292624",
      muted: "#22201d",
      mutedForeground: "#95908b",
      placeholder: "#726f6b",
      secondary: "#23211f",
      secondaryForeground: "#ece6df",
      secondaryLabel: "#95908b",
      sidebar: "#141210",
      sidebarBorder: "#201e1b",
      sidebarControlSurface: "#1e1c1a",
      sidebarForeground: "#ece6df",
      sidebarMutedForeground: "#918d88",
      sidebarRowActive: "#22201d",
      sidebarRowHover: "#1b1916",
      sidebarRowSelected: "#1e1c1a",
      surface: "#201e1c",
      surfaceOverlay: "#252321",
      surfaceRaised: "#23211f",
      terminalBackground: "#1b1917",
      terminalCursor: "#ece6df",
      terminalForeground: "#ece6df",
      terminalScrollbar: "#353330",
      terminalScrollbarHover: "#484542",
      terminalSelection: "#4c3524",
      text: "#ece6df",
      textMuted: "#95908b",
      toolbar: "#1b1917",
      toolbarBorder: "#2c2a27",
      toolbarControl: "#201e1c",
      toolbarControlForeground: "#ece6df",
      toolbarControlHover: "#272522",
      toolbarForeground: "#ece6df",
      update: "#fb923c",
      updateForeground: "#fb923c",
      updateSurface: "#36281f",
      warning: "#fe9a00",
      warningForeground: "#ffb900",
      warningSurface: "#2e251b",
    });
  });
});

describe("seedsFrom", () => {
  it("round-trips a palette's canvas", () => {
    expect(seedsFrom(OTTER_LIGHT_THEME_COLORS).background).toBe(OTTER_LIGHT_THEME_COLORS.canvas);
  });
});

describe("customThemeDefinition", () => {
  it("paints exactly, in its own colors", () => {
    const definition = customThemeDefinition({ id: "custom-aaaa", label: "Sand", light, dark });
    expect(definition).toMatchObject({
      id: "custom-aaaa",
      label: "Sand",
      appearance: "light",
      exact: true,
      monochrome: true,
    });
    expect(definition.colors).toEqual(customThemeColors(light, "light"));
    expect(definition.variants?.dark).toEqual(customThemeColors(dark, "dark"));
  });
});
