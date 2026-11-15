import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from './task.entity';
import { User } from '../users/user.entity';
import { DiscordService } from '../discord/discord.service';
import { MailService } from '../mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { taskUrl } from '../common/public-url';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ProjectsService } from '../projects/projects.service';
import { NotificationsService } from '../notifications/notifications.service';
import { effectivePermissions } from '../roles/role.entity';

@Injectable()
export class TasksService {
    constructor(
        @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        private readonly discordService: DiscordService,
        private readonly mailService: MailService,
        private readonly config: ConfigService,
        private readonly auditService: AuditService,
        private readonly realtimeGateway: RealtimeGateway,
        private readonly projectsService: ProjectsService,
        private readonly notificationsService: NotificationsService,
    ) { }

    async findAll(filters: { projectId?: string; projectIds?: string[]; assigneeId?: string; orAssigneeId?: string; status?: string }) {
        const qb = this.taskRepo.createQueryBuilder('task')
            .leftJoinAndSelect('task.assignee', 'assignee')
            .leftJoinAndSelect('task.project', 'project')
            .leftJoinAndSelect('task.creator', 'creator')
            .leftJoinAndSelect('task.subProject', 'subProject');

        // projectIds (multi-project for leader scope) takes precedence over single projectId.
        // When orAssigneeId is also set, the project scope becomes optional — tasks assigned
        // directly to the user are always included regardless of project membership.
        //
        // "Task authority" filter: tasks assigned to users who hold manage_tasks
        // (the people who assign/review tasks) are excluded from a leader's
        // scoped view — the unified-model replacement for the old
        // role-based assignee exclusion.
        const NOT_TASK_AUTHORITY =
            `COALESCE((assignee.permissions->>'manage_tasks')::boolean, false) = false`;
        if (filters.projectIds?.length && filters.orAssigneeId) {
            // Project Leader scope: include tasks in led projects that are NOT assigned to a
            // task authority, OR tasks directly assigned to this leader (regardless of project).
            // This prevents manager self-assigned tasks from leaking into the PL's view.
            qb.andWhere(
                `(task.projectId IN (:...pids) AND (assignee.id IS NULL OR ${NOT_TASK_AUTHORITY})) OR task.assigneeId = :orA`,
                { pids: filters.projectIds, orA: filters.orAssigneeId },
            );
        } else if (filters.projectIds?.length) {
            // Project Leader scope (no orAssigneeId): tasks in led projects, excluding task-authority assignees
            qb.andWhere(
                `task.projectId IN (:...pids) AND (assignee.id IS NULL OR ${NOT_TASK_AUTHORITY})`,
                { pids: filters.projectIds },
            );
        } else if (filters.projectId) {
            qb.andWhere('task.projectId = :p', { p: filters.projectId });
        }
        if (filters.assigneeId) qb.andWhere('task.assigneeId = :a', { a: filters.assigneeId });
        if (filters.status) qb.andWhere('task.status = :s', { s: filters.status });

        return qb.orderBy('task.position', 'ASC').addOrderBy('task.createdAt', 'DESC').getMany();
    }

    async findById(id: string) {
        const task = await this.taskRepo.findOne({ where: { id }, relations: ['assignee', 'project', 'creator', 'subProject'] });
        if (!task) throw new NotFoundException(`Task ${id} not found`);
        return task;
    }

    /** Prevent tasks from being assigned to users who hold task-management
     *  authority (manage_tasks) — the unified replacement for the old
     *  "cannot assign to task authority" role rule.
     *  Exceptions: self-assignment, and actors with manage_projects. */
    private async assertAssigneeAssignable(
        assigneeId: string,
        actor: { id: string; permissions?: any },
    ): Promise<void> {
        const assignee = await this.userRepo.findOne({ where: { id: assigneeId } });
        if (!assignee) throw new BadRequestException('Assignee user not found');
        const actorPerms = effectivePermissions(actor.permissions);
        const assigneePerms = effectivePermissions(assignee.permissions);
        if (
            assigneePerms.manage_tasks &&
            !actorPerms.manage_projects &&
            actor.id !== assigneeId
        ) {
            throw new BadRequestException(
                'Tasks cannot be assigned to users with task-management permissions',
            );
        }
    }

