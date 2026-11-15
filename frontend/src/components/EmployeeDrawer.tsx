import { useState, useEffect, useCallback } from 'react';
import { Drawer, Tabs, Typography, Table, Tag, Row, Col, Space, Alert } from 'antd';
import { IdcardOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getUserSummary, type UserAttendanceSummary, type WeekBalance, type SessionView,
} from '../api/attendance';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../theme/useTheme';
import { Panel, StatCard, LoadingState } from './ui';
import RfidCardSection from './RfidCardSection';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   An employee's record, in the sections the spec asks for: their card,
   their attendance, and what that attendance lets them report.

   Every figure comes from the same central employee row — there is no
   second identity to reconcile and no mapping table. Account fields stay
   in the existing edit dialog; this is everything that hangs off the
   employee rather than describing them.
   ═══════════════════════════════════════════════════════════════════════ */

interface Props {
    open: boolean;
    onClose: () => void;
    userId: string | null;
    fullName: string;
    employeeId?: string | null;
    /** Lets the employee list refresh its RFID status column. */
    onChanged?: () => void;
}

function sourceLabel(s: string) {
    switch (s) {
        case 'rfid': return 'RFID reader';
        case 'online_portal': return 'Portal';
        case 'admin_correction': return 'Correction';
        case 'csv_import': return 'Imported';
        default: return s;
    }
}

function AttendanceSection({ userId }: { userId: string }) {
    const { t } = useTheme();
    const [data, setData] = useState<UserAttendanceSummary | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setData(await getUserSummary(userId).catch(() => null));
        setLoading(false);
    }, [userId]);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:refresh': () => { void load(); } });

    if (loading && !data) return <LoadingState />;
    if (!data) return <Alert type="error" message="Could not load attendance" />;

    const sessionCols: ColumnsType<SessionView> = [
        { title: 'Date', dataIndex: 'clockInAt', width: 130, render: (v: string) => dayjs(v).format('ddd D MMM') },
        { title: 'In', dataIndex: 'clockInAt', width: 80, render: (v: string) => dayjs(v).format('HH:mm') },
        {
            title: 'Out', dataIndex: 'clockOutAt', width: 80,
            render: (v: string | null) => (v ? dayjs(v).format('HH:mm') : <Text style={{ color: t.textFaint }}>—</Text>),
        },
        {
            title: 'Hours', dataIndex: 'hours', width: 80, align: 'right',
            render: (v: number, r) => (r.status === 'closed' ? v.toFixed(2) : <Text style={{ color: t.textFaint }}>—</Text>),
        },
        {
            title: 'Where', dataIndex: 'mode', width: 90,
            render: (v: string) => <Tag color={v === 'remote' ? 'blue' : 'default'}>{v === 'remote' ? 'Remote' : 'On-site'}</Tag>,
        },
        {
            title: 'Source', dataIndex: 'source', width: 120,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{sourceLabel(v)}</Text>,
        },
        {
            title: 'Status', key: 'status', width: 120,
            render: (_, r) => (
                <Space size={4}>
                    <Tag color={r.status === 'closed' ? 'success' : r.status === 'open' ? 'processing' : 'warning'}
                        style={{ marginInlineEnd: 0 }}>
                        {r.status}
                    </Tag>
                    {r.corrected && <Tag color="purple" style={{ marginInlineEnd: 0 }}>fixed</Tag>}
                </Space>
            ),
        },
    ];

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Current session"
                        value={data.currentSession
                            ? (data.currentSession.mode === 'remote' ? 'Remote' : 'On-site') : 'Not clocked in'}
                        tone={data.currentSession ? t.success : t.textMuted}
                        hint={data.currentSession ? `Since ${dayjs(data.currentSession.clockInAt).format('HH:mm')}` : undefined}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard label="All-time hours" value={`${data.allTime.totalHours.toFixed(1)} h`}
                        hint={`${data.allTime.sessions} sessions`} />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard label="On-site" value={`${data.allTime.onsiteHours.toFixed(1)} h`} />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Remote" value={`${data.allTime.remoteHours.toFixed(1)} h`}
                        hint={data.remotePolicy.allowed
                            ? `${data.remotePolicy.percent}% policy → ${data.remotePolicy.limitHours.toFixed(1)} h/week`
                            : 'Not authorised'}
                    />
                </Col>
            </Row>

            <Panel title="Recent sessions">
                <Table
                    rowKey="id" size="small" columns={sessionCols} dataSource={data.recentSessions}
                    pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 760 }}
                />
            </Panel>
        </div>
    );
}

