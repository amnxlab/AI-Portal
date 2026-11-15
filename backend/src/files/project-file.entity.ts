import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { FileFolder } from './file-folder.entity';

@Entity('project_files')
export class ProjectFile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ name: 'uploader_id', nullable: true })
    uploaderId: string;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'uploader_id' })
    uploader: User;

    @Column()
    filename: string;

    @Column({ name: 'original_name' })
    originalName: string;

    @Column({ name: 'file_size', type: 'bigint', default: 0 })
    fileSize: number;

    @Column({ name: 'mime_type', nullable: true })
    mimeType: string;

    @Column({ default: 'document' })
    type: string;

    @Column({ nullable: true })
    category: string;

    @Column({ nullable: true })
    title: string;

    @Column({ nullable: true })
    description: string;

    @Column({ default: 1 })
    version: number;

    @Column({ default: 'pending' })
    status: string;

    @Column({ name: 'folder_id', nullable: true })
    folderId: string | null;

    @ManyToOne(() => FileFolder, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'folder_id' })
    folder: FileFolder | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
