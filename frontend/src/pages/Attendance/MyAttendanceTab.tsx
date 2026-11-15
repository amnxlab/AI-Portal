import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Table, Tag, Typography, Button, Space, Alert, Segmented, Progress, Tooltip, message } from 'antd';
import {
    LoginOutlined, LogoutOutlined, ReloadOutlined, ClockCircleOutlined,
    CheckCircleOutlined, FileTextOutlined, HourglassOutlined, CalendarOutlined,
    HistoryOutlined, HomeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getCurrent, getMyHours, getMyHistory, selfClockIn, selfClockOut,
    type CurrentAttendance, type MyHoursResult, type MyHistory, type SessionView,
} from '../../api/attendance';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { space, fontSize, radius, alpha } from '../../theme/tokens';
import { currentWeek, addWeeks, formatWeek } from '../../utils/week';
import { Panel, StatCard, LoadingState, EmptyState } from '../../components/ui';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The employee's own attendance. Read-only by design.

   There is no control here to add, edit or delete an attendance record,
   and none exists on the server either — the only thing an employee can
   do is clock themselves in or out, and only when an administrator has
   authorised them for remote work. Whether that is offered at all is the
   server's decision (`remote.canClockIn` / `canClockOut`), not the
   browser's.

   LAYOUT
   ──────
   Follows the same three-part shape as the Overview and Today tabs: a row
   of KPI tiles that is NOT wrapped in a panel, then panels that each hold
   one thing with their controls in the panel header.

   This page used to wrap its tiles inside a panel (a surface on a surface),
   stack them one-per-row on a phone, spend seven tiles on five numbers, and
   render two or three full-width Alert boxes that were always on screen
   whatever the state. The result was roughly two screens of chrome before
   the history table. Nothing about the attendance logic has changed here —
   only how much room it takes to say it.
   ═══════════════════════════════════════════════════════════════════════ */

const RANGES = [
    { label: '4 weeks', value: 28 },
    { label: '8 weeks', value: 56 },
    { label: '6 months', value: 182 },
];

export function sessionSourceLabel(source: string): string {
    switch (source) {
        case 'rfid': return 'RFID reader';
        case 'online_portal': return 'Portal';
        case 'admin_correction': return 'Correction';
        case 'csv_import': return 'Imported';
        case 'manual': return 'Manual';
        default: return source;
    }
}

export function SessionStatusTag({ status, corrected }: { status: string; corrected?: boolean }) {
    const map: Record<string, { color: string; label: string }> = {
        open: { color: 'processing', label: 'Open' },
        closed: { color: 'success', label: 'Closed' },
        incomplete: { color: 'warning', label: 'Incomplete' },
        voided: { color: 'default', label: 'Voided' },
    };
    const m = map[status] ?? { color: 'default', label: status };
    return (
        <Space size={4}>
            <Tag color={m.color} style={{ marginInlineEnd: 0 }}>{m.label}</Tag>
            {corrected && <Tag color="purple" style={{ marginInlineEnd: 0 }}>Corrected</Tag>}
        </Space>
    );
}

/** One figure in a panel header — "Total 42.50 h". */
function InlineTotal({ label, value, tone }: { label: string; value: string; tone: string }) {
    const { t } = useTheme();
    return (
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: space.xs }}>
            <Text style={{ color: t.textMuted, fontSize: fontSize.sm }}>{label}</Text>
            <Text style={{ color: tone, fontSize: fontSize.md, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </Text>
        </span>
    );
}

