import {
    Entity, PrimaryGeneratedColumn, Column,
    ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { Project } from '../../projects/project.entity';
import { PlaylistMedia } from './playlist-media.entity';

@Entity('video_playlists')
export class VideoPlaylist {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ length: 255 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'sort_order', type: 'int', default: 0 })
    sortOrder: number;

    @Column({ name: 'created_by', nullable: true })
    createdBy: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'created_by' })
    creator: User | null;

    @OneToMany(() => PlaylistMedia, (m) => m.playlist)
    media: PlaylistMedia[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
