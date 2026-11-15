import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Task } from '../tasks/task.entity';
import { InventoryItem } from '../inventory/inventory.entity';
import { WeeklyReport } from '../reports/weekly-report.entity';
import { Project } from '../projects/project.entity';
import { ProjectMember } from '../projects/project-member.entity';
import { ProjectFile } from '../files/project-file.entity';
import { Notification } from '../notifications/notification.entity';
import { Ticket } from '../tickets/ticket.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';
import { effectivePermissions } from '../roles/role.entity';

/**
 * Statuses that drop off the dashboard and the timeline.
 *
 * A visibility rule, not a deletion: these projects keep every record they
 * have and stay reachable from the Projects page.
 */
export const TIMELINE_HIDDEN_STATUSES = ['Cancelled', 'Completed'];

@Injectable()
export class DashboardService {
    constructor(
        @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
        @InjectRepository(InventoryItem) private readonly inventoryRepo: Repository<InventoryItem>,
        @InjectRepository(WeeklyReport) private readonly reportRepo: Repository<WeeklyReport>,
        @InjectRepository(Project) private readonly projectRepo: Repository<Project>,
        @InjectRepository(ProjectMember) private readonly memberRepo: Repository<ProjectMember>,
        @InjectRepository(ProjectFile) private readonly fileRepo: Repository<ProjectFile>,
        @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
        @InjectRepository(Ticket) private readonly ticketRepo: Repository<Ticket>,
        @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
        @InjectRepository(User) private readonly userRepo: Repository<User>,
    ) { }

    private readonly doneStatuses = ['Done', 'Cancelled'];

    async getSummary(user: { id: string; permissions?: any }) {
        const perms = effectivePermissions(user.permissions);
        const weekStartDate = this.getMondayOf(new Date());
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
        const completionExpr = this.getCompletionTimestampExpr('t');

        const [openTasks, completedToday, completedThisWeek, lowStock, activeProjects] = await Promise.all([
            // Everyone sees their own assigned open tasks
            this.taskRepo
                .createQueryBuilder('t')
                .where('t.assigneeId = :uid', { uid: user.id })
                .andWhere('t.status NOT IN (:...done)', { done: this.doneStatuses })
                .getCount(),
            this.taskRepo
                .createQueryBuilder('t')
                .where('t.assigneeId = :uid', { uid: user.id })
                .andWhere('t.status = :doneStatus', { doneStatus: 'Done' })
                .andWhere(`${completionExpr} >= :todayStart`, { todayStart })
                .andWhere(`${completionExpr} < :tomorrowStart`, { tomorrowStart })
                .getCount(),
            this.taskRepo
                .createQueryBuilder('t')
                .where('t.assigneeId = :uid', { uid: user.id })
                .andWhere('t.status = :doneStatus', { doneStatus: 'Done' })
                .andWhere(`${completionExpr} >= :weekStartDate`, { weekStartDate })
                .getCount(),
            this.inventoryRepo.createQueryBuilder('i').where('i.quantity <= i.minQuantity').getCount(),
            this.projectRepo.count({ where: { status: 'Active' } }),
        ]);

        // Task status breakdown
        const taskStats = await this.taskRepo
            .createQueryBuilder('t')
            .select('t.status', 'status')
            .addSelect('COUNT(*)', 'count')
            .groupBy('t.status')
            .getRawMany();

        // Unsubmitted reports this week
        const weekStart = this.getCurrentWeekStart();
        const submittedCount = await this.reportRepo.count({ where: { weekStart, status: 'Submitted' } });

        // Pending review queues — each count is gated by the permission that
        // governs the corresponding module instead of a role name.
        const [pendingFilesCount, pendingReviewTasksCount, pendingReadRequestsCount] = await Promise.all([
            perms.manage_projects
                ? this.fileRepo.count({ where: { status: 'pending' } })
                : Promise.resolve(0),
            perms.manage_tasks
                ? this.taskRepo.count({ where: { status: 'Pending Review' } })
                : Promise.resolve(0),
            // Read requests are addressed to this specific user — always relevant.
            this.notifRepo.count({ where: { userId: user.id, type: 'paper_read_request', isRead: false } }),
        ]);
        const pendingReviewCount = pendingFilesCount + pendingReviewTasksCount + pendingReadRequestsCount;

        return {
            openTasks,
            completedToday,
            completedThisWeek,
            lowStock,
            activeProjects,
            taskStats,
            weekStart,
            submittedReports: submittedCount,
            pendingReviewCount,
            pendingFilesCount,
            pendingReviewTasksCount,
            pendingReadRequestsCount,
        };
    }

    async getPersonalDashboard(userId: string) {
        const [myTasks, myReports] = await Promise.all([
            this.taskRepo.find({
                where: { assigneeId: userId },
                relations: ['project'],
                order: { deadline: 'ASC' },
                take: 20,
            }),
            this.reportRepo.find({ where: { userId }, order: { weekStart: 'DESC' }, take: 5 }),
        ]);
        return { myTasks, myReports };
    }

