import { QueryClient } from '@tanstack/react-query';

/* ═══════════════════════════════════════════════════════════════
   Query client configuration.
   ───────────────────────────────────────────────────────────────
   Sits on top of the existing axios instance (api/axios.ts) — it does
   not replace it. The refresh-token interceptor there still owns auth;
   Query only owns caching, deduplication, and mutation lifecycle.
═══════════════════════════════════════════════════════════════ */

export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Lab data changes on human timescales, and Socket.io already
            // pushes the urgent updates. 30s keeps navigation instant without
            // serving anything meaningfully stale.
            staleTime: 30_000,
            gcTime: 5 * 60_000,

            // The app is a long-lived internal dashboard people leave open in
            // a background tab. Refetching on focus is what makes returning to
            // it show current data instead of yesterday's.
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchOnMount: true,

            retry: (failureCount, error) => {
                const status = (error as { response?: { status?: number } })?.response?.status;
                // Never retry a deliberate refusal — 401 is handled by the axios
                // interceptor, and retrying 403/404 just delays the error toast.
                if (status && status >= 400 && status < 500) return false;
                return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
        },
        mutations: {
            // Mutations are user-initiated; a silent retry can duplicate a
            // create. Surface the failure instead and let the user decide.
            retry: false,
        },
    },
});
