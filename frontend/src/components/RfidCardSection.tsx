import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Typography, Button, Space, Tag, Alert, Select, Progress, Table, Form, Input, message, Modal,
} from 'antd';
import {
    IdcardOutlined, DeleteOutlined, SwapOutlined, PlusOutlined,
    CheckCircleFilled, CloseCircleFilled, LoadingOutlined, WifiOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import {
    getUserRfid, startRegistration, cancelRegistration, removeCard, getRegistration,
    formatUid, SYNC_STATUS_LABEL, STAGE_LABEL,
    type UserRfid, type RfidCardHistoryEntry, type RegistrationStage, type RfidSyncStatus,
} from '../api/rfid';
import { useSocket } from '../hooks/useSocket';
import { useTheme } from '../theme/useTheme';
import { alpha } from '../theme/tokens';
import { Panel, LoadingState, FormModal } from './ui';

const { Text, Paragraph } = Typography;

/* ═══════════════════════════════════════════════════════════════════════
   The RFID card, inside the employee's own settings.

   This is the only place a card is ever assigned. Pressing "Register"
   opens a short window on one named reader, bound to this one employee —
   the next card presented at that reader becomes theirs. A card merely
   seen by a reader is never assigned on its own, and the server refuses a
   card already held by someone else.

   Progress arrives over the socket (`rfid:registration`), which is sent
   only to the administrator who opened the window. The poll below is a
   fallback for a dropped socket, and is also what notices the window
   expiring, since no event is emitted when nothing happens.
   ═══════════════════════════════════════════════════════════════════════ */

const STATUS_TONE: Record<RfidSyncStatus, string> = {
    synced: 'success', pending: 'warning', failed: 'error', disabled: 'default',
};

/** Terminal stages: the window is over, one way or another. */
const DONE: RegistrationStage[] = ['success', 'failed', 'expired', 'cancelled'];

export function RfidStatusTag({ status }: { status: RfidSyncStatus }) {
    return <Tag color={STATUS_TONE[status]}>{SYNC_STATUS_LABEL[status]}</Tag>;
}

interface Props {
    userId: string;
    /** Called after a change, so the parent list can refresh its own copy. */
    onChanged?: () => void;
}

export default function RfidCardSection({ userId, onChanged }: Props) {
    const { t } = useTheme();
    const [data, setData] = useState<UserRfid | null>(null);
    const [loading, setLoading] = useState(true);
    const [starting, setStarting] = useState(false);
    const [deviceId, setDeviceId] = useState<string | undefined>();
    const [stage, setStage] = useState<RegistrationStage | null>(null);
    const [stageMessage, setStageMessage] = useState<string | null>(null);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [removing, setRemoving] = useState(false);
    const [removeForm] = Form.useForm();

    const sessionIdRef = useRef<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await getUserRfid(userId);
            setData(res);
            setDeviceId((prev) => prev ?? res.devices.find((d) => d.online)?.id ?? res.devices[0]?.id);
            const live = res.activeRegistration;
            if (live) {
                sessionIdRef.current = live.id;
                setStage((s) => (s && !DONE.includes(s) ? s : 'waiting'));
                setSecondsLeft(live.secondsLeft);
            }
        } catch {
            /* leave the previous view in place */
        }
        setLoading(false);
    }, [userId]);

    useEffect(() => { void load(); }, [load]);

    useSocket({
        'rfid:registration': (p: { sessionId: string; userId: string; stage: RegistrationStage; message?: string }) => {
            // Ignore progress for other employees, and reader-level signals
            // that carry no session.
            if (p.userId && p.userId !== userId) return;
            if (!p.sessionId) { void load(); return; }
            if (sessionIdRef.current && p.sessionId !== sessionIdRef.current) return;
            setStage(p.stage);
            setStageMessage(p.message ?? null);
            if (DONE.includes(p.stage)) {
                setSecondsLeft(0);
                void load();
                onChanged?.();
                if (p.stage === 'success') message.success('Card registered');
                else if (p.stage === 'failed') message.error(p.message || 'Registration failed');
                else if (p.stage === 'expired') message.warning('No card was presented in time');
            }
        },
    });

    // Countdown + fallback poll while a window is open.
    const open = !!stage && !DONE.includes(stage);
    useEffect(() => {
        if (!open) return;
        const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
        const poll = setInterval(async () => {
            const id = sessionIdRef.current;
            if (!id) return;
            try {
                const reg = await getRegistration(id);
                setSecondsLeft(reg.secondsLeft);
                if (reg.status !== 'waiting') {
                    setStage(reg.status as RegistrationStage);
                    setStageMessage(reg.failureReason);
                    await load();
                    onChanged?.();
                }
            } catch { /* keep trying */ }
        }, 2000);
        return () => { clearInterval(tick); clearInterval(poll); };
    }, [open, load, onChanged]);

    const begin = async (mode: 'register' | 'replace', allowPending = false) => {
        setStarting(true);
        setStageMessage(null);
        try {
            const reg = await startRegistration(userId, { deviceId, mode, allowPending });
            sessionIdRef.current = reg.id;
            setStage('waiting');
            setSecondsLeft(reg.secondsLeft);
        } catch (e: any) {
            const body = e?.response?.data;
            // The server refuses this one by default and says so in a way we
            // can act on, rather than leaving a dead end on screen.
            if (body?.code === 'pending_signup' && !allowPending) {
                setStarting(false);
                setStage(null);
                Modal.confirm({
                    title: 'Issue a card before sign-up is finished?',
                    width: 520,
                    content: (
                        <div>
                            <p style={{ marginTop: 0 }}>{body.message}</p>
                            <p style={{ marginBottom: 0 }}>
                                The card is linked to their Employee ID now, so it can be handed
                                over today. Taps are refused until they follow their invitation
                                and set a password, and the reader tells them so by name.
                            </p>
                        </div>
                    ),
                    okText: 'Issue the card anyway',
                    cancelText: 'Not now',
                    onOk: () => begin(mode, true),
                });
                return;
            }
            message.error(body?.message || 'Could not start registration');
            setStage(null);
        }
        setStarting(false);
    };

    const abort = async () => {
        const id = sessionIdRef.current;
        if (!id) return;
        try {
            await cancelRegistration(id);
            setStage('cancelled');
            await load();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not cancel');
        }
    };

    const submitRemove = async () => {
        const v = await removeForm.validateFields();
        try {
            await removeCard(userId, v.reason);
            message.success('Card removed — it can no longer record attendance');
            setRemoving(false);
            removeForm.resetFields();
            await load();
            onChanged?.();
        } catch (e: any) {
            message.error(e?.response?.data?.message || 'Could not remove the card');
        }
    };

    if (loading && !data) return <LoadingState variant="spinner" />;
    if (!data) return <Alert type="error" message="Could not load RFID details" />;

    const card = data.card;
    const devices = data.devices;
    const chosen = devices.find((d) => d.id === deviceId);
    const anyOnline = devices.some((d) => d.online);
    const blockers: string[] = [];
    // A disabled account still blocks: an administrator turned it off and
    // can turn it back on. A pending invitation is not a blocker -- only
    // the employee can clear it, and the card can be issued meanwhile.
    if (!data.isActive && !data.pendingSignup) blockers.push('The account is disabled.');
    if (!data.employeeId) blockers.push('The employee has no Employee ID.');
    if (!devices.length) blockers.push('No RFID reader has been set up.');
    else if (!anyOnline) blockers.push('No reader is online.');

    const historyCols: ColumnsType<RfidCardHistoryEntry> = [
        {
            title: 'Card', dataIndex: 'uid', width: 150,
            render: (v: string) => (
                <Text style={{ color: t.text, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {formatUid(v)}
                </Text>
            ),
        },
        {
            title: 'Status', dataIndex: 'status', width: 110,
            render: (v: string) => (
                <Tag color={v === 'active' ? 'success' : v === 'replaced' ? 'purple' : 'default'}>
                    {v === 'active' ? 'Active' : v === 'replaced' ? 'Replaced' : 'Removed'}
                </Tag>
            ),
        },
        {
            title: 'Assigned', key: 'assigned', width: 200,
            render: (_, r) => (
                <div>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(r.assignedAt).format('D MMM YYYY HH:mm')}</Text>
                    {r.assignedByName && (
                        <Text style={{ color: t.textFaint, fontSize: 11, display: 'block' }}>by {r.assignedByName}</Text>
                    )}
                </div>
            ),
        },
        {
            title: 'Revoked', key: 'revoked',
            render: (_, r) => (r.revokedAt ? (
                <div>
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(r.revokedAt).format('D MMM YYYY HH:mm')}</Text>
                    {r.revokedByName && (
                        <Text style={{ color: t.textFaint, fontSize: 11, display: 'block' }}>by {r.revokedByName}</Text>
                    )}
                    {r.revokeReason && (
                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block' }}>{r.revokeReason}</Text>
                    )}
                </div>
            ) : <Text style={{ color: t.textFaint }}>—</Text>),
        },
    ];

    const stagePercent = (() => {
        switch (stage) {
            case 'waiting': return 10;
            case 'card_detected': return 40;
            case 'validating': return 65;
            case 'registering': return 85;
            case 'success': return 100;
            default: return 0;
        }
    })();

    return (
        <div>
            <Panel
                accent={card ? t.accent : t.warning}
                title={<Space size={8}><IdcardOutlined style={{ color: card ? t.accent : t.warning }} />RFID card</Space>}
                extra={<RfidStatusTag status={data.status} />}
                style={{ marginBottom: 16 }}
            >
                {/* ─── Current assignment ──────────────────────────────── */}
                <div style={{
                    display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center',
                    justifyContent: 'space-between', marginBottom: 16,
                }}>
                    {/* The assignment rendered as the thing it represents — a
                        card — so its state reads at a glance rather than as
                        another line of text. */}
                    <div
                        style={{
                            width: 260, minHeight: 104, borderRadius: 12, padding: '14px 16px',
                            position: 'relative', overflow: 'hidden', flexShrink: 0,
                            background: card
                                ? `linear-gradient(135deg, ${alpha(t.accent, 0.22)}, ${alpha(t.purple, 0.16)})`
                                : t.surfaceSunken,
                            border: `1px solid ${card ? alpha(t.accent, 0.45) : t.borderSubtle}`,
                            borderStyle: card ? 'solid' : 'dashed',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{
                                color: t.textMuted, fontSize: 10, fontWeight: 700,
                                letterSpacing: '0.08em', textTransform: 'uppercase',
                            }}>
                                RFID card
                            </Text>
                            <WifiOutlined style={{ color: card ? t.accent : t.textFaint, fontSize: 15, transform: 'rotate(90deg)' }} />
                        </div>

                        {card ? (
                            <>
                                <Text style={{
                                    color: t.text, fontSize: 19, fontWeight: 700, display: 'block',
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                    letterSpacing: '2px', marginTop: 14,
                                }}>
                                    {formatUid(card.uid)}
                                </Text>
                                <Text style={{ color: t.textMuted, fontSize: 10, display: 'block', marginTop: 8 }}>
                                    {data.fullName}
                                    {data.employeeId ? ` · ${data.employeeId}` : ''}
                                </Text>
                                <Text style={{ color: t.textFaint, fontSize: 10, display: 'block' }}>
                                    Issued {dayjs(card.assignedAt).format('D MMM YYYY')}
                                    {card.assignedByName ? ` by ${card.assignedByName}` : ''}
                                </Text>
                            </>
                        ) : (
                            <div style={{ display: 'grid', placeItems: 'center', minHeight: 64 }}>
                                <Text style={{ color: t.textFaint, fontSize: 13 }}>No card assigned</Text>
                            </div>
                        )}
                    </div>

                    <Space wrap>
                        {devices.length > 1 && (
                            <Select
                                size="small" style={{ minWidth: 200 }} value={deviceId} onChange={setDeviceId}
                                options={devices.map((d) => ({
                                    value: d.id,
                                    label: `${d.name} ${d.online ? '● online' : '○ offline'}`,
                                    disabled: !d.isActive,
                                }))}
                            />
                        )}
                        {!card ? (
                            <Button
                                type="primary" icon={<PlusOutlined />} loading={starting}
                                disabled={open || blockers.length > 0}
                                onClick={() => begin('register')}
                            >Register new RFID card</Button>
                        ) : (
                            <>
                                <Button
                                    icon={<SwapOutlined />} loading={starting}
                                    disabled={open || blockers.length > 0}
                                    onClick={() => begin('replace')}
                                >Replace card</Button>
                                <Button danger icon={<DeleteOutlined />} disabled={open} onClick={() => setRemoving(true)}>
                                    Remove card
                                </Button>
                            </>
                        )}
                    </Space>
                </div>

                {/* ─── Why the buttons are disabled ────────────────────── */}
                {data.pendingSignup && blockers.length === 0 && (
                    <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="This employee has not finished setting up their account"
                        description={
                            'A card can still be issued and linked to their Employee ID. '
                            + 'It starts working the moment they accept their invitation.'
                        }
                    />
                )}
                {blockers.length > 0 && (
                    <Alert
                        type="warning" showIcon style={{ marginBottom: 12 }}
                        message="Card registration is not available"
                        description={
                            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                                {blockers.map((b) => <li key={b}>{b}</li>)}
                            </ul>
                        }
                    />
                )}

                {/* ─── Live registration progress ──────────────────────── */}
                {stage && (
                    <div style={{
                        background: t.surfaceSunken, border: `1px solid ${
                            stage === 'success' ? t.successBorder : stage === 'failed' || stage === 'expired' ? t.dangerBorder : t.accentBorder
                        }`,
                        borderRadius: 10, padding: 16, marginBottom: 12,
                    }}>
                        <Space align="start" size={12} style={{ width: '100%' }}>
                            <div style={{ fontSize: 20, lineHeight: '24px' }}>
                                {stage === 'success' ? <CheckCircleFilled style={{ color: t.success }} />
                                    : stage === 'failed' || stage === 'expired' ? <CloseCircleFilled style={{ color: t.danger }} />
                                        : <LoadingOutlined style={{ color: t.accent }} />}
                            </div>
                            <div style={{ flex: 1 }}>
                                <Text style={{ color: t.text, fontWeight: 600, display: 'block' }}>
                                    {STAGE_LABEL[stage] ?? stage}
                                </Text>
                                {stage === 'waiting' && (
                                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block' }}>
                                        Present {data.fullName}&rsquo;s card to
                                        {chosen ? ` “${chosen.name}”` : ' the reader'} now
                                        {secondsLeft > 0 ? ` — ${secondsLeft}s left` : ''}
                                    </Text>
                                )}
                                {stageMessage && (
                                    <Text style={{ color: t.danger, fontSize: 12, display: 'block' }}>{stageMessage}</Text>
                                )}
                                {open && (
                                    <Progress
                                        percent={stagePercent} size="small" showInfo={false}
                                        style={{ marginTop: 8, marginBottom: 0 }}
                                    />
                                )}
                            </div>
                            <Space>
                                {open && <Button size="small" onClick={abort}>Cancel</Button>}
                                {!open && (
                                    <Button size="small" type="text" onClick={() => { setStage(null); setStageMessage(null); }}>
                                        Dismiss
                                    </Button>
                                )}
                            </Space>
                        </Space>
                    </div>
                )}

                {!stage && !card && blockers.length === 0 && (
                    <Alert
                        type="info" showIcon
                        message="How registration works"
                        description={
                            'Press the button above and the reader accepts one card, for this employee only, '
                            + 'for a short moment. The card is checked against every other employee first — a '
                            + 'card already in use is refused rather than reassigned.'
                        }
                    />
                )}
            </Panel>

            {/* ─── History ─────────────────────────────────────────────── */}
            {data.history.length > 0 && (
                <Panel accent={t.purple} title={<Space size={8}><IdcardOutlined style={{ color: t.purple }} />Card history</Space>} style={{ marginBottom: 16 }}>
                    <Table
                        rowKey="id" size="small" columns={historyCols} dataSource={data.history}
                        pagination={false} scroll={{ x: 640 }}
                    />
                </Panel>
            )}

            {/* ─── Recent reader activity for this employee ────────────── */}
            {data.recentEvents.length > 0 && (
                <Panel accent={t.info} title={<Space size={8}><WifiOutlined style={{ color: t.info, transform: "rotate(90deg)" }} />Recent reader activity</Space>}>
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                        {data.recentEvents.map((e) => (
                            <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                                <Text style={{ color: t.textFaint, fontSize: 11, minWidth: 110, fontVariantNumeric: 'tabular-nums' }}>
                                    {dayjs(e.createdAt).format('D MMM HH:mm:ss')}
                                </Text>
                                <Tag style={{ marginInlineEnd: 0 }}>{e.result.replace(/_/g, ' ')}</Tag>
                                {e.detail && <Text style={{ color: t.textMuted, fontSize: 11 }}>{e.detail}</Text>}
                            </div>
                        ))}
                    </Space>
                </Panel>
            )}

            {/* ─── Remove ──────────────────────────────────────────────── */}
            <FormModal
                open={removing} title="Remove RFID card" okText="Remove card" danger
                onCancel={() => setRemoving(false)} onOk={submitRemove}
            >
                <Paragraph style={{ color: t.textMuted, fontSize: 13 }}>
                    The card stops producing attendance immediately. The assignment is kept in the card
                    history with the reason below, and attendance already recorded with it is untouched.
                </Paragraph>
                <Form form={removeForm} layout="vertical" requiredMark={false}>
                    <Form.Item
                        name="reason" label="Reason"
                        rules={[{ required: true, min: 3, message: 'Give a reason of at least 3 characters' }]}
                    >
                        <Input.TextArea rows={2} placeholder="Card lost; replacement to be issued" />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
