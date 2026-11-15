import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Card, Statistic, Table, Spin, Alert, Tag, Progress, Typography, Button, Space, Tooltip, message } from 'antd';
import { DollarOutlined, BankOutlined, ArrowDownOutlined, RiseOutlined, FilePdfOutlined, BarChartOutlined } from '@ant-design/icons';
import { getOverview, getSustainability, exportAccountReportPdf } from '../../../api/budget';
import type { OverviewData, SustainabilityInfo } from '../../../api/budget';
import { AreaChart, Area, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer } from 'recharts';
import { alpha } from '../../../theme/tokens';
import { useTheme } from '../../../theme/useTheme';
import { useBudgetYear } from '../BudgetYearContext';

const { Text } = Typography;

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
};


const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OverviewTab() {
    const { selectedId } = useBudgetYear();
    const { t } = useTheme();
    const navigate = useNavigate();
    const [overview, setOverview] = useState<OverviewData | null>(null);
    const [sustainability, setSustainability] = useState<SustainabilityInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [exportingId, setExportingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [ov, sus] = await Promise.all([getOverview(selectedId), getSustainability(selectedId)]);
            setOverview(ov);
            setSustainability(sus);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load overview');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    const handleExportAccount = useCallback(async (acct: { id: string; name: string }) => {
        setExportingId(acct.id);
        try {
            const res = await exportAccountReportPdf(acct.id, true);
            const date = new Date().toISOString().split('T')[0];
            const slug = acct.name.toLowerCase().replace(/\s+/g, '-');
            downloadBlob(new Blob([res.data], { type: 'application/pdf' }), `account-statement-${slug}-${date}.pdf`);
        } catch {
            message.error('Export failed');
        } finally {
            setExportingId(null);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loading) return <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />;
    if (error) return <Alert type="error" message={error} />;
    if (!overview) return null;

    const totalMonthlyBurn = sustainability?.totalMonthlyBurnRate ?? 0;

    const accountColumns = [
        {
            title: 'Account', dataIndex: 'name', key: 'name',
            render: (v: string, r: any) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text>
                    {r.description && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 1 }}>{r.description}</div>}
                </div>
            ),
        },
        {
            title: 'Category', dataIndex: 'category', key: 'category',
            render: (v: string) => {
                const isLabor = v === 'Labor';
                const color = isLabor ? t.accent : t.success;
                return (
                    <Tag style={{ background: `${alpha(color, 0.09)}`, border: `1px solid ${alpha(color, 0.27)}`, color }}>
                        {isLabor ? 'Labor Pool' : 'Project Spending'}
                    </Tag>
                );
            },
        },
        {
            title: 'Funding Source', dataIndex: 'fundingSource', key: 'fs',
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
        },
        {
            title: 'Allocated', dataIndex: 'totalAllocated', key: 'alloc', align: 'right' as const,
            render: (v: number) => <Text style={{ color: t.text }}>{fmt(v)}</Text>,
        },
        {
            title: 'Spent', key: 'spent', align: 'right' as const,
            render: (_: any, r: any) => {
                const spent = Number(r.totalAllocated) - Number(r.balance);
                return <Text style={{ color: t.danger, fontWeight: 600 }}>{fmt(spent)}</Text>;
            },
        },
        {
            title: 'Balance', dataIndex: 'balance', key: 'bal', align: 'right' as const,
            render: (v: number) => (
                <Text style={{ color: v < 0 ? t.danger : t.success, fontWeight: 700 }}>{fmt(v)}</Text>
            ),
        },
        {
            title: 'Usage', key: 'usage',
            render: (_: any, r: any) => {
                const used = Number(r.totalAllocated) - Number(r.balance);
                const pct = Number(r.totalAllocated) > 0 ? Math.round((used / Number(r.totalAllocated)) * 100) : 0;
                const color = pct > 90 ? t.danger : pct > 70 ? t.warning : t.success;
                return (
                    <div style={{ minWidth: 90 }}>
                        <div style={{ color, fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{pct}%</div>
                        <Progress percent={pct} size="small" showInfo={false}
                            strokeColor={color} trailColor={t.surfaceRaised} />
                    </div>
                );
            },
        },
        {
            title: 'Actions', key: 'actions', align: 'center' as const, width: 130,
            render: (_: any, r: any) => (
                <Space size={6}>
                    <Tooltip title="View full account statement">
                        <Button
                            size="small"
                            icon={<BarChartOutlined />}
                            onClick={() => navigate(`/budget?tab=reports&account=${r.id}`)}
                            style={{ borderColor: t.accent, color: t.accent, background: `${alpha(t.accent, 0.07)}` }}
                        />
                    </Tooltip>
                    <Tooltip title="Export account statement PDF">
                        <Button
                            size="small"
                            icon={<FilePdfOutlined />}
                            loading={exportingId === r.id}
                            onClick={() => handleExportAccount(r)}
                            style={{ borderColor: t.danger, color: t.danger, background: `${alpha(t.danger, 0.07)}` }}
                        />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    const poolColumns = [
        { title: 'Pool', dataIndex: 'accountName', key: 'name' },
        { title: 'Source', dataIndex: 'fundingSource', key: 'fs' },
        { title: 'Balance', dataIndex: 'balance', key: 'bal', render: fmt },
        { title: 'Monthly Burn', dataIndex: 'monthlyBurnRate', key: 'burn', render: fmt },
        {
            title: 'Runway', dataIndex: 'runwayMonths', key: 'runway', render: (v: number | null) =>
                v !== null ? <Text style={{ color: v < 3 ? t.danger : v < 6 ? t.warning : t.success }}>{Number(v).toFixed(1)} mo</Text> : '—'
        },
        { title: 'Exhaustion Date', dataIndex: 'projectedExhaustionDate', key: 'date', render: (v: string | null) => v ?? '—' },
    ];

    // Simple spend chart: just show account allocations vs balances
    const chartData = overview.accountSummaries.map(a => ({
        name: a.name.length > 15 ? a.name.slice(0, 15) + '…' : a.name,
        allocated: Number(a.totalAllocated),
        balance: Number(a.balance),
    }));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* KPI Cards */}
            <Row gutter={[16, 16]}>
                {[
                    { title: 'Total Allocated', value: Number(overview.totalAllocated), icon: <BankOutlined />, color: t.accent },
                    { title: 'Current Balance', value: Number(overview.totalBalance), icon: <DollarOutlined />, color: t.success },
                    { title: 'Labor Deducted', value: Number(overview.totalLaborDeducted), icon: <ArrowDownOutlined />, color: t.warning },
                    { title: 'Total Expenses', value: Number(overview.totalExpenses), icon: <RiseOutlined />, color: t.danger },
                ].map((kpi) => (
                    <Col xs={24} sm={12} lg={6} key={kpi.title}>
                        <Card style={{ background: t.surface, border: `1px solid ${t.border}` }}>
                            <Statistic
                                title={<span style={{ color: t.textMuted }}>{kpi.title}</span>}
                                value={kpi.value}
                                prefix={<span style={{ color: kpi.color }}>{kpi.icon}</span>}
                                formatter={(v) => fmt(Number(v))}
                                valueStyle={{ color: t.text }}
                            />
                        </Card>
                    </Col>
                ))}
            </Row>

            {/* Sustainability Cards */}
            {sustainability && sustainability.pools.length > 0 && (
                <Card
                    title={<span style={{ color: t.text }}>Financial Sustainability</span>}
                    style={{ background: t.surface, border: `1px solid ${t.border}` }}
                >
                    <div style={{ marginBottom: 12 }}>
                        <Text style={{ color: t.textMuted }}>Total Monthly Labor Burn Rate: </Text>
                        <Text strong style={{ color: t.warning }}>{fmt(totalMonthlyBurn)}/mo</Text>
                    </div>
                    <Table
                        dataSource={sustainability.pools}
                        columns={poolColumns}
                        rowKey="accountId"
                        size="small"
                        pagination={false}
                    />
                </Card>
            )}

            {/* Balance Chart */}
            {chartData.length > 0 && (
                <Card
                    title={<span style={{ color: t.text }}>Account Allocations vs Balance</span>}
                    style={{ background: t.surface, border: `1px solid ${t.border}` }}
                >
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <XAxis dataKey="name" stroke={t.textMuted} tick={{ fill: t.textMuted, fontSize: 11 }} />
                            <YAxis stroke={t.textMuted} tick={{ fill: t.textMuted, fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                            <ReTooltip formatter={(v: any) => fmt(v)} contentStyle={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, color: t.text }} />
                            <Area type="monotone" dataKey="allocated" stroke={t.accent} fill={t.accent + '22'} name="Allocated" />
                            <Area type="monotone" dataKey="balance" stroke={t.success} fill={t.success + '22'} name="Balance" />
                        </AreaChart>
                    </ResponsiveContainer>
                </Card>
            )}

            {/* Account Summary Table */}
            <Card
                title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: t.text }}>Budget Accounts Summary</span>
                        <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 400 }}>
                            Click <BarChartOutlined style={{ color: t.accent }} /> to view full statement &nbsp;·&nbsp;
                            <FilePdfOutlined style={{ color: t.danger }} /> to export PDF
                        </Text>
                    </div>
                }
                style={{ background: t.surface, border: `1px solid ${t.border}` }}
            >
                <div style={{ border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden' }}>
                    <Table
                        dataSource={overview.accountSummaries}
                        columns={accountColumns}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        onRow={() => ({ style: { background: t.surface } })}
                    />
                </div>
            </Card>
        </div>
    );
}
