import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Project } from './project.entity';

@Entity('sub_projects')
export class SubProject {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ name: 'project_id' }) projectId: string;
    @ManyToOne(() => Project, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'project_id' }) project: Project;
    @Column() name: string;
    @Column({ nullable: true }) description: string;
    @Column({ nullable: false, default: 'Active' }) status: string;
    @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
