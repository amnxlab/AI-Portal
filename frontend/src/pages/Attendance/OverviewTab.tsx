import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Row, Col, Table, Tag, Typography, Button, Space, Input, Select, DatePicker,
    Tooltip, Alert, message,
} from 'antd';
import {
    DownloadOutlined, ReloadOutlined, WarningOutlined, SettingOutlined,
    CheckCircleOutlined, FileTextOutlined, TeamOutlined, AlertOutlined,
    CalendarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getWeekly, getSettings, setEnforcementStart, exportAttendancePdf,
    type EmployeeWeeklySummary, type AttendanceSettings,
} from '../../api/attendance';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { currentWeek, addWeeks, formatWeek, isoMonday } from '../../utils/week';
import { Panel, StatCard, LoadingState, FormModal } from '../../components/ui';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   Organisation-wide attendance for one week.

   The point of this screen is the comparison the spec asks for: hours the
   attendance records actually verify, set against hours the employee has
   reported. `overReported` and the remote-overrun flag come from the
   server, so what is highlighted here is the same thing the report
   endpoint would refuse.
   ═══════════════════════════════════════════════════════════════════════ */

type StatusFilter = 'all' | 'working' | 'over_reported' | 'remote_exceeded' | 'incomplete' | 'no_attendance';

