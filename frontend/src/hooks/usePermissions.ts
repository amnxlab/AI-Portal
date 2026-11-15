import { useCallback, useMemo } from 'react';
import { useAuthStore } from '../store/authStore';

/**
 * Modular access flags. Every user shares the same role ('Lab Member'); what
 * they can do is defined entirely by this per-user permission set, resolved
 * from the auth store synchronously (the login/`/auth/me` response carries
 * the current set). No role-name lookups, no module-level caches to go stale.
 */
export interface RolePermissions {
    manage_users:       boolean;
    manage_inventory:   boolean;
    manage_projects:    boolean;
    lead_projects:      boolean;
    manage_tasks:       boolean;
    manage_schedules:   boolean;
    manage_reports:     boolean;
    manage_wishlists:   boolean;
    view_team_data:     boolean;
    post_discord:       boolean;
    cap_hours:          boolean;
    view_all_schedules: boolean;
    manage_budget:      boolean;
    manage_attendance:  boolean;
}

/** Baseline granted to every lab member. Mirrors backend BASE_PERMISSIONS. */
export const BASE_PERMISSIONS: RolePermissions = {
    manage_users:       false,
    manage_inventory:   false,
    manage_projects:    false,
    lead_projects:      false,
    manage_tasks:       false,
    manage_schedules:   false,
    manage_reports:     false,
    manage_wishlists:   true,
    view_team_data:     false,
    post_discord:       false,
    cap_hours:          false,
    view_all_schedules: false,
    manage_budget:      false,
    manage_attendance:  false,
};

/** Merge a stored/partial permission object onto the baseline. */
export function resolvePermissions(
    stored?: Partial<RolePermissions> | null,
): RolePermissions {
    return { ...BASE_PERMISSIONS, ...(stored ?? {}) };
}

/** Unified role metadata — one role for everyone. */
export const UNIFIED_ROLE: RoleOption = {
    name: 'Member',
    label: 'Lab Member',
    color: '#58a6ff',
    permissions: BASE_PERMISSIONS,
};

/**
 * The title shown beside somebody's name.
 *
 * Every account in the lab holds the same nominal role, so the label is not a
 * role at all — it is the position an administrator gave them, set per user
 * under User Management. "Lab Member" is only the fallback for an account
 * nobody has given a title to yet.
 *
 * Access is a separate matter entirely: what a person may do comes from their
 * module permissions, not from whatever this says.
 */
export function positionTitle(user?: { jobTitle?: string | null } | null): string {
    return user?.jobTitle?.trim() || UNIFIED_ROLE.label;
}

export interface RoleOption {
    name: string;
    label: string;
    color: string;
    permissions: RolePermissions;
}

/**
 * Role metadata for components that render a role label (avatars, profile).
 * The system has exactly one role, so this is always the unified role.
 */
export function getRoleMeta(_role?: string | null): { label: string; color: string } {
    return { label: UNIFIED_ROLE.label, color: UNIFIED_ROLE.color };
}

/**
 * Permissions for the currently-authenticated user, read synchronously from
 * the persisted auth store. `isLoading` is kept in the return shape so older
 * call sites keep working; permissions are available immediately after login.
 */
export function usePermissions() {
    const storedPermissions = useAuthStore((s) => s.user?.permissions);

    const permissions = useMemo(
        () => resolvePermissions(storedPermissions),
        [storedPermissions],
    );

    const hasPermission = useCallback(
        (perm: keyof RolePermissions): boolean => permissions[perm] === true,
        [permissions],
    );

    return { permissions, isLoading: false, hasPermission };
}
