import { useState, useEffect, useCallback } from 'react';
import {
    Table, Button, Tag, Modal, Form, Input, Upload, message,
    Radio, Typography, Divider, Tabs, Badge, Empty,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    BugOutlined, LockOutlined, PlusOutlined, UploadOutlined,
    CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
    FileImageOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import api from '../../api/axios';
import { usePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';
import { useDeepLinkId } from '../../hooks/useDeepLink';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ── Types ─────────────────────────────────────────────────────
interface Ticket {
    id:             string;
    type:           'bug' | 'access_request';
    title:          string;
    description:    string;
    screenshotUrl:  string | null;
    status:         'pending' | 'approved' | 'rejected';
    resolutionNote: string | null;
    resolvedAt:     string | null;
    resolver?:      { id: string; fullName: string; username: string } | null;
    submitter:      { id: string; fullName: string; username: string };
    createdAt:      string;
}

// ── Status badge ─────────────────────────────────────────────
function StatusTag({ status, type }: { status: Ticket['status']; type?: Ticket['type'] }) {
    if (status === 'pending')  return <Tag icon={<ClockCircleOutlined />}  color="warning">Pending</Tag>;
    if (status === 'approved') return <Tag icon={<CheckCircleOutlined />}  color="success">{type === 'bug' ? 'Resolved' : 'Approved'}</Tag>;
    return                            <Tag icon={<CloseCircleOutlined />}  color="error">Rejected</Tag>;
}

// ── Type label ───────────────────────────────────────────────
function TypeTag({ type }: { type: Ticket['type'] }) {
    if (type === 'bug') return <Tag icon={<BugOutlined />} color="error">Bug Report</Tag>;
    return                    <Tag icon={<LockOutlined />} color="processing">Access Request</Tag>;
}

// ── Screenshot preview ───────────────────────────────────────
function ScreenshotButton({ filename }: { filename: string }) {
    const [open, setOpen] = useState(false);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    // If the filename prop changes while the component instance is reused by React,
    // discard the stale cached blob so the next click always fetches the correct image.
    useEffect(() => {
        setBlobUrl(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        setOpen(false);
    }, [filename]);

    // Revoke on unmount (cleanup)
    useEffect(() => {
        return () => { setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; }); };
    }, []);

    const load = async () => {
        // Always fetch fresh — never serve a stale cached blob
        setBlobUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
        try {
            const res = await api.get(`/tickets/screenshot/${filename}`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            setBlobUrl(url);
            setOpen(true);
        } catch {
            message.error('Failed to load screenshot');
        }
    };

    const handleClose = () => {
        setOpen(false);
        // Keep the blob URL in memory so re-opening this same ticket's screenshot
        // doesn't require a re-download; it will be cleared on the next click (fresh fetch).
    };

    return (
        <>
            <Button size="small" icon={<FileImageOutlined />} onClick={load}>
                Screenshot
            </Button>
            <Modal
                open={open}
                onCancel={handleClose}
                footer={null}
                title="Screenshot"
                width={800}
            >
                {blobUrl && <img src={blobUrl} alt="screenshot" style={{ width: '100%', borderRadius: 6 }} />}
            </Modal>
        </>
    );
}

// ── Main Page ────────────────────────────────────────────────
export default function TicketsPage() {
    const deepLinkId = useDeepLinkId('ticketId', 'openTicketId');
    const { hasPermission } = usePermissions();
    const canReviewTickets = hasPermission('manage_users');
    const { t } = useTheme();

    const [myTickets,  setMyTickets]  = useState<Ticket[]>([]);
    const [allTickets, setAllTickets] = useState<Ticket[]>([]);
    const [myLoading,    setMyLoading]    = useState(false);
    const [adminLoading, setAdminLoading] = useState(false);

    const [submitOpen, setSubmitOpen] = useState(false);
    const [resolveOpen, setResolveOpen] = useState(false);
    const [resolveTarget, setResolveTarget] = useState<Ticket | null>(null);
    const [resolveStatus, setResolveStatus] = useState<'approved' | 'rejected'>('approved');
    const [viewTicket, setViewTicket] = useState<Ticket | null>(null);

    const [form]        = Form.useForm();
    const [resolveForm] = Form.useForm();
    const [fileList, setFileList] = useState<UploadFile[]>([]);
    const [submitting, setSubmitting] = useState(false);

    // ── Fetch my tickets ─────────────────────────────────────
    const fetchMine = useCallback(async () => {
        setMyLoading(true);
        try {
            const res = await api.get('/tickets/mine');
            setMyTickets(res.data);
        } catch { /* ignore */ } finally {
            setMyLoading(false);
        }
    }, []);

    // ── Fetch all tickets (reviewer view) ────────────────────
    const fetchAll = useCallback(async () => {
        if (!canReviewTickets) return;
        setAdminLoading(true);
        try {
            const res = await api.get('/tickets');
            setAllTickets(res.data);
        } catch { /* ignore */ } finally {
            setAdminLoading(false);
        }
    }, [canReviewTickets]);

    useEffect(() => {
        fetchMine();
        fetchAll();
    }, [fetchMine, fetchAll]);

    // Deep-link: open a specific ticket when navigated here from a notification click
    useEffect(() => {
        const openId = deepLinkId;
        if (!openId) return;
        const found = [...myTickets, ...allTickets].find((t) => t.id === openId);
        if (found) setViewTicket(found);
    }, [deepLinkId, myTickets, allTickets]);

    // ── Submit handler ───────────────────────────────────────
    const handleSubmit = async () => {
        try {
            const values = await form.validateFields();
            setSubmitting(true);
            const fd = new FormData();
            fd.append('type',        values.type);
            fd.append('title',       values.title);
            fd.append('description', values.description);
            if (fileList[0]?.originFileObj) {
                fd.append('screenshot', fileList[0].originFileObj as File);
            }
            await api.post('/tickets', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            message.success('Ticket submitted successfully');
            form.resetFields();
            setFileList([]);
            setSubmitOpen(false);
            fetchMine();
            if (canReviewTickets) fetchAll();
        } catch (err: any) {
            if (err?.errorFields) return; // validation error
            message.error(err?.response?.data?.message ?? 'Failed to submit ticket');
        } finally {
            setSubmitting(false);
        }
    };

    // ── Resolve handler ──────────────────────────────────────
    const handleResolve = async () => {
        if (!resolveTarget) return;
        try {
            const values = await resolveForm.validateFields();
            await api.patch(`/tickets/${resolveTarget.id}/resolve`, {
                status:         resolveStatus,
                resolutionNote: values.resolutionNote ?? undefined,
            });
            message.success(`Ticket ${resolveStatus}`);
            resolveForm.resetFields();
            setResolveOpen(false);
            setResolveTarget(null);
            fetchAll();
            fetchMine();
        } catch (err: any) {
            if (err?.errorFields) return;
            message.error(err?.response?.data?.message ?? 'Failed to resolve ticket');
        }
    };

    const openResolve = (ticket: Ticket, status: 'approved' | 'rejected') => {
        setResolveTarget(ticket);
        setResolveStatus(status);
        resolveForm.resetFields();
        setResolveOpen(true);
    };

    // ── My tickets columns ───────────────────────────────────
    const myColumns: ColumnsType<Ticket> = [
        {
            title: 'Type', dataIndex: 'type', width: 140,
            render: (v) => <TypeTag type={v} />,
        },
        {
            title: 'Title', dataIndex: 'title',
            render: (v, r) => (
                <span
                    style={{ color: t.accent, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setViewTicket(r)}
                >
                    {v}
                </span>
            ),
        },
        {
            title: 'Status', dataIndex: 'status', width: 130,
            render: (v, r) => <StatusTag status={v} type={r.type} />,
        },
        {
            title: 'Screenshot', dataIndex: 'screenshotUrl', width: 120,
            render: (v) => v ? <ScreenshotButton filename={v} /> : <Text type="secondary">—</Text>,
        },
        {
            title: 'Submitted', dataIndex: 'createdAt', width: 130,
            render: (v) => new Date(v).toLocaleDateString(),
        },
        ...[{
            title: '' as const, width: 80,
            render: (_: unknown, r: Ticket) => (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setViewTicket(r)}
                    style={{ borderColor: t.border, color: t.textMuted }}>
                    View
                </Button>
            ),
        }],
    ];

    // ── All tickets columns (reviewer) ───────────────────────
    const adminColumns: ColumnsType<Ticket> = [
        {
            title: 'Type', dataIndex: 'type', width: 140,
            render: (v) => <TypeTag type={v} />,
        },
        {
            title: 'Title', dataIndex: 'title',
            render: (v, r) => (
                <span
                    style={{ color: t.accent, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setViewTicket(r)}
                >
                    {v}
                </span>
            ),
        },
        {
            title: 'Submitter', dataIndex: ['submitter', 'fullName'], width: 160,
        },
        {
            title: 'Status', dataIndex: 'status', width: 130,
            render: (v, r) => <StatusTag status={v} type={r.type} />,
            filters: [
                { text: 'Pending',           value: 'pending' },
                { text: 'Approved / Resolved', value: 'approved' },
                { text: 'Rejected',          value: 'rejected' },
            ],
            onFilter: (v, r) => r.status === v,
        },
        {
            title: 'Screenshot', dataIndex: 'screenshotUrl', width: 120,
            render: (v) => v ? <ScreenshotButton filename={v} /> : <Text type="secondary">—</Text>,
        },
        {
            title: 'Submitted', dataIndex: 'createdAt', width: 120,
            render: (v) => new Date(v).toLocaleDateString(),
        },
        {
            title: '', width: 70,
            render: (_, r) => (
                <Button size="small" icon={<EyeOutlined />} onClick={() => setViewTicket(r)}
                    style={{ borderColor: t.border, color: t.textMuted }}>
                    View
                </Button>
            ),
        },
        {
            title: 'Actions', width: 160,
            render: (_, r) => (
                <div style={{ display: 'flex', gap: 6, minWidth: 140, visibility: r.status === 'pending' ? 'visible' : 'hidden' }}>
                    <Button
                        size="small" type="primary"
                        icon={<CheckCircleOutlined />}
                        onClick={() => openResolve(r, 'approved')}
                        style={{ background: t.success, border: 'none' }}
                    >
                        {r.type === 'bug' ? 'Resolve' : 'Approve'}
                    </Button>
                    <Button
                        size="small" danger
                        icon={<CloseCircleOutlined />}
                        onClick={() => openResolve(r, 'rejected')}
                    >
                        Reject
                    </Button>
                </div>
            ),
        },
    ];

    const pendingCount  = allTickets.filter(t => t.status === 'pending').length;
    const resolvedCount = allTickets.filter(t => t.status === 'approved').length;
    const rejectedCount = allTickets.filter(t => t.status === 'rejected').length;
    const totalCount    = allTickets.length;

    // ── Reviewer stats bar ───────────────────────────────────
    const ReviewerStatsBar = () => {
        const resolvedPct = totalCount ? Math.round((resolvedCount / totalCount) * 100) : 0;
        const rejectedPct = totalCount ? Math.round((rejectedCount / totalCount) * 100) : 0;
        const pendingPct  = totalCount ? 100 - resolvedPct - rejectedPct : 0;

        return (
            <div style={{
                background: t.surfaceRaised,
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: '16px 20px',
                marginBottom: 20,
            }}>
                {/* Stat cards row */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
                    {[
                        { label: 'Total Submitted', value: totalCount,    color: t.accent   },
                        { label: 'Resolved / Approved', value: resolvedCount, color: t.success  },
                        { label: 'Rejected',         value: rejectedCount, color: t.danger    },
                        { label: 'Pending',          value: pendingCount,  color: t.warning },
                    ].map(({ label, value, color }) => (
                        <div key={label} style={{
                            flex: '1 1 120px',
                            background: t.surface,
                            border: `1px solid ${alpha(color, 0.2)}`,
                            borderRadius: 8,
                            padding: '10px 14px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
                            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 3 }}>{label}</div>
                        </div>
                    ))}
                </div>

                {/* Stacked progress bar */}
                {totalCount > 0 && (
                    <>
                        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 10, background: t.border }}>
                            {resolvedPct > 0 && (
                                <div style={{ width: `${resolvedPct}%`, background: t.success, transition: 'width 0.4s ease' }} />
                            )}
                            {rejectedPct > 0 && (
                                <div style={{ width: `${rejectedPct}%`, background: t.danger, transition: 'width 0.4s ease' }} />
                            )}
                            {pendingPct > 0 && (
                                <div style={{ width: `${pendingPct}%`, background: t.warning, transition: 'width 0.4s ease' }} />
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
                            {[
                                { label: `Resolved/Approved ${resolvedPct}%`, color: t.success  },
                                { label: `Rejected ${rejectedPct}%`,          color: t.danger    },
                                { label: `Pending ${pendingPct}%`,            color: t.warning },
                            ].map(({ label, color }) => (
                                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: t.textMuted }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                                    {label}
                                </span>
                            ))}
                        </div>
                    </>
                )}
                {totalCount === 0 && (
                    <div style={{ textAlign: 'center', color: t.textMuted, fontSize: 13, paddingTop: 4 }}>No tickets submitted yet</div>
                )}
            </div>
        );
    };

    // ── panels for Tabs ──────────────────────────────────────
    const tabItems = [
        {
            key:      'mine',
            label:    'My Tickets',
            children: (
                <>
                    <div style={{ marginBottom: 16 }}>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => { form.resetFields(); setFileList([]); setSubmitOpen(true); }}
                            style={{ background: t.accent, border: 'none' }}
                        >
                            New Ticket
                        </Button>
                    </div>
                    <Table<Ticket>
                        dataSource={myTickets}
                        columns={myColumns}
                        rowKey="id"
                        loading={myLoading}
                        pagination={{ pageSize: 10 }}
                        locale={{ emptyText: <Empty description="No tickets submitted yet" /> }}
                    />
                </>
            ),
        },
        ...(canReviewTickets ? [{
            key:   'admin',
            label: (
                <span>
                    All Tickets&nbsp;
                    {pendingCount > 0 && <Badge count={pendingCount} size="small" />}
                </span>
            ),
            children: (
                <>
                    <ReviewerStatsBar />
                    <Table<Ticket>
                        dataSource={allTickets}
                        columns={adminColumns}
                        rowKey="id"
                        loading={adminLoading}
                    pagination={{ pageSize: 15 }}
                    locale={{ emptyText: <Empty description="No tickets found" /> }}
                />
                </>
            ),
        }] : []),
    ];

    return (
        <div style={{ padding: '0 24px 40px', maxWidth: 1200, margin: '0 auto' }}>
            {/* ── Page header ── */}
            <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <div style={{
                        width: 42, height: 42, borderRadius: 10,
                        background: alpha(t.danger, 0.1),
                        border: `1px solid ${alpha(t.danger, 0.2)}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: t.danger, fontSize: 22,
                    }}>
                        <BugOutlined />
                    </div>
                    <div>
                        <Title level={3} style={{ margin: 0, color: t.text }}>Support Tickets</Title>
                        <Text style={{ color: t.textMuted, fontSize: 13 }}>
                            Report a bug or request access to resources
                        </Text>
                    </div>
                </div>
            </div>

            <Divider style={{ borderColor: t.border, margin: '0 0 24px' }} />

            {/* ── Tabs ── */}
            <div style={{
                background: t.surface,
                border:     `1px solid ${t.border}`,
                borderRadius: 10,
                padding: '20px 24px',
            }}>
                <Tabs items={tabItems} defaultActiveKey="mine" />
            </div>

            {/* ── Submit Modal ── */}
            <FormModal
                open={submitOpen}
                onCancel={() => setSubmitOpen(false)}
                title="Submit a Ticket"
                onOk={handleSubmit}
                okText="Submit"
                confirmLoading={submitting}
                width={580}
            >
                <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
                    <Form.Item
                        name="type"
                        label="Ticket Type"
                        rules={[{ required: true, message: 'Please select a type' }]}
                    >
                        <Radio.Group>
                            <Radio.Button value="bug">
                                <BugOutlined /> Bug Report
                            </Radio.Button>
                            <Radio.Button value="access_request">
                                <LockOutlined /> Access Request
                            </Radio.Button>
                        </Radio.Group>
                    </Form.Item>

                    <Form.Item
                        name="title"
                        label="Title"
                        rules={[{ required: true, message: 'Please provide a title' }]}
                    >
                        <Input placeholder="Brief summary of the issue or request" maxLength={200} />
                    </Form.Item>

                    <Form.Item
                        name="description"
                        label="Description"
                        rules={[{ required: true, message: 'Please describe the issue' }]}
                    >
                        <TextArea
                            rows={5}
                            placeholder="Describe the bug or what access you need and why..."
                            maxLength={4000}
                            showCount
                        />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, cur) => prev.type !== cur.type}
                    >
                        {({ getFieldValue }) =>
                            getFieldValue('type') === 'bug' ? (
                                <Form.Item name="screenshot" label="Screenshot (optional)">
                                    <Upload
                                        fileList={fileList}
                                        beforeUpload={() => false}
                                        accept="image/*"
                                        maxCount={1}
                                        onChange={({ fileList: fl }) => setFileList(fl)}
                                        listType="picture"
                                    >
                                        <Button icon={<UploadOutlined />}>Attach Screenshot</Button>
                                    </Upload>
                                </Form.Item>
                            ) : null
                        }
                    </Form.Item>
                </Form>
            </FormModal>

            {/* ── View Details Modal ── */}
            <Modal
                open={!!viewTicket}
                onCancel={() => setViewTicket(null)}
                footer={null}
                title={
                    viewTicket && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <TypeTag type={viewTicket.type} />
                            <span style={{ fontWeight: 700 }}>{viewTicket.title}</span>
                        </div>
                    )
                }
                width={640}
                styles={{
                    header:  { background: t.surface, borderBottom: `1px solid ${t.border}` },
                    body:    { background: t.surface },
                }}
            >
                {viewTicket && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
                        {/* Meta row */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <StatusTag status={viewTicket.status} />
                            {canReviewTickets && (
                                <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                    Submitted by <strong style={{ color: t.text }}>{viewTicket.submitter?.fullName}</strong>
                                    {' '}(@{viewTicket.submitter?.username})
                                </Text>
                            )}
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                {new Date(viewTicket.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </Text>
                        </div>

                        {/* Description */}
                        <div style={{ background: t.surfaceRaised, border: `1px solid ${t.border}`, borderRadius: 8, padding: '12px 16px' }}>
                            <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                Description
                            </Text>
                            <Text style={{ color: t.text, fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                                {viewTicket.description}
                            </Text>
                        </div>

                        {/* Screenshot */}
                        {viewTicket.screenshotUrl && (
                            <div>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Screenshot
                                </Text>
                                <ScreenshotButton filename={viewTicket.screenshotUrl} />
                            </div>
                        )}

                        {/* Resolution */}
                        {(viewTicket.status !== 'pending') && (
                            <div style={{
                                background: viewTicket.status === 'approved' ? alpha(t.success, 0.08) : alpha(t.danger, 0.08),
                                border: `1px solid ${viewTicket.status === 'approved' ? alpha(t.success, 0.28) : alpha(t.danger, 0.28)}`,
                                borderRadius: 8, padding: '12px 16px',
                            }}>
                                <Text style={{
                                    color: viewTicket.status === 'approved' ? t.success : t.danger,
                                    fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4,
                                }}>
                                    {viewTicket.type === 'bug' && viewTicket.status === 'approved' ? '✓ Resolved' : viewTicket.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                                    {viewTicket.resolvedAt && ` — ${new Date(viewTicket.resolvedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                                    {viewTicket.resolver && (
                                        <span style={{ color: t.textMuted, fontWeight: 400, marginLeft: 6 }}>
                                            by {viewTicket.resolver.fullName}
                                        </span>
                                    )}
                                </Text>
                                {viewTicket.resolutionNote && (
                                    <Text style={{ color: t.text, fontSize: 13, whiteSpace: 'pre-wrap' }}>
                                        {viewTicket.resolutionNote}
                                    </Text>
                                )}
                            </div>
                        )}

                        {/* Reviewer resolve buttons (shown inside modal when pending) */}
                        {canReviewTickets && viewTicket.status === 'pending' && (
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
                                <Button
                                    icon={<CloseCircleOutlined />} danger
                                    onClick={() => { setViewTicket(null); openResolve(viewTicket, 'rejected'); }}
                                >
                                    Reject
                                </Button>
                                <Button
                                    type="primary" icon={<CheckCircleOutlined />}
                                    onClick={() => { setViewTicket(null); openResolve(viewTicket, 'approved'); }}
                                    style={{ background: t.success, border: 'none' }}
                                >
                                    {viewTicket.type === 'bug' ? 'Resolve' : 'Approve'}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            {/* ── Resolve Modal ── */}
            <FormModal
                open={resolveOpen}
                onCancel={() => { setResolveOpen(false); setResolveTarget(null); }}
                title={resolveStatus === 'approved'
                    ? (resolveTarget?.type === 'bug' ? 'Resolve Ticket' : 'Approve Ticket')
                    : 'Reject Ticket'}
                onOk={handleResolve}
                okText={resolveStatus === 'approved' ? (resolveTarget?.type === 'bug' ? 'Resolve' : 'Approve') : 'Reject'}
                danger={resolveStatus === 'rejected'}
                width={500}
            >
                {resolveTarget && (
                    <div style={{
                        background: t.surfaceRaised, border: `1px solid ${t.border}`,
                        borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13,
                    }}>
                        <div><TypeTag type={resolveTarget.type} /></div>
                        <div style={{ color: t.text, fontWeight: 600, marginTop: 6 }}>{resolveTarget.title}</div>
                        <div style={{ color: t.textMuted, marginTop: 4 }}>{resolveTarget.description}</div>
                    </div>
                )}
                <Form form={resolveForm} layout="vertical">
                    <Form.Item
                        name="resolutionNote"
                        label="Resolution Note (optional)"
                    >
                        <TextArea rows={3} placeholder="Add a note for the submitter..." maxLength={1000} />
                    </Form.Item>
                </Form>
            </FormModal>
        </div>
    );
}