    async getActivityFeed(userId: string, userPermissions?: any) {
        const perms = effectivePermissions(userPermissions);
        // Active tasks assigned to this user (Done/Cancelled excluded)
        const [recentAssignments, recentNotifications] = await Promise.all([
            this.taskRepo
                .createQueryBuilder('t')
                .leftJoinAndSelect('t.project', 'project')
                .leftJoinAndSelect('t.creator', 'creator')
                .where('t.assigneeId = :userId', { userId })
                .andWhere('t.status NOT IN (:...done)', { done: this.doneStatuses })
                .orderBy('t.deadline', 'ASC', 'NULLS LAST')
                .addOrderBy('t.createdAt', 'DESC')
                .take(30)
                .getMany(),
            this.notifRepo.find({
                where: { userId },
                order: { createdAt: 'DESC' },
                take: 15,
            }),
        ]);

        // Build recent completions using raw query to avoid TypeORM orderBy issues
        const weekStartDate = this.getMondayOf(new Date());
        const rawCompletions = await this.taskRepo.query(
            `
            SELECT 
                t.id, t.title, t.description, t.status, t.priority, t.deadline,
                t.completed_at AS "completedAt", t.updated_at AS "updatedAt",
                t.created_at AS "createdAt",
                p.id AS "project_id", p.name AS "project_name",
                u.id AS "creator_id", u.full_name AS "creator_fullName"
            FROM tasks t
            LEFT JOIN projects p ON p.id = t.project_id
            LEFT JOIN users u ON u.id = t.created_by
            WHERE t.assignee_id = $1
              AND t.status = 'Done'
              AND COALESCE(t.completed_at, t.updated_at) >= $2
            ORDER BY t.completed_at DESC NULLS LAST, t.updated_at DESC
            LIMIT 10
            `,
            [userId, weekStartDate]
        );
        
        // Transform raw results to match expected format
        const recentCompletions = rawCompletions.map((raw: any) => ({
            ...raw,
            project: raw.project_id ? { id: raw.project_id, name: raw.project_name } : null,
            creator: raw.creator_id ? { id: raw.creator_id, fullName: raw.creator_fullName } : null,
        }));

        // Items needing review — each queue is gated by the permission that
        // governs the module, so any user granted that permission sees it.
        let pendingFiles: ProjectFile[] = [];
        let pendingReviewTasks: Task[] = [];
        let pendingReports: WeeklyReport[] = [];
        let pendingTickets: Ticket[] = [];

        const [filesQueue, tasksQueue, reportsQueue, ticketsQueue] = await Promise.all([
            perms.manage_projects
                ? this.fileRepo
                    .createQueryBuilder('f')
                    .leftJoinAndSelect('f.uploader', 'uploader')
                    .leftJoinAndSelect('f.project', 'project')
                    .where('f.status = :status', { status: 'pending' })
                    .orderBy('f.createdAt', 'ASC')
                    .take(10)
                    .getMany()
                : Promise.resolve([] as ProjectFile[]),
            perms.manage_tasks
                ? this.taskRepo
                    .createQueryBuilder('t')
                    .leftJoinAndSelect('t.assignee', 'assignee')
                    .leftJoinAndSelect('t.project', 'project')
                    .where('t.status = :status', { status: 'Pending Review' })
                    .orderBy('t.updatedAt', 'DESC')
                    .take(10)
                    .getMany()
                : Promise.resolve([] as Task[]),
            perms.manage_reports
                ? this.reportRepo
                    .createQueryBuilder('r')
                    .leftJoinAndSelect('r.user', 'user')
                    .where('r.status = :status', { status: 'Submitted' })
                    .orderBy('r.submittedAt', 'DESC')
                    .take(10)
                    .getMany()
                : Promise.resolve([] as WeeklyReport[]),
            perms.manage_users
                ? this.ticketRepo.find({
                    where: { status: 'pending' },
                    order: { createdAt: 'ASC' },
                    take: 10,
                })
                : Promise.resolve([] as Ticket[]),
        ]);
        pendingFiles = filesQueue;
        pendingReviewTasks = tasksQueue;
        pendingReports = reportsQueue;
        pendingTickets = ticketsQueue;

        // Paper read requests addressed directly to this user — always shown.
        const pendingReadRequests = await this.notifRepo.find({
            where: { userId, type: 'paper_read_request', isRead: false },
            order: { createdAt: 'DESC' },
            take: 15,
        });

        return {
            recentAssignments,
            recentCompletions,
            recentNotifications,
            pendingFiles,
            pendingReviewTasks,
            pendingReports,
            pendingTickets,
            pendingReadRequests,
        };
    }

