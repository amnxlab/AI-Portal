import {
    Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
    ManyToOne, JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../users/user.entity';

/** A physical RFID-ShiftMate reader allowed to talk to the portal. */
@Entity('rfid_devices')
export class RfidDevice {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** The identifier the reader announces in X-Device-Id (e.g. RFID-SM2-001). */
    @Column({ name: 'device_id', type: 'varchar', length: 64, unique: true })
    deviceId: string;

    @Column({ type: 'varchar', length: 120 })
    name: string;

    @Column({ type: 'varchar', length: 200, nullable: true })
    location: string | null;

    /** SHA-256 of the device API key. The key itself is shown once, at creation. */
    @Column({ name: 'api_key_hash', type: 'varchar', length: 64 })
    @Exclude()
    apiKeyHash: string;

    @Column({ name: 'is_active', default: true })
    isActive: boolean;

    @Column({ name: 'firmware_version', type: 'varchar', length: 32, nullable: true })
    firmwareVersion: string | null;

    @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
    ipAddress: string | null;

    @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
    lastSeenAt: Date | null;

    @Column({ name: 'last_scan_at', type: 'timestamptz', nullable: true })
    lastScanAt: Date | null;

    @Column({ name: 'created_by', type: 'uuid', nullable: true })
    createdBy: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}

export type RfidCardStatus = 'active' | 'replaced' | 'removed';

/** An RFID card assignment. Rows are never deleted — a card is revoked. */
@Entity('rfid_cards')
export class RfidCard {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    /** Card UID as upper-case hex, no separators. */
    @Column({ type: 'varchar', length: 32 })
    uid: string;

    @Column({ type: 'text', default: 'active' })
    status: RfidCardStatus;

    @Column({ name: 'assigned_by', type: 'uuid', nullable: true })
    assignedBy: string | null;

    @Column({ name: 'assigned_at', type: 'timestamptz', default: () => 'now()' })
    assignedAt: Date;

    @Column({ name: 'registered_device_id', type: 'uuid', nullable: true })
    registeredDeviceId: string | null;

    @Column({ name: 'revoked_by', type: 'uuid', nullable: true })
    revokedBy: string | null;

    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    revokedAt: Date | null;

    @Column({ name: 'revoke_reason', type: 'text', nullable: true })
    revokeReason: string | null;
}

export type RegistrationStatus = 'waiting' | 'success' | 'failed' | 'expired' | 'cancelled';

/**
 * "The next card presented to reader X belongs to employee Y."
 * Opened by an administrator, bound to one employee and one reader, and
 * short-lived. A card is only ever assigned through one of these.
 */
@Entity('rfid_registration_sessions')
export class RfidRegistrationSession {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id', type: 'uuid' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ name: 'device_id', type: 'uuid' })
    deviceId: string;

    @ManyToOne(() => RfidDevice, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'device_id' })
    device: RfidDevice;

    @Column({ name: 'initiated_by', type: 'uuid', nullable: true })
    initiatedBy: string | null;

    @Column({ type: 'text', default: 'register' })
    mode: 'register' | 'replace';

    @Column({ type: 'text', default: 'waiting' })
    status: RegistrationStatus;

    @Column({ name: 'card_uid', type: 'varchar', length: 32, nullable: true })
    cardUid: string | null;

    @Column({ name: 'card_id', type: 'uuid', nullable: true })
    cardId: string | null;

    @Column({ name: 'failure_reason', type: 'text', nullable: true })
    failureReason: string | null;

    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt: Date;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
    completedAt: Date | null;
}

/** One row per reader request: the request log and the idempotency store. */
@Entity('rfid_event_log')
export class RfidEventLog {
    @PrimaryGeneratedColumn('increment', { type: 'bigint' })
    id: string;

    @Column({ name: 'event_id', type: 'uuid', nullable: true })
    eventId: string | null;

    @Column({ name: 'device_id', type: 'uuid', nullable: true })
    deviceId: string | null;

    @Column({ name: 'device_code', type: 'varchar', length: 64, nullable: true })
    deviceCode: string | null;

    @Column({ type: 'text' })
    kind: string;

    @Column({ type: 'varchar', length: 32, nullable: true })
    uid: string | null;

    @Column({ name: 'user_id', type: 'uuid', nullable: true })
    userId: string | null;

    @Column({ type: 'text' })
    result: string;

    @Column({ type: 'text', nullable: true })
    detail: string | null;

    @Column({ type: 'jsonb', nullable: true })
    response: any;

    @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
    ipAddress: string | null;

    @Column({ name: 'device_time', type: 'timestamptz', nullable: true })
    deviceTime: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
