import {
    Injectable, NotFoundException,
    ForbiddenException, OnModuleInit, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
    Role, DEFAULT_PERMISSIONS, BASE_PERMISSIONS, PERMISSION_FLAGS, PERMISSION_LABELS,
    RolePermissions, UNIFIED_ROLE, UNIFIED_ROLE_LABEL, UNIFIED_ROLE_COLOR,
    effectivePermissions, sanitizePermissions,
} from './role.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

// ── Legacy role definitions ─────────────────────────────────────────────────
// These roles no longer exist in the unified model. They are kept ONLY so the
// boot migration can backfill each user's personal permission set from the
// canonical permissions of whatever legacy role they had, before everyone is
// collapsed onto the single 'Member' role.
const LEGACY_ROLE_DEFAULTS: Partial<Role>[] = [
    {
        name: 'Admin',
        permissions: {
            ...DEFAULT_PERMISSIONS,
            manage_users: true, manage_inventory: true, manage_projects: true,
            lead_projects: true, manage_tasks: true, manage_schedules: true,
            manage_reports: true, manage_wishlists: true, view_team_data: true,
            post_discord: true, cap_hours: true, view_all_schedules: true,
            manage_budget: true, manage_attendance: true,
        },
    },
    {
        name: 'Project_Leader',
        permissions: {
            ...DEFAULT_PERMISSIONS,
            lead_projects: true, manage_tasks: true,
            manage_wishlists: true, view_team_data: true,
        },
    },
    {
        name: 'Lab_Assistant',
        permissions: {
            ...DEFAULT_PERMISSIONS,
            manage_wishlists: true,
        },
    },
    {
        name: 'Inventory_Manager',
        permissions: {
            ...DEFAULT_PERMISSIONS,
            manage_inventory: true, manage_wishlists: true, view_team_data: true,
        },
    },
    // Pre-2026 role names, migrated even earlier — kept for old databases.
    { name: 'Manager',  permissions: { ...DEFAULT_PERMISSIONS, manage_projects: true, manage_tasks: true, manage_schedules: true, manage_reports: true, manage_wishlists: true, view_team_data: true, post_discord: true } },
    { name: 'Employee', permissions: { ...DEFAULT_PERMISSIONS, manage_wishlists: true } },
];

@Injectable()
export class RolesService implements OnModuleInit {
    private readonly logger = new Logger(RolesService.name);

