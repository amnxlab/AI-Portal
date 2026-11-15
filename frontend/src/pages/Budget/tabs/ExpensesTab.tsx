import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Form, InputNumber, Input, Select, Space, Popconfirm, Alert, Spin, Tag, DatePicker, Tooltip} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { getExpenses, createExpense, updateExpense, deleteExpense, getAllocations } from '../../../api/budget';
import type { Expense, ProjectBudgetAllocation } from '../../../api/budget';
import api from '../../../api/axios';

import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const CATEGORIES = ['equipment', 'supplies', 'travel', 'other'];
const CAT_COLORS: Record<string, string> = { equipment: 'blue', supplies: 'green', travel: 'orange', other: 'default' };

interface Project { id: string; name: string; }

export default function ExpensesTab() {
    const { selectedId, readOnly } = useBudgetYear();
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [allocations, setAllocations] = useState<ProjectBudgetAllocation[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [filterProject, setFilterProject] = useState<string | undefined>();
    const [filterCat, setFilterCat] = useState<string | undefined>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editing, setEditing] = useState<Expense | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [exps, allocs, prjRes] = await Promise.all([
                getExpenses(undefined, undefined, selectedId),
                getAllocations(undefined, selectedId),
                api.get<Project[]>('/projects'),
            ]);
            setExpenses(exps);
            setAllocations(allocs);
            setProjects(prjRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load expenses');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ category: 'other', expenseDate: dayjs() });
        setModalOpen(true);
    };
    const openEdit = (e: Expense) => {
        setEditing(e);
        form.setFieldsValue({ ...e, expenseDate: dayjs(e.expenseDate) });
        setModalOpen(true);
    };

    const handleSave = async () => {
        try {
            const vals = await form.validateFields();
            // Bug 4 fix: derive projectId from the selected allocation — backend requires it
            const selectedAllocation = allocations.find(a => a.id === vals.allocationId);
            const payload = {
                ...vals,
                expenseDate: vals.expenseDate?.format('YYYY-MM-DD'),
                projectId: selectedAllocation?.projectId ?? vals.projectId,
            };
            setSaving(true);
            if (editing) {
                await updateExpense(editing.id, payload);
            } else {
                await createExpense(payload);
            }
            setModalOpen(false);
            await load();
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteExpense(id);
            setExpenses(prev => prev.filter(e => e.id !== id));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const displayed = expenses
        .filter(e => !filterProject || e.projectId === filterProject)
        .filter(e => !filterCat || e.category === filterCat);

    const columns = [
        { title: 'Date', dataIndex: 'expenseDate', key: 'date', render: (v: string) => new Date(v).toLocaleDateString(), sorter: (a: Expense, b: Expense) => new Date(a.expenseDate).getTime() - new Date(b.expenseDate).getTime() },
        {
            title: 'Description', dataIndex: 'description', key: 'desc',
            render: (v: string, r: Expense) => (
                <Space size={4}>
                    <span>{v}</span>
                    {r.wishlistItemId && <Tag color="gold" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>Wishlist</Tag>}
                </Space>
            ),
        },
        { title: 'Project', key: 'proj', render: (_: any, r: Expense) => projects.find(p => p.id === r.projectId)?.name ?? '—' },
        { title: 'Category', dataIndex: 'category', key: 'cat', render: (v: string) => <Tag color={CAT_COLORS[v] ?? 'default'}>{v}</Tag> },
        { title: 'Amount', dataIndex: 'amount', key: 'amt', render: fmt, sorter: (a: Expense, b: Expense) => Number(a.amount) - Number(b.amount) },
        { title: 'Vendor', dataIndex: 'vendor', key: 'vendor', render: (v: string) => v || '—' },
        { title: 'Receipt', dataIndex: 'receiptUrl', key: 'receipt', render: (v: string) => v ? <a href={v} target="_blank" rel="noreferrer">View</a> : '—' },
        {
            title: 'Actions', key: 'actions', render: (_: any, r: Expense) => (
                <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                    <Popconfirm title="Delete this expense?" onConfirm={() => handleDelete(r.id)} okText="Delete" okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            )
        },
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
                <Space>
                    <Select allowClear placeholder="Filter by project"  onChange={setFilterProject}
                        options={projects.map(p => ({ value: p.id, label: p.name }))} />
                    <Select allowClear placeholder="Filter by category"  onChange={setFilterCat}
                        options={CATEGORIES.map(c => ({ value: c, label: c }))} />
                </Space>
                <Tooltip title={readOnly ? 'This budget year is archived — expenses can only be recorded in the open year.' : undefined}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={readOnly}>Add Expense</Button>
                </Tooltip>
            </div>
            {loading ? <Spin /> : (
                <Table dataSource={displayed} columns={columns} rowKey="id" size="small" />
            )}

            <FormModal
                open={modalOpen}
                title={editing ? 'Edit Expense' : 'New Expense'}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText="Save"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="allocationId" label="Budget Allocation" rules={[{ required: true }]}>
                        <Select showSearch optionFilterProp="label"
                            options={allocations.map(a => ({ value: a.id, label: `${a.budgetAccount?.name ?? '?'} → ${a.project?.name ?? a.projectId}` }))}
                        />
                    </Form.Item>
                    <Form.Item name="description" label="Description" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="amount" label="Amount ($)" rules={[{ required: true }]}>
                        <InputNumber min={0.01} precision={2} style={{ width: '100%' }} prefix="$" />
                    </Form.Item>
                    <Form.Item name="category" label="Category" rules={[{ required: true }]}>
                        <Select options={CATEGORIES.map(c => ({ value: c, label: c }))} />
                    </Form.Item>
                    <Form.Item name="expenseDate" label="Expense Date" rules={[{ required: true }]}>
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="vendor" label="Vendor">
                        <Input />
                    </Form.Item>
                    <Form.Item name="receiptUrl" label="Receipt URL">
                        <Input placeholder="https://..." />
                    </Form.Item>
                    <Form.Item name="wishlistItemId" label="Wishlist Item ID (optional)">
                        <Input placeholder="UUID of wishlist item" />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