    /** Verify a Project Leader (lead_projects but not manage_projects) is scoped to the given projectId */
    private async assertLeaderScope(
        actor: { id: string; permissions?: any },
        projectId: string,
        perms: { manage_projects?: boolean; lead_projects?: boolean },
    ) {
        if (!perms.manage_projects && perms.lead_projects) {
            const ok = await this.projectsService.isLeaderOf(actor.id, projectId);
            if (!ok) throw new ForbiddenException('You are not a leader of this project');
        }
    }

    /** Return tasks whose paperId matches — used by the Papers page to show reading assignments. */
    async findByPaperId(paperId: string) {
        return this.taskRepo.find({
            where: { paperId },
            relations: ['assignee', 'project', 'creator'],
            order: { createdAt: 'DESC' },
        });
    }

    async create(data: Partial<Task>, actor: { id: string; permissions?: any }, perms: any) {
        // Project Leader scope check
        if (data.projectId) await this.assertLeaderScope(actor, data.projectId, perms);
        // Permission hierarchy: task authorities cannot be assignees — EXCEPT for paper reading tasks and self-assignment
        if (data.assigneeId && !data.paperId) await this.assertAssigneeAssignable(data.assigneeId, actor);
        // Membership check: non-authority users can only assign to project members
        if (data.assigneeId && data.projectId && !perms.manage_projects) {
            const isMember = await this.projectsService.isMemberOf(data.assigneeId, data.projectId);
            if (!isMember) {
                throw new BadRequestException('Assignee is not a member of the selected project');
            }
        }

        // Auto-assign startDate to today when a task is assigned and no explicit date was provided
        if (data.assigneeId && !data.startDate) {
            data.startDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        }

        const task = this.taskRepo.create({ ...data, createdBy: actor.id });
        const saved = await this.taskRepo.save(task);

        if (saved.assigneeId) {
            const full = await this.findById(saved.id);
            const deadline = full.deadline ? ` — due ${full.deadline}` : '';
            const project = full.project?.name ?? 'a project';

            // In-app notification to assignee (not to self)
            if (saved.assigneeId !== actor.id) {
                await this.notificationsService.create(
                    saved.assigneeId,
                    'task_assigned',
                    `New task assigned: ${full.title}`,
                    `You have been assigned a task in ${project}${deadline}. Go to Dashboard → My Tasks to view it.`,
                    saved.id,
                );
            }

            // Discord webhook notification
            if (!saved.discordNotified) {
                await this.discordService.postTaskAssigned(
                    full.title,
                    full.assignee?.fullName ?? 'Unknown',
                    full.deadline,
                    project,
                    full.creator?.fullName ?? actor.id,
                    saved.id,
                    full.description,
                );
                full.discordNotified = true;
                await this.taskRepo.save(full);
            }
        }

        this.realtimeGateway.broadcastTaskUpdate(saved);
        await this.auditService.log({ actorId: actor.id, entityType: 'task', entityId: saved.id, action: 'create', newValue: saved });
        return saved;
    }

