import SwiftUI

/**
 * A theme made on the Mac or the web from four colors per appearance, synced
 * as the account's "otter:custom-themes" ui preference. The phone wears them
 * and lets you pick them, but never edits them.
 */
struct CustomTheme: Decodable {
    struct Seeds: Decodable {
        let background, sidebar, text, accent: String

        /** Every seed as lowercase "#rrggbb" ("#abc" expanded), or nil if one isn't hex: TS's normalizeHex. */
        var normalized: Seeds? {
            let seeds = [background, sidebar, text, accent].compactMap(Self.normalize)
            guard seeds.count == 4 else { return nil }
            return Seeds(background: seeds[0], sidebar: seeds[1], text: seeds[2], accent: seeds[3])
        }

        private static func normalize(_ value: String) -> String? {
            var digits = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if digits.hasPrefix("#") { digits.removeFirst() }
            guard digits.allSatisfy({ "0123456789abcdef".contains($0) }) else { return nil }
            if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
            return digits.count == 6 ? "#" + digits : nil
        }
    }

    let id: String
    let label: String
    let light: Seeds
    let dark: Seeds

    var theme: Theme {
        Theme(
            id: id, label: label, exact: true, monochrome: true,
            light: Self.roles(light, .light), dark: Self.roles(dark, .dark)
        )
    }

    /** The stored list as themes; entries that don't hold up are dropped. */
    static func themes(_ raw: String?) -> [Theme] {
        struct Entry: Decodable {
            let theme: CustomTheme?
            init(from decoder: Decoder) throws { theme = try? CustomTheme(from: decoder) }
        }
        guard let data = raw?.data(using: .utf8), let entries = try? JSONDecoder().decode([Entry].self, from: data)
        else { return [] }
        return entries.compactMap(\.theme).compactMap { entry in
            guard entry.id.hasPrefix("custom-"), !entry.label.isEmpty,
                  let light = entry.light.normalized, let dark = entry.dark.normalized
            else { return nil }
            return CustomTheme(id: entry.id, label: entry.label, light: light, dark: dark).theme
        }
    }

    /**
     * Every role, as "#rrggbb", grown from the four seeds by blending in Oklab.
     * Keep in step with packages/shared/src/custom-themes.ts: every role must
     * come out the same hex as there.
     */
    static func roles(_ seeds: Seeds, _ scheme: ColorScheme) -> [String: String] {
        let hex = { (css: String) in RGB(css: css).hex }
        let lightness = { (css: String) in RGB(css: css).lightness }
        // Keeps `keep` of `x`, the rest `y`.
        let mix = { (x: String, y: String, keep: Double) in RGB(css: x).mixed(toward: RGB(css: y), keep: keep).hex }
        let (B, S, T, A) = (hex(seeds.background), hex(seeds.sidebar), hex(seeds.text), hex(seeds.accent))
        let otter = Theme.named("otter")
        let stock = { (role: String) in (scheme == .dark ? otter?.dark : otter?.light)?[role] ?? "#808080" }
        // The preferred color, unless it is too close in lightness to what it sits on.
        let readable = { (on: String, preferred: String) in
            abs(lightness(on) - lightness(preferred)) >= 0.4 ? preferred : lightness(on) > 0.6 ? "#111111" : "#ffffff"
        }
        let ink = { (keep: Double) in mix(T, B, keep) }
        let sidebarText = readable(S, T)
        let sidebarInk = { (keep: Double) in mix(sidebarText, S, keep) }
        let onAccent = readable(A, "#ffffff")

        return [
            // The background and the text itself.
            "canvas": B,
            "chrome": B,
            "toolbar": B,
            "terminalBackground": B,
            "text": T,
            "toolbarForeground": T,
            "toolbarControlForeground": T,
            "secondaryForeground": T,
            "accentSurfaceForeground": T,
            "messageForeground": T,
            "codeForeground": T,
            "terminalForeground": T,
            "terminalCursor": T,
            // Quieter text.
            "textMuted": ink(0.62),
            "mutedForeground": ink(0.62),
            "secondaryLabel": ink(0.62),
            "iconMuted": ink(0.55),
            "placeholder": ink(0.46),
            // Surfaces: a touch of text over the background.
            "muted": ink(0.04),
            "surface": ink(0.03),
            "toolbarControl": ink(0.03),
            "surfaceRaised": ink(0.05),
            "secondary": ink(0.05),
            "codeBackground": ink(0.05),
            "surfaceOverlay": scheme == .light ? B : ink(0.06),
            "accentSurface": ink(0.07),
            "toolbarControlHover": ink(0.07),
            "messageSurface": ink(0.08),
            // Lines.
            "border": ink(0.1),
            "toolbarBorder": ink(0.1),
            "input": ink(0.16),
            "terminalScrollbar": ink(0.15),
            "terminalScrollbarHover": ink(0.25),
            // The accent.
            "accent": A,
            "focus": A,
            "messageAction": A,
            "update": A,
            "updateForeground": A,
            "accentForeground": onAccent,
            "messageActionForeground": onAccent,
            "messageActionHover": mix(A, B, 0.88),
            "updateSurface": mix(A, B, 0.14),
            "terminalSelection": mix(A, B, 0.25),
            // Errors and warnings keep Otter's colors, on this background.
            "error": hex(stock("error")),
            "errorForeground": hex(stock("errorForeground")),
            "errorSurface": mix(stock("error"), B, 0.12),
            "warning": hex(stock("warning")),
            "warningForeground": hex(stock("warningForeground")),
            "warningSurface": mix(stock("warning"), B, 0.1),
            // The sidebar, with text that reads on it.
            "sidebar": S,
            "sidebarForeground": sidebarText,
            "sidebarMutedForeground": sidebarInk(0.62),
            "sidebarRowHover": sidebarInk(0.04),
            "sidebarControlSurface": sidebarInk(0.06),
            "sidebarRowSelected": sidebarInk(0.06),
            "sidebarRowActive": sidebarInk(0.08),
            "sidebarBorder": sidebarInk(0.07),
        ]
    }
}
