import type { ReactNode } from 'react';
import { Button, Empty, Skeleton, Typography } from 'antd';
import { ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme';
import { radius, space, fontSize } from '../../theme/tokens';
import { errorMessage } from '../../hooks/useNotify';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════
   The three states every async view needs.
   ───────────────────────────────────────────────────────────────
   The app had 32 bare <Spin>s, 39 ad-hoc <Empty>s, zero <Skeleton>s, and
   44 catch blocks that swallowed the error with a `/* silent *\/` comment —
   so a failed fetch rendered as a permanently empty page with no way to
   tell "nothing here" from "it broke".
═══════════════════════════════════════════════════════════════ */

/* ── Loading ───────────────────────────────────────────────────── */

interface LoadingStateProps {
    /** `list` and `table` mimic the shape of what's arriving, which reads as
     *  faster than a centred spinner even at identical latency. */
    variant?: 'list' | 'table' | 'cards' | 'spinner';
    rows?: number;
}

export function LoadingState({ variant = 'list', rows = 5 }: LoadingStateProps) {
    const { t } = useTheme();

    if (variant === 'spinner') {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: space.xxl * 2 }}>
                <Skeleton.Node active style={{ width: 48, height: 48 }} />
            </div>
        );
    }

    if (variant === 'cards') {
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: space.lg }}>
                {Array.from({ length: rows }, (_, i) => (
                    <div
                        key={i}
                        style={{
                            background: t.surface,
                            border: `1px solid ${t.border}`,
                            borderRadius: radius.lg,
                            padding: space.xl,
                        }}
                    >
                        <Skeleton active paragraph={{ rows: 2 }} title={{ width: '60%' }} />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div
            style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: radius.lg,
                padding: space.xl,
            }}
        >
            {Array.from({ length: rows }, (_, i) => (
                <div
                    key={i}
                    style={{
                        padding: `${space.md}px 0`,
                        borderBottom: i < rows - 1 ? `1px solid ${t.borderSubtle}` : undefined,
                    }}
                >
                    <Skeleton
                        active
                        avatar={variant === 'list'}
                        title={{ width: `${45 + ((i * 13) % 35)}%` }}
                        paragraph={{ rows: 1, width: '80%' }}
                    />
                </div>
            ))}
        </div>
    );
}

/* ── Empty ─────────────────────────────────────────────────────── */

interface EmptyStateProps {
    /** What isn't here, in the user's terms: 'No tasks this week'. */
    title: string;
    /** Why, or what to do about it. */
    description?: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    compact?: boolean;
}

export function EmptyState({ title, description, icon, action, compact = false }: EmptyStateProps) {
    const { t } = useTheme();

    return (
        <div
            style={{
                textAlign: 'center',
                padding: compact ? `${space.xl}px ${space.lg}px` : `${space.xxl * 2}px ${space.xl}px`,
            }}
        >
            {icon ? (
                <div aria-hidden style={{ fontSize: 40, color: t.borderStrong, marginBottom: space.md }}>
                    {icon}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} />
            )}
            <Text style={{ color: t.text, fontSize: fontSize.base, fontWeight: 600, display: 'block' }}>
                {title}
            </Text>
            {description && (
                <Text
                    style={{
                        color: t.textMuted,
                        fontSize: fontSize.md,
                        display: 'block',
                        marginTop: space.xs,
                        maxWidth: 420,
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    }}
                >
                    {description}
                </Text>
            )}
            {action && <div style={{ marginTop: space.lg }}>{action}</div>}
        </div>
    );
}

/* ── Error ─────────────────────────────────────────────────────── */

interface ErrorStateProps {
    /** The caught error. Unwrapped via `errorMessage`, so axios shapes,
     *  NestJS validation arrays, and network failures all read sensibly. */
    error: unknown;
    /** Context for what failed: 'Could not load tasks'. */
    title?: string;
    onRetry?: () => void;
    compact?: boolean;
}

export function ErrorState({ error, title = 'Something went wrong', onRetry, compact = false }: ErrorStateProps) {
    const { t } = useTheme();
    const detail = errorMessage(error, '');

    return (
        <div
            role="alert"
            style={{
                background: t.dangerBg,
                border: `1px solid ${t.dangerBorder}`,
                borderRadius: radius.lg,
                padding: compact ? space.lg : space.xl,
                display: 'flex',
                alignItems: 'flex-start',
                gap: space.md,
            }}
        >
            <WarningOutlined aria-hidden style={{ color: t.danger, fontSize: fontSize.lg, marginTop: 2, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontWeight: 600, display: 'block' }}>{title}</Text>
                {detail && (
                    <Text style={{ color: t.textMuted, fontSize: fontSize.md, display: 'block', marginTop: 2 }}>
                        {detail}
                    </Text>
                )}
                {onRetry && (
                    <Button
                        size="small"
                        icon={<ReloadOutlined />}
                        onClick={onRetry}
                        style={{ marginTop: space.md }}
                    >
                        Try again
                    </Button>
                )}
            </div>
        </div>
    );
}

/* ── Combinator ────────────────────────────────────────────────
   Collapses the loading / error / empty / content branch that every page
   writes by hand, so the three states can't be skipped by accident.      */

interface AsyncSectionProps<T> {
    isLoading: boolean;
    error: unknown;
    data: T[] | undefined;
    onRetry?: () => void;
    loadingVariant?: LoadingStateProps['variant'];
    empty: Omit<EmptyStateProps, 'compact'>;
    errorTitle?: string;
    children: (data: T[]) => ReactNode;
}

export function AsyncSection<T>({
    isLoading, error, data, onRetry, loadingVariant, empty, errorTitle, children,
}: AsyncSectionProps<T>) {
    if (isLoading && !data) return <LoadingState variant={loadingVariant} />;
    if (error) return <ErrorState error={error} title={errorTitle} onRetry={onRetry} />;
    if (!data || data.length === 0) return <EmptyState {...empty} />;
    return <>{children(data)}</>;
}
