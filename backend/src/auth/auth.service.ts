import {
    Injectable, UnauthorizedException, BadRequestException,
    Logger, OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { RefreshToken } from './refresh-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RegistrationToken } from './registration-token.entity';
import { InviteUserDto } from './dto/invite-user.dto';
import { CompleteRegistrationDto } from './dto/complete-registration.dto';
import { User } from '../users/user.entity';
import { RolePermissions, effectivePermissions } from '../roles/role.entity';

@Injectable()
export class AuthService implements OnModuleInit {
    private readonly logger = new Logger(AuthService.name);

    /**
     * A rotated refresh token stays exchangeable for this long. Concurrent
     * requests (or two browser tabs) that both hit an expired access token
     * used to race: the first refresh deleted the token, the second got a 401
     * and force-logged the user out ("login works sometimes"). The grace
     * window makes duplicate refreshes succeed instead. Presenting a token
     * rotated LONGER ago than the window is treated as replay and rejected.
     */
    private static readonly REFRESH_GRACE_MS = 30_000;

    constructor(
        private readonly usersService: UsersService,
        private readonly mailService: MailService,
        private readonly jwtService: JwtService,
        private readonly config: ConfigService,
        private readonly dataSource: DataSource,
        @InjectRepository(RefreshToken)
        private readonly refreshRepo: Repository<RefreshToken>,
        @InjectRepository(PasswordResetToken)
        private readonly resetRepo: Repository<PasswordResetToken>,
        @InjectRepository(RegistrationToken)
        private readonly inviteRepo: Repository<RegistrationToken>,
    ) { }

    /**
     * How long an invitation stays usable.
     *
     * Longer than a password reset on purpose: a reset is answering something
     * the person is doing right now, while an invitation may arrive while
     * they are away, and an expired one costs an administrator a second trip
     * through the user list.
     */
    private static readonly INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

    /** Grace-window columns (synchronize is off — keep schema in sync at boot). */
    async onModuleInit() {
        await this.dataSource.query(
            `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at timestamptz`,
        );
        await this.dataSource.query(
            `ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS replaced_by_hash varchar`,
        );
    }

    async login(username: string, password: string) {
        const user = await this.usersService.findByUsername(username.trim());
        if (!user || !user.isActive) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const valid = await this.usersService.validatePassword(user, password);
        if (!valid) throw new UnauthorizedException('Invalid credentials');

        const accessToken = this.signAccessToken(user);
        const refreshToken = await this.createRefreshToken(user.id);
        const permissions = this.permissionsOf(user);

        // Opportunistic housekeeping — never fails a login
        this.cleanupRefreshTokens().catch(() => { /* non-fatal */ });

        return {
            accessToken,
            refreshToken,
            user: {
                id: user.id,
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                avatarUrl: user.avatarUrl,
                weeklyHoursCap: user.weeklyHoursCap ?? null,
                isOnHold: user.isOnHold,
                employeeId: user.employeeId ?? null,
                // The position title an administrator gave them. This is what
                // the tag beside their name shows — "Lab Member" is only the
                // fallback when nobody has set one.
                jobTitle: user.jobTitle ?? null,
                remoteWorkAllowed: user.remoteWorkAllowed,
                remoteWorkPercent: Number(user.remoteWorkPercent ?? 20),
                remoteMaxHours: user.remoteMaxHours != null ? Number(user.remoteMaxHours) : null,
                // Superseded names, still sent so existing clients keep
                // rendering the same switches until they move to
                // `remoteWorkAllowed`.
                onlineClockEnabled: user.remoteWorkAllowed,
                remoteWorkRestricted: !user.remoteWorkAllowed,
                permissions,
            },
        };
    }

    async refresh(rawToken: string) {
        const tokenHash = this.hashToken(rawToken);
        const stored = await this.refreshRepo.findOne({
            where: { tokenHash },
            relations: ['user'],
        });
        const now = new Date();

        if (!stored || stored.expiresAt < now || !stored.user || !stored.user.isActive) {
            throw new UnauthorizedException('Refresh token invalid or expired');
        }

        if (stored.rotatedAt) {
            // Already exchanged once. Inside the grace window this is a
            // concurrent duplicate (parallel 401 retries / second tab) —
            // issue fresh tokens instead of logging the user out.
            const age = now.getTime() - new Date(stored.rotatedAt).getTime();
            if (age > AuthService.REFRESH_GRACE_MS) {
                // Replayed long after rotation — possible theft. Reject and
                // revoke the whole user's refresh tokens to be safe.
                this.logger.warn(
                    `Refresh-token replay detected for user ${stored.userId} (rotated ${Math.round(age / 1000)}s ago) — revoking all sessions`,
                );
                await this.refreshRepo.delete({ userId: stored.userId });
                throw new UnauthorizedException('Refresh token invalid or expired');
            }
            const graceToken = await this.createRefreshToken(stored.user.id);
            return { accessToken: this.signAccessToken(stored.user), refreshToken: graceToken };
        }

        // Normal path: create the replacement FIRST, then mark the old token
        // as rotated — so a failure mid-way can never leave the user with no
        // valid token at all.
        const newRefreshToken = await this.createRefreshToken(stored.user.id);
        await this.refreshRepo.update(stored.id, {
            rotatedAt: now,
            replacedByHash: this.hashToken(newRefreshToken),
        });

        return { accessToken: this.signAccessToken(stored.user), refreshToken: newRefreshToken };
    }

    async logout(rawToken: string): Promise<void> {
        const tokenHash = this.hashToken(rawToken);
        await this.refreshRepo.delete({ tokenHash });
    }

    /**
     * Email-based password reset request.
     *
     * Always resolves the same way whether or not the address exists (no
     * account enumeration), and the token is ONLY ever delivered through the
     * email channel (or the server log when SMTP isn't configured) — never
     * in the HTTP response.
     */
    async requestPasswordReset(email: string, resetBaseUrl: string): Promise<void> {
        const user = await this.usersService.findByEmail(email);
        if (!user || !user.isActive || !user.email) {
            this.logger.log(`Password reset requested for unknown/inactive address <${email}> — nothing sent`);
            return;
        }
        await this.issuePasswordReset(user, resetBaseUrl);
    }

    /**
     * Administrator-initiated reset: send the reset link to a named account.
     *
     * Unlike the public endpoint this one DOES report what happened — the
     * caller is an authenticated administrator looking at the user list, so
     * there is no account to enumerate and "did it go anywhere?" is exactly
     * what they need to know. The administrator never sees the token; the link
     * only ever reaches the account's own mailbox.
     */
    async sendPasswordResetFor(userId: string, resetBaseUrl: string): Promise<{ email: string }> {
        const user = await this.usersService.findById(userId);   // 404s if unknown
        if (!user.email) {
            throw new BadRequestException(
                `${user.fullName} has no email address on file, so there is nowhere to send a reset link.`,
            );
        }
        if (!user.isActive) {
            throw new BadRequestException(
                `${user.fullName} is deactivated and cannot sign in, so a reset link would be of no use.`,
            );
        }

        await this.issuePasswordReset(user, resetBaseUrl);
        this.logger.log(`Administrator-initiated password reset issued for <${user.email}>`);
        return { email: user.email };
    }

    /** Mints the single active reset token for a user and mails the link. */
    private async issuePasswordReset(user: User, resetBaseUrl: string): Promise<void> {

        // Invalidate any earlier reset token for this user (single active link)
        await this.resetRepo.delete({ userId: user.id });

        const raw = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(raw);
        const expiresAt = new Date(Date.now() + 60 * 60 * 1_000); // 1 hour

        await this.resetRepo.save(
            this.resetRepo.create({ userId: user.id, tokenHash, expiresAt }),
        );

        const base = (resetBaseUrl || '').replace(/\/+$/, '');
        const link = `${base}/reset-password?token=${raw}`;

        // Deliberately NOT awaited.
        //
        // The endpoint answers identically whether or not the address is
        // registered, so there is nothing a caller could learn by waiting —
        // and delivery can legitimately take minutes here, because the mail
        // service retries connection failures several times over a link that
        // resets about half its outbound TLS connections. Awaiting it left the
        // "send reset link" button spinning for the whole of that.
        //
        // The token is already committed above, so the link in the email is
        // valid the moment it arrives. A delivery failure is logged by
        // MailService together with the link itself, so an administrator can
        // still pass it on by hand.
        void this.mailService
            .sendPasswordReset(user.email, user.fullName, link, expiresAt)
            .catch((err: any) => this.logger.error(
                `Password-reset email to <${user.email}> failed: ${err?.message}`,
            ));
    }

    /**
     * Creates an account from an email address and invites its owner to claim
     * it. The administrator never chooses a username or a password.
     */
    async inviteUser(
        dto: InviteUserDto,
        baseUrl: string,
        actorId?: string,
    ): Promise<{ user: User; email: string }> {
        const invitedBy = await this.displayNameOf(actorId);
        const user = await this.usersService.createInvited(dto);
        await this.issueInvitation(user, baseUrl, invitedBy);
        this.logger.log(`Invitation issued for <${user.email}> by ${invitedBy ?? 'an administrator'}`);
        return { user, email: user.email };
    }

    /**
     * Sends a fresh invitation for an account that has not been claimed yet.
     *
     * Any earlier link stops working, which is the point: an invitation that
     * went to a mistyped address, or that expired, should not stay live once
     * it has been replaced.
     */
    async resendInvitation(
        userId: string,
        baseUrl: string,
        actorId?: string,
    ): Promise<{ email: string }> {
        const invitedBy = await this.displayNameOf(actorId);
        const user = await this.usersService.findById(userId);
        if (!user.email) {
            throw new BadRequestException(
                `${user.fullName} has no email address on file, so there is nowhere to send an invitation.`,
            );
        }
        if (user.registeredAt) {
            throw new BadRequestException(
                `${user.fullName} has already set up their account. `
                + 'Send them a password-reset link instead if they cannot get in.',
            );
        }

        await this.issueInvitation(user, baseUrl, invitedBy);
        this.logger.log(`Invitation re-sent to <${user.email}>`);
        return { email: user.email };
    }

    /**
     * The name to credit an invitation to, or undefined if it cannot be
     * resolved. Never fails the invitation over it — whose name is on the
     * email matters far less than the email going out.
     */
    private async displayNameOf(userId?: string): Promise<string | undefined> {
        if (!userId) return undefined;
        try {
            return (await this.usersService.findById(userId)).fullName || undefined;
        } catch {
            return undefined;
        }
    }

    /** Mints the single active invitation token for a user and mails the link. */
    private async issueInvitation(user: User, baseUrl: string, invitedBy?: string): Promise<void> {
        // One live invitation per account: a new link retires the old one.
        await this.inviteRepo.delete({ userId: user.id });

        const raw = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + AuthService.INVITE_TTL_MS);
        await this.inviteRepo.save(this.inviteRepo.create({
            userId: user.id,
            tokenHash: this.hashToken(raw),
            expiresAt,
            usedAt: null,
        }));

        const base = (baseUrl || '').replace(/\/+$/, '');
        const link = `${base}/register?token=${raw}`;

        // Not awaited, for the same reason as the password reset: delivery
        // retries can take minutes over this link, the token is already
        // committed, and a failure is logged with the link so an
        // administrator can still pass it on by hand.
        void this.mailService
            .sendRegistrationInvite(user.email, user.fullName, link, expiresAt, invitedBy)
            .catch((err: any) => this.logger.error(
                `Invitation email to <${user.email}> failed: ${err?.message}`,
            ));
    }

    /**
     * What the registration page needs to show before anything is typed:
     * which account this link is for, and whether it is still good.
     *
     * The three failure modes are reported apart from each other — unknown,
     * expired, already used — because they call for different things from the
     * person reading the page, and "invalid" tells them none of it.
     */
    async describeInvitation(rawToken: string): Promise<{ email: string; fullName: string }> {
        const stored = await this.inviteRepo.findOne({
            where: { tokenHash: this.hashToken(rawToken) },
            relations: ['user'],
        });

        if (!stored || !stored.user) {
            throw new BadRequestException(
                'This invitation link is not valid. Ask an administrator to send you a new one.',
            );
        }
        if (stored.usedAt) {
            throw new BadRequestException(
                'This invitation has already been used. Try signing in, or use "Forgot password" if you cannot get in.',
            );
        }
        if (stored.expiresAt < new Date()) {
            throw new BadRequestException(
                'This invitation has expired. Ask an administrator to send you a new one.',
            );
        }

        return { email: stored.user.email, fullName: stored.user.fullName };
    }

    /**
     * Completes registration and signs the new member straight in, so the
     * first thing they see after choosing a password is the portal rather
     * than another login form.
     */
    async completeRegistration(dto: CompleteRegistrationDto) {
        const tokenHash = this.hashToken(dto.token);
        const stored = await this.inviteRepo.findOne({
            where: { tokenHash },
            relations: ['user'],
        });

        // Re-checked here rather than trusted from the page's earlier lookup:
        // the link could have been used, replaced or expired in between.
        if (!stored || !stored.user) {
            throw new BadRequestException(
                'This invitation link is not valid. Ask an administrator to send you a new one.',
            );
        }
        if (stored.usedAt) {
            throw new BadRequestException('This invitation has already been used.');
        }
        if (stored.expiresAt < new Date()) {
            throw new BadRequestException(
                'This invitation has expired. Ask an administrator to send you a new one.',
            );
        }

        await this.usersService.finishRegistration(stored.userId, {
            username: dto.username,
            password: dto.password,
            fullName: dto.fullName,
        });

        // Marked used only once the account is really set up, so a failure
        // above (a taken username, say) leaves the link usable for a retry.
        await this.inviteRepo.update(stored.id, { usedAt: new Date() });

        this.logger.log(`Registration completed for <${stored.user.email}> as @${dto.username.trim().toLowerCase()}`);
        return this.login(dto.username.trim().toLowerCase(), dto.password);
    }

    /**
     * Validates the reset token and updates the user's password.
     * The token is single-use; all existing sessions (refresh tokens) are
     * revoked so a password reset signs the user in fresh everywhere.
     */
    async resetPassword(rawToken: string, newPassword: string): Promise<void> {
        const tokenHash = this.hashToken(rawToken);
        const stored = await this.resetRepo.findOne({
            where: { tokenHash },
            relations: ['user'],
        });

        if (!stored || stored.expiresAt < new Date()) {
            throw new BadRequestException('Reset token is invalid or has expired');
        }

        const passwordHash = await bcrypt.hash(newPassword, 12);
        await this.usersService.setPasswordHash(stored.userId, passwordHash);

        // Single-use: delete token after use
        await this.resetRepo.delete(stored.id);
        // Force re-login on every device with the new password
        await this.refreshRepo.delete({ userId: stored.userId });
    }

    /** Effective permission set for the login/me response. */
    permissionsOf(user: User): RolePermissions {
        return effectivePermissions(user.permissions);
    }

    private signAccessToken(user: User): string {
        const payload = { sub: user.id, username: user.username, role: user.role };
        return this.jwtService.sign(payload, {
            secret: this.config.get('JWT_SECRET'),
            expiresIn: this.config.get('JWT_EXPIRES_IN', '15m'),
        });
    }

    private async createRefreshToken(userId: string): Promise<string> {
        const raw = crypto.randomBytes(64).toString('hex');
        const hash = this.hashToken(raw);

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await this.refreshRepo.save(
            this.refreshRepo.create({ userId, tokenHash: hash, expiresAt }),
        );

        return raw;
    }

    /** Deletes expired and long-rotated refresh tokens. Fire-and-forget. */
    private async cleanupRefreshTokens(): Promise<void> {
        const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        await this.refreshRepo
            .createQueryBuilder()
            .delete()
            .where('expires_at < :cutoff OR rotated_at < :cutoff', { cutoff })
            .execute();
    }

    private hashToken(raw: string): string {
        return crypto.createHash('sha256').update(raw).digest('hex');
    }
}
