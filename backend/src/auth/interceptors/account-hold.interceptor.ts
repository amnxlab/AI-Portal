import { Injectable, NestInterceptor, ExecutionContext, CallHandler, ForbiddenException } from '@nestjs/common';
import { Observable } from 'rxjs';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Global interceptor that blocks all write operations for users whose account is on hold.
 * Runs after JwtAuthGuard so req.user is already populated.
 * Read-only methods (GET, HEAD, OPTIONS) are always allowed.
 */
@Injectable()
export class AccountHoldInterceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const method: string = request.method?.toUpperCase() ?? '';

        if (!WRITE_METHODS.has(method)) return next.handle();

        const user = request.user;
        if (user?.isOnHold && !this.isSelfRelease(request, user)) {
            throw new ForbiddenException(
                'Your account is currently on hold. You can view data but cannot submit or modify anything. Please contact an administrator.',
            );
        }

        return next.handle();
    }

    /**
     * The one write an on-hold account may still make: a user administrator
     * taking their OWN account off hold.
     *
     * Administrators can now set the employment fields on themselves, which
     * includes the hold. Without this exemption, ticking it would be a
     * one-way door — every PATCH, this one included, is blocked while on
     * hold, so the only way back would be another administrator or the
     * database. Nothing else is let through, and it can never release
     * somebody else's hold.
     */
    private isSelfRelease(request: any, user: { id: string; permissions?: Record<string, boolean> }): boolean {
        if (!user.permissions?.manage_users) return false;

        const path: string = (request.route?.path ?? request.path ?? '') as string;
        const targetId = request.params?.id;
        if (targetId !== user.id) return false;

        const body = request.body ?? {};
        if (/\/users\/:id\/on-hold$/.test(path)) return body.onHold === false;
        // The general user update, when it is releasing the hold. The form
        // posts the whole account with it, which is why this is pinned to the
        // administrator's own row.
        if (/\/users\/:id$/.test(path)) return body.isOnHold === false;
        return false;
    }
}
