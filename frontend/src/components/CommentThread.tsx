/**
 * CommentThread — reusable component for task / ticket / project discussions.
 *
 * Props:
 *   entityType  - 'task' | 'ticket' | 'project'
 *   entityId    - UUID of the parent record
 *   users       - directory of users available for @mention (id + fullName)
 *
 * Features:
 *  · Loads + displays threaded comments (replies indented under parents)
 *  · Post new comments with optional @mention selection
 *  · Reply to any comment (one level deep shown inline)
 *  · Delete own comments (users with the manage_users permission can delete any)
 *  · Real-time updates via Socket.io `comment:new` event
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useDeepLinkParam } from '../hooks/useDeepLink';
import {
    Input, Button, Select, Typography, Tooltip, Popconfirm,
    Spin, Divider, Empty, Tag, message,
} from 'antd';
import {
    SendOutlined, DeleteOutlined,
    CommentOutlined, TeamOutlined, RollbackOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api from '../api/axios';
import { useAuthStore } from '../store/authStore';
import { useSocket } from '../hooks/useSocket';
import { usePermissions } from '../hooks/usePermissions';
import { useTheme } from '../theme/useTheme';
import { alpha } from '../theme/tokens';
import UserAvatar from './UserAvatar';

dayjs.extend(relativeTime);

const { Text } = Typography;
const { TextArea } = Input;

/* ── Types ───────────────────────────────────────────────────── */
interface DirectoryUser {
    id: string;
    fullName: string;
    role: string;
    avatarUrl?: string | null;
}

interface Comment {
    id: string;
    entityType: string;
    entityId: string;
    authorId: string;
    author: { id: string; fullName: string; avatarUrl?: string | null };
    content: string;
    mentions: string[];
    parentId: string | null;
    isEdited: boolean;
    createdAt: string;
}

interface Props {
    entityType: 'task' | 'ticket' | 'project' | 'video_media';
    entityId: string;
    /** Full user directory for @mention autocomplete */
    users?: DirectoryUser[];
}

/* ── Avatar helper ───────────────────────────────────────────── */
/**
 * Comment avatars go through the shared UserAvatar like everywhere else.
 *
 * This used to be its own implementation — its own initials, its own colour
 * scheme, no profile card on click — which is why clicking a face in a
 * comment thread did nothing while the same face elsewhere opened a card.
 */
function CommentAvatar({ name, avatarUrl, userId }: { name: string; avatarUrl?: string | null; userId?: string }) {
    const { t } = useTheme();
    return (
        <UserAvatar
            name={name}
            avatarUrl={avatarUrl}
            userId={userId}
            size={32}
            style={{ border: `1px solid ${t.border}` }}
        />
    );
}

