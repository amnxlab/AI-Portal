import { useState, useEffect, useMemo } from 'react';
import { useDeepLinkParam } from '../../hooks/useDeepLink';
import { Tabs, Upload, Button, Alert, Typography, Space, Table, message } from 'antd';
import { UploadOutlined, ClockCircleOutlined } from '@ant-design/icons';
import api from '../../api/axios';
import { importCsv, type CsvImportResult } from '../../api/attendance';
import { usePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { PageHeader, Panel } from '../../components/ui';
import MyAttendanceTab from './MyAttendanceTab';
import TodayTab from './TodayTab';
import ShiftsTab from './ShiftsTab';
import OverviewTab from './OverviewTab';
import SessionsTab from './SessionsTab';
import ExceptionsTab from './ExceptionsTab';
import AuditTab from './AuditTab';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The Attendance module.

   Everyone gets "My attendance", which is read-only. The rest requires
   manage_attendance, and is the organisation-wide view the spec asks for:
   who is working, what attendance verifies against what was reported,
   what needs fixing, the readers themselves, and the audit trail.
   ═══════════════════════════════════════════════════════════════════════ */

interface UserRow { id: string; fullName: string; employeeId: string | null; isActive: boolean }

function CsvImportTab() {
    const { t } = useTheme();
    const [result, setResult] = useState<CsvImportResult | null>(null);
    const [busy, setBusy] = useState(false);

    const upload = async (file: File) => {
        setBusy(true);
        try {
            const res = await importCsv(file);
            setResult(res);
            message.success(`Imported ${res.imported} events`);
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Import failed');
        }
        setBusy(false);
        return false;
    };

    return (
        <Panel title="Import history from the original RFID-ShiftMate">
            <Alert
                type="info" showIcon style={{ marginBottom: 16 }}
                message="For historical data only"
                description={
                    'This exists to carry across attendance exported from the old standalone reader. '
                    + 'Day-to-day attendance arrives from the reader directly — there is nothing to '
                    + 'import on an ongoing basis. Imported events are paired into sessions and marked '
                    + 'as imported, so they stay distinguishable from events the reader recorded.'
                }
            />
            <Space direction="vertical" style={{ width: '100%' }}>
                <Upload accept=".csv" showUploadList={false} beforeUpload={upload} maxCount={1}>
                    <Button icon={<UploadOutlined />} loading={busy}>Choose a CSV file</Button>
                </Upload>
                <Text style={{ color: t.textMuted, fontSize: 12 }}>
                    Matched to employees by Employee ID. Rows for unknown employees are skipped and listed below.
                </Text>

                {result && (
                    <div style={{ marginTop: 12 }}>
                        <Space size="large" style={{ marginBottom: 8 }}>
                            <Text style={{ color: t.success }}>Imported: {result.imported}</Text>
                            <Text style={{ color: t.warning }}>Skipped: {result.skipped}</Text>
                            <Text style={{ color: t.textMuted }}>Duplicates: {result.duplicates}</Text>
                        </Space>
                        {result.errors.length > 0 && (
                            <Table
                                size="small" rowKey={(_, i) => String(i)} pagination={{ pageSize: 10 }}
                                dataSource={result.errors.map((e, i) => ({ i, e }))}
                                columns={[{ title: `Problems (${result.errors.length})`, dataIndex: 'e' }]}
                            />
                        )}
                    </div>
                )}
            </Space>
        </Panel>
    );
}

export default function AttendancePage() {
    const { t } = useTheme();
    const { hasPermission } = usePermissions();
    const canManage = hasPermission('manage_attendance');
    const [users, setUsers] = useState<UserRow[]>([]);
    /*
     * A shift notification names the tab it belongs to. Without this the
     * link landed on whichever tab happened to be the default, which for
     * a manager is Today -- not where the shift is.
     */
    const requestedTab = useDeepLinkParam('tab');
    const [tab, setTab] = useState(requestedTab || (canManage ? 'today' : 'mine'));
    useEffect(() => { if (requestedTab) setTab(requestedTab); }, [requestedTab]);

    useEffect(() => {
        if (!canManage) return;
        // The directory, not /users: that one requires user-administration
        // permission, so an attendance manager without it got a 403 and an
        // empty list — which left every person-picker on this page, including
        // the one for assigning a shift, with nobody to choose.
        api.get<UserRow[]>('/users/directory')
            .then((r) => setUsers(r.data))
            .catch(() => setUsers([]));
    }, [canManage]);

    const userOptions = useMemo(
        () => users
            .filter((u) => u.isActive)
            .map((u) => ({ value: u.id, label: `${u.fullName}${u.employeeId ? ` (${u.employeeId})` : ''}` })),
        [users],
    );

    const items = [
        { key: 'mine', label: 'My attendance', children: <MyAttendanceTab /> },
        ...(canManage ? [
            // Today first: "who is in, who is late, who never came" is the
            // question the page gets opened for. The totals follow.
            { key: 'today', label: 'Today', children: <TodayTab /> },
            { key: 'shifts', label: 'Shifts', children: <ShiftsTab users={userOptions} /> },
            { key: 'overview', label: 'Hours', children: <OverviewTab /> },
            { key: 'sessions', label: 'Sessions', children: <SessionsTab users={userOptions} /> },
            { key: 'exceptions', label: 'Exceptions', children: <ExceptionsTab /> },
            // Readers moved out to /readers — device administration with its
            // own sidebar entry. Two homes for one screen is worse than one
            // that is easy to find, and this strip was already too long.
            { key: 'audit', label: 'Audit', children: <AuditTab /> },
            // A one-time migration tool, so it sits at the end rather than
            // taking a place among the views people use daily.
            { key: 'import', label: 'Import history', children: <CsvImportTab /> },
        ] : []),
    ];

    // The same shell every other main page uses: page padding on the themed
    // background, the standard header, then the tabs inside one surface card.
    // Attendance was the odd one out — no page padding, no card, tabs sitting
    // directly on the background — which is what made it look like a
    // different application.
    return (
        <div style={{ padding: 24, background: t.bg, minHeight: '100vh' }}>
            <PageHeader
                title={<Space size={8}><ClockCircleOutlined style={{ color: t.accent }} />Attendance</Space>}
                subtitle={canManage
                    ? 'Who is in today, clock-in records, verified hours and shifts'
                    : 'Your shift, clock-in records and verified hours'}
            />

            <div style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: 12,
                padding: '8px 24px 16px',
                boxShadow: t.shadowSm,
            }}>
                <Tabs
                    activeKey={tab} onChange={setTab} items={items}
                    destroyOnHidden
                    type="line"
                    size="middle"
                    // On a narrow screen the tab strip scrolls instead of
                    // wrapping into an unreadable stack.
                    tabBarStyle={{ marginBottom: 16 }}
                    moreIcon={null}
                />
            </div>
        </div>
    );
}
