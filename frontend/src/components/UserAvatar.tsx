import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Avatar, Spin, Tag, Typography } from 'antd';
import api from '../api/axios';
import { useAuthStore } from '../store/authStore';
import { getRoleMeta, positionTitle } from '../hooks/usePermissions';
import { useTheme } from '../theme/useTheme';
import { alpha, radius } from '../theme/tokens';

const { Text } = Typography;

interface ProfileData {
    id: string;
    fullName: string;
    role: string;
    avatarUrl: string | null;
    bio: string | null;
    jobTitle: string | null;
}

interface UserAvatarProps {
    name: string;
    avatarUrl?: string | null;
    size?: number;
    style?: React.CSSProperties;
    /** Fallback text color when no photo */
    color?: string;
    /** Fallback background color when no photo */
    bg?: string;
    /** When provided, clicking opens a profile card popover */
    userId?: string;
}

function ProfilePopoverContent({ userId, name, avatarUrl: initialAvatarUrl, open, onClose, pos }: {
    userId: string; name: string; avatarUrl?: string | null;
    open: boolean; onClose: () => void;
    pos: { top: number; left: number };
}) {
    const { t } = useTheme();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(false);
    const [zoomedPhoto, setZoomedPhoto] = useState(false);

    // Always re-fetch when the popover opens so the data is never stale after a profile update.
    useEffect(() => {
        if (!open) {
            // Reset so next open shows a fresh fetch
            setProfile(null);
            return;
        }
        setLoading(true);
        api.get<ProfileData>(`/users/${userId}/profile`)
            .then((res) => setProfile(res.data))
            .catch(() => setProfile(null))
            .finally(() => setLoading(false));
    }, [open, userId]);

    // Close zoom on Escape
    useEffect(() => {
        if (!zoomedPhoto) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomedPhoto(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [zoomedPhoto]);

    const navigate = useNavigate();
    const currentUser = useAuthStore((s) => s.user);

    const displayName = profile?.fullName ?? name;
    const photo = profile?.avatarUrl ?? initialAvatarUrl;
    const roleMeta = profile ? getRoleMeta() : null;
    const initials = displayName.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

    const accentColor = roleMeta?.color ?? t.accent;

    const handleGoToProfile = () => {
        onClose();
        if (currentUser?.id === userId) {
            navigate('/profile');
        } else {
            navigate('/users');
        }
    };

    return (
        <>
        {zoomedPhoto && photo && createPortal(
            <div
                onClick={() => setZoomedPhoto(false)}
                style={{
                    position: 'fixed', inset: 0, zIndex: 10001,
                    background: t.overlay,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'zoom-out',
                }}
            >
                <img
                    src={photo}
                    alt="Profile"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        maxWidth: 'min(90vw, 480px)',
                        maxHeight: '85vh',
                        borderRadius: radius.lg,
                        objectFit: 'contain',
                        boxShadow: t.shadowLg,
                        cursor: 'default',
                    }}
                />
            </div>,
            document.body
        )}
        {createPortal(
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                zIndex: 9999,
                width: 320,
                background: t.surfaceRaised,
                border: `1px solid ${t.borderStrong}`,
                borderRadius: radius.lg,
                boxShadow: t.shadowLg,
                overflow: 'hidden',
            }}
        >
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
                    <Spin size="large" />
                </div>
            ) : (
                <>
                    {/* Banner — fills full width, no negative margins needed */}
                    <div style={{
                        height: 90,
                        width: '100%',
                        position: 'relative',
                        overflow: 'hidden',
                        background: `linear-gradient(135deg, ${alpha(accentColor, 0.38)} 0%, ${alpha(accentColor, 0.13)} 55%, ${t.surfaceRaised} 100%)`,
                        borderBottom: `1px solid ${alpha(accentColor, 0.2)}`,
                    }}>
                        {/* Decorative circles */}
                        <div style={{ position: 'absolute', right: -20, top: -20, width: 110, height: 110, borderRadius: '50%', background: alpha(accentColor, 0.1), border: `1px solid ${alpha(accentColor, 0.16)}` }} />
                        <div style={{ position: 'absolute', right: 30, top: 14, width: 58, height: 58, borderRadius: '50%', background: alpha(accentColor, 0.07), border: `1px solid ${alpha(accentColor, 0.13)}` }} />
                    </div>

                    {/* Content area with consistent padding */}
                    <div style={{ padding: '0 18px 20px' }}>
                        {/* Avatar + role tag row — overlaps banner, aligned with content padding */}
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: -44, marginBottom: 14 }}>
                            <Avatar
                                src={photo ?? undefined}
                                size={86}
                                onError={() => true}
                                style={{
                                    background: photo ? 'transparent' : alpha(accentColor, 0.2),
                                    color: accentColor,
                                    fontSize: 30,
                                    fontWeight: 800,
                                    display: 'block',
                                    border: `3px solid ${t.surfaceRaised}`,
                                    boxShadow: `0 0 0 2px ${alpha(accentColor, 0.33)}, ${t.shadowMd}`,
                                    flexShrink: 0,
                                    cursor: photo ? 'zoom-in' : 'default',
                                    transition: 'box-shadow 0.15s',
                                }}
                                onClick={photo ? (e) => { (e as React.MouseEvent).stopPropagation(); setZoomedPhoto(true); } : undefined}
                            >
                                {initials}
                            </Avatar>

                            {/*
                              * The person's title, in the place the generic
                              * "Lab Member" tag used to hold.
                              *
                              * That tag said the same thing about everybody,
                              * while the actual title — the one an
                              * administrator assigns — was stacked on its own
                              * line under the name, pushing the card taller
                              * and reading as an afterthought. The title is
                              * the useful half, so it takes the position, and
                              * "Lab Member" remains only as the fallback for
                              * somebody who has not been given one.
                              */}
                            <Tag style={{
                                background: alpha(accentColor, 0.13),
                                color: accentColor,
                                border: `1px solid ${alpha(accentColor, 0.33)}`,
                                borderRadius: radius.pill,
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '3px 12px',
                                margin: 0,
                                flexShrink: 0,
                                letterSpacing: 0.3,
                                maxWidth: 170,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}>
                                {positionTitle(profile ?? undefined)}
                            </Tag>
                        </div>

                        {/* Name — clickable */}
                        <Text
                            strong
                            onClick={handleGoToProfile}
                            style={{
                                color: t.text, fontSize: 18, display: 'block', lineHeight: 1.25, letterSpacing: -0.2,
                                cursor: 'pointer', transition: 'color 0.15s',
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = accentColor; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = t.text; }}
                        >
                            {displayName}
                        </Text>

                        {/* Divider */}
                        <div style={{ height: 1, background: `linear-gradient(90deg, ${alpha(accentColor, 0.27)}, ${alpha(t.border, 0.27)}, transparent)`, margin: '14px 0' }} />

                        {/* Bio */}
                        {profile?.bio ? (
                            <Text style={{ color: t.textMuted, fontSize: 12.5, lineHeight: 1.7, display: 'block' }}>
                                {profile.bio}
                            </Text>
                        ) : (
                            <Text style={{ color: t.border, fontSize: 12, fontStyle: 'italic' }}>
                                No bio written yet.
                            </Text>
                        )}
                    </div>
                </>
            )}
        </div>,
        document.body
        )}
        </>
    );
}

