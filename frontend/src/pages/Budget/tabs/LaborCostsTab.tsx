import { useEffect, useState, useCallback } from 'react';
import {
    Table, Button, Form, Select, Alert, Spin, Card, Row, Col,
    Typography, Space, Statistic, Tag, Tooltip, DatePicker, Popconfirm, message,
} from 'antd';
import {
    PlusOutlined, DollarOutlined, UserOutlined,
    DeleteOutlined, StopOutlined, TeamOutlined, CalendarOutlined, LineChartOutlined,
    QuestionCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
    getLaborDeductions, laborDeduct, getAccounts, getSustainability,
    getPoolMembers, addPoolMember, endPoolMember, deletePoolMember,
} from '../../../api/budget';
import type { SustainabilityInfo, LaborDeduction, BudgetAccount, LaborPoolMember } from '../../../api/budget';
import api from '../../../api/axios';
import { useTheme } from '../../../theme/useTheme';
import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const { Text, Title } = Typography;


const fmt = (n: number | null | undefined) =>
    `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (v: string | null | undefined) => v ? dayjs(v).format('MMM D, YYYY') : '—';

const runwayColor = (months: number | null, t: ReturnType<typeof useTheme>['t']) => {
    if (months === null) return t.success;
    if (months < 3) return t.danger;
    if (months < 6) return t.warning;
    return t.success;
};

interface UserOption { id: string; fullName: string; username: string; }

export default function LaborCostsTab() {
    const { selectedId } = useBudgetYear();
    const { t } = useTheme();
    const [sustainability, setSustainability] = useState<SustainabilityInfo | null>(null);
    const [deductions, setDeductions] = useState<LaborDeduction[]>([]);
    const [poolMembers, setPoolMembers] = useState<LaborPoolMember[]>([]);
    const [laborAccts, setLaborAccts] = useState<BudgetAccount[]>([]);
    const [allUsers, setAllUsers] = useState<UserOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Add payroll member modal
    const [memberModalOpen, setMemberModalOpen] = useState(false);
    const [memberSaving, setMemberSaving] = useState(false);
    const [memberForm] = Form.useForm();

    // Manual deduction modal
    const [deductModalOpen, setDeductModalOpen] = useState(false);
    const [deductSaving, setDeductSaving] = useState(false);
    const [deductForm] = Form.useForm();
    const [approvedRpts, setApprovedRpts] = useState<{ id: string; weekStart: string; totalHours: number; user?: { fullName: string } }[]>([]);

    // ── Load all data ──────────────────────────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [sus, deds, members, accs, usersRes, rpRes] = await Promise.all([
                getSustainability(),
                getLaborDeductions(selectedId),
                getPoolMembers(),
                getAccounts(selectedId),
                api.get<UserOption[]>('/users'),
                api.get<{ id: string; weekStart: string; totalHours: number; status: string; user?: { fullName: string } }[]>('/reports'),
            ]);
            setSustainability(sus);
            setDeductions(deds);
            setPoolMembers(members);
            setLaborAccts(accs.filter(a => a.category === 'Labor'));
            setAllUsers(usersRes.data);
            // Only show approved reports that haven't been deducted yet
            const alreadyDeducted = new Set(deds.map(d => d.weeklyReportId));
            setApprovedRpts(rpRes.data.filter(r => r.status === 'Approved' && !alreadyDeducted.has(r.id)));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load labor data');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    // ── Add payroll member ─────────────────────────────────────────────────
    const handleAddMember = async () => {
        try {
            const vals = await memberForm.validateFields();
            setMemberSaving(true);
            await addPoolMember({
                userId: vals.userId,
                budgetAccountId: vals.budgetAccountId,
                startDate: vals.startDate.format('YYYY-MM-DD'),
                endDate: vals.endDate ? vals.endDate.format('YYYY-MM-DD') : null,
            });
            message.success('Employee added to payroll pool');
            setMemberModalOpen(false);
            memberForm.resetFields();
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to add member');
        } finally { setMemberSaving(false); }
    };

    // ── End / Remove pool member ───────────────────────────────────────────
    const handleEndMember = async (id: string) => {
        try {
            await endPoolMember(id);
            message.success('Employee removed from active payroll (end date set to today)');
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    const handleDeleteMember = async (id: string) => {
        try {
            await deletePoolMember(id);
            message.success('Payroll entry deleted');
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    // ── Manual deduction ───────────────────────────────────────────────────
    const handleManualDeduct = async () => {
        try {
            const vals = await deductForm.validateFields();
            setDeductSaving(true);
            await laborDeduct({ weeklyReportId: vals.weeklyReportId, budgetAccountId: vals.budgetAccountId });
            message.success('Labor deduction recorded');
            setDeductModalOpen(false);
            deductForm.resetFields();
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Deduction failed');
        } finally { setDeductSaving(false); }
    };

    // ── Pool member columns ────────────────────────────────────────────────
    const memberColumns = [
        {
            title: 'Employee', key: 'user', width: 200,
            render: (_: any, r: LaborPoolMember) => (
                <Space size={8}>
                    <UserOutlined style={{ color: t.accent }} />
                    <div>
                        <Text strong style={{ color: t.text, display: 'block', fontSize: 13 }}>
                            {r.user?.fullName ?? '—'}
                        </Text>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>@{r.user?.username}</Text>
                    </div>
                </Space>
            ),
        },
        {
            title: 'Rate', key: 'rate', width: 100,
            render: (_: any, r: LaborPoolMember) => (
                <Text style={{ color: t.text }}>{fmt(r.user?.hourlyRate ?? 15)}/hr</Text>
            ),
        },
        {
            title: 'Weekly Cap', key: 'cap', width: 110,
            render: (_: any, r: LaborPoolMember) => (
                <Text style={{ color: t.textMuted }}>
                    {r.user?.weeklyHoursCap != null ? `${r.user.weeklyHoursCap}h/wk` : '—'}
                </Text>
            ),
        },
        {
            title: 'Account', key: 'account', width: 180,
            render: (_: any, r: LaborPoolMember) => (
                <Tag color="blue" style={{ fontSize: 12 }}>{r.budgetAccount?.name ?? '—'}</Tag>
            ),
        },
        {
            title: 'Start Date', dataIndex: 'startDate', key: 'start', width: 120,
            render: fmtDate,
        },
        {
            title: 'End Date', dataIndex: 'endDate', key: 'end', width: 120,
            render: (v: string | null) => v
                ? <Text style={{ color: t.textMuted }}>{fmtDate(v)}</Text>
                : <Tag color="green" style={{ fontSize: 11 }}>Active</Tag>,
        },
        {
            title: 'Actions', key: 'actions', width: 120,
            render: (_: any, r: LaborPoolMember) => (
                <Space>
                    {!r.endDate && (
                        <Tooltip title="Remove from active payroll (set end date to today)">
                            <Popconfirm
                                title="Remove this employee from the active payroll pool?"
                                description="Their end date will be set to today. Historical data is preserved."
                                onConfirm={() => handleEndMember(r.id)}
                                okText="Remove" okButtonProps={{ danger: true }}
                            >
                                <Button size="small" icon={<StopOutlined />} danger />
                            </Popconfirm>
                        </Tooltip>
                    )}
                    <Tooltip title="Delete this payroll entry permanently">
                        <Popconfirm
                            title="Delete this payroll entry?"
                            description="This cannot be undone."
                            onConfirm={() => handleDeleteMember(r.id)}
                            okText="Delete" okButtonProps={{ danger: true }}
                        >
                            <Button
                                size="small"
                                icon={<DeleteOutlined />}
                                danger
                            />
                        </Popconfirm>
                    </Tooltip>
                </Space>
            ),
        },
    ];

    // ── Deductions columns ─────────────────────────────────────────────────
    const deductionColumns = [
        {
            title: 'Week', dataIndex: 'weekStart', key: 'week', width: 130,
            render: fmtDate,
        },
        {
            title: 'Employee', key: 'user', width: 170,
            render: (_: any, r: LaborDeduction) => (
                <Text style={{ color: t.text, fontSize: 13 }}>
                    {r.user?.fullName ?? r.user?.username ?? '—'}
                </Text>
            ),
        },
        {
            title: 'Hours', dataIndex: 'hours', key: 'hours', width: 80,
            render: (v: number) => <Text style={{ color: t.text }}>{Number(v || 0).toFixed(1)}h</Text>,
        },
        {
            title: 'Rate', dataIndex: 'hourlyRate', key: 'rate', width: 100,
            render: (v: number) => <Text style={{ color: t.textMuted }}>{fmt(v)}/hr</Text>,
        },
        {
            title: 'Amount', dataIndex: 'amount', key: 'amt', width: 110,
            render: (v: number) => <Text strong style={{ color: t.danger }}>{fmt(v)}</Text>,
        },
        {
            title: 'Account', key: 'acct', width: 180,
            render: (_: any, r: LaborDeduction) => (
                <Tag color="blue" style={{ fontSize: 12 }}>{r.budgetAccount?.name ?? '—'}</Tag>
            ),
        },
    ];

    if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;

    const sus = sustainability;
    // KPI cards summarize ALL labor pools, not just the first one — with more
    // than one Labor account, showing pools[0]'s balance/runway next to
    // aggregate figures (Burn/Month, Totals) mixed two different pictures
    // into one KPI row, and every pool after the first had no balance/runway
    // visible anywhere on this tab. The per-pool table below fills that gap.
    const totalPoolBalance = sus?.pools.reduce((s, p) => s + Number(p.balance), 0) ?? 0;
    const runwayMo = sus && sus.totalMonthlyBurnRate > 0 ? totalPoolBalance / sus.totalMonthlyBurnRate : null;
    const exhaustionDate = (() => {
        if (runwayMo === null) return null;
        const d = new Date();
        d.setDate(d.getDate() + runwayMo * 30);
        return d.toISOString().split('T')[0];
    })();

    return (
        <div>
            {error && (
                <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />
            )}

            {/* ── Section 1: KPI Cards ─────────────────────────────────────── */}
            <Title level={5} style={{ color: t.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Labor Pool Overview
            </Title>
            <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
                {/* Balance */}
                <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                        <Statistic
                            title={<Text style={{ color: t.textMuted, fontSize: 11 }}>Current Balance</Text>}
                            value={totalPoolBalance}
                            formatter={v => fmt(Number(v))}
                            prefix={<DollarOutlined style={{ color: t.accent }} />}
                            valueStyle={{ color: t.accent, fontSize: 22, fontWeight: 700 }}
                        />
                        {sus && sus.pools.length > 0 && (
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                across {sus.pools.length} labor pool{sus.pools.length === 1 ? '' : 's'}
                            </Text>
                        )}
                    </Card>
                </Col>

                {/* Burn/mo */}
                <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                        <Statistic
                            title={
                                <Space size={4}>
                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>Burn / Month</Text>
                                    <Tooltip title="Average monthly spend from actual approved report deductions">
                                        <QuestionCircleOutlined style={{ color: t.textMuted, fontSize: 11 }} />
                                    </Tooltip>
                                </Space>
                            }
                            value={sus?.totalMonthlyBurnRate ?? 0}
                            formatter={v => fmt(Number(v))}
                            prefix={<LineChartOutlined style={{ color: sus?.totalMonthlyBurnRate ? t.danger : t.textMuted }} />}
                            valueStyle={{ color: sus?.totalMonthlyBurnRate ? t.danger : t.textMuted, fontSize: 22, fontWeight: 700 }}
                        />
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            {sus?.totalMonthlyBurnRate ? 'avg from actual deductions' : 'no deductions yet'}
                        </Text>
                    </Card>
                </Col>

                {/* Runway */}
                <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                        <Statistic
                            title={<Text style={{ color: t.textMuted, fontSize: 11 }}>Estimated Runway</Text>}
                            value={runwayMo !== null ? Number(runwayMo.toFixed(1)) : '∞'}
                            suffix={runwayMo !== null ? ' months' : ''}
                            prefix={<CalendarOutlined style={{ color: runwayColor(runwayMo, t) }} />}
                            valueStyle={{ color: runwayColor(runwayMo, t), fontSize: 22, fontWeight: 700 }}
                        />
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                            {exhaustionDate
                                ? `Exhausted ~${fmtDate(exhaustionDate)}`
                                : '✓ Sustainable'}
                        </Text>
                    </Card>
                </Col>

                {/* Totals */}
                <Col xs={24} sm={12} lg={6}>
                    <Card size="small" style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                        <Row gutter={0}>
                            <Col span={12} style={{ padding: '0 8px 0 0', borderRight: `1px solid ${t.border}` }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>Total Deducted</Text>
                                <Text strong style={{ color: t.danger, fontSize: 16 }}>{fmt(sus?.totalDeducted)}</Text>
                                <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 2 }}>
                                    {sus?.deductionCount ?? 0} deductions
                                </Text>
                            </Col>
                            <Col span={12} style={{ padding: '0 0 0 12px' }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>Total Hours</Text>
                                <Text strong style={{ color: t.text, fontSize: 16 }}>{Number(sus?.totalHours ?? 0).toFixed(1)}h</Text>
                                <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 2 }}>
                                    <TeamOutlined /> {sus?.activeMembers ?? 0} active
                                </Text>
                            </Col>
                        </Row>
                    </Card>
                </Col>
            </Row>

            {/* ── Section: Per-pool breakdown (each account's own balance/runway) ── */}
            {sus && sus.pools.length > 0 && (
                <>
                    <Title level={5} style={{ color: t.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                        Labor Pools
                    </Title>
                    <Table
                        dataSource={sus.pools}
                        rowKey="accountId"
                        size="small"
                        pagination={false}
                        style={{ marginBottom: 28 }}
                        columns={[
                            { title: 'Account', dataIndex: 'accountName', key: 'name',
                                render: (v: string) => <Text style={{ color: t.text, fontWeight: 600 }}>{v}</Text> },
                            { title: 'Funding Source', dataIndex: 'fundingSource', key: 'fs',
                                render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text> },
                            { title: 'Balance', dataIndex: 'balance', key: 'bal', align: 'right' as const,
                                render: (v: number) => <Text strong style={{ color: t.accent }}>{fmt(v)}</Text> },
                            { title: 'Burn / Month', dataIndex: 'monthlyBurnRate', key: 'burn', align: 'right' as const,
                                render: (v: number) => <Text style={{ color: v ? t.danger : t.textMuted }}>{fmt(v)}</Text> },
                            { title: 'Runway', dataIndex: 'runwayMonths', key: 'runway', align: 'right' as const,
                                render: (v: number | null) => (
                                    <Text style={{ color: runwayColor(v, t) }}>{v !== null ? `${v.toFixed(1)} mo` : '∞'}</Text>
                                ) },
                            { title: 'Exhaustion Date', dataIndex: 'projectedExhaustionDate', key: 'exh',
                                render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v ? fmtDate(v) : '✓ Sustainable'}</Text> },
                        ]}
                    />
                </>
            )}

            {/* ── Section 2: Payroll Table ──────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Title level={5} style={{ color: t.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                    Payroll Pool Members
                </Title>
                <Tooltip title={laborAccts.length === 0 ? 'Create a Labor budget account first' : 'Add employee to payroll pool'}>
                    <Button
                        type="primary"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => { memberForm.resetFields(); setMemberModalOpen(true); }}
                        disabled={laborAccts.length === 0}
                    >
                        Add Employee
                    </Button>
                </Tooltip>
            </div>
            {poolMembers.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '30px 20px', marginBottom: 28,
                    background: t.surface, border: `1px dashed ${t.border}`, borderRadius: 8,
                }}>
                    <TeamOutlined style={{ fontSize: 28, color: t.textMuted, display: 'block', marginBottom: 8 }} />
                    <Text style={{ color: t.textMuted }}>No payroll members yet.</Text>
                    <br />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Add employees to track who is billable to this labor pool and from what date.
                    </Text>
                </div>
            ) : (
                <Table
                    dataSource={poolMembers}
                    columns={memberColumns}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    style={{ marginBottom: 28, background: t.surface, borderRadius: 8 }}
                    rowClassName={(r) => r.endDate ? 'ended-row' : ''}
                />
            )}
            <style>{`.ended-row td { opacity: 0.55; }`}</style>

            {/* ── Section 3: Deductions History ─────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <Title level={5} style={{ color: t.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, margin: 0 }}>
                    Labor Deductions History
                </Title>
                <Tooltip title={
                    laborAccts.length === 0 ? 'No Labor accounts exist' :
                        approvedRpts.length === 0 ? 'No approved reports available' :
                            'Manually record a labor deduction from an approved report'
                }>
                    <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => { deductForm.resetFields(); setDeductModalOpen(true); }}
                        disabled={laborAccts.length === 0 || approvedRpts.length === 0}
                    >
                        Manual Deduction
                    </Button>
                </Tooltip>
            </div>
            {deductions.length === 0 ? (
                <div style={{
                    textAlign: 'center', padding: '30px 20px',
                    background: t.surface, border: `1px dashed ${t.border}`, borderRadius: 8,
                }}>
                    <DollarOutlined style={{ fontSize: 28, color: t.textMuted, display: 'block', marginBottom: 8 }} />
                    <Text style={{ color: t.textMuted }}>No labor deductions yet.</Text>
                    <br />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        Deductions are created automatically when you approve a weekly report with a Labor account selected.
                    </Text>
                </div>
            ) : (
                <Table
                    dataSource={deductions}
                    columns={deductionColumns}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: 15, showTotal: t => `${t} deductions` }}
                    style={{ background: t.surface, borderRadius: 8 }}
                />
            )}

            {/* ── Add Payroll Member Modal ──────────────────────────────────── */}
            <FormModal
                open={memberModalOpen}
                title="Add Employee to Payroll Pool"
                onCancel={() => { setMemberModalOpen(false); memberForm.resetFields(); }}
                onOk={handleAddMember}
                confirmLoading={memberSaving}
                okText="Add Employee"
            >
                <Form form={memberForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="userId" label="Employee" rules={[{ required: true }]}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="Select employee…"
                            options={allUsers.filter(u => (u as any).isActive !== false).map(u => ({
                                value: u.id,
                                label: `${u.fullName} (@${u.username})`,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item name="budgetAccountId" label="Labor Account" rules={[{ required: true }]}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="Select labor budget account…"
                            options={laborAccts.map(a => ({
                                value: a.id,
                                label: a.isExpired ? `${a.name} — Expired` : a.name,
                                disabled: a.isExpired,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item name="startDate" label="Start Date" rules={[{ required: true }]} initialValue={dayjs()}>
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                        name="endDate"
                        label="End Date (optional)"
                        extra="Set for temporary / seasonal employees (e.g. leave in May, return in September). Leave blank for open-ended employment."
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ── Manual Deduction Modal ────────────────────────────────────── */}
            <FormModal
                open={deductModalOpen}
                title="Manual Labor Deduction"
                onCancel={() => { setDeductModalOpen(false); deductForm.resetFields(); }}
                onOk={handleManualDeduct}
                confirmLoading={deductSaving}
                okText="Record Deduction"
                okButtonProps={{ danger: true }}
            >
                <Form form={deductForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item
                        name="weeklyReportId"
                        label={
                            <Space>
                                Approved Weekly Report
                                <Tooltip title="Only Approved reports are listed. Approve a report in the Reports page first.">
                                    <QuestionCircleOutlined style={{ color: t.textMuted }} />
                                </Tooltip>
                            </Space>
                        }
                        rules={[{ required: true }]}
                    >
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder={`${approvedRpts.length} approved report(s)…`}
                            options={approvedRpts.map(r => ({
                                value: r.id,
                                label: `${r.user?.fullName ?? 'Unknown'} — ${fmtDate(r.weekStart)} (${Number(r.totalHours || 0).toFixed(1)}h)`,
                            }))}
                        />
                    </Form.Item>
                    <Form.Item name="budgetAccountId" label="Labor Account" rules={[{ required: true }]}>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            placeholder="Select account…"
                            options={laborAccts.map(a => ({
                                value: a.id,
                                label: a.isExpired ? `${a.name} (Balance: ${fmt(a.balance)}) — Expired` : `${a.name} (Balance: ${fmt(a.balance)})`,
                                disabled: a.isExpired,
                            }))}
                        />
                    </Form.Item>
                    <Alert
                        type="info"
                        showIcon
                        message="Amount = report hours × the employee's own hourly rate (defaults to $15/hr if none is set). Calculated automatically."
                    />
                </Form>
            </FormModal>
        </div>
    );
}
