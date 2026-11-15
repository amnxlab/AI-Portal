import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Typography, Spin, Alert, Button, Tag, Space, Modal, Select, Row, Col, TreeSelect,
    message, Empty, Upload, Badge, Popconfirm, Card, Tooltip, Input, Progress, Table,
} from 'antd';
import {
    FileOutlined, FilePdfOutlined, FileZipOutlined, FileImageOutlined,
    DownloadOutlined, DeleteOutlined, CheckCircleOutlined,
    ClockCircleOutlined, UploadOutlined, FolderOutlined,
    EyeOutlined, InboxOutlined, FileTextOutlined, SearchOutlined, FilterOutlined,
    FolderAddOutlined, HomeOutlined, EditOutlined, RightOutlined, LeftOutlined, ArrowsAltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import { useTheme } from '../../theme/useTheme';
import { alpha } from '../../theme/tokens';
import { FormModal } from '../../components/ui';
import UserAvatar from '../../components/UserAvatar';
import { useDeepLinkId } from '../../hooks/useDeepLink';

const { Title, Text } = Typography;

interface ProjectFile {
    id: string;
    originalName: string;
    filename: string;
    fileSize: number;
    mimeType: string;
    type: string;
    status: string;
    version: number;
    createdAt: string;
    folderId?: string | null;
    uploader?: { id: string; fullName: string; avatarUrl?: string | null };
    project?: { id: string; name: string };
}

interface Project { id: string; name: string; }

interface FileFolder {
    id: string;
    projectId: string;
    parentId: string | null;
    type: string;
    name: string;
    createdAt: string;
}

interface FolderNavState {
    folderId: string | null;
    path: { id: string; name: string }[];
}

interface FolderUploadEntry {
    file: File;
    relPath: string; // full webkitRelativePath, e.g. "MyDocs/SubA/report.pdf"
}

interface UploadTreeNode {
    name: string;
    path: string;
    children: UploadTreeNode[];
    files: { name: string; size: number }[];
}

function sizeLabel(bytes: number) {
    return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

type FolderTreeNode = { value: string; title: string; children: FolderTreeNode[] };
function buildFolderTree(folders: FileFolder[], parentId: string | null = null): FolderTreeNode[] {
    return folders
        .filter(f => (f.parentId ?? null) === parentId)
        .map(f => ({ value: f.id, title: f.name, children: buildFolderTree(folders, f.id) }));
}

export default function FilesPage() {
    const deepLinkId = useDeepLinkId('fileId', 'openFileId');
    const { t } = useTheme();
    const { hasPermission } = usePermissions();
    const canManage = hasPermission('manage_projects');

    const [files,         setFiles]         = useState<ProjectFile[]>([]);
    const [pending,       setPending]       = useState<ProjectFile[]>([]);
    const [myPending,     setMyPending]     = useState<ProjectFile[]>([]);
    const [projects,      setProjects]      = useState<Project[]>([]);
    const [loading,       setLoading]       = useState(true);
    const [uploadModal,   setUploadModal]   = useState(false);
    const [uploadProject, setUploadProject] = useState<string | null>(null);
    const [uploading,     setUploading]     = useState(false);
    const [viewFile,      setViewFile]      = useState<ProjectFile | null>(null);
    const [viewBlobUrl,   setViewBlobUrl]   = useState<string | null>(null);
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
    const [searchText,    setSearchText]    = useState('');
    const [filterProject, setFilterProject] = useState<string | undefined>();
    const [uploadFolder,  setUploadFolder]  = useState<string | null>(null);

    const canCreateFolders = hasPermission('manage_projects') || hasPermission('lead_projects');

    // Per-project folder navigation
    const [folderNav,  setFolderNav]  = useState<Record<string, FolderNavState>>({});
    const [folders,    setFolders]    = useState<Record<string, FileFolder[]>>({});
    const [allFolders, setAllFolders] = useState<Record<string, FileFolder[]>>({});

    // New-folder modal
    const [newFolderModal,   setNewFolderModal]   = useState(false);
    const [newFolderProject, setNewFolderProject] = useState<string | null>(null);
    const [newFolderName,    setNewFolderName]    = useState('');
    const [newFolderSaving,  setNewFolderSaving]  = useState(false);

    // Move-file modal
    const [moveModal,   setMoveModal]      = useState(false);
    const [moveTarget,  setMoveTarget]     = useState<ProjectFile | null>(null);
    const [moveDest,    setMoveDest]       = useState<string | null>(null);
    const [moveLoading, setMoveLoading]    = useState(false);

    // Rename-folder modal
    const [renameModal,  setRenameModal]  = useState(false);
    const [renameFolder, setRenameFolder] = useState<FileFolder | null>(null);
    const [renameName,   setRenameName]   = useState('');
    const [renameSaving, setRenameSaving] = useState(false);

    // ── Folder upload ──────────────────────────────────────────
    const [fuModal,        setFuModal]        = useState(false);
    const [fuProject,      setFuProject]      = useState<string | null>(null);
    const [fuTargetFolder, setFuTargetFolder] = useState<string | null>(null);
    const [fuRootName,     setFuRootName]     = useState('');
    const [fuEntries,      setFuEntries]      = useState<FolderUploadEntry[]>([]);
    const [fuSkipped,      setFuSkipped]      = useState(0);
    const [fuUploading,    setFuUploading]    = useState(false);
    const [fuProgress,     setFuProgress]     = useState({ done: 0, total: 0 });
    const fuInputRef = useRef<HTMLInputElement>(null);

    // ── ZIP upload ─────────────────────────────────────────────
    const [zipModal,     setZipModal]     = useState(false);
    const [zipProject,   setZipProject]   = useState<string | null>(null);
    const [zipFolder,    setZipFolder]    = useState<string | null>(null);
    const [zipFile,      setZipFile]      = useState<File | null>(null);
    const [zipUploading, setZipUploading] = useState(false);
    const [zipProgress,  setZipProgress]  = useState(0);

    function fileType(mimeType: string, name: string): { icon: React.ReactNode; color: string; label: string } {
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        if (mimeType === 'application/pdf' || ext === 'pdf')
            return { icon: <FilePdfOutlined />, color: t.danger, label: 'PDF' };
        if (['zip', 'rar', '7z'].includes(ext))
            return { icon: <FileZipOutlined />, color: t.warning, label: ext.toUpperCase() };
        if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext))
            return { icon: <FileImageOutlined />, color: t.purple, label: 'Image' };
        if (['doc', 'docx'].includes(ext))
            return { icon: <FileTextOutlined />, color: t.accent, label: 'DOC' };
        if (['sldprt', 'sldasm', 'step', 'stp', 'stl', 'iges', 'igs'].includes(ext))
            return { icon: <FileOutlined />, color: t.orange, label: 'CAD' };
        return { icon: <FileOutlined />, color: t.textMuted, label: ext.toUpperCase() || 'File' };
    }

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [filesRes, projectsRes] = await Promise.all([
                api.get('/files/all-documents'),
                api.get('/projects'),
            ]);
            setFiles(filesRes.data);
            setProjects(projectsRes.data);
        } catch {
            message.error('Failed to load files');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadFolders = useCallback(async (projectId: string, parentId: string | null) => {
        try {
            const res = await api.get('/file-folders', { params: { projectId, type: 'document', parentId: parentId ?? 'root' } });
            setFolders(prev => ({ ...prev, [projectId]: res.data }));
        } catch { /* ignore */ }
    }, []);

    const loadAllFolders = useCallback(async (projectId: string) => {
        try {
            const res = await api.get('/file-folders/all', { params: { projectId, type: 'document' } });
            setAllFolders(prev => ({ ...prev, [projectId]: res.data }));
        } catch { /* ignore */ }
    }, []);

    const handleProjectToggle = useCallback((projectId: string) => {
        setExpandedProjects(prev => {
            const next = new Set(prev);
            if (next.has(projectId)) {
                next.delete(projectId);
            } else {
                next.add(projectId);
                setFolderNav(fn => fn[projectId] ? fn : { ...fn, [projectId]: { folderId: null, path: [] } });
                loadFolders(projectId, null);
                loadAllFolders(projectId);
            }
            return next;
        });
    }, [loadFolders, loadAllFolders]);

    const navigateInto = useCallback((projectId: string, folder: FileFolder) => {
        setFolderNav(prev => {
            const cur = prev[projectId] ?? { folderId: null, path: [] };
            return { ...prev, [projectId]: { folderId: folder.id, path: [...cur.path, { id: folder.id, name: folder.name }] } };
        });
        loadFolders(projectId, folder.id);
    }, [loadFolders]);

    const navigateTo = useCallback((projectId: string, idx: number, curPath: { id: string; name: string }[]) => {
        const newPath = idx < 0 ? [] : curPath.slice(0, idx + 1);
        const newFolderId: string | null = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
        setFolderNav(prev => ({ ...prev, [projectId]: { folderId: newFolderId, path: newPath } }));
        loadFolders(projectId, newFolderId);
    }, [loadFolders]);

    const handleCreateFolder = useCallback(async () => {
        if (!newFolderProject || !newFolderName.trim()) return;
        setNewFolderSaving(true);
        try {
            const nav = folderNav[newFolderProject] ?? { folderId: null, path: [] };
            await api.post('/file-folders', {
                projectId: newFolderProject, type: 'document',
                name: newFolderName.trim(),
                parentId: nav.folderId ?? undefined,
            });
            message.success('Folder created');
            setNewFolderModal(false);
            setNewFolderName('');
            loadFolders(newFolderProject, nav.folderId);
            loadAllFolders(newFolderProject);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to create folder');
        } finally { setNewFolderSaving(false); }
    }, [newFolderProject, newFolderName, folderNav, loadFolders, loadAllFolders]);

    const openRenameModal = useCallback((folder: FileFolder) => {
        setRenameFolder(folder); setRenameName(folder.name); setRenameModal(true);
    }, []);

    const handleRenameFolder = useCallback(async () => {
        if (!renameFolder || !renameName.trim()) return;
        setRenameSaving(true);
        try {
            await api.patch(`/file-folders/${renameFolder.id}`, { name: renameName.trim() });
            message.success('Folder renamed');
            setRenameModal(false);
            const nav = folderNav[renameFolder.projectId] ?? { folderId: null, path: [] };
            loadFolders(renameFolder.projectId, nav.folderId);
            loadAllFolders(renameFolder.projectId);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to rename');
        } finally { setRenameSaving(false); }
    }, [renameFolder, renameName, folderNav, loadFolders, loadAllFolders]);

    const handleDeleteFolder = useCallback(async (folder: FileFolder) => {
        try {
            await api.delete(`/file-folders/${folder.id}`);
            message.success('Folder and all its contents deleted permanently');
            // If we were inside the deleted folder, navigate up
            const nav = folderNav[folder.projectId] ?? { folderId: null, path: [] };
            const wasInside = nav.folderId === folder.id || nav.path.some(s => s.id === folder.id);
            if (wasInside) {
                const parentId = folder.parentId ?? null;
                loadFolders(folder.projectId, parentId);
                setFolderNav(prev => {
                    const parentIdx = nav.path.findIndex(s => s.id === folder.id);
                    return { ...prev, [folder.projectId]: { folderId: parentId, path: parentIdx > 0 ? nav.path.slice(0, parentIdx) : [] } };
                });
            } else {
                loadFolders(folder.projectId, nav.folderId);
            }
            loadAllFolders(folder.projectId);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to delete folder');
        }
    }, [folderNav, loadFolders, loadAllFolders, load]);

    const openMoveModal = useCallback((file: ProjectFile) => {
        setMoveTarget(file); setMoveDest(file.folderId ?? null); setMoveModal(true);
        if (file.project?.id) loadAllFolders(file.project.id);
    }, [loadAllFolders]);

    const handleMoveFile = useCallback(async () => {
        if (!moveTarget) return;
        setMoveLoading(true);
        try {
            await api.patch(`/files/${moveTarget.id}/move`, { folderId: moveDest ?? null });
            message.success('File moved');
            setMoveModal(false); setMoveTarget(null);
            load();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Move failed');
        } finally { setMoveLoading(false); }
    }, [moveTarget, moveDest, load]);

    const loadPending = useCallback(async () => {
        if (!canManage) return;
        try {
            const res = await api.get('/files/documents/pending');
            setPending(res.data);
        } catch { /* ignore */ }
    }, [canManage]);

    const loadMyPending = useCallback(async () => {
        if (canManage) return;
        try {
            const res = await api.get('/files/my-pending');
            setMyPending((res.data as ProjectFile[]).filter(f => f.type !== 'manual'));
        } catch { /* ignore */ }
    }, [canManage]);

    useEffect(() => { load(); loadPending(); loadMyPending(); }, [load, loadPending, loadMyPending]);

    // Deep-link: open a specific file when navigated here from a notification click
    useEffect(() => {
        const openId = deepLinkId;
        if (!openId || (!files.length && !pending.length)) return;
        const found = [...files, ...pending].find((f) => f.id === openId);
        if (found) openFileViewer(found);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deepLinkId, files, pending]);

    const downloadFile = (rec: ProjectFile) => {
        const token = useAuthStore.getState().accessToken;
        const a = document.createElement('a');
        a.href = `/api/files/serve/${rec.id}?token=${encodeURIComponent(token ?? '')}`;
        a.download = rec.originalName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };
    // Give the hidden folder-picker the non-standard webkitdirectory attribute
    useEffect(() => {
        if (fuInputRef.current) (fuInputRef.current as any).webkitdirectory = true;
    }, []);

    const openFileViewer = async (rec: ProjectFile) => {
        try {
            const res = await api.get(`/files/serve/${rec.id}`, { responseType: 'blob' });
            setViewBlobUrl(URL.createObjectURL(res.data));
            setViewFile(rec);
        } catch { message.error('Could not load file'); }
    };



    const isPreviewable = (rec: ProjectFile) => {
        const ext = rec.originalName.split('.').pop()?.toLowerCase() ?? '';
        return rec.mimeType === 'application/pdf' || ext === 'pdf'
            || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)
            || (rec.mimeType?.startsWith('image/') ?? false);
    };

    const closeViewer = () => {
        setViewFile(null);
        if (viewBlobUrl) { URL.revokeObjectURL(viewBlobUrl); setViewBlobUrl(null); }
    };

    const approve = async (id: string) => {
        try {
            await api.patch(`/files/${id}/approve`);
            message.success('File approved');
            await Promise.all([load(), loadPending()]);
        } catch { message.error('Approve failed'); }
    };

    const reject = async (id: string) => {
        try {
            await api.delete(`/files/${id}/reject`);
            message.success('File rejected');
            loadPending();
        } catch { message.error('Reject failed'); }
    };

    // Group files by project (after applying search + project filter)
    const filteredFiles = files.filter(f => {
        if (filterProject && f.project?.id !== filterProject) return false;
        if (searchText.trim()) {
            const q = searchText.toLowerCase();
            return f.originalName.toLowerCase().includes(q) ||
                (f.uploader?.fullName.toLowerCase().includes(q) ?? false) ||
                (f.project?.name.toLowerCase().includes(q) ?? false);
        }
        return true;
    });
    const grouped: Record<string, { project: Project; files: ProjectFile[] }> = {};
    for (const f of filteredFiles) {
        if (!f.project) continue;
        if (!grouped[f.project.id]) grouped[f.project.id] = { project: f.project, files: [] };
        grouped[f.project.id].files.push(f);
    }

    const renderFileFolderBrowser = (projectId: string, pFiles: ProjectFile[]) => {
        const nav = folderNav[projectId] ?? { folderId: null, path: [] };
        const curFolders = folders[projectId] ?? [];
        const visibleFiles = pFiles.filter(f => (f.folderId ?? null) === nav.folderId);
        const isEmpty = curFolders.length === 0 && visibleFiles.length === 0;

        return (
            <div>
                {/* ── Address bar ──────────────────────────────── */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px',
                    borderBottom: `1px solid ${t.border}`, background: t.surfaceRaised,
                }}>
                    <Tooltip title="Back">
                        <Button size="small" type="text" icon={<LeftOutlined />}
                            disabled={nav.path.length === 0}
                            style={{ color: nav.path.length > 0 ? t.text : alpha(t.textMuted, 0.27), padding: '0 4px' }}
                            onClick={() => navigateTo(projectId, nav.path.length - 2, nav.path)}
                        />
                    </Tooltip>
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', gap: 2,
                        background: t.bg, borderRadius: 6, padding: '3px 10px',
                        border: `1px solid ${t.border}`, minHeight: 28, overflow: 'hidden',
                    }}>
                        <Button size="small" type="text" icon={<HomeOutlined />}
                            style={{ color: t.textMuted, padding: '0 2px', fontSize: 12 }}
                            onClick={() => navigateTo(projectId, -1, nav.path)}
                        />
                        {nav.path.map((seg, i) => (
                            <span key={seg.id} style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                                <RightOutlined style={{ color: t.border, fontSize: 8 }} />
                                <Button size="small" type="text"
                                    style={{ color: i === nav.path.length - 1 ? t.text : t.accent, fontWeight: i === nav.path.length - 1 ? 600 : 400, padding: '0 4px', fontSize: 12 }}
                                    onClick={() => navigateTo(projectId, i, nav.path)}
                                >{seg.name}</Button>
                            </span>
                        ))}
                    </div>
                    {canCreateFolders && (
                        <Tooltip title="New Folder">
                            <Button size="small" type="text" icon={<FolderAddOutlined />}
                                style={{ color: t.success, padding: '0 6px' }}
                                onClick={() => { setNewFolderProject(projectId); setNewFolderModal(true); }}
                            />
                        </Tooltip>
                    )}
                </div>

                {/* ── Column headers ───────────────────────────── */}
                {!isEmpty && (
                    <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 130px 120px 52px 64px auto',
                        padding: '5px 16px', borderBottom: `1px solid ${t.border}`,
                        color: t.textMuted, fontSize: 11, fontWeight: 600, userSelect: 'none',
                    }}>
                        <span>Name</span>
                        <span>Owner</span>
                        <span>Date modified</span>
                        <span>Type</span>
                        <span>Size</span>
                        <span></span>
                    </div>
                )}

                {/* ── Folder rows ──────────────────────────────── */}
                {curFolders.map(folder => {
                    const cnt = pFiles.filter(f => f.folderId === folder.id).length;
                    return (
                        <div key={folder.id}
                            style={{
                                display: 'grid', gridTemplateColumns: '1fr 130px 120px 52px 64px auto',
                                padding: '6px 16px', cursor: 'pointer', alignItems: 'center',
                                borderBottom: `1px solid ${alpha(t.border, 0.04)}`, transition: 'background 0.1s',
                            }}
                            onClick={() => navigateInto(projectId, folder)}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = t.surfaceRaised; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <FolderOutlined style={{ color: t.warning, fontSize: 16, flexShrink: 0 }} />
                                <Text style={{ color: t.text, fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={folder.name}>
                                    {folder.name}
                                </Text>
                                {cnt > 0 && <Text style={{ color: t.textMuted, fontSize: 11, flexShrink: 0 }}>({cnt})</Text>}
                            </div>
                            <span />
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(folder.createdAt).format('MMM D, YYYY')}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Folder</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>—</Text>
                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
                                {canCreateFolders && (
                                    <Tooltip title="Rename">
                                        <Button size="small" type="text" icon={<EditOutlined />} style={{ color: t.textMuted, padding: 2 }} onClick={() => openRenameModal(folder)} />
                                    </Tooltip>
                                )}
                                {canManage && (
                                    <Popconfirm title="Delete folder and all contents?" description="All sub-folders and files inside will be permanently deleted." onConfirm={() => handleDeleteFolder(folder)} okText="Delete" okButtonProps={{ danger: true }}>
                                        <Tooltip title="Delete"><Button size="small" type="text" icon={<DeleteOutlined />} danger style={{ padding: 2 }} /></Tooltip>
                                    </Popconfirm>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* ── File rows ─────────────────────────────────── */}
                {visibleFiles.map(rec => {
                    const ft = fileType(rec.mimeType, rec.originalName);
                    return (
                        <div key={rec.id}
                            style={{
                                display: 'grid', gridTemplateColumns: '1fr 130px 120px 52px 64px auto',
                                padding: '6px 16px', cursor: 'pointer', alignItems: 'center',
                                borderBottom: `1px solid ${alpha(t.border, 0.04)}`, transition: 'background 0.1s',
                            }}
                            onClick={() => isPreviewable(rec) ? openFileViewer(rec) : downloadFile(rec)}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = t.surfaceRaised; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <span style={{ color: ft.color, fontSize: 16, flexShrink: 0 }}>{ft.icon}</span>
                                <Text style={{ color: t.text, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={rec.originalName}>
                                    {rec.originalName}
                                </Text>
                                <Tag style={{ background: alpha(t.accent, 0.13), color: t.accent, border: `1px solid ${alpha(t.accent, 0.27)}`, fontSize: 10, margin: 0, flexShrink: 0, lineHeight: '16px', padding: '0 5px' }}>
                                    v{rec.version}
                                </Tag>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                {rec.uploader && (
                                    <UserAvatar
                                        name={rec.uploader.fullName}
                                        avatarUrl={rec.uploader.avatarUrl}
                                        size={18}
                                        style={{ border: `1px solid ${t.border}` }}
                                    />
                                )}
                                <Text style={{ color: t.textMuted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{rec.uploader?.fullName ?? '—'}</Text>
                            </div>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(rec.createdAt).format('MMM D, YYYY')}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{ft.label}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{sizeLabel(rec.fileSize)}</Text>
                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
                                {isPreviewable(rec) && (
                                    <Tooltip title="Preview">
                                        <Button size="small" type="text" icon={<EyeOutlined />} style={{ color: t.accent, padding: 2 }} onClick={() => openFileViewer(rec)} />
                                    </Tooltip>
                                )}
                                <Tooltip title="Download">
                                    <Button size="small" type="text" icon={<DownloadOutlined />} style={{ color: t.textMuted, padding: 2 }} onClick={() => downloadFile(rec)} />
                                </Tooltip>
                                {canCreateFolders && (
                                    <Tooltip title="Move">
                                        <Button size="small" type="text" icon={<ArrowsAltOutlined />} style={{ color: t.purple, padding: 2 }} onClick={() => openMoveModal(rec)} />
                                    </Tooltip>
                                )}
                                {canManage && (
                                    <Popconfirm title="Delete this file?" onConfirm={async () => {
                                        await api.delete(`/files/${rec.id}`);
                                        message.success('Deleted');
                                        load();
                                    }}>
                                        <Tooltip title="Delete">
                                            <Button size="small" type="text" icon={<DeleteOutlined />} danger style={{ padding: 2 }} />
                                        </Tooltip>
                                    </Popconfirm>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* ── Empty state ───────────────────────────────── */}
                {isEmpty && (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: t.textMuted }}>
                        <FolderOutlined style={{ fontSize: 28, marginBottom: 8, display: 'block' }} />
                        This folder is empty
                    </div>
                )}
            </div>
        );
    };

    // ── Folder-upload helpers ──────────────────────────────────
    const buildUploadTree = (entries: FolderUploadEntry[]): UploadTreeNode => {
        const rootName = entries[0]?.relPath.split('/')[0] ?? '';
        const root: UploadTreeNode = { name: rootName, path: rootName, children: [], files: [] };
        for (const entry of entries) {
            const parts = entry.relPath.split('/');
            const folderParts = parts.slice(1, -1);
            const fileName = parts[parts.length - 1];
            let node = root;
            for (let i = 0; i < folderParts.length; i++) {
                const seg = folderParts[i];
                let child = node.children.find(c => c.name === seg);
                if (!child) {
                    child = { name: seg, path: parts.slice(0, i + 2).join('/'), children: [], files: [] };
                    node.children.push(child);
                }
                node = child;
            }
            node.files.push({ name: fileName, size: entry.file.size });
        }
        return root;
    };

    const renderUploadTreeNode = (node: UploadTreeNode, depth: number) => (
        <div>
            {node.files.map(f => (
                <div key={`${node.path}/${f.name}`} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 14, paddingTop: 2, paddingBottom: 2 }}>
                    <FilePdfOutlined style={{ color: t.danger, fontSize: 12, flexShrink: 0 }} />
                    <Text style={{ color: t.textMuted, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{f.name}</Text>
                    <Text style={{ color: alpha(t.textMuted, 0.53), fontSize: 11, flexShrink: 0, marginLeft: 6 }}>{sizeLabel(f.size)}</Text>
                </div>
            ))}
            {node.children.map(child => (
                <div key={child.path}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: depth * 14, paddingTop: 3, paddingBottom: 3 }}>
                        <FolderOutlined style={{ color: t.warning, fontSize: 13, flexShrink: 0 }} />
                        <Text style={{ color: t.text, fontWeight: 600, fontSize: 13 }}>{child.name}</Text>
                        {child.files.length > 0 && (
                            <Text style={{ color: t.textMuted, fontSize: 11 }}>{child.files.length} file{child.files.length !== 1 ? 's' : ''}</Text>
                        )}
                    </div>
                    {renderUploadTreeNode(child, depth + 1)}
                </div>
            ))}
        </div>
    );

    const handleFolderSelect = (e: any) => {
        const all = Array.from((e.target.files ?? []) as File[]);
        const allowed = all.filter(f => f.name.toLowerCase().endsWith('.pdf'));
        setFuSkipped(all.length - allowed.length);
        setFuRootName(allowed[0] ? (allowed[0] as any).webkitRelativePath.split('/')[0] : '');
        setFuEntries(allowed.map(f => ({ file: f, relPath: (f as any).webkitRelativePath as string })));
        if (fuInputRef.current) fuInputRef.current.value = '';
    };

    const handleFolderUpload = async () => {
        if (!fuProject || fuEntries.length === 0) return;
        setFuUploading(true);
        setFuProgress({ done: 0, total: fuEntries.length });
        const resetFu = () => { setFuModal(false); setFuEntries([]); setFuProject(null); setFuTargetFolder(null); setFuRootName(''); };
        try {
            // 1. Collect unique folder paths, sorted shallow-first
            const folderPathSet = new Set<string>();
            for (const entry of fuEntries) {
                const parts = entry.relPath.split('/');
                for (let i = 1; i < parts.length; i++) folderPathSet.add(parts.slice(0, i).join('/'));
            }
            const sortedPaths = Array.from(folderPathSet).sort((a, b) => a.split('/').length - b.split('/').length);
            // 2. Create folder hierarchy (parent before child)
            const folderIdMap: Record<string, string> = {};
            for (const path of sortedPaths) {
                const parts = path.split('/');
                const name = parts[parts.length - 1];
                const parentPath = parts.slice(0, -1).join('/');
                const parentId = parentPath ? (folderIdMap[parentPath] ?? null) : (fuTargetFolder ?? null);
                const res = await api.post('/file-folders', { projectId: fuProject, type: 'document', name, parentId });
                folderIdMap[path] = res.data.id;
            }
            // 3. Upload each PDF into its folder (continue on per-file errors)
            let done = 0;
            const failed: string[] = [];
            for (const entry of fuEntries) {
                const parts = entry.relPath.split('/');
                const folderPath = parts.slice(0, -1).join('/');
                const folderId = folderIdMap[folderPath] ?? null;
                const fileName = parts[parts.length - 1];
                let ok = false;
                for (let attempt = 0; attempt < 3 && !ok; attempt++) {
                    if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt));
                    const fd = new FormData();
                    fd.append('file', entry.file);
                    fd.append('type', 'document');
                    if (folderId) fd.append('folderId', folderId);
                    try {
                        await api.post(`/files/projects/${fuProject}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                        ok = true;
                    } catch (err: any) {
                        const reason = err?.response?.data?.message ?? err?.message ?? 'unknown error';
                        console.error(`[FolderUpload] Attempt ${attempt + 1}/3 failed: ${fileName} — ${reason}`);
                        if (attempt === 2) failed.push(fileName);
                    }
                }
                setFuProgress({ done: ++done, total: fuEntries.length });
            }
            if (failed.length === 0) {
                message.success(`Uploaded ${fuEntries.length} PDF${fuEntries.length !== 1 ? 's' : ''} successfully`);
            } else {
                message.warning(`Uploaded ${fuEntries.length - failed.length} of ${fuEntries.length} — ${failed.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
            }
            resetFu();
            await Promise.all([load(), loadPending()]);
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Folder upload failed');
        } finally { setFuUploading(false); }
    };

    return (
        <div style={{ padding: '24px 28px', background: t.bg, minHeight: '100vh' }}>

            {/* ── Header ─────────────────────────────────────── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <Title level={3} style={{ margin: 0, color: t.text }}>Project Files</Title>
                    <Text style={{ color: t.textMuted, fontSize: 13 }}>
                        Documents, CAD files, archives and deliverables across all projects
                    </Text>
                </div>
                <Space size={8}>
                    <Button icon={<FolderAddOutlined />} onClick={() => setFuModal(true)}
                        style={{ borderColor: t.border, color: t.textMuted }}>
                        Upload Folder
                    </Button>
                    <Button icon={<FileZipOutlined />} onClick={() => setZipModal(true)}
                        style={{ borderColor: t.border, color: t.warning }}>
                        Upload ZIP
                    </Button>
                    <Button type="primary" icon={<UploadOutlined />} onClick={() => setUploadModal(true)}
                        style={{ background: t.accent, borderColor: t.accent }}>
                        Upload File
                    </Button>
                </Space>
            </div>

            {/* ── Stat Cards ─────────────────────────────────── */}
            <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
                {[
                    { label: 'Total Files', value: files.length, color: t.accent, icon: <FileOutlined /> },
                    { label: 'Projects', value: Object.keys(grouped).length, color: t.purple, icon: <FolderOutlined /> },
                    ...(canManage ? [{ label: 'Pending Review', value: pending.length, color: pending.length > 0 ? t.warning : t.textMuted, icon: <ClockCircleOutlined /> }] : []),
                ].map(s => (
                    <Col key={s.label} xs={12} sm={6}>
                        <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10 }}
                            styles={{ body: { padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 } }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10,
                                background: alpha(s.color, 0.10), border: `1px solid ${alpha(s.color, 0.27)}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 18, color: s.color, flexShrink: 0,
                            }}>{s.icon}</div>
                            <div>
                                <div style={{ fontSize: 20, fontWeight: 700, color: s.color, lineHeight: 1.2 }}>{s.value}</div>
                                <div style={{ color: t.textMuted, fontSize: 12 }}>{s.label}</div>
                            </div>
                        </Card>
                    </Col>
                ))}
            </Row>

            {/* ── My Submissions Under Review (employees) ───── */}
            {!canManage && myPending.length > 0 && (
                <div style={{
                    background: alpha(t.warning, 0.06), border: `1px solid ${alpha(t.warning, 0.25)}`,
                    borderRadius: 10, padding: '16px 20px', marginBottom: 24,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                        <ClockCircleOutlined style={{ color: t.warning }} />
                        <Text style={{ color: t.warning, fontWeight: 700 }}>My Submissions — Under Review</Text>
                        <Badge count={myPending.length} style={{ background: t.warning }} />
                    </div>
                    <Table<ProjectFile>
                        dataSource={myPending} rowKey="id" size="small" pagination={false}
                        style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.border}` }}
                        columns={[
                            {
                                title: 'File', dataIndex: 'originalName',
                                render: (name: string, rec) => {
                                    const ft = fileType(rec.mimeType, name);
                                    return <Space size={8}><span style={{ color: ft.color, fontSize: 15 }}>{ft.icon}</span><Text style={{ color: t.text }}>{name}</Text></Space>;
                                },
                            },
                            { title: 'Project', dataIndex: 'project', width: 160, render: (p?: { name: string }) => <Text style={{ color: t.textMuted }}>{p?.name ?? '—'}</Text> },
                            { title: 'Date', dataIndex: 'createdAt', width: 110, render: (d: string) => <Text style={{ color: t.textMuted }}>{dayjs(d).format('MMM D, YYYY')}</Text> },
                            { title: 'Size', dataIndex: 'fileSize', width: 80, render: (s: number) => <Text style={{ color: t.textMuted }}>{sizeLabel(s)}</Text> },
                            {
                                title: 'Status', width: 130,
                                render: () => <Tag style={{ background: alpha(t.warning, 0.13), color: t.warning, border: `1px solid ${alpha(t.warning, 0.20)}`, borderRadius: 10 }}><ClockCircleOutlined style={{ marginRight: 4 }} />Under Review</Tag>,
                            },
                        ]}
                    />
                </div>
            )}

            {/* ── Pending Review (reviewer) ─────────────────── */}
            {canManage && pending.length > 0 && (
                <div style={{
                    background: alpha(t.warning, 0.04), border: `1px solid ${alpha(t.warning, 0.27)}`,
                    borderRadius: 10, padding: '16px 20px', marginBottom: 24,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                        <ClockCircleOutlined style={{ color: t.warning }} />
                        <Text style={{ color: t.warning, fontWeight: 700 }}>Pending Review</Text>
                        <Badge count={pending.length} style={{ background: t.warning }} />
                    </div>
                    <Table<ProjectFile>
                        dataSource={pending} rowKey="id" size="small" pagination={false}
                        style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.border}` }}
                        columns={[
                            {
                                title: 'File', dataIndex: 'originalName',
                                render: (name: string, rec) => {
                                    const ft = fileType(rec.mimeType, name);
                                    return (
                                        <Space size={8}>
                                            <div style={{ width: 30, height: 30, borderRadius: 6, background: alpha(ft.color, 0.10), border: `1px solid ${alpha(ft.color, 0.27)}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: ft.color, flexShrink: 0 }}>{ft.icon}</div>
                                            <div>
                                                <Text style={{ color: t.text, fontWeight: 600 }}>{name}</Text>
                                                <Tag style={{ marginLeft: 6, fontSize: 10, padding: '0 5px', background: alpha(ft.color, 0.10), color: ft.color, border: `1px solid ${alpha(ft.color, 0.27)}` }}>{ft.label}</Tag>
                                            </div>
                                        </Space>
                                    );
                                },
                            },
                            { title: 'Project', dataIndex: 'project', width: 150, render: (p?: { name: string }) => <Text style={{ color: t.textMuted }}>{p?.name ?? '—'}</Text> },
                            { title: 'Uploaded by', dataIndex: 'uploader', width: 130, render: (u?: { fullName: string }) => <Text style={{ color: t.textMuted }}>{u?.fullName ?? '—'}</Text> },
                            { title: 'Date', dataIndex: 'createdAt', width: 110, render: (d: string) => <Text style={{ color: t.textMuted }}>{dayjs(d).format('MMM D, YYYY')}</Text> },
                            { title: 'Size', dataIndex: 'fileSize', width: 80, render: (s: number) => <Text style={{ color: t.textMuted }}>{sizeLabel(s)}</Text> },
                            {
                                title: '', width: 260,
                                render: (_: unknown, rec: ProjectFile) => {
                                    return (
                                        <Space>
                                            <Button size="small" type="primary" icon={<CheckCircleOutlined />} style={{ background: t.success, borderColor: t.success }} onClick={() => approve(rec.id)}>Approve</Button>
                                            {isPreviewable(rec) && <Button size="small" icon={<EyeOutlined />} onClick={() => openFileViewer(rec)}>Preview</Button>}
                                            <Tooltip title="Download">
                                                <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadFile(rec)} />
                                            </Tooltip>
                                            <Popconfirm title="Reject and delete?" onConfirm={() => reject(rec.id)}>
                                                <Button size="small" danger icon={<DeleteOutlined />}>Reject</Button>
                                            </Popconfirm>
                                        </Space>
                                    );
                                },
                            },
                        ]}
                    />
                </div>
            )}

            {canManage && pending.length === 0 && (
                <Alert type="success" showIcon message="No files pending review"
                    style={{ marginBottom: 20, border: `1px solid ${t.border}`, background: alpha(t.success, 0.05) }} />
            )}

            {/* ── Search & Filter Bar ─────────────────────────── */}
            <div style={{
                display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
                padding: '12px 16px', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
            }}>
                <FilterOutlined style={{ color: t.textMuted, fontSize: 14 }} />
                <Input
                    prefix={<SearchOutlined style={{ color: t.textMuted }} />}
                    placeholder="Search filename, uploader, project…"
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    allowClear
                    style={{ width: 280, background: t.surfaceSunken, borderColor: t.border }}
                />
                <Select
                    placeholder="Project"
                    value={filterProject}
                    onChange={setFilterProject}
                    allowClear
                    style={{ width: 200 }}
                    options={projects.map(p => ({ label: p.name, value: p.id }))}
                    showSearch
                    filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
                />
                {(filterProject || searchText) && (
                    <Button size="small" type="link" onClick={() => { setFilterProject(undefined); setSearchText(''); }}>
                        Clear all
                    </Button>
                )}
            </div>

            {/* ── Files by Project ────────────────────────────── */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }}><Spin size="large" /></div>
            ) : Object.keys(grouped).length === 0 ? (
                <Empty description={<span style={{ color: t.textMuted }}>{searchText || filterProject ? 'No files match your search' : 'No project files uploaded yet'}</span>} style={{ marginTop: 60 }} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.values(grouped).map(({ project, files: pFiles }) => {
                        const isOpen = expandedProjects.has(project.id);
                        const pSize = pFiles.reduce((s, f) => s + f.fileSize, 0);
                        return (
                            <div key={project.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
                                <div
                                    onClick={() => handleProjectToggle(project.id)}
                                    style={{
                                        padding: '12px 18px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        borderBottom: isOpen ? `1px solid ${t.border}` : 'none',
                                        background: isOpen ? t.surfaceRaised : t.surface,
                                        userSelect: 'none',
                                    }}
                                >
                                    <Space size={12}>
                                        <FolderOutlined style={{ color: t.accent, fontSize: 18 }} />
                                        <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>{project.name}</Text>
                                        <Tag style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.textMuted, borderRadius: 10, fontSize: 11 }}>
                                            {pFiles.length} file{pFiles.length !== 1 ? 's' : ''}
                                        </Tag>
                                        <Text style={{ color: t.textMuted, fontSize: 12 }}>{sizeLabel(pSize)}</Text>
                                    </Space>
                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>{isOpen ? '▲' : '▼'}</Text>
                                </div>
                                {isOpen && renderFileFolderBrowser(project.id, pFiles)}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Upload Modal ────────────────────────────────── */}
            <Modal
                open={uploadModal}
                title="Upload Project File"
                onCancel={() => { setUploadModal(false); setUploadProject(null); }}
                footer={null}
                width={520}
            >
                {!canManage && (
                    <Alert type="info" showIcon
                        message="Your upload will be sent for review before becoming visible to others."
                        style={{ marginBottom: 16, border: `1px solid ${t.border}` }} />
                )}
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Select project</Text>
                    <Select
                        showSearch optionFilterProp="label"
                        placeholder="Choose a project…"
                        style={{ width: '100%' }}
                        value={uploadProject}
                        onChange={v => { setUploadProject(v); setUploadFolder(null); loadAllFolders(v); }}
                        options={projects.map(p => ({ value: p.id, label: p.name }))}
                    />
                </div>
                {uploadProject && (allFolders[uploadProject] ?? []).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Folder (optional)</Text>
                        <TreeSelect
                            allowClear placeholder="Root (no folder)"
                            style={{ width: '100%' }}
                            value={uploadFolder ?? undefined}
                            onChange={v => setUploadFolder(v ?? null)}
                            treeData={buildFolderTree(allFolders[uploadProject] ?? [])}
                            treeLine showSearch treeNodeFilterProp="title"
                        />
                    </div>
                )}
                <Upload.Dragger
                    name="file" multiple={false} showUploadList={false}
                    disabled={!uploadProject || uploading}
                    customRequest={async ({ file, onSuccess, onError }) => {
                        if (!uploadProject) return;
                        setUploading(true);
                        try {
                            const fd = new FormData();
                            fd.append('file', file as Blob);
                            fd.append('type', 'document');
                            if (uploadFolder) fd.append('folderId', uploadFolder);
                            await api.post(`/files/projects/${uploadProject}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
                            message.success(canManage ? 'File uploaded and published' : 'File submitted for review');
                            onSuccess?.({});
                            setUploadModal(false);
                            setUploadProject(null);
                            setUploadFolder(null);
                            await Promise.all([load(), loadPending()]);
                        } catch (e: any) {
                            message.error(e?.response?.data?.message ?? 'Upload failed');
                            onError?.(e);
                        } finally { setUploading(false); }
                    }}
                    style={{ background: t.surfaceRaised, border: `2px dashed ${uploadProject ? t.accent : t.border}`, borderRadius: 10 }}
                >
                    <p style={{ color: t.textMuted, marginBottom: 8 }}><InboxOutlined style={{ fontSize: 36, color: uploadProject ? t.accent : t.textMuted }} /></p>
                    <p style={{ color: t.text, fontWeight: 600, marginBottom: 4 }}>Click or drag a file to upload</p>
                    <p style={{ color: t.textMuted, fontSize: 12 }}>
                        {uploadProject ? 'All file types · Max 200 MB' : 'Select a project first'}
                    </p>
                    {uploading && <p style={{ color: t.accent, fontSize: 12 }}>Uploading…</p>}
                </Upload.Dragger>
            </Modal>

            {/* ── New Folder Modal ─────────────────────────────── */}
            <FormModal
                open={newFolderModal}
                title="New Folder"
                onCancel={() => { setNewFolderModal(false); setNewFolderName(''); }}
                onOk={handleCreateFolder}
                okText="Create"
                confirmLoading={newFolderSaving}
            >
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 8 }}>Folder name</Text>
                <Input
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onPressEnter={handleCreateFolder}
                    placeholder="e.g. Schematics"
                    autoFocus
                />
            </FormModal>

            {/* ── Rename Folder Modal ──────────────────────────── */}
            <FormModal
                open={renameModal}
                title="Rename Folder"
                onCancel={() => setRenameModal(false)}
                onOk={handleRenameFolder}
                okText="Rename"
                confirmLoading={renameSaving}
            >
                <Input
                    value={renameName}
                    onChange={e => setRenameName(e.target.value)}
                    onPressEnter={handleRenameFolder}
                    autoFocus
                />
            </FormModal>

            {/* ── Move File Modal ──────────────────────────────── */}
            <FormModal
                open={moveModal}
                title="Move File"
                onCancel={() => { setMoveModal(false); setMoveTarget(null); }}
                onOk={handleMoveFile}
                okText="Move"
                confirmLoading={moveLoading}
            >
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 8 }}>Move to folder</Text>
                <TreeSelect
                    allowClear placeholder="Root (no folder)"
                    style={{ width: '100%' }}
                    value={moveDest ?? undefined}
                    onChange={v => setMoveDest(v ?? null)}
                    treeData={buildFolderTree(moveTarget?.project?.id ? (allFolders[moveTarget.project.id] ?? []) : [])}
                    treeLine showSearch treeNodeFilterProp="title"
                />
            </FormModal>

            {/* ── Upload ZIP Modal ─────────────────────────────── */}
            <Modal
                open={zipModal}
                title="Upload ZIP"
                onCancel={() => { setZipModal(false); setZipProject(null); setZipFolder(null); setZipFile(null); }}
                footer={
                    <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button onClick={() => { setZipModal(false); setZipProject(null); setZipFolder(null); setZipFile(null); }}
                            style={{ borderColor: t.border, color: t.textMuted }}>Cancel</Button>
                        <Button type="primary" loading={zipUploading}
                            disabled={!zipProject || !zipFile}
                            style={{ background: t.warning, borderColor: t.warning, color: t.textOnAccent }}
                            onClick={async () => {
                                if (!zipFile || !zipProject) return;
                                setZipUploading(true);
                                setZipProgress(0);
                                try {
                                    const fd = new FormData();
                                    fd.append('file', zipFile);
                                    fd.append('type', 'document');
                                    if (zipFolder) fd.append('folderId', zipFolder);
                                    await api.post(`/files/projects/${zipProject}`, fd, {
                                        headers: { 'Content-Type': 'multipart/form-data' },
                                        onUploadProgress: (e) => {
                                            if (e.total) setZipProgress(Math.round((e.loaded / e.total) * 100));
                                        },
                                    });
                                    setZipProgress(100);
                                    message.success(canManage ? 'ZIP uploaded and published' : 'ZIP submitted for review');
                                    setZipModal(false); setZipProject(null); setZipFolder(null); setZipFile(null); setZipProgress(0);
                                    await Promise.all([load(), loadPending()]);
                                } catch (e: any) {
                                    message.error(e?.response?.data?.message ?? 'Upload failed');
                                } finally { setZipUploading(false); }
                            }}>Submit</Button>
                    </Space>
                }
                width={480}
            >
                {!canManage && (
                    <Alert type="info" showIcon
                        message="Your upload will be sent for review before becoming visible to others."
                        style={{ marginBottom: 16, border: `1px solid ${t.border}` }} />
                )}
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Select project</Text>
                    <Select showSearch optionFilterProp="label" placeholder="Choose a project…"
                        style={{ width: '100%' }} value={zipProject}
                        onChange={v => { setZipProject(v); setZipFolder(null); if (v) loadAllFolders(v); }}
                        options={projects.map(p => ({ value: p.id, label: p.name }))} />
                </div>
                {zipProject && (allFolders[zipProject] ?? []).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Save to folder <span style={{ fontWeight: 400 }}>(optional)</span></Text>
                        <TreeSelect
                            placeholder="Root (no folder)" style={{ width: '100%' }}
                            value={zipFolder ?? undefined} onChange={v => setZipFolder(v ?? null)} allowClear
                            treeData={buildFolderTree(allFolders[zipProject] ?? [])}
                            treeLine showSearch treeNodeFilterProp="title"
                        />
                    </div>
                )}
                <Upload.Dragger
                    name="file" accept=".zip" multiple={false}
                    showUploadList={false}
                    disabled={!zipProject || zipUploading}
                    beforeUpload={(file) => { setZipFile(file); return false; }}
                    style={{ background: t.surfaceRaised, border: `2px dashed ${zipProject ? t.warning : t.border}`, borderRadius: 10 }}
                >
                    <p style={{ color: t.textMuted, marginBottom: 8 }}><FileZipOutlined style={{ fontSize: 36, color: zipProject ? t.warning : t.textMuted }} /></p>
                    {zipFile
                        ? <p style={{ color: t.success, fontWeight: 600, marginBottom: 4 }}>{zipFile.name}</p>
                        : <p style={{ color: t.text, fontWeight: 600, marginBottom: 4 }}>Click or drag a ZIP file to select</p>
                    }
                    <p style={{ color: t.textMuted, fontSize: 12 }}>
                        {zipProject ? 'ZIP files · Max 10 GB' : 'Select a project first'}
                    </p>
                </Upload.Dragger>
                {zipUploading && (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>Uploading…</Text>
                            <Text style={{ color: t.accent, fontSize: 12, fontWeight: 600 }}>{zipProgress}%</Text>
                        </div>
                        <Progress percent={zipProgress} showInfo={false} strokeColor={t.warning} trailColor={t.surfaceRaised}
                            style={{ margin: 0 }} />
                        <Text style={{ color: t.textMuted, fontSize: 11, display: 'block', marginTop: 4 }}>
                            {zipFile ? `${(zipFile.size / (1024 * 1024)).toFixed(1)} MB total` : ''}
                        </Text>
                    </div>
                )}
            </Modal>

            {/* ── Folder Upload Modal ─────────────────────────── */}
            <input ref={fuInputRef} type="file" style={{ display: 'none' }} multiple accept=".pdf" onChange={handleFolderSelect} />
            <Modal
                open={fuModal}
                title={<span>Upload Folder <span style={{ fontSize: 12, fontWeight: 400, color: t.textMuted }}>— PDF files</span></span>}
                onCancel={() => { if (!fuUploading) { setFuModal(false); setFuEntries([]); setFuProject(null); setFuTargetFolder(null); setFuRootName(''); } }}
                footer={null} width={560} destroyOnClose
            >
                {!canManage && (
                    <Alert type="info" showIcon
                        message="Uploaded files will be sent for review before becoming visible."
                        style={{ marginBottom: 16, border: `1px solid ${t.border}` }} />
                )}

                {/* Step 1: Project */}
                <div style={{ marginBottom: 16 }}>
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Select project</Text>
                    <Select
                        showSearch optionFilterProp="label" placeholder="Choose a project…"
                        style={{ width: '100%' }} value={fuProject}
                        onChange={v => { setFuProject(v); setFuTargetFolder(null); loadAllFolders(v); }}
                        options={projects.map(p => ({ value: p.id, label: p.name }))}
                    />
                </div>

                {/* Step 2: Optional parent folder (only when folders exist) */}
                {fuProject && (allFolders[fuProject] ?? []).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                        <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>
                            Upload inside <span style={{ fontWeight: 400 }}>(optional — defaults to root)</span>
                        </Text>
                        <TreeSelect
                            allowClear placeholder="Root level"
                            style={{ width: '100%' }}
                            value={fuTargetFolder ?? undefined}
                            onChange={v => setFuTargetFolder(v ?? null)}
                            treeData={buildFolderTree(allFolders[fuProject] ?? [])}
                            treeLine showSearch treeNodeFilterProp="title"
                        />
                    </div>
                )}

                {/* Step 3: Folder picker button */}
                <div style={{ marginBottom: fuEntries.length > 0 ? 14 : 4 }}>
                    <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 6, fontWeight: 600 }}>Select folder from your computer</Text>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <Button
                            icon={<FolderOutlined />}
                            disabled={!fuProject}
                            style={{
                                borderColor: fuEntries.length > 0 ? t.success : t.border,
                                color: fuEntries.length > 0 ? t.success : (fuProject ? t.text : t.textMuted),
                            }}
                            onClick={() => fuInputRef.current?.click()}
                        >
                            {fuEntries.length > 0
                                ? `${fuRootName}/ — ${fuEntries.length} PDF${fuEntries.length !== 1 ? 's' : ''} found`
                                : 'Choose Folder…'}
                        </Button>
                        {fuSkipped > 0 && (
                            <Text style={{ color: t.warning, fontSize: 12 }}>
                                {fuSkipped} non-PDF file{fuSkipped !== 1 ? 's' : ''} skipped
                            </Text>
                        )}
                    </div>
                </div>

                {/* Tree preview */}
                {fuEntries.length > 0 && (() => {
                    const tree = buildUploadTree(fuEntries);
                    return (
                        <div style={{
                            background: t.bg, border: `1px solid ${t.border}`,
                            borderRadius: 8, padding: '12px 14px', marginBottom: 16,
                            maxHeight: 260, overflowY: 'auto',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <div style={{
                                    width: 26, height: 26, borderRadius: 6,
                                    background: alpha(t.warning, 0.10), border: `1px solid ${alpha(t.warning, 0.27)}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                }}>
                                    <FolderOutlined style={{ color: t.warning, fontSize: 13 }} />
                                </div>
                                <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>{tree.name}/</Text>
                                <Text style={{ color: t.textMuted, fontSize: 12 }}>{fuEntries.length} PDF{fuEntries.length !== 1 ? 's' : ''} total</Text>
                            </div>
                            {renderUploadTreeNode(tree, 1)}
                        </div>
                    );
                })()}

                {/* Progress bar */}
                {fuUploading && (
                    <div style={{ marginBottom: 16 }}>
                        <Text style={{ color: t.textMuted, fontSize: 12, display: 'block', marginBottom: 6 }}>
                            Uploading… {fuProgress.done} / {fuProgress.total}
                        </Text>
                        <Progress
                            percent={fuProgress.total > 0 ? Math.round((fuProgress.done / fuProgress.total) * 100) : 0}
                            strokeColor={t.accent} trailColor={t.border} size="small"
                        />
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                    <Button
                        disabled={fuUploading}
                        style={{ borderColor: t.border, color: t.textMuted }}
                        onClick={() => { setFuModal(false); setFuEntries([]); setFuProject(null); setFuTargetFolder(null); setFuRootName(''); }}
                    >Cancel</Button>
                    <Button
                        type="primary" loading={fuUploading}
                        disabled={!fuProject || fuEntries.length === 0}
                        style={{ background: t.success, borderColor: t.success }}
                        onClick={handleFolderUpload}
                    >Upload {fuEntries.length > 0 ? `${fuEntries.length} PDF${fuEntries.length !== 1 ? 's' : ''}` : 'Folder'}</Button>
                </div>
            </Modal>

            {/* ── PDF Viewer Modal ────────────────────────────── */}
            <Modal
                open={!!viewFile}
                title={viewFile?.originalName}
                onCancel={closeViewer}
                footer={
                    <Button icon={<DownloadOutlined />} onClick={() => viewFile && downloadFile(viewFile)}
                        style={{ borderColor: t.border, color: t.textMuted }}>
                        Download
                    </Button>
                }
                width="88vw"
                destroyOnClose
            >
                {viewFile && viewBlobUrl && (
                    <iframe src={viewBlobUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={viewFile.originalName} />
                )}
            </Modal>
        </div>
    );
}
