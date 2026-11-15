import {
    Typography, Divider, Select, Segmented, Space,
} from 'antd';
import {
    SafetyOutlined, GlobalOutlined, EyeOutlined, BulbOutlined,
    MoonOutlined, SunOutlined, DesktopOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../store/authStore';
import { useTheme } from '../../theme/useTheme';
import { usePreferences } from '../../hooks/usePreferences';
import { DATE_FORMATS } from '../../utils/format';
import { PageHeader } from '../../components/ui';

const { Text } = Typography;

function SettingRow({
    icon,
    label,
    description,
    control,
}: {
    icon: React.ReactNode;
    label: string;
    description?: string;
    control: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 0',
                gap: 16,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1 }}>
                <span style={{ color: t.textMuted, fontSize: 16, paddingTop: 2 }}>{icon}</span>
                <div>
                    <Text style={{ color: t.text, fontWeight: 500, display: 'block' }}>{label}</Text>
                    {description && (
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>{description}</Text>
                    )}
                </div>
            </div>
            <div style={{ flexShrink: 0 }}>{control}</div>
        </div>
    );
}

function SectionCard({
    title,
    icon,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    const { t } = useTheme();
    return (
        <div
            style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                marginBottom: 20,
                padding: '4px 24px 16px',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 0 4px' }}>
                <span style={{ color: t.accent, fontSize: 15 }}>{icon}</span>
                <Text style={{ color: t.textMuted, fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {title}
                </Text>
            </div>
            <Divider style={{ borderColor: t.border, margin: '8px 0 0' }} />
            {children}
        </div>
    );
}

export default function SettingsPage() {
    const { t, preference, setPreference } = useTheme();
    const { prefs, update } = usePreferences();
    const { user } = useAuthStore();

    return (
        <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 60 }}>
            <PageHeader
                title={<Space size={8}><SettingOutlined />Settings</Space>}
                subtitle="Manage your appearance and display preferences"
            />

            {/* Appearance */}
            <SectionCard title="Appearance" icon={<BulbOutlined />}>
                <SettingRow
                    icon={<BulbOutlined />}
                    label="Theme"
                    description="Dark, light, or match your system setting"
                    control={
                        <Segmented
                            value={preference}
                            onChange={(v) => setPreference(v as typeof preference)}
                            options={[
                                { value: 'dark',   icon: <MoonOutlined />,    label: 'Dark' },
                                { value: 'light',  icon: <SunOutlined />,     label: 'Light' },
                                { value: 'system', icon: <DesktopOutlined />, label: 'System' },
                            ]}
                        />
                    }
                />
            </SectionCard>

            {/* Display */}
            <SectionCard title="Display" icon={<EyeOutlined />}>
                <SettingRow
                    icon={<GlobalOutlined />}
                    label="Date format"
                    description="How dates are shown across the portal"
                    control={
                        <Select
                            value={prefs.dateFormat}
                            onChange={(v) => update('dateFormat', v)}
                            style={{ width: 150 }}
                            options={DATE_FORMATS.map((f) => ({ label: f, value: f }))}
                        />
                    }
                />
                <Divider style={{ borderColor: t.borderSubtle, margin: 0 }} />
                <SettingRow
                    icon={<GlobalOutlined />}
                    label="Timezone"
                    description="Used for every date and time shown in the portal"
                    control={
                        <Select
                            value={prefs.timezone}
                            onChange={(v) => update('timezone', v)}
                            style={{ width: 200 }}
                            showSearch
                            options={[
                                { label: 'System default', value: 'system' },
                                { label: 'UTC', value: 'UTC' },
                                { label: 'US Mountain (Denver)', value: 'America/Denver' },
                                { label: 'US Pacific (Los Angeles)', value: 'America/Los_Angeles' },
                                { label: 'US Central (Chicago)', value: 'America/Chicago' },
                                { label: 'US Eastern (New York)', value: 'America/New_York' },
                                { label: 'UK (London)', value: 'Europe/London' },
                                { label: 'UTC+3 (Riyadh)', value: 'Asia/Riyadh' },
                                { label: 'UTC+4 (Dubai)', value: 'Asia/Dubai' },
                                { label: 'UTC+5:30 (India)', value: 'Asia/Kolkata' },
                            ]}
                        />
                    }
                />
            </SectionCard>

            {/* Account info (read-only) */}
            <div
                style={{
                    background: t.surface,
                    border: `1px solid ${t.border}`,
                    borderRadius: 12,
                    padding: 20,
                }}
            >
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    <SafetyOutlined style={{ marginRight: 6 }} />
                    Signed in as{' '}
                    <span style={{ color: t.text, fontWeight: 600 }}>@{user?.username}</span>
                    {' · '}
                    To change your name, email or password, visit{' '}
                    <a
                        href="/profile"
                        style={{ color: t.accent, textDecoration: 'none' }}
                        onClick={(e) => { e.preventDefault(); window.location.href = '/profile'; }}
                    >
                        Your Profile
                    </a>
                    .
                </Text>
            </div>
        </div>
    );
}
