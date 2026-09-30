import { setSyncedPreference } from "../synced-preferences";
import { Switch } from "~/components/ui/switch";
import { features } from "../features";
import { gmailApi } from "../gmail/api";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "../gmail/toast";
import type { NativeThemeInfo } from "@otter-mail/contracts";
import { CopyIcon, MoonIcon, PencilIcon, PlusIcon, SunIcon } from "lucide-react";
import { cn, HintTooltip, IconBtn } from "../gmail/ui";
import { Dialog } from "~/components/ui/dialog";
import { Text } from "~/components/ui/text";
import {
  deleteCustomTheme,
  getCustomThemes,
  INITIAL_THEME_ID,
  saveCustomTheme,
  setThemeForAppearance,
  themeColors,
  useAppThemes,
  useThemeChoice,
} from "../theme/apply-theme";
import {
  APP_THEMES,
  type ThemeAppearance,
  type ThemeColors,
  type ThemeDefinition,
} from "@otter-mail/shared/themes";
import {
  customThemeColors,
  seedsFrom,
  type CustomTheme,
  type ThemeSeeds,
} from "@otter-mail/shared/custom-themes";
import { HexColorField } from "./hex-color-field";
import {
  DEFAULT_PANEL_ANIMATION_DURATION_MS,
  MAX_PANEL_ANIMATION_DURATION_MS,
  MIN_PANEL_ANIMATION_DURATION_MS,
  setPanelAnimationDurationMs,
  usePanelAnimationDurationMs,
} from "../panel-animations";
import { PanelAnimationsPreview } from "./panel-animations-preview";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  TextInput,
} from "./settings-ui";

export type ColorScheme = "system" | "light" | "dark";

// ---------------------------------------------------------------------------
// Color scheme cards: a miniature window painted with the chosen theme.
// ---------------------------------------------------------------------------

/** A tiny mail window (sidebar, list lines, bubble, composer) in one palette. */
function MiniWindow({ colors }: { colors: ThemeColors }) {
  const line = (width: string, extra?: CSSProperties) => (
    <span
      className="block h-1.5 rounded-full"
      style={{ width, backgroundColor: colors.textMuted, opacity: 0.35, ...extra }}
    />
  );
  return (
    <span className="flex size-full" style={{ backgroundColor: colors.canvas }}>
      <span
        className="flex w-[26%] flex-col gap-1.5 px-2 pt-2.5"
        style={{
          backgroundColor: colors.sidebar,
          borderRight: `1px solid ${colors.sidebarBorder}`,
        }}
      >
        <span
          className="block h-2 rounded-full"
          style={{
            backgroundColor: colors.sidebarRowSelected,
            border: `1px solid ${colors.border}`,
          }}
        />
        {line("80%")}
        {line("65%")}
        {line("72%")}
      </span>
      <span className="relative flex flex-1 flex-col gap-1.5 px-3 pt-3">
        <span className="flex justify-end">
          <span
            className="block h-3 w-[38%] rounded-full"
            style={{ backgroundColor: colors.messageSurface }}
          />
        </span>
        {line("62%")}
        {line("48%")}
        <span
          className="absolute inset-x-3 bottom-2.5 flex h-4 items-center justify-end rounded-full px-1"
          style={{ backgroundColor: colors.surfaceRaised, border: `1px solid ${colors.border}` }}
        >
          <span
            className="block size-2.5 rounded-full"
            style={{ backgroundColor: colors.messageAction }}
          />
        </span>
      </span>
    </span>
  );
}

