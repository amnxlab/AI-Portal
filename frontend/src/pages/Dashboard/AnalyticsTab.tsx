import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
    Row, Col, Card, Typography, Spin, Table, Tag, Tooltip, Progress, Empty,
    Button, Input, Segmented,
} from 'antd';
import {
    LineChart, Line, BarChart, Bar, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
    ResponsiveContainer, Legend,
} from 'recharts';
import {
    ThunderboltOutlined, ClockCircleOutlined, DashboardOutlined,
    TeamOutlined, ProjectOutlined, BarChartOutlined,
    ArrowUpOutlined, ArrowDownOutlined,
    WarningOutlined, CheckCircleOutlined, SyncOutlined,
} from '@ant-design/icons';
import api from '../../api/axios';
import UserAvatar from '../../components/UserAvatar';
import { alpha } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

const { Text } = Typography;

/* ── Helpers ───────────────────────────────────────────────────────────── */
const formatWeek = (w: any) => {
    if (!w) return '';
    const raw = String(w);
    const d = new Date(raw.includes('T') ? raw : raw + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

function useAnalyticsTheme() {
    const { t } = useTheme();
    return useMemo(() => ({
        cardStyle: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12 } as React.CSSProperties,
        chartTooltipStyle: {
            contentStyle: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12 },
            labelStyle: { color: t.textMuted },
        },
        riskColor: (score: number) => {
            if (score >= 60) return t.danger;
            if (score >= 35) return t.orange;
            if (score >= 15) return t.warning;
            return t.success;
        },
    }), [t]);
}


