import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

@Entity('wishlist_items')
export class WishlistItem {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ name: 'project_id', nullable: true }) projectId: string;
    @ManyToOne(() => Project, { nullable: true, onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project: Project;
    @Column({ name: 'sub_project_id', nullable: true }) subProjectId: string;
    @Column({ name: 'item_name' }) itemName: string;
    @Column({ nullable: true }) description: string;
    @Column({ type: 'numeric', precision: 10, scale: 2, default: 0 }) cost: number;
    @Column({ nullable: true }) link: string;
    @Column({ default: 'Requested' }) status: string;
    @Column({ name: 'requested_by', nullable: true }) requestedBy: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'requested_by' }) requester: User;
    @Column({ name: 'approved_by', nullable: true }) approvedBy: string;
    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' }) @JoinColumn({ name: 'approved_by' }) approver: User;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
    @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
