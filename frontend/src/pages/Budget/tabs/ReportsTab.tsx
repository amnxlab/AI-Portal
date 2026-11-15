import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Alert, Avatar, Badge, Button, Card, Checkbox, Col, Divider, Empty,
    Progress, Radio, Row, Select, Space, Spin, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
    BankOutlined, DollarOutlined, FilePdfOutlined, FileTextOutlined,
    FundOutlined, TeamOutlined, UserOutlined,
} from '@ant-design/icons';
import { getOverview, getExpenses, getLaborDeductions, getAccounts, getAccountReport, exportAccountReportPdf } from '../../../api/budget';
import type { OverviewData, Expense, LaborDeduction, BudgetAccount, AccountReport } from '../../../api/budget';
import { alpha } from '../../../theme/tokens';
import { useTheme } from '../../../theme/useTheme';

const { Text, Title } = Typography;


const fmt = (n: number | null | undefined) =>
    `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type ReportType = 'overview' | 'expenses' | 'labor' | 'account';

interface Project { id: string; name: string; }

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

// ── KPI stat card (matches weekly-reports summary cards) ───────────────────
function KpiCard({ label, value, color, icon }: {
    label: string; value: string; color: string; icon?: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <Card
            style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, textAlign: 'center' }}
        >
            {icon && <div style={{ marginBottom: 6, color, fontSize: 18 }}>{icon}</div>}
            <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
            <div style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{label}</div>
        </Card>
    );
}

// ── Uppercase section label (matches weekly-reports section headers) ────────
function SectionLabel({ children }: { children: React.ReactNode }) {
    const { t } = useTheme();
    return (
        <Text style={{
            color: t.textMuted, fontSize: 12, textTransform: 'uppercase',
            letterSpacing: 1, display: 'block', marginBottom: 8,
        }}>
            {children}
        </Text>
    );
}

export default function ReportsTab() {
    const { t } = useTheme();
    const [searchParams] = useSearchParams();
    const [reportType,      setReportType]      = useState<ReportType>('overview');
    const [selectedProject, setSelectedProject] = useState<string | undefined>();
    const [projects,        setProjects]        = useState<Project[]>([]);
    const [projectsLoaded,  setProjectsLoaded]  = useState(false);

    const [overviewData,  setOverviewData]  = useState<OverviewData | null>(null);
    const [expensesData,  setExpensesData]  = useState<Expense[] | null>(null);
    const [laborData,     setLaborData]     = useState<LaborDeduction[] | null>(null);
    const [accountReport, setAccountReport] = useState<AccountReport | null>(null);

    const [accounts,       setAccounts]       = useState<BudgetAccount[]>([]);
    const [accountsLoaded, setAccountsLoaded] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>();

    const [loading,       setLoading]       = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [error,         setError]         = useState('');
    const [includeAllocations, setIncludeAllocations] = useState(true);

    // ── Auto-select account from URL param (e.g. navigated from Overview) ─
    useEffect(() => {
        const accountId = searchParams.get('account');
        if (!accountId) return;
        setReportType('account');
        setSelectedAccountId(accountId);
        // Load accounts list so the Select shows the name, then auto-generate
        getAccounts().then(data => {
            setAccounts(data);
            setAccountsLoaded(true);
        }).catch(() => {});
        // Auto-generate the report
        setLoading(true);
        setAccountReport(null);
        setOverviewData(null);
        setExpensesData(null);
        setLaborData(null);
        getAccountReport(accountId)
            .then(setAccountReport)
            .catch(() => setError('Failed to load account report'))
            .finally(() => setLoading(false));
    // Only run when the component mounts or the account param changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams.get('account')]);

    const loadProjects = useCallback(async () => {
        if (projectsLoaded) return;
        try {
            const { default: api } = await import('../../../api/axios');
            const res = await api.get<Project[]>('/projects');
            setProjects(res.data);
            setProjectsLoaded(true);
        } catch { /* non-critical */ }
    }, [projectsLoaded]);

    const loadAccounts = useCallback(async () => {
        if (accountsLoaded) return;
        try {
            const data = await getAccounts();
            setAccounts(data);
            setAccountsLoaded(true);
        } catch { /* non-critical */ }
    }, [accountsLoaded]);

    const changeType = (t: ReportType) => {
        setReportType(t);
        setOverviewData(null);
        setExpensesData(null);
        setLaborData(null);
        setAccountReport(null);
        setError('');
    };

    const loadReport = async () => {
        setLoading(true);
        setError('');
        setOverviewData(null);
        setExpensesData(null);
        setLaborData(null);
        setAccountReport(null);
        try {
            if (reportType === 'overview') {
                setOverviewData(await getOverview());
            } else if (reportType === 'expenses') {
                setExpensesData(await getExpenses(selectedProject));
            } else if (reportType === 'labor') {
                setLaborData(await getLaborDeductions());
            } else if (reportType === 'account') {
                if (!selectedAccountId) { setError('Please select a budget account first.'); setLoading(false); return; }
                setAccountReport(await getAccountReport(selectedAccountId));
            }
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load report');
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async (format: 'csv' | 'pdf') => {
        setExportLoading(true);
        setError('');
        try {
            const { default: api } = await import('../../../api/axios');
            const res = await api.get(`/budget/export/${format}`, {
                params: {
                    type: reportType,
                    // Only the Expenses report has a project filter today — keep the
                    // export in sync with what's actually shown on screen.
                    ...(reportType === 'expenses' && selectedProject ? { projectId: selectedProject } : {}),
                },
                responseType: 'blob',
            });
            const mime = format === 'csv' ? 'text/csv' : 'application/pdf';
            const date = new Date().toISOString().split('T')[0];
            downloadBlob(new Blob([res.data], { type: mime }), `budget-${reportType}-${date}.${format}`);
        } catch (e: any) {
            setError(`Export failed: ${e?.response?.data?.message ?? e.message}`);
        } finally {
            setExportLoading(false);
        }
    };

    const handleExportAccount = async () => {
        if (!selectedAccountId) { setError('Please select a budget account first.'); return; }
        setExportLoading(true);
        setError('');
        try {
            const res = await exportAccountReportPdf(selectedAccountId, includeAllocations);
            const acct = accounts.find(a => a.id === selectedAccountId);
            const date = new Date().toISOString().split('T')[0];
            const name = acct ? acct.name.toLowerCase().replace(/\s+/g, '-') : 'account';
            downloadBlob(new Blob([res.data], { type: 'application/pdf' }), `account-statement-${name}-${date}.pdf`);
        } catch (e: any) {
            setError(`Export failed: ${e?.response?.data?.message ?? e.message}`);
        } finally {
            setExportLoading(false);
        }
    };

    // ── Column definitions ─────────────────────────────────────────────────
    const overviewCols = [
        {
            title: 'Account', dataIndex: 'name', key: 'name',
            sorter: (a: any, b: any) => a.name.localeCompare(b.name),
            render: (v: string) => <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text>,
        },
        {
            title: 'Category', dataIndex: 'category', key: 'cat', width: 150,
            render: (v: string) => {
                const color = v === 'Labor' ? t.accent : v === 'Operations' ? t.orange : t.success;
                return (
                    <Tag style={{ background: `${alpha(color, 0.09)}`, border: `1px solid ${alpha(color, 0.27)}`, color }}>
                        {v || '—'}
                    </Tag>
                );
            },
        },
        {
            title: 'Funding Source', dataIndex: 'fundingSource', key: 'fs', width: 180,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
        },
        {
            title: 'Allocated', dataIndex: 'totalAllocated', key: 'alloc',
            align: 'right' as const, width: 130,
            render: (v: number) => <Text style={{ color: t.text }}>{fmt(v)}</Text>,
        },
        {
            title: 'Balance', dataIndex: 'balance', key: 'bal',
            align: 'right' as const, width: 160,
            sorter: (a: any, b: any) => Number(a.balance) - Number(b.balance),
            render: (v: number, row: any) => {
                const pct   = row.totalAllocated > 0 ? Math.min(100, Math.max(0, (Number(v) / row.totalAllocated) * 100)) : 0;
                const color = pct < 20 ? t.danger : pct < 50 ? t.warning : t.success;
                return (
                    <div style={{ minWidth: 110 }}>
                        <Text style={{ color, fontWeight: 700 }}>{fmt(Number(v))}</Text>
                        <Tooltip title={`${Math.round(pct)}% remaining`}>
                            <Progress
                                percent={Math.round(pct)}
                                showInfo={false}
                                strokeColor={color}
                                trailColor={t.surfaceRaised}
                                size={['100%', 4] as any}
                                style={{ marginTop: 4 }}
                            />
                        </Tooltip>
                    </div>
                );
            },
        },
    ];

    const EXPENSE_CAT_COLOR: Record<string, string> = {
        equipment: t.accent, supplies: t.success, travel: t.orange, other: t.textMuted,
    };

    const expensesCols = [
        {
            title: 'Date', dataIndex: 'expenseDate', key: 'date', width: 110,
            sorter: (a: Expense, b: Expense) =>
                new Date(a.expenseDate).getTime() - new Date(b.expenseDate).getTime(),
            render: (v: string) => (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{new Date(v).toLocaleDateString()}</Text>
            ),
        },
        {
            title: 'Project', key: 'proj',
            render: (_: any, r: Expense) => (
                <Text style={{ color: t.text }}>{r.project?.name ?? '—'}</Text>
            ),
        },
        {
            title: 'Account', key: 'acct',
            render: (_: any, r: Expense) => (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{r.allocation?.budgetAccount?.name ?? '—'}</Text>
            ),
        },
        {
            title: 'Description', dataIndex: 'description', key: 'desc',
            render: (v: string) => <Text style={{ color: t.text }}>{v}</Text>,
        },
        {
            title: 'Category', dataIndex: 'category', key: 'cat', width: 110,
            render: (v: string) => {
                const color = EXPENSE_CAT_COLOR[v] ?? t.textMuted;
                return (
                    <Tag style={{ background: `${alpha(color, 0.09)}`, border: `1px solid ${alpha(color, 0.27)}`, color }}>{v}</Tag>
                );
            },
        },
        {
            title: 'Amount', dataIndex: 'amount', key: 'amt',
            align: 'right' as const, width: 120,
            sorter: (a: Expense, b: Expense) => Number(a.amount) - Number(b.amount),
            render: (v: number) => (
                <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(Number(v))}</Text>
            ),
        },
        {
            title: 'Vendor', dataIndex: 'vendor', key: 'vendor', width: 140,
            render: (v: string | null) => (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>
            ),
        },
        {
            title: 'Recorded By', key: 'by', width: 160,
            render: (_: any, r: Expense) => {
                const name     = r.recordedBy?.fullName ?? '—';
                const initials = name !== '—'
                    ? name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    : '?';
                return (
                    <Space size={6}>
                        {name !== '—' && (
                            <Avatar size="small" style={{ background: t.surfaceRaised, color: t.accent, fontSize: 11, fontWeight: 700 }}>
                                {initials}
                            </Avatar>
                        )}
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>{name}</Text>
                    </Space>
                );
            },
        },
    ];

    const laborCols = [
        {
            title: 'Week', dataIndex: 'weekStart', key: 'week', width: 130,
            sorter: (a: LaborDeduction, b: LaborDeduction) =>
                new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime(),
            render: (v: string) => (
                <Tag style={{ background: `${alpha(t.accent, 0.09)}`, border: `1px solid ${alpha(t.accent, 0.27)}`, color: t.accent, fontSize: 11 }}>
                    {new Date(v).toLocaleDateString()}
                </Tag>
            ),
        },
        {
            title: 'Employee', key: 'user', width: 200,
            render: (_: any, r: LaborDeduction) => {
                const name     = r.user?.fullName ?? r.user?.username ?? '—';
                const initials = name !== '—'
                    ? name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    : '?';
                return (
                    <Space size={8}>
                        <Avatar size="small" style={{ background: t.surfaceRaised, color: t.accent, fontWeight: 700, fontSize: 11 }}>
                            {initials}
                        </Avatar>
                        <Text style={{ color: t.text, fontWeight: 600 }}>{name}</Text>
                    </Space>
                );
            },
        },
        {
            title: 'Hours', dataIndex: 'hours', key: 'hours', width: 90,
            align: 'right' as const,
            sorter: (a: LaborDeduction, b: LaborDeduction) => Number(a.hours) - Number(b.hours),
            render: (v: number) => (
                <Text style={{ color: t.warning, fontWeight: 600 }}>{Number(v || 0).toFixed(1)}h</Text>
            ),
        },
        {
            title: 'Rate', dataIndex: 'hourlyRate', key: 'rate', width: 110,
            align: 'right' as const,
            render: (v: number) => (
                <Text style={{ color: t.textMuted, fontSize: 12 }}>{fmt(v)}/hr</Text>
            ),
        },
        {
            title: 'Amount', dataIndex: 'amount', key: 'amt', width: 130,
            align: 'right' as const,
            sorter: (a: LaborDeduction, b: LaborDeduction) => Number(a.amount) - Number(b.amount),
            render: (v: number) => (
                <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(Number(v))}</Text>
            ),
        },
        {
            title: 'Budget Pool', key: 'pool', width: 220,
            render: (_: any, r: LaborDeduction) => (
                <Tag style={{ background: `${alpha(t.purple, 0.09)}`, border: `1px solid ${alpha(t.purple, 0.27)}`, color: t.purple }}>
                    <BankOutlined style={{ marginRight: 4 }} />{r.budgetAccount?.name ?? '—'}
                </Tag>
            ),
        },
    ];

    // ── Computed summaries ─────────────────────────────────────────────────
    const totalExpensesAmt = expensesData?.reduce((s, e) => s + Number(e.amount), 0) ?? 0;
    const avgExpenseAmt    = expensesData?.length ? totalExpensesAmt / expensesData.length : 0;
    const totalLaborAmt    = laborData?.reduce((s, d) => s + Number(d.amount), 0) ?? 0;
    const totalLaborHrs    = laborData?.reduce((s, d) => s + Number(d.hours),  0) ?? 0;
    const uniqueEmployees  = laborData ? new Set(laborData.map(d => d.user?.id)).size : 0;

    // ── Render ─────────────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Page header ───────────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <Title level={4} style={{ margin: 0, color: t.text }}>Budget Reports</Title>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Generate financial reports · Export as CSV or PDF
                    </Text>
                </div>
                <Space>
                    {reportType !== 'account' && (
                        <>
                            <Button
                                icon={<FileTextOutlined />}
                                loading={exportLoading}
                                onClick={() => handleExport('csv')}
                                style={{ borderColor: t.border, color: t.textMuted }}
                            >
                                Export CSV
                            </Button>
                            <Button
                                icon={<FilePdfOutlined />}
                                loading={exportLoading}
                                onClick={() => handleExport('pdf')}
                                style={{ borderColor: t.danger, color: t.danger }}
                            >
                                Export PDF
                            </Button>
                        </>
                    )}
                    {reportType === 'account' && (
                        <Space size={12}>
                            <Checkbox
                                checked={includeAllocations}
                                onChange={e => setIncludeAllocations(e.target.checked)}
                                style={{ color: t.textMuted, fontSize: 12 }}
                            >
                                Include Project Allocations
                            </Checkbox>
                            <Button
                                icon={<FilePdfOutlined />}
                                loading={exportLoading}
                                onClick={handleExportAccount}
                                type="primary"
                                style={{ background: t.danger, borderColor: t.danger }}
                            >
                                Export Account Statement PDF
                            </Button>
                        </Space>
                    )}
                </Space>
            </div>

            {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}

            {/* ── Controls bar ──────────────────────────────────────────── */}
            <Card
                style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8 }}
            >
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' }}>
                    <Space wrap size={12}>
                        <Radio.Group value={reportType} onChange={e => changeType(e.target.value)} buttonStyle="solid">
                            <Radio.Button value="overview">
                                <FundOutlined style={{ marginRight: 6 }} />Overview
                            </Radio.Button>
                            <Radio.Button value="expenses">
                                <DollarOutlined style={{ marginRight: 6 }} />Expenses
                            </Radio.Button>
                            <Radio.Button value="labor">
                                <TeamOutlined style={{ marginRight: 6 }} />Labor Costs
                            </Radio.Button>
                            <Radio.Button value="account">
                                <BankOutlined style={{ marginRight: 6 }} />Account Statement
                            </Radio.Button>
                        </Radio.Group>

                        {reportType === 'expenses' && (
                            <Select
                                allowClear
                                placeholder="Filter by project (optional)"
                                
                                onFocus={loadProjects}
                                onChange={setSelectedProject}
                                options={projects.map(p => ({ value: p.id, label: p.name }))}
                            />
                        )}

                        {reportType === 'account' && (
                            <Select
                                allowClear
                                placeholder="Select a budget account"
                                
                                onFocus={loadAccounts}
                                onChange={setSelectedAccountId}
                                value={selectedAccountId}
                                options={accounts.map(a => ({
                                    value: a.id,
                                    label: `${a.name} (${a.category === 'Labor' ? 'Labor' : 'Spending'})`,
                                }))}
                                showSearch
                                filterOption={(input, opt) =>
                                    (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        )}
                    </Space>
                    <Button
                        type="primary"
                        onClick={loadReport}
                        loading={loading}
                        style={{ background: t.accent, borderColor: t.accent }}
                    >
                        Generate Report
                    </Button>
                </div>
            </Card>

            {/* ── Loading ───────────────────────────────────────────────── */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 56 }}>
                    <Spin size="large" />
                    <div style={{ color: t.textMuted, marginTop: 12, fontSize: 13 }}>Loading report data…</div>
                </div>
            )}

            {/* ── Overview report ───────────────────────────────────────── */}
            {overviewData && !loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionLabel>Financial Summary</SectionLabel>
                    <Row gutter={[12, 12]}>
                        {[
                            { label: 'Total Allocated', value: fmt(overviewData.totalAllocated),    color: t.accent,   icon: <FundOutlined /> },
                            { label: 'Current Balance', value: fmt(overviewData.totalBalance),       color: t.success,  icon: <BankOutlined /> },
                            { label: 'Labor Deducted',  value: fmt(overviewData.totalLaborDeducted), color: t.warning, icon: <TeamOutlined /> },
                            { label: 'Total Expenses',  value: fmt(overviewData.totalExpenses),      color: t.danger,    icon: <DollarOutlined /> },
                        ].map(kpi => (
                            <Col xs={12} sm={6} key={kpi.label}>
                                <KpiCard {...kpi} />
                            </Col>
                        ))}
                    </Row>

                    <Divider style={{ borderColor: t.border, margin: '4px 0' }} />
                    <SectionLabel>Account Summaries</SectionLabel>
                    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <Table
                            dataSource={overviewData.accountSummaries}
                            columns={overviewCols}
                            rowKey="id"
                            size="small"
                            pagination={false}
                            locale={{
                                emptyText: (
                                    <Empty
                                        description={<Text style={{ color: t.textMuted }}>No accounts found</Text>}
                                        style={{ padding: '32px 0' }}
                                    />
                                ),
                            }}
                            onRow={() => ({ style: { background: t.surface } })}
                        />
                    </div>
                </div>
            )}

            {/* ── Expenses report ───────────────────────────────────────── */}
            {expensesData && !loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionLabel>Expense Summary</SectionLabel>
                    <Row gutter={[12, 12]}>
                        {[
                            { label: 'Total Spent',     value: fmt(totalExpensesAmt),          color: t.danger,    icon: <DollarOutlined /> },
                            { label: 'Records',         value: String(expensesData.length),    color: t.accent,   icon: <FileTextOutlined /> },
                            { label: 'Average Amount',  value: fmt(avgExpenseAmt),             color: t.warning, icon: <FundOutlined /> },
                        ].map(kpi => (
                            <Col xs={12} sm={8} key={kpi.label}>
                                <KpiCard {...kpi} />
                            </Col>
                        ))}
                    </Row>

                    <Divider style={{ borderColor: t.border, margin: '4px 0' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <SectionLabel>Expense Records</SectionLabel>
                        <Badge count={expensesData.length} style={{ background: t.accent }} showZero />
                    </div>
                    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <Table
                            dataSource={expensesData}
                            columns={expensesCols}
                            rowKey="id"
                            size="small"
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            locale={{
                                emptyText: (
                                    <Empty
                                        description={<Text style={{ color: t.textMuted }}>No expenses found</Text>}
                                        style={{ padding: '32px 0' }}
                                    />
                                ),
                            }}
                            onRow={() => ({ style: { background: t.surface } })}
                        />
                    </div>
                </div>
            )}

            {/* ── Labor costs report ────────────────────────────────────── */}
            {laborData && !loading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <SectionLabel>Labor Cost Summary</SectionLabel>
                    <Row gutter={[12, 12]}>
                        {[
                            { label: 'Total Deducted',     value: fmt(totalLaborAmt),                 color: t.danger,    icon: <DollarOutlined /> },
                            { label: 'Total Hours Logged', value: `${totalLaborHrs.toFixed(1)}h`,     color: t.warning, icon: <TeamOutlined /> },
                            { label: 'Employees',          value: String(uniqueEmployees),            color: t.accent,   icon: <UserOutlined /> },
                        ].map(kpi => (
                            <Col xs={12} sm={8} key={kpi.label}>
                                <KpiCard {...kpi} />
                            </Col>
                        ))}
                    </Row>

                    <Divider style={{ borderColor: t.border, margin: '4px 0' }} />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <SectionLabel>Deduction Records</SectionLabel>
                        <Badge count={laborData.length} style={{ background: t.accent }} showZero />
                    </div>
                    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                        <Table
                            dataSource={laborData}
                            columns={laborCols}
                            rowKey="id"
                            size="small"
                            pagination={{ pageSize: 20, showSizeChanger: true }}
                            locale={{
                                emptyText: (
                                    <Empty
                                        description={<Text style={{ color: t.textMuted }}>No labor deductions recorded</Text>}
                                        style={{ padding: '32px 0' }}
                                    />
                                ),
                            }}
                            onRow={() => ({ style: { background: t.surface } })}
                        />
                    </div>
                </div>
            )}

            {/* ── Account Statement report ──────────────────────────────── */}
            {accountReport && !loading && (() => {
                const ar = accountReport;
                const catColor = ar.account.category === 'Labor' ? t.accent : t.success;

                const allocCols = [
                    {
                        title: 'Project', key: 'proj',
                        render: (_: any, r: any) => (
                            <Text style={{ color: t.text, fontWeight: 600 }}>{r.project?.name ?? '—'}</Text>
                        ),
                    },
                    {
                        title: 'Notes', dataIndex: 'notes', key: 'notes',
                        render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
                    },
                    {
                        title: 'Allocated', dataIndex: 'allocatedAmount', key: 'alloc',
                        align: 'right' as const, width: 130,
                        render: (v: number) => <Text style={{ color: t.text }}>{fmt(v)}</Text>,
                    },
                    {
                        title: 'Spent', dataIndex: 'spent', key: 'spent',
                        align: 'right' as const, width: 120,
                        render: (v: number) => <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(v)}</Text>,
                    },
                    {
                        title: 'Balance', dataIndex: 'balance', key: 'bal',
                        align: 'right' as const, width: 130,
                        render: (v: number, row: any) => {
                            const pct   = row.allocatedAmount > 0 ? Math.min(100, (v / row.allocatedAmount) * 100) : 0;
                            const color = pct < 20 ? t.danger : pct < 50 ? t.warning : t.success;
                            return (
                                <div>
                                    <Text style={{ color, fontWeight: 700 }}>{fmt(v)}</Text>
                                    <Progress percent={Math.round(Math.max(0, pct))} showInfo={false}
                                        strokeColor={color} trailColor={t.surfaceRaised}
                                        size={['100%', 3] as any} style={{ marginTop: 3 }} />
                                </div>
                            );
                        },
                    },
                ];

                const acctExpCols = [
                    {
                        title: 'Date', dataIndex: 'expenseDate', key: 'date', width: 110,
                        sorter: (a: Expense, b: Expense) => new Date(a.expenseDate).getTime() - new Date(b.expenseDate).getTime(),
                        render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{new Date(v).toLocaleDateString()}</Text>,
                    },
                    {
                        title: 'Project', key: 'proj',
                        render: (_: any, r: Expense) => <Text style={{ color: t.text }}>{r.project?.name ?? '—'}</Text>,
                    },
                    {
                        title: 'Description', dataIndex: 'description', key: 'desc',
                        render: (v: string) => <Text style={{ color: t.text }}>{v}</Text>,
                    },
                    {
                        title: 'Category', dataIndex: 'category', key: 'cat', width: 110,
                        render: (v: string) => {
                            const catColorMap: Record<string, string> = { equipment: t.accent, supplies: t.success, travel: t.orange, other: t.textMuted };
                            const c = catColorMap[v] ?? t.textMuted;
                            return <Tag style={{ background: `${c}18`, border: `1px solid ${c}44`, color: c }}>{v}</Tag>;
                        },
                    },
                    {
                        title: 'Vendor', dataIndex: 'vendor', key: 'vendor', width: 130,
                        render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
                    },
                    {
                        title: 'Amount', dataIndex: 'amount', key: 'amt', align: 'right' as const, width: 120,
                        sorter: (a: Expense, b: Expense) => Number(a.amount) - Number(b.amount),
                        render: (v: number) => <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(v)}</Text>,
                    },
                ];

                const acctLaborCols = [
                    {
                        title: 'Week', dataIndex: 'weekStart', key: 'week', width: 120,
                        sorter: (a: LaborDeduction, b: LaborDeduction) => new Date(a.weekStart).getTime() - new Date(b.weekStart).getTime(),
                        render: (v: string) => (
                            <Tag style={{ background: `${alpha(t.accent, 0.09)}`, border: `1px solid ${alpha(t.accent, 0.27)}`, color: t.accent, fontSize: 11 }}>
                                {new Date(v).toLocaleDateString()}
                            </Tag>
                        ),
                    },
                    {
                        title: 'Employee', key: 'user',
                        render: (_: any, r: LaborDeduction) => {
                            const name = r.user?.fullName ?? r.user?.username ?? '—';
                            const initials = name !== '—' ? name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() : '?';
                            return (
                                <Space size={8}>
                                    <Avatar size="small" style={{ background: t.surfaceRaised, color: t.accent, fontWeight: 700, fontSize: 11 }}>{initials}</Avatar>
                                    <Text style={{ color: t.text, fontWeight: 600 }}>{name}</Text>
                                </Space>
                            );
                        },
                    },
                    {
                        title: 'Hours', dataIndex: 'hours', key: 'h', align: 'right' as const, width: 80,
                        render: (v: number) => <Text style={{ color: t.warning, fontWeight: 600 }}>{Number(v || 0).toFixed(1)}h</Text>,
                    },
                    {
                        title: 'Rate', dataIndex: 'hourlyRate', key: 'rate', align: 'right' as const, width: 110,
                        render: (v: number) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{fmt(v)}/hr</Text>,
                    },
                    {
                        title: 'Amount', dataIndex: 'amount', key: 'amt', align: 'right' as const, width: 120,
                        sorter: (a: LaborDeduction, b: LaborDeduction) => Number(a.amount) - Number(b.amount),
                        render: (v: number) => <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(v)}</Text>,
                    },
                ];

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                        {/* Account info header */}
                        <Card
                            style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, borderLeft: `4px solid ${catColor}` }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                                <div>
                                    <Text style={{ color: t.text, fontSize: 16, fontWeight: 700 }}>{ar.account.name}</Text>
                                    <div style={{ marginTop: 4 }}>
                                        <Tag style={{ background: `${alpha(catColor, 0.09)}`, border: `1px solid ${alpha(catColor, 0.27)}`, color: catColor }}>
                                            {ar.account.category === 'Labor' ? 'Labor Pool' : 'Project Spending'}
                                        </Tag>
                                        {((ar.account as any).fundingSources ?? []).map((fs: any) => (
                                            <Tag key={fs.id} style={{ background: `${alpha(t.purple, 0.09)}`, border: `1px solid ${alpha(t.purple, 0.27)}`, color: t.purple }}>{fs.name}</Tag>
                                        ))}
                                    </div>
                                </div>
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                    Report generated: {new Date().toLocaleDateString()}
                                </Text>
                            </div>
                        </Card>

                        {/* KPI Summary */}
                        <SectionLabel>Account Summary</SectionLabel>
                        <Row gutter={[12, 12]}>
                            {[
                                { label: 'Total Allocated', value: fmt(ar.account.totalAllocated), color: t.accent,   icon: <FundOutlined /> },
                                { label: 'Total Spent',     value: fmt(ar.totalSpent),             color: t.danger,    icon: <DollarOutlined /> },
                                { label: 'Remaining Bal.',  value: fmt(ar.account.balance),         color: ar.account.balance >= 0 ? t.success : t.danger, icon: <BankOutlined /> },
                                { label: 'Expense Items',   value: String(ar.expenses.length),     color: t.orange, icon: <FileTextOutlined /> },
                                { label: 'Labor Records',   value: String(ar.laborDeductions.length), color: t.purple, icon: <TeamOutlined /> },
                            ].map(kpi => (
                                <Col xs={12} sm={8} md={6} lg={4} key={kpi.label}>
                                    <KpiCard {...kpi} />
                                </Col>
                            ))}
                        </Row>

                        <Divider style={{ borderColor: t.border, margin: '4px 0' }} />

                        {/* Allocations */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <SectionLabel>Project Allocations</SectionLabel>
                            <Badge count={ar.allocations.length} style={{ background: t.accent }} showZero />
                        </div>
                        <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                            <Table dataSource={ar.allocations} columns={allocCols} rowKey="id" size="small" pagination={false}
                                locale={{ emptyText: <Empty description={<Text style={{ color: t.textMuted }}>No allocations</Text>} style={{ padding: '24px 0' }} /> }}
                                onRow={() => ({ style: { background: t.surface } })}
                                summary={() => (
                                    <Table.Summary.Row style={{ background: t.surfaceRaised }}>
                                        <Table.Summary.Cell index={0}><Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>TOTAL</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={1} />
                                        <Table.Summary.Cell index={2} align="right">
                                            <Text style={{ color: t.text, fontWeight: 700 }}>{fmt(ar.allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0))}</Text>
                                        </Table.Summary.Cell>
                                        <Table.Summary.Cell index={3} align="right">
                                            <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(ar.allocations.reduce((s, a) => s + a.spent, 0))}</Text>
                                        </Table.Summary.Cell>
                                        <Table.Summary.Cell index={4} align="right">
                                            <Text style={{ color: t.success, fontWeight: 700 }}>{fmt(ar.allocations.reduce((s, a) => s + a.balance, 0))}</Text>
                                        </Table.Summary.Cell>
                                    </Table.Summary.Row>
                                )}
                            />
                        </div>

                        <Divider style={{ borderColor: t.border, margin: '4px 0' }} />

                        {/* Expenses */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <SectionLabel>Expense Records</SectionLabel>
                            <Space>
                                <Text style={{ color: t.danger, fontWeight: 700, fontSize: 13 }}>{fmt(ar.totalExpenses)}</Text>
                                <Badge count={ar.expenses.length} style={{ background: t.danger }} showZero />
                            </Space>
                        </div>
                        <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                            <Table dataSource={ar.expenses} columns={acctExpCols} rowKey="id" size="small"
                                pagination={{ pageSize: 20, showSizeChanger: true }}
                                locale={{ emptyText: <Empty description={<Text style={{ color: t.textMuted }}>No expenses for this account</Text>} style={{ padding: '24px 0' }} /> }}
                                onRow={() => ({ style: { background: t.surface } })}
                                summary={() => ar.expenses.length > 0 ? (
                                    <Table.Summary.Row style={{ background: t.surfaceRaised }}>
                                        <Table.Summary.Cell index={0} colSpan={5}><Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>TOTAL EXPENSES</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={5} align="right">
                                            <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(ar.totalExpenses)}</Text>
                                        </Table.Summary.Cell>
                                    </Table.Summary.Row>
                                ) : null}
                            />
                        </div>

                        <Divider style={{ borderColor: t.border, margin: '4px 0' }} />

                        {/* Labor Deductions */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <SectionLabel>Labor Deductions</SectionLabel>
                            <Space>
                                <Text style={{ color: t.danger, fontWeight: 700, fontSize: 13 }}>{fmt(ar.totalLabor)}</Text>
                                <Badge count={ar.laborDeductions.length} style={{ background: t.purple }} showZero />
                            </Space>
                        </div>
                        <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, overflow: 'hidden' }}>
                            <Table dataSource={ar.laborDeductions} columns={acctLaborCols} rowKey="id" size="small"
                                pagination={{ pageSize: 20, showSizeChanger: true }}
                                locale={{ emptyText: <Empty description={<Text style={{ color: t.textMuted }}>No labor deductions for this account</Text>} style={{ padding: '24px 0' }} /> }}
                                onRow={() => ({ style: { background: t.surface } })}
                                summary={() => ar.laborDeductions.length > 0 ? (
                                    <Table.Summary.Row style={{ background: t.surfaceRaised }}>
                                        <Table.Summary.Cell index={0} colSpan={4}><Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600 }}>TOTAL LABOR</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={4} align="right">
                                            <Text style={{ color: t.danger, fontWeight: 700 }}>{fmt(ar.totalLabor)}</Text>
                                        </Table.Summary.Cell>
                                    </Table.Summary.Row>
                                ) : null}
                            />
                        </div>

                        {/* Grand total */}
                        <Card
                            style={{ background: 'linear-gradient(135deg, t.bg 0%, t.surface 100%)', border: `1px solid ${t.border}`, borderRadius: 8, borderLeft: `4px solid ${t.success}` }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                                <div>
                                    <Text style={{ color: t.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Total Spend</Text>
                                    <div style={{ fontSize: 26, fontWeight: 700, color: t.danger, marginTop: 2 }}>{fmt(ar.totalSpent)}</div>
                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Expenses {fmt(ar.totalExpenses)} + Labor {fmt(ar.totalLabor)}</Text>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <Text style={{ color: t.textMuted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>Remaining Balance</Text>
                                    <div style={{ fontSize: 22, fontWeight: 700, color: ar.account.balance >= 0 ? t.success : t.danger, marginTop: 2 }}>{fmt(ar.account.balance)}</div>
                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                        {ar.account.balance >= 0
                                            ? `${ar.account.totalAllocated > 0 ? ((ar.account.balance / ar.account.totalAllocated) * 100).toFixed(1) : 0}% remaining`
                                            : 'Over budget'}
                                    </Text>
                                </div>
                            </div>
                        </Card>
                    </div>
                );
            })()}
        </div>
    );
}

