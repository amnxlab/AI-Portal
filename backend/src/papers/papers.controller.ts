import {
    Controller, Get, Post, Patch, Delete,
    Param, Query, Body, Req, UseGuards,
    ForbiddenException, BadRequestException, ParseUUIDPipe,
    UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { PapersService } from './papers.service';
import { FilesService } from '../files/files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { effectivePermissions } from '../roles/role.entity';
import { TasksService } from '../tasks/tasks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UsersService } from '../users/users.service';
import { ProjectsService } from '../projects/projects.service';
import { CreatePaperDto } from './dto/create-paper.dto';
import { UpdatePaperDto } from './dto/update-paper.dto';
import { LinkPaperFileDto } from './dto/link-paper-file.dto';
import { AssignPaperDto } from './dto/assign-paper.dto';

@Controller('papers')
@UseGuards(JwtAuthGuard)
export class PapersController {
    constructor(
        private readonly papersService: PapersService,
        private readonly filesService: FilesService,
        private readonly tasksService: TasksService,
        private readonly notificationsService: NotificationsService,
        private readonly usersService: UsersService,
        private readonly projectsService: ProjectsService,
    ) {}

    /* ── List papers (with optional filters) ──────────────── */
    @Get()
    async findAll(
        @Req() req: any,
        @Query('projectId') projectId?: string,
        @Query('tags') tagsRaw?: string,
        @Query('search') search?: string,
        @Query('folderId') folderId?: string,
    ) {
        const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
        // 'root' sentinel → null (papers with no folder); undefined → all papers
        const resolvedFolder = folderId === 'root' ? null : folderId;
        // No project restriction: the paper library is shared, like the rest
        // of the Knowledge section. Filtering by assignment left a standard
        // user with nothing.
        return this.papersService.findAll({ projectId, tags, search, folderId: resolvedFolder });
    }

    /* ── All unique tags (for autocomplete) ───────────────── */
    @Get('tags')
    async getTags() {
        // Tags are derived from the papers on show, so they follow the same
        // rule — otherwise the filter offered tags that matched nothing.
        return this.papersService.getAllTags();
    }

    /* ── Single paper with linked files ───────────────────── */
    @Get(':id')
    async findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
        const paper = await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        const files = await this.papersService.findFilesForPaper(id);
        return { ...paper, files };
    }

    /* ── Create paper ─────────────────────────────────────── */
    @Post()
    async create(@Body() dto: CreatePaperDto, @Req() req: any) {
        return this.papersService.create(dto, req.user.id);
    }
    /* ── Move a paper to a different folder ────────────────── */
    @Patch(':id/move')
    async move(
        @Param('id', ParseUUIDPipe) id: string,
        @Body('folderId') folderId: string | null,
        @Req() req: any,
    ) {
        await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        return this.papersService.movePaper(id, folderId ?? null);
    }
    /* ── Update paper ─────────────────────────────────────── */
    @Patch(':id')
    async update(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: UpdatePaperDto,
        @Req() req: any,
    ) {
        const paper = await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        if (!(await this.papersService.canModify(paper, req.user.id, req.user.permissions))) {
            throw new ForbiddenException('Only the creator, a project leader, or a user with project authority can edit this paper');
        }
        return this.papersService.update(id, dto, req.user.id);
    }

    /* ── Delete paper (Admin only) ────────────────────────── */
    @Delete(':id')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    async remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
        await this.papersService.findById(id); // throws NotFoundException if not found
        await this.papersService.remove(id, req.user.id);
    }

    /* ── Link a project file to a paper ───────────────────── */
    @Post(':id/files')
    async linkFile(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: LinkPaperFileDto,
        @Req() req: any,
    ) {
        await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        return this.papersService.linkFile(id, dto.fileId, dto.fileType ?? 'pdf', req.user.id);
    }

    /* ── Upload a PDF directly to a paper ────────────────── */
    @Post(':id/upload')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (req: any, _file, cb) => {
                    const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
                    const dir = path.join(docsPath, req.params._projectId ?? 'papers');
                    fs.mkdirSync(dir, { recursive: true });
                    cb(null, dir);
                },
                filename: (_req, file, cb) => {
                    const ext = path.extname(file.originalname).toLowerCase();
                    cb(null, uuidv4() + ext);
                },
            }),
            limits: { fileSize: 200 * 1024 * 1024 },
            fileFilter: (_req, file, cb) => {
                const ext = path.extname(file.originalname).toLowerCase();
                if (ext !== '.pdf') {
                    cb(new BadRequestException('Only PDF files are allowed'), false);
                    return;
                }
                cb(null, true);
            },
        }),
    )
    async uploadPdf(
        @Param('id', ParseUUIDPipe) id: string,
        @UploadedFile() file: Express.Multer.File,
        @Req() req: any,
    ) {
        const paper = await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);

        // Move file to the correct project directory if needed
        const docsPath = process.env.DOCUMENTS_PATH ?? path.join(process.cwd(), 'documents');
        const projectDir = path.join(docsPath, paper.projectId);
        fs.mkdirSync(projectDir, { recursive: true });
        const destPath = path.join(projectDir, file.filename);
        if (file.path !== destPath) {
            fs.renameSync(file.path, destPath);
        }

        // Determine status: Admin (manage_projects) auto-approves; everyone else goes through review.
        const perms = req.user.permissions;
        const status = perms['manage_projects'] ? 'approved' : 'pending';

        // Create a project_files record (type='paper' keeps it out of general project docs)
        const projectFile = await this.filesService.create({
            projectId: paper.projectId,
            uploaderId: req.user.id,
            filename: file.filename,
            originalName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            type: 'paper',
            status,
        });

        // Notify reviewers when a non-authority user uploads a PDF that requires review
        if (status === 'pending') {
            const reviewerIds = await this.filesService.findManagerIds();
            await Promise.all(
                reviewerIds.map((reviewerId) =>
                    this.notificationsService.create(
                        reviewerId,
                        'file_pending',
                        'New paper PDF awaiting review',
                        `"${file.originalname}" was uploaded by ${req.user.fullName ?? req.user.username ?? 'a user'} and requires your approval before it becomes visible.`,
                        projectFile.id,
                    ),
                ),
            );
        }

        // Auto-link to the paper
        return this.papersService.linkFile(id, projectFile.id, 'pdf', req.user.id);
    }

    /* ── Assign someone to read a paper (creates a task) ─── */
    @Post(':id/assign')
    @UseGuards(RolesGuard) @Permissions('manage_tasks')
    async assign(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() dto: AssignPaperDto,
        @Req() req: any,
    ) {
        const paper = await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        const perms = req.user.permissions;

        // Project Leaders: enforce project-membership and no-direct-authority-assign rules
        if (perms.lead_projects && !perms.manage_projects) {
            const assigneeUser = await this.usersService.findById(dto.assigneeId);

            if (effectivePermissions(assigneeUser.permissions).manage_tasks) {
                // PL cannot directly assign a task authority — send a request notification instead
                await this.notificationsService.create(
                    dto.assigneeId,
                    'paper_read_request',
                    `Reading request: "${paper.title}"`,
                    `${req.user.username} is requesting you to read this paper.`,
                    paper.id,
                    req.user.id,  // requestorId — so we can notify PL back on accept/reject
                );
                return { requested: true, message: 'Reading request sent' };
            }

            // Non-Admin assignee must be an explicit project member
            const members = await this.projectsService.getMembers(paper.projectId);
            const isMember = members.some((m) => m.userId === dto.assigneeId);
            if (!isMember) {
                throw new ForbiddenException('You can only assign project members to read tasks');
            }
        }

        const descParts = [
            dto.goal ? `Goal: ${dto.goal}` : `Read and review the paper: "${paper.title}"`,
            paper.authors ? `Authors: ${paper.authors}` : null,
            paper.venue ? `Venue: ${paper.venue}` : null,
            paper.year ? `Year: ${paper.year}` : null,
            paper.doi ? `DOI: https://doi.org/${paper.doi}` : null,
        ].filter(Boolean).join('\n');

        return this.tasksService.create(
            {
                title: `Read: ${paper.title}`,
                projectId: paper.projectId,
                subProjectId: dto.subProjectId,
                assigneeId: dto.assigneeId,
                deadline: dto.deadline,
                description: descParts,
                priority: dto.priority ?? 'Medium',
                paperId: paper.id,
            },
            req.user,
            perms,
        );
    }

    /* ── Reading tasks linked to a paper ────────────────── */
    @Get(':id/read-tasks')
    async getReadTasks(@Param('id', ParseUUIDPipe) paperId: string) {
        return this.tasksService.findByPaperId(paperId);
    }

    /* ── Reviewer: accept a paper-read request ───────────── */
    @Patch(':id/read-request/:notifId/accept')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    async acceptReadRequest(
        @Param('id', ParseUUIDPipe) paperId: string,
        @Param('notifId', ParseUUIDPipe) notifId: string,
        @Req() req: any,
    ) {
        const notif = await this.notificationsService.findById(notifId);
        if (!notif || notif.userId !== req.user.id || notif.type !== 'paper_read_request' || notif.entityId !== paperId) {
            throw new ForbiddenException('Invalid or unauthorized notification');
        }
        if (notif.isRead) {
            throw new BadRequestException('This request has already been handled');
        }

        const paper = await this.papersService.findById(paperId);
        const perms = req.user.permissions;

        const descParts = [
            `Read and review the paper: "${paper.title}"`,
            paper.authors ? `Authors: ${paper.authors}` : null,
            paper.venue ? `Venue: ${paper.venue}` : null,
            paper.year ? `Year: ${paper.year}` : null,
            paper.doi ? `DOI: https://doi.org/${paper.doi}` : null,
        ].filter(Boolean).join('\n');

        await this.tasksService.create(
            {
                title: `Read: ${paper.title}`,
                projectId: paper.projectId,
                assigneeId: req.user.id,
                description: descParts,
                priority: 'Medium',
                paperId: paper.id,
            },
            req.user,
            perms,
        );

        await this.notificationsService.markRead(notif.id, req.user.id);

        if (notif.requestorId) {
            await this.notificationsService.create(
                notif.requestorId,
                'paper_read_accepted',
                `Reading request accepted: "${paper.title}"`,
                `${req.user.username} accepted your request and will read this paper.`,
                paper.id,
            );
        }

        return { ok: true };
    }

    /* ── Reviewer: reject a paper-read request ───────────── */
    @Patch(':id/read-request/:notifId/reject')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    async rejectReadRequest(
        @Param('id', ParseUUIDPipe) paperId: string,
        @Param('notifId', ParseUUIDPipe) notifId: string,
        @Req() req: any,
    ) {
        const notif = await this.notificationsService.findById(notifId);
        if (!notif || notif.userId !== req.user.id || notif.type !== 'paper_read_request' || notif.entityId !== paperId) {
            throw new ForbiddenException('Invalid or unauthorized notification');
        }
        if (notif.isRead) {
            throw new BadRequestException('This request has already been handled');
        }

        const paper = await this.papersService.findById(paperId);

        await this.notificationsService.markRead(notif.id, req.user.id);

        if (notif.requestorId) {
            await this.notificationsService.create(
                notif.requestorId,
                'paper_read_rejected',
                `Reading request declined: "${paper.title}"`,
                `${req.user.username} has declined your reading request for this paper.`,
                paper.id,
            );
        }

        return { ok: true };
    }

    /* ── Unlink a file from a paper ───────────────────────── */
    @Delete(':id/files/:linkId')
    async unlinkFile(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('linkId', ParseUUIDPipe) linkId: string,
        @Req() req: any,
    ) {
        const paper = await this.papersService.assertProjectMember(id, req.user.id, req.user.permissions);
        if (!(await this.papersService.canModify(paper, req.user.id, req.user.permissions))) {
            throw new ForbiddenException('Only the creator, a project leader, or a user with project authority can unlink files');
        }
        await this.papersService.unlinkFile(id, linkId, req.user.id);
    }
}
