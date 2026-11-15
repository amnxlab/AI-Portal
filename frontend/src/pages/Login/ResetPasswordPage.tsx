import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { LockOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { useTheme } from '../../theme/useTheme';
import { errorMessage } from '../../hooks/useNotify';
import { FormCard } from '../../components/ui';

const { Text } = Typography;

export default function ResetPasswordPage() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token') ?? '';

    const [loading, setLoading]  = useState(false);
    const [done,    setDone]     = useState(false);
    const [error,   setError]    = useState<string | null>(null);

    const onFinish = async (values: { newPassword: string }) => {
        setLoading(true);
        setError(null);
        try {
            await api.post('/auth/reset-password', { token, newPassword: values.newPassword });
            setDone(true);
        } catch (err) {
            setError(errorMessage(err, 'Failed to reset password. The link may have expired.'));
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div style={{
                minHeight: '100vh', background: t.bg,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', padding: '24px 16px',
            }}>
                <FormCard style={{ width: 340, textAlign: 'center', padding: '24px 16px' }}>
                    <Text style={{ color: t.text, fontSize: 14, display: 'block', marginBottom: 16 }}>
                        Invalid or missing reset token. Please request a new reset link.
                    </Text>
                    <Link to="/forgot-password" style={{ color: t.accent, fontSize: 13 }}>Request a new link</Link>
                </FormCard>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100vh', background: t.bg,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '24px 16px',
        }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <img src="/AI-ML_Logo.png" alt="AI/ML Lab Portal"
                    style={{ width: 120, height: 120, objectFit: 'contain', marginBottom: 8 }} />
                <div style={{ color: t.text, fontSize: 22, fontWeight: 700 }}>Reset your password</div>
            </div>

            <FormCard style={{ width: 340, padding: '20px 16px' }}>
                {error && (
                    <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
                )}

                {done ? (
                    <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
                        <Text style={{ color: t.text, fontSize: 14, display: 'block', marginBottom: 20 }}>
                            Your password has been reset. You can now sign in with your new password.
                        </Text>
                        <Button type="primary" onClick={() => navigate('/login')}>
                            Go to sign in
                        </Button>
                    </div>
                ) : (
                    <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
                        <Form.Item
                            name="newPassword"
                            label="New password"
                            rules={[
                                { required: true, message: 'Please enter a new password' },
                                { min: 8, message: 'Password must be at least 8 characters' },
                            ]}
                            style={{ marginBottom: 12 }}
                        >
                            <Input.Password
                                prefix={<LockOutlined style={{ color: t.textMuted }} />}
                                placeholder="••••••••"
                                autoFocus
                                size="large"
                            />
                        </Form.Item>
                        <Form.Item
                            name="confirmPassword"
                            label="Confirm new password"
                            dependencies={['newPassword']}
                            rules={[
                                { required: true, message: 'Please confirm your new password' },
                                ({ getFieldValue }) => ({
                                    validator(_, value) {
                                        if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
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
                                {loading ? 'Resetting…' : 'Reset password'}
                            </Button>
                        </Form.Item>
                    </Form>
                )}
            </FormCard>

            <FormCard style={{ width: 340, textAlign: 'center', marginTop: 16, padding: 16 }}>
                <Link to="/login" style={{ color: t.accent, fontSize: 13 }}>
                    <ArrowLeftOutlined style={{ marginRight: 4 }} />Back to sign in
                </Link>
            </FormCard>

            <div style={{ marginTop: 32, textAlign: 'center' }}>
                <div style={{ color: t.textMuted, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                    AI/ML Lab Portal Platform
                </div>
            </div>
        </div>
    );
}
