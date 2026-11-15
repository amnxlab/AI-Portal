import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { RolePermissions, effectivePermissions } from '../../roles/role.entity';

export interface JwtPayload {
    sub: string;
    username: string;
    role: string;
}

/**
 * The authenticated-user shape attached to every request as `req.user`.
 * `permissions` is resolved from the user's DB record on EVERY request
 * (validate() re-loads the user), so permission changes take effect
 * immediately — no stale caches, no role-name indirection.
 */
export interface AuthenticatedUser {
    id: string;
    username: string;
    role: string;
    isOnHold: boolean;
    permissions: RolePermissions;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    private readonly logger = new Logger(JwtStrategy.name);

    constructor(
        private readonly config: ConfigService,
        private readonly usersService: UsersService,
    ) {
        super({
            // Accept token from Authorization header OR ?token= query param (used for direct file downloads)
            jwtFromRequest: ExtractJwt.fromExtractors([
                ExtractJwt.fromAuthHeaderAsBearerToken(),
                (req) => req?.query?.token as string | null ?? null,
            ]),
            ignoreExpiration: false,
            secretOrKey: config.get<string>('JWT_SECRET', 'default_secret_change_me'),
        });

        // Fail fast and loud if the secret is missing: with an undefined
        // secret, tokens are signed under a fallback key that may differ
        // between processes — a classic source of "login works sometimes".
        if (!config.get<string>('JWT_SECRET')) {
            this.logger.error(
                'JWT_SECRET is not set — falling back to a default. Set JWT_SECRET in .env so all instances sign/verify with the same key.',
            );
        }
    }

    async validate(payload: JwtPayload): Promise<AuthenticatedUser | null> {
        try {
            // Re-validate the user still exists and is active
            const user = await this.usersService.findById(payload.sub);
            if (!user || !user.isActive) return null;
            return {
                id: user.id,
                username: user.username,
                role: user.role,
                isOnHold: user.isOnHold,
                permissions: effectivePermissions(user.permissions),
            };
        } catch {
            // Deleted/missing users must yield a clean 401 (returning null),
            // never a 500 — a 500 skips the frontend's refresh-and-retry
            // path and leaves the session stuck.
            return null;
        }
    }
}