/**
 * Shows the user's profile photo if available, otherwise falls back to initials.
 * If `userId` is provided, clicking opens a profile card popover.
 */
export default function UserAvatar({ name, avatarUrl, size = 24, style = {}, color, bg, userId }: UserAvatarProps) {
    const { t } = useTheme();
    const [open, setOpen] = useState(false);
    const [cardPos, setCardPos] = useState({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLSpanElement>(null);
    // Identifies this rendered avatar, not the person it shows: the same user
    // can appear several times on a page and each must close the others.
    const instanceId = useRef(Math.random().toString(36).slice(2));

    const initials = name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();

    const handleOpen = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!userId) return;
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) {
            const CARD_W = 320;
            const CARD_H = 420;
            const GAP = 10;
            const EDGE = 8;
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            // Viewport coordinates — the card is position:fixed, so no scroll
            // offsets apply.
            let left = rect.left;
            if (left + CARD_W > vw - 12) left = vw - CARD_W - 12;
            left = Math.max(EDGE, left);

            // Prefer below the avatar, flip above when there is no room, and
            // clamp either way: on a short screen both sides overflow, and an
            // unclamped flip put the card off the top of the window entirely.
            let top = rect.bottom + GAP;
            if (top + CARD_H > vh - EDGE) {
                const above = rect.top - CARD_H - GAP;
                top = above >= EDGE ? above : Math.max(EDGE, vh - CARD_H - EDGE);
            }

            setCardPos({ top, left });
        }
        // Tell every other open popup to close before opening this one.
        // We dispatch a custom event carrying this avatar's userId so each
        // UserAvatar can compare it against its own and close if different.
        document.dispatchEvent(
            new CustomEvent('userprofile:open', { detail: { instanceId: instanceId.current } })
        );
        setOpen((o) => !o);
    };

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = () => setOpen(false);
        document.addEventListener('click', handler);
        return () => document.removeEventListener('click', handler);
    }, [open]);

    // Close when another profile popup opens
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ instanceId: string }>).detail;
            // Any avatar other than this one opening closes this one.
            if (detail?.instanceId !== instanceId.current) setOpen(false);
        };
        document.addEventListener('userprofile:open', handler);
        return () => document.removeEventListener('userprofile:open', handler);
    }, []);

    const [imgBroken, setImgBroken] = useState(false);

    // Reset broken flag whenever the URL changes so a new valid URL always gets a fresh attempt.
    useEffect(() => { setImgBroken(false); }, [avatarUrl]);

    const effectiveSrc = avatarUrl && !imgBroken ? avatarUrl : undefined;

    const avatarNode = (
        <Avatar
            src={effectiveSrc}
            size={size}
            onError={() => { setImgBroken(true); return true; }}
            style={{
                // A photo gets a plain backing colour rather than transparency:
                // while it is still loading, a transparent circle showed the
                // page through it and the initials underneath bled around the
                // edge of the image.
                background: effectiveSrc ? (bg ?? t.accentBg) : (bg ?? t.accentBg),
                color: color ?? t.accent,
                fontSize: Math.max(9, Math.round(size * 0.42)),
                fontWeight: 700,
                flexShrink: 0,
                ...style,
            }}
        >
            {/* Children ONLY when no photo is being shown. Ant Design renders
                children and <img> in the same box, so passing both put the
                initials over the picture — which is the "name appears above
                the profile picture" problem. */}
            {effectiveSrc ? null : initials}
        </Avatar>
    );

    if (!userId) return avatarNode;

    const card = open
        ? <ProfilePopoverContent userId={userId} name={name} avatarUrl={avatarUrl} open={open} onClose={() => setOpen(false)} pos={cardPos} />
        : null;

    return (
        <>
            <span
                ref={triggerRef}
                style={{ display: 'inline-flex', flexShrink: 0, cursor: 'pointer' }}
                onClick={handleOpen}
            >
                {avatarNode}
            </span>
            {card}
        </>
    );
}
