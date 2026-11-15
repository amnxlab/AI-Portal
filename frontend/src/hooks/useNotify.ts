import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { App } from 'antd';

/* ═══════════════════════════════════════════════════════════════
   Toast / dialog feedback.
   ───────────────────────────────────────────────────────────────
   WHY THIS EXISTS

   The app previously made 276 calls to AntD's *static* `message.*` API
   (`import { message } from 'antd'`). In AntD v5+ the static methods are
   detached from the React tree: they do not consume ConfigProvider, so
   every one of those toasts rendered with default styling regardless of
   the app theme. With a light theme in play the problem doubles.

   `App.useApp()` returns context-aware instances instead. This hook wraps
   them so call sites read almost identically to the old static API:

       const notify = useNotify();
       notify.success('Task updated');
       notify.error(err, 'Save failed');      // ← unwraps axios errors

   Requires <AntApp> above it in the tree — supplied by ThemeProvider.
═══════════════════════════════════════════════════════════════ */

/** Pull a human-readable message out of whatever an API call rejected with.
 *  Replaces ~100 hand-written `e?.response?.data?.message ?? '…'` chains. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
    if (typeof error === 'string') return error;

    const e = error as {
        response?: { data?: { message?: string | string[] }; status?: number };
        message?: string;
        code?: string;
    } | null | undefined;

    const data = e?.response?.data?.message;
    // NestJS validation pipes return an array of messages.
    if (Array.isArray(data)) return data.filter(Boolean).join(', ') || fallback;
    if (typeof data === 'string' && data.trim()) return data;

    // Distinguish "server said no" from "never reached the server" — the two
    // need different user action and the old code collapsed them.
    if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
        return 'Cannot reach the server. Check your connection and try again.';
    }
    if (e?.response?.status === 403) return 'You do not have permission to do that.';
    if (e?.response?.status === 404) return 'That item no longer exists.';

    return e?.message?.trim() || fallback;
}

export function useNotify() {
    const { message, modal, notification } = App.useApp();

    return useMemo(() => ({
        success: (content: string, key?: string) =>
            message.success(key ? { content, key } : content),

        /** Accepts either a string or a caught error. Errors are unwrapped
         *  via `errorMessage`, so call sites stop repeating that chain. */
        error: (contentOrError: unknown, fallback = 'Something went wrong', key?: string) => {
            const content = typeof contentOrError === 'string'
                ? contentOrError
                : errorMessage(contentOrError, fallback);
            return message.error(key ? { content, key } : content);
        },

        warning: (content: string, key?: string) =>
            message.warning(key ? { content, key } : content),

        info: (content: string, key?: string) =>
            message.info(key ? { content, key } : content),

        /** Returns the dismiss fn — call it when the work finishes. */
        loading: (content: string, key?: string) =>
            message.loading(key ? { content, key, duration: 0 } : { content, duration: 0 }),

        /** Promise-based confirm, so call sites can `await` instead of
         *  threading onOk/onCancel callbacks. */
        confirm: (options: {
            title: string;
            content?: ReactNode;
            okText?: string;
            cancelText?: string;
            danger?: boolean;
        }): Promise<boolean> =>
            new Promise((resolve) => {
                modal.confirm({
                    title: options.title,
                    content: options.content,
                    okText: options.okText ?? 'Confirm',
                    cancelText: options.cancelText ?? 'Cancel',
                    okButtonProps: options.danger ? { danger: true } : undefined,
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            }),

        /** For anything that needs to persist past a toast — the bell feed,
         *  long-running background results. */
        notification,
    }), [message, modal, notification]);
}
