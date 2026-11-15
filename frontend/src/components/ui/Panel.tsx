import type { CSSProperties, ReactNode } from 'react';
import { Card } from 'antd';
import { useTheme } from '../../theme/useTheme';
import { radius, space, fontSize } from '../../theme/tokens';

interface PanelProps {
    children: ReactNode;
    title?: ReactNode;
    /** Right-aligned content in the title row. */
    extra?: ReactNode;
    /** Coloured rule across the top — used to categorise cards at a glance. */
    accent?: string;
    /** Lift + accent border on hover. Only for cards that are clickable. */
    hoverable?: boolean;
    padding?: number | string;
    style?: CSSProperties;
    bodyStyle?: CSSProperties;
    className?: string;
    onClick?: () => void;
}

/**
 * The standard surface container.
 *
 * Replaces ~200 hand-styled `<Card style={{ background: GH.surface,
 * border: `1px solid ${GH.border}`, borderRadius: 12 }}>` blocks, which had
 * drifted across two palettes and three radii.
 *
 * Also the migration path off `bodyStyle`, which AntD 6 deprecated in favour
 * of `styles={{ body }}` — callers pass `bodyStyle` here and this component
 * forwards it correctly, so the deprecation is handled in one place.
 */
export default function Panel({
    children,
    title,
    extra,
    accent,
    hoverable = false,
    padding,
    style,
    bodyStyle,
    className,
    onClick,
}: PanelProps) {
    const { t } = useTheme();

    return (
        <Card
            className={[hoverable ? 'app-card' : '', className].filter(Boolean).join(' ') || undefined}
            onClick={onClick}
            style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: radius.lg,
                position: accent ? 'relative' : undefined,
                overflow: accent ? 'hidden' : undefined,
                cursor: onClick ? 'pointer' : undefined,
                ...style,
            }}
            styles={{
                body: {
                    padding: padding ?? space.xl,
                    ...bodyStyle,
                },
                header: {
                    borderBottom: `1px solid ${t.borderSubtle}`,
                    color: t.text,
                    fontSize: fontSize.base,
                    fontWeight: 600,
                    minHeight: 48,
                },
            }}
            title={title}
            extra={extra}
        >
            {accent && (
                <div
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        height: 3,
                        background: accent,
                    }}
                />
            )}
            {children}
        </Card>
    );
}
