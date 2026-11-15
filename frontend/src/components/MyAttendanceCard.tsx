import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Typography, Button, Space, Tag } from 'antd';
import {
    ClockCircleOutlined, ArrowRightOutlined, CheckCircleOutlined,
    FileTextOutlined, HourglassOutlined, HomeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { getCurrent, getMyBalance, type CurrentAttendance, type WeekBalance } from '../api/attendance';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../theme/useTheme';
import { currentWeek } from '../utils/week';
import { Panel, StatCard } from './ui';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The dashboard's attendance summary.

   Deliberately NOT a timer: the live working-time clock lives once, in
   the application header, so there is no second copy to disagree with it.
   What this adds is the week's figures and the reportable balance, with a
   way through to the full read-only history.
   ═══════════════════════════════════════════════════════════════════════ */

export default function MyAttendanceCard() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const [current, setCurrent] = useState<CurrentAttendance | null>(null);
    const [balance, setBalance] = useState<WeekBalance | null>(null);

    const load = useCallback(async () => {
        const [c, b] = await Promise.all([
            getCurrent().catch(() => null),
            getMyBalance(currentWeek()).catch(() => null),
        ]);
        setCurrent(c); setBalance(b);
    }, []);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:changed': () => { void load(); } });

    if (!balance) return null;

    const session = current?.session ?? null;

    return (
        <Panel
            title={<Space size={8}><ClockCircleOutlined style={{ color: t.accent }} />My attendance this week</Space>}
            extra={
                <Space size={8}>
                    {session ? (
                        <Tag color="success" style={{ marginInlineEnd: 0 }}>
                            {session.mode === 'remote' ? 'Remote' : 'On-site'} since {dayjs(session.clockInAt).format('HH:mm')}
                        </Tag>
                    ) : (
                        <Tag style={{ marginInlineEnd: 0 }}>Not clocked in</Tag>
                    )}
                    <Button
                        size="small" type="text" icon={<ArrowRightOutlined />}
                        onClick={() => navigate('/attendance')}
                    >
                        Details
                    </Button>
                </Space>
            }
            accent={session ? t.success : t.accent}
            style={{ marginBottom: 24 }}
        >
            <Row gutter={[16, 16]}>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Verified" value={`${balance.verifiedHours.toFixed(2)} h`}
                        icon={<CheckCircleOutlined />} tone={t.success}
                        hint={`On-site ${balance.onsiteHours.toFixed(2)} h`}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Reported" value={`${balance.reportedHours.toFixed(2)} h`}
                        icon={<FileTextOutlined />} tone={t.purple}
                        hint={balance.reportStatus ?? 'No report filed'}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Remaining reportable"
                        icon={<HourglassOutlined />}
                        value={balance.remainingReportableHours == null
                            ? 'No limit' : `${balance.remainingReportableHours.toFixed(2)} h`}
                        tone={balance.remainingReportableHours != null && balance.remainingReportableHours <= 0
                            ? t.warning : t.accent}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Remote used"
                        icon={<HomeOutlined />}
                        value={balance.remote.allowed
                            ? `${balance.remote.actualHours.toFixed(2)} h` : 'Not allowed'}
                        hint={balance.remote.allowed ? `of ${balance.remote.limitHours.toFixed(2)} h` : undefined}
                        tone={balance.remote.exceeded ? t.danger : undefined}
                    />
                </Col>
            </Row>

            {balance.enforcement && (
                <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginTop: 12 }}>
                    Reports for this week are limited to the {(balance.maxReportableHours ?? 0).toFixed(2)} h
                    that your attendance records verify.
                </Text>
            )}
        </Panel>
    );
}
