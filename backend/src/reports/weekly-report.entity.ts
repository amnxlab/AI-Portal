import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('weekly_reports')
export class WeeklyReport {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ name: 'user_id' }) userId: string;
    @ManyToOne(() => User, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'user_id' }) user: User;
    @Column({ type: 'date', name: 'week_start' }) weekStart: string;
    @Column({ name: 'tasks_hours', type: 'jsonb', default: [] }) tasksHours: Array<{
        taskId?: string;
        taskTitle: string;
        status: string;
        progressNotes: string;
        remainingNotes?: string;
        hours: number;
        isRemote: boolean;
    }>;
    @Column({ name: 'total_hours', type: 'numeric', default: 0 }) totalHours: number;
    @Column({ name: 'remote_hours', type: 'numeric', default: 0 }) remoteHours: number;
    @Column({ type: 'text', nullable: true }) notes: string | null;
    /** Draft → Submitted → Approved | Needs Revision */
    @Column({ default: 'Draft' }) status: string;
    @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true }) submittedAt: Date;
    /** Supervisor feedback when status is Approved or Needs Revision */
    @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote: string | null;
    @Column({ name: 'reviewed_by', type: 'uuid', nullable: true }) reviewedBy: string | null;
    @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
    /** Private manager comment – visible only to reviewers, never shown to employees */
    @Column({ name: 'manager_comment', type: 'text', nullable: true }) managerComment: string | null;
    /**
     * Snapshot of the user's weeklyHoursCap at the time of submission.
     * Once set it is never overwritten so approved reports remain unaffected
     * by later cap policy changes.
     */
    @Column({ name: 'weekly_hours_cap_snapshot', type: 'numeric', precision: 5, scale: 1, nullable: true }) weeklyHoursCapSnapshot: number | null;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
