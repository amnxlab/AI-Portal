import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany,
    JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { PaperFile } from './paper-file.entity';
import { FileFolder } from '../files/file-folder.entity';

@Entity('papers')
export class Paper {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ length: 500 })
    title: string;

    @Column({ type: 'text', nullable: true })
    authors: string;

    @Column({ type: 'int', nullable: true })
    year: number;

    @Column({ length: 255, nullable: true })
    venue: string;

    @Column({ length: 255, nullable: true })
    doi: string;

    @Column({ type: 'text', nullable: true })
    url: string;

    @Column({ type: 'text', nullable: true })
    abstract: string;

    @Column({ type: 'text', nullable: true })
    notes: string;

    @Column({ type: 'jsonb', default: [] })
    tags: string[];

    @Column({ name: 'added_by', nullable: true })
    addedBy: string;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'added_by' })
    addedByUser: User;

    @OneToMany(() => PaperFile, pf => pf.paper)
    files: PaperFile[];

    @Column({ name: 'folder_id', nullable: true })
    folderId: string | null;

    @ManyToOne(() => FileFolder, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'folder_id' })
    folder: FileFolder | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
