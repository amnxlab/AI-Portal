import {
    Controller, Post, Body, Req, Res, Get, Param, UseGuards, HttpCode,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Permissions } from './decorators/permissions.decorator';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

/**
 * Refresh-token cookie scope. It used to be exactly '/api/auth/refresh',
 * which meant the browser never sent the cookie to '/api/auth/logout' — so
 * "logging out" silently left a valid 7-day refresh token behind. '/api/auth'
 * covers both endpoints (and nothing else).
 */
const REFRESH_COOKIE_PATH = '/api/auth';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 20, ttl: 60_000 } }) // 20 attempts/min/IP — brute-force brake that a real user never hits
    @HttpCode(200)
    async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const result = await this.authService.login(dto.username, dto.password);

        // Store refresh token in httpOnly cookie
        res.cookie('refresh_token', result.refreshToken, {
            httpOnly: true,
            // Tied to the actual request protocol, not NODE_ENV: NODE_ENV stays
            // 'development' in this deployment to keep TypeORM off Postgres SSL
            // (see .env), so it can't also gate this. nginx now terminates TLS
            // and forwards X-Forwarded-Proto, and main.ts sets 'trust proxy' so
            // Express reads it — req.secure is true exactly when the browser is
            // on https. Dev (nginx-dev.conf, plain HTTP) is unaffected.
            secure: req.secure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            path: REFRESH_COOKIE_PATH,
        });

        return { accessToken: result.accessToken, user: result.user };
    }

    @Post('refresh')
    @HttpCode(200)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const token = req.cookies?.['refresh_token'];
        if (!token) {
            return res.status(401).json({ message: 'No refresh token' });
        }
        const result = await this.authService.refresh(token);

        res.cookie('refresh_token', result.refreshToken, {
            httpOnly: true,
            // Tied to the actual request protocol, not NODE_ENV (see login()).
            secure: req.secure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: REFRESH_COOKIE_PATH,
        });

        return { accessToken: result.accessToken };
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @HttpCode(200)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        // The cookie's path now covers /api/auth, so it IS sent here and the
        // token can finally be revoked server-side on logout.
        const token = req.cookies?.['refresh_token'];
        if (token) await this.authService.logout(token);

        res.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
        return { message: 'Logged out successfully' };
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    me(@Req() req: Request) {
        return (req as any).user;
    }

    /**
     * Request a password-reset email for a registered address.
     *
     * Security properties:
     *  - The response is ALWAYS the same (no account enumeration).
     *  - The reset token is delivered only via email (or the server log when
     *    SMTP isn't configured) — it is NEVER part of the HTTP response.
     *  - Stricter rate limit: 5 requests / 15 min / IP.
     */
    @Post('forgot-password')
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
    @HttpCode(200)
    async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
        const baseUrl = this.resolveFrontendBaseUrl(req);
        await this.authService.requestPasswordReset(dto.email, baseUrl);
        return {
            message:
                'If that email address is registered, a password-reset link has been sent. It expires in 1 hour.',
        };
    }

    /**
     * Create an account from an email address and invite its owner to claim
     * it.
     *
     * This replaces "administrator types a password and then has to get it to
     * the new member somehow": nobody but the account holder ever knows it.
     *
     * It lives under /auth rather than /users because it mints a token and
     * sends mail, which is this module's job — putting it in UsersController
     * would mean UsersModule importing AuthModule, which already imports
     * UsersModule.
     */
    @Post('invitations')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Permissions('manage_users')
    @HttpCode(201)
    async inviteUser(@Body() dto: InviteUserDto, @Req() req: Request) {
        const { user, email } = await this.authService.inviteUser(
            dto, this.resolveFrontendBaseUrl(req), (req as any).user?.id,
        );
        return {
            user,
            email,
            message: `Invitation sent to ${email}. They choose their own username and password from the link.`,
        };
    }

    /** Send the invitation again, retiring the previous link. */
    @Post('invitations/:id/resend')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Permissions('manage_users')
    @HttpCode(200)
    async resendInvitation(@Param('id') id: string, @Req() req: Request) {
        const { email } = await this.authService.resendInvitation(
            id, this.resolveFrontendBaseUrl(req), (req as any).user?.id,
        );
        return { email, message: `Invitation sent again to ${email}. The previous link no longer works.` };
    }

    /**
     * What the registration page shows before anything is typed: whose
     * account this is, and whether the link is still good.
     *
     * Public by necessity — the person holding it has no account yet. It
     * reveals only the address the invitation was already sent to, and only
     * to somebody holding a 256-bit token for it.
     */
    @Get('registration/:token')
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 20, ttl: 15 * 60 * 1000 } })
    async describeInvitation(@Param('token') token: string) {
        return this.authService.describeInvitation(token);
    }

    /**
     * Claim the account: set the username and password, and sign in.
     */
    @Post('registration')
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
    @HttpCode(200)
    async completeRegistration(
        @Body() dto: CompleteRegistrationDto,
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ) {
        const result = await this.authService.completeRegistration(dto);

        res.cookie('refresh_token', result.refreshToken, {
            httpOnly: true,
            secure: req.secure,
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: REFRESH_COOKIE_PATH,
        });

        return { accessToken: result.accessToken, user: result.user };
    }

    /**
     * Send a password-reset link to a user, on an administrator's behalf.
     *
     * This exists because people lose access to their own "forgot password"
     * flow — a mistyped address, a mailbox they no longer read, a new starter
     * who never set a password at all — and the administrator looking at the
     * user list is the one who gets asked to fix it.
     *
     * The link is mailed to the account's registered address and nowhere else,
     * so an administrator cannot use this to take over an account they can
     * read the mail for. The response names that address so they can tell the
     * person where to look.
     */
    @Post('users/:id/send-reset-link')
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Permissions('manage_users')
    @HttpCode(200)
    async sendResetLinkFor(@Param('id') id: string, @Req() req: Request) {
        const baseUrl = this.resolveFrontendBaseUrl(req);
        const { email } = await this.authService.sendPasswordResetFor(id, baseUrl);
        return {
            email,
            message: `A password-reset link is on its way to ${email}. It expires in 1 hour.`,
        };
    }

    /**
     * Consume a reset token and set a new password.
     * Token is single-use and expires after 1 hour. All existing sessions
     * for the account are revoked as part of the reset.
     */
    @Post('reset-password')
    @UseGuards(ThrottlerGuard)
    @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
    @HttpCode(200)
    async resetPassword(@Body() dto: ResetPasswordDto) {
        await this.authService.resetPassword(dto.token, dto.newPassword);
        return { message: 'Password reset successfully' };
    }

    /**
     * Base URL used to build the reset link, in priority order:
     *  1. APP_BASE_URL  — explicit public portal address (recommended in .env)
     *  2. FRONTEND_URL  — first configured frontend origin
     *  3. The incoming request's own origin (works when frontend+API share
     *     nginx, which is the case in this deployment)
     */
    private resolveFrontendBaseUrl(req: Request): string {
        const explicit =
            process.env.APP_BASE_URL ||
            (process.env.FRONTEND_URL ?? '').split(',')[0]?.trim();
        if (explicit) return explicit;
        const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || req.protocol || 'http';
        const host = (req.headers['x-forwarded-host'] as string) || req.get('host');
        return `${proto}://${host}`;
    }
}
