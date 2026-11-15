import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
    Row, Col, Card, Typography, Spin, Alert, Tag, Tooltip,
    Space, Button, Badge, Empty, Tabs, Popconfirm, message, Segmented,
} from 'antd';
import {
    CheckSquareOutlined, WarningOutlined, ProjectOutlined, FileTextOutlined,
    ReloadOutlined, ArrowRightOutlined,
    BellOutlined, FilePdfOutlined, EyeOutlined,
    CheckCircleOutlined, CalendarOutlined, UserOutlined,
    FolderOpenOutlined, CustomerServiceOutlined,
    BookOutlined, CloseCircleOutlined, TagOutlined, DashboardOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../../components/UserAvatar';
import AnalyticsTab from './AnalyticsTab';
import LeaderboardTab from './LeaderboardTab';
import MyAttendanceCard from '../../components/MyAttendanceCard';
import { alpha } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';
import { deepLink } from '../../hooks/useDeepLink';

dayjs.extend(relativeTime);

const { Text } = Typography;


/** Display label for a task status from a non-reviewer's perspective. */
const taskStatusLabel = (status: string, isReviewer: boolean) =>
    !isReviewer && status === 'Pending Review' ? 'Under Review' : status;

const getTaskCompletionMoment = (task: any) => {
    const ts = task?.completedAt ?? task?.updatedAt;
    return ts ? dayjs(ts) : null;
};

function useDashboardTheme() {
    const { t } = useTheme();
    const statusColors = useMemo<Record<string, string>>(() => ({
        Todo: t.accent,
        'In Progress': t.warning,
        'Pending Review': t.purple,
        Done: t.success,
        Blocked: t.danger,
        'Needs Revision': t.orange,
    }), [t]);
    const priorityColors = useMemo<Record<string, string>>(() => ({
        Critical: t.danger, High: t.orange, Medium: t.warning, Low: t.success,
    }), [t]);
    const projStatusColors = useMemo<Record<string, string>>(() => ({
        Active: t.success, 'On Hold': t.warning, Planned: t.purple,
        Completed: t.accent, Cancelled: t.danger,
    }), [t]);
    const barGradients = useMemo<Record<string, string>>(() => ({
        'Todo':            `linear-gradient(90deg, ${alpha(t.accent, 0.87)}, ${alpha(t.accent, 0.6)})`,
        'In Progress':     `linear-gradient(90deg, ${alpha(t.warning, 0.87)}, ${alpha(t.warning, 0.6)})`,
        'Pending Review':  `linear-gradient(90deg, ${alpha(t.purple, 0.87)}, ${alpha(t.purple, 0.6)})`,
        'Blocked':         `linear-gradient(90deg, ${alpha(t.danger, 0.87)}, ${alpha(t.danger, 0.6)})`,
        'Needs Revision':  `linear-gradient(90deg, ${alpha(t.orange, 0.87)}, ${alpha(t.orange, 0.6)})`,
    }), [t]);
    const cardStyle = useMemo<React.CSSProperties>(() => ({
        background: t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
    }), [t]);
    const getNotifStyle = useCallback((type: string): { color: string; icon: React.ReactNode } => {
        switch (type) {
            case 'report_approved':       return { color: t.success, icon: <CheckCircleOutlined /> };
            case 'report_needs_revision': return { color: t.orange, icon: <ReloadOutlined /> };
            case 'report_submitted':      return { color: t.accent, icon: <FileTextOutlined /> };
            case 'report_resubmitted':    return { color: t.purple, icon: <ReloadOutlined /> };
            case 'task_assigned':         return { color: t.accent, icon: <CheckSquareOutlined /> };
            case 'task_pending_review':   return { color: t.purple, icon: <EyeOutlined /> };
            case 'file_approved':         return { color: t.success, icon: <FilePdfOutlined /> };
            case 'file_rejected':         return { color: t.danger, icon: <FilePdfOutlined /> };
            case 'paper_read_request':    return { color: t.accent, icon: <BookOutlined /> };
            case 'paper_read_accepted':   return { color: t.success, icon: <CheckCircleOutlined /> };
            case 'paper_read_rejected':   return { color: t.danger, icon: <CloseCircleOutlined /> };
            case 'comment_mention':       return { color: t.purple, icon: <TagOutlined /> };
            case 'file_pending':          return { color: t.warning, icon: <FilePdfOutlined /> };
            case 'ticket_submitted':      return { color: t.orange, icon: <CustomerServiceOutlined /> };
            default:                      return { color: t.textMuted, icon: <BellOutlined /> };
        }
    }, [t]);
    return { t, statusColors, priorityColors, projStatusColors, barGradients, cardStyle, getNotifStyle };
}

function StatCard({ icon, title, value, color, badge, overdueCount }: {
    icon: React.ReactNode; title: string; value: number;
    color: string; badge?: number; overdueCount?: number;
}) {
    const { t, cardStyle } = useDashboardTheme();
    const isOverdueCard = overdueCount !== undefined && overdueCount > 0;
    const accent = isOverdueCard ? t.danger : color;
    return (
        <Card style={{
            ...cardStyle,
            position: 'relative',
            borderBottom: `2px solid ${accent}`,
            boxShadow: (value > 0 || isOverdueCard) ? `0 0 0 1px ${alpha(accent, 0.09)}, 0 4px 20px ${alpha(accent, 0.08)}` : 'none',
            transition: 'box-shadow 0.2s',
        }} styles={{ body: { padding: '18px 20px' } }}>
            {badge !== undefined && badge > 0 && (
                <div style={{
                    position: 'absolute', top: 12, right: 12,
                    background: t.danger, color: t.textOnAccent, borderRadius: 12,
                    padding: '1px 8px', fontSize: 11, fontWeight: 700,
                }}>
                    {badge}
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                    width: 44, height: 44, borderRadius: 10,
                    background: `${alpha(accent, 0.09)}`, border: `1px solid ${alpha(accent, 0.19)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: accent, fontSize: 20, flexShrink: 0,
                }}>
                    {icon}
                </div>
                <div>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block' }}>{title}</Text>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <Text style={{ color: isOverdueCard ? t.danger : t.text, fontSize: 24, fontWeight: 700 }}>{value}</Text>
                        {isOverdueCard && (
                            <span style={{
                                background: alpha(t.danger, 0.13), color: t.danger,
                                border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 10,
                                fontSize: 10, padding: '1px 7px', fontWeight: 700, whiteSpace: 'nowrap',
                            }}>{overdueCount} overdue</span>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
}

// ── Project Gantt timeline ─────────────────────────────────────────────────
const PROJ_STATUS_ICON: Record<string, string> = {
    Active: '▶', 'On Hold': '⏸', Planned: '○', Completed: '✓', Cancelled: '✕',
};

const GANTT_LABEL_W = 220;
const GANTT_ROW_H   = 64;

/**
 * How far back the timeline looks.
 *
 * A project that started two years ago used to stretch the window across the
 * whole period, squeezing everything live into a few pixels at the right-hand
 * edge. The window now begins three months ago and runs as far forward as the
 * work does, so the near term is readable and upcoming milestones still show.
 *
 * This is a display rule. Nothing is deleted and no record is changed — the
 * full history remains in the database and on the project's own page.
 */
const TIMELINE_HISTORY_MONTHS = 1;

/**
 * The projects the timeline shows: live work, scheduled, and not finished
 * before the window opens. Shared with the count beside the chart title so
 * the two can never disagree.
 */
function timelineVisible(projects: any[]): any[] {
    const historyStart = dayjs().subtract(TIMELINE_HISTORY_MONTHS, 'month').startOf('day');
    return projects.filter((p) => {
        if (!p.startDate && !p.endDate) return false;
        if (p.archivedAt || p.status === 'Cancelled' || p.status === 'Completed') return false;
        const end = p.endDate ? dayjs(p.endDate) : null;
        return !end || !end.isBefore(historyStart, 'day');
    });
}

function GanttTimeline({ projects }: { projects: any[] }) {
    const { t, projStatusColors } = useDashboardTheme();
    const today = dayjs();
    const [hoveredRow, setHoveredRow] = useState<string | null>(null);
    const historyStart = today.subtract(TIMELINE_HISTORY_MONTHS, 'month').startOf('day');

    const relevant = timelineVisible(projects);

    if (relevant.length === 0) {
        return (
            <Empty
                description={
                    <Text style={{ color: t.textMuted }}>
                        No active projects scheduled in the last month or ahead.
                        Completed, cancelled and archived projects are not shown here &mdash; open the
                        Projects page to see them.
                    </Text>
                }
                style={{ padding: '40px 0' }}
            />
        );
    }

    // Open-ended projects contribute a minimum horizon so the scale has
    // somewhere to run to; it is the view's horizon, not their end date, and
    // nothing is drawn as finishing there.
    const allEnds = relevant.map((p) => p.endDate ? dayjs(p.endDate) : today.add(30, 'day'));
    // The window starts three months back, never earlier, however old the
    // projects are. A bar that began before that is clipped at the edge by
    // toPct() below rather than dragging the whole scale backwards.
    const winStart = historyStart;
    const winEnd   = allEnds.reduce((a, b) => a.isAfter(b) ? a : b, today.add(60, 'day'));
    const winDays  = Math.max(winEnd.diff(winStart, 'day'), 1);

    const toPct = (d: dayjs.Dayjs) => Math.max(0, Math.min(100, d.diff(winStart, 'day') / winDays * 100));
    const todayPct = toPct(today);

    const ticks: dayjs.Dayjs[] = [];
    let tick = winStart.startOf('month');
    while (tick.isBefore(winEnd) || tick.isSame(winEnd, 'month')) { ticks.push(tick); tick = tick.add(1, 'month'); }

    return (
        <div style={{ fontFamily: 'inherit' }}>
            {/* ── Header row ─────────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'stretch', marginBottom: 0 }}>
                {/* Label header */}
                <div style={{
                    width: GANTT_LABEL_W, flexShrink: 0,
                    background: t.surfaceRaised,
                    borderRadius: '8px 0 0 0',
                    borderBottom: `1px solid ${t.border}`,
                    borderRight: `1px solid ${t.border}`,
                    padding: '8px 14px',
                    display: 'flex', alignItems: 'center', gap: 6,
                }}>
                    <FolderOpenOutlined style={{ color: t.textMuted, fontSize: 12 }} />
                    <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' }}>Project</Text>
                </div>
                {/* Month ticks header */}
                <div style={{
                    flex: 1, position: 'relative', height: 36,
                    background: t.surfaceRaised,
                    borderRadius: '0 8px 0 0',
                    borderBottom: `1px solid ${t.border}`,
                    overflow: 'hidden',
                }}>
                    {/* Alternating month bands in header */}
                    {ticks.map((tk, i) => {
                        const x = toPct(tk);
                        const xNext = i + 1 < ticks.length ? toPct(ticks[i + 1]) : 100;
                        return (
                            <div key={i} style={{
                                position: 'absolute', left: `${x}%`, width: `${xNext - x}%`,
                                top: 0, bottom: 0,
                                background: i % 2 === 0 ? `transparent` : alpha(t.textOnAccent, 0.02),
                                borderLeft: `1px solid ${t.border}`,
                                display: 'flex', alignItems: 'center', paddingLeft: 6,
                            }}>
                                <Text style={{ color: t.textMuted, fontSize: 10, fontWeight: 600, letterSpacing: 0.3, whiteSpace: 'nowrap' }}>
                                    {tk.format('MMM')}
                                    <span style={{ color: t.textFaint, marginLeft: 3 }}>{tk.format('YYYY')}</span>
                                </Text>
                            </div>
                        );
                    })}
                    {/* Today marker in header */}
                    <div style={{
                        position: 'absolute',
                        left: `${todayPct}%`,
                        top: 0, bottom: 0,
                        width: 2,
                        background: alpha(t.warning, 0.8),
                        zIndex: 4,
                        pointerEvents: 'none',
                    }} />
                </div>
            </div>

            {/* ── Body ───────────────────────────────────────────────── */}
            <div style={{ position: 'relative', display: 'flex' }}>
                {/* Label column */}
                <div style={{ width: GANTT_LABEL_W, flexShrink: 0, borderRight: `1px solid ${t.border}` }}>
                    {relevant.map((p, idx) => {
                        const color = projStatusColors[p.status] ?? t.accent;
                        const isOverdue = p.endDate && dayjs(p.endDate).isBefore(today) && p.status !== 'Completed';
                        const isCompleted = p.status === 'Completed';
                        return (
                            <div
                                key={p.id}
                                style={{
                                    height: GANTT_ROW_H,
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '0 14px',
                                    background: hoveredRow === p.id
                                        ? `${alpha(color, 0.05)}`
                                        : idx % 2 === 0 ? `transparent` : alpha(t.textOnAccent, 0.01),
                                    borderBottom: `1px solid ${alpha(t.border, 0.13)}`,
                                    transition: 'background 0.15s',
                                    cursor: 'default',
                                }}
                                onMouseEnter={() => setHoveredRow(p.id)}
                                onMouseLeave={() => setHoveredRow(null)}
                            >
                                {/* Status icon */}
                                <div style={{
                                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                    background: `${alpha(color, 0.09)}`,
                                    border: `1px solid ${alpha(color, 0.25)}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color, fontSize: 12, fontWeight: 800,
                                    boxShadow: hoveredRow === p.id ? `0 0 10px ${alpha(color, 0.27)}` : 'none',
                                    transition: 'box-shadow 0.15s',
                                }}>
                                    {PROJ_STATUS_ICON[p.status] ?? '●'}
                                </div>
                                <div style={{ overflow: 'hidden', flex: 1 }}>
                                    <Tooltip title={p.name}>
                                        <Text style={{
                                            color: isCompleted ? t.textMuted : t.text,
                                            fontSize: 12, fontWeight: 600, display: 'block',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            textDecoration: isCompleted ? 'line-through' : 'none',
                                        }}>{p.name}</Text>
                                    </Tooltip>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: isOverdue ? t.danger : color, flexShrink: 0 }} />
                                        <Text style={{ color: isOverdue ? t.danger : t.textMuted, fontSize: 10, fontWeight: 500 }}>
                                            {isOverdue ? 'Overdue' : p.status}
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Track area */}
                <div style={{ flex: 1, position: 'relative' }}>
                    {/* Alternating month column bands */}
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0 }}>
                        {ticks.map((tk, i) => {
                            const x = toPct(tk);
                            const xNext = i + 1 < ticks.length ? toPct(ticks[i + 1]) : 100;
                            return (
                                <div key={i} style={{
                                    position: 'absolute', left: `${x}%`, width: `${xNext - x}%`,
                                    top: 0, bottom: 0,
                                    background: i % 2 === 0 ? `transparent` : alpha(t.textOnAccent, 0.02),
                                    borderLeft: `1px solid ${t.border}`,
                                }} />
                            );
                        })}
                    </div>

                    {/* TODAY vertical line */}
                    <div style={{
                        position: `absolute`,
                        left: `${todayPct}%`,
                        top: 0, bottom: 0, width: 2,
                        background: 'repeating-linear-gradient(to bottom, t.warning 0px, t.warning 6px, transparent 6px, transparent 12px)',
                        zIndex: 10, pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute',
                        left: `${todayPct}%`,
                        top: -18, transform: 'translateX(-50%)',
                        background: t.warning,
                        color: `${t.bg}`, fontSize: 9, fontWeight: 800,
                        padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap',
                        zIndex: 11, letterSpacing: 0.5,
                        boxShadow: `0 0 10px ${alpha(t.warning, 0.4)}`,
                        pointerEvents: 'none',
                    }}>TODAY</div>

                    {/* Rows */}
                    {relevant.map((p, idx) => {
                        const s = p.startDate ? dayjs(p.startDate) : today;
                        /*
                         * A project with no end date has no end date.
                         *
                         * This originally substituted "today + 30 days", which
                         * drew the bar stopping at a definite future point and
                         * computed a progress percentage against it — so
                         * clearing an end date still produced one on screen,
                         * just a fabricated one.
                         *
                         * The bar now runs from its start to today: the work
                         * done so far, which is the only part that is known.
                         * It is not drawn into the future, because nothing is
                         * scheduled there yet.
                         */
                        const hasEnd = !!p.endDate;
                        const e = hasEnd ? dayjs(p.endDate) : today;
                        const lPct  = toPct(s);
                        const rPct  = toPct(e);
                        const wPct  = Math.max(rPct - lPct, 0.6);
                        // Started before the window opens, so the bar is cut
                        // off at the left edge. Without saying so, the start
                        // label sitting at the edge reads as though the work
                        // began there — which for anything long-running is
                        // simply wrong. The marker says it continues from
                        // earlier, and the label keeps the real date.
                        const clippedStart = s.isBefore(winStart, 'day');
                        const color = projStatusColors[p.status] ?? t.accent;
                        const isOverdue   = p.endDate && dayjs(p.endDate).isBefore(today) && p.status !== 'Completed';
                        const isCompleted = p.status === 'Completed';
                        const barColor    = isOverdue ? t.danger : color;

                        // Progress needs a finish line to measure against. Without
                        // an end date there is no denominator, and any number here
                        // would be invented.
                        const progressPct = isCompleted ? 100
                            : hasEnd
                                ? Math.max(0, Math.min(100, (today.diff(s, 'day') / Math.max(e.diff(s, 'day'), 1)) * 100))
                                : 0;

                        const isHovered = hoveredRow === p.id;

                        return (
                            <div
                                key={p.id}
                                style={{
                                    height: GANTT_ROW_H,
                                    position: 'relative',
                                    background: isHovered ? `${alpha(barColor, 0.03)}` : idx % 2 === 0 ? `transparent` : alpha(t.textOnAccent, 0.01),
                                    borderBottom: `1px solid ${alpha(t.border, 0.13)}`,
                                    transition: 'background 0.15s',
                                }}
                                onMouseEnter={() => setHoveredRow(p.id)}
                                onMouseLeave={() => setHoveredRow(null)}
                            >
                                {/* Bar group: date chip above, bar below */}
                                <div style={{ position: 'absolute', left: `${lPct}%`, width: `${wPct}%`, top: '50%', transform: 'translateY(-50%)' }}>
                                    {/* Start / end date labels above bar */}
                                    <div style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 4, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
                                        <Text
                                            title={clippedStart ? `Started ${s.format('MMM D, YYYY')}, before this view begins` : undefined}
                                            style={{ color: barColor, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: 0.2 }}
                                        >
                                            {clippedStart ? '◀ ' : ''}{s.format(clippedStart ? 'MMM D, YYYY' : 'MMM D')}
                                        </Text>
                                        {wPct > 8 && (
                                            <Text
                                                title={hasEnd ? undefined : 'No end date set — the bar runs to today'}
                                                style={{ color: isOverdue ? t.danger : t.textMuted, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: 0.2 }}
                                            >
                                                {hasEnd ? e.format('MMM D') : 'to date'}
                                            </Text>
                                        )}
                                    </div>

                                    {/* Main bar */}
                                    <Tooltip
                                        title={
                                            <div style={{ minWidth: 200 }}>
                                                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ color: barColor }}>{PROJ_STATUS_ICON[p.status] ?? '●'}</span>
                                                    {p.name}
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                                                    <div>
                                                        <div style={{ color: t.textMuted, fontSize: 10, marginBottom: 1 }}>Start</div>
                                                        <div style={{ color: t.text, fontSize: 11, fontWeight: 600 }}>{p.startDate ? s.format('MMM D, YYYY') : '—'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: t.textMuted, fontSize: 10, marginBottom: 1 }}>End</div>
                                                        <div style={{ color: isOverdue ? t.danger : t.text, fontSize: 11, fontWeight: 600 }}>{p.endDate ? e.format('MMM D, YYYY') : 'Ongoing'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: t.textMuted, fontSize: 10, marginBottom: 1 }}>{hasEnd ? 'Duration' : 'Running'}</div>
                                                        <div style={{ color: t.text, fontSize: 11, fontWeight: 600 }}>
                                                            {hasEnd ? `${e.diff(s, 'day')} days` : `${Math.max(today.diff(s, 'day'), 0)} days so far`}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: t.textMuted, fontSize: 10, marginBottom: 1 }}>Progress</div>
                                                        <div style={{ color: hasEnd || isCompleted ? barColor : t.textMuted, fontSize: 11, fontWeight: 700 }}>
                                                            {hasEnd || isCompleted ? `${Math.round(progressPct)}%` : 'no end date'}
                                                        </div>
                                                    </div>
                                                </div>
                                                {isOverdue && (
                                                    <div style={{ marginTop: 8, color: t.danger, fontSize: 11, fontWeight: 700, background: alpha(t.danger, 0.09), border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 6, padding: '4px 8px' }}>
                                                        ⚠ Overdue by {today.diff(e, 'day')} days
                                                    </div>
                                                )}
                                            </div>
                                        }
                                        placement="top"
                                        color={t.surface}
                                        overlayInnerStyle={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: '10px 14px' }}
                                    >
                                        <div style={{
                                            height: 28,
                                            // Squared edges read as "continues"; rounded ones read
                                            // as a beginning or an end. An open-ended project gets
                                            // a flat right edge for the same reason a clipped one
                                            // gets a flat left edge.
                                            borderRadius: `${clippedStart ? '0' : '7px'} ${hasEnd ? '7px' : '0'} ${hasEnd ? '7px' : '0'} ${clippedStart ? '0' : '7px'}`,
                                            position: 'relative', overflow: 'hidden',
                                            background: `${alpha(barColor, 0.13)}`,
                                            border: `1px solid ${alpha(barColor, 0.27)}`,
                                            boxShadow: isHovered ? `0 0 16px ${alpha(barColor, 0.33)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.094)}` : `0 0 8px ${alpha(barColor, 0.13)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.063)}`,
                                            transition: 'box-shadow 0.15s',
                                            cursor: 'default',
                                        }}>
                                            {/* Progress fill */}
                                            <div style={{
                                                position: 'absolute', left: 0, top: 0, height: '100%',
                                                width: `${progressPct}%`,
                                                background: `linear-gradient(90deg, ${alpha(barColor, 0.87)}, ${alpha(barColor, 0.53)})`,
                                                borderRadius: isCompleted || progressPct >= 99 ? 7 : '7px 0 0 7px',
                                                transition: 'width 0.3s ease',
                                            }} />
                                            {/* Shine */}
                                            <div style={{
                                                position: 'absolute', left: 0, top: 0, right: 0,
                                                height: '40%', borderRadius: '7px 7px 0 0',
                                                background: `linear-gradient(to bottom, ${alpha(t.textOnAccent, 0.071)}, transparent)`,
                                                pointerEvents: 'none',
                                            }} />
                                            {/* Label inside bar */}
                                            <div style={{
                                                position: 'absolute', inset: 0,
                                                display: 'flex', alignItems: 'center', paddingLeft: 8, paddingRight: 6,
                                                gap: 5, overflow: 'hidden',
                                            }}>
                                                <span style={{ color: t.textOnAccent, fontSize: 10, fontWeight: 700, opacity: 0.9, textShadow: `0 1px 3px ${alpha(t.bg, 0.53)}`, letterSpacing: 0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {p.name}
                                                </span>
                                                {isCompleted && <span style={{ color: t.textOnAccent, fontSize: 10, opacity: 0.8, marginLeft: 'auto' }}>✓</span>}
                                            </div>
                                        </div>
                                    </Tooltip>

                                    {/* End cap marker */}
                                    {p.endDate && (
                                        <div style={{
                                            position: 'absolute', right: -1, top: '50%', transform: 'translateY(-50%)',
                                            width: 3, height: 34, borderRadius: 2,
                                            background: isOverdue ? t.danger : alpha(t.textOnAccent, 0.27),
                                            pointerEvents: 'none',
                                        }} />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Footer legend ───────────────────────────────────────── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 14, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                {Object.entries(projStatusColors).map(([status, color]) => (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
                        <Text style={{ color: t.textMuted, fontSize: 10 }}>{status}</Text>
                    </div>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 16, height: 2, background: alpha(t.warning, 0.6), borderRadius: 1 }} />
                    <Text style={{ color: t.textMuted, fontSize: 10 }}>Today</Text>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 16, height: 8, borderRadius: 3, background: `linear-gradient(90deg, ${alpha(t.danger, 0.53)}, ${alpha(t.danger, 0.27)})`, border: `1px solid ${alpha(t.danger, 0.4)}` }} />
                    <Text style={{ color: t.textMuted, fontSize: 10 }}>Overdue</Text>
                </div>
            </div>
        </div>
    );
}

// ── Task assignment timeline ───────────────────────────────────────────────
function TaskTimeline({ tasks }: { tasks: any[] }) {
    const { t, statusColors, priorityColors, barGradients } = useDashboardTheme();
    const today = dayjs();
    const [view, setView] = useState<'1M' | '2M' | '4M'>('1M');

    const VIEW_DAYS: Record<string, number> = { '1M': 30, '2M': 60, '4M': 120 };
    const winStart = today.subtract(7, 'day');
    const winEnd   = today.add(VIEW_DAYS[view] - 7, 'day');
    const winDays  = winEnd.diff(winStart, 'day');
    const toPct    = (d: dayjs.Dayjs) => Math.max(0, Math.min(100, d.diff(winStart, 'day') / winDays * 100));
    const todayPct = toPct(today);

    const active = tasks.filter((task) => task.assignee && task.status !== 'Done');

    const byPerson: Record<string, { user: any; tasks: any[] }> = {};
    for (const task of active) {
        const key = task.assignee.id;
        if (!byPerson[key]) byPerson[key] = { user: task.assignee, tasks: [] };
        byPerson[key].tasks.push(task);
    }
    const groups = Object.values(byPerson).sort((a, b) => a.user.fullName.localeCompare(b.user.fullName));

    if (groups.length === 0) {
        return <Empty description={<Text style={{ color: t.textMuted }}>No active task assignments</Text>} style={{ padding: '40px 0' }} />;
    }

    // Ticks: weekly for 1M/2M, bi-weekly for 4M
    const tickStep = view === '4M' ? 2 : 1;
    const ticks: dayjs.Dayjs[] = [];
    let tk = winStart.startOf('week');
    while (tk.isBefore(winEnd)) { ticks.push(tk); tk = tk.add(tickStep, 'week'); }

    const LABEL_W = 220;
    const BAR_H   = 34;
    const LANE_H  = BAR_H + 22;  // 56: bar(34) + info-strip(13) + gaps(9)
    const PAD_V   = 8;            // top/bottom padding inside a row
    const rowH    = (n: number) => PAD_V * 2 + n * LANE_H;  // dynamic row height
    const barTop  = (i: number)  => PAD_V + i * LANE_H + 2;

    const STATUS_ICON: Record<string, string> = {
        'Todo': '○',
        'In Progress': '◑',
        'Pending Review': '◈',
        'Blocked': '⊘',
        'Needs Revision': '↺',
    };



    return (
        <div>
            {/* ── View switcher ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <Segmented
                    size="small"
                    value={view}
                    onChange={(v) => setView(v as '1M' | '2M' | '4M')}
                    options={[
                        { label: '1 Month',  value: '1M' },
                        { label: '2 Months', value: '2M' },
                        { label: '4 Months', value: '4M' },
                    ]}
                    style={{
                        background: t.surfaceRaised,
                        border: `1px solid ${t.border}`,
                        borderRadius: 8,
                    }}
                />
            </div>

            {/* ── Header row ── */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <div style={{ width: LABEL_W, flexShrink: 0 }} />
                <div style={{ flex: 1, position: 'relative', height: 28, borderBottom: `1px solid ${t.border}` }}>
                    {ticks.map((tick, i) => (
                        <div key={i} style={{
                            position: `absolute`,
                            left: `${toPct(tick)}%`,
                            top: 0,
                            transform: 'translateX(-50%)',
                            color: t.textMuted,
                            fontSize: 10,
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            letterSpacing: 0.2,
                        }}>
                            {tick.format('MMM D')}
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Grid + rows ── */}
            <div style={{ position: 'relative' }}>

                {/* TODAY dashed line */}
                <div style={{
                    position: 'absolute',
                    left: `calc(${LABEL_W}px + ${todayPct} * (100% - ${LABEL_W}px) / 100)`,
                    top: -8, bottom: 0,
                    width: 2,
                    background: 'repeating-linear-gradient(to bottom, t.warning 0px, t.warning 5px, transparent 5px, transparent 10px)',
                    zIndex: 10,
                    pointerEvents: 'none',
                }} />
                {/* TODAY pill */}
                <div style={{
                    position: 'absolute',
                    left: `calc(${LABEL_W}px + ${todayPct} * (100% - ${LABEL_W}px) / 100)`,
                    top: -22,
                    transform: 'translateX(-50%)',
                    background: t.warning,
                    color: `${t.bg}`,
                    fontSize: 9,
                    fontWeight: 900,
                    padding: '2px 9px',
                    borderRadius: 20,
                    whiteSpace: 'nowrap',
                    zIndex: 11,
                    letterSpacing: 0.6,
                    boxShadow: `0 2px 10px ${alpha(t.warning, 0.4)}`,
                    pointerEvents: 'none',
                }}>TODAY</div>

                {groups.map(({ user, tasks: ut }, groupIdx) => {
                    const isEven = groupIdx % 2 === 0;
                    return (
                        <div
                            key={user.id}
                            style={{
                                display: 'flex',
                                alignItems: 'stretch',
                                height: rowH(ut.length),
                                background: isEven ? 'transparent' : `${alpha(t.surfaceRaised, 0.53)}`,
                                borderRadius: 8,
                                marginBottom: 2,
                                transition: `background 0.15s`,
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = `${alpha(t.border, 0.27)}`; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = isEven ? `transparent` : `${alpha(t.surfaceRaised, 0.53)}`; }}
                        >
                            {/* ── Person label ── */}
                            <div style={{
                                width: LABEL_W,
                                flexShrink: 0,
                                paddingRight: 14,
                                paddingLeft: 4,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                borderRight: `1px solid ${t.border}`,
                            }}>
                                <UserAvatar
                                    name={user.fullName}
                                    avatarUrl={user.avatarUrl}
                                    size={34}
                                    userId={user.id}
                                    style={{ border: `2px solid ${t.border}`, flexShrink: 0 }}
                                />
                                <div style={{ minWidth: 0 }}>
                                    <Text style={{
                                        color: t.text, fontSize: 12.5, fontWeight: 700,
                                        display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {user.fullName}
                                    </Text>
                                    <Text style={{ color: t.textMuted, fontSize: 10.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{
                                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                                            background: t.success, boxShadow: `0 0 6px ${t.success}`,
                                        }} />
                                        {ut.length} active task{ut.length > 1 ? 's' : ''}
                                    </Text>
                                </div>
                            </div>

                            {/* ── Track area ── */}
                            <div style={{ flex: 1, position: 'relative', overflow: 'visible' }}>
                                {/* Vertical week grid lines */}
                                {ticks.map((tick, i) => (
                                    <div key={i} style={{
                                        position: 'absolute', left: `${toPct(tick)}%`, top: 0, bottom: 0,
                                        width: 1, background: t.border, opacity: 0.35,
                                    }} />
                                ))}

                                {/* Task bars */}
                                {ut.map((task, idx) => {
                                    const taskStart = task.startDate ? dayjs(task.startDate) : (task.createdAt ? dayjs(task.createdAt) : today);
                                    const taskEnd   = task.deadline  ? dayjs(task.deadline)  : winEnd;
                                    const lPct = toPct(taskStart);
                                    const rPct = toPct(taskEnd);
                                    const wPct = Math.max(rPct - lPct, 8);
                                    // Open since before this view started. The bar alone
                                    // cannot show that, and "how long has this been
                                    // open?" is the thing you want from a timeline.
                                    const openedEarlier = taskStart.isBefore(winStart, 'day');
                                    const color = statusColors[task.status] ?? t.accent;
                                    const gradient = barGradients[task.status] ?? `linear-gradient(90deg, ${alpha(t.accent, 0.87)}, ${alpha(t.accent, 0.6)})`;
                                    const overdue = task.deadline && dayjs(task.deadline).endOf('day').isBefore(today);
                                    const icon = STATUS_ICON[task.status] ?? '●';

                                    return (
                                        <div
                                            key={task.id}
                                            style={{
                                                position: 'absolute',
                                                left: `${lPct}%`,
                                                width: `${wPct}%`,
                                                top: barTop(idx),
                                                zIndex: 2,
                                            }}
                                        >
                                            <Tooltip
                                                placement="top"
                                                title={
                                                    <div style={{ minWidth: 200 }}>
                                                        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>{task.title}</div>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                            <div style={{ fontSize: 11, color: t.textMuted }}>
                                                                <span style={{ color: t.textMuted }}>Project: </span>{task.project?.name ?? '—'}
                                                            </div>
                                                            <div style={{ fontSize: 11, color: t.textMuted }}>
                                                                <span style={{ color: t.textMuted }}>Status: </span>
                                                                <span style={{ color }}>{task.status}</span>
                                                            </div>
                                                            {task.priority && (
                                                                <div style={{ fontSize: 11, color: t.textMuted }}>
                                                                    <span style={{ color: t.textMuted }}>Priority: </span>
                                                                    <span style={{ color: priorityColors[task.priority] ?? t.textMuted }}>{task.priority}</span>
                                                                </div>
                                                            )}
                                                            {task.startDate && (
                                                                <div style={{ fontSize: 11, color: t.textMuted }}>
                                                                    <span style={{ color: t.textMuted }}>Start: </span>
                                                                    {dayjs(task.startDate).format('MMM D, YYYY')}
                                                                </div>
                                                            )}
                                                            {task.deadline && (
                                                                <div style={{ fontSize: 11, color: overdue ? t.danger : t.textMuted, marginTop: 2 }}>
                                                                    <span style={{ color: t.textMuted }}>Deadline: </span>
                                                                    {dayjs(task.deadline).format('MMM D, YYYY')}
                                                                    {overdue && <span style={{ fontWeight: 700 }}> · OVERDUE</span>}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                }
                                            >
                                                {/* Main bar */}
                                                <div style={{
                                                    height: BAR_H,
                                                    borderRadius: openedEarlier ? '0 6px 6px 0' : 6,
                                                    background: overdue
                                                        ? `linear-gradient(90deg, ${alpha(t.danger, 0.87)}, ${alpha(t.danger, 0.6)})`
                                                        : gradient,
                                                    cursor: 'default',
                                                    boxShadow: overdue
                                                        ? `0 2px 10px ${alpha(t.danger, 0.27)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.094)}`
                                                        : `0 2px 10px ${alpha(color, 0.2)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.094)}`,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    paddingLeft: 8,
                                                    paddingRight: task.deadline ? 14 : 8,
                                                    gap: 5,
                                                    overflow: 'hidden',
                                                    transition: 'box-shadow 0.15s, filter 0.15s',
                                                }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.filter = 'brightness(1.18)';
                                                        e.currentTarget.style.boxShadow = `0 4px 18px ${alpha(overdue ? t.danger : color, 0.4)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.157)}`;
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.filter = 'brightness(1)';
                                                        e.currentTarget.style.boxShadow = overdue
                                                            ? `0 2px 10px ${alpha(t.danger, 0.27)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.094)}`
                                                            : `0 2px 10px ${alpha(color, 0.2)}, inset 0 1px 0 ${alpha(t.textOnAccent, 0.094)}`;
                                                    }}
                                                >
                                                    {/* Open since before this view began: show when,
                                                        because the bar's left edge is a cut, not a start. */}
                                                    {openedEarlier && (
                                                        <span
                                                            title={`Open since ${taskStart.format('MMM D, YYYY')}`}
                                                            style={{
                                                                flexShrink: 0,
                                                                fontSize: 9.5,
                                                                fontWeight: 700,
                                                                letterSpacing: 0.2,
                                                                color: t.textOnAccent,
                                                                background: alpha(t.textOnAccent, 0.22),
                                                                borderRadius: 3,
                                                                padding: '1px 5px',
                                                                whiteSpace: 'nowrap',
                                                            }}
                                                        >
                                                            ◀ {taskStart.format('MMM D')}
                                                        </span>
                                                    )}
                                                    <span style={{ fontSize: 12, opacity: 0.9, flexShrink: 0 }}>{icon}</span>
                                                    <span style={{
                                                        color: t.textOnAccent,
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        flex: 1,
                                                        minWidth: 0,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        textShadow: `0 1px 3px ${alpha(t.bg, 0.47)}`,
                                                        letterSpacing: 0.2,
                                                    }}>
                                                        {task.title}
                                                    </span>
                                                    {/* Deadline end-cap marker */}
                                                    {task.deadline && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            right: 0,
                                                            top: 0,
                                                            bottom: 0,
                                                            width: 4,
                                                            borderRadius: '0 6px 6px 0',
                                                            background: overdue ? t.danger : alpha(t.textOnAccent, 0.67),
                                                        }} />
                                                    )}
                                                </div>
                                            </Tooltip>

                                            {/* Always-visible info strip */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 5,
                                                marginTop: 3,
                                                paddingLeft: 4,
                                                paddingRight: 4,
                                                overflow: 'hidden',
                                            }}>
                                                <span style={{
                                                    fontSize: 9.5,
                                                    fontWeight: 700,
                                                    color: overdue ? t.danger : color,
                                                    whiteSpace: 'nowrap',
                                                    letterSpacing: 0.1,
                                                    opacity: 0.9,
                                                }}>
                                                    {icon} {task.status}
                                                </span>
                                                {task.deadline && (
                                                    <span style={{
                                                        fontSize: 9,
                                                        color: overdue ? alpha(t.danger, 0.8) : t.textMuted,
                                                        whiteSpace: 'nowrap',
                                                        marginLeft: 'auto',
                                                    }}>
                                                        {overdue ? '⚠ ' : ''}{dayjs(task.deadline).format('MMM D')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function DashboardPage() {
    // The Monday of the current week, so a link to "reports" lands on the
    // period the dashboard is describing rather than whatever the reports
    // page happens to default to.
    const currentWeekStart = dayjs().startOf('week').add(1, 'day').format('YYYY-MM-DD');
    const { t, statusColors, priorityColors, cardStyle, getNotifStyle } = useDashboardTheme();
    const user     = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const navigate = useNavigate();
    const [summary,  setSummary]  = useState<any>(null);
    const [activity, setActivity] = useState<any>(null);
    const [taskFilter, setTaskFilter] = useState<'all' | 'overdue' | 'today' | 'week' | 'blocked'>('all');
    // Isolated timeline data — loaded from dedicated endpoints, visible to all roles
    const [timelineTasks,    setTimelineTasks]    = useState<any[]>([]);
    const [timelineProjects, setTimelineProjects] = useState<any[]>([]);
    const [loading,  setLoading]  = useState(true);
    const [error,    setError]    = useState<string | null>(null);

    // Modular review authority — each queue is gated by the permission that
    // governs its module, so any user granted that module sees the queue.
    const canReviewFiles   = hasPermission('manage_projects');
    const canReviewTasks   = hasPermission('manage_tasks');
    const canReviewReports = hasPermission('manage_reports');
    const canReviewTickets = hasPermission('manage_users');
    const canReviewAnything = canReviewFiles || canReviewTasks || canReviewReports || canReviewTickets;
    const isReviewer = canReviewTasks || canReviewFiles;

    const [handledReadRequests, setHandledReadRequests] = useState<Set<string>>(new Set());
    const [fileActioning, setFileActioning] = useState<Set<string>>(new Set());

    const handleDashReadRequest = async (notif: any, action: 'accept' | 'reject') => {
        try {
            await api.patch(`/papers/${notif.entityId}/read-request/${notif.id}/${action}`);
            setHandledReadRequests(prev => new Set([...prev, notif.id]));
        } catch { /* silent */ }
    };

    const approveFileInline = async (fileId: string) => {
        setFileActioning(prev => new Set([...prev, fileId]));
        try {
            await api.patch(`/files/${fileId}/approve`);
            message.success('File approved');
            await load();
        } catch {
            message.error('Failed to approve file');
        } finally {
            setFileActioning(prev => { const s = new Set(prev); s.delete(fileId); return s; });
        }
    };

    const rejectFileInline = async (fileId: string) => {
        setFileActioning(prev => new Set([...prev, fileId]));
        try {
            await api.delete(`/files/${fileId}/reject`);
            message.success('File rejected');
            await load();
        } catch {
            message.error('Failed to reject file');
        } finally {
            setFileActioning(prev => { const s = new Set(prev); s.delete(fileId); return s; });
        }
    };

    const navigateFromNotif = (n: any) => {
        switch (n.type) {
            case 'comment_mention':
                if (n.entityType === 'task')    { navigate(deepLink('/tasks', { taskId: n.entityId })); return; }
                if (n.entityType === 'ticket')  { navigate(deepLink('/tickets', { ticketId: n.entityId })); return; }
                if (n.entityType === 'project') { navigate(`/projects/${n.entityId ?? ''}`); return; }
                break;
            case 'task_assigned':
            case 'task_pending_review':
                navigate(deepLink('/tasks', { taskId: n.entityId })); break;
            case 'paper_read_request':
            case 'paper_read_accepted':
            case 'paper_read_rejected':
                navigate(deepLink('/papers', { paperId: n.entityId })); break;
            case 'report_approved':
            case 'report_needs_revision':
            case 'report_submitted':
            case 'report_resubmitted':
                navigate(deepLink('/reports', { reportId: n.entityId })); break;
            case 'file_approved':
            case 'file_rejected':
                navigate(deepLink('/files', { fileId: n.entityId })); break;
            case 'file_pending':
                navigate(deepLink('/files', { fileId: n.entityId })); break;
            case 'ticket_submitted':
                navigate('/support'); break;
            default: break;
        }
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Main dashboard data — tabbed sections depend on these
            const [summaryRes, activityRes] = await Promise.all([
                api.get('/dashboard/summary'),
                api.get('/dashboard/activity'),
            ]);
            setSummary(summaryRes.data);
            setActivity(activityRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load dashboard');
        } finally {
            setLoading(false);
        }

        // Timeline data — isolated fetch, never blocks or breaks main dashboard
        try {
            const [tlTasksRes, tlProjectsRes] = await Promise.all([
                api.get('/dashboard/team-timeline'),
                api.get('/dashboard/project-timeline'),
            ]);
            setTimelineTasks(tlTasksRes.data);
            setTimelineProjects(tlProjectsRes.data);
        } catch {
            // Timeline failing silently — does not affect the rest of the dashboard
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ── Real-time cross-reviewer sync ─────────────────────────────────────────
    // When any reviewer approves/rejects a file or report the backend broadcasts
    // 'dashboard:refresh' so every other reviewer's pending lists update instantly.
    useEffect(() => {
        const socket = io('/', {
            path: '/socket.io',
            transports: ['websocket'],
            reconnectionAttempts: 5,
        });
        socket.on('dashboard:refresh', () => { load(); });
        return () => { socket.disconnect(); };
    // load is stable (useCallback with no deps), so this effect runs only once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
                <Spin size="large" />
            </div>
        );
    }
    if (error) return <Alert type="error" message={error} />;

    const myAssignments: any[] = activity?.recentAssignments ?? [];
    const recentCompletions: any[] = activity?.recentCompletions ?? [];
    const myNotifications: any[] = activity?.recentNotifications ?? [];
    const now = dayjs();
    const activeTasks     = myAssignments.filter((t: any) => t.status !== 'Done' && t.status !== 'Cancelled');
    const overdueCount    = activeTasks.filter((t: any) => t.deadline && dayjs(t.deadline).endOf('day').isBefore(now)).length;
    const completedTodayCount = summary?.completedToday ?? 0;
    const completedThisWeekCount = summary?.completedThisWeek ?? 0;
    const unreadCount     = myNotifications.filter((n: any) => !n.isRead).length;

    // Actionable review notifications shown in "Needs Your Attention" strip
    const actionableNotifs = myNotifications.filter((n: any) =>
        !n.isRead && (['file_pending', 'ticket_submitted'] as string[]).includes(n.type)
    );
    // All-clear: this user has a review queue and every one of their queues is empty.
    const hasReviewQueue = canReviewAnything || (activity?.pendingReadRequests ?? []).length > 0;
    const allClear = hasReviewQueue &&
        (!canReviewFiles   || (activity?.pendingFiles ?? []).length === 0) &&
        (!canReviewTasks   || (activity?.pendingReviewTasks ?? []).length === 0) &&
        (!canReviewReports || (activity?.pendingReports ?? []).length === 0) &&
        (!canReviewTickets || (activity?.pendingTickets ?? []).length === 0) &&
        (activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).length === 0;
    // Notification feed — exclude unread actionable notifs (they appear in the strip above)
    const feedNotifications = myNotifications.filter((n: any) =>
        !((['file_pending', 'ticket_submitted'] as string[]).includes(n.type) && !n.isRead)
    );
    // Notification date buckets for grouped feed
    const todayNotifs     = feedNotifications.filter((n: any) =>  dayjs(n.createdAt).isSame(now, 'day'));
    const yesterdayNotifs = feedNotifications.filter((n: any) =>  dayjs(n.createdAt).isSame(now.subtract(1, 'day'), 'day'));
    const earlierNotifs   = feedNotifications.filter((n: any) => !dayjs(n.createdAt).isSame(now, 'day') && !dayjs(n.createdAt).isSame(now.subtract(1, 'day'), 'day'));

    return (
        <div style={{ padding: '0 0 48px' }}>

            <PageHeader
                title={<Space size={8}><DashboardOutlined />Dashboard</Space>}
                subtitle={`Welcome back, ${user?.fullName?.split(' ')[0] ?? ''} · Week of ${summary?.weekStart ?? '—'}`}
                actions={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
                    {/* Compact status strip */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: t.surfaceRaised, border: `1px solid ${t.border}`,
                        borderRadius: 20, padding: `5px 14px`, fontSize: 12,
                    }}>
                        {overdueCount > 0 ? (
                            <span style={{ color: t.danger, fontWeight: 700 }}>⚡ {overdueCount} overdue</span>
                        ) : (
                            <span style={{ color: t.success, fontWeight: 600 }}>✓ No overdue</span>
                        )}
                        {hasReviewQueue && (summary?.pendingReviewCount ?? 0) > 0 && (
                            <>
                                <span style={{ color: t.border }}>·</span>
                                <span style={{ color: t.purple }}>{summary.pendingReviewCount} pending review</span>
                            </>
                        )}
                        {completedThisWeekCount > 0 && (
                            <>
                                <span style={{ color: t.border }}>·</span>
                                <span style={{ color: t.success }}>
                                    {completedTodayCount > 0
                                        ? `${completedTodayCount} completed today`
                                        : `${completedThisWeekCount} completed this week`}
                                </span>
                            </>
                        )}
                        <span style={{ color: t.border }}>·</span>
                        <span style={{ color: t.textMuted }}>{activeTasks.length} active</span>
                    </div>
                    <Tooltip title="Refresh">
                        <Button icon={<ReloadOutlined />} onClick={load}
                            style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.textMuted }} />
                    </Tooltip>
                </div>
                }
            />

            {/* ── Summary Stats ───────────────────────────── */}
            <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard icon={<CheckSquareOutlined />} title="My Open Tasks"
                        value={summary?.openTasks ?? 0} color={t.accent}
                        overdueCount={overdueCount} />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard icon={<WarningOutlined />} title="Low Stock Items"
                        value={summary?.lowStock ?? 0} color={t.warning} />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard icon={<ProjectOutlined />} title="Active Projects"
                        value={summary?.activeProjects ?? 0} color={t.success} />
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <StatCard
                        icon={hasReviewQueue ? <EyeOutlined /> : <FileTextOutlined />}
                        title={hasReviewQueue ? 'Pending Reviews' : 'Submitted Reports'}
                        value={hasReviewQueue ? (summary?.pendingReviewCount ?? 0) : (summary?.submittedReports ?? 0)}
                        color={t.purple}
                        badge={hasReviewQueue ? (summary?.pendingReviewCount ?? 0) : undefined}
                    />
                </Col>
            </Row>

            {/* ── My Attendance (users without attendance management) ──── */}
            {!hasPermission('manage_attendance') && <MyAttendanceCard />}

            {/* ── Tabs ────────────────────────────────────── */}
            <Tabs
                defaultActiveKey={canReviewAnything && (summary?.pendingReviewCount ?? 0) > 0 ? 'reviews' : 'activity'}
                style={{ color: t.text }}
                items={[
                    // ── Activity Feed ──────────────────────────
                    {
                        key: 'activity',
                        label: (
                            <span>
                                My Activity
                                {unreadCount > 0 && (
                                    <Badge count={unreadCount} size="small" style={{ marginLeft: 6 }} />
                                )}
                            </span>
                        ),
                        children: (
                            <Row gutter={[16, 16]}>
                                {/* Needs Your Attention — actionable unread notifications (reviewers) */}
                                {actionableNotifs.length > 0 && (
                                    <Col xs={24}>
                                        <div style={{
                                            background: t.surfaceRaised,
                                            border: `1px solid ${alpha(t.warning, 0.27)}`,
                                            borderRadius: 12,
                                            overflow: `hidden`,
                                            marginBottom: 4,
                                        }}>
                                            <div style={{
                                                background: `linear-gradient(90deg, ${alpha(t.warning, 0.09)}, ${alpha(t.orange, 0.04)})`,
                                                padding: `10px 16px`,
                                                borderBottom: `1px solid ${alpha(t.warning, 0.19)}`,
                                                display: 'flex', alignItems: 'center', gap: 8,
                                            }}>
                                                <WarningOutlined style={{ color: t.warning, fontSize: 14 }} />
                                                <Text style={{ color: t.warning, fontWeight: 700, fontSize: 13 }}>Needs Your Attention</Text>
                                                <Badge count={actionableNotifs.length} size="small" style={{ background: t.warning }} />
                                            </div>
                                            {actionableNotifs.map((n: any, i: number) => {
                                                const { color, icon } = getNotifStyle(n.type);
                                                return (
                                                    <div key={n.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: 12,
                                                        padding: '10px 16px',
                                                        borderBottom: i < actionableNotifs.length - 1 ? `1px solid ${alpha(t.border, 0.13)}` : undefined,
                                                        borderLeft: `3px solid ${color}`,
                                                        background: `${alpha(color, 0.02)}`,
                                                    }}>
                                                        <span style={{ color, fontSize: 18, flexShrink: 0 }}>{icon}</span>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <Text style={{ color: t.text, fontWeight: 700, fontSize: 13 }}>{n.title}</Text>
                                                            {n.message && (
                                                                <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginTop: 2 }}>{n.message}</Text>
                                                            )}
                                                        </div>
                                                        {n.type === 'file_pending' && (
                                                            <Space size={4} style={{ flexShrink: 0 }}>
                                                                <Button
                                                                    size="small"
                                                                    loading={fileActioning.has(n.entityId)}
                                                                    icon={<CheckCircleOutlined />}
                                                                    onClick={() => approveFileInline(n.entityId)}
                                                                    style={{ background: t.success, borderColor: t.success, color: t.textOnAccent, fontSize: 11, height: 26, borderRadius: 5 }}
                                                                >Approve</Button>
                                                                <Popconfirm
                                                                    title="Reject and delete this file?"
                                                                    onConfirm={() => rejectFileInline(n.entityId)}
                                                                    okText="Reject" cancelText="Cancel"
                                                                    okButtonProps={{ danger: true }}
                                                                >
                                                                    <Button
                                                                        size="small"
                                                                        loading={fileActioning.has(n.entityId)}
                                                                        icon={<CloseCircleOutlined />}
                                                                        style={{ background: 'transparent', borderColor: t.danger, color: t.danger, fontSize: 11, height: 26, borderRadius: 5 }}
                                                                    >Reject</Button>
                                                                </Popconfirm>
                                                            </Space>
                                                        )}
                                                        {n.type === 'ticket_submitted' && (
                                                            <Button
                                                                size="small"
                                                                icon={<ArrowRightOutlined />}
                                                                onClick={() => navigate('/support')}
                                                                style={{ background: 'transparent', borderColor: t.orange, color: t.orange, fontSize: 11, height: 26, borderRadius: 5, flexShrink: 0 }}
                                                            >Review</Button>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </Col>
                                )}
                                {/* LEFT: Assigned Tasks (60%) */}
                                <Col xs={24} lg={14}>
                                    {(() => {
                                        const overdueTaskCount = activeTasks.filter((t: any) => t.deadline && dayjs(t.deadline).endOf('day').isBefore(now)).length;
                                        const todayCount       = activeTasks.filter((t: any) => t.deadline && dayjs(t.deadline).isSame(now, 'day') && !dayjs(t.deadline).endOf('day').isBefore(now)).length;
                                        const weekCount        = activeTasks.filter((t: any) => {
                                            const dl = t.deadline ? dayjs(t.deadline) : null;
                                            return dl && dl.isAfter(now) && dl.isBefore(now.add(7, 'day')) && !dl.isSame(now, 'day');
                                        }).length;
                                        const blockedTaskCount = activeTasks.filter((t: any) => t.status === 'Blocked').length;

                                        const filteredTasks = activeTasks.filter((t: any) => {
                                            if (taskFilter === 'overdue') return t.deadline && dayjs(t.deadline).endOf('day').isBefore(now);
                                            if (taskFilter === 'today') {
                                                return t.deadline && dayjs(t.deadline).isSame(now, 'day') && !dayjs(t.deadline).endOf('day').isBefore(now);
                                            }
                                            if (taskFilter === 'week') {
                                                const dl = t.deadline ? dayjs(t.deadline) : null;
                                                return dl && dl.isAfter(now) && dl.isBefore(now.add(7, 'day')) && !dl.isSame(now, 'day');
                                            }
                                            if (taskFilter === 'blocked') return t.status === 'Blocked';
                                            return true;
                                        });

                                        // Group tasks by urgency for the 'all' view
                                        const groupTasks = (tasks: any[]) => {
                                            const overdue       = tasks.filter(t => t.deadline && dayjs(t.deadline).endOf('day').isBefore(now));
                                            const dueToday      = tasks.filter(t => t.deadline && dayjs(t.deadline).isSame(now, 'day') && !dayjs(t.deadline).endOf('day').isBefore(now));
                                            const thisWeek      = tasks.filter(t => { const dl = t.deadline ? dayjs(t.deadline) : null; return dl && dl.isAfter(now) && dl.isBefore(now.add(7, 'day')) && !dl.isSame(now, 'day'); });
                                            const blocked       = tasks.filter(t => t.status === 'Blocked' && !overdue.some((o: any) => o.id === t.id));
                                            const inProgress    = tasks.filter(t => t.status === 'In Progress' && !overdue.some((o: any) => o.id === t.id) && !blocked.some((b: any) => b.id === t.id) && !dueToday.some((d: any) => d.id === t.id) && !thisWeek.some((w: any) => w.id === t.id));
                                            const pendingReview = tasks.filter(t => t.status === 'Pending Review' && !overdue.some((o: any) => o.id === t.id));
                                            const placed = new Set([...overdue, ...dueToday, ...thisWeek, ...blocked, ...inProgress, ...pendingReview].map((t: any) => t.id));
                                            const todo = tasks.filter(t => !placed.has(t.id));
                                            const groups: { label: string; color: string; tasks: any[] }[] = [];
                                            if (overdue.length)        groups.push({ label: 'OVERDUE',      color: t.danger,    tasks: overdue });
                                            if (dueToday.length)       groups.push({ label: 'DUE TODAY',    color: t.orange, tasks: dueToday });
                                            if (thisWeek.length)       groups.push({ label: 'THIS WEEK',    color: t.warning, tasks: thisWeek });
                                            if (blocked.length)        groups.push({ label: 'BLOCKED',      color: t.danger, tasks: blocked });
                                            if (inProgress.length)     groups.push({ label: 'IN PROGRESS',  color: t.accent,   tasks: inProgress });
                                            if (pendingReview.length)  groups.push({ label: 'UNDER REVIEW', color: t.purple, tasks: pendingReview });
                                            if (todo.length)           groups.push({ label: 'TODO',         color: t.textMuted,  tasks: todo });
                                            return groups;
                                        };

                                        const filterChips: { key: typeof taskFilter; label: string; count: number; color: string }[] = [
                                            { key: 'all',     label: 'All',       count: activeTasks.length, color: t.accent   },
                                            { key: 'overdue', label: 'Overdue',   count: overdueTaskCount,   color: t.danger    },
                                            { key: 'today',   label: 'Due Today', count: todayCount,         color: t.orange },
                                            { key: 'week',    label: 'This Week', count: weekCount,          color: t.warning },
                                            { key: 'blocked', label: 'Blocked',   count: blockedTaskCount,   color: t.danger },
                                        ];

                                        const renderTaskRow = (task: any) => {
                                            const statusColor = statusColors[task.status] ?? t.textMuted;
                                            const isOverdue   = task.deadline && dayjs(task.deadline).endOf('day').isBefore(now);
                                            const dueToday    = task.deadline && dayjs(task.deadline).isSame(now, 'day') && !isOverdue;
                                            const isNew       = dayjs(task.createdAt).isAfter(now.subtract(48, 'hour'));
                                            const leftColor   = isOverdue ? t.danger : statusColor;
                                            return (
                                                <div key={task.id} onClick={() => navigate(deepLink('/tasks', { taskId: task.id }))}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 12,
                                                        padding: '10px 18px 10px 15px',
                                                        borderBottom: `1px solid ${alpha(t.border, 0.13)}`,
                                                        borderLeft: `3px solid ${leftColor}`,
                                                        background: isOverdue ? `${alpha(t.danger, 0.03)}` : 'transparent',
                                                        cursor: 'pointer', transition: 'background 0.15s',
                                                    }}
                                                    onMouseEnter={(e) => (e.currentTarget.style.background = isOverdue ? `${alpha(t.danger, 0.07)}` : t.surfaceRaised)}
                                                    onMouseLeave={(e) => (e.currentTarget.style.background = isOverdue ? `${alpha(t.danger, 0.03)}` : 'transparent')}
                                                >
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 2 }}>
                                                            <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>{task.title}</Text>
                                                            {isNew && (
                                                                <span style={{ background: `${alpha(t.success, 0.13)}`, color: t.success, border: `1px solid ${alpha(t.success, 0.27)}`, borderRadius: 8, fontSize: 10, padding: `0 5px`, fontWeight: 700 }}>NEW</span>
                                                            )}
                                                        </div>
                                                        <Space size={8} wrap>
                                                            {task.project && (
                                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                    <FolderOpenOutlined style={{ marginRight: 3 }} />{task.project.name}
                                                                </Text>
                                                            )}
                                                            {task.deadline && (
                                                                <Text style={{ color: isOverdue ? t.danger : dueToday ? t.orange : t.textMuted, fontSize: 11, fontWeight: isOverdue || dueToday ? 600 : 400 }}>
                                                                    <CalendarOutlined style={{ marginRight: 3 }} />
                                                                    {isOverdue
                                                                        ? `Overdue ${dayjs(task.deadline).fromNow()}`
                                                                        : dueToday ? 'Due today'
                                                                        : `Due ${dayjs(task.deadline).format('MMM D')}`}
                                                                </Text>
                                                            )}
                                                            {task.creator && (
                                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                    <UserOutlined style={{ marginRight: 3 }} />By {task.creator.fullName}
                                                                </Text>
                                                            )}
                                                        </Space>
                                                    </div>
                                                    <Space size={4} style={{ flexShrink: 0 }}>
                                                        {task.priority && (
                                                            <Tag style={{
                                                                fontSize: 10, padding: '0 6px', margin: 0, borderRadius: 10,
                                                                background: `${alpha(priorityColors[task.priority] ?? t.textMuted, 0.09)}`,
                                                                color: priorityColors[task.priority] ?? t.textMuted,
                                                                border: `1px solid ${alpha(priorityColors[task.priority] ?? t.textMuted, 0.27)}`,
                                                            }}>{task.priority}</Tag>
                                                        )}
                                                        <Tag style={{
                                                            fontSize: 10, padding: `0 6px`, margin: 0, borderRadius: 10,
                                                            background: `${alpha(statusColor, 0.09)}`, color: statusColor,
                                                            border: `1px solid ${alpha(statusColor, 0.27)}`,
                                                        }}>{taskStatusLabel(task.status, isReviewer)}</Tag>
                                                    </Space>
                                                </div>
                                            );
                                        };

                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                                <Card
                                                    title={
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <CheckSquareOutlined style={{ color: t.accent }} />
                                                            <Text style={{ color: t.text, fontWeight: 600 }}>My Assigned Tasks</Text>
                                                            <Tag style={{ background: `${alpha(t.accent, 0.09)}`, color: t.accent, border: `1px solid ${alpha(t.accent, 0.19)}`, borderRadius: 10, fontSize: 11 }}>
                                                                {activeTasks.length} active
                                                            </Tag>
                                                            {overdueTaskCount > 0 && (
                                                                <Tag style={{ background: `${alpha(t.danger, 0.09)}`, color: t.danger, border: `1px solid ${alpha(t.danger, 0.19)}`, borderRadius: 10, fontSize: 11 }}>
                                                                    {overdueTaskCount} overdue
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    }
                                                    extra={
                                                        <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                            onClick={() => navigate('/tasks')} style={{ color: t.accent, padding: 0 }}>
                                                            View all
                                                        </Button>
                                                    }
                                                    style={cardStyle}
                                                    styles={{ body: { padding: 0 } }}
                                                >
                                                    {/* ── Urgency Banner ── */}
                                                    {(overdueTaskCount + blockedTaskCount) > 0 && (
                                                        <div style={{
                                                            background: `linear-gradient(90deg, ${alpha(t.danger, 0.13)}, ${alpha(t.danger, 0.08)})`,
                                                            borderBottom: `1px solid ${alpha(t.danger, 0.27)}`,
                                                            padding: '10px 18px',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                                <WarningOutlined style={{ color: t.danger, fontSize: 16 }} />
                                                                <div>
                                                                    <Text style={{ color: t.danger, fontWeight: 700, fontSize: 13 }}>Attention required</Text>
                                                                    <Text style={{ color: `${alpha(t.danger, 0.8)}`, fontSize: 11, display: `block` }}>
                                                                        {[
                                                                            overdueTaskCount > 0 && `${overdueTaskCount} overdue`,
                                                                            blockedTaskCount > 0 && `${blockedTaskCount} blocked`,
                                                                        ].filter(Boolean).join(` · `)}
                                                                    </Text>
                                                                </div>
                                                            </div>
                                                            <Button size="small" type="link" icon={<ArrowRightOutlined />}
                                                                onClick={() => navigate('/tasks')}
                                                                style={{ color: t.danger, fontWeight: 700, flexShrink: 0, padding: 0 }}>
                                                                Go to Tasks
                                                            </Button>
                                                        </div>
                                                    )}

                                                    {/* ── Filter chips ── */}
                                                    <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: `1px solid ${t.border}`, flexWrap: `wrap` }}>
                                                        {filterChips.map(({ key, label, count, color }) => {
                                                            const isActive = taskFilter === key;
                                                            return (
                                                                <button key={key} onClick={() => setTaskFilter(key)} style={{
                                                                    background: isActive ? `${alpha(color, 0.13)}` : 'transparent',
                                                                    color: isActive ? color : t.textMuted,
                                                                    border: `1px solid ${isActive ? color + '55' : t.border}`,
                                                                    borderRadius: 20, padding: '3px 10px', fontSize: 11,
                                                                    fontWeight: isActive ? 700 : 400, cursor: 'pointer',
                                                                    display: 'flex', alignItems: 'center', gap: 5, transition: 'all 0.15s',
                                                                }}>
                                                                    {label}
                                                                    {count > 0 && (
                                                                        <span style={{
                                                                            background: isActive ? color : t.border,
                                                                            color: isActive ? t.textOnAccent : t.textMuted,
                                                                            borderRadius: 10, padding: '0 5px',
                                                                            fontSize: 10, fontWeight: 700, minWidth: 18, textAlign: 'center' as const,
                                                                        }}>{count}</span>
                                                                    )}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>

                                                    {filteredTasks.length === 0 ? (
                                                        <Empty
                                                            description={<Text style={{ color: t.textMuted }}>
                                                                {taskFilter === 'overdue' ? 'No overdue tasks — great work!' :
                                                                 taskFilter === 'today'   ? 'Nothing due today' :
                                                                 taskFilter === 'week'    ? 'Nothing due this week' :
                                                                 taskFilter === 'blocked' ? 'No blocked tasks' :
                                                                 'No active tasks assigned to you'}
                                                            </Text>}
                                                            style={{ padding: '32px 0' }}
                                                        />
                                                    ) : taskFilter === 'all' ? (
                                                        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                                            {groupTasks(filteredTasks).map(({ label, color, tasks: g }) => (
                                                                <div key={label}>
                                                                    <div style={{
                                                                        padding: '5px 18px',
                                                                        background: `${alpha(color, 0.04)}`,
                                                                        borderBottom: `1px solid ${alpha(t.border, 0.13)}`,
                                                                        display: 'flex', alignItems: 'center', gap: 8,
                                                                    }}>
                                                                        <div style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
                                                                        <Text style={{ color, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8 }}>{label}</Text>
                                                                        <Text style={{ color: t.textMuted, fontSize: 10 }}>· {g.length}</Text>
                                                                    </div>
                                                                    {g.map(renderTaskRow)}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                                            {filteredTasks.map(renderTaskRow)}
                                                        </div>
                                                    )}
                                                </Card>

                                                <Card
                                                    title={
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <CheckCircleOutlined style={{ color: t.success }} />
                                                            <Text style={{ color: t.text, fontWeight: 600 }}>Recently Completed</Text>
                                                            <Tag style={{ background: `${alpha(t.success, 0.09)}`, color: t.success, border: `1px solid ${alpha(t.success, 0.19)}`, borderRadius: 10, fontSize: 11 }}>
                                                                {completedThisWeekCount} this week
                                                            </Tag>
                                                            {completedTodayCount > 0 && (
                                                                <Tag style={{ background: `${alpha(t.accent, 0.09)}`, color: t.accent, border: `1px solid ${alpha(t.accent, 0.19)}`, borderRadius: 10, fontSize: 11 }}>
                                                                    {completedTodayCount} today
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    }
                                                    extra={
                                                        <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                            onClick={() => navigate(deepLink('/reports', { week: currentWeekStart }))}
                                                            style={{ color: t.success, padding: 0 }}>
                                                            Open reports
                                                        </Button>
                                                    }
                                                    style={cardStyle}
                                                    styles={{ body: { padding: '8px 0' } }}
                                                >
                                                    {recentCompletions.length === 0 ? (
                                                        <Empty
                                                            description={<Text style={{ color: t.textMuted }}>No tasks completed this week yet</Text>}
                                                            style={{ padding: '24px 0' }}
                                                        />
                                                    ) : (
                                                        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                                                            {recentCompletions.map((task: any, index: number) => {
                                                                const completedAt = getTaskCompletionMoment(task);
                                                                return (
                                                                    <div key={task.id}
                                                                        onClick={() => navigate(deepLink('/reports', { week: currentWeekStart }))}
                                                                        style={{
                                                                            display: 'flex', alignItems: 'center', gap: 12,
                                                                            padding: '11px 16px',
                                                                            borderBottom: index < recentCompletions.length - 1 ? `1px solid ${alpha(t.border, 0.13)}` : undefined,
                                                                            borderLeft: `3px solid ${t.success}`,
                                                                            cursor: 'pointer',
                                                                            background: 'transparent',
                                                                        }}
                                                                        onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceRaised)}
                                                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                                    >
                                                                        <div style={{
                                                                            width: 34, height: 34, borderRadius: 10,
                                                                            background: `${alpha(t.success, 0.09)}`, border: `1px solid ${alpha(t.success, 0.2)}`,
                                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                            color: t.success, flexShrink: 0,
                                                                        }}>
                                                                            <CheckCircleOutlined />
                                                                        </div>
                                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                                                                                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>{task.title}</Text>
                                                                                <Tag style={{
                                                                                    fontSize: 10, padding: '0 6px', margin: 0, borderRadius: 10,
                                                                                    background: `${alpha(t.success, 0.09)}`, color: t.success, border: `1px solid ${alpha(t.success, 0.27)}`,
                                                                                }}>Done</Tag>
                                                                            </div>
                                                                            <Space size={8} wrap>
                                                                                {task.project && (
                                                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                                        <FolderOpenOutlined style={{ marginRight: 3 }} />{task.project.name}
                                                                                    </Text>
                                                                                )}
                                                                                {completedAt && (
                                                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                                        <CalendarOutlined style={{ marginRight: 3 }} />Completed {completedAt.fromNow()}
                                                                                    </Text>
                                                                                )}
                                                                                {task.deadline && (
                                                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                                        Due {dayjs(task.deadline).format('MMM D')}
                                                                                    </Text>
                                                                                )}
                                                                            </Space>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </Card>
                                            </div>
                                        );
                                    })()}
                                </Col>

                                {/* RIGHT: Notification feed (40%) — grouped by recency */}
                                <Col xs={24} lg={10}>
                                    <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <BellOutlined style={{ color: t.warning }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Notifications</Text>
                                                {unreadCount > 0 && (
                                                    <Tag style={{
                                                        background: `${alpha(t.danger, 0.13)}`, color: t.danger,
                                                        border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 10, fontSize: 11,
                                                    }}>{unreadCount} new</Tag>
                                                )}
                                            </div>
                                        }
                                        extra={
                                            unreadCount > 0 ? (
                                                <Button
                                                    type="link" size="small"
                                                    onClick={async () => {
                                                        try {
                                                            await api.patch('/notifications/read-all');
                                                            setActivity((prev: any) => prev ? {
                                                                ...prev,
                                                                recentNotifications: (prev.recentNotifications ?? []).map((n: any) => ({ ...n, isRead: true })),
                                                            } : prev);
                                                        } catch { /* silent */ }
                                                    }}
                                                    style={{ color: t.textMuted, padding: 0, fontSize: 11 }}
                                                >Mark all read</Button>
                                            ) : undefined
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {feedNotifications.length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No recent updates</Text>}
                                                style={{ padding: '32px 0' }} />
                                        ) : (
                                            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                                {[
                                                    { label: 'TODAY',     items: todayNotifs },
                                                    { label: 'YESTERDAY', items: yesterdayNotifs },
                                                    { label: 'EARLIER',   items: earlierNotifs },
                                                ].filter(g => g.items.length > 0).map(({ label, items }, gi) => (
                                                    <div key={label}>
                                                        <div style={{
                                                            padding: '6px 16px 4px',
                                                            background: t.surfaceRaised,
                                                            borderTop: gi > 0 ? `1px solid ${t.border}` : undefined,
                                                            borderBottom: `1px solid ${t.border}`,
                                                        }}>
                                                            <Text style={{ color: t.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: 0.8 }}>{label}</Text>
                                                        </div>
                                                        {items.map((n: any) => {
                                                            const { color, icon } = getNotifStyle(n.type);
                                                            const isPaperRequest = n.type === 'paper_read_request' && !handledReadRequests.has(n.id);
                                                            return (
                                                                <div key={n.id}
                                                                    style={{
                                                                        display: 'flex', gap: 10, padding: '11px 16px',
                                                                        borderBottom: `1px solid ${alpha(t.border, 0.13)}`,
                                                                        borderLeft: `3px solid ${color}`,
                                                                        background: n.isRead ? `transparent` : `${alpha(color, 0.03)}`,
                                                                        cursor: isPaperRequest ? 'default' : 'pointer',
                                                                    }}
                                                                    onClick={isPaperRequest ? undefined : () => navigateFromNotif(n)}
                                                                >
                                                                    <span style={{ color, fontSize: 16, marginTop: 2, flexShrink: 0 }}>{icon}</span>
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
                                                                            <Text style={{ color: t.text, fontWeight: n.isRead ? 400 : 700, fontSize: 13 }}>{n.title}</Text>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                                                                                {!n.isRead && <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
                                                                                <Text style={{ color: t.textMuted, fontSize: 10, whiteSpace: 'nowrap' }}>{dayjs(n.createdAt).fromNow()}</Text>
                                                                            </div>
                                                                        </div>
                                                                        {n.message && (
                                                                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginTop: 2 }}>{n.message}</Text>
                                                                        )}
                                                                        {isPaperRequest && (
                                                                            <Space size={4} style={{ marginTop: 7 }}>
                                                                                <Button size="small" icon={<CheckCircleOutlined />}
                                                                                    onClick={() => handleDashReadRequest(n, 'accept')}
                                                                                    style={{ background: t.success, borderColor: t.success, color: t.textOnAccent, fontSize: 11, height: 26, borderRadius: 5 }}>
                                                                                    Accept
                                                                                </Button>
                                                                                <Button size="small" icon={<CloseCircleOutlined />}
                                                                                    onClick={() => handleDashReadRequest(n, 'reject')}
                                                                                    style={{ background: 'transparent', borderColor: t.danger, color: t.danger, fontSize: 11, height: 26, borderRadius: 5 }}>
                                                                                    Decline
                                                                                </Button>
                                                                                <Button size="small" icon={<EyeOutlined />}
                                                                                    onClick={() => navigate(deepLink('/papers', { paperId: n.entityId }))}
                                                                                    style={{ background: 'transparent', borderColor: t.accent, color: t.accent, fontSize: 11, height: 26, borderRadius: 5 }}>
                                                                                    Open Paper
                                                                                </Button>
                                                                            </Space>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                </Col>
                            </Row>
                        ),
                    },
                    // ── Pending Reviews (per-module permissions) ───────────
                    // Each queue below is rendered only for users holding the
                    // permission that governs that module.
                    ...(hasReviewQueue ? [{
                        key: 'reviews',
                        label: (
                            <span>
                                Pending Reviews
                                {(summary?.pendingReviewCount ?? 0) > 0 && (
                                    <Badge count={summary?.pendingReviewCount} size="small"
                                        style={{ marginLeft: 6, background: t.danger }} />
                                )}
                            </span>
                        ),
                        children: (() => {
                            if (allClear) return (
                                <div style={{ textAlign: 'center', padding: '80px 20px' }}>
                                    <div style={{
                                        display: 'inline-flex', flexDirection: 'column',
                                        alignItems: 'center', gap: 16,
                                        background: t.surfaceRaised,
                                        border: `1px solid ${alpha(t.success, 0.27)}`,
                                        borderRadius: 20, padding: '48px 72px',
                                    }}>
                                        <CheckCircleOutlined style={{ color: t.success, fontSize: 52 }} />
                                        <div>
                                            <Text style={{ color: t.success, fontWeight: 700, fontSize: 20, display: 'block' }}>All caught up!</Text>
                                            <Text style={{ color: t.textMuted, fontSize: 14, display: 'block', marginTop: 4 }}>Nothing pending review — great work!</Text>
                                        </div>
                                    </div>
                                </div>
                            );
                            return (
                                <>
                                    <div style={{ marginBottom: 16, color: t.textMuted, fontSize: 13, paddingTop: 2 }}>
                                        Items awaiting your approval — review inline or visit the respective page for full context.
                                    </div>
                                    <Row gutter={[16, 16]}>
                                        {/* Pending Files & Manuals */}
                                        {canReviewFiles && (
                                        <Col xs={24} lg={12}>
                                            <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <FilePdfOutlined style={{ color: t.accent }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Files & Manuals Pending Review</Text>
                                                {(summary?.pendingFilesCount ?? 0) > 0 && (
                                                    <Tag style={{
                                                        background: `${alpha(t.warning, 0.13)}`, color: t.warning,
                                                        border: `1px solid ${alpha(t.warning, 0.27)}`, borderRadius: 10, fontSize: 11,
                                                    }}>{summary?.pendingFilesCount}</Tag>
                                                )}
                                            </div>
                                        }
                                        extra={
                                            <Space>
                                                <Button type="link" size="small" onClick={() => navigate('/files')}
                                                    style={{ color: t.accent, padding: 0 }}>Files</Button>
                                                <Button type="link" size="small" onClick={() => navigate('/manuals')}
                                                    style={{ color: t.accent, padding: 0 }}>Manuals</Button>
                                            </Space>
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {(activity?.pendingFiles ?? []).length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No pending files</Text>}
                                                style={{ padding: '24px 0' }} />
                                        ) : (
                                            <div>
                                                {(activity?.pendingFiles ?? []).map((f: any, i: number) => (
                                                    <div key={f.id} style={{
                                                        display: 'flex', alignItems: 'center', gap: 10,
                                                        padding: '10px 16px',
                                                        borderBottom: i < (activity?.pendingFiles?.length ?? 0) - 1 ? `1px solid ${t.border}` : undefined,
                                                        borderLeft: `3px solid ${t.accent}`,
                                                    }}>
                                                        <FilePdfOutlined style={{ color: t.accent, fontSize: 18, flexShrink: 0 }} />
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <Text style={{
                                                                color: t.text, fontSize: 13, fontWeight: 600, display: 'block',
                                                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                            }}>{f.originalName}</Text>
                                                            <Space size={6} style={{ marginTop: 2 }}>
                                                                <Tag style={{
                                                                    background: f.type === 'manual' ? `${alpha(t.purple, 0.13)}` : f.type === 'paper' ? `${alpha(t.orange, 0.13)}` : `${alpha(t.accent, 0.13)}`,
                                                                    color: f.type === 'manual' ? t.purple : f.type === 'paper' ? t.orange : t.accent,
                                                                    border: `1px solid ${alpha(f.type === 'manual' ? t.purple : f.type === 'paper' ? t.orange : t.accent, 0.27)}`,
                                                                    borderRadius: 6, fontSize: 10, margin: 0,
                                                                }}>{f.type === 'manual' ? 'Manual' : f.type === 'paper' ? 'Paper' : 'File'}</Tag>
                                                                {f.project && <Text style={{ color: t.textMuted, fontSize: 11 }}>{f.project.name}</Text>}
                                                                {f.uploader && <Text style={{ color: t.textMuted, fontSize: 11 }}>by {f.uploader.fullName}</Text>}
                                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>{dayjs(f.createdAt).fromNow()}</Text>
                                                            </Space>
                                                        </div>
                                                        <Space size={4} style={{ flexShrink: 0 }}>
                                                            <Button
                                                                size="small"
                                                                loading={fileActioning.has(f.id)}
                                                                icon={<CheckCircleOutlined />}
                                                                onClick={() => approveFileInline(f.id)}
                                                                style={{ background: t.success, borderColor: t.success, color: t.textOnAccent, fontSize: 11, height: 26, borderRadius: 5 }}
                                                            >Approve</Button>
                                                            <Popconfirm
                                                                title="Reject and delete this file?"
                                                                description="This action cannot be undone."
                                                                onConfirm={() => rejectFileInline(f.id)}
                                                                okText="Reject" cancelText="Cancel"
                                                                okButtonProps={{ danger: true }}
                                                            >
                                                                <Button
                                                                    size="small"
                                                                    loading={fileActioning.has(f.id)}
                                                                    icon={<CloseCircleOutlined />}
                                                                    style={{ background: 'transparent', borderColor: t.danger, color: t.danger, fontSize: 11, height: 26, borderRadius: 5 }}
                                                                >Reject</Button>
                                                            </Popconfirm>
                                                            <Button
                                                                type="link" size="small" icon={<EyeOutlined />}
                                                                onClick={() => navigate(deepLink(
                                                                    f.type === 'manual' ? '/manuals' : f.type === 'paper' ? '/papers' : '/files',
                                                                    f.type === 'paper' ? { paperId: f.id } : { fileId: f.id },
                                                                ))}
                                                                style={{ color: t.accent, padding: 0, fontSize: 11 }}
                                                            >View</Button>
                                                        </Space>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                </Col>
                                )}

                                {/* Tasks Pending Review — requires manage_tasks */}
                                {canReviewTasks && (
                                <Col xs={24} lg={12}>
                                    <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <EyeOutlined style={{ color: t.purple }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Tasks Awaiting Review</Text>
                                                {(summary?.pendingReviewTasksCount ?? 0) > 0 && (
                                                    <Tag style={{
                                                        background: `${alpha(t.purple, 0.13)}`, color: t.purple,
                                                        border: `1px solid ${alpha(t.purple, 0.27)}`, borderRadius: 10, fontSize: 11,
                                                    }}>{summary?.pendingReviewTasksCount}</Tag>
                                                )}
                                            </div>
                                        }
                                        extra={
                                            <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                onClick={() => navigate('/tasks')} style={{ color: t.accent, padding: 0 }}>
                                                Go to Tasks
                                            </Button>
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {(activity?.pendingReviewTasks ?? []).length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No tasks pending review</Text>}
                                                style={{ padding: '24px 0' }} />
                                        ) : (
                                            <div>
                                                {(activity?.pendingReviewTasks ?? []).map((task: any, i: number) => (
                                                    <div key={task.id}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 10,
                                                            padding: '10px 16px',
                                                            borderBottom: i < (activity?.pendingReviewTasks?.length ?? 0) - 1 ? `1px solid ${t.border}` : undefined,
                                                            borderLeft: `3px solid ${t.purple}`,
                                                            cursor: 'pointer',
                                                        }}
                                                        onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceRaised)}
                                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                    >
                                                        <EyeOutlined style={{ color: t.purple, fontSize: 16, flexShrink: 0 }} />
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <Text style={{ color: t.text, fontSize: 13, fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</Text>
                                                            <Space size={6} style={{ marginTop: 2 }}>
                                                                {task.project && <Text style={{ color: t.textMuted, fontSize: 11 }}>{task.project.name}</Text>}
                                                                {task.assignee && <Text style={{ color: t.textMuted, fontSize: 11 }}>by {task.assignee.fullName}</Text>}
                                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>{dayjs(task.updatedAt ?? task.createdAt).fromNow()}</Text>
                                                            </Space>
                                                        </div>
                                                        <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                            onClick={() => navigate('/tasks')}
                                                            style={{ color: t.accent, padding: 0, flexShrink: 0 }}>
                                                            Go to Tasks
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                </Col>
                                )}

                                {/* Reports awaiting review — requires manage_reports */}
                                {canReviewReports && (
                                <Col xs={24}>
                                    <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <FileTextOutlined style={{ color: t.orange }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Weekly Reports — Awaiting Your Review</Text>
                                            </div>
                                        }
                                        extra={
                                            <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                onClick={() => navigate(deepLink('/reports', { week: currentWeekStart }))}
                                                style={{ color: t.accent, padding: 0 }}>
                                                Go to Reports
                                            </Button>
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {(activity?.pendingReports ?? []).length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No reports awaiting review</Text>}
                                                style={{ padding: '24px 0' }} />
                                        ) : (
                                            <Row gutter={[8, 8]} style={{ padding: '12px 16px' }}>
                                                {(activity?.pendingReports ?? []).map((r: any) => (
                                                    <Col key={r.id} xs={24} sm={12} md={8} lg={6}>
                                                        <div
                                                            style={{
                                                                background: t.surfaceRaised, border: `1px solid ${t.border}`,
                                                                borderRadius: 10, padding: '12px 14px', cursor: 'pointer',
                                                                transition: 'border-color 0.15s',
                                                            }}
                                                            onMouseEnter={(e) => (e.currentTarget.style.borderColor = t.orange)}
                                                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = t.border)}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                                                <UserAvatar
                                                                    name={r.user?.fullName ?? r.userId}
                                                                    avatarUrl={r.user?.avatarUrl}
                                                                    size={28}
                                                                    userId={r.user?.id}
                                                                />
                                                                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {r.user?.fullName ?? r.userId}
                                                                </Text>
                                                            </div>
                                                            <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                                                                Week {r.weekStart} · {r.totalHours}h
                                                            </Text>
                                                            <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                                onClick={() => navigate(deepLink('/reports', {
                                                                    reportId: r.id,
                                                                    week: r.weekStart,
                                                                }))}
                                                                style={{ color: t.orange, padding: 0, marginTop: 6, fontWeight: 600, fontSize: 11 }}>
                                                                Review
                                                            </Button>
                                                        </div>
                                                    </Col>
                                                ))}
                                            </Row>
                                        )}
                                    </Card>
                                </Col>
                                )}

                                {/* Support Ticket Reviews — requires manage_users (matches tickets.controller.ts) */}
                                {canReviewTickets && (
                                <Col xs={24}>
                                    <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <CustomerServiceOutlined style={{ color: t.accent }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Support Tickets — Awaiting Review</Text>
                                                {(activity?.pendingTickets ?? []).length > 0 && (
                                                    <Tag style={{
                                                        background: `${alpha(t.accent, 0.13)}`, color: t.accent,
                                                        border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 10, fontSize: 11,
                                                    }}>{(activity?.pendingTickets ?? []).length}</Tag>
                                                )}
                                            </div>
                                        }
                                        extra={
                                            <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                onClick={() => navigate('/support')} style={{ color: t.accent, padding: 0 }}>
                                                Go to Support
                                            </Button>
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {(activity?.pendingTickets ?? []).length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No tickets awaiting review</Text>}
                                                style={{ padding: '24px 0' }} />
                                        ) : (
                                            <div>
                                                {(activity?.pendingTickets ?? []).map((task: any, i: number) => (
                                                    <div key={task.id}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 10,
                                                            padding: '10px 16px',
                                                            borderBottom: i < (activity?.pendingTickets?.length ?? 0) - 1 ? `1px solid ${t.border}` : undefined,
                                                            borderLeft: `3px solid ${task.type === 'bug' ? t.danger : t.purple}`,
                                                            cursor: 'pointer',
                                                        }}
                                                        onMouseEnter={(e) => (e.currentTarget.style.background = t.surfaceRaised)}
                                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                                                    >
                                                        <Tag style={{
                                                            background: task.type === 'bug' ? `${alpha(t.danger, 0.13)}` : `${alpha(t.purple, 0.13)}`,
                                                            color: task.type === 'bug' ? t.danger : t.purple,
                                                            border: `1px solid ${alpha(task.type === 'bug' ? t.danger : t.purple, 0.27)}`,
                                                            borderRadius: 6, fontSize: 10, flexShrink: 0, textTransform: 'capitalize',
                                                        }}>{task.type === 'access_request' ? 'Access' : task.type}</Tag>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <Text style={{ color: t.text, fontSize: 13, fontWeight: 600, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.title}</Text>
                                                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                                by {task.submitter?.fullName ?? '—'} · {dayjs(task.createdAt).fromNow()}
                                                            </Text>
                                                        </div>
                                                        <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                            onClick={() => navigate('/support')}
                                                            style={{ color: t.accent, padding: 0, flexShrink: 0 }}>
                                                            Open
                                                        </Button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                </Col>
                                )}

                                {/* Paper Reading Requests — personal, addressed to this user */}
                                {(activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).length > 0 && (
                                <Col xs={24}>
                                    <Card
                                        title={
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <BookOutlined style={{ color: t.accent }} />
                                                <Text style={{ color: t.text, fontWeight: 600 }}>Paper Reading Requests</Text>
                                                {(activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).length > 0 && (
                                                    <Tag style={{
                                                        background: `${alpha(t.accent, 0.13)}`, color: t.accent,
                                                        border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 10, fontSize: 11,
                                                    }}>{(activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).length}</Tag>
                                                )}
                                            </div>
                                        }
                                        extra={
                                            <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                                onClick={() => navigate('/papers')} style={{ color: t.accent, padding: 0 }}>
                                                Go to Papers
                                            </Button>
                                        }
                                        style={cardStyle} styles={{ body: { padding: '8px 0' } }}
                                    >
                                        {(activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).length === 0 ? (
                                            <Empty description={<Text style={{ color: t.textMuted }}>No pending reading requests</Text>}
                                                style={{ padding: '24px 0' }} />
                                        ) : (
                                            <div>
                                                {(activity?.pendingReadRequests ?? []).filter((n: any) => !handledReadRequests.has(n.id)).map((n: any, i: number, arr: any[]) => (
                                                    <div key={n.id} style={{
                                                        display: 'flex', alignItems: 'flex-start', gap: 10,
                                                        padding: '12px 16px',
                                                        borderBottom: i < arr.length - 1 ? `1px solid ${t.border}` : undefined,
                                                        borderLeft: `3px solid ${t.accent}`,
                                                    }}>
                                                        <BookOutlined style={{ color: t.accent, fontSize: 18, flexShrink: 0, marginTop: 2 }} />
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <Text style={{ color: t.text, fontSize: 13, fontWeight: 600, display: 'block' }}>
                                                                {n.title}
                                                            </Text>
                                                            <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 1 }}>
                                                                {n.message}
                                                            </Text>
                                                            <Text style={{ color: t.border, fontSize: 11, display: 'block', marginTop: 2 }}>
                                                                {dayjs(n.createdAt).fromNow()}
                                                            </Text>
                                                        </div>
                                                        <Space size={6} style={{ flexShrink: 0 }}>
                                                            <Button
                                                                size="small"
                                                                icon={<CheckCircleOutlined />}
                                                                onClick={() => handleDashReadRequest(n, 'accept')}
                                                                style={{ background: t.success, borderColor: t.success, color: t.textOnAccent, fontSize: 11, height: 26, borderRadius: 5 }}
                                                            >
                                                                Accept
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                icon={<CloseCircleOutlined />}
                                                                onClick={() => handleDashReadRequest(n, 'reject')}
                                                                style={{ background: 'transparent', borderColor: t.danger, color: t.danger, fontSize: 11, height: 26, borderRadius: 5 }}
                                                            >
                                                                Decline
                                                            </Button>
                                                            <Button
                                                                size="small"
                                                                icon={<EyeOutlined />}
                                                                onClick={() => navigate(deepLink('/papers', { paperId: n.entityId }))}
                                                                style={{ background: 'transparent', borderColor: t.accent, color: t.accent, fontSize: 11, height: 26, borderRadius: 5 }}
                                                            >
                                                                Open Paper
                                                            </Button>
                                                        </Space>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </Card>
                                </Col>
                                )}
                            </Row>
                                </>
                            );
                        })(),
                    }] : []),

                    // ── Timelines tab ─────────────────────────────────────
                    {
                        key: 'timelines',
                        label: 'Timelines',
                        children: (
                            <>
                                {/* Project Gantt — visible to all; data is scoped by membership for non-managers */}
                                <Card
                                    title={
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <ProjectOutlined style={{ color: t.success }} />
                                            <Text style={{ color: t.text, fontWeight: 600 }}>Project Gantt</Text>
                                            <Tag style={{
                                                background: `${alpha(t.success, 0.09)}`, color: t.success,
                                                border: `1px solid ${alpha(t.success, 0.19)}`, borderRadius: 10, fontSize: 11,
                                            }}>{timelineVisible(timelineProjects).length} active</Tag>
                                        </div>
                                    }
                                    extra={
                                        <Button type="link" size="small" icon={<ArrowRightOutlined />}
                                            onClick={() => navigate('/projects')} style={{ color: t.accent, padding: 0 }}>
                                            All Projects
                                        </Button>
                                    }
                                    style={{ ...cardStyle, marginBottom: 16 }}
                                    styles={{ body: { padding: '16px 20px' } }}
                                >
                                    <GanttTimeline projects={timelineProjects} />
                                </Card>

                                <Card
                                    title={
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <CheckSquareOutlined style={{ color: t.accent }} />
                                            <Text style={{ color: t.text, fontWeight: 600 }}>Task Assignments Timeline</Text>
                                            <Tag style={{
                                                background: `${alpha(t.accent, 0.09)}`, color: t.accent,
                                                border: `1px solid ${alpha(t.accent, 0.19)}`, borderRadius: 10, fontSize: 11,
                                            }}>{timelineTasks.filter((t) => t.assignee && t.status !== 'Done').length} active</Tag>
                                        </div>
                                    }
                                    style={cardStyle}
                                    styles={{ body: { padding: '16px 20px' } }}
                                >
                                    <TaskTimeline tasks={timelineTasks} />
                                </Card>
                            </>
                        ),
                    },

                    // ── Analytics / Charts tab ────────────────────
                    {
                        key: 'analytics',
                        label: 'Analytics',
                        children: <AnalyticsTab />,
                    },

                    // ── Leaderboard tab ────────────────────────────
                    {
                        key: 'leaderboard',
                        label: (
                            <span>
                                <span role="img" aria-label="trophy" style={{ marginRight: 4 }}>🏆</span>
                                Leaderboard
                            </span>
                        ),
                        children: <LeaderboardTab />,
                    },
                ]}
            />
        </div>
    );
}
