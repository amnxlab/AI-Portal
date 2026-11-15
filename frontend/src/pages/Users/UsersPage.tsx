import { useEffect, useState, useCallback } from 'react';
import {
    Table, Button, Form, Input, Tag, Space, Checkbox,
    Typography, Alert, Popconfirm, Badge, message, InputNumber, Switch, Tooltip, AutoComplete, Modal,
} from 'antd';
import { PlusOutlined, EditOutlined, UserOutlined, StopOutlined, ReloadOutlined, CopyOutlined, EyeOutlined, EyeInvisibleOutlined, IdcardOutlined, InboxOutlined, UndoOutlined, MailOutlined, SendOutlined, DeleteOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { getStatuses, type EmployeeRfidStatus } from '../../api/rfid';
import EmployeeDrawer from '../../components/EmployeeDrawer';
import { RfidStatusTag } from '../../components/RfidCardSection';
import { useAuthStore } from '../../store/authStore';
import { usePermissions, resolvePermissions, type RolePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../../components/UserAvatar';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;

/** Permission catalogue for the per-user access editor (order = display order). */
/**
 * Suggested position titles. The field stays free text — a lab invents titles
 * faster than anyone can maintain a list — these are only the common ones,
 * offered so they are spelled the same way each time.
 */
const POSITION_TITLES = [
    'Lab Member',
    'Research Assistant',
    'Graduate Researcher',
    'Undergraduate Researcher',
    'Research Engineer',
    'Lab Coordinator',
    'Lab Manager',
    'Project Lead',
    'Principal Investigator',
    'Faculty Advisor',
    'Visiting Researcher',
    'Intern',
];

const PERMISSION_ITEMS: { key: keyof RolePermissions; label: string; help: string }[] = [
    { key: 'manage_users',       label: 'Users & Permissions', help: 'Create users, reset passwords, moderate comments and resolve support tickets.' },
    { key: 'manage_projects',    label: 'Projects & Files',    help: 'Full project management, approve uploaded files/manuals, see all projects and documents.' },
    { key: 'lead_projects',      label: 'Lead Projects',       help: 'Manage tasks and folders in projects the user is a member of. No global visibility.' },
    { key: 'manage_tasks',       label: 'Tasks',               help: 'Create, assign, review and delete tasks.' },
    { key: 'manage_schedules',   label: 'Schedules',           help: 'Review and approve all weekly schedules.' },
    { key: 'view_all_schedules', label: 'View All Schedules',  help: 'Read-only access to everyone\'s weekly schedule.' },
    { key: 'post_discord',       label: 'Post to Discord',     help: 'Publish approved schedules to the lab Discord channel.' },
    { key: 'manage_reports',     label: 'Weekly Reports',      help: 'Review, edit and export every user\'s weekly report.' },
    { key: 'manage_inventory',   label: 'Inventory',           help: 'Full inventory management (items, stock, categories).' },
    { key: 'manage_wishlists',   label: 'Wishlists',           help: 'Create wishlist/purchase requests. Enabled for every member by default.' },
    { key: 'manage_budget',      label: 'Budget',              help: 'Manage budget accounts, expenses and labor deductions.' },
    { key: 'manage_attendance',  label: 'Attendance',          help: 'View and manage attendance records for all users.' },
    { key: 'cap_hours',          label: 'Set Hours Caps',      help: 'Set weekly hours caps on other users.' },
    { key: 'view_team_data',     label: 'Team Analytics',      help: 'See team-wide analytics and workload data.' },
];

interface UserRecord {
    id: string;
    username: string;
    fullName: string;
    email: string;
    role: string;
    isActive: boolean;
    isOnHold: boolean;
    createdAt: string;
    weeklyHoursCap: number | null;
    /** The authoritative column. The two below are derived from it. */
    remoteWorkAllowed?: boolean;
    /** Share of the week this person may work remotely. */
    remoteWorkPercent?: number;
    remoteMaxHours?: number | null;
    remoteWorkRestricted?: boolean;
    avatarUrl?: string | null;
    jobTitle?: string | null;
    employeeId?: string | null;
    /** Set when the account has been archived; null while it is in use. */
    archivedAt?: string | null;
    /** The Employee ID the account held before archiving, kept for history. */
    archivedEmployeeId?: string | null;
    onlineClockEnabled?: boolean;
    /** Set when an invitation was sent; cleared by nothing. */
    invitedAt?: string | null;
    /** Set once they have chosen a username and password themselves. */
    registeredAt?: string | null;
    permissions?: Partial<RolePermissions>;
}

/**
 * Whether `target` is an administrator other than the person signed in.
 *
 * Employment settings - position title, Employee ID, hours cap, hold, remote
 * work - are an administrator's to set, including on their own account. What
 * one administrator must not do is set them on another: with everybody
 * holding the same permission there would otherwise be nothing to stop one
 * capping a colleague's hours or taking their Employee ID. The server
 * enforces this; the form simply doesn't offer what would be refused.
 */
/**
 * The settings one administrator may not change on another. Kept beside the
 * rule itself so the form and the server stay in step — the server rejects
 * exactly this list on another administrator's account.
 */
const EMPLOYMENT_FIELDS = [
    'jobTitle', 'employeeId', 'weeklyHoursCap', 'isOnHold',
    'onlineClockEnabled', 'remoteWorkRestricted',
] as const;

/**
 * An invitation that has been sent but not yet accepted.
 *
 * The account exists — it can hold an Employee ID, a position and
 * permissions — but nobody can sign in to it until its owner sets a
 * password. That is a different state from "deactivated", which is also
 * `isActive: false`, so the two are told apart by how the account got there.
 */
function isPendingInvite(u: { invitedAt?: string | null; registeredAt?: string | null }): boolean {
    return !!u.invitedAt && !u.registeredAt;
}

function isOtherAdministrator(
    target: UserRecord | null,
    selfId: string | undefined,
): boolean {
    if (!target || target.id === selfId) return false;
    return !!resolvePermissions(target.permissions).manage_users;
}

function generatePassword(): string {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export default function UsersPage() {
    const currentUser = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const { t } = useTheme();
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [editUser, setEditUser] = useState<UserRecord | null>(null);
    const [saveLoading, setSaveLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [changePassword, setChangePassword] = useState(false);
    const [form] = Form.useForm();

    // RFID provisioning status per employee, keyed by user id. Loaded
    // separately so a reader being unreachable never stops the employee
    // list from rendering.
    const [rfid, setRfid] = useState<Record<string, EmployeeRfidStatus>>({});
    const [readers, setReaders] = useState<{ total: number; online: number }>({ total: 0, online: 0 });
    const [drawerUser, setDrawerUser] = useState<UserRecord | null>(null);
    // Deleted accounts stay in the table only when asked for: they are
    // tombstones kept so their work has an owner, not people in the lab.
    const [showDeleted, setShowDeleted] = useState(false);

    const loadRfid = useCallback(async () => {
        try {
            const res = await getStatuses();
            setReaders(res.readers);
            setRfid(Object.fromEntries(res.employees.map((e) => [e.userId, e])));
        } catch {
            setRfid({});
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const usersRes = await api.get('/users');
            setUsers(usersRes.data);
        } catch (e: any) {
            setError(e?.response?.data?.message ?? 'Failed to load users');
        } finally {
            setLoading(false);
        }
        void loadRfid();
    }, [loadRfid]);

    useEffect(() => { load(); }, [load]);

    const openModal = (user?: UserRecord) => {
        setEditUser(user ?? null);
        setShowPassword(false);
        setChangePassword(false);
        if (user) {
            form.setFieldsValue({
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                permissions: resolvePermissions(user.permissions),
                weeklyHoursCap: user.weeklyHoursCap,
                jobTitle: user.jobTitle ?? '',
                employeeId: user.employeeId ?? '',
                // Derived from the stored column rather than from fields
                // that no longer exist — reading `remoteWorkRestricted`
                // straight off the row always produced undefined, which is
                // why every toggle looked like it reverted on reload.
                remoteWorkRestricted: user.remoteWorkAllowed === undefined
                    ? (user.remoteWorkRestricted ?? false)
                    : !user.remoteWorkAllowed,
                remoteWorkPercent: user.remoteWorkPercent ?? 20,
                isOnHold: user.isOnHold ?? false,
                onlineClockEnabled: user.remoteWorkAllowed ?? user.onlineClockEnabled ?? false,
            });
        } else {
            // Inviting somebody: an email address is the whole of what an
            // administrator provides. The username and password are the new
            // member's to choose, from the link they are sent.
            form.resetFields();
            form.setFieldValue('permissions', resolvePermissions(null));
        }
        setModalOpen(true);
    };

    // Follows whichever row the modal was opened on.
    const editingOtherAdmin = isOtherAdministrator(editUser, currentUser?.id);

    /**
     * Sends a password-reset link to a user's own registered address.
     *
     * People lose access to the self-service flow - a mailbox they no longer
     * read, an address typed wrong, a new starter who never had a password -
     * and the administrator is who they ask. The link goes to the account's
     * own email and nowhere else, so this cannot be used to take an account
     * over.
     */
    const handleSendResetLink = async (user: UserRecord) => {
        const key = `reset-${user.id}`;
        message.open({ key, type: 'loading', content: `Sending a reset link to ${user.fullName}...` });
        try {
            const res = await api.post(`/auth/users/${user.id}/send-reset-link`);
            message.open({
                key, type: 'success', duration: 6,
                content: res.data?.message ?? `Reset link sent to ${user.email}.`,
            });
        } catch (e: any) {
            message.open({
                key, type: 'error', duration: 6,
                content: e?.response?.data?.message ?? 'Could not send the reset link',
            });
        }
    };

    /**
     * Saves the whole form in one request.
     *
     * It used to send the account in one PATCH and then follow up with a
     * request per employment field, because the backend accepted those fields
     * on the main route and silently dropped them. That made a save
     * non-atomic: if one of the follow-ups was refused, the earlier ones had
     * already been written and the user was told the save had failed. The
     * backend now persists the whole payload, so there is one request, and it
     * either takes or it doesn't.
     */
    const handleSave = async () => {
        let values: any;
        try {
            values = await form.validateFields();
        } catch {
            return;   // the form shows the field errors itself
        }

        setSaveLoading(true);
        try {
            if (editUser) {
                const payload = { ...values };
                if (!payload.password) delete payload.password;
                if (editingOtherAdmin) {
                    // These fields aren't shown for another administrator, but
                    // the form still holds the values it was opened with, and
                    // sending them back counts as an attempted change. Drop
                    // them so the rest of the save still goes through.
                    for (const f of EMPLOYMENT_FIELDS) delete payload[f];
                }
                // Re-read the saved row rather than trusting the form: the
                // dialog closes on what the server actually stored, so the
                // list can never show a value the backend rejected or
                // normalised.
                await api.patch(`/users/${editUser.id}`, payload);
                const { data: saved } = await api.get(`/users/${editUser.id}`);
                setUsers((prev) => prev.map((u) => (u.id === saved.id ? { ...u, ...saved } : u)));
                message.success('Changes saved');
            } else {
                const res = await api.post('/auth/invitations', {
                    email: values.email.trim(),
                    fullName: values.fullName?.trim() || undefined,
                    jobTitle: values.jobTitle?.trim() || undefined,
                    employeeId: values.employeeId?.trim() || undefined,
                    permissions: values.permissions,
                    weeklyHoursCap: values.weeklyHoursCap ?? undefined,
                });
                message.success({
                    content: res.data?.message ?? `Invitation sent to ${values.email}`,
                    duration: 6,
                });
            }
            setModalOpen(false);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Save failed');
        } finally {
            setSaveLoading(false);
        }
    };

    /**
     * Sends the invitation again, retiring the previous link. For somebody
     * who never received the first one, or let it expire.
     */
    const handleResendInvite = async (user: UserRecord) => {
        const key = `invite-${user.id}`;
        message.open({ key, type: 'loading', content: `Sending the invitation to ${user.email}...` });
        try {
            const res = await api.post(`/auth/invitations/${user.id}/resend`);
            message.open({
                key, type: 'success', duration: 6,
                content: res.data?.message ?? `Invitation sent again to ${user.email}.`,
            });
        } catch (e: any) {
            message.open({
                key, type: 'error', duration: 6,
                content: e?.response?.data?.message ?? 'Could not send the invitation',
            });
        }
    };

    const handleDeactivate = async (id: string) => {
        try {
            await api.delete(`/users/${id}`);
            message.success('User deactivated');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Deactivation failed');
        }
    };

    const handleReactivate = async (id: string) => {
        try {
            await api.post(`/users/${id}/reactivate`);
            message.success('User reactivated');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Reactivation failed');
        }
    };

    /**
     * Deletes an account without deleting anything it produced.
     *
     * The row survives as a tombstone so every task, report, upload, schedule
     * and attendance record keeps a valid owner — they show the person's name
     * followed by "(deleted user)". The account itself stops existing: it
     * cannot sign in, and its Employee ID and username are released for reuse.
     */
    const handleDeleteUser = async (id: string) => {
        try {
            const res = await api.post(`/users/${id}/archive`);
            const freed = res.data?.archivedEmployeeId;
            message.success(freed
                ? `User deleted — their work is kept, and Employee ID ${freed} is free to reassign`
                : 'User deleted — their work is kept');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not delete the account');
        }
    };

    /**
     * Removes the account row itself, with no undo.
     *
     * Deliberately a different action from the delete above: that one keeps
     * everything the person produced and only retires the account, which is
     * what you want almost every time. This one is for an account that never
     * should have existed — an invitation to the wrong address, a duplicate,
     * a test account. The server refuses it outright if the account has any
     * history, so the dialog asks what is attached before offering it.
     */
    const confirmPermanentDelete = async (user: UserRecord) => {
        let blockers: { label: string; count: number }[] = [];
        try {
            const { data } = await api.get(`/users/${user.id}/deletion-blockers`);
            blockers = data.blockers ?? [];
        } catch {
            message.error('Could not check what is attached to this account');
            return;
        }

        if (blockers.length) {
            Modal.info({
                title: `${user.fullName} cannot be permanently deleted`,
                width: 560,
                okText: 'Close',
                content: (
                    <div style={{ marginTop: 10 }}>
                        <Text style={{ color: t.text, fontSize: 13 }}>
                            This account still has work attached to it:
                        </Text>
                        <ul style={{ margin: '10px 0 12px 18px', color: t.textMuted, fontSize: 13 }}>
                            {blockers.map((x) => (
                                <li key={x.label}>{x.count} {x.label}</li>
                            ))}
                        </ul>
                        <Text style={{ color: t.textMuted, fontSize: 12.5 }}>
                            Deleting the account would either destroy those records or leave them
                            belonging to nobody. Use <strong>Delete</strong> instead &mdash; it keeps
                            every one of them, shows the person as &ldquo;{user.fullName} (deleted
                            user)&rdquo;, and frees their Employee&nbsp;ID and username for reuse.
                        </Text>
                    </div>
                ),
            });
            return;
        }

        Modal.confirm({
            title: `Permanently delete ${user.fullName}?`,
            width: 560,
            okText: 'Permanently delete',
            okButtonProps: { danger: true },
            cancelText: 'Cancel',
            content: (
                <div style={{ marginTop: 10 }}>
                    <Text style={{ color: t.text, fontSize: 13, display: 'block', marginBottom: 10 }}>
                        This removes the account row itself. <strong>There is no undo.</strong>
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 12.5 }}>
                        Nothing is attached to this account, so nothing is lost. Their sign-in,
                        invitation links, notifications and project memberships go with it, and
                        the username <strong>@{user.username}</strong>
                        {user.employeeId ? <> and Employee&nbsp;ID <strong>{user.employeeId}</strong></> : null}
                        {' '}become available again.
                    </Text>
                </div>
            ),
            onOk: async () => {
                try {
                    const res = await api.delete(`/users/${user.id}/permanent`);
                    message.success(res.data?.message ?? 'Account permanently deleted');
                    load();
                } catch (e: any) {
                    message.error(e?.response?.data?.message ?? 'Could not delete the account');
                    throw e;   // keeps the dialog open so the reason stays readable
                }
            },
        });
    };

    const handleRestoreUser = async (id: string) => {
        try {
            await api.post(`/users/${id}/restore`);
            message.success('User restored — assign them an Employee ID to finish');
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Could not restore the account');
        }
    };

    const deletedCount = users.filter((u) => u.archivedAt).length;
    const visibleUsers = showDeleted ? users : users.filter((u) => !u.archivedAt);

    const columns = [
        { title: 'User', key: 'user',
            render: (_: any, r: UserRecord) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <UserAvatar name={r.fullName} avatarUrl={r.avatarUrl} color={t.textOnAccent} bg={t.accent} userId={r.id} />
                    <div>
                        <Text strong style={{ color: t.text, display: 'block' }}>{r.fullName}</Text>
                        <Text style={{ color: t.textMuted, fontSize: 11 }}>@{r.username}</Text>
                        {r.employeeId && <Text style={{ color: t.textFaint, fontSize: 10 }}>ID: {r.employeeId}</Text>}
                    </div>
                </div>
            ),
        },
        { title: 'Email', dataIndex: 'email', key: 'email', render: (v: string) => <Text style={{ color: t.textMuted }}>{v ?? '—'}</Text> },
        {
            title: 'Access', key: 'permissions',
            render: (_: any, r: UserRecord) => {
                const perms = resolvePermissions(r.permissions);
                const granted = PERMISSION_ITEMS.filter((p) => perms[p.key]);
                const elevated = granted.filter((p) => p.key !== 'manage_wishlists');
                if (!elevated.length) {
                    return (
                        <Tag style={{ borderColor: t.border, color: t.textMuted, background: 'transparent' }}>
                            Standard
                        </Tag>
                    );
                }
                return (
                    <Tooltip title={granted.map((p) => p.label).join(' · ')}>
                        <Space size={4} wrap>
                            {elevated.slice(0, 2).map((p) => (
                                <Tag key={p.key} style={{ borderColor: alpha(t.accent, 0.4), color: t.accent, background: alpha(t.accent, 0.08) }}>
                                    {p.label}
                                </Tag>
                            ))}
                            {elevated.length > 2 && (
                                <Tag style={{ borderColor: t.border, color: t.textMuted, background: 'transparent' }}>
                                    +{elevated.length - 2}
                                </Tag>
                            )}
                        </Space>
                    </Tooltip>
                );
            },
        },
        {
            title: 'Status', key: 'status',
            render: (_: any, r: UserRecord) => {
                if (r.archivedAt) {
                    return (
                        <Tooltip title={r.archivedEmployeeId
                            ? `Deleted — their work is kept. Previously ${r.archivedEmployeeId}.`
                            : 'Deleted — their work is kept'}>
                            <Badge status="default" text={<Text style={{ color: t.textMuted, fontSize: 12 }}>Deleted</Text>} />
                        </Tooltip>
                    );
                }
                if (isPendingInvite(r)) return (
                    <Tooltip title={`Invited ${new Date(r.invitedAt!).toLocaleDateString()} — waiting for them to choose a username and password. The link expires 7 days after it was sent.`}>
                        <Badge status="processing" text={<Text style={{ color: t.accent, fontSize: 12 }}>Invited</Text>} />
                    </Tooltip>
                );
                if (!r.isActive) return <Badge status="error" text={<Text style={{ color: t.danger, fontSize: 12 }}>Inactive</Text>} />;
                if (r.isOnHold)  return <Badge status="warning" text={<Text style={{ color: t.warning, fontSize: 12 }}>On Hold</Text>} />;
                return <Badge status="success" text={<Text style={{ color: t.success, fontSize: 12 }}>Active</Text>} />;
            },
        },
        {
            title: 'RFID', key: 'rfid',
            render: (_: any, r: UserRecord) => {
                const s = rfid[r.id];
                if (!s) return <Text style={{ color: t.textFaint, fontSize: 12 }}>—</Text>;
                return (
                    <Space direction="vertical" size={2}>
                        {s.registering
                            ? <Tag color="processing" style={{ marginInlineEnd: 0 }}>Registering…</Tag>
                            : <RfidStatusTag status={s.status} />}
                        {s.card ? (
                            <Text style={{ color: t.textFaint, fontSize: 10, fontFamily: 'ui-monospace, monospace' }}>
                                {s.card.uid}
                            </Text>
                        ) : !s.hasEmployeeId ? (
                            <Text style={{ color: t.warning, fontSize: 10 }}>Needs an Employee ID</Text>
                        ) : s.lastRegistration?.failureReason ? (
                            <Tooltip title={s.lastRegistration.failureReason}>
                                <Text style={{ color: t.danger, fontSize: 10 }}>Last attempt failed</Text>
                            </Tooltip>
                        ) : null}
                    </Space>
                );
            },
        },
        {
            title: 'Joined', dataIndex: 'createdAt', key: 'createdAt',
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{new Date(v).toLocaleDateString()}</Text>,
            sorter: (a: UserRecord, b: UserRecord) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        },
        {
            title: 'Actions', key: 'actions',
            render: (_: any, record: UserRecord) => (
                <Space>
                    <Tooltip title="RFID card, attendance and reporting">
                        <Button size="small" icon={<IdcardOutlined />} onClick={() => setDrawerUser(record)} />
                    </Tooltip>
                    <Button size="small" icon={<EditOutlined />} onClick={() => openModal(record)} />
                    {isPendingInvite(record) && !record.archivedAt && record.email && (
                        <Popconfirm
                            title={`Send ${record.fullName} the invitation again?`}
                            description={
                                <span style={{ display: 'inline-block', maxWidth: 320 }}>
                                    A fresh setup link will be emailed to <strong>{record.email}</strong>.
                                    Any earlier invitation stops working.
                                </span>
                            }
                            onConfirm={() => handleResendInvite(record)}
                            okText="Resend"
                            cancelText="Cancel"
                        >
                            <Button
                                size="small"
                                icon={<SendOutlined />}
                                title="Send the setup invitation again"
                            />
                        </Popconfirm>
                    )}
                    {record.isActive && !record.archivedAt && record.email && (
                        <Popconfirm
                            title={`Send ${record.fullName} a reset link?`}
                            description={
                                <span style={{ display: 'inline-block', maxWidth: 320 }}>
                                    A password-reset link will be emailed to <strong>{record.email}</strong>,
                                    and nowhere else. It expires in 1 hour and replaces any earlier
                                    link they were sent.
                                </span>
                            }
                            onConfirm={() => handleSendResetLink(record)}
                            okText="Send link"
                            cancelText="Cancel"
                        >
                            <Button
                                size="small"
                                icon={<MailOutlined />}
                                title="Email this user a password-reset link"
                            />
                        </Popconfirm>
                    )}
                    {record.id !== currentUser?.id && record.isActive && !isPendingInvite(record) && (
                        <Popconfirm
                            title={`Deactivate ${record.fullName}?`}
                            description="This will prevent them from logging in."
                            onConfirm={() => handleDeactivate(record.id)}
                            okText="Deactivate"
                            okButtonProps={{ danger: true }}
                        >
                            <Button size="small" danger icon={<StopOutlined />} title="Deactivate" />
                        </Popconfirm>
                    )}
                    {record.archivedAt && (
                        <Tooltip title="Restore this account">
                            <Button
                                size="small"
                                icon={<UndoOutlined />}
                                onClick={() => handleRestoreUser(record.id)}
                            />
                        </Tooltip>
                    )}
                    {record.id !== currentUser?.id && !record.archivedAt && (
                        <Popconfirm
                            title={`Delete ${record.fullName}?`}
                            description={
                                <span style={{ display: 'inline-block', maxWidth: 340 }}>
                                    <strong>Their work is kept.</strong> Every task, report, upload,
                                    schedule and attendance record stays exactly as it is, shown
                                    against &ldquo;{record.fullName} (deleted user)&rdquo;.
                                    <br /><br />
                                    The account stops existing: they cannot sign in, their RFID card
                                    is revoked, and
                                    {record.employeeId
                                        ? <> Employee&nbsp;ID <strong>{record.employeeId}</strong> and the
                                            username <strong>@{record.username}</strong> are released for reuse.</>
                                        : <> their username is released for reuse.</>}
                                    <br /><br />
                                    Reversible &mdash; you can restore them later.
                                </span>
                            }
                            onConfirm={() => handleDeleteUser(record.id)}
                            okText="Delete user"
                            cancelText="Cancel"
                        >
                            <Button
                                size="small"
                                icon={<InboxOutlined />}
                                title="Delete — keeps all their work, frees the Employee ID"
                            />
                        </Popconfirm>
                    )}
                    {record.id !== currentUser?.id && (
                        <Tooltip title="Permanently delete — removes the account row itself. Only possible when nothing is attached to it.">
                            <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={() => confirmPermanentDelete(record)}
                            />
                        </Tooltip>
                    )}
                    {record.id !== currentUser?.id && !record.isActive && !isPendingInvite(record) && !record.archivedAt && (
                        <Popconfirm
                            title={`Reactivate ${record.fullName}?`}
                            description="This will allow them to log in again."
                            onConfirm={() => handleReactivate(record.id)}
                            okText="Reactivate"
                        >
                            <Button size="small" type="primary" icon={<PlusOutlined />} style={{ background: t.success, borderColor: t.success }} />
                        </Popconfirm>
                    )}
                </Space>
            ),
        },
    ];

    return (
        <div style={{ padding: '0 0 40px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <Title level={3} style={{ margin: 0, color: t.text }}>User Management</Title>
                    <Text style={{ color: t.textMuted }}>{users.length} user{users.length !== 1 ? 's' : ''} total</Text>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()} style={{ background: t.accent, borderColor: t.accent }}>
                    Add User
                </Button>
            </div>

            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

            {/* Card registration needs a reader that is online, so say so here
                rather than only failing when someone tries. */}
            {readers.total === 0 ? (
                <Alert
                    type="info" showIcon style={{ marginBottom: 16 }}
                    message="No RFID reader is set up yet"
                    description="Employees can be created and given Employee IDs now; cards can be registered once a reader is added under Attendance → Readers."
                />
            ) : readers.online === 0 ? (
                <Alert
                    type="warning" showIcon style={{ marginBottom: 16 }}
                    message={`No RFID reader is online (${readers.total} configured)`}
                    description="Card registration will stay unavailable until a reader checks in. Check its power and network connection."
                />
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Switch
                    size="small"
                    checked={showDeleted}
                    onChange={setShowDeleted}
                />
                <Text style={{ color: t.textMuted, fontSize: 13 }}>
                    Show deleted users
                    {deletedCount > 0 && (
                        <Text style={{ color: t.textFaint, fontSize: 12 }}> &middot; {deletedCount} hidden</Text>
                    )}
                </Text>
            </div>

            <Table
                dataSource={visibleUsers}
                columns={columns}
                rowKey="id"
                loading={loading}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                style={{ background: t.surface, borderRadius: 12 }}
                rowClassName={(record) => !record.isActive ? 'inactive-row' : record.isOnHold ? 'onhold-row' : ''}
            />

            <style>{`
                .inactive-row td { opacity: 0.5; }
                .onhold-row td { opacity: 0.75; }
                .onhold-row { border-left: 3px solid ${t.warning} !important; }
            `}</style>

            <FormModal
                title={editUser ? `Edit — ${editUser.fullName}` : 'Invite a new member'}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                onOk={handleSave}
                confirmLoading={saveLoading}
                okText={editUser ? 'Save Changes' : 'Send invitation'}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    {!editUser && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 18 }}
                            message="They set their own username and password"
                            description={
                                <span style={{ fontSize: 12 }}>
                                    Enter an email address and the portal sends an invitation.
                                    They choose a username and password from the link, so there is
                                    no temporary password for you to pass on. You can fill in the
                                    employment details now or once they have joined.
                                </span>
                            }
                        />
                    )}
                    <Form.Item
                        name="email"
                        label={editUser ? 'Email' : 'Email address'}
                        rules={editUser ? [{ type: 'email', message: 'Enter a valid email address' }] : [
                            { required: true, message: 'An email address is required — the invitation goes there' },
                            { type: 'email', message: 'Enter a valid email address' },
                        ]}
                        extra={!editUser && (
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                The invitation is sent here, and this becomes the address they
                                use for password resets.
                            </Text>
                        )}
                    >
                        <Input type="email" prefix={<MailOutlined style={{ color: t.textMuted }} />} />
                    </Form.Item>
                    <Form.Item
                        name="fullName"
                        label={editUser ? 'Full Name' : 'Full name (optional)'}
                        rules={editUser ? [{ required: true }] : []}
                        extra={!editUser && (
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                Used to greet them in the invitation. They can correct it when
                                they register.
                            </Text>
                        )}
                    >
                        <Input prefix={<UserOutlined />} />
                    </Form.Item>
                    {editUser && (
                        <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                            <Input />
                        </Form.Item>
                    )}
                    <Form.Item
                        name="password"
                        label={<Text>New Password</Text>}
                        rules={[]}
                        style={{ display: !editUser || !changePassword ? 'none' : undefined }}
                    >
                        <Input
                            type={showPassword ? 'text' : 'password'}
                            autoComplete="new-password"
                            style={{ fontFamily: showPassword ? 'monospace' : undefined }}
                            suffix={
                                <Space size={4}>
                                    <Tooltip title={showPassword ? 'Hide' : 'Show'}>
                                        <Button
                                            type="text" size="small"
                                            icon={showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                            onClick={() => setShowPassword(!showPassword)}
                                            style={{ color: t.textMuted, padding: 0, height: 'auto' }}
                                        />
                                    </Tooltip>
                                    <Tooltip title="Copy password">
                                        <Button
                                            type="text" size="small"
                                            icon={<CopyOutlined />}
                                            onClick={() => {
                                                const pwd = form.getFieldValue('password');
                                                if (pwd) { navigator.clipboard.writeText(pwd); message.success('Password copied to clipboard'); }
                                            }}
                                            style={{ color: t.textMuted, padding: 0, height: 'auto' }}
                                        />
                                    </Tooltip>
                                </Space>
                            }
                        />
                    </Form.Item>
                    {/* Setting a password by hand is the fallback, not the path:
                        "Send a reset link" from the row lets them choose their
                        own without anybody else ever knowing it. */}
                    {editUser && !changePassword && (
                        <Form.Item style={{ marginBottom: 16 }}>
                            <Button
                                type="dashed"
                                icon={<ReloadOutlined />}
                                style={{ borderColor: t.border, color: t.textMuted, width: '100%' }}
                                onClick={() => {
                                    const pwd = generatePassword();
                                    form.setFieldValue('password', pwd);
                                    setShowPassword(true);
                                    setChangePassword(true);
                                }}
                            >
                                Set a password by hand
                            </Button>
                            <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 6 }}>
                                Usually unnecessary &mdash; the envelope button on their row emails
                                them a reset link so they choose it themselves.
                            </Text>
                        </Form.Item>
                    )}
                    <Form.Item
                        label="Module Permissions"
                        extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Everyone shares the same role (Lab Member). Tick the modules this user may access. Changes take effect on their next page load or focus.</Text>}
                        style={{ marginBottom: 20 }}
                    >
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1fr 1fr',
                            gap: '10px 18px',
                            background: t.surfaceSunken,
                            border: `1px solid ${t.border}`,
                            borderRadius: 8,
                            padding: '14px 16px',
                        }}>
                            {PERMISSION_ITEMS.map((p) => (
                                <Form.Item
                                    key={p.key}
                                    name={['permissions', p.key]}
                                    valuePropName="checked"
                                    noStyle
                                >
                                    <Checkbox disabled={editUser?.id === currentUser?.id}>
                                        <Tooltip title={p.help}>
                                            <Text style={{ color: t.text, fontSize: 12 }}>{p.label}</Text>
                                        </Tooltip>
                                    </Checkbox>
                                </Form.Item>
                            ))}
                        </div>
                        {editUser?.id === currentUser?.id && (
                            <Text style={{ color: t.warning, fontSize: 11, display: 'block', marginTop: 8 }}>
                                You cannot change your own permissions — ask another user administrator.
                            </Text>
                        )}
                    </Form.Item>
                    {editingOtherAdmin && (
                        <Alert
                            type="info"
                            showIcon
                            style={{ marginBottom: 20 }}
                            message="This account belongs to another administrator"
                            description={
                                <span style={{ fontSize: 12 }}>
                                    You can still correct their name, email, password and module
                                    permissions. Their employment settings &mdash; position title,
                                    Employee&nbsp;ID, hours cap, account hold and remote work &mdash;
                                    are theirs to set on their own account.
                                </span>
                            }
                        />
                    )}
                    {/* Position title — this is the tag shown beside the person's
                        name across the portal. It describes their position, not
                        their access: what they may do comes from the module
                        permissions above. Free text, with the common ones offered. */}
                    {editUser && !editingOtherAdmin && (
                        <Form.Item
                            name="jobTitle"
                            label="Position title"
                            extra={
                                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                    Shown beside their name throughout the portal. Leave empty to
                                    show &ldquo;Lab Member&rdquo;. This is their position, not their
                                    access &mdash; permissions are set above.
                                </Text>
                            }
                        >
                            <AutoComplete
                                allowClear
                                placeholder="e.g. Research Assistant"
                                options={POSITION_TITLES.map((v) => ({ value: v }))}
                                filterOption={(input, option) =>
                                    (option?.value ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                }
                            />
                        </Form.Item>
                    )}
                    {/* Weekly hours cap — requires the distinct cap_hours permission */}
                    {editUser && !editingOtherAdmin && hasPermission('cap_hours') && (
                        <Form.Item
                            name="weeklyHoursCap"
                            label="Weekly Hours Cap (leave blank for no cap)"
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Applies to Lab Assistants. Schedule submissions exceeding this cap will be blocked.</Text>}
                        >
                            <InputNumber min={0.5} max={168} step={0.5} precision={1} placeholder="e.g. 40" style={{ width: '100%' }} />
                        </Form.Item>
                    )}
                    {/* Remote work restriction — requires manage_users */}
                    {editUser && !editingOtherAdmin && hasPermission('manage_users') && (
                        <Form.Item
                            name="remoteWorkRestricted"
                            valuePropName="checked"
                            label="Remote Work Restriction"
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>When enabled, this user cannot log any remote hours. All submitted report hours must be on-site.</Text>}
                        >
                            <Switch
                                checkedChildren="Restricted"
                                unCheckedChildren="Allowed"
                                style={{ background: form.getFieldValue('remoteWorkRestricted') ? t.danger : undefined }}
                            />
                        </Form.Item>
                    )}
                    {/* Remote-work share — the "20% policy", per person rather
                        than a fixed rule. It only means anything when remote
                        work is allowed at all. */}
                    {editUser && !editingOtherAdmin && hasPermission('manage_users') && (
                        <Form.Item
                            noStyle
                            shouldUpdate={(prev, next) => prev.remoteWorkRestricted !== next.remoteWorkRestricted}
                        >
                            {({ getFieldValue }) => (
                                <Form.Item
                                    name="remoteWorkPercent"
                                    label="Remote Work Allowance (% of the week)"
                                    extra={
                                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                            The share of this person&rsquo;s weekly hours that may be
                                            worked remotely. The lab default is 20%. Set per person
                                            &mdash; it is not a fixed rule.
                                            {getFieldValue('remoteWorkRestricted') && (
                                                <> Currently inactive: remote work is restricted for
                                                this user.</>
                                            )}
                                        </Text>
                                    }
                                    rules={[{ type: 'number', min: 0, max: 100, message: 'Between 0 and 100' }]}
                                >
                                    <InputNumber
                                        min={0}
                                        max={100}
                                        step={5}
                                        precision={0}
                                        addonAfter="%"
                                        style={{ width: '100%' }}
                                        disabled={getFieldValue('remoteWorkRestricted')}
                                    />
                                </Form.Item>
                            )}
                        </Form.Item>
                    )}
                    {/* Employee ID — requires manage_users */}
                    {editUser && !editingOtherAdmin && hasPermission('manage_users') && (
                        <Form.Item
                            name="employeeId"
                            label="Employee ID"
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>Unique identifier for attendance matching. Only visible to user administrators and shown read-only to the user.</Text>}
                            rules={[{ max: 64, message: 'Max 64 characters' }]}
                        >
                            <Input placeholder="e.g. EMP-0042" />
                        </Form.Item>
                    )}
                    {/* Account Hold — requires manage_users */}
                    {editUser && !editingOtherAdmin && hasPermission('manage_users') && (
                        <Form.Item
                            name="isOnHold"
                            valuePropName="checked"
                            label="Account Hold"
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>When enabled, the user can view all their data but cannot submit or modify anything (tasks, reports, schedules, etc.).</Text>}
                        >
                            <Switch
                                checkedChildren="On Hold"
                                unCheckedChildren="Normal"
                                style={{ background: form.getFieldValue('isOnHold') ? t.warning : undefined }}
                            />
                        </Form.Item>
                    )}
                    {/* Online Clock-In/Out — requires manage_users */}
                    {editUser && !editingOtherAdmin && hasPermission('manage_users') && (
                        <Form.Item
                            name="onlineClockEnabled"
                            valuePropName="checked"
                            label="Online Clock-In/Out"
                            extra={<Text style={{ color: t.textMuted, fontSize: 11 }}>When enabled, this user can clock in and out via the online portal.</Text>}
                        >
                            <Switch
                                checkedChildren="Enabled"
                                unCheckedChildren="Disabled"
                                style={{ background: form.getFieldValue('onlineClockEnabled') ? t.success : undefined }}
                            />
                        </Form.Item>
                    )}
                </Form>
            </FormModal>

            <EmployeeDrawer
                open={!!drawerUser}
                onClose={() => setDrawerUser(null)}
                userId={drawerUser?.id ?? null}
                fullName={drawerUser?.fullName ?? ''}
                employeeId={drawerUser?.employeeId ?? null}
                onChanged={loadRfid}
            />
        </div>
    );
}
