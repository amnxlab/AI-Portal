import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
    ManyToOne, JoinColumn, PrimaryColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type SessionMode = 'onsite' | 'remote';
export type SessionStatus = 'open' | 'closed' | 'incomplete' | 'voided';

/**
 * A working session: one clock-in paired with its clock-out.
 *
 *  - `originalInAt` / `originalOutAt` are what was first recorded and never
 *    change.
 *  - `clockInAt` / `clockOutAt` are the effective values used for every
 *    calculation. They differ from the originals only after an administrator
 *    correction, which is recorded in attendance_corrections.
 *  - Only `closed` sessions count as worked time. `open` is in progress,
 *    `incomplete` is a clock-in that was never clocked out, `voided` was
 *    cancelled by an administrator.
 */
@Entity('attendance_sessions')
export class AttendanceSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    /** onsite = RFID reader (or admin entry); remote = portal clock. */
    @Column({ type: 'text' })
    mode: SessionMode;

    @Column({ type: 'text' })
    source: string;

    @Column({ name: 'clock_in_record_id', type: 'uuid', nullable: true })
    clockInRecordId: string | null;

    @Column({ name: 'clock_out_record_id', type: 'uuid', nullable: true })
    clockOutRecordId: string | null;

    @Column({ name: 'original_in_at', type: 'timestamptz', nullable: true })
    originalInAt: Date | null;

    @Column({ name: 'original_out_at', type: 'timestamptz', nullable: true })
    originalOutAt: Date | null;

    @Column({ name: 'clock_in_at', type: 'timestamptz' })
    clockInAt: Date;

    @Column({ name: 'clock_out_at', type: 'timestamptz', nullable: true })
    clockOutAt: Date | null;

    @Column({ type: 'text' })
    status: SessionStatus;

    @Column({ type: 'boolean', default: false })
    corrected: boolean;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}

export type CorrectionAction = 'create' | 'edit' | 'close' | 'void' | 'manual_clock';

/** Append-only record of every administrative change to a session. */
@Entity('attendance_corrections')
export class AttendanceCorrection {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'session_id', type: 'uuid' })
    sessionId: string;

    /** The employee whose attendance was changed. */
    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @Column({ type: 'text' })
    action: CorrectionAction;

    @Column({ name: 'old_values', type: 'jsonb', nullable: true })
    oldValues: any;

    @Column({ name: 'new_values', type: 'jsonb', nullable: true })
    newValues: any;

    @Column({ type: 'text' })
    reason: string;

    /** The administrator responsible. */
    @Column({ name: 'corrected_by', type: 'uuid', nullable: true })
    correctedBy: string | null;

    /** Name snapshot, so the log stays readable if the admin account is later removed. */
    @Column({ name: 'corrected_by_name', type: 'text' })
    correctedByName: string;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}

@Entity('system_settings')
export class SystemSetting {
    @PrimaryColumn({ type: 'text' })
    key: string;

    @Column({ type: 'jsonb', nullable: true })
    value: any;

    @Column({ name: 'updated_by', type: 'uuid', nullable: true })
    updatedBy: string | null;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
