import { useCallback, useEffect, useState } from 'react';
import {
    Table, Tag, Typography, Space, DatePicker, Button, Alert, Spin, Tooltip, Empty,
} from 'antd';
import { ReloadOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import UserAvatar from '../../components/UserAvatar';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';

const { Text } = Typography;

type DayStatus = 'present' | 'late' | 'absent' | 'upcoming' | 'working' | 'off' | 'unscheduled';

interface DayRow {
    userId: string;
    fullName: string;
    employeeId: string | null;
    shift: {
        id: string; name: string; startTime: string; endTime: string;
        graceMinutes: number; source: 'schedule' | 'shift';
    } | null;
    expectedStart: string | null;
    expectedEnd: string | null;
    /** The session in progress, or the most recent one: what the columns show. */
    clockedInAt: string | null;
    clockedOutAt: string | null;
    /** How many sessions the day's hours are made of. */
    sessionCount?: number;
    /** First arrival and final departure of the day. */
    firstClockIn: string | null;
    lastClockOut: string | null;
    openSession: boolean;
    hours: number;
    lateByMinutes: number | null;
    status: DayStatus;
}

interface DayPayload {
    date: string;
    timezone: string;
    serverTime: string;
    rows: DayRow[];
    summary: Record<string, number>;
}

/** Local wall-clock time of an instant, in the lab's timezone. */
const clock = (iso: string | null, tz: string) =>
    iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '—';

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Who is in, who is late, who never came.
 *
 * The module could total a week's hours and say nothing about today, which is
 * the question a lab actually asks each morning. Everything here is derived
 * from the same sessions the rest of attendance uses, compared against the
 * shift each person is on.
 */
export default function TodayTab() {
    const { t } = useTheme();
    const [date, setDate] = useState(dayjs());
    const [data, setData] = useState<DayPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const isToday = date.isSame(dayjs(), 'day');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.get<DayPayload>('/attendance/day', {
                params: { date: date.format('YYYY-MM-DD') },
            });
            setData(res.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Could not load the day');
        } finally {
            setLoading(false);
        }
    }, [date]);

    useEffect(() => { void load(); }, [load]);

    // While looking at today, refresh on a slow timer so a wall display or a
    // left-open tab stays honest without anybody pressing anything.
    useEffect(() => {
        if (!isToday) return;
        const id = setInterval(() => { void load(); }, 60_000);
        return () => clearInterval(id);
    }, [isToday, load]);

    const STATUS: Record<DayStatus, { label: string; color: string; help: string }> = {
        working: { label: 'Working now', color: t.success, help: 'Clocked in and still on the clock.' },
        present: { label: 'Present', color: t.success, help: 'Arrived within the grace period and clocked out.' },
        late: { label: 'Late', color: t.warning, help: 'Clocked in after the shift’s grace period.' },
        absent: { label: 'Absent', color: t.danger, help: 'On shift, the shift has started, and no clock-in.' },
        upcoming: { label: 'Not started', color: t.textMuted, help: 'On shift later today.' },
        unscheduled: { label: 'Unscheduled', color: t.accent, help: 'Worked today without being on a shift.' },
        off: { label: 'Off', color: t.textMuted, help: 'Not on a shift today.' },
    };

    const tz = data?.timezone ?? 'UTC';

    const columns = [
        {
            title: 'Employee',
            key: 'employee',
            fixed: 'left' as const,
            width: 230,
            render: (_: any, r: DayRow) => (
                <Space size={10}>
                    <UserAvatar name={r.fullName} userId={r.userId} size={30} />
                    <div style={{ minWidth: 0 }}>
                        <Text style={{ color: t.text, fontWeight: 600, display: 'block' }}>{r.fullName}</Text>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            {r.employeeId ?? 'no Employee ID'}
                        </Text>
                    </div>
                </Space>
            ),
        },
        {
            title: 'Status',
            key: 'status',
            width: 150,
            render: (_: any, r: DayRow) => {
                const s = STATUS[r.status];
                return (
                    <Tooltip title={s.help}>
                        <Tag
                            style={{
                                background: alpha(s.color, 0.14),
                                borderColor: alpha(s.color, 0.3),
                                color: s.color,
                                fontWeight: 600,
                            }}
                        >
                            {s.label}
                            {r.lateByMinutes != null && r.status !== 'working' ? ` · ${r.lateByMinutes}m` : ''}
                        </Tag>
                    </Tooltip>
                );
            },
            filters: Object.entries(STATUS).map(([k, v]) => ({ text: v.label, value: k })),
            onFilter: (v: any, r: DayRow) => r.status === v,
        },
        {
            title: 'Shift',
            key: 'shift',
            width: 170,
            render: (_: any, r: DayRow) => (r.shift ? (
                <div>
                    <Space size={6}>
                        <Text style={{ color: t.text, fontSize: 13 }}>{r.shift.name}</Text>
                        {/* Where the expectation came from. Their own schedule
                            takes precedence over an assigned shift, so saying
                            which is in force avoids an argument about it. */}
                        <Tooltip title={r.shift.source === 'schedule'
                            ? 'From the schedule this person submitted for the week'
                            : 'From a shift an administrator assigned'}>
                            <Tag style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: '16px' }}>
                                {r.shift.source === 'schedule' ? 'their schedule' : 'assigned'}
                            </Tag>
                        </Tooltip>
                    </Space>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {hhmm(r.shift.startTime)}–{hhmm(r.shift.endTime)}
                    </Text>
                </div>
            ) : <Text style={{ color: t.textMuted }}>—</Text>),
        },
        {
            title: 'Expected',
            key: 'expected',
            width: 110,
            render: (_: any, r: DayRow) => (
                <Text style={{ color: t.textMuted, fontSize: 12.5 }}>
                    {r.expectedStart ? clock(r.expectedStart, tz) : '—'}
                </Text>
            ),
        },
        {
            title: 'Clocked in',
            key: 'in',
            width: 110,
            render: (_: any, r: DayRow) => (
                <Tooltip
                    title={(r.sessionCount ?? 0) > 1
                        ? `${r.sessionCount} sessions today. First clock-in ${clock(r.firstClockIn, tz)}, `
                          + `last clock-out ${clock(r.lastClockOut, tz)}. `
                          + 'The times shown are the most recent session; Hours is the total of all of them.'
                        : undefined}
                >
                    <div style={{ lineHeight: 1.2 }}>
                        <Text style={{
                            color: r.lateByMinutes != null ? t.warning : t.text,
                            fontWeight: r.clockedInAt ? 600 : 400,
                            fontSize: 12.5,
                        }}>
                            {clock(r.clockedInAt, tz)}
                        </Text>
                        {(r.sessionCount ?? 0) > 1 && (
                            // Two short visits must not read as one long one.
                            <div style={{ color: t.textMuted, fontSize: 10 }}>
                                {r.sessionCount} sessions · 1st {clock(r.firstClockIn, tz)}
                            </div>
                        )}
                    </div>
                </Tooltip>
            ),
        },
        {
            title: 'Clocked out',
            key: 'out',
            width: 110,
            render: (_: any, r: DayRow) => (
                <Text style={{ color: t.text, fontSize: 12.5 }}>
                    {r.openSession
                        ? <Tag color="green" style={{ marginInlineEnd: 0 }}>on the clock</Tag>
                        : clock(r.clockedOutAt, tz)}
                </Text>
            ),
        },
        {
            title: 'Hours',
            key: 'hours',
            width: 90,
            align: 'right' as const,
            render: (_: any, r: DayRow) => (
                <Text style={{ color: r.hours > 0 ? t.text : t.textMuted, fontWeight: 600 }}>
                    {r.hours.toFixed(2)}
                </Text>
            ),
            sorter: (a: DayRow, b: DayRow) => a.hours - b.hours,
        },
    ];

    const tiles: { key: DayStatus | 'onShift'; label: string; color: string }[] = [
        { key: 'onShift', label: 'On shift', color: t.accent },
        { key: 'working', label: 'Working now', color: t.success },
        { key: 'late', label: 'Late', color: t.warning },
        { key: 'absent', label: 'Absent', color: t.danger },
        { key: 'present', label: 'Done', color: t.success },
        { key: 'off', label: 'Off', color: t.textMuted },
    ];

    return (
        <div>
            <div style={{
                display: 'flex', gap: 12, flexWrap: 'wrap',
                alignItems: 'center', marginBottom: 16,
            }}>
                <Space size={8}>
                    <CalendarOutlined style={{ color: t.textMuted }} />
                    <DatePicker
                        value={date}
                        onChange={(d) => d && setDate(d)}
                        allowClear={false}
                        disabledDate={(d) => d.isAfter(dayjs(), 'day')}
                    />
                </Space>
                {!isToday && (
                    <Button size="small" onClick={() => setDate(dayjs())}>Back to today</Button>
                )}
                <div style={{ flex: 1 }} />
                {data && (
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {data.timezone} · as of {clock(data.serverTime, tz)}
                        {isToday ? ' · refreshes every minute' : ''}
                    </Text>
                )}
                <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
                    Refresh
                </Button>
            </div>

            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

            {data && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))',
                    gap: 10, marginBottom: 18,
                }}>
                    {tiles.map((tile) => {
                        const value = tile.key === 'onShift'
                            ? data.summary.onShift ?? 0
                            : data.summary[tile.key] ?? 0;
                        return (
                            <div key={tile.key} style={{
                                background: t.surface,
                                border: `1px solid ${value > 0 ? alpha(tile.color, 0.35) : t.border}`,
                                borderRadius: 10, padding: '12px 14px',
                            }}>
                                <div style={{ color: tile.color, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
                                    {value}
                                </div>
                                <div style={{ color: t.textMuted, fontSize: 11.5, marginTop: 2 }}>{tile.label}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {loading && !data ? (
                <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
            ) : (
                <Table
                    size="small"
                    rowKey="userId"
                    dataSource={data?.rows ?? []}
                    columns={columns}
                    loading={loading}
                    pagination={false}
                    // The table is wider than a phone; scrolling it horizontally
                    // keeps every column readable instead of crushing them.
                    scroll={{ x: 900 }}
                    locale={{
                        emptyText: (
                            <Empty
                                image={null}
                                description={
                                    <Text style={{ color: t.textMuted }}>
                                        Nobody is on a shift for this day. Create a shift and assign
                                        people to it, and this becomes the lab's daily roll call.
                                    </Text>
                                }
                            />
                        ),
                    }}
                    rowClassName={(r: DayRow) => (r.status === 'absent' ? 'att-row-flag' : '')}
                />
            )}
        </div>
    );
}
