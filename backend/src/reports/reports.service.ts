import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';
import { WeeklyReport } from './weekly-report.entity';
import { Task } from '../tasks/task.entity';
import { Comment } from '../comments/comment.entity';
import { DiscordService } from '../discord/discord.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetService } from '../budget/budget.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AttendanceService } from '../attendance/attendance.service';
import { effectivePermissions } from '../roles/role.entity';

interface TaskDetail {
    description: string;
    comments: Array<{
        id: string;
        content: string;
        authorName: string;
        createdAt: Date;
        parentId: string | null;
    }>;
}

@Injectable()
export class ReportsService {
    constructor(
        @InjectRepository(WeeklyReport) private readonly reportRepo: Repository<WeeklyReport>,
        @InjectRepository(Task) private readonly taskRepo: Repository<Task>,
        @InjectRepository(Comment) private readonly commentRepo: Repository<Comment>,
        private readonly discordService: DiscordService,
        private readonly usersService: UsersService,
        private readonly notificationsService: NotificationsService,
        @Inject(forwardRef(() => BudgetService)) private readonly budgetService: BudgetService,
        private readonly realtimeGateway: RealtimeGateway,
        private readonly attendanceService: AttendanceService,
        private readonly dataSource: DataSource,
    ) { }

    async submit(userId: string, weekStart: string, tasksHours: any[], notes?: string) {
        // ── Input hardening ────────────────────────────────────────────────
        if (!weekStart || typeof weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
            throw new BadRequestException('weekStart must be a valid date in YYYY-MM-DD format.');
        }
        if (!Array.isArray(tasksHours)) {
            throw new BadRequestException('tasksHours must be an array.');
        }
        // Sanitise each entry so unexpected shapes never crash the reduce below
        const safeEntries = tasksHours.map((t: any) => ({
            taskId: t?.taskId ?? undefined,
            taskTitle: String(t?.taskTitle ?? '').trim(),
            status: String(t?.status ?? 'In Progress'),
            progressNotes: String(t?.progressNotes ?? ''),
            remainingNotes: t?.remainingNotes != null ? String(t.remainingNotes) : undefined,
            hours: Math.max(0, isFinite(Number(t?.hours)) ? Number(t.hours) : 0),
            isRemote: Boolean(t?.isRemote),
        }));

        const totalHours = safeEntries.reduce((sum, t) => sum + t.hours, 0);
        const remoteHours = safeEntries.reduce((sum, t) => sum + (t.isRemote ? t.hours : 0), 0);

        const reportUser = await this.usersService.findById(userId);

        // The weekly limits are enforced inside the same transaction that
        // writes the report, after locking the employee's row. Two
        // submissions racing each other therefore cannot both pass: the
        // second one re-reads the balance only once the first has committed.
        // The check itself lives in AttendanceService because verified
        // attendance is what the reportable ceiling is derived from.
        const { saved, isResubmission } = await this.dataSource.transaction(async (manager) => {
            const reports = manager.getRepository(WeeklyReport);
            await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

            await this.attendanceService.assertReportWithinLimits(
                manager, userId, weekStart, totalHours, remoteHours,
            );

            let report = await reports.findOne({ where: { userId, weekStart } });
            let resubmission = false;

            // Capture cap at submission time (only set once; never overwrite so
            // approved reports remain unaffected by later policy changes).
            // pg returns NUMERIC columns as strings; coerce to a JS number (or null).
            const capSnapshot = reportUser.weeklyHoursCap != null ? parseFloat(String(reportUser.weeklyHoursCap)) : null;

            if (report) {
                // Block resubmission of already-approved reports
                if (report.status === 'Approved') {
                    throw new ForbiddenException('This report has already been approved and cannot be resubmitted.');
                }
                resubmission = report.status === 'Needs Revision';
                report.tasksHours = safeEntries;
                report.totalHours = totalHours;
                report.remoteHours = remoteHours;
                report.notes = notes ?? null;
                report.status = 'Submitted';
                report.submittedAt = new Date();
                // Refresh snapshot on each (re)submission so it always reflects the
                // policy in effect at the time the employee actually filed.
                report.weeklyHoursCapSnapshot = capSnapshot;
                // Clear previous review feedback on resubmission
                report.reviewNote = null;
                report.reviewedBy = null;
                report.reviewedAt = null;
            } else {
                report = reports.create({
                    userId, weekStart, tasksHours: safeEntries,
                    totalHours, remoteHours,
                    notes, status: 'Submitted', submittedAt: new Date(),
                    weeklyHoursCapSnapshot: capSnapshot,
                });
            }
            return { saved: await reports.save(report), isResubmission: resubmission };
        });

        // Notify every report reviewer (manage_reports permission) about the submission / resubmission
        const submitterName = reportUser.fullName;
        const allUsers = await this.usersService.findAll();
        const reviewers = allUsers.filter((u) =>
            u.isActive && u.id !== userId && effectivePermissions(u.permissions).manage_reports);
        const notifType = isResubmission ? 'report_resubmitted' : 'report_submitted';
        const notifTitle = isResubmission
            ? `Report resubmitted by ${submitterName} 🔄`
            : `New report submitted by ${submitterName} 📋`;
        const notifMessage = isResubmission
            ? `${submitterName} has resubmitted their weekly report for week of ${weekStart} after revision. Please review.`
            : `${submitterName} has submitted their weekly report for week of ${weekStart}. Please review.`;

        // Notify reviewers — non-fatal: a notification failure must never abort a successful submission
        Promise.all(
            reviewers.map((reviewer) =>
                this.notificationsService.create(reviewer.id, notifType, notifTitle, notifMessage, saved.id),
            ),
        ).catch((notifErr: any) => {
            console.error('[ReportsService] Failed to send submission notifications:', notifErr?.message);
        });
        this.discordService.postReportSubmitted(submitterName, weekStart, isResubmission).catch(() => {});

        return saved;
    }

