import {
    Injectable, BadRequestException, ForbiddenException, NotFoundException,
    Logger, OnModuleInit, OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { AttendanceRecord, AttendanceSource } from './attendance-record.entity';
import {
    AttendanceSession, AttendanceCorrection, SystemSetting,
    SessionMode, CorrectionAction,
} from './attendance-session.entity';
import { User } from '../users/user.entity';
import { WeeklyReport } from '../reports/weekly-report.entity';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
    LocalDate, addDays, dayInterval, weekInterval, monthInterval, weekStartOf,
    localDateOf, localToday, localToInstant, overlapMs, msToHours, round2,
    isLocalDate, isMonday, startOfLocalDay, LAB_TZ,
} from '../common/tz';

/** A clock-in with no clock-out after this long is treated as forgotten. */
export const MAX_SESSION_HOURS = Number(process.env.ATTENDANCE_MAX_SESSION_HOURS ?? 16);
/** Base for the remote-work percentage when an employee has no weekly cap. */
export const STANDARD_WEEK_HOURS = 40;
/** Report statuses whose hours count against the verified-hours balance. */
export const COUNTED_REPORT_STATUSES = ['Submitted', 'Approved'];
const EPS = 0.01;
const SETTING_ENFORCEMENT_START = 'attendance_enforcement_start';

export interface SessionView {
    id: string;
    userId: string;
    mode: SessionMode;
    source: string;
    status: string;
    corrected: boolean;
    clockInAt: Date;
    clockOutAt: Date | null;
    originalInAt: Date | null;
    originalOutAt: Date | null;
    /** Worked hours — 0 unless the session is closed. */
    hours: number;
    user?: { id: string; fullName: string; employeeId: string | null };
}

export interface RemotePolicy {
    allowed: boolean;
    percent: number;
    maxHours: number | null;
    /** Weekly remote-hours ceiling that results from percent and maxHours. 0 when not authorised. */
    limitHours: number;
}

export interface RemoteUsage extends RemotePolicy {
    actualHours: number;
    /** Remote hours that count as verified: min(actual, limit). */
    creditedHours: number;
    remainingHours: number;
    exceeded: boolean;
}

export interface DaySummary {
    date: LocalDate;
    onsiteHours: number;
    remoteHours: number;
    totalHours: number;
    sessions: SessionView[];
}

export interface WeekBalance {
    weekStart: LocalDate;
    /** True when report hours for this week are bounded by verified attendance. */
    enforcement: boolean;
    onsiteHours: number;
    verifiedHours: number;
    weeklyHoursCap: number | null;
    reportedHours: number;
    reportedRemoteHours: number;
    reportStatus: string | null;
    /** null = no upper bound applies. */
    maxReportableHours: number | null;
    remainingReportableHours: number | null;
    remote: RemoteUsage;
}

export interface EmployeeWeeklySummary extends WeekBalance {
    userId: string;
    fullName: string;
    employeeId: string | null;
    isActive: boolean;
    days: DaySummary[];
    /** Alias of verifiedHours, kept for older callers. */
    totalHours: number;
    openSession: SessionView | null;
    incompleteCount: number;
    /** Reported more hours than attendance verifies. */
    overReported: boolean;
}

export interface ClockResult {
    action: 'clock_in' | 'clock_out';
    session: AttendanceSession;
    record: AttendanceRecord;
    workedMs: number | null;
    /** A forgotten session that was closed off as incomplete by this event. */
    markedIncomplete: AttendanceSession | null;
}

interface ClockInput {
    userId: string;
    action: 'clock_in' | 'clock_out' | 'toggle';
    source: AttendanceSource;
    mode: SessionMode;
    at?: Date;
    uid?: string | null;
    deviceId?: string | null;
    cardId?: string | null;
    eventId?: string | null;
    createdBy?: string | null;
}

/** Weekly remote-hours ceiling for a user under their individual policy. */
export function remotePolicyOf(user: Pick<User, 'remoteWorkAllowed' | 'remoteWorkPercent' | 'remoteMaxHours' | 'weeklyHoursCap'>): RemotePolicy {
    const allowed = !!user.remoteWorkAllowed;
    const percent = Number(user.remoteWorkPercent ?? 20);
    const maxHours = user.remoteMaxHours != null ? Number(user.remoteMaxHours) : null;
    const cap = user.weeklyHoursCap != null ? Number(user.weeklyHoursCap) : null;
    let limitHours = 0;
    if (allowed) {
        limitHours = ((cap ?? STANDARD_WEEK_HOURS) * percent) / 100;
        if (maxHours != null) limitHours = Math.min(limitHours, maxHours);
        limitHours = round2(Math.max(0, limitHours));
    }
    return { allowed, percent, maxHours, limitHours };
}

