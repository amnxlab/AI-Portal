import {
    Entity, PrimaryGeneratedColumn, Column,
    ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/user.entity';
import { Project } from '../../projects/project.entity';
import { VideoPlaylist } from './video-playlist.entity';

@Entity('playlist_media')
export class PlaylistMedia {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'playlist_id' })
    playlistId: string;

    @ManyToOne(() => VideoPlaylist, (p) => p.media, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'playlist_id' })
    playlist: VideoPlaylist;

    @Column({ name: 'project_id' })
    projectId: string;

    @ManyToOne(() => Project, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'project_id' })
    project: Project;

    @Column({ name: 'uploader_id', nullable: true })
    uploaderId: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'uploader_id' })
    uploader: User | null;

    @Column({ type: 'text', nullable: true })
    filename: string | null;

    @Column({ name: 'original_name', type: 'text', nullable: true })
    originalName: string | null;

    @Column({ name: 'file_size', type: 'bigint', default: 0 })
    fileSize: number;

    @Column({ name: 'mime_type', type: 'text', nullable: true })
    mimeType: string | null;

    @Column({ name: 'media_type', length: 20 })
    mediaType: 'video' | 'pdf' | 'youtube';

    /** Set for YouTube / external embeds; null for file uploads. */
    @Column({ name: 'external_url', type: 'text', nullable: true })
    externalUrl: string | null;

    @Column({ length: 20, default: 'pending' })
    status: 'pending' | 'approved' | 'rejected';

    @Column({ length: 255 })
    title: string;

    @Column({ type: 'text', nullable: true })
    description: string | null;

    @Column({ name: 'sort_order', type: 'int', default: 0 })
    sortOrder: number;

    @Column({ name: 'duration_seconds', type: 'int', nullable: true })
    durationSeconds: number | null;

    @Column({ name: 'thumbnail_filename', type: 'text', nullable: true })
    thumbnailFilename: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