/* ── Sparkline ─────────────────────────────────────────────────────────── */
function Sparkline({ data, dataKey, color }: { data: any[]; dataKey: string; color: string }) {
    if (!data?.length) return null;
    return (
        <ResponsiveContainer width="100%" height={32}>
            <BarChart data={data} barSize={6}>
                <Bar dataKey={dataKey} fill={color} radius={[2, 2, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}

/* ── Section header ────────────────────────────────────────────────────── */
function SectionHeader({ icon, text, color, id, extra }: {
    icon: React.ReactNode; text: string; color: string; id?: string; extra?: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <div id={id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: `${alpha(color, 0.09)}`, border: `1px solid ${alpha(color, 0.19)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color, fontSize: 16,
                }}>
                    {icon}
                </div>
                <Text style={{ color: t.text, fontSize: 16, fontWeight: 700 }}>{text}</Text>
            </div>
            {extra}
        </div>
    );
}

/* ── KPI Card ─────────────────────────────────────────────────────────── */
function KpiCard({ label, value, unit, delta, deltaLabel, color, icon, sparkData, sparkKey }: {
    label: string; value: string | number; unit?: string;
    delta?: number; deltaLabel?: string; color: string; icon: React.ReactNode;
    sparkData?: any[]; sparkKey?: string;
}) {
    const { t } = useTheme();
    const { cardStyle } = useAnalyticsTheme();
    const isPos = delta !== undefined && delta > 0;
    const isNeg = delta !== undefined && delta < 0;
    return (
        <Card style={cardStyle} styles={{ body: { padding: '14px 16px' } }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                    <Text style={{ color: t.textMuted, fontSize: 10, display: 'block', marginBottom: 4 }}>{label}</Text>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <Text style={{ color: t.text, fontSize: 26, fontWeight: 800, lineHeight: 1 }}>{value}</Text>
                        {unit && <Text style={{ color: t.textMuted, fontSize: 11 }}>{unit}</Text>}
                    </div>
                    {delta !== undefined && (
                        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {isPos && <ArrowUpOutlined style={{ color: t.success, fontSize: 10 }} />}
                            {isNeg && <ArrowDownOutlined style={{ color: t.danger, fontSize: 10 }} />}
                            <Text style={{
                                color: isPos ? t.success : isNeg ? t.danger : t.textMuted,
                                fontSize: 11, fontWeight: 600,
                            }}>
                                {delta > 0 ? '+' : ''}{delta}%
                            </Text>
                            {deltaLabel && <Text style={{ color: t.textMuted, fontSize: 10 }}>{deltaLabel}</Text>}
                        </div>
                    )}
                </div>
                <div style={{
                    width: 34, height: 34, borderRadius: 10,
                    background: `${alpha(color, 0.08)}`, border: `1px solid ${alpha(color, 0.19)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color, fontSize: 15, flexShrink: 0,
                }}>
                    {icon}
                </div>
            </div>
            {sparkData && sparkKey && (
                <div style={{ marginTop: 8 }}>
                    <Sparkline data={sparkData} dataKey={sparkKey} color={color} />
                </div>
            )}
        </Card>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  AnalyticsTab — Week-based performance analytics
 *  Periods: 2W · 4W · 6W · 8W · 3M (13 weeks)
 * ═══════════════════════════════════════════════════════════════════════════ */
export default function AnalyticsTab() {
    const { t } = useTheme();
    const { cardStyle, chartTooltipStyle, riskColor } = useAnalyticsTheme();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [weeks, setWeeks] = useState(4);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [teamSearch, setTeamSearch] = useState('');

    const load = useCallback(() => {
        setLoading(true);
        api.get(`/dashboard/analytics?weeks=${weeks}`)
            .then(res => { setData(res.data); setLastUpdated(new Date()); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [weeks]);

    useEffect(() => { load(); }, [load]);

    const filteredIndividuals = useMemo(() => {
        if (!data?.individualPerformance) return [];
        if (!teamSearch) return data.individualPerformance;
        const q = teamSearch.toLowerCase();
        return data.individualPerformance.filter((m: any) =>
            m.fullName.toLowerCase().includes(q),
        );
    }, [data, teamSearch]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Spin size="large" />
            </div>
        );
    }

    if (!data) return <Empty description="Could not load analytics data" />;

    const {
        executiveOverview: eo,
        individualPerformance,
        projectPerformance,
        flowDiagnostics: fd,
        weeklyReportsAnalytics: wra,
    } = data;

    const throughputSpark = (fd.throughputTrend as any[]).slice(-8);

    /* ── Individual perf table columns ── */
    const individualColumns = [
        {
            title: 'Member',
            dataIndex: 'fullName',
            key: 'fullName',
            fixed: 'left' as const,
            width: 180,
            render: (_: any, r: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserAvatar name={r.fullName} avatarUrl={r.avatarUrl} size={28} userId={r.id} />
                    <div>
                        <Text style={{ color: t.text, fontSize: 12, fontWeight: 600, display: 'block' }}>{r.fullName}</Text>
                    </div>
                </div>
            ),
        },
        {
            title: 'Active',
            dataIndex: 'activeCount',
            key: 'active',
            width: 70,
            sorter: (a: any, b: any) => a.activeCount - b.activeCount,
            render: (v: number) => <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text>,
        },
        {
            title: 'WIP',
            dataIndex: 'wipCount',
            key: 'wip',
            width: 60,
            sorter: (a: any, b: any) => a.wipCount - b.wipCount,
            render: (v: number) => (
                <Tag style={{
                    background: `${alpha(t.warning, 0.13)}`, color: t.warning,
                    border: `1px solid ${alpha(t.warning, 0.27)}`, borderRadius: 10,
                }}>{v}</Tag>
            ),
        },
        {
            title: 'Overdue',
            dataIndex: 'overdueCount',
            key: 'overdue',
            width: 76,
            sorter: (a: any, b: any) => a.overdueCount - b.overdueCount,
            render: (v: number) =>
                v > 0
                    ? <Tag style={{ background: `${alpha(t.danger, 0.13)}`, color: t.danger, border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 10 }}>{v}</Tag>
                    : <Text style={{ color: t.textMuted }}>0</Text>,
        },
        {
            title: `Done (${weeks}w)`,
            dataIndex: 'totalCompleted',
            key: 'totalCompleted',
            width: 86,
            sorter: (a: any, b: any) => a.totalCompleted - b.totalCompleted,
            render: (v: number) => <Text style={{ color: t.success, fontWeight: 700 }}>{v}</Text>,
        },
        {
            title: 'Avg/wk',
            dataIndex: 'avgPerWeek',
            key: 'avgPerWeek',
            width: 76,
            sorter: (a: any, b: any) => a.avgPerWeek - b.avgPerWeek,
            render: (v: number) => <Text style={{ color: t.accent, fontWeight: 600 }}>{v}</Text>,
        },
        {
            title: 'Cycle',
            dataIndex: 'avgCycleTime',
            key: 'cycle',
            width: 70,
            sorter: (a: any, b: any) => (a.avgCycleTime ?? 999) - (b.avgCycleTime ?? 999),
            render: (v: number | null) =>
                v !== null
                    ? <Text style={{ color: t.text }}>{v}d</Text>
                    : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Weekly Trend',
            dataIndex: 'weeklyData',
            key: 'trend',
            width: 140,
            render: (weeklyData: any[]) => (
                <Sparkline data={weeklyData} dataKey="completed" color={t.success} />
            ),
        },
    ];

    /* ── Project perf table columns ── */
    const projectColumns = [
        {
            title: 'Project',
            dataIndex: 'name',
            key: 'name',
            fixed: 'left' as const,
            width: 180,
            render: (_: any, r: any) => (
                <div>
                    <Text style={{ color: t.text, fontSize: 12, fontWeight: 600, display: 'block' }}>{r.name}</Text>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                        <Tag style={{
                            fontSize: 9, margin: 0, borderRadius: 8,
                            background: `${alpha(r.status === 'Active' ? t.success : t.warning, 0.13)}`,
                            color: r.status === 'Active' ? t.success : t.warning,
                            border: `1px solid ${alpha(r.status === 'Active' ? t.success : t.warning, 0.27)}`,
                        }}>{r.status}</Tag>
                    </div>
                </div>
            ),
        },
        {
            title: 'Progress',
            dataIndex: 'completionPct',
            key: 'progress',
            width: 130,
            sorter: (a: any, b: any) => a.completionPct - b.completionPct,
            render: (pct: number, r: any) => (
                <Tooltip title={`${r.done}/${r.total} tasks done`}>
                    <Progress
                        percent={pct} size="small"
                        strokeColor={t.success} trailColor={t.borderSubtle}
                        format={p => <Text style={{ color: t.textMuted, fontSize: 10 }}>{p}%</Text>}
                    />
                </Tooltip>
            ),
        },
        {
            title: 'Risk',
            dataIndex: 'riskScore',
            key: 'risk',
            width: 60,
            sorter: (a: any, b: any) => a.riskScore - b.riskScore,
            render: (v: number) => (
                <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: `2px solid ${riskColor(v)}`,
                    background: `${alpha(riskColor(v), 0.08)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Text style={{ color: riskColor(v), fontWeight: 800, fontSize: 11 }}>{v}</Text>
                </div>
            ),
        },
        {
            title: 'In Prog',
            dataIndex: 'inProgress',
            key: 'inProgress',
            width: 68,
            render: (v: number) => <Tag style={{ background: `${alpha(t.warning, 0.13)}`, color: t.warning, border: `1px solid ${alpha(t.warning, 0.27)}`, borderRadius: 10 }}>{v}</Tag>,
        },
        {
            title: 'Blocked',
            dataIndex: 'blocked',
            key: 'blocked',
            width: 74,
            render: (v: number) => v > 0
                ? <Tag style={{ background: `${alpha(t.danger, 0.13)}`, color: t.danger, border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 10 }}>{v}</Tag>
                : <Text style={{ color: t.textMuted }}>0</Text>,
        },
        {
            title: 'Overdue',
            dataIndex: 'overdue',
            key: 'overdue',
            width: 74,
            render: (v: number) => v > 0
                ? <Tag style={{ background: `${alpha(t.danger, 0.13)}`, color: t.danger, border: `1px solid ${alpha(t.danger, 0.27)}`, borderRadius: 10 }}>{v}</Tag>
                : <Text style={{ color: t.textMuted }}>0</Text>,
        },
        {
            title: 'Avg/wk',
            dataIndex: 'avgCompletedPerWeek',
            key: 'avgWk',
            width: 76,
            sorter: (a: any, b: any) => a.avgCompletedPerWeek - b.avgCompletedPerWeek,
            render: (v: number) => <Text style={{ color: t.accent, fontWeight: 600 }}>{v}</Text>,
        },
        {
            title: 'Cycle',
            dataIndex: 'avgCycleTime',
            key: 'cycle',
            width: 60,
            render: (v: number | null) =>
                v !== null
                    ? <Text style={{ color: t.text }}>{v}d</Text>
                    : <Text style={{ color: t.textMuted }}>—</Text>,
        },
        {
            title: 'Hours (Est/Act)',
            key: 'hours',
            width: 120,
            render: (_: any, r: any) => {
                const effPct = r.estimatedHours > 0
                    ? Math.round((r.actualHours / r.estimatedHours) * 100) : null;
                return (
                    <div>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            {r.estimatedHours}h / {r.actualHours}h
                        </Text>
                        {effPct !== null && (
                            <Tag style={{
                                fontSize: 9, borderRadius: 8, margin: '0 0 0 6px',
                                background: effPct > 120 ? `${alpha(t.danger, 0.13)}` : `${alpha(t.success, 0.13)}`,
                                color: effPct > 120 ? t.danger : t.success,
                                border: `1px solid ${alpha(effPct > 120 ? t.danger : t.success, 0.27)}`,
                            }}>{effPct}%</Tag>
                        )}
                    </div>
                );
            },
        },
        {
            title: 'Weekly Trend',
            dataIndex: 'weeklyData',
            key: 'trend',
            width: 140,
            render: (weeklyData: any[]) => (
                <Sparkline data={weeklyData} dataKey="completed" color={t.success} />
            ),
        },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>

            {/* ── Toolbar: period selector + refresh ── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: t.surfaceRaised, borderRadius: 10, padding: '10px 16px',
                border: `1px solid ${t.border}`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>Period:</Text>
                    <Segmented
                        value={weeks}
                        onChange={(v) => setWeeks(Number(v))}
                        options={[
                            { label: '2W', value: 2 },
                            { label: '4W', value: 4 },
                            { label: '6W', value: 6 },
                            { label: '8W', value: 8 },
                            { label: '3M', value: 13 },
                        ]}
                        style={{ background: t.surface, fontSize: 12 }}
                    />
                    {eo?.periodLabel && (
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>{eo.periodLabel}</Text>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {lastUpdated && (
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            Updated {lastUpdated.toLocaleTimeString()}
                        </Text>
                    )}
                    <Button
                        icon={<SyncOutlined />}
                        size="small"
                        onClick={load}
                        loading={loading}
                        style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }}
                    >
                        Refresh
                    </Button>
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════
                 1. Executive Overview — 5 focused KPI cards
               ══════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader id="exec" icon={<DashboardOutlined />} text="Weekly Overview" color={t.accent} />
                <Row gutter={[12, 12]}>
                    <Col xs={12} sm={8} lg={5}>
                        <KpiCard label="Throughput" value={eo.throughput} unit="tasks/wk"
                            color={t.accent} icon={<ThunderboltOutlined />}
                            sparkData={throughputSpark} sparkKey="count" />
                    </Col>
                    <Col xs={12} sm={8} lg={5}>
                        <KpiCard label="Velocity" value={eo.thisWeekCompleted} unit="this wk"
                            delta={eo.velocityDelta} deltaLabel="vs prev wk"
                            color={t.success} icon={<ThunderboltOutlined />} />
                    </Col>
                    <Col xs={12} sm={8} lg={5}>
                        <KpiCard label="Avg Cycle Time" value={eo.avgCycleTime} unit="days"
                            color={t.purple} icon={<ClockCircleOutlined />} />
                    </Col>
                    <Col xs={12} sm={8} lg={5}>
                        <KpiCard label="Active / WIP" value={`${eo.totalActive}`} unit={`(${eo.wipCount} in progress)`}
                            color={t.warning} icon={<DashboardOutlined />} />
                    </Col>
                    <Col xs={12} sm={8} lg={4}>
                        <KpiCard label="Overdue" value={eo.overdueRate} unit="%"
                            color={eo.overdueRate > 20 ? t.danger : t.success}
                            icon={<WarningOutlined />} />
                    </Col>
                </Row>
            </div>

            {/* ══════════════════════════════════════════════════════
                 2. Project Performance — table with sparklines
               ══════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader id="projects" icon={<ProjectOutlined />} text="Project Performance" color={t.orange} />
                {projectPerformance.length === 0 ? (
                    <Empty description="No active projects" />
                ) : (
                    <Card style={cardStyle} styles={{ body: { padding: 0 } }}>
                        <Table
                            dataSource={projectPerformance}
                            columns={projectColumns}
                            rowKey="id"
                            pagination={false}
                            size="small"
                            scroll={{ x: 1000 }}
                            style={{ background: 'transparent' }}
                        />
                    </Card>
                )}
            </div>

            {/* ══════════════════════════════════════════════════════
                 3. Individual Performance — table with sparklines
               ══════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader
                    id="team"
                    icon={<TeamOutlined />}
                    text="Individual Performance"
                    color={t.success}
                    extra={
                        <Input.Search
                            placeholder="Filter by name or role"
                            size="small"
                            allowClear
                            value={teamSearch}
                            onChange={e => setTeamSearch(e.target.value)}
                            onSearch={v => setTeamSearch(v)}
                            style={{ width: 220 }}
                        />
                    }
                />
                {individualPerformance.length === 0 ? (
                    <Empty description="No performance data" />
                ) : (
                    <Card style={cardStyle} styles={{ body: { padding: 0 } }}>
                        <Table
                            dataSource={filteredIndividuals}
                            columns={individualColumns}
                            rowKey="id"
                            pagination={false}
                            size="small"
                            scroll={{ x: 900 }}
                            style={{ background: 'transparent' }}
                        />
                    </Card>
                )}
            </div>

            {/* ══════════════════════════════════════════════════════
                 4. Flow Diagnostics — Throughput + Cycle + Overdue
               ══════════════════════════════════════════════════════ */}
            <div>
                <SectionHeader id="flow" icon={<BarChartOutlined />} text="Weekly Trends" color={t.purple} />
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={8}>
                        <Card title={<Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Throughput</Text>}
                            style={cardStyle} styles={{ body: { padding: '12px 8px' } }}>
                            <ResponsiveContainer width="100%" height={200}>
                                <BarChart data={fd.throughputTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                    <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <YAxis allowDecimals={false} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <RechartTooltip {...chartTooltipStyle} labelFormatter={formatWeek} />
                                    <Bar dataKey="count" name="Completed" fill={t.success} radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card title={<Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Cycle Time</Text>}
                            style={cardStyle} styles={{ body: { padding: '12px 8px' } }}>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={fd.cycleTimeTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                    <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <RechartTooltip {...chartTooltipStyle} labelFormatter={formatWeek}
                                        formatter={(v: any) => [`${v} days`, 'Avg Cycle Time']} />
                                    <Line type="monotone" dataKey="avg" name="Days" stroke={t.purple}
                                        strokeWidth={2} dot={{ fill: t.purple, r: 3 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card title={<Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Overdue Trend</Text>}
                            style={cardStyle} styles={{ body: { padding: '12px 8px' } }}>
                            <ResponsiveContainer width="100%" height={200}>
                                <AreaChart data={fd.overdueTrend}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                    <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <YAxis allowDecimals={false} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                    <RechartTooltip {...chartTooltipStyle} labelFormatter={formatWeek} />
                                    <Area type="monotone" dataKey="count" name="Overdue Tasks"
                                        stroke={t.danger} fill={`${alpha(t.danger, 0.2)}`} strokeWidth={2} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </Card>
                    </Col>
                </Row>
            </div>

            {/* ══════════════════════════════════════════════════════
                 5. Report Insights — Hours & Submission (compact)
               ══════════════════════════════════════════════════════ */}
            {wra && wra.length > 0 && (
                <div>
                    <SectionHeader id="reports" icon={<CheckCircleOutlined />} text="Report Insights" color={t.warning} />
                    <Row gutter={[16, 16]}>
                        <Col xs={24} lg={12}>
                            <Card title={<Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Hours Reported / Week</Text>}
                                style={cardStyle} styles={{ body: { padding: '12px 8px' } }}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <BarChart data={wra}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                        <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} />
                                        <RechartTooltip {...chartTooltipStyle} labelFormatter={formatWeek} />
                                        <Bar dataKey="totalHours" name="Total Hours" fill={t.accent} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                        <Col xs={24} lg={12}>
                            <Card title={<Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>Submission Rate & Avg Hours</Text>}
                                style={cardStyle} styles={{ body: { padding: '12px 8px' } }}>
                                <ResponsiveContainer width="100%" height={180}>
                                    <LineChart data={wra}>
                                        <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                        <XAxis dataKey="week" tickFormatter={formatWeek} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                        <YAxis tick={{ fill: t.textMuted, fontSize: 10 }} />
                                        <RechartTooltip {...chartTooltipStyle} labelFormatter={formatWeek} />
                                        <Legend wrapperStyle={{ fontSize: 11, color: t.textMuted }} />
                                        <Line type="monotone" dataKey="submissionRate" name="Submission %"
                                            stroke={t.success} strokeWidth={2} dot={{ fill: t.success, r: 3 }} />
                                        <Line type="monotone" dataKey="avgHoursPerUser" name="Avg Hrs/User"
                                            stroke={t.warning} strokeWidth={2} dot={{ fill: t.warning, r: 3 }} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </Card>
                        </Col>
                    </Row>
                </div>
            )}

        </div>
    );
}
