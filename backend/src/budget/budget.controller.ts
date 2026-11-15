import {
    Controller, Get, Post, Patch, Delete, Param, Body, Query,
    UseGuards, Request, Res, HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { BudgetService } from './budget.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CreateFundingSourceDto } from './dto/create-funding-source.dto';
import { CreateBudgetAccountDto } from './dto/create-budget-account.dto';
import { CreateProjectAllocationDto } from './dto/create-project-allocation.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { LaborDeductDto } from './dto/labor-deduct.dto';
import { SimulateDto } from './dto/simulate.dto';

@Controller('budget')
@UseGuards(JwtAuthGuard, RolesGuard)
@Permissions('manage_budget')
export class BudgetController {
    constructor(private readonly budgetService: BudgetService) { }

    // ── Funding Sources ────────────────────────────────────────────────────
    // ── Budget years ───────────────────────────────────────────────────

    /** Every budget year with its headline figures, newest first. */
    @Get('years')
    listYears() {
        return this.budgetService.listYears();
    }

    /** The year currently open for spending. */
    @Get('years/active')
    activeYear() {
        return this.budgetService.getActiveYear();
    }

    /**
     * Close the open year and open the next one.
     *
     * Nothing is deleted or moved: the closed year keeps its accounts,
     * allocations, expenses and labor, and goes read-only.
     */
    @Post('years/close')
    closeYear(
        @Body() dto: { year?: number; label?: string; carryStructure?: boolean; notes?: string },
        @Request() req,
    ) {
        return this.budgetService.closeYearAndOpenNext(dto ?? {}, req.user.id);
    }

    @Get('sources')
    getSources(@Query('yearId') yearId?: string) { return this.budgetService.findSourcesForYear(yearId); }

    @Post('sources')
    createSource(@Body() dto: CreateFundingSourceDto, @Request() req) {
        return this.budgetService.createSource(dto, req.user.id);
    }

    @Patch('sources/:id')
    updateSource(@Param('id') id: string, @Body() dto: Partial<CreateFundingSourceDto>, @Request() req) {
        return this.budgetService.updateSource(id, dto, req.user.id);
    }

    @Delete('sources/:id')
    @HttpCode(204)
    deleteSource(@Param('id') id: string, @Request() req) {
        return this.budgetService.deleteSource(id, req.user.id);
    }

    // ── Budget Accounts ────────────────────────────────────────────────────
    @Get('accounts')
    getAccounts(@Query('yearId') yearId?: string) { return this.budgetService.findAllAccounts(yearId); }

    @Post('accounts')
    createAccount(@Body() dto: CreateBudgetAccountDto, @Request() req) {
        return this.budgetService.createAccount(dto, req.user.id);
    }

    @Get('accounts/:id/balance')
    getAccountBalance(@Param('id') id: string) {
        return this.budgetService.getAccountBalance(id);
    }

    @Patch('accounts/:id')
    updateAccount(@Param('id') id: string, @Body() dto: Partial<CreateBudgetAccountDto>, @Request() req) {
        return this.budgetService.updateAccount(id, dto, req.user.id);
    }

    @Delete('accounts/:id')
    @HttpCode(204)
    deleteAccount(@Param('id') id: string, @Request() req) {
        return this.budgetService.deleteAccount(id, req.user.id);
    }

    // ── Project Allocations ────────────────────────────────────────────────
    @Get('allocations')
    getAllocations(@Query('projectId') projectId?: string, @Query('yearId') yearId?: string) {
        return this.budgetService.findAllocations(projectId, yearId);
    }

    @Post('allocations')
    createAllocation(@Body() dto: CreateProjectAllocationDto, @Request() req) {
        return this.budgetService.createAllocation(dto, req.user.id);
    }

    @Patch('allocations/:id')
    updateAllocation(@Param('id') id: string, @Body() dto: Partial<CreateProjectAllocationDto>, @Request() req) {
        return this.budgetService.updateAllocation(id, dto, req.user.id);
    }

    @Delete('allocations/:id')
    @HttpCode(204)
    deleteAllocation(@Param('id') id: string, @Request() req) {
        return this.budgetService.deleteAllocation(id, req.user.id);
    }

    // ── Transfers ──────────────────────────────────────────────────────────
    @Get('transfers')
    getTransfers(@Query('yearId') yearId?: string) {
        return this.budgetService.findTransfersForYear(yearId);
    }

    @Post('transfers')
    createTransfer(@Body() dto: CreateTransferDto, @Request() req) {
        return this.budgetService.createTransfer(dto, req.user.id);
    }

    // ── Expenses ───────────────────────────────────────────────────────────
    @Get('expenses')
    getExpenses(
        @Query('projectId') projectId?: string,
        @Query('allocationId') allocationId?: string,
        @Query('yearId') yearId?: string,
    ) {
        // A project or allocation filter is already narrower than a year, so
        // those keep their own meaning; otherwise the year applies.
        if (projectId || allocationId) return this.budgetService.findExpenses(projectId, allocationId);
        return this.budgetService.findExpensesForYear(yearId);
    }

    @Post('expenses')
    createExpense(@Body() dto: CreateExpenseDto, @Request() req) {
        return this.budgetService.createExpense(dto, req.user.id);
    }

    @Patch('expenses/:id')
    updateExpense(@Param('id') id: string, @Body() dto: Partial<CreateExpenseDto>, @Request() req) {
        return this.budgetService.updateExpense(id, dto, req.user.id);
    }

    @Delete('expenses/:id')
    @HttpCode(204)
    deleteExpense(@Param('id') id: string, @Request() req) {
        return this.budgetService.deleteExpense(id, req.user.id);
    }

    // ── Labor ──────────────────────────────────────────────────────────────
    @Get('labor/deductions')
    getLaborDeductions(@Query('yearId') yearId?: string) {
        return this.budgetService.findLaborDeductionsForYear(yearId);
    }

    @Post('labor/deduct')
    laborDeduct(@Body() dto: LaborDeductDto, @Request() req) {
        return this.budgetService.createLaborDeduction(dto, req.user.id);
    }

    @Get('labor/sustainability')
    getSustainability(@Query('yearId') yearId?: string) {
        return this.budgetService.getLaborSustainability(yearId);
    }

    @Get('labor-pool')
    getPoolMembers(@Query('budgetAccountId') budgetAccountId?: string) {
        return this.budgetService.getPoolMembers(budgetAccountId);
    }

    @Post('labor-pool')
    addPoolMember(
        @Body() dto: { userId: string; budgetAccountId: string; startDate: string; endDate?: string | null },
        @Request() req,
    ) {
        return this.budgetService.addPoolMember(dto, req.user.id);
    }

    @Patch('labor-pool/:id')
    removePoolMember(@Param('id') id: string, @Body() body: { endDate?: string }) {
        return this.budgetService.removePoolMember(id, body.endDate);
    }

    @Delete('labor-pool/:id')
    @HttpCode(204)
    deletePoolMember(@Param('id') id: string) {
        return this.budgetService.deletePoolMember(id);
    }

    // ── Overview & Reports ─────────────────────────────────────────────────
    @Get('overview')
    getOverview(@Query('yearId') yearId?: string) { return this.budgetService.getOverview(yearId); }

    @Get('reports/project/:id')
    getProjectReport(@Param('id') id: string) {
        return this.budgetService.getProjectBudgetReport(id);
    }

    // ── Account Report ─────────────────────────────────────────────────────
    @Get('accounts/:id/report')
    getAccountReport(@Param('id') id: string) {
        return this.budgetService.getAccountReport(id);
    }

    @Get('export/account-report/:id')
    async exportAccountReport(
        @Param('id') id: string,
        @Query('includeAllocations') includeAllocations: string,
        @Res() res: Response,
    ) {
        const withAlloc = includeAllocations !== 'false';
        const buffer = await this.budgetService.exportAccountPdf(id, withAlloc);
        const date   = new Date().toISOString().split('T')[0];
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="account-statement-${date}.pdf"`,
            'Content-Length': buffer.length,
        });
        res.send(buffer);
    }

    // ── Export ─────────────────────────────────────────────────────────────
    @Get('export/csv')
    async exportCsv(
        @Query('type') type: 'overview' | 'expenses' | 'labor' = 'overview',
        @Query('projectId') projectId: string | undefined,
        @Res() res: Response,
    ) {
        const csv = await this.budgetService.exportCsv(type, projectId);
        res.set({
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="budget-${type}-${new Date().toISOString().split('T')[0]}.csv"`,
        });
        res.send(csv);
    }

    @Get('export/pdf')
    async exportPdf(
        @Query('type') type: 'overview' | 'expenses' | 'labor' = 'overview',
        @Query('projectId') projectId: string | undefined,
        @Res() res: Response,
    ) {
        const buffer = await this.budgetService.exportPdf(type, projectId);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="budget-${type}-${new Date().toISOString().split('T')[0]}.pdf"`,
            'Content-Length': buffer.length,
        });
        res.send(buffer);
    }

    // ── Simulation (stateless compute) ────────────────────────────────────
    @Post('simulate')
    simulate(@Body() dto: SimulateDto) {
        return this.budgetService.simulate(dto);
    }

    // ── Simulation Snapshots (persisted) ──────────────────────────────────
    @Get('simulations')
    getSimulations() {
        return this.budgetService.findSimulationSnapshots();
    }

    @Post('simulations')
    saveSimulation(
        @Body() dto: { name: string; laborBalance: number; simMonths: number; simStartIso: string; members: any },
        @Request() req,
    ) {
        return this.budgetService.saveSimulationSnapshot(dto, req.user.id);
    }

    @Patch('simulations/:id')
    updateSimulation(
        @Param('id') id: string,
        @Body() dto: Partial<{ name: string; laborBalance: number; simMonths: number; simStartIso: string; members: any }>,
        @Request() req,
    ) {
        return this.budgetService.updateSimulationSnapshot(id, dto, req.user.id);
    }

    @Delete('simulations/:id')
    @HttpCode(204)
    deleteSimulation(@Param('id') id: string, @Request() req) {
        return this.budgetService.deleteSimulationSnapshot(id, req.user.id);
    }
}
