import { useCallback, useState } from 'react';
import type { DisplayPreferences } from '../utils/format';
import { readPreferences, writePreferences } from '../utils/format';

/**
 * Reactive wrapper around the localStorage-backed display preferences in
 * utils/format.ts. Plain `readPreferences()`/`writePreferences()` calls
 * don't trigger a re-render on their own — this hook adds the React state
 * needed for a Settings page control to actually reflect a change.
 */
export function usePreferences() {
    const [prefs, setPrefs] = useState<DisplayPreferences>(readPreferences);

    const update = useCallback(<K extends keyof DisplayPreferences>(key: K, value: DisplayPreferences[K]) => {
        setPrefs((prev) => {
            const next = { ...prev, [key]: value };
            writePreferences(next);
            return next;
        });
    }, []);

    return { prefs, update };
}