export default function OverviewTab() {
    const { t } = useTheme();
    const [week, setWeek] = useState(currentWeek());
    const [rows, setRows] = useState<EmployeeWeeklySummary[]>([]);
    const [settings, setSettings] = useState<AttendanceSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState<StatusFilter>('all');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [enforceFrom, setEnforceFrom] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const [r, s] = await Promise.all([
            getWeekly(week).catch(() => [] as EmployeeWeeklySummary[]),
            getSettings().catch(() => null),
        ]);
        setRows(r); setSettings(s);
        setEnforceFrom(s?.enforcementStart ?? null);
        setLoading(false);
    }, [week]);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:refresh': () => { void load(); } });

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return rows.filter((r) => {
            if (q && !(
                r.fullName.toLowerCase().includes(q)
                || (r.employeeId ?? '').toLowerCase().includes(q)
            )) return false;
            switch (filter) {
                case 'working': return !!r.openSession;
                case 'over_reported': return r.overReported;
                case 'remote_exceeded': return r.remote.exceeded;
                case 'incomplete': return r.incompleteCount > 0;
                case 'no_attendance': return r.verifiedHours <= 0;
                default: return true;
            }
        });
    }, [rows, search, filter]);

    const totals = useMemo(() => ({
        verified: rows.reduce((n, r) => n + r.verifiedHours, 0),
        reported: rows.reduce((n, r) => n + r.reportedHours, 0),
        working: rows.filter((r) => r.openSession).length,
        flagged: rows.filter((r) => r.overReported || r.remote.exceeded || r.incompleteCount > 0).length,
    }), [rows]);

    const saveEnforcement = async () => {
        setSaving(true);
        try {
            const s = await setEnforcementStart(enforceFrom);
            setSettings(s);
            message.success('Enforcement updated');
            setSettingsOpen(false);
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not update enforcement');
        }
        setSaving(false);
    };

    const columns: ColumnsType<EmployeeWeeklySummary> = [
        {
            title: 'Employee', key: 'employee', fixed: 'left', width: 220,
            sorter: (a, b) => a.fullName.localeCompare(b.fullName),
            render: (_, r) => (
                <div>
                    <Space size={6}>
                        <Text style={{ color: t.text, fontWeight: 600 }}>{r.fullName}</Text>
                        {r.openSession && <Tag color="processing" style={{ marginInlineEnd: 0 }}>Working</Tag>}
                        {!r.isActive && <Tag style={{ marginInlineEnd: 0 }}>Disabled</Tag>}
                    </Space>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {r.employeeId ?? 'No Employee ID'}
                    </Text>
                </div>
            ),
        },
        {
            title: 'Verified', key: 'verified', width: 130, align: 'right',
            sorter: (a, b) => a.verifiedHours - b.verifiedHours,
            render: (_, r) => (
                <Tooltip title={`On-site ${r.onsiteHours.toFixed(2)} h · remote credited ${r.remote.creditedHours.toFixed(2)} h`}>
                    <Text style={{ color: t.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {r.verifiedHours.toFixed(2)} h
                    </Text>
                </Tooltip>
            ),
        },
        {
            title: 'Reported', key: 'reported', width: 130, align: 'right',
            sorter: (a, b) => a.reportedHours - b.reportedHours,
            render: (_, r) => (
                <Space size={4}>
                    <Text style={{
                        color: r.overReported ? t.danger : t.text,
                        fontWeight: r.overReported ? 700 : 400,
                        fontVariantNumeric: 'tabular-nums',
                    }}>
                        {r.reportedHours.toFixed(2)} h
                    </Text>
                    {r.overReported && (
                        <Tooltip title={`Reported more than the ${r.verifiedHours.toFixed(2)} h verified by attendance`}>
                            <WarningOutlined style={{ color: t.danger }} />
                        </Tooltip>
                    )}
                </Space>
            ),
        },
        {
            title: 'Remaining', key: 'remaining', width: 120, align: 'right',
            render: (_, r) => (
                <Text style={{
                    color: r.remainingReportableHours == null
                        ? t.textFaint
                        : r.remainingReportableHours <= 0 ? t.warning : t.accent,
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {r.remainingReportableHours == null ? 'No limit' : `${r.remainingReportableHours.toFixed(2)} h`}
                </Text>
            ),
        },
        {
            title: 'Remote', key: 'remote', width: 150, align: 'right',
            render: (_, r) => (!r.remote.allowed
                ? <Text style={{ color: t.textFaint, fontSize: 12 }}>Not authorised</Text>
                : (
                    <Tooltip title={`Policy ${r.remote.percent}% → ${r.remote.limitHours.toFixed(2)} h limit`}>
                        <Text style={{ color: r.remote.exceeded ? t.danger : t.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                            {r.remote.actualHours.toFixed(2)} / {r.remote.limitHours.toFixed(2)} h
                        </Text>
                    </Tooltip>
                )
            ),
        },
        {
            title: 'Report', dataIndex: 'reportStatus', width: 130,
            render: (v: string | null) => (v
                ? <Tag color={v === 'Approved' ? 'success' : v === 'Submitted' ? 'processing' : v === 'Needs Revision' ? 'warning' : 'default'}>{v}</Tag>
                : <Text style={{ color: t.textFaint, fontSize: 12 }}>Not filed</Text>),
        },
        {
            title: 'Exceptions', key: 'exceptions', width: 130,
            render: (_, r) => (r.incompleteCount > 0
                ? <Tag color="warning">{r.incompleteCount} incomplete</Tag>
                : <Text style={{ color: t.textFaint }}>—</Text>),
        },
        {
            title: 'Daily', key: 'daily', width: 230,
            render: (_, r) => (
                <Space size={2}>
                    {r.days.map((d) => (
                        <Tooltip key={d.date} title={`${dayjs(d.date).format('ddd D MMM')}: ${d.totalHours.toFixed(2)} h`}>
                            <div style={{
                                width: 22, height: 22, borderRadius: 4, display: 'grid', placeItems: 'center',
                                fontSize: 9, fontWeight: 700,
                                background: d.totalHours > 0 ? t.successBg : t.surfaceSunken,
                                color: d.totalHours > 0 ? t.success : t.textFaint,
                                border: `1px solid ${d.totalHours > 0 ? t.successBorder : t.borderSubtle}`,
                            }}>
                                {d.totalHours > 0 ? d.totalHours.toFixed(0) : '·'}
                            </div>
                        </Tooltip>
                    ))}
                </Space>
            ),
        },
    ];

    if (loading && !rows.length) return <LoadingState />;

    const enforcementOn = !!settings?.enforcementStart && week >= settings.enforcementStart;

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><StatCard label="Verified hours" value={`${totals.verified.toFixed(2)} h`} icon={<CheckCircleOutlined />} tone={t.success} hint={`${rows.length} employees`} /></Col>
                <Col xs={12} md={6}><StatCard label="Reported hours" value={`${totals.reported.toFixed(2)} h`} icon={<FileTextOutlined />} tone={t.purple} hint="Submitted or approved" /></Col>
                <Col xs={12} md={6}><StatCard label="Clocked in now" value={totals.working} icon={<TeamOutlined />} tone={t.success} hint="Open sessions right now" /></Col>
                <Col xs={12} md={6}><StatCard label="Needing attention" value={totals.flagged} icon={<AlertOutlined />} tone={totals.flagged ? t.warning : t.textMuted} hint="Over-reported, remote overrun or incomplete" /></Col>
            </Row>

            {!enforcementOn && (
                <Alert
                    type="warning" showIcon style={{ marginBottom: 16 }}
                    message="Reports are not capped by attendance for this week"
                    description={settings?.enforcementStart
                        ? `Enforcement starts the week of ${settings.enforcementStart}. Earlier weeks are recorded but not capped.`
                        : 'No enforcement date is set, so employees can report any number of hours up to their weekly cap. Set a start week to begin capping reports at verified attendance.'}
                    action={<Button size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Set</Button>}
                />
            )}

            <Panel
                accent={t.accent}
                title={<Space size={8}><CalendarOutlined style={{ color: t.accent }} />Week of {formatWeek(week)}</Space>}
                extra={
                    <Space wrap>
                        <Button size="small" onClick={() => setWeek(addWeeks(week, -1))}>← Previous</Button>
                        <Button size="small" onClick={() => setWeek(currentWeek())}>This week</Button>
                        <Button size="small" disabled={week >= currentWeek()} onClick={() => setWeek(addWeeks(week, 1))}>Next →</Button>
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
                        <Button size="small" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>Enforcement</Button>
                        <Button size="small" icon={<DownloadOutlined />} onClick={() => void exportAttendancePdf(week, 'weekly')}>PDF</Button>
                    </Space>
                }
            >
                <Space wrap style={{ marginBottom: 12 }}>
                    <Input.Search
                        allowClear placeholder="Name or Employee ID" style={{ width: 240 }}
                        value={search} onChange={(e) => setSearch(e.target.value)}
                    />
                    <Select
                        value={filter} onChange={setFilter} style={{ width: 210 }}
                        options={[
                            { value: 'all', label: 'All employees' },
                            { value: 'working', label: 'Clocked in now' },
                            { value: 'over_reported', label: 'Reported above verified' },
                            { value: 'remote_exceeded', label: 'Remote limit exceeded' },
                            { value: 'incomplete', label: 'Has incomplete sessions' },
                            { value: 'no_attendance', label: 'No attendance this week' },
                        ]}
                    />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {filtered.length} of {rows.length}
                    </Text>
                </Space>

                <Table
                    rowKey="userId" size="small" columns={columns} dataSource={filtered}
                    loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }}
                    scroll={{ x: 1340 }}
                    rowClassName={(r) => (r.overReported ? 'att-row-flag' : '')}
                />
            </Panel>

            <FormModal
                open={settingsOpen}
                title="Attendance enforcement"
                onCancel={() => setSettingsOpen(false)}
                onOk={saveEnforcement}
                confirmLoading={saving}
                okText="Save"
            >
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 12 }}>
                    From the chosen week onward, a weekly report cannot exceed the hours that attendance
                    records verify. Weeks before it are recorded as usual but not capped — which is what
                    lets you switch this on without invalidating past reports.
                </Text>
                <Space direction="vertical" style={{ width: '100%' }}>
                    <DatePicker
                        picker="week" style={{ width: '100%' }}
                        value={enforceFrom ? dayjs(enforceFrom) : null}
                        onChange={(d) => setEnforceFrom(d ? isoMonday(d) : null)}
                        placeholder="No enforcement"
                    />
                    <Button size="small" danger type="text" onClick={() => setEnforceFrom(null)}>
                        Turn enforcement off
                    </Button>
                    {settings && (
                        <Text style={{ color: t.textFaint, fontSize: 12 }}>
                            Timezone {settings.timezone} · standard week {settings.standardWeekHours} h
                            · sessions auto-close after {settings.maxSessionHours} h
                        </Text>
                    )}
                </Space>
            </FormModal>
        </div>
    );
}