export function SchemeCard({
  scheme,
  selected,
  light,
  dark,
  onSelect,
}: {
  scheme: ColorScheme;
  selected: boolean;
  light: ThemeColors;
  dark: ThemeColors;
  onSelect: () => void;
}) {
  const label = scheme === "system" ? "System" : scheme === "light" ? "Light" : "Dark";
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-2 rounded-xl border bg-card p-2 pb-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        selected
          ? "border-focus-ring text-foreground ring-1 ring-focus-ring"
          : "border-border/60 text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden rounded-lg border border-border/60">
        {scheme === "system" ? (
          <>
            <span className="absolute inset-0">
              <MiniWindow colors={light} />
            </span>
            <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
              <MiniWindow colors={dark} />
            </span>
          </>
        ) : (
          <MiniWindow colors={scheme === "light" ? light : dark} />
        )}
      </span>
      <span className={selected ? "font-medium" : undefined}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Theme orbs (ported from Otter Code's ThemePreviewCircles).
// ---------------------------------------------------------------------------

const ORB_SPEC = {
  light: {
    baseTarget: "#ffffff",
    accent: { center: "72% 22%", middleOffset: 28, middleOpacity: 72, endOffset: 58 },
    action: { center: "18% 82%", startOpacity: 45, endOffset: 55 },
  },
  dark: {
    baseTarget: "#09090b",
    accent: { center: "28% 78%", middleOffset: 28, middleOpacity: 62, endOffset: 58 },
    action: { center: "82% 18%", startOpacity: 45, endOffset: 55 },
  },
} as const;

function orbStyle(colors: ThemeColors, mode: ThemeAppearance): CSSProperties {
  const spec = ORB_SPEC[mode];
  return {
    backgroundColor: `color-mix(in oklab, ${colors.canvas} 80%, ${spec.baseTarget})`,
    backgroundImage: [
      `radial-gradient(circle at ${spec.accent.center} in oklab, ${colors.accent} 0%, color-mix(in oklab, ${colors.accent} ${spec.accent.middleOpacity}%, transparent) ${spec.accent.middleOffset}%, transparent ${spec.accent.endOffset}%)`,
      `radial-gradient(circle at ${spec.action.center} in oklab, color-mix(in oklab, ${colors.messageAction} ${spec.action.startOpacity}%, transparent) 0%, transparent ${spec.action.endOffset}%)`,
    ].join(", "),
    filter: "blur(3px)",
    transform: "scale(1.1)",
  };
}

function ThemeOrb({
  theme,
  mode,
  picked,
  onPick,
}: {
  theme: ThemeDefinition;
  mode: ThemeAppearance;
  picked: boolean;
  onPick: () => void;
}) {
  const colors = themeColors(theme.id, mode);
  return (
    <HintTooltip label={mode === "light" ? "Use for light mode" : "Use for dark mode"}>
      <button
        type="button"
        aria-label={`Use ${theme.label} for ${mode} mode`}
        aria-pressed={picked}
        onClick={(e) => {
          e.stopPropagation();
          onPick();
        }}
        className={cn(
          "relative flex size-[68px] shrink-0 cursor-pointer items-center justify-center rounded-full p-1 outline-none transition-transform focus-visible:ring-2 focus-visible:ring-focus-ring",
          !picked && "hover:scale-105",
        )}
      >
        <span
          aria-hidden
          className="relative block size-14 overflow-hidden rounded-full border-2 border-canvas"
          style={{
            boxShadow:
              mode === "dark"
                ? "inset 0 0 0 1px rgb(255 255 255 / 0.14), 0 1px 2px rgb(0 0 0 / 0.18)"
                : "inset 0 0 0 1px rgb(0 0 0 / 0.10), 0 1px 2px rgb(0 0 0 / 0.08)",
          }}
        >
          <span className="absolute inset-0 rounded-full" style={orbStyle(colors, mode)} />
        </span>
        {picked ? (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: "inset 0 0 0 2px var(--ring)" }}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-5 items-center justify-center rounded-full border border-border/70 bg-canvas text-foreground shadow-sm"
            >
              {mode === "light" ? <SunIcon className="size-3" /> : <MoonIcon className="size-3" />}
            </span>
          </>
        ) : null}
      </button>
    </HintTooltip>
  );
}