    async update(id: string, data: Partial<Task>, actor: { id: string; permissions?: any }, perms: any) {
        const task = await this.findById(id);
        // Permission hierarchy: task authorities cannot be assignees (except self-assignment)
        if (data.assigneeId) await this.assertAssigneeAssignable(data.assigneeId, actor);
        // Membership check: non-authority users can only reassign within the task's project
        if (data.assigneeId && data.assigneeId !== task.assigneeId && !perms.manage_projects) {
            const projectId = data.projectId ?? task.projectId;
            const isMember = await this.projectsService.isMemberOf(data.assigneeId, projectId);
            if (!isMember) {
                throw new BadRequestException('Assignee is not a member of the selected project');
            }
        }

        if (perms.lead_projects && !perms.manage_projects) {
            // Determine whether this task was created by a task authority
            // (manage_tasks holder) — the unified replacement for "created by a task authority"
            let authorityCreated = false;
            if (task.createdBy) {
                const creator = await this.userRepo.findOne({ where: { id: task.createdBy }, select: ['id', 'permissions'] });
                authorityCreated = effectivePermissions(creator?.permissions).manage_tasks;
            }

            if (task.assigneeId === actor.id) {
                // Self-assigned leader: can update status/hours but NOT full-field edits on authority-created tasks
                const ALLOWED_STATUSES = ['In Progress', 'Pending Review', 'Needs Revision'];
                if (data.status && !ALLOWED_STATUSES.includes(data.status)) {
                    throw new ForbiddenException(`You can only set status to: ${ALLOWED_STATUSES.join(', ')}`);
                }
                if (authorityCreated) {
                    // Restrict to status and actualHours only — no structural edits on authority-owned tasks
                    data = {
                        ...(data.status      !== undefined ? { status: data.status }           : {}),
                        ...(data.actualHours !== undefined ? { actualHours: data.actualHours } : {}),
                    };
                }
                // Otherwise no field whitelist — all fields freely editable
            } else {
                // Leader managing someone else's task
                if (authorityCreated) {
                    throw new ForbiddenException('Tasks created by a task authority can only be modified by a task authority');
                }
                await this.assertLeaderScope(actor, task.projectId, perms);
                if (data.status === 'Done') {
                    throw new ForbiddenException('Project authority is required to mark tasks as Done. Submit for review instead.');
                }
            }
        } else if (!perms.manage_tasks && !perms.lead_projects) {
            // Regular members without task/project authority: own tasks only, limited fields
            if (task.assigneeId !== actor.id) {
                throw new ForbiddenException('You can only update your own tasks');
            }
            const ALLOWED_STATUSES = ['In Progress', 'Pending Review'];
            if (data.status && !ALLOWED_STATUSES.includes(data.status)) {
                throw new ForbiddenException(`You can only set status to: ${ALLOWED_STATUSES.join(', ')}`);
            }
            data = {
                ...(data.status      !== undefined ? { status: data.status }           : {}),
                ...(data.actualHours !== undefined ? { actualHours: data.actualHours } : {}),
            };
        }

        const old = { ...task };
        Object.assign(task, data);

        // Auto-populate flow-timing columns on status transitions
        if (data.status && data.status !== old.status) {
            // ── Entering In Progress ───────────────────────────────────────────
            if (data.status === 'In Progress') {
                if (!task.startedAt) {
                    // First time starting the task
                    task.startedAt = new Date();
                } else if (task.pausedAt) {
                    // Re-entering from Pending Review / Needs Revision / Blocked:
                    // accumulate the time spent outside In Progress into totalPausedMs
                    task.totalPausedMs = Number(task.totalPausedMs || 0) +
                        (new Date().getTime() - new Date(task.pausedAt).getTime());
                    task.pausedAt = null;
                }
            }
            // ── Leaving In Progress (not Done — Done handled below) ────────────
            if (old.status === 'In Progress' && data.status !== 'Done') {
                // Freeze the timer so inactive time is not counted on resume
                if (!task.pausedAt) {
                    task.pausedAt = new Date();
                }
            }
            if (data.status === 'Done') {
                task.completedAt = new Date();
                // Accumulate any remaining pause gap (explicit pause OR leaving In Progress)
                if (task.pausedAt) {
                    task.totalPausedMs = Number(task.totalPausedMs || 0) +
                        (new Date().getTime() - new Date(task.pausedAt).getTime());
                    task.pausedAt = null;
                }
            }
            // Auto-compute actualHours when leaving In Progress (if not manually provided)
            if (old.status === 'In Progress' && task.startedAt && data.actualHours === undefined) {
                // Use the now-frozen pausedAt timestamp so we don't count inactive time
                const frozenAt = task.pausedAt ? new Date(task.pausedAt).getTime() : Date.now();
                const elapsedMs = frozenAt - new Date(task.startedAt).getTime() - Number(task.totalPausedMs || 0);
                task.actualHours = Math.round(Math.max(0, elapsedMs) / 36_000) / 100;
            }
            // Re-opening a completed task clears completedAt
            if (old.status === 'Done' && data.status !== 'Done') {
                task.completedAt = null;
            }
        }

        const saved = await this.taskRepo.save(task);

        // Notify new assignee when assignee changes
        if (data.assigneeId && data.assigneeId !== old.assigneeId) {
            const full = await this.findById(saved.id);
            const deadline = full.deadline ? ` — due ${full.deadline}` : '';
            const project = full.project?.name ?? 'a project';

            // Look up the actor's name so the Discord message correctly shows who made the assignment
            const actorUserForAssign = await this.userRepo.findOne({ where: { id: actor.id } });
            const assignerName = actorUserForAssign?.fullName ?? actor.id;

            if (data.assigneeId !== actor.id) {
                await this.notificationsService.create(
                    data.assigneeId,
                    'task_assigned',
                    `Task assigned to you: ${full.title}`,
                    `You have been assigned a task in ${project}${deadline}. Go to Dashboard → My Tasks to view it.`,
                    saved.id,
                );
            }

            await this.discordService.postTaskAssigned(
                full.title,
                full.assignee?.fullName ?? 'Unknown',
                full.deadline,
                project,
                assignerName,
                saved.id,
                full.description,
            );
        } else {
            // For all other edits: notify the current assignee if a meaningful field changed
            const WATCHED_FIELDS: (keyof Task)[] = ['title', 'description', 'deadline', 'priority', 'status', 'projectId', 'estimatedHours'];
            const FIELD_LABELS: Partial<Record<keyof Task, string>> = {
                title:          'Title',
                description:    'Description',
                deadline:       'Deadline',
                priority:       'Priority',
                status:         'Status',
                projectId:      'Project',
                estimatedHours: 'Estimated Hours',
            };
            const changedFields = WATCHED_FIELDS.filter(
                (f) => data[f] !== undefined && data[f] !== old[f],
            ).map((f) => FIELD_LABELS[f] ?? String(f));

            if (changedFields.length > 0 && saved.assigneeId && saved.assigneeId !== actor.id) {
                const full = await this.findById(saved.id);
                const project = full.project?.name ?? 'a project';
                const actorUser = await this.userRepo.findOne({ where: { id: actor.id } });
                const editorName = actorUser?.fullName ?? actor.id;

                // In-app notification to the assignee (fires for any WATCHED_FIELDS change)
                await this.notificationsService.create(
                    saved.assigneeId,
                    'task_updated',
                    `Task updated: ${full.title}`,
                    `Your task "${full.title}" in ${project} was updated by ${editorName}. Changed: ${changedFields.join(', ')}.`,
                    saved.id,
                );

                // Discord notification — only for impactful changes (deadline, priority, status).
                // Minor text edits (description, title, estimated hours, project) are skipped
                // to avoid flooding the channel with low-signal updates.
                const DISCORD_FIELDS: (keyof Task)[] = ['deadline', 'priority', 'status'];
                const discordChangedFields = DISCORD_FIELDS
                    .filter((f) => data[f] !== undefined && data[f] !== old[f])
                    .map((f) => FIELD_LABELS[f] ?? String(f));

                if (discordChangedFields.length > 0) {
                    await this.discordService.postTaskUpdated(
                        full.title,
                        full.assignee?.fullName ?? 'Unknown',
                        full.deadline,
                        project,
                        editorName,
                        discordChangedFields,
                        saved.id,
                    );
                }
            }
        }

        // Notify task creator when status changes to Pending Review
        if (data.status === 'Pending Review' && old.status !== 'Pending Review') {
            const full = await this.findById(saved.id);
            const submitterName = full.assignee?.fullName ?? 'A team member';
            const reviewProject = full.project?.name ?? 'a project';

            if (task.createdBy && task.createdBy !== actor.id) {
                // Normal path: notify the task creator/manager who is different from the submitter
                await this.notificationsService.create(
                    task.createdBy,
                    'task_pending_review',
                    `Task ready for review: ${full.title}`,
                    `${submitterName} has submitted "${full.title}" for your review. Check the Tasks page.`,
                    saved.id,
                );
            } else {
                // Self-assigned path: creator == submitter (e.g. Project Leader assigned task to themselves)
                // Notify all task authorities (manage_tasks holders) so the submission is not missed
                const authorities = await this.userRepo
                    .createQueryBuilder('u')
                    .select('u.id', 'id')
                    .where('u.isActive = true')
                    .andWhere(`COALESCE((u.permissions->>'manage_tasks')::boolean, false) = true`)
                    .getRawMany();
                await Promise.all(authorities.map(auth =>
                    this.notificationsService.create(
                        auth.id,
                        'task_pending_review',
                        `Task ready for review: ${full.title}`,
                        `${submitterName} has submitted "${full.title}" (project: ${reviewProject}) for review. Check the Tasks page.`,
                        saved.id,
                    )
                ));
            }

            // Discord notification so the team channel is alerted
            await this.discordService.postTaskPendingReview(
                full.title,
                submitterName,
                full.deadline,
                reviewProject,
                saved.id,
                full.description,
            );
        }

        this.realtimeGateway.broadcastTaskUpdate(saved);
        await this.auditService.log({ actorId: actor.id, entityType: 'task', entityId: id, action: 'update', oldValue: old, newValue: saved });
        return saved;
    }

