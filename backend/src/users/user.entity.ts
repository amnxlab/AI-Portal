import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import type { RolePermissions } from '../roles/role.entity';

/**
 * Legacy role names — kept only for migration/type compatibility.
 * The system now uses ONE unified role ('Member') for everyone; actual
 * access is driven by the per-user `permissions` column below.
 */
export type UserRole = 'Admin' | 'Project_Leader' | 'Lab_Assistant' | 'Inventory_Manager' | 'Member' | string;

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ unique: true })
    username: string;

    @Column({ unique: true, nullable: true })
    email: string;

    @Column({ name: 'full_name' })
    fullName: string;

    @Column({ name: 'password_hash' })
    @Exclude()
    passwordHash: string;

    /**
     * Unified role — every user is a 'Member'. Kept as a column so existing
     * queries/relations keep working, but it no longer gates any behaviour.
     * Access control is fully driven by `permissions`.
     */
    @Column({ type: 'text', default: 'Member' })
    role: UserRole;

    /**
     * Per-user modular access permissions. Single source of truth for what
     * this user may do. null until the boot migration backfills it (from the
     * user's legacy role), then always a full RolePermissions-shaped object.
     * Resolve with effectivePermissions(user.permissions).
     */
    @Column({ type: 'jsonb', nullable: true, default: null })
    permissions: RolePermissions | null;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
    avatarUrl: string | null;

    @Column({ type: 'text', nullable: true })
    bio: string | null;

    @Column({ name: 'job_title', type: 'varchar', nullable: true })
    jobTitle: string | null;

    /** Max hours a regular member can submit per week. null = no cap. Set by a user administrator. */
    @Column({ name: 'weekly_hours_cap', type: 'numeric', precision: 5, scale: 1, nullable: true })
    weeklyHoursCap: number | null;

    /** Hourly rate for labor cost calculations. Set by a user administrator. */
    @Column({ name: 'hourly_rate', type: 'numeric', precision: 10, scale: 2, nullable: true, default: 15.00 })
    hourlyRate: number | null;

    /**
     * Remote-work authorisation. Only a user administrator can change it.
     * When false the employee cannot report remote hours and cannot clock
     * in/out through the portal — the RFID reader is their only clock.
     */
    @Column({ name: 'remote_work_allowed', type: 'boolean', default: false })
    remoteWorkAllowed: boolean;

    /** Share of the weekly hours that may be worked remotely (default policy: 20%). */
    @Column({ name: 'remote_work_percent', type: 'numeric', precision: 5, scale: 2, default: 20 })
    remoteWorkPercent: number;

    /** Hard weekly ceiling on remote hours. null = only the percentage applies. */
    @Column({ name: 'remote_max_hours', type: 'numeric', precision: 5, scale: 1, nullable: true })
    remoteMaxHours: number | null;

    /** When true, the user account is on hold: they can view everything but cannot submit or modify any data. Set by a user administrator. */
    @Column({ name: 'is_on_hold', type: 'boolean', default: false })
    isOnHold: boolean;

    /** Unique employee identifier used to match attendance records. Set by a user administrator. */
    @Column({ name: 'employee_id', type: 'varchar', nullable: true, unique: true })
    employeeId: string | null;

    /**
     * When the account was archived, or null while it is in use.
     *
     * Archiving replaces deletion: the row and everything referring to it are
     * kept, so no attendance, report, comment or uploaded file is ever lost.
     */
    /**
     * When the invitation to set up this account was sent, or null for an
     * account that was never invited (everything created before invitations
     * existed).
     */
    @Column({ name: 'invited_at', type: 'timestamptz', nullable: true })
    invitedAt: Date | null;

    /**
     * When its owner finished setting it up by choosing a username and
     * password. An account with an `invitedAt` but no `registeredAt` is an
     * outstanding invitation: it exists, but nobody can sign in to it.
     */
    @Column({ name: 'registered_at', type: 'timestamptz', nullable: true })
    registeredAt: Date | null;

    @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
    archivedAt: Date | null;

    /**
     * The Employee ID this account held before it was archived.
     *
     * Archiving releases `employeeId` so the number can be issued to somebody
     * new — which is the point of archiving rather than deactivating. The old
     * value is kept here so historical attendance can still be attributed.
     */
    @Column({ name: 'archived_employee_id', type: 'varchar', nullable: true })
    archivedEmployeeId: string | null;

    /**
     * The real name, kept while the account is deleted.
     *
     * While deleted, `fullName` carries the "(deleted user)" suffix so every
     * screen that shows a name is correct without each one having to know
     * about deletion. Restoring puts this back.
     */
    @Column({ name: 'original_full_name', type: 'varchar', nullable: true })
    originalFullName: string | null;

    /** The username held before deletion, so the handle can be reused. */
    @Column({ name: 'original_username', type: 'varchar', nullable: true })
    originalUsername: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
