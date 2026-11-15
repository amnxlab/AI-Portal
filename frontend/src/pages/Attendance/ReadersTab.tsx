import { useState, useEffect, useCallback } from 'react';
import {
    Table, Tag, Typography, Button, Space, Form, Input, Switch, Alert, Row, Col,
    message, Tooltip, Popconfirm,
} from 'antd';
import {
    PlusOutlined, ReloadOutlined, KeyOutlined, DeleteOutlined, CopyOutlined, EditOutlined,
    WifiOutlined, ApiOutlined, ScanOutlined, StopOutlined, HistoryOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    listDevices, createDevice, updateDevice, rotateDeviceKey, deleteDevice, listEvents,
    formatUid, type RfidDevice, type RfidEvent,
} from '../../api/rfid';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { Panel, StatCard, LoadingState, EmptyState, FormModal } from '../../components/ui';

const { Text, Paragraph } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   RFID readers and their event log.

   A reader authenticates with its own device ID and API key — it has no
   user account and no token. The key is generated on the server, shown
   once here, and only its SHA-256 is stored, so it cannot be read back:
   if it is lost, rotate it and reflash the reader.

   "Online" means the reader has polled within the last few seconds. The
   reader polls continuously, which is also how it learns that it should
   enter card-registration mode.
   ═══════════════════════════════════════════════════════════════════════ */

const RESULT_TONE: Record<string, string> = {
    clock_in: 'success', clock_out: 'success', registered: 'success',
    duplicate: 'default', unknown_card: 'warning', card_removed: 'warning',
    inactive_employee: 'error', registration_failed: 'error', invalid_card: 'error',
    pending_signup: 'warning',
    auth_failed: 'error', bad_key: 'error', unknown_device: 'error', disabled: 'error',
};

const RESULT_LABEL: Record<string, string> = {
    clock_in: 'Clocked in', clock_out: 'Clocked out', registered: 'Card registered',
    duplicate: 'Duplicate tap', unknown_card: 'Unknown card', card_removed: 'Card removed',
    inactive_employee: 'Account disabled', registration_failed: 'Registration failed',
    pending_signup: 'Sign-up not finished',
    invalid_card: 'Unreadable card', processing: 'In progress',
    missing_credentials: 'No credentials', bad_key: 'Wrong API key',
    unknown_device: 'Unknown reader', disabled: 'Reader disabled',
};

