import {
    Controller, Get, Post, Patch, Put, Delete, Param, Query, Body, UseGuards, UseInterceptors,
    UploadedFile, Request, Res, BadRequestException, ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { AttendanceService } from './attendance.service';
import { ShiftsService } from './shifts.service';
import { buildWeeklyAttendancePdf, buildBiweeklyAttendancePdf } from './attendance-pdf';
import { ClockActionDto } from './dto/clock-action.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { CreateSessionDto, CorrectSessionDto, ReasonDto, EnforcementDto } from './dto/session.dto';
import { weekStartOf, localToday } from '../common/tz';

/**
 * Attendance API.
 *
 *  - /attendance/me/*  — the signed-in employee's own data. Read-only, except
 *    the portal clock, which the service restricts to employees authorised
 *    for remote work. `req.user.id` is the only identity ever used here, so
 *    an employee cannot address anyone else's records.
 *  - everything else   — requires the manage_attendance permission.
 *
 * There is deliberately no endpoint that edits or deletes an attendance
 * record: changes go through audited corrections.
 */
@Controller('attendance')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendanceController {
    constructor(
        private readonly attendance: AttendanceService,
        private readonly shiftsService: ShiftsService,
    ) {}

    // ─── Employee: own attendance ─────────────────────────────────

    @Get('me/current')
    getCurrent(@Request() req: any) {
        return this.attendance.getCurrent(req.user.id);
    }

    /** Kept for older clients; same data as me/current. */
    @Get('me/status')
    async getSelfStatus(@Request() req: any) {
        const cur = await this.attendance.getCurrent(req.user.id);
        return { isClockedIn: !!cur.session, session: cur.session, remote: cur.remote };
    }

    @Get('me/history')
    getMyHistory(@Request() req: any, @Query('from') from?: string, @Query('to') to?: string) {
        return this.attendance.getMyHistory(req.user.id, from, to);
    }

    @Get('me/balance')
    getMyBalance(@Request() req: any, @Query('weekStart') weekStart?: string) {
        return this.attendance.getBalance(req.user.id, weekStart || weekStartOf(localToday()));
    }

    @Get('my-hours')
    getMyHours(@Request() req: any, @Query('weekStart') weekStart?: string) {
        return this.attendance.getMyHours(req.user.id, weekStart || weekStartOf(localToday()));
    }

    @Post('me/clock-in')
    selfClockIn(@Request() req: any) {
        return this.attendance.selfClockIn(req.user.id, req.ip);
    }

    @Post('me/clock-out')
    selfClockOut(@Request() req: any) {
        return this.attendance.selfClockOut(req.user.id, req.ip);
    }

    // ─── Administrator: organisation-wide views ───────────────────

    /** The shift the signed-in person is on, for their own view. */
    @Get('me/shift')
    myShift(@Request() req, @Query('date') date?: string) {
        return this.shiftsService.myShift(req.user.id, date);
    }

    // ══════════════════════════════════════════════════════════════
    //  The day view — who is in, who is late, who never came.
    //
    //  The module could report how many hours a week somebody worked and
    //  nothing about today, which is the question that actually gets asked.
    // ══════════════════════════════════════════════════════════════

    @Get('day')
    @Permissions('manage_attendance')
    getDay(@Query('date') date?: string) {
        return this.shiftsService.getDay(date);
    }

    /** Today, by definition — a stable URL for a dashboard or a wall display. */
    @Get('today')
    @Permissions('manage_attendance')
    getToday() {
        return this.shiftsService.getDay();
    }

    // ══════════════════════════════════════════════════════════════
    //  Shifts
    // ══════════════════════════════════════════════════════════════

    @Get('shifts')
    @Permissions('manage_attendance')
    listShifts(@Query('includeInactive') includeInactive?: string) {
        return this.shiftsService.listShifts(includeInactive === 'true');
    }

    @Post('shifts')
    @Permissions('manage_attendance')
    createShift(@Body() dto: any, @Request() req) {
        return this.shiftsService.createShift(dto, req.user.id);
    }

    @Patch('shifts/:id')
    @Permissions('manage_attendance')
    updateShift(@Param('id') id: string, @Body() dto: any, @Request() req) {
        return this.shiftsService.updateShift(id, dto, req.user.id);
    }

    /**
     * Retires a shift. Not a delete: past days were judged against it and
     * past assignments point at it.
     */
    @Delete('shifts/:id')
    @Permissions('manage_attendance')
    deactivateShift(@Param('id') id: string, @Request() req) {
        return this.shiftsService.deactivateShift(id, req.user.id);
    }

    @Get('shift-assignments')
    @Permissions('manage_attendance')
    listAssignments(
        @Query('shiftId') shiftId?: string,
        @Query('userId') userId?: string,
        @Query('activeOnly') activeOnly?: string,
    ) {
        return this.shiftsService.listAssignments({ shiftId, userId, activeOnly: activeOnly === 'true' });
    }

    @Post('shift-assignments')
    @Permissions('manage_attendance')
    assignShift(@Body() dto: any, @Request() req) {
        return this.shiftsService.assign(dto, req.user.id);
    }

    @Patch('shift-assignments/:id/end')
    @Permissions('manage_attendance')
    endAssignment(@Param('id') id: string, @Body() body: { endDate?: string }, @Request() req) {
        return this.shiftsService.endAssignment(id, body?.endDate, req.user.id);
    }

    @Get('settings')
    @Permissions('manage_attendance')
    getSettings() {
        return this.attendance.getSettings();
    }

    @Put('settings/enforcement')
    @Permissions('manage_attendance')
    setEnforcement(@Request() req: any, @Body() dto: EnforcementDto) {
        return this.attendance.setEnforcementStart(req.user.id, dto.enforcementStart ?? null);
    }

    @Get('weekly')
    @Permissions('manage_attendance')
    getWeekly(@Query() q: QueryAttendanceDto) {
        return this.attendance.getAllEmployeesWeekly(q.weekStart || weekStartOf(localToday()));
    }

    @Get('biweekly')
    @Permissions('manage_attendance')
    getBiweekly(@Query() q: QueryAttendanceDto) {
        if (!q.biweekStart) throw new BadRequestException('biweekStart is required');
        return this.attendance.getAllEmployeesBiweekly(q.biweekStart);
    }

    @Get('monthly')
    @Permissions('manage_attendance')
    getMonthly(@Query('month') month: string) {
        return this.attendance.getMonthly(month);
    }

    @Get('sessions')
    @Permissions('manage_attendance')
    listSessions(
        @Query('from') from?: string, @Query('to') to?: string, @Query('userId') userId?: string,
        @Query('status') status?: string, @Query('mode') mode?: string, @Query('search') search?: string,
    ) {
        return this.attendance.listSessions({ from, to, userId, status, mode, search });
    }

    @Get('exceptions')
    @Permissions('manage_attendance')
    getExceptions() {
        return this.attendance.getExceptions();
    }

    @Get('corrections')
    @Permissions('manage_attendance')
    getCorrections(
        @Query('sessionId') sessionId?: string, @Query('userId') userId?: string, @Query('limit') limit?: string,
    ) {
        return this.attendance.getCorrections({ sessionId, userId, limit: Number(limit) || undefined });
    }

    @Get('audit')
    @Permissions('manage_attendance')
    getAudit(@Query('limit') limit?: string) {
        return this.attendance.getAuditTrail(Number(limit) || 200);
    }

    @Get('users/:id/summary')
    @Permissions('manage_attendance')
    getUserSummary(@Param('id', ParseUUIDPipe) id: string) {
        return this.attendance.getUserSummary(id);
    }

    @Get('users/:id/balance')
    @Permissions('manage_attendance')
    getUserBalance(@Param('id', ParseUUIDPipe) id: string, @Query('weekStart') weekStart?: string) {
        return this.attendance.getBalance(id, weekStart || weekStartOf(localToday()));
    }

    @Get('export/pdf')
    @Permissions('manage_attendance')
    async exportPdf(@Query() q: QueryAttendanceDto, @Res() res: Response) {
        const type = q.type || 'weekly';
        const weekStart = q.weekStart || q.biweekStart;
        if (!weekStart) throw new BadRequestException('weekStart or biweekStart is required');
        let pdf: Buffer;
        if (type === 'biweekly') {
            const { week1, week2 } = await this.attendance.getAllEmployeesBiweekly(weekStart);
            pdf = await buildBiweeklyAttendancePdf(week1, week2, weekStart);
        } else {
            pdf = await buildWeeklyAttendancePdf(await this.attendance.getAllEmployeesWeekly(weekStart), weekStart);
        }
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="attendance-${type}-${weekStart}.pdf"`,
            'Content-Length': pdf.length,
        });
        res.end(pdf);
    }

    // ─── Administrator: manual entries and corrections (audited) ──

    @Post('clock-in')
    @Permissions('manage_attendance')
    clockIn(@Request() req: any, @Body() dto: ClockActionDto) {
        return this.attendance.adminClock(req.user.id, dto.userId, 'clock_in', dto.reason, req.ip);
    }

    @Post('clock-out')
    @Permissions('manage_attendance')
    clockOut(@Request() req: any, @Body() dto: ClockActionDto) {
        return this.attendance.adminClock(req.user.id, dto.userId, 'clock_out', dto.reason, req.ip);
    }

    @Post('sessions')
    @Permissions('manage_attendance')
    createSession(@Request() req: any, @Body() dto: CreateSessionDto) {
        return this.attendance.adminCreateSession(req.user.id, dto, req.ip);
    }

    @Patch('sessions/:id')
    @Permissions('manage_attendance')
    correctSession(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectSessionDto) {
        return this.attendance.adminCorrectSession(req.user.id, id, dto, req.ip);
    }

    @Post('sessions/:id/void')
    @Permissions('manage_attendance')
    voidSession(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
        return this.attendance.adminVoidSession(req.user.id, id, dto.reason, req.ip);
    }

    @Post('import-csv')
    @Permissions('manage_attendance')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
    importCsv(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
        if (!file) throw new BadRequestException('No file uploaded');
        return this.attendance.importCsv(req.user.id, file.buffer.toString('utf-8'));
    }
}
