import { createContext } from 'react';
import type { SemanticTokens, ThemeMode } from './tokens';
import { darkTokens } from './dark';

export interface ThemeContextValue {
    /** Active token set. Read colours from here, never from a hex literal. */
    t: SemanticTokens;
    /** The user's stored preference. `'system'` follows the OS setting. */
    preference: ThemeMode | 'system';
    /** The mode actually being rendered, after resolving `'system'`. */
    mode: ThemeMode;
    setPreference: (p: ThemeMode | 'system') => void;
    /** Flip between light and dark, pinning the result (leaves `'system'`). */
    toggle: () => void;
}

/* Defaults to dark so that a component rendered outside the provider —
   which shouldn't happen, but does in tests and Storybook-style isolation —
   still gets a usable token set instead of throwing. */
export const ThemeContext = createContext<ThemeContextValue>({
    t: darkTokens,
    preference: 'system',
    mode: 'dark',
    setPreference: () => {},
    toggle: () => {},
});

export const THEME_STORAGE_KEY = 'aiml-portal-theme';
