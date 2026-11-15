import { useMemo, useState } from 'react';
import { Tabs, Space, Select, Tag, Alert, Button, Modal, Form, Input, InputNumber, Switch, Typography, message, Descriptions } from 'antd';
import { DollarCircleOutlined, LockOutlined, CalendarOutlined, ArrowRightOutlined } from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router-dom';
import OverviewTab from './tabs/OverviewTab';
import FundingSourcesTab from './tabs/FundingSourcesTab';
import BudgetAccountsTab from './tabs/BudgetAccountsTab';
import ProjectAllocationsTab from './tabs/ProjectAllocationsTab';
import TransfersTab from './tabs/TransfersTab';
import ExpensesTab from './tabs/ExpensesTab';
import LaborCostsTab from './tabs/LaborCostsTab';
import ReportsTab from './tabs/ReportsTab';
import SimulationTab from './tabs/SimulationTab';
import { BudgetYearProvider, useBudgetYear } from './BudgetYearContext';
import { closeBudgetYear } from '../../api/budget';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';

const { Text } = Typography;

const TAB_ITEMS = [
    { key: 'overview', label: 'Overview', children: <OverviewTab /> },
    { key: 'sources', label: 'Funding Sources', children: <FundingSourcesTab /> },
    { key: 'accounts', label: 'Budget Accounts', children: <BudgetAccountsTab /> },
    { key: 'allocations', label: 'Project Allocations', children: <ProjectAllocationsTab /> },
    { key: 'transfers', label: 'Transfers', children: <TransfersTab /> },
    { key: 'expenses', label: 'Expenses', children: <ExpensesTab /> },
    { key: 'labor', label: 'Labor Costs', children: <LaborCostsTab /> },
    { key: 'reports', label: 'Reports & Export', children: <ReportsTab /> },
    { key: 'simulation', label: 'Simulation', children: <SimulationTab /> },
];

const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Closing the year is the one action in the module that cannot be undone by
 * clicking something else, so it asks for its confirmation in full: which
 * year is being closed, what it is carrying, what will be opened, and —
 * stated plainly, because it is the part people worry about — that nothing
 * is deleted.
 */
function StartNewYearModal({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
    const { t } = useTheme();
    const { activeYear, refresh } = useBudgetYear();
    const [form] = Form.useForm();
    const [saving, setSaving] = useState(false);

    const nextYear = (activeYear?.year ?? new Date().getFullYear()) + 1;

    const submit = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const res = await closeBudgetYear({
                year: values.year,
                label: values.label?.trim() || undefined,
                carryStructure: values.carryStructure,
                notes: values.notes?.trim() || undefined,
            });
            message.success(
                `${res.archived.label} is closed and kept. ${res.opened.label} is open`
                + (res.accountsCreated ? ` with ${res.accountsCreated} account(s) carried over.` : '.'),
                6,
            );
            await refresh();
            onClose(true);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not start the new budget year');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open={open}
            title="Start a new budget year"
            onCancel={() => onClose(false)}
            onOk={submit}
            confirmLoading={saving}
            okText="Close the year and open the next"
            width={620}
            destroyOnHidden
        >
            {!activeYear ? (
                <Alert type="warning" showIcon message="No budget year is currently open." />
            ) : (
                <>
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="Nothing is deleted"
                        description={
                            <span style={{ fontSize: 12 }}>
                                {activeYear.label} keeps every account, allocation, expense and
                                labor entry it has. It becomes read-only and stays available from
                                the year selector, reporting exactly the figures it reports today.
                            </span>
                        }
                    />

                    <Descriptions
                        size="small"
                        column={1}
                        bordered
                        style={{ marginBottom: 18 }}
                        items={[
                            {
                                key: 'closing',
                                label: 'Year being closed',
                                children: (
                                    <Space size={8} wrap>
                                        <Text strong style={{ color: t.text }}>{activeYear.label}</Text>
                                        <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                            {activeYear.accountCount} account(s) · allocated {fmt(activeYear.totalAllocated)} ·
                                            balance {fmt(activeYear.totalBalance)}
                                        </Text>
                                    </Space>
                                ),
                            },
                            {
                                key: 'opening',
                                label: 'Year being opened',
                                children: (
                                    <Form form={form} layout="vertical" initialValues={{
                                        year: nextYear,
                                        label: `${nextYear} Budget`,
                                        carryStructure: true,
                                    }}>
                                        <Space size={10} wrap style={{ width: '100%' }}>
                                            <Form.Item
                                                name="year" label="Year" style={{ marginBottom: 8 }}
                                                rules={[{ required: true, message: 'Required' }]}
                                            >
                                                <InputNumber min={(activeYear.year ?? 0) + 1} max={9999} style={{ width: 110 }} />
                                            </Form.Item>
                                            <Form.Item name="label" label="Name" style={{ marginBottom: 8 }}>
                                                <Input style={{ width: 220 }} placeholder={`${nextYear} Budget`} />
                                            </Form.Item>
                                        </Space>
                                        <Form.Item
                                            name="carryStructure"
                                            label="Carry over the chart of accounts"
                                            valuePropName="checked"
                                            extra={
                                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                    Recreates the same account names, categories and funding
                                                    sources in the new year with <strong>zero allocated</strong>.
                                                    No balance, allocation, expense or labor entry is carried.
                                                    Leave it off to start with no accounts at all.
                                                </Text>
                                            }
                                            style={{ marginBottom: 8 }}
                                        >
                                            <Switch checkedChildren="Copy structure" unCheckedChildren="Start empty" />
                                        </Form.Item>
                                        <Form.Item name="notes" label="Note (optional)" style={{ marginBottom: 0 }}>
                                            <Input.TextArea rows={2} placeholder="Anything worth recording about this year" />
                                        </Form.Item>
                                    </Form>
                                ),
                            },
                        ]}
                    />

                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        After this, new accounts, allocations, expenses and labor can only be
                        recorded against the new year. A year can only be opened once.
                    </Text>
                </>
            )}
        </Modal>
    );
}

