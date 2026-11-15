import { useEffect, useState, useCallback } from 'react';
import {
    Button, Select, Tag, Space, Typography, Alert, Spin, Card, Row, Col,
    DatePicker, message, Tooltip, Progress, Divider, Table, Modal, Input,
    InputNumber, Badge, Empty, Popconfirm, Switch,
} from 'antd';
import {
    PlusOutlined, FilePdfOutlined, BellOutlined,
    CheckCircleOutlined, ClockCircleOutlined, WarningOutlined,
    LaptopOutlined, HomeOutlined, UserOutlined, FileTextOutlined, RedoOutlined,
    CheckOutlined, StopOutlined, MessageOutlined, DeleteOutlined,
    EyeOutlined, EditOutlined, ExclamationCircleOutlined,
    LeftOutlined, RightOutlined, LockOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import utc from 'dayjs/plugin/utc';
import dayjsPickerLocale from 'antd/es/date-picker/locale/en_GB';
import api from '../../api/axios';
import { getMyBalance, type WeekBalance } from '../../api/attendance';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { alpha } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';
import UserAvatar from '../../components/UserAvatar';
import { useDeepLinkId, useDeepLinkParam } from '../../hooks/useDeepLink';

dayjs.extend(isoWeek);
dayjs.extend(utc);

const { Title, Text } = Typography;
const { TextArea } = Input;


const DEFAULT_MAX_HOURS = 20;
const DEFAULT_MAX_REMOTE = 4;

/**
 * What attendance actually allows this employee to report for a week.
 *
 * The bars beside this are derived in the browser from the user's weekly cap.
 * This block is different: it is the server's own figure, computed from the
 * clock-in and clock-out records, and it is the number the backend enforces
 * when the report is submitted. It is shown here so the limit is visible
 * while the report is being filled in rather than arriving as a rejection.
 *
 * The display is advisory only — nothing here gates the submit button, and
 * editing it would change nothing, because the check happens server-side
 * inside the transaction that writes the report.
 */
function ReportableBalance({
    weekStart, enteredHours, t,
}: { weekStart: string; enteredHours: number; t: SemanticTokens }) {
    const [balance, setBalance] = useState<WeekBalance | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let live = true;
        setLoading(true);
        getMyBalance(weekStart)
            .then((b) => { if (live) setBalance(b); })
            .catch(() => { if (live) setBalance(null); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [weekStart]);

    if (loading) {
        return (
            <div style={{ marginTop: 8 }}>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>Checking verified attendance…</Text>
            </div>
        );
    }
    if (!balance) return null;

    // Before the enforcement week there is no attendance-derived ceiling, so
    // showing a "remaining" figure would imply a limit that is not applied.
    if (!balance.enforcement) {
        return (
            <div style={{ marginTop: 8 }}>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                    Verified attendance this week: {balance.verifiedHours.toFixed(2)}h
                    {' · '}not yet enforced for this week
                </Text>
            </div>
        );
    }

    const ceiling = balance.maxReportableHours ?? balance.verifiedHours;
    const over = enteredHours > ceiling + 0.01;

    return (
        <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 6,
            background: alpha(over ? t.danger : t.accent, 0.08),
            border: `1px solid ${alpha(over ? t.danger : t.accent, 0.3)}`,
        }}>
            <Text style={{ color: over ? t.danger : t.accent, fontSize: 11, fontWeight: 600, display: 'block' }}>
                {over
                    ? `Over the limit — attendance verifies ${ceiling.toFixed(2)}h this week`
                    : `Reportable from attendance: ${ceiling.toFixed(2)}h`}
            </Text>
            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                Verified {balance.verifiedHours.toFixed(2)}h
                {' · '}already counted {balance.reportedHours.toFixed(2)}h
                {balance.remainingReportableHours != null
                    && ` · remaining ${balance.remainingReportableHours.toFixed(2)}h`}
            </Text>
            {over && (
                <Text style={{ color: t.danger, fontSize: 11, display: 'block', marginTop: 2 }}>
                    Submitting more than this will be refused.
                </Text>
            )}
        </div>
    );
}

/** Compute per-user limits from their weeklyHoursCap (null = no cap → use default) */
function getUserLimits(cap: number | null | undefined): { maxH: number; maxR: number; hasCap: boolean } {
    if (cap !== null && cap !== undefined) {
        return { maxH: cap, maxR: Math.round(cap * 0.2 * 10) / 10, hasCap: true };
    }
    return { maxH: DEFAULT_MAX_HOURS, maxR: DEFAULT_MAX_REMOTE, hasCap: true };
}

/**
 * Resolve the effective cap for a specific report record.
 * For finalized (Approved) reports we use the snapshot frozen at submission
 * time so later policy changes do not retroactively flag old records as
 * violations.  For all other statuses we fall back to the live user cap.
 */
function resolveReportCap(report: Report, liveCapHours: number | null | undefined): number | null | undefined {
    if (report.status === 'Approved' && report.weeklyHoursCapSnapshot !== null && report.weeklyHoursCapSnapshot !== undefined) {
        return report.weeklyHoursCapSnapshot;
    }
    // Also use the snapshot for submitted/revision if available (keeps the
    // submitted-week limits consistent as long as we have a snapshot).
    if (report.weeklyHoursCapSnapshot !== null && report.weeklyHoursCapSnapshot !== undefined) {
        return report.weeklyHoursCapSnapshot;
    }
    return liveCapHours ?? report.user?.weeklyHoursCap;
}

const TASK_STATUSES = ['To Do', 'In Progress', 'Done', 'Needs Revision'] as const;

function getStatusColor(t: SemanticTokens): Record<string, string> {
    return { 'To Do': t.textMuted, 'Todo': t.textMuted, 'In Progress': t.accent, Done: t.success, 'Needs Revision': t.orange };
}
function getStatusIcon(t: SemanticTokens): Record<string, React.ReactNode> {
    return {
        'To Do': <ClockCircleOutlined />,
        'Todo': <ClockCircleOutlined />,
        'In Progress': <ClockCircleOutlined style={{ color: t.accent }} />,
        Done: <CheckCircleOutlined style={{ color: t.success }} />,
        'Needs Revision': <RedoOutlined style={{ color: t.orange }} />,
    };
}

// Return the ISO‑Monday of the week in UTC (midnight UTC)
function mondayOfWeek(d: dayjs.Dayjs) {
    return d.utc().isoWeekday(1).format('YYYY-MM-DD');
}

// Compute the Monday of the current week purely in LOCAL time, then format as
// YYYY-MM-DD.  Avoids the dayjs utc+isoWeek plugin interaction bug where
// calling .isoWeekday(1) in UTC mode can land on the wrong day (e.g. returning
// today=Tuesday instead of the previous Monday).
function defaultReportWeek(): string {
    const local = dayjs();
    // isoWeekday: 1=Mon … 7=Sun.  Subtract (dow-1) days to reach Monday.
    const dow = local.isoWeekday(); // 1–7
    return local.subtract(dow - 1, 'day').format('YYYY-MM-DD');
}

interface AssignedTask { id: string; title: string; status: string; completedAt?: string | null; }

interface TaskEntry {
    taskId?: string;
    taskTitle: string;
    status: string;
    progressNotes: string;
    remainingNotes?: string;
    hours: number;
    isRemote: boolean;
}

interface Report {
    id: string;
    userId: string;
    weekStart: string;
    tasksHours: TaskEntry[];
    totalHours: number;
    remoteHours: number;
    notes: string;
    status: string;
    submittedAt: string;
    reviewNote: string | null;
    reviewedBy: string | null;
    reviewedAt: string | null;
    managerComment?: string | null;
    /** Cap snapshot captured at submission time — used to display approved
     *  reports with the limits that were in force when they were filed so that
     *  later policy changes do not retroactively flag them as violations. */
    weeklyHoursCapSnapshot?: number | null;
    user?: { id?: string; fullName: string; avatarUrl?: string | null; role?: string; weeklyHoursCap?: number | null };
}

function getReportStatusConfig(t: SemanticTokens): Record<string, { color: string; label: string; icon: React.ReactNode }> {
    return {
        Draft: { color: t.textMuted, label: 'Draft', icon: <ClockCircleOutlined /> },
        Submitted: { color: t.accent, label: 'Under Review', icon: <ClockCircleOutlined style={{ color: t.accent }} /> },
        Approved: { color: t.success, label: 'Approved', icon: <CheckCircleOutlined style={{ color: t.success }} /> },
        'Needs Revision': { color: t.orange, label: 'Needs Revision', icon: <RedoOutlined style={{ color: t.orange }} /> },
    };
}

const emptyEntry = (): TaskEntry => ({
    taskTitle: '', status: 'In Progress', progressNotes: '', remainingNotes: '', hours: 0, isRemote: false,
});

function HourBar({ used, max, label, color }: { used: number; max: number; label: string; color: string }) {
    const { t } = useTheme();
    const pct = Math.min((used / max) * 100, 100);
    const over = used > max;
    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{label}</Text>
                <Text style={{ color: over ? t.danger : t.text, fontSize: 12, fontWeight: 600 }}>
                    {used}h / {max}h
                </Text>
            </div>
            <Progress
                percent={pct}
                showInfo={false}
                strokeColor={over ? t.danger : color}
                trailColor={t.surfaceRaised}
                size={['100%', 6] as any}
            />
            {over && (
                <Text style={{ color: t.danger, fontSize: 11 }}>
                    Exceeds limit by {(used - max).toFixed(1)}h
                </Text>
            )}
        </div>
    );
}

/**
 * Decide whether a task should appear in the task-picker for a specific report week.
 *
 * Active-period overlap rule — a task shows up in week [weekStart, weekEnd) if
 * its "active period" [activeStart, activeEnd) overlaps with the report week:
 *
 *   activeStart < weekEnd   AND   activeEnd >= weekStart
 *
 * Where:
 *   • activeStart = startDate (preferred) or createdAt
 *   • activeEnd   = completedAt if Done (updatedAt fallback)
 *                   OR deadline if set and task is not yet Done
 *                   OR "now" if neither exists (task is still open with no deadline,
 *                     only relevant up to the current week)
 *
 * This prevents:
 *   • Done tasks from leaking into weeks after completion
 *   • Open tasks from piling up in every historical week
 *   • Status changes from making tasks vanish from past weeks
 */
