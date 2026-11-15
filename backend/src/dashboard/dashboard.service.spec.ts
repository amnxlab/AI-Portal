import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DashboardService } from './dashboard.service';
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

type QueryBuilderMock = {
    where: jest.Mock;
    andWhere: jest.Mock;
    leftJoinAndSelect: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    take: jest.Mock;
    select: jest.Mock;
    addSelect: jest.Mock;
    groupBy: jest.Mock;
    getCount: jest.Mock;
    getMany: jest.Mock;
    getRawMany: jest.Mock;
};

const createQueryBuilderMock = (): QueryBuilderMock => {
    const qb = {
        where: jest.fn(),
        andWhere: jest.fn(),
        leftJoinAndSelect: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        take: jest.fn(),
        select: jest.fn(),
        addSelect: jest.fn(),
        groupBy: jest.fn(),
        getCount: jest.fn(),
        getMany: jest.fn(),
        getRawMany: jest.fn(),
    } as QueryBuilderMock;

    qb.where.mockReturnValue(qb);
    qb.andWhere.mockReturnValue(qb);
    qb.leftJoinAndSelect.mockReturnValue(qb);
    qb.orderBy.mockReturnValue(qb);
    qb.addOrderBy.mockReturnValue(qb);
    qb.take.mockReturnValue(qb);
    qb.select.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.groupBy.mockReturnValue(qb);

    return qb;
};

const createRepoMock = () => ({
    createQueryBuilder: jest.fn(),
    count: jest.fn(),
    find: jest.fn(),
});

describe('DashboardService', () => {
    let service: DashboardService;
    let taskRepo: ReturnType<typeof createRepoMock>;
    let inventoryRepo: ReturnType<typeof createRepoMock>;
    let reportRepo: ReturnType<typeof createRepoMock>;
    let projectRepo: ReturnType<typeof createRepoMock>;
    let notifRepo: ReturnType<typeof createRepoMock>;

    beforeEach(async () => {
        taskRepo = createRepoMock();
        inventoryRepo = createRepoMock();
        reportRepo = createRepoMock();
        projectRepo = createRepoMock();
        notifRepo = createRepoMock();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                DashboardService,
                { provide: getRepositoryToken(Task), useValue: taskRepo },
                { provide: getRepositoryToken(InventoryItem), useValue: inventoryRepo },
                { provide: getRepositoryToken(WeeklyReport), useValue: reportRepo },
                { provide: getRepositoryToken(Project), useValue: projectRepo },
                { provide: getRepositoryToken(ProjectMember), useValue: createRepoMock() },
                { provide: getRepositoryToken(ProjectFile), useValue: createRepoMock() },
                { provide: getRepositoryToken(Notification), useValue: notifRepo },
                { provide: getRepositoryToken(Ticket), useValue: createRepoMock() },
                { provide: getRepositoryToken(AuditLog), useValue: createRepoMock() },
                { provide: getRepositoryToken(User), useValue: createRepoMock() },
            ],
        }).compile();

        service = module.get(DashboardService);
    });

    it('returns completion counters for a project leader without affecting open tasks', async () => {
        const openTasksQb = createQueryBuilderMock();
        openTasksQb.getCount.mockResolvedValue(4);

        const completedTodayQb = createQueryBuilderMock();
        completedTodayQb.getCount.mockResolvedValue(1);

        const completedWeekQb = createQueryBuilderMock();
        completedWeekQb.getCount.mockResolvedValue(3);

        const taskStatsQb = createQueryBuilderMock();
        taskStatsQb.getRawMany.mockResolvedValue([{ status: 'Done', count: '3' }]);

        const lowStockQb = createQueryBuilderMock();
        lowStockQb.getCount.mockResolvedValue(2);

        taskRepo.createQueryBuilder
            .mockReturnValueOnce(openTasksQb)
            .mockReturnValueOnce(completedTodayQb)
            .mockReturnValueOnce(completedWeekQb)
            .mockReturnValueOnce(taskStatsQb);
        inventoryRepo.createQueryBuilder.mockReturnValue(lowStockQb);
        projectRepo.count.mockResolvedValue(5);
        reportRepo.count.mockResolvedValue(7);

        const result = await service.getSummary({ id: 'leader-1', permissions: { lead_projects: true } });

        expect(result.openTasks).toBe(4);
        expect(result.completedToday).toBe(1);
        expect(result.completedThisWeek).toBe(3);
        expect(result.lowStock).toBe(2);
        expect(result.activeProjects).toBe(5);
        expect(result.submittedReports).toBe(7);
        expect(completedWeekQb.andWhere).toHaveBeenCalledWith(
            expect.stringContaining('COALESCE(t.completed_at, t.updated_at) >= :weekStartDate'),
            expect.any(Object),
        );
    });

    it('returns recent completed work for contributor roles using completion ordering', async () => {
        const assignmentTasks = [{ id: 'task-open', title: 'Open task', status: 'In Progress' }];
        const completedTasks = [
            { 
                id: 'task-done', 
                title: 'Finished task', 
                status: 'Done', 
                completedAt: new Date().toISOString(),
                project_id: 'proj-1',
                project_name: 'Test Project',
                creator_id: 'user-2',
                creator_fullName: 'John Doe'
            }
        ];

        const assignmentsQb = createQueryBuilderMock();
        assignmentsQb.getMany.mockResolvedValue(assignmentTasks);

        taskRepo.createQueryBuilder.mockReturnValue(assignmentsQb);
        taskRepo.query = jest.fn().mockResolvedValue(completedTasks);
        notifRepo.find.mockResolvedValue([{ id: 'notif-1', type: 'task_assigned', isRead: false }]);

        const result = await service.getActivityFeed('user-1', { manage_inventory: true });

        expect(result.recentAssignments).toEqual(assignmentTasks);
        expect(result.recentCompletions).toHaveLength(1);
        expect(result.recentNotifications).toHaveLength(1);
        // Verify raw SQL query was called with correct parameters
        expect(taskRepo.query).toHaveBeenCalledWith(
            expect.stringContaining('COALESCE(t.completed_at, t.updated_at)'),
            expect.arrayContaining(['user-1', expect.any(Date)])
        );
    });
});