import {
    Entity, PrimaryGeneratedColumn, Column, ManyToOne,
    JoinColumn, CreateDateColumn,
} from 'typeorm';
import { Paper } from './paper.entity';
import { ProjectFile } from '../files/project-file.entity';

@Entity('paper_files')
export class PaperFile {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'paper_id' })
    paperId: string;

    @ManyToOne(() => Paper, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'paper_id' })
    paper: Paper;

    @Column({ name: 'file_id', nullable: true })
    fileId: string;

    @ManyToOne(() => ProjectFile, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'file_id' })
    file: ProjectFile;

    @Column({ name: 'file_type', length: 30, default: 'pdf' })
    fileType: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