function filterTasksForWeek(
    rawTasks: any[],
    userId: string | undefined,
    weekStart: dayjs.Dayjs,
    weekEnd: dayjs.Dayjs,
): AssignedTask[] {
    const now = dayjs.utc();

    return rawTasks
        .filter((t: any) => t.assigneeId === userId || t.assignee?.id === userId)
        .filter((t: any) => {
            // ── activeStart: when the task's life began ──
            const activeStart = t.startDate
                ? dayjs.utc(t.startDate)
                : t.createdAt ? dayjs.utc(t.createdAt) : null;

            // Task must have started before the week ends
            if (activeStart && !activeStart.isBefore(weekEnd)) return false;

            // ── activeEnd: when the task's active period ended ──
            let activeEnd: dayjs.Dayjs;
            if (t.status === 'Done') {
                // Use completedAt; fall back to updatedAt for legacy data
                activeEnd = t.completedAt
                    ? dayjs.utc(t.completedAt)
                    : t.updatedAt ? dayjs.utc(t.updatedAt) : now;
            } else if (t.deadline) {
                // Non-done task with a deadline: relevant up to the deadline
                // but at minimum until "now" if the deadline has passed and
                // the task is still open (employee is still working on it)
                const dl = dayjs.utc(t.deadline);
                activeEnd = dl.isAfter(now) ? dl : now;
            } else {
                // No deadline, not done → still active, cap at today
                activeEnd = now;
            }

            // Task's active period must not have ended before the week started
            if (activeEnd.isBefore(weekStart)) return false;

            return true;
        })
        .map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            completedAt: t.completedAt ?? null,
        }));
}

