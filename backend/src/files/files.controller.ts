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
import { FilesService } from './files.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DiscordService }        from '../discord/discord.service';
import { ProjectsService } from '../projects/projects.service';
import { effectivePermissions } from '../roles/role.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { TasksService } from '../tasks/tasks.service';
import { UsersService } from '../users/users.service';
import { AssignManualDto } from './dto/assign-manual.dto';
import type { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const MANUAL_ALLOWED_EXTENSIONS = new Set(['.pdf', '.zip']);

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
    constructor(
        private readonly filesService: FilesService,
        private readonly notificationsService: NotificationsService,
        private readonly discordService: DiscordService,
        private readonly projectsService: ProjectsService,
        private readonly tasksService: TasksService,
        private readonly usersService: UsersService,
    ) {}
    /**
     * Every approved document in the lab, for anyone signed in.
     *
     * This used to be filtered to the projects the reader was assigned to,
     * which is the access model the lab has cancelled: a standard user
     * belongs to no projects, so the library came back empty for exactly the
     * people it was meant to serve. Only approved files are listed either
     * way — submissions awaiting review have their own endpoints.
     */
    @Get('all-documents')
    async listAllDocuments() {
        return this.filesService.findAllApprovedDocuments();
    }

    // ── My pending submissions (own files under review) ────────────
    @Get('my-pending')
    async listMyPending(@Req() req: any) {
        return this.filesService.findMyPendingFiles(req.user.id);
    }

    // ── Pending documents (project authority only) ────────────────────
    @Get('documents/pending')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async listPendingDocuments() {
        return this.filesService.findPendingDocuments();
    }
    // ── Global manuals (approved, all projects) ──────────────────────
    /** Every approved manual, for anyone signed in. See listAllDocuments. */
    @Get('manuals')
    async listAllManuals() {
        return this.filesService.findAllApprovedManuals();
    }

    // ── Pending manuals (project authority only) ──────────────────────
    @Get('manuals/pending')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async listPendingManuals() {
        return this.filesService.findPendingManuals();
    }

    // ── Pending paper PDFs (project authority only) ───────────────────
    @Get('papers/pending')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async listPendingPapers() {
        return this.filesService.findPendingPaperFiles();
    }

    // ── Project file list (managers see all incl. pending) ────────────
    @Get('projects/:projectId')
    async listFiles(
        @Param('projectId') projectId: string,
        @Query('type') type: string,
        @Query('folderId') folderId: string | undefined,
        @Req() req: any,
    ) {
        const perms = req.user.permissions;
        // Anyone signed in may read a project's files. Project authority still
        // decides who additionally sees submissions awaiting approval.
        const isAuthority = !!perms['manage_projects'];
        // 'root' sentinel → null (items with no folder); undefined → all items
        const resolvedFolder = folderId === 'root' ? null : folderId;
        return this.filesService.findByProject(projectId, type, isAuthority, resolvedFolder, req.user.id);
    }

    // ── Upload (all authenticated; status=pending unless manage_projects) ──
    @Post('projects/:projectId')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (req: any, _file, cb) => {
                    const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
                    const dir = path.join(docsPath, req.params.projectId);
                    fs.mkdirSync(dir, { recursive: true });
                    cb(null, dir);
                },
                filename: (_req, file, cb) => {
                    const ext = path.extname(file.originalname).toLowerCase();
                    cb(null, uuidv4() + ext);
                },
            }),
            limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
            fileFilter: (_req, _file, cb) => {
                // All file types are accepted for project files.
                // Manual uploads are restricted to PDF in the controller handler.
                cb(null, true);
            },
        }),
    )
    async uploadFile(
        @Param('projectId') projectId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body('type') type: string,
        @Body('category') category: string,
        @Body('title') title: string,
        @Body('description') description: string,
        @Body('folderId') folderId: string | undefined,
        @Req() req: any,
    ) {
        // Manuals are restricted to PDF only — reject and clean up if violated
        const ext = path.extname(file.originalname).toLowerCase();
        if (type === 'manual' && !MANUAL_ALLOWED_EXTENSIONS.has(ext)) {
            fs.unlink(file.path, () => {});
            throw new BadRequestException(
                `Manuals must be PDF files. Received: ${ext || '(no extension)'}`,
            );
        }
        const perms = req.user.permissions;

        // Anyone signed in may contribute to any project. What keeps that
        // safe is the next line, not a membership wall: a submission from
        // somebody without project authority lands as `pending` and is not
        // published until it is approved.
        const status = perms['manage_projects'] ? 'approved' : 'pending';

        const saved = await this.filesService.create({
            projectId,
            uploaderId: req.user.id,
            filename: file.filename,
            originalName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            type: type ?? 'document',
            category,
            title,
            description,
            status,
            folderId: folderId ?? null,
        });

        // Notify reviewers about the pending submission (non-authority users only)
        if (status === 'pending') {
            const reviewerIds = await this.filesService.findManagerIds();
            await Promise.all(
                reviewerIds.map((reviewerId) =>
                    this.notificationsService.create(
                        reviewerId,
                        'file_pending',
                        `New ${type ?? 'file'} awaiting review`,
                        `"${file.originalname}" was uploaded by ${req.user.fullName ?? req.user.username ?? 'a user'} and requires your approval before it becomes visible.`,
                        saved.id,
                        undefined,
                        // Which page can review it: a manual and a paper are
                        // both files, and without this the reviewer was sent
                        // to whichever page the frontend guessed.
                        type ?? 'file',
                    ),
                ),
            );
            // Discord notification — non-critical
            const uploaderName = req.user.fullName ?? req.user.username ?? 'A user';
            this.discordService.postFilePending(uploaderName, file.originalname, type ?? 'file').catch(() => {});
        }

        return saved;
    }

    // ── Move a file to a different folder ─────────────────────────────
    @Patch(':id/move')
    async moveFile(
        @Param('id') id: string,
        @Body('folderId') folderId: string | null,
    ) {
        return this.filesService.moveFile(id, folderId ?? null);
    }

    // ── Approve a pending file (project authority only) ───────────────
    //
    // @Permissions only records what is required; RolesGuard is what enforces
    // it, and this route was missing the guard — so any signed-in user could
    // approve a pending file, including their own submission. That is the one
    // control the whole submit-for-review model rests on.
    @Patch(':id/approve')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async approveFile(@Param('id') id: string) {
        const file = await this.filesService.findById(id);
        const approved = await this.filesService.approve(id);
        // Notify uploader
        if (file.uploaderId) {
            await this.notificationsService.create(
                file.uploaderId,
                'file_approved',
                `Your ${file.type} has been approved ✅`,
                `"${file.originalName}" in project "${file.project?.name ?? ''}" has been approved and is now visible to the team.`,
                file.id,
                undefined,
                file.type,
            );
        }
        return approved;
    }

    // ── Reject a pending file (project authority) = delete it ───────
    @Delete(':id/reject')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async rejectFile(@Param('id') id: string) {
        const file = await this.filesService.findById(id);
        // Notify uploader before deleting
        if (file.uploaderId) {
            await this.notificationsService.create(
                file.uploaderId,
                'file_rejected',
                `Your ${file.type} submission was not approved`,
                `"${file.originalName}" in project "${file.project?.name ?? ''}" was rejected by the manager. Please revise and resubmit.`,
                file.id,
                undefined,
                file.type,
            );
        }
        await this.filesService.delete(id);
        return { success: true };
    }

    // ── Stream / serve file ───────────────────────────────────────────
    @Get('serve/:id')
    async serveFile(@Param('id') id: string, @Res() res: Response) {
        const file = await this.filesService.findById(id);
        const filePath = this.filesService.getFilePath(file);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ message: 'Physical file not found' });
        }
        const isPdf = file.mimeType === 'application/pdf' || file.originalName.toLowerCase().endsWith('.pdf');
        res.setHeader('Content-Type', file.mimeType ?? 'application/octet-stream');
        res.setHeader('Content-Disposition', isPdf
            ? `inline; filename="${file.originalName}"`
            : `attachment; filename="${file.originalName}"`);
        res.setHeader('Content-Length', file.fileSize);
        fs.createReadStream(filePath).pipe(res);
    }

    // ── Delete a file (project authority only) ───────────────────────
    @Delete(':id')
    @UseGuards(RolesGuard)
    @Permissions('manage_projects')
    async deleteFile(@Param('id') id: string) {
        await this.filesService.delete(id);
        return { success: true };
    }

    // ── Assign a manual to read (creates a task) ──────────────────────
    @Post(':id/assign-read')
    @UseGuards(RolesGuard)
    @Permissions('manage_tasks')
    async assignManualRead(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: AssignManualDto,
        @Req() req: any,
    ) {
        const file = await this.filesService.findById(id);
        if (!file || file.type !== 'manual') {
            throw new BadRequestException('Manual not found');
        }

        const perms = req.user.permissions;

        // PLs: enforce project membership; cannot directly assign a task authority
        if (perms.lead_projects && !perms.manage_projects) {
            const assigneeUser = await this.usersService.findById(dto.assigneeId);

            if (effectivePermissions(assigneeUser.permissions).manage_tasks) {
                await this.notificationsService.create(
                    dto.assigneeId,
                    'manual_read_request',
                    `Reading request: "${file.originalName}"`,
                    `${req.user.username} is requesting you to read this manual.`,
                    file.id,
                    req.user.id,
                    file.type ?? 'manual',
                );
                return { requested: true, message: 'Reading request sent' };
            }

            const members = await this.projectsService.getMembers(file.projectId);
            const isMember = members.some((m) => m.userId === dto.assigneeId);
            if (!isMember) {
                throw new ForbiddenException('You can only assign project members to read tasks');
            }
        }

        const description = [
            dto.goal ? `Goal: ${dto.goal}` : `Read and review the manual: "${file.originalName}"`,
            `Project: ${file.project?.name ?? file.projectId}`,
        ].join('\n');

        return this.tasksService.create(
            {
                title: `Read: ${file.originalName}`,
                projectId: file.projectId,
                subProjectId: dto.subProjectId,
                assigneeId: dto.assigneeId,
                deadline: dto.deadline,
                description,
                priority: dto.priority ?? 'Medium',
            },
            req.user,
            perms,
        );
    }
}

