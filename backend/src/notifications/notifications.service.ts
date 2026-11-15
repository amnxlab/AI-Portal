import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class NotificationsService {
    constructor(
        @InjectRepository(Notification)
        private readonly notifRepo: Repository<Notification>,
        private readonly realtimeGateway: RealtimeGateway,
    ) {}

    /** Create and persist a notification for a user. */
    async create(
        userId: string,
        type: string,
        title: string,
        message?: string,
        entityId?: string,
        requestorId?: string,
        entityType?: string,
        /**
         * Anything the recipient's click needs that the columns above cannot
         * hold -- `{ commentId }` for a mention, so the page can scroll to it.
         * Optional, so every existing caller is unaffected.
         */
        context?: Record<string, unknown> | null,
    ): Promise<Notification> {
        const notif = this.notifRepo.create({
            userId,
            type,
            title,
            message: message ?? null,
            entityId: entityId ?? null,
            requestorId: requestorId ?? null,
            entityType: entityType ?? null,
            context: context ?? null,
        });
        const saved = await this.notifRepo.save(notif);
        // Push to the recipient's browser in real time via WebSocket
        this.realtimeGateway.broadcastNotification(userId, saved);
        return saved;
    }

    /** Find a single notification by ID. */
    findById(id: string): Promise<Notification | null> {
        return this.notifRepo.findOne({ where: { id } });
    }

    /** Return all notifications for a user, newest first. */
    findAll(userId: string): Promise<Notification[]> {
        return this.notifRepo.find({
            where: { userId },
            order: { createdAt: 'DESC' },
            take: 50,
        });
    }

    /** Count unread notifications for a user. */
    async countUnread(userId: string): Promise<number> {
        return this.notifRepo.count({ where: { userId, isRead: false } });
    }

    /** Mark a single notification as read. */
    async markRead(id: string, userId: string): Promise<void> {
        await this.notifRepo.update({ id, userId }, { isRead: true });
    }

    /** Mark all notifications for a user as read.
     *  Excludes unhandled paper_read_request items so their action buttons stay visible. */
    async markAllRead(userId: string): Promise<void> {
        await this.notifRepo
            .createQueryBuilder()
            .update()
            .set({ isRead: true })
            .where('user_id = :userId', { userId })
            .andWhere('is_read = false')
            .andWhere('type != :type', { type: 'paper_read_request' })
            .execute();
    }

    /**
     * Mark all notifications of a given type for a specific entity as read,
     * across ALL users. Used when a reviewer approves/rejects a shared item so
     * other reviewers' dashboards are also cleared immediately.
     */
    async markReadByEntityId(entityId: string, type: string): Promise<void> {
        await this.notifRepo
            .createQueryBuilder()
            .update()
            .set({ isRead: true })
            .where('entity_id = :entityId', { entityId })
            .andWhere('type = :type', { type })
            .andWhere('is_read = false')
            .execute();
    }

    /** Mark a single notification as unread (toggle). */
    async markUnread(id: string, userId: string): Promise<void> {
        await this.notifRepo.update({ id, userId }, { isRead: false });
    }

    /** Hard-delete a single notification owned by the given user. */
    async deleteById(id: string, userId: string): Promise<void> {
        await this.notifRepo.delete({ id, userId });
    }

    /** Hard-delete all already-read notifications for a user. */
    async deleteAllRead(userId: string): Promise<void> {
        await this.notifRepo
            .createQueryBuilder()
            .delete()
            .where('user_id = :userId', { userId })
            .andWhere('is_read = true')
            .execute();
    }
}
