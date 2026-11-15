import { useState, useEffect, useCallback } from 'react';
import { Typography, Tabs, Button, Empty, Spin, Badge, Space, Tag } from 'antd';
import {
    BellOutlined, BookOutlined, CheckCircleOutlined, CloseCircleOutlined,
    RedoOutlined, DeleteOutlined, EyeOutlined, EyeInvisibleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { getNotifCategory, navigateToEntity, type NotifCategory } from '../../utils/notificationUtils';
import { alpha } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';

const { Text } = Typography;


const TABS: { key: NotifCategory | 'all'; label: string }[] = [
    { key: 'all',     label: 'All' },
    { key: 'tasks',   label: 'Tasks' },
    { key: 'reports', label: 'Reports' },
    { key: 'files',   label: 'Files' },
    { key: 'papers',  label: 'Papers' },
    { key: 'tickets', label: 'Tickets' },
    { key: 'other',   label: 'Other' },
];

function accentFor(n: any, t: ReturnType<typeof useTheme>['t']): string {
    if (n.type === 'paper_read_accepted') return t.success;
    if (n.type === 'paper_read_rejected') return t.danger;
    if (n.type === 'paper_read_request')  return t.accent;
    if (n.type === 'report_approved')     return t.success;
    return t.orange;
}

function IconFor({ n, accent }: { n: any; accent: string }) {
    const style = { color: accent, fontSize: 18, marginTop: 2, flexShrink: 0 } as const;
    if (n.type === 'paper_read_accepted') return <CheckCircleOutlined style={style} />;
    if (n.type === 'paper_read_rejected') return <CloseCircleOutlined style={style} />;
    if (n.type === 'paper_read_request')  return <BookOutlined         style={style} />;
    if (n.type === 'report_approved')     return <CheckCircleOutlined  style={style} />;
    return <RedoOutlined style={style} />;
}

export default function NotificationsPage() {
    const { t } = useTheme();
    const [notifications, setNotifications] = useState<any[]>([]);
    const [loading, setLoading]             = useState(true);
    const [activeTab, setActiveTab]         = useState<NotifCategory | 'all'>('all');
    const navigate = useNavigate();

    const load = useCallback(async () => {
        try {
            const res = await api.get('/notifications');
            setNotifications(res.data);
        } catch { /* silent */ } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleMarkAll = async () => {
        try {
            await api.patch('/notifications/read-all');
            setNotifications(prev => prev.map(n =>
                n.type === 'paper_read_request' ? n : { ...n, isRead: true }
            ));
        } catch { /* silent */ }
    };

    const handleClearRead = async () => {
        try {
            await api.delete('/notifications/read');
            setNotifications(prev => prev.filter(n => !n.isRead));
        } catch { /* silent */ }
    };

    const handleDelete = async (id: number) => {
        try {
            await api.delete(`/notifications/${id}`);
            setNotifications(prev => prev.filter(n => n.id !== id));
        } catch { /* silent */ }
    };

    const handleToggle = async (n: any) => {
        try {
            if (n.isRead) {
                await api.patch(`/notifications/${n.id}/unread`);
                setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: false } : x));
            } else {
                await api.patch(`/notifications/${n.id}/read`);
                setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
            }
        } catch { /* silent */ }
    };

    const handleClick = (n: any) => {
        if (!n.isRead && n.type !== 'paper_read_request') {
            api.patch(`/notifications/${n.id}/read`).catch(() => {});
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
        }
        navigateToEntity(n, navigate);
    };

    const filtered = activeTab === 'all'
        ? notifications
        : notifications.filter(n => getNotifCategory(n.type, n.entityType) === activeTab);

    const unreadCount = notifications.filter(n => !n.isRead).length;

    const tabItems = TABS.map(({ key, label }) => {
        const count = key === 'all'
            ? notifications.filter(n => !n.isRead).length
            : notifications.filter(n => !n.isRead && getNotifCategory(n.type, n.entityType) === key).length;
        return {
            key,
            label: count > 0
                ? <span>{label} <Badge count={count} size="small" style={{ boxShadow: 'none', marginLeft: 4 }} /></span>
                : label,
        };
    });

    return (
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <PageHeader
                title={
                    <Space size={8}>
                        <BellOutlined style={{ color: unreadCount > 0 ? t.warning : t.textMuted }} />
                        Notifications
                        {unreadCount > 0 && (
                            <Tag color="warning" style={{ marginInlineEnd: 0 }}>{unreadCount} unread</Tag>
                        )}
                    </Space>
                }
                subtitle={unreadCount > 0
                    ? `${unreadCount} notification${unreadCount === 1 ? '' : 's'} you have not read yet`
                    : 'You are up to date'}
                actions={
                    <Space>
                        {notifications.some((n) => n.isRead) && (
                            <Button size="small" danger onClick={handleClearRead}>Clear read</Button>
                        )}
                        {unreadCount > 0 && (
                            <Button size="small" type="primary" onClick={handleMarkAll}>Mark all read</Button>
                        )}
                    </Space>
                }
            />

            {/* Card */}
            <div style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10 }}>
                {/* Tabs */}
                <div style={{ borderBottom: `1px solid ${t.border}`, padding: '0 16px' }}>
                    <Tabs
                        activeKey={activeTab}
                        onChange={key => setActiveTab(key as NotifCategory | 'all')}
                        items={tabItems}
                        size="small"
                        tabBarStyle={{ margin: 0 }}
                    />
                </div>

                {/* Content */}
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center' }}>
                        <Spin />
                    </div>
                ) : filtered.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<Text style={{ color: t.textMuted }}>
                            {activeTab === 'all' ? "You're all caught up!" : `No ${activeTab} notifications`}
                        </Text>}
                        style={{ padding: '40px 0' }}
                    />
                ) : (
                    filtered.map((n, i) => {
                        const accent = accentFor(n, t);
                        return (
                            <div
                                key={n.id}
                                onClick={() => handleClick(n)}
                                style={{
                                    display:      'flex',
                                    gap:           12,
                                    alignItems:   'flex-start',
                                    padding:      '14px 20px 14px 20px',
                                    borderBottom: i < filtered.length - 1 ? `1px solid ${t.border}` : undefined,
                                    background:   n.isRead ? 'transparent' : `${alpha(accent, 0.03)}`,
                                    cursor:       'pointer',
                                    transition:   'background 0.15s',
                                }}
                                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = n.isRead ? alpha(t.textOnAccent, 0.02) : alpha(accent, 0.07); }}
                                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = n.isRead ? 'transparent' : `${alpha(accent, 0.03)}`; }}
                            >
                                {!n.isRead && (
                                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, flexShrink: 0, marginTop: 7 }} />
                                )}
                                {n.isRead && (
                                    <div style={{ width: 6, height: 6, flexShrink: 0, marginTop: 7 }} />
                                )}
                                <IconFor n={n} accent={accent} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={{ color: t.text, fontWeight: n.isRead ? 400 : 700, fontSize: 14, display: 'block' }}>
                                        {n.title}
                                    </Text>
                                    {n.message && (
                                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginTop: 2 }}>
                                            {n.message}
                                        </Text>
                                    )}
                                    <Text style={{ color: t.border, fontSize: 12, display: 'block', marginTop: 4 }}>
                                        {new Date(n.createdAt).toLocaleString()}
                                    </Text>
                                </div>
                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                                    <Button
                                        type="text" size="small"
                                        icon={n.isRead ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                                        title={n.isRead ? 'Mark unread' : 'Mark read'}
                                        onClick={() => handleToggle(n)}
                                        style={{ color: t.textMuted }}
                                    />
                                    <Button
                                        type="text" size="small"
                                        icon={<DeleteOutlined />}
                                        title="Delete"
                                        danger
                                        onClick={() => handleDelete(n.id)}
                                    />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
