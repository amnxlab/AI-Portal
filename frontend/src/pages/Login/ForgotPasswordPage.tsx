import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Form, Input, Button, Typography, Alert } from 'antd';
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { useTheme } from '../../theme/useTheme';
import { errorMessage } from '../../hooks/useNotify';
import { FormCard } from '../../components/ui';

const { Text } = Typography;

export default function ForgotPasswordPage() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const [loading,  setLoading]  = useState(false);
    const [sent,     setSent]     = useState(false);
    const [error,    setError]    = useState<string | null>(null);

    const onFinish = async (values: { email: string }) => {
        setLoading(true);
        setError(null);
        try {
            await api.post('/auth/forgot-password', values);
            setSent(true);
        } catch (err) {
            setError(errorMessage(err, 'Failed to send reset link. Please try again.'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh', background: t.bg,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '24px 16px',
        }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <img src="/AI-ML_Logo.png" alt="AI/ML Lab Portal"
                    style={{ width: 120, height: 120, objectFit: 'contain', marginBottom: 8 }} />
                <div style={{ color: t.text, fontSize: 22, fontWeight: 700 }}>Forgot password</div>
            </div>

            <FormCard style={{ width: 340, padding: '20px 16px' }}>
                {error && (
                    <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
                )}

                {sent ? (
                    <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
                        <div style={{ fontSize: 32, marginBottom: 12 }}>📬</div>
                        <Text style={{ color: t.text, fontSize: 14, display: 'block', marginBottom: 8 }}>
                            If that email address is registered, a reset link has been sent.
                        </Text>
                        <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 20 }}>
                            Check your inbox and follow the link. The link expires in 1 hour.
                        </Text>
                        <Button type="link" icon={<ArrowLeftOutlined />}
                            onClick={() => navigate('/login')}
                            style={{ color: t.accent, padding: 0 }}>
                            Back to sign in
                        </Button>
                    </div>
                ) : (
                    <>
                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 16 }}>
                            Enter the email address associated with your account and we'll send you a reset link.
                        </Text>
                        <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
                            <Form.Item
                                name="email"
                                label="Email address"
                                rules={[
                                    { required: true, message: 'Please enter your email' },
                                    { type: 'email', message: 'Please enter a valid email' },
                                ]}
                                style={{ marginBottom: 16 }}
                            >
                                <Input
                                    prefix={<MailOutlined style={{ color: t.textMuted }} />}
                                    placeholder="you@example.com"
                                    autoComplete="email"
                                    autoFocus
                                    size="large"
                                />
                            </Form.Item>
                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button type="primary" htmlType="submit" loading={loading} block size="large">
                                    {loading ? 'Sending…' : 'Send reset link'}
                                </Button>
                            </Form.Item>
                        </Form>
                    </>
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
