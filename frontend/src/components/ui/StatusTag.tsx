import type { ReactNode } from 'react';
import { Tag } from 'antd';
import { useTheme } from '../../theme/useTheme';
import { radius, fontSize, alpha } from '../../theme/tokens';
import {
    taskStatusColor, taskStatusBg, taskStatusLabel,
    reportStatusColor, reportStatusBg,
    taskPriorityColor, taskPriorityBg,
} from '../../constants/taskStatus';

type Kind = 'task' | 'report' | 'priority' | 'custom';

interface StatusTagProps {
    /** The raw status/priority string from the API. */
    value: string;
    kind?: Kind;
    /** For `kind="task"` — reviewers see "Pending Review", submitters see
     *  "Under Review" for the same underlying status. */
    isReviewer?: boolean;
    /** Only for `kind="custom"` — e.g. a role's user-defined colour. */
    color?: string;
    icon?: ReactNode;
    size?: 'sm' | 'md';
}

/**
 * The pill used for every status and priority in the app.
 *
 * Previously each page built its own `<Tag>` with a locally-declared colour
 * map and a `${color}22` hex-suffix fill. That fill technique breaks in light
 * mode, and the maps disagreed — the same status rendered in different
 * colours on Tasks, Dashboard, and Projects.
 */
export default function StatusTag({
    value,
    kind = 'task',
    isReviewer = false,
    color,
    icon,
    size = 'md',
}: StatusTagProps) {
    const { t } = useTheme();

    let fg: string;
    let bg: string;
    let label: string = value;

    switch (kind) {
        case 'report':
            fg = reportStatusColor(value, t);
            bg = reportStatusBg(value, t);
            break;
        case 'priority':
            fg = taskPriorityColor(value, t);
            bg = taskPriorityBg(value, t);
            break;
        case 'custom':
            fg = color ?? t.textMuted;
            bg = t.surfaceSunken;
            break;
        case 'task':
        default:
            fg = taskStatusColor(value, t);
            bg = taskStatusBg(value, t);
            label = taskStatusLabel(value, isReviewer);
            break;
    }

    return (
        <Tag
            icon={icon}
            style={{
                background: bg,
                color: fg,
                border: `1px solid ${alpha(fg, 0.32)}`,
                borderRadius: radius.sm,
                fontSize: size === 'sm' ? fontSize.xs : fontSize.sm,
                fontWeight: 500,
                padding: size === 'sm' ? '0 6px' : '1px 8px',
                margin: 0,
                lineHeight: size === 'sm' ? '16px' : '20px',
            }}
        >
            {label}
        </Tag>
    );
}
