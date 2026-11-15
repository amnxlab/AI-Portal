import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { BudgetService } from '../budget/budget.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { CreateSubProjectDto } from './dto/create-subproject.dto';
import { UpdateSubProjectDto } from './dto/update-subproject.dto';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
    constructor(
        private readonly projectsService: ProjectsService,
        @Inject(forwardRef(() => BudgetService)) private readonly budgetService: BudgetService,
    ) { }

    /**
     * Every active project, for anyone signed in.
     *
     * The lab works collaboratively: a project is not a private workspace,
     * and needing to be assigned to one before you could even see it meant
     * people could not find the work they were meant to help with. Reading
     * is open to all; what remains restricted is deleting, and what remains
     * moderated is submitting (an upload from somebody without project
     * authority is recorded as pending and has to be approved).
     */
    @Get()
    async findAll(@Request() _req) {
        return this.projectsService.findAllWithTaskSummary();
    }

    /**
     * The archive, readable by anyone signed in.
     *
     * An archived project is still the lab's record of work done, and its
     * files still matter to whoever needs them. Only putting a project away
     * or taking it out again needs project authority.
     */
    @Get('archived')
    async findArchived() {
        return this.projectsService.findArchived();
    }

    @Post(':id/archive')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    archive(@Param('id') id: string, @Request() req) {
        return this.projectsService.archive(id, req.user.id);
    }

    @Post(':id/restore')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    restore(@Param('id') id: string, @Request() req) {
        return this.projectsService.restore(id, req.user.id);
    }

    @Get('my')
    async findMyProjects(@Request() req) {
        return this.projectsService.findByMember(req.user.id);
    }

    /** Returns the IDs of projects where the current user has isLeader = true */
    @Get('leading')
    async findLeading(@Request() req) {
        return this.projectsService.getLeaderProjectIds(req.user.id);
    }

    @Get(':id')
    async findOne(@Param('id') id: string) {
        return this.projectsService.findById(id);
    }

    @Get(':id/subprojects')
    async getSubProjects(@Param('id') id: string) {
        return this.projectsService.getSubProjects(id);
    }

    @Get(':id/budget')
    async getBudget(@Param('id') id: string, @Request() req) {
        const perms = req.user.permissions;
        if (perms.manage_projects || perms.manage_budget) {
            return this.budgetService.getProjectBudgetReport(id);
        }
        if (perms.lead_projects) {
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, id);
            if (!isLeader) throw new ForbiddenException('Access denied');
            return this.budgetService.getProjectBudgetReport(id);
        }
        throw new ForbiddenException('Access denied');
    }

    @Post()
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    create(@Body() dto: CreateProjectDto, @Request() req) {
        return this.projectsService.create({ ...dto, ownerId: req.user.id }, req.user.id);
    }

    @Patch(':id')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @Request() req) {
        return this.projectsService.update(id, dto, req.user.id);
    }

    /**
     * What deleting this project would destroy, before anyone commits to it.
     */
    @Get(':id/deletion-impact')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    async deletionImpact(@Param('id') id: string) {
        const impact = await this.projectsService.getDeletionImpact(id);
        return { canDelete: !impact.some((x) => x.blocking), impact };
    }

    /**
     * Create sub-project — project authority (manage_projects) OR Project Leader of this project (lead_projects).
     */
    @Post(':id/subprojects')
    @UseGuards(RolesGuard) @Permissions('lead_projects')
    async createSubProject(@Param('id') projectId: string, @Body() dto: CreateSubProjectDto, @Request() req) {
        const perms = req.user.permissions;
        if (!perms.manage_projects) {
            // Project Leader path — must be leader of THIS project
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, projectId);
            if (!isLeader) throw new ForbiddenException('You are not a leader of this project');
        }
        return this.projectsService.createSubProject({ ...dto, projectId });
    }

    @Patch(':id/subprojects/:subId')
    @UseGuards(RolesGuard) @Permissions('lead_projects')
    async updateSubProject(
        @Param('id') projectId: string,
        @Param('subId') subId: string,
        @Body() dto: UpdateSubProjectDto,
        @Request() req,
    ) {
        const perms = req.user.permissions;
        if (!perms.manage_projects) {
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, projectId);
            if (!isLeader) throw new ForbiddenException('You are not a leader of this project');
        }
        return this.projectsService.updateSubProject(subId, dto);
    }

    @Delete(':id/subprojects/:subId')
    @UseGuards(RolesGuard) @Permissions('lead_projects')
    async removeSubProject(
        @Param('id') projectId: string,
        @Param('subId') subId: string,
        @Request() req,
    ) {
        const perms = req.user.permissions;
        if (!perms.manage_projects) {
            const isLeader = await this.projectsService.isLeaderOf(req.user.id, projectId);
            if (!isLeader) throw new ForbiddenException('You are not a leader of this project');
        }
        return this.projectsService.removeSubProject(subId);
    }

    @Delete(':id')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    remove(@Param('id') id: string, @Request() req) {
        return this.projectsService.remove(id, req.user.id);
    }

    // ── Project Membership (project authority only) ─────────────────────

    @Get(':id/members')
    async getMembers(@Param('id') id: string, @Request() req) {
        const perms = req.user.permissions;
        return this.projectsService.getMembers(id);
    }

    @Post(':id/members')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    addMember(
        @Param('id') id: string,
        @Body() body: { userId: string; isLeader?: boolean },
        @Request() req,
    ) {
        return this.projectsService.addMember(id, body.userId, body.isLeader ?? false, req.user.id);
    }

    @Delete(':id/members/:userId')
    @UseGuards(RolesGuard) @Permissions('manage_projects')
    removeMember(@Param('id') id: string, @Param('userId') userId: string, @Request() req) {
        return this.projectsService.removeMember(id, userId, req.user.id);
    }
}
