import { Injectable, NotFoundException, ConflictException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Project } from './project.entity';
import { SubProject } from './sub-project.entity';
import { ProjectMember } from './project-member.entity';
import { UsersService } from '../users/users.service';
import { effectivePermissions } from '../roles/role.entity';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectsService {
    constructor(
        @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
        @InjectRepository(SubProject) private readonly subRepo: Repository<SubProject>,
        @InjectRepository(ProjectMember) private readonly memberRepo: Repository<ProjectMember>,
        private readonly usersService: UsersService,
        private readonly auditService: AuditService,
    ) { }

    findAll(includeArchived = false) {
        return this.projectRepo.find({
            where: includeArchived ? {} : { archivedAt: IsNull() },
            relations: ['owner'],
            order: { createdAt: 'DESC' },
        });
    }

    /** The archive: everything that has been put away, most recent first. */
    findArchived() {
        return this.projectRepo.find({
            where: { archivedAt: Not(IsNull()) },
            relations: ['owner'],
            order: { archivedAt: 'DESC' },
        });
    }

    /**
     * Puts a project away without changing anything about it.
     *
     * Nothing is deleted and no relationship is touched — the row simply
     * gains a date, which is what every list filters on. `status` is left
     * exactly as it was, so a cancelled project stays cancelled and a
     * completed one stays completed while archived.
     */
    async archive(id: string, actorId: string) {
        const p = await this.findById(id);
        if (p.archivedAt) return p;          // already archived; nothing to do
        p.archivedAt = new Date();
        p.archivedById = actorId;
        const saved = await this.projectRepo.save(p);
        await this.auditService.log({
            actorId, entityType: 'Project', entityId: id, action: 'archive',
            oldValue: { archivedAt: null }, newValue: { archivedAt: saved.archivedAt },
        });
        return saved;
    }

    /** Returns an archived project to the active list, untouched. */
    async restore(id: string, actorId: string) {
        const p = await this.findById(id);
        if (!p.archivedAt) return p;
        const was = p.archivedAt;
        p.archivedAt = null;
        p.archivedById = null;
        const saved = await this.projectRepo.save(p);
        await this.auditService.log({
            actorId, entityType: 'Project', entityId: id, action: 'restore',
            oldValue: { archivedAt: was }, newValue: { archivedAt: null },
        });
        return saved;
    }

    /** Returns projects where the user is a member (used for members without project-wide visibility). */
    async findByMember(userId: string) {
        const memberships = await this.memberRepo.find({ where: { userId }, select: ['projectId'] });
        if (!memberships.length) return [];
        const ids = memberships.map((m) => m.projectId);
        const projects = await this.projectRepo
            .createQueryBuilder('p')
            .leftJoinAndSelect('p.owner', 'owner')
            .where('p.id IN (:...ids)', { ids })
            .andWhere('p.archived_at IS NULL')
            .orderBy('p.createdAt', 'DESC')
            .getMany();
        return projects;
    }

    async findAllWithTaskSummary(projectIds?: string[]) {
        const projects = projectIds?.length
            ? await this.projectRepo.find({
                where: projectIds.map(id => ({ id, archivedAt: IsNull() })),
                relations: ['owner'], order: { createdAt: 'DESC' },
            })
            : await this.projectRepo.find({
                where: { archivedAt: IsNull() },
                relations: ['owner'], order: { createdAt: 'DESC' },
            });

        const qb = this.projectRepo
            .createQueryBuilder('p')
            .innerJoin('tasks', 't', 't.project_id = p.id')
            .select('t.project_id', 'project_id')
            .addSelect('t.status', 'status')
            .addSelect('COUNT(*)', 'cnt')
            .groupBy('t.project_id')
            .addGroupBy('t.status');
        if (projectIds?.length) {
            qb.where('t.project_id IN (:...projectIds)', { projectIds });
        }
        const raw: { project_id: string; status: string; cnt: string }[] = await qb.getRawMany();

        const summaryMap: Record<string, { total: number; done: number; inProgress: number; blocked: number }> = {};
        for (const row of raw) {
            if (!summaryMap[row.project_id]) summaryMap[row.project_id] = { total: 0, done: 0, inProgress: 0, blocked: 0 };
            const n = Number(row.cnt);
            summaryMap[row.project_id].total += n;
            if (row.status === 'Done')        summaryMap[row.project_id].done       += n;
            if (row.status === 'In Progress') summaryMap[row.project_id].inProgress += n;
            if (row.status === 'Blocked')     summaryMap[row.project_id].blocked    += n;
        }

        return projects.map((p) => ({
            ...p,
            tasksSummary: summaryMap[p.id] ?? { total: 0, done: 0, inProgress: 0, blocked: 0 },
        }));
    }

    async findById(id: string) {
        const p = await this.projectRepo.findOne({ where: { id }, relations: ['owner'] });
        if (!p) throw new NotFoundException(`Project ${id} not found`);
        return p;
    }

    /**
     * Rejects a date range that runs backwards.
     *
     * Nothing stopped an end date before the start date, and the timeline
     * draws from one to the other — a reversed pair produced a bar of
     * negative width that silently vanished from the chart.
     */
    private assertSaneDates(start?: string | null, end?: string | null): void {
        if (start && end && end < start) {
            throw new BadRequestException(
                `The end date (${end}) cannot be before the start date (${start}).`,
            );
        }
    }

    async create(data: Partial<Project>, actorId?: string) {
        const name = (data.name ?? '').trim();
        if (!name) throw new BadRequestException('Give the project a name.');
        this.assertSaneDates(data.startDate, data.endDate);

        const saved = await this.projectRepo.save(this.projectRepo.create({ ...data, name }));
        await this.auditService.log({
            actorId: actorId ?? null as any, entityType: 'Project', entityId: saved.id,
            action: 'create', newValue: saved,
        });
        return saved;
    }

    async update(id: string, data: Partial<Project>, actorId?: string) {
        const p = await this.findById(id);
        const before = { ...p };

        if (data.name !== undefined) {
            const name = String(data.name).trim();
            if (!name) throw new BadRequestException('Give the project a name.');
            data.name = name;
        }
        this.assertSaneDates(
            data.startDate !== undefined ? data.startDate : p.startDate,
            data.endDate !== undefined ? data.endDate : p.endDate,
        );

        Object.assign(p, data);
        const saved = await this.projectRepo.save(p);
        await this.auditService.log({
            actorId: actorId ?? null as any, entityType: 'Project', entityId: id,
            action: 'update', oldValue: before, newValue: saved,
        });
        return saved;
    }

    /**
     * Everything that would be destroyed along with a project.
     *
     * Deleting a project cascades into eleven tables, financial records among
     * them. The confirmation dialog asks for this first so it can name what
     * is actually at stake rather than warning only about tasks, which is all
     * it used to mention while expenses and files went with it unannounced.
     */
    async getDeletionImpact(id: string): Promise<{ label: string; count: number; blocking: boolean }[]> {
        const [row] = await this.projectRepo.query(
            `SELECT
               (SELECT count(*) FROM tasks                      WHERE project_id = $1) AS tasks,
               (SELECT count(*) FROM sub_projects               WHERE project_id = $1) AS sub_projects,
               (SELECT count(*) FROM project_files              WHERE project_id = $1) AS files,
               (SELECT count(*) FROM papers                     WHERE project_id = $1) AS papers,
               (SELECT count(*) FROM expenses                   WHERE project_id = $1) AS expenses,
               (SELECT COALESCE(SUM(amount), 0) FROM expenses   WHERE project_id = $1) AS expense_total,
               (SELECT count(*) FROM project_budget_allocations WHERE project_id = $1) AS allocations,
               (SELECT count(*) FROM wishlist_items             WHERE project_id = $1) AS wishlist_items,
               (SELECT count(*) FROM video_playlists            WHERE project_id = $1) AS playlists,
               (SELECT count(*) FROM playlist_media             WHERE project_id = $1) AS playlist_media,
               (SELECT count(*) FROM file_folders               WHERE project_id = $1) AS folders,
               (SELECT count(*) FROM project_members            WHERE project_id = $1) AS members`,
            [id],
        );

        // Financial records and published material are never acceptable
        // collateral; membership and empty folders are not worth blocking on.
        const SPEC: { key: string; label: string; blocking: boolean }[] = [
            { key: 'expenses', label: 'recorded expenses', blocking: true },
            { key: 'allocations', label: 'budget allocations', blocking: true },
            { key: 'files', label: 'uploaded files', blocking: true },
            { key: 'papers', label: 'papers', blocking: true },
            { key: 'tasks', label: 'tasks', blocking: true },
            { key: 'sub_projects', label: 'sub-projects', blocking: true },
            { key: 'playlists', label: 'video playlists', blocking: true },
            { key: 'playlist_media', label: 'playlist items', blocking: true },
            { key: 'wishlist_items', label: 'wishlist items', blocking: true },
            { key: 'folders', label: 'folders', blocking: false },
            { key: 'members', label: 'assigned members', blocking: false },
        ];

        const impact = SPEC
            .map((x) => ({ label: x.label, count: Number(row?.[x.key]) || 0, blocking: x.blocking }))
            .filter((x) => x.count > 0);

        const spent = Number(row?.expense_total) || 0;
        if (spent > 0) {
            impact.unshift({
                label: `$${spent.toFixed(2)} of recorded spending`,
                count: 1,
                blocking: true,
            });
        }
        return impact;
    }



    async getSubProjects(projectId: string) {
        return this.subRepo.find({ where: { projectId }, order: { createdAt: 'ASC' } });
    }

    createSubProject(data: Partial<SubProject>) { return this.subRepo.save(this.subRepo.create(data)); }

    async updateSubProject(subId: string, data: Partial<SubProject>) {
        const sp = await this.subRepo.findOne({ where: { id: subId } });
        if (!sp) throw new NotFoundException(`Sub-project ${subId} not found`);
        Object.assign(sp, data);
        return this.subRepo.save(sp);
    }

    async removeSubProject(subId: string) {
        const sp = await this.subRepo.findOne({ where: { id: subId } });
        if (!sp) throw new NotFoundException(`Sub-project ${subId} not found`);
        return this.subRepo.remove(sp);
    }

    /**
     * Permanently removes a project. Refused while it holds anything.
     *
     * The cascade reaches expenses, budget allocations, files, papers, tasks
     * and more, with no record beyond a single audit row. A project with work
     * in it is archived instead — that keeps every one of those and takes the
     * project off the active list, which is what "delete" nearly always
     * means here.
     */
    /** "1 tasks" reads like a bug. Every label here pluralises by a plain 's'. */
    private static countLabel(count: number, label: string): string {
        if (label.startsWith('$')) return label;
        return `${count} ${count === 1 ? label.replace(/s$/, '') : label}`;
    }

    async remove(id: string, actorId?: string) {
        const p = await this.findById(id);
        const impact = await this.getDeletionImpact(id);
        const blockers = impact.filter((x) => x.blocking);

        if (blockers.length) {
            const summary = blockers
                .map((x) => ProjectsService.countLabel(x.count, x.label))
                .join(', ');
            throw new ConflictException(
                `"${p.name}" cannot be deleted: it still holds ${summary}. `
                + 'Deleting it would destroy all of that. Archive it instead — the project leaves '
                + 'the active list and keeps everything it has.',
            );
        }

        await this.projectRepo.remove(p);
        await this.auditService.log({
            actorId: actorId ?? null as any, entityType: 'Project', entityId: id,
            action: 'delete', oldValue: p,
        });
        return { id, name: p.name };
    }

    // ── Project Membership ───────────────────────────────────────────────

    async getMembers(projectId: string) {
        return this.memberRepo.find({
            where: { projectId },
            relations: ['user'],
            order: { createdAt: 'ASC' },
        });
    }

    async addMember(projectId: string, userId: string, isLeader = false, actorId?: string): Promise<ProjectMember> {
        const existing = await this.memberRepo.findOne({ where: { projectId, userId } });
        if (existing) throw new ConflictException('User is already a member of this project');

        if (isLeader) {
            const targetUser = await this.usersService.findById(userId);
            const perms = effectivePermissions(targetUser.permissions);
            if (!perms.lead_projects) {
                throw new BadRequestException(
                    `User '${targetUser.fullName}' does not have the lead_projects permission and cannot be set as project leader`,
                );
            }
        }

        const member = await this.memberRepo.save(this.memberRepo.create({ projectId, userId, isLeader }));

        if (actorId) {
            await this.auditService.log({
                actorId,
                entityType: 'ProjectMember',
                entityId:   projectId,
                action:     'ADD_MEMBER',
                newValue:   { userId, isLeader },
            });
        }

        return member;
    }

    async removeMember(projectId: string, userId: string, actorId?: string): Promise<void> {
        const m = await this.memberRepo.findOne({ where: { projectId, userId } });
        if (m) {
            await this.memberRepo.remove(m);
            if (actorId) {
                await this.auditService.log({
                    actorId,
                    entityType: 'ProjectMember',
                    entityId:   projectId,
                    action:     'REMOVE_MEMBER',
                    oldValue:   { userId, isLeader: m.isLeader },
                });
            }
        }
    }

    /** Returns true if userId is a member of projectId (any role) */
    async isMemberOf(userId: string, projectId: string): Promise<boolean> {
        const m = await this.memberRepo.findOne({ where: { projectId, userId } });
        return !!m;
    }

    /** Returns true if userId is a Project Leader for projectId */
    async isLeaderOf(userId: string, projectId: string): Promise<boolean> {
        const m = await this.memberRepo.findOne({ where: { projectId, userId, isLeader: true } });
        return !!m;
    }

    /** Returns all projectIds where userId is a Project Leader */
    async getLeaderProjectIds(userId: string): Promise<string[]> {
        const rows = await this.memberRepo.find({ where: { userId, isLeader: true }, select: ['projectId'] });
        return rows.map((r) => r.projectId);
    }

    /** Returns all projectIds where userId is any kind of member */
    async getMemberProjectIds(userId: string): Promise<string[]> {
        const rows = await this.memberRepo.find({ where: { userId }, select: ['projectId'] });
        return rows.map((r) => r.projectId);
    }
}
