import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Form, InputNumber, Input, Select, Space, Popconfirm, Alert, Spin, Tag, Tooltip} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getAllocations, createAllocation, updateAllocation, deleteAllocation, getAccounts } from '../../../api/budget';
import type { BudgetAccount, ProjectBudgetAllocation } from '../../../api/budget';
import api from '../../../api/axios';
import { useTheme } from '../../../theme/useTheme';
import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const fmt = (n: number) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Project { id: string; name: string; }

export default function ProjectAllocationsTab() {
    const { selectedId, readOnly } = useBudgetYear();
    const { t } = useTheme();
    const [allocations, setAllocations] = useState<ProjectBudgetAllocation[]>([]);
    const [accounts, setAccounts]       = useState<BudgetAccount[]>([]);
    const [projects, setProjects]       = useState<Project[]>([]);
    const [filterProject, setFilterProject] = useState<string | undefined>();
    const [loading, setLoading]         = useState(true);
    const [error, setError]             = useState('');
    const [modalOpen, setModalOpen]     = useState(false);
    const [editing, setEditing]         = useState<ProjectBudgetAllocation | null>(null);
    const [saving, setSaving]           = useState(false);
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [allocs, accs, prjRes] = await Promise.all([
                getAllocations(undefined, selectedId),
                getAccounts(selectedId),
                api.get<Project[]>('/projects'),
            ]);
            setAllocations(allocs);
            setAccounts(accs);
            setProjects(prjRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load allocations');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => { setEditing(null); form.resetFields(); setModalOpen(true); };
    const openEdit   = (a: ProjectBudgetAllocation) => { setEditing(a); form.setFieldsValue(a); setModalOpen(true); };

    const handleSave = async () => {
        try {
            const vals = await form.validateFields();
            setSaving(true);
            if (editing) {
                // This tab's list is loaded once and can go stale the moment a
                // Transfer moves money in/out of this allocation elsewhere. If the
                // user didn't actually touch these money-relevant fields, don't
                // resubmit their (possibly stale) cached values — PATCH is partial,
                // so omitting them leaves whatever the server currently holds
                // untouched, instead of silently reverting a transfer that
                // happened since load.
                const payload: any = { ...vals };
                if (!form.isFieldTouched('allocatedAmount')) delete payload.allocatedAmount;
                if (!form.isFieldTouched('budgetAccountId')) delete payload.budgetAccountId;
                await updateAllocation(editing.id, payload);
            } else {
                await createAllocation(vals);
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
            await deleteAllocation(id);
            setAllocations(prev => prev.filter(a => a.id !== id));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const displayed = filterProject ? allocations.filter(a => a.projectId === filterProject) : allocations;

    const columns = [
        { title: 'Project', key: 'proj', render: (_: any, r: ProjectBudgetAllocation) =>
            <span>{projects.find(p => p.id === r.projectId)?.name ?? r.projectId}</span>
        },
        { title: 'Budget Account', key: 'acct', render: (_: any, r: ProjectBudgetAllocation) => r.budgetAccount?.name ?? '—' },
        { title: 'Allocated', dataIndex: 'allocatedAmount', key: 'alloc', render: fmt },
        { title: 'Spent', dataIndex: 'spent', key: 'spent', render: (v: number) =>
            <span style={{ color: Number(v) > 0 ? t.danger : undefined }}>{fmt(Number(v))}</span>
        },
        { title: 'Remaining', key: 'remaining', render: (_: any, r: ProjectBudgetAllocation) => {
            const rem = Number(r.allocatedAmount) - Number(r.spent ?? 0);
            const color = rem < 0 ? t.danger : rem < Number(r.allocatedAmount) * 0.1 ? t.warning : t.success;
            return <Tag color={color === t.danger ? 'red' : color === t.warning ? 'gold' : 'green'}>{fmt(rem)}</Tag>;
        }},
        { title: 'Notes', dataIndex: 'notes', key: 'notes', render: (v: string) => v || '—' },
        { title: 'Actions', key: 'actions', render: (_: any, r: ProjectBudgetAllocation) => (
            <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                <Popconfirm title="Delete this allocation?" onConfirm={() => handleDelete(r.id)} okText="Delete" okButtonProps={{ danger: true }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
            </Space>
        )},
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <Select
                    allowClear
                    placeholder="Filter by project"
                    
                    onChange={setFilterProject}
                    options={projects.map(p => ({ value: p.id, label: p.name }))}
                />
                <Tooltip title={readOnly ? 'This budget year is archived — allocations can only be recorded in the open year.' : undefined}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={readOnly}>Add Allocation</Button>
                </Tooltip>
            </div>
            {loading ? <Spin /> : (
                <Table dataSource={displayed} columns={columns} rowKey="id" size="small" />
            )}

            <FormModal
                open={modalOpen}
                title={editing ? 'Edit Allocation' : 'New Project Allocation'}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText="Save"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="projectId" label="Project" rules={[{ required: true }]}>
                        <Select showSearch optionFilterProp="label" options={projects.map(p => ({ value: p.id, label: p.name }))} />
                    </Form.Item>
                    <Form.Item name="budgetAccountId" label="Budget Account" rules={[{ required: true }]}>
                        <Select showSearch optionFilterProp="label" options={accounts.map(a => ({
                            value: a.id,
                            label: a.isExpired ? `${a.name} (${a.category}) — Expired` : `${a.name} (${a.category})`,
                            disabled: a.isExpired,
                        }))} />
                    </Form.Item>
                    <Form.Item name="allocatedAmount" label="Allocated Amount ($)" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                    </Form.Item>
                    <Form.Item name="notes" label="Notes">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
