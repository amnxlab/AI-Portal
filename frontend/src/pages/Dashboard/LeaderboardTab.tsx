import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    Row, Col, Card, Typography, Spin, Empty, Tooltip, Tag, Segmented, Button, Select,
} from 'antd';
import {
    BarChart, Bar, LineChart, Line,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip, Legend,
    ResponsiveContainer,
} from 'recharts';
import {
    TrophyOutlined, CrownOutlined, StarOutlined, FireOutlined,
    ArrowUpOutlined, ArrowDownOutlined, MinusOutlined,
    SyncOutlined, CheckCircleOutlined, ClockCircleOutlined,
    ThunderboltOutlined, FileTextOutlined, SafetyOutlined,
    TeamOutlined, SwapOutlined, LineChartOutlined,
    CaretDownOutlined, CaretUpOutlined,
} from '@ant-design/icons';
import api from '../../api/axios';
import UserAvatar from '../../components/UserAvatar';
import { alpha } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';

const { Text, Title } = Typography;

/* ── Theme ─────────────────────────────────────────────────────────────── */

function useLeaderboardTheme() {
    const { t } = useTheme();
    return useMemo(() => ({
        cardStyle: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12 } as React.CSSProperties,
        avatarRing: (color: string, size: 'lg' | 'md' | 'sm' | 'xl' = 'md'): React.CSSProperties => {
            const borderW = size === 'xl' ? 4 : size === 'lg' ? 3 : size === 'sm' ? 2 : 3;
            const pad = size === 'xl' ? 4 : size === 'lg' ? 3 : 2;
            return {
                border: `${borderW}px solid ${color}`,
                borderRadius: '50%',
                padding: pad,
                boxShadow: `0 0 ${size === 'xl' ? 24 : size === 'lg' ? 18 : size === 'sm' ? 8 : 12}px ${alpha(color, 0.27)},
                            0 0 ${size === 'xl' ? 48 : size === 'lg' ? 36 : size === 'sm' ? 16 : 24}px ${alpha(color, 0.13)}`,
                background: `linear-gradient(135deg, ${alpha(color, 0.09)}, transparent 60%)`,
                transition: 'box-shadow 0.3s ease, transform 0.3s ease',
            };
        },
        chartTooltipStyle: {
            contentStyle: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, fontSize: 12 },
            labelStyle: { color: t.textMuted },
        },
        medalColor: (rank: number) => {
            if (rank === 1) return t.warning;
            if (rank === 2) return t.textMuted;
            if (rank === 3) return t.orange;
            return t.textMuted;
        },
        breakdownMeta: [
            { key: 'tasks',     label: 'Tasks Done', max: 35, color: t.accent,   icon: <ThunderboltOutlined /> },
            { key: 'onTime',    label: 'On-Time',    max: 25, color: t.success,  icon: <CheckCircleOutlined /> },
            { key: 'cycle',     label: 'Cycle Speed', max: 15, color: t.purple, icon: <ClockCircleOutlined /> },
            { key: 'report',    label: 'Report',     max: 15, color: t.warning, icon: <FileTextOutlined /> },
            { key: 'noOverdue', label: 'No Overdue', max: 10, color: t.orange, icon: <SafetyOutlined /> },
        ],
    }), [t]);
}

const medalIcon = (rank: number) => {
    if (rank === 1) return <CrownOutlined />;
    if (rank === 2) return <StarOutlined />;
    if (rank === 3) return <FireOutlined />;
    return null;
};