export function ThemeCard({
  theme,
  pickedModes,
  onPick,
  action,
}: {
  theme: ThemeDefinition;
  pickedModes: ThemeAppearance[];
  onPick: (modes: ThemeAppearance[]) => void;
  /** A button by the label, shown while the card is hovered or focused. */
  action?: ReactNode;
}) {
  const active = pickedModes.length > 0;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Use ${theme.label} for light and dark mode`}
      onClick={() => onPick(["light", "dark"])}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(["light", "dark"]);
        }
      }}
      className={cn(
        "group/card flex cursor-pointer flex-col gap-2 rounded-xl border bg-card pb-3.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
        active ? "border-foreground/25" : "border-border/60 hover:border-input",
      )}
    >
      <div className="flex min-h-16 items-center justify-center gap-2.5 px-3 pt-3">
        {(["light", "dark"] as const).map((mode) => (
          <ThemeOrb
            key={mode}
            theme={theme}
            mode={mode}
            picked={pickedModes.includes(mode)}
            onPick={() => onPick([mode])}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 px-4">
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{theme.label}</span>
        {action ? (
          <span
            className="-my-1.5 -me-2 flex shrink-0 opacity-0 transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {action}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The Themes grid's last card: starts a theme of your own. */
function NewThemeCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col gap-2 rounded-xl border border-dashed border-input pb-3.5 text-muted-foreground outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      <span className="flex min-h-16 items-center justify-center px-3 pt-3">
        <span className="flex size-[68px] items-center justify-center">
          <PlusIcon className="size-5" />
        </span>
      </span>
      <span className="px-4 text-start text-sm">New theme</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Custom theme editor
// ---------------------------------------------------------------------------

/** A theme of your own to start from: `light` and `dark` are the themes whose colors it takes. */
function newCustomTheme(label: string, light: string, dark: string): CustomTheme {
  return {
    id: `custom-${crypto.randomUUID().slice(0, 8)}`,
    label,
    light: seedsFrom(themeColors(light, "light")),
    dark: seedsFrom(themeColors(dark, "dark")),
  };
}

/** What a deleted theme's appearances fall back to (apply-theme's `deleteCustomTheme`). */
const INITIAL_THEME_LABEL = APP_THEMES.find((t) => t.id === INITIAL_THEME_ID)?.label;

const SEED_ROWS: { key: keyof ThemeSeeds; label: string }[] = [
  { key: "background", label: "Background" },
  { key: "sidebar", label: "Sidebar" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
];

/** A theme's name and its four colors per appearance, with both previewed live. */
function ThemeEditor({
  theme,
  isNew,
  onClose,
}: {
  theme: CustomTheme;
  isNew: boolean;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(theme);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cell, setCell] = useState<{ mode: ThemeAppearance; key: keyof ThemeSeeds }>({
    mode: "light",
    key: "background",
  });
  const label = draft.label.trim();

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        title={isNew ? "New theme" : "Edit theme"}
        size="xl"
        confirmLabel="Save"
        confirmDisabled={!label}
        destructiveAction={
          isNew ? undefined : { label: "Delete", onClick: () => setConfirmDelete(true) }
        }
        onConfirm={() => {
          saveCustomTheme({ ...draft, label });
          // A new theme is worn at once; an edit leaves the picks alone.
          if (isNew)
            for (const mode of ["light", "dark"] as const) setThemeForAppearance(mode, draft.id);
        }}
      >
        <TextInput
          aria-label="Theme name"
          placeholder="Name"
          maxLength={40}
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        />
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_13rem] gap-6">
          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
            <span />
            {(["light", "dark"] as const).map((mode) => (
              <div key={mode} className="flex flex-col items-center gap-1.5 pb-1">
                <span className="block aspect-[16/10] w-full overflow-hidden rounded-lg border border-border/60">
                  <MiniWindow colors={customThemeColors(draft[mode], mode)} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {mode === "light" ? "Light" : "Dark"}
                </span>
              </div>
            ))}
            {SEED_ROWS.map((row) => (
              <SeedRow
                key={row.key}
                label={row.label}
                colors={[draft.light[row.key], draft.dark[row.key]]}
                selected={cell.key === row.key ? cell.mode : null}
                onSelect={(mode) => setCell({ mode, key: row.key })}
              />
            ))}
          </div>
          <HexColorField
            value={draft[cell.mode][cell.key]}
            onChange={(hex) =>
              setDraft((d) => ({ ...d, [cell.mode]: { ...d[cell.mode], [cell.key]: hex } }))
            }
          />
        </div>
      </Dialog>
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${theme.label}”?`}
        confirmLabel="Delete theme"
        confirmVariant="accent"
        onConfirm={() => {
          deleteCustomTheme(theme.id);
          onClose();
        }}
      >
        <Text variant="small">
          It's removed on all your devices, and {INITIAL_THEME_LABEL} takes its place wherever you
          wear it.
        </Text>
      </Dialog>
    </>
  );
}