function TaskEntryRow({
    entry, index, assignedTasks, onChange, onRemove, canRemove, maxHours, remoteWorkRestricted,
}: {
    entry: TaskEntry;
    index: number;
    assignedTasks: AssignedTask[];
    onChange: (i: number, field: keyof TaskEntry, val: any) => void;
    onRemove: (i: number) => void;
    canRemove: boolean;
    /** Per-user weekly cap — used as the upper bound for hours on each task entry */
    maxHours: number;
    /** When true, the remote toggle is disabled and entries are forced on-site */
    remoteWorkRestricted?: boolean;
}) {
    const { t } = useTheme();
    const isDone = entry.status === 'Done';

    return (
        <div style={{
            background: t.surfaceRaised, border: `1px solid ${t.border}`,
            borderRadius: 8, padding: 14, marginBottom: 12,
        }}>
            <Row gutter={[10, 10]} align="top">
                <Col span={1}>
                    <div style={{
                        width: 24, height: 24, borderRadius: '50%', marginTop: 4,
                        background: t.surface, border: `1px solid ${t.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: t.textMuted, fontSize: 11, fontWeight: 700,
                    }}>{index + 1}</div>
                </Col>
                <Col span={11}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Task</Text>
                    <Select
                        showSearch
                        allowClear
                        placeholder="Select assigned task or type name…"
                        style={{ width: '100%', marginTop: 3 }}
                        value={entry.taskId || (entry.taskTitle ? entry.taskTitle : undefined)}
                        onChange={(val) => {
                            const match = assignedTasks.find(t => t.id === val);
                            if (match) {
                                onChange(index, 'taskId', match.id);
                                onChange(index, 'taskTitle', match.title);
                                const s = match.status;
                                onChange(index, 'status', s === 'Done' ? 'Done' : s === 'Needs Revision' ? 'Needs Revision' : 'In Progress');
                            } else {
                                onChange(index, 'taskId', undefined);
                                onChange(index, 'taskTitle', val ?? '');
                            }
                        }}
                        onSearch={val => {
                            if (!assignedTasks.find(t => t.id === entry.taskId)) {
                                onChange(index, 'taskTitle', val);
                            }
                        }}
                        options={assignedTasks.map(t => ({ label: t.title, value: t.id }))}
                        filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
                    />
                </Col>
                <Col span={5}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Status</Text>
                    <Select
                        value={entry.status}
                        onChange={v => {
                            onChange(index, 'status', v);
                            if (v === 'Done') onChange(index, 'remainingNotes', '');
                        }}
                        style={{ width: '100%', marginTop: 3 }}
                        options={TASK_STATUSES.map(s => ({
                            label: <span style={{ color: getStatusColor(t)[s] }}>{s}</span>,
                            value: s,
                        }))}
                    />
                </Col>
                <Col span={4}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Hours</Text>
                    <InputNumber
                        min={0} max={maxHours} step={0.5}
                        value={entry.hours}
                        onChange={v => onChange(index, 'hours', v ?? 0)}
                        addonAfter="h"
                        style={{ width: '100%', marginTop: 3 }}
                    />
                </Col>
                <Col span={2} style={{ textAlign: 'center', paddingTop: 14 }}>
                    <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Remote</Text>
                    <Tooltip title={remoteWorkRestricted ? 'Remote work is restricted for your account' : undefined}>
                        <Switch
                            size="small"
                            checked={remoteWorkRestricted ? false : entry.isRemote}
                            onChange={v => onChange(index, 'isRemote', v)}
                            disabled={remoteWorkRestricted}
                            checkedChildren={<HomeOutlined />}
                            unCheckedChildren={<LaptopOutlined />}
                            style={entry.isRemote && !remoteWorkRestricted ? { background: t.purple } : undefined}
                        />
                    </Tooltip>
                </Col>
                <Col span={1} style={{ textAlign: 'right', paddingTop: 12 }}>
                    <Button
                        size="small" danger type="text" icon={<DeleteOutlined />}
                        onClick={() => onRemove(index)} disabled={!canRemove}
                    />
                </Col>

                <Col span={23} offset={1}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Progress made this week</Text>
                    <TextArea
                        rows={2}
                        placeholder="Describe what you accomplished on this task…"
                        value={entry.progressNotes}
                        onChange={e => onChange(index, 'progressNotes', e.target.value)}
                        style={{ marginTop: 3, resize: 'none' }}
                    />
                </Col>

                {!isDone && (
                    <Col span={23} offset={1}>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>What still needs to be done</Text>
                        <TextArea
                            rows={2}
                            placeholder="Remaining work, blockers, next steps…"
                            value={entry.remainingNotes}
                            onChange={e => onChange(index, 'remainingNotes', e.target.value)}
                            style={{ marginTop: 3, resize: 'none' }}
                        />
                    </Col>
                )}
            </Row>
        </div>
    );
}

function ReportViewModal({ report, onClose, onExportPdf, exportLoading, onApprove, onReject, canReview }: {
    report: Report | null;
    onClose: () => void;
    onExportPdf: (r: Report) => void;
    exportLoading: boolean;
    onApprove?: (r: Report) => void;
    onReject?: (r: Report) => void;
    canReview?: boolean;
}) {
    const { t } = useTheme();
    if (!report) return null;
    const remoteH = Number(report.remoteHours ?? 0);
    const totalH = Number(report.totalHours);
    const onsiteH = +(totalH - remoteH).toFixed(1);
    const limits = getUserLimits(resolveReportCap(report, report.user?.weeklyHoursCap));
    const overH = totalH > limits.maxH;
    const overR = remoteH > limits.maxR;
    const cfg = getReportStatusConfig(t)[report.status];
    const name = report.user?.fullName;
    return (
        <Modal
            open
            onCancel={onClose}
            title={
                <Space size={10}>
                    {name && <Text style={{ color: t.text }}>{name} —</Text>}
                    <Text style={{ color: t.text }}>Week of {report.weekStart}</Text>
                    <Tag style={{ background: `${alpha(cfg?.color ?? t.textMuted, 0.09)}`, border: `1px solid ${alpha(cfg?.color ?? t.textMuted, 0.27)}`, color: cfg?.color ?? t.textMuted }}>
                        {cfg?.icon} {cfg?.label ?? report.status}
                    </Tag>
                </Space>
            }
            footer={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Button icon={<FilePdfOutlined />} loading={exportLoading} onClick={() => onExportPdf(report)}
                        style={{ borderColor: t.danger, color: t.danger }}>Export PDF</Button>
                    <Space>
                        <Button icon={<StopOutlined />} onClick={() => { onClose(); onReject?.(report); }}
                            style={{ borderColor: t.orange, color: t.orange, visibility: (canReview && onReject && report.status !== 'Approved') ? 'visible' : 'hidden' }}>Needs Revision</Button>
                        <Button type="primary" icon={<CheckOutlined />} onClick={() => { onClose(); onApprove?.(report); }}
                            style={{ background: t.success, border: 'none', visibility: (canReview && onApprove && report.status !== 'Approved') ? 'visible' : 'hidden' }}>Approve</Button>
                        <Button onClick={onClose}>Close</Button>
                    </Space>
                </div>
            }
            width={760}
            styles={{
                body: { background: t.bg, maxHeight: '70vh', overflowY: 'auto', padding: '16px 24px' },
                header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                footer: { background: t.surface, borderTop: `1px solid ${t.border}`, padding: '12px 24px' },
            }}
        >
            <Row gutter={32} style={{ marginBottom: 12 }}>
                <Col span={12}><HourBar used={totalH} max={limits.maxH} label={`Total hours (max ${limits.maxH}h/week)`} color={t.success} /></Col>
                <Col span={12}><HourBar used={remoteH} max={limits.maxR} label={`Remote hours (max 20% = ${limits.maxR}h)`} color={t.purple} /></Col>
            </Row>
            <Space size={8} style={{ marginBottom: 14 }}>
                <Tag icon={<LaptopOutlined />} style={{ color: t.accent, background: `${alpha(t.accent, 0.09)}`, border: `1px solid ${alpha(t.accent, 0.27)}` }}>{onsiteH}h on-site</Tag>
                <Tag icon={<HomeOutlined />} style={{ color: t.purple, background: `${alpha(t.purple, 0.09)}`, border: `1px solid ${alpha(t.purple, 0.27)}` }}>{remoteH}h remote</Tag>
                {(overH || overR) && <Tag style={{ background: t.dangerBg, border: `1px solid ${t.danger}`, color: t.danger }}><WarningOutlined /> Limit exceeded</Tag>}
            </Space>
            {(report.tasksHours ?? []).map((task, i) => (
                <div key={i} style={{ padding: '12px 14px', marginBottom: 8, background: t.surfaceRaised, borderRadius: 6, border: `1px solid ${t.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <Space size={8}>
                            <Text style={{ color: t.text, fontWeight: 600 }}>{task.taskTitle || 'Unnamed Task'}</Text>
                            <Tag style={{ fontSize: 11, padding: '0 8px', background: `${alpha(getStatusColor(t)[task.status], 0.13)}`, border: `1px solid ${alpha(getStatusColor(t)[task.status], 0.4)}`, color: getStatusColor(t)[task.status] }}>
                                {getStatusIcon(t)[task.status]} {task.status}
                            </Tag>
                            {task.isRemote && <Tag icon={<HomeOutlined />} style={{ fontSize: 11, color: t.purple, background: `${alpha(t.purple, 0.13)}`, border: `1px solid ${alpha(t.purple, 0.33)}` }}>Remote</Tag>}
                        </Space>
                        <Tag style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700 }}>{task.hours}h</Tag>
                    </div>
                    {task.progressNotes && (
                        <div style={{ marginBottom: task.remainingNotes ? 4 : 0 }}>
                            <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Progress made: </Text>
                            <Text style={{ color: t.text, fontSize: 12 }}>{task.progressNotes}</Text>
                        </div>
                    )}
                    {task.remainingNotes && (
                        <div>
                            <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Still needed: </Text>
                            <Text style={{ color: t.warning, fontSize: 12 }}>{task.remainingNotes}</Text>
                        </div>
                    )}
                </div>
            ))}
            {report.notes && (
                <div style={{ padding: '10px 14px', background: t.surface, borderRadius: 6, border: `1px solid ${t.border}`, marginTop: 4 }}>
                    <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>General Notes</Text>
                    <Text style={{ color: t.text, fontSize: 13, whiteSpace: 'pre-wrap' }}>{report.notes}</Text>
                </div>
            )}
            {report.reviewNote && (
                <div style={{ padding: '10px 14px', background: `${alpha(cfg?.color ?? t.textMuted, 0.07)}`, borderRadius: 6, border: `1px solid ${alpha(cfg?.color ?? t.textMuted, 0.27)}`, marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <MessageOutlined style={{ color: cfg?.color ?? t.textMuted, marginTop: 2, flexShrink: 0 }} />
                    <div>
                        <Text style={{ color: cfg?.color ?? t.textMuted, fontSize: 11, fontWeight: 600, display: 'block' }}>Supervisor note</Text>
                        <Text style={{ color: t.text, fontSize: 13, whiteSpace: 'pre-wrap' }}>{report.reviewNote}</Text>
                    </div>
                </div>
            )}
            {canReview && report.managerComment && (
                <div style={{ padding: '10px 14px', background: `${alpha(t.purple, 0.07)}`, borderRadius: 6, border: `1px solid ${alpha(t.purple, 0.27)}`, marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <LockOutlined style={{ color: t.purple, marginTop: 2, flexShrink: 0 }} />
                    <div>
                        <Text style={{ color: t.purple, fontSize: 11, fontWeight: 600, display: 'block' }}>Private Manager Comment</Text>
                        <Text style={{ color: t.text, fontSize: 13, whiteSpace: 'pre-wrap' }}>{report.managerComment}</Text>
                    </div>
                </div>
            )}
        </Modal>
    );
}

/** Inline editable manager comment – shown only to reviewers inside EmployeeReportCard */
function ManagerCommentInline({ report, onSave }: { report: Report; onSave: (r: Report, comment: string) => void }) {
    const { t } = useTheme();
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState(report.managerComment ?? '');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        await onSave(report, value);
        setSaving(false);
        setEditing(false);
    };

    return (
        <div style={{ padding: '8px 20px', borderTop: `1px solid ${t.border}`, background: `${alpha(t.purple, 0.03)}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editing || report.managerComment ? 6 : 0 }}>
                <Space size={6}>
                    <LockOutlined style={{ color: t.purple, fontSize: 12 }} />
                    <Text style={{ color: t.purple, fontSize: 11, fontWeight: 700 }}>Private Manager Comment</Text>
                </Space>
                {!editing && (
                    <Button type="link" size="small"
                        onClick={() => { setValue(report.managerComment ?? ''); setEditing(true); }}
                        style={{ color: t.purple, fontSize: 11, padding: 0 }}>
                        {report.managerComment ? 'Edit' : 'Add Comment'}
                    </Button>
                )}
            </div>
            {editing ? (
                <div>
                    <Input.TextArea
                        rows={2}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        placeholder="Private performance note (invisible to employee)…"
                        style={{ resize: 'none', background: t.bg, borderColor: t.border, color: t.text, fontSize: 12 }}
                    />
                    <Space size={6} style={{ marginTop: 6 }}>
                        <Button size="small" type="primary" loading={saving} onClick={save}
                            style={{ background: t.purple, borderColor: t.purple, fontSize: 11 }}>
                            Save
                        </Button>
                        <Button size="small" onClick={() => setEditing(false)} style={{ fontSize: 11 }}>Cancel</Button>
                    </Space>
                </div>
            ) : report.managerComment ? (
                <Text style={{ color: t.text, fontSize: 12, whiteSpace: 'pre-wrap' }}>{report.managerComment}</Text>
            ) : null}
        </div>
    );
}

export function EmployeeReportCard({ report, onApprove, onReject, onView, onExportPdf, onDelete, onSaveManagerComment }: {
    report: Report;
    onApprove?: (r: Report) => void;
    onReject?: (r: Report) => void;
    onView?: (r: Report) => void;
    onExportPdf?: (r: Report) => void;
    onDelete?: (r: Report) => void;
    onSaveManagerComment?: (r: Report, comment: string) => void;
}) {
    const { t } = useTheme();
    const name = report.user?.fullName ?? 'Unknown';
    const remoteH = Number(report.remoteHours ?? 0);
    const totalH = Number(report.totalHours);
    const onsiteH = +(totalH - remoteH).toFixed(1);
    const limits = getUserLimits(resolveReportCap(report, report.user?.weeklyHoursCap));
    const overH = totalH > limits.maxH;
    const overR = remoteH > limits.maxR;

    return (
        <Card
            style={{ background: t.surface, border: `1px solid ${overH || overR ? t.danger : t.border}`, borderRadius: 8, marginBottom: 16 }}
            bodyStyle={{ padding: 0 }}
        >
            <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${t.border}` }}>
                <Space size={12}>
                    <UserAvatar name={name} avatarUrl={report.user?.avatarUrl} userId={report.user?.id} size={32} />
                    <div>
                        <Text style={{ color: t.text, fontWeight: 700, display: 'block' }}>{name}</Text>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            {report.submittedAt ? `Submitted ${new Date(report.submittedAt).toLocaleDateString()}` : 'Draft'}
                        </Text>
                    </div>
                </Space>
                <Space size={8}>
                    {(overH || overR) && (
                        <Tag style={{ background: t.dangerBg, border: `1px solid ${t.danger}`, color: t.danger }}>
                            <WarningOutlined /> Limit exceeded
                        </Tag>
                    )}
                    <Tag style={{
                        background: `${alpha(getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, 0.09)}`,
                        border: `1px solid ${alpha(getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, 0.27)}`,
                        color: getReportStatusConfig(t)[report.status]?.color ?? t.textMuted,
                    }}>
                        {getReportStatusConfig(t)[report.status]?.icon} {getReportStatusConfig(t)[report.status]?.label ?? report.status}
                    </Tag>
                    <Tooltip title="Total hours this week">
                        <Tag style={{ background: t.surfaceRaised, border: `1px solid ${overH ? t.danger : t.border}`, color: overH ? t.danger : t.text }}>{totalH}h total</Tag>
                    </Tooltip>
                    <Tooltip title="Remote hours">
                        <Tag icon={<HomeOutlined />} style={{ color: overR ? t.danger : t.purple, background: t.surfaceRaised, border: `1px solid ${overR ? t.danger : t.border}` }}>
                            {remoteH}h remote
                        </Tag>
                    </Tooltip>
                </Space>
            </div>

            <div style={{ padding: '12px 20px', background: t.bg }}>
                <Row gutter={32}>
                    <Col span={12}><HourBar used={totalH} max={limits.maxH} label={`Total hours (max ${limits.maxH}h/week)`} color={t.success} /></Col>
                    <Col span={12}><HourBar used={remoteH} max={limits.maxR} label={`Remote hours (max 20% = ${limits.maxR}h)`} color={t.purple} /></Col>
                </Row>
                <Space size={8} style={{ marginTop: 8 }}>
                    <Tag icon={<LaptopOutlined />} style={{ color: t.accent, background: `${alpha(t.accent, 0.09)}`, border: `1px solid ${alpha(t.accent, 0.27)}` }}>{onsiteH}h on-site</Tag>
                    <Tag icon={<HomeOutlined />} style={{ color: t.purple, background: `${alpha(t.purple, 0.09)}`, border: `1px solid ${alpha(t.purple, 0.27)}` }}>{remoteH}h remote</Tag>
                    <Tag icon={<FileTextOutlined />} style={{ color: t.orange, background: `${alpha(t.orange, 0.09)}`, border: `1px solid ${alpha(t.orange, 0.27)}` }}>{report.tasksHours?.length ?? 0} tasks</Tag>
                </Space>
            </div>

            <div style={{ padding: '0 20px 16px' }}>
                {(report.tasksHours ?? []).map((task, i) => (
                    <div key={i} style={{ padding: '12px 14px', marginBottom: 8, background: t.surfaceRaised, borderRadius: 6, border: `1px solid ${t.border}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <Space size={8}>
                                <Text style={{ color: t.text, fontWeight: 600 }}>{task.taskTitle || 'Unnamed Task'}</Text>
                                <Tag style={{ fontSize: 11, padding: '0 8px', background: `${alpha(getStatusColor(t)[task.status], 0.13)}`, border: `1px solid ${alpha(getStatusColor(t)[task.status], 0.4)}`, color: getStatusColor(t)[task.status] }}>
                                    {getStatusIcon(t)[task.status]} {task.status}
                                </Tag>
                                {task.isRemote && <Tag icon={<HomeOutlined />} style={{ fontSize: 11, color: t.purple, background: `${alpha(t.purple, 0.13)}`, border: `1px solid ${alpha(t.purple, 0.33)}` }}>Remote</Tag>}
                            </Space>
                            <Tag style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontWeight: 700 }}>{task.hours}h</Tag>
                        </div>
                        {task.progressNotes && (
                            <div style={{ marginBottom: task.remainingNotes ? 6 : 0 }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Progress made: </Text>
                                <Text style={{ color: t.text, fontSize: 12 }}>{task.progressNotes}</Text>
                            </div>
                        )}
                        {task.remainingNotes && (
                            <div>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Still needed: </Text>
                                <Text style={{ color: t.warning, fontSize: 12 }}>{task.remainingNotes}</Text>
                            </div>
                        )}
                    </div>
                ))}
                {report.notes && (
                    <div style={{ padding: '8px 14px', background: t.surface, borderRadius: 6, border: `1px solid ${t.border}`, marginTop: 4 }}>
                        <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Notes: </Text>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>{report.notes}</Text>
                    </div>
                )}
                {/* Review feedback (if already reviewed) */}
                {report.reviewNote && (
                    <div style={{ padding: '8px 14px', background: `${alpha(getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, 0.07)}`, borderRadius: 6, border: `1px solid ${alpha(getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, 0.27)}`, marginTop: 4, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <MessageOutlined style={{ color: getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, marginTop: 2, flexShrink: 0 }} />
                        <div>
                            <Text style={{ color: getReportStatusConfig(t)[report.status]?.color ?? t.textMuted, fontSize: 11, fontWeight: 600, display: 'block' }}>Supervisor note</Text>
                            <Text style={{ color: t.text, fontSize: 12 }}>{report.reviewNote}</Text>
                        </div>
                    </div>
                )}
            </div>

            {/* Private manager comment (reviewers only) */}
            {onSaveManagerComment && (
                <ManagerCommentInline report={report} onSave={onSaveManagerComment} />
            )}

            {/* View + Export on the header */}
            {(onView || onExportPdf || onDelete) && (
                <div style={{ padding: '8px 20px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space size={8}>
                        {onView && (
                            <Button size="small" icon={<EyeOutlined />} onClick={() => onView(report)}
                                style={{ borderColor: t.border, color: t.textMuted }}>
                                View Report
                            </Button>
                        )}
                        {onExportPdf && (
                            <Button size="small" icon={<FilePdfOutlined />} onClick={() => onExportPdf(report)}
                                style={{ borderColor: t.danger, color: t.danger }}>
                                Export PDF
                            </Button>
                        )}
                    </Space>
                    {onDelete && (
                        <Popconfirm
                            title="Delete this report?"
                            description="This action cannot be undone."
                            icon={<ExclamationCircleOutlined style={{ color: t.danger }} />}
                            onConfirm={() => onDelete(report)}
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                            cancelText="Cancel"
                        >
                            <Button size="small" danger icon={<DeleteOutlined />}
                                style={{ background: `${alpha(t.danger, 0.07)}` }}>
                                Delete
                            </Button>
                        </Popconfirm>
                    )}
                </div>
            )}

            {/* Supervisor approve / reject actions */}
            {(onApprove || onReject) && report.status !== 'Approved' && (
                <div style={{ padding: '10px 20px 14px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    {onReject && (
                        <Button
                            size="small" icon={<StopOutlined />}
                            onClick={() => onReject(report)}
                            style={{ borderColor: t.orange, color: t.orange, background: `${alpha(t.orange, 0.07)}` }}
                        >
                            Needs Revision
                        </Button>
                    )}
                    {onApprove && (
                        <Button
                            size="small" icon={<CheckOutlined />} type="primary"
                            onClick={() => onApprove(report)}
                            style={{ background: t.success, borderColor: t.success }}
                        >
                            Approve
                        </Button>
                    )}
                </div>
            )}
        </Card>
    );
}

export default function ReportsPage() {
    const deepLinkId = useDeepLinkId('reportId', 'openReportId');
    const deepLinkWeek = useDeepLinkParam('week');
    const { t } = useTheme();
    const user = useAuthStore(s => s.user);
    const setUser = useAuthStore(s => s.setUser);
    const { permissions } = usePermissions();
    // The reviewer view is driven solely by the manage_reports permission —
    // no role-name shortcut. Permissions are available synchronously from the
    // persisted auth store, so there is no first-render flash.
    const canManage = permissions.manage_reports === true;

    // Reviewer filter defaults to CURRENT week so they immediately see this week's submissions.
    // For employees (non-reviewer), "My Reports" week defaults to the current ISO Monday.
    const defaultAdminWeek = defaultReportWeek();
    const defaultEmployeeWeek = defaultReportWeek();

    const [reports, setReports] = useState<Report[]>([]);
    const [myReports, setMyReports] = useState<Report[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
    const [weekFilter, setWeekFilter] = useState(canManage ? defaultAdminWeek : defaultEmployeeWeek);

    const [submitOpen, setSubmitOpen] = useState(false);
    const [submitLoading, setSubmitLoading] = useState(false);
    const [reportWeek, setReportWeek] = useState(defaultEmployeeWeek);

    // Reviewer edit modal state
    const [editReport, setEditReport] = useState<Report | null>(null);
    const [editWeekStart, setEditWeekStart] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [editEntries, setEditEntries] = useState<TaskEntry[]>([]);
    const [editLoading, setEditLoading] = useState(false);
    const [editManagerComment, setEditManagerComment] = useState('');
    const [entries, setEntries] = useState<TaskEntry[]>([emptyEntry()]);
    const [generalNotes, setGeneralNotes] = useState('');
    const [pdfLoading, setPdfLoading] = useState(false);
    const [reminderLoading, setReminderLoading] = useState(false);

    // ── Live cap hours: always fetch fresh from backend, don't rely on stale auth store ──
    // The auth store is only hydrated at login; if a user administrator sets the cap after login it would be stale.
    const [myCapHours, setMyCapHours] = useState<number | null | undefined>(user?.weeklyHoursCap);
    const [myRemoteWorkRestricted, setMyRemoteWorkRestricted] = useState<boolean>(user?.remoteWorkRestricted ?? false);
    useEffect(() => {
        api.get('/users/me').then(res => {
            const fresh: number | null = res.data.weeklyHoursCap ?? null;
            const restricted: boolean = res.data.remoteWorkRestricted ?? false;
            setMyCapHours(fresh);
            setMyRemoteWorkRestricted(restricted);
            // Also update the auth store so other pages stay in sync
            if (user) setUser({ ...user, weeklyHoursCap: fresh, remoteWorkRestricted: restricted });
        }).catch(() => { /* keep stale value */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Review modal state (supervisor)
    const [reviewOpen, setReviewOpen] = useState(false);
    const [reviewTarget, setReviewTarget] = useState<Report | null>(null);
    const [reviewMode, setReviewMode] = useState<'approve' | 'reject'>('approve');
    const [reviewNoteInput, setReviewNoteInput] = useState('');
    const [reviewLoading, setReviewLoading] = useState(false);
    // Labor account for auto-deduction on approval
    const [laborAccountId, setLaborAccountId] = useState<string | undefined>(undefined);
    const [laborAccounts, setLaborAccounts] = useState<{ id: string; name: string; balance: number }[]>([]);

    // View modal state
    const [viewReport, setViewReport] = useState<Report | null>(null);
    const [viewPdfLoading, setViewPdfLoading] = useState(false);

    // Manager comment modal state
    const [commentModalOpen, setCommentModalOpen] = useState(false);
    const [commentTarget, setCommentTarget] = useState<Report | null>(null);
    const [commentValue, setCommentValue] = useState('');
    const [commentSaving, setCommentSaving] = useState(false);

    const totalHours = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const remoteHours = entries.reduce((s, e) => s + (e.isRemote ? Number(e.hours) || 0 : 0), 0);
    const myLimits = getUserLimits(myCapHours);
    const overTotal = totalHours > myLimits.maxH;
    const overRemote = remoteHours > myLimits.maxR;

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [myRes, allRes] = await Promise.all([
                api.get('/reports/mine'),
                canManage ? api.get('/reports', { params: { week: weekFilter } }) : Promise.resolve({ data: [] }),
            ]);
            setMyReports(myRes.data);
            setReports(allRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load reports');
        } finally {
            setLoading(false);
        }
    }, [weekFilter, canManage]);

    // A link may name a reporting period rather than one report.
    useEffect(() => {
        if (deepLinkWeek) setWeekFilter(deepLinkWeek);
    }, [deepLinkWeek]);

    useEffect(() => { load(); }, [load]);

    // Deep-link: open exactly the report that was clicked.
    //
    // Looking only through the reports already on screen was not enough: the
    // list is loaded for one week at a time, so a link to a report from any
    // other week found nothing and the page just sat on its default week —
    // which is what "it opens the general reports page instead" was. If the
    // report is not in the loaded set, it is fetched by id.
    useEffect(() => {
        const openId = deepLinkId;
        if (!openId) return;
        const found = [...myReports, ...reports].find((r) => r.id === openId);
        if (found) { setViewReport(found); return; }

        let cancelled = false;
        api.get<Report>(`/reports/${openId}`)
            .then((res) => {
                if (cancelled) return;
                setViewReport(res.data);
                // Move the week filter to the report's own week so the list
                // behind the dialog is showing the right period.
                if (res.data?.weekStart) setWeekFilter(res.data.weekStart);
            })
            .catch(() => {
                if (!cancelled) {
                    message.warning('That report could not be opened — it may have been removed, or you may not have access to it.');
                }
            });
        return () => { cancelled = true; };
    }, [deepLinkId, myReports, reports]);

    const openSubmit = async (prefilledReport?: Report) => {
        let week: string;
        if (prefilledReport) {
            // Pre-fill from an existing report (resubmit after rejection)
            setReportWeek(prefilledReport.weekStart);
            setEntries(prefilledReport.tasksHours.map(t => ({ ...t })));
            setGeneralNotes(prefilledReport.notes ?? '');
            week = prefilledReport.weekStart;
        } else {
            setEntries([emptyEntry()]);
            setGeneralNotes('');
            setReportWeek(defaultEmployeeWeek);
            week = defaultEmployeeWeek;
        }
        try {
            const res = await api.get('/tasks');
            // UTC week boundaries: Monday 00:00 UTC → following Monday 00:00 UTC.
            // All timestamp comparisons use UTC so they match the UTC-derived week string.
            const weekStart = dayjs.utc(week).startOf('day');
            const weekEnd = weekStart.add(7, 'day');
            setAssignedTasks(filterTasksForWeek(res.data, user?.id, weekStart, weekEnd));
        } catch { setAssignedTasks([]); }
        setSubmitOpen(true);
    };

    const addEntry = () => setEntries(prev => [...prev, emptyEntry()]);

    // Re-fetch task list AND reset entries when report week changes in the submit modal.
    // Each week is an independent time-slot: if there is an existing editable report
    // for the newly-selected week we pre-fill from it; otherwise we start blank.
    useEffect(() => {
        if (!submitOpen) return;
        (async () => {
            try {
                const res = await api.get('/tasks');
                // UTC week boundaries, identical derivation to openSubmit so the
                // task list stays in sync when the employee changes the report week.
                const weekStart = dayjs.utc(reportWeek).startOf('day');
                const weekEnd = weekStart.add(7, 'day');
                setAssignedTasks(filterTasksForWeek(res.data, user?.id, weekStart, weekEnd));
            } catch { /* keep existing */ }

            // Week-isolation: load or reset entries for the selected week
            const existingForWeek = myReports.find(r => r.weekStart === reportWeek);
            if (existingForWeek && existingForWeek.status !== 'Approved') {
                // Pre-fill from the existing draft / submitted / needs-revision report
                setEntries(existingForWeek.tasksHours.map(t => ({ ...t })));
                setGeneralNotes(existingForWeek.notes ?? '');
            } else if (!existingForWeek) {
                // No report for this week yet — start completely fresh
                setEntries([emptyEntry()]);
                setGeneralNotes('');
            }
            // If the existing report is already Approved, leave entries as-is
            // (the submit button will be disabled for that week anyway)
        })();
    }, [reportWeek, submitOpen, user?.id, myReports]);
    const removeEntry = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i));
    const updateEntry = (i: number, field: keyof TaskEntry, val: any) => {
        setEntries(prev => { const n = [...prev]; (n[i] as any)[field] = val; return n; });
    };

    const handleSubmit = async () => {
        if (entries.find(e => !e.taskTitle.trim())) { message.warning('All entries need a task name'); return; }
        if (entries.find(e => e.status !== 'Done' && !e.progressNotes.trim())) { message.warning('Fill in progress notes for each task'); return; }
        if (myRemoteWorkRestricted && remoteHours > 0) { message.error('Remote work is restricted for your account. All hours must be on-site.'); return; }
        if (overTotal) { message.error(`Total hours (${totalHours}h) exceeds ${myLimits.maxH}h weekly limit`); return; }
        if (overRemote) { message.error(`Remote hours (${remoteHours}h) exceed ${myLimits.maxR}h (20% of ${myLimits.maxH}h)`); return; }

        setSubmitLoading(true);
        try {
            await api.post('/reports', { weekStart: reportWeek, tasksHours: entries, notes: generalNotes });
            message.success('Report submitted!');
            setSubmitOpen(false);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Submit failed');
        } finally { setSubmitLoading(false); }
    };

    const handleExportPdf = async () => {
        setPdfLoading(true);
        try {
            const res = await api.get('/reports/export/pdf', { params: { week: weekFilter }, responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a = document.createElement('a'); a.href = url; a.download = `weekly-report-${weekFilter}.pdf`; a.click();
            URL.revokeObjectURL(url);
            message.success('PDF downloaded!');
        } catch { message.error('PDF export failed'); }
        finally { setPdfLoading(false); }
    };

    const handleExportSinglePdf = async (report: Report) => {
        setViewPdfLoading(true);
        try {
            const res = await api.get(`/reports/${report.id}/export`, { responseType: 'blob' });
            const name = report.user?.fullName ?? 'report';
            const filename = `report-${report.weekStart}-${name.replace(/\s+/g, '-')}.pdf`;
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
            URL.revokeObjectURL(url);
            message.success('PDF downloaded!');
        } catch { message.error('PDF export failed'); }
        finally { setViewPdfLoading(false); }
    };

    const handleDeleteReport = async (report: Report) => {
        try {
            await api.delete(`/reports/${report.id}`);
            message.success('Report deleted');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to delete report');
        }
    };

    const handleSaveManagerComment = async (report: Report, comment: string) => {
        try {
            await api.patch(`/reports/${report.id}`, { managerComment: comment || null });
            message.success('Manager comment saved');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to save comment');
        }
    };

    const openAdminEdit = (report: Report) => {
        setEditReport(report);
        setEditWeekStart(report.weekStart);
        setEditNotes(report.notes ?? '');
        setEditEntries((report.tasksHours ?? []).map(t => ({ ...t })));
        setEditManagerComment(report.managerComment ?? '');
    };

    const handleAdminEditSave = async () => {
        if (!editReport) return;
        setEditLoading(true);
        try {
            await api.patch(`/reports/${editReport.id}`, {
                weekStart: editWeekStart,
                notes: editNotes,
                tasksHours: editEntries,
                managerComment: editManagerComment || null,
            });
            message.success('Report updated ✅');
            setEditReport(null);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to save changes');
        } finally { setEditLoading(false); }
    };

    const handleReminders = async () => {
        setReminderLoading(true);
        try {
            const res = await api.post(`/reports/remind/${weekFilter}`);
            message.success(`Reminded ${res.data.reminded} employee(s)`);
        } catch (e: any) { message.error(e?.response?.data?.message ?? 'Failed'); }
        finally { setReminderLoading(false); }
    };

    const openReview = async (report: Report, mode: 'approve' | 'reject') => {
        setReviewTarget(report);
        setReviewMode(mode);
        setReviewNoteInput('');
        setLaborAccountId(undefined);
        setReviewOpen(true);
        // Fetch labor accounts when opening the approve modal so admin can trigger auto-deduction
        if (mode === 'approve' && laborAccounts.length === 0) {
            try {
                const res = await api.get<{ id: string; name: string; balance: number; category: string }[]>('/budget/accounts');
                setLaborAccounts(res.data.filter(a => a.category === 'Labor'));
            } catch { /* non-fatal — deduction can be done manually */ }
        }
    };

    const handleReview = async () => {
        if (!reviewTarget) return;
        setReviewLoading(true);
        try {
            await api.patch(`/reports/${reviewTarget.id}/review`, {
                action: reviewMode === 'approve' ? 'approve' : 'reject',
                note: reviewNoteInput.trim() || undefined,
                // Include laborAccountId so the backend auto-creates a labor deduction on approval
                ...(reviewMode === 'approve' && laborAccountId ? { laborAccountId } : {}),
            });
            message.success(
                reviewMode === 'approve'
                    ? laborAccountId ? 'Report approved & labor cost deducted ✅' : 'Report approved ✅'
                    : 'Report sent back for revision 🔁'
            );
            setReviewOpen(false);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Review failed');
        } finally { setReviewLoading(false); }
    };

    const teamTotalH = reports.reduce((s, r) => s + Number(r.totalHours), 0);
    const teamRemoteH = reports.reduce((s, r) => s + Number(r.remoteHours ?? 0), 0);
    const violations = reports.filter(r => {
        const rL = getUserLimits(resolveReportCap(r, r.user?.weeklyHoursCap));
        return Number(r.totalHours) > rL.maxH || Number(r.remoteHours ?? 0) > rL.maxR;
    }).length;

    return (
        <div style={{ padding: '0 0 60px', background: t.bg, minHeight: '100vh' }}>
            <PageHeader
                title={<Space size={8}><FileTextOutlined />Weekly Reports</Space>}
                subtitle={`Hours are capped per employee — default ${DEFAULT_MAX_HOURS}h a week, of which 20% may be remote. `
                    + 'Where attendance enforcement is on, verified attendance is the ceiling.'}
                actions={
                <Space wrap>
                    {canManage && (
                        <>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: '2px 6px' }}>
                                <Button type="text" size="small" icon={<LeftOutlined />}
                                    onClick={() => { const d = dayjs(weekFilter).subtract(7, 'day'); setWeekFilter(d.subtract(d.isoWeekday() - 1, 'day').format('YYYY-MM-DD')); }}
                                    style={{ color: t.textMuted }} />
                                <DatePicker
                                    picker="week"
                                    locale={dayjsPickerLocale}
                                    value={dayjs(weekFilter).utc()}
                                    onChange={d => { if (d) setWeekFilter(mondayOfWeek(d.utc())); }}
                                    format={d => `Week of ${mondayOfWeek(d)}`}
                                    allowClear={false}
                                    style={{ width: 200 }}
                                />
                                <Button type="text" size="small" icon={<RightOutlined />}
                                    onClick={() => { const d = dayjs(weekFilter).add(7, 'day'); setWeekFilter(d.subtract(d.isoWeekday() - 1, 'day').format('YYYY-MM-DD')); }}
                                    style={{ color: t.textMuted }} />
                                {weekFilter !== defaultReportWeek() && (
                                    <Button type="link" size="small"
                                        onClick={() => setWeekFilter(defaultReportWeek())}
                                        style={{ color: t.accent, fontSize: 12, padding: '0 6px' }}>
                                        Today
                                    </Button>
                                )}
                            </div>
                            <Button icon={<BellOutlined />} loading={reminderLoading} onClick={handleReminders} style={{ borderColor: t.warning, color: t.warning }}>
                                Remind
                            </Button>
                            <Button icon={<FilePdfOutlined />} loading={pdfLoading} onClick={handleExportPdf} style={{ borderColor: t.danger, color: t.danger }}>
                                Export PDF
                            </Button>
                        </>
                    )}
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openSubmit()} style={{ background: t.accent, border: 'none' }}>
                        Submit Report
                    </Button>
                </Space>
                }
            />

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {loading ? (
                <div style={{ textAlign: 'center', paddingTop: 100 }}><Spin size="large" /></div>
            ) : (
                <>
                    {canManage && (
                        <>
                            <Row gutter={16} style={{ marginBottom: 20 }}>
                                {[
                                    { label: 'Submitted', value: reports.length, color: t.success },
                                    { label: 'Team Hours', value: `${teamTotalH}h`, color: t.accent },
                                    { label: 'Remote Hours', value: `${teamRemoteH}h`, color: t.purple },
                                    { label: 'Violations', value: violations, color: violations > 0 ? t.danger : t.textMuted },
                                ].map(s => (
                                    <Col key={s.label} xs={12} sm={6}>
                                        <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, textAlign: 'center' }} bodyStyle={{ padding: '12px 16px' }}>
                                            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                                            <div style={{ color: t.textMuted, fontSize: 12 }}>{s.label}</div>
                                        </Card>
                                    </Col>
                                ))}
                            </Row>

                            <Title level={5} style={{ color: t.text, marginBottom: 16 }}>
                                Employee Reports — Week of {weekFilter}
                            </Title>

                            <Table
                                dataSource={reports}
                                rowKey="id"
                                pagination={false}
                                locale={{ emptyText: <Empty description={<Text style={{ color: t.textMuted }}>No reports for this week</Text>} style={{ padding: '32px 0' }} /> }}
                                style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.border}` }}
                                onRow={(r: Report) => {
                                    const rL = getUserLimits(resolveReportCap(r, r.user?.weeklyHoursCap));
                                    return {
                                        style: {
                                            background: Number(r.totalHours) > rL.maxH || Number(r.remoteHours ?? 0) > rL.maxR
                                                ? `${alpha(t.danger, 0.03)}`
                                                : t.surface,
                                        }
                                    };
                                }}
                                columns={[
                                    {
                                        title: 'Employee',
                                        key: 'employee',
                                        render: (_: any, r: Report) => {
                                            const name = r.user?.fullName ?? 'Unknown';
                                            return (
                                                <Space>
                                                    <UserAvatar name={name} avatarUrl={r.user?.avatarUrl} userId={r.user?.id} size={32} />
                                                    <div>
                                                        <Text style={{ color: t.text, fontWeight: 600 }}>{name}</Text>
                                                        {r.submittedAt && (
                                                            <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                                                                {new Date(r.submittedAt).toLocaleDateString()}
                                                            </Text>
                                                        )}
                                                    </div>
                                                </Space>
                                            );
                                        },
                                    },
                                    {
                                        title: 'Status',
                                        key: 'status',
                                        width: 160,
                                        render: (_: any, r: Report) => (
                                            <Tag style={{
                                                background: `${alpha(getReportStatusConfig(t)[r.status]?.color ?? t.textMuted, 0.09)}`,
                                                border: `1px solid ${alpha(getReportStatusConfig(t)[r.status]?.color ?? t.textMuted, 0.27)}`,
                                                color: getReportStatusConfig(t)[r.status]?.color ?? t.textMuted,
                                            }}>
                                                {getReportStatusConfig(t)[r.status]?.icon} {getReportStatusConfig(t)[r.status]?.label ?? r.status}
                                            </Tag>
                                        ),
                                    },
                                    {
                                        title: 'Hours',
                                        key: 'hours',
                                        width: 200,
                                        render: (_: any, r: Report) => {
                                            const total = Number(r.totalHours);
                                            const remote = Number(r.remoteHours ?? 0);
                                            const rL = getUserLimits(resolveReportCap(r, r.user?.weeklyHoursCap));
                                            const overH = total > rL.maxH;
                                            const overR = remote > rL.maxR;
                                            return (
                                                <div>
                                                    <Space size={4}>
                                                        <Tag style={{ background: t.surfaceRaised, border: `1px solid ${overH ? t.danger : t.border}`, color: overH ? t.danger : t.text }}>
                                                            {total}h total
                                                        </Tag>
                                                        <Tag icon={<HomeOutlined />} style={{ background: t.surfaceRaised, border: `1px solid ${overR ? t.danger : t.border}`, color: overR ? t.danger : t.purple }}>
                                                            {remote}h remote
                                                        </Tag>
                                                    </Space>
                                                    {(overH || overR) && (
                                                        <div style={{ marginTop: 4 }}>
                                                            <Tag style={{ background: `${alpha(t.danger, 0.09)}`, border: `1px solid ${alpha(t.danger, 0.27)}`, color: t.danger, fontSize: 11 }}>
                                                                <WarningOutlined /> Over limit
                                                            </Tag>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        },
                                    },
                                    {
                                        title: 'Tasks',
                                        key: 'tasks',
                                        width: 70,
                                        align: 'center' as const,
                                        render: (_: any, r: Report) => (
                                            <Badge count={r.tasksHours?.length ?? 0} style={{ background: t.accent }} showZero />
                                        ),
                                    },
                                    {
                                        title: <span><LockOutlined style={{ marginRight: 4 }} />Comment</span>,
                                        key: 'managerComment',
                                        width: 100,
                                        align: 'center' as const,
                                        render: (_: any, r: Report) => (
                                            <Tooltip title={r.managerComment || 'No private comment yet'}>
                                                <Badge dot={!!r.managerComment} offset={[-2, 2]} color={t.purple}>
                                                    <Button type="text" size="small" icon={<LockOutlined />}
                                                        onClick={() => { setCommentTarget(r); setCommentValue(r.managerComment ?? ''); setCommentModalOpen(true); }}
                                                        style={{ color: r.managerComment ? t.purple : t.textMuted }} />
                                                </Badge>
                                            </Tooltip>
                                        ),
                                    },
                                    {
                                        title: 'Actions',
                                        key: 'actions',
                                        width: 300,
                                        render: (_: any, r: Report) => (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {/* Row 1: View / Edit / PDF */}
                                                <Space size={4}>
                                                    <Tooltip title="View full report">
                                                        <Button size="small" icon={<EyeOutlined />} onClick={() => setViewReport(r)}
                                                            style={{ borderColor: t.border, color: t.textMuted, background: t.surfaceRaised }} />
                                                    </Tooltip>
                                                    <Tooltip title="Edit report">
                                                        <Button size="small" icon={<EditOutlined />} onClick={() => openAdminEdit(r)}
                                                            style={{ borderColor: t.accent, color: t.accent, background: `${alpha(t.accent, 0.06)}` }} />
                                                    </Tooltip>
                                                    <Tooltip title="Export PDF">
                                                        <Button size="small" icon={<FilePdfOutlined />} onClick={() => handleExportSinglePdf(r)}
                                                            style={{ borderColor: t.danger, color: t.danger, background: `${alpha(t.danger, 0.06)}` }} />
                                                    </Tooltip>
                                                </Space>
                                                {/* Row 2: Approve / Revise / Delete */}
                                                <Space size={4}>
                                                    {r.status === 'Approved' ? (
                                                        <Tag icon={<CheckCircleOutlined />} style={{
                                                            color: t.success, background: `${alpha(t.success, 0.08)}`,
                                                            border: `1px solid ${alpha(t.success, 0.27)}`, borderRadius: 6,
                                                            fontSize: 11, padding: '1px 8px', margin: 0,
                                                        }}>Approved</Tag>
                                                    ) : (
                                                        <>
                                                            <Tooltip title="Approve report">
                                                                <Button size="small" icon={<CheckOutlined />} onClick={() => openReview(r, 'approve')}
                                                                    style={{ background: `${alpha(t.success, 0.09)}`, borderColor: t.success, color: t.success }}>
                                                                    Approve
                                                                </Button>
                                                            </Tooltip>
                                                            <Tooltip title="Request revision">
                                                                <Button size="small" icon={<RedoOutlined />} onClick={() => openReview(r, 'reject')}
                                                                    style={{ background: `${alpha(t.orange, 0.09)}`, borderColor: t.orange, color: t.orange }}>
                                                                    Revise
                                                                </Button>
                                                            </Tooltip>
                                                        </>
                                                    )}
                                                    <Popconfirm
                                                        title="Delete this report?"
                                                        description="This action cannot be undone."
                                                        icon={<ExclamationCircleOutlined style={{ color: t.danger }} />}
                                                        onConfirm={() => handleDeleteReport(r)}
                                                        okText="Delete"
                                                        okButtonProps={{ danger: true }}
                                                        cancelText="Cancel"
                                                    >
                                                        <Tooltip title="Delete report">
                                                            <Button size="small" danger icon={<DeleteOutlined />}
                                                                style={{ background: `${alpha(t.danger, 0.07)}`, borderColor: `${alpha(t.danger, 0.4)}` }} />
                                                        </Tooltip>
                                                    </Popconfirm>
                                                </Space>
                                            </div>
                                        ),
                                    },
                                ]}
                            />

                            <Divider style={{ borderColor: t.border, margin: '32px 0' }} />
                        </>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                        <Title level={5} style={{ color: t.text, margin: 0 }}>
                            <UserOutlined style={{ marginRight: 8, color: t.accent }} />My Report — Week of {weekFilter}
                        </Title>
                        {/* Non-reviewers get their own week navigation here */}
                        {!canManage && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, padding: '2px 6px' }}>
                                <Button type="text" size="small" icon={<LeftOutlined />}
                                    onClick={() => setWeekFilter(dayjs(weekFilter).utc().subtract(7, 'day').format('YYYY-MM-DD'))}
                                    style={{ color: t.textMuted }} />
                                <DatePicker
                                    picker="week"
                                    locale={dayjsPickerLocale}
                                    value={dayjs(weekFilter).utc()}
                                    onChange={d => { if (d) setWeekFilter(mondayOfWeek(d.utc())); }}
                                    format={d => `Week of ${mondayOfWeek(d)}`}
                                    allowClear={false}
                                    style={{ width: 190 }}
                                />
                                <Button type="text" size="small" icon={<RightOutlined />}
                                    onClick={() => { const d = dayjs(weekFilter).add(7, 'day'); setWeekFilter(d.subtract(d.isoWeekday() - 1, 'day').format('YYYY-MM-DD')); }}
                                    style={{ color: t.textMuted }} />
                                {weekFilter !== defaultReportWeek() && (
                                    <Button type="link" size="small"
                                        onClick={() => setWeekFilter(defaultReportWeek())}
                                        style={{ color: t.accent, fontSize: 12, padding: '0 6px' }}>
                                        Today
                                    </Button>
                                )}
                            </div>
                        )}
                    </div>

                    {(() => {
                        const weekReport = myReports.find(r => r.weekStart === weekFilter);
                        if (!weekReport) {
                            return (
                                <Card style={{ background: t.surface, border: `1px solid ${t.border}`, textAlign: 'center' }} styles={{ body: { padding: 40 } }}>
                                    <FileTextOutlined style={{ fontSize: 40, color: t.textMuted, marginBottom: 12 }} /><br />
                                    <Text style={{ color: t.textMuted }}>No report for this week yet. Click "Submit Report" to log your hours.</Text>
                                </Card>
                            );
                        }
                        const r = weekReport;
                        const rTotal = Number(r.totalHours);
                        const rRemote = Number(r.remoteHours ?? 0);
                        const rOnsiteH = +(rTotal - rRemote).toFixed(1);
                        const rLimits = getUserLimits(resolveReportCap(r, myCapHours));
                        const rOver = rTotal > rLimits.maxH || rRemote > rLimits.maxR;
                        const statusConf = getReportStatusConfig(t)[r.status];
                        const borderColor = r.status === 'Needs Revision'
                            ? t.orange
                            : r.status === 'Approved'
                                ? t.success
                                : rOver ? t.danger : t.border;
                        return (
                        <Row gutter={[16, 16]}>
                            <Col xs={24} md={12} key={r.id}>
                                <Card
                                    style={{ background: t.surface, border: `1.5px solid ${borderColor}`, borderRadius: 10, height: '100%' }}
                                    styles={{ body: { padding: 0 } }}
                                >
                                    {/* Header: week + status badge */}
                                    <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <div>
                                                    <Text style={{ color: t.textMuted, fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>WEEK OF</Text>
                                                    <div style={{ color: t.text, fontWeight: 700, fontSize: 16 }}>{r.weekStart}</div>
                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                        {r.submittedAt ? `Submitted ${new Date(r.submittedAt).toLocaleDateString()}` : 'Draft — not submitted'}
                                                    </Text>
                                                </div>
                                                <Tag style={{
                                                    background: `${alpha(statusConf?.color ?? t.textMuted, 0.13)}`,
                                                    border: `1px solid ${alpha(statusConf?.color ?? t.textMuted, 0.33)}`,
                                                    color: statusConf?.color ?? t.textMuted,
                                                    fontSize: 12, padding: '3px 10px', borderRadius: 6,
                                                }}>
                                                    {statusConf?.icon} {statusConf?.label ?? r.status}
                                                </Tag>
                                            </div>

                                            {/* Hour bars */}
                                            <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}` }}>
                                                <HourBar used={rTotal} max={rLimits.maxH} label={`Total: ${rTotal}h / ${rLimits.maxH}h`} color={rTotal > rLimits.maxH ? t.danger : t.success} />
                                                <HourBar used={rRemote} max={rLimits.maxR} label={`Remote: ${rRemote}h / ${rLimits.maxR}h (20%)`} color={rRemote > rLimits.maxR ? t.danger : t.purple} />
                                                <Space size={8} style={{ marginTop: 8, flexWrap: 'wrap' as const }}>
                                                    <Tag icon={<LaptopOutlined />} style={{ color: t.accent, background: `${alpha(t.accent, 0.09)}`, border: `1px solid ${alpha(t.accent, 0.27)}` }}>{rOnsiteH}h on-site</Tag>
                                                    <Tag icon={<HomeOutlined />} style={{ color: t.purple, background: `${alpha(t.purple, 0.09)}`, border: `1px solid ${alpha(t.purple, 0.27)}` }}>{rRemote}h remote</Tag>
                                                    <Tag icon={<FileTextOutlined />} style={{ color: t.orange, background: `${alpha(t.orange, 0.09)}`, border: `1px solid ${alpha(t.orange, 0.27)}` }}>{r.tasksHours?.length ?? 0} tasks</Tag>
                                                    {rOver && <Tag style={{ background: `${alpha(t.danger, 0.09)}`, border: `1px solid ${alpha(t.danger, 0.27)}`, color: t.danger }}><WarningOutlined /> Over limit</Tag>}
                                                </Space>
                                            </div>

                                            {/* Revision / approval note — highlighted banner */}
                                            {r.reviewNote && (
                                                <div style={{
                                                    padding: '10px 18px',
                                                    background: `${alpha(statusConf?.color ?? t.textMuted, 0.07)}`,
                                                    borderBottom: `1px solid ${alpha(statusConf?.color ?? t.textMuted, 0.2)}`,
                                                    display: 'flex', gap: 10, alignItems: 'flex-start',
                                                }}>
                                                    <MessageOutlined style={{ color: statusConf?.color ?? t.textMuted, marginTop: 2, flexShrink: 0, fontSize: 14 }} />
                                                    <div>
                                                        <Text style={{ color: statusConf?.color ?? t.textMuted, fontSize: 11, fontWeight: 700, display: 'block' }}>
                                                            {r.status === 'Approved' ? 'Supervisor approved' : 'Supervisor feedback'}
                                                        </Text>
                                                        <Text style={{ color: t.text, fontSize: 13 }}>{r.reviewNote}</Text>
                                                    </div>
                                                </div>
                                            )}

                                            {/* General notes (if any) */}
                                            {r.notes && (
                                                <div style={{ padding: '8px 18px', borderBottom: `1px solid ${t.border}` }}>
                                                    <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Notes: </Text>
                                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{r.notes}</Text>
                                                </div>
                                            )}

                                            {/* Actions */}
                                            <div style={{ padding: '12px 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
                                                {r.status !== 'Approved' ? (
                                                    <Button
                                                        type="primary"
                                                        icon={r.status === 'Needs Revision' ? <RedoOutlined /> : <EditOutlined />}
                                                        onClick={() => openSubmit(r)}
                                                        style={r.status === 'Needs Revision'
                                                            ? { background: t.orange, borderColor: t.orange }
                                                            : { background: t.accent, borderColor: t.accent }
                                                        }
                                                    >
                                                        {r.status === 'Needs Revision' ? 'Fix & Resubmit' : 'Edit & Resubmit'}
                                                    </Button>
                                                ) : (
                                                    <Tag icon={<CheckCircleOutlined />} style={{ padding: '4px 12px', fontSize: 13, color: t.success, background: `${alpha(t.success, 0.09)}`, border: `1px solid ${alpha(t.success, 0.33)}` }}>
                                                        Approved — no changes needed
                                                    </Tag>
                                                )}
                                            </div>
                                        </Card>
                                    </Col>
                                </Row>
                                );
                            })()}

                    {/* ── Report History ──────────────────────────────────────────── */}
                    {myReports.length > 0 && (
                        <>
                            <Divider style={{ borderColor: t.border, margin: '32px 0 16px' }} />
                            <Title level={5} style={{ color: t.text, marginBottom: 12 }}>
                                <ClockCircleOutlined style={{ marginRight: 8, color: t.textMuted }} />Report History
                            </Title>
                            <Table
                                dataSource={[...myReports].sort((a, b) => b.weekStart.localeCompare(a.weekStart))}
                                rowKey="id"
                                pagination={false}
                                size="small"
                                style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.border}` }}
                                onRow={(r: Report) => ({ style: { background: t.surface, cursor: 'pointer' }, onClick: () => setViewReport(r) })}
                                columns={[
                                    {
                                        title: 'Week',
                                        dataIndex: 'weekStart',
                                        key: 'weekStart',
                                        render: (w: string) => <Text style={{ color: t.text, fontWeight: 600 }}>{w}</Text>,
                                    },
                                    {
                                        title: 'Hours',
                                        key: 'hours',
                                        render: (_: any, r: Report) => {
                                            const rL = getUserLimits(resolveReportCap(r, myCapHours));
                                            const over = Number(r.totalHours) > rL.maxH;
                                            return <Text style={{ color: over ? t.danger : t.text }}>{Number(r.totalHours)}h</Text>;
                                        },
                                    },
                                    {
                                        title: 'Remote',
                                        key: 'remote',
                                        render: (_: any, r: Report) => <Text style={{ color: t.textMuted }}>{Number(r.remoteHours ?? 0)}h</Text>,
                                    },
                                    {
                                        title: 'Status',
                                        dataIndex: 'status',
                                        key: 'status',
                                        render: (s: string) => {
                                            const cfg = getReportStatusConfig(t)[s];
                                            return <Tag style={{ color: cfg?.color ?? t.textMuted, background: `${alpha(cfg?.color ?? t.textMuted, 0.09)}`, borderColor: `${alpha(cfg?.color ?? t.textMuted, 0.27)}` }}>{cfg?.label ?? s}</Tag>;
                                        },
                                    },
                                    {
                                        title: 'Submitted',
                                        dataIndex: 'submittedAt',
                                        key: 'submittedAt',
                                        render: (d: string) => d ? <Text style={{ color: t.textMuted, fontSize: 12 }}>{new Date(d).toLocaleDateString()}</Text> : <Text style={{ color: t.textMuted, fontSize: 12 }}>—</Text>,
                                    },
                                    {
                                        title: '',
                                        key: 'action',
                                        render: (_: any, r: Report) => (
                                            <Button size="small" type="text" icon={<EyeOutlined />}
                                                onClick={e => { e.stopPropagation(); setViewReport(r); }}
                                                style={{ color: t.accent }} />
                                        ),
                                    },
                                ]}
                            />
                        </>
                    )}
                </>
            )}

            {/* ── View Report Modal ─────────────────────── */}
            <ReportViewModal
                report={viewReport}
                onClose={() => setViewReport(null)}
                onExportPdf={handleExportSinglePdf}
                exportLoading={viewPdfLoading}
                canReview={canManage}
                onApprove={canManage ? (rep) => { setViewReport(null); openReview(rep, 'approve'); } : undefined}
                onReject={canManage ? (rep) => { setViewReport(null); openReview(rep, 'reject'); } : undefined}
            />

            {/* ── Reviewer Edit Report Modal ────────────── */}
            <Modal
                open={!!editReport}
                title={<Text style={{ color: t.text }}>✏️ Edit Report — {editReport?.user?.fullName}</Text>}
                onCancel={() => setEditReport(null)}
                onOk={handleAdminEditSave}
                confirmLoading={editLoading}
                okText="Save Changes"
                width={780}
                okButtonProps={{ style: { background: t.accent, border: 'none' } }}
                styles={{
                    body: { background: t.bg, maxHeight: '72vh', overflowY: 'auto', padding: '16px 24px' },
                    header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                    footer: { background: t.surface, borderTop: `1px solid ${t.border}` },
                }}
            >
                {/* — Week date — */}
                <div style={{ marginBottom: 20 }}>
                    <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Report Week</Text>
                    <DatePicker
                        picker="week"
                        locale={dayjsPickerLocale}
                        value={editWeekStart ? dayjs(editWeekStart) : undefined}
                        onChange={d => { if (d) setEditWeekStart(mondayOfWeek(d)); }}
                        format={d => `Week of ${mondayOfWeek(d)}`}
                        style={{ width: 280 }}
                        allowClear={false}
                    />
                    <Text style={{ color: t.textMuted, fontSize: 11, marginLeft: 10 }}>
                        Currently: <strong style={{ color: t.text }}>{editReport?.weekStart}</strong>
                    </Text>
                </div>

                {/* — Task entries — */}
                <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 8 }}>
                    Task Entries <Tag style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, color: t.textMuted }}>{editEntries.length}</Tag>
                </Text>
                {editEntries.map((entry, idx) => (
                    <div key={idx} style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 8, padding: 14, marginBottom: 10 }}>
                        <Row gutter={[10, 10]} align="top">
                            <Col span={1}>
                                <div style={{ width: 22, height: 22, borderRadius: '50%', marginTop: 4, background: t.surface, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: 11, fontWeight: 700 }}>{idx + 1}</div>
                            </Col>
                            <Col span={11}>
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>Task Name</Text>
                                <Input
                                    value={entry.taskTitle}
                                    onChange={e => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], taskTitle: e.target.value }; return n; })}
                                    style={{ marginTop: 3 }}
                                />
                            </Col>
                            <Col span={5}>
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>Status</Text>
                                <Select
                                    value={entry.status}
                                    onChange={v => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], status: v }; return n; })}
                                    style={{ width: '100%', marginTop: 3 }}
                                    options={TASK_STATUSES.map(s => ({ label: <span style={{ color: getStatusColor(t)[s] }}>{s}</span>, value: s }))}
                                />
                            </Col>
                            <Col span={4}>
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>Hours</Text>
                                <InputNumber
                                    min={0} max={getUserLimits(editReport?.user?.weeklyHoursCap).maxH} step={0.5}
                                    value={entry.hours}
                                    onChange={v => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], hours: v ?? 0 }; return n; })}
                                    addonAfter="h"
                                    style={{ width: '100%', marginTop: 3 }}
                                />
                            </Col>
                            <Col span={3} style={{ textAlign: 'center', paddingTop: 14 }}>
                                <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Remote</Text>
                                <Switch
                                    size="small"
                                    checked={entry.isRemote}
                                    onChange={v => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], isRemote: v }; return n; })}
                                    checkedChildren={<HomeOutlined />}
                                    unCheckedChildren={<LaptopOutlined />}
                                    style={entry.isRemote ? { background: t.purple } : undefined}
                                />
                            </Col>
                            <Col span={24} offset={1} style={{ paddingLeft: 0 }}>
                                <Row gutter={10}>
                                    <Col span={12}>
                                        <Text style={{ color: t.textMuted, fontSize: 11 }}>Progress Notes</Text>
                                        <Input.TextArea
                                            rows={2}
                                            value={entry.progressNotes}
                                            onChange={e => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], progressNotes: e.target.value }; return n; })}
                                            style={{ marginTop: 3, resize: 'none' }}
                                        />
                                    </Col>
                                    <Col span={12}>
                                        <Text style={{ color: t.textMuted, fontSize: 11 }}>Still Needed</Text>
                                        <Input.TextArea
                                            rows={2}
                                            value={entry.remainingNotes}
                                            onChange={e => setEditEntries(prev => { const n = [...prev]; n[idx] = { ...n[idx], remainingNotes: e.target.value }; return n; })}
                                            style={{ marginTop: 3, resize: 'none' }}
                                        />
                                    </Col>
                                </Row>
                            </Col>
                        </Row>
                    </div>
                ))}

                {/* — General notes — */}
                <div style={{ marginTop: 4 }}>
                    <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>General Notes</Text>
                    <Input.TextArea
                        rows={3}
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        placeholder="Optional general notes for this report…"
                        style={{ resize: 'none' }}
                    />
                </div>

                {/* — Private manager comment — */}
                <div style={{ marginTop: 16, padding: '12px 14px', background: `${alpha(t.purple, 0.03)}`, borderRadius: 8, border: `1px solid ${alpha(t.purple, 0.2)}` }}>
                    <Text style={{ color: t.purple, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                        <LockOutlined style={{ marginRight: 6 }} />Private Manager Comment
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginBottom: 6 }}>
                        Only visible to reviewers — never shown to the employee.
                    </Text>
                    <Input.TextArea
                        rows={3}
                        value={editManagerComment}
                        onChange={e => setEditManagerComment(e.target.value)}
                        placeholder="Private performance note on this employee…"
                        style={{ resize: 'none', background: t.bg, borderColor: `${alpha(t.purple, 0.27)}`, color: t.text }}
                    />
                </div>

                {/* — Live hours summary — */}
                {(() => {
                    const tot = editEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
                    const rem = editEntries.reduce((s, e) => s + (e.isRemote ? Number(e.hours) || 0 : 0), 0);
                    const editLimits = getUserLimits(editReport?.user?.weeklyHoursCap);
                    const overT = tot > editLimits.maxH;
                    const overR = rem > editLimits.maxR;
                    return (
                        <div style={{ marginTop: 16, padding: '10px 14px', background: t.surface, borderRadius: 8, border: `1px solid ${overT || overR ? t.danger : t.border}` }}>
                            <Row gutter={16}>
                                <Col span={8}><Text style={{ color: t.textMuted, fontSize: 12 }}>Total: </Text><Text style={{ color: overT ? t.danger : t.success, fontWeight: 700 }}>{tot}h / {editLimits.maxH}h</Text></Col>
                                <Col span={8}><Text style={{ color: t.textMuted, fontSize: 12 }}>Remote: </Text><Text style={{ color: overR ? t.danger : t.purple, fontWeight: 700 }}>{rem}h / {editLimits.maxR}h</Text></Col>
                                <Col span={8}><Text style={{ color: t.textMuted, fontSize: 12 }}>On-site: </Text><Text style={{ color: t.accent, fontWeight: 700 }}>{Math.max(0, +(tot - rem).toFixed(1))}h</Text></Col>
                            </Row>
                        </div>
                    );
                })()}
            </Modal>

            {/* ── Submit / Edit Modal ──────────────────── */}
            <Modal
                open={submitOpen}
                title={
                    <Text style={{ color: t.text }}>
                        {myReports.find(r => r.weekStart === reportWeek && r.status === 'Needs Revision')
                            ? '🔁 Resubmit Revised Report'
                            : myReports.find(r => r.weekStart === reportWeek && r.status === 'Submitted')
                                ? '✏️ Edit & Resubmit Report'
                                : 'Submit Weekly Report'}
                    </Text>
                }
                onCancel={() => setSubmitOpen(false)}
                onOk={handleSubmit}
                confirmLoading={submitLoading}
                okText={
                    myReports.find(r => r.weekStart === reportWeek && (r.status === 'Needs Revision' || r.status === 'Submitted'))
                        ? 'Resubmit' : 'Submit Report'
                }
                width={780}
                okButtonProps={{ style: { background: t.accent, border: 'none' }, disabled: overTotal || (overRemote && !myRemoteWorkRestricted) || (myRemoteWorkRestricted && remoteHours > 0) }}
                styles={{
                    body: { background: t.bg, maxHeight: '72vh', overflowY: 'auto', padding: '16px 24px' },
                    header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                    footer: { background: t.surface, borderTop: `1px solid ${t.border}` },
                }}
            >
                <Row gutter={16} style={{ marginBottom: 20 }}>
                    <Col span={12}>
                        <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Week Starting</Text>
                        <DatePicker
                            picker="week"
                            locale={dayjsPickerLocale}
                            value={dayjs(reportWeek)}
                            onChange={d => { if (d) setReportWeek(mondayOfWeek(d)); }}
                            disabledDate={d => d.utc().isoWeekday(1).isAfter(dayjs().utc().isoWeekday(1), 'day')}
                            format={d => `Week of ${mondayOfWeek(d)}`}
                            style={{ width: '100%' }}
                            allowClear={false}
                        />
                    </Col>
                    <Col span={12}>
                        <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>Hour Summary</Text>
                        <div style={{ padding: '10px 12px', background: t.surface, borderRadius: 8, border: `1px solid ${t.border}` }}>
                            <HourBar used={totalHours} max={myLimits.maxH} label={`Total hours (max ${myLimits.maxH}h)`} color={t.success} />
                            {!myRemoteWorkRestricted && (
                                <HourBar used={remoteHours} max={myLimits.maxR} label={`Remote (max ${myLimits.maxR}h = 20%)`} color={t.purple} />
                            )}
                            {myRemoteWorkRestricted && (
                                <div style={{ marginTop: 6, padding: '6px 10px', background: `${alpha(t.danger, 0.08)}`, border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 6 }}>
                                    <Text style={{ color: t.danger, fontSize: 11 }}>
                                        🚫 Remote work restricted — all hours must be on-site
                                    </Text>
                                </div>
                            )}
                            {/* The authoritative ceiling, from verified attendance. */}
                            <ReportableBalance weekStart={reportWeek} enteredHours={totalHours} t={t} />
                        </div>
                    </Col>
                </Row>

                <div style={{ marginBottom: 12 }}>
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Task Entries</Text>
                    <Text style={{ color: t.textMuted, fontSize: 12, marginLeft: 8 }}>{entries.length} task{entries.length !== 1 ? 's' : ''}</Text>
                </div>

                {entries.map((entry, i) => (
                    <TaskEntryRow
                        key={i}
                        entry={entry}
                        index={i}
                        assignedTasks={assignedTasks}
                        onChange={updateEntry}
                        onRemove={removeEntry}
                        canRemove={entries.length > 1}
                        maxHours={myLimits.maxH}
                        remoteWorkRestricted={myRemoteWorkRestricted}
                    />
                ))}

                <Button
                    type="dashed"
                    icon={<PlusOutlined />}
                    onClick={addEntry}
                    style={{ width: '100%', borderColor: t.border, color: t.textMuted, marginBottom: 20 }}
                >
                    Add Another Task
                </Button>

                <Text style={{ color: t.textMuted, fontWeight: 600, display: 'block', marginBottom: 6 }}>General Notes (optional)</Text>
                <TextArea
                    rows={3}
                    placeholder="Anything else your supervisor should know this week…"
                    value={generalNotes}
                    onChange={e => setGeneralNotes(e.target.value)}
                    style={{ resize: 'none' }}
                />

                {(overTotal || overRemote) && (
                    <Alert
                        type="error"
                        style={{ marginTop: 16 }}
                        message={
                            <span>
                                {overTotal ? `Total hours (${totalHours}h) exceed the ${myLimits.maxH}h weekly limit. ` : ''}
                                {overRemote ? `Remote hours (${remoteHours}h) exceed ${myLimits.maxR}h (20% of ${myLimits.maxH}h).` : ''}
                            </span>
                        }
                    />
                )}
            </Modal>

            {/* ── Review Modal (supervisor) ─────────────────── */}
            <Modal
                open={reviewOpen}
                title={
                    <Text style={{ color: t.text }}>
                        {reviewMode === 'approve' ? '✅ Approve Report' : '🔁 Request Revision'}
                    </Text>
                }
                onCancel={() => setReviewOpen(false)}
                onOk={handleReview}
                confirmLoading={reviewLoading}
                okText={reviewMode === 'approve' ? 'Approve' : 'Send Back'}
                okButtonProps={{
                    style: { background: reviewMode === 'approve' ? t.success : t.orange, border: 'none' },
                }}
                width={480}
                styles={{
                    body: { background: t.surface, padding: '16px 24px' },
                    header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                    footer: { background: t.surface, borderTop: `1px solid ${t.border}` },
                }}
            >
                {reviewTarget && (
                    <div>
                        <div style={{ marginBottom: 14, padding: '10px 14px', background: t.surfaceRaised, borderRadius: 8, border: `1px solid ${t.border}` }}>
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>Report by</Text>
                            <Text style={{ color: t.text, fontWeight: 700, display: 'block', fontSize: 14 }}>{reviewTarget.user?.fullName ?? 'Unknown'}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Week of {reviewTarget.weekStart} &bull; {reviewTarget.totalHours}h logged</Text>
                        </div>
                        <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                            {reviewMode === 'approve' ? 'Optional note to employee' : 'Reason for revision (required)'}
                        </Text>
                        <TextArea
                            rows={3}
                            placeholder={reviewMode === 'approve'
                                ? 'Great work this week! (optional)'
                                : 'Please correct the hours for Task X and resubmit…'}
                            value={reviewNoteInput}
                            onChange={e => setReviewNoteInput(e.target.value)}
                            style={{ resize: 'none', background: t.bg, borderColor: t.border, color: t.text }}
                        />
                        {reviewMode === 'reject' && (
                            <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 6, display: 'block' }}>
                                The employee will be notified and can resubmit a corrected report.
                            </Text>
                        )}

                        {/* Auto labor deduction — only shown when approving */}
                        {reviewMode === 'approve' && (
                            <div style={{ marginTop: 14 }}>
                                <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                                    Auto Labor Deduction (optional)
                                </Text>
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder={
                                        laborAccounts.length === 0
                                            ? 'No Labor accounts configured'
                                            : 'Select a Labor account to auto-deduct…'
                                    }
                                    style={{ width: '100%' }}
                                    value={laborAccountId}
                                    onChange={(v) => setLaborAccountId(v)}
                                    options={laborAccounts.map(a => ({
                                        value: a.id,
                                        label: `${a.name}  ($${Number(a.balance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })} available)`,
                                    }))}
                                />
                                <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 4, display: 'block' }}>
                                    {laborAccountId
                                        ? `Hours × hourly rate will be automatically deducted from this account.`
                                        : 'Skip to approve without deducting. You can deduct manually from the Budget tab.'}
                                </Text>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* ── Private Manager Comment Modal ─────────── */}
            <Modal
                open={commentModalOpen}
                title={
                    <Space>
                        <LockOutlined style={{ color: t.purple }} />
                        <Text style={{ color: t.text }}>Private Manager Comment</Text>
                    </Space>
                }
                onCancel={() => setCommentModalOpen(false)}
                onOk={async () => {
                    if (!commentTarget) return;
                    setCommentSaving(true);
                    await handleSaveManagerComment(commentTarget, commentValue);
                    setCommentSaving(false);
                    setCommentModalOpen(false);
                }}
                confirmLoading={commentSaving}
                okText="Save Comment"
                okButtonProps={{ style: { background: t.purple, border: 'none' } }}
                width={520}
                styles={{
                    body: { background: t.surface, padding: '16px 24px' },
                    header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                    footer: { background: t.surface, borderTop: `1px solid ${t.border}` },
                }}
            >
                {commentTarget && (
                    <div>
                        <div style={{ marginBottom: 14, padding: '10px 14px', background: t.surfaceRaised, borderRadius: 8, border: `1px solid ${t.border}` }}>
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>Report by</Text>
                            <Text style={{ color: t.text, fontWeight: 700, display: 'block', fontSize: 14 }}>{commentTarget.user?.fullName ?? 'Unknown'}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Week of {commentTarget.weekStart} &bull; {commentTarget.totalHours}h logged</Text>
                        </div>
                        <Text style={{ color: t.purple, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                            <LockOutlined style={{ marginRight: 4 }} />
                            This comment is private — only visible to reviewers and included in exported PDFs. Employees will never see it.
                        </Text>
                        <Input.TextArea
                            rows={4}
                            placeholder="Private performance note on this employee's report…"
                            value={commentValue}
                            onChange={e => setCommentValue(e.target.value)}
                            style={{ resize: 'none', background: t.bg, borderColor: t.border, color: t.text }}
                        />
                    </div>
                )}
            </Modal>
        </div>
    );
}