const formatWeek = (w: string) => {
    const d = new Date(w + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/* ── Score Gauge Ring ──────────────────────────────────────────────────── */
function ScoreGauge({ score, size = 64, color }: { score: number; size?: number; color: string }) {
    const { t } = useTheme();
    const r = (size - 8) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={t.borderSubtle} strokeWidth={4} />
            <circle cx={size / 2} cy={size / 2} r={r}
                fill="none" stroke={color} strokeWidth={4}
                strokeDasharray={circ} strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
            <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
                fill={t.text} fontSize={size > 50 ? 16 : 13} fontWeight={800}
                style={{ transform: 'rotate(90deg)', transformOrigin: 'center' }}>
                {score}
            </text>
        </svg>
    );
}

/* ── Breakdown Bars ────────────────────────────────────────────────────── */
function BreakdownBars({ breakdown }: { breakdown: Record<string, number> }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {theme.breakdownMeta.map(({ key, label, max, color, icon }) => {
                const val = breakdown[key] ?? 0;
                const pct = Math.round((val / max) * 100);
                return (
                    <Tooltip key={key} title={`${label}: ${val}/${max} pts`}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color, fontSize: 11, width: 14, textAlign: 'center' }}>{icon}</span>
                            <div style={{
                                flex: 1, background: t.borderSubtle, borderRadius: 3, height: 6, overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${pct}%`, height: '100%', background: color,
                                    borderRadius: 3, transition: 'width 0.6s ease',
                                }} />
                            </div>
                            <Text style={{ color: t.textMuted, fontSize: 10, width: 28, textAlign: 'right' }}>
                                {val}
                            </Text>
                        </div>
                    </Tooltip>
                );
            })}
        </div>
    );
}

/* ── Podium Card (Top 3) ───────────────────────────────────────────────── */
function PodiumCard({ entry, highlight }: { entry: any; highlight: boolean }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const rank = entry.rank;
    const mc = theme.medalColor(rank);
    const isFirst = rank === 1;

    return (
        <Card
            style={{
                ...theme.cardStyle,
                border: highlight ? `2px solid ${mc}` : `1px solid ${t.border}`,
                background: isFirst ? `${alpha(mc, 0.03)}` : t.surface,
                position: 'relative',
                overflow: 'hidden',
            }}
            styles={{ body: { padding: '24px 18px' } }}
        >
            {/* Rank badge */}
            <div style={{
                position: 'absolute', top: 10, left: 12,
                display: 'flex', alignItems: 'center', gap: 4,
                color: mc, fontSize: 18,
            }}>
                {medalIcon(rank)}
                <Text style={{ color: mc, fontWeight: 800, fontSize: 14 }}>#{rank}</Text>
            </div>

            {/* Delta indicator */}
            <div style={{ position: 'absolute', top: 12, right: 14 }}>
                {entry.delta > 0 && (
                    <Tag style={{ background: `${alpha(t.success, 0.13)}`, color: t.success, border: 'none', borderRadius: 8, fontSize: 10 }}>
                        <ArrowUpOutlined /> +{entry.delta}
                    </Tag>
                )}
                {entry.delta < 0 && (
                    <Tag style={{ background: `${alpha(t.danger, 0.13)}`, color: t.danger, border: 'none', borderRadius: 8, fontSize: 10 }}>
                        <ArrowDownOutlined /> {entry.delta}
                    </Tag>
                )}
                {entry.delta === 0 && entry.previousScore > 0 && (
                    <Tag style={{ background: `${alpha(t.textMuted, 0.13)}`, color: t.textMuted, border: 'none', borderRadius: 8, fontSize: 10 }}>
                        <MinusOutlined /> 0
                    </Tag>
                )}
            </div>

            {/* Avatar + Name */}
            <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                marginTop: 20, marginBottom: 16,
            }}>
                <div style={{
                    ...theme.avatarRing(mc, isFirst ? 'xl' : 'lg'),
                    marginBottom: 12,
                    position: 'relative',
                }}>
                    <UserAvatar name={entry.fullName} avatarUrl={entry.avatarUrl} size={isFirst ? 96 : 72} userId={entry.id} />
                    {/* Medal badge overlay */}
                    <div style={{
                        position: 'absolute', bottom: -2, right: -2,
                        background: mc, borderRadius: '50%',
                        width: isFirst ? 28 : 24, height: isFirst ? 28 : 24,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 2px 6px ${alpha(mc, 0.4)}`,
                        border: `2px solid ${t.surface}`,
                        fontSize: isFirst ? 14 : 12, color: t.text,
                    }}>
                        {medalIcon(rank)}
                    </div>
                </div>
                <Text style={{ color: t.text, fontWeight: 700, fontSize: isFirst ? 16 : 14, textAlign: 'center' }}>
                    {entry.fullName}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>{entry.jobTitle}</Text>
            </div>

            {/* Score gauge */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                <ScoreGauge score={entry.score} size={isFirst ? 80 : 68} color={mc} />
            </div>

            {/* Breakdown bars */}
            <BreakdownBars breakdown={entry.breakdown} />

            {/* Tasks count */}
            <div style={{
                marginTop: 10, paddingTop: 8, borderTop: `1px solid ${t.border}`,
                textAlign: 'center',
            }}>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                    {entry.breakdown.completedCount} task{entry.breakdown.completedCount !== 1 ? 's' : ''} completed this week
                </Text>
            </div>
        </Card>
    );
}

/* ── Runner-up Row ─────────────────────────────────────────────────────── */
function RunnerUpRow({ entry }: { entry: any }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const mc = theme.medalColor(entry.rank);
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 16px',
            borderBottom: `1px solid ${t.border}`,
            transition: 'background 0.2s ease',
        }}
            onMouseEnter={e => (e.currentTarget.style.background = `${t.surfaceRaised}`)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {/* Rank */}
            <Text style={{ color: mc, fontWeight: 700, fontSize: 14, width: 30, textAlign: 'center' }}>
                #{entry.rank}
            </Text>

            {/* Avatar */}
            <div style={theme.avatarRing(mc, 'sm')}>
                <UserAvatar name={entry.fullName} avatarUrl={entry.avatarUrl} size={44} userId={entry.id} />
            </div>

            {/* Name + role */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13, display: 'block' }} ellipsis>
                    {entry.fullName}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 10 }}>{entry.jobTitle}</Text>
            </div>

            {/* Score */}
            <ScoreGauge score={entry.score} size={40} color={theme.medalColor(entry.rank)} />

            {/* Delta */}
            <div style={{ width: 50, textAlign: 'right' }}>
                {entry.delta > 0 && (
                    <Text style={{ color: t.success, fontSize: 11, fontWeight: 600 }}>
                        <ArrowUpOutlined /> +{entry.delta}
                    </Text>
                )}
                {entry.delta < 0 && (
                    <Text style={{ color: t.danger, fontSize: 11, fontWeight: 600 }}>
                        <ArrowDownOutlined /> {entry.delta}
                    </Text>
                )}
                {entry.delta === 0 && (
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>—</Text>
                )}
            </div>

            {/* Mini breakdown */}
            <div style={{ width: 140 }}>
                <BreakdownBars breakdown={entry.breakdown} />
            </div>
        </div>
    );
}

