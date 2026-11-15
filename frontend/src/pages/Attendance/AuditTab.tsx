import { useState, useEffect, useCallback } from 'react';
import { Table, Tag, Typography, Button, Alert, Space } from 'antd';
import { ReloadOutlined, EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getCorrections, getAudit, type CorrectionEntry, type AuditEntry,
} from '../../api/attendance';
import { useSocket } from '../../hooks/useSocket';
import { useTheme } from '../../theme/useTheme';
import { Panel, LoadingState, EmptyState } from '../../components/ui';

const { Text } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The audit trail.

   Two views of the same principle: nothing is changed silently. The
   corrections table is the attendance-specific record — what a session
   looked like before, what it looks like now, who changed it and why. The
   activity log below is wider, covering card registrations, reader
   changes and remote-work authorisations.
   ═══════════════════════════════════════════════════════════════════════ */

const ACTION_LABEL: Record<string, string> = {
    create: 'Session added', edit: 'Times corrected', close: 'Session closed',
    void: 'Session voided', manual_clock: 'Clocked by administrator',
    card_registered: 'Card registered', card_replaced: 'Card replaced', card_removed: 'Card removed',
    device_created: 'Reader added', device_updated: 'Reader updated',
    device_key_rotated: 'Reader key rotated', device_deleted: 'Reader removed',
    registration_started: 'Registration opened', registration_failed: 'Registration failed',
    registration_cancelled: 'Registration cancelled',
    set_enforcement_start: 'Enforcement changed',
};

const ACTION_TONE: Record<string, string> = {
    void: 'error', edit: 'purple', create: 'blue', manual_clock: 'orange',
    card_registered: 'success', card_replaced: 'purple', card_removed: 'error',
    registration_failed: 'error', device_deleted: 'error', device_key_rotated: 'warning',
};

/** Renders a jsonb old/new value blob compactly. */
function ValueCell({ value }: { value: Record<string, unknown> | null }) {
    const { t } = useTheme();
    if (!value || !Object.keys(value).length) return <Text style={{ color: t.textFaint }}>—</Text>;
    return (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: t.textMuted, lineHeight: 1.5 }}>
            {Object.entries(value).map(([k, v]) => (
                <div key={k} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>
                    <span style={{ color: t.textFaint }}>{k}: </span>
                    {typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
                        ? dayjs(v).format('D MMM HH:mm')
                        : String(v)}
                </div>
            ))}
        </div>
    );
}

export default function AuditTab() {
    const { t } = useTheme();
    const [corrections, setCorrections] = useState<CorrectionEntry[]>([]);
    const [audit, setAudit] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const [c, a] = await Promise.all([
            getCorrections({ limit: 300 }).catch(() => [] as CorrectionEntry[]),
            getAudit(300).catch(() => [] as AuditEntry[]),
        ]);
        setCorrections(c); setAudit(a);
        setLoading(false);
    }, []);

    useEffect(() => { void load(); }, [load]);
    useSocket({ 'attendance:refresh': () => { void load(); } });

    if (loading && !corrections.length && !audit.length) return <LoadingState />;

    const correctionCols: ColumnsType<CorrectionEntry> = [
        {
            title: 'When', dataIndex: 'createdAt', width: 150,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(v).format('D MMM YYYY HH:mm')}</Text>,
        },
        {
            title: 'Action', dataIndex: 'action', width: 180,
            render: (v: string) => <Tag color={ACTION_TONE[v] ?? 'default'}>{ACTION_LABEL[v] ?? v}</Tag>,
        },
        {
            title: 'Employee', key: 'employee', width: 180,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.text }}>{r.employeeName ?? '—'}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>{r.employeeId ?? ''}</Text>
                </div>
            ),
        },
        { title: 'Before', dataIndex: 'oldValues', width: 280, render: (v) => <ValueCell value={v} /> },
        { title: 'After', dataIndex: 'newValues', width: 280, render: (v) => <ValueCell value={v} /> },
        {
            title: 'Reason', dataIndex: 'reason',
            render: (v: string) => <Text style={{ color: t.text, fontSize: 12 }}>{v}</Text>,
        },
        {
            title: 'By', dataIndex: 'correctedByName', width: 150,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v}</Text>,
        },
    ];

    const auditCols: ColumnsType<AuditEntry> = [
        {
            title: 'When', dataIndex: 'timestamp', width: 150,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(v).format('D MMM YYYY HH:mm')}</Text>,
        },
        {
            title: 'What', dataIndex: 'action', width: 190,
            render: (v: string) => <Tag color={ACTION_TONE[v] ?? 'default'}>{ACTION_LABEL[v] ?? v}</Tag>,
        },
        {
            title: 'Area', dataIndex: 'entityType', width: 160,
            render: (v: string) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v.replace(/_/g, ' ')}</Text>,
        },
        { title: 'Before', dataIndex: 'oldValue', width: 260, render: (v) => <ValueCell value={v} /> },
        { title: 'After', dataIndex: 'newValue', width: 260, render: (v) => <ValueCell value={v} /> },
        {
            title: 'By', dataIndex: 'actorName', width: 150,
            render: (v: string | null) => <Text style={{ color: t.textMuted, fontSize: 12 }}>{v ?? 'system'}</Text>,
        },
        {
            title: 'IP', dataIndex: 'ipAddress', width: 130,
            render: (v: string | null) => <Text style={{ color: t.textFaint, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{v ?? ''}</Text>,
        },
    ];

    return (
        <div>
            <Alert
                type="info" showIcon style={{ marginBottom: 16 }}
                message="Append-only"
                description={
                    'Correction rows are never updated or deleted, and the original clock-in and '
                    + 'clock-out times stay on the session itself. What you see here is the full history '
                    + 'of every administrative change to attendance, cards and readers.'
                }
            />

            <Panel
                accent={t.purple}
                title={<Space size={8}><EditOutlined style={{ color: t.purple }} />Attendance corrections</Space>}
                extra={<Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>Refresh</Button>}
                style={{ marginBottom: 16 }}
            >
                {corrections.length ? (
                    <Table
                        rowKey="id" size="small" columns={correctionCols} dataSource={corrections}
                        loading={loading} pagination={{ pageSize: 15, showSizeChanger: false }} scroll={{ x: 1500 }}
                    />
                ) : (
                    <EmptyState compact title="No corrections" description="No attendance record has been altered." />
                )}
            </Panel>

            <Panel accent={t.accent} title={<Space size={8}><SafetyCertificateOutlined style={{ color: t.accent }} />Attendance, RFID and remote-work activity</Space>}>
                {audit.length ? (
                    <Table
                        rowKey="id" size="small" columns={auditCols} dataSource={audit}
                        loading={loading} pagination={{ pageSize: 20, showSizeChanger: false }} scroll={{ x: 1460 }}
                    />
                ) : (
                    <EmptyState compact title="Nothing logged yet" description="Activity appears here as the system is used." />
                )}
            </Panel>
        </div>
    );
}
