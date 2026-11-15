import {
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    Req,
    Res,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    ForbiddenException,
    ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { VideoTutorialsService } from './video-tutorials.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscordService } from '../discord/discord.service';
import { ProjectsService } from '../projects/projects.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';
import { UpdateMediaDto } from './dto/update-media.dto';
import { ReorderDto } from './dto/reorder.dto';
import type { Response, Request } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const VIDEO_MIME_PREFIXES = ['video/'];
const PDF_MIME = 'application/pdf';

function resolveStoragePath(): string {
    return process.env.VIDEO_TUTORIALS_PATH ?? path.join(process.cwd(), 'video_tutorials');
}

@Controller('video-tutorials')
@UseGuards(JwtAuthGuard)
export class VideoTutorialsController {
    constructor(
        private readonly service: VideoTutorialsService,
        private readonly notificationsService: NotificationsService,
        private readonly discordService: DiscordService,
        private readonly projectsService: ProjectsService,
    ) {}

    // ── Playlist endpoints ───────────────────────────────────────────

    @Get('playlists')
    async listPlaylists(@Query('projectId') projectId: string) {
        if (!projectId) throw new BadRequestException('projectId query param is required');
        return this.service.findPlaylistsByProject(projectId);
    }

    @Get('playlists/:id')
    async getPlaylist(
        @Param('id', ParseUUIDPipe) id: string,
        @Req() req: any,
    ) {
        const pl = await this.service.findPlaylistById(id);
        const perms = req.user.permissions;
        const includeAll = !!perms['manage_projects'];
        const media = await this.service.findMediaByPlaylist(id, includeAll);
        return { ...pl, media };
    }

    @Post('playlists')
    @UseGuards(RolesGuard)
    @Permissions('lead_projects')
    async createPlaylist(@Body() dto: CreatePlaylistDto, @Req() req: any) {
        const perms = req.user.permissions;
        if (!perms['manage_projects']) {
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, dto.projectId);
            if (!isLeader) throw new ForbiddenException('You are not a leader of this project');
        }
        return this.service.createPlaylist({
            ...dto,
            createdBy: req.user.id,
        });
    }

    @Patch('playlists/:id')
    @UseGuards(RolesGuard)
    @Permissions('lead_projects')
    async updatePlaylist(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdatePlaylistDto,
        @Req() req: any,
    ) {
        const pl = await this.service.findPlaylistById(id);
        const perms = req.user.permissions;
        if (!perms['manage_projects']) {
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, pl.projectId);
            if (!isLeader) throw new ForbiddenException('You are not a leader of this project');
        }
        return this.service.updatePlaylist(id, dto);
    }

    @Delete('playlists/:id')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async deletePlaylist(@Param('id', ParseUUIDPipe) id: string) {
        await this.service.deletePlaylist(id);
        return { success: true };
    }

    @Patch('playlists/reorder')
    @UseGuards(RolesGuard)
    @Permissions('lead_projects')
    async reorderPlaylists(@Body() dto: ReorderDto) {
        await this.service.reorderPlaylists(dto.items);
        return { success: true };
    }

    // ── Media endpoints ──────────────────────────────────────────────

    @Get('media/pending')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async listPendingMedia() {
        return this.service.findPendingMedia();
    }

    @Get('media/my-pending')
    async listMyPendingMedia(@Req() req: any) {
        return this.service.findMyPendingMedia(req.user.id);
    }

    @Post('playlists/:id/media')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (req: any, _file, cb) => {
                    const base = resolveStoragePath();
                    const playlistId = req.params.id;
                    // projectId is sent as a body field alongside the file
                    const projectId = req.body.projectId;
                    if (!projectId) return cb(new BadRequestException('projectId is required'), '');
                    const dir = path.join(base, projectId, playlistId);
                    fs.mkdirSync(dir, { recursive: true });
                    cb(null, dir);
                },
                filename: (_req, file, cb) => {
                    const ext = path.extname(file.originalname).toLowerCase();
                    cb(null, uuidv4() + ext);
                },
            }),
            limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
            fileFilter: (_req, file, cb) => {
                const isVideo = VIDEO_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p));
                const isPdf = file.mimetype === PDF_MIME;
                if (!isVideo && !isPdf) {
                    return cb(new BadRequestException('Only video files and PDFs are allowed'), false);
                }
                cb(null, true);
            },
        }),
    )
    async uploadMedia(
        @Param('id', ParseUUIDPipe) playlistId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body('projectId') projectId: string,
        @Body('title') title: string,
        @Body('description') description: string,
        @Req() req: any,
    ) {
        if (!file) throw new BadRequestException('File is required');
        if (!title) {
            fs.unlink(file.path, () => {});
            throw new BadRequestException('Title is required');
        }

        // Verify playlist exists and belongs to the right project
        const playlist = await this.service.findPlaylistById(playlistId);
        if (playlist.projectId !== projectId) {
            fs.unlink(file.path, () => {});
            throw new BadRequestException('Playlist does not belong to this project');
        }

        const perms = req.user.permissions;

        // Open to anyone signed in; the upload is recorded as pending below
        // unless the uploader holds project authority.

        const isVideo = VIDEO_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p));
        const mediaType: 'video' | 'pdf' = isVideo ? 'video' : 'pdf';
        const status = perms['manage_projects'] ? 'approved' : 'pending';

        const saved = await this.service.createMedia({
            playlistId,
            projectId,
            uploaderId: req.user.id,
            filename: file.filename,
            originalName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            mediaType,
            title,
            description,
            status,
        });

        // Notify reviewers about pending submission
        if (status === 'pending') {
            const reviewerIds = await this.service.findManagerIds();
            await Promise.all(
                reviewerIds.map((reviewerId) =>
                    this.notificationsService.create(
                        reviewerId,
                        'video_pending',
                        `New video tutorial awaiting review`,
                        `"${title}" was uploaded by ${req.user.fullName ?? req.user.username ?? 'a user'} to playlist "${playlist.title}" and requires your approval.`,
                        saved.id,
                    ),
                ),
            );
            this.discordService.postVideoTutorialPending(
                req.user.fullName ?? req.user.username ?? 'A user',
                title,
                playlist.title,
                mediaType,
            ).catch(() => {});
        }

        return saved;
    }

    // ── Add external / YouTube link ──────────────────────────────────
    @Post('playlists/:id/media/link')
    async addExternalMedia(
        @Param('id', ParseUUIDPipe) playlistId: string,
        @Body('projectId') projectId: string,
        @Body('title') title: string,
        @Body('description') description: string,
        @Body('externalUrl') externalUrl: string,
        @Req() req: any,
    ) {
        if (!externalUrl?.trim()) throw new BadRequestException('externalUrl is required');
        if (!title?.trim())       throw new BadRequestException('title is required');
        if (!projectId)           throw new BadRequestException('projectId is required');

        const playlist = await this.service.findPlaylistById(playlistId);
        if (playlist.projectId !== projectId)
            throw new BadRequestException('Playlist does not belong to this project');

        const perms = req.user.permissions;
        // Open to anyone signed in; approval, not assignment, is the control.
        const status = perms['manage_projects'] ? 'approved' : 'pending';
        const saved = await this.service.createMedia({
            playlistId,
            projectId,
            uploaderId: req.user.id,
            filename:     null,
            originalName: null,
            fileSize:     0,
            mimeType:     null,
            mediaType:    'youtube',
            title:        title.trim(),
            description:  description ?? undefined,
            status,
            externalUrl:  externalUrl.trim(),
        });

        if (status === 'pending') {
            const reviewerIds = await this.service.findManagerIds();
            await Promise.all(
                reviewerIds.map((reviewerId) =>
                    this.notificationsService.create(
                        reviewerId,
                        'video_pending',
                        `New video tutorial awaiting review`,
                        `"${title}" (YouTube link) was added by ${req.user.fullName ?? req.user.username ?? 'a user'} to playlist "${playlist.title}" and requires your approval.`,
                        saved.id,
                    ),
                ),
            );
        }

        return saved;
    }

    @Get('media/:id')
    async getMedia(@Param('id', ParseUUIDPipe) id: string) {
        return this.service.findMediaById(id);
    }

    @Patch('media/:id')
    async updateMedia(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdateMediaDto,
        @Req() req: any,
    ) {
        const media = await this.service.findMediaById(id);
        const perms = req.user.permissions;

        // Only creator, project leader, or project authority can edit
        const isOwner = media.uploaderId === req.user.id;
        const isAuthority = !!perms['manage_projects'];
        let isLeader = false;
        if (!isOwner && !isAuthority) {
            isLeader = await this.projectsService.isLeaderOf(req.user.id, media.projectId);
            if (!isLeader) throw new ForbiddenException('You can only edit your own uploads');
        }

        // Non-authority users trigger re-approval when editing approved content
        const resetApproval = !isAuthority;
        return this.service.updateMedia(id, dto, resetApproval);
    }

    @Patch('media/:id/approve')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async approveMedia(@Param('id', ParseUUIDPipe) id: string) {
        const media = await this.service.findMediaById(id);
        const approved = await this.service.approveMedia(id);
        if (media.uploaderId) {
            await this.notificationsService.create(
                media.uploaderId,
                'video_approved',
                `Your video tutorial has been approved ✅`,
                `"${media.title}" in playlist "${media.playlist?.title ?? ''}" has been approved and is now visible.`,
                media.id,
            );
        }
        return approved;
    }

    @Delete('media/:id/reject')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async rejectMedia(@Param('id', ParseUUIDPipe) id: string) {
        const media = await this.service.findMediaById(id);
        if (media.uploaderId) {
            await this.notificationsService.create(
                media.uploaderId,
                'video_rejected',
                `Your video tutorial was not approved`,
                `"${media.title}" in playlist "${media.playlist?.title ?? ''}" was rejected. Please revise and resubmit.`,
                media.id,
            );
        }
        await this.service.rejectMedia(id);
        return { success: true };
    }

    @Delete('media/:id')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async deleteMedia(@Param('id', ParseUUIDPipe) id: string) {
        await this.service.deleteMedia(id);
        return { success: true };
    }

    @Patch('media/reorder')
    @UseGuards(RolesGuard)
    @Permissions('lead_projects')
    async reorderMedia(@Body() dto: ReorderDto) {
        await this.service.reorderMedia(dto.items);
        return { success: true };
    }

    // ── Serve / stream media ─────────────────────────────────────────

    @Get('media/serve/:id')
    async serveMedia(
        @Param('id', ParseUUIDPipe) id: string,
        @Req() req: Request,
        @Res() res: Response,
    ) {
        const media = await this.service.findMediaById(id);
        const filePath = this.service.getMediaFilePath(media);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'Physical file not found' });
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        res.setHeader('Accept-Ranges', 'bytes');

        // Video files: support Range requests for seeking
        if (range && media.mediaType === 'video') {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Content-Length', chunkSize);
            res.setHeader('Content-Type', media.mimeType ?? 'application/octet-stream');
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            // Full response (PDFs or non-range video requests)
            const isPdf = media.mediaType === 'pdf';
            res.setHeader('Content-Type', media.mimeType ?? 'application/octet-stream');
            res.setHeader('Content-Length', fileSize);
            res.setHeader(
                'Content-Disposition',
                isPdf
                    ? `inline; filename="${media.originalName}"`
                    : `inline; filename="${media.originalName}"`,
            );
            fs.createReadStream(filePath).pipe(res);
        }
    }
}
