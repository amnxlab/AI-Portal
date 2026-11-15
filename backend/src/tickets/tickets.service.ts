import {
    Injectable, NotFoundException, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository }       from 'typeorm';
import { Ticket, TicketType } from './ticket.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscordService }       from '../discord/discord.service';
import { UsersService }         from '../users/users.service';
import { effectivePermissions } from '../roles/role.entity';
import * as path from 'path';
import * as fs   from 'fs';

const UPLOAD_DIR = path.join(
    process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents'),
    'tickets',
);

@Injectable()
export class TicketsService {
    constructor(
        @InjectRepository(Ticket)
        private readonly repo: Repository<Ticket>,
        private readonly notificationsService: NotificationsService,
        private readonly discordService: DiscordService,
        private readonly usersService: UsersService,
    ) {}

    async create(
        submitterId: string,
        body: { type: TicketType; title: string; description: string },
        screenshotFilename?: string,
    ): Promise<Ticket> {
        const ticket = this.repo.create({
            submitterId,
            type:          body.type,
            title:         body.title,
            description:   body.description,
            screenshotUrl: screenshotFilename ?? null,
            status:        'pending',
        });
        const saved = await this.repo.save(ticket);

        // Notify everyone with ticket-moderation rights (manage_users permission)
        try {
            const allUsers = await this.usersService.findAll();
            const managers = allUsers.filter(u =>
                effectivePermissions(u.permissions).manage_users && u.isActive && u.id !== submitterId);
            const typeLabel = body.type === 'bug' ? 'Bug Report' : 'Access Request';
            await Promise.all(managers.map(manager =>
                this.notificationsService.create(
                    manager.id,
                    'ticket_submitted',
                    `New ${typeLabel}: ${body.title}`,
                    `A ${typeLabel.toLowerCase()} was submitted. Go to Support Tickets to review it.`,
                    saved.id,
                ),
            ));
            // Discord notification — non-critical
            const submitterName = allUsers.find(u => u.id === submitterId)?.fullName ?? 'A team member';
            this.discordService.postTicketSubmitted(submitterName, body.type, body.title, saved.id).catch(() => {});
        } catch { /* non-fatal */ }

        return saved;
    }

    /** All tickets for the submitting user */
    findMine(submitterId: string): Promise<Ticket[]> {
        return this.repo.find({
            where:     { submitterId },
            relations: ['resolver'],
            order:     { createdAt: 'DESC' },
        });
    }

    /** All tickets — user administrators only */
    findAll(): Promise<Ticket[]> {
        return this.repo.find({
            relations: ['resolver'],
            order:     { createdAt: 'DESC' },
        });
    }

    /** Pending tickets — user administrators only */
    findPending(): Promise<Ticket[]> {
        return this.repo.find({
            where:     { status: 'pending' },
            relations: ['resolver'],
            order:     { createdAt: 'ASC' },
        });
    }

    async resolve(
        id: string,
        actorId: string,
        actorPermissions: any,
        dto: { status: 'approved' | 'rejected'; resolutionNote?: string },
    ): Promise<Ticket> {
        const ticket = await this.repo.findOne({ where: { id } });
        if (!ticket) throw new NotFoundException('Ticket not found');
        // Only users with the manage_users permission can resolve tickets (including their own).
        if (!effectivePermissions(actorPermissions).manage_users) {
            throw new ForbiddenException('Only user administrators can resolve tickets');
        }
        if (ticket.status !== 'pending') {
            throw new BadRequestException('Ticket is already resolved');
        }
        ticket.status         = dto.status;
        ticket.resolutionNote = dto.resolutionNote ?? null;
        ticket.resolvedBy     = actorId;
        ticket.resolvedAt     = new Date();
        await this.repo.save(ticket);
        const resolved = await this.repo.findOne({ where: { id }, relations: ['resolver'] }) as Ticket;

        // Notify the submitter
        try {
            const statusLabel = ticket.type === 'bug' && dto.status === 'approved'
                ? 'resolved ✅'
                : dto.status === 'approved' ? 'approved ✅' : 'rejected ❌';
            await this.notificationsService.create(
                ticket.submitterId,
                'ticket_resolved',
                `Your ticket has been ${statusLabel}`,
                `"${ticket.title}" was ${dto.status}.${
                    dto.resolutionNote ? ` Note: ${dto.resolutionNote}` : ''
                }`,
                id,
            );
            // Discord notification — load user names for a meaningful embed
            const allUsers = await this.usersService.findAll();
            const submitterName = allUsers.find(u => u.id === ticket.submitterId)?.fullName ?? 'A team member';
            const actorName     = allUsers.find(u => u.id === actorId)?.fullName ?? 'System';
            this.discordService.postTicketResolved(submitterName, ticket.type, ticket.title, actorName, dto.status).catch(() => {});
        } catch { /* non-fatal */ }

        return resolved;
    }

    async serveScreenshot(filename: string): Promise<string> {
        const filePath = path.join(UPLOAD_DIR, filename);
        if (!fs.existsSync(filePath)) throw new NotFoundException('Screenshot not found');
        return filePath;
    }

    async findByScreenshotUrl(filename: string): Promise<Ticket | null> {
        return this.repo.findOne({ where: { screenshotUrl: filename } });
    }
}
