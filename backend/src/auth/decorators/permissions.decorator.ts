import { SetMetadata } from '@nestjs/common';

// Permission flag keys (mirrors RolePermissions in role.entity.ts)
export type PermissionKey =
    | 'manage_users' | 'manage_inventory' | 'manage_projects'
    | 'lead_projects' | 'manage_tasks'
    | 'manage_schedules' | 'manage_reports' | 'manage_wishlists'
    | 'view_team_data' | 'post_discord' | 'cap_hours'
    | 'view_all_schedules' | 'manage_budget'
    | 'manage_attendance';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: PermissionKey[]) =>
    SetMetadata(PERMISSIONS_KEY, permissions);
