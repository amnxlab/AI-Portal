import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import api from '../../api/axios';
import { safeNextPath } from '../../hooks/useDeepLink';

export default function LoginPage() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { setToken, setUser } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    const onFinish = async (values: { username: string; password: string }) => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await api.post('/auth/login', values);
            setToken(data.accessToken);
            setUser(data.user);
            // Back to whatever they were trying to open, if anything.
            navigate(safeNextPath(searchParams.get('next')), { replace: true });
        } catch (err: any) {
            const status = err?.response?.status;
            if (!err?.response) {
                setError('Cannot reach the server right now. Check your connection and try again.');
            } else if (status === 401) {
                setError('Incorrect username or password.');
            } else if (status === 429) {
                setError('Too many sign-in attempts. Please wait a minute and try again.');
            } else if (status >= 500) {
                setError('The server is temporarily unavailable. Please try again in a moment.');
            } else {
                setError(
                    err.response.data?.message ??
                    'Sign-in failed. Please try again.',
                );
            }
        } finally {
            setLoading(false);
        }
    };

    const cssVars = {
        '--lp-bg':            t.bg,
        '--lp-surface':       t.surface,
        '--lp-surface-raised': t.surfaceRaised,
        '--lp-border':        t.border,
        '--lp-text':          t.text,
        '--lp-text-muted':    t.textMuted,
        '--lp-text-faint':    t.textFaint,
        '--lp-on-accent':     t.textOnAccent,
        '--lp-brand':         t.brand,
        '--lp-brand-15':      alpha(t.brand, 0.15),
        '--lp-brand-22':      alpha(t.brand, 0.22),
        '--lp-brand-28':      alpha(t.brand, 0.28),
        '--lp-brand-30':      alpha(t.brand, 0.30),
        '--lp-brand-55':      alpha(t.brand, 0.55),
        '--lp-focus':         t.focusRing,
        '--lp-shadow-lg':     t.shadowLg,
    } as React.CSSProperties;

    return (
        <>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap');

                *, *::before, *::after { box-sizing: border-box; }

                .lp-root {
                    min-height: 100vh;
                    display: flex;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    background: var(--lp-bg);
                    overflow: hidden;
                }

                /* ── Animations ─────────────────────── */
                @keyframes lp-float {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    33%      { transform: translateY(-10px) rotate(0.5deg); }
                    66%      { transform: translateY(-5px) rotate(-0.5deg); }
                }
                @keyframes lp-pulse {
                    0%   { transform: scale(1);   opacity: 0.5; }
                    100% { transform: scale(1.55); opacity: 0;   }
                }
                @keyframes lp-glow-border {
                    0%, 100% { box-shadow: 0 0 20px var(--lp-brand-15), 0 0 60px var(--lp-brand-15); }
                    50%      { box-shadow: 0 0 35px var(--lp-brand-28), 0 0 80px var(--lp-brand-15); }
                }
                @keyframes lp-grain {
                    0%, 100% { transform: translate(0, 0); }
                    10%      { transform: translate(-1%, -1%); }
                    20%      { transform: translate(1%, 2%); }
                    30%      { transform: translate(-2%, 1%); }
                    40%      { transform: translate(2%, -1%); }
                    50%      { transform: translate(-1%, 2%); }
                    60%      { transform: translate(1%, -2%); }
                    70%      { transform: translate(-2%, 2%); }
                    80%      { transform: translate(2%, 1%); }
                    90%      { transform: translate(-1%, -2%); }
                }
                @keyframes lp-shimmer-line {
                    0%   { opacity: 0.4; transform: scaleX(0.6); }
                    50%  { opacity: 1;   transform: scaleX(1);   }
                    100% { opacity: 0.4; transform: scaleX(0.6); }
                }

                /* ── Left panel ─────────────────────── */
                .lp-left {
                    width: 28%;
                    min-height: 100vh;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 44px;
                    overflow: hidden;
                    background: linear-gradient(155deg, color-mix(in srgb, var(--lp-brand) 15%, black) 0%, color-mix(in srgb, var(--lp-brand) 20%, black) 45%, color-mix(in srgb, var(--lp-brand) 8%, black) 100%);
                }
                .lp-left-noise {
                    position: absolute;
                    inset: -50%;
                    width: 200%;
                    height: 200%;
                    opacity: 0.025;
                    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
                    background-size: 128px 128px;
                    animation: lp-grain 8s steps(10) infinite;
                    pointer-events: none;
                }
                .lp-left-radials {
                    position: absolute;
                    inset: 0;
                    background:
                        radial-gradient(ellipse 70% 60% at 30% 25%, var(--lp-brand-22) 0%, transparent 65%),
                        radial-gradient(ellipse 50% 50% at 80% 80%, rgba(120,0,0,0.18) 0%, transparent 55%);
                    pointer-events: none;
                }
                .lp-left-grid {
                    position: absolute;
                    inset: 0;
                    background-image:
                        linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
                    background-size: 44px 44px;
                    pointer-events: none;
                }

                /* ── Emblem ─────────────────────────── */
                .lp-emblem-wrap {
                    position: relative;
                    z-index: 2;
                    margin-bottom: 40px;
                    animation: lp-float 7s ease-in-out infinite;
                }
                .lp-emblem-ring {
                    position: absolute;
                    inset: -20px;
                    border-radius: 50%;
                    border: 1px solid var(--lp-brand-22);
                    animation: lp-pulse 3.2s ease-out infinite;
                }
                .lp-emblem-ring-2 {
                    inset: -20px;
                    animation-delay: 1.6s;
                }
                .lp-emblem-circle {
                    width: 192px;
                    height: 192px;
                    border-radius: 50%;
                    background: radial-gradient(circle at 38% 32%, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 60%);
                    border: 1.5px solid rgba(255,255,255,0.13);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    overflow: hidden;
                    animation: lp-glow-border 4s ease-in-out infinite;
                    box-shadow:
                        0 0 0 1px rgba(255,255,255,0.04),
                        0 24px 64px rgba(0,0,0,0.7),
                        inset 0 1px 0 rgba(255,255,255,0.08);
                }
                .lp-emblem-circle img {
                    width: 138px;
                    height: 138px;
                    object-fit: contain;
                    filter: drop-shadow(0 6px 18px rgba(0,0,0,0.5)) drop-shadow(0 0 30px rgba(255,255,255,0.08));
                    position: relative;
                    z-index: 1;
                }
                .lp-emblem-inner-glow {
                    position: absolute;
                    inset: 0;
                    border-radius: 50%;
                    background: radial-gradient(circle at 50% 40%, var(--lp-brand-22) 0%, transparent 65%);
                    pointer-events: none;
                }

                /* ── Left text ──────────────────────── */
                .lp-univ-label {
                    font-size: 30px;
                    font-weight: 800;
                    letter-spacing: 5px;
                    color: var(--lp-on-accent);
                    text-transform: uppercase;
                    margin-bottom: 4px;
                    text-align: center;
                    z-index: 2;
                    position: relative;
                    text-shadow: 0 2px 24px rgba(255,255,255,0.12);
                    animation: lp-float 4s ease-in-out infinite;
                }
                .lp-univ-name {
                    font-size: 16px;
                    font-weight: 500;
                    letter-spacing: 4px;
                    color: rgba(255,255,255,0.55);
                    text-transform: uppercase;
                    line-height: 1;
                    margin-bottom: 22px;
                    text-align: center;
                    z-index: 2;
                    position: relative;
                    animation: lp-float 4s ease-in-out infinite 0.2s;
                }
                .lp-divider {
                    width: 36px;
                    height: 1.5px;
                    background: linear-gradient(90deg, transparent, var(--lp-brand), transparent);
                    margin: 0 auto 22px;
                    border-radius: 2px;
                    animation: lp-shimmer-line 3s ease-in-out infinite;
                    z-index: 2;
                    position: relative;
                }
                .lp-tagline {
                    font-size: 13px;
                    color: rgba(255,255,255,0.5);
                    line-height: 1.8;
                    letter-spacing: 0.3px;
                    text-align: center;
                    z-index: 2;
                    position: relative;
                }
                .lp-tagline-sub {
                    display: block;
                    font-size: 10px;
                    color: rgba(255,255,255,0.28);
                    letter-spacing: 2.5px;
                    text-transform: uppercase;
                    margin-top: 8px;
                }
                .lp-bottom-bar {
                    position: absolute;
                    bottom: 0; left: 0; right: 0;
                    height: 2px;
                    background: linear-gradient(90deg, transparent 0%, var(--lp-brand) 50%, transparent 100%);
                }

                /* ── Right panel ────────────────────── */
                .lp-right {
                    flex: 1;
                    min-height: 100vh;
                    background: var(--lp-bg);
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 48px;
                    position: relative;
                }
                .lp-right-glow {
                    position: absolute;
                    width: 500px;
                    height: 500px;
                    border-radius: 50%;
                    top: -80px;
                    right: -80px;
                    background: radial-gradient(circle, var(--lp-brand-15) 0%, transparent 65%);
                    pointer-events: none;
                }
                .lp-right-glow-2 {
                    width: 350px;
                    height: 350px;
                    top: auto;
                    right: auto;
                    bottom: -60px;
                    left: -40px;
                    background: radial-gradient(circle, rgba(80,100,180,0.04) 0%, transparent 65%);
                }

                /* ── Logo area ──────────────────────── */
                .lp-logo-wrap {
                    margin-bottom: 20px;
                    text-align: center;
                    position: relative;
                    z-index: 2;
                    animation: lp-float 6s ease-in-out infinite;
                }
                .lp-logo-wrap img {
                    width: 220px;
                    height: 220px;
                    object-fit: contain;
                    filter: drop-shadow(0 4px 20px rgba(99,179,237,0.28));
                    transition: filter 0.3s ease, transform 0.3s ease;
                }
                .lp-logo-wrap:hover img {
                    filter: drop-shadow(0 6px 30px rgba(99,179,237,0.42)) drop-shadow(0 0 12px var(--lp-brand-30));
                    transform: scale(1.02);
                }

                /* ── Heading ────────────────────────── */
                .lp-heading-wrap {
                    text-align: center;
                    margin-bottom: 36px;
                    position: relative;
                    z-index: 2;
                }
                .lp-heading {
                    color: var(--lp-text);
                    font-size: 26px;
                    font-weight: 700;
                    margin: 0 0 10px;
                    letter-spacing: -0.4px;
                    position: relative;
                    display: inline-block;
                }
                .lp-heading::after {
                    content: '';
                    position: absolute;
                    bottom: -8px;
                    left: 0;
                    right: 0;
                    height: 2px;
                    background: linear-gradient(90deg, transparent, var(--lp-brand), transparent);
                    border-radius: 2px;
                }
                .lp-subheading {
                    color: var(--lp-text-muted);
                    font-size: 14px;
                    font-weight: 400;
                    margin: 0;
                    letter-spacing: 0.1px;
                }

                /* ── Login card ─────────────────────── */
                .lp-card {
                    width: 400px;
                    background: var(--lp-surface);
                    border: 1px solid var(--lp-border);
                    border-radius: 18px;
                    padding: 28px 30px 24px;
                    backdrop-filter: blur(24px);
                    -webkit-backdrop-filter: blur(24px);
                    box-shadow: var(--lp-shadow-lg);
                    position: relative;
                    z-index: 2;
                }
                /* top edge highlight */
                .lp-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 10%; right: 10%;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
                    border-radius: 100%;
                }

                /* ── Sign-in button ─────────────────── */
                .lp-btn {
                    height: 48px !important;
                    border-radius: 10px !important;
                    font-size: 14.5px !important;
                    font-weight: 600 !important;
                    letter-spacing: 0.2px !important;
                    border: none !important;
                    background: var(--lp-brand) !important;
                    color: var(--lp-on-accent) !important;
                    box-shadow: 0 4px 24px var(--lp-brand-30), 0 1px 0 rgba(255,255,255,0.08) inset !important;
                    transition: all 0.25s ease !important;
                    position: relative !important;
                    overflow: hidden !important;
                }
                .lp-btn::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0; right: 0;
                    height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
                }
                .lp-btn:not(:disabled):hover {
                    filter: brightness(1.1);
                    box-shadow: 0 6px 32px var(--lp-brand-30), 0 1px 0 rgba(255,255,255,0.1) inset !important;
                    transform: translateY(-1px) !important;
                }
                .lp-btn:not(:disabled):active {
                    transform: translateY(0) !important;
                    box-shadow: 0 3px 16px var(--lp-brand-30) !important;
                }
                .lp-btn:disabled {
                    opacity: 0.7 !important;
                }
            `}</style>

            <div className="lp-root" style={cssVars}>

                {/* ════════════════════════════════════
                    LEFT PANEL — SUU Identity
                ════════════════════════════════════ */}
                <div className="lp-left">
                    <div className="lp-left-noise" />
                    <div className="lp-left-radials" />
                    <div className="lp-left-grid" />

                    {/* Floating emblem */}
                    <div className="lp-emblem-wrap">
                        <div className="lp-emblem-ring" />
                        <div className="lp-emblem-ring lp-emblem-ring-2" />
                        <div className="lp-emblem-circle">
                            <img src="/SUU_Emblem.png" alt="Southern Utah University Emblem" />
                            <div className="lp-emblem-inner-glow" />
                        </div>
                    </div>

                    {/* Text */}
                    <div className="lp-univ-label">Southern Utah</div>
                    <div className="lp-univ-name">University</div>
                    <div className="lp-divider" />
                    <div className="lp-tagline">
                        AI &amp; Machine Learning Lab
                        <span className="lp-tagline-sub">Research · Innovation · Excellence</span>
                    </div>

                    <div className="lp-bottom-bar" />
                </div>

                {/* ════════════════════════════════════
                    RIGHT PANEL — Login Form
                ════════════════════════════════════ */}
                <div className="lp-right">
                    <div className="lp-right-glow" />
                    <div className="lp-right-glow lp-right-glow-2" />

                    {/* AI Lab logo */}
                    <div className="lp-logo-wrap">
                        <img src="/AI-ML_Logo.png" alt="AI/ML Lab Portal" />
                    </div>

                    {/* Heading */}
                    <div className="lp-heading-wrap">
                        <h1 className="lp-heading">Welcome back</h1>
                        <p className="lp-subheading">Sign in to your AI/ML Lab Portal account</p>
                    </div>

                    {/* Card */}
                    <div className="lp-card">
                        {error && <Alert type="error" message={error} showIcon />}

                        <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
                            <Form.Item
                                name="username"
                                label="Username"
                                rules={[{ required: true, message: 'Please enter your username' }]}
                                style={{ marginBottom: 16 }}
                            >
                                <Input
                                    prefix={<UserOutlined />}
                                    placeholder="Enter your username"
                                    autoComplete="username"
                                    autoFocus
                                    size="large"
                                />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={
                                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                        <span>Password</span>
                                        <Link
                                            to="/forgot-password"
                                            style={{ color: t.brand, fontSize: 12, fontWeight: 500, letterSpacing: '0.1px' }}
                                        >
                                            Forgot password?
                                        </Link>
                                    </div>
                                }
                                rules={[{ required: true, message: 'Please enter your password' }]}
                                style={{ marginBottom: 26 }}
                            >
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    placeholder="Enter your password"
                                    autoComplete="current-password"
                                    size="large"
                                />
                            </Form.Item>

                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={loading}
                                    block
                                    className="lp-btn"
                                >
                                    {loading ? 'Signing in…' : 'Sign in'}
                                </Button>
                            </Form.Item>
                        </Form>
                    </div>

                    {/* Footer note */}
                    <p style={{
                        marginTop: 28,
                        color: t.textFaint,
                        fontSize: 13,
                        textAlign: 'center',
                        position: 'relative',
                        zIndex: 2,
                    }}>
                        New to the lab?{' '}
                        <span style={{ color: t.brand, fontWeight: 500, cursor: 'default' }}>
                            Contact your administrator
                        </span>{' '}
                        to get access.
                    </p>
                </div>
            </div>
        </>
    );
}
