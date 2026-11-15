import { useCallback, useEffect, useState } from 'react';
import {
    Table, Button, Tag, Space, Typography, Alert, Popconfirm, message, Switch,
    Form, Input, InputNumber, TimePicker, Select, Tooltip, Empty, DatePicker, Modal,
} from 'antd';
import { PlusOutlined, EditOutlined, InboxOutlined, UserAddOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import UserAvatar from '../../components/UserAvatar';
import { FormModal } from '../../components/ui';
import { useTheme } from '../../theme/useTheme';

const { Text } = Typography;

/** ISO weekdays, matching the backend (1 = Monday … 7 = Sunday). */
const DAYS = [
    { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
    { value: 7, label: 'Sun' },
];

interface Shift {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
    graceMinutes: number;
    isActive: boolean;
    notes: string | null;
    assignedCount?: number;
}

interface Assignment {
    id: string;
    shiftId: string;
    userId: string;
    startDate: string;
    endDate: string | null;
    shift: { id: string; name: string; startTime: string; endTime: string } | null;
    user: { id: string; fullName: string; employeeId: string | null } | null;
}

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Shifts, and who is on them.
 *
 * Attendance used to record only what happened. A shift is what was supposed
 * to happen, which is what lets the Today view say "late" or "absent" rather
 * than just listing clock-ins.
 */
export default function ShiftsTab({ users }: { users: { value: string; label: string }[] }) {
    const { t } = useTheme();
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [showRetired, setShowRetired] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [shiftModal, setShiftModal] = useState(false);
    const [editing, setEditing] = useState<Shift | null>(null);
    const [assignModal, setAssignModal] = useState<Shift | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm();
    const [assignForm] = Form.useForm();

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [s, a] = await Promise.all([
                api.get<Shift[]>('/attendance/shifts', { params: { includeInactive: showRetired } }),
                api.get<Assignment[]>('/attendance/shift-assignments'),
            ]);
            setShifts(s.data);
            setAssignments(a.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Could not load shifts');
        } finally {
            setLoading(false);
        }
    }, [showRetired]);

    useEffect(() => { void load(); }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({
            daysOfWeek: [1, 2, 3, 4, 5],
            graceMinutes: 10,
            isActive: true,
            startTime: dayjs('09:00', 'HH:mm'),
            endTime: dayjs('17:00', 'HH:mm'),
        });
        setShiftModal(true);
    };

    const openEdit = (shift: Shift) => {
        setEditing(shift);
        form.setFieldsValue({
            name: shift.name,
            startTime: dayjs(hhmm(shift.startTime), 'HH:mm'),
            endTime: dayjs(hhmm(shift.endTime), 'HH:mm'),
            daysOfWeek: shift.daysOfWeek,
            graceMinutes: shift.graceMinutes,
            isActive: shift.isActive,
            notes: shift.notes ?? '',
        });
        setShiftModal(true);
    };

    const saveShift = async () => {
        let values: any;
        try { values = await form.validateFields(); } catch { return; }
        setSaving(true);
        try {
            const payload = {
                name: values.name,
                startTime: values.startTime.format('HH:mm'),
                endTime: values.endTime.format('HH:mm'),
                daysOfWeek: values.daysOfWeek,
                graceMinutes: values.graceMinutes,
                isActive: values.isActive,
                notes: values.notes || undefined,
            };
            if (editing) {
                await api.patch(`/attendance/shifts/${editing.id}`, payload);
                message.success('Shift updated');
            } else {
                const created = await api.post('/attendance/shifts', payload);

                // Creating the shift used to be the whole of it: the people
                // picked here were ignored and you had to go back and use the
                // assign button per person. Assign them now, and say plainly
                // who could not be assigned rather than claiming success.
                const chosen: string[] = values.assignTo ?? [];
                const failed: string[] = [];
                for (const userId of chosen) {
                    try {
                        await api.post('/attendance/shift-assignments', {
                            shiftId: created.data.id,
                            userId,
                        });
                    } catch (err: any) {
                        const who = users.find((u) => u.value === userId)?.label ?? 'someone';
                        failed.push(`${who}: ${err?.response?.data?.message ?? 'could not be assigned'}`);
                    }
                }

                const assigned = chosen.length - failed.length;
                if (!chosen.length) {
                    message.success('Shift created. Use the assign button on its row to put people on it.');
                } else if (!failed.length) {
                    message.success(`Shift created and ${assigned} ${assigned === 1 ? 'person' : 'people'} assigned — it is now on their schedule.`);
                } else {
                    // A toast is the wrong shape for "the shift exists but the
                    // people you picked are not on it": it disappears, and the
                    // half-done state looks like success. This has to be
                    // dismissed deliberately.
                    Modal.warning({
                        title: assigned
                            ? `Shift created, but ${failed.length} of ${chosen.length} could not be assigned`
                            : 'Shift created, but nobody was assigned',
                        width: 560,
                        okText: 'I understand',
                        content: (
                            <div style={{ marginTop: 10 }}>
                                <Text style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>
                                    The shift itself was saved. These people are not on it:
                                </Text>
                                <ul style={{ margin: '0 0 12px 18px', fontSize: 13 }}>
                                    {failed.map((f) => <li key={f}>{f}</li>)}
                                </ul>
                                <Text style={{ fontSize: 12.5, opacity: 0.8 }}>
                                    Use the assign button on the shift&rsquo;s row once that is
                                    sorted out.
                                </Text>
                            </div>
                        ),
                    });
                }
            }
            setShiftModal(false);
            void load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not save the shift');
        } finally {
            setSaving(false);
        }
    };

    const retire = async (shift: Shift) => {
        try {
            await api.delete(`/attendance/shifts/${shift.id}`);
            message.success(`${shift.name} retired — its history is kept`);
            void load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not retire the shift');
        }
    };

    const assign = async () => {
        let values: any;
        try { values = await assignForm.validateFields(); } catch { return; }
        setSaving(true);
        try {
            await api.post('/attendance/shift-assignments', {
                shiftId: assignModal!.id,
                userId: values.userId,
                startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
                endDate: values.endDate ? values.endDate.format('YYYY-MM-DD') : undefined,
            });
            message.success('Assigned');
            setAssignModal(null);
            assignForm.resetFields();
            void load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not assign that person');
        } finally {
            setSaving(false);
        }
    };

    const endAssignment = async (a: Assignment) => {
        try {
            await api.patch(`/attendance/shift-assignments/${a.id}/end`, {});
            message.success('Assignment ended — the record is kept');
            void load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not end the assignment');
        }
    };

    const today = dayjs().format('YYYY-MM-DD');
    const isCurrent = (a: Assignment) => a.startDate <= today && (!a.endDate || a.endDate >= today);

    const shiftColumns = [
        {
            title: 'Shift', key: 'name', fixed: 'left' as const, width: 180,
            render: (_: any, s: Shift) => (
                <div>
                    <Text style={{ color: t.text, fontWeight: 600 }}>{s.name}</Text>
                    {!s.isActive && <Tag style={{ marginLeft: 6 }}>Retired</Tag>}
                    {s.notes && (
                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>{s.notes}</Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Hours', key: 'hours', width: 130,
            render: (_: any, s: Shift) => (
                <Text style={{ color: t.text, fontSize: 13 }}>
                    {hhmm(s.startTime)}–{hhmm(s.endTime)}
                    {s.endTime <= s.startTime && (
                        <Tooltip title="Ends the next day">
                            <Text style={{ color: t.textMuted, fontSize: 11 }}> +1d</Text>
                        </Tooltip>
                    )}
                </Text>
            ),
        },
        {
            title: 'Days', key: 'days', width: 210,
            render: (_: any, s: Shift) => (
                <Space size={3} wrap>
                    {DAYS.map((d) => (
                        <Tag
                            key={d.value}
                            style={{
                                marginInlineEnd: 0,
                                opacity: s.daysOfWeek?.includes(d.value) ? 1 : 0.25,
                                borderColor: s.daysOfWeek?.includes(d.value) ? t.accent : t.border,
                                color: s.daysOfWeek?.includes(d.value) ? t.accent : t.textMuted,
                                background: 'transparent',
                                fontSize: 11,
                            }}
                        >
                            {d.label}
                        </Tag>
                    ))}
                </Space>
            ),
        },
        {
            title: 'Grace', key: 'grace', width: 90, align: 'right' as const,
            render: (_: any, s: Shift) => (
                <Tooltip title="How late somebody may clock in before the day counts as late">
                    <Text style={{ color: t.textMuted }}>{s.graceMinutes}m</Text>
                </Tooltip>
            ),
        },
        {
            title: 'On it', key: 'assigned', width: 80, align: 'right' as const,
            render: (_: any, s: Shift) => <Text style={{ color: t.text, fontWeight: 600 }}>{s.assignedCount ?? 0}</Text>,
        },
        {
            title: 'Actions', key: 'actions', width: 150,
            render: (_: any, s: Shift) => (
                <Space size={4}>
                    <Tooltip title="Assign somebody">
                        <Button size="small" icon={<UserAddOutlined />} disabled={!s.isActive}
                            onClick={() => { setAssignModal(s); assignForm.resetFields(); }} />
                    </Tooltip>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(s)} />
                    {s.isActive && (
                        <Popconfirm
                            title={`Retire ${s.name}?`}
                            description={
                                <span style={{ display: 'inline-block', maxWidth: 300 }}>
                                    It stops being offered and everyone on it is taken off as of today.
                                    Nothing is deleted &mdash; past days stay judged against it.
                                </span>
                            }
                            onConfirm={() => retire(s)}
                            okText="Retire"
                        >
                            <Button size="small" icon={<InboxOutlined />} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    const assignmentColumns = [
        {
            title: 'Person', key: 'person', fixed: 'left' as const, width: 220,
            render: (_: any, a: Assignment) => (
                <Space size={10}>
                    <UserAvatar name={a.user?.fullName ?? 'Unknown'} userId={a.user?.id} size={28} />
                    <div>
                        <Text style={{ color: t.text, fontWeight: 600, display: 'block' }}>
                            {a.user?.fullName ?? 'Unknown'}
                        </Text>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>{a.user?.employeeId ?? '—'}</Text>
                    </div>
                </Space>
            ),
        },
        {
            title: 'Shift', key: 'shift', width: 170,
            render: (_: any, a: Assignment) => (
                <Text style={{ color: t.text }}>
                    {a.shift?.name ?? '—'}
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>
                        {a.shift ? `${hhmm(a.shift.startTime)}–${hhmm(a.shift.endTime)}` : ''}
                    </Text>
                </Text>
            ),
        },
        {
            title: 'From', dataIndex: 'startDate', key: 'from', width: 110,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12.5 }}>{v}</Text>,
        },
        {
            title: 'Until', key: 'until', width: 120,
            render: (_: any, a: Assignment) => (a.endDate
                ? <Text style={{ color: t.textMuted, fontSize: 12.5 }}>{a.endDate}</Text>
                : <Tag color="green" style={{ marginInlineEnd: 0 }}>Ongoing</Tag>),
        },
        {
            title: '', key: 'actions', width: 90,
            render: (_: any, a: Assignment) => (isCurrent(a) && !a.endDate ? (
                <Popconfirm
                    title="End this assignment?"
                    description="They come off the shift as of today. The record is kept."
                    onConfirm={() => endAssignment(a)}
                    okText="End"
                >
                    <Button size="small" icon={<StopOutlined />}>End</Button>
                </Popconfirm>
            ) : null),
        },
    ];

    return (
        <div>
            {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="Assigning a shift writes it into that person's schedule"
                description={
                    <span style={{ fontSize: 12 }}>
                        A shift is a template; assigning it fills in the weeks ahead on that
                        person&rsquo;s own weekly schedule, and nobody else&rsquo;s. Anything they
                        already put on a day stays as it is &mdash; their own entry always wins, and
                        attendance measures them against it. Ending an assignment takes the
                        assigned days back out from tomorrow on, leaving the days already past.
                    </span>
                }
            />

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                <Text style={{ color: t.text, fontWeight: 600 }}>Shifts</Text>
                <Space size={6}>
                    <Switch size="small" checked={showRetired} onChange={setShowRetired} />
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>Show retired</Text>
                </Space>
                <div style={{ flex: 1 }} />
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New shift</Button>
            </div>

            <Table
                size="small"
                rowKey="id"
                dataSource={shifts}
                columns={shiftColumns}
                loading={loading}
                pagination={false}
                scroll={{ x: 940 }}
                style={{ marginBottom: 28 }}
                locale={{
                    emptyText: (
                        <Empty image={null} description={
                            <Text style={{ color: t.textMuted }}>
                                No shifts yet. A shift is when people are expected in — once one
                                exists and people are on it, the Today view can show who is late
                                or missing.
                            </Text>
                        } />
                    ),
                }}
            />

            <Text style={{ color: t.text, fontWeight: 600, display: 'block', marginBottom: 10 }}>
                Assignments
            </Text>
            <Table
                size="small"
                rowKey="id"
                dataSource={assignments}
                columns={assignmentColumns}
                loading={loading}
                pagination={{ pageSize: 12, size: 'small', hideOnSinglePage: true }}
                scroll={{ x: 740 }}
                locale={{
                    emptyText: <Text style={{ color: t.textMuted }}>Nobody is assigned to a shift yet.</Text>,
                }}
            />

            <FormModal
                open={shiftModal}
                title={editing ? `Edit — ${editing.name}` : 'New shift'}
                onCancel={() => setShiftModal(false)}
                onOk={saveShift}
                confirmLoading={saving}
                okText={editing ? 'Save changes' : 'Create shift'}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Give the shift a name' }]}>
                        <Input placeholder="Morning" />
                    </Form.Item>
                    <Space size={12} style={{ width: '100%' }}>
                        <Form.Item name="startTime" label="Starts" rules={[{ required: true }]}>
                            <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} />
                        </Form.Item>
                        <Form.Item
                            name="endTime" label="Ends" rules={[{ required: true }]}
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Earlier than the start = overnight</Text>}
                        >
                            <TimePicker format="HH:mm" minuteStep={5} needConfirm={false} />
                        </Form.Item>
                    </Space>
                    <Form.Item
                        name="daysOfWeek" label="Days"
                        rules={[{ required: true, message: 'Choose at least one day' }]}
                    >
                        <Select mode="multiple" options={DAYS} placeholder="Mon–Fri" />
                    </Form.Item>
                    <Form.Item
                        name="graceMinutes" label="Grace period (minutes)"
                        extra={
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                How late somebody may clock in before the day counts as late.
                            </Text>
                        }
                    >
                        <InputNumber min={0} max={240} style={{ width: '100%' }} addonAfter="min" />
                    </Form.Item>
                    <Form.Item name="isActive" label="Active" valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name="notes" label="Notes">
                        <Input.TextArea rows={2} />
                    </Form.Item>
                    {!editing && (
                        <Form.Item
                            name="assignTo"
                            label="Assign to"
                            extra={
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                    Puts these people on the shift straight away, which writes it
                                    onto each of their own weekly schedules. You can also leave
                                    this empty and assign people later from the shift&rsquo;s row.
                                </Text>
                            }
                        >
                            <Select
                                mode="multiple"
                                allowClear
                                options={users}
                                showSearch
                                optionFilterProp="label"
                                placeholder="Search by name or Employee ID"
                            />
                        </Form.Item>
                    )}
                </Form>
            </FormModal>

            <FormModal
                open={!!assignModal}
                title={assignModal ? `Assign to ${assignModal.name}` : 'Assign'}
                onCancel={() => setAssignModal(null)}
                onOk={assign}
                confirmLoading={saving}
                okText="Assign"
            >
                <Form form={assignForm} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item name="userId" label="Person" rules={[{ required: true, message: 'Choose somebody' }]}>
                        <Select
                            options={users}
                            showSearch
                            optionFilterProp="label"
                            placeholder="Search by name or Employee ID"
                        />
                    </Form.Item>
                    <Form.Item
                        name="startDate" label="From"
                        extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Defaults to today.</Text>}
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                        name="endDate" label="Until (optional)"
                        extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Leave empty for an ongoing assignment.</Text>}
                    >
                        <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