/* ── Single comment bubble ───────────────────────────────────── */
function CommentBubble({
    comment,
    currentUserId,
    canModerate,
    userMap,
    onDelete,
    onReply,
    isReply = false,
}: {
    comment: Comment;
    currentUserId: string;
    canModerate: boolean;
    userMap: Map<string, string>;
    onDelete: (id: string) => void;
    onReply: (comment: Comment) => void;
    isReply?: boolean;
}) {
    const { t } = useTheme();
    const canDelete = comment.authorId === currentUserId || canModerate;

    /* Highlight @mentions in content: replace `@[Name](id)` or bare ids */
    const renderedContent = comment.content.replace(
        /@\[([^\]]+)\]\([^)]+\)/g,
        (_, name) => `@${name}`,
    );

    return (
        <div
            style={{
                display: 'flex',
                gap: 10,
                paddingLeft: isReply ? 42 : 0,
            }}
        >
            <CommentAvatar
                name={comment.author?.fullName ?? 'Unknown'}
                avatarUrl={comment.author?.avatarUrl}
                userId={comment.author?.id ?? comment.authorId}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Text strong style={{ color: t.text, fontSize: 13 }}>
                        {comment.author?.fullName ?? 'Unknown'}
                    </Text>
                    <Text style={{ color: t.textMuted, fontSize: 11 }}>
                        {dayjs(comment.createdAt).fromNow()}
                    </Text>
                    {comment.isEdited && (
                        <Text style={{ color: t.textMuted, fontSize: 10, fontStyle: 'italic' }}>edited</Text>
                    )}
                    {/* Mentioned users */}
                    {comment.mentions.length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {comment.mentions.map((uid) => (
                                <Tag
                                    key={uid}
                                    style={{
                                        background: alpha(t.accent, 0.13),
                                        color: t.accent,
                                        border: `1px solid ${alpha(t.accent, 0.27)}`,
                                        fontSize: 10,
                                        padding: '0 5px',
                                        margin: 0,
                                    }}
                                >
                                    @{userMap.get(uid) ?? uid.slice(0, 8)}
                                </Tag>
                            ))}
                        </div>
                    )}
                </div>

                {/* Content bubble */}
                <div
                    style={{
                        background: t.surface,
                        border: `1px solid ${t.border}`,
                        borderRadius: isReply ? '0 8px 8px 8px' : 8,
                        padding: '10px 14px',
                        color: t.text,
                        fontSize: 13,
                        lineHeight: 1.6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
                    {renderedContent}
                </div>

                {/* Action row */}
                <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
                    {!isReply && (
                        <Button
                            type="link"
                            size="small"
                            icon={<RollbackOutlined />}
                            style={{ color: t.textMuted, padding: 0, fontSize: 11, height: 'auto' }}
                            onClick={() => onReply(comment)}
                        >
                            Reply
                        </Button>
                    )}
                    {canDelete && (
                        <Popconfirm
                            title="Delete this comment?"
                            okText="Delete"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => onDelete(comment.id)}
                        >
                            <Button
                                type="link"
                                size="small"
                                icon={<DeleteOutlined />}
                                danger
                                style={{ padding: 0, fontSize: 11, height: 'auto' }}
                            >
                                Delete
                            </Button>
                        </Popconfirm>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ── Main component ──────────────────────────────────────────── */
/*
 * The arrival tint. Deliberately a background wash and not a border: a border
 * shifts the layout by a pixel and the whole thread twitches on arrival.
 */
const FLASH_STYLE: React.CSSProperties = {
    background: 'rgba(250, 173, 20, 0.16)',
    borderRadius: 8,
    transition: 'background 600ms ease-out',
    scrollMarginTop: 90,     // clears the sticky header when scrolled to
};

export default function CommentThread({ entityType, entityId, users = [] }: Props) {
    /*
     * The comment a notification pointed at.
     *
     * Read from the URL rather than router state so it survives a reload and
     * the round trip through the login page -- which is exactly the journey a
     * notification link takes when the session has expired.
     */
    const highlightId = useDeepLinkParam('commentId');
    const [flash, setFlash] = useState<string | null>(null);

    const user = useAuthStore((s) => s.user);
    const { hasPermission } = usePermissions();
    const canModerate = hasPermission('manage_users'); // moderation right
    const { t } = useTheme();

    const [comments, setComments]       = useState<Comment[]>([]);
    const [loading, setLoading]         = useState(false);
    const [posting, setPosting]         = useState(false);
    const [content, setContent]         = useState('');
    const [mentions, setMentions]       = useState<string[]>([]);
    const [replyTo, setReplyTo]         = useState<Comment | null>(null);
    const bottomRef                     = useRef<HTMLDivElement>(null);

    /* Build a quick id→fullName map for rendering mention tags.
       Seed from the users directory prop, then supplement with any
       author data already embedded in loaded comments (eager relation),
       so mention tags always resolve to a name even before /users loads. */
    const userMap = (() => {
        const map = new Map<string, string>(users.map((u) => [u.id, u.fullName]));
        for (const c of comments) {
            if (c.author?.id && c.author?.fullName) map.set(c.author.id, c.author.fullName);
        }
        return map;
    })();

    /* ── fetch comments ──────────────────────────────────────── */
    const load = useCallback(async () => {
        if (!entityId) return;
        setLoading(true);
        try {
            const res = await api.get('/comments', { params: { entityType, entityId } });
            setComments(res.data);
        } catch {
            /* silently ignore — do not crash the parent page */
        } finally {
            setLoading(false);
        }
    }, [entityType, entityId]);

    useEffect(() => { load(); }, [load]);

    /* ── real-time updates ───────────────────────────────────── */
    const { joinRoom } = useSocket({
        'comment:new': (incoming: Comment) => {
            if (incoming.entityType === entityType && incoming.entityId === entityId) {
                setComments((prev) => {
                    if (prev.some((c) => c.id === incoming.id)) return prev;
                    return [...prev, incoming];
                });
            }
        },
    });

    useEffect(() => {
        if (entityId) joinRoom(`comment-${entityType}-${entityId}`);
    }, [entityType, entityId, joinRoom]);

    /* ── scroll to bottom on new comments ───────────────────── */
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [comments.length]);

    /* ── post comment ────────────────────────────────────────── */
    const post = async () => {
        if (!content.trim()) return;
        setPosting(true);
        try {
            const body: Record<string, unknown> = {
                entityType,
                entityId,
                content: content.trim(),
                mentions,
                ...(replyTo ? { parentId: replyTo.id } : {}),
            };
            const res = await api.post('/comments', body);
            // Optimistic add (real-time will also push it; dedup handled in handler)
            setComments((prev) => {
                if (prev.some((c) => c.id === res.data.id)) return prev;
                return [...prev, res.data];
            });
            setContent('');
            setMentions([]);
            setReplyTo(null);
        } catch (err: any) {
            message.error(err?.response?.data?.message ?? 'Failed to post comment. Please try again.');
        } finally {
            setPosting(false);
        }
    };

    /* ── delete comment ──────────────────────────────────────── */
    const deleteComment = async (id: string) => {
        try {
            await api.delete(`/comments/${id}`);
            setComments((prev) => prev.filter((c) => c.id !== id));
        } catch (err: any) {
            message.error(err?.response?.data?.message ?? 'Failed to delete comment.');
        }
    };

    /* ── group: top-level vs replies ─────────────────────────── */
    const topLevel = comments.filter((c) => !c.parentId);
    /*
     * Scroll once the thread has rendered. The id is dropped afterwards so a
     * later re-render does not yank the page back, and so scrolling away and
     * returning does not re-trigger it.
     */
    useEffect(() => {
        if (!highlightId || !comments.length) return;
        const el = document.getElementById(`comment-${highlightId}`);
        if (!el) return;                     // not on this thread, or deleted
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFlash(highlightId);
        const t = setTimeout(() => setFlash(null), 2600);
        return () => clearTimeout(t);
    }, [highlightId, comments.length]);

    const repliesFor = (parentId: string) => comments.filter((c) => c.parentId === parentId);

    /* ── render ──────────────────────────────────────────────── */
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* ── Header ───────────────────────────────────────── */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    paddingBottom: 12,
                    borderBottom: `1px solid ${t.border}`,
                    marginBottom: 12,
                }}
            >
                <CommentOutlined style={{ color: t.accent, fontSize: 15 }} />
                <Text strong style={{ color: t.text, fontSize: 14 }}>
                    Discussion
                </Text>
                {comments.length > 0 && (
                    <Text style={{ color: t.textMuted, fontSize: 12 }}>
                        ({comments.length})
                    </Text>
                )}
            </div>

            {/* ── Comment list ─────────────────────────────────── */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                    <Spin size="small" />
                </div>
            ) : topLevel.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>
                            No comments yet. Be the first!
                        </Text>
                    }
                    style={{ margin: '16px 0' }}
                />
            ) : (
                <div
                    style={{
                        maxHeight: 380,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 16,
                        paddingRight: 4,
                    }}
                >
                    {topLevel.map((comment) => (
                        <div
                            key={comment.id}
                            id={`comment-${comment.id}`}
                            style={flash === comment.id ? FLASH_STYLE : undefined}
                        >
                            <CommentBubble
                                comment={comment}
                                currentUserId={user?.id ?? ''}
                                canModerate={canModerate}
                                userMap={userMap}
                                onDelete={deleteComment}
                                onReply={setReplyTo}
                            />
                            {/* Replies */}
                            {repliesFor(comment.id).map((reply) => (
                                <div
                                    key={reply.id}
                                    id={`comment-${reply.id}`}
                                    style={{ marginTop: 8, ...(flash === reply.id ? FLASH_STYLE : {}) }}
                                >
                                    <CommentBubble
                                        comment={reply}
                                        currentUserId={user?.id ?? ''}
                                        canModerate={canModerate}
                                        userMap={userMap}
                                        onDelete={deleteComment}
                                        onReply={setReplyTo}
                                        isReply
                                    />
                                </div>
                            ))}
                        </div>
                    ))}
                    <div ref={bottomRef} />
                </div>
            )}

            <Divider style={{ borderColor: t.border, margin: '12px 0' }} />

            {/* ── Compose area ─────────────────────────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Reply banner */}
                {replyTo && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 12px',
                            background: alpha(t.accent, 0.07),
                            border: `1px solid ${alpha(t.accent, 0.2)}`,
                            borderRadius: 6,
                            fontSize: 12,
                            color: t.textMuted,
                        }}
                    >
                        <RollbackOutlined style={{ color: t.accent }} />
                        <Text style={{ color: t.textMuted, fontSize: 12 }}>
                            Replying to{' '}
                            <Text strong style={{ color: t.accent, fontSize: 12 }}>
                                {replyTo.author?.fullName}
                            </Text>
                        </Text>
                        <Button
                            type="link"
                            size="small"
                            style={{ marginLeft: 'auto', color: t.textMuted, padding: 0, fontSize: 11, height: 'auto' }}
                            onClick={() => setReplyTo(null)}
                        >
                            Cancel
                        </Button>
                    </div>
                )}

                <TextArea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={replyTo ? `Reply to ${replyTo.author?.fullName}…` : 'Write a comment…'}
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    maxLength={4000}
                    onKeyDown={(e) => {
                        // Ctrl+Enter or Cmd+Enter to submit
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            post();
                        }
                    }}
                />

                {/* Mention selector + Send */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {users.length > 0 && (
                        <Tooltip title="Mention team members">
                            <Select
                                mode="multiple"
                                allowClear
                                showSearch
                                placeholder={
                                    <span style={{ fontSize: 12 }}>
                                        <TeamOutlined /> @mention…
                                    </span>
                                }
                                optionFilterProp="label"
                                value={mentions}
                                onChange={setMentions}
                                options={users
                                    .filter((u) => u.id !== user?.id)
                                    .map((u) => ({ value: u.id, label: u.fullName }))}
                                style={{ flex: 1, minWidth: 0 }}
                            />
                        </Tooltip>
                    )}
                    <Button
                        type="primary"
                        icon={<SendOutlined />}
                        loading={posting}
                        onClick={post}
                        disabled={!content.trim()}
                        style={{
                            background: t.success,
                            borderColor: t.success,
                            flexShrink: 0,
                        }}
                    >
                        {replyTo ? 'Reply' : 'Post'}
                    </Button>
                </div>
                <Text style={{ color: t.textMuted, fontSize: 11 }}>
                    Ctrl+Enter to post quickly
                </Text>
            </div>
        </div>
    );
}