/* ── Monthly Card ──────────────────────────────────────────────────────── */
function MonthlyEntry({ entry, rank }: { entry: any; rank: number }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const mc = theme.medalColor(rank);
    const isTop3 = rank <= 3;

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderBottom: `1px solid ${t.border}`,
            background: isTop3 ? `${alpha(mc, 0.03)}` : 'transparent',
        }}>
            {/* Rank + medal */}
            <div style={{ width: 36, textAlign: 'center' }}>
                {isTop3 ? (
                    <span style={{ color: mc, fontSize: 18 }}>{medalIcon(rank)}</span>
                ) : (
                    <Text style={{ color: t.textMuted, fontWeight: 700, fontSize: 14 }}>#{rank}</Text>
                )}
            </div>

            {/* Avatar */}
            <div style={isTop3 ? theme.avatarRing(mc, 'sm') : { borderRadius: '50%' }}>
                <UserAvatar name={entry.fullName} avatarUrl={entry.avatarUrl} size={isTop3 ? 52 : 44} userId={entry.id} />
            </div>

            {/* Name */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13, display: 'block' }} ellipsis>
                    {entry.fullName}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 10 }}>{entry.jobTitle}</Text>
            </div>

            {/* Score gauge */}
            <ScoreGauge score={entry.score} size={44} color={mc} />

            {/* Weekly scores sparkbar */}
            <Tooltip title={
                <div>
                    <div style={{ marginBottom: 4, fontWeight: 600 }}>Weekly Scores</div>
                    {entry.weekLabels.map((wl: string, i: number) => (
                        <div key={wl} style={{ fontSize: 11 }}>
                            {formatWeek(wl)}: <span style={{ fontWeight: 600 }}>{entry.weeklyScores[i]}</span>
                        </div>
                    ))}
                    {entry.consistencyBonus > 0 && (
                        <div style={{ marginTop: 4, color: t.success, fontSize: 11 }}>
                            +{entry.consistencyBonus} consistency bonus
                        </div>
                    )}
                </div>
            }>
                <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 28, cursor: 'pointer' }}>
                    {entry.weeklyScores.map((s: number, i: number) => (
                        <div key={i} style={{
                            width: 14, borderRadius: '3px 3px 0 0',
                            height: `${Math.max((s / 100) * 28, 2)}px`,
                            background: s > 0 ? t.success : t.borderSubtle,
                            transition: 'height 0.4s ease',
                        }} />
                    ))}
                </div>
            </Tooltip>

            {/* Stats */}
            <div style={{ textAlign: 'right', minWidth: 80 }}>
                <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>
                    Avg: <span style={{ color: t.text, fontWeight: 600 }}>{entry.avgScore}</span>
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 10 }}>
                    {entry.weeksActive}/4 weeks
                    {entry.consistencyBonus > 0 && (
                        <span style={{ color: t.success }}> +{entry.consistencyBonus}</span>
                    )}
                </Text>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Category Champions — #1 in each scoring dimension
 * ═══════════════════════════════════════════════════════════════════════════ */