export default function MyAttendanceTab() {
    const { t } = useTheme();
    const [current, setCurrent] = useState<CurrentAttendance | null>(null);
    const [hours, setHours] = useState<MyHoursResult | null>(null);
    const [history, setHistory] = useState<MyHistory | null>(null);
    const [week, setWeek] = useState(currentWeek());
    const [days, setDays] = useState(28);
    const [loading, setLoading] = useState(true);
    const [acting, setActing] = useState(false);

    const load = useCallback(async () => {
        const to = dayjs().format('YYYY-MM-DD');
        const from = dayjs().subtract(days, 'day').format('YYYY-MM-DD');
        const [c, h, hist] = await Promise.all([
            getCurrent().catch(() => null),
            getMyHours(week).catch(() => null),
            getMyHistory(from, to).catch(() => null),
        ]);
        setCurrent(c); setHours(h); setHistory(hist);
        setLoading(false);
    }, [week, days]);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:changed': () => { void load(); } });

    const act = async (fn: () => Promise<unknown>, ok: string) => {
        setActing(true);
        try {
            await fn();
            message.success({ content: ok, key: 'self-clock' });
            await load();
        } catch (e: any) {
            message.error({ content: e?.response?.data?.message || 'That did not go through', key: 'self-clock' });
        }
        setActing(false);
    };

    if (loading) return <LoadingState />;

    const weekly = hours?.weekly;
    const remote = current?.remote;
    const session = current?.session ?? null;
    const enforcement = !!weekly?.enforcement;

    const columns: ColumnsType<SessionView> = [
        {
            title: 'Date', dataIndex: 'clockInAt', width: 136,
            render: (v: string) => (
                <Text style={{ color: t.text, fontSize: fontSize.md, whiteSpace: 'nowrap' }}>
                    {dayjs(v).format('ddd D MMM YYYY')}
                </Text>
            ),
        },
        {
            title: 'In', dataIndex: 'clockInAt', width: 72,
            render: (v: string) => (
                <Text style={{ color: t.text, fontSize: fontSize.md, fontVariantNumeric: 'tabular-nums' }}>
                    {dayjs(v).format('HH:mm')}
                </Text>
            ),
        },
        {
            title: 'Out', dataIndex: 'clockOutAt', width: 72,
            render: (v: string | null) => (
                <Text style={{
                    color: v ? t.text : t.textFaint,
                    fontSize: fontSize.md, fontVariantNumeric: 'tabular-nums',
                }}>
                    {v ? dayjs(v).format('HH:mm') : '—'}
                </Text>
            ),
        },
        {
            title: 'Hours', dataIndex: 'hours', width: 76, align: 'right',
            render: (v: number, r) => (
                <Text style={{
                    color: r.status === 'closed' ? t.text : t.textFaint,
                    fontSize: fontSize.md, fontWeight: r.status === 'closed' ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {r.status === 'closed' ? v.toFixed(2) : '—'}
                </Text>
            ),
        },
        {
            title: 'Where', dataIndex: 'mode', width: 88,
            render: (v: string) => (
                <Tag color={v === 'remote' ? 'blue' : 'default'} style={{ marginInlineEnd: 0, fontSize: fontSize.xs }}>
                    {v === 'remote' ? 'Remote' : 'On-site'}
                </Tag>
            ),
        },
        {
            title: 'Recorded by', dataIndex: 'source', width: 112,
            render: (v: string) => (
                <Text style={{ color: t.textMuted, fontSize: fontSize.sm }}>{sessionSourceLabel(v)}</Text>
            ),
        },
        {
            title: 'Status', key: 'status', width: 150,
            render: (_, r) => <SessionStatusTag status={r.status} corrected={r.corrected} />,
        },
    ];

    const remoteUsedPct = remote?.allowed && remote.limitHours > 0
        ? Math.min(100, Math.round((remote.actualHours / remote.limitHours) * 100))
        : 0;

    return (
        <div>
            {/* ─── Live status and the only two actions on this page ───────
                A compact strip rather than a KPI tile: it is the one thing
                here that changes minute to minute, and the clock buttons
                belong beside it. */}
            <Panel
                accent={session ? t.success : t.accent}
                padding={space.md}
                style={{ marginBottom: space.lg }}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: space.md, flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: space.md, minWidth: 0 }}>
                        <div
                            aria-hidden
                            style={{
                                width: 32, height: 32, borderRadius: radius.md, flexShrink: 0,
                                background: alpha(session ? t.success : t.textMuted, 0.12),
                                color: session ? t.success : t.textMuted,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: fontSize.lg,
                            }}
                        >
                            {session?.mode === 'remote' ? <HomeOutlined /> : <ClockCircleOutlined />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <Text style={{
                                color: session ? t.success : t.text,
                                fontSize: fontSize.base, fontWeight: 600, display: 'block', lineHeight: 1.3,
                            }}>
                                {session
                                    ? `Clocked in · ${session.mode === 'remote' ? 'Remote' : 'On-site'}`
                                    : 'Not clocked in'}
                            </Text>
                            <Text style={{ color: t.textMuted, fontSize: fontSize.sm }}>
                                {session
                                    ? `Since ${dayjs(session.clockInAt).format('HH:mm')} · ${sessionSourceLabel(session.source)}`
                                    : current?.lastClockOutAt
                                        ? `Last clocked out ${dayjs(current.lastClockOutAt).format('D MMM, HH:mm')}`
                                        : 'No sessions recorded yet'}
                            </Text>
                        </div>
                    </div>

                    <Space size={space.sm} wrap>
                        <Tooltip title="Reload">
                            <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
                        </Tooltip>
                        {remote?.canClockIn && (
                            <Button
                                size="small" type="primary" icon={<LoginOutlined />} loading={acting}
                                onClick={() => act(selfClockIn, 'Clocked in')}
                            >Clock in (remote)</Button>
                        )}
                        {remote?.canClockOut && (
                            <Button
                                size="small" danger icon={<LogoutOutlined />} loading={acting}
                                onClick={() => act(selfClockOut, 'Clocked out')}
                            >Clock out</Button>
                        )}
                    </Space>
                </div>
            </Panel>

            {/* ─── This week's figures ────────────────────────────────────
                Unwrapped, as on every other tab. Two-up on a phone. */}
            <Row gutter={[space.lg, space.lg]} style={{ marginBottom: space.lg }}>
                <Col xs={12} md={8}>
                    <StatCard
                        label="Verified this week" value={`${(weekly?.verifiedHours ?? 0).toFixed(2)} h`}
                        icon={<CheckCircleOutlined />} tone={t.success}
                        hint={`On-site ${(weekly?.onsiteHours ?? 0).toFixed(2)} h · remote ${(weekly?.remote.creditedHours ?? 0).toFixed(2)} h`}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <StatCard
                        label="Already reported" value={`${(weekly?.reportedHours ?? 0).toFixed(2)} h`}
                        icon={<FileTextOutlined />} tone={t.purple}
                        hint={weekly?.reportStatus ? `Report: ${weekly.reportStatus}` : 'No report filed'}
                    />
                </Col>
                <Col xs={24} md={8}>
                    <StatCard
                        label="Remaining reportable"
                        icon={<HourglassOutlined />}
                        value={weekly?.remainingReportableHours == null ? 'No limit' : `${weekly.remainingReportableHours.toFixed(2)} h`}
                        tone={weekly?.remainingReportableHours != null && weekly.remainingReportableHours <= 0 ? t.danger : t.accent}
                        hint={weekly?.maxReportableHours == null
                            ? enforcement ? 'No weekly cap set' : 'Not limited by attendance yet'
                            : `Of ${weekly.maxReportableHours.toFixed(2)} h reportable`}
                    />
                </Col>
            </Row>

            {/* ─── Notices ────────────────────────────────────────────────
                Only what needs acting on gets an Alert box. The two states
                that are merely informational are one quiet line each, and
                remote usage is a meter rather than a paragraph. */}
            {enforcement && (
                <Alert
                    type="info" showIcon style={{ marginBottom: space.md }}
                    message={
                        <Text style={{ fontSize: fontSize.md }}>
                            This week you can report at most{' '}
                            <strong>{(weekly?.maxReportableHours ?? 0).toFixed(2)} h</strong> — the hours your
                            clock-in and clock-out records verify. Clock in and out as usual and the figure rises
                            on its own.
                        </Text>
                    }
                />
            )}

            {remote && !remote.allowed && (
                <Alert
                    type="warning" showIcon style={{ marginBottom: space.md }}
                    message={
                        <Text style={{ fontSize: fontSize.md }}>
                            Remote work is not authorised for your account — the RFID reader is your clock.
                            Ask an administrator if you need remote hours.
                        </Text>
                    }
                />
            )}

            {remote?.allowed && remote.exceeded && (
                <Alert
                    type="error" showIcon style={{ marginBottom: space.md }}
                    message={
                        <Text style={{ fontSize: fontSize.md }}>
                            Remote hours this week (<strong>{remote.actualHours.toFixed(2)} h</strong>) exceed your{' '}
                            {remote.limitHours.toFixed(2)} h limit. Only the first {remote.limitHours.toFixed(2)} h
                            count as verified.
                        </Text>
                    }
                />
            )}

            {remote?.allowed && !remote.exceeded && (
                <Panel padding={`${space.sm}px ${space.md}px`} style={{ marginBottom: space.lg }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' }}>
                        <HomeOutlined style={{ color: t.info, fontSize: fontSize.base, flexShrink: 0 }} />
                        <Text style={{ color: t.textMuted, fontSize: fontSize.sm, flexShrink: 0 }}>
                            Remote allowance
                        </Text>
                        <Progress
                            percent={remoteUsedPct} showInfo={false}
                            strokeColor={remoteUsedPct >= 90 ? t.warning : t.info}
                            trailColor={t.surfaceSunken}
                            size="small"
                            style={{ flex: '1 1 120px', margin: 0, minWidth: 90 }}
                        />
                        <Text style={{
                            color: t.text, fontSize: fontSize.sm, fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums', flexShrink: 0,
                        }}>
                            {remote.actualHours.toFixed(2)} / {remote.limitHours.toFixed(2)} h
                        </Text>
                        <Text style={{ color: t.textFaint, fontSize: fontSize.xs, flexShrink: 0 }}>
                            {remote.percent}% of the week
                            {remote.maxHours != null ? `, capped at ${remote.maxHours} h` : ''}
                        </Text>
                    </div>
                </Panel>
            )}

            {!enforcement && (
                <Text style={{
                    color: t.textFaint, fontSize: fontSize.sm,
                    display: 'block', marginBottom: space.lg,
                }}>
                    Your reports are not yet limited by verified attendance for this week. Your hours are
                    still being recorded and are shown above.
                </Text>
            )}

            {/* ─── Week picker + daily breakdown ──────────────────────── */}
            <Panel
                accent={t.accent}
                title={
                    <Space size={space.sm}>
                        <CalendarOutlined style={{ color: t.accent }} />
                        <span>Week of {formatWeek(week)}</span>
                    </Space>
                }
                extra={
                    <Space size={space.xs}>
                        <Button size="small" onClick={() => setWeek(addWeeks(week, -1))}>←</Button>
                        <Button size="small" onClick={() => setWeek(currentWeek())}>This week</Button>
                        <Button size="small" disabled={week >= currentWeek()} onClick={() => setWeek(addWeeks(week, 1))}>→</Button>
                    </Space>
                }
                padding={space.md}
                style={{ marginBottom: space.lg }}
            >
                <Row gutter={[space.sm, space.sm]}>
                    {(weekly?.days ?? []).map((d) => {
                        const worked = d.totalHours > 0;
                        return (
                            <Col key={d.date} xs={8} sm={6} md={3} lg={3}>
                                <div style={{
                                    textAlign: 'center', padding: `${space.sm}px ${space.xs}px`,
                                    borderRadius: radius.md,
                                    background: worked ? t.successBg : t.surfaceSunken,
                                    border: `1px solid ${worked ? t.successBorder : t.borderSubtle}`,
                                }}>
                                    <Text style={{ fontSize: fontSize.xs, color: t.textMuted, display: 'block' }}>
                                        {dayjs(d.date).format('ddd D')}
                                    </Text>
                                    <Text style={{
                                        fontSize: fontSize.base, fontWeight: 700,
                                        color: worked ? t.success : t.textFaint,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}>
                                        {worked ? d.totalHours.toFixed(2) : '—'}
                                    </Text>
                                    {d.remoteHours > 0 && (
                                        <Text style={{ fontSize: fontSize.xs, color: t.info, display: 'block' }}>
                                            {d.remoteHours.toFixed(2)} remote
                                        </Text>
                                    )}
                                </div>
                            </Col>
                        );
                    })}
                </Row>
            </Panel>

            {/* ─── History ────────────────────────────────────────────────
                The three totals were three more KPI tiles, which made seven
                on one page. They are figures about the table below them, so
                they sit in its header. */}
            <Panel
                accent={t.purple}
                title={
                    <Space size={space.sm}>
                        <HistoryOutlined style={{ color: t.purple }} />
                        <span>Attendance history</span>
                    </Space>
                }
                extra={
                    <Space size={space.md} wrap>
                        {history && history.sessions.length > 0 && (
                            <Space size={space.md} wrap>
                                <InlineTotal label="Total" value={`${history.totalHours.toFixed(2)} h`} tone={t.purple} />
                                <InlineTotal label="On-site" value={`${history.onsiteHours.toFixed(2)} h`} tone={t.success} />
                                <InlineTotal label="Remote" value={`${history.remoteHours.toFixed(2)} h`} tone={t.info} />
                            </Space>
                        )}
                        <Segmented size="small" options={RANGES} value={days} onChange={(v) => setDays(v as number)} />
                    </Space>
                }
                padding={space.md}
            >
                {history && history.sessions.length > 0 ? (
                    <Table
                        rowKey="id" size="small" columns={columns} dataSource={history.sessions}
                        pagination={{
                            pageSize: 15, showSizeChanger: false, size: 'small',
                            showTotal: (total) => `${total} session${total === 1 ? '' : 's'}`,
                        }}
                        scroll={{ x: 760 }}
                    />
                ) : (
                    <EmptyState
                        title="No attendance yet"
                        description="Sessions appear here once you have clocked in and out."
                    />
                )}
            </Panel>
        </div>
    );
}
