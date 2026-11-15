import type { SemanticTokens } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Dark palette — the canonical one.
   ───────────────────────────────────────────────────────────────
   Two palettes were in the codebase before this file existed:

     Gen 1  "GitHub classic"  #0d1117 / #161b22 / #30363d / #e6edf3
     Gen 2  "premium dark"    #05080f / #0b0f1a / #1c2538 / #e8edf5

   Gen 2 wins: it already owned the AntD ConfigProvider theme, index.css,
   and the whole app shell, so keeping it means the chrome doesn't move.
   Gen 1 is retired — every one of its 29 files migrates to these values.
═══════════════════════════════════════════════════════════════ */

export const darkTokens: SemanticTokens = {
    mode: 'dark',

    /* Surfaces */
    bg:            '#05080f',
    surface:       '#0b0f1a',
    surfaceRaised: '#0f1522',
    surfaceSunken: '#070a12',

    /* Lines */
    border:       '#1c2538',
    borderSubtle: '#111826',
    borderStrong: '#2d3d58',

    /* Text */
    text:         '#e8edf5',
    textMuted:    '#7b8898',
    textFaint:    '#4a5568',
    textOnAccent: '#ffffff',

    /* Semantic hues — base for text/icons/borders, `Bg` for safe fills */
    accent:       '#58a6ff',
    accentBg:     'rgba(88, 166, 255, 0.12)',
    accentBorder: 'rgba(88, 166, 255, 0.32)',

    success:       '#3fb950',
    successBg:     'rgba(63, 185, 80, 0.13)',
    successBorder: 'rgba(63, 185, 80, 0.32)',

    warning:       '#d29922',
    warningBg:     'rgba(210, 153, 34, 0.13)',
    warningBorder: 'rgba(210, 153, 34, 0.32)',

    danger:       '#f85149',
    dangerBg:     'rgba(248, 81, 73, 0.13)',
    dangerBorder: 'rgba(248, 81, 73, 0.32)',

    info:       '#58a6ff',
    infoBg:     'rgba(88, 166, 255, 0.12)',
    infoBorder: 'rgba(88, 166, 255, 0.32)',

    /* Category hues */
    purple:   '#bc8cff',
    purpleBg: 'rgba(188, 140, 255, 0.13)',
    orange:   '#db6d28',
    orangeBg: 'rgba(219, 109, 40, 0.14)',

    /* Brand — SUU crimson */
    brand:     '#cc0000',
    brandGlow: 'rgba(204, 0, 0, 0.30)',

    /* Interaction */
    hoverBg:    'rgba(255, 255, 255, 0.05)',
    activeBg:   'rgba(255, 255, 255, 0.08)',
    selectedBg: 'rgba(204, 0, 0, 0.13)',
    focusRing:  '#58a6ff',

    /* Elevation & overlay */
    shadowSm: '0 1px 3px rgba(0, 0, 0, 0.40)',
    shadowMd: '0 4px 16px rgba(0, 0, 0, 0.45)',
    shadowLg: '0 8px 30px rgba(0, 0, 0, 0.50)',
    overlay:  'rgba(0, 0, 0, 0.65)',

    /* Categorical chart palette — bright enough to read on #05080f.
       Append only; consumers index modulo length. */
    chart: [
        '#58a6ff', '#3fb950', '#d29922', '#f85149',
        '#bc8cff', '#db6d28', '#79c0ff', '#56d364',
        '#e3b341', '#ff7b72', '#d2a8ff', '#ffa657',
    ],
};