    async remove(id: string, actor: { id: string; permissions?: any }, perms: any) {
        const task = await this.findById(id);
        // Project Leader: must be scoped to this project
        if (perms.lead_projects && !perms.manage_projects) {
            await this.assertLeaderScope(actor, task.projectId, perms);
        }
        await this.auditService.log({ actorId: actor.id, entityType: 'task', entityId: id, action: 'delete', oldValue: task });
        await this.taskRepo.remove(task);
    }

    async pauseTask(id: string, actorId: string) {
        const task = await this.findById(id);
        if (task.status !== 'In Progress') {
            throw new ForbiddenException('Can only pause tasks that are In Progress');
        }
        if (task.pausedAt) {
            throw new BadRequestException('Task is already paused');
        }
        task.pausedAt = new Date();
        return this.taskRepo.save(task);
    }

    async resumeTask(id: string, actorId: string) {
        const task = await this.findById(id);
        if (!task.pausedAt) {
            throw new BadRequestException('Task is not paused');
        }
        const pauseDuration = new Date().getTime() - new Date(task.pausedAt).getTime();
        task.totalPausedMs = Number(task.totalPausedMs || 0) + pauseDuration;
        task.pausedAt = null;
        return this.taskRepo.save(task);
    }

    /* ═══════════════════ email notification ═══════════════════════════
       A second, formal channel beside Discord. Discord tells the team
       channel; this tells the person, in their inbox, with the full brief.
       Neither depends on the other and neither is triggered by the other:
       this runs only when somebody presses the button.
       ═══════════════════════════════════════════════════════════════════ */

