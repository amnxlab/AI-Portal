import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('notifications')
export class Notification {
    @PrimaryGeneratedColumn('uuid') id: string;

    @Column({ name: 'user_id' }) userId: string;
    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' }) user: User;

    /** e.g. report_approved | report_needs_revision */
    @Column({ length: 60 }) type: string;

    @Column({ length: 200 }) title: string;
    @Column({ type: 'text', nullable: true }) message: string | null;

/** ID of the related entity (e.g. report id, paper id) */
    @Column({ name: 'entity_id', type: 'uuid', nullable: true }) entityId: string | null;

    /** For request-type notifications: the user who made the request (so we can notify them back) */
    @Column({ name: 'requestor_id', type: 'uuid', nullable: true }) requestorId: string | null;

    /** Entity type for routing on click (e.g. 'task' | 'ticket' | 'project' | 'paper') */
    @Column({ name: 'entity_type', type: 'varchar', length: 50, nullable: true }) entityType: string | null;

    @Column({ name: 'is_read', default: false }) isRead: boolean;

    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
