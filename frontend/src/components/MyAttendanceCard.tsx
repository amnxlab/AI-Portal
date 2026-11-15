import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Typography, Tag, Progress, Tooltip } from 'antd';
import {
    ClockCircleOutlined, CheckCircleOutlined,
    HourglassOutlined, HomeOutlined, CalendarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
    getCurrent, getMyBalance, getMyHistory,
    type CurrentAttendance, type WeekBalance, type MyHistory,
} from '../api/attendance';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../theme/useTheme';
import { space, fontSize } from '../theme/tokens';
import { currentWeek } from '../utils/week';
import { Panel, StatCard } from './ui';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The dashboard's attendance summary.

   Deliberately NOT a timer: the live working-time clock lives once, in the
   application header, so there is no second copy to disagree with it.

   Laid out to be read in one glance, in three steps rather than as a grid of
   equally loud numbers:

     1. the week and the month, side by side -- the two figures people
        actually come here for;
     2. one bar showing how much of the reportable allowance is left, because
        "4.00 of 20.00 h" is a proportion and a proportion should be drawn;
     3. the remote allowance, only when there is one.

   It previously showed seven stat tiles of identical weight, which made the
   two numbers that matter no easier to find than the five that support them.
   The same three-tile-then-bar shape is used on the My Attendance tab, so
   moving between the two does not feel like moving between two applications.
   ═══════════════════════════════════════════════════════════════════════ */

export default function MyAttendanceCard() {
    const { t } = useTheme();
    const [current, setCurrent] = useState<CurrentAttendance | null>(null);
    const [balance, setBalance] = useState<WeekBalance | null>(null);
    /** Month to date: the figure people mean when they ask how much they have worked. */
    const [month, setMonth] = useState<MyHistory | null>(null);

    const load = useCallback(async () => {
        const [c, b, m] = await Promise.all([
            getCurrent().catch(() => null),
            getMyBalance(currentWeek()).catch(() => null),
            // Caught separately: a failure here costs the month tile, not the card.
            getMyHistory(
                dayjs().startOf('month').format('YYYY-MM-DD'),
                dayjs().format('YYYY-MM-DD'),
            ).catch(() => null),
        ]);
        setCurrent(c); setBalance(b); setMonth(m);
    }, []);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:changed': () => { void load(); } });

    if (!balance) return null;

    const session = current?.session ?? null;
    const remote = balance.remote;

    // How much of the reportable allowance is used. Null when uncapped, in
    // which case the bar is not drawn at all rather than drawn as empty.
    const cap = balance.maxReportableHours ?? null;
    const usedPct = cap && cap > 0
        ? Math.min(100, Math.round((balance.verifiedHours / cap) * 100))
        : null;
    const remotePct = remote.allowed && remote.limitHours > 0
        ? Math.min(100, Math.round((remote.actualHours / remote.limitHours) * 100))
        : null;

    const monthDays = month?.days.length ?? 0;

    /** One slim labelled bar. Two of these read better than two more tiles. */
    const meter = (
        icon: React.ReactNode, label: string, pct: number,
        figure: string, note: string, tone: string,
    ) => (
        <div style={{
            display: 'flex', alignItems: 'center', gap: space.sm,
            flexWrap: 'wrap', marginTop: space.sm,
        }}>
            <span style={{ color: tone, fontSize: fontSize.base, flexShrink: 0 }}>{icon}</span>
            <Text style={{ color: t.textMuted, fontSize: fontSize.xs, flexShrink: 0, minWidth: 78 }}>
                {label}
            </Text>
            <Progress
                percent={pct} showInfo={false}
                strokeColor={pct >= 90 ? t.warning : tone}
                trailColor={t.surfaceSunken}
                size="small"
                style={{ flex: '1 1 120px', margin: 0, minWidth: 90 }}
            />
            <Text style={{
                color: t.text, fontSize: fontSize.sm, fontWeight: 600,
                fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            }}>
                {figure}
            </Text>
            <Text style={{ color: t.textFaint, fontSize: fontSize.xs, flexShrink: 0 }}>
                {note}
            </Text>
        </div>
    );

    return (
        <Panel
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <ClockCircleOutlined style={{ color: t.accent }} />My attendance
                </span>
            }
            extra={
                /*
                 * Status only. There was a "Details" link to /attendance here,
                 * but this card is shown to everyone and that page is not
                 * everyone's to open -- so for most of the people who can see
                 * the card, the link led somewhere they could not go.
                 */
                session ? (
                    <Tag color="success" style={{ marginInlineEnd: 0 }}>
                        {session.mode === 'remote' ? 'Remote' : 'On-site'} since {dayjs(session.clockInAt).format('HH:mm')}
                    </Tag>
                ) : (
                    <Tag style={{ marginInlineEnd: 0 }}>Not clocked in</Tag>
                )
            }
            accent={session ? t.success : t.accent}
            style={{ marginBottom: 24 }}
        >
            {/* The two figures people come for, then the one that constrains them. */}
            <Row gutter={[space.sm, space.sm]}>
                <Col xs={12} md={8}>
                    <StatCard
                        compact
                        label="This week"
                        value={`${balance.verifiedHours.toFixed(2)} h`}
                        icon={<CheckCircleOutlined />} tone={t.success}
                        hint={`On-site ${balance.onsiteHours.toFixed(2)} h · remote ${remote.creditedHours.toFixed(2)} h`}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <StatCard
                        compact
                        label={`${dayjs().format('MMMM')} so far`}
                        value={month ? `${month.totalHours.toFixed(2)} h` : '—'}
                        icon={<CalendarOutlined />} tone={t.accent}
                        hint={month
                            ? monthDays === 0
                                ? 'No days worked yet'
                                : `${monthDays} day${monthDays === 1 ? '' : 's'} · `
                                  + `${(month.totalHours / monthDays).toFixed(2)} h a day`
                            : 'Unavailable'}
                    />
                </Col>
                <Col xs={24} md={8}>
                    <StatCard
                        compact
                        label="Remaining reportable"
                        icon={<HourglassOutlined />}
                        value={balance.remainingReportableHours == null
                            ? 'No limit'
                            : `${balance.remainingReportableHours.toFixed(2)} h`}
                        tone={balance.remainingReportableHours != null && balance.remainingReportableHours <= 0
                            ? t.warning : t.accent}
                        hint={cap == null
                            ? 'No weekly cap set'
                            : `Of ${cap.toFixed(2)} h · reported ${balance.reportedHours.toFixed(2)} h`}
                    />
                </Col>
            </Row>

            {/* Proportions, drawn rather than spelled out. */}
            {usedPct != null && meter(
                <HourglassOutlined />, 'Reportable', usedPct,
                `${balance.verifiedHours.toFixed(2)} / ${cap!.toFixed(2)} h`,
                `${usedPct}% of the week`, t.accent,
            )}
            {remote.allowed && remotePct != null && meter(
                <HomeOutlined />, 'Remote', remotePct,
                `${remote.actualHours.toFixed(2)} / ${remote.limitHours.toFixed(2)} h`,
                remote.exceeded ? 'over the allowance' : `${remote.percent}% of the week`,
                remote.exceeded ? t.danger : t.info,
            )}

            {balance.enforcement && cap != null && (
                <Tooltip title="Set by the attendance policy. Hours beyond this cannot be reported for this week.">
                    <Text style={{
                        color: t.textFaint, fontSize: fontSize.xs,
                        display: 'block', marginTop: space.sm,
                    }}>
                        Reports this week are limited to {cap.toFixed(2)} h.
                    </Text>
                </Tooltip>
            )}
        </Panel>
    );
}
