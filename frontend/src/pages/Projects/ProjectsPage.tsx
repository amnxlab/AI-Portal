import { useEffect, useState, useCallback, useRef } from 'react';
import {
    Row, Col, Progress, Typography, Spin, Alert, Button,
    Form, Input, Select, DatePicker, InputNumber, Popconfirm,
    Space, Tooltip, message, Empty, Segmented, Modal,
} from 'antd';
import {
    PlusOutlined, FolderOutlined, DeleteOutlined, EditOutlined,
    CalendarOutlined, DollarOutlined, CheckCircleOutlined,
    ClockCircleOutlined, PauseCircleOutlined, StopOutlined,
    ThunderboltOutlined, ArrowRightOutlined, CameraOutlined, InboxOutlined, UndoOutlined,
    SearchOutlined, AppstoreOutlined, UnorderedListOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { usePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../../components/UserAvatar';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;

interface TasksSummary { total: number; done: number; inProgress: number; blocked: number; }
const EMPTY_SUMMARY: TasksSummary = { total: 0, done: 0, inProgress: 0, blocked: 0 };
interface Project {
    id: string; name: string; description: string; status: string;
    startDate: string; endDate: string; budget: number;
    coverImage?: string;
    owner?: { id?: string; fullName: string; avatarUrl?: string | null };
    tasksSummary?: TasksSummary;
    archivedAt?: string | null;
    createdAt?: string;
}

/** One line of what deleting a project would take with it. */
interface ImpactLine { label: string; count: number; blocking: boolean }

function useStatusConfig() {
    const { t } = useTheme();
    return {
        Active:    { color: t.success, bg: alpha(t.success, 0.10), icon: <ThunderboltOutlined />, label: 'Active'    },
        'On Hold': { color: t.warning, bg: alpha(t.warning, 0.10), icon: <PauseCircleOutlined />, label: 'On Hold'   },
        Planned:   { color: t.purple,  bg: alpha(t.purple, 0.10),  icon: <CalendarOutlined />,    label: 'Planned'   },
        Completed: { color: t.accent,  bg: alpha(t.accent, 0.10),  icon: <CheckCircleOutlined />, label: 'Completed' },
        Cancelled: { color: t.danger,  bg: alpha(t.danger, 0.10),  icon: <StopOutlined />,        label: 'Cancelled' },
    } as Record<string, { color: string; bg: string; icon: React.ReactNode; label: string }>;
}

// Sort order: Active first, then On Hold, then Planned (future), then Completed, then Cancelled
const STATUS_SORT: Record<string, number> = {
    Active: 1, 'On Hold': 2, Planned: 3, Completed: 4, Cancelled: 5,
};

const STATUS_OPTIONS = ['Active', 'On Hold', 'Planned', 'Completed', 'Cancelled'];

/**
 * How the list is ordered.
 *
 * The order was fixed — status, and nothing else — which answers only one of
 * the questions people actually bring to this page. "What is due first" and
 * "where is the money" needed scrolling and arithmetic.
 */
const SORT_OPTIONS = [
    { value: 'smart',    label: 'Status, then soonest due' },
    { value: 'deadline', label: 'Deadline (soonest first)' },
    { value: 'name',     label: 'Name (A \u2013 Z)' },
    { value: 'progress', label: 'Progress (least done first)' },
    { value: 'budget',   label: 'Budget (largest first)' },
    { value: 'newest',   label: 'Recently created' },
];

const progressOf = (p: Project) => {
    const s = p.tasksSummary ?? EMPTY_SUMMARY;
    return s.total > 0 ? s.done / s.total : 0;
};

// An undated project sorts last rather than first: no deadline is not an
// early one. `Infinity` keeps it out of the way without a special case at
// every comparison.
const dueOf = (p: Project) => (p.endDate ? dayjs(p.endDate).valueOf() : Infinity);

function comparatorFor(sort: string): (a: Project, b: Project) => number {
    switch (sort) {
        case 'deadline': return (a, b) => dueOf(a) - dueOf(b);
        case 'name':     return (a, b) => a.name.localeCompare(b.name);
        case 'progress': return (a, b) => progressOf(a) - progressOf(b);
        case 'budget':   return (a, b) => (Number(b.budget) || 0) - (Number(a.budget) || 0);
        case 'newest':   return (a, b) =>
            dayjs(b.createdAt ?? 0).valueOf() - dayjs(a.createdAt ?? 0).valueOf();
        default: return (a, b) => {
            const d = (STATUS_SORT[a.status] ?? 99) - (STATUS_SORT[b.status] ?? 99);
            return d !== 0 ? d : dueOf(a) - dueOf(b);
        };
    }
}

/** Matches the words somebody typed against a project's name, blurb and owner. */
function matchesQuery(p: Project, q: string): boolean {
    if (!q) return true;
    const hay = `${p.name} ${p.description ?? ''} ${p.owner?.fullName ?? ''} ${p.status}`.toLowerCase();
    // Every word has to appear somewhere, in any order: "cv robot" finds
    // "CV Robots" and "robot, CV pipeline" alike.
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

const VIEW_KEY = 'projects.view';
const SORT_KEY = 'projects.sort';

/**
 * The Archive sits beside the statuses rather than among them.
 *
 * Status says what became of the work — a project can be Cancelled or
 * Completed. Archiving says whether it is still on the desk. They are
 * independent: a cancelled project can be archived, and an archived one
 * keeps the status it had. Mixing them into one list of pills would force a
 * choice between the two that the data does not make.
 */
const ARCHIVE_FILTER = 'Archived';
const ALL_FILTERS    = ['All', ...STATUS_OPTIONS];

/* ─── hero metric ─────────────────────────────────────────────
 * The four counts used to be full-width cards on their own row. Together
 * with the hero and the filter row that put roughly 250px of chrome above
 * the first project, so a laptop screen opened on almost no projects. They
 * carry four numbers; they now sit inside the hero and read just as well.
 */
function HeroMetric({ icon, label, value, color, onClick, active }: {
    icon: React.ReactNode; label: string; value: number; color: string;
    onClick: () => void; active: boolean;
}) {
    const { t } = useTheme();
    const [hov, setHov] = useState(false);
    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setHov(true)}
            onMouseLeave={() => setHov(false)}
            title={`Show only ${label.toLowerCase()} projects`}
            style={{
                display: 'flex', alignItems: 'center', gap: 9,
                padding: '7px 13px 7px 9px', borderRadius: 9,
                border: `1px solid ${active || hov ? alpha(color, 0.32) : 'transparent'}`,
                background: active ? alpha(color, 0.10) : hov ? alpha(color, 0.06) : 'transparent',
                cursor: 'pointer', transition: 'all 0.15s', textAlign: 'left' as const,
            }}
        >
            <div style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: alpha(color, 0.12),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color,
            }}>
                {icon}
            </div>
            <div>
                <div style={{ color: t.text, fontWeight: 700, fontSize: 18, lineHeight: 1.1 }}>{value}</div>
                <div style={{ color: t.textMuted, fontSize: 11, marginTop: 1 }}>{label}</div>
            </div>
        </button>
    );
}