@Injectable()
export class AttendanceService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AttendanceService.name);
    private sweepTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        @InjectRepository(AttendanceRecord) private readonly recordRepo: Repository<AttendanceRecord>,
        @InjectRepository(AttendanceSession) private readonly sessionRepo: Repository<AttendanceSession>,
        @InjectRepository(AttendanceCorrection) private readonly correctionRepo: Repository<AttendanceCorrection>,
        @InjectRepository(SystemSetting) private readonly settingRepo: Repository<SystemSetting>,
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        @InjectRepository(WeeklyReport) private readonly reportRepo: Repository<WeeklyReport>,
        private readonly dataSource: DataSource,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeGateway,
    ) {}

    async onModuleInit() {
        await this.backfillSessionsFromRecords();
        await this.sweepStaleSessions().catch((e) => this.logger.warn(`Stale sweep failed: ${e?.message}`));
        this.sweepTimer = setInterval(() => {
            this.sweepStaleSessions().catch((e) => this.logger.warn(`Stale sweep failed: ${e?.message}`));
        }, 10 * 60_000);
        this.sweepTimer.unref?.();
    }

    onModuleDestroy() {
        if (this.sweepTimer) clearInterval(this.sweepTimer);
    }

    // ════════════════════════════════════════════════════════════════
    //  One-time backfill: pair pre-existing clock events into sessions
    // ════════════════════════════════════════════════════════════════

    private async backfillSessionsFromRecords(): Promise<void> {
        const [sessions, records] = await Promise.all([this.sessionRepo.count(), this.recordRepo.count()]);
        if (sessions > 0 || records === 0) return;

        const all = await this.recordRepo.find({ order: { userId: 'ASC', timestamp: 'ASC' } });
        const staleMs = MAX_SESSION_HOURS * 3_600_000;
        const now = Date.now();
        const out: Partial<AttendanceSession>[] = [];
        let open: AttendanceRecord | null = null;

        const flushOpen = () => {
            if (!open) return;
            const age = now - new Date(open.timestamp).getTime();
            out.push({
                userId: open.userId,
                mode: open.source === 'online_portal' ? 'remote' : 'onsite',
                source: open.source,
                clockInRecordId: open.id,
                originalInAt: open.timestamp,
                clockInAt: open.timestamp,
                status: age > staleMs ? 'incomplete' : 'open',
            });
            open = null;
        };

        for (const r of all) {
            if (open && open.userId !== r.userId) flushOpen();
            if (r.action === 'clock_in') {
                if (open) {
                    // Two clock-ins in a row: the first was never clocked out.
                    out.push({
                        userId: open.userId,
                        mode: open.source === 'online_portal' ? 'remote' : 'onsite',
                        source: open.source,
                        clockInRecordId: open.id,
                        originalInAt: open.timestamp,
                        clockInAt: open.timestamp,
                        status: 'incomplete',
                    });
                }
                open = r;
            } else if (open && new Date(r.timestamp) > new Date(open.timestamp)) {
                out.push({
                    userId: r.userId,
                    mode: open.source === 'online_portal' ? 'remote' : 'onsite',
                    source: open.source,
                    clockInRecordId: open.id,
                    clockOutRecordId: r.id,
                    originalInAt: open.timestamp,
                    originalOutAt: r.timestamp,
                    clockInAt: open.timestamp,
                    clockOutAt: r.timestamp,
                    status: 'closed',
                });
                open = null;
            }
            // A clock-out with no preceding clock-in stays in the event log only.
        }
        flushOpen();

        if (out.length) await this.sessionRepo.save(out.map((s) => this.sessionRepo.create(s)));
        this.logger.log(`Backfilled ${out.length} working session(s) from ${records} existing attendance record(s)`);
    }

    // ════════════════════════════════════════════════════════════════
    //  Core: recording a clock event
    // ════════════════════════════════════════════════════════════════

    /**
     * Records a clock-in or clock-out inside the caller's transaction.
     *
     * The user row is locked for the duration, so concurrent events for the
     * same employee are applied one after another — two simultaneous scans
     * can never both become clock-ins. The partial unique index on open
     * sessions is the database-level backstop.
     */
    async recordClock(manager: EntityManager, input: ClockInput): Promise<ClockResult> {
        const at = input.at ?? new Date();
        const locked = await manager.query(`SELECT id, is_active FROM users WHERE id = $1 FOR UPDATE`, [input.userId]);
        if (!locked.length) throw new NotFoundException('Employee not found');

        const sessions = manager.getRepository(AttendanceSession);
        const records = manager.getRepository(AttendanceRecord);

        let open = await sessions.findOne({ where: { userId: input.userId, status: 'open' } });
        let markedIncomplete: AttendanceSession | null = null;

        if (open && at.getTime() - new Date(open.clockInAt).getTime() > MAX_SESSION_HOURS * 3_600_000) {
            // Forgotten clock-out. It does not count as worked time until an
            // administrator corrects it.
            open.status = 'incomplete';
            markedIncomplete = await sessions.save(open);
            open = null;
        }

        const action = input.action === 'toggle' ? (open ? 'clock_out' : 'clock_in') : input.action;

        if (action === 'clock_in') {
            if (open) throw new BadRequestException('Already clocked in. Clock out first.');
            const record = await records.save(records.create({
                userId: input.userId, action: 'clock_in', timestamp: at, source: input.source,
                uid: input.uid ?? null, deviceId: input.deviceId ?? null, cardId: input.cardId ?? null,
                eventId: input.eventId ?? null, createdBy: input.createdBy ?? null,
            }));
            const session = await sessions.save(sessions.create({
                userId: input.userId, mode: input.mode, source: input.source,
                clockInRecordId: record.id, originalInAt: at, clockInAt: at, status: 'open',
            }));
            return { action, session, record, workedMs: null, markedIncomplete };
        }

        if (!open) throw new BadRequestException('Not clocked in. Clock in first.');
        if (at.getTime() <= new Date(open.clockInAt).getTime()) {
            throw new BadRequestException('Clock-out time must be after the clock-in time.');
        }
        const record = await records.save(records.create({
            userId: input.userId, action: 'clock_out', timestamp: at, source: input.source,
            uid: input.uid ?? null, deviceId: input.deviceId ?? null, cardId: input.cardId ?? null,
            eventId: input.eventId ?? null, createdBy: input.createdBy ?? null,
        }));
        open.clockOutRecordId = record.id;
        open.originalOutAt = at;
        open.clockOutAt = at;
        open.status = 'closed';
        const session = await sessions.save(open);
        return {
            action, session, record, markedIncomplete,
            workedMs: at.getTime() - new Date(session.clockInAt).getTime(),
        };
    }

    /** Tell the employee's browser (header timer) and admin screens to refresh. */
    notifyChanged(userId: string) {
        try { this.realtime.emitAttendanceChanged(userId); } catch { /* realtime is best-effort */ }
    }

    /** Marks clock-ins older than MAX_SESSION_HOURS as incomplete. */
    async sweepStaleSessions(): Promise<number> {
        const cutoff = new Date(Date.now() - MAX_SESSION_HOURS * 3_600_000);
        const rows: Array<{ user_id: string }> = await this.dataSource.query(
            `UPDATE attendance_sessions SET status = 'incomplete', updated_at = now()
             WHERE status = 'open' AND clock_in_at < $1 RETURNING user_id`,
            [cutoff],
        ).then((r: any) => (Array.isArray(r?.[0]) ? r[0] : r));
        for (const r of rows ?? []) this.notifyChanged(r.user_id);
        return rows?.length ?? 0;
    }

    // ════════════════════════════════════════════════════════════════
    //  Settings
    // ════════════════════════════════════════════════════════════════

    /** First week (Monday) from which report hours are bounded by attendance; null = off. */
    async getEnforcementStart(manager?: EntityManager): Promise<LocalDate | null> {
        const repo = manager ? manager.getRepository(SystemSetting) : this.settingRepo;
        const row = await repo.findOne({ where: { key: SETTING_ENFORCEMENT_START } });
        const v = row?.value;
        return isLocalDate(v) ? v : null;
    }

    async getSettings() {
        return {
            timezone: LAB_TZ,
            maxSessionHours: MAX_SESSION_HOURS,
            standardWeekHours: STANDARD_WEEK_HOURS,
            enforcementStart: await this.getEnforcementStart(),
            currentWeek: weekStartOf(localToday()),
        };
    }

    async setEnforcementStart(actorId: string, value: string | null) {
        let next: LocalDate | null = null;
        if (value !== null && value !== undefined && value !== '') {
            if (!isLocalDate(value)) throw new BadRequestException('enforcementStart must be a date (YYYY-MM-DD) or null.');
            next = weekStartOf(value);
        }
        const previous = await this.getEnforcementStart();
        await this.settingRepo.save(this.settingRepo.create({
            key: SETTING_ENFORCEMENT_START, value: next, updatedBy: actorId,
        }));
        await this.audit.log({
            actorId, entityType: 'attendance_settings', action: 'set_enforcement_start',
            oldValue: { enforcementStart: previous }, newValue: { enforcementStart: next },
        });
        this.realtime.emitAttendanceRefresh();
        return this.getSettings();
    }

    // ════════════════════════════════════════════════════════════════
    //  Hour calculations
    // ════════════════════════════════════════════════════════════════

    private view(s: AttendanceSession, user?: User | null): SessionView {
        const closed = s.status === 'closed' && s.clockOutAt;
        return {
            id: s.id, userId: s.userId, mode: s.mode, source: s.source, status: s.status,
            corrected: s.corrected, clockInAt: s.clockInAt, clockOutAt: s.clockOutAt,
            originalInAt: s.originalInAt, originalOutAt: s.originalOutAt,
            hours: closed ? round2(msToHours(new Date(s.clockOutAt!).getTime() - new Date(s.clockInAt).getTime())) : 0,
            ...(user ? { user: { id: user.id, fullName: user.fullName, employeeId: user.employeeId } } : {}),
        };
    }

    /** Non-voided sessions that touch [start, end). */
    private async sessionsTouching(
        start: Date, end: Date, userIds?: string[], manager?: EntityManager,
    ): Promise<AttendanceSession[]> {
        const repo = manager ? manager.getRepository(AttendanceSession) : this.sessionRepo;
        const qb = repo.createQueryBuilder('s')
            .where(`s.status <> 'voided'`)
            .andWhere('s.clock_in_at < :end', { end })
            .andWhere('(s.clock_out_at IS NULL OR s.clock_out_at > :start)', { start })
            .orderBy('s.clockInAt', 'ASC');
        if (userIds) {
            if (!userIds.length) return [];
            qb.andWhere('s.user_id IN (:...userIds)', { userIds });
        }
        return qb.getMany();
    }

    /** Closed-session hours inside an interval, split by mode. */
    private hoursIn(sessions: AttendanceSession[], iv: { start: Date; end: Date }) {
        let onsite = 0;
        let remote = 0;
        for (const s of sessions) {
            if (s.status !== 'closed' || !s.clockOutAt) continue;
            const ms = overlapMs(new Date(s.clockInAt), new Date(s.clockOutAt), iv);
            if (s.mode === 'remote') remote += ms; else onsite += ms;
        }
        return { onsite: msToHours(onsite), remote: msToHours(remote) };
    }

    private buildBalance(
        user: User, weekStart: LocalDate, sessions: AttendanceSession[],
        report: WeeklyReport | null, enforcementStart: LocalDate | null,
    ): WeekBalance {
        const { onsite, remote } = this.hoursIn(sessions, weekInterval(weekStart));
        const policy = remotePolicyOf(user);
        const actual = round2(remote);
        const credited = round2(Math.min(remote, policy.limitHours));
        const onsiteHours = round2(onsite);
        const verifiedHours = round2(onsiteHours + credited);
        const cap = user.weeklyHoursCap != null ? Number(user.weeklyHoursCap) : null;
        const counted = report && COUNTED_REPORT_STATUSES.includes(report.status);
        const reportedHours = counted ? round2(Number(report!.totalHours) || 0) : 0;
        const reportedRemoteHours = counted ? round2(Number(report!.remoteHours) || 0) : 0;
        const enforcement = !!enforcementStart && weekStart >= enforcementStart;

        let maxReportableHours: number | null = cap;
        if (enforcement) maxReportableHours = cap != null ? Math.min(cap, verifiedHours) : verifiedHours;

        return {
            weekStart, enforcement, onsiteHours, verifiedHours,
            weeklyHoursCap: cap, reportedHours, reportedRemoteHours,
            reportStatus: report?.status ?? null,
            maxReportableHours,
            remainingReportableHours: maxReportableHours == null
                ? null : round2(Math.max(0, maxReportableHours - reportedHours)),
            remote: {
                ...policy,
                actualHours: actual,
                creditedHours: credited,
                remainingHours: round2(Math.max(0, policy.limitHours - actual)),
                exceeded: policy.allowed ? actual > policy.limitHours + EPS : actual > EPS,
            },
        };
    }

    private buildWeek(
        user: User, weekStart: LocalDate, sessions: AttendanceSession[],
        report: WeeklyReport | null, enforcementStart: LocalDate | null,
    ): EmployeeWeeklySummary {
        const balance = this.buildBalance(user, weekStart, sessions, report, enforcementStart);
        const week = weekInterval(weekStart);
        const days: DaySummary[] = [];
        for (let i = 0; i < 7; i++) {
            const date = addDays(weekStart, i);
            const { onsite, remote } = this.hoursIn(sessions, dayInterval(date));
            days.push({
                date,
                onsiteHours: round2(onsite),
                remoteHours: round2(remote),
                totalHours: round2(onsite + remote),
                sessions: sessions.filter((s) => localDateOf(new Date(s.clockInAt)) === date).map((s) => this.view(s)),
            });
        }
        const open = sessions.find((s) => s.status === 'open') ?? null;
        const inWeek = (s: AttendanceSession) =>
            new Date(s.clockInAt) >= week.start && new Date(s.clockInAt) < week.end;
        return {
            ...balance,
            userId: user.id, fullName: user.fullName, employeeId: user.employeeId, isActive: user.isActive,
            days,
            totalHours: balance.verifiedHours,
            openSession: open ? this.view(open) : null,
            incompleteCount: sessions.filter((s) => s.status === 'incomplete' && inWeek(s)).length,
            overReported: balance.reportedHours > balance.verifiedHours + EPS,
        };
    }

    private assertWeekStart(weekStart: string): asserts weekStart is LocalDate {
        if (!isMonday(weekStart)) {
            throw new BadRequestException('weekStart must be a Monday in YYYY-MM-DD format.');
        }
    }

    async getBalance(userId: string, weekStart: string, manager?: EntityManager): Promise<WeekBalance> {
        this.assertWeekStart(weekStart);
        const users = manager ? manager.getRepository(User) : this.userRepo;
        const reports = manager ? manager.getRepository(WeeklyReport) : this.reportRepo;
        const user = await users.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const iv = weekInterval(weekStart);
        const [sessions, report, enforcementStart] = await Promise.all([
            this.sessionsTouching(iv.start, iv.end, [userId], manager),
            reports.findOne({ where: { userId, weekStart } }),
            this.getEnforcementStart(manager),
        ]);
        return this.buildBalance(user, weekStart, sessions, report, enforcementStart);
    }

    async getEmployeeWeeklySummary(userId: string, weekStart: string): Promise<EmployeeWeeklySummary> {
        this.assertWeekStart(weekStart);
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const iv = weekInterval(weekStart);
        const [sessions, report, enforcementStart] = await Promise.all([
            this.sessionsTouching(iv.start, iv.end, [userId]),
            this.reportRepo.findOne({ where: { userId, weekStart } }),
            this.getEnforcementStart(),
        ]);
        return this.buildWeek(user, weekStart, sessions, report, enforcementStart);
    }

    /**
     * Organisation-wide week. Every employee appears — including those with
     * no attendance and those not authorised for remote work — so the remote
     * columns are explicit for everyone. Deactivated accounts are included
     * only when they have attendance or a report in the week.
     */
    async getAllEmployeesWeekly(weekStart: string): Promise<EmployeeWeeklySummary[]> {
        this.assertWeekStart(weekStart);
        const iv = weekInterval(weekStart);
        const [users, sessions, reports, enforcementStart] = await Promise.all([
            this.userRepo.find({ order: { fullName: 'ASC' } }),
            this.sessionsTouching(iv.start, iv.end),
            this.reportRepo.find({ where: { weekStart } }),
            this.getEnforcementStart(),
        ]);
        const byUser = new Map<string, AttendanceSession[]>();
        for (const s of sessions) {
            if (!byUser.has(s.userId)) byUser.set(s.userId, []);
            byUser.get(s.userId)!.push(s);
        }
        const reportBy = new Map(reports.map((r) => [r.userId, r]));
        return users
            .filter((u) => u.isActive || byUser.has(u.id) || reportBy.has(u.id))
            .map((u) => this.buildWeek(u, weekStart, byUser.get(u.id) ?? [], reportBy.get(u.id) ?? null, enforcementStart));
    }

    async getAllEmployeesBiweekly(biweekStart: string) {
        this.assertWeekStart(biweekStart);
        const [week1, week2] = await Promise.all([
            this.getAllEmployeesWeekly(biweekStart),
            this.getAllEmployeesWeekly(addDays(biweekStart, 7)),
        ]);
        return { week1, week2, biweekStart };
    }

    async getMonthly(month: string) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '')) {
            throw new BadRequestException('month must be in YYYY-MM format.');
        }
        const iv = monthInterval(month);
        const [users, sessions] = await Promise.all([
            this.userRepo.find({ order: { fullName: 'ASC' } }),
            this.sessionsTouching(iv.start, iv.end),
        ]);
        const byUser = new Map<string, AttendanceSession[]>();
        for (const s of sessions) {
            if (!byUser.has(s.userId)) byUser.set(s.userId, []);
            byUser.get(s.userId)!.push(s);
        }
        return {
            month,
            employees: users
                .filter((u) => u.isActive || byUser.has(u.id))
                .map((u) => {
                    const list = byUser.get(u.id) ?? [];
                    const { onsite, remote } = this.hoursIn(list, iv);
                    const daysWorked = iv.days.filter((d) => {
                        const h = this.hoursIn(list, dayInterval(d));
                        return h.onsite + h.remote > 0;
                    }).length;
                    return {
                        userId: u.id, fullName: u.fullName, employeeId: u.employeeId, isActive: u.isActive,
                        onsiteHours: round2(onsite), remoteHours: round2(remote),
                        totalHours: round2(onsite + remote),
                        daysWorked,
                        sessions: list.filter((s) => s.status === 'closed').length,
                        incomplete: list.filter((s) => s.status === 'incomplete').length,
                    };
                }),
        };
    }

    // ════════════════════════════════════════════════════════════════
    //  Employee self-service (read-only, plus the remote portal clock)
    // ════════════════════════════════════════════════════════════════

    private async findOpen(userId: string): Promise<AttendanceSession | null> {
        const open = await this.sessionRepo.findOne({ where: { userId, status: 'open' } });
        if (open && Date.now() - new Date(open.clockInAt).getTime() > MAX_SESSION_HOURS * 3_600_000) {
            open.status = 'incomplete';
            await this.sessionRepo.save(open);
            return null;
        }
        return open;
    }

    /** Drives the header timer. Purely a view of central attendance data. */
    async getCurrent(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const open = await this.findOpen(userId);
        const week = weekStartOf(localToday());
        const balance = await this.getBalance(userId, week);
        const last = open ? null : await this.sessionRepo.findOne({
            where: { userId, status: 'closed' }, order: { clockOutAt: 'DESC' },
        });
        return {
            serverTime: new Date(),
            timezone: LAB_TZ,
            employeeId: user.employeeId,
            session: open ? this.view(open) : null,
            lastClockOutAt: last?.clockOutAt ?? null,
            remote: {
                ...balance.remote,
                /** Whether the portal clock-in button should be offered right now. */
                canClockIn: !open && balance.remote.allowed && balance.remote.remainingHours > EPS && !user.isOnHold,
                canClockOut: !!open && open.mode === 'remote',
            },
        };
    }

    async getMyHistory(userId: string, from?: string, to?: string) {
        const end = isLocalDate(to) ? to : localToday();
        const start = isLocalDate(from) ? from : addDays(end, -27);
        if (start > end) throw new BadRequestException('from must not be after to.');
        if (addDays(start, 366) < end) throw new BadRequestException('Range is limited to one year.');
        const iv = { start: startOfLocalDay(start), end: startOfLocalDay(addDays(end, 1)) };
        const sessions = await this.sessionsTouching(iv.start, iv.end, [userId]);
        const days: Array<{ date: LocalDate; onsiteHours: number; remoteHours: number; totalHours: number }> = [];
        for (let d = start; d <= end; d = addDays(d, 1)) {
            const h = this.hoursIn(sessions, dayInterval(d));
            if (h.onsite + h.remote > 0) {
                days.push({ date: d, onsiteHours: round2(h.onsite), remoteHours: round2(h.remote), totalHours: round2(h.onsite + h.remote) });
            }
        }
        const total = this.hoursIn(sessions, iv);
        return {
            from: start, to: end, timezone: LAB_TZ,
            sessions: sessions.map((s) => this.view(s)).reverse(),
            days: days.reverse(),
            onsiteHours: round2(total.onsite),
            remoteHours: round2(total.remote),
            totalHours: round2(total.onsite + total.remote),
        };
    }

    async getMyHours(userId: string, weekStart: string) {
        const weekly = await this.getEmployeeWeeklySummary(userId, weekStart);
        const previous = await this.getEmployeeWeeklySummary(userId, addDays(weekStart, -7));
        return { weekly, biweekly: { week1: previous, week2: weekly } };
    }

    /**
     * Portal clock-in. Only for employees an administrator has authorised
     * for remote work, and only while they have remote hours left this week.
     */
    async selfClockIn(userId: string, ip?: string) {
        const result = await this.dataSource.transaction(async (manager) => {
            const user = await manager.getRepository(User).findOne({ where: { id: userId, isActive: true } });
            if (!user) throw new NotFoundException('User not found or inactive');
            if (user.isOnHold) throw new ForbiddenException('Your account is on hold.');
            if (!user.remoteWorkAllowed) {
                throw new ForbiddenException(
                    'Remote work is not authorised for your account. Use the RFID reader to clock in.',
                );
            }
            // Lock first so the balance is read after any concurrent clock event.
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
            const balance = await this.getBalance(userId, weekStartOf(localToday()), manager);
            if (balance.remote.remainingHours <= EPS) {
                throw new ForbiddenException(
                    `You have used your remote-work allowance for this week (${balance.remote.limitHours}h).`,
                );
            }
            return this.recordClock(manager, { userId, action: 'clock_in', source: 'online_portal', mode: 'remote' });
        });
        await this.audit.log({
            actorId: userId, entityType: 'attendance_session', entityId: result.session.id,
            action: 'portal_clock_in', newValue: { clockInAt: result.session.clockInAt, mode: 'remote' }, ipAddress: ip,
        });
        this.notifyChanged(userId);
        return this.view(result.session);
    }

    async selfClockOut(userId: string, ip?: string) {
        const result = await this.dataSource.transaction(async (manager) => {
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [userId]);
            const open = await manager.getRepository(AttendanceSession).findOne({ where: { userId, status: 'open' } });
            if (open && open.mode !== 'remote') {
                throw new ForbiddenException('You clocked in at the RFID reader. Clock out at the reader.');
            }
            return this.recordClock(manager, { userId, action: 'clock_out', source: 'online_portal', mode: 'remote' });
        });
        await this.audit.log({
            actorId: userId, entityType: 'attendance_session', entityId: result.session.id,
            action: 'portal_clock_out',
            newValue: { clockInAt: result.session.clockInAt, clockOutAt: result.session.clockOutAt, mode: 'remote' },
            ipAddress: ip,
        });
        this.notifyChanged(userId);
        return this.view(result.session);
    }

    // ════════════════════════════════════════════════════════════════
    //  Administrator: views
    // ════════════════════════════════════════════════════════════════

    async listSessions(q: {
        from?: string; to?: string; userId?: string; status?: string; mode?: string; search?: string;
    }) {
        const end = isLocalDate(q.to) ? q.to : localToday();
        const start = isLocalDate(q.from) ? q.from : weekStartOf(end);
        if (start > end) throw new BadRequestException('from must not be after to.');
        const qb = this.sessionRepo.createQueryBuilder('s')
            .innerJoinAndSelect('s.user', 'u')
            .where('s.clock_in_at >= :start AND s.clock_in_at < :end', {
                start: startOfLocalDay(start), end: startOfLocalDay(addDays(end, 1)),
            })
            .orderBy('s.clockInAt', 'DESC')
            .take(2000);
        if (q.userId) qb.andWhere('s.user_id = :userId', { userId: q.userId });
        if (q.status) qb.andWhere('s.status = :status', { status: q.status });
        else qb.andWhere(`s.status <> 'voided'`);
        if (q.mode) qb.andWhere('s.mode = :mode', { mode: q.mode });
        if (q.search?.trim()) {
            qb.andWhere('(u.full_name ILIKE :s OR u.employee_id ILIKE :s OR u.username ILIKE :s)', {
                s: `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`,
            });
        }
        const rows = await qb.getMany();
        return { from: start, to: end, timezone: LAB_TZ, sessions: rows.map((s) => this.view(s, s.user)) };
    }

    /** Records that need an administrator's attention. */
    async getExceptions() {
        const since = new Date(Date.now() - 45 * 24 * 3_600_000);
        const rows = await this.sessionRepo.createQueryBuilder('s')
            .innerJoinAndSelect('s.user', 'u')
            .where(`s.status = 'incomplete'`)
            .orWhere(`s.status = 'open' AND s.clock_in_at < :longOpen`, { longOpen: new Date(Date.now() - 12 * 3_600_000) })
            .orWhere(
                `s.status = 'closed' AND s.clock_in_at >= :since AND (
                    s.clock_out_at - s.clock_in_at > interval '12 hours'
                 OR s.clock_out_at - s.clock_in_at < interval '1 minute')`,
                { since },
            )
            .orderBy('s.clockInAt', 'DESC')
            .take(500)
            .getMany();

        const items = rows.map((s) => {
            const v = this.view(s, s.user);
            let type = 'incomplete';
            let message = 'Clocked in but never clocked out — counts as 0 hours until corrected.';
            if (s.status === 'open') {
                type = 'long_open';
                message = 'Still clocked in after more than 12 hours.';
            } else if (s.status === 'closed') {
                if (v.hours > 12) { type = 'long_session'; message = `Unusually long session (${v.hours}h).`; }
                else { type = 'short_session'; message = 'Session shorter than one minute.'; }
            }
            return { type, message, session: v };
        });

        // Remote-work overruns and over-reporting, this week and last.
        const thisWeek = weekStartOf(localToday());
        const weekly = [
            ...(await this.getAllEmployeesWeekly(thisWeek)),
            ...(await this.getAllEmployeesWeekly(addDays(thisWeek, -7))),
        ];
        const flags = weekly
            .filter((w) => w.remote.exceeded || w.overReported)
            .map((w) => ({
                userId: w.userId, fullName: w.fullName, employeeId: w.employeeId, weekStart: w.weekStart,
                remoteExceeded: w.remote.exceeded, overReported: w.overReported,
                remoteActualHours: w.remote.actualHours, remoteLimitHours: w.remote.limitHours,
                reportedHours: w.reportedHours, verifiedHours: w.verifiedHours,
            }));

        return { sessions: items, weekly: flags };
    }

    async getCorrections(q: { sessionId?: string; userId?: string; limit?: number }) {
        const qb = this.correctionRepo.createQueryBuilder('c')
            .leftJoin(User, 'u', 'u.id = c.user_id')
            .addSelect(['u.full_name AS employee_name', 'u.employee_id AS employee_code'])
            .orderBy('c.createdAt', 'DESC')
            .take(Math.min(Math.max(Number(q.limit) || 200, 1), 1000));
        if (q.sessionId) qb.andWhere('c.session_id = :sid', { sid: q.sessionId });
        if (q.userId) qb.andWhere('c.user_id = :uid', { uid: q.userId });
        const { entities, raw } = await qb.getRawAndEntities();
        return entities.map((c, i) => ({
            ...c, employeeName: raw[i]?.employee_name ?? null, employeeId: raw[i]?.employee_code ?? null,
        }));
    }

    /** Attendance, RFID and remote-work entries of the portal audit log. */
    async getAuditTrail(limit = 200) {
        const rows = await this.dataSource.query(
            `SELECT a.id, a.timestamp, a.entity_type AS "entityType", a.entity_id AS "entityId",
                    a.action, a.old_value AS "oldValue", a.new_value AS "newValue",
                    a.ip_address AS "ipAddress", a.actor_id AS "actorId", u.full_name AS "actorName"
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
             WHERE a.entity_type IN ('attendance_session', 'attendance_settings', 'attendance_import',
                                     'rfid_card', 'rfid_device', 'rfid_registration', 'user_remote_work')
             ORDER BY a.timestamp DESC LIMIT $1`,
            [Math.min(Math.max(Number(limit) || 200, 1), 1000)],
        );
        return rows;
    }

    /** Attendance + reporting block of an employee's profile. */
    async getUserSummary(userId: string, weeks = 8) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const thisWeek = weekStartOf(localToday());
        const first = addDays(thisWeek, -7 * (weeks - 1));
        const iv = { start: startOfLocalDay(first), end: startOfLocalDay(addDays(thisWeek, 7)) };
        const weekStarts = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, -7 * i));
        const [sessions, reports, enforcementStart, totals, open] = await Promise.all([
            this.sessionsTouching(iv.start, iv.end, [userId]),
            this.reportRepo.find({ where: { userId, weekStart: In(weekStarts) } }),
            this.getEnforcementStart(),
            this.dataSource.query(
                `SELECT mode,
                        COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out_at - clock_in_at))), 0) / 3600.0 AS hours,
                        COUNT(*)::int AS sessions
                 FROM attendance_sessions WHERE user_id = $1 AND status = 'closed' GROUP BY mode`,
                [userId],
            ),
            this.findOpen(userId),
        ]);
        const reportBy = new Map(reports.map((r) => [String(r.weekStart).slice(0, 10), r]));
        const onsite = Number(totals.find((t: any) => t.mode === 'onsite')?.hours ?? 0);
        const remote = Number(totals.find((t: any) => t.mode === 'remote')?.hours ?? 0);
        return {
            userId, fullName: user.fullName, employeeId: user.employeeId, timezone: LAB_TZ,
            currentSession: open ? this.view(open) : null,
            allTime: {
                onsiteHours: round2(onsite), remoteHours: round2(remote), totalHours: round2(onsite + remote),
                sessions: totals.reduce((n: number, t: any) => n + Number(t.sessions), 0),
            },
            remotePolicy: remotePolicyOf(user),
            weeks: weekStarts.map((ws) => {
                const touching = sessions.filter((s) => {
                    const w = weekInterval(ws);
                    return new Date(s.clockInAt) < w.end && (!s.clockOutAt || new Date(s.clockOutAt) > w.start);
                });
                return this.buildBalance(user, ws, touching, reportBy.get(ws) ?? null, enforcementStart);
            }),
            recentSessions: sessions.slice(-30).reverse().map((s) => this.view(s)),
        };
    }

    // ════════════════════════════════════════════════════════════════
    //  Administrator: manual entries and corrections (all audited)
    // ════════════════════════════════════════════════════════════════

    private requireReason(reason: unknown): string {
        const r = typeof reason === 'string' ? reason.trim() : '';
        if (r.length < 3) throw new BadRequestException('A reason is required for every manual entry or correction.');
        if (r.length > 500) throw new BadRequestException('Reason is limited to 500 characters.');
        return r;
    }

    private parseInstant(v: unknown, label: string): Date {
        const d = new Date(String(v));
        if (!v || isNaN(d.getTime())) throw new BadRequestException(`${label} is not a valid date/time.`);
        if (d.getTime() > Date.now() + 60_000) throw new BadRequestException(`${label} cannot be in the future.`);
        return d;
    }

    private async assertNoOverlap(
        manager: EntityManager, userId: string, start: Date, end: Date | null, ignoreId?: string,
    ) {
        const qb = manager.getRepository(AttendanceSession).createQueryBuilder('s')
            .where('s.user_id = :userId', { userId })
            .andWhere(`s.status IN ('open', 'closed')`)
            .andWhere('s.clock_in_at < :end', { end: end ?? new Date(8.64e15) })
            .andWhere('(s.clock_out_at IS NULL OR s.clock_out_at > :start)', { start });
        if (ignoreId) qb.andWhere('s.id <> :ignoreId', { ignoreId });
        if (await qb.getCount()) {
            throw new BadRequestException('This overlaps another attendance session for the same employee.');
        }
    }

    private async logCorrection(
        manager: EntityManager, admin: { id: string; name: string }, session: AttendanceSession,
        action: CorrectionAction, oldValues: any, newValues: any, reason: string,
    ) {
        await manager.getRepository(AttendanceCorrection).save(
            manager.getRepository(AttendanceCorrection).create({
                sessionId: session.id, userId: session.userId, action, oldValues, newValues, reason,
                correctedBy: admin.id, correctedByName: admin.name,
            }),
        );
    }

    private async adminIdentity(adminId: string) {
        const admin = await this.userRepo.findOne({ where: { id: adminId } });
        return { id: adminId, name: admin?.fullName ?? 'Administrator' };
    }

    private snapshot(s: AttendanceSession) {
        return { clockInAt: s.clockInAt, clockOutAt: s.clockOutAt, mode: s.mode, status: s.status };
    }

    /** Administrator clocks an employee in or out "now" (e.g. forgotten card). */
    async adminClock(adminId: string, userId: string, action: 'clock_in' | 'clock_out', reasonRaw: unknown, ip?: string) {
        const reason = this.requireReason(reasonRaw);
        const admin = await this.adminIdentity(adminId);
        const result = await this.dataSource.transaction(async (manager) => {
            const user = await manager.getRepository(User).findOne({ where: { id: userId, isActive: true } });
            if (!user) throw new NotFoundException('User not found or inactive');
            const r = await this.recordClock(manager, {
                userId, action, source: 'manual', mode: 'onsite', createdBy: adminId,
            });
            await this.logCorrection(manager, admin, r.session, 'manual_clock', null,
                { action, at: r.record.timestamp, ...this.snapshot(r.session) }, reason);
            return r;
        });
        await this.audit.log({
            actorId: adminId, entityType: 'attendance_session', entityId: result.session.id,
            action: `admin_${action}`, newValue: { employeeId: userId, reason, ...this.snapshot(result.session) }, ipAddress: ip,
        });
        this.notifyChanged(userId);
        return this.view(result.session);
    }

    /** Administrator adds a complete session that was never recorded. */
    async adminCreateSession(adminId: string, body: {
        userId: string; clockInAt: string; clockOutAt: string; mode?: SessionMode; reason: string;
    }, ip?: string) {
        const reason = this.requireReason(body.reason);
        const start = this.parseInstant(body.clockInAt, 'Clock-in');
        const end = this.parseInstant(body.clockOutAt, 'Clock-out');
        if (end <= start) throw new BadRequestException('Clock-out must be after clock-in.');
        if (end.getTime() - start.getTime() > 24 * 3_600_000) throw new BadRequestException('A session cannot be longer than 24 hours.');
        const mode: SessionMode = body.mode === 'remote' ? 'remote' : 'onsite';
        const admin = await this.adminIdentity(adminId);

        const session = await this.dataSource.transaction(async (manager) => {
            const user = await manager.getRepository(User).findOne({ where: { id: body.userId } });
            if (!user) throw new NotFoundException('User not found');
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [body.userId]);
            await this.assertNoOverlap(manager, body.userId, start, end);
            const records = manager.getRepository(AttendanceRecord);
            const rin = await records.save(records.create({
                userId: body.userId, action: 'clock_in', timestamp: start, source: 'admin_correction', createdBy: adminId,
            }));
            const rout = await records.save(records.create({
                userId: body.userId, action: 'clock_out', timestamp: end, source: 'admin_correction', createdBy: adminId,
            }));
            const sessions = manager.getRepository(AttendanceSession);
            const s = await sessions.save(sessions.create({
                userId: body.userId, mode, source: 'admin_correction',
                clockInRecordId: rin.id, clockOutRecordId: rout.id,
                originalInAt: null, originalOutAt: null,
                clockInAt: start, clockOutAt: end, status: 'closed', corrected: true,
            }));
            await this.logCorrection(manager, admin, s, 'create', null, this.snapshot(s), reason);
            return s;
        });
        await this.audit.log({
            actorId: adminId, entityType: 'attendance_session', entityId: session.id, action: 'admin_create_session',
            newValue: { employeeId: body.userId, reason, ...this.snapshot(session) }, ipAddress: ip,
        });
        this.notifyChanged(body.userId);
        return this.view(session);
    }

    /**
     * Corrects a session. The original timestamps stay in original_in_at /
     * original_out_at and in the event log; only the effective values move,
     * and the before/after pair is written to attendance_corrections.
     */
    async adminCorrectSession(adminId: string, sessionId: string, body: {
        clockInAt?: string; clockOutAt?: string | null; mode?: SessionMode; reason: string;
    }, ip?: string) {
        const reason = this.requireReason(body.reason);
        const admin = await this.adminIdentity(adminId);

        const { session, before } = await this.dataSource.transaction(async (manager) => {
            const sessions = manager.getRepository(AttendanceSession);
            const found = await sessions.findOne({ where: { id: sessionId } });
            if (!found) throw new NotFoundException('Session not found');
            if (found.status === 'voided') throw new BadRequestException('A voided session cannot be edited.');
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [found.userId]);
            const s = (await sessions.findOne({ where: { id: sessionId } }))!;
            const old = this.snapshot(s);

            const start = body.clockInAt !== undefined ? this.parseInstant(body.clockInAt, 'Clock-in') : new Date(s.clockInAt);
            let end: Date | null = s.clockOutAt ? new Date(s.clockOutAt) : null;
            if (body.clockOutAt !== undefined && body.clockOutAt !== null && body.clockOutAt !== '') {
                end = this.parseInstant(body.clockOutAt, 'Clock-out');
            }
            if (end && end <= start) throw new BadRequestException('Clock-out must be after clock-in.');
            if (end && end.getTime() - start.getTime() > 24 * 3_600_000) throw new BadRequestException('A session cannot be longer than 24 hours.');
            if (!end && s.status === 'incomplete') {
                throw new BadRequestException('Provide a clock-out time to complete this session.');
            }
            await this.assertNoOverlap(manager, s.userId, start, end, s.id);

            const wasUnfinished = s.status === 'open' || s.status === 'incomplete';
            s.clockInAt = start;
            s.clockOutAt = end;
            if (body.mode === 'onsite' || body.mode === 'remote') s.mode = body.mode;
            if (end) s.status = 'closed';
            s.corrected = true;
            const saved = await sessions.save(s);
            const next = this.snapshot(saved);
            if (JSON.stringify(old) === JSON.stringify(next)) throw new BadRequestException('Nothing was changed.');
            await this.logCorrection(manager, admin, saved, wasUnfinished && end ? 'close' : 'edit', old, next, reason);
            return { session: saved, before: old };
        });
        await this.audit.log({
            actorId: adminId, entityType: 'attendance_session', entityId: session.id, action: 'admin_correct_session',
            oldValue: before, newValue: { reason, ...this.snapshot(session) }, ipAddress: ip,
        });
        this.notifyChanged(session.userId);
        return this.view(session);
    }

    /** Cancels a session. Nothing is deleted — it stops counting and stays in the log. */
    async adminVoidSession(adminId: string, sessionId: string, reasonRaw: unknown, ip?: string) {
        const reason = this.requireReason(reasonRaw);
        const admin = await this.adminIdentity(adminId);
        const { session, before } = await this.dataSource.transaction(async (manager) => {
            const sessions = manager.getRepository(AttendanceSession);
            const s = await sessions.findOne({ where: { id: sessionId } });
            if (!s) throw new NotFoundException('Session not found');
            if (s.status === 'voided') throw new BadRequestException('Session is already voided.');
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [s.userId]);
            const old = this.snapshot(s);
            s.status = 'voided';
            s.corrected = true;
            const saved = await sessions.save(s);
            await this.logCorrection(manager, admin, saved, 'void', old, this.snapshot(saved), reason);
            return { session: saved, before: old };
        });
        await this.audit.log({
            actorId: adminId, entityType: 'attendance_session', entityId: session.id, action: 'admin_void_session',
            oldValue: before, newValue: { reason, status: 'voided' }, ipAddress: ip,
        });
        this.notifyChanged(session.userId);
        return this.view(session);
    }

    // ════════════════════════════════════════════════════════════════
    //  Weekly-report limits (called by ReportsService inside its transaction)
    // ════════════════════════════════════════════════════════════════

    /**
     * Throws unless the proposed report totals fit the employee's limits:
     * weekly cap, individual remote-work policy and — for weeks under
     * enforcement — verified attendance. Must be called inside a transaction
     * that already holds the per-user lock, so two simultaneous submissions
     * cannot both pass.
     */
    async assertReportWithinLimits(
        manager: EntityManager, userId: string, weekStart: string, totalHours: number, remoteHours: number,
    ): Promise<WeekBalance> {
        if (!isFinite(totalHours) || !isFinite(remoteHours) || totalHours < 0 || remoteHours < 0) {
            throw new BadRequestException('Hours must be zero or positive numbers.');
        }
        if (remoteHours > totalHours + EPS) throw new BadRequestException('Remote hours cannot exceed total hours.');
        const b = await this.getBalance(userId, weekStart, manager);
        const onsiteReported = totalHours - remoteHours;

        if (remoteHours > EPS && !b.remote.allowed) {
            throw new BadRequestException('Remote work is not authorised for this account. All hours must be logged as on-site.');
        }
        if (remoteHours > b.remote.limitHours + EPS) {
            throw new BadRequestException(
                `Remote hours (${round2(remoteHours)}h) exceed the allowed maximum of ${b.remote.limitHours}h for this week.`,
            );
        }
        if (b.weeklyHoursCap != null && totalHours > b.weeklyHoursCap + EPS) {
            throw new BadRequestException(`Total hours (${round2(totalHours)}h) exceed the weekly cap of ${b.weeklyHoursCap}h.`);
        }
        if (b.enforcement) {
            if (totalHours > b.verifiedHours + EPS) {
                throw new BadRequestException(
                    `Reported hours (${round2(totalHours)}h) exceed the ${b.verifiedHours}h of verified attendance for this week.`,
                );
            }
            if (remoteHours > b.remote.creditedHours + EPS) {
                throw new BadRequestException(
                    `Remote hours (${round2(remoteHours)}h) exceed the ${b.remote.creditedHours}h of verified remote attendance for this week.`,
                );
            }
            if (onsiteReported > b.onsiteHours + EPS) {
                throw new BadRequestException(
                    `On-site hours (${round2(onsiteReported)}h) exceed the ${b.onsiteHours}h of verified on-site attendance for this week.`,
                );
            }
        }
        return b;
    }

    // ════════════════════════════════════════════════════════════════
    //  Legacy CSV import (exports from the original RFID-ShiftMate)
    // ════════════════════════════════════════════════════════════════

    async importCsv(adminId: string, csvContent: string) {
        const cleaned = csvContent.replace(/^﻿/, '');
        const lines = cleaned.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter(Boolean);
        if (lines.length < 2) throw new BadRequestException('CSV file is empty or has no data rows');

        const users = await this.userRepo.find({ where: { isActive: true } });
        const byEmp = new Map<string, User>();
        for (const u of users) if (u.employeeId) byEmp.set(u.employeeId.trim(), u);

        let imported = 0, skipped = 0, duplicates = 0;
        const errors: string[] = [];
        const touched = new Set<string>();

        const rows = lines.slice(1).map((line, i) => ({ line, row: i + 2 }));
        for (const { line, row } of rows) {
            const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
            if (parts.length < 6) { skipped++; continue; }
            const [dateStr, timeStr, uid, , empCode, actionRaw] = parts;
            if (!dateStr || /^-+$/.test(dateStr) || !timeStr || /^-+[:\-]+-*$/.test(timeStr)) { skipped++; continue; }
            if (!isLocalDate(dateStr)) { errors.push(`Row ${row}: unrecognised date "${dateStr}" (expected YYYY-MM-DD)`); skipped++; continue; }
            const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeStr);
            if (!tm || +tm[1] > 23 || +tm[2] > 59 || +(tm[3] ?? 0) > 59) {
                errors.push(`Row ${row}: unrecognised time "${timeStr}" (expected HH:MM or HH:MM:SS)`); skipped++; continue;
            }
            // The reader's clock ran on lab-local time.
            const timestamp = localToInstant(dateStr, +tm[1], +tm[2], +(tm[3] ?? 0));
            const a = actionRaw.toLowerCase().replace(/[\s-]/g, '_');
            const action = ['clock_in', 'in', 'checkin', 'check_in', 'clk_in'].includes(a) ? 'clock_in'
                : ['clock_out', 'out', 'checkout', 'check_out', 'clk_out'].includes(a) ? 'clock_out' : null;
            if (!action) { errors.push(`Row ${row}: invalid action "${actionRaw}"`); skipped++; continue; }
            const user = byEmp.get(empCode.trim());
            if (!user) { errors.push(`Row ${row}: no active user with employee_id "${empCode}"`); skipped++; continue; }

            const dup = await this.recordRepo.createQueryBuilder('r')
                .where('r.user_id = :u AND r.action = :a AND r.source = :s', { u: user.id, a: action, s: 'csv_import' })
                .andWhere('r.timestamp BETWEEN :lo AND :hi', {
                    lo: new Date(timestamp.getTime() - 60_000), hi: new Date(timestamp.getTime() + 60_000),
                })
                .getCount();
            if (dup) { duplicates++; continue; }

            try {
                await this.dataSource.transaction((manager) => this.recordClock(manager, {
                    userId: user.id, action, source: 'csv_import', mode: 'onsite',
                    at: timestamp, uid: uid || null, createdBy: adminId,
                }));
                imported++;
                touched.add(user.id);
            } catch (e: any) {
                errors.push(`Row ${row}: ${e?.message ?? 'could not be applied'}`);
                skipped++;
            }
        }
        await this.audit.log({
            actorId: adminId, entityType: 'attendance_import', action: 'csv_import',
            newValue: { imported, skipped, duplicates, errorCount: errors.length },
        });
        for (const id of touched) this.notifyChanged(id);
        return { imported, skipped, duplicates, errors };
    }
}
