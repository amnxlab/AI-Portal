import { lazy } from 'react';
import type { ComponentType } from 'react';

/**
 * Lazily loads a route, surviving a deployment that happened mid-session.
 *
 * Every page is a separate chunk whose filename carries a content hash
 * (`LoginPage-9D0Cq1Ia.js`). When the portal is redeployed those hashes
 * change and the previous files are gone. A browser tab that loaded the old
 * `index.html` still holds the old names, so the first navigation to a page
 * it has not visited yet asks for a file that no longer exists:
 *
 *   error loading dynamically imported module: .../assets/LoginPage-9D0Cq1Ia.js
 *
 * That was the error people kept seeing, on any page, and the error boundary
 * behind it offered "Retry" — which re-ran the same import for the same
 * missing file and failed identically.
 *
 * A reload is the actual fix: it fetches the current `index.html`, which
 * points at chunks that exist. The nginx config now sends `index.html` with
 * `no-store` so that reload cannot be served a stale copy from cache.
 *
 * The one-shot flag matters. If the import fails for any other reason — a
 * genuine syntax error in the chunk, the user being offline — reloading
 * repeatedly would spin forever. So each chunk gets exactly one automatic
 * reload per tab; a second failure is re-thrown and the boundary explains it.
 */

const RELOAD_FLAG_PREFIX = 'chunk-reload:';

/** Did we already try reloading for this chunk in this tab? */
function alreadyRetried(key: string): boolean {
    try {
        return sessionStorage.getItem(RELOAD_FLAG_PREFIX + key) === '1';
    } catch {
        // Private windows and blocked storage throw. Without somewhere to
        // record the attempt we cannot guarantee a single retry, so treat it
        // as already retried and let the boundary handle it rather than risk
        // a reload loop.
        return true;
    }
}

function markRetried(key: string): void {
    try {
        sessionStorage.setItem(RELOAD_FLAG_PREFIX + key, '1');
    } catch {
        /* nothing to do — see alreadyRetried */
    }
}

/** Clears the flags once a load has succeeded, so a later deploy can retry. */
function clearRetried(key: string): void {
    try {
        sessionStorage.removeItem(RELOAD_FLAG_PREFIX + key);
    } catch {
        /* ignore */
    }
}

/**
 * True for the browser-specific ways "the chunk is missing" is reported.
 * Chrome, Firefox and Safari each word it differently, and a stale chunk can
 * also come back as the SPA's own index.html, which fails to parse as a
 * module.
 */
export function isChunkLoadError(error: unknown): boolean {
    const message = String((error as Error)?.message ?? error ?? '');
    const name = String((error as Error)?.name ?? '');
    return (
        name === 'ChunkLoadError'
        || /error loading dynamically imported module/i.test(message)
        || /Failed to fetch dynamically imported module/i.test(message)
        || /Importing a module script failed/i.test(message)
        || /Loading chunk [\w-]+ failed/i.test(message)
        || /expected a JavaScript(-or-Wasm)? module script/i.test(message)
        || /Unexpected token '<'/.test(message)
    );
}

/**
 * Drop-in replacement for React.lazy for route-level chunks.
 *
 * @param key    a stable name for the chunk, used for the one-shot flag
 * @param loader the dynamic import
 */
export function lazyWithReload<T extends ComponentType<any>>(
    key: string,
    loader: () => Promise<{ default: T }>,
) {
    return lazy(async () => {
        try {
            const mod = await loader();
            clearRetried(key);
            return mod;
        } catch (error) {
            if (isChunkLoadError(error) && !alreadyRetried(key)) {
                markRetried(key);
                // Replace rather than reload: the current history entry may
                // itself have come from a stale document, and this keeps the
                // user on the page they asked for.
                window.location.replace(window.location.href);
                // Never resolves — the document is being replaced. Returning
                // a component here would render it for a frame first.
                return new Promise<{ default: T }>(() => { });
            }
            throw error;
        }
    });
}
