import { Controller, Get, Patch, Delete, Param, UseGuards, Request } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
    constructor(private readonly notificationsService: NotificationsService) {}

    /** GET /notifications — all notifications for the current user */
    @Get()
    findAll(@Request() req) {
        return this.notificationsService.findAll(req.user.id);
    }

    /** GET /notifications/unread-count */
    @Get('unread-count')
    async unreadCount(@Request() req) {
        const count = await this.notificationsService.countUnread(req.user.id);
        return { count };
    }

    /** PATCH /notifications/read-all */
    @Patch('read-all')
    async markAllRead(@Request() req) {
        await this.notificationsService.markAllRead(req.user.id);
        return { ok: true };
    }

    /** PATCH /notifications/:id/read */
    @Patch(':id/read')
    async markRead(@Param('id') id: string, @Request() req) {
        await this.notificationsService.markRead(id, req.user.id);
        return { ok: true };
    }

    /** PATCH /notifications/:id/unread — toggle back to unread */
    @Patch(':id/unread')
    async markUnread(@Param('id') id: string, @Request() req) {
        await this.notificationsService.markUnread(id, req.user.id);
        return { ok: true };
    }

    /** DELETE /notifications/read — bulk-delete all read notifications */
    @Delete('read')
    async deleteAllRead(@Request() req) {
        await this.notificationsService.deleteAllRead(req.user.id);
        return { ok: true };
    }

    /** DELETE /notifications/:id — delete a single notification */
    @Delete(':id')
    async deleteOne(@Param('id') id: string, @Request() req) {
        await this.notificationsService.deleteById(id, req.user.id);
        return { ok: true };
    }
}
