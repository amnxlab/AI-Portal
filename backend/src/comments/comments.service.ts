import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Comment } from './comment.entity';
import { User } from '../users/user.entity';
import { PlaylistMedia } from '../video-tutorials/entities/playlist-media.entity';
import { CreateCommentDto } from './dto/create-comment.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';
import { effectivePermissions } from '../roles/role.entity';

@Injectable()
export class CommentsService {
    constructor(
        @InjectRepository(Comment)       private readonly commentRepo: Repository<Comment>,
        @InjectRepository(User)          private readonly userRepo: Repository<User>,
        @InjectRepository(PlaylistMedia) private readonly mediaRepo: Repository<PlaylistMedia>,
        private readonly notificationsService: NotificationsService,
        private readonly realtimeGateway: RealtimeGateway,
        private readonly auditService: AuditService,
    ) {}

    /** Fetch all comments for a given entity, ordered oldest-first. */
    async findAll(entityType: string, entityId: string): Promise<Comment[]> {
        return this.commentRepo.find({
            where: { entityType, entityId },
            order: { createdAt: 'ASC' },
        });
    }

    async create(dto: CreateCommentDto, actor: { id: string; username: string; role: string }): Promise<Comment> {
        const mentions = Array.from(new Set(dto.mentions ?? []));

        const comment = this.commentRepo.create({
            entityType: dto.entityType,
            entityId:   dto.entityId,
            authorId:   actor.id,
            content:    dto.content,
            parentId:   dto.parentId ?? null,
            mentions,
        });
        const raw = await this.commentRepo.save(comment);
        // Reload so eager relations (author) are populated before broadcasting/returning
        const saved = (await this.commentRepo.findOne({ where: { id: raw.id } })) ?? raw;

        // Fetch author full name for readable notification messages
        const authorUser = await this.userRepo.findOne({ where: { id: actor.id } });
        const authorName = authorUser?.fullName ?? actor.username;

        // For video_media entities, include the video title in the notification message
        let contextLabel = '';
        if (dto.entityType === 'video_media') {
            const media = await this.mediaRepo.findOne({ where: { id: dto.entityId }, select: ['title'] });
            if (media?.title) contextLabel = ` in "${media.title}"`;
        }

        // Notify each @mentioned user (skip self-mentions)
        for (const userId of mentions) {
            if (userId !== actor.id) {
                await this.notificationsService.create(
                    userId,
                    'comment_mention',
                    `${authorName} mentioned you${contextLabel}`,
                    dto.content.length > 120 ? dto.content.slice(0, 117) + '…' : dto.content,
                    dto.entityId,
                    undefined,       // requestorId
                    dto.entityType,  // entityType — enables click-to-navigate in the frontend
                    // The comment itself, so the notification can open the
                    // thread at the right line instead of the top of the page.
                    { commentId: saved.id, parentId: saved.parentId ?? null },
                );
            }
        }

        // Broadcast real-time event so open clients update instantly
        this.realtimeGateway.broadcastComment(saved);

        await this.auditService.log({
            actorId:    actor.id,
            entityType: 'comment',
            entityId:   saved.id,
            action:     'create',
            newValue:   { entityType: dto.entityType, entityId: dto.entityId },
        });

        return saved;
    }

    /** Delete a comment. Only the author or a user with moderation rights
     *  (manage_users permission) may do so. */
    async remove(id: string, actor: { id: string; permissions?: any }): Promise<void> {
        const comment = await this.commentRepo.findOne({ where: { id } });
        if (!comment) throw new NotFoundException(`Comment ${id} not found`);

        if (comment.authorId !== actor.id && !effectivePermissions(actor.permissions).manage_users) {
            throw new ForbiddenException('You can only delete your own comments');
        }

        await this.commentRepo.remove(comment);

        await this.auditService.log({
            actorId:    actor.id,
            entityType: 'comment',
            entityId:   id,
            action:     'delete',
        });
    }
}