export default function ReadersTab() {
    const { t } = useTheme();
    const [devices, setDevices] = useState<RfidDevice[]>([]);
    const [events, setEvents] = useState<RfidEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<RfidDevice | null>(null);
    const [saving, setSaving] = useState(false);
    const [issuedKey, setIssuedKey] = useState<{ device: RfidDevice; apiKey: string } | null>(null);
    const [createForm] = Form.useForm();
    const [editForm] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        const [d, e] = await Promise.all([
            listDevices().catch(() => [] as RfidDevice[]),
            listEvents({ limit: 150 }).catch(() => [] as RfidEvent[]),
        ]);
        setDevices(d); setEvents(e);
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'rfid:refresh': () => { void load(); } });

    // The reader's online flag is time-based, so re-poll while this tab is open.
    useEffect(() => {
        const id = setInterval(() => { void load(); }, 15_000);
        return () => clearInterval(id);
    }, [load]);

    const submitCreate = async () => {
        const v = await createForm.validateFields();
        setSaving(true);
        try {
            const res = await createDevice({ deviceId: v.deviceId.trim(), name: v.name.trim(), location: v.location?.trim() });
            setCreating(false);
            createForm.resetFields();
            setIssuedKey(res);
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not add the reader');
        }
        setSaving(false);
    };

    const submitEdit = async () => {
        const v = await editForm.validateFields();
        if (!editing) return;
        setSaving(true);
        try {
            await updateDevice(editing.id, { name: v.name, location: v.location, isActive: v.isActive });
            message.success('Reader updated');
            setEditing(null);
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not update the reader');
        }
        setSaving(false);
    };

    const rotate = async (d: RfidDevice) => {
        try {
            setIssuedKey(await rotateDeviceKey(d.id));
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not rotate the key');
        }
    };

    const remove = async (d: RfidDevice) => {
        try {
            await deleteDevice(d.id);
            message.success('Reader removed — its attendance history is kept');
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not remove the reader');
        }
    };

    const deviceCols: ColumnsType<RfidDevice> = [
        {
            title: 'Reader', key: 'reader', width: 230,
            render: (_, r) => (
                <div>
                    <Space size={6}>
                        <span style={{
                            width: 8, height: 8, borderRadius: '50%',
                            background: r.online ? t.success : r.isActive ? t.textFaint : t.danger,
                            display: 'inline-block',
                        }} />
                        <Text style={{ color: t.text, fontWeight: 600 }}>{r.name}</Text>
                    </Space>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', fontFamily: 'ui-monospace, monospace' }}>
                        {r.deviceId}
                    </Text>
                </div>
            ),
        },
        {
            title: 'Status', key: 'status', width: 120,
            render: (_, r) => (!r.isActive
                ? <Tag color="error">Disabled</Tag>
                : r.online ? <Tag color="success">Online</Tag> : <Tag>Offline</Tag>),
        },
        { title: 'Location', dataIndex: 'location', render: (v: string | null) => v || <Text style={{ color: t.textFaint }}>—</Text> },
        {
            title: 'Firmware', dataIndex: 'firmwareVersion', width: 110,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
        },
        {
            title: 'IP', dataIndex: 'ipAddress', width: 130,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{v || '—'}</Text>,
        },
        {
            title: 'Last seen', dataIndex: 'lastSeenAt', width: 150,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {v ? dayjs(v).format('D MMM HH:mm:ss') : 'never'}
            </Text>,
        },
        {
            title: 'Last scan', dataIndex: 'lastScanAt', width: 150,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {v ? dayjs(v).format('D MMM HH:mm') : 'never'}
            </Text>,
        },
        {
            title: '', key: 'actions', fixed: 'right', width: 120,
            render: (_, r) => (
                <Space size={2}>
                    <Tooltip title="Edit">
                        <Button
                            size="small" type="text" icon={<EditOutlined />}
                            onClick={() => {
                                setEditing(r);
                                editForm.setFieldsValue({ name: r.name, location: r.location ?? '', isActive: r.isActive });
                            }}
                        />
                    </Tooltip>
                    <Popconfirm
                        title="Issue a new API key?"
                        description="The reader stops working until it is reflashed with the new key."
                        onConfirm={() => rotate(r)} okText="Rotate" cancelText="Cancel"
                    >
                        <Tooltip title="Rotate API key"><Button size="small" type="text" icon={<KeyOutlined />} /></Tooltip>
                    </Popconfirm>
                    <Popconfirm
                        title="Remove this reader?"
                        description="Attendance already recorded through it is kept."
                        onConfirm={() => remove(r)} okText="Remove" okButtonProps={{ danger: true }} cancelText="Cancel"
                    >
                        <Tooltip title="Remove"><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Tooltip>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    const eventCols: ColumnsType<RfidEvent> = [
        {
            title: 'When', dataIndex: 'createdAt', width: 155,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(v).format('D MMM HH:mm:ss')}</Text>,
        },
        {
            title: 'Outcome', dataIndex: 'result', width: 170,
            render: (v: string) => <Tag color={RESULT_TONE[v] ?? 'default'}>{RESULT_LABEL[v] ?? v}</Tag>,
        },
        {
            title: 'Employee', key: 'employee', width: 190,
            render: (_, r) => (r.employeeName
                ? (
                    <div>
                        <Text style={{ color: t.text }}>{r.employeeName}</Text>
                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>{r.employeeId ?? ''}</Text>
                    </div>
                )
                : <Text style={{ color: t.textFaint }}>—</Text>),
        },
        {
            title: 'Card', dataIndex: 'uid', width: 140,
            render: (v: string | null) => (
                <Text style={{ color: t.textMuted, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>
                    {formatUid(v)}
                </Text>
            ),
        },
        {
            title: 'Reader', dataIndex: 'deviceCode', width: 140,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || '—'}</Text>,
        },
        {
            title: 'Detail', dataIndex: 'detail',
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v || ''}</Text>,
        },
    ];

    if (loading && !devices.length && !events.length) return <LoadingState />;

    const online = devices.filter((d) => d.online).length;

    return (
        <div>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={12} md={6}><StatCard label="Readers" value={devices.length} icon={<ApiOutlined />} tone={t.accent} hint="Configured in the portal" /></Col>
                <Col xs={12} md={6}><StatCard label="Online" value={online} icon={<WifiOutlined />} tone={online ? t.success : t.danger} hint={online ? "Polling normally" : "None reachable"} /></Col>
                <Col xs={12} md={6}>
                    <StatCard label="Scans logged" value={events.filter((e) => e.kind === 'scan').length} icon={<ScanOutlined />} tone={t.purple} hint="Most recent 150 events" />
                </Col>
                <Col xs={12} md={6}>
                    <StatCard
                        label="Rejected"
                        value={events.filter((e) => ['auth_failed', 'bad_key', 'unknown_device'].includes(e.result)).length}
                        icon={<StopOutlined />} tone={t.warning} hint="Failed reader authentication"
                    />
                </Col>
            </Row>

            {!devices.length && (
                <Alert
                    type="warning" showIcon style={{ marginBottom: 16 }}
                    message="No reader has been set up yet"
                    description="Add one here to get its API key, then flash that key into the reader. Card registration needs a reader that is online."
                />
            )}

            <Panel
                accent={t.accent}
                title={<Space size={8}><ApiOutlined style={{ color: t.accent }} />RFID readers</Space>}
                extra={
                    <Space>
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                            Add reader
                        </Button>
                    </Space>
                }
                style={{ marginBottom: 16 }}
            >
                {devices.length ? (
                    <Table
                        rowKey="id" size="small" columns={deviceCols} dataSource={devices}
                        loading={loading} pagination={false} scroll={{ x: 1180 }}
                    />
                ) : (
                    <EmptyState compact title="No readers" description="Add a reader to begin." />
                )}
            </Panel>

            <Panel accent={t.purple} title={<Space size={8}><HistoryOutlined style={{ color: t.purple }} />Reader event log</Space>}>
                {events.length ? (
                    <Table
                        rowKey="id" size="small" columns={eventCols} dataSource={events}
                        loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 1000 }}
                    />
                ) : (
                    <EmptyState compact title="No events yet" description="Card taps and reader errors appear here." />
                )}
            </Panel>

            {/* ─── Add reader ─────────────────────────────────────────── */}
            <FormModal
                open={creating} title="Add an RFID reader" okText="Create reader"
                onCancel={() => setCreating(false)} onOk={submitCreate} confirmLoading={saving}
            >
                <Form form={createForm} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="deviceId" label="Device ID"
                        extra="Must match DEVICE_ID in the reader's firmware. 3–64 characters: letters, digits, dot, dash, underscore."
                        rules={[
                            { required: true, message: 'Required' },
                            { pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/, message: 'Letters, digits, dot, dash or underscore' },
                        ]}
                    >
                        <Input placeholder="RFID-SM2-001" />
                    </Form.Item>
                    <Form.Item name="name" label="Name" rules={[{ required: true, min: 2, message: 'Required' }]}>
                        <Input placeholder="Main Entrance Reader" />
                    </Form.Item>
                    <Form.Item name="location" label="Location">
                        <Input placeholder="Building A — Main Entrance" />
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ─── Edit reader ────────────────────────────────────────── */}
            <FormModal
                open={!!editing} title="Edit reader" okText="Save"
                onCancel={() => setEditing(null)} onOk={submitEdit} confirmLoading={saving}
            >
                <Form form={editForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label="Name" rules={[{ required: true, min: 2, message: 'Required' }]}>
                        <Input />
                    </Form.Item>
                    <Form.Item name="location" label="Location"><Input /></Form.Item>
                    <Form.Item
                        name="isActive" label="Enabled" valuePropName="checked"
                        extra="A disabled reader is refused by the server and cannot record attendance."
                    >
                        <Switch />
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ─── The one and only showing of an API key ─────────────── */}
            <FormModal
                open={!!issuedKey} title="Reader API key" okText="I have copied it"
                onCancel={() => setIssuedKey(null)} onOk={() => setIssuedKey(null)}
                cancelButtonProps={{ style: { display: 'none' } }}
            >
                <Alert
                    type="warning" showIcon style={{ marginBottom: 12 }}
                    message="This is the only time this key is shown"
                    description="Only its hash is stored. If it is lost, rotate the key and reflash the reader."
                />
                {issuedKey && (
                    <>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>Device ID</Text>
                        <Paragraph copyable style={{ color: t.text, fontFamily: 'ui-monospace, monospace', marginBottom: 12 }}>
                            {issuedKey.device.deviceId}
                        </Paragraph>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>API key</Text>
                        <Paragraph
                            copyable={{ icon: <CopyOutlined /> }}
                            style={{
                                color: t.text, fontFamily: 'ui-monospace, monospace', fontSize: 12,
                                wordBreak: 'break-all', background: t.surfaceSunken,
                                padding: 10, borderRadius: 6, border: `1px solid ${t.borderSubtle}`,
                            }}
                        >
                            {issuedKey.apiKey}
                        </Paragraph>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>
                            Put both into the reader's configuration. It sends them on every request as
                            <Text code style={{ fontSize: 11 }}>X-Device-Id</Text> and
                            <Text code style={{ fontSize: 11 }}>X-Api-Key</Text>.
                        </Text>
                    </>
                )}
            </FormModal>
        </div>
    );
}
