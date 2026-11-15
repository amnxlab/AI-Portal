import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { isChunkLoadError } from '../lib/lazyWithReload';

interface Props {
    children: ReactNode;
    /** Route key. Changing it resets the boundary, so navigating away from a
     *  crashed page recovers instead of showing the error forever. */
    resetKey?: string;
}

interface State {
    error: Error | null;
}

/**
 * Per-route error boundary.
 *
 * The app had exactly one boundary, at the root in main.tsx — so a render
 * error anywhere in any of the 21 pages blanked the entire application,
 * chrome included, and the only recovery was a full reload.
 *
 * Scoping a boundary to the routed content keeps the sidebar, header, and
 * navigation alive: the user can simply click somewhere else.
 *
 * Deliberately a class component — `getDerivedStateFromError` has no hook
 * equivalent. Styling is inline rather than token-driven because this must
 * render even if the failure was in the theme layer itself.
 */
export default class RouteBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidUpdate(prev: Props) {
        if (prev.resetKey !== this.props.resetKey && this.state.error) {
            this.setState({ error: null });
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[RouteBoundary]', error, info.componentStack);
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        /**
         * A missing chunk is not a crash in the page — it means the portal was
         * updated while this tab was open, so the file this tab was told to
         * load no longer exists. `lazyWithReload` reloads once on its own; if
         * we are here, that reload did not resolve it, so the honest thing is
         * to say what happened and offer a real reload rather than a "retry"
         * that re-requests the same missing file.
         */
        const stale = isChunkLoadError(error);
        if (stale) {
            return (
                <div
                    role="alert"
                    style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 24,
                        maxWidth: 720,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <ReloadOutlined style={{ color: 'var(--accent)', fontSize: 18 }} />
                        <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 16 }}>
                            The portal was updated
                        </span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 16px' }}>
                        This tab is still running the previous version, and the page you asked
                        for is part of the new one. Reloading picks it up. Nothing is lost.
                    </p>
                    <Button
                        type="primary"
                        icon={<ReloadOutlined />}
                        onClick={() => window.location.reload()}
                    >
                        Reload the portal
                    </Button>
                </div>
            );
        }

        return (
            <div
                role="alert"
                style={{
                    background: 'var(--danger-bg)',
                    border: '1px solid var(--danger-border)',
                    borderRadius: 12,
                    padding: 24,
                    maxWidth: 720,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <WarningOutlined style={{ color: 'var(--danger)', fontSize: 18 }} />
                    <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 16 }}>
                        This page failed to load
                    </span>
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 4px' }}>
                    The rest of the portal is still working — you can navigate elsewhere
                    using the sidebar.
                </p>
                <pre
                    style={{
                        color: 'var(--text-faint)',
                        fontSize: 11,
                        whiteSpace: 'pre-wrap',
                        background: 'var(--surface-sunken)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 10,
                        margin: '12px 0 16px',
                        maxHeight: 160,
                        overflow: 'auto',
                    }}
                >
                    {error.message}
                </pre>
                <Button
                    icon={<ReloadOutlined />}
                    onClick={() => this.setState({ error: null })}
                >
                    Retry this page
                </Button>
            </div>
        );
    }
}
