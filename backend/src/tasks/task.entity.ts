import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { SubProject } from '../projects/sub-project.entity';

@Entity('tasks')
export class Task {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ name: 'project_id' }) projectId: string;
    @ManyToOne(() => Project, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project: Project;
    @Column({ name: 'sub_project_id', nullable: true }) subProjectId: string;
    @ManyToOne(() => SubProject, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'sub_project_id' }) subProject: SubProject;
    @Column({ name: 'assignee_id', nullable: true }) assigneeId: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'assignee_id' }) assignee: User;
    @Column({ name: 'created_by', nullable: true }) createdBy: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'created_by' }) creator: User;
    @Column() title: string;
    @Column({ nullable: true }) description: string;
    @Column({ default: 'Todo' }) status: string;
    @Column({ default: 'Medium' }) priority: string;
    @Column({ type: 'date', nullable: true }) deadline: string;
    @Column({ name: 'start_date', type: 'date', nullable: true }) startDate: string | null;
    @Column({ name: 'estimated_hours', type: 'numeric', nullable: true }) estimatedHours: number;
    @Column({ name: 'actual_hours', type: 'numeric', nullable: true }) actualHours: number;
    @Column({ default: 0 }) position: number;
    @Column({ type: 'jsonb', default: [] }) attachments: any[];
    @Column({ name: 'discord_notified', default: false }) discordNotified: boolean;
    @Column({ name: 'paper_id', type: 'uuid', nullable: true }) paperId: string | null;
    @Column({ name: 'started_at', type: 'timestamptz', nullable: true }) startedAt: Date | null;
    @Column({ name: 'completed_at', type: 'timestamptz', nullable: true }) completedAt: Date | null;
    @Column({ name: 'paused_at', type: 'timestamptz', nullable: true }) pausedAt: Date | null;
    @Column({ name: 'total_paused_ms', type: 'bigint', default: 0 }) totalPausedMs: number;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