    async getGanttData(projectId?: string) {
        const qb = this.taskRepo.createQueryBuilder('t')
            .leftJoinAndSelect('t.assignee', 'assignee')
            .where('t.deadline IS NOT NULL');
        if (projectId) qb.andWhere('t.projectId = :projectId', { projectId });
        const tasks = await qb.orderBy('t.deadline', 'ASC').getMany();

        return tasks.map((t) => ({
            id: t.id,
            title: t.title,
            start: t.createdAt,
            end: t.deadline,
            status: t.status,
            assignee: t.assignee?.fullName,
            projectId: t.projectId,
        }));
    }

    /** Team task timeline — all active tasks with assignee info.
     *  Accessible to every authenticated user; used by the read-only Timelines tab. */
    async getTeamTimeline() {
        const tasks = await this.taskRepo
            .createQueryBuilder('t')
            .leftJoinAndSelect('t.assignee', 'assignee')
            .leftJoinAndSelect('t.project', 'project')
            .where('t.status NOT IN (:...done)', { done: ['Done', 'Cancelled'] })
            .andWhere('t.assigneeId IS NOT NULL')
            .orderBy('t.deadline', 'ASC', 'NULLS LAST')
            .getMany();

        return tasks.map((t) => ({
            id:        t.id,
            title:     t.title,
            status:    t.status,
            priority:  t.priority,
            deadline:  t.deadline,
            startDate: t.startDate,
            createdAt: t.createdAt,
            project:   t.project ? { id: t.project.id, name: t.project.name } : null,
            assignee:  t.assignee ? {
                id:        t.assignee.id,
                fullName:  t.assignee.fullName,
                role:      t.assignee.role,
                avatarUrl: t.assignee.avatarUrl,
            } : null,
        }));
    }

    /** Project Gantt timeline — scoped by permission.
     *  Users with project-wide visibility (manage_projects) or leadership
     *  (lead_projects) see all projects. Everyone else sees only projects
     *  they are a member of or have an assigned task in. */
    /**
     * Projects for the dashboard timeline: the ones still being worked on.
     *
     * Archived, Cancelled and Completed projects are left out. A timeline is
     * for what is in flight — a finished or abandoned project stretches the
     * window and crowds out the work that is actually live. Nothing is
     * deleted or changed; they are simply not on this view, and remain
     * reachable through the Projects page and its Archive filter.
     *
     * Everyone signed in sees the same set. Restricting it to projects
     * somebody was assigned to belonged to the assignment model the lab has
     * cancelled, and meant a standard user's timeline was usually empty.
     */
    async getProjectTimeline(_user: { id: string; permissions?: any }) {
        return this.projectRepo
            .createQueryBuilder('p')
            .select(['p.id', 'p.name', 'p.status', 'p.startDate', 'p.endDate'])
            .where('p.archived_at IS NULL')
            .andWhere('p.status NOT IN (:...hidden)', { hidden: TIMELINE_HIDDEN_STATUSES })
            .orderBy('p.startDate', 'ASC')
            .getMany();
    }

