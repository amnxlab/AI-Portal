import { useState, useEffect, useCallback } from 'react';
import {
    Table, Tag, Typography, Button, Space, Input, Select, DatePicker, Alert,
    Form, message, Tooltip,
} from 'antd';
import { EditOutlined, StopOutlined, PlusOutlined, ReloadOutlined, FieldTimeOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    listSessions, createSession, correctSession, voidSession,
    type SessionView,
} from '../../api/attendance';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { Panel, LoadingState, FormModal } from '../../components/ui';
import { SessionStatusTag, sessionSourceLabel } from './MyAttendanceTab';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   Working sessions, and the only way to change one.

   A correction never overwrites history: the original timestamps stay on
   the session, the change is written to attendance_corrections with its
   reason and author, and the row is marked as corrected. A reason is
   mandatory — the server rejects anything shorter than three characters,
   so the field here is required too rather than letting the request fail.
   ═══════════════════════════════════════════════════════════════════════ */

interface UserOption { value: string; label: string }

export default function SessionsTab({ users }: { users: UserOption[] }) {
    const { t } = useTheme();
    const [sessions, setSessions] = useState<SessionView[]>([]);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState<[string, string]>(() => [
        dayjs().subtract(14, 'day').format('YYYY-MM-DD'),
        dayjs().format('YYYY-MM-DD'),
    ]);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState<string | undefined>();
    const [mode, setMode] = useState<string | undefined>();

    const [editing, setEditing] = useState<SessionView | null>(null);
    const [creating, setCreating] = useState(false);
    const [voiding, setVoiding] = useState<SessionView | null>(null);
    const [saving, setSaving] = useState(false);
    const [editForm] = Form.useForm();
    const [createForm] = Form.useForm();
    const [voidForm] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await listSessions({
                from: range[0], to: range[1], status, mode, search: search.trim() || undefined,
            });
            setSessions(res.sessions);
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not load sessions');
        }
        setLoading(false);
    }, [range, status, mode, search]);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:refresh': () => { void load(); } });

    const openEdit = (s: SessionView) => {
        setEditing(s);
        editForm.setFieldsValue({
            clockInAt: dayjs(s.clockInAt),
            clockOutAt: s.clockOutAt ? dayjs(s.clockOutAt) : null,
            mode: s.mode,
            reason: '',
        });
    };

    const submitEdit = async () => {
        const v = await editForm.validateFields();
        if (!editing) return;
        setSaving(true);
        try {
            await correctSession(editing.id, {
                clockInAt: v.clockInAt ? v.clockInAt.toISOString() : undefined,
                clockOutAt: v.clockOutAt ? v.clockOutAt.toISOString() : undefined,
                mode: v.mode,
                reason: v.reason,
            });
            message.success('Session corrected — the original times are kept in the audit trail');
            setEditing(null);
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not correct the session');
        }
        setSaving(false);
    };

    const submitCreate = async () => {
        const v = await createForm.validateFields();
        setSaving(true);
        try {
            await createSession({
                userId: v.userId,
                clockInAt: v.clockInAt.toISOString(),
                clockOutAt: v.clockOutAt.toISOString(),
                mode: v.mode ?? 'onsite',
                reason: v.reason,
            });
            message.success('Session added');
            setCreating(false);
            createForm.resetFields();
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not add the session');
        }
        setSaving(false);
    };

    const submitVoid = async () => {
        const v = await voidForm.validateFields();
        if (!voiding) return;
        setSaving(true);
        try {
            await voidSession(voiding.id, v.reason);
            message.success('Session voided');
            setVoiding(null);
            voidForm.resetFields();
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not void the session');
        }
        setSaving(false);
    };

    const columns: ColumnsType<SessionView> = [
        {
            title: 'Employee', key: 'employee', fixed: 'left', width: 200,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{r.user?.fullName ?? '—'}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {r.user?.employeeId ?? 'No Employee ID'}
                    </Text>
                </div>
            ),
        },
        {
            title: 'Date', dataIndex: 'clockInAt', width: 130,
            render: (v: string) => dayjs(v).format('ddd D MMM YYYY'),
        },
        {
            title: 'In', key: 'in', width: 110,
            render: (_, r) => (
                <Tooltip title={r.originalInAt && r.originalInAt !== r.clockInAt
                    ? `Originally ${dayjs(r.originalInAt).format('HH:mm')}` : undefined}>
                    <Text style={{ color: t.text }}>{dayjs(r.clockInAt).format('HH:mm')}</Text>
                    {r.originalInAt && r.originalInAt !== r.clockInAt && (
                        <Text style={{ color: t.purple, fontSize: 10, display: 'block' }}>
                            was {dayjs(r.originalInAt).format('HH:mm')}
                        </Text>
                    )}
                </Tooltip>
            ),
        },
        {
            title: 'Out', key: 'out', width: 110,
            render: (_, r) => (r.clockOutAt ? (
                <Tooltip title={r.originalOutAt && r.originalOutAt !== r.clockOutAt
                    ? `Originally ${dayjs(r.originalOutAt).format('HH:mm')}` : undefined}>
                    <Text style={{ color: t.text }}>{dayjs(r.clockOutAt).format('HH:mm')}</Text>
                    {r.originalOutAt && r.originalOutAt !== r.clockOutAt && (
                        <Text style={{ color: t.purple, fontSize: 10, display: 'block' }}>
                            was {dayjs(r.originalOutAt).format('HH:mm')}
                        </Text>
                    )}
                </Tooltip>
            ) : <Text style={{ color: t.textFaint }}>—</Text>),
        },
        {
            title: 'Hours', dataIndex: 'hours', width: 90, align: 'right',
            sorter: (a, b) => a.hours - b.hours,
            render: (v: number, r) => (
                <Text style={{ color: r.status === 'closed' ? t.text : t.textFaint, fontVariantNumeric: 'tabular-nums' }}>
                    {r.status === 'closed' ? v.toFixed(2) : '—'}
                </Text>
            ),
        },
        {
            title: 'Where', dataIndex: 'mode', width: 95,
            render: (v: string) => <Tag color={v === 'remote' ? 'blue' : 'default'}>{v === 'remote' ? 'Remote' : 'On-site'}</Tag>,
        },
        {
            title: 'Source', dataIndex: 'source', width: 120,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{sessionSourceLabel(v)}</Text>,
        },
        {
            title: 'Status', key: 'status', width: 165,
            render: (_, r) => <SessionStatusTag status={r.status} corrected={r.corrected} />,
        },
        {
            title: '', key: 'actions', fixed: 'right', width: 90,
            render: (_, r) => (
                <Space size={2}>
                    <Tooltip title="Correct times">
                        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                    </Tooltip>
                    {r.status !== 'voided' && (
                        <Tooltip title="Void session">
                            <Button size="small" type="text" danger icon={<StopOutlined />} onClick={() => setVoiding(r)} />
                        </Tooltip>
                    )}
                </Space>
            ),
        },
    ];

    if (loading && !sessions.length) return <LoadingState />;

    return (
        <div>
            <Alert
                type="info" showIcon style={{ marginBottom: 16 }}
                message="Corrections are recorded, not applied silently"
                description={
                    'Original clock-in and clock-out times are preserved on every session. A correction '
                    + 'stores the old and new values, your name and your stated reason in the audit trail, '
                    + 'which you can read under the Audit tab.'
                }
            />

            <Panel
                accent={t.accent}
                title={<Space size={8}><FieldTimeOutlined style={{ color: t.accent }} />Working sessions</Space>}
                extra={
                    <Space>
                        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} />
                        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
                            Add session
                        </Button>
                    </Space>
                }
            >
                <Space wrap style={{ marginBottom: 12 }}>
                    <DatePicker.RangePicker
                        value={[dayjs(range[0]), dayjs(range[1])]}
                        onChange={(v) => v && v[0] && v[1] && setRange([v[0].format('YYYY-MM-DD'), v[1].format('YYYY-MM-DD')])}
                        allowClear={false}
                    />
                    <Input.Search
                        allowClear placeholder="Name or Employee ID" style={{ width: 220 }}
                        value={search} onChange={(e) => setSearch(e.target.value)}
                    />
                    <Select
                        allowClear placeholder="Any status" style={{ width: 150 }} value={status} onChange={setStatus}
                        options={[
                            { value: 'open', label: 'Open' },
                            { value: 'closed', label: 'Closed' },
                            { value: 'incomplete', label: 'Incomplete' },
                            { value: 'voided', label: 'Voided' },
                        ]}
                    />
                    <Select
                        allowClear placeholder="Anywhere" style={{ width: 130 }} value={mode} onChange={setMode}
                        options={[{ value: 'onsite', label: 'On-site' }, { value: 'remote', label: 'Remote' }]}
                    />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{sessions.length} sessions</Text>
                </Space>

                <Table
                    rowKey="id" size="small" columns={columns} dataSource={sessions} loading={loading}
                    pagination={{ pageSize: 25, showSizeChanger: false }} scroll={{ x: 1300 }}
                />
            </Panel>

            {/* ─── Correct ────────────────────────────────────────────── */}
            <FormModal
                open={!!editing} title="Correct session" okText="Save correction"
                onCancel={() => setEditing(null)} onOk={submitEdit} confirmLoading={saving}
            >
                {editing && (
                    <>
                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 12 }}>
                            {editing.user?.fullName} · {dayjs(editing.clockInAt).format('ddd D MMM YYYY')}
                        </Text>
                        <Form form={editForm} layout="vertical" requiredMark={false}>
                            <Form.Item name="clockInAt" label="Clock in" rules={[{ required: true, message: 'Required' }]}>
                                <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item
                                name="clockOutAt" label="Clock out"
                                extra="Leave empty to keep the session open."
                            >
                                <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="mode" label="Where">
                                <Select options={[{ value: 'onsite', label: 'On-site' }, { value: 'remote', label: 'Remote' }]} />
                            </Form.Item>
                            <Form.Item
                                name="reason" label="Reason for the correction"
                                rules={[{ required: true, min: 3, message: 'Give a reason of at least 3 characters' }]}
                            >
                                <Input.TextArea rows={2} placeholder="Forgot to clock out; confirmed with supervisor" />
                            </Form.Item>
                        </Form>
                    </>
                )}
            </FormModal>

            {/* ─── Add ───────────────────────────────────────────────── */}
            <FormModal
                open={creating} title="Add a session by hand" okText="Add session"
                onCancel={() => setCreating(false)} onOk={submitCreate} confirmLoading={saving}
            >
                <Form form={createForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="userId" label="Employee" rules={[{ required: true, message: 'Choose an employee' }]}>
                        <Select
                            showSearch options={users} placeholder="Search by name"
                            filterOption={(i, o) => (o?.label ?? '').toString().toLowerCase().includes(i.toLowerCase())}
                        />
                    </Form.Item>
                    <Form.Item name="clockInAt" label="Clock in" rules={[{ required: true, message: 'Required' }]}>
                        <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="clockOutAt" label="Clock out" rules={[{ required: true, message: 'Required' }]}>
                        <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="mode" label="Where" initialValue="onsite">
                        <Select options={[{ value: 'onsite', label: 'On-site' }, { value: 'remote', label: 'Remote' }]} />
                    </Form.Item>
                    <Form.Item
                        name="reason" label="Reason"
                        rules={[{ required: true, min: 3, message: 'Give a reason of at least 3 characters' }]}
                    >
                        <Input.TextArea rows={2} placeholder="Reader was offline; times confirmed from the sign-in sheet" />
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ─── Void ──────────────────────────────────────────────── */}
            <FormModal
                open={!!voiding} title="Void session" okText="Void session" danger
                onCancel={() => setVoiding(null)} onOk={submitVoid} confirmLoading={saving}
            >
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 12 }}>
                    The session stops counting towards hours. The row is kept, and the reason below goes
                    into the audit trail.
                </Text>
                <Form form={voidForm} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="reason" label="Reason"
                        rules={[{ required: true, min: 3, message: 'Give a reason of at least 3 characters' }]}
                    >
                        <Input.TextArea rows={2} placeholder="Duplicate of the session recorded at 09:02" />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
