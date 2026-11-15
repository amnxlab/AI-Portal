import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

export type AttendanceSource = 'manual' | 'csv_import' | 'online_portal' | 'rfid' | 'admin_correction';

/**
 * The immutable attendance event log: one row per clock-in / clock-out as it
 * was originally received. Rows here are never updated or deleted — working
 * time is derived from attendance_sessions, and changes go through
 * attendance_corrections.
 */
@Entity('attendance_records')
export class AttendanceRecord {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ type: 'text' })
    action: 'clock_in' | 'clock_out';

    /** Authoritative server time of the event (UTC). */
    @Column({ type: 'timestamptz' })
    timestamp: Date;

    @Column({ type: 'text', default: 'manual' })
    source: AttendanceSource;

    /** RFID card UID, when the event came from a reader or a CSV import. */
    @Column({ type: 'varchar', nullable: true })
    uid: string | null;

    @Column({ name: 'device_id', type: 'uuid', nullable: true })
    deviceId: string | null;

    @Column({ name: 'card_id', type: 'uuid', nullable: true })
    cardId: string | null;

    /** Reader-generated event identifier (idempotency key). */
    @Column({ name: 'event_id', type: 'uuid', nullable: true })
    eventId: string | null;

    /** The administrator who entered the event, for manual entries. */
    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
