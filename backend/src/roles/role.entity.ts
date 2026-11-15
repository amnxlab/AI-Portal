import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export interface RolePermissions {
    manage_users:        boolean;   // User administration & moderation
    manage_inventory:    boolean;   // Full inventory CRUD
    manage_projects:     boolean;   // Project CRUD, file approvals, global visibility
    lead_projects:       boolean;   // Scoped task/sub-project management on led projects
    manage_tasks:        boolean;   // Create/assign/delete tasks, review submissions
    manage_schedules:    boolean;   // Review all schedules
    manage_reports:      boolean;   // Review all reports, export PDFs
    manage_wishlists:    boolean;   // Create wishlist requests (baseline for all)
    view_team_data:      boolean;   // See team analytics/metrics
    post_discord:        boolean;   // Post schedules to Discord
    cap_hours:           boolean;   // Set weekly hours caps on users
    view_all_schedules:  boolean;   // See everyone's schedule in the Schedule tab (read-only)
    manage_budget:       boolean;   // Full budget management
    manage_attendance:   boolean;   // Attendance records & reports
}

export const PERMISSION_FLAGS: (keyof RolePermissions)[] = [
    'manage_users',
    'manage_inventory',
    'manage_projects',
    'lead_projects',
    'manage_tasks',
    'manage_schedules',
    'manage_reports',
    'manage_wishlists',
    'view_team_data',
    'post_discord',
    'cap_hours',
    'view_all_schedules',
    'manage_budget',
    'manage_attendance',
];

export const PERMISSION_LABELS: Record<keyof RolePermissions, string> = {
    manage_users:       'Manage Users & Permissions',
    manage_inventory:   'Manage Inventory',
    manage_projects:    'Manage Projects (full access, file approvals)',
    lead_projects:      'Lead Assigned Projects (scoped task management)',
    manage_tasks:       'Create, Assign & Delete Tasks',
    manage_schedules:   'Review All Schedules',
    manage_reports:     'Review & Export Reports',
    manage_wishlists:   'Create Wishlist Requests',
    view_team_data:     'View Team Data',
    post_discord:       'Post Schedules to Discord',
    cap_hours:          'Set User Weekly Hours Cap',
    view_all_schedules: 'View All Schedules (read-only)',
    manage_budget:      'Manage Budget & Finances',
    manage_attendance:  'Manage Attendance Records',
};

export const DEFAULT_PERMISSIONS: RolePermissions = {
    manage_users:        false,
    manage_inventory:    false,
    manage_projects:     false,
    lead_projects:       false,
    manage_tasks:        false,
    manage_schedules:    false,
    manage_reports:      false,
    manage_wishlists:    false,
    view_team_data:      false,
    post_discord:        false,
    cap_hours:           false,
    view_all_schedules:  false,
    manage_budget:       false,
    manage_attendance:   false,
};

// ── Unified role model ───────────────────────────────────────────────────────
// Every user shares ONE system role ('Member'). Module/feature access is no
// longer derived from the role name — it is stored per user in
// users.permissions (jsonb) and resolved with effectivePermissions() below.
// This guarantees identical system behaviour for all users; only the
// permission set differs.

export const UNIFIED_ROLE       = 'Member';
export const UNIFIED_ROLE_LABEL = 'Lab Member';
export const UNIFIED_ROLE_COLOR = '#58a6ff';

/** Baseline granted to every member of the lab. */
export const BASE_PERMISSIONS: RolePermissions = {
    ...DEFAULT_PERMISSIONS,
    manage_wishlists: true,
};

/**
 * Resolves a user's effective permission set: BASE_PERMISSIONS with the
 * user's stored overrides merged in. Always returns every flag, so callers
 * never have to null-check individual keys. Pure + synchronous — safe to
 * call per-request (JwtStrategy does exactly that).
 */
export function effectivePermissions(
    stored?: Partial<RolePermissions> | null,
): RolePermissions {
    return { ...BASE_PERMISSIONS, ...(stored ?? {}) };
}

/**
 * Strips unknown keys / non-boolean values from an incoming permissions
 * payload (DTOs, user-admin UI) so only canonical flags can ever be stored.
 */
export function sanitizePermissions(input: unknown): Partial<RolePermissions> {
    const out: Partial<RolePermissions> = {};
    if (!input || typeof input !== 'object') return out;
    for (const key of PERMISSION_FLAGS) {
        const v = (input as Record<string, unknown>)[key];
        if (typeof v === 'boolean') out[key] = v;
    }
    return out;
}

@Entity('roles')
export class Role {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    name: string;

    @Column()
    label: string;

    @Column({ default: '#58a6ff' })
    color: string;

    @Column({ name: 'is_system', default: false })
    isSystem: boolean;

    @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
    permissions: RolePermissions;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
