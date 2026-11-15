import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Typography, Spin, Alert, Button, Tag, Space, Modal, Select, TreeSelect,
    message, Empty, Row, Col, Card, Tooltip, Input, Form,
    Drawer, Popconfirm, Descriptions, Upload, Divider, Table,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
    PlusOutlined, EditOutlined, DeleteOutlined,
    SearchOutlined, BookOutlined, LinkOutlined,
    EyeOutlined, ExperimentOutlined, FilterOutlined, UserAddOutlined,
    FilePdfOutlined, FileTextOutlined, DownloadOutlined, UploadOutlined,
    CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
    FolderOutlined, FolderAddOutlined, HomeOutlined, RightOutlined, LeftOutlined, ArrowsAltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { DatePicker } from 'antd';
import api from '../../api/axios';
import { useAuthStore } from '../../store/authStore';
import { usePermissions } from '../../hooks/usePermissions';
import UserAvatar from '../../components/UserAvatar';
import { useTheme } from '../../theme/useTheme';
import { PageHeader } from '../../components/ui';
import { alpha, readableOn } from '../../theme/tokens';
import { useDeepLinkId } from '../../hooks/useDeepLink';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;


/* ── Types ───────────────────────────────────────────────── */

interface Paper {
    id: string;
    projectId: string;
    title: string;
    authors?: string;
    year?: number;
    venue?: string;
    doi?: string;
    url?: string;
    abstract?: string;
    notes?: string;
    tags: string[];
    addedBy?: string;
    addedByUser?: { id: string; fullName: string; avatarUrl?: string | null };
    project?: { id: string; name: string };
    files?: PaperFileLink[];
    folderId?: string | null;
    createdAt: string;
    updatedAt: string;
}

interface FileFolder {
    id: string;
    projectId: string;
    parentId: string | null;
    type: string;
    name: string;
    createdAt: string;
}

type FolderTreeNode = { value: string; title: string; children: FolderTreeNode[] };
function buildFolderTree(folders: FileFolder[], parentId: string | null = null): FolderTreeNode[] {
    return folders
        .filter(f => (f.parentId ?? null) === parentId)
        .map(f => ({ value: f.id, title: f.name, children: buildFolderTree(folders, f.id) }));
}

interface FolderNavState {
    folderId: string | null;
    path: { id: string; name: string }[];
}

interface PaperFileLink {
    id: string;
    fileId: string;
    fileType: string;
    file?: { id: string; originalName: string; mimeType: string; fileSize: number; status?: string };
    createdAt: string;
}

interface Project { id: string; name: string; }

interface ProjectFile {
    id: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    type?: string;
    status?: string;
    createdAt?: string;
    project?: { id: string; name: string };
    uploader?: { id: string; fullName: string; avatarUrl?: string | null };
}

/* ── Helpers ─────────────────────────────────────────────── */

function sizeLabel(bytes: number): string {
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
}

/* ── Component ───────────────────────────────────────────── */

