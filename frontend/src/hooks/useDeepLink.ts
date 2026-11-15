import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * Reads the record a link was pointing at.
 *
 * Navigation used to carry the target only in React Router's `state`, which
 * lives in the history entry and nothing else: it survives a click, and is
 * gone the moment the page is refreshed, the URL is copied to somebody else,
 * or the link is opened in a new tab. All three are things people do with a
 * link to a specific report.
 *
 * The query string is now the carrier, and `state` is still read so older
 * links and any navigation not yet converted keep working.
 *
 * @param param    the query parameter to read, e.g. 'reportId'
 * @param stateKey the legacy `state` key, e.g. 'openReportId'
 */
export function useDeepLinkId(param: string, stateKey?: string): string | undefined {
    const [searchParams] = useSearchParams();
    const location = useLocation();

    const fromUrl = searchParams.get(param);
    if (fromUrl) return fromUrl;

    if (stateKey) {
        const fromState = (location.state as Record<string, unknown> | null)?.[stateKey];
        if (typeof fromState === 'string' && fromState) return fromState;
    }
    return undefined;
}

/** A plain query parameter, for context carried alongside an id (a week, a filter). */
export function useDeepLinkParam(param: string): string | undefined {
    const [searchParams] = useSearchParams();
    return searchParams.get(param) ?? undefined;
}

/**
 * Builds a deep link. Keeps callers from assembling query strings by hand and
 * getting the encoding or the separator wrong.
 */
export function deepLink(path: string, params: Record<string, string | null | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v) qs.set(k, v);
    }
    const query = qs.toString();
    return query ? `${path}?${query}` : path;
}

/**
 * Where to send somebody after they sign in, from `?next=`.
 *
 * Only ever an internal path. A value that names a host — `//evil.test`,
 * `https://evil.test`, or anything with a backslash that a browser may
 * normalise into a slash — is discarded, because this value comes from a
 * URL anyone can write and it ends up in a redirect.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/home'): string {
    if (!raw) return fallback;
    let next = raw;
    try {
        next = decodeURIComponent(raw);
    } catch {
        return fallback;          // malformed percent-encoding
    }
    if (!next.startsWith('/')) return fallback;       // not a path at all
    if (next.startsWith('//')) return fallback;       // protocol-relative
    if (next.includes('\\')) return fallback;         // normalises to //
    if (next.startsWith('/login')) return fallback;   // no loop back to here
    return next;
}
