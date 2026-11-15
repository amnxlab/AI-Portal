import {
    Injectable, NotFoundException, BadRequestException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

import { FundingSource } from './entities/funding-source.entity';
import { BudgetAccount } from './entities/budget-account.entity';
import { BudgetYear } from './entities/budget-year.entity';
import { ProjectBudgetAllocation } from './entities/project-budget-allocation.entity';
import { BudgetTransfer } from './entities/budget-transfer.entity';
import { Expense } from './entities/expense.entity';
import { LaborDeduction } from './entities/labor-deduction.entity';
import { LaborPoolMember } from './entities/labor-pool-member.entity';
import { BudgetSimulationSnapshot } from './entities/budget-simulation-snapshot.entity';
import { User } from '../users/user.entity';
import { AuditService } from '../audit/audit.service';

import { CreateFundingSourceDto } from './dto/create-funding-source.dto';
import { CreateBudgetAccountDto } from './dto/create-budget-account.dto';
import { CreateProjectAllocationDto } from './dto/create-project-allocation.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { LaborDeductDto } from './dto/labor-deduct.dto';
import { SimulateDto } from './dto/simulate.dto';

@Injectable()
export class BudgetService {
    constructor(
        @InjectRepository(FundingSource)
        private readonly sourceRepo: Repository<FundingSource>,
        @InjectRepository(BudgetAccount)
        private readonly accountRepo: Repository<BudgetAccount>,
        @InjectRepository(BudgetYear)
        private readonly yearRepo: Repository<BudgetYear>,
        @InjectRepository(ProjectBudgetAllocation)
        private readonly allocationRepo: Repository<ProjectBudgetAllocation>,
        @InjectRepository(BudgetTransfer)
        private readonly transferRepo: Repository<BudgetTransfer>,
        @InjectRepository(Expense)
        private readonly expenseRepo: Repository<Expense>,
        @InjectRepository(LaborDeduction)
        private readonly deductionRepo: Repository<LaborDeduction>,
        @InjectRepository(LaborPoolMember)
        private readonly poolMemberRepo: Repository<LaborPoolMember>,
        @InjectRepository(BudgetSimulationSnapshot)
        private readonly simSnapshotRepo: Repository<BudgetSimulationSnapshot>,
        private readonly auditService: AuditService,
        private readonly dataSource: DataSource,
    ) { }

    // ─────────────────────────────────────────────────────────────────────────
    // Funding Sources
    // ─────────────────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────────────────
    // Budget years
    //
    // A year owns its accounts; allocations, expenses and labor deductions
    // hang off those accounts. Every figure for a year is therefore derived
    // by following those links — nothing is copied when a year is closed, so
    // closing one cannot lose or alter a single record.
    // ─────────────────────────────────────────────────────────────────────────

    /** The year currently being spent. */
    async getActiveYear(): Promise<BudgetYear> {
        const year = await this.yearRepo.findOne({ where: { status: 'active' } });
        if (!year) {
            throw new ConflictException(
                'No budget year is open. Start a new budget year before recording anything.',
            );
        }
        return year;
    }

    /** Every year, newest first, each with its headline figures. */
    async listYears(): Promise<any[]> {
        const years = await this.yearRepo.find({
            relations: ['closedBy'],
            order: { year: 'DESC' },
        });
        return Promise.all(years.map(async (y) => ({
            ...y,
            closedBy: y.closedBy ? { id: y.closedBy.id, fullName: y.closedBy.fullName } : null,
            ...(await this.yearTotals(y.id)),
        })));
    }

    /**
     * Resolves the year a request is asking about.
     *
     * No id means "the one being spent now", which is what every screen wants
     * by default and what every write is restricted to.
     */
    async resolveYear(yearId?: string): Promise<BudgetYear> {
        if (!yearId) return this.getActiveYear();
        const year = await this.yearRepo.findOne({ where: { id: yearId } });
        if (!year) throw new NotFoundException('Budget year not found');
        return year;
    }

    /**
     * A closed year is a record, not a ledger.
     *
     * Enforced here, on the way into every write, rather than by hiding
     * buttons: the API is what protects the history.
     */
    private async assertYearOpen(yearId: string | null | undefined, what: string): Promise<void> {
        if (!yearId) return;      // pre-existing rows with no year attached
        const year = await this.yearRepo.findOne({ where: { id: yearId } });
        if (year && year.status !== 'active') {
            throw new ConflictException(
                `${year.label} is closed and is kept read-only. ${what} can only be recorded in the open budget year.`,
            );
        }
    }

    /** The year an account belongs to — the root of every other lookup. */
    private async yearIdOfAccount(accountId: string): Promise<string | null> {
        const a = await this.accountRepo.findOne({ where: { id: accountId } });
        return a?.budgetYearId ?? null;
    }

    private async yearIdOfAllocation(allocationId: string): Promise<string | null> {
        const rows = await this.dataSource.query(
            `SELECT a.budget_year_id AS y
               FROM project_budget_allocations p
               JOIN budget_accounts a ON a.id = p.budget_account_id
              WHERE p.id = $1`,
            [allocationId],
        );
        return rows[0]?.y ?? null;
    }

    /**
     * The four headline figures for a year, from the ledger itself.
     *
     * This is the single place they are computed. The dashboard cards, the
     * year list, the charts and the per-account rows all read from here or
     * from `getOverview`, which calls it — so they cannot disagree.
     */
    private async yearTotals(yearId: string): Promise<{
        totalAllocated: number; totalBalance: number;
        totalLaborDeducted: number; totalExpenses: number; accountCount: number;
    }> {
        const [row] = await this.dataSource.query(
            `WITH ya AS (
                 SELECT id, total_allocated FROM budget_accounts WHERE budget_year_id = $1
             )
             SELECT
                 (SELECT COALESCE(SUM(total_allocated), 0) FROM ya)                      AS allocated,
                 (SELECT COUNT(*) FROM ya)                                               AS accounts,
                 (SELECT COALESCE(SUM(d.amount), 0)
                    FROM labor_deductions d WHERE d.budget_account_id IN (SELECT id FROM ya)) AS labor,
                 (SELECT COALESCE(SUM(e.amount), 0)
                    FROM expenses e
                    JOIN project_budget_allocations p ON p.id = e.allocation_id
                   WHERE p.budget_account_id IN (SELECT id FROM ya))                     AS expenses`,
            [yearId],
        );
        const totalAllocated = Number(row?.allocated) || 0;
        const totalLaborDeducted = Number(row?.labor) || 0;
        const totalExpenses = Number(row?.expenses) || 0;
        return {
            totalAllocated,
            totalLaborDeducted,
            totalExpenses,
            totalBalance: totalAllocated - totalLaborDeducted - totalExpenses,
            accountCount: Number(row?.accounts) || 0,
        };
    }

    /**
     * Closes the open year and opens the next one.
     *
     * Nothing is deleted, moved or recalculated: the old year is marked
     * archived — which is what makes it read-only — and a new one is opened
     * alongside it. The previous year's accounts, allocations, expenses and
     * labor stay attached to it and keep reporting the same totals forever.
     *
     * `carryStructure` copies the shape of the old year's accounts — their
     * names, categories and funding sources — with zero allocated, so the
     * new year starts with the same chart of accounts and none of the money.
     * Balances and transactions are never carried.
     *
     * The whole thing is one transaction, and the database's partial unique
     * index on `status = 'active'` is what actually prevents two open years
     * if this is somehow entered twice at once.
     */
    async closeYearAndOpenNext(
        dto: { year?: number; label?: string; carryStructure?: boolean; notes?: string },
        actorId: string,
    ): Promise<{ archived: BudgetYear; opened: BudgetYear; accountsCreated: number }> {
        const current = await this.getActiveYear();
        const newYearNumber = dto.year ?? current.year + 1;

        if (newYearNumber <= current.year) {
            throw new BadRequestException(
                `The new budget year must come after ${current.year}.`,
            );
        }
        const clash = await this.yearRepo.findOne({ where: { year: newYearNumber } });
        if (clash) {
            throw new ConflictException(
                `A ${newYearNumber} budget year already exists. Each year can only be opened once.`,
            );
        }

        try {
            return await this.openNextYear(current, newYearNumber, dto, actorId);
        } catch (err: any) {
            // Two requests arriving together both pass the checks above and
            // then race to insert. The database settles it — a partial unique
            // index allows only one active year, and the year number is
            // unique — and the loser arrives here. That is a conflict, not a
            // server fault, so it must not surface as a 500: the button was
            // simply pressed twice.
            if (err?.code === '23505') {
                throw new ConflictException(
                    `The ${newYearNumber} budget year has just been opened. Reload to see it.`,
                );
            }
            throw err;
        }
    }

    private async openNextYear(
        current: BudgetYear,
        newYearNumber: number,
        dto: { label?: string; carryStructure?: boolean; notes?: string },
        actorId: string,
    ): Promise<{ archived: BudgetYear; opened: BudgetYear; accountsCreated: number }> {
        return this.dataSource.transaction(async (manager) => {
            const yearRepo = manager.getRepository(BudgetYear);
            const accountRepo = manager.getRepository(BudgetAccount);

            // Close the open year.
            current.status = 'archived';
            current.closedAt = new Date();
            current.closedById = actorId;
            await yearRepo.save(current);

            // Open the next one.
            const opened = await yearRepo.save(yearRepo.create({
                year: newYearNumber,
                label: dto.label?.trim() || `${newYearNumber} Budget`,
                status: 'active',
                openedAt: new Date(),
                notes: dto.notes ?? null,
            }));

            let accountsCreated = 0;
            if (dto.carryStructure) {
                const previous = await accountRepo.find({
                    where: { budgetYearId: current.id },
                    relations: ['fundingSources'],
                });
                for (const old of previous) {
                    // Only sources flagged as spanning years follow the
                    // account across. A one-off grant ended with its year,
                    // and linking it here would suggest the new account is
                    // funded by money that is already spent.
                    const carried = (old.fundingSources ?? []).filter((f) => f.carriesOver);
                    const fresh = accountRepo.create({
                        name: old.name.replace(String(current.year), String(newYearNumber)),
                        description: old.description,
                        category: old.category,
                        totalAllocated: 0,          // the shape carries over, the money does not
                        expiresAt: null,
                        fundingSources: carried,
                        budgetYearId: opened.id,
                    });
                    await accountRepo.save(fresh);
                    accountsCreated++;
                }
            }

            await this.auditService.log({
                actorId, entityType: 'BudgetYear', entityId: opened.id, action: 'close_and_open',
                oldValue: { closed: current.label, closedAt: current.closedAt },
                newValue: { opened: opened.label, accountsCreated },
            });

            return { archived: current, opened, accountsCreated };
        });
    }

    async createSource(dto: CreateFundingSourceDto, actorId: string): Promise<FundingSource> {
        // Money is raised into the year that is open.
        const activeYear = await this.getActiveYear();
        const source = this.sourceRepo.create({
            ...dto, createdById: actorId, budgetYearId: activeYear.id,
        });
        const saved = await this.sourceRepo.save(source);
        await this.auditService.log({ actorId, entityType: 'FundingSource', entityId: saved.id, action: 'create', newValue: saved });
        return saved;
    }

    /**
     * The funding sources available in a year.
     *
     * That is the year's own sources, plus any earlier source flagged as
     * carrying over. A source from a later year never appears in an earlier
     * one — money cannot be spent before it exists.
     */
    async findSourcesForYear(yearId?: string): Promise<FundingSource[]> {
        const year = await this.resolveYear(yearId);
        return this.sourceRepo
            .createQueryBuilder('s')
            .leftJoin('budget_years', 'y', 'y.id = s.budget_year_id')
            .where('s.budget_year_id = :yearId', { yearId: year.id })
            .orWhere('s.budget_year_id IS NULL')
            .orWhere('s.carries_over = true AND y.year <= :yearNumber', { yearNumber: year.year })
            .orderBy('s.name', 'ASC')
            .getMany();
    }

    findAllSources(): Promise<FundingSource[]> {
        return this.sourceRepo.find({ relations: ['createdBy'], order: { createdAt: 'DESC' } });
    }

    async updateSource(id: string, dto: Partial<CreateFundingSourceDto>, actorId: string): Promise<FundingSource> {
        await this.assertSourceEditable(id, 'Funding source changes', dto);
        const source = await this.sourceRepo.findOne({ where: { id } });
        if (!source) throw new NotFoundException('Funding source not found');
        const old = { ...source };
        Object.assign(source, dto);
        const saved = await this.sourceRepo.save(source);
        await this.auditService.log({ actorId, entityType: 'FundingSource', entityId: id, action: 'update', oldValue: old, newValue: saved });
        return saved;
    }

    async deleteSource(id: string, actorId: string): Promise<void> {
        await this.assertSourceEditable(id, 'Deleting funding sources');
        const source = await this.sourceRepo.findOne({ where: { id } });
        if (!source) throw new NotFoundException('Funding source not found');
        // The join table cascades on delete with no warning otherwise, silently
        // stripping this source's attribution from every account that lists it
        // (with no record of which accounts lost it) — require it be detached first.
        const linkedAccounts = await this.accountRepo.createQueryBuilder('a')
            .innerJoin('a.fundingSources', 'fs', 'fs.id = :id', { id })
            .getCount();
        if (linkedAccounts > 0) {
            throw new ConflictException(
                `Cannot delete: this funding source is linked to ${linkedAccounts} budget account(s). Remove it from those accounts first.`,
            );
        }
        await this.sourceRepo.remove(source);
        await this.auditService.log({ actorId, entityType: 'FundingSource', entityId: id, action: 'delete', oldValue: source });
    }

    /**
     * A source that belongs to a closed year is part of that year's record.
     *
     * One that carries over is different: it is still live in the open year,
     * so it stays editable — otherwise a multi-year award could never be
     * corrected again after its first year ended.
     */
    private async assertSourceEditable(
        id: string,
        what: string,
        dto?: Partial<CreateFundingSourceDto>,
    ): Promise<void> {
        const source = await this.sourceRepo.findOne({ where: { id } });
        if (!source || !source.budgetYearId || source.carriesOver) return;

        // Marking a source as spanning years is a statement about what the
        // award IS, not a change to what a closed year recorded: it moves no
        // money and alters no total. It therefore stays possible after the
        // year closes — otherwise a multi-year award that nobody flagged in
        // time could never be carried forward at all, which is exactly when
        // you discover you need it.
        if (dto && Object.keys(dto).length > 0 && Object.keys(dto).every((k) => k === 'carriesOver')) {
            return;
        }

        await this.assertYearOpen(source.budgetYearId, what);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Budget Accounts
    // ─────────────────────────────────────────────────────────────────────────

    async createAccount(dto: CreateBudgetAccountDto, actorId: string): Promise<BudgetAccount & { balance: number; isExpired: boolean }> {
        // New money always lands in the year that is open.
        const activeYear = await this.getActiveYear();
        const { fundingSourceIds, ...rest } = dto;
        const sources = await this.sourceRepo.findByIds(fundingSourceIds);
        if (sources.length !== fundingSourceIds.length) throw new NotFoundException('One or more funding sources not found');
        const account = this.accountRepo.create(rest);
        account.fundingSources = sources;
        account.budgetYearId = activeYear.id;
        const saved = await this.accountRepo.save(account);
        await this.auditService.log({ actorId, entityType: 'BudgetAccount', entityId: saved.id, action: 'create', newValue: saved });
        // A freshly-created account always has balance === totalAllocated and
        // isExpired === false, but compute both for real rather than assuming,
        // so the response matches the BudgetAccount contract findAllAccounts
        // returns (frontend code relies on both fields always being present).
        return { ...saved, balance: await this.computeAccountBalance(saved.id), isExpired: this.isAccountExpired(saved) };
    }

    async findAllAccounts(yearId?: string): Promise<(BudgetAccount & { balance: number; isExpired: boolean })[]> {
        const year = await this.resolveYear(yearId);
        const accounts = await this.accountRepo.find({
            where: { budgetYearId: year.id },
            relations: ['fundingSources'],
            order: { createdAt: 'DESC' },
        });
        return Promise.all(accounts.map(async (a) => ({
            ...a,
            balance: await this.computeAccountBalance(a.id),
            isExpired: this.isAccountExpired(a),
        })));
    }

    async getAccountBalance(id: string): Promise<{ account: BudgetAccount; balance: number }> {
        const account = await this.accountRepo.findOne({ where: { id }, relations: ['fundingSources'] });
        if (!account) throw new NotFoundException('Budget account not found');
        const balance = await this.computeAccountBalance(id);
        return { account, balance };
    }

    /** True once an account's `expiresAt` date has passed. Null means it never expires. */
    private isAccountExpired(account: Pick<BudgetAccount, 'expiresAt'>): boolean {
        return !!account.expiresAt && new Date(account.expiresAt) < new Date();
    }

    /** Loads an account and throws if it doesn't exist or has expired. */
    private async requireActiveAccount(accountId: string): Promise<BudgetAccount> {
        const account = await this.accountRepo.findOne({ where: { id: accountId } });
        if (!account) throw new NotFoundException('Budget account not found');
        if (this.isAccountExpired(account)) {
            throw new BadRequestException('Budget account has expired and is no longer available');
        }
        return account;
    }

    /**
     * balance = totalAllocated - sum(labor deductions) - sum(expenses on allocations in this account)
     * Pass a transactional `EntityManager` (instead of the default `this.dataSource`) to read
     * through row locks held by the same transaction, rather than a separate connection.
     */
    private async computeAccountBalance(accountId: string, runner: DataSource | EntityManager = this.dataSource): Promise<number> {
        const accountRepo = runner instanceof EntityManager ? runner.getRepository(BudgetAccount) : this.accountRepo;
        const account = await accountRepo.findOne({ where: { id: accountId } });
        if (!account) return 0;
        const allocated = Number(account.totalAllocated) || 0;

        // Sum of labor deductions charged to this account
        const deductionResult = await runner.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM labor_deductions WHERE budget_account_id = $1`,
            [accountId],
        );
        const deductions = Number(deductionResult[0]?.total) || 0;

        // Sum of expenses on allocations belonging to this account
        const expenseResult = await runner.query(
            `SELECT COALESCE(SUM(e.amount), 0) AS total
             FROM expenses e
             JOIN project_budget_allocations pba ON pba.id = e.allocation_id
             WHERE pba.budget_account_id = $1`,
            [accountId],
        );
        const expenses = Number(expenseResult[0]?.total) || 0;

        return allocated - deductions - expenses;
    }

    async updateAccount(id: string, dto: Partial<CreateBudgetAccountDto>, actorId: string): Promise<BudgetAccount & { balance: number; isExpired: boolean }> {
        await this.assertYearOpen(await this.yearIdOfAccount(id), 'Account changes');
        const account = await this.accountRepo.findOne({ where: { id }, relations: ['fundingSources'] });
        if (!account) throw new NotFoundException('Budget account not found');
        const old = { ...account };
        const { fundingSourceIds, ...rest } = dto;
        Object.assign(account, rest);
        if (fundingSourceIds) {
            const sources = await this.sourceRepo.findByIds(fundingSourceIds);
            if (sources.length !== fundingSourceIds.length) throw new NotFoundException('One or more funding sources not found');
            account.fundingSources = sources;
        }
        const saved = await this.accountRepo.save(account);
        await this.auditService.log({ actorId, entityType: 'BudgetAccount', entityId: id, action: 'update', oldValue: old, newValue: saved });
        return { ...saved, balance: await this.computeAccountBalance(saved.id), isExpired: this.isAccountExpired(saved) };
    }

    async deleteAccount(id: string, actorId: string): Promise<void> {
        await this.assertYearOpen(await this.yearIdOfAccount(id), 'Deleting accounts');
        const account = await this.accountRepo.findOne({ where: { id } });
        if (!account) throw new NotFoundException('Budget account not found');
        // Allocations, expenses (via allocations), and labor deductions all
        // cascade-delete from this account with no trace beyond this single
        // audit row otherwise — block deletion while financial history exists
        // instead of silently wiping it.
        const [allocationCount, deductionCount] = await Promise.all([
            this.allocationRepo.count({ where: { budgetAccountId: id } }),
            this.deductionRepo.count({ where: { budgetAccountId: id } }),
        ]);
        if (allocationCount > 0 || deductionCount > 0) {
            throw new ConflictException(
                `Cannot delete: this account has ${allocationCount} project allocation(s) and ${deductionCount} labor deduction(s) on record. Remove or reassign them first.`,
            );
        }
        await this.accountRepo.remove(account);
        await this.auditService.log({ actorId, entityType: 'BudgetAccount', entityId: id, action: 'delete', oldValue: account });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Project Allocations
    // ─────────────────────────────────────────────────────────────────────────

    async createAllocation(dto: CreateProjectAllocationDto, actorId: string): Promise<ProjectBudgetAllocation> {
        await this.assertYearOpen(await this.yearIdOfAccount(dto.budgetAccountId), 'Allocations');
        await this.requireActiveAccount(dto.budgetAccountId);
        const allocation = this.allocationRepo.create({ ...dto, createdById: actorId });
        const saved = await this.allocationRepo.save(allocation);
        await this.auditService.log({ actorId, entityType: 'ProjectBudgetAllocation', entityId: saved.id, action: 'create', newValue: saved });
        return saved;
    }

    async findAllocations(projectId?: string, yearId?: string): Promise<(ProjectBudgetAllocation & { spent: number; balance: number })[]> {
        const where: any = {};
        if (projectId) where.projectId = projectId;
        const allocations = await this.allocationRepo.find({
            where,
            relations: ['budgetAccount', 'budgetAccount.fundingSources', 'project', 'createdBy'],
            order: { createdAt: 'DESC' },
        });
        const scoped = yearId === undefined
            ? allocations
            : await (async () => {
                const year = await this.resolveYear(yearId);
                const ids = (await this.accountRepo.find({ where: { budgetYearId: year.id } })).map(x => x.id);
                return allocations.filter(a => ids.includes(a.budgetAccountId));
            })();
        return Promise.all(scoped.map(async (a) => {
            const spent = await this.computeAllocationSpent(a.id);
            return { ...a, spent, balance: Number(a.allocatedAmount) - spent };
        }));
    }

    private async computeAllocationSpent(allocationId: string, runner: DataSource | EntityManager = this.dataSource): Promise<number> {
        const result = await runner.query(
            `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE allocation_id = $1`,
            [allocationId],
        );
        return Number(result[0]?.total) || 0;
    }

    async updateAllocation(id: string, dto: Partial<CreateProjectAllocationDto>, actorId: string): Promise<ProjectBudgetAllocation> {
        await this.assertYearOpen(await this.yearIdOfAllocation(id), 'Allocation changes');
        const allocation = await this.allocationRepo.findOne({ where: { id } });
        if (!allocation) throw new NotFoundException('Allocation not found');
        // Any change that touches money (moving the allocation to a different
        // account, or changing how much is allocated) must go through the same
        // "account must exist and not be expired" check createAllocation applies —
        // otherwise an update could silently move an allocation onto an expired
        // or nonexistent account.
        if (dto.budgetAccountId !== undefined || dto.allocatedAmount !== undefined) {
            await this.requireActiveAccount(dto.budgetAccountId ?? allocation.budgetAccountId);
        }
        const old = { ...allocation };
        Object.assign(allocation, dto);
        const saved = await this.allocationRepo.save(allocation);
        await this.auditService.log({ actorId, entityType: 'ProjectBudgetAllocation', entityId: id, action: 'update', oldValue: old, newValue: saved });
        return saved;
    }

    async deleteAllocation(id: string, actorId: string): Promise<void> {
        await this.assertYearOpen(await this.yearIdOfAllocation(id), 'Deleting allocations');
        const allocation = await this.allocationRepo.findOne({ where: { id } });
        if (!allocation) throw new NotFoundException('Allocation not found');
        // Expenses cascade-delete from this allocation with no trace beyond this
        // single audit row otherwise — block deletion while expense history exists.
        const expenseCount = await this.expenseRepo.count({ where: { allocationId: id } });
        if (expenseCount > 0) {
            throw new ConflictException(
                `Cannot delete: this allocation has ${expenseCount} expense(s) recorded against it. Remove them first.`,
            );
        }
        await this.allocationRepo.remove(allocation);
        await this.auditService.log({ actorId, entityType: 'ProjectBudgetAllocation', entityId: id, action: 'delete', oldValue: allocation });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Transfers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Which side (account vs. allocation) each transfer type moves money from/to.
     * `createTransfer` uses this to require exactly the two ids a given type
     * needs and reject any others — previously all four ids were independently
     * optional with no cross-check, so a request could (a) omit the destination
     * entirely while still recording a "successful" transfer, (b) populate both
     * an account leg AND an allocation leg under one transferType and silently
     * move money through both, or (c) declare `account_to_project`/
     * `project_to_account` — whose destination was never credited by the old
     * from-account-shaped / from-allocation-shaped branching below — and have
     * the source debited with the money going nowhere.
     */
    private static readonly TRANSFER_SHAPE: Record<CreateTransferDto['transferType'], { from: 'account' | 'allocation'; to: 'account' | 'allocation' }> = {
        account_to_account: { from: 'account', to: 'account' },
        project_to_project: { from: 'allocation', to: 'allocation' },
        account_to_project: { from: 'account', to: 'allocation' },
        project_to_account: { from: 'allocation', to: 'account' },
    };

    async createTransfer(dto: CreateTransferDto, actorId: string): Promise<BudgetTransfer> {
        // Both ends have to be in the open year — a transfer into a closed
        // year would rewrite a total that has already been reported.
        if (dto.fromAccountId) await this.assertYearOpen(await this.yearIdOfAccount(dto.fromAccountId), 'Transfers');
        if (dto.toAccountId) await this.assertYearOpen(await this.yearIdOfAccount(dto.toAccountId), 'Transfers');
        if (dto.fromAllocationId) await this.assertYearOpen(await this.yearIdOfAllocation(dto.fromAllocationId), 'Transfers');
        if (dto.toAllocationId) await this.assertYearOpen(await this.yearIdOfAllocation(dto.toAllocationId), 'Transfers');
        if (dto.amount <= 0) throw new BadRequestException('Transfer amount must be positive');

        const shape = BudgetService.TRANSFER_SHAPE[dto.transferType];
        const fromAccountId    = shape.from === 'account'    ? dto.fromAccountId    : undefined;
        const fromAllocationId = shape.from === 'allocation' ? dto.fromAllocationId : undefined;
        const toAccountId      = shape.to   === 'account'    ? dto.toAccountId      : undefined;
        const toAllocationId   = shape.to   === 'allocation' ? dto.toAllocationId   : undefined;

        if (shape.from === 'account'    && !fromAccountId)    throw new BadRequestException(`fromAccountId is required for transfer type '${dto.transferType}'`);
        if (shape.from === 'allocation' && !fromAllocationId) throw new BadRequestException(`fromAllocationId is required for transfer type '${dto.transferType}'`);
        if (shape.to   === 'account'    && !toAccountId)      throw new BadRequestException(`toAccountId is required for transfer type '${dto.transferType}'`);
        if (shape.to   === 'allocation' && !toAllocationId)   throw new BadRequestException(`toAllocationId is required for transfer type '${dto.transferType}'`);
        // Reject ids that don't belong to this transfer type at all, so a request
        // can't move money through a second, unrecorded leg alongside the declared one.
        if (shape.from !== 'account'    && dto.fromAccountId)    throw new BadRequestException(`fromAccountId is not valid for transfer type '${dto.transferType}'`);
        if (shape.from !== 'allocation' && dto.fromAllocationId) throw new BadRequestException(`fromAllocationId is not valid for transfer type '${dto.transferType}'`);
        if (shape.to   !== 'account'    && dto.toAccountId)      throw new BadRequestException(`toAccountId is not valid for transfer type '${dto.transferType}'`);
        if (shape.to   !== 'allocation' && dto.toAllocationId)   throw new BadRequestException(`toAllocationId is not valid for transfer type '${dto.transferType}'`);
        if (fromAccountId && fromAccountId === toAccountId) throw new BadRequestException('Source and destination account cannot be the same');
        if (fromAllocationId && fromAllocationId === toAllocationId) throw new BadRequestException('Source and destination allocation cannot be the same');

        // Everything below runs in one transaction with the touched rows locked
        // for the duration: without this, two concurrent transfers could both
        // read a sufficient balance before either debit lands (overdrawing the
        // source), and a failure partway through (e.g. the destination-side
        // check throwing after the source was already debited) would leave the
        // debit permanently applied with no BudgetTransfer record of where the
        // money went.
        return this.dataSource.transaction(async (manager) => {
            const accountRepo = manager.getRepository(BudgetAccount);
            const allocationRepo = manager.getRepository(ProjectBudgetAllocation);

            const lockedAllocations = new Map<string, ProjectBudgetAllocation>();
            for (const id of [fromAccountId, toAccountId].filter((x): x is string => !!x)) {
                const acct = await accountRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
                if (!acct) throw new NotFoundException('Budget account not found');
                if (this.isAccountExpired(acct)) throw new BadRequestException('Budget account has expired and is no longer available');
            }
            for (const id of [fromAllocationId, toAllocationId].filter((x): x is string => !!x)) {
                const alloc = await allocationRepo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' }, relations: ['budgetAccount'] });
                if (!alloc) throw new NotFoundException('Allocation not found');
                if (this.isAccountExpired(alloc.budgetAccount)) throw new BadRequestException('Budget account has expired and is no longer available');
                lockedAllocations.set(id, alloc);
            }

            if (fromAccountId) {
                const bal = await this.computeAccountBalance(fromAccountId, manager);
                if (bal < dto.amount) {
                    throw new BadRequestException(`Insufficient balance in source account (available: $${bal.toFixed(2)})`);
                }
            }
            if (fromAllocationId) {
                const fromAlloc = lockedAllocations.get(fromAllocationId)!;
                const spent = await this.computeAllocationSpent(fromAllocationId, manager);
                const available = Number(fromAlloc.allocatedAmount) - spent;
                if (available < dto.amount) {
                    throw new BadRequestException(`Insufficient balance in source allocation (available: $${available.toFixed(2)})`);
                }
            }

            // Apply exactly one debit and one credit — the pair this type declares.
            if (fromAccountId)    await accountRepo.decrement({ id: fromAccountId }, 'totalAllocated', dto.amount);
            if (toAccountId)      await accountRepo.increment({ id: toAccountId }, 'totalAllocated', dto.amount);
            if (fromAllocationId) await allocationRepo.decrement({ id: fromAllocationId }, 'allocatedAmount', dto.amount);
            if (toAllocationId)   await allocationRepo.increment({ id: toAllocationId }, 'allocatedAmount', dto.amount);

            const transferRepo = manager.getRepository(BudgetTransfer);
            const transfer = transferRepo.create({ ...dto, performedById: actorId });
            const saved = await transferRepo.save(transfer);
            await this.auditService.log({
                actorId,
                entityType: 'BudgetTransfer',
                entityId: saved.id,
                action: 'create',
                newValue: { ...dto, performedById: actorId },
            });
            return saved;
        });
    }

    async findTransfersForYear(yearId?: string): Promise<BudgetTransfer[]> {
        const year = await this.resolveYear(yearId);
        return this.dataSource.query(
            `SELECT t.* FROM budget_transfers t
              WHERE COALESCE(
                        (SELECT a.budget_year_id FROM budget_accounts a WHERE a.id = t.from_account_id),
                        (SELECT a.budget_year_id FROM budget_accounts a WHERE a.id = t.to_account_id),
                        (SELECT a.budget_year_id FROM budget_accounts a
                          JOIN project_budget_allocations p ON p.budget_account_id = a.id
                         WHERE p.id = t.from_allocation_id),
                        (SELECT a.budget_year_id FROM budget_accounts a
                          JOIN project_budget_allocations p ON p.budget_account_id = a.id
                         WHERE p.id = t.to_allocation_id)
                    ) = $1
              ORDER BY t.created_at DESC`,
            [year.id],
        );
    }

    findAllTransfers(): Promise<BudgetTransfer[]> {
        return this.transferRepo.find({
            relations: ['fromAccount', 'toAccount', 'fromAllocation', 'toAllocation', 'performedBy',
                'fromAllocation.project', 'toAllocation.project'],
            order: { createdAt: 'DESC' },
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Expenses
    // ─────────────────────────────────────────────────────────────────────────

    async createExpense(dto: CreateExpenseDto, actorId: string): Promise<Expense> {
        await this.assertYearOpen(await this.yearIdOfAllocation(dto.allocationId), 'Expenses');
        const allocation = await this.allocationRepo.findOne({
            where: { id: dto.allocationId },
            relations: ['budgetAccount'],
        });
        if (!allocation) throw new NotFoundException('Allocation not found');
        if (this.isAccountExpired(allocation.budgetAccount)) {
            throw new BadRequestException('Budget account has expired and is no longer available');
        }
        // Expense.projectId is a separate column from the allocation's own
        // projectId — without this check they can diverge, which makes
        // project-scoped reports (spend computed from allocations vs. from
        // expenses.project_id directly) disagree about the same expense.
        if (dto.projectId !== allocation.projectId) {
            throw new BadRequestException("projectId does not match the allocation's project");
        }
        const expense = this.expenseRepo.create({ ...dto, recordedById: actorId });
        const saved = await this.expenseRepo.save(expense);
        await this.auditService.log({ actorId, entityType: 'Expense', entityId: saved.id, action: 'create', newValue: saved });
        return saved;
    }

    /** A year's expenses, reached through the allocations of its accounts. */
    async findExpensesForYear(yearId?: string): Promise<Expense[]> {
        const year = await this.resolveYear(yearId);
        return this.expenseRepo
            .createQueryBuilder('e')
            .leftJoinAndSelect('e.allocation', 'allocation')
            .leftJoinAndSelect('e.project', 'project')
            .leftJoin('budget_accounts', 'a', 'a.id = allocation.budget_account_id')
            .where('a.budget_year_id = :yearId', { yearId: year.id })
            .orderBy('e.created_at', 'DESC')
            .getMany();
    }

    findExpenses(projectId?: string, allocationId?: string): Promise<Expense[]> {
        const where: any = {};
        if (projectId) where.projectId = projectId;
        if (allocationId) where.allocationId = allocationId;
        return this.expenseRepo.find({
            where,
            relations: ['project', 'allocation', 'allocation.budgetAccount', 'recordedBy'],
            order: { expenseDate: 'DESC' },
        });
    }

    async updateExpense(id: string, dto: Partial<CreateExpenseDto>, actorId: string): Promise<Expense> {
        const target = await this.expenseRepo.findOne({ where: { id } });
        if (target) await this.assertYearOpen(await this.yearIdOfAllocation(target.allocationId), 'Expense changes');
        const expense = await this.expenseRepo.findOne({ where: { id } });
        if (!expense) throw new NotFoundException('Expense not found');
        // Same money-relevant checks as createExpense: re-pointing an expense at
        // a different allocation, or changing its amount, must not be able to
        // land it on an expired account or a mismatched project.
        if (dto.allocationId !== undefined || dto.amount !== undefined) {
            const allocation = await this.allocationRepo.findOne({
                where: { id: dto.allocationId ?? expense.allocationId },
                relations: ['budgetAccount'],
            });
            if (!allocation) throw new NotFoundException('Allocation not found');
            if (this.isAccountExpired(allocation.budgetAccount)) {
                throw new BadRequestException('Budget account has expired and is no longer available');
            }
            const projectId = dto.projectId ?? expense.projectId;
            if (projectId !== allocation.projectId) {
                throw new BadRequestException("projectId does not match the allocation's project");
            }
        }
        const old = { ...expense };
        Object.assign(expense, dto);
        const saved = await this.expenseRepo.save(expense);
        await this.auditService.log({ actorId, entityType: 'Expense', entityId: id, action: 'update', oldValue: old, newValue: saved });
        return saved;
    }

    async deleteExpense(id: string, actorId: string): Promise<void> {
        const doomed = await this.expenseRepo.findOne({ where: { id } });
        if (doomed) await this.assertYearOpen(await this.yearIdOfAllocation(doomed.allocationId), 'Deleting expenses');
        const expense = await this.expenseRepo.findOne({ where: { id } });
        if (!expense) throw new NotFoundException('Expense not found');
        await this.expenseRepo.remove(expense);
        await this.auditService.log({ actorId, entityType: 'Expense', entityId: id, action: 'delete', oldValue: expense });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Labor Deductions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Create a labor deduction from an approved weekly report.
     * Called by ReportsService on approval when laborAccountId is provided.
     */
    async createLaborDeduction(dto: LaborDeductDto, actorId: string): Promise<LaborDeduction> {
        await this.assertYearOpen(await this.yearIdOfAccount(dto.budgetAccountId), 'Labor deductions');
        // Prevent duplicate deductions for the same report
        const existing = await this.deductionRepo.findOne({
            where: { weeklyReportId: dto.weeklyReportId, budgetAccountId: dto.budgetAccountId },
        });
        if (existing) throw new ConflictException('Labor deduction already exists for this report and account');

        const account = await this.accountRepo.findOne({ where: { id: dto.budgetAccountId } });
        if (!account) throw new NotFoundException('Budget account not found');
        if (account.category !== 'Labor') {
            throw new BadRequestException('Selected budget account is not a Labor account');
        }
        if (this.isAccountExpired(account)) {
            throw new BadRequestException('Budget account has expired and is no longer available');
        }

        // Fetch the report and user data via raw query to avoid circular imports
        const reportRows = await this.dataSource.query(
            `SELECT wr.total_hours, wr.user_id, wr.week_start, u.hourly_rate
             FROM weekly_reports wr
             JOIN users u ON u.id = wr.user_id
             WHERE wr.id = $1`,
            [dto.weeklyReportId],
        );
        if (!reportRows.length) throw new NotFoundException('Weekly report not found');
        const row = reportRows[0];
        const hours = Number(row.total_hours) || 0;
        const hourlyRate = Number(row.hourly_rate) || 0;
        if (hourlyRate === 0) throw new BadRequestException('Employee has no hourly rate set. Please set an hourly rate before deducting labor costs.');

        const amount = parseFloat((hours * hourlyRate).toFixed(2));

        const deduction = this.deductionRepo.create({
            weeklyReportId: dto.weeklyReportId,
            userId: row.user_id,
            budgetAccountId: dto.budgetAccountId,
            hours,
            hourlyRate,
            amount,
            weekStart: row.week_start,
        });
        const saved = await this.deductionRepo.save(deduction);
        await this.auditService.log({
            actorId,
            entityType: 'LaborDeduction',
            entityId: saved.id,
            action: 'create',
            newValue: saved,
        });
        return saved;
    }

    /** A year's labor deductions, reached through its accounts. */
    async findLaborDeductionsForYear(yearId?: string): Promise<LaborDeduction[]> {
        const year = await this.resolveYear(yearId);
        return this.deductionRepo
            .createQueryBuilder('d')
            .leftJoinAndSelect('d.user', 'user')
            .leftJoinAndSelect('d.budgetAccount', 'budgetAccount')
            .where('budgetAccount.budget_year_id = :yearId', { yearId: year.id })
            .orderBy('d.created_at', 'DESC')
            .getMany();
    }

    findLaborDeductions(): Promise<LaborDeduction[]> {
        return this.deductionRepo.find({
            relations: ['user', 'budgetAccount', 'budgetAccount.fundingSources'],
            order: { createdAt: 'DESC' },
        });
    }

    /** Compute sustainability metrics based on ACTUAL submitted report hours from payroll members */
    /**
     * Labor runway for a single budget year.
     *
     * This was reading every labor account and every deduction ever recorded,
     * so a freshly opened year showed the previous year's pool, its balance
     * and an exhaustion date — figures that belong to a closed year and say
     * nothing about the money available now. Every part of it is scoped to
     * the year being viewed: the pools, the burn rate it is divided by, and
     * the totals underneath.
     */
    async getLaborSustainability(yearId?: string): Promise<{
        pools: {
            accountId: string;
            accountName: string;
            fundingSource: string;
            balance: number;
            monthlyBurnRate: number;
            runwayMonths: number | null;
            projectedExhaustionDate: string | null;
        }[];
        totalMonthlyBurnRate: number;
        totalDeducted: number;
        totalHours: number;
        deductionCount: number;
        activeMembers: number;
    }> {
        // ── Aggregate totals from actual deductions ───────────────────────
        const year = await this.resolveYear(yearId);
        const totalsRow: { total_amount: string; total_hours: string; cnt: string }[] =
            await this.dataSource.query(
                `SELECT COALESCE(SUM(d.amount), 0) AS total_amount,
                        COALESCE(SUM(d.hours), 0)  AS total_hours,
                        COUNT(*)                   AS cnt
                 FROM labor_deductions d
                 JOIN budget_accounts a ON a.id = d.budget_account_id
                WHERE a.budget_year_id = $1`,
                [year.id],
            );
        const totalDeducted = Number(totalsRow[0]?.total_amount) || 0;
        const totalHours = Number(totalsRow[0]?.total_hours) || 0;
        const deductionCount = Number(totalsRow[0]?.cnt) || 0;

        // ── Active payroll pool members (active users only) ───────────────
        const activeMembersCount = await this.poolMemberRepo
            .createQueryBuilder('m')
            .leftJoin('m.user', 'u')
            .where('m.end_date IS NULL AND u.is_active = true')
            .getCount();

        // ── Monthly burn rate: average of months that have actual data ────
        const monthlyRows: { month: string; total: string }[] = await this.dataSource.query(
            `SELECT TO_CHAR(DATE_TRUNC('month', d.created_at), 'YYYY-MM') AS month,
                    SUM(d.amount) AS total
             FROM labor_deductions d
             JOIN budget_accounts a ON a.id = d.budget_account_id
            WHERE a.budget_year_id = $1
            GROUP BY month
            ORDER BY month`,
            [year.id],
        );

        let totalMonthlyBurnRate = 0;
        if (monthlyRows.length > 0) {
            const totalSpend = monthlyRows.reduce((s, r) => s + Number(r.total), 0);
            totalMonthlyBurnRate = totalSpend / monthlyRows.length;
        }

        // ── Per-account pool sustainability ───────────────────────────────
        const laborAccounts = await this.accountRepo.find({
            where: { category: 'Labor', budgetYearId: year.id },
            relations: ['fundingSources'],
        });

        const pools = await Promise.all(laborAccounts.map(async (a) => {
            const balance = await this.computeAccountBalance(a.id);
            // Each pool's own burn rate — averaged over months THIS account has
            // deductions in, not the blended rate across every Labor account.
            // Reusing the blended total here (as before) meant a low-burn pool's
            // runway was dragged down by a high-burn pool's spend and vice versa.
            const acctMonthlyRows: { month: string; total: string }[] = await this.dataSource.query(
                `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
                        SUM(amount) AS total
                 FROM labor_deductions
                 WHERE budget_account_id = $1
                 GROUP BY month
                 ORDER BY month`,
                [a.id],
            );
            let monthlyBurnRate = 0;
            if (acctMonthlyRows.length > 0) {
                const acctTotalSpend = acctMonthlyRows.reduce((s, r) => s + Number(r.total), 0);
                monthlyBurnRate = acctTotalSpend / acctMonthlyRows.length;
            }
            const runwayMonths = monthlyBurnRate > 0 ? balance / monthlyBurnRate : null;
            let projectedExhaustionDate: string | null = null;
            if (runwayMonths !== null) {
                const d = new Date();
                d.setDate(d.getDate() + runwayMonths * 30);
                projectedExhaustionDate = d.toISOString().split('T')[0];
            }
            return {
                accountId: a.id,
                accountName: a.name,
                fundingSource: (a.fundingSources ?? []).map(s => s.name).join(', ') || '',
                balance,
                monthlyBurnRate,
                runwayMonths,
                projectedExhaustionDate,
            };
        }));

        return {
            pools,
            totalMonthlyBurnRate,
            totalDeducted,
            totalHours,
            deductionCount,
            activeMembers: activeMembersCount,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Labor Pool Members (Payroll)
    // ─────────────────────────────────────────────────────────────────────────

    getPoolMembers(budgetAccountId?: string) {
        const qb = this.poolMemberRepo
            .createQueryBuilder('m')
            .leftJoinAndSelect('m.user', 'u')
            .leftJoinAndSelect('m.budgetAccount', 'ba')
            .leftJoinAndSelect('m.createdBy', 'cb')
            .where('u.is_active = true')   // never show deactivated accounts
            .orderBy('m.created_at', 'DESC');
        if (budgetAccountId) qb.andWhere('m.budget_account_id = :budgetAccountId', { budgetAccountId });
        return qb.getMany();
    }

    async addPoolMember(
        dto: { userId: string; budgetAccountId: string; startDate: string; endDate?: string | null },
        actorId: string,
    ) {
        // Validate user is active
        const user = await this.dataSource.getRepository(User).findOne({ where: { id: dto.userId } });
        if (!user) throw new NotFoundException('User not found');
        if (!user.isActive) throw new BadRequestException('Cannot add a deactivated user to the payroll pool');

        // Prevent duplicate active membership in same account
        const existing = await this.poolMemberRepo.findOne({
            where: { userId: dto.userId, budgetAccountId: dto.budgetAccountId, endDate: null as any },
        });
        if (existing) throw new ConflictException('Employee is already an active member of this labor pool.');

        const account = await this.accountRepo.findOne({ where: { id: dto.budgetAccountId } });
        if (!account) throw new NotFoundException('Budget account not found');
        if (account.category !== 'Labor') throw new BadRequestException('Account must be a Labor account');

        const member = this.poolMemberRepo.create({
            userId: dto.userId,
            budgetAccountId: dto.budgetAccountId,
            startDate: dto.startDate,
            endDate: dto.endDate ?? null,
            createdById: actorId,
        });
        return this.poolMemberRepo.save(member);
    }

    async removePoolMember(id: string, endDate?: string) {
        const member = await this.poolMemberRepo.findOne({ where: { id } });
        if (!member) throw new NotFoundException('Pool member not found');
        member.endDate = endDate ?? new Date().toISOString().split('T')[0];
        return this.poolMemberRepo.save(member);
    }

    async deletePoolMember(id: string) {
        const member = await this.poolMemberRepo.findOne({ where: { id } });
        if (!member) throw new NotFoundException('Pool member not found');
        await this.poolMemberRepo.remove(member);
    }



    // ─────────────────────────────────────────────────────────────────────────
    // Overview & Reports
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Everything the dashboard shows, for one budget year.
     *
     * The headline figures come from `yearTotals` — the same method the year
     * list uses — and the per-account rows are built from the same ledger, so
     * the cards, the table and the charts cannot disagree with each other.
     * The totals used to be summed two different ways (accounts one by one
     * for the balance, whole tables for labor and expenses), which agreed
     * only as long as every expense's allocation still existed.
     */
    async getOverview(yearId?: string): Promise<any> {
        const year = await this.resolveYear(yearId);
        const sources = (await this.findSourcesForYear(year.id)).length;
        const accounts = await this.accountRepo.find({
            where: { budgetYearId: year.id },
            relations: ['fundingSources'],
        });

        const accountSummaries: any[] = [];
        for (const a of accounts) {
            const balance = await this.computeAccountBalance(a.id);
            accountSummaries.push({
                id: a.id,
                name: a.name,
                category: a.category,
                fundingSource: (a.fundingSources ?? []).map(s => s.name).join(', ') || '',
                totalAllocated: a.totalAllocated,
                balance,
            });
        }

        const totals = await this.yearTotals(year.id);

        return {
            sourcesCount: sources,
            year: {
                id: year.id, year: year.year, label: year.label, status: year.status,
                openedAt: year.openedAt, closedAt: year.closedAt,
                readOnly: year.status !== 'active',
            },
            totalAllocated: totals.totalAllocated,
            totalBalance: totals.totalBalance,
            totalLaborDeducted: totals.totalLaborDeducted,
            totalExpenses: totals.totalExpenses,
            accountSummaries,
        };
    }

    async getProjectBudgetReport(projectId: string): Promise<any> {
        const allocations = await this.findAllocations(projectId);
        const expenses = await this.findExpenses(projectId);
        const totalAllocated = allocations.reduce((s, a) => s + Number(a.allocatedAmount), 0);
        const totalSpent = allocations.reduce((s, a) => s + a.spent, 0);
        const balance = totalAllocated - totalSpent;
        return { projectId, allocations, expenses, totalAllocated, totalSpent, balance };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Export
    // ─────────────────────────────────────────────────────────────────────────

    async exportCsv(type: 'overview' | 'expenses' | 'labor', projectId?: string): Promise<string> {
        if (type === 'expenses') {
            const rows = await this.findExpenses(projectId);
            const lines = ['Date,Project,Description,Category,Amount,Vendor,Recorded By'];
            for (const r of rows) {
                const proj = (r.project as any)?.name ?? '';
                const rec = (r.recordedBy as any)?.fullName ?? '';
                lines.push([r.expenseDate, proj, `"${r.description}"`, r.category, r.amount, r.vendor ?? '', rec].join(','));
            }
            return lines.join('\n');
        }
        if (type === 'labor') {
            const rows = await this.findLaborDeductions();
            const lines = ['Week Start,Employee,Hours,Hourly Rate,Amount,Pool'];
            for (const r of rows) {
                const emp = (r.user as any)?.fullName ?? '';
                const pool = (r.budgetAccount as any)?.name ?? '';
                lines.push([r.weekStart, emp, r.hours, r.hourlyRate, r.amount, pool].join(','));
            }
            return lines.join('\n');
        }
        // overview
        const ov = await this.getOverview();
        const lines = ['Metric,Value'];
        lines.push(`Total Allocated,$${Number(ov.totalAllocated).toFixed(2)}`);
        lines.push(`Total Balance,$${Number(ov.totalBalance).toFixed(2)}`);
        lines.push(`Total Labor Deducted,$${Number(ov.totalLaborDeducted).toFixed(2)}`);
        lines.push(`Total Expenses,$${Number(ov.totalExpenses).toFixed(2)}`);
        lines.push('');
        lines.push('Account,Category,Funding Source,Allocated,Balance');
        for (const a of ov.accountSummaries) {
            lines.push([a.name, a.category, a.fundingSource ?? '', `$${Number(a.totalAllocated).toFixed(2)}`, `$${Number(a.balance).toFixed(2)}`].join(','));
        }
        return lines.join('\n');
    }

    async exportPdf(type: 'overview' | 'expenses' | 'labor', projectId?: string): Promise<Buffer> {
        const doc = await PDFDocument.create();
        const page = doc.addPage([612, 792]);
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const bold = await doc.embedFont(StandardFonts.HelveticaBold);
        const { width, height } = page.getSize();
        let y = height - 50;

        const draw = (text: string, x: number, size = 11, isBold = false) => {
            page.drawText(this.pdfSafe(text), { x, y, size, font: isBold ? bold : font, color: rgb(0.1, 0.1, 0.1) });
        };

        const title = type === 'overview' ? 'Budget Overview Report'
            : type === 'expenses' ? 'Expenses Report'
                : 'Labor Costs Report';
        draw(title, 50, 18, true); y -= 30;
        draw(`Generated: ${new Date().toLocaleDateString()}`, 50, 10); y -= 30;

        if (type === 'overview') {
            const ov = await this.getOverview();
            draw(`Total Allocated: $${Number(ov.totalAllocated).toFixed(2)}`, 50, 12); y -= 18;
            draw(`Current Balance: $${Number(ov.totalBalance).toFixed(2)}`, 50, 12); y -= 18;
            draw(`Total Labor Deducted: $${Number(ov.totalLaborDeducted).toFixed(2)}`, 50, 12); y -= 18;
            draw(`Total Expenses: $${Number(ov.totalExpenses).toFixed(2)}`, 50, 12); y -= 30;
            draw('Budget Accounts', 50, 14, true); y -= 20;
            for (const a of ov.accountSummaries) {
                if (y < 60) break;
                draw(`${a.name}  |  ${a.category}  |  ${a.fundingSource ?? '—'}  |  Allocated: $${Number(a.totalAllocated).toFixed(2)}  |  Balance: $${Number(a.balance).toFixed(2)}`, 50, 10);
                y -= 16;
            }
        } else if (type === 'expenses') {
            const rows = await this.findExpenses(projectId);
            draw('Date          Project               Description                    Category     Amount', 40, 9, true); y -= 16;
            for (const r of rows) {
                if (y < 60) break;
                const proj = (r.project as any)?.name ?? '';
                const line = `${r.expenseDate}  ${this.pdfSafe(proj).padEnd(20)}  ${this.pdfSafe(r.description).substring(0, 28).padEnd(30)}  ${r.category.padEnd(12)}  $${Number(r.amount).toFixed(2)}`;
                draw(line, 40, 8); y -= 14;
            }
        } else {
            const rows = await this.findLaborDeductions();
            draw('Week          Employee              Hours   Rate        Amount       Pool', 40, 9, true); y -= 16;
            for (const r of rows) {
                if (y < 60) break;
                const emp = (r.user as any)?.fullName ?? '';
                const pool = (r.budgetAccount as any)?.name ?? '';
                const line = `${r.weekStart}  ${this.pdfSafe(emp).substring(0, 20).padEnd(22)}  ${String(r.hours).padEnd(6)}  $${Number(r.hourlyRate).toFixed(2).padEnd(10)}  $${Number(r.amount).toFixed(2).padEnd(10)}  ${this.pdfSafe(pool)}`;
                draw(line, 40, 8); y -= 14;
            }
        }

        const bytes = await doc.save();
        return Buffer.from(bytes);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Account Report (JSON + PDF)
    // ─────────────────────────────────────────────────────────────────────────

    async getAccountReport(accountId: string): Promise<{
        account: BudgetAccount & { balance: number };
        allocations: (ProjectBudgetAllocation & { spent: number; balance: number; project: any })[];
        expenses: Expense[];
        laborDeductions: LaborDeduction[];
        totalExpenses: number;
        totalLabor: number;
        totalSpent: number;
    }> {
        const account = await this.accountRepo.findOne({ where: { id: accountId }, relations: ['fundingSources'] });
        if (!account) throw new NotFoundException('Budget account not found');
        const balance = await this.computeAccountBalance(accountId);

        const allocations = await this.allocationRepo.find({
            where: { budgetAccountId: accountId },
            relations: ['project', 'createdBy'],
            order: { createdAt: 'DESC' },
        });
        const allocsWithBalances = await Promise.all(allocations.map(async (a) => {
            const spent = await this.computeAllocationSpent(a.id);
            return { ...a, spent, balance: Number(a.allocatedAmount) - spent };
        }));

        const allocationIds = allocations.map(a => a.id);
        let expenses: Expense[] = [];
        if (allocationIds.length > 0) {
            expenses = await this.expenseRepo.find({
                where: { allocationId: In(allocationIds) },
                relations: ['project', 'allocation', 'recordedBy'],
                order: { expenseDate: 'DESC' },
            });
        }

        const laborDeductions = await this.deductionRepo.find({
            where: { budgetAccountId: accountId },
            relations: ['user'],
            order: { weekStart: 'DESC' },
        });

        const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
        const totalLabor = laborDeductions.reduce((s, d) => s + Number(d.amount), 0);
        const totalSpent = totalExpenses + totalLabor;

        return {
            account: { ...account, balance },
            allocations: allocsWithBalances,
            expenses,
            laborDeductions,
            totalExpenses,
            totalLabor,
            totalSpent,
        };
    }

    async exportAccountPdf(accountId: string, includeAllocations = true): Promise<Buffer> {
        const data = await this.getAccountReport(accountId);
        const { account, allocations, expenses, laborDeductions, totalExpenses, totalLabor, totalSpent } = data;

        const doc   = await PDFDocument.create();
        const font  = await doc.embedFont(StandardFonts.Helvetica);
        const bold  = await doc.embedFont(StandardFonts.HelveticaBold);

        const W = 595, M = 45, CONTENT_W = W - M * 2;
        const HEADER_H = 90, FOOTER_H = 45;

        // ── Measure content height ────────────────────────────────────────
        const ROW_H_ALLOC = 22, ROW_H_EXP = 18, ROW_H_LABOR = 18;
        let contentH = 0;
        contentH += 44 + 14;          // KPI cards (40h card + 4h top bar) + gap
        if (includeAllocations) {
            contentH += 24;               // allocations banner
            contentH += allocations.length > 0 ? 16 + allocations.length * ROW_H_ALLOC + 18 : 22;
            contentH += 14;               // section gap
        }
        contentH += 24;               // expenses banner
        contentH += expenses.length   > 0 ? 16 + expenses.length   * ROW_H_EXP   + 18 : 22;
        contentH += 14;
        contentH += 24;               // labor banner
        contentH += laborDeductions.length > 0 ? 16 + laborDeductions.length * ROW_H_LABOR + 18 : 22;
        contentH += 16;
        contentH += 50;               // grand total box

        const PAGE_H = Math.max(842, Math.ceil(HEADER_H + 16 + contentH + FOOTER_H + 8));

        // ── Load stamp ────────────────────────────────────────────────────
        let stampImage: any = null;
        try {
            stampImage = await doc.embedPng(
                fs.readFileSync(path.resolve(__dirname, '..', '..', 'assets', 'stamp.png')));
        } catch { /* stamp optional */ }

        const page = doc.addPage([W, PAGE_H]);

        if (stampImage) {
            const STAMP_SZ = 78;
            page.drawImage(stampImage, {
                x: W - STAMP_SZ - 32, y: 48,
                width: STAMP_SZ, height: STAMP_SZ,
                rotate: degrees(-12), opacity: 0.88,
            });
        }

        // ── HEADER BAND ───────────────────────────────────────────────────
        page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: W, height: HEADER_H, color: rgb(0.12, 0.16, 0.32) });
        page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: 5, height: HEADER_H, color: rgb(0.20, 0.58, 0.55) });
        page.drawText('AI/ML Lab Portal', { x: M, y: PAGE_H - 20, size: 8, font, color: rgb(0.70, 0.78, 0.92) });
        page.drawText(this.pdfSafe(account.name), { x: M, y: PAGE_H - 40, size: 18, font: bold, color: rgb(1, 1, 1) });
        const catLabel   = account.category === 'Labor' ? 'Labor Pool Account' : 'Project Spending Account';
        const fundingStr = ((account as any).fundingSources ?? []).map((s: any) => this.pdfSafe(s.name)).join(', ') || '—';
        page.drawText(`${catLabel}  ·  ${fundingStr}`, { x: M, y: PAGE_H - 55, size: 9, font, color: rgb(0.72, 0.78, 0.90) });
        page.drawText('Budget Account Statement', { x: M, y: PAGE_H - 68, size: 8, font, color: rgb(0.50, 0.58, 0.75) });

        // category badge (top-right)
        const catBg  = account.category === 'Labor' ? rgb(0.18, 0.38, 0.65) : rgb(0.13, 0.50, 0.30);
        const badgeX = W - 158;
        page.drawRectangle({ x: badgeX, y: PAGE_H - 50, width: 115, height: 22, color: catBg });
        page.drawText(account.category === 'Labor' ? 'LABOR POOL' : 'PROJECT SPENDING',
            { x: badgeX + 6, y: PAGE_H - 41, size: 8.5, font: bold, color: rgb(1, 1, 1) });
        const genDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
        page.drawText(`Generated: ${genDate}`, { x: badgeX, y: PAGE_H - 66, size: 7.5, font, color: rgb(0.65, 0.72, 0.86) });

        // ── helpers ───────────────────────────────────────────────────────
        const $$ = (n: number) => `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${n < 0 ? ' CR' : ''}`;
        const drawSectionBanner = (label: string, count: string, yPos: number) => {
            page.drawRectangle({ x: M, y: yPos - 20, width: CONTENT_W, height: 20, color: rgb(0.12, 0.18, 0.35) });
            page.drawText(label, { x: M + 6, y: yPos - 13, size: 8, font: bold, color: rgb(1, 1, 1) });
            page.drawText(count, { x: W - M - font.widthOfTextAtSize(count, 7.5) - 8, y: yPos - 13, size: 7.5, font, color: rgb(0.75, 0.80, 0.92) });
        };
        const drawColHeader = (cols: { text: string; x: number }[], yPos: number) => {
            page.drawRectangle({ x: M, y: yPos - 14, width: CONTENT_W, height: 14, color: rgb(0.92, 0.93, 0.96) });
            for (const c of cols) page.drawText(c.text, { x: c.x, y: yPos - 10, size: 7, font: bold, color: rgb(0.32, 0.34, 0.42) });
        };

        let y = PAGE_H - HEADER_H - 16;

        // ── KPI CARDS ─────────────────────────────────────────────────────
        const cardW = 117, cardH = 40, cardGap = 9;
        const balColor = Number(account.balance) >= 0 ? rgb(0.13, 0.50, 0.30) : rgb(0.72, 0.18, 0.18);
        const kpis = [
            { label: 'Total Allocated', value: $$(Number(account.totalAllocated)), color: rgb(0.15, 0.36, 0.62) },
            { label: 'Total Spent',     value: $$(totalSpent),                     color: rgb(0.72, 0.18, 0.18) },
            { label: 'Remaining Bal.',  value: $$(Number(account.balance)),        color: balColor },
            { label: 'Transactions',    value: `${expenses.length + laborDeductions.length}`, color: rgb(0.38, 0.22, 0.62) },
        ];
        kpis.forEach((k, i) => {
            const cx = M + i * (cardW + cardGap);
            page.drawRectangle({ x: cx, y: y - cardH, width: cardW, height: cardH, color: rgb(0.96, 0.97, 0.98) });
            page.drawRectangle({ x: cx, y: y - 4,     width: cardW, height: 4,     color: k.color });
            page.drawText(k.label, { x: cx + 7, y: y - 14, size: 7,    font,       color: rgb(0.42, 0.44, 0.50) });
            const vsz = k.value.length > 14 ? 9 : 11;
            page.drawText(k.value, { x: cx + 7, y: y - 28, size: vsz, font: bold,  color: k.color });
        });
        y -= cardH + 14;

        // ── ALLOCATIONS ───────────────────────────────────────────────────
        if (includeAllocations) {
            drawSectionBanner('PROJECT ALLOCATIONS', `${allocations.length} allocation(s)`, y);
            y -= 24;
            if (allocations.length > 0) {
                drawColHeader([
                    { text: 'Project',   x: M + 6 },
                    { text: 'Notes',     x: M + 200 },
                    { text: 'Allocated', x: M + 310 },
                    { text: 'Spent',     x: M + 380 },
                    { text: 'Balance',   x: M + 448 },
                ], y);
                y -= 16;
                let tAlloc = 0, tSpent = 0;
                allocations.forEach((a, i) => {
                    tAlloc += Number(a.allocatedAmount);
                    tSpent += a.spent;
                    page.drawRectangle({ x: M, y: y - ROW_H_ALLOC, width: CONTENT_W, height: ROW_H_ALLOC,
                        color: i % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99) });
                    page.drawRectangle({ x: M, y: y - ROW_H_ALLOC, width: 3, height: ROW_H_ALLOC, color: catBg });
                    const projN = this.pdfSafe((a.project as any)?.name ?? '—').substring(0, 33);
                    const notesN = a.notes ? this.pdfSafe(a.notes).substring(0, 22) : '—';
                    page.drawText(projN,  { x: M + 6,   y: y - 14, size: 8,   font: bold, color: rgb(0.12, 0.14, 0.22) });
                    page.drawText(notesN, { x: M + 200, y: y - 14, size: 7.5, font,       color: rgb(0.45, 0.46, 0.50) });
                    page.drawText($$(Number(a.allocatedAmount)), { x: M + 310, y: y - 14, size: 8, font, color: rgb(0.12, 0.14, 0.22) });
                    page.drawText($$(a.spent), { x: M + 380, y: y - 14, size: 8, font, color: rgb(0.60, 0.18, 0.18) });
                    const bClr = a.balance < 0 ? rgb(0.72, 0.18, 0.18) : rgb(0.10, 0.45, 0.24);
                    page.drawText($$(a.balance), { x: M + 448, y: y - 14, size: 8, font: bold, color: bClr });
                    y -= ROW_H_ALLOC;
                });
                // subtotal
                page.drawRectangle({ x: M, y: y - 18, width: CONTENT_W, height: 18, color: rgb(0.90, 0.91, 0.95) });
                page.drawText('SUBTOTAL', { x: M + 6, y: y - 11, size: 7, font: bold, color: rgb(0.20, 0.22, 0.32) });
                page.drawText($$(tAlloc), { x: M + 310, y: y - 11, size: 7, font: bold, color: rgb(0.20, 0.22, 0.32) });
                page.drawText($$(tSpent), { x: M + 380, y: y - 11, size: 7, font: bold, color: rgb(0.60, 0.18, 0.18) });
                page.drawText($$(tAlloc - tSpent), { x: M + 448, y: y - 11, size: 7, font: bold, color: rgb(0.10, 0.45, 0.24) });
                y -= 18;
            } else {
                page.drawText('No project allocations for this account.', { x: M + 6, y: y - 13, size: 8, font, color: rgb(0.55, 0.57, 0.62) });
                y -= 22;
            }
            y -= 14;
        }

        // ── EXPENSES ──────────────────────────────────────────────────────
        drawSectionBanner('EXPENSE RECORDS', `${expenses.length} item(s)  ·  Total: ${$$(totalExpenses)}`, y);
        y -= 24;
        if (expenses.length > 0) {
            drawColHeader([
                { text: 'Date',        x: M + 6 },
                { text: 'Description', x: M + 72 },
                { text: 'Category',    x: M + 240 },
                { text: 'Vendor',      x: M + 315 },
                { text: 'Amount',      x: M + 430 },
            ], y);
            y -= 16;
            const CAT_COL: Record<string, [number, number, number]> = {
                equipment: [0.15, 0.36, 0.62], supplies: [0.13, 0.50, 0.30],
                travel: [0.62, 0.36, 0.10], other: [0.42, 0.42, 0.48],
            };
            expenses.forEach((e, i) => {
                page.drawRectangle({ x: M, y: y - ROW_H_EXP, width: CONTENT_W, height: ROW_H_EXP,
                    color: i % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99) });
                const cc = CAT_COL[e.category] ?? [0.42, 0.42, 0.48];
                page.drawRectangle({ x: M, y: y - ROW_H_EXP, width: 3, height: ROW_H_EXP, color: rgb(cc[0], cc[1], cc[2]) });
                const dateStr = new Date(e.expenseDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
                const desc   = this.pdfSafe(e.description).substring(0, 30);
                const vendor = this.pdfSafe(e.vendor ?? '—').substring(0, 18);
                page.drawText(dateStr, { x: M + 6,   y: y - 11, size: 7.5, font,       color: rgb(0.35, 0.37, 0.42) });
                page.drawText(desc,    { x: M + 72,  y: y - 11, size: 8,   font,       color: rgb(0.12, 0.14, 0.22) });
                page.drawText(e.category, { x: M + 240, y: y - 11, size: 7.5, font,   color: rgb(cc[0], cc[1], cc[2]) });
                page.drawText(vendor,  { x: M + 315, y: y - 11, size: 7.5, font,       color: rgb(0.45, 0.46, 0.50) });
                page.drawText($$(Number(e.amount)), { x: M + 430, y: y - 11, size: 8, font: bold, color: rgb(0.55, 0.10, 0.10) });
                y -= ROW_H_EXP;
            });
            page.drawRectangle({ x: M, y: y - 18, width: CONTENT_W, height: 18, color: rgb(0.90, 0.91, 0.95) });
            page.drawText('EXPENSES SUBTOTAL', { x: M + 6, y: y - 11, size: 7, font: bold, color: rgb(0.20, 0.22, 0.32) });
            page.drawText($$(totalExpenses), { x: M + 430, y: y - 11, size: 7, font: bold, color: rgb(0.55, 0.10, 0.10) });
            y -= 18;
        } else {
            page.drawText('No expense records for this account.', { x: M + 6, y: y - 13, size: 8, font, color: rgb(0.55, 0.57, 0.62) });
            y -= 22;
        }
        y -= 14;

        // ── LABOR DEDUCTIONS ──────────────────────────────────────────────
        drawSectionBanner('LABOR DEDUCTIONS', `${laborDeductions.length} item(s)  ·  Total: ${$$(totalLabor)}`, y);
        y -= 24;
        if (laborDeductions.length > 0) {
            drawColHeader([
                { text: 'Week',     x: M + 6 },
                { text: 'Employee', x: M + 90 },
                { text: 'Hours',    x: M + 255 },
                { text: 'Rate/hr',  x: M + 315 },
                { text: 'Amount',   x: M + 430 },
            ], y);
            y -= 16;
            laborDeductions.forEach((d, i) => {
                page.drawRectangle({ x: M, y: y - ROW_H_LABOR, width: CONTENT_W, height: ROW_H_LABOR,
                    color: i % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99) });
                page.drawRectangle({ x: M, y: y - ROW_H_LABOR, width: 3, height: ROW_H_LABOR, color: rgb(0.18, 0.38, 0.65) });
                const weekStr = d.weekStart
                    ? new Date(d.weekStart).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
                    : '—';
                const empName = this.pdfSafe((d.user as any)?.fullName ?? (d.user as any)?.username ?? '—').substring(0, 28);
                page.drawText(weekStr,  { x: M + 6,   y: y - 11, size: 7.5, font,       color: rgb(0.35, 0.37, 0.42) });
                page.drawText(empName,  { x: M + 90,  y: y - 11, size: 8,   font,       color: rgb(0.12, 0.14, 0.22) });
                page.drawText(`${Number(d.hours || 0).toFixed(1)}h`, { x: M + 255, y: y - 11, size: 8, font, color: rgb(0.45, 0.38, 0.12) });
                page.drawText(`$${Number(d.hourlyRate || 0).toFixed(2)}`, { x: M + 315, y: y - 11, size: 8, font, color: rgb(0.35, 0.37, 0.45) });
                page.drawText($$(Number(d.amount)), { x: M + 430, y: y - 11, size: 8, font: bold, color: rgb(0.55, 0.10, 0.10) });
                y -= ROW_H_LABOR;
            });
            page.drawRectangle({ x: M, y: y - 18, width: CONTENT_W, height: 18, color: rgb(0.90, 0.91, 0.95) });
            page.drawText('LABOR SUBTOTAL', { x: M + 6, y: y - 11, size: 7, font: bold, color: rgb(0.20, 0.22, 0.32) });
            page.drawText($$(totalLabor), { x: M + 430, y: y - 11, size: 7, font: bold, color: rgb(0.55, 0.10, 0.10) });
            y -= 18;
        } else {
            page.drawText('No labor deductions recorded for this account.', { x: M + 6, y: y - 13, size: 8, font, color: rgb(0.55, 0.57, 0.62) });
            y -= 22;
        }
        y -= 16;

        // ── GRAND TOTAL BOX ───────────────────────────────────────────────
        page.drawRectangle({ x: M, y: y - 46, width: CONTENT_W, height: 46, color: rgb(0.12, 0.16, 0.32) });
        page.drawRectangle({ x: M, y: y - 46, width: 5, height: 46, color: rgb(0.20, 0.58, 0.55) });
        page.drawText('TOTAL SPEND', { x: M + 14, y: y - 14, size: 9, font: bold, color: rgb(0.72, 0.78, 0.92) });
        page.drawText(`Expenses: ${$$(totalExpenses)}`, { x: M + 14, y: y - 28, size: 8, font, color: rgb(0.72, 0.78, 0.92) });
        page.drawText(`Labor: ${$$(totalLabor)}`, { x: M + 14, y: y - 38, size: 8, font, color: rgb(0.72, 0.78, 0.92) });
        const totalStr = $$(totalSpent);
        const totalStrW = bold.widthOfTextAtSize(totalStr, 20);
        page.drawText(totalStr, { x: W - M - 8 - totalStrW, y: y - 32, size: 20, font: bold, color: rgb(1, 0.90, 0.30) });
        const balStr  = `Balance: ${$$(Number(account.balance))}`;
        const balStrW = font.widthOfTextAtSize(balStr, 8);
        const bColorFinal = Number(account.balance) >= 0 ? rgb(0.55, 0.95, 0.65) : rgb(1, 0.45, 0.45);
        page.drawText(balStr, { x: W - M - 8 - balStrW, y: y - 42, size: 8, font, color: bColorFinal });
        y -= 46;

        // ── FOOTER ────────────────────────────────────────────────────────
        const fY = 32;
        page.drawLine({ start: { x: M, y: fY + 14 }, end: { x: W - M, y: fY + 14 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
        page.drawText('AI/ML Lab Portal',           { x: M,               y: fY + 3,  size: 7,   font, color: rgb(0.55, 0.57, 0.62) });
        page.drawText(this.pdfSafe(account.name),   { x: W / 2 - 40,      y: fY + 3,  size: 7,   font, color: rgb(0.55, 0.57, 0.62) });
        page.drawText(`Generated: ${genDate}`,      { x: W - M - 120,     y: fY + 3,  size: 6.5, font, color: rgb(0.55, 0.57, 0.62) });
        page.drawText('Budget Account Statement',   { x: M,               y: fY - 7,  size: 6.5, font, color: rgb(0.65, 0.67, 0.72) });

        const bytes = await doc.save();
        return Buffer.from(bytes);
    }

    private pdfSafe(text: string): string {
        if (!text) return '';
        return text
            .replace(/[\r\n]/g, ' ')
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u2026/g, '...')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/[^\x00-\xFF]/g, '');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Simulation Snapshots (persisted)
    // ─────────────────────────────────────────────────────────────────────────

    async saveSimulationSnapshot(
        dto: { name: string; laborBalance: number; simMonths: number; simStartIso: string; members: any },
        actorId: string,
    ): Promise<BudgetSimulationSnapshot> {
        const snap = this.simSnapshotRepo.create({
            name: dto.name,
            laborBalance: dto.laborBalance,
            simMonths: dto.simMonths,
            simStartIso: dto.simStartIso,
            members: dto.members,
            createdById: actorId,
        });
        return this.simSnapshotRepo.save(snap);
    }

    findSimulationSnapshots(): Promise<BudgetSimulationSnapshot[]> {
        return this.simSnapshotRepo.find({
            relations: ['createdBy'],
            order: { createdAt: 'DESC' },
        });
    }

    async updateSimulationSnapshot(
        id: string,
        dto: Partial<{ name: string; laborBalance: number; simMonths: number; simStartIso: string; members: any }>,
        actorId: string,
    ): Promise<BudgetSimulationSnapshot> {
        const snap = await this.simSnapshotRepo.findOne({ where: { id } });
        if (!snap) throw new NotFoundException('Simulation snapshot not found');
        // Only the creator may update
        if (snap.createdById && snap.createdById !== actorId) {
            throw new BadRequestException('You can only edit your own simulation snapshots');
        }
        Object.assign(snap, dto);
        return this.simSnapshotRepo.save(snap);
    }

    async deleteSimulationSnapshot(id: string, actorId: string): Promise<void> {
        const snap = await this.simSnapshotRepo.findOne({ where: { id } });
        if (!snap) throw new NotFoundException('Simulation snapshot not found');
        // Only the creator may delete
        if (snap.createdById && snap.createdById !== actorId) {
            throw new BadRequestException('You can only delete your own simulation snapshots');
        }
        await this.simSnapshotRepo.remove(snap);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Simulation (stateless — no DB writes)
    // NOTE: This endpoint is NOT called by the frontend SimulationTab, which
    // runs its own period-direct, day-granular engine entirely client-side.
    // This method uses a simplified constant burn-rate model (rate × hours × 4.33)
    // with no per-period schedule awareness and is retained only for potential
    // external/API consumers.
    // ─────────────────────────────────────────────────────────────────────────

    simulate(dto: SimulateDto): {
        monthlyBurnRate: number;
        runwayMonths: number | null;
        exhaustionDate: string | null;
        optimalHourCaps: { name: string; currentHours: number; optimalHours: number }[];
        monthlyTimeline: { month: number; label: string; balance: number }[];
    } {
        const included = dto.employees.filter((e) => e.included);
        const monthlyBurnRate = included.reduce((sum, e) => sum + e.hourlyRate * e.weeklyHours * 4.33, 0);

        const runwayMonths = monthlyBurnRate > 0 ? dto.laborBalance / monthlyBurnRate : null;
        let exhaustionDate: string | null = null;
        if (runwayMonths !== null) {
            const d = new Date();
            d.setDate(d.getDate() + runwayMonths * 30);
            exhaustionDate = d.toISOString().split('T')[0];
        }

        // Optimal hour caps to reach a target date
        let optimalHourCaps: { name: string; currentHours: number; optimalHours: number }[] = [];
        if (dto.targetDate) {
            const targetMs = new Date(dto.targetDate).getTime() - Date.now();
            const targetMonths = Math.max(0, targetMs / (1000 * 60 * 60 * 24 * 30));
            const requiredMonthlyBurn = targetMonths > 0 ? dto.laborBalance / targetMonths : 0;
            const ratio = monthlyBurnRate > 0 ? requiredMonthlyBurn / monthlyBurnRate : 1;
            optimalHourCaps = included.map((e) => ({
                name: e.name,
                currentHours: e.weeklyHours,
                optimalHours: parseFloat((e.weeklyHours * ratio).toFixed(1)),
            }));
        }

        // Monthly timeline (up to 36 months)
        const monthlyTimeline: { month: number; label: string; balance: number }[] = [];
        const maxMonths = runwayMonths !== null ? Math.min(Math.ceil(runwayMonths) + 3, 36) : 36;
        let balance = dto.laborBalance;
        const now = new Date();
        for (let i = 0; i <= maxMonths; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            monthlyTimeline.push({ month: i, label, balance: Math.max(0, balance) });
            balance -= monthlyBurnRate;
        }

        return { monthlyBurnRate, runwayMonths, exhaustionDate, optimalHourCaps, monthlyTimeline };
    }
}
