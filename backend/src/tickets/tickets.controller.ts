import {
    Controller, Get, Post, Patch, Param, Body, Req, Res, Request,
    UseGuards, UseInterceptors, UploadedFile,
    BadRequestException, ParseUUIDPipe, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import type { Response } from 'express';
import * as path from 'path';
import * as fs   from 'fs';
import { JwtAuthGuard }     from '../auth/guards/jwt-auth.guard';
import { RolesGuard }       from '../auth/guards/roles.guard';
import { Permissions }      from '../auth/decorators/permissions.decorator';
import { TicketsService }   from './tickets.service';
import { TicketType }       from './ticket.entity';

const UPLOAD_DIR = path.join(
    process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents'),
    'tickets',
);

function ensureUploadDir() {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketsController {
    constructor(private readonly svc: TicketsService) {}

    // ── Submit a ticket (all authenticated users) ────────────
    @Post()
    @UseInterceptors(FileInterceptor('screenshot', {
        storage: diskStorage({
            destination: (_req, _file, cb) => {
                ensureUploadDir();
                cb(null, UPLOAD_DIR);
            },
            filename: (_req, file, cb) => {
                const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
                const ext    = path.extname(file.originalname);
                cb(null, `${unique}${ext}`);
            },
        }),
        limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
        fileFilter: (_req, file, cb) => {
            if (!file.mimetype.startsWith('image/')) {
                cb(new BadRequestException('Only image files are allowed for screenshots'), false);
            } else {
                cb(null, true);
            }
        },
    }))
    async create(
        @Req() req: any,
        @Body() body: { type: TicketType; title: string; description: string },
        @UploadedFile() screenshot?: Express.Multer.File,
    ) {
        const user = req.user;
        if (!body.type || !body.title || !body.description) {
            throw new BadRequestException('type, title, and description are required');
        }
        return this.svc.create(user.id, body, screenshot?.filename);
    }

    // ── My own tickets ────────────────────────────────────────
    @Get('mine')
    mine(@Req() req: any) {
        const user = req.user;
        return this.svc.findMine(user.id);
    }

    // ── All tickets (user administrators only) ────────────────
    @Get()
    @Permissions('manage_users')
    findAll() {
        return this.svc.findAll();
    }

    // ── Pending tickets (user administrators only) ────────────
    @Get('pending')

    @Permissions('manage_users')
    findPending() {
        return this.svc.findPending();
    }

    // ── Approve / Reject (user administrators only) ─────────
    @Patch(':id/resolve')
    @Permissions('manage_users')
    resolve(
        @Req() req: any,
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: { status: 'approved' | 'rejected'; resolutionNote?: string },
    ) {
        const actor = req.user;
        return this.svc.resolve(id, actor.id, actor.permissions, dto);
    }

    // ── Serve screenshot (ticket owner or user administrator only) ─
    @Get('screenshot/:filename')
    async serveScreenshot(
        @Param('filename') filename: string,
        @Res() res: Response,
        @Request() req,
    ) {
        // Basic path-traversal guard
        const safe = path.basename(filename);
        // Ownership / permission check
        const ticket = await this.svc.findByScreenshotUrl(safe);
        if (!ticket) throw new NotFoundException('Screenshot not found');
        const isModerator = !!req.user.permissions?.manage_users;
        if (!isModerator && ticket.submitterId !== req.user.id) {
            throw new ForbiddenException('Access denied');
        }
        const full = await this.svc.serveScreenshot(safe);
        const ext  = path.extname(safe).toLowerCase();
        const mime: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp',
        };
        res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream');
        fs.createReadStream(full).pipe(res);
    }
}
