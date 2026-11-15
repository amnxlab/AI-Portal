import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Form, Input, InputNumber, Select, Switch, Space, Popconfirm, Tag, Alert, Spin, Tooltip} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { getSources, createSource, updateSource, deleteSource } from '../../../api/budget';
import type { FundingSource, FundingSourceType } from '../../../api/budget';

import { FormModal } from '../../../components/ui';
import { useBudgetYear } from '../BudgetYearContext';

const SOURCE_TYPE_COLORS: Record<FundingSourceType, string> = {
    grant: 'blue', institutional: 'purple', donation: 'green', external: 'orange', other: 'default',
};

export default function FundingSourcesTab() {
    const { selectedId, readOnly, selected } = useBudgetYear();
    const [sources, setSources] = useState<FundingSource[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState('');
    const [modalOpen, setModalOpen]   = useState(false);
    const [editing, setEditing]       = useState<FundingSource | null>(null);
    const [saving, setSaving]         = useState(false);
    const [form] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setSources(await getSources(selectedId));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load funding sources');
        } finally {
            setLoading(false);
        }
    }, [selectedId]);

    useEffect(() => { load(); }, [load]);

    const openCreate = () => { setEditing(null); form.resetFields(); form.setFieldsValue({ isActive: true, sourceType: 'other', totalAmount: 0 }); setModalOpen(true); };
    const openEdit   = (s: FundingSource) => { setEditing(s); form.setFieldsValue(s); setModalOpen(true); };

    const handleSave = async () => {
        try {
            const vals = await form.validateFields();
            setSaving(true);
            if (editing) {
                const updated = await updateSource(editing.id, vals);
                setSources(prev => prev.map(s => s.id === editing.id ? updated : s));
            } else {
                const created = await createSource(vals);
                setSources(prev => [created, ...prev]);
            }
            setModalOpen(false);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteSource(id);
            setSources(prev => prev.filter(s => s.id !== id));
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const columns = [
        { title: 'Name', dataIndex: 'name', key: 'name' },
        { title: 'Type', dataIndex: 'sourceType', key: 'type', render: (v: FundingSourceType) => <Tag color={SOURCE_TYPE_COLORS[v]}>{v}</Tag> },
        { title: 'Total Amount', dataIndex: 'totalAmount', key: 'amount', render: (v: number) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}` },
        { title: 'Status', dataIndex: 'isActive', key: 'status', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Active' : 'Inactive'}</Tag> },
        {
            title: 'Spans years', dataIndex: 'carriesOver', key: 'carries',
            render: (v: boolean) => (
                <Tooltip title={v
                    ? 'Stays available after this budget year closes — a multi-year award.'
                    : 'Ends with this budget year. It will not appear in next year\u2019s list.'}>
                    <Tag color={v ? 'blue' : 'default'}>{v ? 'Carries over' : 'This year only'}</Tag>
                </Tooltip>
            ),
        },
        { title: 'Description', dataIndex: 'description', key: 'desc', render: (v: string | null) => v ?? '—' },
        {
            title: 'Actions', key: 'actions',
            render: (_: any, r: FundingSource) => (
                <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                    <Popconfirm title="Delete this funding source?" onConfirm={() => handleDelete(r.id)} okText="Delete" okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message={`Funding available in ${selected?.label ?? 'this budget year'}`}
                description={
                    <span style={{ fontSize: 12 }}>
                        This year&rsquo;s own sources, plus any earlier one marked as carrying
                        over. A source raised in a closed year stays with that year unless it is
                        a multi-year award.
                    </span>
                }
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
                <Tooltip title={readOnly ? 'This budget year is archived — funding sources can only be raised in the open year.' : undefined}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={readOnly}>Add Funding Source</Button>
                </Tooltip>
            </div>
            {loading ? <Spin /> : (
                <Table dataSource={sources} columns={columns} rowKey="id" size="small" />
            )}

            <FormModal
                open={modalOpen}
                title={editing ? 'Edit Funding Source' : 'New Funding Source'}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saving}
                okText="Save"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Form.Item name="sourceType" label="Type" rules={[{ required: true }]}>
                        <Select options={[
                            { value: 'grant', label: 'Grant' },
                            { value: 'institutional', label: 'Institutional' },
                            { value: 'donation', label: 'Donation' },
                            { value: 'external', label: 'External' },
                            { value: 'other', label: 'Other' },
                        ]} />
                    </Form.Item>
                    <Form.Item name="totalAmount" label="Total Amount ($)" rules={[{ required: true }]}>
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                    </Form.Item>
                    <Form.Item name="isActive" label="Active" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item
                        name="carriesOver"
                        label="Carries over to future budget years"
                        valuePropName="checked"
                        extra={
                            <span style={{ fontSize: 11, opacity: 0.75 }}>
                                Leave this off for a one-off grant: it ends with its budget year and
                                will not be offered in the next one. Turn it on for a multi-year
                                award, which stays available after the year closes.
                            </span>
                        }
                    >
                        <Switch checkedChildren="Spans years" unCheckedChildren="This year only" />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
