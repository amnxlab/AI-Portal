import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Form, InputNumber, Input, Select, Alert, Spin, Tag, Typography, Tooltip} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { getTransfers, createTransfer, getAccounts, getAllocations } from '../../../api/budget';
import type { BudgetTransfer, BudgetAccount, ProjectBudgetAllocation } from '../../../api/budget';
import api from '../../../api/axios';

import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const { Text } = Typography;
const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TRANSFER_TYPES = [
    { value: 'account_to_account', label: 'Account → Account', from: 'account', to: 'account' },
    { value: 'account_to_project', label: 'Account → Allocation', from: 'account', to: 'allocation' },
    { value: 'project_to_account', label: 'Allocation → Account', from: 'allocation', to: 'account' },
    { value: 'project_to_project', label: 'Allocation → Allocation', from: 'allocation', to: 'allocation' },
];

const TYPE_COLORS: Record<string, string> = {
    account_to_account: 'blue',
    account_to_project: 'purple',
    project_to_account: 'orange',
    project_to_project: 'cyan',
};

// Bug 5: need project names for readable allocation labels
interface Project { id: string; name: string; }

export default function TransfersTab() {
    const { selectedId, readOnly } = useBudgetYear();
    const [transfers, setTransfers] = useState<BudgetTransfer[]>([]);
    const [accounts, setAccounts] = useState<BudgetAccount[]>([]);
    const [allocations, setAllocations] = useState<ProjectBudgetAllocation[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);   // Bug 5 fix
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [selectedType, setSelectedType] = useState<string>('account_to_account');
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            // Bug 5 fix: also load projects so allocation labels show project names, not UUIDs
            const [trans, accs, allocs, prjRes] = await Promise.all([
                getTransfers(selectedId),
                getAccounts(selectedId),
                getAllocations(undefined, selectedId),
                api.get<Project[]>('/projects'),
            ]);
            setTransfers(trans);
            setAccounts(accs);
            setAllocations(allocs);
            setProjects(prjRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load transfers');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => { form.resetFields(); form.setFieldsValue({ transferType: 'account_to_account' }); setSelectedType('account_to_account'); setModalOpen(true); };

    const handleSave = async () => {
        try {
            const vals = await form.validateFields();
            setSaving(true);
            const created = await createTransfer(vals);
            setTransfers(prev => [created, ...prev]);
            setModalOpen(false);
            await load();
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const typeMeta = TRANSFER_TYPES.find(t => t.value === selectedType)!;

    // Bug 5 fix: build a project name lookup map
    const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

    // Bug 5 fix: readable allocation label using projectMap instead of raw UUID
    const allocLabel = (a: ProjectBudgetAllocation) => {
        const projectName = a.project?.name ?? projectMap[a.projectId] ?? a.projectId;
        return `${a.budgetAccount?.name ?? '?'} → ${projectName}`;
    };

    const columns = [
        { title: 'Date', dataIndex: 'createdAt', key: 'date', render: (v: string) => new Date(v).toLocaleDateString() },
        {
            title: 'Type', dataIndex: 'transferType', key: 'type', render: (v: string) =>
                <Tag color={TYPE_COLORS[v] ?? 'default'}>{TRANSFER_TYPES.find(t => t.value === v)?.label ?? v}</Tag>
        },
        { title: 'Amount', dataIndex: 'amount', key: 'amt', render: fmt },
        {
            title: 'From', key: 'from', render: (_: any, r: BudgetTransfer) => {
                if (r.fromAccountId) return r.fromAccount?.name ?? r.fromAccountId;
                if (r.fromAllocationId) {
                    const alloc = r.fromAllocation;
                    const projName = alloc?.project?.name ?? projectMap[alloc?.projectId ?? ''] ?? r.fromAllocationId.slice(0, 8);
                    return `${alloc?.budgetAccount?.name ?? '?'} → ${projName}`;
                }
                return '—';
            }
        },
        {
            title: 'To', key: 'to', render: (_: any, r: BudgetTransfer) => {
                if (r.toAccountId) return r.toAccount?.name ?? r.toAccountId;
                if (r.toAllocationId) {
                    const alloc = r.toAllocation;
                    const projName = alloc?.project?.name ?? projectMap[alloc?.projectId ?? ''] ?? r.toAllocationId.slice(0, 8);
                    return `${alloc?.budgetAccount?.name ?? '?'} → ${projName}`;
                }
                return '—';
            }
        },
        {
            title: 'By', key: 'by', render: (_: any, r: BudgetTransfer) =>
                r.performedBy ? r.performedBy.fullName : '—'
        },
        {
            title: 'Reason', dataIndex: 'reason', key: 'reason', render: (v: string) =>
                <Text style={{ maxWidth: 200 }} ellipsis={{ tooltip: v }}>{v}</Text>
        },
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <Tooltip title={readOnly ? 'This budget year is archived — transfers can only be recorded in the open year.' : undefined}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={readOnly}>New Transfer</Button>
                </Tooltip>
            </div>
            {loading ? <Spin /> : (
                <Table dataSource={transfers} columns={columns} rowKey="id" size="small" />
            )}

            <FormModal
                open={modalOpen}
                title="New Budget Transfer"
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText="Execute Transfer"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="transferType" label="Transfer Type" rules={[{ required: true }]}>
                        <Select
                            options={TRANSFER_TYPES.map(t => ({ value: t.value, label: t.label }))}
                            onChange={v => { setSelectedType(v); form.setFieldsValue({ fromAccountId: undefined, fromAllocationId: undefined, toAccountId: undefined, toAllocationId: undefined }); }}
                        />
                    </Form.Item>

                    {typeMeta?.from === 'account' ? (
                        <Form.Item name="fromAccountId" label="From Account" rules={[{ required: true }]}>
                            <Select showSearch optionFilterProp="label" options={accounts.map(a => ({
                                value: a.id,
                                label: a.isExpired ? `${a.name} — Expired` : a.name,
                                disabled: a.isExpired,
                            }))} />
                        </Form.Item>
                    ) : (
                        <Form.Item name="fromAllocationId" label="From Allocation" rules={[{ required: true }]}>
                            {/* Bug 5 fix: use allocLabel(..) for readable names */}
                            <Select showSearch optionFilterProp="label" options={allocations.map(a => {
                                const acct = accounts.find(x => x.id === a.budgetAccountId);
                                return {
                                    value: a.id,
                                    label: acct?.isExpired ? `${allocLabel(a)} — Account Expired` : allocLabel(a),
                                    disabled: acct?.isExpired,
                                };
                            })} />
                        </Form.Item>
                    )}

                    {typeMeta?.to === 'account' ? (
                        <Form.Item name="toAccountId" label="To Account" rules={[{ required: true }]}>
                            <Select showSearch optionFilterProp="label" options={accounts.map(a => ({
                                value: a.id,
                                label: a.isExpired ? `${a.name} — Expired` : a.name,
                                disabled: a.isExpired,
                            }))} />
                        </Form.Item>
                    ) : (
                        <Form.Item name="toAllocationId" label="To Allocation" rules={[{ required: true }]}>
                            {/* Bug 5 fix: use allocLabel(..) for readable names */}
                            <Select showSearch optionFilterProp="label" options={allocations.map(a => {
                                const acct = accounts.find(x => x.id === a.budgetAccountId);
                                return {
                                    value: a.id,
                                    label: acct?.isExpired ? `${allocLabel(a)} — Account Expired` : allocLabel(a),
                                    disabled: acct?.isExpired,
                                };
                            })} />
                        </Form.Item>
                    )}

                    <Form.Item name="amount" label="Amount ($)" rules={[{ required: true }]}>
                        <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="$" />
                    </Form.Item>
                    <Form.Item name="reason" label="Reason" rules={[{ required: true }]}>
                        <Input.TextArea rows={2} />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
