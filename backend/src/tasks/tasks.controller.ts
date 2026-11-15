import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { ProjectsService } from '../projects/projects.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
    constructor(
        private readonly tasksService: TasksService,
        private readonly projectsService: ProjectsService,
    ) { }

    @Get()
    async findAll(
        @Query() q: { projectId?: string; assigneeId?: string; status?: string },
        @Request() req,
    ) {
        const perms = req.user.permissions;
        const filters: { projectId?: string; projectIds?: string[]; assigneeId?: string; orAssigneeId?: string; status?: string } = { ...q };

        if (perms.manage_projects) {
            // Full project authority — see everything, no additional filter
        } else if (perms.lead_projects) {
            // Project leader — see ONLY tasks in the projects they lead.
            // This includes tasks assigned to them AND tasks they assigned to others,
            // but scoped strictly to led projects (no cross-project leakage).
            if (!filters.projectId) {
                const leaderIds = await this.projectsService.getLeaderProjectIds(req.user.id);
                if (leaderIds.length > 0) {
                    filters.projectIds = leaderIds;
                } else {
                    // Leader has no projects yet — show only their own assigned tasks
                    filters.assigneeId = req.user.id;
                }
            }
        } else {
            /*
             * Tasks are personal, and deliberately not part of the open
             * collaborative read.
             *
             * The shared material in a project is its files, documents and
             * papers — anyone can read those, and that stays open. Who is
             * assigned what is a different thing: it is a work allocation
             * between a person and whoever manages the project, and a member
             * browsing a project has no business reading somebody else's
             * assignment list.
             *
             * So this scopes to the signed-in user whether or not a project
             * was asked for. Passing ?projectId= narrows their own tasks to
             * that project; it cannot widen the set to anybody else's.
             */
            filters.assigneeId = req.user.id;
        }

        return this.tasksService.findAll(filters);
    }

    @Get(':id')
    async findOne(@Param('id') id: string, @Request() req) {
        const task = await this.tasksService.findById(id);
        const perms = req.user.permissions;
        // manage_projects — can see any task
        if (perms.manage_projects) return task;
        // Project leader — can see tasks in the projects they lead
        if (perms.lead_projects) {
            if (task.assigneeId === req.user.id) return task;
            if (task.projectId) {
                const isLeader = await this.projectsService.isLeaderOf(req.user.id, task.projectId);
                if (isLeader) return task;
            }
            throw new ForbiddenException('Access denied');
        }
        // Everyone else — only their own assigned tasks
        if (task.assigneeId !== req.user.id) throw new ForbiddenException('Access denied');
        return task;
    }

    @Post()
    @UseGuards(RolesGuard) @Permissions('manage_tasks')
    async create(@Body() dto: CreateTaskDto, @Request() req) {
        return this.tasksService.create(dto, req.user, req.user.permissions);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Request() req) {
        return this.tasksService.update(id, dto, req.user, req.user.permissions);
    }

    @Delete(':id')
    @UseGuards(RolesGuard) @Permissions('manage_tasks')
    async remove(@Param('id') id: string, @Request() req) {
        return this.tasksService.remove(id, req.user, req.user.permissions);
    }

    /**
     * Sends the assignment email. An explicit act, never a side effect of
     * saving a task — see notifyAssigneesByEmail.
     */
    @Post(':id/notify-email')
    async notifyByEmail(@Param('id') id: string, @Request() req) {
        return this.tasksService.notifyAssigneesByEmail(id, req.user, req.user.permissions);
    }

    @Patch(':id/pause')
    async pause(@Param('id') id: string, @Request() req) {
        return this.tasksService.pauseTask(id, req.user.id);
    }

    @Patch(':id/resume')
    async resume(@Param('id') id: string, @Request() req) {
        return this.tasksService.resumeTask(id, req.user.id);
    }
}
