import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography, Button, Space, Alert, Row, Col } from 'antd';
import {
    ReloadOutlined, WarningOutlined, ClockCircleOutlined, FileExclamationOutlined,
    SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getExceptions, type ExceptionsResult, type AttendanceException, type WeeklyFlag,
} from '../../api/attendance';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { Panel, StatCard, LoadingState, EmptyState } from '../../components/ui';
import { sessionSourceLabel } from './MyAttendanceTab';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   Records that need an administrator's attention.

   Two different kinds sit here. Session-level problems are mechanical: a
   clock-in with no clock-out, a session running impossibly long, one that
   lasted seconds. Week-level flags are policy: an employee who reported
   more hours than attendance verifies, or exceeded their remote-work
   allowance. The first kind is fixed with a correction; the second is a
   conversation.
   ═══════════════════════════════════════════════════════════════════════ */

const TYPE_META: Record<string, { color: string; label: string }> = {
    incomplete: { color: 'warning', label: 'Never clocked out' },
    long_open: { color: 'processing', label: 'Still clocked in' },
    long_session: { color: 'error', label: 'Unusually long' },
    short_session: { color: 'default', label: 'Unusually short' },
};

export default function ExceptionsTab() {
    const { t } = useTheme();
    const [data, setData] = useState<ExceptionsResult | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setData(await getExceptions().catch(() => null));
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:refresh': () => { void load(); } });

    if (loading && !data) return <LoadingState />;

    const sessionCols: ColumnsType<AttendanceException> = [
        {
            title: 'Problem', dataIndex: 'type', width: 170,
            render: (v: string) => {
                const m = TYPE_META[v] ?? { color: 'default', label: v };
                return <Tag color={m.color}>{m.label}</Tag>;
            },
        },
        {
            title: 'Employee', key: 'employee', width: 190,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{r.session.user?.fullName ?? '—'}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {r.session.user?.employeeId ?? 'No Employee ID'}
                    </Text>
                </div>
            ),
        },
        {
            title: 'When', key: 'when', width: 180,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.text }}>{dayjs(r.session.clockInAt).format('ddd D MMM, HH:mm')}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {r.session.clockOutAt ? `out ${dayjs(r.session.clockOutAt).format('HH:mm')}` : 'no clock-out'}
                        {' · '}{sessionSourceLabel(r.session.source)}
                    </Text>
                </div>
            ),
        },
        {
            title: 'What it means', dataIndex: 'message',
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v}</Text>,
        },
    ];

    const weeklyCols: ColumnsType<WeeklyFlag> = [
        {
            title: 'Employee', key: 'employee', width: 190,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{r.fullName}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {r.employeeId ?? 'No Employee ID'}
                    </Text>
                </div>
            ),
        },
        { title: 'Week', dataIndex: 'weekStart', width: 120 },
        {
            title: 'Flag', key: 'flag', width: 220,
            render: (_, r) => (
                <Space direction="vertical" size={2}>
                    {r.overReported && <Tag color="error" style={{ marginInlineEnd: 0 }}>Reported above verified</Tag>}
                    {r.remoteExceeded && <Tag color="warning" style={{ marginInlineEnd: 0 }}>Remote limit exceeded</Tag>}
                </Space>
            ),
        },
        {
            title: 'Reported vs verified', key: 'cmp', width: 190,
            render: (_, r) => (
                <Text style={{ color: r.overReported ? t.danger : t.text, fontVariantNumeric: 'tabular-nums' }}>
                    {r.reportedHours.toFixed(2)} h / {r.verifiedHours.toFixed(2)} h
                </Text>
            ),
        },
        {
            title: 'Remote', key: 'remote', width: 170,
            render: (_, r) => (
                <Text style={{ color: r.remoteExceeded ? t.warning : t.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                    {r.remoteActualHours.toFixed(2)} h / {r.remoteLimitHours.toFixed(2)} h limit
                </Text>
            ),
        },
    ];

    const sessions = data?.sessions ?? [];
    const weekly = data?.weekly ?? [];

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Session problems" value={sessions.length}
                        icon={<WarningOutlined />}
                        tone={sessions.length ? t.warning : t.success}
                        hint={sessions.length ? 'Need a correction' : 'Nothing outstanding'}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Never clocked out"
                        value={sessions.filter((s) => s.type === 'incomplete').length}
                        icon={<ClockCircleOutlined />} tone={t.orange}
                        hint="Counts as 0 hours until corrected"
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Over-reported weeks"
                        value={weekly.filter((w) => w.overReported).length}
                        icon={<FileExclamationOutlined />}
                        tone={weekly.some((w) => w.overReported) ? t.danger : t.textMuted}
                        hint="Reported above verified attendance"
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Remote overruns"
                        value={weekly.filter((w) => w.remoteExceeded).length}
                        icon={<SafetyCertificateOutlined />} tone={t.warning}
                        hint="Above the per-employee remote limit"
                    />
                </Col>
            </Row>

            <Alert
                type="info" showIcon style={{ marginBottom: 16 }}
                message="An incomplete session contributes nothing"
                description={
                    'A session with no clock-out is never counted as worked time — it cannot silently '
                    + 'inflate anyone’s hours. Fix it with a correction under the Sessions tab, which '
                    + 'records the original state alongside the change.'
                }
            />

            <Panel
                accent={t.warning}
                title={<Space size={8}><WarningOutlined style={{ color: t.warning }} />Session exceptions</Space>}
                extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>Refresh</Button>}
                style={{ marginBottom: 16 }}
            >
                {sessions.length ? (
                    <Table
                        rowKey={(r) => r.session.id} size="small" columns={sessionCols} dataSource={sessions}
                        loading={loading} pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 900 }}
                    />
                ) : (
                    <EmptyState compact title="Nothing to fix" description="No incomplete or unusual sessions." />
                )}
            </Panel>

            <Panel accent={t.danger} title={<Space size={8}><FileExclamationOutlined style={{ color: t.danger }} />Weekly policy flags (this week and last)</Space>}>
                {weekly.length ? (
                    <Table
                        rowKey={(r) => `${r.userId}-${r.weekStart}`} size="small" columns={weeklyCols}
                        dataSource={weekly} loading={loading}
                        pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 890 }}
                    />
                ) : (
                    <EmptyState compact title="No policy flags" description="Reported hours are within verified attendance." />
                )}
            </Panel>
        </div>
    );
}
