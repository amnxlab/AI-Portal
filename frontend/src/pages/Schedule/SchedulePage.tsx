import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import html2canvas from 'html2canvas';
import {
    Button, Modal, TimePicker, Select, Input, Typography, Alert, Spin,
    Tag, DatePicker, Space, message, Tooltip, Empty, Popconfirm,
} from 'antd';
import {
    PlusOutlined, SendOutlined, ClockCircleOutlined, CalendarOutlined,
    TeamOutlined, UserOutlined, EditOutlined, DeleteOutlined, CopyOutlined,
    ScheduleOutlined, ThunderboltOutlined, EyeOutlined,
    RiseOutlined, LeftOutlined, RightOutlined,
    CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';
import dayjsPickerLocale from 'antd/es/date-picker/locale/en_GB';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import UserAvatar from '../../components/UserAvatar';
import { FormModal } from '../../components/ui';
import { alpha } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

dayjs.extend(isoWeek);

const { Title, Text } = Typography;

// ── GitHub-inspired dark palette ────────────────────────────

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const DAY_SHORT: Record<string, string> = {
    Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
    Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const DAY_ABBR: Record<string, string> = {
    Monday: 'M', Tuesday: 'T', Wednesday: 'W', Thursday: 'T',
    Friday: 'F', Saturday: 'S', Sunday: 'S',
};

function mondayOfWeek(d: dayjs.Dayjs): string {
    return d.isoWeekday(1).startOf('day').format('YYYY-MM-DD');
}

function defaultSubmitWeek(): string {
    const today = dayjs();
    const dow = today.day(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    // From Friday onwards, default to next week so employees are prompted to
    // plan ahead — but the current week remains selectable via disabledPastWeeks.
    if (dow === 5 || dow === 6 || dow === 0) {
        return today.isoWeekday(1).add(1, 'week').startOf('day').format('YYYY-MM-DD');
    }
    return mondayOfWeek(today);
}

function disabledPastWeeks(d: dayjs.Dayjs): boolean {
    // Always use the CURRENT week's Monday as the lower bound so employees can
    // still pick the current week even on Fri/Sat/Sun after the default shifts
    // to next week.
    const ref = dayjs(mondayOfWeek(dayjs()));
    return d.isBefore(ref, 'day');
}

/** Convert "HH:MM" to fractional hours */
function timeToHours(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return h + m / 60;
}

/** format duration */
function fmtDur(hrs: number): string {
    const h = Math.floor(hrs);
    const m = Math.round((hrs - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface Shift {
    day: string;
    start: string;
    end: string;
    note?: string;
    /** Set when an administrator put this day here by assigning a shift. */
    source?: 'shift';
    shiftId?: string;
}

interface Schedule {
    id: string;
    userId: string;
    weekStart: string;
    shifts: Shift[];
    notes?: string | null;
    user?: { fullName: string; avatarUrl?: string | null };
    discordPosted: boolean;
    status?: string;
    reviewNote?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
}

type DayEntry = {
    name: string;
    color: string;
    shift: Shift;
    avatarUrl?: string | null;
    userId?: string;
    durationHrs: number;
};

/* ═══════════════════════════════ component ══════════════════════════════ */
export default function SchedulePage() {
    const { t } = useTheme();
    const user       = useAuthStore((s) => s.user);
    const canViewAll = user?.permissions?.view_all_schedules === true;
    const canManage  = user?.permissions?.manage_schedules === true;

    const [schedules,    setSchedules]    = useState<Schedule[]>([]);
    const [mySchedules,  setMySchedules]  = useState<Schedule[]>([]);
    const [selectedWeek, setSelectedWeek] = useState<string>(() => mondayOfWeek(dayjs()));
    const [loading,      setLoading]      = useState(false);
    const [error,        setError]        = useState<string | null>(null);

    // submit modal
    const [submitOpen,      setSubmitOpen]      = useState(false);
    const [submitLoading,   setSubmitLoading]   = useState(false);
    const [submitWeek,      setSubmitWeek]      = useState<string>(() => defaultSubmitWeek());
    const [shifts,          setShifts]          = useState<Shift[]>([{ day: 'Monday', start: '09:00', end: '17:00' }]);
    const [scheduleNotes,   setScheduleNotes]   = useState<string>('');
    const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

    // discord
    const [discordLoading, setDiscordLoading] = useState(false);
    const calendarRef = useRef<HTMLDivElement>(null);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const [myRes, teamRes] = await Promise.all([
                api.get('/schedules/mine'),
                canViewAll ? api.get(`/schedules?week=${selectedWeek}`) : Promise.resolve({ data: [] }),
            ]);
            setMySchedules(myRes.data);
            setSchedules(teamRes.data);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to load schedules';
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [selectedWeek, canViewAll]);

    useEffect(() => { load(); }, [load]);

    /* ── submit ─────────────────────────────────────────────────────── */
    const openSubmit = (schedule?: Schedule) => {
        if (schedule) {
            setEditingSchedule(schedule);
            setSubmitWeek(schedule.weekStart);
            setShifts(schedule.shifts.map((s) => ({ ...s })));
            setScheduleNotes(schedule.notes ?? '');
        } else {
            setEditingSchedule(null);
            setSubmitWeek(defaultSubmitWeek());
            setShifts([{ day: 'Monday', start: '09:00', end: '17:00' }]);
            setScheduleNotes('');
        }
        setSubmitOpen(true);
    };

    const handleSubmit = async () => {
        if (!shifts.length) { message.warning('Add at least one shift'); return; }
        const invalid = shifts.find((s) => !s.start || !s.end);
        if (invalid) {
            message.error(`Shift on ${invalid.day} has an empty start or end time — please fill it in.`);
            return;
        }
        setSubmitLoading(true);
        try {
            await api.post('/schedules', {
                weekStart: submitWeek,
                shifts,
                notes: scheduleNotes || undefined,
            });
            message.success('Schedule submitted!');
            setSubmitOpen(false);
            if (submitWeek !== selectedWeek) setSelectedWeek(submitWeek);
            else load();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to submit';
            message.error(msg);
        } finally {
            setSubmitLoading(false);
        }
    };

    /* ── copy previous week ─────────────────────────────────────────── */
    const handleCopyLastWeek = () => {
        const targetWeek = defaultSubmitWeek();
        // Compute "last week" relative to the week being submitted — not relative to
        // today. This matters when the default shifts to next week (on Fri/Sat/Sun):
        // users expect to copy from the current week, not from two weeks ago.
        const prevMonday = dayjs(targetWeek).subtract(1, 'week').format('YYYY-MM-DD');
        const prevSchedule = mySchedules.find((s) => s.weekStart === prevMonday);
        if (!prevSchedule || prevSchedule.shifts.length === 0) {
            message.info(`No schedule found for the previous week (${prevMonday}). Submit one first.`);
            return;
        }
        setEditingSchedule(null);
        setSubmitWeek(targetWeek);
        setShifts(prevSchedule.shifts.map((s) => ({ ...s })));
        setScheduleNotes(prevSchedule.notes ?? '');
        setSubmitOpen(true);
        message.success(`Copied ${prevSchedule.shifts.length} shift(s) from week of ${prevMonday}`);
    };

    /* ── discord ─────────────────────────────────────────────────────── */
    const handlePostDiscord = async () => {
        if (!calendarRef.current || totalShifts === 0) {
            message.warning('No schedules to post for this week');
            return;
        }
        setDiscordLoading(true);
        try {
            const canvas = await html2canvas(calendarRef.current, {
                scale: 2,
                backgroundColor: t.bg,
                useCORS: true,
                logging: false,
            });
            const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png')
            );
            const formData = new FormData();
            formData.append('image', blob, `schedule-${selectedWeek}.png`);
            const res = await api.post(
                `/schedules/post-discord-image/${selectedWeek}`,
                formData,
                { headers: { 'Content-Type': 'multipart/form-data' } },
            );
            message.success(res.data.message ?? 'Schedule posted to Discord!');
            // Optimistically mark all currently-approved schedules as discordPosted so the
            // Posted tag appears immediately without waiting for load() to settle.
            setSchedules((prev) => prev.map((s) => s.status === 'Approved' ? { ...s, discordPosted: true } : s));
            load();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to post to Discord';
            message.error(msg);
        } finally {
            setDiscordLoading(false);
        }
    };

    /* ── delete schedule (manager) ──────────────────────────────────── */
    const handleDeleteSchedule = async (id: string) => {
        try {
            await api.delete(`/schedules/${id}`);
            message.success('Schedule deleted');
            load();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to delete schedule';
            message.error(msg);
        }
    };

    /* ── shift helpers ───────────────────────────────────────────────── */
    const addShift    = () => setShifts((prev) => [...prev, { day: 'Monday', start: '09:00', end: '17:00' }]);
    const removeShift = (i: number) => setShifts((prev) => prev.filter((_, idx) => idx !== i));
    const updateShift = (i: number, field: keyof Shift, value: string) => {
        setShifts((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s));
    };

    /* ── computed data ───────────────────────────────────────────────── */
    const weekBase = dayjs(selectedWeek);

    const sourceSchedules = canViewAll ? schedules
        : mySchedules.filter((s) => s.weekStart === selectedWeek);

    // Timeline only shows approved schedules
    const timelineSchedules = sourceSchedules.filter((s) => s.status === 'Approved');

    const memberColors: Record<string, string> = {};
    let colorIdx = 0;
    for (const s of sourceSchedules) {
        const name = s.user?.fullName ?? s.userId;
        if (!memberColors[name]) {
            memberColors[name] = t.chart[colorIdx % t.chart.length];
            colorIdx++;
        }
    }

    const dayData: Record<string, DayEntry[]> = {};
    for (const day of WEEKDAYS) dayData[day] = [];

    for (const sched of timelineSchedules) {
        const name  = sched.user?.fullName ?? (canViewAll ? sched.userId : 'My Shift');
        const color = memberColors[name] ?? t.accent;
        const avatarUrl = sched.user?.avatarUrl ?? null;
        for (const shift of sched.shifts) {
            if (dayData[shift.day]) {
                const dur = timeToHours(shift.end) - timeToHours(shift.start);
                dayData[shift.day].push({ name, color, shift, avatarUrl, userId: sched.userId, durationHrs: dur > 0 ? dur : 0 });
            }
        }
    }

    // Sort every day's entries by start time
    for (const day of WEEKDAYS) {
        dayData[day].sort((a, b) => timeToHours(a.shift.start) - timeToHours(b.shift.start));
    }

    const totalShifts = Object.values(dayData).flat().length;

    // ── summary stats ──────────────────────────────────────────────
    const stats = useMemo(() => {
        const allEntries = Object.values(dayData).flat();
        const totalHours = allEntries.reduce((s, e) => s + e.durationHrs, 0);
        const memberCount = Object.keys(memberColors).length;
        const peakDay = WEEKDAYS.reduce((best, day) =>
            dayData[day].length > dayData[best].length ? day : best, WEEKDAYS[0]);
        const peakDayCount = dayData[peakDay].length;

        // Earliest shift start, latest shift end
        let earliest = 24;
        let latest = 0;
        for (const e of allEntries) {
            const s = timeToHours(e.shift.start);
            const en = timeToHours(e.shift.end);
            if (s < earliest) earliest = s;
            if (en > latest) latest = en;
        }
        return { totalHours, memberCount, peakDay, peakDayCount, earliest, latest, totalShifts: allEntries.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceSchedules, selectedWeek]);

    // Current time
    const now = dayjs();

    /* ── week navigation ─────────────────────────────────────────────── */
    const goPrevWeek = () => setSelectedWeek(dayjs(selectedWeek).subtract(7, 'day').format('YYYY-MM-DD'));
    const goNextWeek = () => setSelectedWeek(dayjs(selectedWeek).add(7, 'day').format('YYYY-MM-DD'));
    const goThisWeek = () => setSelectedWeek(mondayOfWeek(dayjs()));

    const isThisWeek = selectedWeek === mondayOfWeek(dayjs());

    /* ── status helpers ──────────────────────────────────────────────── */
    function getStatusConfig(t: SemanticTokens): Record<string, { color: string; icon: React.ReactNode; label: string }> {
    return {
        Submitted: { color: t.accent, icon: <ClockCircleOutlined />, label: 'Submitted for Review' },
        Approved: { color: t.success, icon: <CheckCircleOutlined />, label: 'Approved' },
        Denied: { color: t.danger, icon: <CloseCircleOutlined />, label: 'Denied' },
        'Needs Revision': { color: t.warning, icon: <ExclamationCircleOutlined />, label: 'Needs Revision' },
    };
}

    const StatusBadge = ({ status }: { status?: string }) => {
    const { t } = useTheme();
        const cfg = getStatusConfig(t)[status ?? 'Submitted'] ?? getStatusConfig(t).Submitted;
        return (
            <Tag style={{
                background: `${alpha(cfg.color, 0.09)}`, color: cfg.color,
                border: `1px solid ${alpha(cfg.color, 0.27)}`, borderRadius: 8, fontSize: 11,
            }}>
                {cfg.icon} <span style={{ marginLeft: 4 }}>{cfg.label}</span>
            </Tag>
        );
    };

    /* ── review handler ──────────────────────────────────────────────── */
    const [reviewLoading, setReviewLoading] = useState<string | null>(null);

    const handleReview = async (scheduleId: string, action: 'approve' | 'deny' | 'revision', note?: string) => {
        setReviewLoading(scheduleId);
        try {
            await api.patch(`/schedules/${scheduleId}/review`, { action, note });
            message.success(action === 'approve' ? 'Schedule approved' : action === 'deny' ? 'Schedule denied' : 'Revision requested');
            // Optimistically update the schedule status so the UI is consistent before load() resolves.
            // This prevents a race condition where load() from a previous action could overwrite
            // a subsequent discord-post load() with stale discordPosted:false data.
            const optimisticStatus = { approve: 'Approved', deny: 'Denied', revision: 'Needs Revision' }[action];
            setSchedules((prev) => prev.map((s) => s.id === scheduleId ? { ...s, status: optimisticStatus } : s));
            load();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Review failed';
            message.error(msg);
        } finally {
            setReviewLoading(null);
        }
    };

    const [revisionNoteModal, setRevisionNoteModal] = useState<{ open: boolean; scheduleId: string; action: 'deny' | 'revision' }>({ open: false, scheduleId: '', action: 'revision' });
    const [revisionNote, setRevisionNote] = useState('');
    const [viewingSchedule, setViewingSchedule] = useState<Schedule | null>(null);

    /* ═══════════════════════════ TIMELINE VIEW ══════════════════════ */
    const TimelineView = () => (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 0,
            borderRadius: 12,
            border: `1px solid ${t.border}`,
            overflow: 'hidden',
            minWidth: 900,
        }}>
            {WEEKDAYS.map((day, idx) => {
                const date    = weekBase.add(idx, 'day');
                const isToday = date.format('YYYY-MM-DD') === now.format('YYYY-MM-DD');
                const entries = dayData[day];
                const dayHrs  = entries.reduce((s, e) => s + e.durationHrs, 0);

                return (
                    <div key={day} style={{
                        borderRight: idx < 6 ? `1px solid ${t.border}` : undefined,
                        background: isToday ? `${alpha(t.accent, 0.02)}` : (idx >= 5 ? `${alpha(t.surfaceRaised, 0.27)}` : 'transparent'),
                        display: 'flex', flexDirection: 'column',
                    }}>
                        {/* Day header */}
                        <div style={{
                            padding: '12px 14px 10px',
                            borderBottom: `1px solid ${t.border}`,
                            background: isToday
                                ? `linear-gradient(135deg, ${alpha(t.accent, 0.08)}, ${alpha(t.purple, 0.03)})`
                                : t.surface,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Text strong style={{
                                        color: isToday ? t.accent : t.text,
                                        fontSize: 15,
                                    }}>
                                        {DAY_SHORT[day]}
                                    </Text>
                                    <Text style={{
                                        color: isToday ? t.accent : t.textMuted,
                                        fontSize: 12,
                                    }}>
                                        {date.format('D')}
                                    </Text>
                                    {isToday && (
                                        <div style={{
                                            width: 6, height: 6, borderRadius: '50%', background: t.accent,
                                            boxShadow: `0 0 6px ${alpha(t.accent, 0.53)}`,
                                        }} />
                                    )}
                                </div>
                                {entries.length > 0 && (
                                    <Text style={{ color: t.textFaint, fontSize: 10 }}>
                                        {entries.length} · {fmtDur(dayHrs)}
                                    </Text>
                                )}
                            </div>
                        </div>

                        {/* Shift list */}
                        <div style={{ padding: '8px 6px 10px', flex: 1, minHeight: 80 }}>
                            {entries.length === 0 ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 60 }}>
                                    <Text style={{ color: t.border, fontSize: 11 }}>—</Text>
                                </div>
                            ) : (
                                entries.map((entry, ei) => (
                                    <div
                                        key={ei}
                                        style={{
                                            display: 'flex', alignItems: 'stretch', gap: 0,
                                            marginBottom: ei < entries.length - 1 ? 6 : 0,
                                            borderRadius: 8, overflow: 'hidden',
                                            background: `${alpha(entry.color, 0.04)}`,
                                            border: `1px solid ${alpha(entry.color, 0.16)}`,
                                            transition: 'border-color 0.15s, background 0.15s',
                                            cursor: 'default',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = entry.color + '55';
                                            e.currentTarget.style.background = entry.color + '14';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = entry.color + '28';
                                            e.currentTarget.style.background = entry.color + '0a';
                                        }}
                                    >
                                        {/* Color accent bar */}
                                        <div style={{ width: 4, flexShrink: 0, background: entry.color, borderRadius: '8px 0 0 8px' }} />

                                        {/* Card content */}
                                        <div style={{ padding: '8px 10px', flex: 1, minWidth: 0 }}>
                                            {/* Name row */}
                                            {canViewAll && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                                                    <UserAvatar name={entry.name} avatarUrl={entry.avatarUrl} size={18} color={entry.color} bg={entry.color + '33'} userId={entry.userId} />
                                                    <Text style={{
                                                        color: entry.color, fontSize: 12, fontWeight: 600,
                                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    }}>
                                                        {entry.name}
                                                    </Text>
                                                </div>
                                            )}
                                            {/* Time row */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <ClockCircleOutlined style={{ color: t.textMuted, fontSize: 11 }} />
                                                <Text style={{ color: t.text, fontSize: 13, fontFamily: 'monospace', fontWeight: 500, letterSpacing: '-0.02em' }}>
                                                    {entry.shift.start}
                                                </Text>
                                                <Text style={{ color: t.textFaint, fontSize: 10 }}>→</Text>
                                                <Text style={{ color: t.text, fontSize: 13, fontFamily: 'monospace', fontWeight: 500, letterSpacing: '-0.02em' }}>
                                                    {entry.shift.end}
                                                </Text>
                                                <Text style={{
                                                    color: t.textMuted, fontSize: 10, marginLeft: 'auto',
                                                    background: t.surfaceRaised, padding: '1px 6px', borderRadius: 6,
                                                }}>
                                                    {fmtDur(entry.durationHrs)}
                                                </Text>
                                            </div>
                                            {/* Note */}
                                            {entry.shift.note && (
                                                <Text style={{
                                                    color: t.textMuted, fontSize: 11, display: 'block', marginTop: 4,
                                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                    fontStyle: 'italic',
                                                }}>
                                                    {entry.shift.note}
                                                </Text>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    /* ═══════════════════════════ RENDER ══════════════════════════════ */
    return (
        <div style={{ padding: '24px 28px', background: t.bg, minHeight: '100vh' }}>

            {/* ── header ─────────────────────────────────────── */}
            <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                        <Title level={3} style={{ margin: 0, color: t.text }}>
                            <ScheduleOutlined style={{ marginRight: 10, color: t.accent }} />
                            Schedule
                        </Title>
                        <Text style={{ color: t.textMuted, fontSize: 13 }}>
                            {canViewAll ? 'Team schedules' : 'My schedule'} · Week of{' '}
                            <span style={{ color: t.text, fontWeight: 600 }}>{dayjs(selectedWeek).format('MMMM D, YYYY')}</span>
                        </Text>
                    </div>

                    <Space wrap size={8}>
                        <Button icon={<CopyOutlined />} onClick={handleCopyLastWeek}>
                            Copy Last Week
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openSubmit()}>
                            Submit Schedule
                        </Button>
                        {canManage && (
                            <Button
                                icon={<SendOutlined />}
                                loading={discordLoading}
                                onClick={handlePostDiscord}
                            >
                                Post to Discord
                            </Button>
                        )}
                    </Space>
                </div>

                {/* ── week nav + view toggle row ─────────────────── */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: 16, flexWrap: 'wrap', gap: 10,
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8,
                        padding: '4px 4px',
                    }}>
                        <Button type="text" size="small" icon={<LeftOutlined />} onClick={goPrevWeek}
                            style={{ color: t.textMuted, width: 32, height: 32 }}
                        />
                        <DatePicker
                            picker="week"
                            locale={dayjsPickerLocale}
                            value={dayjs(selectedWeek)}
                            onChange={(d) => { if (d) setSelectedWeek(mondayOfWeek(d)); }}
                            allowClear={false}
                            format={(d) => `${mondayOfWeek(d)}`}
                            style={{ width: 140 }}
                        />
                        <Button type="text" size="small" icon={<RightOutlined />} onClick={goNextWeek}
                            style={{ color: t.textMuted, width: 32, height: 32 }}
                        />
                        {!isThisWeek && (
                            <Button type="link" size="small" onClick={goThisWeek}
                                style={{ color: t.accent, fontSize: 11, padding: '0 6px' }}
                            >
                                Today
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 80 }}>
                    <Spin size="large" />
                </div>
            ) : (
                <>
                    {/* ── summary stats ────────────────────────────── */}
                    {totalShifts > 0 && (
                        <div style={{
                            display: 'flex', gap: 12, marginBottom: 18, overflowX: 'auto',
                        }}>
                            {[
                                { label: 'Total Shifts', value: String(stats.totalShifts), icon: <CalendarOutlined />, color: t.accent },
                                { label: 'Total Hours', value: fmtDur(stats.totalHours), icon: <ClockCircleOutlined />, color: t.success },
                                { label: 'Team Members', value: String(stats.memberCount), icon: <TeamOutlined />, color: t.purple },
                                { label: 'Peak Day', value: `${DAY_SHORT[stats.peakDay]} (${stats.peakDayCount})`, icon: <RiseOutlined />, color: t.orange },
                            ].map(({ label, value, icon, color }) => (
                                <div key={label} style={{
                                    flex: '1 0 160px',
                                    background: t.surface,
                                    border: `1px solid ${t.border}`,
                                    borderRadius: 10, padding: '14px 16px',
                                    display: 'flex', alignItems: 'center', gap: 12,
                                }}>
                                    <div style={{
                                        width: 36, height: 36, borderRadius: 8,
                                        background: `${alpha(color, 0.08)}`, border: `1px solid ${alpha(color, 0.19)}`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 16, color,
                                    }}>
                                        {icon}
                                    </div>
                                    <div>
                                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', lineHeight: 1 }}>{label}</Text>
                                        <Text style={{ color: t.text, fontSize: 16, fontWeight: 700 }}>{value}</Text>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <div ref={calendarRef} style={{ background: t.bg, borderRadius: 8, padding: '4px 0 8px' }}>
                    {/* ── team legend ──────────────────────────── */}
                    {canViewAll && Object.keys(memberColors).length > 0 && (
                        <div style={{
                            display: 'flex', flexWrap: 'wrap', gap: 12,
                            marginBottom: 16, padding: '12px 16px',
                            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
                        }}>
                            <TeamOutlined style={{ color: t.textMuted, marginRight: 2 }} />
                            {Object.entries(memberColors).map(([name, color]) => (
                                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <div style={{
                                        width: 10, height: 10, borderRadius: '50%', background: color,
                                        boxShadow: `0 0 4px ${alpha(color, 0.33)}`,
                                    }} />
                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{name}</Text>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── main view ────────────────────────────── */}
                    {totalShifts === 0 ? (
                        <Empty
                            description={<Text style={{ color: t.textMuted }}>No schedules submitted for this week</Text>}
                            style={{ margin: '60px 0' }}
                        />
                    ) : (
                        <TimelineView />
                    )}

                    </div>{/* calendarRef */}

                    {/* ── coverage heatmap (mini) ─────────────────── */}
                    {totalShifts > 0 && (
                        <div style={{
                            marginTop: 18, padding: '14px 16px',
                            background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
                        }}>
                            <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                Daily Coverage
                            </Text>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 52 }}>
                                {WEEKDAYS.map((day, idx) => {
                                    const count = dayData[day].length;
                                    const maxCount = Math.max(...WEEKDAYS.map((d) => dayData[d].length), 1);
                                    const pct = count / maxCount;
                                    const isToday = weekBase.add(idx, 'day').format('YYYY-MM-DD') === now.format('YYYY-MM-DD');
                                    return (
                                        <Tooltip key={day} title={`${DAY_SHORT[day]}: ${count} shift${count !== 1 ? 's' : ''}`}>
                                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                                <div style={{
                                                    width: '100%', maxWidth: 48,
                                                    height: Math.max(pct * 36, count > 0 ? 6 : 2),
                                                    borderRadius: 4,
                                                    background: count > 0
                                                        ? isToday
                                                            ? `linear-gradient(180deg, ${t.accent}, ${t.purple})`
                                                            : `linear-gradient(180deg, ${alpha(t.success, 0.8)}, ${alpha(t.success, 0.27)})`
                                                        : t.surfaceRaised,
                                                    transition: 'height 0.3s ease',
                                                }} />
                                                <Text style={{
                                                    color: isToday ? t.accent : t.textMuted,
                                                    fontSize: 10, fontWeight: isToday ? 700 : 400,
                                                }}>
                                                    {DAY_ABBR[day]}
                                                </Text>
                                            </div>
                                        </Tooltip>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── manager: team submissions for selected week ── */}
                    {canManage && schedules.length > 0 && (
                        <div style={{
                            marginTop: 24, background: t.surface,
                            border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden',
                        }}>
                            <div style={{
                                padding: '12px 18px', borderBottom: `1px solid ${t.border}`,
                                display: 'flex', alignItems: 'center', gap: 8,
                                background: `${alpha(t.surfaceRaised, 0.53)}`,
                            }}>
                                <TeamOutlined style={{ color: t.accent }} />
                                <Text strong style={{ color: t.text }}>Team Submissions</Text>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>— week of {selectedWeek}</Text>
                                <Tag style={{
                                    background: `${alpha(t.accent, 0.09)}`, color: t.accent,
                                    border: 'none', borderRadius: 10, fontSize: 11, marginLeft: 4,
                                }}>
                                    {schedules.length}
                                </Tag>
                            </div>

                            {schedules.map((s, idx) => {
                                const name = s.user?.fullName ?? s.userId;
                                const color = memberColors[name] ?? t.accent;
                                const totalHrs = s.shifts.reduce((acc, sh) => {
                                    const [ssH, ssM] = sh.start.split(':').map(Number);
                                    const [seH, seM] = sh.end.split(':').map(Number);
                                    return acc + (seH * 60 + seM - ssH * 60 - ssM) / 60;
                                }, 0);
                                // Mini day heatmap per member
                                const memberDays = new Set(s.shifts.map((sh) => sh.day));
                                return (
                                    <div
                                        key={s.id}
                                        style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            alignItems: 'center', padding: '12px 18px',
                                            borderBottom: idx < schedules.length - 1 ? `1px solid ${t.border}` : undefined,
                                            transition: 'background 0.12s',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.background = t.surfaceRaised; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <UserAvatar name={name} avatarUrl={s.user?.avatarUrl} size={32} color={color} bg={color + '33'} userId={s.userId} />
                                            <div>
                                                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>{name}</Text>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                                                    {/* Mini week dots */}
                                                    <div style={{ display: 'flex', gap: 2 }}>
                                                        {WEEKDAYS.map((d) => (
                                                            <Tooltip key={d} title={DAY_SHORT[d]}>
                                                                <div style={{
                                                                    width: 12, height: 12, borderRadius: 3,
                                                                    background: memberDays.has(d) ? `${alpha(color, 0.33)}` : t.surfaceRaised,
                                                                    border: memberDays.has(d) ? `1px solid ${alpha(color, 0.53)}` : `1px solid ${t.border}`,
                                                                    fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    color: memberDays.has(d) ? color : t.textFaint,
                                                                    fontWeight: 600,
                                                                }}>
                                                                    {DAY_ABBR[d]}
                                                                </div>
                                                            </Tooltip>
                                                        ))}
                                                    </div>
                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                        {s.shifts.length} shift{s.shifts.length !== 1 ? 's' : ''}
                                                    </Text>
                                                </div>
                                            </div>
                                        </div>
                                        <Space size={6}>
                                            <StatusBadge status={s.status} />
                                            <Tag style={{
                                                background: `${alpha(t.accent, 0.13)}`, color: t.accent,
                                                border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8,
                                            }}>
                                                <ThunderboltOutlined style={{ marginRight: 3 }} />
                                                {totalHrs.toFixed(1)}h
                                            </Tag>
                                            {s.discordPosted && (
                                                <Tag style={{
                                                    background: alpha(t.accent, 0.13), color: t.accent,
                                                    border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8,
                                                }}>
                                                    Posted
                                                </Tag>
                                            )}
                                            <Tooltip title="View schedule details">
                                                <Button
                                                    size="small"
                                                    type="text"
                                                    icon={<EyeOutlined style={{ color: t.accent }} />}
                                                    onClick={() => setViewingSchedule(s)}
                                                />
                                            </Tooltip>
                                            <Button
                                                size="small" type="text"
                                                icon={<CheckCircleOutlined style={{ color: t.success }} />}
                                                loading={reviewLoading === s.id}
                                                onClick={() => handleReview(s.id, 'approve')}
                                                title="Approve"
                                                style={{ visibility: (s.status === 'Submitted' || s.status === 'Needs Revision') ? 'visible' : 'hidden' }}
                                            />
                                            <Button
                                                size="small" type="text"
                                                icon={<ExclamationCircleOutlined style={{ color: t.warning }} />}
                                                loading={reviewLoading === s.id}
                                                onClick={() => { setRevisionNoteModal({ open: true, scheduleId: s.id, action: 'revision' }); setRevisionNote(''); }}
                                                title="Request Revision"
                                                style={{ visibility: (s.status === 'Submitted' || s.status === 'Needs Revision') ? 'visible' : 'hidden' }}
                                            />
                                            <Button
                                                size="small" type="text"
                                                icon={<CloseCircleOutlined style={{ color: t.danger }} />}
                                                loading={reviewLoading === s.id}
                                                onClick={() => { setRevisionNoteModal({ open: true, scheduleId: s.id, action: 'deny' }); setRevisionNote(''); }}
                                                title="Deny"
                                                style={{ visibility: (s.status === 'Submitted' || s.status === 'Needs Revision') ? 'visible' : 'hidden' }}
                                            />
                                            <Popconfirm
                                                title="Delete schedule?"
                                                description={`Remove ${name}'s schedule for this week?`}
                                                onConfirm={() => handleDeleteSchedule(s.id)}
                                                okText="Delete"
                                                okButtonProps={{ danger: true }}
                                                cancelText="Cancel"
                                            >
                                                <Button
                                                    danger type="text" size="small"
                                                    icon={<DeleteOutlined />}
                                                    title="Delete schedule"
                                                />
                                            </Popconfirm>
                                        </Space>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── my submitted schedules list ──────────── */}
                    <div style={{
                        marginTop: 24, background: t.surface,
                        border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden',
                    }}>
                        <div style={{
                            padding: '12px 18px', borderBottom: `1px solid ${t.border}`,
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: `${alpha(t.surfaceRaised, 0.53)}`,
                        }}>
                            <UserOutlined style={{ color: t.success }} />
                            <Text strong style={{ color: t.text }}>My Submitted Schedules</Text>
                            <Tag style={{
                                background: `${alpha(t.success, 0.09)}`, color: t.success,
                                border: 'none', borderRadius: 10, fontSize: 11, marginLeft: 4,
                            }}>
                                {mySchedules.length}
                            </Tag>
                        </div>

                        {mySchedules.length === 0 ? (
                            <div style={{ padding: '28px 18px', textAlign: 'center' }}>
                                <Text style={{ color: t.textMuted }}>No schedules submitted yet.</Text>
                            </div>
                        ) : (
                            mySchedules.map((s, idx) => {
                                const isSelected = s.weekStart === selectedWeek;
                                const totalHrs = s.shifts.reduce((acc, sh) => {
                                    const [ssH, ssM] = sh.start.split(':').map(Number);
                                    const [seH, seM] = sh.end.split(':').map(Number);
                                    return acc + (seH * 60 + seM - ssH * 60 - ssM) / 60;
                                }, 0);
                                const myDays = new Set(s.shifts.map((sh) => sh.day));
                                // Days an administrator assigned, so a week
                                // that appeared without the person doing
                                // anything is explained rather than puzzling.
                                const assignedCount = s.shifts.filter((sh) => sh.source === 'shift').length;
                                return (
                                    <div
                                        key={s.id}
                                        onClick={() => setSelectedWeek(s.weekStart)}
                                        style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            alignItems: 'center', padding: '12px 18px',
                                            borderBottom: idx < mySchedules.length - 1 ? `1px solid ${t.border}` : undefined,
                                            background: isSelected ? `${alpha(t.accent, 0.05)}` : 'transparent',
                                            cursor: 'pointer', transition: 'background 0.15s',
                                            borderLeft: isSelected ? `3px solid ${t.accent}` : '3px solid transparent',
                                        }}
                                        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = t.surfaceRaised; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? `${alpha(t.accent, 0.05)}` : 'transparent'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <CalendarOutlined style={{ color: isSelected ? t.accent : t.textMuted, fontSize: 16 }} />
                                            <div>
                                                <Space size={6}>
                                                    <Text style={{ color: isSelected ? t.accent : t.text, fontWeight: isSelected ? 600 : 400 }}>
                                                        Week of {s.weekStart}
                                                    </Text>
                                                    {assignedCount > 0 && (
                                                        <Tooltip title={`${assignedCount} day(s) put here by an administrator assigning you a shift. You can still set your own times on any day.`}>
                                                            <Tag color="blue" style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>
                                                                assigned
                                                            </Tag>
                                                        </Tooltip>
                                                    )}
                                                </Space>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                    <div style={{ display: 'flex', gap: 2 }}>
                                                        {WEEKDAYS.map((d) => (
                                                            <div key={d} style={{
                                                                width: 10, height: 10, borderRadius: 2,
                                                                background: myDays.has(d) ? `${alpha(t.success, 0.33)}` : t.surfaceRaised,
                                                                border: myDays.has(d) ? `1px solid ${alpha(t.success, 0.53)}` : `1px solid ${t.border}`,
                                                            }} />
                                                        ))}
                                                    </div>
                                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                        {s.shifts.length} shift{s.shifts.length !== 1 ? 's' : ''}
                                                    </Text>
                                                </div>
                                            </div>
                                        </div>
                                        <Space size={6}>
                                            <StatusBadge status={s.status} />
                                            <Tag style={{
                                                background: `${alpha(t.accent, 0.13)}`, color: t.accent,
                                                border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8,
                                            }}>
                                                {totalHrs.toFixed(1)}h
                                            </Tag>
                                            {s.discordPosted && (
                                                <Tag style={{
                                                    background: alpha(t.accent, 0.13), color: t.accent,
                                                    border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8,
                                                }}>
                                                    Posted
                                                </Tag>
                                            )}
                                            <Button
                                                type="text" size="small"
                                                icon={<EditOutlined style={{ color: t.textMuted }} />}
                                                onClick={(e) => { e.stopPropagation(); openSubmit(s); }}
                                                title={s.status === 'Approved' ? 'Edit (requires re-approval)' : 'Edit schedule'}
                                                style={{ flexShrink: 0, visibility: s.status !== 'Denied' ? 'visible' : 'hidden' }}
                                            />
                                        </Space>
                                        {s.reviewNote && (
                                            <div style={{
                                                marginTop: 4, fontSize: 11, color: t.warning,
                                                fontStyle: 'italic',
                                            }}>
                                                Note: {s.reviewNote}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </>
            )}

            {/* ══ Submit Schedule Modal ══════════════════════════════════════ */}
            <FormModal
                title={editingSchedule ? 'Edit My Schedule' : 'Submit My Schedule'}
                open={submitOpen}
                onCancel={() => setSubmitOpen(false)}
                onOk={handleSubmit}
                confirmLoading={submitLoading}
                width={640}
                okText={editingSchedule ? 'Save Changes' : 'Submit Schedule'}
            >
                {/* Week picker */}
                <div style={{
                    marginBottom: 18, padding: '12px 14px',
                    background: t.surfaceRaised, borderRadius: 8, border: `1px solid ${t.border}`,
                }}>
                    <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                        Week Starting
                    </Text>
                    <DatePicker
                        picker="week"
                        locale={dayjsPickerLocale}
                        value={dayjs(submitWeek)}
                        onChange={(d) => { if (d) setSubmitWeek(mondayOfWeek(d)); }}
                        disabledDate={editingSchedule ? undefined : disabledPastWeeks}
                        allowClear={false}
                        disabled={!!editingSchedule}
                        format={(d) => `Week of ${mondayOfWeek(d)}`}
                        style={{ width: '100%' }}
                    />
                    <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 6, display: 'block' }}>
                        <CalendarOutlined style={{ marginRight: 4 }} />
                        {editingSchedule
                            ? 'Editing the schedule for this week — shifts will be replaced when saved.'
                            : 'Past weeks are locked — you can only submit for the current or upcoming weeks.'}
                    </Text>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div>
                        <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Shifts</Text>
                        <Text style={{ color: t.textMuted, fontSize: 12, marginLeft: 8 }}>
                            {shifts.length} shift{shifts.length !== 1 ? 's' : ''}
                        </Text>
                    </div>
                    {shifts.length > 0 && (
                        <Text style={{ color: t.accent, fontSize: 12 }}>
                            {fmtDur(shifts.reduce((s, sh) => {
                                if (!sh.start || !sh.end) return s;
                                const dur = timeToHours(sh.end) - timeToHours(sh.start);
                                return s + (dur > 0 ? dur : 0);
                            }, 0))} total
                        </Text>
                    )}
                </div>

                {shifts.map((shift, i) => (
                    <div key={i} style={{
                        display: 'flex', gap: 8, alignItems: 'center',
                        marginBottom: 8, padding: '10px 12px',
                        background: t.surfaceRaised, borderRadius: 8, border: `1px solid ${t.border}`,
                    }}>
                        <Select
                            value={shift.day}
                            onChange={(v) => updateShift(i, 'day', v)}
                            options={WEEKDAYS.map((d) => ({ label: d, value: d }))}
                            style={{ width: 130, flexShrink: 0 }}
                        />
                        <TimePicker
                            value={shift.start ? dayjs(shift.start, 'HH:mm') : null}
                            format="HH:mm"
                            minuteStep={15}
                            allowClear={false}
                            onChange={(_, s) => { if (s) updateShift(i, 'start', s as string); }}
                            style={{ flex: 1 }}
                            placeholder="Start"
                        />
                        <Text style={{ color: t.textMuted, flexShrink: 0 }}>→</Text>
                        <TimePicker
                            value={shift.end ? dayjs(shift.end, 'HH:mm') : null}
                            format="HH:mm"
                            minuteStep={15}
                            allowClear={false}
                            onChange={(_, s) => { if (s) updateShift(i, 'end', s as string); }}
                            style={{ flex: 1 }}
                            placeholder="End"
                        />
                        <Input
                            placeholder="Note (optional)"
                            value={shift.note}
                            onChange={(e) => updateShift(i, 'note', e.target.value)}
                            style={{ flex: 1 }}
                        />
                        <Button
                            danger type="text" size="small"
                            onClick={() => removeShift(i)}
                            disabled={shifts.length === 1}
                            style={{ flexShrink: 0 }}
                        >
                            ✕
                        </Button>
                    </div>
                ))}

                <Button type="dashed" onClick={addShift} icon={<PlusOutlined />} block style={{ marginTop: 4 }}>
                    Add Shift
                </Button>
            </FormModal>

            {/* ══ View Schedule Modal ════════════════════════════════════════ */}
            <Modal
                title={
                    viewingSchedule && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <EyeOutlined style={{ color: t.accent }} />
                            <span style={{ color: t.text }}>
                                {viewingSchedule.user?.fullName ?? 'Schedule'}
                                {' '}&mdash; week of {viewingSchedule.weekStart}
                            </span>
                        </div>
                    )
                }
                open={!!viewingSchedule}
                onCancel={() => setViewingSchedule(null)}
                footer={null}
                width={700}
                styles={{
                    body:   { background: t.surface, padding: 20 },
                    header: { background: t.surface, borderBottom: `1px solid ${t.border}` },
                }}
            >
                {viewingSchedule && (() => {
                    const viewTotalHrs = viewingSchedule.shifts.reduce((acc, sh) => {
                        const [h1, m1] = sh.start.split(':').map(Number);
                        const [h2, m2] = sh.end.split(':').map(Number);
                        return acc + (h2 * 60 + m2 - h1 * 60 - m1) / 60;
                    }, 0);
                    const memberColor = memberColors[viewingSchedule.user?.fullName ?? viewingSchedule.userId] ?? t.accent;
                    return (
                        <div>
                            {/* Summary row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
                                <StatusBadge status={viewingSchedule.status} />
                                <Tag style={{ background: `${alpha(t.accent, 0.13)}`, color: t.accent, border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8 }}>
                                    <ThunderboltOutlined style={{ marginRight: 3 }} />
                                    {viewTotalHrs.toFixed(1)}h &nbsp;·&nbsp; {viewingSchedule.shifts.length} shift{viewingSchedule.shifts.length !== 1 ? 's' : ''}
                                </Tag>
                                {viewingSchedule.discordPosted && (
                                    <Tag style={{ background: alpha(t.accent, 0.13), color: t.accent, border: `1px solid ${alpha(t.accent, 0.27)}`, borderRadius: 8 }}>Posted</Tag>
                                )}
                            </div>
                            {/* Shift cards grouped by day */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {WEEKDAYS.filter((d) => viewingSchedule.shifts.some((sh) => sh.day === d)).map((day) => {
                                    const dayShifts = viewingSchedule.shifts.filter((sh) => sh.day === day);
                                    const dayDate = dayjs(viewingSchedule.weekStart).add(WEEKDAYS.indexOf(day), 'day');
                                    const dayHrs = dayShifts.reduce((s, sh) => {
                                        const dur = timeToHours(sh.end) - timeToHours(sh.start);
                                        return s + (dur > 0 ? dur : 0);
                                    }, 0);
                                    return (
                                        <div key={day} style={{
                                            background: t.surfaceRaised,
                                            border: `1px solid ${t.border}`,
                                            borderRadius: 10, overflow: 'hidden',
                                        }}>
                                            {/* Day header */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '8px 14px',
                                                borderBottom: `1px solid ${t.border}`,
                                                background: `${alpha(memberColor, 0.03)}`,
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <div style={{
                                                        width: 3, height: 18, borderRadius: 2, background: memberColor, flexShrink: 0,
                                                    }} />
                                                    <Text strong style={{ color: t.text, fontSize: 13 }}>{day}</Text>
                                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayDate.format('MMM D')}</Text>
                                                </div>
                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                    {dayShifts.length} shift{dayShifts.length !== 1 ? 's' : ''} · {fmtDur(dayHrs)}
                                                </Text>
                                            </div>
                                            {/* Shift rows */}
                                            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {dayShifts.map((sh, si) => {
                                                    const dur = timeToHours(sh.end) - timeToHours(sh.start);
                                                    return (
                                                        <div key={si} style={{
                                                            display: 'flex', alignItems: 'center', gap: 12,
                                                            padding: '8px 12px',
                                                            background: `${alpha(memberColor, 0.05)}`,
                                                            border: `1px solid ${alpha(memberColor, 0.16)}`,
                                                            borderRadius: 8,
                                                        }}>
                                                            <ClockCircleOutlined style={{ color: memberColor, fontSize: 13, flexShrink: 0 }} />
                                                            <Text style={{ color: t.text, fontFamily: 'monospace', fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', flexShrink: 0 }}>
                                                                {sh.start}
                                                            </Text>
                                                            <Text style={{ color: t.textFaint, fontSize: 12, flexShrink: 0 }}>→</Text>
                                                            <Text style={{ color: t.text, fontFamily: 'monospace', fontSize: 14, fontWeight: 600, letterSpacing: '-0.02em', flexShrink: 0 }}>
                                                                {sh.end}
                                                            </Text>
                                                            <Tag style={{
                                                                background: t.surface, color: t.textMuted, border: `1px solid ${t.border}`,
                                                                borderRadius: 6, fontSize: 11, marginLeft: 'auto', flexShrink: 0,
                                                            }}>
                                                                {fmtDur(dur > 0 ? dur : 0)}
                                                            </Tag>
                                                            {sh.note && (
                                                                <Text style={{ color: t.textMuted, fontSize: 12, fontStyle: 'italic', flex: 1, minWidth: 0,
                                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                    {sh.note}
                                                                </Text>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {/* General notes */}
                            {viewingSchedule.notes && (
                                <div style={{ marginTop: 12, padding: '10px 14px', background: `${alpha(t.warning, 0.05)}`, border: `1px solid ${alpha(t.warning, 0.16)}`, borderRadius: 8 }}>
                                    <Text style={{ color: t.warning, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Notes</Text>
                                    <Text style={{ color: t.text, fontSize: 13 }}>{viewingSchedule.notes}</Text>
                                </div>
                            )}
                            {/* Review note (if revision requested) */}
                            {viewingSchedule.reviewNote && (
                                <div style={{ marginTop: 8, padding: '10px 14px', background: `${alpha(t.danger, 0.05)}`, border: `1px solid ${alpha(t.danger, 0.16)}`, borderRadius: 8 }}>
                                    <Text style={{ color: t.danger, fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Review Note</Text>
                                    <Text style={{ color: t.text, fontSize: 13 }}>{viewingSchedule.reviewNote}</Text>
                                </div>
                            )}
                            {/* Action buttons for pending schedules */}
                            {(viewingSchedule.status === 'Submitted' || viewingSchedule.status === 'Needs Revision') && (
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
                                    <Button
                                        icon={<CheckCircleOutlined />}
                                        type="primary"
                                        loading={reviewLoading === viewingSchedule.id}
                                        onClick={() => { handleReview(viewingSchedule.id, 'approve'); setViewingSchedule(null); }}
                                        style={{ background: t.success, borderColor: t.success }}
                                    >
                                        Approve
                                    </Button>
                                    <Button
                                        icon={<ExclamationCircleOutlined />}
                                        loading={reviewLoading === viewingSchedule.id}
                                        onClick={() => { setRevisionNoteModal({ open: true, scheduleId: viewingSchedule.id, action: 'revision' }); setRevisionNote(''); setViewingSchedule(null); }}
                                        style={{ borderColor: t.warning, color: t.warning }}
                                    >
                                        Request Revision
                                    </Button>
                                    <Button
                                        danger
                                        icon={<CloseCircleOutlined />}
                                        loading={reviewLoading === viewingSchedule.id}
                                        onClick={() => { setRevisionNoteModal({ open: true, scheduleId: viewingSchedule.id, action: 'deny' }); setRevisionNote(''); setViewingSchedule(null); }}
                                    >
                                        Deny
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </Modal>

            {/* ══ Review Note Modal ══════════════════════════════════════════ */}
            <FormModal
                title={revisionNoteModal.action === 'deny' ? 'Deny Schedule' : 'Request Revision'}
                open={revisionNoteModal.open}
                onCancel={() => setRevisionNoteModal({ open: false, scheduleId: '', action: 'revision' })}
                onOk={() => {
                    handleReview(revisionNoteModal.scheduleId, revisionNoteModal.action, revisionNote);
                    setRevisionNoteModal({ open: false, scheduleId: '', action: 'revision' });
                }}
                okText={revisionNoteModal.action === 'deny' ? 'Deny' : 'Request Revision'}
                danger={revisionNoteModal.action === 'deny'}
            >
                <Input.TextArea
                    rows={3}
                    placeholder="Add a note (optional)..."
                    value={revisionNote}
                    onChange={(e) => setRevisionNote(e.target.value)}
                />
            </FormModal>
        </div>
    );
}