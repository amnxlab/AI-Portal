import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useDeepLinkId } from '../../hooks/useDeepLink';
import {
    Typography, Spin, Button, Tag, Space, Select, message, Empty, Upload,
    Card, Row, Col, Badge, Popconfirm, Table, Tooltip, Input, Progress, Tabs,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
    PlayCircleOutlined, EyeOutlined, DownloadOutlined, DeleteOutlined,
    CheckCircleOutlined, ClockCircleOutlined, UploadOutlined,
    VideoCameraOutlined, FilePdfOutlined, PlusOutlined,
    EditOutlined, SearchOutlined,
    CloseCircleOutlined, CaretRightOutlined, LinkOutlined, YoutubeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import CommentThread from '../../components/CommentThread';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';

const { Title, Text } = Typography;
const { TextArea } = Input;

// ── Types ─────────────────────────────────────────────────────
interface Project { id: string; name: string; }

interface VideoPlaylist {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    sortOrder: number;
    createdBy: string | null;
    creator?: { id: string; fullName: string } | null;
    mediaCount?: number;
    createdAt: string;
    updatedAt: string;
}

interface MediaItem {
    id: string;
    playlistId: string;
    projectId: string;
    uploaderId: string | null;
    filename: string | null;
    originalName: string | null;
    fileSize: number;
    mimeType: string | null;
    mediaType: 'video' | 'pdf' | 'youtube';
    status: 'pending' | 'approved' | 'rejected';
    title: string;
    description: string | null;
    sortOrder: number;
    durationSeconds: number | null;
    externalUrl: string | null;
    createdAt: string;
    updatedAt: string;
    uploader?: { id: string; fullName: string } | null;
    playlist?: VideoPlaylist & { project?: Project };
}

function sizeLabel(bytes: number) {
    if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

/** Convert any YouTube URL to an embed URL for the iframe. Returns as-is for non-YouTube URLs. */
function toEmbedUrl(url: string): string {
    const patterns = [
        /(?:youtube\.com\/watch\?(?:.*&)?v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0`;
    }
    return url;
}

export default function VideoTutorialsPage() {
    const { user } = useAuthStore();
    const { hasPermission } = usePermissions();
    const location = useLocation();
    const deepLinkMediaId = useDeepLinkId('mediaId', 'openMediaId');
    const canManage = hasPermission('manage_projects');
    const canCreatePlaylists = hasPermission('lead_projects');
    const { t } = useTheme();

    // ── State ────────────────────────────────────────────────────
    const [loading, setLoading] = useState(true);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [playlists, setPlaylists] = useState<VideoPlaylist[]>([]);
    const [selectedPlaylist, setSelectedPlaylist] = useState<VideoPlaylist | null>(null);
    const [media, setMedia] = useState<MediaItem[]>([]);
    const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);

    // Pending review (reviewer)
    const [pending, setPending] = useState<MediaItem[]>([]);
    const [myPending, setMyPending] = useState<MediaItem[]>([]);

    // Modals
    const [uploadModal, setUploadModal] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [playlistModal, setPlaylistModal] = useState(false);
    const [editPlaylist, setEditPlaylist] = useState<VideoPlaylist | null>(null);
    const [editMediaModal, setEditMediaModal] = useState(false);
    const [editMediaItem, setEditMediaItem] = useState<MediaItem | null>(null);

    // Form state
    const [plTitle, setPlTitle] = useState('');
    const [plDesc, setPlDesc] = useState('');
    const [uploadTitle, setUploadTitle] = useState('');
    const [uploadDesc, setUploadDesc] = useState('');
    const [uploadFile, setUploadFile] = useState<File | null>(null);
    const [editMTitle, setEditMTitle] = useState('');
    const [editMDesc, setEditMDesc] = useState('');

    // Upload modal mode
    const [uploadMode, setUploadMode] = useState<'file' | 'link'>('file');
    const [linkUrl, setLinkUrl] = useState('');
    const [linkTitle, setLinkTitle] = useState('');
    const [linkDesc, setLinkDesc] = useState('');

    // Tab
    const [activeTab, setActiveTab] = useState('tutorials');

    // Search
    const [searchText, setSearchText] = useState('');

    // Users for @mention in discussion threads
    const [allUsers, setAllUsers] = useState<{ id: string; fullName: string; role: string; avatarUrl?: string | null }[]>([]);

    // Video player
    const videoRef = useRef<HTMLVideoElement>(null);

    // ── Data loading ─────────────────────────────────────────────
    const loadProjects = useCallback(async () => {
        try {
            const res = await api.get('/projects');
            setProjects(res.data);
            return res.data as Project[];
        } catch { return []; }
    }, []);

    const loadPlaylists = useCallback(async (projectId: string) => {
        try {
            const res = await api.get('/video-tutorials/playlists', { params: { projectId } });
            setPlaylists(res.data);
        } catch { setPlaylists([]); }
    }, []);

    const loadPlaylistMedia = useCallback(async (playlistId: string) => {
        try {
            const res = await api.get(`/video-tutorials/playlists/${playlistId}`);
            const pl = res.data;
            setSelectedPlaylist(pl);
            setMedia(pl.media ?? []);
            if (pl.media?.length > 0 && !activeMedia) {
                setActiveMedia(pl.media[0]);
            }
        } catch { /* silent */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadPending = useCallback(async () => {
        if (!canManage) return;
        try {
            const res = await api.get('/video-tutorials/media/pending');
            setPending(res.data);
        } catch { /* silent */ }
    }, [canManage]);

    const loadMyPending = useCallback(async () => {
        try {
            const res = await api.get('/video-tutorials/media/my-pending');
            setMyPending(res.data);
        } catch { /* silent */ }
    }, []);

    // Initial load
    useEffect(() => {
        (async () => {
            setLoading(true);
            const projs = await loadProjects();
            await loadPending();
            await loadMyPending();
            if (projs.length > 0) {
                setSelectedProjectId(projs[0].id);
                await loadPlaylists(projs[0].id);
            }
            setLoading(false);
        })();
        // Load all users once for @mention
        api.get('/users').then((r) => setAllUsers(r.data)).catch(() => {});
    }, [loadProjects, loadPlaylists, loadPending, loadMyPending]);

    // When project changes, load playlists
    useEffect(() => {
        if (selectedProjectId) {
            loadPlaylists(selectedProjectId);
            setSelectedPlaylist(null);
            setMedia([]);
            setActiveMedia(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProjectId]);

    // Deep link from notification (openMediaId + optional scrollToDiscussion)
    useEffect(() => {
        const state = location.state as any;
        // The URL first: router state does not survive a reload or the
        // redirect back from login, which is when notification links are
        // usually followed.
        const openId = deepLinkMediaId ?? state?.openMediaId;
        if (!openId) return;
        (async () => {
            try {
                // Use in-memory lookup first, fall back to direct API fetch
                let found: MediaItem | undefined =
                    pending.find((m) => m.id === openId) ??
                    media.find((m) => m.id === openId);
                if (!found) {
                    const res = await api.get(`/video-tutorials/media/${openId}`);
                    found = res.data as MediaItem;
                }
                if (found) {
                    // Ensure the right playlist is loaded
                    if (found.playlistId && selectedPlaylist?.id !== found.playlistId) {
                        await loadPlaylistMedia(found.playlistId);
                    }
                    setActiveMedia(found);
                    setActiveTab('tutorials');
                    if (state?.scrollToDiscussion) {
                        setTimeout(() => {
                            document.getElementById(`discussion-${openId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 400);
                    }
                }
            } catch { /* silent */ }
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state, deepLinkMediaId]);

    // ── Handlers ─────────────────────────────────────────────────
    const handleSelectPlaylist = async (pl: VideoPlaylist) => {
        setActiveMedia(null);
        await loadPlaylistMedia(pl.id);
    };

    const handleCreateOrEditPlaylist = async () => {
        if (!plTitle.trim()) { message.warning('Title is required'); return; }
        try {
            if (editPlaylist) {
                await api.patch(`/video-tutorials/playlists/${editPlaylist.id}`, {
                    title: plTitle,
                    description: plDesc || undefined,
                });
                message.success('Playlist updated');
            } else {
                await api.post('/video-tutorials/playlists', {
                    projectId: selectedProjectId,
                    title: plTitle,
                    description: plDesc || undefined,
                });
                message.success('Playlist created');
            }
            setPlaylistModal(false);
            setEditPlaylist(null);
            setPlTitle('');
            setPlDesc('');
            if (selectedProjectId) loadPlaylists(selectedProjectId);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    const handleDeletePlaylist = async (id: string) => {
        try {
            await api.delete(`/video-tutorials/playlists/${id}`);
            message.success('Playlist deleted');
            if (selectedPlaylist?.id === id) {
                setSelectedPlaylist(null);
                setMedia([]);
                setActiveMedia(null);
            }
            if (selectedProjectId) loadPlaylists(selectedProjectId);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const handleUpload = async () => {
        if (!uploadFile || !uploadTitle.trim() || !selectedPlaylist) return;
        const formData = new FormData();
        // Text fields must come BEFORE the file so req.body is populated
        // when Multer's destination callback fires
        formData.append('projectId', selectedPlaylist.projectId);
        formData.append('title', uploadTitle);
        if (uploadDesc) formData.append('description', uploadDesc);
        formData.append('file', uploadFile);

        setUploading(true);
        setUploadProgress(0);
        try {
            await api.post(`/video-tutorials/playlists/${selectedPlaylist.id}/media`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (e) => {
                    if (e.total) setUploadProgress(Math.round((e.loaded * 100) / e.total));
                },
            });
            message.success(canManage ? 'Media uploaded and approved' : 'Media uploaded — pending review');
            setUploadModal(false);
            setUploadFile(null);
            setUploadTitle('');
            setUploadDesc('');
            setUploadProgress(0);
            loadPlaylistMedia(selectedPlaylist.id);
            loadPending();
            loadMyPending();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    const handleAddLink = async () => {
        if (!linkUrl.trim() || !linkTitle.trim() || !selectedPlaylist) return;
        try {
            await api.post(`/video-tutorials/playlists/${selectedPlaylist.id}/media/link`, {
                projectId:   selectedPlaylist.projectId,
                title:       linkTitle.trim(),
                description: linkDesc || undefined,
                externalUrl: linkUrl.trim(),
            });
            message.success(canManage ? 'Link added' : 'Link submitted — pending review');
            setUploadModal(false);
            setLinkUrl('');
            setLinkTitle('');
            setLinkDesc('');
            loadPlaylistMedia(selectedPlaylist.id);
            loadPending();
            loadMyPending();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to add link');
        }
    };

    const handleApprove = async (id: string) => {
        try {
            await api.patch(`/video-tutorials/media/${id}/approve`);
            message.success('Media approved');
            loadPending();
            if (selectedPlaylist) loadPlaylistMedia(selectedPlaylist.id);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    const handleReject = async (id: string) => {
        try {
            await api.delete(`/video-tutorials/media/${id}/reject`);
            message.success('Media rejected');
            loadPending();
            if (selectedPlaylist) loadPlaylistMedia(selectedPlaylist.id);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    const handleDeleteMedia = async (id: string) => {
        try {
            await api.delete(`/video-tutorials/media/${id}`);
            message.success('Media deleted');
            if (activeMedia?.id === id) setActiveMedia(null);
            if (selectedPlaylist) loadPlaylistMedia(selectedPlaylist.id);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Delete failed');
        }
    };

    const handleEditMedia = async () => {
        if (!editMediaItem || !editMTitle.trim()) return;
        try {
            await api.patch(`/video-tutorials/media/${editMediaItem.id}`, {
                title: editMTitle,
                description: editMDesc || undefined,
            });
            message.success('Media updated');
            setEditMediaModal(false);
            setEditMediaItem(null);
            if (selectedPlaylist) loadPlaylistMedia(selectedPlaylist.id);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed');
        }
    };

    const openEditMedia = (m: MediaItem) => {
        setEditMediaItem(m);
        setEditMTitle(m.title);
        setEditMDesc(m.description ?? '');
        setEditMediaModal(true);
    };

    const handleDownload = (m: MediaItem) => {
        if (m.externalUrl) return; // nothing to download for external links
        const token = useAuthStore.getState().accessToken;
        const a = document.createElement('a');
        a.href = `/api/video-tutorials/media/serve/${m.id}?token=${token}`;
        a.download = m.originalName ?? m.title;
        a.click();
    };

    const getStreamUrl = (m: MediaItem) => {
        const token = useAuthStore.getState().accessToken;
        return `/api/video-tutorials/media/serve/${m.id}?token=${token}`;
    };

    // ── Pending table columns (reviewer) ─────────────────────────
    const pendingColumns: TableColumnsType<MediaItem> = [
        {
            title: 'Title',
            dataIndex: 'title',
            render: (title: string, rec) => (
                <Space>
                    {rec.externalUrl
                        ? <YoutubeOutlined style={{ color: t.danger }} />
                        : rec.mediaType === 'video'
                            ? <VideoCameraOutlined style={{ color: t.accent }} />
                            : <FilePdfOutlined style={{ color: t.danger }} />}
                    <Text style={{ color: t.text, fontWeight: 500 }}>{title}</Text>
                </Space>
            ),
        },
        {
            title: 'Playlist',
            render: (_: any, rec) => (
                <Text style={{ color: t.textMuted }}>{rec.playlist?.title ?? '—'}</Text>
            ),
        },
        {
            title: 'Project',
            render: (_: any, rec) => (
                <Text style={{ color: t.textMuted }}>{rec.playlist?.project?.name ?? '—'}</Text>
            ),
        },
        {
            title: 'Uploaded by',
            render: (_: any, rec) => (
                <Text style={{ color: t.textMuted }}>{rec.uploader?.fullName ?? '—'}</Text>
            ),
        },
        {
            title: 'Date',
            dataIndex: 'createdAt',
            render: (d: string) => <Text style={{ color: t.textMuted }}>{dayjs(d).format('MMM D, YYYY')}</Text>,
        },
        {
            title: 'Size',
            dataIndex: 'fileSize',
            render: (s: number, rec) => <Text style={{ color: t.textMuted }}>{rec.externalUrl ? '—' : sizeLabel(s)}</Text>,
        },
        {
            title: 'Actions',
            align: 'right' as const,
            render: (_: any, rec: MediaItem) => (
                <Space size={4}>
                    <Tooltip title="Approve">
                        <Button type="text" size="small" icon={<CheckCircleOutlined />}
                            style={{ color: t.success }}
                            onClick={() => handleApprove(rec.id)} />
                    </Tooltip>
                    <Tooltip title="Preview">
                        <Button type="text" size="small" icon={<EyeOutlined />}
                            style={{ color: t.accent }}
                            onClick={() => {
                                // Switch to tutorials tab, select the right playlist & media
                                setActiveMedia(rec);
                                setActiveTab('tutorials');
                            }} />
                    </Tooltip>
                    {!rec.externalUrl && (
                        <Tooltip title="Download">
                            <Button type="text" size="small" icon={<DownloadOutlined />}
                                style={{ color: t.purple }}
                                onClick={() => handleDownload(rec)} />
                        </Tooltip>
                    )}
                    <Popconfirm title="Reject & delete this media?" onConfirm={() => handleReject(rec.id)} okText="Reject" okButtonProps={{ danger: true }}>
                        <Tooltip title="Reject">
                            <Button type="text" size="small" icon={<CloseCircleOutlined />}
                                style={{ color: t.danger }} />
                        </Tooltip>
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    // ── Render ────────────────────────────────────────────────────
    if (loading) return <Spin size="large" style={{ display: 'flex', justifyContent: 'center', marginTop: 120 }} />;

    const filteredMedia = searchText
        ? media.filter((m) => m.title.toLowerCase().includes(searchText.toLowerCase()) ||
            (m.originalName ?? '').toLowerCase().includes(searchText.toLowerCase()))
        : media;

    return (
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                    <Title level={3} style={{ color: t.text, margin: 0 }}>
                        <VideoCameraOutlined style={{ marginRight: 10, color: t.accent }} />
                        Video Tutorials
                    </Title>
                    <Text style={{ color: t.textMuted }}>Playlist-based learning system for lab equipment and workflows</Text>
                </div>
            </div>

            {/* Stat Cards */}
            <Row gutter={16} style={{ marginBottom: 24 }}>
                <Col span={8}>
                    <Card size="small" style={{ background: t.surface, borderColor: t.border, borderRadius: 10 }}>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>Total Playlists</Text>
                        <div style={{ color: t.text, fontSize: 24, fontWeight: 700 }}>{playlists.length}</div>
                    </Card>
                </Col>
                <Col span={8}>
                    <Card size="small" style={{ background: t.surface, borderColor: t.border, borderRadius: 10 }}>
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>Media Items</Text>
                        <div style={{ color: t.text, fontSize: 24, fontWeight: 700 }}>{media.length}</div>
                    </Card>
                </Col>
                {canManage && (
                    <Col span={8}>
                        <Card size="small" style={{
                            background: pending.length > 0 ? t.warningBg : t.surface,
                            borderColor: pending.length > 0 ? t.warning : t.border,
                            borderRadius: 10,
                        }}>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Pending Review</Text>
                            <div style={{ color: pending.length > 0 ? t.warning : t.text, fontSize: 24, fontWeight: 700 }}>
                                {pending.length}
                            </div>
                        </Card>
                    </Col>
                )}
                {!canManage && myPending.length > 0 && (
                    <Col span={8}>
                        <Card size="small" style={{ background: t.warningBg, borderColor: t.warning, borderRadius: 10 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Your Pending</Text>
                            <div style={{ color: t.warning, fontSize: 24, fontWeight: 700 }}>{myPending.length}</div>
                        </Card>
                    </Col>
                )}
            </Row>

            {/* Tabs: Tutorials / Pending Review */}
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                items={[
                    { key: 'tutorials', label: 'Tutorials' },
                    ...(canManage ? [{
                        key: 'pending',
                        label: (
                            <Badge count={pending.length} size="small" offset={[8, -2]}>
                                Pending Review
                            </Badge>
                        ),
                    }] : []),
                ]}
                style={{ marginBottom: 16 }}
            />

            {activeTab === 'pending' && canManage && (
                <Card style={{ background: t.surface, borderColor: t.border, borderRadius: 10 }}>
                    <Table<MediaItem>
                        columns={pendingColumns}
                        dataSource={pending}
                        rowKey="id"
                        size="small"
                        pagination={false}
                        locale={{ emptyText: <Empty description="No pending media" /> }}
                        style={{ background: 'transparent' }}
                    />
                </Card>
            )}

            {activeTab === 'tutorials' && (
                <>
                    {/* ── Top bar: Project + Playlist selectors ── */}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Project</Text>
                            <Select
                                value={selectedProjectId}
                                onChange={(val) => setSelectedProjectId(val)}
                                style={{ width: 220 }}
                                options={projects.map((p) => ({ value: p.id, label: p.name }))}
                                placeholder="Select project"
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Playlist</Text>
                            <Select
                                value={selectedPlaylist?.id ?? null}
                                onChange={(val) => {
                                    const pl = playlists.find((p) => p.id === val);
                                    if (pl) handleSelectPlaylist(pl);
                                }}
                                style={{ width: 260 }}
                                options={playlists.map((p) => ({ value: p.id, label: p.title }))}
                                placeholder={selectedProjectId ? 'Select playlist' : 'Select a project first'}
                                disabled={!selectedProjectId || playlists.length === 0}
                            />
                        </div>
                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                            {canCreatePlaylists && selectedProjectId && (
                                <Button icon={<PlusOutlined />} size="small"
                                    onClick={() => { setEditPlaylist(null); setPlTitle(''); setPlDesc(''); setPlaylistModal(true); }}
                                    style={{ borderRadius: 6 }}>
                                    New Playlist
                                </Button>
                            )}
                            {selectedPlaylist && (
                                <Button type="primary" icon={<UploadOutlined />} size="small"
                                    onClick={() => setUploadModal(true)}
                                    style={{ borderRadius: 6, background: t.accent, borderColor: t.accent }}>
                                    Upload
                                </Button>
                            )}
                        </div>
                    </div>

                    {!selectedPlaylist ? (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            minHeight: 400, borderRadius: 12,
                            background: t.surface, border: `1px solid ${t.border}`,
                            flexDirection: 'column', gap: 12,
                        }}>
                            <VideoCameraOutlined style={{ fontSize: 52, color: t.border }} />
                            <Text style={{ color: t.textMuted, fontSize: 15 }}>
                                {!selectedProjectId ? 'Select a project to get started' : 'Select a playlist to start watching'}
                            </Text>
                        </div>
                    ) : (
                        /* ── YouTube-style layout: player (left) + queue (right) ── */
                        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>

                            {/* ── Left: Player + Info ── */}
                            <div style={{ flex: 1, minWidth: 0 }}>

                                {/* 16:9 Video player */}
                                <div style={{
                                    position: 'relative',
                                    width: '100%',
                                    paddingBottom: '56.25%',
                                    background: 'black',
                                    borderRadius: 12,
                                    overflow: 'hidden',
                                    marginBottom: 0,
                                }}>
                                    {activeMedia ? (
                                        activeMedia.externalUrl ? (
                                            /* ── YouTube / external embed ── */
                                            <iframe
                                                key={activeMedia.id}
                                                src={toEmbedUrl(activeMedia.externalUrl)}
                                                style={{
                                                    position: 'absolute', top: 0, left: 0,
                                                    width: '100%', height: '100%',
                                                    border: 'none',
                                                }}
                                                title={activeMedia.title}
                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                allowFullScreen
                                            />
                                        ) : activeMedia.mediaType === 'video' ? (
                                            <video
                                                ref={videoRef}
                                                key={activeMedia.id}
                                                controls
                                                autoPlay
                                                style={{
                                                    position: 'absolute', top: 0, left: 0,
                                                    width: '100%', height: '100%',
                                                    background: 'black',
                                                    outline: 'none',
                                                }}
                                                src={getStreamUrl(activeMedia)}
                                                onEnded={() => {
                                                    const idx = filteredMedia.findIndex((m) => m.id === activeMedia.id);
                                                    if (idx >= 0 && idx < filteredMedia.length - 1) {
                                                        setActiveMedia(filteredMedia[idx + 1]);
                                                    }
                                                }}
                                            />
                                        ) : (
                                            <iframe
                                                key={activeMedia.id}
                                                src={getStreamUrl(activeMedia)}
                                                style={{
                                                    position: 'absolute', top: 0, left: 0,
                                                    width: '100%', height: '100%',
                                                    border: 'none', background: 'white',
                                                }}
                                                title={activeMedia.title}
                                            />
                                        )
                                    ) : (
                                        <div style={{
                                            position: 'absolute', inset: 0,
                                            display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center', gap: 12,
                                        }}>
                                            <PlayCircleOutlined style={{ fontSize: 56, color: alpha(t.textOnAccent, 0.15) }} />
                                            <Text style={{ color: alpha(t.textOnAccent, 0.4), fontSize: 14 }}>
                                                Select a video from the queue
                                            </Text>
                                        </div>
                                    )}
                                </div>

                                {/* Title bar + actions */}
                                {activeMedia && (
                                    <div style={{
                                        background: t.surface, borderRadius: '0 0 12px 12px',
                                        border: `1px solid ${t.border}`, borderTop: 'none',
                                        padding: '14px 18px 12px',
                                        marginBottom: 0,
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <Text style={{ color: t.text, fontSize: 17, fontWeight: 700, display: 'block', lineHeight: 1.3 }}>
                                                    {activeMedia.title}
                                                </Text>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                                                    <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                                        {activeMedia.uploader?.fullName ?? 'Unknown'}
                                                    </Text>
                                                    <Text style={{ color: t.border }}>·</Text>
                                                    <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                                        {dayjs(activeMedia.createdAt).format('MMM D, YYYY')}
                                                    </Text>
                                                    {!activeMedia.externalUrl && (
                                                        <>
                                                            <Text style={{ color: t.border }}>·</Text>
                                                            <Text style={{ color: t.textMuted, fontSize: 13 }}>
                                                                {sizeLabel(activeMedia.fileSize)}
                                                            </Text>
                                                        </>
                                                    )}
                                                    <Tag
                                                        color={activeMedia.status === 'approved' ? t.success : activeMedia.status === 'pending' ? t.warning : t.danger}
                                                        style={{ borderRadius: 4, margin: 0 }}
                                                    >
                                                        {activeMedia.status}
                                                    </Tag>
                                                    {activeMedia.externalUrl ? (
                                                        <Tag color={t.danger} icon={<YoutubeOutlined />} style={{ borderRadius: 4, margin: 0 }}>YouTube</Tag>
                                                    ) : (
                                                        <Tag color={activeMedia.mediaType === 'video' ? t.accent : t.danger} style={{ borderRadius: 4, margin: 0 }}>
                                                            {activeMedia.mediaType === 'video' ? 'Video' : 'PDF'}
                                                        </Tag>
                                                    )}
                                                </div>
                                                {activeMedia.description && (
                                                    <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 8, display: 'block', lineHeight: 1.6 }}>
                                                        {activeMedia.description}
                                                    </Text>
                                                )}
                                            </div>
                                            <Space>
                                                {(canManage || activeMedia.uploaderId === user?.id) && (
                                                    <Tooltip title="Edit">
                                                        <Button type="text" size="small" icon={<EditOutlined />}
                                                            style={{ color: t.textMuted }}
                                                            onClick={() => openEditMedia(activeMedia)} />
                                                    </Tooltip>
                                                )}
                                                {!activeMedia.externalUrl && (
                                                    <Button icon={<DownloadOutlined />} size="small"
                                                        onClick={() => handleDownload(activeMedia)}
                                                        style={{ borderRadius: 6 }}>
                                                        Download
                                                    </Button>
                                                )}
                                                {activeMedia.externalUrl && (
                                                    <Button icon={<LinkOutlined />} size="small"
                                                        href={activeMedia.externalUrl} target="_blank" rel="noopener noreferrer"
                                                        style={{ borderRadius: 6 }}>
                                                        Open on YouTube
                                                    </Button>
                                                )}
                                            </Space>
                                        </div>
                                    </div>
                                )}

                                {/* ── Discussion thread ── */}
                                {activeMedia && (
                                    <div id={`discussion-${activeMedia.id}`} style={{ marginTop: 20 }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 8,
                                            marginBottom: 12,
                                        }}>
                                            <div style={{ width: 3, height: 18, background: t.accent, borderRadius: 2 }} />
                                            <Text style={{ color: t.text, fontWeight: 700, fontSize: 15 }}>
                                                Discussion
                                            </Text>
                                        </div>
                                        <CommentThread
                                            entityType="video_media"
                                            entityId={activeMedia.id}
                                            users={allUsers}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* ── Right: Queue sidebar ── */}
                            <div style={{ width: 360, flexShrink: 0 }}>
                                {/* Queue header */}
                                <div style={{
                                    background: t.surface, border: `1px solid ${t.border}`,
                                    borderRadius: '12px 12px 0 0', padding: '12px 14px',
                                    borderBottom: 'none',
                                }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                        <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>
                                            {selectedPlaylist.title}
                                        </Text>
                                        <Space>
                                            {canCreatePlaylists && (
                                                <Tooltip title="Edit playlist">
                                                    <Button type="text" size="small" icon={<EditOutlined />} style={{ color: t.textMuted }}
                                                        onClick={() => { setEditPlaylist(selectedPlaylist); setPlTitle(selectedPlaylist.title); setPlDesc(selectedPlaylist.description ?? ''); setPlaylistModal(true); }} />
                                                </Tooltip>
                                            )}
                                            {canManage && (
                                                <Popconfirm title="Delete this playlist and all its media?" onConfirm={() => handleDeletePlaylist(selectedPlaylist.id)} okText="Delete" okButtonProps={{ danger: true }}>
                                                    <Tooltip title="Delete playlist">
                                                        <Button type="text" size="small" icon={<DeleteOutlined />} style={{ color: t.danger }} />
                                                    </Tooltip>
                                                </Popconfirm>
                                            )}
                                        </Space>
                                    </div>
                                    {activeMedia && (
                                        <Text style={{ color: t.textMuted, fontSize: 12 }}>
                                            {filteredMedia.findIndex((m) => m.id === activeMedia.id) + 1} / {filteredMedia.length}
                                        </Text>
                                    )}
                                    <Input
                                        prefix={<SearchOutlined style={{ color: t.textMuted }} />}
                                        placeholder="Search..."
                                        value={searchText}
                                        onChange={(e) => setSearchText(e.target.value)}
                                        allowClear
                                        size="small"
                                        style={{ marginTop: 8, borderRadius: 6, width: '100%' }}
                                    />
                                </div>

                                {/* Queue list */}
                                <div style={{
                                    background: t.surface, border: `1px solid ${t.border}`,
                                    borderRadius: '0 0 12px 12px',
                                    maxHeight: '70vh', overflowY: 'auto',
                                }}>
                                    {filteredMedia.length === 0 ? (
                                        <Empty description="No media in this playlist" style={{ padding: '32px 0' }} />
                                    ) : (
                                        filteredMedia.map((m, idx) => {
                                            const isActive = activeMedia?.id === m.id;
                                            return (
                                                <div
                                                    key={m.id}
                                                    onClick={() => setActiveMedia(m)}
                                                    style={{
                                                        display: 'flex', gap: 10, padding: '9px 12px',
                                                        cursor: 'pointer',
                                                        background: isActive ? alpha(t.accent, 0.08) : 'transparent',
                                                        borderLeft: isActive ? `3px solid ${t.accent}` : '3px solid transparent',
                                                        transition: 'background 0.12s',
                                                    }}
                                                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = t.hoverBg; }}
                                                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                                                >
                                                    {/* Thumbnail */}
                                                    <div style={{ position: 'relative', flexShrink: 0 }}>
                                                        <div style={{
                                                            width: 110, height: 62, borderRadius: 6, overflow: 'hidden',
                                                            background: isActive ? alpha(t.accent, 0.15) : t.hoverBg,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            border: `1px solid ${isActive ? alpha(t.accent, 0.25) : t.border}`,
                                                        }}>
                                                            {m.externalUrl
                                                                ? <YoutubeOutlined style={{ fontSize: 22, color: isActive ? t.danger : t.textMuted }} />
                                                                : m.mediaType === 'video'
                                                                    ? <VideoCameraOutlined style={{ fontSize: 22, color: isActive ? t.accent : t.textMuted }} />
                                                                    : <FilePdfOutlined style={{ fontSize: 22, color: isActive ? t.danger : t.textMuted }} />}
                                                        </div>
                                                        {isActive && (
                                                            <div style={{
                                                                position: 'absolute', inset: 0, display: 'flex',
                                                                alignItems: 'center', justifyContent: 'center',
                                                                background: alpha(t.bg, 0.35), borderRadius: 6,
                                                            }}>
                                                                <CaretRightOutlined style={{ color: t.textOnAccent, fontSize: 18 }} />
                                                            </div>
                                                        )}
                                                        <div style={{
                                                            position: 'absolute', bottom: 3, right: 4,
                                                            background: alpha(t.bg, 0.75), borderRadius: 3,
                                                            padding: '1px 4px',
                                                            fontSize: 10, color: t.textOnAccent, lineHeight: 1.4,
                                                        }}>
                                                            {idx + 1}
                                                        </div>
                                                    </div>

                                                    {/* Info */}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <Text
                                                            style={{
                                                                color: isActive ? t.accent : t.text,
                                                                fontSize: 12, fontWeight: isActive ? 600 : 500,
                                                                display: '-webkit-box',
                                                                WebkitLineClamp: 2,
                                                                WebkitBoxOrient: 'vertical' as any,
                                                                overflow: 'hidden',
                                                                lineHeight: 1.4,
                                                            }}
                                                        >
                                                            {m.title}
                                                        </Text>
                                                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 3 }}>
                                                            {m.uploader?.fullName ?? 'Unknown'}
                                                        </Text>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                            {m.externalUrl
                                                                ? <Tag color={t.danger} icon={<YoutubeOutlined />} style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', borderRadius: 3, margin: 0 }}>YouTube</Tag>
                                                                : <Text style={{ color: t.textMuted, fontSize: 11 }}>{sizeLabel(m.fileSize)}</Text>
                                                            }
                                                            {m.status === 'pending' && (
                                                                <Tag color={t.warning} style={{ fontSize: 10, lineHeight: '15px', padding: '0 4px', borderRadius: 3, margin: 0 }}>
                                                                    Pending
                                                                </Tag>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Row actions */}
                                                    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                                                        <Tooltip title="Download">
                                                            <Button type="text" size="small" icon={<DownloadOutlined />}
                                                                style={{ color: t.textMuted, width: 26, height: 26, display: m.externalUrl ? 'none' : undefined }}
                                                                onClick={() => handleDownload(m)} />
                                                        </Tooltip>
                                                        {(canManage || m.uploaderId === user?.id) && (
                                                            <Tooltip title="Edit">
                                                                <Button type="text" size="small" icon={<EditOutlined />}
                                                                    style={{ color: t.textMuted, width: 26, height: 26 }}
                                                                    onClick={() => openEditMedia(m)} />
                                                            </Tooltip>
                                                        )}
                                                        {canManage && (
                                                            <Popconfirm title="Delete this media?" onConfirm={() => handleDeleteMedia(m.id)} okText="Delete" okButtonProps={{ danger: true }}>
                                                                <Tooltip title="Delete">
                                                                    <Button type="text" size="small" icon={<DeleteOutlined />}
                                                                        style={{ color: t.danger, width: 26, height: 26 }} />
                                                                </Tooltip>
                                                            </Popconfirm>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Upload Modal ── */}
            <FormModal
                open={uploadModal}
                title="Add Media"
                onCancel={() => {
                    setUploadModal(false);
                    setUploadFile(null); setUploadTitle(''); setUploadDesc('');
                    setLinkUrl(''); setLinkTitle(''); setLinkDesc('');
                    setUploadMode('file');
                }}
                onOk={uploadMode === 'file' ? handleUpload : handleAddLink}
                okText={uploadMode === 'file' ? (uploading ? 'Uploading...' : 'Upload') : 'Add Link'}
                confirmLoading={uploading}
                okButtonProps={{
                    disabled: uploadMode === 'file'
                        ? (!uploadFile || !uploadTitle.trim())
                        : (!linkUrl.trim() || !linkTitle.trim()),
                }}
                width={520}
            >
                <Tabs
                    activeKey={uploadMode}
                    onChange={(k) => setUploadMode(k as 'file' | 'link')}
                    items={[
                        { key: 'file', label: <><UploadOutlined /> Upload File</> },
                        { key: 'link', label: <><YoutubeOutlined /> YouTube / URL</> },
                    ]}
                    style={{ marginBottom: 16 }}
                />

                {uploadMode === 'file' ? (
                    <>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Title *</Text>
                            <Input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g. Equipment Setup Guide" />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Description</Text>
                            <TextArea rows={3} value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder="Optional description" />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>File (Video or PDF) *</Text>
                            <Upload.Dragger
                                accept="video/*,application/pdf"
                                beforeUpload={(file) => { setUploadFile(file); return false; }}
                                onRemove={() => setUploadFile(null)}
                                fileList={uploadFile ? [{ uid: '-1', name: uploadFile.name, status: 'done' }] : []}
                                maxCount={1}
                            >
                                <p style={{ color: t.textMuted }}>
                                    <UploadOutlined style={{ fontSize: 24, marginBottom: 8, display: 'block' }} />
                                    Click or drag video/PDF to upload
                                </p>
                            </Upload.Dragger>
                        </div>
                        {uploading && <Progress percent={uploadProgress} size="small" />}
                    </>
                ) : (
                    <>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>YouTube URL *</Text>
                            <Input
                                prefix={<YoutubeOutlined style={{ color: t.danger }} />}
                                value={linkUrl}
                                onChange={(e) => setLinkUrl(e.target.value)}
                                placeholder="https://www.youtube.com/watch?v=..."
                            />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Title *</Text>
                            <Input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. How to Use the Oscilloscope" />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Description</Text>
                            <TextArea rows={3} value={linkDesc} onChange={(e) => setLinkDesc(e.target.value)} placeholder="Optional description" />
                        </div>
                    </>
                )}

                {!canManage && (
                    <Text style={{ color: t.warning, fontSize: 12 }}>
                        <ClockCircleOutlined style={{ marginRight: 4 }} />
                        Your submission will be reviewed by a moderator before it becomes visible.
                    </Text>
                )}
            </FormModal>

            {/* ── Playlist Create/Edit Modal ── */}
            <FormModal
                open={playlistModal}
                title={editPlaylist ? 'Edit Playlist' : 'Create Playlist'}
                onCancel={() => { setPlaylistModal(false); setEditPlaylist(null); setPlTitle(''); setPlDesc(''); }}
                onOk={handleCreateOrEditPlaylist}
                okText={editPlaylist ? 'Save' : 'Create'}
                width={450}
            >
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Title *</Text>
                    <Input value={plTitle} onChange={(e) => setPlTitle(e.target.value)} placeholder="e.g. Oscilloscope Training" />
                </div>
                <div>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Description</Text>
                    <TextArea rows={3} value={plDesc} onChange={(e) => setPlDesc(e.target.value)} placeholder="Optional playlist description" />
                </div>
            </FormModal>

            {/* ── Edit Media Modal ── */}
            <FormModal
                open={editMediaModal}
                title="Edit Media"
                onCancel={() => { setEditMediaModal(false); setEditMediaItem(null); }}
                onOk={handleEditMedia}
                okText="Save"
                width={450}
            >
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Title *</Text>
                    <Input value={editMTitle} onChange={(e) => setEditMTitle(e.target.value)} />
                </div>
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 4 }}>Description</Text>
                    <TextArea rows={3} value={editMDesc} onChange={(e) => setEditMDesc(e.target.value)} />
                </div>
                {editMediaItem?.status === 'approved' && !canManage && (
                    <Text style={{ color: t.warning, fontSize: 12 }}>
                        <ClockCircleOutlined style={{ marginRight: 4 }} />
                        Editing an approved item will reset it to pending review.
                    </Text>
                )}
            </FormModal>
        </div>
    );
}