export default function PapersPage() {
    const deepLinkId = useDeepLinkId('paperId', 'openPaperId');
    const { t } = useTheme();
    const { user } = useAuthStore();
    const { hasPermission } = usePermissions();
    const navigate = useNavigate();
    const canReviewPapers = hasPermission('manage_projects');
    const canLeadProjects = hasPermission('lead_projects');

    /* ── State ───────────────────────────────────────────── */
    const [papers,     setPapers]       = useState<Paper[]>([]);
    const [projects,   setProjects]     = useState<Project[]>([]);
    const [allTags,    setAllTags]      = useState<string[]>([]);
    const [loading,    setLoading]      = useState(true);
    const [pendingPaperFiles,   setPendingPaperFiles]   = useState<ProjectFile[]>([]);
    const [myPendingPaperFiles, setMyPendingPaperFiles] = useState<ProjectFile[]>([]);

    // Filters
    const [filterProject, setFilterProject] = useState<string | undefined>();
    const [filterTags,    setFilterTags]    = useState<string[]>([]);
    const [searchText,    setSearchText]    = useState('');

    // Modals / drawers
    const [createModal,   setCreateModal]   = useState(false);
    const [editModal,     setEditModal]     = useState(false);
    const [saving,        setSaving]        = useState(false);
    const [detailDrawer,  setDetailDrawer]  = useState(false);
    const [linkFileModal, setLinkFileModal] = useState(false);
    const [selectedPaper, setSelectedPaper] = useState<Paper | null>(null);

    // Link file state
    const [projectFiles,     setProjectFiles]     = useState<ProjectFile[]>([]);
    const [selectedFileId,   setSelectedFileId]   = useState<string | undefined>();
    const [selectedFileType, setSelectedFileType] = useState<string>('pdf');

    // PDF viewer (modal, like manuals)
    const [viewBlobUrl, setViewBlobUrl] = useState<string | null>(null);
    const [viewFile, setViewFile] = useState<{ name: string } | null>(null);
    const [viewFileId, setViewFileId] = useState<string | null>(null);

    // Upload state
    const [uploading, setUploading] = useState(false);
    const [createPdfFile, setCreatePdfFile] = useState<File | null>(null);

    // Assign to read
    const [assignModal, setAssignModal] = useState(false);
    const [assignPaper, setAssignPaper] = useState<Paper | null>(null);
    const [projectMembers, setProjectMembers] = useState<{ userId: string; user?: { id: string; fullName: string; role?: string } }[]>([]);
    const [assigneeId, setAssigneeId] = useState<string | undefined>();
    const [assignDeadline, setAssignDeadline] = useState<string | undefined>();
    const [assignSubProject, setAssignSubProject] = useState<string | undefined>();
    const [assignPriority, setAssignPriority] = useState<string>('Medium');
    const [assignGoal, setAssignGoal] = useState<string>('');
    const [assignSubProjects, setAssignSubProjects] = useState<{ id: string; name: string }[]>([]);
    const [assignLoading, setAssignLoading] = useState(false);

    const [readTasks, setReadTasks] = useState<any[]>([]);
    const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

    const canCreateFolders = canReviewPapers || canLeadProjects;

    // Per-project folder navigation
    const [folderNav,  setFolderNav]  = useState<Record<string, FolderNavState>>({});
    const [folders,    setFolders]    = useState<Record<string, FileFolder[]>>({});
    const [allFolders, setAllFolders] = useState<Record<string, FileFolder[]>>({});

    // New-folder modal
    const [newFolderModal,   setNewFolderModal]   = useState(false);
    const [newFolderProject, setNewFolderProject] = useState<string | null>(null);
    const [newFolderName,    setNewFolderName]    = useState('');
    const [newFolderSaving,  setNewFolderSaving]  = useState(false);

    // Move-paper modal
    const [movePaperModal,   setMovePaperModal]   = useState(false);
    const [movePaperTarget,  setMovePaperTarget]  = useState<Paper | null>(null);
    const [movePaperDest,    setMovePaperDest]    = useState<string | null>(null);
    const [movePaperLoading, setMovePaperLoading] = useState(false);

    // Rename-folder modal
    const [renameModal,  setRenameModal]  = useState(false);
    const [renameFolder, setRenameFolder] = useState<FileFolder | null>(null);
    const [renameName,   setRenameName]   = useState('');
    const [renameSaving, setRenameSaving] = useState(false);

    const [createForm] = Form.useForm();
    const [editForm]   = Form.useForm();

    /* ── Data loading ────────────────────────────────────── */

    const loadPendingPapers = useCallback(async () => {
        if (!canReviewPapers) return;
        try {
            const res = await api.get('/files/papers/pending');
            setPendingPaperFiles(res.data);
        } catch { /* ignore */ }
    }, [canReviewPapers]);

    const loadMyPendingPapers = useCallback(async () => {
        if (canReviewPapers) return;
        try {
            const res = await api.get('/files/my-pending');
            setMyPendingPaperFiles((res.data as ProjectFile[]).filter(f => f.type === 'paper'));
        } catch { /* ignore */ }
    }, [canReviewPapers]);

    const loadPapers = useCallback(async () => {
        setLoading(true);
        try {
            const params: Record<string, string> = {};
            if (filterProject) params.projectId = filterProject;
            if (filterTags.length) params.tags = filterTags.join(',');
            if (searchText.trim()) params.search = searchText.trim();

            const res = await api.get('/papers', { params });
            const loaded = res.data as Paper[];
            setPapers(loaded);
        } catch {
            message.error('Failed to load papers');
        } finally {
            setLoading(false);
        }
    }, [filterProject, filterTags, searchText]);

    const loadMeta = useCallback(async () => {
        try {
            const [projRes, tagsRes] = await Promise.all([
                api.get('/projects'),
                api.get('/papers/tags'),
            ]);
            setProjects(projRes.data);
            setAllTags(tagsRes.data);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { loadMeta(); }, [loadMeta]);
    useEffect(() => { loadPapers(); }, [loadPapers]);
    useEffect(() => { loadPendingPapers(); loadMyPendingPapers(); }, [loadPendingPapers, loadMyPendingPapers]);

    const loadFolders = useCallback(async (projectId: string, parentId: string | null) => {
        try {
            const params: Record<string, string> = { projectId, type: 'paper', parentId: parentId ?? 'root' };
            const res = await api.get('/file-folders', { params });
            setFolders(prev => ({ ...prev, [projectId]: res.data }));
        } catch { /* ignore */ }
    }, []);

    const loadAllFolders = useCallback(async (projectId: string) => {
        try {
            const res = await api.get('/file-folders/all', { params: { projectId, type: 'paper' } });
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
                projectId: newFolderProject, type: 'paper',
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
            message.success('Folder deleted — contents moved to parent level');
            const nav = folderNav[folder.projectId] ?? { folderId: null, path: [] };
            loadFolders(folder.projectId, nav.folderId);
            loadAllFolders(folder.projectId);
            loadPapers();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Failed to delete folder');
        }
    }, [folderNav, loadFolders, loadAllFolders, loadPapers]);

    const openMovePaperModal = useCallback((paper: Paper) => {
        setMovePaperTarget(paper); setMovePaperDest(paper.folderId ?? null); setMovePaperModal(true);
        loadAllFolders(paper.projectId);
    }, [loadAllFolders]);

    const handleMovePaper = useCallback(async () => {
        if (!movePaperTarget) return;
        setMovePaperLoading(true);
        try {
            await api.patch(`/papers/${movePaperTarget.id}/move`, { folderId: movePaperDest ?? null });
            message.success('Paper moved');
            setMovePaperModal(false); setMovePaperTarget(null);
            loadPapers();
        } catch (e: any) {
            message.error(e?.response?.data?.message ?? 'Move failed');
        } finally { setMovePaperLoading(false); }
    }, [movePaperTarget, movePaperDest, loadPapers]);

    /* ── Handlers ────────────────────────────────────────── */

    const openCreateModal = () => {
        if (!projects.length) {
            message.warning('No projects available — create a project first');
            return;
        }
        createForm.resetFields();
        setCreateModal(true);
    };

    const handleCreate = async () => {
        if (saving) return;
        try {
            const values = await createForm.validateFields();
            setSaving(true);
            const res = await api.post('/papers', values);
            const newPaper = res.data;

            // Upload PDF if one was selected
            if (createPdfFile && newPaper?.id) {
                try {
                    const fd = new FormData();
                    fd.append('file', createPdfFile);
                    await api.post(`/papers/${newPaper.id}/upload`, fd);
                } catch { message.warning('Paper created but PDF upload failed'); }
            }

            message.success('Paper added');
            setCreateModal(false);
            createForm.resetFields();
            setCreatePdfFile(null);
            loadPapers();
            loadMeta();
        } catch { /* validation or API error */ } finally {
            setSaving(false);
        }
    };

    const handleEdit = async () => {
        if (!selectedPaper) return;
        try {
            const values = await editForm.validateFields();
            await api.patch(`/papers/${selectedPaper.id}`, values);
            message.success('Paper updated');
            setEditModal(false);
            editForm.resetFields();
            loadPapers();
            loadMeta();
            // Refresh detail drawer if open
            if (detailDrawer) openDetail(selectedPaper.id);
        } catch { /* validation or API error */ }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/papers/${id}`);
            message.success('Paper deleted');
            loadPapers();
            if (selectedPaper?.id === id) {
                setDetailDrawer(false);
                setSelectedPaper(null);
            }
        } catch {
            message.error('Delete failed');
        }
    };

    const openDetail = async (id: string) => {
        try {
            const [paperRes, tasksRes] = await Promise.all([
                api.get(`/papers/${id}`),
                api.get(`/papers/${id}/read-tasks`),
            ]);
            setSelectedPaper(paperRes.data);
            setReadTasks(tasksRes.data ?? []);
            setDetailDrawer(true);
        } catch {
            message.error('Failed to load paper details');
        }
    };

    // Auto-open a paper when navigated here from a task with a paper link
    useEffect(() => {
        const openId = deepLinkId;
        if (openId) {
            navigate('/papers', { replace: true, state: {} });
            openDetail(openId);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deepLinkId]);

    const openEdit = (paper: Paper) => {
        setSelectedPaper(paper);
        editForm.setFieldsValue({
            title: paper.title,
            authors: paper.authors,
            year: paper.year,
            venue: paper.venue,
            doi: paper.doi,
            url: paper.url,
            abstract: paper.abstract,
            notes: paper.notes,
            tags: paper.tags,
        });
        setEditModal(true);
    };

    const openLinkFile = async (paper: Paper) => {
        setSelectedPaper(paper);
        try {
            const res = await api.get(`/files/projects/${paper.projectId}`, { params: { type: 'paper' } });
            setProjectFiles(res.data);
        } catch {
            setProjectFiles([]);
        }
        setSelectedFileId(undefined);
        setSelectedFileType('pdf');
        setLinkFileModal(true);
    };

    const handleLinkFile = async () => {
        if (!selectedPaper || !selectedFileId) return;
        try {
            await api.post(`/papers/${selectedPaper.id}/files`, {
                fileId: selectedFileId,
                fileType: selectedFileType,
            });
            message.success('File linked');
            setLinkFileModal(false);
            openDetail(selectedPaper.id);
        } catch {
            message.error('Failed to link file');
        }
    };

    const handleUnlinkFile = async (linkId: string) => {
        if (!selectedPaper) return;
        try {
            await api.delete(`/papers/${selectedPaper.id}/files/${linkId}`);
            message.success('File unlinked');
            openDetail(selectedPaper.id);
        } catch {
            message.error('Failed to unlink file');
        }
    };

    const openPdfViewer = async (fileId: string, fileName: string) => {
        try {
            const res = await api.get(`/files/serve/${fileId}`, { responseType: 'blob' });
            setViewBlobUrl(URL.createObjectURL(res.data));
            setViewFile({ name: fileName });
            setViewFileId(fileId);
        } catch {
            message.error('Could not load file');
        }
    };

    const downloadFile = (fileId: string, fileName: string) => {
        const token = useAuthStore.getState().accessToken;
        const a = document.createElement('a');
        a.href = `/api/files/serve/${fileId}?token=${encodeURIComponent(token ?? '')}`;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const closeViewer = () => {
        setViewFile(null);
        setViewFileId(null);
        if (viewBlobUrl) { URL.revokeObjectURL(viewBlobUrl); setViewBlobUrl(null); }
    };

    const approvePaperFile = async (fileId: string) => {
        try {
            await api.patch(`/files/${fileId}/approve`);
            message.success('PDF approved — it is now visible to the team');
            if (selectedPaper) openDetail(selectedPaper.id);
        } catch { message.error('Approval failed'); }
    };

    const rejectPaperFile = async (fileId: string) => {
        try {
            await api.delete(`/files/${fileId}/reject`);
            message.success('PDF rejected and removed');
            if (selectedPaper) openDetail(selectedPaper.id);
        } catch { message.error('Rejection failed'); }
    };

    /** Edit metadata: manage_projects, or the paper's own creator — matches backend papers.service.ts canModify(). */
    const canEdit = (paper: Paper) =>
        canReviewPapers || paper.addedBy === user?.id;

    /** Delete paper: requires manage_projects. */
    const canDelete = () => canReviewPapers;

    /** Matches backend's route-level gate (papers.controller.ts assign is
     * @Permissions('manage_tasks')); the backend itself further scopes what a
     * lead_projects-only caller can do, so the frontend doesn't need to
     * duplicate a "must lead this specific project" check. */
    const canAssign = (_paper: Paper) => hasPermission('manage_tasks');

    const openAssignModal = async (paper: Paper) => {
        setAssignPaper(paper);
        setAssigneeId(undefined);
        setAssignDeadline(undefined);
        setAssignSubProject(undefined);
        setAssignPriority('Medium');
        setAssignGoal('');
        setAssignSubProjects([]);
        try {
            const [memRes, subRes] = await Promise.all([
                api.get(`/projects/${paper.projectId}/members`),
                api.get(`/projects/${paper.projectId}/subprojects`),
            ]);
            setProjectMembers(memRes.data);
            setAssignSubProjects(subRes.data);
        } catch {
            setProjectMembers([]);
        }
        setAssignModal(true);
    };

    const handleAssign = async () => {
        if (!assignPaper || !assigneeId) return;
        setAssignLoading(true);
        try {
            const body: Record<string, string> = { assigneeId, priority: assignPriority };
            if (assignDeadline) body.deadline = assignDeadline;
            if (assignSubProject) body.subProjectId = assignSubProject;
            if (assignGoal.trim()) body.goal = assignGoal.trim();
            const res = await api.post(`/papers/${assignPaper.id}/assign`, body);
            message.success(res.data?.requested ? 'Reading request sent to the reviewer' : 'Reading task created');
            setAssignModal(false);
        } catch (err: any) {
            message.error(err?.response?.data?.message ?? 'Failed to assign');
        } finally {
            setAssignLoading(false);
        }
    };

    /* ── Stat counts ─────────────────────────────────────── */
    const projectCount = new Set(papers.map(p => p.projectId)).size;

    // Group papers by project for card-grid display
    const grouped: Record<string, { project: { id: string; name: string }; papers: Paper[] }> = {};
    for (const p of papers) {
        if (!p.project) continue;
        const pid = p.project.id;
        if (!grouped[pid]) grouped[pid] = { project: p.project, papers: [] };
        grouped[pid].papers.push(p);
    }

    /* ── Folder browser render ───────────────────────────── */
    const renderPaperFolderBrowser = (projectId: string, allPapers: Paper[]) => {
        const nav = folderNav[projectId] ?? { folderId: null, path: [] };
        const curFolders = folders[projectId] ?? [];
        const visiblePapers = allPapers.filter(p => (p.folderId ?? null) === nav.folderId);
        const isEmpty = curFolders.length === 0 && visiblePapers.length === 0;

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
                            style={{ color: nav.path.length > 0 ? t.text : `${t.textMuted}44`, padding: '0 4px' }}
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
                    const cnt = allPapers.filter(p => p.folderId === folder.id).length;
                    return (
                        <div key={folder.id}
                            style={{
                                display: 'grid', gridTemplateColumns: '1fr 130px 120px 52px 64px auto',
                                padding: '6px 16px', cursor: 'pointer', alignItems: 'center',
                                borderBottom: `1px solid ${t.border}0a`, transition: 'background 0.1s',
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
                                {canCreateFolders && (
                                    <Popconfirm title="Delete this folder?" description="All papers inside will be moved to the parent level." onConfirm={() => handleDeleteFolder(folder)}>
                                        <Tooltip title="Delete folder"><Button size="small" type="text" icon={<DeleteOutlined />} danger style={{ padding: 2 }} /></Tooltip>
                                    </Popconfirm>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* ── Paper rows ────────────────────────────────── */}
                {visiblePapers.map(p => {
                    const firstFile = p.files?.[0] ?? null;
                    const hasPdf = !!firstFile;
                    const fileStatus = firstFile?.file?.status;
                    const ownerName = p.addedByUser?.fullName;
                    const ownerAvatar = p.addedByUser?.avatarUrl;
                    return (
                        <div key={p.id}
                            style={{
                                display: 'grid', gridTemplateColumns: '1fr 130px 120px 52px 64px auto',
                                padding: '6px 16px', cursor: hasPdf && fileStatus === 'approved' ? 'pointer' : 'default',
                                alignItems: 'center', borderBottom: `1px solid ${t.border}0a`, transition: 'background 0.1s',
                            }}
                            onClick={() => hasPdf && fileStatus === 'approved' && firstFile ? openPdfViewer(firstFile.fileId, firstFile.file!.originalName) : openDetail(p.id)}
                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = t.surfaceRaised; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                {hasPdf
                                    ? <FilePdfOutlined style={{ color: t.danger, fontSize: 16, flexShrink: 0 }} />
                                    : <FileTextOutlined style={{ color: t.purple, fontSize: 16, flexShrink: 0 }} />}
                                <Text style={{ color: t.text, fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }} title={p.title}>
                                    {p.title}
                                </Text>
                                {p.tags.slice(0, 1).map(tag => (
                                    <Tag key={tag} style={{ fontSize: 10, padding: '0 5px', margin: 0, borderRadius: 8, background: alpha(t.purple, 0.09), color: t.purple, border: `1px solid ${alpha(t.purple, 0.27)}`, flexShrink: 0 }}>{tag}</Tag>
                                ))}
                                {hasPdf && fileStatus !== 'approved' && (
                                    <Tag style={{ fontSize: 10, padding: '0 5px', margin: 0, background: `${t.warning}22`, color: t.warning, border: `1px solid ${t.warning}44`, flexShrink: 0 }}>Pending</Tag>
                                )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                {ownerName && (
                                    <UserAvatar
                                        name={ownerName}
                                        avatarUrl={ownerAvatar}
                                        size={18}
                                        style={{ border: `1px solid ${t.border}` }}
                                    />
                                )}
                                <Text style={{ color: t.textMuted, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{ownerName ?? '—'}</Text>
                            </div>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{dayjs(p.createdAt).format('MMM D, YYYY')}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{hasPdf ? 'PDF' : 'Meta'}</Text>
                            <Text style={{ color: t.textMuted, fontSize: 12 }}>{hasPdf && firstFile?.file ? sizeLabel(firstFile.file.fileSize) : '—'}</Text>
                            <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>
                                {hasPdf && fileStatus === 'approved' && firstFile && (
                                    <Tooltip title="Preview PDF">
                                        <Button size="small" type="text" icon={<EyeOutlined />} style={{ color: t.accent, padding: 2 }}
                                            onClick={() => openPdfViewer(firstFile.fileId, firstFile.file!.originalName)} />
                                    </Tooltip>
                                )}
                                {hasPdf && fileStatus === 'approved' && firstFile && (
                                    <Tooltip title="Download">
                                        <Button size="small" type="text" icon={<DownloadOutlined />} style={{ color: t.textMuted, padding: 2 }}
                                            onClick={() => downloadFile(firstFile.fileId, firstFile.file!.originalName)} />
                                    </Tooltip>
                                )}
                                {canCreateFolders && (
                                    <Tooltip title="Move">
                                        <Button size="small" type="text" icon={<ArrowsAltOutlined />} style={{ color: t.purple, padding: 2 }} onClick={() => openMovePaperModal(p)} />
                                    </Tooltip>
                                )}
                                {canAssign(p) && (
                                    <Tooltip title="Assign to read">
                                        <Button size="small" type="text" icon={<UserAddOutlined />} style={{ color: t.success, padding: 2 }} onClick={() => openAssignModal(p)} />
                                    </Tooltip>
                                )}
                                {canEdit(p) && (
                                    <Tooltip title="Edit">
                                        <Button size="small" type="text" icon={<EditOutlined />} style={{ color: t.textMuted, padding: 2 }} onClick={() => openEdit(p)} />
                                    </Tooltip>
                                )}
                                {canDelete() && (
                                    <Popconfirm title="Delete this paper?" onConfirm={() => handleDelete(p.id)}>
                                        <Tooltip title="Delete">
                                            <Button size="small" type="text" icon={<DeleteOutlined />} danger style={{ padding: 2 }} />
                                        </Tooltip>
                                    </Popconfirm>
                                )}
                                {p.doi && (
                                    <Tooltip title="Open DOI">
                                        <Button size="small" type="text" icon={<LinkOutlined />} style={{ color: t.textMuted, padding: 2 }}
                                            onClick={() => window.open(`https://doi.org/${p.doi}`, '_blank')} />
                                    </Tooltip>
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

    /* ── Paper form fields (shared by create & edit) ──────── */
    const paperFormFields = (isEdit: boolean) => (
        <>
            {!isEdit && (
                <Form.Item name="projectId" label="Project" rules={[{ required: true, message: 'Select a project' }]}>
                    <Select placeholder="Select project" options={projects.map(p => ({ label: p.name, value: p.id }))}
                        showSearch filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
                        onChange={v => { createForm.setFieldValue('folderId', undefined); if (v) loadAllFolders(v); }} />
                </Form.Item>
            )}
            {!isEdit && (
                <Form.Item noStyle shouldUpdate={(prev, cur) => prev.projectId !== cur.projectId}>
                    {({ getFieldValue }) => {
                        const pid = getFieldValue('projectId');
                        const opts = pid ? (allFolders[pid] ?? []) : [];
                        if (!pid || opts.length === 0) return null;
                        return (
                            <Form.Item name="folderId" label="Folder (optional)">
                                <TreeSelect
                                    allowClear placeholder="Root (no folder)"
                                    treeData={buildFolderTree(opts)}
                                    treeLine showSearch treeNodeFilterProp="title"
                                />
                            </Form.Item>
                        );
                    }}
                </Form.Item>
            )}
            <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
                <Input placeholder="Paper title" />
            </Form.Item>
            <Form.Item name="authors" label="Authors">
                <Input placeholder='e.g. Smith, J.; Chen, W.' />
            </Form.Item>
            <Row gutter={12}>
                <Col span={8}>
                    <Form.Item name="year" label="Year">
                        <Input type="number" placeholder="2024" />
                    </Form.Item>
                </Col>
                <Col span={16}>
                    {isEdit && (
                        <Form.Item name="venue" label="Venue">
                            <Input placeholder="Journal or conference" />
                        </Form.Item>
                    )}
                </Col>
            </Row>
            <Row gutter={12}>
                <Col span={12}>
                    <Form.Item name="doi" label="DOI">
                        <Input placeholder="10.1000/xyz123" />
                    </Form.Item>
                </Col>
                <Col span={12}>
                    <Form.Item name="url" label="URL">
                        <Input placeholder="https://..." />
                    </Form.Item>
                </Col>
            </Row>
            {isEdit && (
                <Form.Item name="abstract" label="Abstract">
                    <TextArea rows={3} placeholder="Paper abstract" />
                </Form.Item>
            )}
            <Form.Item name="notes" label="Notes">
                <TextArea rows={2} placeholder="Your annotations / key takeaways" />
            </Form.Item>
            <Form.Item name="tags" label="Tags">
                <Select mode="tags" placeholder="Add tags" tokenSeparators={[',']}
                    options={allTags.map(t => ({ label: t, value: t }))} />
            </Form.Item>
            {!isEdit && (
                <Form.Item label="PDF File (optional)">
                    <Upload.Dragger
                        name="file" accept=".pdf" multiple={false}
                        showUploadList={!!createPdfFile}
                        fileList={createPdfFile ? [{ uid: '-1', name: createPdfFile.name, status: 'done' as const }] : []}
                        beforeUpload={(file) => {
                            setCreatePdfFile(file);
                            return false; // prevent auto-upload
                        }}
                        onRemove={() => { setCreatePdfFile(null); }}
                        style={{ background: t.surfaceRaised, border: `2px dashed ${t.border}`, borderRadius: 10 }}
                    >
                        <p style={{ color: t.textMuted, marginBottom: 4 }}><FilePdfOutlined style={{ fontSize: 24, color: t.danger }} /></p>
                        <p style={{ color: t.text, fontWeight: 600, fontSize: 12, marginBottom: 2 }}>Click or drag a PDF</p>
                        <p style={{ color: t.textMuted, fontSize: 11 }}>Will be attached to the paper after creation</p>
                    </Upload.Dragger>
                </Form.Item>
            )}
        </>
    );

    /* ── Render ───────────────────────────────────────────── */
    return (
        <div style={{ padding: '24px 28px', background: t.bg, minHeight: '100vh' }}>

            <PageHeader
                title={<Space size={8}><BookOutlined />Papers &amp; References</Space>}
                subtitle="Literature references organised by project — search, tag and annotate"
                actions={
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}
                        style={{ background: t.success, borderColor: t.success }}>
                        Add Paper
                    </Button>
                }
            />

            {/* ── Stat Cards ─────────────────────────────── */}
            <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
                {[
                    { label: 'Total Papers', value: papers.length, color: t.accent, icon: <BookOutlined /> },
                    { label: 'Projects',      value: projectCount, color: t.purple, icon: <ExperimentOutlined /> },
                    ...(canReviewPapers ? [{ label: 'Pending Review', value: pendingPaperFiles.length, color: pendingPaperFiles.length > 0 ? t.warning : t.textMuted, icon: <ClockCircleOutlined /> }] : []),
                ].map(s => (
                    <Col key={s.label} xs={12} sm={6}>
                        <Card style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10 }}
                            styles={{ body: { padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 } }}>
                            <div style={{
                                width: 40, height: 40, borderRadius: 10,
                                background: `${s.color}18`, border: `1px solid ${s.color}44`,
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

            {/* ── Pending review (reviewer) ───────────────── */}
            {canReviewPapers && pendingPaperFiles.length > 0 && (() => {
                const pendingColumns: TableColumnsType<ProjectFile> = [
                    {
                        title: 'File', dataIndex: 'originalName',
                        render: (name: string) => (
                            <Space size={10}>
                                <div style={{ width: 32, height: 32, borderRadius: 8, background: `${t.danger}18`, border: `1px solid ${t.danger}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.danger, flexShrink: 0 }}>
                                    <FilePdfOutlined />
                                </div>
                                <Text style={{ color: t.text, fontWeight: 600 }}>{name}</Text>
                            </Space>
                        ),
                    },
                    { title: 'Project', dataIndex: 'project', width: 160, render: (p?: { name: string }) => <Text style={{ color: t.textMuted }}>{p?.name ?? '—'}</Text> },
                    { title: 'Submitted by', dataIndex: 'uploader', width: 140, render: (u?: { fullName: string }) => <Text style={{ color: t.textMuted }}>{u?.fullName ?? '—'}</Text> },
                    { title: 'Date', dataIndex: 'createdAt', width: 110, render: (d: string) => <Text style={{ color: t.textMuted }}>{dayjs(d).format('MMM D, YYYY')}</Text> },
                    {
                        title: '', width: 220,
                        render: (_: unknown, rec: ProjectFile) => (
                            <Space>
                                <Button size="small" type="primary" icon={<CheckCircleOutlined />}
                                    style={{ background: t.success, borderColor: t.success }}
                                    onClick={async () => { await approvePaperFile(rec.id); loadPendingPapers(); }}>Approve</Button>
                                <Popconfirm title="Reject and delete this PDF?" onConfirm={async () => { await rejectPaperFile(rec.id); loadPendingPapers(); }}>
                                    <Button size="small" danger icon={<CloseCircleOutlined />}>Reject</Button>
                                </Popconfirm>
                            </Space>
                        ),
                    },
                ];
                return (
                    <div style={{ marginBottom: 24, background: t.surface, border: `1px solid ${t.warning}44`, borderRadius: 10, overflow: 'hidden' }}>
                        <div style={{ padding: '12px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                            <ClockCircleOutlined style={{ color: t.warning, fontSize: 16 }} />
                            <Text style={{ color: t.text, fontWeight: 700 }}>Pending PDF Review</Text>
                            <span style={{ background: t.warning, color: readableOn(t.warning, t), borderRadius: 10, fontSize: 11, fontWeight: 700, padding: '0 7px' }}>{pendingPaperFiles.length}</span>
                        </div>
                        <Table
                            dataSource={pendingPaperFiles}
                            rowKey="id"
                            size="small"
                            pagination={false}
                            columns={pendingColumns}
                            style={{ background: t.surface }}
                        />
                    </div>
                );
            })()}

            {/* ── My pending submissions ─────────────────── */}
            {!canReviewPapers && myPendingPaperFiles.length > 0 && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 20, background: `${t.warning}11`, border: `1px solid ${t.warning}44`, borderRadius: 10 }}
                    message={<Text style={{ color: t.warning, fontWeight: 700 }}>
                        {myPendingPaperFiles.length} PDF{myPendingPaperFiles.length > 1 ? 's' : ''} pending review
                    </Text>}
                    description={<Text style={{ color: t.textMuted, fontSize: 12 }}>
                        {myPendingPaperFiles.map(f => f.originalName).join(', ')}
                    </Text>}
                />
            )}

            {/* ── Filters ────────────────────────────────── */}
            <div style={{
                display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center',
                padding: '12px 16px', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10,
            }}>
                <FilterOutlined style={{ color: t.textMuted, fontSize: 14 }} />
                <Input
                    prefix={<SearchOutlined style={{ color: t.textMuted }} />}
                    placeholder="Search title, authors, abstract..."
                    value={searchText}
                    onChange={e => setSearchText(e.target.value)}
                    allowClear
                    style={{ width: 260 }}
                />
                <Select
                    placeholder="Project"
                    value={filterProject}
                    onChange={setFilterProject}
                    allowClear
                    style={{ width: 180 }}
                    options={projects.map(p => ({ label: p.name, value: p.id }))}
                    showSearch
                    filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
                />
                <Select
                    mode="multiple"
                    placeholder="Tags"
                    value={filterTags}
                    onChange={setFilterTags}
                    allowClear
                    style={{ minWidth: 180, maxWidth: 300 }}
                    options={allTags.map(t => ({ label: t, value: t }))}
                />
                {(filterProject || filterTags.length > 0 || searchText) && (
                    <Button size="small" type="link" onClick={() => { setFilterProject(undefined); setFilterTags([]); setSearchText(''); }}>
                        Clear all
                    </Button>
                )}
            </div>

            {/* ── Paper grid (grouped by project) ────────── */}
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 60 }}>
                    <Spin size="large" />
                </div>
            ) : papers.length === 0 ? (
                <Empty description={<span style={{ color: t.textMuted }}>No papers found</span>} style={{ marginTop: 60 }}>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                        Add your first paper
                    </Button>
                </Empty>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.values(grouped).map(({ project: proj, papers: projPapers }) => {
                        const isOpen = expandedProjects.has(proj.id);
                        return (
                            <div key={proj.id} style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden' }}>
                                {/* Project header */}
                                <div
                                onClick={() => handleProjectToggle(proj.id)}
                                    style={{
                                        padding: '12px 18px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        borderBottom: isOpen ? `1px solid ${t.border}` : 'none',
                                        background: isOpen ? t.surfaceRaised : t.surface,
                                        userSelect: 'none',
                                    }}
                                >
                                    <Space size={12}>
                                        <ExperimentOutlined style={{ color: t.purple, fontSize: 18 }} />
                                        <Text style={{ color: t.text, fontWeight: 700, fontSize: 14 }}>{proj.name}</Text>
                                        <Tag style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.textMuted, borderRadius: 10, fontSize: 11 }}>
                                            {projPapers.length} paper{projPapers.length !== 1 ? 's' : ''}
                                        </Tag>
                                    </Space>
                                    <Text style={{ color: t.textMuted, fontSize: 11 }}>{isOpen ? '▲' : '▼'}</Text>
                                </div>

                                {/* Paper folder browser */}
                                {isOpen && renderPaperFolderBrowser(proj.id, projPapers)}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Create Modal ───────────────────────────── */}
            <Modal
                title="Add Paper"
                open={createModal}
                onOk={handleCreate}
                confirmLoading={saving}
                onCancel={() => { setCreateModal(false); createForm.resetFields(); setCreatePdfFile(null); }}
                okText="Add"
                width={640}
                okButtonProps={{ style: { background: t.success, borderColor: t.success } }}
            >
                <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
                    {paperFormFields(false)}
                </Form>
            </Modal>

            {/* ── Edit Modal ─────────────────────────────── */}
            <Modal
                title="Edit Paper"
                open={editModal}
                onOk={handleEdit}
                onCancel={() => { setEditModal(false); editForm.resetFields(); }}
                okText="Save"
                width={640}
            >
                <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
                    {paperFormFields(true)}
                </Form>
            </Modal>

            {/* ── Detail Drawer ──────────────────────────── */}
            <Drawer
                title={null}
                open={detailDrawer}
                onClose={() => { setDetailDrawer(false); setSelectedPaper(null); }}
                width={560}
                styles={{ body: { padding: 0, background: t.bg } }}
            >
                {selectedPaper && (
                    <div style={{ padding: '24px 24px 40px' }}>
                        {/* Title & Meta */}
                        <Title level={4} style={{ color: t.text, margin: 0 }}>{selectedPaper.title}</Title>
                        {selectedPaper.authors && (
                            <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginTop: 4 }}>
                                {selectedPaper.authors}
                            </Text>
                        )}
                        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            {selectedPaper.year && (
                                <Tag style={{ background: t.surface, border: `1px solid ${t.border}`, color: t.text, borderRadius: 10 }}>
                                    {selectedPaper.year}
                                </Tag>
                            )}
                            {selectedPaper.venue && (
                                <Tag style={{ background: `${t.accent}18`, color: t.accent, border: `1px solid ${t.accent}44`, borderRadius: 10 }}>
                                    {selectedPaper.venue}
                                </Tag>
                            )}
                        </div>
                        {selectedPaper.tags.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                {selectedPaper.tags.map(tag => (
                                    <Tag key={tag} style={{ fontSize: 11, background: alpha(t.purple, 0.09), color: t.purple, border: `1px solid ${alpha(t.purple, 0.27)}`, marginBottom: 4 }}>
                                        {tag}
                                    </Tag>
                                ))}
                            </div>
                        )}

                        {/* Links */}
                        <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {selectedPaper.doi && (
                                <a href={`https://doi.org/${selectedPaper.doi}`} target="_blank" rel="noreferrer"
                                    style={{ color: t.accent, fontSize: 12 }}>
                                    <LinkOutlined /> DOI: {selectedPaper.doi}
                                </a>
                            )}
                            {selectedPaper.url && (
                                <a href={selectedPaper.url} target="_blank" rel="noreferrer"
                                    style={{ color: t.accent, fontSize: 12 }}>
                                    <LinkOutlined /> URL
                                </a>
                            )}
                        </div>

                        {/* Abstract */}
                        {selectedPaper.abstract && (
                            <div style={{ marginTop: 20 }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Abstract
                                </Text>
                                <div style={{
                                    marginTop: 6, padding: '12px 16px', background: t.surface,
                                    border: `1px solid ${t.border}`, borderRadius: 8,
                                }}>
                                    <Paragraph style={{ color: t.text, fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {selectedPaper.abstract}
                                    </Paragraph>
                                </div>
                            </div>
                        )}

                        {/* Notes */}
                        {selectedPaper.notes && (
                            <div style={{ marginTop: 16 }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Notes
                                </Text>
                                <div style={{
                                    marginTop: 6, padding: '12px 16px', background: `${t.warning}0a`,
                                    border: `1px solid ${t.warning}30`, borderRadius: 8,
                                }}>
                                    <Paragraph style={{ color: t.text, fontSize: 13, margin: 0, whiteSpace: 'pre-wrap' }}>
                                        {selectedPaper.notes}
                                    </Paragraph>
                                </div>
                            </div>
                        )}

                        {/* Linked Files */}
                        <div style={{ marginTop: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Paper PDFs
                                </Text>
                                <Space size={6}>
                                    <Button size="small" icon={<LinkOutlined />} onClick={() => openLinkFile(selectedPaper)}
                                        style={{ fontSize: 11 }}>
                                        Link Existing
                                    </Button>
                                </Space>
                            </div>

                            {/* Upload drag area */}
                            <Upload.Dragger
                                name="file" accept=".pdf" multiple={false} showUploadList={false}
                                disabled={uploading}
                                customRequest={async ({ file, onSuccess, onError }) => {
                                    setUploading(true);
                                    try {
                                        const fd = new FormData();
                                        fd.append('file', file as Blob);
                                        await api.post(`/papers/${selectedPaper.id}/upload`, fd);
                                        message.success('PDF uploaded and linked');
                                        onSuccess?.({});
                                        openDetail(selectedPaper.id);
                                    } catch (e: any) {
                                        message.error(e?.response?.data?.message ?? 'Upload failed');
                                        onError?.(e);
                                    } finally { setUploading(false); }
                                }}
                                style={{ background: t.surfaceRaised, border: `2px dashed ${t.border}`, borderRadius: 10, marginBottom: 12 }}
                            >
                                <p style={{ color: t.textMuted, marginBottom: 4 }}><UploadOutlined style={{ fontSize: 20, color: t.textMuted }} /></p>
                                <p style={{ color: t.text, fontWeight: 600, fontSize: 12, marginBottom: 2 }}>Click or drag a PDF to upload</p>
                                <p style={{ color: t.textMuted, fontSize: 11 }}>PDF files only</p>
                                {uploading && <p style={{ color: t.accent, fontSize: 11 }}>Uploading…</p>}
                            </Upload.Dragger>

                            {/* File cards (manual-style) */}
                            {(!selectedPaper.files || selectedPaper.files.length === 0) ? (
                                <div style={{ padding: '16px', background: t.surface, border: `1px solid ${t.border}`, borderRadius: 8, textAlign: 'center' }}>
                                    <Text style={{ color: t.textMuted, fontSize: 12 }}>No files attached yet</Text>
                                </div>
                            ) : (
                                <Row gutter={[10, 10]}>
                                    {selectedPaper.files.map(link => (
                                        <Col xs={24} sm={12} key={link.id}>
                                            <Card
                                                style={{ background: t.surface, border: `1px solid ${t.border}`, borderRadius: 10, overflow: 'hidden', cursor: 'pointer' }}
                                                styles={{ body: { padding: 0 } }}
                                                onClick={() => link.file && openPdfViewer(link.fileId, link.file.originalName)}
                                            >
                                                <div style={{
                                                    background: `linear-gradient(135deg, ${t.surfaceRaised} 0%, ${t.surfaceRaised} 100%)`,
                                                    borderBottom: `1px solid ${t.border}`,
                                                    padding: '14px 12px',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column',
                                                }}>
                                                    <div style={{
                                                        width: 42, height: 42, borderRadius: 10,
                                                        background: `${t.danger}18`, border: `1px solid ${t.danger}44`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        marginBottom: 6,
                                                    }}>
                                                        <FilePdfOutlined style={{ fontSize: 20, color: t.danger }} />
                                                    </div>
                                                    <Tag style={{ background: `${t.accent}22`, color: t.accent, border: `1px solid ${t.accent}44`, fontSize: 10 }}>
                                                        {link.fileType}
                                                    </Tag>
                                                </div>
                                                <div style={{ padding: '10px 12px' }}>
                                                    <Text style={{
                                                        color: t.text, fontWeight: 600, fontSize: 12, display: 'block',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }} title={link.file?.originalName}>
                                                        {link.file?.originalName ?? 'Unknown file'}
                                                    </Text>
                                                    {link.file && (
                                                        <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>
                                                            {link.file.fileSize > 1048576
                                                                ? `${(link.file.fileSize / 1048576).toFixed(1)} MB`
                                                                : `${(link.file.fileSize / 1024).toFixed(0)} KB`}
                                                        </div>
                                                    )}
                                                </div>
                                                <div onClick={e => e.stopPropagation()} style={{ padding: '6px 12px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    {link.file && (
                                                        <>
                                                            <Tooltip title="Preview">
                                                                <Button size="small" type="text" icon={<EyeOutlined />}
                                                                    style={{ color: t.accent }}
                                                                    onClick={() => openPdfViewer(link.fileId, link.file!.originalName)} />
                                                            </Tooltip>
                                                            <Tooltip title="Download">
                                                                <Button size="small" type="text" icon={<DownloadOutlined />}
                                                                    style={{ color: t.textMuted }}
                                                                    onClick={() => downloadFile(link.fileId, link.file!.originalName)} />
                                                            </Tooltip>
                                                        </>
                                                    )}
                                                    {canEdit(selectedPaper) && (
                                                        <Popconfirm title="Unlink this file?" onConfirm={() => handleUnlinkFile(link.id)}>
                                                            <Tooltip title="Unlink">
                                                                <Button size="small" type="text" icon={<DeleteOutlined />} danger />
                                                            </Tooltip>
                                                        </Popconfirm>
                                                    )}
                                                    {/* Pending review badge + reviewer approve/reject */}
                                                    {link.file?.status === 'pending' && (
                                                        <Tag style={{
                                                            fontSize: 10, padding: '0 6px', margin: '0 0 0 auto', borderRadius: 8,
                                                            background: `${t.warning}22`, color: t.warning, border: `1px solid ${t.warning}44`,
                                                        }}>Pending Review</Tag>
                                                    )}
                                                    {canReviewPapers && link.file?.status === 'pending' && (
                                                        <>
                                                            <Tooltip title="Approve PDF">
                                                                <Button size="small" type="text" icon={<CheckCircleOutlined />}
                                                                    style={{ color: t.success }}
                                                                    onClick={() => approvePaperFile(link.fileId)} />
                                                            </Tooltip>
                                                            <Popconfirm title="Reject and remove this PDF?" onConfirm={() => rejectPaperFile(link.fileId)}>
                                                                <Tooltip title="Reject PDF">
                                                                    <Button size="small" type="text" icon={<CloseCircleOutlined />} danger />
                                                                </Tooltip>
                                                            </Popconfirm>
                                                        </>
                                                    )}
                                                </div>
                                            </Card>
                                        </Col>
                                    ))}
                                </Row>
                            )}
                        </div>

                        {/* Reading Assignments */}
                        {readTasks.length > 0 && (
                            <div style={{ marginTop: 24 }}>
                                <Text style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Reading Assignments
                                </Text>
                                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {readTasks.map((t: any) => {
                                        const STATUS_COLOR: Record<string, string> = {
                                            'Todo': t.accent, 'In Progress': t.warning, 'Pending Review': t.purple,
                                            'Done': t.success, 'Blocked': t.danger,
                                        };
                                        const color = STATUS_COLOR[t.status] ?? t.textMuted;
                                        const isDone = t.status === 'Done';
                                        return (
                                            <div key={t.id} style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '10px 14px',
                                                background: t.surface,
                                                border: `1px solid ${t.border}`,
                                                borderLeft: `3px solid ${color}`,
                                                borderRadius: 8,
                                            }}>
                                                {isDone
                                                    ? <CheckCircleOutlined style={{ color: t.success, fontSize: 15, flexShrink: 0 }} />
                                                    : <BookOutlined style={{ color, fontSize: 15, flexShrink: 0 }} />
                                                }
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <Text style={{ color: t.text, fontSize: 12, fontWeight: 600, display: 'block' }}>
                                                        {t.assignee?.fullName ?? '—'}
                                                    </Text>
                                                    {t.deadline && (
                                                        <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                            Due {dayjs(t.deadline).format('MMM D, YYYY')}
                                                        </Text>
                                                    )}
                                                </div>
                                                <Tag style={{
                                                    background: `${color}22`, color, border: `1px solid ${color}44`,
                                                    borderRadius: 10, fontSize: 10, margin: 0,
                                                }}>{t.status}</Tag>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Meta info */}
                        <div style={{ marginTop: 24 }}>
                            <Descriptions column={1} size="small" labelStyle={{ color: t.textMuted, fontSize: 12 }} contentStyle={{ color: t.text, fontSize: 12 }}>
                                <Descriptions.Item label="Project">{selectedPaper.project?.name ?? '—'}</Descriptions.Item>
                                <Descriptions.Item label="Added by">{selectedPaper.addedByUser?.fullName ?? '—'}</Descriptions.Item>
                                <Descriptions.Item label="Added on">{dayjs(selectedPaper.createdAt).format('MMM D, YYYY h:mm A')}</Descriptions.Item>
                            </Descriptions>
                        </div>

                        {/* Actions */}
                        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
                            <Button icon={<UserAddOutlined />} onClick={() => openAssignModal(selectedPaper)}
                                style={{ background: `${t.success}18`, borderColor: t.success, color: t.success, visibility: canAssign(selectedPaper) ? 'visible' : 'hidden' }}>
                                Assign to Read
                            </Button>
                            <Button icon={<EditOutlined />} onClick={() => openEdit(selectedPaper)}
                                style={{ visibility: canEdit(selectedPaper) ? 'visible' : 'hidden' }}>Edit</Button>
                            <Popconfirm title="Delete this paper?" onConfirm={() => handleDelete(selectedPaper.id)}>
                                <Button danger icon={<DeleteOutlined />}
                                    style={{ visibility: canDelete() ? 'visible' : 'hidden' }}>Delete</Button>
                            </Popconfirm>
                        </div>
                    </div>
                )}
            </Drawer>

            {/* ── Link File Modal ─────────────────────────── */}
            <Modal
                title="Link Project File"
                open={linkFileModal}
                onOk={handleLinkFile}
                onCancel={() => setLinkFileModal(false)}
                okText="Link"
                okButtonProps={{ disabled: !selectedFileId }}
            >
                <div style={{ marginTop: 16 }}>
                    <Form.Item label="File" style={{ marginBottom: 12 }}>
                        <Select
                            placeholder="Select a file from the project"
                            value={selectedFileId}
                            onChange={setSelectedFileId}
                            showSearch
                            filterOption={(input, opt) => (opt?.label as string ?? '').toLowerCase().includes(input.toLowerCase())}
                            options={projectFiles.map(f => ({ label: f.originalName, value: f.id }))}
                        />
                    </Form.Item>
                    <Form.Item label="Type" style={{ marginBottom: 0 }}>
                        <Select value={selectedFileType} onChange={setSelectedFileType}
                            options={[
                                { label: 'PDF', value: 'pdf' },
                                { label: 'Supplementary', value: 'supplementary' },
                                { label: 'Slides', value: 'slides' },
                                { label: 'Poster', value: 'poster' },
                                { label: 'Code', value: 'code' },
                            ]}
                        />
                    </Form.Item>
                </div>
            </Modal>

            {/* ── Assign to Read Modal ────────────────── */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <UserAddOutlined style={{ color: t.accent }} />
                        <span style={{ color: t.text }}>Assign to Read</span>
                    </div>
                }
                open={assignModal}
                onOk={handleAssign}
                onCancel={() => setAssignModal(false)}
                okText="Assign Task"
                width={520}
                okButtonProps={{ disabled: !assigneeId, loading: assignLoading, style: { background: t.success, borderColor: t.success } }}
                styles={{ body: { padding: '4px 0 0' } }}
            >
                {assignPaper && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* Paper info banner */}
                        <div style={{
                            padding: '12px 16px',
                            background: `${t.accent}0f`,
                            border: `1px solid ${t.accent}30`,
                            borderRadius: 8,
                            marginBottom: 20,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                <FilePdfOutlined style={{ color: t.accent, fontSize: 18, marginTop: 2, flexShrink: 0 }} />
                                <div>
                                    <Text style={{ color: t.text, fontWeight: 600, fontSize: 13, display: 'block' }}>
                                        {assignPaper.title}
                                    </Text>
                                    {assignPaper.authors && (
                                        <Text style={{ color: t.textMuted, fontSize: 11, marginTop: 2, display: 'block' }}>
                                            {assignPaper.authors}
                                        </Text>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Assignment section */}
                        <Divider orientationMargin={0} style={{ color: t.textMuted, fontSize: 11, borderColor: t.border, margin: '0 0 12px' }}>
                            ASSIGNMENT
                        </Divider>

                        <Form layout="vertical" style={{ gap: 0 }}>
                            <Form.Item label={<span style={{ color: t.text, fontSize: 12 }}>Assign to <span style={{ color: t.danger }}>*</span></span>} style={{ marginBottom: 14 }}>
                                <Select
                                    placeholder="Select a project member"
                                    value={assigneeId}
                                    onChange={setAssigneeId}
                                    showSearch
                                    size="middle"
                                    filterOption={(input, opt) => {
                                        const lbl = (opt?.label ?? '') as string;
                                        return lbl.toLowerCase().includes(input.toLowerCase());
                                    }}
                                    options={projectMembers
                                        .filter(m => m.user)
                                        .map(m => ({ label: m.user!.fullName, value: m.userId }))
                                    }
                                />
                            </Form.Item>

                            <Row gutter={12}>
                                <Col span={12}>
                                    <Form.Item label={<span style={{ color: t.text, fontSize: 12 }}>Priority</span>} style={{ marginBottom: 14 }}>
                                        <Select
                                            value={assignPriority}
                                            onChange={setAssignPriority}
                                            options={[
                                                { label: <Tag color="default"  style={{ margin: 0 }}>Low</Tag>,      value: 'Low' },
                                                { label: <Tag color="blue"     style={{ margin: 0 }}>Medium</Tag>,   value: 'Medium' },
                                                { label: <Tag color="orange"   style={{ margin: 0 }}>High</Tag>,     value: 'High' },
                                                { label: <Tag color="red"      style={{ margin: 0 }}>Critical</Tag>, value: 'Critical' },
                                            ]}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item label={<span style={{ color: t.text, fontSize: 12 }}>Deadline</span>} style={{ marginBottom: 14 }}>
                                        <DatePicker
                                            style={{ width: '100%' }}
                                            placeholder="Optional"
                                            onChange={(_: unknown, dateStr: string | null) => setAssignDeadline(dateStr || undefined)}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>

                            {assignSubProjects.length > 0 && (
                                <Form.Item label={<span style={{ color: t.text, fontSize: 12 }}>Sub-Project</span>} style={{ marginBottom: 14 }}>
                                    <Select
                                        placeholder="Optional — scope to sub-project"
                                        value={assignSubProject}
                                        onChange={setAssignSubProject}
                                        allowClear
                                        options={assignSubProjects.map(s => ({ label: s.name, value: s.id }))}
                                    />
                                </Form.Item>
                            )}

                            {/* Goal section */}
                            <Divider orientationMargin={0} style={{ color: t.textMuted, fontSize: 11, borderColor: t.border, margin: '4px 0 12px' }}>
                                READING GOAL
                            </Divider>

                            <Form.Item
                                label={<span style={{ color: t.text, fontSize: 12 }}>Key Goal / Focus <span style={{ color: t.textMuted, fontWeight: 400 }}>(optional)</span></span>}
                                style={{ marginBottom: 0 }}
                            >
                                <TextArea
                                    rows={3}
                                    placeholder="e.g. Understand the methodology for use in Experiment X, extract key equations"
                                    value={assignGoal}
                                    onChange={e => setAssignGoal(e.target.value)}
                                    style={{ resize: 'none' }}
                                />
                            </Form.Item>
                        </Form>
                    </div>
                )}
            </Modal>

            {/* ── New Folder Modal ─────────────────────────── */}
            <Modal
                open={newFolderModal}
                title={<Text style={{ color: t.text }}>New Folder</Text>}
                onCancel={() => { setNewFolderModal(false); setNewFolderName(''); }}
                onOk={handleCreateFolder}
                okText="Create"
                confirmLoading={newFolderSaving}
                okButtonProps={{ disabled: !newFolderName.trim(), style: { background: t.accent, borderColor: t.accent } }}
                styles={{ body: { background: t.surface, paddingTop: 16 }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, footer: { background: t.surface, borderTop: `1px solid ${t.border}` } }}
            >
                <Input
                    placeholder="Folder name…"
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onPressEnter={handleCreateFolder}
                    autoFocus

                />
            </Modal>

            {/* ── Rename Folder Modal ───────────────────────── */}
            <Modal
                open={renameModal}
                title={<Text style={{ color: t.text }}>Rename Folder</Text>}
                onCancel={() => { setRenameModal(false); setRenameFolder(null); }}
                onOk={handleRenameFolder}
                okText="Rename"
                confirmLoading={renameSaving}
                okButtonProps={{ disabled: !renameName.trim(), style: { background: t.accent, borderColor: t.accent } }}
                styles={{ body: { background: t.surface, paddingTop: 16 }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, footer: { background: t.surface, borderTop: `1px solid ${t.border}` } }}
            >
                <Input
                    placeholder="New name…"
                    value={renameName}
                    onChange={e => setRenameName(e.target.value)}
                    onPressEnter={handleRenameFolder}
                    autoFocus

                />
            </Modal>

            {/* ── Move Paper Modal ──────────────────────────── */}
            <Modal
                open={movePaperModal}
                title={<Text style={{ color: t.text }}>Move to Folder</Text>}
                onCancel={() => { setMovePaperModal(false); setMovePaperTarget(null); }}
                onOk={handleMovePaper}
                okText="Move"
                confirmLoading={movePaperLoading}
                okButtonProps={{ style: { background: t.accent, borderColor: t.accent } }}
                styles={{ body: { background: t.surface, paddingTop: 16 }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, footer: { background: t.surface, borderTop: `1px solid ${t.border}` } }}
            >
                <Text style={{ color: t.textMuted, fontSize: 13, display: 'block', marginBottom: 8 }}>
                    Moving: <span style={{ color: t.text, fontWeight: 600 }}>{movePaperTarget?.title}</span>
                </Text>
                <TreeSelect
                    placeholder="Root (no folder)"
                    style={{ width: '100%' }}
                    value={movePaperDest ?? undefined}
                    onChange={v => setMovePaperDest(v ?? null)}
                    allowClear
                    treeData={buildFolderTree(movePaperTarget?.projectId ? (allFolders[movePaperTarget.projectId] ?? []) : [])}
                    treeLine showSearch treeNodeFilterProp="title"
                />
            </Modal>

            {/* ── PDF Viewer Modal (like manuals) ───────── */}
            <Modal
                open={!!viewFile}
                title={<Text style={{ color: t.text }}>{viewFile?.name}</Text>}
                onCancel={closeViewer}
                footer={
                    viewFile ? (
                        <div style={{ display: 'flex', gap: 8 }}>
                            {viewFileId && viewFile && (
                                <Button icon={<DownloadOutlined />}
                                    style={{ borderColor: t.border, color: t.text }}
                                    onClick={() => downloadFile(viewFileId, viewFile.name)}>
                                    Download
                                </Button>
                            )}
                            <Button onClick={closeViewer} style={{ borderColor: t.border, color: t.textMuted }}>Close</Button>
                        </div>
                    ) : null
                }
                width="88vw"
                styles={{ body: { background: t.bg, padding: 0 }, header: { background: t.surface, borderBottom: `1px solid ${t.border}` }, footer: { background: t.surface, borderTop: `1px solid ${t.border}` } }}
                destroyOnClose
            >
                {viewFile && viewBlobUrl && (
                    <iframe src={viewBlobUrl} style={{ width: '100%', height: '80vh', border: 'none' }} title={viewFile.name} />
                )}
            </Modal>
        </div>
    );
}
