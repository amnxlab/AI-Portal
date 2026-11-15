import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getBudgetYears } from '../../api/budget';
import type { BudgetYearSummary } from '../../api/budget';

/**
 * Which budget year the Budget module is showing.
 *
 * Every tab reads the selected year from here and passes it to the API, so
 * switching years moves the whole module at once and no two tabs can end up
 * showing different years. `readOnly` is the archived-year flag: the server
 * refuses writes to a closed year regardless, and this is what lets the UI
 * stop offering them in the first place.
 */
interface BudgetYearState {
    years: BudgetYearSummary[];
    selected: BudgetYearSummary | null;
    selectedId: string | undefined;
    activeYear: BudgetYearSummary | null;
    readOnly: boolean;
    loading: boolean;
    select: (id: string) => void;
    refresh: () => Promise<void>;
}

const Ctx = createContext<BudgetYearState>({
    years: [], selected: null, selectedId: undefined, activeYear: null,
    readOnly: false, loading: true,
    select: () => { }, refresh: async () => { },
});

export const useBudgetYear = () => useContext(Ctx);

export function BudgetYearProvider({ children }: { children: ReactNode }) {
    const [years, setYears] = useState<BudgetYearSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const list = await getBudgetYears();
            setYears(list);
            setSelectedId((current) => {
                // Keep the year the user is looking at if it still exists;
                // otherwise fall back to the one that is open.
                if (current && list.some((y) => y.id === current)) return current;
                return list.find((y) => y.status === 'active')?.id ?? list[0]?.id;
            });
        } catch {
            setYears([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const value = useMemo<BudgetYearState>(() => {
        const selected = years.find((y) => y.id === selectedId) ?? null;
        return {
            years,
            selected,
            selectedId,
            activeYear: years.find((y) => y.status === 'active') ?? null,
            readOnly: selected ? selected.status !== 'active' : false,
            loading,
            select: setSelectedId,
            refresh,
        };
    }, [years, selectedId, loading, refresh]);

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