    /** Approve or reject a report (supervisor action). */
    async review(
        reportId: string,
        reviewerId: string,
        action: 'approve' | 'reject',
        note?: string,
        laborAccountId?: string,
    ): Promise<WeeklyReport> {
        const report = await this.reportRepo.findOne({ where: { id: reportId }, relations: ['user'] });
        if (!report) throw new NotFoundException('Report not found');
        if (report.status === 'Approved') {
            throw new ForbiddenException('Report is already approved.');
        }

        const newStatus = action === 'approve' ? 'Approved' : 'Needs Revision';
        report.status = newStatus;
        report.reviewNote = note ?? null;
        report.reviewedBy = reviewerId;
        report.reviewedAt = new Date();
        await this.reportRepo.save(report);

        // Notify all admin dashboards to re-fetch their pending-reports list.
        this.realtimeGateway.broadcastDashboardRefresh();

        // ── Auto-trigger labor deduction on approval ──────────────────────
        if (action === 'approve' && laborAccountId) {
            try {
                await this.budgetService.createLaborDeduction(
                    { weeklyReportId: reportId, budgetAccountId: laborAccountId },
                    reviewerId,
                );
            } catch (deductErr: any) {
                // Re-throw expected errors so the admin knows what went wrong.
                // (e.g. no hourly rate set, account not found, duplicate deduction)
                // The report is still marked Approved — only the deduction failed.
                const knownCodes = [400, 404, 409];
                if (deductErr?.status && knownCodes.includes(deductErr.status)) {
                    throw deductErr;
                }
                // Unexpected errors: log but don't block the approval
                console.error('[ReportsService] Auto labor deduction failed:', deductErr?.message);
            }
        }

        // Send in-app notification to the report owner
        const userName = report.user?.fullName ?? 'You';
        const reviewerUser = await this.usersService.findAll().then(us => us.find(u => u.id === reviewerId));
        const reviewerName = reviewerUser?.fullName ?? 'Reviewer';

        if (action === 'approve') {
            await this.notificationsService.create(
                report.userId,
                'report_approved',
                'Weekly report approved ✅',
                `Your report for week of ${report.weekStart} has been approved.${note ? ` Note: ${note}` : ''}`,
                report.id,
            );
        } else {
            await this.notificationsService.create(
                report.userId,
                'report_needs_revision',
                'Weekly report needs revision 🔁',
                `Your report for week of ${report.weekStart} needs revision.${note ? ` Reason: ${note}` : ''} Please resubmit.`,
                report.id,
            );
        }

        // Discord notification — non-critical
        this.discordService.postReportReviewed(
            userName,
            action === 'approve' ? 'approved' : 'revision',
            report.weekStart,
            reviewerName,
        ).catch(() => {});

        return report;
    }

    async findMine(userId: string) {
        const reports = await this.reportRepo.find({ where: { userId }, order: { weekStart: 'DESC' } });
        // Strip private manager comments — employees must never see them
        return reports.map(({ managerComment, ...rest }) => rest);
    }

    findAll(weekStart?: string, userId?: string) {
        const where: any = {};
        if (weekStart) where.weekStart = weekStart;
        if (userId) where.userId = userId;
        return this.reportRepo.find({ where, relations: ['user'], order: { weekStart: 'DESC', userId: 'ASC' } });
    }

    async findById(id: string, requesterId: string, requesterPermissions?: any): Promise<WeeklyReport> {
        const report = await this.reportRepo.findOne({ where: { id }, relations: ['user'] });
        if (!report) throw new NotFoundException('Report not found');
        const canReview = effectivePermissions(requesterPermissions).manage_reports;
        if (!canReview && report.userId !== requesterId) {
            throw new ForbiddenException('Access denied');
        }
        // Strip private manager comment from users who cannot review reports
        if (!canReview) {
            report.managerComment = null;
        }
        return report;
    }

    // ─── Shared PDF helpers ────────────────────────────────────────────────

    /** Strip characters that WinAnsi (Helvetica) cannot encode */
    private pdfSafe(text: string): string {
        if (!text) return '';
        // Replace known Unicode chars with ASCII equivalents, strip the rest
        return text
            .replace(/\r\n/g, ' ')
            .replace(/[\r\n]/g, ' ')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
            .replace(/[\u2018\u2019\u201A]/g, "'")
            .replace(/[\u201C\u201D\u201E]/g, '"')
            .replace(/\u2026/g, '...')
            .replace(/[\u2013\u2014]/g, '-')
            .replace(/\u2022/g, '*')
            .replace(/[\u25CF\u25CB\u25A0\u25AA]/g, '*')
            .replace(/[\u21B3\u2192\u2190\u2191\u2193]/g, '>')
            .replace(/[\u2713\u2714\u2705]/g, 'v')
            .replace(/[\u2717\u2718\u274C]/g, 'x')
            .replace(/[^\x00-\xFF]/g, '');
    }

    private pdfTextWrap(text: string, maxWidth: number, sz: number, f: any): string[] {
        if (!text) return [];
        const safe = this.pdfSafe(text);
        const words = safe.split(' ');
        const lines: string[] = [];
        let current = '';
        for (const w of words) {
            const test = current ? `${current} ${w}` : w;
            if (f.widthOfTextAtSize(test, sz) <= maxWidth) { current = test; }
            else {
                if (current) lines.push(current);
                current = f.widthOfTextAtSize(w, sz) > maxWidth ? w : w;
            }
        }
        if (current) lines.push(current);
        return lines;
    }

    private pdfClamp(txt: string | undefined | null, max: number): string {
        if (!txt) return '';
        const safe = this.pdfSafe(txt);
        return safe.length > max ? safe.substring(0, max) + '...' : safe;
    }

    private pdfDrawHbar(page: any, x: number, y: number, w: number, h: number, fill: number, total: number, fillColor: any, bgColor: any) {
        page.drawRectangle({ x, y, width: w, height: h, color: bgColor, borderWidth: 0 });
        const fw = total > 0 ? Math.min((fill / total) * w, w) : 0;
        if (fw > 0) page.drawRectangle({ x, y, width: fw, height: h, color: fillColor, borderWidth: 0 });
    }

