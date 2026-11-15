import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY, PermissionKey } from '../decorators/permissions.decorator';
import { RolesService } from '../../roles/roles.service';
import { effectivePermissions, RolePermissions } from '../../roles/role.entity';

/**
 * Enforces @Permissions() (primary) and @Roles() (legacy) metadata.
 *
 * Permissions come from `req.user.permissions`, resolved by JwtStrategy from
 * the user's DB record on every request — the unified model has a single
 * role, so role-name lookups no longer carry access information.
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        private rolesService: RolesService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // --- @Permissions() check (primary system) ---
        const requiredPerms = this.reflector.getAllAndOverride<PermissionKey[]>(
            PERMISSIONS_KEY,
            [context.getHandler(), context.getClass()],
        );

        // --- @Roles() check (legacy fallback) ---
        const requiredRoles = this.reflector.getAllAndOverride<string[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()],
        );

        // No restriction on this route
        if (!requiredPerms?.length && !requiredRoles?.length) return true;

        const { user } = context.switchToHttp().getRequest();
        if (!user) throw new ForbiddenException('No authenticated user');

        // @Roles() check — role must match if specified
        if (requiredRoles?.length) {
            if (!requiredRoles.includes(user.role)) {
                throw new ForbiddenException(
                    `Role '${user.role}' is not allowed. Required: [${requiredRoles.join(', ')}]`,
                );
            }
            // intentionally no early return — fall through to also enforce @Permissions()
        }

        // @Permissions() check — per-user permission set (always fresh)
        if (requiredPerms?.length) {
            const perms: RolePermissions = user.permissions
                ? effectivePermissions(user.permissions)
                // Safety net for callers that didn't attach permissions
                : await this.rolesService.getPermissions(user.role);
            const missing = requiredPerms.filter((p) => !perms[p]);
            if (missing.length) {
                throw new ForbiddenException(
                    `Your account lacks permission: [${missing.join(', ')}]`,
                );
            }
        }
        return true;
    }
}
