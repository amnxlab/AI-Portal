import {
    Entity, PrimaryGeneratedColumn, Column,
    ManyToOne, OneToMany, JoinColumn, CreateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';

@Entity('file_folders')
export class FileFolder {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ name: 'parent_id', nullable: true })
    parentId: string | null;

    @ManyToOne(() => FileFolder, (f) => f.children, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'parent_id' })
    parent: FileFolder | null;

    @OneToMany(() => FileFolder, (f) => f.parent)
    children: FileFolder[];

    @Column({ length: 20 })
    type: 'manual' | 'paper' | 'document';

    @Column({ length: 255 })
    name: string;

    @Column({ name: 'created_by', nullable: true })
    createdBy: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    createdByUser: User | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
