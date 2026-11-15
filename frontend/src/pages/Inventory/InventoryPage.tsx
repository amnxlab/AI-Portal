import { useEffect, useState, useCallback, useMemo } from 'react';
import {
    Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Space,
    Typography, Alert, Badge, Tooltip, Drawer, message, Row, Col,
    Upload, Divider, Card, Statistic, Dropdown,
} from 'antd';
import type { MenuProps } from 'antd';
import {
    PlusOutlined, EditOutlined, DeleteOutlined, ImportOutlined,
    ExportOutlined, HistoryOutlined, SearchOutlined, UploadOutlined,
    UserSwitchOutlined, UserDeleteOutlined, DownloadOutlined, FilterOutlined,
    CloseCircleOutlined, MoreOutlined,
} from '@ant-design/icons';
import Papa from 'papaparse';
import api from '../../api/axios';
import { usePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;

/* ── Interfaces ───────────────────────────────────────────────── */

interface InventoryItem {
    id: string;
    name: string;
    category: string;
    description: string;
    quantity: number;
    unit: string;
    status: string;
    location: string;
    minQuantity: number;
    photoUrl: string;
    code: string;
    subLocation: string;
    extraInfo: string;
    condition: string;
    assignedTo: string;
    assignee?: { id: string; fullName: string };
    sourceWishlistItemId: string | null;
    createdAt: string;
}

interface InventoryLog {
    id: string;
    action: string;
    quantityDelta: number;
    notes: string;
    loggedAt: string;
    user?: { fullName: string };
}

interface CategoryDef {
    id?: string;
    code: string;
    name: string;
}

interface DirectoryUser {
    id: string;
    fullName: string;
    role: string;
}

/* ── Constants ────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
    Available: 'green',
    'Low Stock': 'orange',
    'Out of Stock': 'red',
    Reserved: 'blue',
    'Checked Out': 'purple',
};

const CONDITION_COLORS: Record<string, string> = {
    Good: 'green',
    Alright: 'gold',
    Unknown: 'default',
    Damaged: 'red',
    New: 'blue',
};

/* ── CSV column mapping (screenshot headers → entity fields) ── */
const CSV_HEADER_MAP: Record<string, string> = {
    'item/part/piece': 'name',
    'item': 'name',
    'name': 'name',
    'category': 'category',
    'code': 'code',
    'quantity': 'quantity',
    '#': 'quantity',
    'status': 'status',
    'inventory status': 'status',
    'condition': 'condition',
    'physical condition': 'condition',
    'quality': 'condition',
    'location': 'location',
    'sub-location': 'subLocation',
    'sublocation': 'subLocation',
    'sub_location': 'subLocation',
    'extra info': 'extraInfo',
    'extra_info': 'extraInfo',
    'extrainfo': 'extraInfo',
    'description': 'description',
    'unit': 'unit',
};

const VALID_STATUSES = ['Available', 'Low Stock', 'Out of Stock', 'Discontinued', 'Reserved', 'Checked Out'];
const VALID_CONDITIONS = ['Good', 'Alright', 'Unknown', 'Damaged', 'New'];

/* ══════════════════════════════════════════════════════════════ */

export default function InventoryPage() {
    const { t } = useTheme();
    const { hasPermission } = usePermissions();
    const canManage = hasPermission('manage_inventory');
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [logs, setLogs] = useState<InventoryLog[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
    const [statusFilter, setStatusFilter] = useState<string | undefined>();
    const [conditionFilter, setConditionFilter] = useState<string | undefined>();

    // Categories
    const [categories, setCategories] = useState<CategoryDef[]>([]);

    // Users directory (for assign)
    const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([]);

    // Modals
    const [editOpen, setEditOpen] = useState(false);
    const [editItem, setEditItem] = useState<InventoryItem | null>(null);
    const [logDrawer, setLogDrawer] = useState(false);
    const [logsLoading, setLogsLoading] = useState(false);
    const [checkModal, setCheckModal] = useState<'in' | 'out' | null>(null);
    const [checkItem, setCheckItem] = useState<InventoryItem | null>(null);
    const [checkNotes, setCheckNotes] = useState('');
    const [checkQty, setCheckQty] = useState<number>(1);
    const [checkLoading, setCheckLoading] = useState(false);
    const [form] = Form.useForm();

    // CSV Import
    const [csvModalOpen, setCsvModalOpen] = useState(false);
    const [csvData, setCsvData] = useState<Record<string, any>[]>([]);
    const [csvImporting, setCsvImporting] = useState(false);
    const [csvErrors, setCsvErrors] = useState<{ index: number; error: string }[]>([]);

    // Assign modal
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [assignItem, setAssignItem] = useState<InventoryItem | null>(null);
    const [assignUserId, setAssignUserId] = useState<string | undefined>();
    const [assignNotes, setAssignNotes] = useState('');
    const [assignLoading, setAssignLoading] = useState(false);

    // Add category modal
    const [addCatOpen, setAddCatOpen] = useState(false);
    const [newCatCode, setNewCatCode] = useState('');
    const [newCatName, setNewCatName] = useState('');

    /* ── Data Loading ──────────────────────────────────────────── */

    // Debounce search input — only fire API after 400ms of inactivity
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(search), 400);
        return () => clearTimeout(timer);
    }, [search]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const params: any = {};
            if (debouncedSearch) params.search = debouncedSearch;
            if (categoryFilter) params.category = categoryFilter;
            if (statusFilter) params.status = statusFilter;
            const res = await api.get('/inventory', { params });
            setItems(res.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load inventory');
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, categoryFilter, statusFilter]);

    const loadCategories = useCallback(async () => {
        try {
            const res = await api.get('/inventory/categories');
            setCategories(res.data);
        } catch { /* ignore */ }
    }, []);

    const loadUsers = useCallback(async () => {
        try {
            const res = await api.get('/users/directory');
            setDirectoryUsers(res.data);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { loadCategories(); loadUsers(); }, [loadCategories, loadUsers]);

    /* ── CRUD Handlers ─────────────────────────────────────────── */

    const openEdit = (item?: InventoryItem) => {
        setEditItem(item ?? null);
        form.setFieldsValue(item ?? { unit: 'pcs', status: 'Available', minQuantity: 0, quantity: 0, condition: 'Unknown' });
        setEditOpen(true);
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            if (editItem) {
                await api.patch(`/inventory/${editItem.id}`, values);
                message.success('Item updated');
            } else {
                await api.post('/inventory', values);
                message.success('Item added');
            }
            setEditOpen(false);
            load();
        } catch (e: any) {
            if (e?.response) message.error(e.response.data?.message ?? 'Save failed');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/inventory/${id}`);
            message.success('Item deleted');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    /* ── Check-in / Check-out ──────────────────────────────────── */

    const openLogs = async (item: InventoryItem) => {
        setCheckItem(item);
        setLogDrawer(true);
        setLogsLoading(true);
        try {
            const res = await api.get(`/inventory/${item.id}/logs`);
            setLogs(res.data);
        } catch { setLogs([]); }
        finally { setLogsLoading(false); }
    };

    const handleCheckAction = async () => {
        if (!checkItem || !checkModal) return;
        setCheckLoading(true);
        try {
            await api.post(`/inventory/${checkItem.id}/${checkModal === 'in' ? 'checkin' : 'checkout'}`, {
                notes: checkNotes,
                quantity: checkQty,
            });
            message.success(checkModal === 'in' ? 'Checked in!' : 'Checked out!');
            setCheckModal(null);
            setCheckNotes('');
            setCheckQty(1);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Action failed');
        } finally {
            setCheckLoading(false);
        }
    };

    /* ── Device Assignment ─────────────────────────────────────── */

    const openAssign = (item: InventoryItem) => {
        setAssignItem(item);
        setAssignUserId(undefined);
        setAssignNotes('');
        setAssignModalOpen(true);
    };

    const handleAssign = async () => {
        if (!assignItem || !assignUserId) return;
        setAssignLoading(true);
        try {
            await api.post(`/inventory/${assignItem.id}/assign`, { assigneeId: assignUserId, notes: assignNotes });
            message.success('Device assigned successfully');
            setAssignModalOpen(false);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Assignment failed');
        } finally { setAssignLoading(false); }
    };

    const handleUnassign = async (item: InventoryItem) => {
        try {
            await api.post(`/inventory/${item.id}/unassign`, {});
            message.success('Device unassigned');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Unassign failed');
        }
    };

    /* ── CSV Import ────────────────────────────────────────────── */

    const resolveCategoryName = (raw: string): string => {
        if (!raw) return '';
        const upper = raw.trim().toUpperCase();
        // Check if it's a category code (e.g., "MAC", "TLS")
        const byCode = categories.find(c => c.code.toUpperCase() === upper);
        if (byCode) return byCode.name;
        // Check if it's already a full name
        const byName = categories.find(c => c.name.toLowerCase() === raw.trim().toLowerCase());
        if (byName) return byName.name;
        return raw.trim();
    };

    const handleCsvFile = (file: File) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const mapped = results.data.map((row: any) => {
                    const item: Record<string, any> = {};
                    for (const [csvHeader, value] of Object.entries(row)) {
                        const key = CSV_HEADER_MAP[csvHeader.toLowerCase().trim()];
                        if (key) {
                            if (key === 'quantity') {
                                item[key] = parseInt(String(value), 10) || 0;
                            } else if (key === 'category') {
                                item[key] = resolveCategoryName(String(value));
                            } else {
                                item[key] = String(value).trim();
                            }
                        }
                    }
                    // Default values
                    if (!item.name) return null;
                    if (!item.quantity) item.quantity = 0;
                    if (!item.unit) item.unit = 'pcs';
                    // Normalize status — default to 'Available' if missing or unrecognised
                    if (!item.status || !VALID_STATUSES.includes(item.status)) item.status = 'Available';
                    // Normalize condition — default to 'Unknown' if missing or unrecognised
                    if (!item.condition || !VALID_CONDITIONS.includes(item.condition)) item.condition = 'Unknown';
                    return item;
                }).filter((item): item is Record<string, any> => item !== null);
                setCsvData(mapped);
                setCsvErrors([]);
                if (mapped.length === 0) {
                    message.warning('No valid rows found in CSV. Check that headers match expected fields.');
                }
            },
            error: () => {
                message.error('Failed to parse CSV file');
            },
        });
        return false; // prevent Upload from POSTing
    };

    const handleCsvImport = async () => {
        if (csvData.length === 0) return;
        setCsvImporting(true);
        setCsvErrors([]);
        try {
            const res = await api.post('/inventory/bulk', { items: csvData });
            if (res.data.failed > 0) {
                setCsvErrors(res.data.errors ?? []);
                if (res.data.imported > 0) {
                    message.warning(`Imported ${res.data.imported} item(s), ${res.data.failed} failed — see errors below`);
                    load();
                } else {
                    message.error(`Import failed: all ${res.data.failed} row(s) could not be saved — see errors below`);
                }
            } else {
                message.success(`Imported ${res.data.imported} item(s) successfully`);
                setCsvModalOpen(false);
                setCsvData([]);
                load();
            }
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Import failed');
        } finally { setCsvImporting(false); }
    };

    /* ── Add Category ──────────────────────────────────────────── */

    const handleAddCategory = async () => {
        if (!newCatCode.trim() || !newCatName.trim()) { message.warning('Both code and name are required'); return; }
        try {
            await api.post('/inventory/categories', { code: newCatCode.trim().toUpperCase(), name: newCatName.trim() });
            message.success('Category added');
            setAddCatOpen(false);
            setNewCatCode('');
            setNewCatName('');
            loadCategories();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to add category');
        }
    };

    /* ── Category helpers ──────────────────────────────────────── */

    const categoryOptions = categories.map((c) => ({
        label: c.code ? `[${c.code}] ${c.name}` : c.name,
        value: c.name,
    }));

    const filterCategories = [...new Set([...categories.map(c => c.name), ...items.map(i => i.category).filter(Boolean)])];

    /* ── Derived stats ─────────────────────────────────────────── */
    const stats = useMemo(() => ({
        total:      items.length,
        available:  items.filter(i => i.status === 'Available').length,
        lowStock:   items.filter(i => i.status === 'Low Stock').length,
        outOfStock: items.filter(i => i.status === 'Out of Stock').length,
        reserved:   items.filter(i => i.status === 'Reserved').length,
        checkedOut: items.filter(i => i.status === 'Checked Out').length,
    }), [items]);

    /* ── Client-side condition filter (condition not sent to API) ── */
    const displayItems = useMemo(() =>
        conditionFilter ? items.filter(i => i.condition === conditionFilter) : items
    , [items, conditionFilter]);

    /* ── Export current view as CSV ────────────────────────────── */
    const handleExport = () => {
        const rows = displayItems.map(i => ({
            Name: i.name,
            Code: i.code ?? '',
            Category: i.category ?? '',
            Quantity: i.quantity,
            Unit: i.unit,
            Status: i.status,
            Condition: i.condition ?? '',
            Location: i.location ?? '',
            'Sub-Location': i.subLocation ?? '',
            'Extra Info': i.extraInfo ?? '',
            Description: i.description ?? '',
            'Assigned To': i.assignee?.fullName ?? '',
        }));
        const csv = Papa.unparse(rows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const hasActiveFilters = !!(search || categoryFilter || statusFilter || conditionFilter);

    /* ── Category color map ────────────────────────────────────── */
    const CATEGORY_COLORS: Record<string, string> = {
        Electronics:        t.chart[0],
        'Computing Hardware': t.chart[4],
        Organization:       t.chart[1],
        Tools:              t.chart[5],
        Sensors:            t.chart[6],
        'Cables/Adaptors':  t.chart[3],
        Machineary:         t.chart[9],
        Miscellanous:       t.chart[8],
        Robotics:           t.chart[10],
        Devices:            t.chart[2],
    };

    /* ── Table Columns ─────────────────────────────────────────── */

    const columns = [
        {
            title: 'Name', dataIndex: 'name', key: 'name',
            sorter: (a: InventoryItem, b: InventoryItem) => a.name.localeCompare(b.name),
            render: (v: string, r: InventoryItem) => (
                <div>
                    <Text strong style={{ color: t.text }}>{v}</Text>
                    {r.quantity <= r.minQuantity && r.minQuantity > 0 && (
                        <Badge count="Low Stock" style={{ marginLeft: 8, background: t.warning, fontSize: 10 }} />
                    )}
                    {r.sourceWishlistItemId && (
                        <Tag color="gold" style={{ marginLeft: 6, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>Wishlist</Tag>
                    )}
                </div>
            ),
        },
        {
            title: 'Code', dataIndex: 'code', key: 'code',
            render: (v: string) => v ? <Text style={{ color: t.textMuted, fontFamily: 'monospace' }}>{v}</Text> : '—',
        },
        {
            title: 'Category', dataIndex: 'category', key: 'category',
            render: (v: string) => v ? <Tag color={CATEGORY_COLORS[v] ?? t.purple}>{v}</Tag> : '—',
        },
        {
            title: 'Qty', key: 'qty',
            sorter: (a: InventoryItem, b: InventoryItem) => a.quantity - b.quantity,
            render: (_: any, r: InventoryItem) => (
                <Text style={{ color: r.quantity === 0 ? t.danger : r.quantity <= r.minQuantity ? t.warning : t.success, fontWeight: 600 }}>
                    {r.quantity} {r.unit}
                </Text>
            ),
        },
        {
            title: 'Condition', dataIndex: 'condition', key: 'condition',
            render: (v: string) => v ? <Tag color={CONDITION_COLORS[v] ?? 'default'}>{v}</Tag> : '—',
        },
        { title: 'Location', dataIndex: 'location', key: 'location', render: (v: string) => v || '—' },
        {
            title: 'Sub-Loc', dataIndex: 'subLocation', key: 'subLocation',
            render: (v: string) => v ? <Text style={{ color: t.textMuted }}>{v}</Text> : '—',
        },
        {
            title: 'Status', dataIndex: 'status', key: 'status',
            render: (v: string) => <Tag color={STATUS_COLORS[v] ?? 'default'}>{v}</Tag>,
        },
        {
            title: 'Assigned To', key: 'assignedTo',
            render: (_: any, r: InventoryItem) =>
                r.assignee ? <Tag color="purple">{r.assignee.fullName}</Tag> : '—',
        },
        {
            title: 'Actions', key: 'actions', fixed: 'right' as const, width: 110,
            render: (_: any, record: InventoryItem) => {
                const isCheckedOut = record.status === 'Checked Out';
                // Check BOTH the FK column and the relation object — TypeORM may
                // return only one depending on the query path used
                const isAssigned = !!(record.assignedTo || record.assignee);

                const menuItems: MenuProps['items'] = [
                    ...(canManage ? [
                    {
                        key: 'checkin',
                        label: 'Check In',
                        icon: <ImportOutlined style={{ color: t.success }} />,
                        disabled: !isCheckedOut,
                        onClick: () => { setCheckItem(record); setCheckModal('in'); },
                    },
                    {
                        key: 'checkout',
                        label: 'Check Out',
                        icon: <ExportOutlined style={{ color: t.warning }} />,
                        disabled: isCheckedOut,
                        onClick: () => { setCheckItem(record); setCheckModal('out'); },
                    },
                    ] : []),
                    ...(canManage ? [
                        { type: 'divider' as const },
                        isAssigned
                            ? {
                                key: 'unassign',
                                label: `Unassign (${record.assignee?.fullName ?? 'user'})`,
                                icon: <UserDeleteOutlined style={{ color: t.danger }} />,
                                onClick: () => Modal.confirm({
                                    title: `Unassign ${record.assignee?.fullName ?? 'this user'}?`,
                                    content: `"${record.name}" will be unassigned and become available again.`,
                                    okText: 'Unassign',
                                    okButtonProps: { danger: true },
                                    onOk: () => handleUnassign(record),
                                }),
                                danger: true,
                            }
                            : {
                                key: 'assign',
                                label: 'Assign to Employee',
                                icon: <UserSwitchOutlined style={{ color: t.purple }} />,
                                onClick: () => openAssign(record),
                            },
                    ] : []),
                    ...(canManage ? [
                        { type: 'divider' as const },
                        {
                            key: 'delete',
                            label: 'Delete',
                            icon: <DeleteOutlined />,
                            danger: true,
                            onClick: () => {
                                Modal.confirm({
                                    title: 'Delete this item?',
                                    content: `"${record.name}" will be permanently removed.`,
                                    okText: 'Delete',
                                    okButtonProps: { danger: true },
                                    onOk: () => handleDelete(record.id),
                                });
                            },
                        },
                    ] : []),
                ];

                return (
                    <Space size={4}>
                        {/* Logs — always visible */}
                        <Tooltip title="View Logs">
                            <Button
                                size="small"
                                icon={<HistoryOutlined />}
                                onClick={() => openLogs(record)}
                                style={{ color: t.textMuted, borderColor: t.border }}
                            />
                        </Tooltip>
                        {/* Edit — always rendered; hidden for non-managers so the column stays stable */}
                        <Tooltip title="Edit">
                            <Button
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => openEdit(record)}
                                style={{ color: t.accent, borderColor: t.border, visibility: canManage ? 'visible' : 'hidden' }}
                            />
                        </Tooltip>
                        {/* More actions dropdown */}
                        <Dropdown
                            menu={{ items: menuItems }}
                            trigger={['click']}
                            overlayStyle={{ minWidth: 200 }}
                        >
                            <Button
                                size="small"
                                icon={<MoreOutlined />}
                                style={{ color: t.textMuted, borderColor: t.border }}
                            />
                        </Dropdown>
                    </Space>
                );
            },
        },
    ];

    /* ── Render ─────────────────────────────────────────────────── */

    return (
        <div style={{ padding: '0 0 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={3} style={{ margin: 0, color: t.text }}>Inventory</Title>
                <Space wrap>
                        <Button icon={<DownloadOutlined />} onClick={handleExport}
                            style={{ borderColor: t.accent, color: t.accent }}>
                            Export CSV
                        </Button>
                        {canManage && (<>
                        <Button icon={<UploadOutlined />} onClick={() => { setCsvData([]); setCsvErrors([]); setCsvModalOpen(true); }}
                            style={{ borderColor: t.success, color: t.success }}>
                            Import CSV
                        </Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openEdit()} style={{ background: t.purple }}>
                            Add Item
                        </Button>
                        </>)}
                    </Space>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {/* ── Stat Cards ─────────────────────────────────────── */}
            <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
                {[
                    { label: 'Total Items',   value: stats.total,      color: t.textMuted, status: undefined },
                    { label: 'Available',     value: stats.available,  color: t.success, status: 'Available' },
                    { label: 'Low Stock',     value: stats.lowStock,   color: t.warning, status: 'Low Stock' },
                    { label: 'Out of Stock',  value: stats.outOfStock, color: t.danger, status: 'Out of Stock' },
                    { label: 'Reserved',      value: stats.reserved,   color: t.info, status: 'Reserved' },
                    { label: 'Checked Out',   value: stats.checkedOut, color: t.purple, status: 'Checked Out' },
                ].map(({ label, value, color, status }) => (
                    <Col key={label} xs={12} sm={8} md={4}>
                        <Card
                            size="small"
                            hoverable
                            onClick={() => setStatusFilter(statusFilter === status ? undefined : status)}
                            style={{
                                background: statusFilter === status ? alpha(color, 0.13) : t.surface,
                                borderColor: statusFilter === status ? color : t.border,
                                cursor: 'pointer',
                                textAlign: 'center',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Statistic
                                title={<span style={{ color: t.textMuted, fontSize: 11 }}>{label}</span>}
                                value={value}
                                valueStyle={{ color, fontSize: 22, fontWeight: 700 }}
                            />
                        </Card>
                    </Col>
                ))}
            </Row>

            {/* ── Filters ────────────────────────────────────────── */}
            <Row gutter={[12, 8]} style={{ marginBottom: 16 }} align="middle">
                <Col xs={24} sm={8}>
                    <Input
                        prefix={<SearchOutlined style={{ color: t.textFaint }} />}
                        placeholder="Search name, code, description..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        allowClear
                        style={{ background: t.surface, borderColor: t.border }}
                    />
                </Col>
                <Col xs={12} sm={5}>
                    <Select
                        placeholder="Category"
                        allowClear
                        value={categoryFilter}
                        onChange={setCategoryFilter}
                        options={filterCategories.map((c) => ({ label: c, value: c }))}
                        style={{ width: '100%' }}
                    />
                </Col>
                <Col xs={12} sm={5}>
                    <Select
                        placeholder="Status"
                        allowClear
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={['Available', 'Low Stock', 'Out of Stock', 'Reserved', 'Checked Out'].map((s) => ({ label: s, value: s }))}
                        style={{ width: '100%' }}
                    />
                </Col>
                <Col xs={12} sm={4}>
                    <Select
                        placeholder="Condition"
                        allowClear
                        value={conditionFilter}
                        onChange={setConditionFilter}
                        options={['New', 'Good', 'Alright', 'Unknown', 'Damaged'].map((c) => ({ label: c, value: c }))}
                        style={{ width: '100%' }}
                    />
                </Col>
                {hasActiveFilters && (
                    <Col xs={12} sm={2}>
                        <Button
                            icon={<CloseCircleOutlined />}
                            onClick={() => { setSearch(''); setCategoryFilter(undefined); setStatusFilter(undefined); setConditionFilter(undefined); }}
                            style={{ color: t.danger, borderColor: alpha(t.danger, 0.28), background: alpha(t.danger, 0.1), width: '100%' }}
                        >
                            Clear
                        </Button>
                    </Col>
                )}
                <Col flex="1" style={{ textAlign: 'right' }}>
                    <Text style={{ color: t.textFaint, fontSize: 12 }}>
                        <FilterOutlined style={{ marginRight: 4 }} />
                        {displayItems.length} item{displayItems.length !== 1 ? 's' : ''}
                    </Text>
                </Col>
            </Row>

            <Table
                dataSource={displayItems}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['15', '30', '50'], showTotal: (total) => `${total} items` }}
                style={{ background: t.surface, borderRadius: 12 }}
                scroll={{ x: 1200 }}
                rowClassName={(_, i) => i % 2 === 0 ? 'row-even' : ''}
                expandable={{
                    expandedRowRender: (r: InventoryItem) => (
                        <div style={{ padding: '8px 24px', background: t.surfaceSunken, borderRadius: 8, display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                            {r.description && <div><Text style={{ color: t.textFaint, fontSize: 11 }}>Description</Text><br /><Text style={{ color: t.textMuted }}>{r.description}</Text></div>}
                            {r.extraInfo   && <div><Text style={{ color: t.textFaint, fontSize: 11 }}>Extra Info</Text><br /><Text style={{ color: t.textMuted }}>{r.extraInfo}</Text></div>}
                            {r.minQuantity > 0 && <div><Text style={{ color: t.textFaint, fontSize: 11 }}>Min Qty</Text><br /><Text style={{ color: t.warning }}>{r.minQuantity} {r.unit}</Text></div>}
                            {r.code && <div><Text style={{ color: t.textFaint, fontSize: 11 }}>Code</Text><br /><Text style={{ color: t.textMuted, fontFamily: 'monospace' }}>{r.code}</Text></div>}
                            {r.assignee && <div><Text style={{ color: t.textFaint, fontSize: 11 }}>Assigned To</Text><br /><Tag color="purple">{r.assignee.fullName}</Tag></div>}
                        </div>
                    ),
                    rowExpandable: (r: InventoryItem) => !!(r.description || r.extraInfo || r.minQuantity > 0),
                }}
            />

            {/* ── Add/Edit Modal ──────────────────────────────────── */}
            <FormModal
                title={editItem ? 'Edit Item' : 'Add Inventory Item'}
                open={editOpen}
                onCancel={() => setEditOpen(false)}
                onOk={handleSave}
                okText="Save"
                width={640}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="name" label="Name" rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="category" label="Category">
                                <Select
                                    options={categoryOptions}
                                    showSearch
                                    optionFilterProp="label"
                                    style={{ width: '100%' }}
                                    dropdownRender={(menu) => (
                                        <>
                                            {menu}
                                            <Divider style={{ margin: '8px 0' }} />
                                            <Button type="link" icon={<PlusOutlined />} onClick={() => setAddCatOpen(true)}
                                                style={{ width: '100%', textAlign: 'left', color: t.purple }}>
                                                Add New Category
                                            </Button>
                                        </>
                                    )}
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="code" label="Code">
                                <Input placeholder="e.g. MAC-PA1-100" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="location" label="Location">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="subLocation" label="Sub-Location">
                                <Input placeholder="e.g. C:B1" />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={8}>
                            <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}>
                                <InputNumber style={{ width: '100%' }} min={0} />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="unit" label="Unit">
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col span={8}>
                            <Form.Item name="minQuantity" label="Min Qty">
                                <InputNumber style={{ width: '100%' }} min={0} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col span={12}>
                            <Form.Item name="status" label="Status">
                                <Select options={['Available', 'Low Stock', 'Out of Stock', 'Reserved', 'Checked Out'].map((s) => ({ label: s, value: s }))} />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item name="condition" label="Condition">
                                <Select options={['Good', 'Alright', 'Unknown', 'Damaged', 'New'].map((s) => ({ label: s, value: s }))} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="extraInfo" label="Extra Info">
                        <Input />
                    </Form.Item>
                    <Form.Item name="description" label="Description">
                        <Input.TextArea rows={3} />
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ── Check-in / Check-out Modal ──────────────────────── */}
            <FormModal
                title={`${checkModal === 'in' ? '📥 Check In' : '📤 Check Out'} — ${checkItem?.name}`}
                open={!!checkModal}
                onCancel={() => { setCheckModal(null); setCheckNotes(''); setCheckQty(1); }}
                onOk={handleCheckAction}
                confirmLoading={checkLoading}
                okText={checkModal === 'in' ? 'Confirm Check In' : 'Confirm Check Out'}
            >
                <div style={{ marginTop: 16 }}>
                    <Alert
                        type="info"
                        style={{ marginBottom: 16, background: t.surfaceSunken, borderColor: t.border }}
                        message={
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                {checkModal === 'out'
                                    ? 'Check Out reduces the item quantity and logs the movement.'
                                    : 'Check In increases the item quantity and logs the movement.'}
                            </Text>
                        }
                    />
                    <div style={{ marginBottom: 12 }}>
                        <Text style={{ color: t.textMuted }}>Quantity</Text>
                        <InputNumber
                            min={1}
                            max={checkModal === 'out' ? (checkItem?.quantity ?? 1) : undefined}
                            value={checkQty}
                            onChange={(v) => setCheckQty(v ?? 1)}
                            style={{ width: '100%', marginTop: 8 }}
                        />
                    </div>
                    <Text style={{ color: t.textMuted }}>Notes (optional)</Text>
                    <Input.TextArea rows={3} value={checkNotes} onChange={(e) => setCheckNotes(e.target.value)} style={{ marginTop: 8 }} />
                </div>
            </FormModal>

            {/* ── Assign Device Modal ─────────────────────────────── */}
            <FormModal
                title={`🔒 Assign Device — ${assignItem?.name}`}
                open={assignModalOpen}
                onCancel={() => setAssignModalOpen(false)}
                onOk={handleAssign}
                confirmLoading={assignLoading}
                okText="Assign"
                okButtonProps={{ disabled: !assignUserId }}
            >
                <div style={{ marginTop: 16 }}>
                    <Text style={{ color: t.textMuted }}>Assign To</Text>
                    <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="Select employee..."
                        value={assignUserId}
                        onChange={setAssignUserId}
                        options={directoryUsers.map(u => ({ label: u.fullName, value: u.id }))}
                        style={{ width: '100%', marginTop: 8, marginBottom: 16 }}
                    />
                    <Text style={{ color: t.textMuted }}>Notes (optional)</Text>
                    <Input.TextArea rows={2} value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)}
                        placeholder="e.g. For remote work, expected return date..."
                        style={{ marginTop: 8 }} />
                </div>
            </FormModal>

            {/* ── CSV Import Modal ────────────────────────────────── */}
            <Modal
                title="📁 Import CSV"
                open={csvModalOpen}
                onCancel={() => { setCsvModalOpen(false); setCsvData([]); setCsvErrors([]); }}
                onOk={handleCsvImport}
                confirmLoading={csvImporting}
                okText={`Import ${csvData.length} Item(s)`}
                okButtonProps={{ disabled: csvData.length === 0 }}
                width={900}
            >
                <div style={{ marginTop: 16 }}>
                    <Upload.Dragger
                        accept=".csv"
                        showUploadList={false}
                        beforeUpload={handleCsvFile}
                        style={{ background: t.surfaceSunken, borderColor: t.border, marginBottom: 16 }}
                    >
                        <p style={{ color: t.textMuted }}>
                            <UploadOutlined style={{ fontSize: 24, marginBottom: 8 }} /><br />
                            Click or drag a CSV file here
                        </p>
                        <p style={{ color: t.textFaint, fontSize: 12 }}>
                            Expected columns: Item/Part/Piece, Category, Code, Quantity, Status, Condition, Location, Sub-Location, Extra Info<br />
                            Status values: Available, Low Stock, Out of Stock, Discontinued, Reserved, Checked Out<br />
                            Condition values: New, Good, Alright, Unknown, Damaged
                        </p>
                    </Upload.Dragger>

                    {csvData.length > 0 && (
                        <>
                            <Alert type="info" message={`${csvData.length} row(s) parsed — review and click Import`} style={{ marginBottom: 12 }} />
                            <Table
                                dataSource={csvData.map((r, i) => ({ ...r, _key: i }))}
                                rowKey="_key"
                                size="small"
                                pagination={{ pageSize: 10 }}
                                scroll={{ x: 900 }}
                                columns={[
                                    { title: 'Name', dataIndex: 'name', key: 'name', width: 180 },
                                    { title: 'Category', dataIndex: 'category', key: 'category', width: 120 },
                                    { title: 'Code', dataIndex: 'code', key: 'code', width: 120 },
                                    { title: 'Qty', dataIndex: 'quantity', key: 'quantity', width: 60 },
                                    { title: 'Status', dataIndex: 'status', key: 'status', width: 110 },
                                    { title: 'Condition', dataIndex: 'condition', key: 'condition', width: 90 },
                                    { title: 'Location', dataIndex: 'location', key: 'location', width: 80 },
                                    { title: 'Sub-Loc', dataIndex: 'subLocation', key: 'subLocation', width: 80 },
                                    { title: 'Extra Info', dataIndex: 'extraInfo', key: 'extraInfo', width: 120 },
                                ]}
                            />
                            {csvErrors.length > 0 && (
                                <Alert
                                    type="error"
                                    style={{ marginTop: 12 }}
                                    message={`${csvErrors.length} row(s) failed to import`}
                                    description={
                                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                                            {csvErrors.map((e) => (
                                                <li key={e.index}>Row {e.index + 1}: {e.error}</li>
                                            ))}
                                        </ul>
                                    }
                                />
                            )}
                        </>
                    )}
                </div>
            </Modal>

            {/* ── Add Category Modal ──────────────────────────────── */}
            <FormModal
                title="Add New Category"
                open={addCatOpen}
                onCancel={() => setAddCatOpen(false)}
                onOk={handleAddCategory}
                okText="Add"
            >
                <div style={{ marginTop: 16 }}>
                    <Text style={{ color: t.textMuted }}>Category Code (e.g. DEV)</Text>
                    <Input value={newCatCode} onChange={(e) => setNewCatCode(e.target.value)}
                        style={{ marginTop: 8, marginBottom: 16 }}
                        maxLength={5} placeholder="3-letter code" />
                    <Text style={{ color: t.textMuted }}>Category Name</Text>
                    <Input value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                        style={{ marginTop: 8 }}
                        placeholder="e.g. Devices" />
                </div>
            </FormModal>

            {/* ── Logs Drawer ─────────────────────────────────────── */}
            <Drawer
                title={<Text style={{ color: t.text }}>Logs — {checkItem?.name}</Text>}
                open={logDrawer}
                onClose={() => setLogDrawer(false)}
                width={480}
                styles={{ body: { background: t.surface }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, wrapper: { background: t.surface } }}
            >
                {logsLoading ? <Text style={{ color: t.textMuted }}>Loading...</Text> : logs.length === 0 ? (
                    <Text style={{ color: t.textFaint }}>No logs for this item.</Text>
                ) : (
                    logs.map((log) => {
                        const actionColor = log.action === 'check_in' ? 'green' : log.action === 'check_out' ? 'orange'
                            : log.action === 'assign' ? 'purple' : log.action === 'unassign' ? 'red' : 'blue';
                        return (
                            <div key={log.id} style={{ padding: '10px 0', borderBottom: `1px solid ${t.border}` }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Tag color={actionColor}>
                                        {log.action.replace('_', ' ').toUpperCase()}
                                    </Tag>
                                    <Text style={{ color: t.textFaint, fontSize: 11 }}>{new Date(log.loggedAt).toLocaleString()}</Text>
                                </div>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                    {log.user?.fullName ?? 'Unknown'}
                                    {log.quantityDelta != null && ` · Δ ${log.quantityDelta > 0 ? '+' : ''}${log.quantityDelta}`}
                                </Text>
                                {log.notes && <><br /><Text style={{ color: t.textFaint, fontSize: 11 }}>{log.notes}</Text></>}
                            </div>
                        );
                    })
                )}
            </Drawer>
        </div>
    );
}
