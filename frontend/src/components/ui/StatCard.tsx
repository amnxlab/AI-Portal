import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';
import { useTheme } from '../../theme/useTheme';
import { radius, space, fontSize, alpha } from '../../theme/tokens';

const { Text } = Typography;

interface StatCardProps {
    label: string;
    value: ReactNode;
    /** Small caption under the value — 'of 20h cap', '3 overdue'. */
    hint?: ReactNode;
    icon?: ReactNode;
    /** Accent colour for the icon, top rule, and trend. Defaults to accent. */
    tone?: string;
    /** Percentage change. Positive renders green-up, negative red-down. */
    trend?: number;
    /** Inverts trend colouring, for metrics where down is good (spend, overdue). */
    trendInverted?: boolean;
    onClick?: () => void;
    /**
     * A smaller tile, for use inside another card rather than as a page's own
     * KPI row. Same shape, about a third less height: the full-size tile was
     * built to sit directly on a page, and three of them nested inside a
     * dashboard card dominated everything around them.
     */
    compact?: boolean;
}

/**
 * The KPI tile.
 *
 * This exact layout was duplicated across Dashboard, Budget (Overview and
 * Reports tabs), Attendance, and Tickets — five implementations that
 * disagreed on padding, icon size, and whether the label sat above or below
 * the value. This is the one.
 */
export default function StatCard({
    label,
    value,
    hint,
    icon,
    tone,
    trend,
    trendInverted = false,
    onClick,
    compact = false,
}: StatCardProps) {
    const { t } = useTheme();
    const accent = tone ?? t.accent;

    const trendIsGood = trend === undefined
        ? null
        : trendInverted ? trend <= 0 : trend >= 0;
    const trendColor = trendIsGood === null
        ? t.textMuted
        : trendIsGood ? t.success : t.danger;

    return (
        <div
            className={onClick ? 'app-card' : undefined}
            onClick={onClick}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            onKeyDown={onClick ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
            } : undefined}
            style={{
                position: 'relative',
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: radius.lg,
                padding: compact
                    ? `${space.md}px ${space.md + 2}px`
                    : `${space.lg}px ${space.xl}px`,
                overflow: 'hidden',
                cursor: onClick ? 'pointer' : undefined,
                height: '100%',
            }}
        >
            <div
                aria-hidden
                style={{
                    position: 'absolute', top: 0, left: 0, right: 0,
                    height: 3, background: accent,
                }}
            />

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: compact ? space.sm : space.md }}>
                {icon && (
                    <div
                        aria-hidden
                        style={{
                            width: compact ? 26 : 36,
                            height: compact ? 26 : 36,
                            flexShrink: 0,
                            borderRadius: radius.md,
                            background: alpha(accent, 0.12),
                            color: accent,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: compact ? fontSize.sm : fontSize.lg,
                        }}
                    >
                        {icon}
                    </div>
                )}

                <div style={{ minWidth: 0, flex: 1 }}>
                    <Text
                        style={{
                            color: t.textMuted,
                            fontSize: fontSize.xs,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            display: 'block',
                        }}
                    >
                        {label}
                    </Text>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm, marginTop: 2 }}>
                        <Text style={{
                            color: t.text,
                            fontSize: compact ? fontSize.xl : fontSize.xxl,
                            fontWeight: 700, lineHeight: 1.2,
                        }}>
                            {value}
                        </Text>
                        {trend !== undefined && (
                            <span style={{ color: trendColor, fontSize: fontSize.sm, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {trend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                                {' '}{Math.abs(trend).toFixed(0)}%
                            </span>
                        )}
                    </div>

                    {hint && (
                        <Text style={{
                            color: t.textFaint,
                            fontSize: compact ? fontSize.xs : fontSize.sm,
                            display: 'block', marginTop: 2,
                        }}>
                            {hint}
                        </Text>
                    )}
                </div>
            </div>
        </div>
    );
}