function ReportingSection({ userId }: { userId: string }) {
    const { t } = useTheme();
    const [data, setData] = useState<UserAttendanceSummary | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        getUserSummary(userId).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    }, [userId]);

    if (loading && !data) return <LoadingState />;
    if (!data) return <Alert type="error" message="Could not load reporting figures" />;

    const cols: ColumnsType<WeekBalance> = [
        { title: 'Week', dataIndex: 'weekStart', width: 120, render: (v: string) => dayjs(v).format('D MMM YYYY') },
        {
            title: 'Verified', dataIndex: 'verifiedHours', width: 110, align: 'right',
            render: (v: number) => <Text style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(2)} h</Text>,
        },
        {
            title: 'Reported', key: 'reported', width: 110, align: 'right',
            render: (_, r) => (
                <Text style={{
                    color: r.reportedHours > r.verifiedHours + 0.01 ? t.danger : t.text,
                    fontVariantNumeric: 'tabular-nums',
                }}>
                    {r.reportedHours.toFixed(2)} h
                </Text>
            ),
        },
        {
            title: 'Remaining', key: 'remaining', width: 120, align: 'right',
            render: (_, r) => (
                <Text style={{ color: r.remainingReportableHours == null ? t.textFaint : t.accent, fontVariantNumeric: 'tabular-nums' }}>
                    {r.remainingReportableHours == null ? 'No limit' : `${r.remainingReportableHours.toFixed(2)} h`}
                </Text>
            ),
        },
        {
            title: 'Remote', key: 'remote', width: 140, align: 'right',
            render: (_, r) => (!r.remote.allowed
                ? <Text style={{ color: t.textFaint, fontSize: 12 }}>—</Text>
                : (
                    <Text style={{ color: r.remote.exceeded ? t.danger : t.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                        {r.remote.actualHours.toFixed(2)} / {r.remote.limitHours.toFixed(2)} h
                    </Text>
                )),
        },
        {
            title: 'Report', dataIndex: 'reportStatus', width: 130,
            render: (v: string | null) => (v
                ? <Tag color={v === 'Approved' ? 'success' : v === 'Submitted' ? 'processing' : 'warning'}>{v}</Tag>
                : <Text style={{ color: t.textFaint, fontSize: 12 }}>Not filed</Text>),
        },
        {
            title: 'Capped', dataIndex: 'enforcement', width: 100,
            render: (v: boolean) => (v
                ? <Tag color="blue">Enforced</Tag>
                : <Text style={{ color: t.textFaint, fontSize: 12 }}>No</Text>),
        },
    ];

    const totalVerified = data.weeks.reduce((n, w) => n + w.verifiedHours, 0);
    const totalReported = data.weeks.reduce((n, w) => n + w.reportedHours, 0);

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={8}>
                    <StatCard label="Verified (last 8 weeks)" value={`${totalVerified.toFixed(2)} h`} />
                </Col>
                <Col xs={12} md={8}>
                    <StatCard
                        label="Reported (last 8 weeks)" value={`${totalReported.toFixed(2)} h`}
                        tone={totalReported > totalVerified + 0.01 ? t.danger : undefined}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <StatCard
                        label="This week remaining"
                        value={data.weeks[0]?.remainingReportableHours == null
                            ? 'No limit' : `${data.weeks[0].remainingReportableHours.toFixed(2)} h`}
                        tone={t.accent}
                    />
                </Col>
            </Row>

            <Alert
                type="info" showIcon style={{ marginBottom: 16 }}
                message="Where the limit comes from"
                description={
                    'For an enforced week the employee cannot report more hours than attendance verifies. '
                    + 'The backend checks this when a report is submitted, inside the same transaction that '
                    + 'writes it, so two submissions at once cannot slip past the limit between them.'
                }
            />

            <Panel title="Week by week">
                <Table
                    rowKey="weekStart" size="small" columns={cols} dataSource={data.weeks}
                    pagination={false} scroll={{ x: 840 }}
                />
            </Panel>
        </div>
    );
}

export default function EmployeeDrawer({ open, onClose, userId, fullName, employeeId, onChanged }: Props) {
    const { t } = useTheme();
    const [tab, setTab] = useState('rfid');

    useEffect(() => { if (open) setTab('rfid'); }, [open, userId]);

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={Math.min(1040, typeof window !== 'undefined' ? window.innerWidth : 1040)}
            destroyOnHidden
            title={
                <Space size={10}>
                    <IdcardOutlined style={{ color: t.accent }} />
                    <span>
                        <Text style={{ color: t.text, fontWeight: 700 }}>{fullName}</Text>
                        <Text style={{ color: t.textMuted, fontSize: 12, display: 'block' }}>
                            {employeeId ? `Employee ID ${employeeId}` : 'No Employee ID assigned'}
                        </Text>
                    </span>
                </Space>
            }
        >
            {userId && (
                <Tabs
                    activeKey={tab} onChange={setTab} destroyOnHidden
                    items={[
                        {
                            key: 'rfid', label: 'RFID card',
                            children: <RfidCardSection userId={userId} onChanged={onChanged} />,
                        },
                        {
                            key: 'attendance', label: 'Attendance',
                            children: <AttendanceSection userId={userId} />,
                        },
                        {
                            key: 'reporting', label: 'Reporting',
                            children: <ReportingSection userId={userId} />,
                        },
                    ]}
                />
            )}
        </Drawer>
    );
}
