import { useState, useEffect, useRef } from 'react';
import {
    Form, Input, Button, Typography, Alert, Avatar, Divider, Tag, Card, Row, Col, Spin, Tooltip, Space,
} from 'antd';
import {
    UserOutlined, MailOutlined, LockOutlined, SaveOutlined, EditOutlined,
    CheckCircleOutlined, CameraOutlined, DeleteOutlined,
} from '@ant-design/icons';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { useNotify } from '../../hooks/useNotify';
import { UNIFIED_ROLE, resolvePermissions, positionTitle, type RolePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/ui';

const { Text } = Typography;

/**
 * Human names for the permission flags, so the profile can state what the
 * account can actually do instead of quoting a nominal role that is the same
 * for everybody.
 */
const MODULE_LABELS: { key: keyof RolePermissions; label: string }[] = [
    { key: 'manage_users',       label: 'User management' },
    { key: 'manage_attendance',  label: 'Attendance' },
    { key: 'manage_projects',    label: 'Projects' },
    { key: 'lead_projects',      label: 'Project leadership' },
    { key: 'manage_tasks',       label: 'Tasks' },
    { key: 'manage_reports',     label: 'Reports' },
    { key: 'manage_schedules',   label: 'Schedules' },
    { key: 'manage_inventory',   label: 'Inventory' },
    { key: 'manage_budget',      label: 'Budget' },
    { key: 'manage_wishlists',   label: 'Wishlists' },
    { key: 'view_team_data',     label: 'Team data' },
    { key: 'view_all_schedules', label: 'All schedules' },
    { key: 'cap_hours',          label: 'Hour caps' },
    { key: 'post_discord',       label: 'Discord posting' },
];

export default function ProfilePage() {
    const { t } = useTheme();
    const notify = useNotify();
    const { user, setUser } = useAuthStore();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [avatarHover, setAvatarHover] = useState(false);
    // Whether the current avatarUrl failed to load (404, deleted file) — falls
    // back to the initials tile instead of leaving a broken-image icon.
    const [avatarBroken, setAvatarBroken] = useState(false);
    const [employeeId, setEmployeeId] = useState<string | null>(null);
    const avatarFileRef = useRef<HTMLInputElement>(null);

    // Load full profile from backend (has email which may not be in jwt)
    useEffect(() => {
        api.get('/users/me')
            .then((meRes) => {
                const me = meRes.data;
                setAvatarUrl(me.avatarUrl ?? null);
                setEmployeeId(me.employeeId ?? null);
                if (user) setUser({ ...user, avatarUrl: me.avatarUrl ?? undefined });
                form.setFieldsValue({
                    fullName: me.fullName,
                    username: me.username,
                    email: me.email ?? '',
                });
            })
            .catch(() => setLoadError('Failed to load profile data.'));
    }, [form]);

    // A newly uploaded or removed photo always gets a fresh load attempt.
    useEffect(() => { setAvatarBroken(false); }, [avatarUrl]);

    const handleAvatarUpload = async (file: File) => {
        if (file.size > 10 * 1024 * 1024) {
            notify.error('Image must be under 10 MB');
            return;
        }
        const fd = new FormData();
        fd.append('file', file);
        setAvatarUploading(true);
        try {
            // 1. Upload file to disk
            // The avatar endpoint, not the general one: it accepts images
            // only, caps the size, and checks the file really is an image —
            // so a document cannot become somebody's profile picture and
            // break every avatar on every page.
            const uploadRes = await api.post('/uploads/avatar', fd);
            const newUrl = uploadRes.data.url as string;
            // 2. Immediately persist the new URL to the DB so it is never "staged"
            const patchRes = await api.patch('/users/me', { avatarUrl: newUrl });
            const savedUrl: string | null = patchRes.data.avatarUrl ?? newUrl;
            setAvatarUrl(savedUrl);
            setUser({ ...user!, avatarUrl: savedUrl ?? undefined });
            notify.success('Profile photo updated');
        } catch {
            notify.error('Upload failed');
        } finally {
            setAvatarUploading(false);
        }
    };

    const handleAvatarRemove = async () => {
        setAvatarUploading(true);
        try {
            await api.patch('/users/me', { avatarUrl: null });
            setAvatarUrl(null);
            setUser({ ...user!, avatarUrl: undefined });
            notify.success('Profile photo removed');
        } catch {
            notify.error('Failed to remove photo');
        } finally {
            setAvatarUploading(false);
        }
    };

    const handleSave = async () => {
        try {
            const values = await form.validateFields();
            if (!values.newPassword) {
                delete values.newPassword;
                delete values.confirmPassword;
            }
            // Remove confirmPassword before sending
            const payload: Record<string, string | null | undefined> = {
                fullName: values.fullName,
                username: values.username,
                email: values.email,
                bio: values.bio || null,
                // Avatar is persisted atomically on select/remove — do not include it here
                // to avoid accidentally overwriting with a stale local value.
            };
            if (values.newPassword) {
                payload.password = values.newPassword;
            }

            setLoading(true);
            const res = await api.patch('/users/me', payload);
            const updated = res.data;
            // Update auth store so header reflects new name/username
            setUser({
                ...user!,
                fullName: updated.fullName,
                username: updated.username,
                email: updated.email,
                avatarUrl: updated.avatarUrl ?? undefined,
            });
            form.setFieldsValue({ newPassword: '', confirmPassword: '' });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
            notify.success('Profile updated successfully');
        } catch (e) {
            notify.error(e, 'Update failed');
        } finally {
            setLoading(false);
        }
    };

    // The lab has one nominal role for everyone; what actually differs between
    // accounts is the set of module permissions. Describing every account as
    // "Lab Member" was therefore wrong for an administrator, so the standing
    // is derived from the permissions the account really holds.
    const perms = resolvePermissions(user?.permissions as Partial<RolePermissions> | null | undefined);
    const grantedModules = MODULE_LABELS.filter(({ key }) => perms[key]);
    const isAdministrator = perms.manage_users;
    const hasAnyElevated = grantedModules.some(({ key }) => key !== 'manage_wishlists');

    // Two different things, deliberately kept apart:
    //   title  — the position an administrator assigned (what the tag shows)
    //   access — what the account may actually do (explained in the panel)
    const title = positionTitle(user);
    const standingLabel = isAdministrator
        ? 'Administrator'
        : hasAnyElevated ? 'Lab Member with module access' : UNIFIED_ROLE.label;
    const roleColor = isAdministrator ? t.danger : hasAnyElevated ? t.accent : UNIFIED_ROLE.color;
    const initials = user?.fullName?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() ?? '?';

    return (
        <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 60 }}>
            <PageHeader
                title={<Space size={8}><UserOutlined />Your Profile</Space>}
                subtitle="Manage your personal information and account security"
            />

            {loadError && <Alert type="error" message={loadError} style={{ marginBottom: 20 }} />}

            {/* Profile card */}
            <Card
                style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12, marginBottom: 20 }}
                styles={{ body: { padding: 28 } }}
            >
                {/* Avatar + basic info row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
                    {/* Clickable circular avatar */}
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                        <div
                            onClick={() => avatarFileRef.current?.click()}
                            onMouseEnter={() => setAvatarHover(true)}
                            onMouseLeave={() => setAvatarHover(false)}
                            style={{ position: 'relative', width: 80, height: 80, cursor: 'pointer', borderRadius: '50%' }}
                        >
                            {avatarUploading ? (
                                <div style={{
                                    width: 80, height: 80, borderRadius: '50%',
                                    background: t.surfaceRaised, border: `2px solid ${alpha(roleColor, 0.4)}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Spin size="small" />
                                </div>
                            ) : avatarUrl && !avatarBroken ? (
                                <img
                                    src={avatarUrl}
                                    alt="avatar"
                                    onError={() => setAvatarBroken(true)}
                                    style={{
                                        width: 80, height: 80, borderRadius: '50%',
                                        objectFit: 'cover',
                                        border: `2px solid ${alpha(roleColor, 0.4)}`,
                                        display: 'block',
                                        opacity: avatarHover ? 0.6 : 1,
                                        transition: 'opacity 0.2s',
                                    }}
                                />
                            ) : (
                                <Avatar
                                    size={80}
                                    style={{
                                        background: alpha(roleColor, 0.13),
                                        border: `2px solid ${alpha(roleColor, 0.4)}`,
                                        fontSize: 26,
                                        fontWeight: 700,
                                        color: roleColor,
                                        opacity: avatarHover ? 0.6 : 1,
                                        transition: 'opacity 0.2s',
                                    }}
                                >
                                    {initials}
                                </Avatar>
                            )}
                            {/* Camera overlay */}
                            {avatarHover && !avatarUploading && (
                                <div style={{
                                    position: 'absolute', inset: 0, borderRadius: '50%',
                                    display: 'flex', flexDirection: 'column',
                                    alignItems: 'center', justifyContent: 'center',
                                    pointerEvents: 'none',
                                }}>
                                    <CameraOutlined style={{ fontSize: 20, color: t.textOnAccent }} />
                                    <span style={{ fontSize: 9, color: t.textOnAccent, marginTop: 2, fontWeight: 600 }}>CHANGE</span>
                                </div>
                            )}
                        </div>
                        {/* Remove button when photo exists */}
                        {avatarUrl && !avatarUploading && (
                            <Tooltip title="Remove photo">
                                <button
                                    onClick={handleAvatarRemove}
                                    style={{
                                        position: 'absolute', bottom: 0, right: -2,
                                        width: 22, height: 22, borderRadius: '50%',
                                        background: t.danger, border: 'none', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        padding: 0,
                                    }}
                                >
                                    <DeleteOutlined style={{ fontSize: 11, color: t.textOnAccent }} />
                                </button>
                            </Tooltip>
                        )}
                        <input
                            ref={avatarFileRef}
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleAvatarUpload(file);
                                e.target.value = '';
                            }}
                        />
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <Text style={{ color: t.text, fontSize: 18, fontWeight: 700 }}>
                                {user?.fullName}
                            </Text>
                            <Tag
                                style={{
                                    background: alpha(roleColor, 0.10),
                                    borderColor: alpha(roleColor, 0.27),
                                    color: roleColor,
                                    borderRadius: 20,
                                    fontWeight: 600,
                                    fontSize: 11,
                                }}
                            >
                                {title}
                            </Tag>
                            {saved && (
                                <Tag
                                    icon={<CheckCircleOutlined />}
                                    style={{ background: t.successBg, borderColor: t.successBorder, color: t.success }}
                                >
                                    Saved
                                </Tag>
                            )}
                        </div>
                        <Text style={{ color: t.textMuted, fontSize: 13 }}>@{user?.username}</Text>
                        {employeeId && (
                            <div style={{ marginTop: 4 }}>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                    Employee ID:{' '}
                                    <span style={{ color: t.accent, fontFamily: 'monospace', fontWeight: 600 }}>{employeeId}</span>
                                </Text>
                            </div>
                        )}
                    </div>
                </div>

                <Divider style={{ borderColor: t.border, margin: '0 0 24px 0' }} />

                {/* Edit form */}
                <Form form={form} layout="vertical" onFinish={handleSave}>
                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                name="fullName"
                                label={<Text style={{ color: t.textMuted, fontSize: 12 }}>Full Name</Text>}
                                rules={[{ required: true, message: 'Full name is required' }]}
                            >
                                <Input
                                    prefix={<UserOutlined style={{ color: t.textMuted }} />}
                                    placeholder="Your full name"
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                name="username"
                                label={<Text style={{ color: t.textMuted, fontSize: 12 }}>Username</Text>}
                                rules={[
                                    { required: true, message: 'Username is required' },
                                    { pattern: /^[a-zA-Z0-9._-]+$/, message: 'Letters, numbers, . _ - only' },
                                ]}
                            >
                                <Input
                                    prefix={<span style={{ color: t.textMuted, marginRight: 4 }}>@</span>}
                                    placeholder="username"
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item
                        name="email"
                        label={<Text style={{ color: t.textMuted, fontSize: 12 }}>Email Address</Text>}
                        rules={[{ type: 'email', message: 'Enter a valid email' }]}
                    >
                        <Input
                            prefix={<MailOutlined style={{ color: t.textMuted }} />}
                            placeholder="you@company.com"
                            type="email"
                        />
                    </Form.Item>

                    <Form.Item
                        name="bio"
                        label={<Text style={{ color: t.textMuted, fontSize: 12 }}>Bio</Text>}
                    >
                        <Input.TextArea
                            placeholder="A short description about yourself..."
                            rows={3}
                            style={{ resize: 'none' }}
                        />
                    </Form.Item>

                    <Divider style={{ borderColor: t.border }}>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>Change Password</Text>
                    </Divider>

                    <Row gutter={16}>
                        <Col span={12}>
                            <Form.Item
                                name="newPassword"
                                label={<Text style={{ color: t.textMuted, fontSize: 12 }}>New Password</Text>}
                                rules={[{ min: 6, message: 'At least 6 characters' }]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined style={{ color: t.textMuted }} />}
                                    placeholder="Leave blank to keep current"
                                />
                            </Form.Item>
                        </Col>
                        <Col span={12}>
                            <Form.Item
                                name="confirmPassword"
                                label={<Text style={{ color: t.textMuted, fontSize: 12 }}>Confirm Password</Text>}
                                dependencies={['newPassword']}
                                rules={[
                                    ({ getFieldValue }) => ({
                                        validator(_, value) {
                                            const pw = getFieldValue('newPassword');
                                            if (!pw || pw === value) return Promise.resolve();
                                            return Promise.reject(new Error('Passwords do not match'));
                                        },
                                    }),
                                ]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined style={{ color: t.textMuted }} />}
                                    placeholder="Repeat new password"
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <Button
                            type="primary"
                            htmlType="submit"
                            icon={saved ? <CheckCircleOutlined /> : <SaveOutlined />}
                            loading={loading}
                            style={{
                                background: saved ? t.success : t.accent,
                                borderColor: saved ? t.success : t.accent,
                                fontWeight: 600,
                            }}
                        >
                            {saved ? 'Saved!' : 'Save Changes'}
                        </Button>
                    </div>
                </Form>
            </Card>

            {/* Info panel */}
            <Card
                style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 12 }}
                styles={{ body: { padding: 20 } }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <EditOutlined style={{ color: t.textMuted }} />
                    <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Account Details</Text>
                </div>
                <Text style={{ color: t.textMuted, fontSize: 12, display: 'block' }}>
                    You are an <span style={{ color: roleColor, fontWeight: 600 }}>{standingLabel}</span>
                    {isAdministrator
                        ? ' — you can manage accounts and permissions for the whole lab.'
                        : hasAnyElevated
                            ? ' — the modules below are the ones your account can manage.'
                            : ' — contact an administrator if you need access to additional modules.'}
                </Text>

                {grantedModules.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {grantedModules.map(({ key, label }) => (
                            <Tag
                                key={key}
                                style={{
                                    marginInlineEnd: 0,
                                    background: alpha(t.accent, 0.1),
                                    borderColor: alpha(t.accent, 0.35),
                                    color: t.accent,
                                    fontSize: 11,
                                }}
                            >
                                {label}
                            </Tag>
                        ))}
                    </div>
                )}
            </Card>
        </div>
    );
}