/* ─── filter pill ─────────────────────────────────────────── */
function FilterPill({ label, count, active, color, onClick }: {
    label: string; count: number; active: boolean; color?: string; onClick: () => void;
}) {
    const { t } = useTheme();
    const accent = color ?? t.accent;
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 14px', borderRadius: 20,
                border: active ? `1px solid ${alpha(accent, 0.32)}` : `1px solid ${t.border}`,
                background: active ? alpha(accent, 0.10) : t.surfaceRaised,
                color: active ? accent : t.textMuted,
                fontWeight: active ? 600 : 400, fontSize: 13,
                cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap' as const,
            }}
        >
            {label}
            <span style={{
                background: active ? alpha(accent, 0.18) : t.surface,
                color: active ? accent : t.textMuted,
                borderRadius: 10, padding: '0 6px', fontSize: 11, fontWeight: 600,
            }}>{count}</span>
        </button>
    );
}

/* ─── project card ────────────────────────────────────────── */
function ProjectCard({ p, canEdit, busy, onEdit, onDelete, onArchive, onRestore, onClick }: {
    p: Project; canEdit: boolean; busy?: boolean;
    onEdit: (e: React.MouseEvent) => void;
    onArchive: () => void;
    onRestore: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onClick: () => void;
}) {
    const { t } = useTheme();
    const STATUS = useStatusConfig();
    const [hovered, setHovered] = useState(false);
    const [coverHov, setCoverHov] = useState(false);
    const st      = STATUS[p.status] ?? STATUS.Active;
    const summary = p.tasksSummary ?? EMPTY_SUMMARY;
    const pct = summary.total > 0
        ? Math.round((summary.done / summary.total) * 100)
        : 0;
    const daysLeft = p.endDate ? dayjs(p.endDate).diff(dayjs(), 'day') : null;
    const overdue  = daysLeft !== null && daysLeft < 0 && p.status === 'Active';

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                background: t.surface,
                border: `1px solid ${hovered ? alpha(st.color, 0.32) : t.border}`,
                borderLeft: `3px solid ${st.color}`,
                borderRadius: 10,
                padding: p.coverImage ? '0 0 14px' : '18px 18px 14px',
                cursor: 'pointer',
                transition: 'border-color 0.2s, transform 0.18s, box-shadow 0.18s',
                transform: hovered ? 'translateY(-2px)' : 'none',
                boxShadow: hovered ? t.shadowLg : 'none',
                height: '100%',
                display: 'flex', flexDirection: 'column' as const,
            }}
        >
            {/* cover image */}
            {p.coverImage && (
                <div
                    onMouseEnter={() => setCoverHov(true)}
                    onMouseLeave={() => setCoverHov(false)}
                    style={{
                        height: 90,
                        backgroundImage: `url(${p.coverImage})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: '8px 8px 0 0',
                        marginBottom: 14,
                        position: 'relative',
                        flexShrink: 0,
                    }}
                >
                    <div style={{
                        position: 'absolute', inset: 0,
                        borderRadius: '8px 8px 0 0',
                        background: `linear-gradient(to bottom, ${alpha(t.bg, coverHov ? 0.35 : 0.15)}, ${alpha(t.bg, 0.5)})`,
                        transition: 'background 0.2s',
                    }} />
                </div>
            )}
            {/* top row */}
            <div style={{ padding: p.coverImage ? '0 18px' : undefined, flex: 1, display: 'flex', flexDirection: 'column' as const }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
                    <div style={{
                        width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                        background: alpha(st.color, 0.10),
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 15, color: st.color,
                    }}>
                        <FolderOutlined />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <Text strong style={{
                            color: t.text, fontSize: 14, display: 'block',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {p.name}
                        </Text>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' as const }}>
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: st.bg, color: st.color,
                                border: `1px solid ${alpha(st.color, 0.20)}`,
                                borderRadius: 20, padding: '1px 8px',
                                fontSize: 11, fontWeight: 500,
                            }}>
                                {st.icon}&nbsp;{p.status}
                            </span>
                            {overdue && (
                                <span style={{
                                    background: alpha(t.danger, 0.12), color: t.danger,
                                    border: `1px solid ${alpha(t.danger, 0.20)}`,
                                    borderRadius: 20, padding: '1px 8px', fontSize: 11, fontWeight: 500,
                                }}>
                                    Overdue
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                {/* Edit/delete always rendered so the card layout stays stable */}
                <Space size={2} onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0, marginLeft: 6, visibility: canEdit ? 'visible' : 'hidden' }}>
                    <Tooltip title="Edit">
                        <Button size="small" type="text"
                            icon={<EditOutlined style={{ color: t.textMuted, fontSize: 12 }} />}
                            onClick={onEdit}
                        />
                    </Tooltip>
                    {p.archivedAt ? (
                        <Tooltip title="Restore to the active projects">
                            <Button size="small" type="text"
                                icon={<UndoOutlined style={{ color: t.textMuted, fontSize: 12 }} />}
                                onClick={onRestore as any}
                            />
                        </Tooltip>
                    ) : (
                        <Popconfirm
                            title="Archive this project?"
                            description={
                                <span style={{ display: 'inline-block', maxWidth: 300 }}>
                                    It keeps everything &mdash; tasks, expenses, labor, members and
                                    history &mdash; and moves out of the active list into the
                                    Archive, where you can open it or restore it at any time.
                                </span>
                            }
                            onConfirm={onArchive as any}
                            okText="Archive"
                        >
                            <Button size="small" type="text"
                                icon={<InboxOutlined style={{ color: t.textMuted, fontSize: 12 }} />}
                            />
                        </Popconfirm>
                    )}
                    {/* No inline confirmation: what deletion costs is read from
                        the server first, because it is not knowable from here. */}
                    <Tooltip title="Delete">
                        <Button size="small" type="text" onClick={onDelete} loading={busy}
                            icon={<DeleteOutlined style={{ color: t.danger, fontSize: 12 }} />}
                        />
                    </Tooltip>
                </Space>
            </div>

            {/* description */}
            {p.description ? (
                <Text style={{
                    color: t.textMuted, fontSize: 12,
                    display: '-webkit-box',
                    WebkitLineClamp: '2', WebkitBoxOrient: 'vertical',
                    overflow: 'hidden', marginBottom: 12, lineHeight: 1.55,
                } as any}>
                    {p.description}
                </Text>
            ) : <div style={{ marginBottom: 4 }} />}

            {/* task mini-chips */}
            {summary.total > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' as const }}>
                    {summary.done > 0 && (
                        <span style={{ background: alpha(t.success, 0.10), color: t.success, borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
                            ✓ {summary.done} done
                        </span>
                    )}
                    {summary.inProgress > 0 && (
                        <span style={{ background: alpha(t.accent, 0.10), color: t.accent, borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
                            ⟳ {summary.inProgress} in progress
                        </span>
                    )}
                    {summary.blocked > 0 && (
                        <span style={{ background: alpha(t.danger, 0.10), color: t.danger, borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
                            ✗ {summary.blocked} blocked
                        </span>
                    )}
                </div>
            )}

            {/* progress */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                        {summary.total === 0 ? 'No tasks yet' : `${summary.done} / ${summary.total} tasks`}
                    </Text>
                    <Text style={{ color: pct === 100 ? t.success : st.color, fontSize: 11, fontWeight: 600 }}>
                        {pct}%
                    </Text>
                </div>
                <Progress
                    percent={pct} showInfo={false}
                    strokeColor={pct === 100 ? t.success : st.color}
                    trailColor={t.surfaceRaised}
                    size="small" style={{ margin: 0 }}
                />
            </div>

            {/* footer */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                paddingTop: 10, borderTop: `1px solid ${t.border}`, marginTop: 'auto',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const }}>
                    {p.startDate && (
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            <CalendarOutlined style={{ marginRight: 3 }} />
                            {dayjs(p.startDate).format('MMM YYYY')}
                            {p.endDate ? ` → ${dayjs(p.endDate).format('MMM YYYY')}` : ''}
                        </Text>
                    )}
                    {daysLeft !== null && p.status === 'Active' && (
                        <Text style={{ color: overdue ? t.danger : daysLeft < 7 ? t.warning : t.textMuted, fontSize: 11 }}>
                            <ClockCircleOutlined style={{ marginRight: 3 }} />
                            {overdue ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
                        </Text>
                    )}
                    {Number(p.budget) > 0 && (
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            <DollarOutlined style={{ marginRight: 3 }} />
                            {Number(p.budget).toLocaleString()}
                        </Text>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {p.owner && (
                        <Tooltip title={p.owner.fullName}>
                            <UserAvatar name={p.owner.fullName} avatarUrl={p.owner.avatarUrl} size={22} color={t.purple} bg={alpha(t.purple, 0.26)} style={{ border: `1px solid ${alpha(t.purple, 0.26)}` }} userId={p.owner.id} />
                        </Tooltip>
                    )}
                    <ArrowRightOutlined style={{
                        color: t.textMuted, fontSize: 12,
                        transform: hovered ? 'translateX(3px)' : 'none',
                        transition: 'transform 0.15s',
                    }} />
                </div>
            </div>
            </div>
        </div>
    );
}

/* ─── compact row ─────────────────────────────────────────────
 * Cards show a project; a list compares them. Fourteen projects at three
 * cards a row is five rows of scrolling to find a deadline, so the same
 * data is also offered one line per project.
 */
function ProjectRow({ p, canEdit, busy, onEdit, onDelete, onArchive, onRestore, onClick }: {
    p: Project; canEdit: boolean; busy?: boolean;
    onEdit: (e: React.MouseEvent) => void;
    onArchive: () => void;
    onRestore: () => void;
    onDelete: (e: React.MouseEvent) => void;
    onClick: () => void;
}) {
    const { t } = useTheme();
    const STATUS = useStatusConfig();
    const [hov, setHov] = useState(false);
    const st = STATUS[p.status] ?? STATUS.Active;
    const summary = p.tasksSummary ?? EMPTY_SUMMARY;
    const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
    const daysLeft = p.endDate ? dayjs(p.endDate).diff(dayjs(), 'day') : null;
    const overdue = daysLeft !== null && daysLeft < 0 && p.status === 'Active';

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHov(true)}
            onMouseLeave={() => setHov(false)}
            style={{
                display: 'flex', alignItems: 'center', gap: 14,
                background: hov ? t.surfaceRaised : t.surface,
                border: `1px solid ${hov ? alpha(st.color, 0.28) : t.border}`,
                borderLeft: `3px solid ${st.color}`,
                borderRadius: 9, padding: '11px 14px', cursor: 'pointer',
                transition: 'background 0.15s, border-color 0.15s',
            }}
        >
            <div style={{
                width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                background: alpha(st.color, 0.10),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, color: st.color,
            }}>
                <FolderOutlined />
            </div>

            {/* name + status */}
            <div style={{ flex: '2 1 200px', minWidth: 0 }}>
                <Text strong style={{
                    color: t.text, fontSize: 13.5, display: 'block',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{p.name}</Text>
                <span style={{ color: st.color, fontSize: 11 }}>{st.icon}&nbsp;{p.status}</span>
                {overdue && (
                    <span style={{ color: t.danger, fontSize: 11, marginLeft: 8 }}>
                        · {Math.abs(daysLeft!)}d overdue
                    </span>
                )}
            </div>

            {/* progress */}
            <div style={{ flex: '1 1 130px', minWidth: 90 }}>
                <Progress
                    percent={pct} showInfo={false}
                    strokeColor={pct === 100 ? t.success : st.color}
                    trailColor={t.surfaceRaised} size="small" style={{ margin: 0 }}
                />
                <Text style={{ color: t.textMuted, fontSize: 10.5 }}>
                    {summary.total === 0 ? 'No tasks' : `${summary.done}/${summary.total} tasks`}
                </Text>
            </div>

            {/* dates */}
            <div style={{ flex: '0 1 150px', minWidth: 0, textAlign: 'right' as const }}>
                <Text style={{ color: t.textMuted, fontSize: 11, whiteSpace: 'nowrap' as const }}>
                    {p.endDate
                        ? <>due {dayjs(p.endDate).format('D MMM YYYY')}</>
                        : p.startDate ? <>from {dayjs(p.startDate).format('MMM YYYY')}</> : '—'}
                </Text>
            </div>

            {/* budget */}
            <div style={{ flex: '0 0 90px', textAlign: 'right' as const }}>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                    {Number(p.budget) > 0 ? `$${Number(p.budget).toLocaleString()}` : '—'}
                </Text>
            </div>

            {p.owner && (
                <Tooltip title={p.owner.fullName}>
                    <UserAvatar name={p.owner.fullName} avatarUrl={p.owner.avatarUrl} size={22}
                        color={t.purple} bg={alpha(t.purple, 0.26)}
                        style={{ border: `1px solid ${alpha(t.purple, 0.26)}`, flexShrink: 0 }}
                        userId={p.owner.id} />
                </Tooltip>
            )}

            <Space size={2} onClick={(e) => e.stopPropagation()}
                style={{ flexShrink: 0, visibility: canEdit ? 'visible' : 'hidden' }}>
                <Tooltip title="Edit">
                    <Button size="small" type="text" onClick={onEdit}
                        icon={<EditOutlined style={{ color: t.textMuted, fontSize: 12 }} />} />
                </Tooltip>
                {p.archivedAt ? (
                    <Tooltip title="Restore">
                        <Button size="small" type="text" onClick={onRestore as any}
                            icon={<UndoOutlined style={{ color: t.textMuted, fontSize: 12 }} />} />
                    </Tooltip>
                ) : (
                    <Popconfirm
                        title="Archive this project?"
                        description={
                            <span style={{ display: 'inline-block', maxWidth: 300 }}>
                                It keeps everything and moves out of the active list into the
                                Archive, where you can restore it at any time.
                            </span>
                        }
                        onConfirm={onArchive as any} okText="Archive"
                    >
                        <Button size="small" type="text"
                            icon={<InboxOutlined style={{ color: t.textMuted, fontSize: 12 }} />} />
                    </Popconfirm>
                )}
                <Tooltip title="Delete">
                    <Button size="small" type="text" onClick={onDelete} loading={busy}
                        icon={<DeleteOutlined style={{ color: t.danger, fontSize: 12 }} />} />
                </Tooltip>
            </Space>
        </div>
    );
}

/* ══════════════════════════════ page ════════════════════════ */
export default function ProjectsPage() {
    const { t } = useTheme();
    const STATUS = useStatusConfig();
    const { hasPermission } = usePermissions();
    const canEdit  = hasPermission('manage_projects');
    const navigate = useNavigate();

    const [projects, setProjects] = useState<Project[]>([]);
    const [archived, setArchived] = useState<Project[]>([]);
    const [loading,  setLoading]  = useState(false);
    const [error,    setError]    = useState<string | null>(null);
    // Active is the default: a project list is a list of work in progress.
    // Completed, cancelled and archived projects are reachable from their own
    // filters — they are not hidden, just not what you open the page to see.
    const [filter,   setFilter]   = useState<string>('Active');
    const [query,    setQuery]    = useState('');
    // The ordering and the card/list choice are a working preference, not a
    // property of the data, so they are remembered per browser.
    const [sort, setSort] = useState<string>(() => localStorage.getItem(SORT_KEY) ?? 'smart');
    const [view, setView] = useState<'cards' | 'list'>(
        () => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'),
    );
    const [deleting, setDeleting] = useState<string | null>(null);
    const [modalOpen,   setModalOpen]   = useState(false);
    const [editProject, setEditProject] = useState<Project | null>(null);
    const [saving,      setSaving]      = useState(false);
    const [form] = Form.useForm();
    const [coverUrl, setCoverUrl]   = useState('');
    const coverFileRef = useRef<HTMLInputElement>(null);

    // Active and archived are fetched separately: the active list is what
    // the page is for, and the archive is only read when asked for.
    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const [active, archived] = await Promise.all([
                api.get('/projects'),
                api.get('/projects/archived').catch(() => ({ data: [] })),
            ]);
            setProjects(active.data);
            setArchived(archived.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load projects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { try { localStorage.setItem(SORT_KEY, sort); } catch { /* private mode */ } }, [sort]);
    useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ } }, [view]);

    const handleArchive = async (id: string) => {
        try {
            await api.post(`/projects/${id}/archive`);
            message.success('Project archived — everything it holds is kept');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not archive the project');
        }
    };

    const handleRestore = async (id: string) => {
        try {
            await api.post(`/projects/${id}/restore`);
            message.success('Project restored to the active list');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not restore the project');
        }
    };

    const showingArchive = filter === ARCHIVE_FILTER;
    const source = showingArchive ? archived : projects;
    const filtered = (filter === 'All' || showingArchive ? source : source.filter((p) => p.status === filter))
        .filter((p) => matchesQuery(p, query))
        .slice()
        .sort(comparatorFor(sort));

    const counts: Record<string, number> = { All: projects.length, [ARCHIVE_FILTER]: archived.length };
    for (const s of STATUS_OPTIONS) counts[s] = projects.filter((p) => p.status === s).length;

    // Worth knowing before anything else on the page: active work whose
    // deadline has already gone past.
    const overdueCount = projects.filter(
        (p) => p.status === 'Active' && p.endDate && dayjs(p.endDate).isBefore(dayjs(), 'day'),
    ).length;

    const totalTasks = projects.reduce((a, p) => a + (p.tasksSummary?.total ?? 0), 0);
    const doneTasks  = projects.reduce((a, p) => a + (p.tasksSummary?.done  ?? 0), 0);
    const overallPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    const openCreate = () => {
        setEditProject(null); form.resetFields();
        form.setFieldsValue({ status: 'Active' });
        setCoverUrl('');
        setModalOpen(true);
    };

    const openEdit = (e: React.MouseEvent, p: Project) => {
        e.stopPropagation(); setEditProject(p);
        form.setFieldsValue({
            ...p,
            startDate: p.startDate ? dayjs(p.startDate) : undefined,
            endDate:   p.endDate   ? dayjs(p.endDate)   : undefined,
        });
        setCoverUrl(p.coverImage ?? '');
        setModalOpen(true);
    };

    const handleSave = async () => {
        const values = await form.validateFields();
        if (values.startDate) values.startDate = values.startDate.format('YYYY-MM-DD');
        if (values.endDate)   values.endDate   = values.endDate.format('YYYY-MM-DD');
        values.coverImage = coverUrl || null;
        // An untouched budget field must stay unset rather than becoming $0:
        // "no budget" and "a budget of zero" are different answers, and the
        // column no longer defaults one into the other.
        if (values.budget === undefined || values.budget === null || values.budget === '') {
            delete values.budget;
        }
        setSaving(true);
        try {
            if (editProject) {
                await api.patch(`/projects/${editProject.id}`, values);
                message.success('Project updated');
            } else {
                await api.post('/projects', values);
                message.success('Project created');
            }
            setModalOpen(false); load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Save failed');
        } finally { setSaving(false); }
    };

    const doDelete = async (p: Project) => {
        try {
            await api.delete(`/projects/${p.id}`);
            message.success(`"${p.name}" deleted`); load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    /**
     * Asks the server what deletion would destroy, then says so.
     *
     * The old dialog warned about tasks. Deleting a project also takes its
     * expenses, budget allocations, files, papers, sub-projects, playlists
     * and wishlist items — and nothing said so, which made "Delete" a far
     * bigger action than it read as. The server now refuses while any of
     * that is attached; this asks first so the refusal is not a surprise,
     * and offers Archive, which is what was nearly always meant.
     */
    const requestDelete = async (p: Project) => {
        setDeleting(p.id);
        let impact: ImpactLine[] = [];
        let canDelete = true;
        try {
            const res = await api.get(`/projects/${p.id}/deletion-impact`);
            impact = res.data.impact ?? [];
            canDelete = res.data.canDelete !== false;
        } catch {
            // Without the impact we cannot describe the cost, so we do not
            // offer a one-click delete on a guess.
            Modal.warning({
                title: 'Could not check what this would delete',
                content: 'The project was left alone. Try again, or archive it instead.',
            });
            setDeleting(null);
            return;
        }
        setDeleting(null);

        // "1 tasks" reads like a bug; every label here pluralises by a plain 's'.
        const countLabel = (x: ImpactLine) =>
            x.label.startsWith('$')
                ? x.label
                : `${x.count} ${x.count === 1 ? x.label.replace(/s$/, '') : x.label}`;

        const lines = impact.map((x) => (
            <li key={x.label} style={{ marginBottom: 2 }}>{countLabel(x)}</li>
        ));

        if (!canDelete) {
            Modal.confirm({
                title: `"${p.name}" cannot be deleted`,
                icon: <WarningOutlined style={{ color: t.warning }} />,
                width: 560,
                okText: 'Archive it instead',
                cancelText: 'Leave it alone',
                onOk: () => handleArchive(p.id),
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                            It still holds work that deleting would destroy:
                        </Text>
                        <ul style={{ margin: '0 0 12px 18px', fontSize: 13 }}>{lines}</ul>
                        <Text style={{ fontSize: 12.5, opacity: 0.85 }}>
                            Archiving keeps every one of those and takes the project off the
                            active list &mdash; which is usually what is wanted. To delete it
                            outright, empty it first.
                        </Text>
                    </div>
                ),
            });
            return;
        }

        Modal.confirm({
            title: `Delete "${p.name}"?`,
            icon: <DeleteOutlined style={{ color: t.danger }} />,
            width: 520,
            okText: 'Delete permanently',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            onOk: () => doDelete(p),
            content: (
                <div style={{ marginTop: 10 }}>
                    {impact.length === 0 ? (
                        <Text style={{ fontSize: 13 }}>
                            This project is empty &mdash; nothing is attached to it. Deleting it
                            cannot be undone.
                        </Text>
                    ) : (
                        <>
                            <Text style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
                                This will also remove:
                            </Text>
                            <ul style={{ margin: '0 0 10px 18px', fontSize: 13 }}>{lines}</ul>
                            <Text style={{ fontSize: 12.5, opacity: 0.85 }}>
                                It cannot be undone. Archive it instead to keep all of it.
                            </Text>
                        </>
                    )}
                </div>
            ),
        });
    };

    if (loading) return (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}>
            <Spin size="large" />
        </div>
    );

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 4px 40px' }}>

            {/* ── Hero ────────────────────────────────────────── */}
            <div style={{
                background: `linear-gradient(135deg, ${t.surface} 0%, ${t.surfaceRaised} 60%, ${t.surface} 100%)`,
                border: `1px solid ${t.border}`, borderRadius: 12,
                padding: '28px 32px', marginBottom: 24,
                position: 'relative', overflow: 'hidden',
            }}>
                <div style={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: alpha(t.success, 0.05), pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: -30, right: 180, width: 130, height: 130, borderRadius: '50%', background: alpha(t.purple, 0.04), pointerEvents: 'none' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10,
                                background: alpha(t.success, 0.10),
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 20, color: t.success,
                            }}>
                                <FolderOutlined />
                            </div>
                            <Title level={3} style={{ margin: 0, color: t.text, fontWeight: 800 }}>Projects</Title>
                        </div>
                        <Text style={{ color: t.textMuted, fontSize: 13 }}>
                            {projects.length} project{projects.length !== 1 ? 's' : ''}
                            &nbsp;·&nbsp;{overallPct}% overall completion
                            {overdueCount > 0 && (
                                <>
                                    &nbsp;·&nbsp;
                                    <span style={{ color: t.danger }}>
                                        {overdueCount} past its deadline
                                    </span>
                                </>
                            )}
                        </Text>
                    </div>
                    {canEdit && (
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ flexShrink: 0 }}>
                            New Project
                        </Button>
                    )}
                </div>

                {/* The counts, inline — and each one is a filter. */}
                <div style={{
                    display: 'flex', gap: 4, flexWrap: 'wrap' as const,
                    marginTop: 18, paddingTop: 14, borderTop: `1px solid ${t.border}`,
                }}>
                    <HeroMetric icon={<ThunderboltOutlined />} label="Active"    value={counts['Active']    ?? 0} color={t.success} active={filter === 'Active'}    onClick={() => setFilter('Active')} />
                    <HeroMetric icon={<PauseCircleOutlined />} label="On Hold"   value={counts['On Hold']   ?? 0} color={t.warning} active={filter === 'On Hold'}   onClick={() => setFilter('On Hold')} />
                    <HeroMetric icon={<CalendarOutlined />}    label="Planned"   value={counts['Planned']   ?? 0} color={t.purple}  active={filter === 'Planned'}   onClick={() => setFilter('Planned')} />
                    <HeroMetric icon={<CheckCircleOutlined />} label="Completed" value={counts['Completed'] ?? 0} color={t.accent}  active={filter === 'Completed'} onClick={() => setFilter('Completed')} />
                    <HeroMetric icon={<InboxOutlined />}       label="Archived"  value={counts[ARCHIVE_FILTER] ?? 0} color={t.textMuted} active={showingArchive} onClick={() => setFilter(ARCHIVE_FILTER)} />
                </div>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {/* ── Search, ordering and view ────────────────────── */}
            <div style={{
                display: 'flex', gap: 10, marginBottom: 14,
                flexWrap: 'wrap' as const, alignItems: 'center',
            }}>
                <Input
                    allowClear
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name, description or owner"
                    prefix={<SearchOutlined style={{ color: t.textMuted }} />}
                    style={{ flex: '1 1 260px', maxWidth: 380 }}
                />
                <Select
                    value={sort}
                    onChange={setSort}
                    options={SORT_OPTIONS}
                    style={{ width: 215, flexShrink: 0 }}
                />
                <Segmented
                    value={view}
                    onChange={(v) => setView(v as 'cards' | 'list')}
                    options={[
                        { value: 'cards', icon: <AppstoreOutlined />, title: 'Cards' },
                        { value: 'list',  icon: <UnorderedListOutlined />, title: 'Compact list' },
                    ]}
                />
            </div>

            {/* ── Filter pills ─────────────────────────────────── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
                {ALL_FILTERS.map((f) => (
                    <FilterPill
                        key={f} label={f} count={counts[f] ?? 0}
                        active={filter === f}
                        color={f === 'All' ? t.accent : STATUS[f]?.color}
                        onClick={() => setFilter(f)}
                    />
                ))}
                <div style={{
                    width: 1, height: 22, background: t.border, margin: '0 2px',
                }} />
                <FilterPill
                    label={ARCHIVE_FILTER} count={counts[ARCHIVE_FILTER] ?? 0}
                    active={showingArchive}
                    color={t.textMuted}
                    onClick={() => setFilter(ARCHIVE_FILTER)}
                />
                <div style={{ flex: 1 }} />
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    {query
                        ? `${filtered.length} of ${source.length} match "${query}"`
                        : `${filtered.length} shown`}
                </Text>
            </div>

            {showingArchive && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 20 }}
                    message="Archived projects"
                    description={
                        <span style={{ fontSize: 12 }}>
                            These are out of the way, not gone. Each one keeps every task,
                            expense, labor entry, member and comment it had. Open one to read it
                            in full, or restore it to put it back on the active list.
                        </span>
                    }
                />
            )}

            {/* ── Grid ─────────────────────────── */}
            {filtered.length === 0 ? (
                <div style={{
                    background: t.surface, border: `1px solid ${t.border}`,
                    borderRadius: 12, padding: '60px 24px', textAlign: 'center',
                }}>
                    <FolderOutlined style={{ fontSize: 40, color: t.textMuted, marginBottom: 12 }} />
                    <Empty
                        description={
                            <Text style={{ color: t.textMuted }}>
                                {query
                                    ? `Nothing matches "${query}"${filter !== 'All' && !showingArchive ? ` among ${filter.toLowerCase()} projects` : ''}.`
                                    : showingArchive
                                        ? 'Nothing archived yet. Archiving a project keeps all of its history and takes it off the active list.'
                                        : 'No projects in this category'}
                            </Text>
                        }
                        image={null}
                    />
                    {query && (
                        <Button onClick={() => { setQuery(''); setFilter('All'); }} style={{ marginTop: 16 }}>
                            Clear the search and show all
                        </Button>
                    )}
                    {canEdit && !showingArchive && !query && (
                        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginTop: 16 }}>
                            Create first project
                        </Button>
                    )}
                </div>
            ) : view === 'list' ? (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 7 }}>
                    {filtered.map((p) => (
                        <ProjectRow
                            key={p.id} p={p} canEdit={canEdit} busy={deleting === p.id}
                            onEdit={(e) => openEdit(e, p)}
                            onDelete={(e) => { e.stopPropagation(); requestDelete(p); }}
                            onArchive={() => handleArchive(p.id)}
                            onRestore={() => handleRestore(p.id)}
                            onClick={() => navigate(`/projects/${p.id}`)}
                        />
                    ))}
                </div>
            ) : (
                <Row gutter={[16, 16]}>
                    {filtered.map((p) => (
                        <Col xs={24} sm={12} lg={8} key={p.id} style={{ display: 'flex' }}>
                            <div style={{ width: '100%' }}>
                                <ProjectCard
                                    p={p} canEdit={canEdit} busy={deleting === p.id}
                                    onEdit={(e) => openEdit(e, p)}
                                    onDelete={(e) => { e.stopPropagation(); requestDelete(p); }}
                                    onArchive={() => handleArchive(p.id)}
                                    onRestore={() => handleRestore(p.id)}
                                    onClick={() => navigate(`/projects/${p.id}`)}
                                />
                            </div>
                        </Col>
                    ))}
                </Row>
            )}

            {/* ── Modal ───────────────────────────────────────── */}
            <FormModal
                open={modalOpen}
                title={editProject ? 'Edit Project' : 'New Project'}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText={editProject ? 'Save Changes' : 'Create Project'}
                width={520}
            >
                <Form form={form} layout="vertical">
                    {/* cover image upload */}
                    <div
                        onClick={() => coverFileRef.current?.click()}
                        style={{
                            width: '100%', height: 110, marginBottom: 16,
                            borderRadius: 8,
                            border: coverUrl ? 'none' : `2px dashed ${t.border}`,
                            cursor: 'pointer', overflow: 'hidden', position: 'relative',
                            background: coverUrl ? 'transparent' : t.surfaceRaised,
                            backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
                            backgroundSize: 'cover', backgroundPosition: 'center',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        {!coverUrl ? (
                            <div style={{ textAlign: 'center', pointerEvents: 'none' }}>
                                <CameraOutlined style={{ fontSize: 24, color: t.textMuted, display: 'block', marginBottom: 4 }} />
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>Click to add cover image</Text>
                            </div>
                        ) : (
                            <div style={{
                                position: 'absolute', bottom: 0, left: 0, right: 0,
                                background: t.overlay, padding: '4px 0',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            }}>
                                <CameraOutlined style={{ color: t.textOnAccent, fontSize: 13 }} />
                                <Text style={{ color: t.textOnAccent, fontSize: 12 }}>Change cover</Text>
                            </div>
                        )}
                    </div>
                    <input
                        ref={coverFileRef} type="file" accept="image/*"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            
                            // Check file size (50 MB limit)
                            const maxSize = 50 * 1024 * 1024; // 50 MB
                            if (file.size > maxSize) {
                                message.error(`Image is too large (${(file.size / (1024 * 1024)).toFixed(2)} MB). Maximum size is 50 MB.`);
                                e.target.value = '';
                                return;
                            }
                            
                            const fd = new FormData();
                            fd.append('file', file);
                            try {
                                const res = await api.post('/uploads', fd);
                                setCoverUrl(res.data.url);
                                message.success('Cover image uploaded');
                            } catch (err: any) { 
                                console.error('Upload error:', err);
                                const errorMsg = err?.response?.data?.message ?? 'Image upload failed';
                                message.error(errorMsg);
                            }
                            e.target.value = '';
                        }}
                    />
                    <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input placeholder="Project name" />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} placeholder="Optional description" />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="status" label="Status">
                                <Select options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="budget" label="Budget ($)">
                                <InputNumber
                                    style={{ width: '100%' }}
                                    min={0}
                                    step={100}
                                    placeholder="No budget set"
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="startDate" label="Start Date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="endDate" label="End Date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </FormModal>
        </div>
    );
}