function CategoryChampions({ champions }: { champions: any[] }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    if (!champions || champions.length === 0) return null;
    return (
        <Card
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <StarOutlined style={{ color: t.warning, fontSize: 16 }} />
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Category Champions</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, marginLeft: 4 }}>This week's best in each dimension</Text>
                </div>
            }
            style={theme.cardStyle}
            styles={{ body: { padding: '16px 12px' } }}
        >
            <Row gutter={[12, 12]}>
                {champions.map(({ category, champion }) => {
                    const meta = theme.breakdownMeta.find(m => m.key === category);
                    if (!meta || !champion) return null;
                    return (
                        <Col xs={24} sm={12} md={8} lg={4} xl={4} key={category}
                            style={{ minWidth: 170 }}
                        >
                            <div style={{
                                border: `1px solid ${alpha(meta.color, 0.27)}`,
                                borderRadius: 10,
                                padding: '14px 12px',
                                background: `${alpha(meta.color, 0.03)}`,
                                textAlign: 'center',
                                height: '100%',
                            }}>
                                {/* Category icon + label */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
                                    <span style={{ color: meta.color, fontSize: 16 }}>{meta.icon}</span>
                                    <Text style={{ color: meta.color, fontWeight: 700, fontSize: 12 }}>{meta.label}</Text>
                                </div>
                                {/* Champion avatar */}
                                <div style={{
                                    ...theme.avatarRing(meta.color, 'sm'),
                                    display: 'inline-block',
                                    marginBottom: 8,
                                }}>
                                    <UserAvatar
                                        name={champion.fullName}
                                        avatarUrl={champion.avatarUrl}
                                        size={44}
                                        userId={champion.id}
                                    />
                                </div>
                                <Text style={{ color: t.text, fontWeight: 600, fontSize: 12, display: 'block' }} ellipsis>
                                    {champion.fullName}
                                </Text>
                                <Text style={{ color: meta.color, fontWeight: 800, fontSize: 16, display: 'block', marginTop: 2 }}>
                                    {champion.value}/{meta.max}
                                </Text>
                            </div>
                        </Col>
                    );
                })}
            </Row>
        </Card>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Head-to-Head Comparison — Radar chart of two employees
 * ═══════════════════════════════════════════════════════════════════════════ */
function HeadToHead({ weeklyBoard }: { weeklyBoard: any[] }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const [playerA, setPlayerA] = useState<string | null>(null);
    const [playerB, setPlayerB] = useState<string | null>(null);

    const options = useMemo(() =>
        weeklyBoard.map(u => ({ value: u.id, label: u.fullName }))
    , [weeklyBoard]);

    const entryA = weeklyBoard.find(u => u.id === playerA);
    const entryB = weeklyBoard.find(u => u.id === playerB);

    const radarData = useMemo(() =>
        theme.breakdownMeta.map(({ key, label, max }) => ({
            dimension: label,
            [entryA?.fullName ?? 'Player A']: entryA ? Math.round(((entryA.breakdown[key] ?? 0) / max) * 100) : 0,
            [entryB?.fullName ?? 'Player B']: entryB ? Math.round(((entryB.breakdown[key] ?? 0) / max) * 100) : 0,
        }))
    , [entryA, entryB]);

    const nameA = entryA?.fullName ?? 'Player A';
    const nameB = entryB?.fullName ?? 'Player B';

    return (
        <Card
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <SwapOutlined style={{ color: t.purple, fontSize: 16 }} />
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Head-to-Head Comparison</Text>
                </div>
            }
            style={theme.cardStyle}
            styles={{ body: { padding: '16px 20px' } }}
        >
            {/* Selectors */}
            <Row gutter={16} style={{ marginBottom: 20 }}>
                <Col xs={24} sm={11}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {entryA && (
                            <div style={theme.avatarRing(t.accent, 'sm')}>
                                <UserAvatar name={entryA.fullName} avatarUrl={entryA.avatarUrl} size={36} userId={entryA.id} />
                            </div>
                        )}
                        <Select
                            value={playerA}
                            onChange={setPlayerA}
                            options={options.filter(o => o.value !== playerB)}
                            placeholder="Select Employee A"
                            style={{ flex: 1 }}
                            allowClear
                            showSearch
                            filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                            popupMatchSelectWidth={false}
                        />
                    </div>
                </Col>
                <Col xs={24} sm={2} style={{ textAlign: 'center', lineHeight: '36px' }}>
                    <Text style={{ color: t.textMuted, fontSize: 18, fontWeight: 700 }}>VS</Text>
                </Col>
                <Col xs={24} sm={11}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Select
                            value={playerB}
                            onChange={setPlayerB}
                            options={options.filter(o => o.value !== playerA)}
                            placeholder="Select Employee B"
                            style={{ flex: 1 }}
                            allowClear
                            showSearch
                            filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                            popupMatchSelectWidth={false}
                        />
                        {entryB && (
                            <div style={theme.avatarRing(t.success, 'sm')}>
                                <UserAvatar name={entryB.fullName} avatarUrl={entryB.avatarUrl} size={36} userId={entryB.id} />
                            </div>
                        )}
                    </div>
                </Col>
            </Row>

            {entryA && entryB ? (
                <Row gutter={16}>
                    {/* Radar chart */}
                    <Col xs={24} lg={14}>
                        <ResponsiveContainer width="100%" height={300}>
                            <RadarChart data={radarData} outerRadius="72%">
                                <PolarGrid stroke={t.border} />
                                <PolarAngleAxis dataKey="dimension" tick={{ fill: t.textMuted, fontSize: 11 }} />
                                <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: t.textMuted, fontSize: 9 }} />
                                <Radar name={nameA} dataKey={nameA}
                                    stroke={t.accent} fill={t.accent} fillOpacity={0.25} strokeWidth={2} />
                                <Radar name={nameB} dataKey={nameB}
                                    stroke={t.success} fill={t.success} fillOpacity={0.25} strokeWidth={2} />
                                <Legend wrapperStyle={{ fontSize: 11, color: t.textMuted }} />
                                <RechartTooltip {...theme.chartTooltipStyle}
                                    formatter={(v: any, name?: string) => [`${v}%`, name ?? '']} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </Col>
                    {/* Side-by-side stats */}
                    <Col xs={24} lg={10}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0' }}>
                            {/* Overall scores */}
                            <div style={{
                                display: 'flex', justifyContent: 'space-around', alignItems: 'center',
                                padding: '12px 0', borderBottom: `1px solid ${t.border}`,
                            }}>
                                <div style={{ textAlign: 'center' }}>
                                    <ScoreGauge score={entryA.score} size={64} color={t.accent} />
                                    <Text style={{ color: t.text, fontSize: 11, fontWeight: 600, display: 'block', marginTop: 4 }}>
                                        {nameA.split(' ')[0]}
                                    </Text>
                                </div>
                                <Text style={{ color: t.textMuted, fontSize: 20, fontWeight: 800 }}>VS</Text>
                                <div style={{ textAlign: 'center' }}>
                                    <ScoreGauge score={entryB.score} size={64} color={t.success} />
                                    <Text style={{ color: t.text, fontSize: 11, fontWeight: 600, display: 'block', marginTop: 4 }}>
                                        {nameB.split(' ')[0]}
                                    </Text>
                                </div>
                            </div>
                            {/* Per-category comparison */}
                            {theme.breakdownMeta.map(({ key, label, max, color, icon }) => {
                                const valA = entryA.breakdown[key] ?? 0;
                                const valB = entryB.breakdown[key] ?? 0;
                                const winner = valA > valB ? 'A' : valB > valA ? 'B' : null;
                                return (
                                    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Text style={{
                                            color: winner === 'A' ? t.accent : t.textMuted,
                                            fontWeight: winner === 'A' ? 700 : 400,
                                            fontSize: 12, width: 32, textAlign: 'right',
                                        }}>
                                            {valA}
                                        </Text>
                                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            {/* Bar A (right aligned) */}
                                            <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                                                <div style={{
                                                    width: `${(valA / max) * 100}%`,
                                                    height: 6, borderRadius: 3,
                                                    background: t.accent,
                                                    minWidth: valA > 0 ? 3 : 0,
                                                    transition: 'width 0.4s ease',
                                                }} />
                                            </div>
                                            <Tooltip title={`${label} (max ${max})`}>
                                                <span style={{ color, fontSize: 12, width: 16, textAlign: 'center' }}>{icon}</span>
                                            </Tooltip>
                                            {/* Bar B (left aligned) */}
                                            <div style={{ flex: 1 }}>
                                                <div style={{
                                                    width: `${(valB / max) * 100}%`,
                                                    height: 6, borderRadius: 3,
                                                    background: t.success,
                                                    minWidth: valB > 0 ? 3 : 0,
                                                    transition: 'width 0.4s ease',
                                                }} />
                                            </div>
                                        </div>
                                        <Text style={{
                                            color: winner === 'B' ? t.success : t.textMuted,
                                            fontWeight: winner === 'B' ? 700 : 400,
                                            fontSize: 12, width: 32, textAlign: 'left',
                                        }}>
                                            {valB}
                                        </Text>
                                    </div>
                                );
                            })}
                        </div>
                    </Col>
                </Row>
            ) : (
                <div style={{ textAlign: 'center', padding: '30px 0', color: t.textMuted }}>
                    <SwapOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Select two employees above to compare their performance dimensions
                    </Text>
                </div>
            )}
        </Card>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Historical Trend — 12-week score line chart for a user
 * ═══════════════════════════════════════════════════════════════════════════ */
