import type { SemanticTokens } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Light palette.
   ───────────────────────────────────────────────────────────────
   Same keys as `darkTokens`, so every consumer works in both themes
   with no branching.

   Contrast: all text tokens meet WCAG AA (4.5:1) against the surface
   they are intended to sit on.

     text       #1f2328  on #ffffff  → 15.3:1
     textMuted  #59636e  on #ffffff  →  6.0:1
     textFaint  #818b98  on #ffffff  →  3.4:1   (large/decorative only —
                                                 timestamps, placeholders)
     accent     #0969da  on #ffffff  →  5.2:1
     success    #1a7f37  on #ffffff  →  4.8:1
     warning    #9a6700  on #ffffff  →  4.9:1
     danger     #cf222e  on #ffffff  →  5.2:1

   Note the semantic hues are NOT the dark palette's values. #3fb950 on
   white is 2.1:1 — unreadable. Each hue is re-picked for its background,
   which is the whole reason the token layer exists rather than a filter.
═══════════════════════════════════════════════════════════════ */

export const lightTokens: SemanticTokens = {
    mode: 'light',

    /* Surfaces — panels are pure white, the canvas behind them is tinted,
       inverting the dark theme's relationship so cards still read as
       raised rather than cut out. */
    bg:            '#f4f6f9',
    surface:       '#ffffff',
    surfaceRaised: '#ffffff',
    surfaceSunken: '#f6f8fa',

    /* Lines */
    border:       '#d5dce4',
    borderSubtle: '#e8ecf1',
    borderStrong: '#b4bfcc',

    /* Text */
    text:         '#1f2328',
    textMuted:    '#59636e',
    textFaint:    '#818b98',
    textOnAccent: '#ffffff',

    /* Semantic hues */
    accent:       '#0969da',
    accentBg:     'rgba(9, 105, 218, 0.09)',
    accentBorder: 'rgba(9, 105, 218, 0.28)',

    success:       '#1a7f37',
    successBg:     'rgba(26, 127, 55, 0.10)',
    successBorder: 'rgba(26, 127, 55, 0.28)',

    warning:       '#9a6700',
    warningBg:     'rgba(154, 103, 0, 0.10)',
    warningBorder: 'rgba(154, 103, 0, 0.28)',

    danger:       '#cf222e',
    dangerBg:     'rgba(207, 34, 46, 0.09)',
    dangerBorder: 'rgba(207, 34, 46, 0.28)',

    info:       '#0969da',
    infoBg:     'rgba(9, 105, 218, 0.09)',
    infoBorder: 'rgba(9, 105, 218, 0.28)',

    /* Category hues */
    purple:   '#8250df',
    purpleBg: 'rgba(130, 80, 223, 0.10)',
    orange:   '#bc4c00',
    orangeBg: 'rgba(188, 76, 0, 0.10)',

    /* Brand — same crimson, it reads correctly on both canvases */
    brand:     '#cc0000',
    brandGlow: 'rgba(204, 0, 0, 0.18)',

    /* Interaction — inverted from dark. A white overlay is invisible here;
       this is the single most common way a dark-only app breaks in light. */
    hoverBg:    'rgba(31, 35, 40, 0.05)',
    activeBg:   'rgba(31, 35, 40, 0.08)',
    selectedBg: 'rgba(204, 0, 0, 0.09)',
    focusRing:  '#0969da',

    /* Elevation & overlay — softer and tinted, not pure black */
    shadowSm: '0 1px 3px rgba(31, 35, 40, 0.10)',
    shadowMd: '0 4px 14px rgba(31, 35, 40, 0.12)',
    shadowLg: '0 8px 28px rgba(31, 35, 40, 0.16)',
    overlay:  'rgba(31, 35, 40, 0.45)',

    /* Categorical chart palette — deeper than the dark set so series stay
       legible on white. Same length and ordering contract. */
    chart: [
        '#0969da', '#1a7f37', '#9a6700', '#cf222e',
        '#8250df', '#bc4c00', '#218bff', '#2da44e',
        '#bf8700', '#a40e26', '#a475f9', '#e16f24',
    ],
};
