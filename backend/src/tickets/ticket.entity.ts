import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export type TicketType   = 'bug' | 'access_request';
export type TicketStatus = 'pending' | 'approved' | 'rejected';

@Entity('tickets')
export class Ticket {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'submitter_id' })
    submitterId: string;

    @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'submitter_id' })
    submitter: User;

    @Column({ type: 'text' })
    type: TicketType;

    @Column({ type: 'text' })
    title: string;

    @Column({ type: 'text' })
    description: string;

    @Column({ name: 'screenshot_url', type: 'text', nullable: true })
    screenshotUrl: string | null;

    @Column({ type: 'text', default: 'pending' })
    status: TicketStatus;

    @Column({ name: 'resolution_note', type: 'text', nullable: true })
    resolutionNote: string | null;

    @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
    resolvedBy: string | null;

    @ManyToOne(() => User, { eager: false, nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'resolved_by' })
    resolver: User | null;

    @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
    resolvedAt: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
