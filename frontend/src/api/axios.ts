import axios from 'axios';
import { useAuthStore } from '../store/authStore';

// VITE_API_URL is set by start-dev.sh before `npm run dev` runs.
// The '/api' relative fallback works for both dev (nginx proxies /api/ → :4000)
// and production (outer nginx does the same). Never fall back to plain
// http://localhost:4000 — browsers block HTTP sub-requests from HTTPS pages.
const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');

const api = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
});

// ── Dev logger ────────────────────────────────────────────────
// Gated on DEV. These previously ran in production builds, printing every
// request body, every response payload, and a prefix of the access token to
// the browser console on the deployed portal.
const DEBUG = import.meta.env.DEV;

const c = {
    req:    'color:#58a6ff;font-weight:700',
    ok:     'color:#3fb950;font-weight:700',
    warn:   'color:#d29922;font-weight:700',
    err:    'color:#f85149;font-weight:700',
    muted:  'color:#8b949e',
    token:  'color:#bc8cff',
    label:  'color:#e6edf3;font-weight:600',
};

function logRequest(config: any) {
    if (!DEBUG) return;
    const token = useAuthStore.getState().accessToken;
    const short = token ? `${token.slice(0, 20)}…` : 'none';
    console.groupCollapsed(
        `%c⬆ ${config.method?.toUpperCase()} %c${config.baseURL ?? ''}${config.url}`,
        c.req, c.label,
    );
    console.log('%cbase URL  ', c.muted, config.baseURL);
    console.log('%ctoken     ', c.token, short);
    if (config.params)  console.log('%cparams    ', c.muted, config.params);
    if (config.data) {
        // Handle FormData specially to avoid logging issues
        if (config.data instanceof FormData) {
            console.log('%cbody      ', c.muted, '[FormData]');
        } else {
            console.log('%cbody      ', c.muted,
                typeof config.data === 'string' ? JSON.parse(config.data) : config.data);
        }
    }
    console.groupEnd();
}

function logResponse(res: any) {
    if (!DEBUG) return;
    const status = res.status;
    const style  = status < 300 ? c.ok : status < 400 ? c.warn : c.err;
    console.groupCollapsed(
        `%c⬇ ${status} %c${res.config?.method?.toUpperCase()} ${res.config?.url}`,
        style, c.label,
    );
    console.log('%cdata      ', c.muted, res.data);
    console.groupEnd();
}

function logError(error: any) {
    if (!DEBUG) return;
    const status  = error.response?.status ?? 'NET';
    const url     = error.config?.url ?? '?';
    const method  = error.config?.method?.toUpperCase() ?? '?';
    const msg     = error.response?.data?.message ?? error.message;

    console.groupCollapsed(
        `%c✖ ${status} %c${method} ${url}  %c${msg}`,
        c.err, c.label, c.muted,
    );
    console.log('%cstatus    ', c.muted, status);
    console.log('%cresponse  ', c.muted, error.response?.data);
    console.log('%corigin    ', c.muted, window.location.origin);
    console.log('%cfull error', c.muted, error);
    console.groupEnd();
}

// ── Token refresh ─────────────────────────────────────────────
// All refresh calls go through one shared promise, so parallel requests that
// hit an expired access token trigger exactly ONE /auth/refresh request.
let refreshPromise: Promise<string> | null = null;

// Cross-tab token sync: when any tab refreshes, the others adopt the new
// access token immediately instead of firing their own refresh.
const authChannel: BroadcastChannel | null =
    typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('aiml-auth')
        : null;

authChannel?.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'token' && typeof event.data.token === 'string') {
        useAuthStore.getState().setToken(event.data.token);
    }
});

const refreshClient = axios.create({
    baseURL: API_BASE,
    withCredentials: true,
    timeout: 10_000,
});

/** True when the JWT expires within `skewMs` (default: one minute). */
function tokenExpiresSoon(token: string, skewMs = 60_000): boolean {
    try {
        const payloadPart = token.split('.')[1];
        if (!payloadPart) return false;
        const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
        const payload = JSON.parse(atob(padded));
        return typeof payload.exp === 'number'
            && payload.exp * 1000 - Date.now() <= skewMs;
    } catch {
        return false;
    }
}

/**
 * Exchanges the httpOnly refresh cookie for a new access token.
 * Single-flight per tab; the backend additionally tolerates concurrent
 * refreshes from multiple tabs for 30 s so the old rotation race cannot
 * log anyone out.
 */
function refreshAccessToken(): Promise<string> {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        const { data } = await refreshClient.post('/auth/refresh', {});
        const newToken = (data as any)?.accessToken;
        if (!newToken) throw new Error('Refresh response did not contain an access token');
        useAuthStore.getState().setToken(newToken);
        authChannel?.postMessage({ type: 'token', token: newToken });
        return newToken as string;
    })().finally(() => {
        refreshPromise = null;
    });

    return refreshPromise;
}

// Auth endpoints that should never trigger a token refresh attempt
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/forgot-password', '/auth/reset-password'];

// ── Request interceptor ───────────────────────────────────────
// Proactive refresh: if the access token is about to expire, renew it BEFORE
// sending the request. This removes the normal 15-minute 401 burst entirely.
let refreshCooldownUntil = 0;

api.interceptors.request.use(async (config) => {
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => config.url?.includes(path));
    let token = useAuthStore.getState().accessToken;

    if (token && !isAuthEndpoint && tokenExpiresSoon(token) && Date.now() > refreshCooldownUntil) {
        try {
            token = await refreshAccessToken();
        } catch {
            // Keep the current token — if it is still valid for a few seconds
            // the request may succeed; otherwise the 401 path handles it.
            // Cooldown avoids a refresh attempt on every queued request.
            refreshCooldownUntil = Date.now() + 10_000;
        }
    }

    if (token) config.headers.Authorization = `Bearer ${token}`;
    logRequest(config);
    return config;
});

// ── Response interceptor ──────────────────────────────────────
api.interceptors.response.use(
    (res) => {
        logResponse(res);
        return res;
    },
    async (error) => {
        logError(error);
        const original = error.config;
        const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => original?.url?.includes(path));

        if (error.response?.status === 401 && original && !original._retry && !isAuthEndpoint) {
            original._retry = true;

            if (DEBUG) console.warn('%c[AUTH] Access token rejected — refreshing…', c.warn);

            try {
                const newToken = await refreshAccessToken();
                if (DEBUG) console.log('%c[AUTH] Refresh OK — retrying request', c.ok);
                original.headers = original.headers ?? {};
                original.headers.Authorization = `Bearer ${newToken}`;
                return api(original);
            } catch (refreshError) {
                if (DEBUG) console.error('%c[AUTH] Refresh failed — signing out', c.err, refreshError);
                useAuthStore.getState().logout();

                const path = window.location.pathname;
                const isPublicAuthPage =
                    path === '/login' ||
                    path.startsWith('/forgot-password') ||
                    path.startsWith('/reset-password');
                if (!isPublicAuthPage) window.location.href = '/login';
                return Promise.reject(refreshError);
            }
        }

        return Promise.reject(error);
    },
);

export default api;