function SeedRow({
  label,
  colors,
  selected,
  onSelect,
}: {
  label: string;
  colors: [light: string, dark: string];
  selected: ThemeAppearance | null;
  onSelect: (mode: ThemeAppearance) => void;
}) {
  return (
    <>
      <span className="text-sm text-muted-foreground">{label}</span>
      {(["light", "dark"] as const).map((mode, i) => (
        <button
          key={mode}
          type="button"
          aria-label={`${label}, ${mode}`}
          aria-pressed={selected === mode}
          onClick={() => onSelect(mode)}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2 rounded-lg border bg-surface-raised/60 px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus-ring",
            selected === mode
              ? "border-focus-ring ring-1 ring-focus-ring"
              : "border-border/70 hover:border-input",
          )}
        >
          <span
            className="size-4 shrink-0 rounded-full border border-foreground/15"
            style={{ backgroundColor: colors[i] }}
          />
          <span className="font-mono text-xs uppercase text-foreground">{colors[i]}</span>
        </button>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pane
// ---------------------------------------------------------------------------

/** The app's color scheme (System, Light, Dark), and a setter that syncs it with the account. */
export function useColorScheme(): [ColorScheme, (next: ColorScheme) => Promise<void>] {
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  const refreshThemeInfo = async () => {
    try {
      setThemeInfo(await window.desktopBridge.nativeTheme.getInfo());
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };
  useEffect(() => {
    void refreshThemeInfo();
  }, []);

  const scheme: ColorScheme = themeInfo?.themeSource ?? "system";
  const setScheme = async (next: ColorScheme) => {
    console.log("[Settings:setColorScheme]", { scheme: next });
    try {
      await window.desktopBridge.nativeTheme.setThemeSource(next);
      setSyncedPreference("otter:theme-source", next);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set color scheme: ${error}`);
    }
  };
  return [scheme, setScheme];
}

/** Whether the Dock icon shows the unread count (Mac app), on by default. */
function useDockBadge(): [boolean, (next: boolean) => Promise<void>] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!features.dockBadge) return;
    gmailApi
      .getSyncSettings()
      .then((settings) => setEnabled(settings.dockBadgeEnabled))
      .catch((error) => toast.error(`Failed to load Dock badge setting: ${error}`));
  }, []);
  const set = async (next: boolean) => {
    setEnabled(next);
    console.log("[Settings:setDockBadgeEnabled]", { checked: next });
    try {
      await gmailApi.setSyncSettings({ dockBadgeEnabled: next });
    } catch (error) {
      setEnabled(!next);
      toast.error(`Failed to change Dock badge: ${error}`);
    }
  };
  return [enabled, set];
}

export function AppearancePane() {
  const choice = useThemeChoice();
  const themes = useAppThemes();
  const [scheme, setScheme] = useColorScheme();
  const [dockBadge, setDockBadge] = useDockBadge();
  const [editing, setEditing] = useState<{ theme: CustomTheme; isNew: boolean } | null>(null);

  const panelAnimationDurationMs = usePanelAnimationDurationMs();
  const panelAnimationDurationRatio =
    (panelAnimationDurationMs - MIN_PANEL_ANIMATION_DURATION_MS) /
    (MAX_PANEL_ANIMATION_DURATION_MS - MIN_PANEL_ANIMATION_DURATION_MS);
  const panelAnimationDurationSliderStyle = {
    "--settings-slider-progress": `${panelAnimationDurationRatio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - panelAnimationDurationRatio}rem`,
  } as CSSProperties;

  const light = themeColors(choice.light, "light");
  const dark = themeColors(choice.dark, "dark");

  return (
    <SettingsPageContainer title="Appearance">
      <SettingsSection title="Color scheme" variant="plain">
        <div className="grid grid-cols-3 gap-3">
          {(["system", "light", "dark"] as const).map((s) => (
            <SchemeCard
              key={s}
              scheme={s}
              selected={scheme === s}
              light={light}
              dark={dark}
              onSelect={() => void setScheme(s)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Themes"
        description="Click a theme to use it everywhere, or a single orb for light or dark mode only, or make your own."
        variant="plain"
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {themes.map((theme) => {
            const custom = getCustomThemes().find((t) => t.id === theme.id);
            return (
              <ThemeCard
                key={theme.id}
                theme={theme}
                pickedModes={(["light", "dark"] as const).filter((m) => choice[m] === theme.id)}
                onPick={(modes) => {
                  for (const mode of modes) setThemeForAppearance(mode, theme.id);
                }}
                action={
                  custom ? (
                    <IconBtn
                      label={`Edit ${theme.label}`}
                      onClick={() => setEditing({ theme: custom, isNew: false })}
                    >
                      <PencilIcon />
                    </IconBtn>
                  ) : (
                    <IconBtn
                      label={`Duplicate ${theme.label}`}
                      onClick={() =>
                        setEditing({
                          theme: newCustomTheme(`${theme.label} copy`, theme.id, theme.id),
                          isNew: true,
                        })
                      }
                    >
                      <CopyIcon />
                    </IconBtn>
                  )
                }
              />
            );
          })}
          <NewThemeCard
            onClick={() =>
              setEditing({
                theme: newCustomTheme("New theme", choice.light, choice.dark),
                isNew: true,
              })
            }
          />
        </div>
        {editing ? (
          <ThemeEditor
            key={editing.theme.id}
            theme={editing.theme}
            isNew={editing.isNew}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Dock">
        <SettingsRow
          title="Show unread count on Dock icon"
          description={
            features.dockBadge
              ? "A badge with the number of unread messages in your inboxes."
              : "A badge with the number of unread messages in your inboxes. Available in the Mac app."
          }
          control={
            <Switch
              id="dockBadgeEnabled"
              checked={features.dockBadge && dockBadge}
              disabled={!features.dockBadge}
              onCheckedChange={(checked) => void setDockBadge(checked)}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Motion">
        <SettingsRow
          title="Panel animations"
          description="Set how fast panels open and close."
          control={
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <PanelAnimationsPreview durationMs={panelAnimationDurationMs} />
              <div className="flex w-full items-center gap-3">
                <output
                  className="min-w-16 rounded-lg bg-muted px-2 py-1 text-center font-mono text-xs tabular-nums text-foreground"
                  htmlFor="panel-animation-duration"
                >
                  {panelAnimationDurationMs} ms
                </output>
                <input
                  aria-label="Panel animation duration"
                  className="settings-slider min-w-0 flex-1"
                  id="panel-animation-duration"
                  max={MAX_PANEL_ANIMATION_DURATION_MS}
                  min={MIN_PANEL_ANIMATION_DURATION_MS}
                  onChange={(event) =>
                    setPanelAnimationDurationMs(Number(event.currentTarget.value))
                  }
                  step={25}
                  style={panelAnimationDurationSliderStyle}
                  type="range"
                  value={panelAnimationDurationMs}
                />
              </div>
            </div>
          }
          resetAction={
            panelAnimationDurationMs !== DEFAULT_PANEL_ANIMATION_DURATION_MS ? (
              <SettingResetButton
                label="panel animations"
                onClick={() => setPanelAnimationDurationMs(DEFAULT_PANEL_ANIMATION_DURATION_MS)}
              />
            ) : null
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