    /** How long a repeat send to the same person about the same task is refused. */
    private static readonly EMAIL_COOLDOWN_MS = 60_000;

    /**
     * Who may send a task assignment by email.
     *
     * The same authority model the rest of this module uses: full project
     * authority, or a scoped project leader on the project the task belongs
     * to. `manage_tasks` alone is not enough — creating a task and formally
     * emailing somebody about it are different acts, and the brief says
     * administrators and authorised project leaders.
     */
    private async assertMayEmailAbout(task: Task, actorId: string, perms: any): Promise<void> {
        if (perms?.manage_projects) return;
        if (perms?.lead_projects && task.projectId
            && await this.projectsService.isLeaderOf(actorId, task.projectId)) {
            return;
        }
        throw new ForbiddenException(
            'Only administrators and the leaders of this task\'s project can send assignment emails.',
        );
    }

    /**
     * Emails every assignee of a task their assignment.
     *
     * One message per recipient, never one message addressed to several: a
     * combined message would put each assignee's address in everybody
     * else's inbox. Recipients and task details come from the database, not
     * from the request — the caller sends an id and nothing else.
     *
     * Reports per person rather than throwing, so one missing address or
     * one SMTP refusal does not hide what happened to the others.
     */
    async notifyAssigneesByEmail(taskId: string, actor: any, perms: any): Promise<{
        taskTitle: string;
        sent: string[];
        skipped: { name: string; reason: string }[];
        failed: { name: string; reason: string }[];
    }> {
        const task = await this.taskRepo.findOne({
            where: { id: taskId },
            relations: ['project', 'assignee'],
        });
        if (!task) throw new NotFoundException(`Task ${taskId} not found`);

        await this.assertMayEmailAbout(task, actor.id, perms);

        /*
         * The recipient set.
         *
         * A task carries exactly one assignee column today, so this is a
         * list of at most one. It is built and handled as a list anyway: the
         * brief asks for every assignee to be notified, and when a task
         * gains more than one this loop is already right.
         */
        const recipients = [task.assignee].filter((u): u is User => !!u);
        if (recipients.length === 0) {
            throw new BadRequestException(
                'This task has nobody assigned to it. Assign somebody first, then send the email.',
            );
        }

        const assigneeNames = recipients.map((u) => u.fullName);
        const projectName = task.project?.name ?? 'No project';

        // Deep link, not the Tasks page: the recipient lands on this task.
        // Built from PUBLIC_URL, never by indexing the CORS allow-list — see
        // common/public-url.ts for what that got wrong.
        const taskLink = taskUrl(this.config, task.id);

        /*
     * The actor's display name has to be looked up.
     *
     * `req.user` is the JWT payload, which carries the id, the username and
     * the permissions — not the full name. Reading `actor.fullName` off it
     * therefore fell through to the username, and the email told people
     * they had been assigned a task "by zz_admin" instead of by a person.
     */
        const actorRow = actor?.id
            ? await this.userRepo.findOne({ where: { id: actor.id }, select: ['id', 'fullName'] })
            : null;
        const actorName = actorRow?.fullName ?? actor?.fullName ?? actor?.username ?? null;
        const sent: string[] = [];
        const skipped: { name: string; reason: string }[] = [];
        const failed: { name: string; reason: string }[] = [];

        for (const user of recipients) {
            if (!user.email?.trim()) {
                skipped.push({
                    name: user.fullName,
                    reason: 'no email address on their account',
                });
                continue;
            }

            // Repeat press, re-submitted form, or an impatient second go.
            const [recent] = await this.taskRepo.query(
                `SELECT sent_at FROM task_email_notifications
                 WHERE task_id = $1 AND user_id = $2 AND delivered = true
                   AND sent_at > now() - ($3 || ' milliseconds')::interval
                 ORDER BY sent_at DESC LIMIT 1`,
                [task.id, user.id, String(TasksService.EMAIL_COOLDOWN_MS)],
            );
            if (recent) {
                const secondsAgo = Math.max(
                    1, Math.round((Date.now() - new Date(recent.sent_at).getTime()) / 1000),
                );
                skipped.push({
                    name: user.fullName,
                    reason: `already emailed ${secondsAgo}s ago — wait a moment before resending`,
                });
                continue;
            }

            let delivered = false;
            let error: string | null = null;
            try {
                delivered = await this.mailService.sendTaskAssignment({
                    to: user.email,
                    recipientName: user.fullName,
                    taskTitle: task.title,
                    taskLink,
                    projectName,
                    assigneeNames,
                    description: task.description,
                    deadline: task.deadline,
                    priority: task.priority,
                    status: task.status,
                    assignedBy: actorName,
                });
                if (!delivered) error = 'the mail server would not accept the message';
            } catch (e: any) {
                error = e?.message ?? String(e);
            }

            // Recorded either way: a failure here is the only trace a bad
            // address leaves, and the cooldown must not count a failed send.
            await this.taskRepo.query(
                `INSERT INTO task_email_notifications
                   (task_id, user_id, recipient_email, actor_id, delivered, error)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [task.id, user.id, user.email, actor?.id ?? null, delivered, error],
            ).catch(() => { /* the email went; failing to log it must not undo that */ });

            if (delivered) sent.push(user.fullName);
            else failed.push({ name: user.fullName, reason: error ?? 'delivery failed' });
        }

        // Who told whom, and what came of it.
        await this.auditService.log({
            actorId: actor?.id ?? null,
            entityType: 'Task',
            entityId: task.id,
            action: 'email_notify',
            newValue: { sent, skipped, failed },
        }).catch(() => { /* a missing audit row must not undo a sent email */ });

        return { taskTitle: task.title, sent, skipped, failed };
    }
}
