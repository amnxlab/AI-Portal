import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('projects')
export class Project {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column() name: string;
    @Column({ nullable: true }) description: string;
    @Column({ default: 'Active' }) status: string;
    @Column({ type: 'date', name: 'start_date', nullable: true }) startDate: string;
    @Column({ type: 'date', name: 'end_date', nullable: true }) endDate: string;
    /**
     * Allocated budget for the project.
     *
     * The column has always been here and the project form has always offered
     * the field, but it was missing from the entity and the DTOs — so the
     * global ValidationPipe (whitelist: true) stripped it from every request
     * and the save reported success while discarding the number.
     */
    @Column({ type: 'numeric', nullable: true }) budget: number | null;

    @Column({ nullable: true, name: 'cover_image' }) coverImage: string;
    /**
     * When the project was archived, or null while it is on the active list.
     *
     * Separate from `status` on purpose: status is what became of the work,
     * archiving is whether it is still in front of you. Archiving changes
     * nothing else about the project — every task, expense, allocation,
     * member and comment stays attached exactly as it was.
     */
    @Column({ name: 'archived_at', type: 'timestamptz', nullable: true }) archivedAt: Date | null;

    @Column({ name: 'archived_by_id', type: 'uuid', nullable: true }) archivedById: string | null;

    @Column({ name: 'owner_id', nullable: true }) ownerId: string;
    @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'owner_id' }) owner: User;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
