import { useEffect, useState, useCallback } from 'react';
import {
    Table, Button, Form, Input, InputNumber, Select, Tag, Space,
    Typography, Alert, Popconfirm, Card, Row, Col, message, Divider,
} from 'antd';
import {
    PlusOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined,
    ShoppingCartOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { getAllocations, purchaseWishlistItem } from '../../api/budget';
import type { ProjectBudgetAllocation, PurchaseWishlistItemPayload } from '../../api/budget';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;

interface WishlistItem {
    id: string;
    itemName: string;
    description: string;
    cost: number;
    link: string;
    status: string;
    projectId: string;
    subProjectId: string;
    requestedBy: string;
    requester?: { fullName: string };
    project?: { name: string };
    createdAt: string;
}

interface BudgetSummary {
    spent: string;
    requested: string;
    approved: string;
    total_items: string;
}

interface Project { id: string; name: string; }

export default function WishlistPage() {
    const user = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const canApprove = hasPermission('manage_projects');
    const canPurchase = hasPermission('manage_projects') && hasPermission('manage_budget');
    const { t } = useTheme();

    const [items, setItems] = useState<WishlistItem[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [budget, setBudget] = useState<BudgetSummary | null>(null);
    const [selectedProject, setSelectedProject] = useState<string | undefined>();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editItem, setEditItem] = useState<WishlistItem | null>(null);
    const [saveLoading, setSaveLoading] = useState(false);
    const [form] = Form.useForm();

    // Purchase modal state
    const [purchaseItem, setPurchaseItem] = useState<WishlistItem | null>(null);
    const [purchaseLoading, setPurchaseLoading] = useState(false);
    const [allocations, setAllocations] = useState<(ProjectBudgetAllocation & { spent: number; balance: number })[]>([]);
    const [allocsLoading, setAllocsLoading] = useState(false);
    const [purchaseForm] = Form.useForm();

    const statusColor: Record<string, string> = {
        Requested: t.accent,
        Approved: t.success,
        Purchased: t.purple,
        Rejected: t.danger,
    };

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [itemsRes, projectsRes] = await Promise.all([
                api.get('/wishlists', { params: selectedProject ? { project: selectedProject } : {} }),
                api.get(canApprove ? '/projects' : '/projects/my'),
            ]);
            setItems(itemsRes.data);
            setProjects(projectsRes.data);
            if (selectedProject) {
                const budgetRes = await api.get(`/wishlists/budget/${selectedProject}`);
                setBudget(budgetRes.data);
            } else {
                setBudget(null);
            }
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load wishlists');
        } finally {
            setLoading(false);
        }
    }, [selectedProject]);

    useEffect(() => { load(); }, [load]);

    const openModal = (item?: WishlistItem) => {
        setEditItem(item ?? null);
        form.setFieldsValue(item ?? { status: 'Requested', cost: 0 });
        setModalOpen(true);
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            setSaveLoading(true);
            if (editItem) {
                await api.patch(`/wishlists/${editItem.id}`, values);
                message.success('Item updated');
            } else {
                await api.post('/wishlists', values);
                message.success('Item added to wishlist');
            }
            setModalOpen(false);
            load();
        } catch (e: any) {
            if (e?.response) message.error(e.response.data?.message ?? 'Save failed');
        } finally {
            setSaveLoading(false);
        }
    };

    const handleStatusChange = async (id: string, status: string) => {
        try {
            await api.patch(`/wishlists/${id}`, { status });
            message.success(`Status updated to ${status}`);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Update failed');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/wishlists/${id}`);
            message.success('Item removed');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const openPurchaseModal = async (item: WishlistItem) => {
        setPurchaseItem(item);
        purchaseForm.resetFields();
        purchaseForm.setFieldsValue({
            expenseDate: dayjs().format('YYYY-MM-DD'),
            category: 'equipment',
            inventoryName: item.itemName,
            inventoryQuantity: 1,
            inventoryUnit: 'pcs',
            inventoryCondition: 'New',
        });
        setAllocsLoading(true);
        try {
            const data = await getAllocations(item.projectId || undefined);
            setAllocations(data as any);
        } catch {
            setAllocations([]);
        } finally {
            setAllocsLoading(false);
        }
    };

    const handlePurchase = async () => {
        if (!purchaseItem) return;
        try {
            const values = await purchaseForm.validateFields();
            setPurchaseLoading(true);
            const payload: PurchaseWishlistItemPayload = {
                allocationId:      values.allocationId,
                expenseDate:       values.expenseDate,
                category:          values.category,
                vendor:            values.vendor || undefined,
                receiptUrl:        values.receiptUrl || undefined,
                inventoryName:     values.inventoryName || undefined,
                inventoryCategory: values.inventoryCategory || undefined,
                inventoryQuantity: values.inventoryQuantity || undefined,
                inventoryUnit:     values.inventoryUnit || undefined,
                inventoryLocation: values.inventoryLocation || undefined,
                inventoryCondition: values.inventoryCondition || undefined,
            };
            await purchaseWishlistItem(purchaseItem.id, payload);
            message.success('Item purchased — expense and inventory entry created');
            setPurchaseItem(null);
            load();
        } catch (e: any) {
            if (e?.response) message.error(e.response.data?.message ?? 'Purchase failed');
        } finally {
            setPurchaseLoading(false);
        }
    };

    const columns = [
        {
            title: 'Item', dataIndex: 'itemName', key: 'itemName',
            render: (v: string, r: WishlistItem) => (
                <div>
                    <Text strong style={{ color: t.text }}>{v}</Text>
                    {r.link && (
                        <><br /><a href={r.link} target="_blank" rel="noreferrer" style={{ color: t.accent, fontSize: 11 }}>View link ↗</a></>
                    )}
                </div>
            ),
        },
        { title: 'Project', key: 'project', render: (_: any, r: WishlistItem) => r.project?.name ? <Tag color={t.accent}>{r.project.name}</Tag> : '—' },
        {
            title: 'Cost', dataIndex: 'cost', key: 'cost',
            render: (v: number) => <Text style={{ color: t.success, fontWeight: 600 }}>${Number(v).toFixed(2)}</Text>,
            sorter: (a: WishlistItem, b: WishlistItem) => Number(a.cost) - Number(b.cost),
        },
        { title: 'Requested By', key: 'requester', render: (_: any, r: WishlistItem) => r.requester?.fullName ?? '—' },
        {
            title: 'Status', dataIndex: 'status', key: 'status',
            render: (v: string) => <Tag color={statusColor[v]}>{v}</Tag>,
        },
        {
            title: 'Actions', key: 'actions',
            render: (_: any, record: WishlistItem) => {
                const isOwner = record.requestedBy === user?.id;
                const canEditDelete = canApprove || isOwner;
                return (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 180, justifyContent: 'flex-start' }}>
                    <Button size="small" icon={<CheckOutlined />} style={{ color: t.success, borderColor: t.success, visibility: (canApprove && record.status === 'Requested') ? 'visible' : 'hidden' }}
                        onClick={() => handleStatusChange(record.id, 'Approved')} />
                    <Button size="small" icon={<CloseOutlined />} danger style={{ visibility: (canApprove && record.status === 'Requested') ? 'visible' : 'hidden' }}
                        onClick={() => handleStatusChange(record.id, 'Rejected')} />
                    <Button size="small" icon={<ShoppingCartOutlined />} style={{ color: t.purple, borderColor: t.purple, visibility: (canPurchase && record.status === 'Approved') ? 'visible' : 'hidden' }}
                        onClick={() => openPurchaseModal(record)}>Purchase…</Button>
                    <Button size="small" icon={<EditOutlined />} style={{ visibility: canEditDelete ? 'visible' : 'hidden' }}
                        onClick={() => openModal(record)} />
                    <Popconfirm title="Remove this item?" onConfirm={() => handleDelete(record.id)} okButtonProps={{ danger: true }}>
                        <Button size="small" danger icon={<DeleteOutlined />} style={{ visibility: canEditDelete ? 'visible' : 'hidden' }} />
                    </Popconfirm>
                </div>
                );
            },
        },
    ];

    return (
        <div style={{ padding: '0 0 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={3} style={{ margin: 0, color: t.text }}>Wishlists</Title>
                <Space>
                    <Select
                        placeholder="Filter by project"
                        allowClear
                        value={selectedProject}
                        onChange={setSelectedProject}
                        options={projects.map((p) => ({ label: p.name, value: p.id }))}
                        style={{ width: 200 }}
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()} style={{ background: t.accent, borderColor: t.accent }}>
                        Add Item
                    </Button>
                </Space>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {/* Budget Summary */}
            {budget && selectedProject && (
                <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
                    {[
                        { label: 'Total Items', value: budget.total_items, color: t.text },
                        { label: 'Requested ($)', value: `$${Number(budget.requested ?? 0).toFixed(2)}`, color: t.warning },
                        { label: 'Approved ($)', value: `$${Number(budget.approved ?? 0).toFixed(2)}`, color: t.success },
                        { label: 'Purchased ($)', value: `$${Number(budget.spent ?? 0).toFixed(2)}`, color: t.purple },
                    ].map((s) => (
                        <Col key={s.label} xs={12} sm={6}>
                            <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10 }} styles={{ body: { padding: 16 } }}>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>{s.label}</Text>
                                <div><Text strong style={{ color: s.color, fontSize: 20 }}>{s.value}</Text></div>
                            </Card>
                        </Col>
                    ))}
                </Row>
            )}

            <Table
                dataSource={items}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                style={{ background: t.surface, borderRadius: 12 }}
            />

            <FormModal
                title={editItem ? 'Edit Wishlist Item' : 'Add Wishlist Item'}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saveLoading}
                okText="Save"
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="itemName" label="Item Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="cost" label="Cost ($)">
                                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="projectId" label="Project">
                                <Select allowClear options={projects.map((p) => ({ label: p.name, value: p.id }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="link" label="Link (URL)">
                        <Input placeholder="https://..." />
                    </Form.Item>
                    {editItem && canApprove && (
                        <Form.Item name="status" label="Status">
                            <Select options={['Requested', 'Approved', 'Purchased', 'Rejected'].map((s) => ({ label: s, value: s }))} />
                        </Form.Item>
                    )}
                </Form>
            </FormModal>

            {/* ── Purchase Modal ─────────────────────────────────────── */}
            <FormModal
                title={`Purchase: ${purchaseItem?.itemName ?? ''}`}
                open={!!purchaseItem}
                onCancel={() => setPurchaseItem(null)}
                onOk={handlePurchase}
                confirmLoading={purchaseLoading}
                okText="Purchase"
            >
                <Form form={purchaseForm} layout="vertical" style={{ marginTop: 16 }}>
                    {purchaseItem && (
                        <div style={{ background: t.surfaceSunken, border: `1px solid ${t.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Item cost: </Text>
                            <Text strong style={{ color: t.success }}>${Number(purchaseItem.cost).toFixed(2)}</Text>
                            {purchaseItem.project?.name && (
                                <><Text style={{ color: t.textMuted, marginLeft: 12 }}>Project: </Text><Tag color={t.accent} style={{ marginLeft: 4 }}>{purchaseItem.project.name}</Tag></>
                            )}
                        </div>
                    )}

                    <Divider orientation={'left' as any} orientationMargin={0} style={{ color: t.accent, borderColor: t.border, fontSize: 12 }}>Budget</Divider>

                    <Row gutter={12}>
                        <Col span={16}>
                            <Form.Item name="allocationId" label="Budget Allocation" rules={[{ required: true, message: 'Select an allocation' }]}>
                                <Select
                                    loading={allocsLoading}
                                    placeholder="Select allocation (project-scoped)"
                                    options={allocations.map((a) => ({
                                        value: a.id,
                                        label: `${a.budgetAccount?.name ?? a.budgetAccountId} — balance: $${(a.balance ?? 0).toFixed(2)}`,
                                        disabled: (a.balance ?? 0) < Number(purchaseItem?.cost ?? 0),
                                    }))}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="expenseDate" label="Expense Date" rules={[{ required: true }]}>
                                <Input type="date" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={8}>
                            <Form.Item name="category" label="Category">
                                <Select options={['equipment', 'supplies', 'travel', 'other'].map((c) => ({ label: c, value: c }))} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="vendor" label="Vendor">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="receiptUrl" label="Receipt URL">
                                <Input placeholder="https://..." />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Divider orientation={'left' as any} orientationMargin={0} style={{ color: t.accent, borderColor: t.border, fontSize: 12 }}>Inventory Item (auto-created)</Divider>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="inventoryName" label="Item Name">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="inventoryCategory" label="Category">
                                <Input placeholder="e.g. Electronics" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={6}>
                            <Form.Item name="inventoryQuantity" label="Qty">
                                <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="inventoryUnit" label="Unit">
                                <Input placeholder="pcs" />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="inventoryCondition" label="Condition">
                                <Select options={['New', 'Good', 'Alright', 'Unknown', 'Damaged'].map((c) => ({ label: c, value: c }))} />
                            </Form.Item>
                        </Col>
                        <Col span={6}>
                            <Form.Item name="inventoryLocation" label="Location">
                                <Input />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </FormModal>
        </div>
    );
}