    /* ─────────────────────────────────────────────────────────────────────
     *  Week-based Operational Analytics
     *  All data is aligned to ISO weeks (Monday → Sunday).
     *  Selectable periods: 2W, 4W, 6W, 8W, 13W (≈3 months)
     * ───────────────────────────────────────────────────────────────────── */
    async getAnalytics(weeks: number = 4) {
        const now = new Date();

        // ── Build Monday-aligned week boundaries ──
        const currentMonday = this.getMondayOf(now);
        const weekBoundaries: { start: Date; end: Date; label: string }[] = [];
        for (let i = weeks - 1; i >= 0; i--) {
            const start = new Date(currentMonday.getTime() - i * 7 * 86_400_000);
            const end = new Date(start.getTime() + 7 * 86_400_000);
            weekBoundaries.push({ start, end, label: start.toISOString().split('T')[0] });
        }
        const cutoff = weekBoundaries[0].start;

        // ─── Parallel data fetching ───
        const [allTasks, allUsers, recentReports, activeProjectsList] = await Promise.all([
            this.taskRepo.find({ relations: ['assignee', 'project'] }),
            this.userRepo.find(),
            this.reportRepo
                .createQueryBuilder('r')
                .leftJoinAndSelect('r.user', 'user')
                .where('r.weekStart >= :cutoff', { cutoff: cutoff.toISOString().split('T')[0] })
                .getMany(),
            this.projectRepo.find({ where: [{ status: 'Active' as any }, { status: 'On Hold' as any }] }),
        ]);

        const completedTasks = allTasks.filter(t => t.status === 'Done');
        const activeTasks = allTasks.filter(t => !['Done', 'Cancelled'].includes(t.status));
        const wipTasks = allTasks.filter(t => t.status === 'In Progress');
        const blockedTasks = allTasks.filter(t => t.status === 'Blocked');
        const overdueTasks = activeTasks.filter(t => t.deadline && new Date(t.deadline + 'T23:59:59') < now);

        // Helpers
        const inWeek = (d: Date | string | null, wk: { start: Date; end: Date }) => {
            if (!d) return false;
            const t = new Date(d).getTime();
            return t >= wk.start.getTime() && t < wk.end.getTime();
        };
        const round1 = (n: number) => Math.round(n * 10) / 10;

        // ── Executive Overview (period-aware) ──
        const recentCompleted = completedTasks.filter(t =>
            t.completedAt && new Date(t.completedAt) >= cutoff,
        );
        const cycleTimes = recentCompleted
            .filter(t => t.startedAt && t.completedAt)
            .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
        const avgCycleTime = cycleTimes.length
            ? cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length : 0;

        const throughputPerWeek = weekBoundaries.map(wk =>
            completedTasks.filter(t => inWeek(t.completedAt, wk)).length,
        );
        const avgThroughput = throughputPerWeek.length
            ? throughputPerWeek.reduce((a, b) => a + b, 0) / throughputPerWeek.length : 0;

        const currentWeek = weekBoundaries[weekBoundaries.length - 1];
        const prevWeek = weekBoundaries.length > 1 ? weekBoundaries[weekBoundaries.length - 2] : null;
        const thisWeekCount = completedTasks.filter(t => inWeek(t.completedAt, currentWeek)).length;
        const lastWeekCount = prevWeek
            ? completedTasks.filter(t => inWeek(t.completedAt, prevWeek)).length : 0;
        // With no completions last week there is no percentage to report.
        // Returning 100 made "0 → 1 task" look like a 100% improvement and
        // "0 → 20 tasks" look identical to it. The flag lets the dashboard
        // caveat the figure instead of presenting an invented one.
        const velocityComparable = lastWeekCount > 0;
        const velocityDelta = velocityComparable
            ? ((thisWeekCount - lastWeekCount) / lastWeekCount) * 100
            : 0;

        const executiveOverview = {
            throughput: round1(avgThroughput),
            avgCycleTime: round1(avgCycleTime),
            wipCount: wipTasks.length,
            overdueRate: activeTasks.length > 0
                ? round1((overdueTasks.length / activeTasks.length) * 100) : 0,
            velocityDelta: round1(velocityDelta),
            velocityComparable,
            totalActive: activeTasks.length,
            totalBlocked: blockedTasks.length,
            thisWeekCompleted: thisWeekCount,
            lastWeekCompleted: lastWeekCount,
            periodLabel: `${weekBoundaries[0].label} → ${weekBoundaries[weekBoundaries.length - 1].label}`,
        };

        // ── Individual Performance (week-by-week per person) ──
        const activeUsers = allUsers.filter(u => u.isActive);
        const individualPerformance = activeUsers.map(user => {
            const uTasks = allTasks.filter(t => t.assigneeId === user.id);
            const uActive = uTasks.filter(t => !['Done', 'Cancelled'].includes(t.status));
            const uOverdue = uActive.filter(t => t.deadline && new Date(t.deadline + 'T23:59:59') < now);

            // Per-week completed & cycle time
            const weeklyData = weekBoundaries.map(wk => {
                const done = uTasks.filter(t => inWeek(t.completedAt, wk));
                const cycles = done
                    .filter(t => t.startedAt)
                    .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
                return {
                    week: wk.label,
                    completed: done.length,
                    avgCycleTime: cycles.length ? round1(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
                };
            });

            const totalCompleted = weeklyData.reduce((s, w) => s + w.completed, 0);
            const avgPerWeek = round1(totalCompleted / weeks);
            const allCycles = uTasks
                .filter(t => t.startedAt && t.completedAt && new Date(t.completedAt) >= cutoff)
                .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
            const uAvgCycle = allCycles.length
                ? round1(allCycles.reduce((a, b) => a + b, 0) / allCycles.length) : null;

            return {
                id: user.id,
                fullName: user.fullName,
                role: user.jobTitle || 'Lab Member',
                avatarUrl: user.avatarUrl,
                activeCount: uActive.length,
                wipCount: uTasks.filter(t => t.status === 'In Progress').length,
                overdueCount: uOverdue.length,
                totalCompleted,
                avgPerWeek,
                avgCycleTime: uAvgCycle,
                weeklyData,
            };
        }).filter(u => u.activeCount > 0 || u.totalCompleted > 0)
          .sort((a, b) => b.totalCompleted - a.totalCompleted);

        // ── Project Performance (week-by-week per project) ──
        const projectPerformance = activeProjectsList.map(project => {
            const pTasks = allTasks.filter(t => t.projectId === project.id);
            const total = pTasks.length;
            const done = pTasks.filter(t => t.status === 'Done').length;
            const inProgress = pTasks.filter(t => t.status === 'In Progress').length;
            const blocked = pTasks.filter(t => t.status === 'Blocked').length;
            const pActive = pTasks.filter(t => !['Done', 'Cancelled'].includes(t.status));
            const overdue = pActive.filter(t => t.deadline && new Date(t.deadline + 'T23:59:59') < now).length;

            // Per-week completed
            const weeklyData = weekBoundaries.map(wk => {
                const wDone = pTasks.filter(t => inWeek(t.completedAt, wk));
                const wCreated = pTasks.filter(t => inWeek(t.createdAt, wk));
                return {
                    week: wk.label,
                    completed: wDone.length,
                    created: wCreated.length,
                };
            });

            const totalCompletedInPeriod = weeklyData.reduce((s, w) => s + w.completed, 0);
            const avgCompletedPerWeek = round1(totalCompletedInPeriod / weeks);

            // Risk score
            const overdueRate = pActive.length > 0 ? overdue / pActive.length : 0;
            const blockedRate = pActive.length > 0 ? blocked / pActive.length : 0;
            // A project with nothing open carries no risk. The old formula
            // divided by max(active, 1), so a finished project with no
            // activity in the period scored 20% risk from the stalled-work
            // term alone — and since the table sorts by risk, completed
            // projects sat at the top of it.
            const riskScore = pActive.length === 0 ? 0 : Math.round((
                overdueRate * 0.5
                + blockedRate * 0.3
                + (1 - Math.min(totalCompletedInPeriod / pActive.length, 1)) * 0.2
            ) * 100);

            const estHours = pTasks.reduce((s, t) => s + (Number(t.estimatedHours) || 0), 0);
            const actHours = pTasks.reduce((s, t) => s + (Number(t.actualHours) || 0), 0);

            const pCycles = pTasks
                .filter(t => t.startedAt && t.completedAt && new Date(t.completedAt) >= cutoff)
                .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
            const pAvgCycle = pCycles.length
                ? round1(pCycles.reduce((a, b) => a + b, 0) / pCycles.length) : null;

            return {
                id: project.id,
                name: project.name,
                status: project.status,
                total, done, inProgress, blocked, overdue,
                completionPct: total > 0 ? Math.round((done / total) * 100) : 0,
                riskScore,
                avgCycleTime: pAvgCycle,
                avgCompletedPerWeek,
                estimatedHours: round1(estHours),
                actualHours: round1(actHours),
                weeklyData,
            };
        }).sort((a, b) => b.riskScore - a.riskScore);

        // ── Flow Diagnostics (weekly aligned) ──
        const throughputTrend = weekBoundaries.map(wk => ({
            week: wk.label,
            count: completedTasks.filter(t => inWeek(t.completedAt, wk)).length,
        }));

        const cycleTimeTrend = weekBoundaries.map(wk => {
            const wCompleted = completedTasks.filter(t => inWeek(t.completedAt, wk));
            const wCycles = wCompleted
                .filter(t => t.startedAt)
                .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
            return {
                week: wk.label,
                avg: wCycles.length ? round1(wCycles.reduce((a, b) => a + b, 0) / wCycles.length) : 0,
                count: wCycles.length,
            };
        });

        const overdueTrend = weekBoundaries.map(wk => {
            const overdueAtPoint = allTasks.filter(t => {
                if (['Done', 'Cancelled'].includes(t.status)) {
                    if (t.completedAt && new Date(t.completedAt) > wk.end) {
                        return t.deadline && new Date(t.deadline + 'T23:59:59') < wk.end;
                    }
                    return false;
                }
                return t.deadline && new Date(t.deadline + 'T23:59:59') < wk.end && new Date(t.createdAt) < wk.end;
            }).length;
            return { week: wk.label, count: overdueAtPoint };
        });

        const flowDiagnostics = { throughputTrend, cycleTimeTrend, overdueTrend };

        // ── Weekly Reports Analytics ──
        const reportWeeks: Record<string, { totalHours: number; remoteHours: number; users: Set<string> }> = {};
        for (const r of recentReports) {
            const wk = String(r.weekStart);
            if (!reportWeeks[wk]) reportWeeks[wk] = { totalHours: 0, remoteHours: 0, users: new Set() };
            reportWeeks[wk].totalHours += Number(r.totalHours) || 0;
            reportWeeks[wk].remoteHours += Number(r.remoteHours) || 0;
            reportWeeks[wk].users.add(r.userId);
        }
        const totalActiveUsers = activeUsers.length;
        const weeklyReportsAnalytics = weekBoundaries.map(wk => {
            const data = reportWeeks[wk.label];
            if (!data) {
                return { week: wk.label, totalHours: 0, submissionRate: 0, avgHoursPerUser: 0 };
            }
            return {
                week: wk.label,
                totalHours: round1(data.totalHours),
                submissionRate: totalActiveUsers > 0
                    ? round1((data.users.size / totalActiveUsers) * 100) : 0,
                avgHoursPerUser: data.users.size > 0
                    ? round1(data.totalHours / data.users.size) : 0,
            };
        });

        // ── Week labels for frontend ──
        const weekLabels = weekBoundaries.map(wk => wk.label);

        return {
            executiveOverview,
            individualPerformance,
            projectPerformance,
            flowDiagnostics,
            weeklyReportsAnalytics,
            weekLabels,
        };
    }

    /* ─────────────────────────────────────────────────────────────────────
     *  Employee Leaderboard — Weekly & Monthly boards
     *
     *  Scoring (0-100 per week):
     *    Tasks Completed  (35 pts) — scaled to team average, capped 2×
     *    On-Time Rate     (25 pts) — % completed before deadline
     *    Cycle Efficiency (15 pts) — faster than team avg = more points
     *    Report Submitted (15 pts) — weekly report filed on time
     *    Zero Overdue     (10 pts) — no overdue tasks at week end
     *
     *  Monthly score = weighted avg of weekly scores + consistency bonus
     * ───────────────────────────────────────────────────────────────────── */
    async getLeaderboard() {
        const now = new Date();
        const round1 = (n: number) => Math.round(n * 10) / 10;

        // Build 12 weeks: current + previous 11 (for historical trend)
        const weeks: { start: Date; end: Date; label: string }[] = [];
        const currentMonday = this.getMondayOf(now);
        for (let i = 11; i >= 0; i--) {
            const start = new Date(currentMonday.getTime() - i * 7 * 86_400_000);
            const end = new Date(start.getTime() + 7 * 86_400_000);
            weeks.push({ start, end, label: start.toISOString().split('T')[0] });
        }
        const twelveWeeksAgo = weeks[0].start;

        // Fetch data
        const [allTasks, allUsers, recentReports, projectMembers, projects] = await Promise.all([
            this.taskRepo.find({ relations: ['assignee'] }),
            this.userRepo.find(),
            this.reportRepo
                .createQueryBuilder('r')
                .where('r.weekStart >= :cutoff', { cutoff: twelveWeeksAgo.toISOString().split('T')[0] })
                .getMany(),
            this.memberRepo.find({ relations: ['project'] }),
            this.projectRepo.find(),
        ]);

        const activeUsers = allUsers.filter(u => u.isActive);
        const completedTasks = allTasks.filter(t => t.status === 'Done');

        /**
         * A score has to be earned.
         *
         * Every component below is awarded only when there was something to
         * measure. Where there was nothing, the component is zero and — if
         * the person did nothing at all that week — they get no entry for the
         * week, so an empty week cannot reach the board at all.
         */

        const inWeek = (d: Date | string | null, wk: { start: Date; end: Date }) => {
            if (!d) return false;
            const t = new Date(d).getTime();
            return t >= wk.start.getTime() && t < wk.end.getTime();
        };

        // Per-user per-week scores
        const userWeekScores: Record<string, { week: string; score: number; breakdown: any }[]> = {};

        for (const wk of weeks) {
            // Team-wide averages for this week
            const teamCompleted = completedTasks.filter(t => inWeek(t.completedAt, wk));

            // Averaged across the people who actually had work that week, not
            // across everybody on the books. Dividing by the whole roster
            // pushed the average so low that a single completed task scored
            // full marks: 1 task against 6 users is an "average" of 0.17, and
            // the ratio is capped at 2, so one task looked like double the
            // team rate.
            const weekParticipantCount = activeUsers.filter((u) => {
                const theirs = allTasks.filter(t => t.assigneeId === u.id);
                return theirs.some(t => inWeek(t.completedAt, wk))
                    || theirs.some(t => !['Done', 'Cancelled'].includes(t.status) && new Date(t.createdAt) < wk.end);
            }).length;
            const teamCompletedPerUser = weekParticipantCount > 0
                ? teamCompleted.length / weekParticipantCount : 0;
            const teamCycles = teamCompleted
                .filter(t => t.startedAt)
                .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
            const teamAvgCycle = teamCycles.length
                ? teamCycles.reduce((a, b) => a + b, 0) / teamCycles.length : 7;

            for (const user of activeUsers) {
                const uTasks = allTasks.filter(t => t.assigneeId === user.id);
                const uCompleted = uTasks.filter(t => inWeek(t.completedAt, wk));
                const uActive = uTasks.filter(t =>
                    !['Done', 'Cancelled'].includes(t.status) && new Date(t.createdAt) < wk.end,
                );

                // 1. Tasks Completed (35 pts) — scaled to team avg
                const completedCount = uCompleted.length;
                const completedRatio = teamCompletedPerUser > 0
                    ? Math.min(completedCount / teamCompletedPerUser, 2) : (completedCount > 0 ? 2 : 0);
                const tasksScore = round1(completedRatio * 17.5);

                // 2. On-Time Rate (25 pts) — tasks completed before/on deadline
                const withDeadline = uCompleted.filter(t => t.deadline);
                const onTime = withDeadline.filter(t =>
                    new Date(t.completedAt!) <= new Date(t.deadline + 'T23:59:59'),
                ).length;
                // Nothing finished against a deadline is not a 100% on-time
                // record. It used to default the rate to 1, which handed 25
                // points to anybody who completed nothing.
                const onTimeRate = withDeadline.length > 0 ? onTime / withDeadline.length : 0;
                const onTimeScore = round1(onTimeRate * 25);

                // 3. Cycle Time Efficiency (15 pts) — faster than team avg
                const uCycles = uCompleted
                    .filter(t => t.startedAt)
                    .map(t => (new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime()) / 86_400_000);
                let cycleScore = 0;
                if (uCycles.length > 0 && teamAvgCycle > 0) {
                    const uAvg = uCycles.reduce((a, b) => a + b, 0) / uCycles.length;
                    const ratio = Math.min(teamAvgCycle / Math.max(uAvg, 0.5), 2);
                    cycleScore = round1(Math.min(ratio * 7.5, 15));
                } else if (completedCount > 0) {
                    cycleScore = 7.5; // neutral if no timing data
                }

                // 4. Report Submitted (15 pts)
                const reportSubmitted = recentReports.some(r =>
                    r.userId === user.id &&
                    String(r.weekStart) === wk.label &&
                    ['Submitted', 'Approved'].includes(r.status),
                );
                const reportScore = reportSubmitted ? 15 : 0;

                // 5. Zero Overdue Bonus (10 pts)
                const overdueCount = uActive.filter(t =>
                    t.deadline && new Date(t.deadline + 'T23:59:59') < wk.end,
                ).length;
                // Also count tasks that were overdue and completed late in this week
                const lateCompleted = uCompleted.filter(t =>
                    t.deadline && new Date(t.completedAt!) > new Date(t.deadline + 'T23:59:59'),
                ).length;
                // Keeping nothing on time is not an achievement. The bonus
                // needs work that could have slipped: either open tasks the
                // person was carrying, or something they finished this week.
                const hadWorkAtRisk = uActive.length > 0 || uCompleted.length > 0;
                const overdueScore = (hadWorkAtRisk && overdueCount === 0 && lateCompleted === 0) ? 10 : 0;

                const totalScore = round1(
                    Math.min(tasksScore + onTimeScore + cycleScore + reportScore + overdueScore, 100),
                );

                // No completions, no report, nothing open: there is nothing
                // to rank. Recording a zero would still put them on the board
                // once anything else in the week moved.
                const participated = completedCount > 0 || reportSubmitted || uActive.length > 0;
                if (!participated) continue;

                if (!userWeekScores[user.id]) userWeekScores[user.id] = [];
                userWeekScores[user.id].push({
                    week: wk.label,
                    score: totalScore,
                    breakdown: {
                        tasks: tasksScore,
                        onTime: onTimeScore,
                        cycle: cycleScore,
                        report: reportScore,
                        noOverdue: overdueScore,
                        completedCount,
                        activeCount: uActive.length,
                        reportSubmitted,
                    },
                });
            }
        }

        // Current week = last entry
        const currentWeekLabel = weeks[weeks.length - 1].label;
        const previousWeekLabel = weeks[weeks.length - 2].label;

        // Build weekly board
        const weeklyBoard = activeUsers.map(user => {
            const weekData = userWeekScores[user.id] || [];
            const current = weekData.find(w => w.week === currentWeekLabel);
            const previous = weekData.find(w => w.week === previousWeekLabel);

            return {
                id: user.id,
                fullName: user.fullName,
                jobTitle: user.jobTitle || 'Lab Member',
                avatarUrl: user.avatarUrl,
                score: current?.score ?? 0,
                previousScore: previous?.score ?? 0,
                delta: current && previous
                    ? round1(current.score - previous.score) : 0,
                breakdown: current?.breakdown ?? {
                    tasks: 0, onTime: 0, cycle: 0, report: 0, noOverdue: 0, completedCount: 0,
                },
                weeklyHistory: weekData,
            };
        })
        .filter(u => u.score > 0 || u.previousScore > 0)
        .sort((a, b) => b.score - a.score);

        // Assign ranks (handle ties)
        let rank = 0;
        let lastScore = -1;
        for (const entry of weeklyBoard) {
            if (entry.score !== lastScore) { rank++; lastScore = entry.score; }
            (entry as any).rank = rank;
        }

        // Monthly board — last 4 full weeks (exclude the partially-complete current week)
        const monthWeeks = weeks.slice(weeks.length - 5, weeks.length - 1);
        const monthlyBoard = activeUsers.map(user => {
            const weekData = userWeekScores[user.id] || [];
            const monthScores = monthWeeks
                .map(wk => weekData.find(w => w.week === wk.label)?.score ?? 0);
            const weeksWithActivity = monthScores.filter(s => s > 0).length;
            // Averaged over the whole four weeks, not only the weeks with
            // activity. Dividing by active weeks made one strong week score
            // the same as four, which is the opposite of what a monthly board
            // is for.
            const avgScore = monthWeeks.length > 0
                ? monthScores.reduce((a, b) => a + b, 0) / monthWeeks.length : 0;

            // Consistency bonus: +5 pts if scored in all 4 weeks, +3 for 3/4
            const consistencyBonus = weeksWithActivity >= 4 ? 5 : weeksWithActivity >= 3 ? 3 : 0;
            const totalScore = round1(Math.min(avgScore + consistencyBonus, 100));

            return {
                id: user.id,
                fullName: user.fullName,
                jobTitle: user.jobTitle || 'Lab Member',
                avatarUrl: user.avatarUrl,
                score: totalScore,
                avgScore: round1(avgScore),
                consistencyBonus,
                weeksActive: weeksWithActivity,
                weeklyScores: monthScores,
                weekLabels: monthWeeks.map(w => w.label),
            };
        })
        .filter(u => u.score > 0)
        .sort((a, b) => b.score - a.score);

        let mRank = 0;
        let mLastScore = -1;
        for (const entry of monthlyBoard) {
            if (entry.score !== mLastScore) { mRank++; mLastScore = entry.score; }
            (entry as any).rank = mRank;
        }

        // ── Category Champions ──────────────────────────────────────────
        const categoryKeys = ['tasks', 'onTime', 'cycle', 'report', 'noOverdue'] as const;
        const categoryChampions = categoryKeys.map(key => {
            const sorted = [...weeklyBoard]
                .filter(u => (u.breakdown[key] ?? 0) > 0)
                .sort((a, b) => (b.breakdown[key] ?? 0) - (a.breakdown[key] ?? 0));
            const champion = sorted[0] ?? null;
            return {
                category: key,
                champion: champion ? {
                    id: champion.id,
                    fullName: champion.fullName,
                    avatarUrl: champion.avatarUrl,
                    jobTitle: (champion as any).jobTitle,
                    value: champion.breakdown[key] ?? 0,
                } : null,
            };
        });

        // ── Team / Project Leaderboard ──────────────────────────────────
        // Group users by active projects, compute average team score
        const activeProjectIds = projects
            .filter(p => p.status === 'Active')
            .map(p => p.id);

        const teamBoard = activeProjectIds.map(projectId => {
            const project = projects.find(p => p.id === projectId)!;
            const memberUserIds = projectMembers
                .filter(pm => pm.projectId === projectId)
                .map(pm => pm.userId);

            // Get scores for team members from the weeklyBoard
            const teamMembers = weeklyBoard.filter(w => memberUserIds.includes(w.id));
            const avgScore = teamMembers.length > 0
                ? round1(teamMembers.reduce((sum, m) => sum + m.score, 0) / teamMembers.length)
                : 0;
            const totalScore = round1(teamMembers.reduce((sum, m) => sum + m.score, 0));

            // Best member in team
            const topMember = teamMembers.length > 0
                ? teamMembers.reduce((best, m) => m.score > best.score ? m : best, teamMembers[0])
                : null;

            // Team breakdown averages
            const breakdownAvg: Record<string, number> = {};
            for (const key of categoryKeys) {
                const vals = teamMembers.map(m => m.breakdown[key] ?? 0);
                breakdownAvg[key] = vals.length > 0
                    ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
            }

            return {
                projectId,
                projectName: project.name,
                memberCount: memberUserIds.length,
                activeScoredCount: teamMembers.length,
                avgScore,
                totalScore,
                breakdownAvg,
                topMember: topMember ? {
                    id: topMember.id,
                    fullName: topMember.fullName,
                    avatarUrl: topMember.avatarUrl,
                    score: topMember.score,
                } : null,
                members: teamMembers.map(m => ({
                    id: m.id,
                    fullName: m.fullName,
                    avatarUrl: m.avatarUrl,
                    score: m.score,
                })),
            };
        })
        .filter(t => t.activeScoredCount > 0)
        .sort((a, b) => b.avgScore - a.avgScore);

        // Assign team ranks
        let tRank = 0;
        let tLastScore = -1;
        for (const entry of teamBoard) {
            if (entry.avgScore !== tLastScore) { tRank++; tLastScore = entry.avgScore; }
            (entry as any).rank = tRank;
        }

        return {
            currentWeek: currentWeekLabel,
            previousWeek: previousWeekLabel,
            weeklyBoard,
            monthlyBoard,
            categoryChampions,
            teamBoard,
            scoring: {
                tasks: { max: 35, description: 'Tasks completed, against the average of everyone with work that week' },
                onTime: { max: 25, description: 'Share finished on or before deadline — zero if nothing had a deadline' },
                cycle: { max: 15, description: 'Cycle time against the team average' },
                report: { max: 15, description: 'Weekly report submitted' },
                noOverdue: { max: 10, description: 'Nothing overdue or finished late, where there was work at risk' },
            },
            // Weeks with no completions, no report and nothing open are not
            // scored at all, so an inactive account cannot appear.
            note: 'Only people with activity in the week are ranked.',
        };
    }

    /** Get the Monday (00:00) of the week containing the given date */
    private getMondayOf(date: Date): Date {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d;
    }

    private getCurrentWeekStart(): string {
        return this.getMondayOf(new Date()).toISOString().split('T')[0];
    }

    private getCompletionTimestampExpr(alias: string): string {
        return `COALESCE(${alias}.completed_at, ${alias}.updated_at)`;
    }
}
