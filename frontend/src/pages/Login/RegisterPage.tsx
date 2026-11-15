import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Form, Input, Button, Typography, Alert, Spin } from 'antd';
import { LockOutlined, UserOutlined, IdcardOutlined, ArrowLeftOutlined, MailOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/useTheme';
import { errorMessage } from '../../hooks/useNotify';
import { FormCard } from '../../components/ui';

const { Text } = Typography;

/**
 * Where an invited member claims their account.
 *
 * The administrator who created the account chose an email address and
 * nothing else — no username, no password, and no temporary one to pass
 * along. Those are chosen here, by the person they belong to, and the portal
 * signs them straight in afterwards rather than sending them back to a login
 * form to type what they just set.
 */
export default function RegisterPage() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const { setToken, setUser } = useAuthStore();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    // The invitation is checked before anything is typed, so an expired or
    // already-used link says so immediately instead of after a filled form.
    const [checking, setChecking] = useState(true);
    const [invite, setInvite] = useState<{ email: string; fullName: string } | null>(null);
    const [linkError, setLinkError] = useState<string | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form] = Form.useForm();

    useEffect(() => {
        if (!token) { setChecking(false); return; }
        let cancelled = false;
        (async () => {
            try {
                const res = await api.get(`/auth/registration/${encodeURIComponent(token)}`);
                if (cancelled) return;
                setInvite(res.data);
                // Offered, not imposed — an administrator may have guessed the
                // name from the address, so it stays editable.
                form.setFieldsValue({ fullName: res.data.fullName ?? '' });
            } catch (err) {
                if (!cancelled) setLinkError(errorMessage(err, 'This invitation link is not valid.'));
            } finally {
                if (!cancelled) setChecking(false);
            }
        })();
        return () => { cancelled = true; };
    }, [token, form]);

    const onFinish = async (values: { username: string; password: string; fullName?: string }) => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await api.post('/auth/registration', {
                token,
                username: values.username.trim().toLowerCase(),
                password: values.password,
                fullName: values.fullName?.trim() || undefined,
            });
            setToken(data.accessToken);
            setUser(data.user);
            navigate('/home', { replace: true });
        } catch (err) {
            setError(errorMessage(err, 'Could not complete your registration. Please try again.'));
        } finally {
            setLoading(false);
        }
    };

    const shell = (children: React.ReactNode, heading: string) => (
        <div style={{
            minHeight: '100vh', background: t.bg,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '24px 16px',
        }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <img src="/AI-ML_Logo.png" alt="AI/ML Lab Portal"
                    style={{ width: 120, height: 120, objectFit: 'contain', marginBottom: 8 }} />
                <div style={{ color: t.text, fontSize: 22, fontWeight: 700 }}>{heading}</div>
            </div>
            {children}
            <div style={{ marginTop: 32, textAlign: 'center' }}>
                <div style={{ color: t.textMuted, fontSize: 12 }}>AI/ML Lab Portal Platform</div>
            </div>
        </div>
    );

    if (!token) {
        return shell(
            <FormCard style={{ width: 380, textAlign: 'center', padding: '24px 16px' }}>
                <Text style={{ color: t.text, fontSize: 14, display: 'block', marginBottom: 16 }}>
                    This page needs an invitation link. Open the link from the email you were
                    sent, or ask an administrator to send you a new one.
                </Text>
                <Link to="/login" style={{ color: t.accent, fontSize: 13 }}>Back to sign in</Link>
            </FormCard>,
            'Set up your account',
        );
    }

    if (checking) {
        return shell(
            <FormCard style={{ width: 380, textAlign: 'center', padding: '32px 16px' }}>
                <Spin />
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginTop: 14 }}>
                    Checking your invitation…
                </Text>
            </FormCard>,
            'Set up your account',
        );
    }

    if (linkError) {
        return shell(
            <>
                <FormCard style={{ width: 380, padding: '20px 16px' }}>
                    <Alert type="error" message={linkError} showIcon style={{ marginBottom: 16 }} />
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block' }}>
                        If you already finished setting up your account, sign in as usual. If you
                        cannot get in, use “Forgot password” on the sign-in page.
                    </Text>
                </FormCard>
                <FormCard style={{ width: 380, textAlign: 'center', marginTop: 16, padding: 16 }}>
                    <Link to="/login" style={{ color: t.accent, fontSize: 13 }}>
                        <ArrowLeftOutlined style={{ marginRight: 4 }} />Back to sign in
                    </Link>
                </FormCard>
            </>,
            'Set up your account',
        );
    }

    return shell(
        <>
            <FormCard style={{ width: 380, padding: '20px 16px' }}>
                {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

                <div style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    background: t.surfaceSunken, border: `1px solid ${t.border}`,
                    borderRadius: 8, padding: '10px 12px', marginBottom: 18,
                }}>
                    <MailOutlined style={{ color: t.textMuted }} />
                    <div style={{ minWidth: 0 }}>
                        <div style={{ color: t.textMuted, fontSize: 11, lineHeight: 1.3 }}>
                            Setting up the account for
                        </div>
                        <div style={{
                            color: t.text, fontSize: 13, fontWeight: 600,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {invite?.email}
                        </div>
                    </div>
                </div>

                <Form form={form} onFinish={onFinish} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="fullName"
                        label="Your name"
                        rules={[{ required: true, message: 'Please enter your name' }]}
                        style={{ marginBottom: 12 }}
                    >
                        <Input
                            prefix={<IdcardOutlined style={{ color: t.textMuted }} />}
                            placeholder="Jane Okafor"
                            size="large"
                        />
                    </Form.Item>
                    <Form.Item
                        name="username"
                        label="Choose a username"
                        extra={
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                This is what you sign in with. Letters, numbers, dots, dashes
                                and underscores.
                            </Text>
                        }
                        rules={[
                            { required: true, message: 'Please choose a username' },
                            { min: 3, message: 'Username must be at least 3 characters' },
                            { max: 32, message: 'Username must be 32 characters or fewer' },
                            {
                                pattern: /^[a-zA-Z0-9._-]+$/,
                                message: 'Only letters, numbers, dots, dashes and underscores',
                            },
                        ]}
                        style={{ marginBottom: 12 }}
                    >
                        <Input
                            prefix={<UserOutlined style={{ color: t.textMuted }} />}
                            placeholder="jokafor"
                            autoFocus
                            size="large"
                        />
                    </Form.Item>
                    <Form.Item
                        name="password"
                        label="Choose a password"
                        rules={[
                            { required: true, message: 'Please choose a password' },
                            { min: 8, message: 'Password must be at least 8 characters' },
                        ]}
                        style={{ marginBottom: 12 }}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: t.textMuted }} />}
                            placeholder="••••••••"
                            size="large"
                        />
                    </Form.Item>
                    <Form.Item
                        name="confirmPassword"
                        label="Confirm password"
                        dependencies={['password']}
                        rules={[
                            { required: true, message: 'Please confirm your password' },
                            ({ getFieldValue }) => ({
                                validator(_, value) {
                                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                                    return Promise.reject(new Error('Passwords do not match'));
                                },
                            }),
                        ]}
                        style={{ marginBottom: 16 }}
                    >
                        <Input.Password
                            prefix={<LockOutlined style={{ color: t.textMuted }} />}
                            placeholder="••••••••"
                            size="large"
                        />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Button type="primary" htmlType="submit" loading={loading} block size="large">
                            {loading ? 'Setting up…' : 'Create my account'}
                        </Button>
                    </Form.Item>
                </Form>
            </FormCard>

            <FormCard style={{ width: 380, textAlign: 'center', marginTop: 16, padding: 16 }}>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    Already set up your account?{' '}
                    <Link to="/login" style={{ color: t.accent }}>Sign in</Link>
                </Text>
            </FormCard>
        </>,
        'Set up your account',
    );
}
