import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VideoPlaylist } from './entities/video-playlist.entity';
import { PlaylistMedia } from './entities/playlist-media.entity';
import { User } from '../users/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { effectivePermissions } from '../roles/role.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class VideoTutorialsService {
    constructor(
        @InjectRepository(VideoPlaylist)
        private readonly playlistRepo: Repository<VideoPlaylist>,
        @InjectRepository(PlaylistMedia)
        private readonly mediaRepo: Repository<PlaylistMedia>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        private readonly notificationsService: NotificationsService,
        private readonly realtimeGateway: RealtimeGateway,
    ) {}

    private get storagePath(): string {
        return process.env.VIDEO_TUTORIALS_PATH ?? path.join(process.cwd(), 'video_tutorials');
    }

    // ── Playlist operations ──────────────────────────────────────────

    async findPlaylistsByProject(projectId: string): Promise<VideoPlaylist[]> {
        return this.playlistRepo.createQueryBuilder('p')
            .leftJoinAndSelect('p.creator', 'creator')
            .loadRelationCountAndMap('p.mediaCount', 'p.media', 'media', (qb) =>
                qb.andWhere('media.status = :s', { s: 'approved' }),
            )
            .where('p.project_id = :projectId', { projectId })
            .orderBy('p.sort_order', 'ASC')
            .addOrderBy('p.created_at', 'ASC')
            .getMany();
    }

    async findPlaylistById(id: string): Promise<VideoPlaylist> {
        const pl = await this.playlistRepo.findOne({
            where: { id },
            relations: ['creator', 'project'],
        });
        if (!pl) throw new NotFoundException('Playlist not found');
        return pl;
    }

    async createPlaylist(data: {
        projectId: string;
        title: string;
        description?: string;
        sortOrder?: number;
        createdBy: string;
    }): Promise<VideoPlaylist> {
        if (data.sortOrder === undefined) {
            const max = await this.playlistRepo.createQueryBuilder('p')
                .select('MAX(p.sort_order)', 'max')
                .where('p.project_id = :projectId', { projectId: data.projectId })
                .getRawOne();
            data.sortOrder = (max?.max ?? -1) + 1;
        }
        const entity = this.playlistRepo.create({
            projectId: data.projectId,
            title: data.title,
            description: data.description ?? null,
            sortOrder: data.sortOrder,
            createdBy: data.createdBy,
        });
        return this.playlistRepo.save(entity);
    }

    async updatePlaylist(id: string, data: {
        title?: string;
        description?: string;
        sortOrder?: number;
    }): Promise<VideoPlaylist> {
        const pl = await this.findPlaylistById(id);
        if (data.title !== undefined) pl.title = data.title;
        if (data.description !== undefined) pl.description = data.description;
        if (data.sortOrder !== undefined) pl.sortOrder = data.sortOrder;
        return this.playlistRepo.save(pl);
    }

    async deletePlaylist(id: string): Promise<void> {
        const pl = await this.findPlaylistById(id);
        // Remove media files from disk
        const mediaItems = await this.mediaRepo.find({ where: { playlistId: id } });
        for (const m of mediaItems) {
            if (m.filename) {
                this.removeFileFromDisk(m.projectId, m.playlistId, m.filename);
            }
        }
        // Remove playlist directory
        const dir = path.join(this.storagePath, pl.projectId, id);
        try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        await this.playlistRepo.delete(id);
    }

    async reorderPlaylists(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
        await Promise.all(
            items.map((item) =>
                this.playlistRepo.update(item.id, { sortOrder: item.sortOrder }),
            ),
        );
    }

    // ── Media operations ─────────────────────────────────────────────

    async findMediaByPlaylist(playlistId: string, includeAll = false): Promise<PlaylistMedia[]> {
        const qb = this.mediaRepo.createQueryBuilder('m')
            .leftJoinAndSelect('m.uploader', 'uploader')
            .where('m.playlist_id = :playlistId', { playlistId });
        if (!includeAll) {
            qb.andWhere('m.status = :status', { status: 'approved' });
        }
        return qb.orderBy('m.sort_order', 'ASC').addOrderBy('m.created_at', 'ASC').getMany();
    }

    async findMediaById(id: string): Promise<PlaylistMedia> {
        const media = await this.mediaRepo.findOne({
            where: { id },
            relations: ['playlist', 'playlist.project', 'uploader'],
        });
        if (!media) throw new NotFoundException('Media item not found');
        return media;
    }

    async findPendingMedia(): Promise<PlaylistMedia[]> {
        return this.mediaRepo.createQueryBuilder('m')
            .leftJoinAndSelect('m.uploader', 'uploader')
            .leftJoinAndSelect('m.playlist', 'playlist')
            .leftJoinAndSelect('playlist.project', 'project')
            .where('m.status = :status', { status: 'pending' })
            .orderBy('m.created_at', 'ASC')
            .getMany();
    }

    async findMyPendingMedia(uploaderId: string): Promise<PlaylistMedia[]> {
        return this.mediaRepo.createQueryBuilder('m')
            .leftJoinAndSelect('m.playlist', 'playlist')
            .leftJoinAndSelect('playlist.project', 'project')
            .where('m.uploader_id = :uploaderId', { uploaderId })
            .andWhere('m.status = :status', { status: 'pending' })
            .orderBy('m.created_at', 'DESC')
            .getMany();
    }

    async createMedia(data: {
        playlistId: string;
        projectId: string;
        uploaderId: string;
        filename?: string | null;
        originalName?: string | null;
        fileSize?: number;
        mimeType?: string | null;
        mediaType: 'video' | 'pdf' | 'youtube';
        title: string;
        description?: string;
        status: string;
        externalUrl?: string | null;
    }): Promise<PlaylistMedia> {
        // Auto-increment sort_order within the playlist
        const max = await this.mediaRepo.createQueryBuilder('m')
            .select('MAX(m.sort_order)', 'max')
            .where('m.playlist_id = :playlistId', { playlistId: data.playlistId })
            .getRawOne();
        const sortOrder = (max?.max ?? -1) + 1;

        const entity = this.mediaRepo.create({
            playlistId: data.playlistId,
            projectId: data.projectId,
            uploaderId: data.uploaderId,
            filename: data.filename ?? null,
            originalName: data.originalName ?? null,
            fileSize: data.fileSize ?? 0,
            mimeType: data.mimeType ?? null,
            mediaType: data.mediaType,
            status: data.status as any,
            title: data.title,
            description: data.description ?? null,
            sortOrder,
            externalUrl: data.externalUrl ?? null,
        });
        return this.mediaRepo.save(entity);
    }

    async updateMedia(id: string, data: {
        title?: string;
        description?: string;
        sortOrder?: number;
    }, resetApproval: boolean): Promise<PlaylistMedia> {
        const media = await this.findMediaById(id);
        if (data.title !== undefined) media.title = data.title;
        if (data.description !== undefined) media.description = data.description;
        if (data.sortOrder !== undefined) media.sortOrder = data.sortOrder;
        // If the item was approved and we're editing content fields, re-enter approval
        if (resetApproval && media.status === 'approved' &&
            (data.title !== undefined || data.description !== undefined)) {
            media.status = 'pending';
        }
        return this.mediaRepo.save(media);
    }

    async approveMedia(id: string): Promise<PlaylistMedia> {
        const media = await this.findMediaById(id);
        media.status = 'approved';
        const saved = await this.mediaRepo.save(media);
        // Clear all pending notifications for this media across all reviewers
        await this.notificationsService.markReadByEntityId(id, 'video_pending');
        this.realtimeGateway.broadcastDashboardRefresh();
        return saved;
    }

    async rejectMedia(id: string): Promise<void> {
        const media = await this.findMediaById(id);
        if (media.filename) {
            this.removeFileFromDisk(media.projectId, media.playlistId, media.filename);
        }
        await this.mediaRepo.delete(id);
    }

    async deleteMedia(id: string): Promise<void> {
        const media = await this.findMediaById(id);
        if (media.filename) {
            this.removeFileFromDisk(media.projectId, media.playlistId, media.filename);
        }
        await this.mediaRepo.delete(id);
    }

    async reorderMedia(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
        await Promise.all(
            items.map((item) =>
                this.mediaRepo.update(item.id, { sortOrder: item.sortOrder }),
            ),
        );
    }

    getMediaFilePath(media: PlaylistMedia): string {
        return path.join(this.storagePath, media.projectId, media.playlistId, media.filename ?? '');
    }

    /** Return ids of all active users who can approve video content (manage_projects). */
    async findManagerIds(): Promise<string[]> {
        const users = await this.userRepo.find({
            where: { isActive: true },
            select: ['id', 'permissions'],
        });
        return users
            .filter((u) => effectivePermissions(u.permissions).manage_projects)
            .map((u) => u.id);
    }

    private removeFileFromDisk(projectId: string, playlistId: string, filename: string): void {
        const filePath = path.join(this.storagePath, projectId, playlistId, filename);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch { /* ignore */ }
    }
}
