import { HexColorInput, HexColorPicker } from "react-colorful";
import { normalizeHex } from "@otter-mail/shared/custom-themes";

/**
 * A color as "#rrggbb": a spectrum (saturation and brightness, then hue) to
 * pick from, and the hex to type. Only whole colors reach `onChange`.
 */
export function HexColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const emit = (next: string) => {
    const hex = normalizeHex(next);
    if (hex && hex !== value) onChange(hex);
  };
  return (
    <div className="hex-color-field flex flex-col gap-3">
      <HexColorPicker color={value} onChange={emit} style={{ width: "100%", height: "11rem" }} />
      {/* Looks like settings' TextInput; react-colorful renders its own <input>. */}
      <HexColorInput
        prefixed
        color={value}
        onChange={emit}
        aria-label="Hex color"
        spellCheck={false}
        className="h-8 w-full min-w-0 rounded-lg border border-border/70 bg-surface-raised/60 px-[calc(--spacing(2.75)-1px)] font-mono text-sm uppercase text-foreground outline-none transition-[box-shadow,border-color,background-color] focus-visible:border-focus-ring/60 focus-visible:bg-canvas focus-visible:ring-[3px] focus-visible:ring-focus-ring/16"
      />
    </div>
  );
}