    private pdfDrawFooter(page: any, font: any, pageNum: number, totalPages: number, weekStart: string, W: number, H: number) {
        const gray = rgb(0.55, 0.57, 0.62);
        const lightGray = rgb(0.85, 0.87, 0.90);
        page.drawLine({ start: { x: 40, y: 36 }, end: { x: W - 40, y: 36 }, thickness: 0.5, color: lightGray });
        page.drawText('AI/ML Lab Portal', { x: 40, y: 22, size: 7, font, color: gray });
        page.drawText(`Week of ${weekStart}`, { x: W / 2 - 30, y: 22, size: 7, font, color: gray });
        page.drawText(`Page ${pageNum} of ${totalPages}`, { x: W - 100, y: 22, size: 7, font, color: gray });
        page.drawText(`Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, { x: 40, y: 12, size: 6.5, font, color: gray });
    }

    // ─── STATUS colour map (shared) ────────────────────────────────────────
    private readonly STATUS_COLORS_MAP: Record<string, [number, number, number]> = {
        'Done': [0.13, 0.50, 0.30],
        'In Progress': [0.18, 0.38, 0.65],
        'To Do': [0.48, 0.48, 0.52],
        'Needs Revision': [0.65, 0.42, 0.10],
        'Pending Review': [0.38, 0.22, 0.62],
        'Blocked': [0.72, 0.18, 0.18],
    };

    /** Build one employee section on a single variable-height page.
     *  The page is at least A4 tall; it grows to fit all content at normal size.
     *  Always returns 1. */
    private async buildEmployeeSection(
        pdfDoc: any,
        report: WeeklyReport,
        font: any,
        boldFont: any,
        weekStart: string,
        pageNumberOffset: number,
        includeDetails: boolean = false,
        taskDetailsMap: Map<string, TaskDetail> = new Map(),
    ): Promise<number> {
        const W = 595, M = 45;
        const CONTENT_W = W - M * 2;
        const HEADER_H = 80, FOOTER_RESERVE = 40;

        const name      = this.pdfSafe(report.user?.fullName ?? 'Unknown Employee');
        const roleLabel = this.pdfSafe((report.user as any)?.jobTitle || (report.user as any)?.role || '');
        const totalH  = Number(report.totalHours  ?? 0);
        const remoteH = Number(report.remoteHours ?? 0);
        const onsiteH = Math.max(0, totalH - remoteH);
        const userCap = report.weeklyHoursCapSnapshot !== null && report.weeklyHoursCapSnapshot !== undefined
            ? report.weeklyHoursCapSnapshot
            : (report.user as any)?.weeklyHoursCap;
        const hasCap     = userCap !== null && userCap !== undefined;
        const MAX_HOURS  = hasCap ? userCap : 0;
        const MAX_REMOTE = hasCap ? Math.floor(MAX_HOURS * 0.2) : 0;
        const overH = hasCap && totalH  > MAX_HOURS;
        const overR = hasCap && remoteH > MAX_REMOTE;

        const STATUS_BG: Record<string, [number, number, number]> = {
            'Approved':       [0.05, 0.55, 0.15],
            'Submitted':      [0.08, 0.35, 0.75],
            'Needs Revision': [0.70, 0.35, 0.00],
            'Draft':          [0.42, 0.42, 0.42],
        };
        const statusBg  = STATUS_BG[report.status] ?? [0.42, 0.42, 0.42];
        const statusRgb = rgb(statusBg[0], statusBg[1], statusBg[2]);

        const tasks = report.tasksHours ?? [];
        const COL = { num: M, title: M + 18, status: M + 255, hours: M + 345, remote: M + 395 };

        // ── STEP 1: measure full content height at normal scale ────────────
        let contentH = 0;
        contentH += 40 + 10;              // cards (40px) + gap
        contentH += 11 + 7 + 15 + 7 + 17; // bars section: heading + 2 bars with labels = 57
        contentH += 24;                   // task banner
        if (tasks.length > 0) {
            contentH += 16;               // col headers
            for (const entry of tasks) {
                const tl = this.pdfTextWrap(entry.taskTitle ?? 'Unnamed task', COL.status - COL.title, 8.5, boldFont);
                const pl = entry.progressNotes  ? this.pdfTextWrap(entry.progressNotes,  CONTENT_W - 26, 7.5, font) : [];
                const rl = entry.remainingNotes ? this.pdfTextWrap(entry.remainingNotes, CONTENT_W - 26, 7.5, font) : [];
                const tH = tl.length > 1 ? (tl.length - 1) * 10 : 0;
                const pH = pl.length > 0 ? 11 + pl.length * 10 : 0;
                const rH = rl.length > 0 ? 11 + rl.length * 10 : 0;
                let dH = 0, cH = 0;
                if (includeDetails && entry.taskId) {
                    const detail = taskDetailsMap.get(entry.taskId);
                    if (detail?.description) {
                        const dl = this.pdfTextWrap(detail.description, CONTENT_W - 30, 7.5, font);
                        dH = 11 + dl.length * 10;
                    }
                    if (detail?.comments?.length) {
                        cH += 13;
                        for (const c of detail.comments) {
                            const indent = c.parentId ? 20 : 10;
                            const cLines = this.pdfTextWrap(c.content, CONTENT_W - 26 - indent, 7.5, font);
                            cH += 12 + cLines.length * 10;
                        }
                    }
                }
                contentH += 22 + tH + pH + rH + dH + cH + 6;
            }
        } else {
            contentH += 20;
        }
        contentH += 8; // gap before bottom sections
        if (report.notes) {
            const nl = this.pdfTextWrap(report.notes, CONTENT_W, 8.5, font);
            contentH += 8 + 12 + 13 + nl.length * 13 + 4;
        }
        if (report.reviewNote || report.reviewedAt) {
            contentH += 8 + 4 + 32 + 8;
            if (report.reviewNote) {
                contentH += this.pdfTextWrap(report.reviewNote, CONTENT_W - 4, 8.5, font).length * 12;
            }
        }
        if (report.managerComment) {
            contentH += 8 + 4 + 32 + 8;
            contentH += this.pdfTextWrap(report.managerComment, CONTENT_W - 4, 8.5, font).length * 12;
        }

        // ── STEP 2: page height = max(A4, content + fixed areas) ──────────
        // 95 = header (80) + gap (15) between header and content start
        const PAGE_H = Math.max(842, Math.ceil(HEADER_H + 15 + contentH + FOOTER_RESERVE + 8));

        // ── Load stamp ─────────────────────────────────────────────────────
        const STAMP_SZ = 78, STAMP_X = W - STAMP_SZ - 32, STAMP_Y = 48;
        let stampImage: any = null;
        try {
            stampImage = await pdfDoc.embedPng(fs.readFileSync(
                path.resolve(__dirname, '..', '..', 'assets', 'stamp.png')));
        } catch { /* missing */ }

        // ── Create page ────────────────────────────────────────────────────
        const page = pdfDoc.addPage([W, PAGE_H]);
        if (stampImage) {
            page.drawImage(stampImage, {
                x: STAMP_X, y: STAMP_Y, width: STAMP_SZ, height: STAMP_SZ,
                rotate: degrees(-12), opacity: 0.88,
            });
        }

        // ── HEADER BAND (always at top) ────────────────────────────────────
        page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: W, height: HEADER_H, color: rgb(0.12, 0.16, 0.32) });
        page.drawRectangle({ x: 0, y: PAGE_H - HEADER_H, width: 5, height: HEADER_H, color: rgb(0.20, 0.58, 0.55) });
        page.drawText('AI/ML Lab Portal',          { x: M, y: PAGE_H - 20, size: 8,  font,           color: rgb(0.70, 0.78, 0.92) });
        page.drawText(name,                        { x: M, y: PAGE_H - 38, size: 18, font: boldFont, color: rgb(1, 1, 1) });
        if (roleLabel) page.drawText(roleLabel,    { x: M, y: PAGE_H - 54, size: 9,  font,           color: rgb(0.72, 0.78, 0.90) });
        page.drawText(`Week of ${report.weekStart}`, { x: M, y: PAGE_H - 68, size: 9, font,          color: rgb(0.65, 0.72, 0.86) });

        const statusLabel = report.status === 'Submitted' ? 'Under Review' : report.status;
        const badgeX = W - 155;
        page.drawRectangle({ x: badgeX, y: PAGE_H - 55, width: 112, height: 22, color: statusRgb });
        page.drawText(statusLabel, { x: badgeX + 6, y: PAGE_H - 46, size: 9, font: boldFont, color: rgb(1, 1, 1) });
        const submittedStr = report.submittedAt
            ? new Date(report.submittedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'Not submitted';
        page.drawText(`Submitted: ${submittedStr}`, { x: badgeX, y: PAGE_H - 68, size: 7.5, font, color: rgb(0.65, 0.72, 0.86) });

        let y = PAGE_H - 95;

        // ── METRIC CARDS ───────────────────────────────────────────────────
        const cardW = 117, cardH = 40, cardXgap = 8;
        [
            { label: 'Total Hours',  value: `${totalH}h`,      sub: hasCap ? `Cap: ${MAX_HOURS}h` : 'No cap',   top: overH ? rgb(0.72, 0.18, 0.18) : rgb(0.13, 0.50, 0.30) },
            { label: 'On-Site',      value: `${onsiteH}h`,     sub: 'in-person work',                           top: rgb(0.15, 0.36, 0.62) },
            { label: 'Remote',       value: `${remoteH}h`,     sub: hasCap ? `Max: ${MAX_REMOTE}h` : 'No cap',  top: overR ? rgb(0.72, 0.18, 0.18) : rgb(0.38, 0.22, 0.62) },
            { label: 'Tasks Filed',  value: `${tasks.length}`, sub: 'task entries',                             top: rgb(0.28, 0.30, 0.38) },
        ].forEach((c, i) => {
            const cx = M + i * (cardW + cardXgap);
            page.drawRectangle({ x: cx, y: y - cardH, width: cardW, height: cardH, color: rgb(0.96, 0.97, 0.98) });
            page.drawRectangle({ x: cx, y: y - 4,     width: cardW, height: 4,     color: c.top });
            page.drawText(c.label, { x: cx + 7, y: y - 13, size: 7,   font,           color: rgb(0.42, 0.44, 0.50) });
            page.drawText(c.value, { x: cx + 7, y: y - 28, size: 13,  font: boldFont, color: c.top });
            page.drawText(c.sub,   { x: cx + 7, y: y - 37, size: 6.5, font,           color: rgb(0.50, 0.52, 0.56) });
        });
        y -= cardH + 10;

        // ── HOURS BARS ─────────────────────────────────────────────────────
        const barW = CONTENT_W, barH = 7;
        page.drawText('Hours Utilisation', { x: M, y, size: 7.5, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
        y -= 11;
        this.pdfDrawHbar(page, M, y - barH, barW, barH, totalH, hasCap ? MAX_HOURS : (totalH || 1),
            overH ? rgb(0.72, 0.18, 0.18) : rgb(0.15, 0.55, 0.38), rgb(0.92, 0.93, 0.95));
        page.drawText(hasCap
            ? `Total: ${totalH}h / ${MAX_HOURS}h  (${MAX_HOURS > 0 ? Math.round(totalH / MAX_HOURS * 100) : 0}%)`
            : `Total: ${totalH}h`,
            { x: M, y: y - barH - 9, size: 7, font, color: rgb(0.32, 0.34, 0.40) });
        y -= barH + 15;
        this.pdfDrawHbar(page, M, y - barH, barW, barH, remoteH, hasCap ? MAX_REMOTE : (totalH || 1),
            overR ? rgb(0.72, 0.18, 0.18) : rgb(0.38, 0.22, 0.62), rgb(0.92, 0.93, 0.95));
        page.drawText(hasCap
            ? `Remote: ${remoteH}h / ${MAX_REMOTE}h  (${MAX_REMOTE > 0 ? Math.round(remoteH / MAX_REMOTE * 100) : 0}%)`
            : `Remote: ${remoteH}h`,
            { x: M, y: y - barH - 9, size: 7, font, color: rgb(0.32, 0.34, 0.40) });
        y -= barH + 17;

        // ── TASK TABLE ─────────────────────────────────────────────────────
        page.drawRectangle({ x: M, y: y - 20, width: CONTENT_W, height: 20, color: rgb(0.12, 0.18, 0.35) });
        page.drawText('TASK ENTRIES', { x: M + 6, y: y - 13, size: 8, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText(`${tasks.length} task(s)  ·  ${totalH}h total`, { x: W - M - 110, y: y - 13, size: 7.5, font, color: rgb(0.75, 0.80, 0.92) });
        y -= 24;

        if (tasks.length > 0) {
            page.drawRectangle({ x: M, y: y - 14, width: CONTENT_W, height: 14, color: rgb(0.92, 0.93, 0.96) });
            page.drawText('#',      { x: COL.num,    y: y - 10, size: 7, font: boldFont, color: rgb(0.32, 0.34, 0.42) });
            page.drawText('Task',   { x: COL.title,  y: y - 10, size: 7, font: boldFont, color: rgb(0.32, 0.34, 0.42) });
            page.drawText('Status', { x: COL.status, y: y - 10, size: 7, font: boldFont, color: rgb(0.32, 0.34, 0.42) });
            page.drawText('Hrs',    { x: COL.hours,  y: y - 10, size: 7, font: boldFont, color: rgb(0.32, 0.34, 0.42) });
            page.drawText('Remote', { x: COL.remote, y: y - 10, size: 7, font: boldFont, color: rgb(0.32, 0.34, 0.42) });
            y -= 16;

            for (let i = 0; i < tasks.length; i++) {
                const entry = tasks[i];
                const titleLines = this.pdfTextWrap(entry.taskTitle ?? 'Unnamed task', COL.status - COL.title, 8.5, boldFont);
                const progLines  = entry.progressNotes  ? this.pdfTextWrap(entry.progressNotes,  CONTENT_W - 26, 7.5, font) : [];
                const remLines   = entry.remainingNotes ? this.pdfTextWrap(entry.remainingNotes, CONTENT_W - 26, 7.5, font) : [];
                const tH = titleLines.length > 1 ? (titleLines.length - 1) * 10 : 0;
                const pH = progLines.length  > 0 ? 11 + progLines.length  * 10 : 0;
                const rH = remLines.length   > 0 ? 11 + remLines.length   * 10 : 0;

                // ── Task detail (description + comments) — individual PDF only ──
                let descLines: string[] = [];
                let commentData: TaskDetail['comments'] = [];
                let dH = 0, cH = 0;
                if (includeDetails && entry.taskId) {
                    const detail = taskDetailsMap.get(entry.taskId);
                    if (detail?.description) {
                        descLines = this.pdfTextWrap(detail.description, CONTENT_W - 30, 7.5, font);
                        dH = 11 + descLines.length * 10;
                    }
                    if (detail?.comments?.length) {
                        commentData = detail.comments;
                        cH += 13;
                        for (const c of detail.comments) {
                            const indent = c.parentId ? 20 : 10;
                            cH += 12 + this.pdfTextWrap(c.content, CONTENT_W - 26 - indent, 7.5, font).length * 10;
                        }
                    }
                }

                const blockH = 22 + tH + pH + rH + dH + cH + 6;

                const sc = this.STATUS_COLORS_MAP[entry.status ?? ''] ?? [0.48, 0.48, 0.52];
                page.drawRectangle({ x: M, y: y - blockH, width: CONTENT_W, height: blockH,
                    color: i % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99) });
                page.drawRectangle({ x: M, y: y - blockH, width: 3, height: blockH, color: rgb(sc[0], sc[1], sc[2]) });

                page.drawText(`${i + 1}`, { x: COL.num + 1, y: y - 13, size: 7.5, font, color: rgb(0.50, 0.52, 0.56) });
                let ty = y - 13;
                for (const tl of titleLines) {
                    page.drawText(tl, { x: COL.title, y: ty, size: 8.5, font: boldFont, color: rgb(0.12, 0.14, 0.22) });
                    ty -= 10;
                }
                page.drawText(entry.status ?? '—',          { x: COL.status, y: y - 13, size: 7.5, font, color: rgb(sc[0], sc[1], sc[2]) });
                page.drawText(`${entry.hours}h`,             { x: COL.hours,  y: y - 13, size: 8.5, font: boldFont, color: rgb(0.14, 0.30, 0.58) });
                page.drawText(entry.isRemote ? 'Yes' : '—', { x: COL.remote, y: y - 13, size: 7.5, font,
                    color: entry.isRemote ? rgb(0.38, 0.22, 0.62) : rgb(0.60, 0.62, 0.66) });

                let ny = y - 22 - tH;
                if (progLines.length > 0) {
                    page.drawText('> Progress:', { x: COL.title, y: ny, size: 7, font: boldFont, color: rgb(0.16, 0.38, 0.56) });
                    ny -= 10;
                    for (const ln of progLines) {
                        page.drawText(ln, { x: COL.title + 10, y: ny, size: 7.5, font, color: rgb(0.18, 0.20, 0.26) });
                        ny -= 10;
                    }
                }
                if (remLines.length > 0) {
                    page.drawText('> Still needed:', { x: COL.title, y: ny, size: 7, font: boldFont, color: rgb(0.58, 0.35, 0.10) });
                    ny -= 10;
                    for (const ln of remLines) {
                        page.drawText(ln, { x: COL.title + 10, y: ny, size: 7.5, font, color: rgb(0.48, 0.32, 0.10) });
                        ny -= 10;
                    }
                }
                // ── Description (individual PDF only) ──────────────────────
                if (descLines.length > 0) {
                    page.drawText('> Description:', { x: COL.title, y: ny, size: 7, font: boldFont, color: rgb(0.20, 0.45, 0.18) });
                    ny -= 10;
                    for (const ln of descLines) {
                        page.drawText(ln, { x: COL.title + 10, y: ny, size: 7.5, font, color: rgb(0.22, 0.24, 0.30) });
                        ny -= 10;
                    }
                }
                // ── Discussion threads (individual PDF only) ────────────────
                if (commentData.length > 0) {
                    page.drawText(`> Discussion (${commentData.length}):`, { x: COL.title, y: ny, size: 7, font: boldFont, color: rgb(0.16, 0.36, 0.58) });
                    ny -= 12;
                    for (const c of commentData) {
                        const indent = c.parentId ? 20 : 10;
                        const dateStr = new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                        const prefix = c.parentId ? 'Reply by ' : '';
                        page.drawText(`${prefix}${this.pdfSafe(c.authorName)}  ·  ${dateStr}`, {
                            x: COL.title + indent, y: ny, size: 6.5, font: boldFont, color: rgb(0.38, 0.40, 0.50),
                        });
                        ny -= 10;
                        for (const ln of this.pdfTextWrap(c.content, CONTENT_W - 26 - indent, 7.5, font)) {
                            page.drawText(ln, { x: COL.title + indent + 4, y: ny, size: 7.5, font, color: rgb(0.22, 0.24, 0.30) });
                            ny -= 10;
                        }
                    }
                }
                y -= blockH;
            }
        } else {
            page.drawText('No task entries recorded for this week.', { x: M + 6, y: y - 12, size: 8.5, font, color: rgb(0.50, 0.52, 0.56) });
            y -= 20;
        }

        y -= 8;

        // ── GENERAL NOTES ──────────────────────────────────────────────────
        if (report.notes) {
            y -= 8;
            page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
            y -= 12;
            page.drawText('GENERAL NOTES', { x: M, y, size: 8.5, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
            y -= 13;
            for (const line of this.pdfTextWrap(report.notes, CONTENT_W, 8.5, font)) {
                page.drawText(line, { x: M + 4, y, size: 8.5, font, color: rgb(0.24, 0.26, 0.32) });
                y -= 13;
            }
        }

        // ── SUPERVISOR REVIEW ──────────────────────────────────────────────
        if (report.reviewNote || report.reviewedAt) {
            y -= 8;
            page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
            y -= 4;
            const revBg     = report.status === 'Approved' ? rgb(0.93, 0.97, 0.94) : rgb(0.98, 0.96, 0.92);
            const revAccent = report.status === 'Approved' ? rgb(0.13, 0.50, 0.30) : rgb(0.65, 0.42, 0.10);
            page.drawRectangle({ x: M, y: y - 28, width: CONTENT_W, height: 32, color: revBg });
            page.drawRectangle({ x: M, y: y - 28, width: 4,         height: 32, color: revAccent });
            page.drawText(`SUPERVISOR REVIEW — ${report.status.toUpperCase()}`, { x: M + 10, y: y - 12, size: 8.5, font: boldFont, color: revAccent });
            if (report.reviewedAt) {
                const rd = new Date(report.reviewedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                page.drawText(`Reviewed: ${rd}`, { x: W - M - 100, y: y - 12, size: 7.5, font, color: rgb(0.48, 0.50, 0.55) });
            }
            y -= 36;
            if (report.reviewNote) {
                for (const line of this.pdfTextWrap(report.reviewNote, CONTENT_W - 4, 8.5, font)) {
                    page.drawText(line, { x: M + 4, y, size: 8.5, font, color: rgb(0.26, 0.28, 0.34) });
                    y -= 12;
                }
            }
        }

        // ── MANAGER COMMENT ────────────────────────────────────────────────
        if (report.managerComment) {
            y -= 8;
            page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
            y -= 4;
            page.drawRectangle({ x: M, y: y - 28, width: CONTENT_W, height: 32, color: rgb(0.94, 0.92, 0.97) });
            page.drawRectangle({ x: M, y: y - 28, width: 4,         height: 32, color: rgb(0.38, 0.22, 0.62) });
            page.drawText('MANAGER COMMENT (CONFIDENTIAL)', { x: M + 10, y: y - 12, size: 8.5, font: boldFont, color: rgb(0.38, 0.22, 0.62) });
            y -= 36;
            for (const line of this.pdfTextWrap(report.managerComment, CONTENT_W - 4, 8.5, font)) {
                page.drawText(line, { x: M + 4, y, size: 8.5, font, color: rgb(0.26, 0.28, 0.34) });
                y -= 12;
            }
        }

        // ── FOOTER (always at page bottom) ─────────────────────────────────
        this.pdfDrawFooter(page, font, pageNumberOffset + 1, 999, weekStart, W, PAGE_H);
        return 1;
    }

    async exportSinglePdf(id: string, requesterId: string, requesterPermissions?: any): Promise<Buffer> {
        const report = await this.findById(id, requesterId, requesterPermissions);

        // ── Fetch task descriptions and discussion threads ─────────────────
        const taskIds = (report.tasksHours ?? [])
            .map((t: any) => t.taskId)
            .filter((tid: any): tid is string => !!tid);

        const taskDetailsMap = new Map<string, TaskDetail>();
        if (taskIds.length > 0) {
            const [tasks, comments] = await Promise.all([
                this.taskRepo.find({ where: { id: In(taskIds) } }),
                this.commentRepo.find({
                    where: { entityType: 'task', entityId: In(taskIds) },
                    order: { createdAt: 'ASC' },
                }),
            ]);
            for (const task of tasks) {
                taskDetailsMap.set(task.id, { description: task.description ?? '', comments: [] });
            }
            for (const comment of comments) {
                const detail = taskDetailsMap.get(comment.entityId);
                if (detail) {
                    detail.comments.push({
                        id: comment.id,
                        content: comment.content,
                        authorName: comment.author?.fullName ?? 'Unknown',
                        createdAt: comment.createdAt,
                        parentId: comment.parentId,
                    });
                }
            }
        }

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const weekStart = report.weekStart;
        const W = 595, H = 842;

        const totalPages = await this.buildEmployeeSection(pdfDoc, report, font, boldFont, weekStart, 0, true, taskDetailsMap);

        // Back-fill footer page totals now that we know totalPages
        const pages = pdfDoc.getPages();
        for (let i = 0; i < pages.length; i++) {
            const pg = pages[i];
            // blank out old "999" placeholder and write correct total
            pg.drawRectangle({ x: W - 105, y: 18, width: 65, height: 12, color: rgb(1, 1, 1) });
            pg.drawText(`Page ${i + 1} of ${totalPages}`, { x: W - 100, y: 22, size: 7, font, color: rgb(0.55, 0.57, 0.62) });
        }

        const bytes = await pdfDoc.save();
        return Buffer.from(bytes);
    }

    async sendReminders(weekStart: string) {
        const allUsers = await this.usersService.findAll();
        const submitted = await this.reportRepo.find({ where: { weekStart } });
        const submittedIds = new Set(submitted.map((r) => r.userId));
        // Report reviewers are not expected to file reports themselves.
        const pending = allUsers.filter((u) =>
            u.isActive && !submittedIds.has(u.id) && !effectivePermissions(u.permissions).manage_reports);

        // In-app notification for every pending user
        for (const u of pending) {
            await this.notificationsService.create(
                u.id,
                'report_reminder',
                'Weekly Report Reminder',
                `Please submit your report for the week of ${weekStart}.`,
            );
        }

        // Discord broadcast
        await this.discordService.postReportReminder(pending.map((u) => u.fullName), weekStart);
        return { reminded: pending.length };
    }

    async delete(id: string): Promise<void> {
        const report = await this.reportRepo.findOne({ where: { id } });
        if (!report) throw new NotFoundException('Report not found');
        await this.reportRepo.remove(report);
    }

    async adminUpdate(
        id: string,
        data: { weekStart?: string; notes?: string; tasksHours?: any[]; managerComment?: string | null },
    ): Promise<WeeklyReport> {
        // Runs in a transaction, under the same per-user lock and the same
        // attendance check as a submission. An administrator editing a report
        // is still bound by the hours attendance verifies — otherwise the
        // limit would be enforced on the employee's own submission and then
        // freely bypassed through this route. Where the attendance itself is
        // what is wrong, the fix is an audited attendance correction, which
        // raises the ceiling honestly.
        return this.dataSource.transaction(async (manager) => {
            const reports = manager.getRepository(WeeklyReport);
            const report = await reports.findOne({ where: { id }, relations: ['user'] });
            if (!report) throw new NotFoundException('Report not found');

            await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [report.userId]);

            if (data.weekStart !== undefined) report.weekStart = data.weekStart;
            if (data.notes !== undefined) report.notes = data.notes ?? null;
            if (data.managerComment !== undefined) report.managerComment = data.managerComment ?? null;

            if (data.tasksHours !== undefined) {
                report.tasksHours = data.tasksHours;
                report.totalHours = data.tasksHours.reduce((s, t) => s + (Number(t.hours) || 0), 0);
                report.remoteHours = data.tasksHours.reduce((s, t) => s + (t.isRemote ? Number(t.hours) || 0 : 0), 0);
            }

            // Only re-check when the figures that the limit applies to have
            // actually moved; editing a note must not fail because a limit
            // tightened after the report was filed.
            if (data.tasksHours !== undefined || data.weekStart !== undefined) {
                await this.attendanceService.assertReportWithinLimits(
                    manager,
                    report.userId,
                    String(report.weekStart).slice(0, 10),
                    Number(report.totalHours) || 0,
                    Number(report.remoteHours) || 0,
                );
            }

            return reports.save(report);
        });
    }

    async exportPdf(weekStart: string): Promise<Buffer> {
        const reports = await this.findAll(weekStart);
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const W = 595, H = 842, M = 45;
        const CONTENT_W = W - M * 2;

        // ── Aggregate stats ────────────────────────────────────────────
        const totalTeamHours = reports.reduce((s, r) => s + Number(r.totalHours ?? 0), 0);
        const totalRemoteHours = reports.reduce((s, r) => s + Number(r.remoteHours ?? 0), 0);
        const totalTasks = reports.reduce((s, r) => s + (r.tasksHours?.length ?? 0), 0);
        const approved = reports.filter(r => r.status === 'Approved').length;
        const submitted = reports.filter(r => r.status === 'Submitted').length;
        const needsRev = reports.filter(r => r.status === 'Needs Revision').length;

        // ══════════════════════════════════════════════════════════════
        // PAGE 1 — COVER PAGE
        // ══════════════════════════════════════════════════════════════
        let page = pdfDoc.addPage([W, H]);

        // Full-width banner
        page.drawRectangle({ x: 0, y: H - 160, width: W, height: 160, color: rgb(0.12, 0.16, 0.32) });
        // Teal accent stripe
        page.drawRectangle({ x: 0, y: H - 160, width: 8, height: 160, color: rgb(0.20, 0.58, 0.55) });
        // Decorative right block
        page.drawRectangle({ x: W - 100, y: H - 160, width: 100, height: 160, color: rgb(0.15, 0.22, 0.40) });

        page.drawText('Southern Utah University', { x: M + 6, y: H - 38, size: 25, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('AI/ML Lab Portal', { x: M + 6, y: H - 58, size: 11, font, color: rgb(0.70, 0.78, 0.92) });
        page.drawText('WEEKLY ACTIVITY REPORT', { x: M + 6, y: H - 82, size: 14, font: boldFont, color: rgb(0.82, 0.86, 0.96) });
        page.drawText(`Period: Week of ${weekStart}`, { x: M + 6, y: H - 102, size: 10, font, color: rgb(0.68, 0.74, 0.88) });
        page.drawText(`Generated: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}`, {
            x: M + 6, y: H - 120, size: 9, font, color: rgb(0.60, 0.66, 0.82),
        });
        page.drawText('CONFIDENTIAL — Internal Use Only', { x: M + 6, y: H - 140, size: 8, font, color: rgb(0.52, 0.58, 0.78) });

        // ── Official Stamp (lower-right corner of cover page) ────────────────
        // Uses the lab's actual stamp image, tilted ~-12° to look like it was
        // physically applied to the document rather than inserted as a picture.
        const STAMP_SZ = 78;
        const STAMP_X  = W - STAMP_SZ - 32;   // right margin
        const STAMP_Y  = 48;                    // above page bottom
        let stampImageCover: any = null;
        try {
            const stampPath = path.resolve(__dirname, '..', '..', 'assets', 'stamp.png');
            const stampBytes = fs.readFileSync(stampPath);
            stampImageCover = await pdfDoc.embedPng(stampBytes);
            page.drawImage(stampImageCover, {
                x: STAMP_X,
                y: STAMP_Y,
                width: STAMP_SZ,
                height: STAMP_SZ,
                rotate: degrees(-12),
                opacity: 0.88,
            });
        } catch { /* stamp file missing — skip silently */ }

        // ── Executive Summary Cards ────────────────────────────────────
        let sy = H - 195;
        page.drawText('EXECUTIVE SUMMARY', { x: M, y: sy, size: 10, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
        sy -= 14;

        const sumCards = [
            { label: 'Team Members', value: `${reports.length}`, color: rgb(0.12, 0.18, 0.35) },
            { label: 'Total Hours', value: `${totalTeamHours}h`, color: rgb(0.13, 0.50, 0.30) },
            { label: 'Remote Hours', value: `${totalRemoteHours}h`, color: rgb(0.38, 0.22, 0.62) },
            { label: 'Tasks Filed', value: `${totalTasks}`, color: rgb(0.18, 0.38, 0.65) },
        ];
        const scW = (CONTENT_W - 15) / 4, scH = 55;
        sumCards.forEach((c, i) => {
            const cx = M + i * (scW + 5);
            page.drawRectangle({ x: cx, y: sy - scH, width: scW, height: scH, color: rgb(0.96, 0.97, 0.98) });
            page.drawRectangle({ x: cx, y: sy - 4, width: scW, height: 4, color: c.color });
            page.drawText(c.label, { x: cx + 6, y: sy - 17, size: 7.5, font, color: rgb(0.42, 0.44, 0.50) });
            page.drawText(c.value, { x: cx + 6, y: sy - 37, size: 16, font: boldFont, color: c.color });
        });
        sy -= scH + 14;

        // ── Status breakdown row ───────────────────────────────────────
        const stBreak = [
            { label: 'Approved', val: approved, color: rgb(0.13, 0.50, 0.30) },
            { label: 'Under Review', val: submitted, color: rgb(0.18, 0.38, 0.65) },
            { label: 'Needs Revision', val: needsRev, color: rgb(0.65, 0.42, 0.10) },
        ];
        const sbW = (CONTENT_W - 10) / 3, sbH = 30;
        stBreak.forEach((s, i) => {
            const cx = M + i * (sbW + 5);
            page.drawRectangle({ x: cx, y: sy - sbH, width: sbW, height: sbH, color: s.color });
            page.drawText(`${s.val}`, { x: cx + 8, y: sy - 16, size: 13, font: boldFont, color: rgb(1, 1, 1) });
            page.drawText(s.label, { x: cx + 8, y: sy - 27, size: 7.5, font, color: rgb(0.88, 0.92, 0.98) });
        });
        sy -= sbH + 20;

        // ── Hours bar chart (visual comparison) ───────────────────────
        page.drawLine({ start: { x: M, y: sy }, end: { x: W - M, y: sy }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
        sy -= 14;
        page.drawText('HOURS OVERVIEW BY TEAM MEMBER', { x: M, y: sy, size: 9, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
        sy -= 12;

        const maxBarW = CONTENT_W - 130;
        const maxHoursInTeam = Math.max(...reports.map(r => Number(r.totalHours ?? 0)), 1);
        for (const r of reports) {
            if (sy < 60) break; // stop if no room
            const rName = this.pdfClamp(r.user?.fullName ?? 'Unknown', 24);
            const rHours = Number(r.totalHours ?? 0);
            const barLen = Math.max((rHours / maxHoursInTeam) * maxBarW, 1);
            page.drawText(rName, { x: M, y: sy - 3, size: 7.5, font, color: rgb(0.20, 0.22, 0.30) });
            // background
            page.drawRectangle({ x: M + 125, y: sy - 10, width: maxBarW, height: 9, color: rgb(0.92, 0.93, 0.95) });
            // fill
            page.drawRectangle({ x: M + 125, y: sy - 10, width: barLen, height: 9, color: rgb(0.18, 0.38, 0.65) });
            page.drawText(`${rHours}h`, { x: M + 125 + maxBarW + 5, y: sy - 3, size: 7.5, font: boldFont, color: rgb(0.18, 0.38, 0.65) });
            sy -= 16;
        }

        // ── Summary Table ──────────────────────────────────────────────
        sy -= 10;
        page.drawLine({ start: { x: M, y: sy + 5 }, end: { x: W - M, y: sy + 5 }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
        sy -= 14;
        page.drawText('TEAM SUBMISSIONS SUMMARY', { x: M, y: sy + 8, size: 9, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
        sy -= 12;

        // Table header — evenly spaced columns across full content width
        const TH = { name: M, totalH: M + 150, onsite: M + 210, remote: M + 270, tasks: M + 330, status: M + 380, reviewed: M + 450 };
        page.drawRectangle({ x: M, y: sy - 4, width: CONTENT_W, height: 18, color: rgb(0.12, 0.18, 0.35) });
        page.drawText('Employee', { x: TH.name, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('Total', { x: TH.totalH, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('On-Site', { x: TH.onsite, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('Remote', { x: TH.remote, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('Tasks', { x: TH.tasks, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('Status', { x: TH.status, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        page.drawText('Reviewed', { x: TH.reviewed, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
        sy -= 18;

        for (let ri = 0; ri < reports.length; ri++) {
            const r = reports[ri];
            if (sy < 130) {
                this.pdfDrawFooter(page, font, 1, 999, weekStart, W, H);
                page = pdfDoc.addPage([W, H]);
                // Draw stamp on continuation summary page
                if (stampImageCover) {
                    page.drawImage(stampImageCover, {
                        x: W - 78 - 32, y: 48, width: 78, height: 78,
                        rotate: degrees(-12), opacity: 0.88,
                    });
                }
                sy = H - M;
                // Re-draw header
                page.drawRectangle({ x: M, y: sy - 4, width: CONTENT_W, height: 18, color: rgb(0.12, 0.18, 0.35) });
                page.drawText('Employee', { x: TH.name, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('Total', { x: TH.totalH, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('On-Site', { x: TH.onsite, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('Remote', { x: TH.remote, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('Tasks', { x: TH.tasks, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('Status', { x: TH.status, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                page.drawText('Reviewed', { x: TH.reviewed, y: sy, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
                sy -= 18;
            }

            const rTotalH = Number(r.totalHours ?? 0);
            const rRemoteH = Number(r.remoteHours ?? 0);
            const rOnsiteH = Math.max(0, rTotalH - rRemoteH);
            // Use the cap snapshot frozen at submission time; fall back to live cap
            // only for pre-migration records that have no snapshot yet.
            const rCap = r.weeklyHoursCapSnapshot !== null && r.weeklyHoursCapSnapshot !== undefined
                ? r.weeklyHoursCapSnapshot
                : (r.user as any)?.weeklyHoursCap;
            const rHasCap = rCap !== null && rCap !== undefined;
            const rMaxH = rHasCap ? rCap : 0;
            const rMaxR = rHasCap ? Math.floor(rMaxH * 0.2) : 0;
            const overH = rHasCap && rTotalH > rMaxH;
            const overR = rHasCap && rRemoteH > rMaxR;

            const rowBg = (overH || overR) ? rgb(0.99, 0.95, 0.95) : (ri % 2 === 0 ? rgb(1, 1, 1) : rgb(0.98, 0.98, 0.99));
            page.drawRectangle({ x: M, y: sy - 4, width: CONTENT_W, height: 16, color: rowBg });

            const STATUS_SC: Record<string, any> = {
                'Approved': rgb(0.13, 0.50, 0.30), 'Submitted': rgb(0.18, 0.38, 0.65),
                'Needs Revision': rgb(0.65, 0.42, 0.10), 'Draft': rgb(0.48, 0.48, 0.52),
            };
            page.drawText(this.pdfClamp(r.user?.fullName ?? 'Unknown', 22), { x: TH.name, y: sy, size: 8, font, color: rgb(0.14, 0.16, 0.24) });
            page.drawText(`${rTotalH}h`, { x: TH.totalH, y: sy, size: 8, font: boldFont, color: overH ? rgb(0.72, 0.18, 0.18) : rgb(0.13, 0.50, 0.30) });
            page.drawText(`${rOnsiteH}h`, { x: TH.onsite, y: sy, size: 8, font, color: rgb(0.15, 0.36, 0.62) });
            page.drawText(`${rRemoteH}h`, { x: TH.remote, y: sy, size: 8, font, color: overR ? rgb(0.72, 0.18, 0.18) : rgb(0.38, 0.22, 0.62) });
            page.drawText(`${r.tasksHours?.length ?? 0}`, { x: TH.tasks, y: sy, size: 8, font, color: rgb(0.28, 0.30, 0.38) });
            const sLabel = r.status === 'Submitted' ? 'Under Review' : r.status;
            page.drawText(sLabel, { x: TH.status, y: sy, size: 7.5, font, color: STATUS_SC[r.status] ?? rgb(0.48, 0.48, 0.52) });
            const reviewedStr = r.reviewedAt ? new Date(r.reviewedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';
            page.drawText(reviewedStr, { x: TH.reviewed, y: sy, size: 7.5, font, color: rgb(0.42, 0.44, 0.50) });
            sy -= 16;
        }

        // ── Cover page totals row ──────────────────────────────────────
        page.drawLine({ start: { x: M, y: sy }, end: { x: W - M, y: sy }, thickness: 0.5, color: rgb(0.85, 0.87, 0.90) });
        sy -= 14;
        page.drawRectangle({ x: M, y: sy - 4, width: CONTENT_W, height: 16, color: rgb(0.94, 0.95, 0.97) });
        page.drawText('TOTALS', { x: TH.name, y: sy, size: 8, font: boldFont, color: rgb(0.18, 0.22, 0.38) });
        page.drawText(`${totalTeamHours}h`, { x: TH.totalH, y: sy, size: 8, font: boldFont, color: rgb(0.13, 0.50, 0.30) });
        page.drawText(`${totalTeamHours - totalRemoteHours}h`, { x: TH.onsite, y: sy, size: 8, font: boldFont, color: rgb(0.15, 0.36, 0.62) });
        page.drawText(`${totalRemoteHours}h`, { x: TH.remote, y: sy, size: 8, font: boldFont, color: rgb(0.38, 0.22, 0.62) });
        page.drawText(`${totalTasks}`, { x: TH.tasks, y: sy, size: 8, font: boldFont, color: rgb(0.28, 0.30, 0.38) });

        this.pdfDrawFooter(page, font, 1, 999, weekStart, W, H);

        // ══════════════════════════════════════════════════════════════
        // INDIVIDUAL EMPLOYEE SECTIONS (one per report)
        // ══════════════════════════════════════════════════════════════
        for (const report of reports) {
            await this.buildEmployeeSection(pdfDoc, report, font, boldFont, weekStart, pdfDoc.getPageCount());
        }

        // ── Back-fill correct total page count in all footers ─────────
        const allPages = pdfDoc.getPages();
        const totalPgs = allPages.length;
        for (let i = 0; i < totalPgs; i++) {
            const pg = allPages[i];
            pg.drawRectangle({ x: W - 108, y: 18, width: 68, height: 12, color: rgb(1, 1, 1) });
            pg.drawText(`Page ${i + 1} of ${totalPgs}`, { x: W - 100, y: 22, size: 7, font, color: rgb(0.55, 0.57, 0.62) });
        }

        const bytes = await pdfDoc.save();
        return Buffer.from(bytes);
    }
}
