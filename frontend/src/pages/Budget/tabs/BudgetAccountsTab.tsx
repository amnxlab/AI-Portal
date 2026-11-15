import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Form, Input, InputNumber, Select, Space, Popconfirm, Tag, Alert, Spin, Progress, Typography, DatePicker, Tooltip} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAccounts, createAccount, updateAccount, deleteAccount, getSources } from '../../../api/budget';
import type { BudgetAccount, FundingSource } from '../../../api/budget';
import { useTheme } from '../../../theme/useTheme';
import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const { Text } = Typography;

const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BudgetAccountsTab() {
    const { selectedId, readOnly } = useBudgetYear();
    const { t } = useTheme();
    const [accounts, setAccounts]   = useState<BudgetAccount[]>([]);
    const [sources, setSources]     = useState<FundingSource[]>([]);
    const [loading, setLoading]     = useState(true);
    const [error, setError]         = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing]     = useState<BudgetAccount | null>(null);
    const [saving, setSaving]       = useState(false);
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [accs, srcs] = await Promise.all([getAccounts(selectedId), getSources(selectedId)]);
            setAccounts(accs);
            setSources(srcs);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load accounts');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ category: 'ProjectSpending', totalAllocated: 0 }); setModalOpen(true); };
    const openEdit   = (a: BudgetAccount) => {
        setEditing(a);
        form.setFieldsValue({
            ...a,
            fundingSourceIds: a.fundingSources.map(s => s.id),
            expiresAt: a.expiresAt ? dayjs(a.expiresAt) : undefined,
        });
        setModalOpen(true);
    };

    const handleSave = async () => {
        try {
            const vals = await form.validateFields();
            setSaving(true);
            const payload: any = { ...vals, expiresAt: vals.expiresAt ? vals.expiresAt.format('YYYY-MM-DD') : null };
            if (editing) {
                // This tab's list is loaded once and can go stale the moment a
                // Transfer moves money in/out of this account elsewhere. If the
                // user didn't actually touch Total Allocated, don't resubmit the
                // (possibly stale) cached value — PATCH is partial, so omitting
                // it here leaves whatever the server currently holds untouched,
                // instead of silently reverting a transfer that happened since load.
                if (!form.isFieldTouched('totalAllocated')) delete payload.totalAllocated;
                const updated = await updateAccount(editing.id, payload);
                setAccounts(prev => prev.map(a => a.id === editing.id ? { ...a, ...updated } : a));
            } else {
                const created = await createAccount(payload);
                setAccounts(prev => [created, ...prev]);
            }
            setModalOpen(false);
            await load(); // reload to get fresh balances
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteAccount(id);
            setAccounts(prev => prev.filter(a => a.id !== id));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const columns = [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Category', dataIndex: 'category', key: 'cat', render: (v: string, r: BudgetAccount) => (
            <Space size={4}>
                <Tag color={v === 'Labor' ? 'blue' : 'green'}>{v === 'Labor' ? 'Labor' : 'Project Spending'}</Tag>
                {r.isExpired && <Tag color="red">Expired</Tag>}
            </Space>
        )},
        { title: 'Funding Sources', key: 'fs', render: (_: any, r: BudgetAccount) =>
            r.fundingSources?.length
                ? r.fundingSources.map(s => <Tag key={s.id} style={{ marginBottom: 2 }}>{s.name}</Tag>)
                : '—'
        },
        { title: 'Allocated', dataIndex: 'totalAllocated', key: 'alloc', render: fmt },
        { title: 'Balance', dataIndex: 'balance', key: 'bal', render: (v: number) =>
            <Text style={{ color: Number(v) < 0 ? t.danger : t.success, fontWeight: 600 }}>{fmt(Number(v))}</Text>
        },
        { title: 'Usage', key: 'usage', render: (_: any, r: BudgetAccount) => {
            const used = Number(r.totalAllocated) - Number(r.balance);
            const pct  = Number(r.totalAllocated) > 0 ? Math.min(100, Math.round((used / Number(r.totalAllocated)) * 100)) : 0;
            return <Progress percent={pct} size="small" status={pct > 90 ? 'exception' : pct > 70 ? 'active' : 'normal'} />;
        }},
        {
            title: 'Actions', key: 'actions',
            render: (_: any, r: BudgetAccount) => (
                <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                    <Popconfirm title="Delete this account?" onConfirm={() => handleDelete(r.id)} okText="Delete" okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <Tooltip title={readOnly ? 'This budget year is archived — accounts can only be recorded in the open year.' : undefined}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={readOnly}>Add Budget Account</Button>
                </Tooltip>
            </div>
            {loading ? <Spin /> : (
                <Table dataSource={accounts} columns={columns} rowKey="id" size="small" />
            )}

            <FormModal
                open={modalOpen}
                title={editing ? 'Edit Budget Account' : 'New Budget Account'}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText="Save"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="fundingSourceIds" label="Funding Sources" rules={[{ required: true, message: 'Select at least one funding source' }]}>
                        <Select
                            mode="multiple"
                            showSearch
                            optionFilterProp="label"
                            options={sources.map(s => ({ value: s.id, label: s.name }))}
                            placeholder="Select one or more funding sources"
                        />
                    </Form.Item>
                    <Form.Item name="name" label="Account Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="category" label="Category" rules={[{ required: true }]}>
                        <Select options={[
                            { value: 'Labor', label: 'Labor' },
                            { value: 'ProjectSpending', label: 'Project Spending' },
                        ]} />
                    </Form.Item>
                    <Form.Item name="totalAllocated" label="Total Allocated ($)" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                    </Form.Item>
                    <Form.Item
                        name="expiresAt"
                        label="Expiration Date (optional)"
                        extra="After this date, the account is locked: no new expenses, allocations, or transfers in either direction. Leave blank for no deadline."
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
