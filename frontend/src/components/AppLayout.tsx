import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Badge, Typography, Divider, Button, Popover, Tabs, Switch } from 'antd';
import {
    HomeOutlined, DashboardOutlined, CalendarOutlined, AppstoreOutlined,
    CheckSquareOutlined, ShoppingCartOutlined, FileTextOutlined, TeamOutlined,
    LogoutOutlined, BellOutlined, UserOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
    SettingOutlined, ProjectOutlined, BookOutlined, FolderOutlined,
    BugOutlined, CheckCircleOutlined, RedoOutlined, CloseCircleOutlined, VideoCameraOutlined,
    CheckOutlined, CloseOutlined, DollarCircleOutlined, SunOutlined, MoonOutlined,
    DeleteOutlined, EyeOutlined, EyeInvisibleOutlined, ClockCircleOutlined,
    ApiOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { usePermissions, UNIFIED_ROLE, positionTitle } from '../hooks/usePermissions';
import { useSocket } from '../hooks/useSocket';
import WorkTimer from './WorkTimer';
import { useNotify } from '../hooks/useNotify';
import { useTheme } from '../theme/useTheme';
import { alpha } from '../theme/tokens';

import api from '../api/axios';
import { getNotifCategory, type NotifCategory } from '../utils/notificationUtils';
import { deepLink } from '../hooks/useDeepLink';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

// ── Nav groups ───────────────────────────────────────────────
const itemStyle = { borderRadius: 6, marginBottom: 2 };

const homeItem = { key: '/home', icon: <HomeOutlined />, label: 'Home', style: itemStyle };

const workItems = [
    { key: '/dashboard', icon: <DashboardOutlined />,     label: 'Dashboard', style: itemStyle },
    { key: '/tasks',     icon: <CheckSquareOutlined />,   label: 'Tasks',     style: itemStyle },
    { key: '/schedule',  icon: <CalendarOutlined />,      label: 'Schedule',  style: itemStyle },
    { key: '/reports',   icon: <FileTextOutlined />,      label: 'Reports',   style: itemStyle },
];

const projectItem = { key: '/projects', icon: <ProjectOutlined />, label: 'Projects', style: itemStyle };

const assetItems = [
    { key: '/inventory', icon: <AppstoreOutlined />,     label: 'Inventory', style: itemStyle },
    { key: '/wishlists', icon: <ShoppingCartOutlined />, label: 'Wishlists', style: itemStyle },
];

const knowledgeItems = [
    { key: '/manuals', icon: <BookOutlined />,   label: 'Manuals',       style: itemStyle },
    { key: '/files',   icon: <FolderOutlined />, label: 'Project Files', style: itemStyle },
    { key: '/papers',  icon: <FileTextOutlined />, label: 'Papers',      style: itemStyle },
    { key: '/video-tutorials', icon: <VideoCameraOutlined />, label: 'Video Tutorials', style: itemStyle },
];

const supportItem = { key: '/tickets', icon: <BugOutlined />, label: 'Support', style: itemStyle };

const adminItems = [
    { key: '/users',      icon: <TeamOutlined />,          label: 'Users',      style: itemStyle },
    { key: '/budget',     icon: <DollarCircleOutlined />,  label: 'Budget',     style: itemStyle },
    { key: '/attendance', icon: <ClockCircleOutlined />,   label: 'Attendance', style: itemStyle },
    // Hardware, not an attendance view. It was the seventh of nine tabs
    // inside Attendance, on a strip that scrolls rather than collapsing, so
    // the only place to register a reader was off the edge of the screen.
    { key: '/readers',    icon: <ApiOutlined />,            label: 'RFID Readers', style: itemStyle },
];

export default function AppLayout() {
    const { t, mode, toggle } = useTheme();
    const notify = useNotify();
    const [collapsed, setCollapsed] = useState(false);
    const [notifications, setNotifications] = useState<any[]>([]);
    const [unreadCount, setUnreadCount]     = useState(0);
    const [bellOpen, setBellOpen]           = useState(false);
    const [activeTab, setActiveTab]           = useState<NotifCategory | 'all'>('all');
    const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
    const setBellOpenRef = useRef<(v: boolean) => void>(setBellOpen);
    useEffect(() => { setBellOpenRef.current = setBellOpen; }, [setBellOpen]);

    // Real-time: receive new notification pushed from the server via WebSocket
    useSocket({
        'notification:new': (notif: any) => {
            setNotifications((prev) => {
                // Avoid duplicates if the 90s poll fires at the same time
                if (prev.some((n) => n.id === notif.id)) return prev;
                return [notif, ...prev];
            });
            setUnreadCount((prev) => prev + 1);
            // Toast popup so the user notices even without looking at the bell
            notify.notification.open({
                message: notif.title,
                description: notif.message ?? undefined,
                duration: 6,
                placement: 'topRight',
                icon: <BellOutlined style={{ color: t.warning }} />,
                style: { background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10 },
                onClick: () => {
                    setBellOpenRef.current(true);
                    notify.notification.destroy();
                },
            });
        },
    });
    const navigate   = useNavigate();
    const location   = useLocation();
    const { user, logout, setUser } = useAuthStore();

    // Sync account flags and modular permissions from the server. Runs on
    // mount and whenever the window regains focus, so a permission change
    // made by a user administrator applies without forcing a re-login.
    const syncMe = useCallback(async () => {
        try {
            const { data: me } = await api.get('/users/me');
            const current = useAuthStore.getState().user;
            if (!current) return;
            const next = {
                ...current,
                role: me.role ?? current.role,
                permissions: me.permissions ?? current.permissions,
                isOnHold: me.isOnHold,
                onlineClockEnabled: me.onlineClockEnabled,
            };
            const permissionsChanged =
                JSON.stringify(next.permissions ?? {}) !== JSON.stringify(current.permissions ?? {});
            if (
                permissionsChanged ||
                next.role !== current.role ||
                next.isOnHold !== current.isOnHold ||
                next.onlineClockEnabled !== current.onlineClockEnabled
            ) {
                setUser(next);
            }
        } catch { /* silent — transient network failure */ }
    }, [setUser]);

    useEffect(() => {
        syncMe();
        const onFocus = () => { void syncMe(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [syncMe]);

    const fetchNotifications = useCallback(async () => {
        try {
            const res = await api.get('/notifications');
            const notifs: any[] = res.data;
            setNotifications(notifs);
            setUnreadCount(notifs.filter((n) => !n.isRead).length);
        } catch { /* silent */ }
    }, []);

    const markAllRead = async () => {
        try {
            await api.patch('/notifications/read-all');
            // Skip paper_read_request — they stay unread until explicitly accepted/declined
            setNotifications((prev) => prev.map((n) =>
                n.type === 'paper_read_request' ? n : { ...n, isRead: true }
            ));
            setUnreadCount(
                notifications.filter(n => n.type === 'paper_read_request' && !n.isRead).length
            );
        } catch { /* silent */ }
    };

    const handleBellOpen = (open: boolean) => {
        setBellOpen(open);
        if (open) {
            fetchNotifications();
            setActiveTab('all');
        }
    };

    const handleDeleteNotif = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.delete(`/notifications/${id}`);
            const target = notifications.find(n => n.id === id);
            setNotifications(prev => prev.filter(n => n.id !== id));
            if (target && !target.isRead) setUnreadCount(c => Math.max(0, c - 1));
        } catch { /* silent */ }
    };

    const handleToggleUnread = async (n: any, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            if (n.isRead) {
                await api.patch(`/notifications/${n.id}/unread`);
                setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
                setUnreadCount(c => c + 1);
            } else {
                await api.patch(`/notifications/${n.id}/read`);
                setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
                setUnreadCount(c => Math.max(0, c - 1));
            }
        } catch { /* silent */ }
    };

    const handleClearRead = async (e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            await api.delete('/notifications/read');
            setNotifications(prev => prev.filter(n => !n.isRead));
        } catch { /* silent */ }
    };

    const handleNotifClick = (n: any) => {
        setBellOpen(false);
        // Don't mark paper_read_request as read on click — requires explicit Accept/Decline
        if (!n.isRead && n.type !== 'paper_read_request') {
            api.patch(`/notifications/${n.id}/read`).catch(() => {});
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
            setUnreadCount(prev => Math.max(0, prev - 1));
        }
        switch (n.type) {
            case 'comment_mention':
                if (n.entityType === 'task')    { navigate(deepLink('/tasks', { taskId: n.entityId })); break; }
                if (n.entityType === 'ticket')  { navigate(deepLink('/tickets', { ticketId: n.entityId })); break; }
                if (n.entityType === 'project') { navigate(`/projects/${n.entityId ?? ''}`); break; }
                break;
            case 'task_assigned':
            case 'task_updated':
            case 'task_pending_review':
                navigate(deepLink('/tasks', { taskId: n.entityId })); break;
            case 'paper_read_request':
            case 'paper_read_accepted':
            case 'paper_read_rejected':
                navigate(deepLink('/papers', { paperId: n.entityId })); break;
            case 'report_approved':
            case 'report_needs_revision':
            case 'report_submitted':
            case 'report_resubmitted':
                navigate(deepLink('/reports', { reportId: n.entityId })); break;
            case 'file_approved':
            case 'file_rejected':
            case 'file_pending':
                navigate(deepLink('/files', { fileId: n.entityId })); break;
            case 'video_pending':
            case 'video_approved':
            case 'video_rejected':
                navigate('/video-tutorials', { state: { openMediaId: n.entityId } }); break;
            case 'ticket_submitted':
            case 'ticket_resolved':
                navigate(deepLink('/tickets', { ticketId: n.entityId })); break;
            default: break;
        }
    };

    const handlePaperReadRequest = async (notif: any, action: 'accept' | 'reject') => {
        try {
            await api.patch(`/papers/${notif.entityId}/read-request/${notif.id}/${action}`);
            // Optimistically mark handled in local state
            setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, isRead: true, _handled: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch {
            // Silently ignore; next poll will sync
        }
    };

    useEffect(() => {
        // Load notifications on mount and poll every 90s as a fallback
        fetchNotifications();
        pollRef.current = setInterval(fetchNotifications, 90_000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [fetchNotifications]);

    useEffect(() => {
        document.title = unreadCount > 0 ? `(${unreadCount}) Lab Management` : 'Lab Management';
    }, [unreadCount]);

    const handleLogout = async () => {
        try { await api.post('/auth/logout'); } catch { /* ignore */ }
        logout();
        navigate('/login');
    };

    const { hasPermission } = usePermissions();
    // The tag beside the avatar is the position an administrator assigned,
    // not a role — every account shares the same nominal role.
    const rc      = { color: UNIFIED_ROLE.color, label: positionTitle(user) };
    const initials = user?.fullName?.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? '?';

    const groupLabel = (text: string) =>
        collapsed ? null : (
            <span style={{ color: t.textFaint, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {text}
            </span>
        );

    // Each administration link is gated by its own actual permission, not
    // lumped under manage_users — a user granted e.g. manage_budget but not
    // manage_users should still see the Budget link.
    const adminChildren = [
        ...(hasPermission('manage_users') ? [adminItems[0]] : []),          // Users
        ...(hasPermission('manage_budget') ? [adminItems[1]] : []),         // Budget
        ...(hasPermission('manage_attendance') ? [adminItems[2]] : []),     // Attendance
        ...(hasPermission('manage_attendance') ? [adminItems[3]] : []),     // RFID Readers
    ];

    const menuItems: any[] = [
        homeItem,
        { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
        { type: 'group', label: groupLabel('Work'), children: [
            ...workItems,
            // All authenticated users can access Projects (backend filters by membership)
            projectItem,
        ]},
        { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
        { type: 'group', label: groupLabel('Assets'), children: assetItems },
        { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
        { type: 'group', label: groupLabel('Knowledge'), children: knowledgeItems },
        { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
        { type: 'group', label: groupLabel('Support'), children: [supportItem] },
        // Self-service Attendance link for users who don't already get it via
        // the Administration group below (i.e. lack manage_attendance) but can clock in.
        ...((!hasPermission('manage_attendance') && user?.onlineClockEnabled) ? [
            { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
            { type: 'group', label: groupLabel('Attendance'), children: [
                { key: '/attendance', icon: <ClockCircleOutlined />, label: 'Attendance', style: itemStyle },
            ]},
        ] : []),
        ...(adminChildren.length > 0 ? [
            { type: 'divider', style: { borderColor: t.borderSubtle, margin: '6px 8px' } },
            { type: 'group', label: groupLabel('Administration'), children: adminChildren },
        ] : []),
    ];

    const userMenuItems = [
        {
            key: 'info',
            label: (
                <div style={{ padding: '4px 0' }}>
                    <div style={{ color: t.text,  fontWeight: 600, fontSize: 13 }}>{user?.fullName}</div>
                    <div style={{ color: t.textMuted, fontSize: 11 }}>{user?.username}</div>
                </div>
            ),
            disabled: true,
        },
        { type: 'divider' as const },
        {
            key: 'role',
            label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: rc.color, display: 'inline-block' }} />
                    <span style={{ color: rc.color, fontSize: 12, fontWeight: 500 }}>{rc.label}</span>
                </span>
            ),
            disabled: true,
        },
        { type: 'divider' as const },
        {
            key: 'theme',
            label: (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: t.text }}>
                        {mode === 'dark' ? <MoonOutlined /> : <SunOutlined />}
                        {mode === 'dark' ? 'Dark mode' : 'Light mode'}
                    </span>
                    {/* Purely visual — the row's own onClick below drives the toggle.
                        A live onChange here would double-fire alongside it, since
                        AntD bubbles the click to the menu item regardless. */}
                    <Switch size="small" checked={mode === 'dark'} style={{ pointerEvents: 'none' }} />
                </div>
            ),
            onClick: () => toggle(),
        },
        { type: 'divider' as const },
        {
            key: 'profile',
            icon: <UserOutlined />,
            label: 'Your profile',
            onClick: () => navigate('/profile'),
        },
        {
            key: 'settings',
            icon: <SettingOutlined />,
            label: 'Settings',
            onClick: () => navigate('/settings'),
        },
        { type: 'divider' as const },
        {
            key: 'logout',
            icon: <LogoutOutlined />,
            label: 'Sign out',
            danger: true,
            onClick: handleLogout,
        },
    ];

    // breadcrumb label from path
    const allFlat = [homeItem, ...workItems, projectItem, ...assetItems, ...knowledgeItems, supportItem, ...adminItems];
    const currentNav = allFlat.find((n) => location.pathname.startsWith(n.key));
    const pageLabel  = currentNav?.label ?? '';

    return (
        <>
        <style>{`
            .al-sider .ant-menu-item-selected { box-shadow: inset 3px 0 0 ${t.brand} !important; }
            .al-sider .ant-menu-item-group-title span { color: ${t.textFaint} !important; font-size: 9.5px !important; letter-spacing: 0.08em !important; }
        `}</style>
        <Layout style={{ minHeight: '100vh', background: t.bg }}>

            {/* ── Sidebar ─────────────────────────────────────── */}
            <Sider
                collapsible
                collapsed={collapsed}
                onCollapse={setCollapsed}
                width={220}
                collapsedWidth={56}
                trigger={null}
                className="al-sider"
                style={{
                    background:    t.surface,
                    borderRight:   `1px solid ${t.border}`,
                    overflow:      'hidden',
                    position:      'fixed',
                    left:           0,
                    top:            0,
                    bottom:         0,
                    zIndex:         200,
                }}
            >
                {/* Inner flex column — required because Ant Design wraps children
                    in .ant-layout-sider-children, so flex on the Sider root doesn't apply */}
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

                {/* Logo / Brand */}
                <div
                    style={{
                        display:       'flex',
                        alignItems:    'center',
                        gap:            10,
                        padding:       collapsed ? '16px 10px' : '16px 16px',
                        borderBottom:  `1px solid ${t.border}`,
                        cursor:        'pointer',
                        minHeight:      57,
                        transition:    'padding 0.2s',
                    }}
                    onClick={() => navigate('/home')}
                >
                    <div style={{ position: 'relative', flexShrink: 0, width: 32, height: 32 }}>
                        <img
                            src="/AI-ML_Logo.png"
                            alt="AI/ML Lab Portal"
                            style={{ width: 32, height: 32, objectFit: 'contain', display: 'block', position: 'relative', zIndex: 1 }}
                        />
                        <div style={{ position: 'absolute', inset: -7, borderRadius: '50%', background: `radial-gradient(circle, ${t.brandGlow} 0%, transparent 70%)`, pointerEvents: 'none' }} />
                    </div>
                    {!collapsed && (
                        <div>
                            <div style={{ color: t.text, fontWeight: 700, fontSize: 14, lineHeight: 1.2 }}>
                                AI/ML Lab Portal
                            </div>
                            <div style={{ color: t.textMuted, fontSize: 11 }}>Internal Management</div>
                        </div>
                    )}
                </div>

                {/* Nav menu */}
                <Menu
                    mode="inline"
                    theme={mode}
                    inlineCollapsed={collapsed}
                    selectedKeys={[location.pathname]}
                    onClick={({ key }) => navigate(key)}
                    style={{
                        background:  'transparent',
                        border:      'none',
                        padding:     '8px 4px',
                        flex:         1,
                        overflowY:   'auto',
                        overflowX:   'hidden',
                    }}
                    items={menuItems}
                />

                {/* Bottom section: user mini + collapse toggle */}
                <div style={{ borderTop: `1px solid ${t.border}`, padding: '8px 0' }}>
                    {/* Collapse toggle */}
                    <div
                        style={{
                            display:     'flex',
                            alignItems:  'center',
                            gap:          8,
                            padding:     collapsed ? '8px 14px' : '8px 16px',
                            cursor:      'pointer',
                            color:        t.textMuted,
                            fontSize:     12,
                            borderRadius: 6,
                            margin:      '0 4px',
                            transition:  'background 0.15s',
                        }}
                        onClick={() => setCollapsed(!collapsed)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = t.hoverBg)}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                        {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                        {!collapsed && <span>Collapse sidebar</span>}
                    </div>
                </div>
                </div>
            </Sider>

            {/* ── Main area ───────────────────────────────────── */}
            <Layout style={{ marginLeft: collapsed ? 56 : 220, background: t.bg, transition: 'margin-left 0.2s' }}>

                {/* Top bar */}
                <Header
                    style={{
                    background:           alpha(t.bg, 0.82),
                    backdropFilter:       'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    borderBottom:         `1px solid ${t.borderSubtle}`,
                    padding:              '0 20px',
                    height:                57,
                    display:              'flex',
                    alignItems:           'center',
                    justifyContent:       'space-between',
                    position:             'sticky',
                    top:                   0,
                    zIndex:                100,
                    }}
                >
                    {/* Breadcrumb */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <img src="/AI-ML_Logo.png" alt="lab" style={{ width: 18, height: 18, objectFit: 'contain', opacity: 0.7 }} />
                        <Text
                            style={{ color: t.textMuted, fontSize: 13, cursor: 'pointer' }}
                            onClick={() => navigate('/home')}
                        >AI/ML Lab Portal</Text>
                        {pageLabel && (
                            <>
                                <Text style={{ color: t.border, fontSize: 13 }}>/</Text>
                                <Text style={{ color: t.text, fontSize: 13, fontWeight: 600 }}>
                                    {pageLabel}
                                </Text>
                            </>
                        )}

                        {/* Live working-time timer, beside the logo. It reads
                            the open attendance session and counts up from the
                            server's clock-in instant — see WorkTimer. */}
                        <div style={{ marginLeft: 6 }}>
                            <WorkTimer />
                        </div>
                    </div>

                    {/* Right controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                        {/* Quick theme toggle */}
                        <Button
                            type="text"
                            size="small"
                            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                            title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                            onClick={toggle}
                            style={{ color: t.textMuted, borderRadius: 6 }}
                        />

                        {/* Notification bell — live Popover */}
                    <style>{`
                        @keyframes bell-ring {
                            0%,55%,100% { transform: rotate(0deg); }
                            5%  { transform: rotate(-18deg); }
                            15% { transform: rotate(18deg); }
                            25% { transform: rotate(-12deg); }
                            35% { transform: rotate(12deg); }
                            45% { transform: rotate(-6deg); }
                        }
                        .bell-ringing { animation: bell-ring 2.8s ease infinite; transform-origin: top center; }
                    `}</style>
                        <Popover
                            open={bellOpen}
                            onOpenChange={handleBellOpen}
                            trigger="click"
                            placement="bottomRight"
                            arrow={false}
                            styles={{ root: { padding: 0, background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, width: 340, maxWidth: '90vw' } }}
                            overlayStyle={{ zIndex: 300 }}
                            content={
                                <div>
                                    {/* Header */}
                                    <div style={{ padding: '12px 16px', borderBottom: `1px solid ${t.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>Notifications</Text>
                                        <div style={{ display: 'flex', gap: 10 }}>
                                            {notifications.some(n => n.isRead) && (
                                                <span onClick={handleClearRead} style={{ color: t.danger, fontSize: 12, cursor: 'pointer' }}>Clear read</span>
                                            )}
                                            {notifications.some(n => !n.isRead) && (
                                                <span onClick={markAllRead} style={{ color: t.accent, fontSize: 12, cursor: 'pointer' }}>Mark all read</span>
                                            )}
                                        </div>
                                    </div>
                                    {/* Category tabs */}
                                    {notifications.length > 0 && (
                                        <Tabs
                                            size="small"
                                            activeKey={activeTab}
                                            onChange={key => setActiveTab(key as NotifCategory | 'all')}
                                            tabBarStyle={{ margin: '0 12px', borderBottom: `1px solid ${t.border}` }}
                                            items={(['all', 'tasks', 'reports', 'files', 'papers', 'tickets'] as const).map(tab => ({
                                                key: tab,
                                                label: tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1),
                                            }))}
                                        />
                                    )}
                                    {/* List */}
                                    {notifications.length === 0 ? (
                                        <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                                            <BellOutlined style={{ fontSize: 28, color: t.border, display: 'block', marginBottom: 8 }} />
                                            <Text style={{ color: t.textMuted, fontSize: 13 }}>You're all caught up!</Text>
                                        </div>
                                    ) : (() => {
                                        const filtered = activeTab === 'all'
                                            ? notifications
                                            : notifications.filter(n => getNotifCategory(n.type, n.entityType) === activeTab);
                                        return (
                                            <>
                                                {filtered.length === 0 ? (
                                                    <div style={{ padding: '24px 16px', textAlign: 'center' }}>
                                                        <Text style={{ color: t.textMuted, fontSize: 13 }}>No {activeTab} notifications</Text>
                                                    </div>
                                                ) : (
                                                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                                        {filtered.map((n, i) => {
                                                            const isPaperRequest  = n.type === 'paper_read_request';
                                                            const isPaperAccepted = n.type === 'paper_read_accepted';
                                                            const isPaperRejected = n.type === 'paper_read_rejected';
                                                            const isApproved      = n.type === 'report_approved';

                                                            const accent = isPaperAccepted ? t.success
                                                                         : isPaperRejected ? t.danger
                                                                         : isPaperRequest  ? t.accent
                                                                         : isApproved      ? t.success
                                                                         : t.orange;

                                                            const Icon = isPaperAccepted ? CheckCircleOutlined
                                                                       : isPaperRejected ? CloseCircleOutlined
                                                                       : isPaperRequest  ? BookOutlined
                                                                       : isApproved      ? CheckCircleOutlined
                                                                       : RedoOutlined;

                                                            return (
                                                                <div
                                                                    key={n.id}
                                                                    onClick={() => handleNotifClick(n)}
                                                                    style={{
                                                                        padding: '10px 10px 10px 16px',
                                                                        borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : undefined,
                                                                        background: n.isRead ? 'transparent' : alpha(accent, 0.05),
                                                                        display: 'flex', gap: 10, alignItems: 'flex-start',
                                                                        cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    <Icon style={{ color: accent, fontSize: 16, marginTop: 2, flexShrink: 0 }} />
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <Text style={{ color: t.text, fontWeight: n.isRead ? 400 : 700, fontSize: 13, display: 'block' }}>
                                                                            {n.title}
                                                                        </Text>
                                                                        {n.message && (
                                                                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginTop: 2 }}>
                                                                                {n.message}
                                                                            </Text>
                                                                        )}
                                                                        {isPaperRequest && !n._handled && (
                                                                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                                                                <Button
                                                                                    size="small"
                                                                                    icon={<CheckOutlined />}
                                                                                    onClick={(e) => { e.stopPropagation(); handlePaperReadRequest(n, 'accept'); }}
                                                                                    style={{ background: t.success, borderColor: t.success, color: t.textOnAccent, fontSize: 11, height: 24, borderRadius: 4 }}
                                                                                >
                                                                                    Accept
                                                                                </Button>
                                                                                <Button
                                                                                    size="small"
                                                                                    icon={<CloseOutlined />}
                                                                                    onClick={(e) => { e.stopPropagation(); handlePaperReadRequest(n, 'reject'); }}
                                                                                    style={{ background: 'transparent', borderColor: t.danger, color: t.danger, fontSize: 11, height: 24, borderRadius: 4 }}
                                                                                >
                                                                                    Decline
                                                                                </Button>
                                                                            </div>
                                                                        )}
                                                                        <Text style={{ color: t.textFaint, fontSize: 11, display: 'block', marginTop: 3 }}>
                                                                            {new Date(n.createdAt).toLocaleString()}
                                                                        </Text>
                                                                    </div>
                                                                    {/* Per-row actions */}
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                                                        <Button
                                                                            type="text" size="small"
                                                                            icon={n.isRead ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                                                            title={n.isRead ? 'Mark unread' : 'Mark read'}
                                                                            onClick={(e) => handleToggleUnread(n, e)}
                                                                            style={{ color: t.textMuted, padding: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                        />
                                                                        <Button
                                                                            type="text" size="small"
                                                                            icon={<DeleteOutlined />}
                                                                            title="Delete"
                                                                            danger
                                                                            onClick={(e) => handleDeleteNotif(n.id, e)}
                                                                            style={{ padding: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {/* Footer */}
                                                <div style={{ padding: '9px 16px', borderTop: `1px solid ${t.border}`, textAlign: 'center' }}>
                                                    <span
                                                        onClick={() => { setBellOpen(false); navigate('/notifications'); }}
                                                        style={{ color: t.accent, fontSize: 12, cursor: 'pointer' }}
                                                    >
                                                        View all notifications →
                                                    </span>
                                                </div>
                                            </>
                                        );
                                    })()}
                                </div>
                            }
                        >
                            <Button
                                type="text"
                                size="small"
                                icon={
                                    <Badge count={unreadCount} size="small" style={{ boxShadow: 'none' }}>
                                        <BellOutlined
                                            className={unreadCount > 0 ? 'bell-ringing' : undefined}
                                            style={{ fontSize: 16, color: unreadCount > 0 ? t.warning : t.textMuted }}
                                        />
                                    </Badge>
                                }
                                style={{ color: t.textMuted, borderRadius: 6 }}
                            />
                        </Popover>

                        <Divider type="vertical" style={{ borderColor: t.border, height: 20 }} />

                        {/* Role badge */}
                        <span
                            style={{
                                display:       'inline-flex',
                                alignItems:    'center',
                                background:     alpha(rc.color, 0.10),
                                border:        `1px solid ${alpha(rc.color, 0.27)}`,
                                color:          rc.color,
                                borderRadius:   20,
                                padding:       '0 10px',
                                height:         22,
                                fontSize:       11,
                                fontWeight:     600,
                                letterSpacing: '0.3px',
                                lineHeight:    '20px',
                                flexShrink:     0,
                            }}
                        >
                            {rc.label}
                        </span>

                        {/* User avatar dropdown */}
                        <Dropdown
                            menu={{ items: userMenuItems }}
                            placement="bottomRight"
                            overlayStyle={{ minWidth: 180 }}
                        >
                            <Avatar
                                src={user?.avatarUrl || undefined}
                                onError={() => true}
                                style={{
                                    background:  t.surfaceRaised,
                                    cursor:      'pointer',
                                    fontSize:    13,
                                    fontWeight:  700,
                                    lineHeight:  '32px',
                                    border:      `2px solid ${user?.avatarUrl ? rc.color : t.border}`,
                                    color:        rc.color,
                                    flexShrink:   0,
                                    objectFit:   'cover',
                                }}
                                size={32}
                            >
                                {initials}
                            </Avatar>
                        </Dropdown>
                    </div>
                </Header>

                {/* Page content */}
                <Content
                    className="page-enter"
                    style={{
                        padding:    '28px 28px 48px',
                        minHeight: 'calc(100vh - 57px)',
                        overflowX: 'hidden',
                    }}
                >
                    {user?.isOnHold && (
                        <div style={{
                            marginBottom: 20,
                            padding: '10px 16px',
                            background: t.warningBg,
                            border: `1px solid ${t.warningBorder}`,
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <span style={{ fontSize: 16 }}>⏸</span>
                            <div>
                                <Text style={{ color: t.warning, fontWeight: 600, display: 'block', lineHeight: 1.3 }}>
                                    Your account is currently on hold
                                </Text>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                    You can view all your data but cannot submit or modify anything. This is typically done when a lab member is not scheduled for active assignments, or while an administrative review is in progress.
                                </Text>
                            </div>
                        </div>
                    )}
                    <Outlet />
                </Content>
            </Layout>
        </Layout>
        </>
    );
}
