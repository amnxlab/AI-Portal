import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import { User, UserRole } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSelfDto } from './dto/update-self.dto';
import {
    RolePermissions, UNIFIED_ROLE, BASE_PERMISSIONS,
    effectivePermissions, sanitizePermissions,
} from '../roles/role.entity';
import { Project } from '../projects/project.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Appended to a deleted account's name.
 *
 * Deleting a person must not delete their work, so the row survives as a
 * tombstone and everything attached to it keeps a valid owner. This is what
 * makes that visible: their name reads "Jane Okafor (deleted user)" wherever
 * it still appears.
 */
export const DELETED_SUFFIX = ' (deleted user)';

@Injectable()
export class UsersService {
    constructor(
        @InjectRepository(User)
        private readonly usersRepo: Repository<User>,
        @InjectRepository(Project)
        private readonly projectRepo: Repository<Project>,
        // AuditModule is @Global, so this needs no module wiring.
        private readonly auditService: AuditService,
    ) { }

    /**
     * Safely deletes a locally-hosted avatar file from disk.
     * Only handles /api/uploads/<uuid>.<ext> paths — ignores external URLs.
     * Guards against path traversal.
     */
    private deleteAvatarFile(avatarUrl: string): void {
        const PREFIX = '/api/uploads/';
        if (!avatarUrl || !avatarUrl.startsWith(PREFIX)) return;
        const filename = avatarUrl.slice(PREFIX.length);
        // Reject any path segments to prevent directory traversal
        if (filename.includes('/') || filename.includes('..') || filename.includes('\\')) return;
        const uploadDir = nodePath.resolve(process.env.UPLOAD_PATH ?? './uploads');
        const filePath = nodePath.resolve(nodePath.join(uploadDir, filename));
        // Double-check resolved path is still inside the uploads directory
        if (!filePath.startsWith(uploadDir + nodePath.sep) && filePath !== uploadDir) return;
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore — file may already be absent */ }
    }

    /**
     * The shape every read of a user returns.
     *
     * `remoteWorkAllowed` is the column; `remoteWorkRestricted` and
     * `onlineClockEnabled` are the names the forms were built around. They
     * used to exist as columns and were folded into one authorisation, but
     * only the login response was taught to send the old names — every other
     * read returned the entity as-is. The edit form read
     * `user.remoteWorkRestricted`, got undefined, and showed the switch off
     * no matter what was stored. The save worked; reopening the form threw
     * the answer away, which is exactly what "it reverts after a reload"
     * looked like.
     *
     * Derived here, in one place, so no read can disagree with another.
     */
    private view<T extends User>(user: T) {
        return {
            ...user,
            remoteWorkPercent: user.remoteWorkPercent != null ? Number(user.remoteWorkPercent) : 20,
            remoteMaxHours: user.remoteMaxHours != null ? Number(user.remoteMaxHours) : null,
            weeklyHoursCap: user.weeklyHoursCap != null ? Number(user.weeklyHoursCap) : null,
            hourlyRate: user.hourlyRate != null ? Number(user.hourlyRate) : null,
            // Superseded names for the same authorisation, kept so existing
            // screens keep working and always agree with the column.
            onlineClockEnabled: user.remoteWorkAllowed,
            remoteWorkRestricted: !user.remoteWorkAllowed,
        };
    }

    async findAll(): Promise<any[]> {
        const users = await this.usersRepo.find({ order: { createdAt: 'DESC' } });
        return users.map((u) => this.view(u));
    }

    /** Single user, in the same shape the list returns. */
    async findOneView(id: string): Promise<any> {
        return this.view(await this.findById(id));
    }

    /**
     * Everything attached to an account that must outlive it.
     *
     * Permanent deletion is refused while any of this exists. The point is
     * not to make deletion hard — it is that these rows either cascade away
     * with the user (reports, schedules, comments, tickets) or point back at
     * them (attendance, labor, audit). Removing the account would either
     * destroy the record or leave it attributed to nobody, and both are worse
     * than keeping a deactivated row. Archiving exists for that case and
     * keeps all of it.
     */
    async getDeletionBlockers(id: string): Promise<{ label: string; count: number }[]> {
        const [row] = await this.usersRepo.query(
            `SELECT
               (SELECT count(*) FROM attendance_records      WHERE user_id = $1)                       AS attendance_events,
               (SELECT count(*) FROM attendance_sessions     WHERE user_id = $1)                       AS attendance_sessions,
               (SELECT count(*) FROM attendance_corrections  WHERE user_id = $1)                       AS attendance_corrections,
               (SELECT count(*) FROM rfid_cards              WHERE user_id = $1)                       AS rfid_cards,
               (SELECT count(*) FROM weekly_reports          WHERE user_id = $1)                       AS weekly_reports,
               (SELECT count(*) FROM schedules               WHERE user_id = $1)                       AS schedules,
               (SELECT count(*) FROM comments                WHERE author_id = $1)                     AS comments,
               (SELECT count(*) FROM tickets                 WHERE submitter_id = $1)                  AS tickets,
               (SELECT count(*) FROM labor_deductions        WHERE user_id = $1)                       AS labor_deductions,
               (SELECT count(*) FROM expenses                WHERE recorded_by_id = $1)                AS expenses_recorded,
               (SELECT count(*) FROM projects                WHERE owner_id = $1)                      AS projects_owned,
               (SELECT count(*) FROM tasks                   WHERE created_by = $1 OR assignee_id = $1) AS tasks,
               (SELECT count(*) FROM inventory_items         WHERE created_by = $1 OR assigned_to = $1) AS inventory_items,
               (SELECT count(*) FROM wishlist_items          WHERE requested_by = $1 OR approved_by = $1) AS wishlist_items,
               (SELECT count(*) FROM papers                  WHERE added_by = $1)                      AS papers,
               (SELECT count(*) FROM project_files           WHERE uploader_id = $1)                   AS files,
               (SELECT count(*) FROM audit_logs              WHERE actor_id = $1)                      AS audit_entries`,
            [id],
        );
        const LABELS: Record<string, string> = {
            attendance_events: 'attendance events',
            attendance_sessions: 'attendance sessions',
            attendance_corrections: 'attendance corrections',
            rfid_cards: 'RFID cards',
            weekly_reports: 'weekly reports',
            schedules: 'schedule entries',
            comments: 'comments',
            tickets: 'tickets',
            labor_deductions: 'labor charges',
            expenses_recorded: 'expenses they recorded',
            projects_owned: 'projects they own',
            tasks: 'tasks',
            inventory_items: 'inventory items',
            wishlist_items: 'wishlist items',
            papers: 'papers',
            files: 'uploaded files',
            audit_entries: 'audit-trail entries',
        };
        return Object.entries(LABELS)
            .map(([key, label]) => ({ label, count: Number(row?.[key]) || 0 }))
            .filter((x) => x.count > 0);
    }

    /**
     * Removes the account row itself. There is no undo.
     *
     * Only possible for an account that has not done anything yet — an
     * invitation to the wrong address, a duplicate, a test account. Anything
     * with history is refused, naming exactly what is in the way, because the
     * alternative is destroying that history or orphaning it.
     *
     * What does go with the account is the account itself: its sessions,
     * reset and invitation tokens, notifications, project memberships and
     * labor-pool membership. None of those are records of work.
     */
    async permanentlyDelete(id: string, actorId: string): Promise<{ username: string; fullName: string }> {
        const user = await this.findById(id);
        if (id === actorId) {
            throw new BadRequestException('You cannot permanently delete your own account.');
        }

        const blockers = await this.getDeletionBlockers(id);
        if (blockers.length) {
            const summary = blockers.map((x) => `${x.count} ${x.label}`).join(', ');
            throw new ConflictException(
                `${user.fullName} cannot be permanently deleted: the account still has ${summary}. `
                + 'Deleting it would either destroy those records or leave them attributed to nobody. '
                + 'Delete the account instead — that keeps every one of them and frees the Employee ID and username for reuse.',
            );
        }

        const identity = { username: user.originalUsername ?? user.username, fullName: user.originalFullName ?? user.fullName };
        await this.usersRepo.manager.transaction(async (manager) => {
            // Session and invitation state cascades, but clear it explicitly
            // so the intent is on the record rather than in a foreign key.
            await manager.query(`DELETE FROM refresh_tokens        WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM registration_tokens   WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM notifications         WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM project_members       WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM labor_pool_members    WHERE user_id = $1`, [id]);
            await manager.query(`DELETE FROM users                 WHERE id = $1`, [id]);
        });

        await this.auditService.log({
            actorId, entityType: 'User', entityId: id, action: 'permanent_delete',
            oldValue: identity,
        });
        return identity;
    }

    /** Returns minimal user info for all active users (id, fullName, role, permissions, weeklyHoursCap).
      * permissions is included so assignment UIs can gate on what a user may do
      * (e.g. task-creation pickers), and weeklyHoursCap so they can enforce hour limits. */
    async findDirectory(): Promise<{ id: string; fullName: string; employeeId: string | null; isActive: boolean; role: string; permissions: RolePermissions; weeklyHoursCap: number | null }[]> {
        const users = await this.usersRepo.find({
            where: { isActive: true },
            // employeeId is here because every person-picker in the portal
            // wants it to tell two people with similar names apart. It is not
            // sensitive — it is printed on the attendance board — and this
            // route is already limited to signed-in users.
            select: ['id', 'fullName', 'employeeId', 'role', 'permissions', 'weeklyHoursCap'],
            order: { fullName: 'ASC' },
        });
        return users.map((u) => ({
            id: u.id,
            fullName: u.fullName,
            employeeId: u.employeeId ?? null,
            // The directory only ever lists active people; stating it saves
            // every caller from guessing.
            isActive: true,
            role: u.role,
            permissions: effectivePermissions(u.permissions),
            weeklyHoursCap: u.weeklyHoursCap,
        }));
    }

    async findById(id: string): Promise<User> {
        const user = await this.usersRepo.findOne({ where: { id } });
        if (!user) throw new NotFoundException(`User ${id} not found`);
        return user;
    }

    /** Public profile card — safe for any authenticated user to read. */
    async findProfile(id: string): Promise<{ id: string; fullName: string; role: string; avatarUrl: string | null; bio: string | null; jobTitle: string | null }> {
        const user = await this.usersRepo.findOne({ where: { id } });
        if (!user) throw new NotFoundException(`User ${id} not found`);
        return {
            id: user.id,
            fullName: user.fullName,
            role: user.role,
            avatarUrl: user.avatarUrl,
            bio: user.bio,
            jobTitle: user.jobTitle,
        };
    }

    async findByUsername(username: string): Promise<User | null> {
        return this.usersRepo
            .createQueryBuilder('user')
            .where('LOWER(user.username) = LOWER(:username)', { username: username.trim() })
            .getOne();
    }

    /** Case-insensitive lookup by email — used by the password-reset flow. */
    async findByEmail(email: string): Promise<User | null> {
        return this.usersRepo
            .createQueryBuilder('user')
            .where('LOWER(user.email) = LOWER(:email)', { email: email.trim() })
            .getOne();
    }

    async create(dto: CreateUserDto): Promise<User> {
        const normalizedUsername = dto.username.trim().toLowerCase();
        const exists = await this.usersRepo
            .createQueryBuilder('user')
            .where('LOWER(user.username) = :username', { username: normalizedUsername })
            .getOne();
        if (exists) throw new ConflictException('Username already taken');

        if (dto.email) {
            const emailTaken = await this.findByEmail(dto.email);
            if (emailTaken) throw new ConflictException('Email already in use by another account');
        }

        const passwordHash = await bcrypt.hash(dto.password, 12);
        const user = this.usersRepo.create({
            username: normalizedUsername,
            email: dto.email,
            fullName: dto.fullName,
            passwordHash,
            // Unified model: everyone is a Member; access comes from permissions.
            // dto.role is accepted for API compatibility but no longer applied.
            role: UNIFIED_ROLE as UserRole,
            permissions: { ...BASE_PERMISSIONS, ...sanitizePermissions(dto.permissions) },
        });
        return this.usersRepo.save(user);
    }

    /**
     * Creates an account from an email address alone, for its owner to claim.
     *
     * The row exists immediately — so it can be given an Employee ID, a
     * position and permissions straight away — but it cannot be signed in to:
     * `isActive` is false and the stored password hash is of a random secret
     * that nobody, including this process, ever keeps. The only way in is the
     * invitation link, which sets a real username and password.
     *
     * The placeholder username is unique and obviously temporary. It is
     * replaced the moment the invitation is accepted.
     */
    async createInvited(dto: {
        email: string;
        fullName?: string;
        jobTitle?: string | null;
        employeeId?: string | null;
        permissions?: Record<string, boolean>;
        weeklyHoursCap?: number | null;
        remoteWorkAllowed?: boolean;
        isOnHold?: boolean;
    }): Promise<User> {
        const email = dto.email.trim();
        const existing = await this.findByEmail(email);
        if (existing) {
            if (existing.invitedAt && !existing.registeredAt) {
                throw new ConflictException(
                    `${email} has already been invited and has not finished setting up their account yet. `
                    + 'Use "Resend invitation" on their row to send the link again.',
                );
            }
            throw new ConflictException(`${email} already belongs to an account on the portal.`);
        }

        if (dto.employeeId) {
            const idTaken = await this.usersRepo.findOne({ where: { employeeId: dto.employeeId } });
            if (idTaken) throw new ConflictException(`Employee ID ${dto.employeeId} is already in use.`);
        }

        // A hash of a secret that is generated, used once and never kept, so
        // the account has a valid password column that no password matches.
        const unusablePassword = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);

        const user = this.usersRepo.create({
            username: `pending-${crypto.randomBytes(5).toString('hex')}`,
            email,
            fullName: (dto.fullName?.trim() || email.split('@')[0]),
            passwordHash: unusablePassword,
            role: UNIFIED_ROLE as UserRole,
            permissions: { ...BASE_PERMISSIONS, ...sanitizePermissions(dto.permissions) },
            isActive: false,
            invitedAt: new Date(),
            registeredAt: null,
            jobTitle: dto.jobTitle || null,
            employeeId: dto.employeeId || null,
            weeklyHoursCap: dto.weeklyHoursCap ?? null,
            remoteWorkAllowed: dto.remoteWorkAllowed ?? false,
            isOnHold: dto.isOnHold ?? false,
        });
        return this.usersRepo.save(user);
    }

    /**
     * Turns an invited account into a real one, with the username and
     * password its owner chose. Only ever reached by presenting a valid
     * invitation token.
     */
    async finishRegistration(
        userId: string,
        chosen: { username: string; password: string; fullName?: string },
    ): Promise<User> {
        const user = await this.findById(userId);
        const username = chosen.username.trim().toLowerCase();

        const taken = await this.usersRepo
            .createQueryBuilder('user')
            .where('LOWER(user.username) = :username', { username })
            .andWhere('user.id != :id', { id: userId })
            .getOne();
        if (taken) throw new ConflictException('That username is already taken — please choose another.');

        user.username = username;
        user.passwordHash = await bcrypt.hash(chosen.password, 12);
        if (chosen.fullName?.trim()) user.fullName = chosen.fullName.trim();
        user.isActive = true;
        user.registeredAt = new Date();
        return this.usersRepo.save(user);
    }

    async update(id: string, dto: UpdateUserDto): Promise<User> {
        const user = await this.findById(id);
        if (dto.username && dto.username.trim().toLowerCase() !== user.username.toLowerCase()) {
            const normalizedNew = dto.username.trim().toLowerCase();
            const taken = await this.usersRepo
                .createQueryBuilder('user')
                .where('LOWER(user.username) = :username', { username: normalizedNew })
                .getOne();
            if (taken) throw new ConflictException('Username already taken');
            dto.username = normalizedNew;
        }
        if (dto.email && dto.email.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) {
            const emailTaken = await this.findByEmail(dto.email);
            if (emailTaken && emailTaken.id !== id) throw new ConflictException('Email already in use by another account');
        }
        if (dto.password) {
            user.passwordHash = await bcrypt.hash(dto.password, 12);
            delete dto.password;
        }
        if (dto.fullName  !== undefined) user.fullName  = dto.fullName;
        if (dto.username  !== undefined) user.username  = dto.username;
        if (dto.email     !== undefined) user.email     = dto.email;
        // dto.role is ignored on purpose — the unified model has one role.
        if (dto.permissions !== undefined) {
            // Full replace with a sanitized, complete flag set (missing keys
            // fall back to the member baseline) so the stored object always
            // has every PERMISSION_FLAGS key.
            user.permissions = { ...BASE_PERMISSIONS, ...sanitizePermissions(dto.permissions) };
        }
        if (dto.avatarUrl !== undefined) {
            // Delete the old upload file before overwriting the URL
            if (user.avatarUrl && user.avatarUrl !== (dto.avatarUrl ?? null)) {
                this.deleteAvatarFile(user.avatarUrl);
            }
            user.avatarUrl = dto.avatarUrl ?? null;
        }
        if (dto.jobTitle  !== undefined) user.jobTitle  = (dto.jobTitle || null);
        if (dto.employeeId !== undefined) user.employeeId = (dto.employeeId || null);
        // Employment settings. These used to be accepted here and quietly
        // discarded, so the form had to follow up with a request per field —
        // and if one of those was refused the save was left half-applied.
        // One request now carries the whole form.
        if (dto.isOnHold  !== undefined) user.isOnHold  = dto.isOnHold;
        if (dto.hourlyRate !== undefined) user.hourlyRate = dto.hourlyRate ?? null;
        if (dto.weeklyHoursCap !== undefined) {
            const cap = dto.weeklyHoursCap;
            if (cap != null && (!isFinite(cap) || cap < 0 || cap > 168)) {
                throw new BadRequestException('Weekly hours cap must be between 0 and 168.');
            }
            user.weeklyHoursCap = cap ?? null;
        }
        // `remoteWorkRestricted` is the inverse of `remoteWorkAllowed` and is
        // applied first, so an explicit `remoteWorkAllowed` still wins.
        if (dto.remoteWorkRestricted !== undefined) user.remoteWorkAllowed = !dto.remoteWorkRestricted;
        // Remote-work policy. `onlineClockEnabled` is the superseded name for
        // the same authorisation and is applied first, so an explicit
        // `remoteWorkAllowed` in the same request wins.
        if (dto.onlineClockEnabled !== undefined) user.remoteWorkAllowed = dto.onlineClockEnabled;
        if (dto.remoteWorkAllowed !== undefined) user.remoteWorkAllowed = dto.remoteWorkAllowed;
        if (dto.remoteWorkPercent !== undefined) user.remoteWorkPercent = dto.remoteWorkPercent;
        if (dto.remoteMaxHours !== undefined) user.remoteMaxHours = dto.remoteMaxHours ?? null;
        return this.usersRepo.save(user);
    }

    async updateSelf(id: string, dto: UpdateSelfDto): Promise<User> {
        const user = await this.findById(id);
        if (dto.username && dto.username !== user.username) {
            const taken = await this.usersRepo.findOne({ where: { username: dto.username } });
            if (taken) throw new ConflictException('Username already taken');
        }
        if (dto.password) {
            (user as any).passwordHash = await bcrypt.hash(dto.password, 12);
            delete dto.password;
        }
        if (dto.fullName  !== undefined) user.fullName  = dto.fullName;
        if (dto.username  !== undefined) user.username  = dto.username;
        if (dto.email     !== undefined) user.email     = dto.email;
        if (dto.avatarUrl !== undefined) {
            // Delete the old upload file before overwriting the URL
            if (user.avatarUrl && user.avatarUrl !== (dto.avatarUrl ?? null)) {
                this.deleteAvatarFile(user.avatarUrl);
            }
            user.avatarUrl = dto.avatarUrl ?? null;
        }
        if (dto.bio       !== undefined) user.bio       = dto.bio ?? null;
        return this.usersRepo.save(user);
    }

    async deactivate(id: string): Promise<void> {
        const user = await this.findById(id);
        user.isActive = false;
        await this.usersRepo.save(user);
    }

    /**
     * Archives an account: removes the person from the lab without removing
     * their work.
     *
     * This is what used to be "permanently delete", and it no longer deletes
     * anything. A hard delete was destructive in one direction and impossible
     * in the other — it erased comments, weekly reports, submitted tickets and
     * schedules via ON DELETE CASCADE, while being refused outright for anyone
     * who had attendance, a card, or had created a task or inventory item.
     *
     * Archiving instead:
     *   - keeps the row and every reference to it, so nothing is lost;
     *   - deactivates the account, so they cannot sign in;
     *   - revokes their RFID card, so it stops opening attendance and its UID
     *     can be issued again;
     *   - **releases the Employee ID**, so the number can go to somebody new,
     *     while keeping the old value for historical attribution.
     */
    async archiveUser(id: string, actorId?: string): Promise<User> {
        const user = await this.findById(id);
        if (user.archivedAt) return user;   // already archived; nothing to do

        return this.usersRepo.manager.transaction(async (manager) => {
            // An archived account must not keep a working card.
            await manager.query(
                `UPDATE rfid_cards
                    SET status = 'removed', revoked_by = $2, revoked_at = now(),
                        revoke_reason = 'Account archived'
                  WHERE user_id = $1 AND status = 'active'`,
                [id, actorId ?? null],
            );

            // Close any session they left open, so an archived employee does
            // not appear to be still clocked in.
            await manager.query(
                `UPDATE attendance_sessions
                    SET status = 'incomplete', updated_at = now()
                  WHERE user_id = $1 AND status = 'open'`,
                [id],
            );

            const repo = manager.getRepository(User);
            const fresh = await repo.findOneOrFail({ where: { id } });

            // Keep the originals so this is reversible.
            fresh.originalFullName = fresh.originalFullName ?? fresh.fullName;
            fresh.originalUsername = fresh.originalUsername ?? fresh.username;
            fresh.archivedEmployeeId = fresh.employeeId ?? fresh.archivedEmployeeId;

            // Rewrite the display name at the source. Every screen, export and
            // raw SQL join that shows a name becomes correct at once, and a
            // query written next year cannot forget to handle deletion.
            if (!fresh.fullName.endsWith(DELETED_SUFFIX)) {
                fresh.fullName = `${fresh.fullName}${DELETED_SUFFIX}`;
            }

            // Release the identifiers so they can be issued to somebody new.
            // Both are UNIQUE, so they have to actually change rather than
            // simply be marked free. Nothing references them: every record
            // points at this row's UUID.
            fresh.employeeId = null;
            fresh.username = `${fresh.username}.deleted.${fresh.id.slice(0, 8)}`;

            fresh.archivedAt = new Date();
            fresh.isActive = false;
            return repo.save(fresh);
        });
    }

    /**
     * Brings an archived account back. The Employee ID is NOT restored
     * automatically — it may already have been issued to somebody else, so an
     * administrator assigns one explicitly.
     */
    async restoreUser(id: string): Promise<User> {
        const user = await this.findById(id);
        if (!user.archivedAt) return user;

        // Put the name and handle back, unless somebody has since taken the
        // handle — in which case the administrator picks a new one.
        if (user.originalFullName) user.fullName = user.originalFullName;
        if (user.originalUsername) {
            const taken = await this.usersRepo.findOne({ where: { username: user.originalUsername } });
            if (!taken) user.username = user.originalUsername;
        }
        user.originalFullName = null;
        user.originalUsername = null;

        // The Employee ID is deliberately NOT restored: it may already belong
        // to somebody else by now, so an administrator assigns one explicitly.
        user.archivedAt = null;
        user.isActive = true;
        return this.usersRepo.save(user);
    }

    /**
     * @deprecated Hard deletion is no longer available, by request: removing a
     * person must never remove their work. Archives instead.
     */
    async deleteUser(id: string): Promise<void> {
        await this.archiveUser(id);
    }

    async reactivate(id: string): Promise<void> {
        const user = await this.findById(id);
        user.isActive = true;
        await this.usersRepo.save(user);
    }

    async setHoursCap(id: string, cap: number | null): Promise<User> {
        const user = await this.findById(id);
        user.weeklyHoursCap = cap;
        return this.usersRepo.save(user);
    }

    /**
     * Sets the employee's remote-work policy: whether remote hours are
     * authorised at all, the share of the week they may cover, and an
     * optional hard ceiling. This is what both the portal clock and the
     * weekly-report remote-hour limit are derived from.
     */
    async setRemoteWorkPolicy(
        id: string,
        policy: { allowed?: boolean; percent?: number; maxHours?: number | null },
    ): Promise<User> {
        const user = await this.findById(id);
        if (policy.allowed !== undefined) user.remoteWorkAllowed = policy.allowed;
        if (policy.percent !== undefined) {
            if (!isFinite(policy.percent) || policy.percent < 0 || policy.percent > 100) {
                throw new BadRequestException('Remote-work percent must be between 0 and 100.');
            }
            user.remoteWorkPercent = policy.percent;
        }
        if (policy.maxHours !== undefined) {
            if (policy.maxHours != null && (!isFinite(policy.maxHours) || policy.maxHours < 0)) {
                throw new BadRequestException('Remote maximum hours must be zero or positive.');
            }
            user.remoteMaxHours = policy.maxHours ?? null;
        }
        return this.usersRepo.save(user);
    }

    /** @deprecated Inverted alias of `setRemoteWorkPolicy({ allowed })`. */
    async setRemoteWorkRestricted(id: string, restricted: boolean): Promise<User> {
        return this.setRemoteWorkPolicy(id, { allowed: !restricted });
    }

    async setOnHold(id: string, onHold: boolean): Promise<User> {
        const user = await this.findById(id);
        user.isOnHold = onHold;
        return this.usersRepo.save(user);
    }

    /**
     * @deprecated Alias of `setRemoteWorkPolicy({ allowed })`. Clocking in
     * from the portal and reporting remote hours are the same authorisation.
     */
    async setOnlineClockEnabled(id: string, enabled: boolean): Promise<User> {
        return this.setRemoteWorkPolicy(id, { allowed: enabled });
    }

    /**
     * bcrypt.compare rejects (throws) on malformed hashes instead of
     * returning false. A single corrupted row used to surface as a 500 on
     * login; treat any comparison failure as "wrong password".
     */
    async validatePassword(user: User, password: string): Promise<boolean> {
        try {
            return await bcrypt.compare(password, user.passwordHash);
        } catch {
            return false;
        }
    }

    /** Directly sets the password hash — used by the password-reset flow. */
    async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
        await this.usersRepo.update(userId, { passwordHash });
    }
}
