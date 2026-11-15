import { useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Typography, Spin } from 'antd';
import {
    DashboardOutlined, AppstoreOutlined,
    CheckSquareOutlined, ShoppingCartOutlined, FileTextOutlined,
    TeamOutlined, ArrowRightOutlined, RocketOutlined,
    ClockCircleOutlined, WarningOutlined, ProjectOutlined, SafetyOutlined,
    BookOutlined, FolderOutlined, BugOutlined, CalendarOutlined, ExperimentOutlined,
    DollarCircleOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions, positionTitle } from '../../hooks/usePermissions';
import type { RolePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import type { SemanticTokens } from '../../theme/tokens';

const { Text } = Typography;

/* ── Category definitions ─────────────────────────────────────── */
interface Category {
    key:    string;
    label:  string;
    accent: string;
    icon:   ReactNode;
    desc:   string;
}

/**
 * Category and app accent colors are pulled from the theme's categorical
 * chart palette (indexed, not semantic) rather than hardcoded hex. The old
 * version hand-picked hex per tile — good in dark, but several (bright
 * green/yellow) drop under 3:1 contrast against a white card in light mode.
 * Built as functions of the active tokens so both themes stay legible.
 */
function getCategories(t: SemanticTokens): Category[] {
    const c = t.chart;
    return [
        { key: 'work',      label: 'Work',      accent: c[0], icon: <CheckSquareOutlined />, desc: 'Tasks, projects, schedules & reports'     },
        { key: 'assets',    label: 'Assets',    accent: c[5], icon: <AppstoreOutlined />,     desc: 'Inventory management & purchase requests' },
        { key: 'knowledge', label: 'Knowledge', accent: c[8], icon: <BookOutlined />,          desc: 'Manuals, papers & project files'          },
        { key: 'admin',     label: 'Administration', accent: c[3], icon: <SafetyOutlined />,   desc: 'Accounts, access & system settings'       },
        { key: 'support',   label: 'Support',   accent: c[9], icon: <BugOutlined />,           desc: 'Bug reports & access requests'            },
    ];
}

/* ── App definitions ──────────────────────────────────────────── */
interface AppConfig {
    key:      string;
    path:     string;
    label:    string;
    short:    string;
    icon:     ReactNode;
    accent:   string;
    category: string;
    /** When set, the tile only shows for users granted this permission. */
    permission?: keyof RolePermissions;
}
function getApps(t: SemanticTokens): AppConfig[] {
    const c = t.chart;
    return [
        { key: 'dashboard', path: '/dashboard', label: 'Dashboard',     short: 'Analytics & real-time overview',     icon: <DashboardOutlined />,    accent: c[0], category: 'work'      },
        { key: 'tasks',     path: '/tasks',     label: 'Tasks',         short: 'Kanban board & deadlines',           icon: <CheckSquareOutlined />,  accent: c[1], category: 'work'      },
        // Open to every authenticated member — backend scopes visibility by project membership.
        { key: 'projects',  path: '/projects',  label: 'Projects',      short: 'Browse & manage projects',           icon: <ProjectOutlined />,      accent: c[7], category: 'work'      },
        { key: 'schedule',  path: '/schedule',  label: 'Schedule',      short: 'Shifts & weekly calendar',           icon: <CalendarOutlined />,     accent: c[4], category: 'work'      },
        { key: 'reports',   path: '/reports',   label: 'Reports',       short: 'Weekly reports & PDF exports',       icon: <FileTextOutlined />,     accent: c[6], category: 'work'      },
        { key: 'inventory', path: '/inventory', label: 'Inventory',     short: 'Equipment & supply tracking',        icon: <AppstoreOutlined />,     accent: c[5], category: 'assets'    },
        { key: 'wishlists', path: '/wishlists', label: 'Wishlists',     short: 'Purchase & equipment requests',      icon: <ShoppingCartOutlined />, accent: c[2], category: 'assets'    },
        { key: 'manuals',   path: '/manuals',   label: 'Manuals',       short: 'PDF manuals & documentation',        icon: <BookOutlined />,         accent: c[6], category: 'knowledge' },
        { key: 'papers',    path: '/papers',    label: 'Papers',        short: 'Research papers & reading lists',    icon: <ExperimentOutlined />,   accent: c[4], category: 'knowledge' },
        { key: 'files',     path: '/files',     label: 'Project Files', short: 'Documents, CAD & deliverables',      icon: <FolderOutlined />,       accent: c[8], category: 'knowledge' },
        { key: 'video-tutorials', path: '/video-tutorials', label: 'Video Tutorials', short: 'Training videos & PDF playlists', icon: <VideoCameraOutlined />, accent: c[9], category: 'knowledge' },
        { key: 'users',     path: '/users',     label: 'Users',         short: 'Manage accounts & module access',    icon: <TeamOutlined />,         accent: c[9], category: 'admin',     permission: 'manage_users' },
        { key: 'budget',    path: '/budget',    label: 'Budget',        short: 'Funding, accounts & labor costs',    icon: <DollarCircleOutlined />, accent: c[1], category: 'admin',     permission: 'manage_budget' },
        { key: 'attendance', path: '/attendance', label: 'Attendance',   short: 'Clock-in/out & attendance reports',  icon: <ClockCircleOutlined />,  accent: c[2], category: 'admin',     permission: 'manage_attendance' },
        { key: 'tickets',   path: '/tickets',   label: 'Support',       short: 'Bug reports & access requests',      icon: <BugOutlined />,          accent: c[9], category: 'support'   },
    ];
}

/* ── Stat card ────────────────────────────────────────────────── */
function StatCard({ icon, label, value, color, t }: { icon: ReactNode; label: string; value: number | string; color: string; t: SemanticTokens }) {
    return (
        <div style={{
            flex: 1, minWidth: 130,
            background:     t.surface,
            border:         `1px solid ${t.border}`,
            borderTop:      `2px solid ${color}`,
            borderRadius:    12,
            padding:        '18px 20px',
            backdropFilter: 'blur(12px)',
            boxShadow:      `${t.shadowMd}, 0 0 16px ${alpha(color, 0.05)}`,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                    {label}
                </Text>
                <div style={{
                    width: 28, height: 28, borderRadius: 7, fontSize: 13,
                    background: alpha(color, 0.10), border: `1px solid ${alpha(color, 0.19)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color,
                }}>
                    {icon}
                </div>
            </div>
            <Text style={{ color: t.text, fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{value}</Text>
        </div>
    );
}

/* ── App tile ─────────────────────────────────────────────────── */
function AppTile({ app, onClick, t }: { app: AppConfig; onClick: () => void; t: SemanticTokens }) {
    const [hov, setHov] = useState(false);
    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHov(true)}
            onMouseLeave={() => setHov(false)}
            style={{
                background:    hov ? alpha(app.accent, 0.03) : t.surface,
                border:       `1px solid ${hov ? alpha(app.accent, 0.33) : t.border}`,
                borderRadius:  12,
                cursor:       'pointer',
                padding:      '22px 14px 16px',
                height:       '100%',
                minHeight:     164,
                display:      'flex',
                flexDirection: 'column',
                alignItems:   'center',
                gap:           10,
                textAlign:    'center',
                boxShadow:     hov ? `${t.shadowLg}, 0 0 0 1px ${alpha(app.accent, 0.13)}` : t.shadowSm,
                transform:     hov ? 'translateY(-3px)' : 'translateY(0)',
                transition:   'all 0.15s ease',
            }}
        >
            {/* Icon */}
            <div style={{
                width:       52,
                height:      52,
                borderRadius: 14,
                fontSize:     22,
                flexShrink:   0,
                background:  alpha(app.accent, 0.10),
                border:      `1px solid ${alpha(app.accent, hov ? 0.33 : 0.16)}`,
                display:     'flex',
                alignItems:  'center',
                justifyContent: 'center',
                color:        app.accent,
                boxShadow:    hov ? `0 0 20px ${alpha(app.accent, 0.21)}` : 'none',
                transition:  'all 0.15s ease',
            }}>
                {app.icon}
            </div>

            {/* Label */}
            <Text style={{ fontWeight: 700, color: t.text, fontSize: 14, lineHeight: 1.2 }}>
                {app.label}
            </Text>

            {/* Short description */}
            <Text style={{ color: t.textMuted, fontSize: 11.5, lineHeight: 1.45, flex: 1 }}>
                {app.short}
            </Text>

            {/* "Open" footer row */}
            <div style={{
                width:         '100%',
                paddingTop:    8,
                borderTop:    `1px solid ${t.borderSubtle}`,
                display:      'flex',
                alignItems:   'center',
                justifyContent: 'center',
                gap:            4,
                color:          hov ? app.accent : t.textMuted,
                fontSize:       11,
                fontWeight:     600,
                transition:    'color 0.15s',
            }}>
                Open
                <ArrowRightOutlined style={{
                    fontSize:   10,
                    transform:  hov ? 'translateX(3px)' : 'translateX(0)',
                    transition: 'transform 0.15s',
                }} />
            </div>
        </div>
    );
}

/* ── Category swimlane ────────────────────────────────────────── */
function CategorySection({ cat, apps, onNav, t }: {
    cat:   Category;
    apps:  AppConfig[];
    onNav: (p: string) => void;
    t:     SemanticTokens;
}) {
    if (!apps.length) return null;
    return (
        <div>
            {/* Header strip */}
            <div style={{
                display:       'flex',
                alignItems:    'center',
                gap:            12,
                padding:       '11px 18px',
                background:    `linear-gradient(90deg, ${alpha(cat.accent, 0.07)} 0%, transparent 70%)`,
                borderLeft:    `3px solid ${cat.accent}`,
                borderRadius:  '0 10px 10px 0',
                marginBottom:   14,
            }}>
                <div style={{
                    width:          30,
                    height:         30,
                    borderRadius:    8,
                    fontSize:        14,
                    flexShrink:      0,
                    background:     alpha(cat.accent, 0.13),
                    border:         `1px solid ${alpha(cat.accent, 0.25)}`,
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                    color:           cat.accent,
                }}>
                    {cat.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: t.text, fontWeight: 700, fontSize: 14, display: 'block', lineHeight: 1.2 }}>
                        {cat.label}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 11.5, lineHeight: 1.2 }}>
                        {cat.desc}
                    </Text>
                </div>
                <span style={{
                    flexShrink:   0,
                    background:   alpha(cat.accent, 0.08),
                    border:       `1px solid ${alpha(cat.accent, 0.22)}`,
                    color:         cat.accent,
                    borderRadius:  20,
                    padding:      '2px 10px',
                    fontSize:      11,
                    fontWeight:    600,
                }}>
                    {apps.length} app{apps.length !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Tile grid */}
            <Row gutter={[12, 12]}>
                {apps.map(app => (
                    <Col key={app.key} xs={12} sm={8} md={6} lg={4}>
                        <AppTile app={app} onClick={() => onNav(app.path)} t={t} />
                    </Col>
                ))}
            </Row>
        </div>
    );
}

/* ── Main page ────────────────────────────────────────────────── */
export default function HomePage() {
    const { t } = useTheme();
    const navigate = useNavigate();
    const [zoomedPhoto, setZoomedPhoto] = useState(false);
    // Tracks whether the avatar image itself failed to load (404, deleted file,
    // etc.) — falls back to the initials tile instead of a broken-image icon.
    const [avatarBroken, setAvatarBroken] = useState(false);

    // Close zoom on Escape
    const handleEscape = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') setZoomedPhoto(false); }, []);
    useEffect(() => {
        if (!zoomedPhoto) return;
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [zoomedPhoto, handleEscape]);
    const user     = useAuthStore(s => s.user);
    const { hasPermission } = usePermissions();

    // Reset the broken flag whenever the URL changes so a newly-uploaded
    // photo always gets a fresh attempt rather than staying stuck broken.
    useEffect(() => { setAvatarBroken(false); }, [user?.avatarUrl]);

    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [employeeId, setEmployeeId] = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            api.get('/dashboard/summary'),
            api.get('/users/me'),
        ])
            .then(([summaryRes, meRes]) => {
                setSummary(summaryRes.data);
                setEmployeeId(meRes.data.employeeId ?? null);
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    const categories = getCategories(t);
    const apps = getApps(t);
    const visibleApps = apps.filter(a => !a.permission || hasPermission(a.permission));

    const now       = new Date();
    const hour      = now.getHours();
    const greeting  = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const emoji     = hour < 12 ? '🌅' : hour < 18 ? '☀️' : '🌙';
    const firstName = user?.fullName?.split(' ')[0] ?? user?.username ?? 'there';

    return (
        <div className="page-enter" style={{ maxWidth: 1200, margin: '0 auto' }}>

            {/* ── Hero banner ────────────────────────────────── */}
            <div style={{
                background:   t.mode === 'dark'
                    ? 'linear-gradient(140deg, t.bg 0%, t.bg 55%, t.bg 100%)'
                    : `linear-gradient(140deg, ${t.surface} 0%, ${t.surfaceRaised} 100%)`,
                border:       `1px solid ${t.border}`,
                borderRadius:  16,
                padding:      '32px 36px 30px',
                marginBottom:  20,
                position:     'relative',
                overflow:     'hidden',
            }}>
                {/* Atmospheric glow orbs */}
                <div style={{ position: 'absolute', top: -80,  right: -80,  width: 320, height: 320, borderRadius: '50%', background: `radial-gradient(circle, ${t.brandGlow} 0%, transparent 65%)`, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: -60, right: 180, width: 220, height: 220, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(t.accent, 0.045)} 0%, transparent 70%)`, pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: 30, right: '36%',  width: 140,  height: 140, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(t.success, 0.04)} 0%, transparent 70%)`, pointerEvents: 'none' }} />

                <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 24 }}>
                    {/* Profile picture — click to zoom (same behaviour as popup) */}
                    {zoomedPhoto && user?.avatarUrl && !avatarBroken && createPortal(
                        <div
                            onClick={() => setZoomedPhoto(false)}
                            style={{
                                position: 'fixed', inset: 0, zIndex: 10001,
                                background: t.overlay,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'zoom-out',
                            }}
                        >
                            <img
                                src={user.avatarUrl}
                                alt="Profile"
                                onClick={e => e.stopPropagation()}
                                style={{
                                    maxWidth: 'min(90vw, 480px)',
                                    maxHeight: '85vh',
                                    borderRadius: 16,
                                    objectFit: 'contain',
                                    boxShadow: t.shadowLg,
                                }}
                            />
                        </div>,
                        document.body,
                    )}
                    {user?.avatarUrl && !avatarBroken ? (
                        <img
                            src={user.avatarUrl}
                            alt={firstName}
                            onClick={() => setZoomedPhoto(true)}
                            onError={() => setAvatarBroken(true)}
                            style={{
                                width: 120, height: 120, borderRadius: '50%',
                                objectFit: 'cover', flexShrink: 0, display: 'block',
                                border: `3px solid ${t.accentBorder}`,
                                boxShadow: `0 0 0 4px ${t.accentBg}, ${t.shadowMd}`,
                                imageRendering: 'auto',
                                cursor: 'zoom-in',
                                transition: 'box-shadow 0.2s, transform 0.2s',
                            }}
                            onMouseEnter={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1.05)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLImageElement).style.transform = 'scale(1)'; }}
                        />
                    ) : (
                        <div style={{
                            width: 120, height: 120, borderRadius: '50%',
                            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: `linear-gradient(135deg, ${alpha(t.accent, 0.22)}, ${alpha(t.purple, 0.22)})`,
                            border: `3px solid ${t.accentBorder}`,
                            boxShadow: `0 0 0 4px ${t.accentBg}, ${t.shadowMd}`,
                            color: t.accent, fontSize: 44, fontWeight: 700,
                        }}>
                            {firstName.charAt(0).toUpperCase()}
                        </div>
                    )}

                    {/* Text block */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 500 }}>
                            AI/ML Lab Portal
                        </Text>
                        <Text style={{ color: t.text, fontSize: 32, fontWeight: 800, lineHeight: 1.1, display: 'block' }}>
                            {greeting}, {firstName} {emoji}
                        </Text>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
                            <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                {now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </Text>
                            <span style={{ color: t.border }}>·</span>
                            <span style={{
                                background:   t.accentBg,
                                border:       `1px solid ${t.accentBorder}`,
                                color:         t.accent,
                                borderRadius:  20,
                                padding:      '3px 14px',
                                fontSize:      12,
                                fontWeight:    600,
                                display:      'inline-flex',
                                alignItems:   'center',
                                gap:           6,
                            }}>
                                <RocketOutlined style={{ fontSize: 11 }} />
                                {user?.username} · {positionTitle(user)}
                            </span>
                            {employeeId && (
                                <span style={{
                                    background:   t.successBg,
                                    border:       `1px solid ${t.successBorder}`,
                                    color:         t.success,
                                    borderRadius:  20,
                                    padding:      '3px 14px',
                                    fontSize:      12,
                                    fontWeight:    600,
                                    display:      'inline-flex',
                                    alignItems:   'center',
                                    gap:           6,
                                    fontFamily:   'monospace',
                                }}>
                                    ID: {employeeId}
                                </span>
                            )}
                        </div>
                    </div>
                    {/* Lab logo */}
                    <img
                        src="/AI-ML_Logo.png"
                        alt="AI/ML Lab"
                        style={{ marginLeft: 'auto', height: 160, width: 'auto', objectFit: 'contain', opacity: 0.95, flexShrink: 0, filter: `drop-shadow(0 2px 16px ${alpha(t.accent, 0.18)})` }}
                    />
                </div>
            </div>

            {/* ── Quick stats ────────────────────────────────── */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '16px 0 24px' }}>
                    <Spin size="small" />
                </div>
            ) : summary && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 36, flexWrap: 'wrap' }}>
                    <StatCard t={t} icon={<CheckSquareOutlined />} label="Open Tasks"       value={summary.openTasks        ?? 0} color={t.accent}  />
                    <StatCard t={t} icon={<WarningOutlined />}     label="Low Stock"         value={summary.lowStock         ?? 0} color={t.warning} />
                    <StatCard t={t} icon={<ProjectOutlined />}     label="Active Projects"   value={summary.activeProjects   ?? 0} color={t.success} />
                    <StatCard t={t} icon={<ClockCircleOutlined />} label="Reports Submitted" value={summary.submittedReports ?? 0} color={t.purple}  />
                </div>
            )}

            {/* ── Category swimlanes ─────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
                {categories.map(cat => (
                    <CategorySection
                        key={cat.key}
                        cat={cat}
                        apps={visibleApps.filter(a => a.category === cat.key)}
                        onNav={navigate}
                        t={t}
                    />
                ))}
            </div>

            {/* ── Footer ─────────────────────────────────────── */}
            <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>AI/ML Lab Portal · Built with NestJS + React + Ant Design</Text>
                <div style={{ display: 'flex', gap: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>v1.0.0</Text>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: t.success, marginRight: 5 }} />
                        All systems operational
                    </Text>
                </div>
            </div>
        </div>
    );
}