function HistoricalTrend({ entry }: { entry: any }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const history: { week: string; score: number }[] = entry.weeklyHistory ?? [];
    if (history.length < 2) return null;

    const chartData = history.map(h => ({
        week: formatWeek(h.week),
        score: h.score,
    }));

    const scores = history.map(h => h.score).filter(s => s > 0);
    const avg = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const best = scores.length > 0 ? Math.max(...scores) : 0;
    const trend = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : 0;

    return (
        <div style={{
            padding: '12px 16px 16px',
            background: `${t.surfaceRaised}`,
            borderBottom: `1px solid ${t.border}`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <LineChartOutlined style={{ color: t.accent, fontSize: 14 }} />
                <Text style={{ color: t.text, fontWeight: 600, fontSize: 12 }}>
                    {entry.fullName} — 12 Week Trend
                </Text>
                <div style={{ flex: 1 }} />
                <Tag style={{
                    background: `${alpha(t.accent, 0.13)}`, color: t.accent,
                    border: 'none', borderRadius: 6, fontSize: 10,
                }}>
                    Avg: {avg}
                </Tag>
                <Tag style={{
                    background: `${alpha(t.warning, 0.13)}`, color: t.warning,
                    border: 'none', borderRadius: 6, fontSize: 10,
                }}>
                    Best: {best}
                </Tag>
                {trend !== 0 && (
                    <Tag style={{
                        background: trend > 0 ? `${alpha(t.success, 0.13)}` : `${alpha(t.danger, 0.13)}`,
                        color: trend > 0 ? t.success : t.danger,
                        border: 'none', borderRadius: 6, fontSize: 10,
                    }}>
                        {trend > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(trend)} from last week
                    </Tag>
                )}
            </div>
            <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                    <XAxis dataKey="week" tick={{ fill: t.textMuted, fontSize: 9 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: t.textMuted, fontSize: 9 }} width={30} />
                    <RechartTooltip {...theme.chartTooltipStyle}
                        formatter={(v: any) => [`${v}/100`, 'Score']} />
                    <Line type="monotone" dataKey="score" stroke={t.accent} strokeWidth={2}
                        dot={{ fill: t.accent, r: 3 }} activeDot={{ r: 5, fill: t.accent }} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  Team / Project Leaderboard
 * ═══════════════════════════════════════════════════════════════════════════ */
function TeamLeaderboard({ teamBoard }: { teamBoard: any[] }) {
    const { t } = useTheme();
    const theme = useLeaderboardTheme();
    const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

    if (!teamBoard || teamBoard.length === 0) {
        return <Empty description="No team data available" />;
    }

    return (
        <Card
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <TeamOutlined style={{ color: t.accent, fontSize: 16 }} />
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Team / Project Leaderboard</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, marginLeft: 4 }}>Average score per active project</Text>
                </div>
            }
            style={theme.cardStyle}
            styles={{ body: { padding: 0 } }}
        >
            {teamBoard.map((team: any) => {
                const rank = team.rank;
                const mc = theme.medalColor(rank);
                const isExpanded = expandedTeam === team.projectId;

                return (
                    <div key={team.projectId}>
                        {/* Team row */}
                        <div
                            style={{
                                display: 'flex', alignItems: 'center', gap: 14,
                                padding: '14px 16px',
                                borderBottom: `1px solid ${t.border}`,
                                cursor: 'pointer',
                                transition: 'background 0.2s ease',
                                background: rank <= 3 ? `${alpha(mc, 0.02)}` : 'transparent',
                            }}
                            onClick={() => setExpandedTeam(isExpanded ? null : team.projectId)}
                            onMouseEnter={e => { if (rank > 3) e.currentTarget.style.background = t.surfaceRaised; }}
                            onMouseLeave={e => { if (rank > 3) e.currentTarget.style.background = 'transparent'; }}
                        >
                            {/* Rank */}
                            <div style={{ width: 36, textAlign: 'center' }}>
                                {rank <= 3 ? (
                                    <span style={{ color: mc, fontSize: 18 }}>{medalIcon(rank)}</span>
                                ) : (
                                    <Text style={{ color: t.textMuted, fontWeight: 700, fontSize: 14 }}>#{rank}</Text>
                                )}
                            </div>

                            {/* Project name */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Text style={{ color: t.text, fontWeight: 700, fontSize: 14, display: 'block' }} ellipsis>
                                    {team.projectName}
                                </Text>
                                <Text style={{ color: t.textMuted, fontSize: 10 }}>
                                    {team.activeScoredCount} active / {team.memberCount} members
                                </Text>
                            </div>

                            {/* Avg score gauge */}
                            <ScoreGauge score={team.avgScore} size={48} color={mc} />

                            {/* Top member */}
                            {team.topMember && (
                                <Tooltip title={`Top: ${team.topMember.fullName} (${team.topMember.score})`}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <CrownOutlined style={{ color: t.warning, fontSize: 11 }} />
                                        <UserAvatar
                                            name={team.topMember.fullName}
                                            avatarUrl={team.topMember.avatarUrl}
                                            size={28}
                                            userId={team.topMember.id}
                                        />
                                    </div>
                                </Tooltip>
                            )}

                            {/* Mini breakdown */}
                            <div style={{ width: 120 }}>
                                <BreakdownBars breakdown={team.breakdownAvg} />
                            </div>

                            {/* Expand arrow */}
                            <div style={{ color: t.textMuted, fontSize: 12 }}>
                                {isExpanded ? <CaretUpOutlined /> : <CaretDownOutlined />}
                            </div>
                        </div>

                        {/* Expanded: team members */}
                        {isExpanded && (
                            <div style={{
                                background: t.surfaceRaised,
                                borderBottom: `1px solid ${t.border}`,
                                padding: '8px 16px 8px 56px',
                            }}>
                                <div style={{
                                    display: 'flex', flexWrap: 'wrap', gap: 10,
                                }}>
                                    {team.members
                                        .sort((a: any, b: any) => b.score - a.score)
                                        .map((m: any) => (
                                            <Tooltip key={m.id} title={`${m.fullName}: ${m.score}/100`}>
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    padding: '6px 10px',
                                                    background: t.surface,
                                                    borderRadius: 8,
                                                    border: `1px solid ${t.border}`,
                                                }}>
                                                    <UserAvatar
                                                        name={m.fullName}
                                                        avatarUrl={m.avatarUrl}
                                                        size={28}
                                                        userId={m.id}
                                                    />
                                                    <div>
                                                        <Text style={{ color: t.text, fontSize: 11, fontWeight: 600, display: 'block' }}>
                                                            {m.fullName.split(' ')[0]}
                                                        </Text>
                                                        <Text style={{ color: t.accent, fontSize: 10, fontWeight: 700 }}>
                                                            {m.score}
                                                        </Text>
                                                    </div>
                                                </div>
                                            </Tooltip>
                                        ))
                                    }
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </Card>
    );
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  LeaderboardTab — Main Component
 * ═══════════════════════════════════════════════════════════════════════════ */
export default function LeaderboardTab() {
    const theme = useLeaderboardTheme();
    const { t } = useTheme();
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [view, setView] = useState<'weekly' | 'monthly'>('weekly');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

    const load = useCallback(() => {
        setLoading(true);
        api.get('/dashboard/leaderboard')
            .then(res => { setData(res.data); setLastUpdated(new Date()); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Spin size="large" />
            </div>
        );
    }

    if (!data) return <Empty description="Could not load leaderboard data" />;

    const { weeklyBoard, monthlyBoard, currentWeek, scoring, categoryChampions, teamBoard } = data;
    const top3 = weeklyBoard.slice(0, 3);
    const rest = weeklyBoard.slice(3);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* ── Header toolbar ── */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: t.surfaceRaised, borderRadius: 10, padding: '10px 16px',
                border: `1px solid ${t.border}`,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <TrophyOutlined style={{ color: t.warning, fontSize: 18 }} />
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 15 }}>Employee Leaderboard</Text>
                    <Segmented
                        value={view}
                        onChange={(v) => setView(v as any)}
                        options={[
                            { label: 'This Week', value: 'weekly' },
                            { label: 'Monthly', value: 'monthly' },
                        ]}
                        style={{ background: t.surface, fontSize: 12, marginLeft: 8 }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                        Week of {formatWeek(currentWeek)}
                        {lastUpdated && ` · Updated ${lastUpdated.toLocaleTimeString()}`}
                    </Text>
                    <Button
                        icon={<SyncOutlined />} size="small"
                        onClick={load} loading={loading}
                        style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text }}
                    >
                        Refresh
                    </Button>
                </div>
            </div>

            {/* ── Scoring Criteria Legend ── */}
            <div style={{
                display: 'flex', gap: 16, flexWrap: 'wrap',
                padding: '8px 16px', borderRadius: 8,
                background: t.surfaceRaised, border: `1px solid ${t.border}`,
            }}>
                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>Score breakdown:</Text>
                {theme.breakdownMeta.map(({ key, label, max, color, icon }) => (
                    <Tooltip key={key} title={scoring[key]?.description ?? ''}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <span style={{ color, fontSize: 12 }}>{icon}</span>
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>{label}</Text>
                            <Tag style={{
                                fontSize: 9, margin: 0, padding: '0 4px', borderRadius: 6,
                                background: `${alpha(color, 0.13)}`, color, border: 'none', lineHeight: '16px',
                            }}>{max}</Tag>
                        </div>
                    </Tooltip>
                ))}
                <Text style={{ color: t.textMuted, fontSize: 11 }}>= 100 max</Text>
            </div>

            {view === 'weekly' ? (
                <>
                    {/* ══════════════════════════════════════════════
                         Weekly Board — Podium + Rest
                       ══════════════════════════════════════════════ */}
                    {weeklyBoard.length === 0 ? (
                        <Empty description="No scores yet this week" />
                    ) : (
                        <>
                            {/* Top 3 Podium */}
                            <Row gutter={[16, 16]} justify="center">
                                {/* Show in order: 2nd, 1st, 3rd for podium effect */}
                                {[top3[1], top3[0], top3[2]].filter(Boolean).map((entry: any, idx: number) => (
                                    <Col xs={24} sm={12} lg={8} key={entry.id}
                                        style={idx === 1 ? { order: -1 } : {}}
                                    >
                                        <div
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => setExpandedUserId(
                                                expandedUserId === entry.id ? null : entry.id,
                                            )}
                                        >
                                            <PodiumCard entry={entry} highlight={entry.rank <= 2} />
                                        </div>
                                    </Col>
                                ))}
                            </Row>

                            {/* Expanded trend for podium user */}
                            {expandedUserId && top3.find((e: any) => e.id === expandedUserId) && (
                                <Card style={theme.cardStyle} styles={{ body: { padding: 0 } }}>
                                    <HistoricalTrend entry={top3.find((e: any) => e.id === expandedUserId)} />
                                </Card>
                            )}

                            {/* 4th+ as compact list */}
                            {rest.length > 0 && (
                                <Card style={theme.cardStyle} styles={{ body: { padding: 0 } }}>
                                    {rest.map((entry: any) => (
                                        <div key={entry.id}>
                                            <div
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => setExpandedUserId(
                                                    expandedUserId === entry.id ? null : entry.id,
                                                )}
                                            >
                                                <RunnerUpRow entry={entry} />
                                            </div>
                                            {expandedUserId === entry.id && (
                                                <HistoricalTrend entry={entry} />
                                            )}
                                        </div>
                                    ))}
                                </Card>
                            )}

                            {/* Score distribution chart */}
                            {weeklyBoard.length > 1 && (
                                <Card
                                    title={
                                        <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>
                                            Score Distribution
                                        </Text>
                                    }
                                    style={theme.cardStyle}
                                    styles={{ body: { padding: '12px 8px' } }}
                                >
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart
                                            data={weeklyBoard.map((e: any) => ({
                                                name: e.fullName.split(' ')[0],
                                                score: e.score,
                                                fill: theme.medalColor(e.rank),
                                            }))}
                                            barSize={20}
                                        >
                                            <CartesianGrid strokeDasharray="3 3" stroke={t.border} />
                                            <XAxis dataKey="name" tick={{ fill: t.textMuted, fontSize: 10 }} />
                                            <YAxis domain={[0, 100]} tick={{ fill: t.textMuted, fontSize: 10 }} />
                                            <RechartTooltip {...theme.chartTooltipStyle}
                                                formatter={(v: any) => [`${v}/100`, 'Score']} />
                                            <Bar dataKey="score" name="Score" radius={[4, 4, 0, 0]}
                                                fill={t.accent}
                                                shape={(props: any) => {
                                                    const { x, y, width, height, payload } = props;
                                                    return (
                                                        <rect x={x} y={y} width={width} height={height}
                                                            rx={4} ry={4} fill={payload.fill || t.accent} />
                                                    );
                                                }}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </Card>
                            )}

                            {/* ── Category Champions ── */}
                            <CategoryChampions champions={categoryChampions} />

                            {/* ── Head-to-Head Comparison ── */}
                            {weeklyBoard.length >= 2 && (
                                <HeadToHead weeklyBoard={weeklyBoard} />
                            )}

                            {/* ── Team / Project Leaderboard ── */}
                            <TeamLeaderboard teamBoard={teamBoard} />
                        </>
                    )}
                </>
            ) : (
                <>
                    {/* ══════════════════════════════════════════════
                         Monthly Board — Accumulated scores
                       ══════════════════════════════════════════════ */}
                    {monthlyBoard.length === 0 ? (
                        <Empty description="No monthly data yet" />
                    ) : (
                        <>
                            {/* Monthly header */}
                            <div style={{
                                textAlign: 'center', padding: '16px 0',
                            }}>
                                <Title level={4} style={{ color: t.warning, margin: 0 }}>
                                    <TrophyOutlined /> Employee of the Month
                                </Title>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                    Based on last 4 weeks performance · Consistency bonus included
                                </Text>
                            </div>

                            {/* #1 spotlight */}
                            {monthlyBoard[0] && (
                                <Card style={{
                                    ...theme.cardStyle,
                                    border: `2px solid ${t.warning}`,
                                    background: `${alpha(t.warning, 0.03)}`,
                                    textAlign: 'center',
                                    marginBottom: 4,
                                }} styles={{ body: { padding: '32px 28px' } }}>
                                    <div style={{
                                        ...theme.avatarRing(t.warning, 'xl'),
                                        display: 'inline-block', marginBottom: 14,
                                        position: 'relative',
                                    }}>
                                        <UserAvatar
                                            name={monthlyBoard[0].fullName}
                                            avatarUrl={monthlyBoard[0].avatarUrl}
                                            size={110}
                                            userId={monthlyBoard[0].id}
                                        />
                                        {/* Crown overlay */}
                                        <div style={{
                                            position: 'absolute', top: -14, left: '50%',
                                            transform: 'translateX(-50%)',
                                            background: t.warning, borderRadius: '50%',
                                            width: 30, height: 30,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            boxShadow: `0 2px 10px ${alpha(t.warning, 0.53)}`,
                                            border: `2px solid ${t.surface}`,
                                            fontSize: 16, color: t.text,
                                        }}>
                                            <CrownOutlined />
                                        </div>
                                    </div>
                                    <div>
                                        <Title level={4} style={{ color: t.text, margin: '4px 0 2px' }}>
                                            {monthlyBoard[0].fullName}
                                        </Title>
                                        <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 12 }}>
                                            {monthlyBoard[0].jobTitle}
                                        </Text>
                                    </div>
                                    <div style={{
                                        display: 'flex', justifyContent: 'center',
                                        gap: 24, flexWrap: 'wrap',
                                    }}>
                                        <div>
                                            <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Monthly Score</Text>
                                            <Text style={{ color: t.warning, fontSize: 28, fontWeight: 800 }}>
                                                {monthlyBoard[0].score}
                                            </Text>
                                        </div>
                                        <div>
                                            <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Avg / Week</Text>
                                            <Text style={{ color: t.text, fontSize: 28, fontWeight: 800 }}>
                                                {monthlyBoard[0].avgScore}
                                            </Text>
                                        </div>
                                        <div>
                                            <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Weeks Active</Text>
                                            <Text style={{ color: t.text, fontSize: 28, fontWeight: 800 }}>
                                                {monthlyBoard[0].weeksActive}/4
                                            </Text>
                                        </div>
                                        {monthlyBoard[0].consistencyBonus > 0 && (
                                            <div>
                                                <Text style={{ color: t.textMuted, fontSize: 10, display: 'block' }}>Consistency</Text>
                                                <Text style={{ color: t.success, fontSize: 28, fontWeight: 800 }}>
                                                    +{monthlyBoard[0].consistencyBonus}
                                                </Text>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            )}

                            {/* Rest of monthly board */}
                            <Card style={theme.cardStyle} styles={{ body: { padding: 0 } }}>
                                {monthlyBoard.map((entry: any) => (
                                    <MonthlyEntry key={entry.id} entry={entry} rank={entry.rank} />
                                ))}
                            </Card>
                        </>
                    )}
                </>
            )}
        </div>
    );
}