function BudgetYearBar() {
    const { t } = useTheme();
    const { years, selected, selectedId, select, readOnly, loading } = useBudgetYear();
    const [wizardOpen, setWizardOpen] = useState(false);

    return (
        <>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                flexWrap: 'wrap', marginBottom: readOnly ? 12 : 20,
            }}>
                <Space size={8}>
                    <CalendarOutlined style={{ color: t.textMuted }} />
                    <Text style={{ color: t.textMuted, fontSize: 13 }}>Budget year</Text>
                </Space>
                <Select
                    value={selectedId}
                    onChange={select}
                    loading={loading}
                    style={{ minWidth: 230 }}
                    options={years.map((y) => ({
                        value: y.id,
                        label: (
                            <Space size={8}>
                                <span>{y.label}</span>
                                {y.status === 'active'
                                    ? <Tag color="green" style={{ marginInlineEnd: 0 }}>Open</Tag>
                                    : <Tag style={{ marginInlineEnd: 0 }}>Archived</Tag>}
                            </Space>
                        ),
                    }))}
                />
                {selected && (
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {selected.accountCount} account(s) · allocated {fmt(selected.totalAllocated)} ·
                        balance {fmt(selected.totalBalance)}
                    </Text>
                )}
                <div style={{ flex: 1 }} />
                <Button icon={<ArrowRightOutlined />} onClick={() => setWizardOpen(true)}>
                    Start new budget year
                </Button>
            </div>

            {readOnly && selected && (
                <Alert
                    type="warning"
                    showIcon
                    icon={<LockOutlined />}
                    style={{ marginBottom: 20 }}
                    message={`${selected.label} is archived and read-only`}
                    description={
                        <span style={{ fontSize: 12 }}>
                            You are looking at a closed year. Everything it recorded is here and
                            unchanged, and nothing can be added to or edited in it &mdash; the
                            server refuses those changes, not just this screen. Switch back to the
                            open year to record anything new.
                        </span>
                    }
                />
            )}

            <StartNewYearModal open={wizardOpen} onClose={() => setWizardOpen(false)} />
        </>
    );
}

function BudgetTabs() {
    const { t } = useTheme();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const activeKey = useMemo(() => {
        const tab = searchParams.get('tab');
        return TAB_ITEMS.some((x) => x.key === tab) ? tab! : 'overview';
    }, [searchParams]);

    return (
        <div style={{ padding: '24px', background: t.bg, minHeight: '100vh' }}>
            <PageHeader
                title={<Space size={8}><DollarCircleOutlined style={{ color: t.accent }} />Budget Management</Space>}
                subtitle="Funding sources, accounts, project allocations, expenses and labour costs"
            />

            <BudgetYearBar />

            <div style={{
                background: t.surface, border: `1px solid ${t.border}`,
                borderRadius: 12, padding: '8px 24px 16px', boxShadow: t.shadowSm,
            }}>
                <Tabs
                    activeKey={activeKey}
                    onChange={(key) => navigate(`/budget?tab=${key}`, { replace: true })}
                    items={TAB_ITEMS}
                    type="line"
                    size="middle"
                />
            </div>
        </div>
    );
}

export default function BudgetPage() {
    return (
        <BudgetYearProvider>
            <BudgetTabs />
        </BudgetYearProvider>
    );
}
