/* ═══════════════════════════════════════════════════════════════
   Design token contract
   ───────────────────────────────────────────────────────────────
   The single source of truth for every colour in the app.

   RULES
   ─────
   1. This file contains NO colour literals. It defines the shape only.
      Concrete values live in `dark.ts` and `light.ts`.
   2. No `.tsx` file outside `src/theme/` may contain a hex literal.
      Read colours via `useTheme()` instead — see `useTheme.ts`.
      A grep gate in CI enforces this; a missed hex is invisible in dark
      mode and glaring in light mode, which is exactly the class of bug
      this layer exists to prevent.
   3. Names are semantic (`danger`), not descriptive (`red`). The two
      exceptions are `purple` / `orange`, which the app uses as category
      hues with no semantic meaning attached.
═══════════════════════════════════════════════════════════════ */

export type ThemeMode = 'dark' | 'light';

export interface SemanticTokens {
    /** Which palette this is. Useful for the rare branch that genuinely
     *  needs to differ structurally rather than just chromatically. */
    mode: ThemeMode;

    /* ── Surfaces ──────────────────────────────────────────────
       bg            page canvas, behind everything
       surface       cards, panels, the sidebar
       surfaceRaised popovers, dropdowns, nested panels
       surfaceSunken form inputs, code blocks, wells                    */
    bg: string;
    surface: string;
    surfaceRaised: string;
    surfaceSunken: string;

    /* ── Lines ────────────────────────────────────────────────
       border        the default visible edge
       borderSubtle  quieter dividers inside an already-bordered box   */
    border: string;
    borderSubtle: string;
    borderStrong: string;

    /* ── Text ─────────────────────────────────────────────────
       text          body copy and headings
       textMuted     secondary copy, labels, captions
       textFaint     timestamps, placeholders, disabled                */
    text: string;
    textMuted: string;
    textFaint: string;
    /** Text that sits on top of a saturated fill (accent/success/danger). */
    textOnAccent: string;

    /* ── Semantic hues ────────────────────────────────────────
       Each has a base (for text/icons/borders) and a `Bg` (a low-alpha
       tint safe to use as a fill in BOTH themes). Never build a fill by
       string-concatenating alpha onto the base — use the `Bg` variant or
       the `alpha()` helper, or light mode washes out.                  */
    accent: string;
    accentBg: string;
    accentBorder: string;

    success: string;
    successBg: string;
    successBorder: string;

    warning: string;
    warningBg: string;
    warningBorder: string;

    danger: string;
    dangerBg: string;
    dangerBorder: string;

    info: string;
    infoBg: string;
    infoBorder: string;

    /* ── Category hues (non-semantic) ─────────────────────────── */
    purple: string;
    purpleBg: string;
    orange: string;
    orangeBg: string;

    /* ── Brand ────────────────────────────────────────────────
       SUU crimson. Used for the selected-nav rail and logo glow only. */
    brand: string;
    brandGlow: string;

    /* ── Interaction ──────────────────────────────────────────
       These MUST be theme-specific. The old code hardcoded
       `rgba(255,255,255,0.05)` for hover, which is invisible on a light
       background — the most common way a dark-only app breaks in light. */
    hoverBg: string;
    activeBg: string;
    selectedBg: string;
    focusRing: string;

    /* ── Elevation & overlay ──────────────────────────────────── */
    shadowSm: string;
    shadowMd: string;
    shadowLg: string;
    overlay: string;

    /* ── Data visualisation ───────────────────────────────────
       Ordered categorical palette for charts, project badges, and any
       other "colour by series" need. Consumers index into it modulo
       length, so order is stable API — append, never reorder.          */
    chart: readonly string[];
}

/* ── Shared scale ──────────────────────────────────────────────
   Non-colour design values. Identical across themes, so they live here
   rather than being duplicated in each palette.                        */
export const radius = {
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    pill: 999,
} as const;

export const space = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
} as const;

export const fontSize = {
    xs: 11,
    sm: 12,
    md: 13,
    base: 14,
    lg: 16,
    xl: 20,
    xxl: 24,
} as const;

export const fontFamily =
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export const fontFamilyMono =
    "'SFMono-Regular', ui-monospace, Consolas, 'Liberation Mono', Menlo, monospace";

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * Apply an alpha channel to a token colour.
 *
 * Prefer this over the `${color}22` hex-suffix trick the codebase used
 * previously: that only works for 6-digit hex, silently produces an
 * invalid colour for `rgb()`/`hsl()` values, and reads as a magic number.
 *
 *   alpha(t.accent, 0.12)  →  'rgba(88, 166, 255, 0.12)'
 */
export function alpha(color: string, a: number): string {
    const hex = color.trim();
    if (hex.startsWith('#')) {
        const h = hex.slice(1);
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
        const n = parseInt(full, 16);
        if (Number.isNaN(n)) return color;
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
    }
    // Already a functional colour — let the caller's value through untouched
    // rather than producing something the browser will drop.
    return color;
}

/**
 * Pick a readable foreground for an arbitrary background colour.
 * Used where a colour is data-driven (custom role colours, project hues)
 * and we cannot know at author time whether it is light or dark.
 */
export function readableOn(background: string, tokens: SemanticTokens): string {
    const hex = background.trim();
    if (!hex.startsWith('#')) return tokens.text;
    const h = hex.slice(1);
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
    const n = parseInt(full, 16);
    if (Number.isNaN(n)) return tokens.text;
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    // Relative luminance, sRGB coefficients.
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#101418' : '#ffffff';
}
