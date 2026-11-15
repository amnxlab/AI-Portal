import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('schedules')
export class Schedule {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'user_id' })
    userId: string;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @Column({ type: 'date', name: 'week_start' })
    weekStart: string;

    @Column({ type: 'jsonb', default: [] })
    /**
     * The person's working windows for the week.
     *
     * `source` records where an entry came from. Entries a person wrote
     * themselves have no source; entries an administrator put there by
     * assigning a shift carry 'shift' and the shift's id, so they can be
     * withdrawn again without touching anything the person wrote.
     */
    shifts: Array<{
        day: string;
        start: string;
        end: string;
        note?: string;
        source?: 'shift';
        shiftId?: string;
    }>;

    @Column({ type: 'text', nullable: true })
    notes: string | null;

    @Column({ name: 'submitted_at', type: 'timestamptz', default: () => 'NOW()' })
    submittedAt: Date;

    @Column({ name: 'discord_posted', default: false })
    discordPosted: boolean;

    @Column({ type: 'text', default: 'Submitted' })
    status: string;

    @Column({ name: 'review_note', type: 'text', nullable: true })
    reviewNote: string | null;

    @Column({ name: 'reviewed_by', nullable: true })
    reviewedBy: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'reviewed_by' })
    reviewer: User | null;

    @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
    reviewedAt: Date | null;
}
