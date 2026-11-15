import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfigProvider, App as AntApp } from 'antd';
import type { SemanticTokens, ThemeMode } from './tokens';
import { darkTokens } from './dark';
import { lightTokens } from './light';
import { buildAntdTheme } from './antdTheme';
import { ThemeContext, THEME_STORAGE_KEY } from './themeContext';
import type { ThemeContextValue } from './themeContext';

type Preference = ThemeMode | 'system';

/**
 * Default preference while the page migration is in flight.
 *
 * MUST stay 'dark' until every page reads its colours from tokens.
 * Pages that still hardcode the old palette paint dark hex on what would
 * be a light surface — unreadable. Defaulting to 'system' would hand that
 * broken state to every user whose OS is set to light, without them ever
 * asking for light mode.
 *
 * Flip to 'system' once the grep gate in the plan returns zero:
 *     grep -rn "#[0-9a-fA-F]\{6\}" --include=*.tsx src | grep -v "^src/theme/"
 */
const DEFAULT_PREFERENCE: Preference = 'dark';

function readStoredPreference(): Preference {
    try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
    } catch {
        // Private mode / blocked site data — fall through to the default.
    }
    return DEFAULT_PREFERENCE;
}

function systemMode(): ThemeMode {
    return typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark';
}

/**
 * Publish every token as a CSS custom property on <html>.
 *
 * This is what lets `index.css` (and any future stylesheet) stay theme-aware
 * without duplicating values — it reads `var(--surface)` instead of hardcoding
 * a hex, so there is exactly one place a colour is defined.
 */
function applyCssVariables(t: SemanticTokens) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(t)) {
        if (key === 'mode' || Array.isArray(value)) continue;
        // camelCase → kebab-case:  surfaceRaised → --surface-raised
        const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        root.style.setProperty(`--${name}`, String(value));
    }
    t.chart.forEach((c, i) => root.style.setProperty(`--chart-${i}`, c));

    // Drives native form controls, scrollbars, and the browser's own UI.
    root.style.setProperty('color-scheme', t.mode);
    root.setAttribute('data-theme', t.mode);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [preference, setPreferenceState] = useState<Preference>(readStoredPreference);
    const [resolvedSystem, setResolvedSystem] = useState<ThemeMode>(systemMode);

    // Track OS changes so `'system'` stays live rather than being read once.
    useEffect(() => {
        const mq = window.matchMedia?.('(prefers-color-scheme: light)');
        if (!mq) return;
        const onChange = () => setResolvedSystem(mq.matches ? 'light' : 'dark');
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    const mode: ThemeMode = preference === 'system' ? resolvedSystem : preference;
    const t = mode === 'light' ? lightTokens : darkTokens;

    useEffect(() => { applyCssVariables(t); }, [t]);

    const setPreference = useCallback((p: Preference) => {
        setPreferenceState(p);
        try { localStorage.setItem(THEME_STORAGE_KEY, p); } catch { /* non-fatal */ }
    }, []);

    const toggle = useCallback(() => {
        setPreference(mode === 'dark' ? 'light' : 'dark');
    }, [mode, setPreference]);

    const antdTheme = useMemo(() => buildAntdTheme(t), [t]);

    const value = useMemo<ThemeContextValue>(
        () => ({ t, preference, mode, setPreference, toggle }),
        [t, preference, mode, setPreference, toggle],
    );

    return (
        <ThemeContext.Provider value={value}>
            <ConfigProvider theme={antdTheme}>
                {/* AntApp supplies the context that `useNotify()` reads. Without it
                    message/modal/notification fall back to the static API, which
                    does not consume ConfigProvider and renders unthemed. */}
                <AntApp>{children}</AntApp>
            </ConfigProvider>
        </ThemeContext.Provider>
    );
}
