import { useContext } from 'react';
import { ThemeContext } from './themeContext';
import type { ThemeContextValue } from './themeContext';

/**
 * Access the active design tokens.
 *
 *   const { t } = useTheme();
 *   <div style={{ background: t.surface, color: t.text }} />
 *
 * This is the ONLY sanctioned way to get a colour into a component.
 * Hex literals outside `src/theme/` fail the CI grep gate — they look
 * fine in dark mode and break in light, which is precisely the failure
 * this indirection removes.
 */
export function useTheme(): ThemeContextValue {
    return useContext(ThemeContext);
}