    constructor(
        @InjectRepository(Role)
        private readonly rolesRepo: Repository<Role>,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Boot migration to the unified role model. Idempotent — safe on every
     * start:
     *  1. Ensure the users.permissions column exists (synchronize is off).
     *  2. Backfill legacy role rows with their canonical permission sets so
     *     nothing is lost when they are collapsed.
     *  3. Copy each user's role permissions into users.permissions (only for
     *     users that don't have personal permissions yet), then backfill any
     *     brand-new permission keys for users that do.
     *  4. Move every user onto the single 'Member' role.
     *  5. Ensure the 'Member' role row exists; delete all other role rows.
     */
    async onModuleInit() {
        // 1. Schema: per-user permissions column
        await this.dataSource.query(
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions jsonb`,
        );

        // 2. Backfill legacy role rows with canonical permissions (so step 3
        //    copies a complete set). Custom roles keep whatever they have.
        for (const def of LEGACY_ROLE_DEFAULTS) {
            const existing = await this.rolesRepo.findOne({ where: { name: def.name } });
            if (!existing) continue;
            let changed = false;
            for (const key of PERMISSION_FLAGS) {
                const canonical = (def.permissions as any)[key] ?? false;
                if (!(key in (existing.permissions ?? {}))) {
                    existing.permissions = { ...(existing.permissions ?? {}), [key]: canonical };
                    changed = true;
                } else if (canonical === true && (existing.permissions as any)[key] !== true) {
                    existing.permissions = { ...existing.permissions, [key]: true };
                    changed = true;
                }
            }
            if (changed) await this.rolesRepo.save(existing);
        }

        // 3a. Users without personal permissions yet: adopt their role's set
        //     (falls back to the member baseline for unknown/missing roles).
        await this.dataSource.query(
            `UPDATE users u
             SET permissions = COALESCE(
                 (SELECT r.permissions FROM roles r WHERE r.name = u.role),
                 $1::jsonb
             )
             WHERE u.permissions IS NULL`,
            [JSON.stringify(BASE_PERMISSIONS)],
        );

        // 3b. Everyone: backfill brand-new permission keys with base defaults
        //     without touching keys the user already has.
        await this.dataSource.query(
            `UPDATE users SET permissions = $1::jsonb || permissions
             WHERE permissions IS NOT NULL`,
            [JSON.stringify(BASE_PERMISSIONS)],
        );

        // 4. Collapse everyone onto the unified role.
        const [{ n }] = await this.dataSource.query(
            `SELECT COUNT(*)::int AS n FROM users WHERE role IS DISTINCT FROM $1`,
            [UNIFIED_ROLE],
        );
        if (n > 0) {
            await this.dataSource.query(
                `UPDATE users SET role = $1 WHERE role IS DISTINCT FROM $1`,
                [UNIFIED_ROLE],
            );
            this.logger.log(`Unified role migration: ${n} user(s) moved to '${UNIFIED_ROLE}'`);
        }

        // 5. Ensure the single system role exists; remove the rest.
        let member = await this.rolesRepo.findOne({ where: { name: UNIFIED_ROLE } });
        if (!member) {
            member = await this.rolesRepo.save(this.rolesRepo.create({
                name: UNIFIED_ROLE,
                label: UNIFIED_ROLE_LABEL,
                color: UNIFIED_ROLE_COLOR,
                isSystem: true,
                permissions: { ...BASE_PERMISSIONS },
            }));
        } else {
            member.label = UNIFIED_ROLE_LABEL;
            member.color = UNIFIED_ROLE_COLOR;
            member.isSystem = true;
            // Keep every flag present; base value only for missing keys.
            member.permissions = { ...BASE_PERMISSIONS, ...member.permissions };
            await this.rolesRepo.save(member);
        }
        const removed = await this.rolesRepo
            .createQueryBuilder()
            .delete()
            .where('name != :name', { name: UNIFIED_ROLE })
            .execute();
        if (removed.affected) {
            this.logger.log(`Unified role migration: removed ${removed.affected} legacy role row(s)`);
        }
    }

    findAll(): Promise<Role[]> {
        return this.rolesRepo.find({ order: { createdAt: 'ASC' } });
    }

    async findOne(id: string): Promise<Role> {
        const role = await this.rolesRepo.findOne({ where: { id } });
        if (!role) throw new NotFoundException(`Role ${id} not found`);
        return role;
    }

    async findByName(name: string): Promise<Role | null> {
        return this.rolesRepo.findOne({ where: { name } });
    }

    getPermissionsSchema() {
        return PERMISSION_FLAGS.map((key) => ({
            key,
            label: PERMISSION_LABELS[key],
        }));
    }

    /**
     * Effective permissions for a user object (anything carrying a
     * `permissions` jsonb column). Synchronous, no cache, never stale —
     * JwtStrategy re-loads the user on every request.
     */
    getUserPermissions(user: { permissions?: Partial<RolePermissions> | null }): RolePermissions {
        return effectivePermissions(user?.permissions);
    }

    /**
     * @deprecated The unified model resolves permissions from the user record
     * (see getUserPermissions). Role-name lookup only ever returns the Member
     * base set now. Kept so stragglers never crash during the transition.
     */
    async getPermissions(_roleName?: string): Promise<RolePermissions> {
        return { ...BASE_PERMISSIONS };
    }

    async create(_dto: CreateRoleDto): Promise<Role> {
        // The unified model has exactly one role; additional roles would
        // reintroduce the inconsistencies this migration removed.
        throw new ForbiddenException(
            'Role creation is disabled: the system uses a single unified role with per-user permissions. Grant access on the Users page instead.',
        );
    }

    async update(id: string, dto: UpdateRoleDto): Promise<Role> {
        const role = await this.findOne(id);
        if (dto.label !== undefined)       role.label = dto.label;
        if (dto.color !== undefined)       role.color = dto.color;
        if (dto.permissions !== undefined) {
            role.permissions = { ...role.permissions, ...sanitizePermissions(dto.permissions) };
        }
        return this.rolesRepo.save(role);
    }

    async remove(id: string): Promise<void> {
        const role = await this.findOne(id);
        if (role.isSystem) {
            throw new ForbiddenException(`System role '${role.name}' cannot be deleted`);
        }
        throw new ForbiddenException(
            'Role deletion is disabled in the unified role model.',
        );
    }
}
