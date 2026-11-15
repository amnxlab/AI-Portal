import type { ReactNode } from 'react';
import { Typography } from 'antd';
import { useTheme } from '../../theme/useTheme';
import { fontSize, space } from '../../theme/tokens';

const { Title, Text } = Typography;

interface PageHeaderProps {
    title: ReactNode;
    subtitle?: ReactNode;
    /** Buttons / filters, right-aligned on the same row as the title. */
    actions?: ReactNode;
    /** Filter bars or tab strips, on their own row beneath the title. */
    children?: ReactNode;
}

/**
 * The title block every page opens with.
 *
 * All 21 pages hand-rolled this — same structure, but drifting margins
 * (20/24/28px), heading levels (3 vs 4), and subtitle colours. One
 * component means the vertical rhythm is finally consistent.
 */
export default function PageHeader({ title, subtitle, actions, children }: PageHeaderProps) {
    const { t } = useTheme();

    return (
        <div style={{ marginBottom: space.xl }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: space.lg,
                    flexWrap: 'wrap',
                }}
            >
                <div style={{ minWidth: 0 }}>
                    <Title level={3} style={{ margin: 0, color: t.text, fontSize: fontSize.xxl }}>
                        {title}
                    </Title>
                    {subtitle && (
                        <Text style={{ color: t.textMuted, fontSize: fontSize.md }}>
                            {subtitle}
                        </Text>
                    )}
                </div>
                {actions && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 }}>
                        {actions}
                    </div>
                )}
            </div>
            {children && <div style={{ marginTop: space.lg }}>{children}</div>}
        </div>
    );
}
