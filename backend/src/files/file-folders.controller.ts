import {
    Controller, Get, Post, Patch, Delete,
    Param, Query, Body, Req, UseGuards,
    ParseUUIDPipe, ForbiddenException,
} from '@nestjs/common';
import { FileFoldersService, CreateFolderDto } from './file-folders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import {
    IsString, IsNotEmpty, IsIn, IsUUID, IsOptional, MaxLength,
} from 'class-validator';

class CreateFolderBody {
    @IsUUID()
    @IsNotEmpty()
    projectId: string;

    @IsIn(['manual', 'paper', 'document'])
    type: 'manual' | 'paper' | 'document';

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name: string;

    @IsUUID()
    @IsOptional()
    parentId?: string | null;
}

class RenameFolderBody {
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name: string;
}

@Controller('file-folders')
@UseGuards(JwtAuthGuard)
export class FileFoldersController {
    constructor(
        private readonly foldersService: FileFoldersService,
        private readonly projectsService: ProjectsService,
    ) {}

    /* ── Helpers ──────────────────────────────────────────── */
    /**
     * Folder structure is still managed rather than open: it is the shape of
     * someone else's filing, not a submission. Project leaders may manage it
     * in any project now — the assignment requirement is gone — and deleting
     * a folder remains project authority only (see requireAdmin).
     */
    private async requireLeaderOrAdmin(req: any, _projectId: string): Promise<void> {
        const perms = req.user.permissions;
        if (perms['manage_projects'] || perms['lead_projects']) return;
        throw new ForbiddenException('Only project leaders or users with project authority can manage folders');
    }

    private async requireAdmin(req: any): Promise<void> {
        const perms = req.user.permissions;
        if (!perms['manage_projects']) {
            throw new ForbiddenException('Only users with project authority can delete folders');
        }
    }

    /* ── List immediate children ──────────────────────────── */
    @Get()
    async listChildren(
        @Query('projectId') projectId: string,
        @Query('type') type: 'manual' | 'paper' | 'document',
        @Query('parentId') parentId?: string,
    ) {
        // 'root' is a frontend sentinel meaning: fetch top-level folders (parent_id IS NULL)
        const resolvedParent = (!parentId || parentId === 'root') ? null : parentId;
        return this.foldersService.findChildren(projectId, type, resolvedParent);
    }

    /* ── Flat list for picker dropdowns ───────────────────── */
    @Get('all')
    async listAll(
        @Query('projectId') projectId: string,
        @Query('type') type: 'manual' | 'paper' | 'document',
    ) {
        return this.foldersService.findAll(projectId, type);
    }

    /* ── Breadcrumb path to a folder ──────────────────────── */
    @Get(':id/path')
    async getPath(@Param('id', ParseUUIDPipe) id: string) {
        return this.foldersService.findPath(id);
    }

    /* ── Create folder ────────────────────────────────────── */
    @Post()
    async create(@Body() body: CreateFolderBody, @Req() req: any) {
        await this.requireLeaderOrAdmin(req, body.projectId);
        const dto: CreateFolderDto = {
            projectId: body.projectId,
            type: body.type,
            name: body.name,
            parentId: body.parentId ?? null,
        };
        return this.foldersService.create(dto, req.user.id);
    }

    /* ── Rename folder ────────────────────────────────────── */
    @Patch(':id')
    async rename(
        @Param('id', ParseUUIDPipe) id: string,
        @Body() body: RenameFolderBody,
        @Req() req: any,
    ) {
        const folder = await this.foldersService.findById(id);
        await this.requireLeaderOrAdmin(req, folder.projectId);
        return this.foldersService.rename(id, body.name);
    }

    /* ── Delete folder and all contents (admin only) ──────── */
    @Delete(':id')
    async remove(
        @Param('id', ParseUUIDPipe) id: string,
        @Req() req: any,
    ) {
        await this.requireAdmin(req);
        await this.foldersService.delete(id);
    }
}
