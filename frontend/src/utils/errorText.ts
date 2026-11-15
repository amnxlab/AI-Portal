/**
 * Turn anything that was thrown into a sentence a person can act on.
 *
 * Three different shapes reach catch blocks in this app and only one of them
 * is an Error:
 *
 *   - axios rejections carry the server's words in response.data.message,
 *     which NestJS sends as a string for most failures and as an array of
 *     strings when the ValidationPipe rejects a DTO;
 *   - Ant Design forms reject with a plain object, { errorFields, values },
 *     which is not an error at all -- the form has already shown the problem
 *     next to the field;
 *   - everything else.
 *
 * `String(x)` on the middle one yields "[object Object]", which is how a
 * validation slip used to reach the user as an async crash with no clue in
 * it. This module exists so that can never happen again.
 */

/** Ant Design's form rejection: the fields are already marked in the UI. */
export interface AntdValidationError {
    errorFields: { name: (string | number)[]; errors: string[] }[];
    outOfDate?: boolean;
    values?: Record<string, unknown>;
}

export function isValidationError(e: unknown): e is AntdValidationError {
    return !!e && typeof e === 'object' && Array.isArray((e as AntdValidationError).errorFields);
}

/** The first field message, for when something must still be said out loud. */
export function validationSummary(e: AntdValidationError): string {
    const first = e.errorFields?.find((f) => f.errors?.length);
    return first?.errors?.[0] ?? 'Please check the highlighted fields.';
}

/**
 * A readable sentence for any thrown value. Never returns "[object Object]",
 * and never returns an empty string.
 */
export function errorText(e: unknown, fallback = 'Something went wrong.'): string {
    if (e === null || e === undefined) return fallback;

    if (isValidationError(e)) return validationSummary(e);

    if (typeof e === 'string') return e.trim() || fallback;

    if (typeof e === 'object') {
        const any = e as Record<string, any>;

        // axios: the server's own words first -- they are written for the user.
        const data = any.response?.data;
        if (data) {
            const m = data.message ?? data.error;
            if (Array.isArray(m) && m.length) return m.filter(Boolean).join('. ');
            if (typeof m === 'string' && m.trim()) return m.trim();
        }

        // A network failure has no response at all, which is worth saying:
        // "something went wrong" sends people hunting for a bug that is not there.
        if (any.isAxiosError && !any.response) {
            return any.code === 'ECONNABORTED'
                ? 'The server took too long to answer. It may still have saved the change — reload before trying again.'
                : 'Could not reach the server. Check the connection and try again.';
        }

        const status = any.response?.status;
        if (typeof any.message === 'string' && any.message.trim()) {
            return status ? `${any.message.trim()} (HTTP ${status})` : any.message.trim();
        }
        if (status) return `The server refused the request (HTTP ${status}).`;

        // Last resort: show *something* specific rather than [object Object].
        try {
            const json = JSON.stringify(e);
            if (json && json !== '{}') return json.length > 300 ? json.slice(0, 300) + '…' : json;
        } catch {
            /* circular or otherwise unserialisable */
        }
    }

    return fallback;
}
