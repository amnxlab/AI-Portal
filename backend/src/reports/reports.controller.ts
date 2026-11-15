import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, Res, HttpCode } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
    constructor(private readonly reportsService: ReportsService) { }

    @Post()
    submit(@Body() body: { weekStart: string; tasksHours: any[]; notes?: string }, @Request() req) {
        return this.reportsService.submit(req.user.id, body.weekStart, body.tasksHours, body.notes);
    }

    @Get('mine')
    findMine(@Request() req) { return this.reportsService.findMine(req.user.id); }

    // ── Static routes MUST come before parameterized ones ────────────────
    @Get('export/pdf')
    @UseGuards(RolesGuard) @Permissions('manage_reports')
    async exportPdf(@Query('week') week: string, @Res() res: Response) {
        const buffer = await this.reportsService.exportPdf(week);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="weekly-report-${week}.pdf"`,
            'Content-Length': buffer.length,
        });
        res.send(buffer);
    }

    /**
     * Every weekly report.
     *
     * Open to anyone signed in, as part of the collaborative model: the lab
     * works on the same projects and reads the same record of what was done.
     * Reviewing, editing and reminding still require `manage_reports` — the
     * routes below keep their guards.
     */
    @Get()
    findAll(@Query('week') week?: string, @Query('userId') userId?: string) {
        return this.reportsService.findAll(week, userId);
    }

    // ── Parameterized routes ──────────────────────────────────────────────
    @Get(':id')
    findOne(@Param('id') id: string, @Request() req) {
        return this.reportsService.findById(id, req.user.id, req.user.permissions);
    }

    @Get(':id/export')
    async exportOne(@Param('id') id: string, @Request() req, @Res() res: Response) {
        const buffer = await this.reportsService.exportSinglePdf(id, req.user.id, req.user.permissions);
        const report = await this.reportsService.findById(id, req.user.id, req.user.permissions);
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="report-${report.weekStart}-${(report.user?.fullName ?? 'report').replace(/\s+/g, '-')}.pdf"`,
            'Content-Length': buffer.length,
        });
        res.send(buffer);
    }

    /** Admin: update report fields (week date, notes, task entries, manager comment) */
    @Patch(':id')
    @UseGuards(RolesGuard) @Permissions('manage_reports')
    adminUpdate(
        @Param('id') id: string,
        @Body() body: { weekStart?: string; notes?: string; tasksHours?: any[]; managerComment?: string | null },
    ) {
        return this.reportsService.adminUpdate(id, body);
    }

    /** Approve or reject a report — supervisors only */
    @Patch(':id/review')
    @UseGuards(RolesGuard) @Permissions('manage_reports')
    review(
        @Param('id') id: string,
        @Body() body: { action: 'approve' | 'reject'; note?: string; laborAccountId?: string },
        @Request() req,
    ) {
        return this.reportsService.review(id, req.user.id, body.action, body.note, body.laborAccountId);
    }

    @Post('remind/:weekStart')
    @UseGuards(RolesGuard) @Permissions('manage_reports')
    sendReminders(@Param('weekStart') weekStart: string) {
        return this.reportsService.sendReminders(weekStart);
    }

    @Delete(':id')
    @HttpCode(204)
    @UseGuards(RolesGuard) @Permissions('manage_reports')
    deleteReport(@Param('id') id: string) {
        return this.reportsService.delete(id);
    }
}
