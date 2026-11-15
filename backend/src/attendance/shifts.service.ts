import {
    Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Shift, ShiftAssignment } from './shift.entity';
import { AttendanceSession } from './attendance-session.entity';
import { Schedule } from '../schedules/schedule.entity';
import { User } from '../users/user.entity';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
    LocalDate, isLocalDate, localToday, isoWeekday, localToInstant,
    dayInterval, overlapMs, msToHours, round2, addDays, weekStartOf, LAB_TZ,
} from '../common/tz';

/** How a person's day looks against what was expected of them. */
export type DayStatus =
    | 'present'        // on shift and clocked in on time
    | 'late'           // on shift, clocked in after the grace period
    | 'absent'         // on shift, never clocked in, and the shift has started
    | 'upcoming'       // on shift, which has not started yet
    | 'working'        // currently clocked in
    | 'off'            // not on shift today
    | 'unscheduled';   // clocked in without a shift today

export interface DayRow {
    userId: string;
    fullName: string;
    employeeId: string | null;
    shift: {
        id: string; name: string; startTime: string; endTime: string;
        graceMinutes: number; source: 'schedule' | 'shift';
    } | null;
    expectedStart: Date | null;
    expectedEnd: Date | null;
    firstClockIn: Date | null;
    lastClockOut: Date | null;
    openSession: boolean;
    hours: number;
    lateByMinutes: number | null;
    status: DayStatus;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

/**
 * Schedules name their days; shifts number them. This is the one place the
 * two conventions meet, indexed by ISO weekday (1 = Monday … 7 = Sunday) to
 * match isoWeekday() in common/tz.
 */
const DAY_NAMES: Record<number, string> = {
    1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday',
    5: 'Friday', 6: 'Saturday', 7: 'Sunday',
};

/** Day name back to ISO weekday, for locating an entry's actual date. */
const DAY_NUMBERS: Record<string, number> = Object.fromEntries(
    Object.entries(DAY_NAMES).map(([n, name]) => [name, Number(n)]),
);

/** Grace for an expectation that came from somebody's own schedule. */
const DEFAULT_GRACE_MINUTES = 10;

/**
 * How far ahead assigning a shift writes into somebody's schedule.
 *
 * Far enough to be useful, short enough that a rota change does not have to
 * be unpicked from a year of future weeks. Weeks beyond this still resolve
 * through the assignment itself, so nothing is missing — they simply are not
 * written down yet.
 */
const SCHEDULE_HORIZON_WEEKS = 8;

/** '9:00' and '09:00:00' both mean the same thing; store one shape. */
function normaliseClock(v: string): string {
    const [h = '0', m = '0'] = String(v).split(':');
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:00`;
}

@Injectable()
export class ShiftsService {
    constructor(
        @InjectRepository(Shift)
        private readonly shiftRepo: Repository<Shift>,
        @InjectRepository(ShiftAssignment)
        private readonly assignmentRepo: Repository<ShiftAssignment>,
        @InjectRepository(AttendanceSession)
        private readonly sessionRepo: Repository<AttendanceSession>,
        @InjectRepository(Schedule)
        private readonly scheduleRepo: Repository<Schedule>,
        @InjectRepository(User)
        private readonly userRepo: Repository<User>,
        private readonly auditService: AuditService,
        private readonly notifications: NotificationsService,
    ) { }

    // ───────────────────────────────── shifts

    private normaliseTime(value: unknown, label: string): string {
        if (typeof value !== 'string' || !TIME_RE.test(value)) {
            throw new BadRequestException(`${label} must be a time of day, like 09:00.`);
        }
        const [, hh, mm, , ss] = value.match(TIME_RE)!;
        return `${hh}:${mm}:${ss ?? '00'}`;
    }

    private normaliseDays(value: unknown): number[] {
        if (!Array.isArray(value) || value.length === 0) {
            throw new BadRequestException('Choose at least one day of the week.');
        }
        const days = [...new Set(value.map(Number))].sort((a, b) => a - b);
        if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
            throw new BadRequestException('Days of the week must be 1 (Monday) through 7 (Sunday).');
        }
        return days;
    }

    async listShifts(includeInactive = false): Promise<any[]> {
        const shifts = await this.shiftRepo.find({
            where: includeInactive ? {} : { isActive: true },
            order: { startTime: 'ASC' },
        });
        // Each shift reports how many people are on it right now, which is the
        // number an administrator actually looks for in the list.
        const today = localToday();
        return Promise.all(shifts.map(async (shift) => ({
            ...shift,
            assignedCount: await this.assignmentRepo
                .createQueryBuilder('a')
                .where('a.shift_id = :id', { id: shift.id })
                .andWhere('a.start_date <= :today', { today })
                .andWhere('(a.end_date IS NULL OR a.end_date >= :today)', { today })
                .getCount(),
        })));
    }

    async createShift(dto: any, actorId: string): Promise<Shift> {
        const shift = this.shiftRepo.create({
            name: String(dto.name ?? '').trim(),
            startTime: this.normaliseTime(dto.startTime, 'Start time'),
            endTime: this.normaliseTime(dto.endTime, 'End time'),
            daysOfWeek: this.normaliseDays(dto.daysOfWeek),
            graceMinutes: Math.max(0, Math.min(240, Number(dto.graceMinutes ?? 10))),
            isActive: dto.isActive ?? true,
            notes: dto.notes?.trim() || null,
            createdById: actorId,
        });
        if (!shift.name) throw new BadRequestException('Give the shift a name.');

        const saved = await this.shiftRepo.save(shift);
        await this.auditService.log({
            actorId, entityType: 'Shift', entityId: saved.id, action: 'create', newValue: saved,
        });
        return saved;
    }

    async updateShift(id: string, dto: any, actorId: string): Promise<Shift> {
        const shift = await this.shiftRepo.findOne({ where: { id } });
        if (!shift) throw new NotFoundException('Shift not found');
        const before = { ...shift };

        if (dto.name !== undefined) shift.name = String(dto.name).trim();
        if (dto.startTime !== undefined) shift.startTime = this.normaliseTime(dto.startTime, 'Start time');
        if (dto.endTime !== undefined) shift.endTime = this.normaliseTime(dto.endTime, 'End time');
        if (dto.daysOfWeek !== undefined) shift.daysOfWeek = this.normaliseDays(dto.daysOfWeek);
        if (dto.graceMinutes !== undefined) shift.graceMinutes = Math.max(0, Math.min(240, Number(dto.graceMinutes)));
        if (dto.isActive !== undefined) shift.isActive = !!dto.isActive;
        if (dto.notes !== undefined) shift.notes = dto.notes?.trim() || null;

        const saved = await this.shiftRepo.save(shift);
        await this.auditService.log({
            actorId, entityType: 'Shift', entityId: id, action: 'update',
            oldValue: before, newValue: saved,
        });
        return saved;
    }

    /**
     * Retires a shift without deleting it.
     *
     * Past assignments point at it and past days were judged by it, so
     * removing the row would rewrite history. Deactivating takes it out of
     * every picker and leaves the record intact.
     */
    async deactivateShift(id: string, actorId: string): Promise<Shift> {
        const shift = await this.shiftRepo.findOne({ where: { id } });
        if (!shift) throw new NotFoundException('Shift not found');
        shift.isActive = false;
        const saved = await this.shiftRepo.save(shift);
        // End any assignment still running, so nobody stays on a retired shift.
        const running = await this.assignmentRepo.find({ where: { shiftId: id, endDate: IsNull() } });
        await this.assignmentRepo
            .createQueryBuilder()
            .update(ShiftAssignment)
            .set({ endDate: localToday() })
            .where('shift_id = :id AND end_date IS NULL', { id })
            .execute();

        // And take it back out of everyone's schedules from tomorrow on.
        const today = localToday();
        for (const a of running) {
            await this.withdrawShiftFromSchedules(a.userId, id, today);
        }
        await this.auditService.log({
            actorId, entityType: 'Shift', entityId: id, action: 'deactivate', oldValue: shift,
        });
        return saved;
    }

    // ──────────────────────────── assignments

    async listAssignments(q: { shiftId?: string; userId?: string; activeOnly?: boolean }): Promise<any[]> {
        const qb = this.assignmentRepo.createQueryBuilder('a')
            .leftJoinAndSelect('a.shift', 'shift')
            .leftJoinAndSelect('a.user', 'user')
            .orderBy('a.start_date', 'DESC');
        if (q.shiftId) qb.andWhere('a.shift_id = :shiftId', { shiftId: q.shiftId });
        if (q.userId) qb.andWhere('a.user_id = :userId', { userId: q.userId });
        if (q.activeOnly) {
            const today = localToday();
            qb.andWhere('a.start_date <= :today', { today })
                .andWhere('(a.end_date IS NULL OR a.end_date >= :today)', { today });
        }
        const rows = await qb.getMany();
        return rows.map((a) => ({
            id: a.id,
            shiftId: a.shiftId,
            userId: a.userId,
            startDate: a.startDate,
            endDate: a.endDate,
            shift: a.shift ? { id: a.shift.id, name: a.shift.name, startTime: a.shift.startTime, endTime: a.shift.endTime } : null,
            user: a.user ? { id: a.user.id, fullName: a.user.fullName, employeeId: a.user.employeeId } : null,
        }));
    }

    async assign(dto: any, actorId: string): Promise<ShiftAssignment> {
        const shift = await this.shiftRepo.findOne({ where: { id: dto.shiftId } });
        if (!shift) throw new NotFoundException('Shift not found');
        if (!shift.isActive) throw new BadRequestException('That shift has been retired.');

        const user = await this.userRepo.findOne({ where: { id: dto.userId } });
        if (!user) throw new NotFoundException('User not found');

        const startDate = isLocalDate(dto.startDate) ? dto.startDate : localToday();
        const endDate = dto.endDate && isLocalDate(dto.endDate) ? dto.endDate : null;
        if (endDate && endDate < startDate) {
            throw new BadRequestException('The end date cannot come before the start date.');
        }

        /*
         * One shift at a time per person — but ending one and starting
         * another on the same day is a handover, not a conflict.
         *
         * This used `a.end_date >= :start`, so an assignment ended TODAY
         * still counted as covering today and refused a new assignment
         * starting today. That is the ordinary way a rota changes: unassign,
         * then reassign. The result was a 409 nobody expected, the new shift
         * never got an assignment, and the person was told only that their
         * old one had ended.
         *
         * The comparison is now exclusive at that edge: an assignment whose
         * last day is the new one's first day no longer blocks it. Where both
         * cover the same day, `shiftFor` takes the one that started most
         * recently, so the day still has exactly one answer.
         */
        const clash = await this.assignmentRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.shift', 'shift')
            .where('a.user_id = :userId', { userId: dto.userId })
            .andWhere('a.start_date <= :end', { end: endDate ?? '9999-12-31' })
            .andWhere('(a.end_date IS NULL OR a.end_date > :start)', { start: startDate })
            .getOne();
        if (clash) {
            throw new ConflictException(
                `${user.fullName} is already on the ${clash.shift?.name ?? 'another'} shift for that period`
                + `${clash.endDate ? ` (until ${clash.endDate})` : ' (ongoing)'}. End that assignment first.`,
            );
        }

        const saved = await this.assignmentRepo.save(this.assignmentRepo.create({
            shiftId: dto.shiftId,
            userId: dto.userId,
            startDate,
            endDate,
            createdById: actorId,
        }));

        // Assigning a shift IS assigning a schedule: write it onto the
        // person's own weekly schedule, on their row only.
        const weeksWritten = await this.writeShiftIntoSchedules(dto.userId, shift, startDate, endDate);

        // And tell them. A schedule that appears without a word is worse than
        // no schedule: the person has no reason to go and look, and the first
        // they hear of it is being marked late.
        const days = (shift.daysOfWeek ?? []).map((d) => DAY_NAMES[d]?.slice(0, 3)).filter(Boolean).join(', ');
        await this.notifications.create(
            dto.userId,
            'shift_assigned',
            `You have been put on the ${shift.name} shift`,
            `${days} · ${shift.startTime.slice(0, 5)}–${shift.endTime.slice(0, 5)}`
            + `, from ${startDate}${endDate ? ` until ${endDate}` : ''}. `
            + `It is on your schedule for the next ${weeksWritten} week(s). `
            + `Anything you had already put on a day was left as it is.`,
            saved.id,
            actorId,
            'shift',
        ).catch(() => { /* a failed notification must not fail the assignment */ });

        await this.auditService.log({
            actorId, entityType: 'ShiftAssignment', entityId: saved.id, action: 'create',
            newValue: { ...saved, scheduleWeeksWritten: weeksWritten },
        });
        return { ...saved, scheduleWeeksWritten: weeksWritten } as ShiftAssignment;
    }

    /** Ends an assignment as of a date, keeping it on the record. */
    async endAssignment(id: string, endDate: string | undefined, actorId: string): Promise<ShiftAssignment> {
        const assignment = await this.assignmentRepo.findOne({ where: { id } });
        if (!assignment) throw new NotFoundException('Assignment not found');
        const when = isLocalDate(endDate) ? endDate : localToday();
        if (when < assignment.startDate) {
            throw new BadRequestException('The end date cannot come before the assignment started.');
        }
        const before = { ...assignment };
        assignment.endDate = when;
        const saved = await this.assignmentRepo.save(assignment);

        // Take the assigned entries back out of the weeks that have not
        // happened yet. Past weeks keep what was expected at the time, and
        // anything the person wrote themselves is never touched.
        const cleared = await this.withdrawShiftFromSchedules(
            assignment.userId, assignment.shiftId, when,
        );

        const shift = await this.shiftRepo.findOne({ where: { id: assignment.shiftId } });
        await this.notifications.create(
            assignment.userId,
            'shift_ended',
            `You are no longer on the ${shift?.name ?? 'assigned'} shift`,
            `It ends on ${when}. The assigned days after that have been taken off your `
            + `schedule; days already past are kept, and anything you added yourself is untouched.`,
            assignment.id,
            actorId,
            'shift',
        ).catch(() => { /* non-fatal */ });

        await this.auditService.log({
            actorId, entityType: 'ShiftAssignment', entityId: id, action: 'end',
            oldValue: before, newValue: { ...saved, futureScheduleWeeksCleared: cleared },
        });
        return saved;
    }

    /** The shift template a person is assigned to on a given day, or null. */
    async shiftFor(userId: string, date: LocalDate): Promise<Shift | null> {
        const assignment = await this.assignmentRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.shift', 'shift')
            .where('a.user_id = :userId', { userId })
            .andWhere('a.start_date <= :date', { date })
            .andWhere('(a.end_date IS NULL OR a.end_date >= :date)', { date })
            // On the day of a handover two assignments can both cover the
            // date. The one that started most recently is the current one.
            .orderBy('a.start_date', 'DESC')
            .addOrderBy('a.created_at', 'DESC')
            .getOne();
        if (!assignment?.shift) return null;
        return assignment.shift.daysOfWeek?.includes(isoWeekday(date)) ? assignment.shift : null;
    }

    /**
     * When this person is expected in on this day — the one answer everything
     * else is built on.
     *
     * There are two places an expectation can come from, and they are not two
     * sources of truth:
     *
     *   1. The person's own schedule for that week. This is the concrete
     *      record — real days, real times, already validated for overlaps and
     *      the weekly hours cap — so if it covers the day, it IS the
     *      expectation. That is what makes a schedule somebody submits show
     *      up immediately as their shift.
     *
     *   2. Otherwise, a shift template an administrator assigned them.
     *      Assigning a shift also writes it into their schedule (see
     *      `writeShiftIntoSchedules`), so this is the fallback for weeks that
     *      have not been materialised yet rather than a competing answer.
     *
     * Grace comes from the assigned shift where there is one, because that is
     * where an administrator sets it; a schedule the person wrote themselves
     * uses the lab default.
     */
    async expectedFor(userId: string, date: LocalDate): Promise<{
        startTime: string;
        endTime: string;
        graceMinutes: number;
        source: 'schedule' | 'shift';
        shiftId: string | null;
        shiftName: string;
    } | null> {
        const template = await this.shiftFor(userId, date);
        const dayName = DAY_NAMES[isoWeekday(date)];

        const schedule = await this.scheduleRepo.findOne({
            where: { userId, weekStart: weekStartOf(date) },
        });
        const entries = (schedule?.shifts ?? [])
            .filter((x) => x?.day === dayName && x?.start && x?.end)
            .sort((a, c) => a.start.localeCompare(c.start));

        if (entries.length) {
            // Several windows in a day (a split shift) are treated as one span
            // from the first start to the last end: attendance measures when
            // somebody was in, not which half of the day they were due.
            const first = entries[0];
            const last = entries.reduce((l, x) => (x.end > l.end ? x : l), entries[0]);
            return {
                startTime: normaliseClock(first.start),
                endTime: normaliseClock(last.end),
                graceMinutes: template?.graceMinutes ?? DEFAULT_GRACE_MINUTES,
                source: 'schedule',
                shiftId: template?.id ?? null,
                shiftName: template?.name ?? 'Own schedule',
            };
        }

        if (template) {
            return {
                startTime: template.startTime,
                endTime: template.endTime,
                graceMinutes: template.graceMinutes,
                source: 'shift',
                shiftId: template.id,
                shiftName: template.name,
            };
        }
        return null;
    }

    /**
     * Writes an assigned shift into the person's own schedule.
     *
     * This is what "an administrator assigns somebody a schedule" means in
     * practice: the assignment is not a parallel record the person cannot
     * see, it lands in the same weekly schedule they fill in themselves, on
     * their row and nobody else's.
     *
     * Anything the person already put on a day is left exactly as it is — the
     * assignment fills the days they have not spoken for. Written entries are
     * tagged with the shift's id so ending the assignment can withdraw them
     * again without disturbing the person's own.
     *
     * The weekly hours cap is deliberately not enforced here. It guards what
     * somebody may submit for themselves; an administrator's instruction is
     * not a submission, and failing an assignment because of it would leave
     * the assignment saved and the schedule half-written.
     */
    private async writeShiftIntoSchedules(
        userId: string,
        shift: Shift,
        from: LocalDate,
        until: LocalDate | null,
        horizonWeeks = SCHEDULE_HORIZON_WEEKS,
    ): Promise<number> {
        const today = localToday();
        let week = weekStartOf(from > today ? from : today);
        let weeksWritten = 0;

        for (let i = 0; i < horizonWeeks; i++) {
            if (until && week > until) break;

            const existing = await this.scheduleRepo.findOne({ where: { userId, weekStart: week } });
            const entries = [...(existing?.shifts ?? [])];
            let changed = false;

            for (const isoDay of shift.daysOfWeek ?? []) {
                const dayName = DAY_NAMES[isoDay];
                if (!dayName) continue;

                const dayDate = addDays(week, isoDay - 1);
                if (dayDate < from) continue;            // before the assignment starts
                if (until && dayDate > until) continue;  // after it ends

                // The person's own entry for that day wins.
                if (entries.some((x) => x?.day === dayName)) continue;

                entries.push({
                    day: dayName,
                    start: shift.startTime.slice(0, 5),
                    end: shift.endTime.slice(0, 5),
                    note: `${shift.name} (assigned)`,
                    source: 'shift',
                    shiftId: shift.id,
                });
                changed = true;
            }

            if (changed) {
                if (existing) {
                    existing.shifts = entries;
                    await this.scheduleRepo.save(existing);
                } else {
                    await this.scheduleRepo.save(this.scheduleRepo.create({
                        userId,
                        weekStart: week,
                        shifts: entries,
                        // An administrator's instruction does not need the
                        // person's own submission to be reviewed.
                        status: 'Approved',
                        notes: `Assigned shift: ${shift.name}`,
                    }));
                }
                weeksWritten++;
            }
            week = addDays(week, 7);
        }
        return weeksWritten;
    }

    /**
     * Withdraws a shift's entries from a person's future schedules.
     *
     * Only entries this shift wrote are removed, and only from weeks that
     * have not happened yet — past weeks are a record of what was expected at
     * the time and are left alone.
     */
    private async withdrawShiftFromSchedules(
        userId: string,
        shiftId: string,
        afterDate: LocalDate,
    ): Promise<number> {
        const rows = await this.scheduleRepo
            .createQueryBuilder('s')
            .where('s.user_id = :userId', { userId })
            .andWhere('s.week_start >= :fromWeek', { fromWeek: weekStartOf(afterDate) })
            .getMany();

        let cleared = 0;
        for (const row of rows) {
            const before = row.shifts ?? [];
            // Day by day, not week by week. The week an assignment ends in
            // contains days that have already happened, and those were
            // genuinely expected — removing them would rewrite the record
            // that the Today view for those days is judged against. Only
            // days after the end date are withdrawn.
            const kept = before.filter((x) => {
                if (x?.shiftId !== shiftId) return true;          // not ours
                const isoDay = DAY_NUMBERS[x.day];
                if (!isoDay) return true;                          // unknown day name: leave it
                const entryDate = addDays(row.weekStart as LocalDate, isoDay - 1);
                return entryDate <= afterDate;                     // already passed: keep
            });
            if (kept.length !== before.length) {
                row.shifts = kept;
                await this.scheduleRepo.save(row);
                cleared++;
            }
        }
        return cleared;
    }

    // ──────────────────────────── the day view

    /**
     * Everyone's day: what was expected, what happened, and the gap.
     *
     * This is the view the module was missing. Weekly, biweekly and monthly
     * totals answer "how much", and nothing answered "who is in, who is
     * late, who never came" — the question a lab actually asks each morning.
     */
    async getDay(date?: string): Promise<{
        date: LocalDate;
        timezone: string;
        serverTime: Date;
        rows: DayRow[];
        summary: {
            onShift: number; fromSchedule: number; fromShift: number;
            working: number; present: number; late: number; absent: number;
            off: number; unscheduled: number;
        };
    }> {
        const day: LocalDate = isLocalDate(date) ? date : localToday();
        const iv = dayInterval(day);
        const now = new Date();
        const isToday = day === localToday();

        const users = await this.userRepo.find({
            where: { isActive: true },
            order: { fullName: 'ASC' },
        });

        // Every session touching the day, in one query rather than per user.
        const sessions = await this.sessionRepo
            .createQueryBuilder('s')
            .where('s.clock_in_at < :end', { end: iv.end })
            .andWhere('(s.clock_out_at IS NULL OR s.clock_out_at > :start)', { start: iv.start })
            .andWhere(`s.status <> 'void'`)
            .getMany();

        const byUser = new Map<string, AttendanceSession[]>();
        for (const s of sessions) {
            const list = byUser.get(s.userId) ?? [];
            list.push(s);
            byUser.set(s.userId, list);
        }

        const rows: DayRow[] = [];
        for (const user of users) {
            const expected = await this.expectedFor(user.id, day);
            const mine = (byUser.get(user.id) ?? []).sort(
                (a, b) => new Date(a.clockInAt).getTime() - new Date(b.clockInAt).getTime(),
            );

            const firstClockIn = mine.length ? new Date(mine[0].clockInAt) : null;
            const closed = mine.filter((s) => s.clockOutAt);
            const lastClockOut = closed.length
                ? new Date(Math.max(...closed.map((s) => new Date(s.clockOutAt!).getTime())))
                : null;
            const openSession = mine.some((s) => s.status === 'open');
            const hours = round2(msToHours(mine.reduce(
                (ms, s) => ms + overlapMs(new Date(s.clockInAt), s.clockOutAt ? new Date(s.clockOutAt) : now, iv),
                0,
            )));

            let expectedStart: Date | null = null;
            let expectedEnd: Date | null = null;
            if (expected) {
                const [sh, sm] = expected.startTime.split(':').map(Number);
                const [eh, em] = expected.endTime.split(':').map(Number);
                expectedStart = localToInstant(day, sh, sm);
                // An end before the start means the window runs past midnight.
                const endsNextDay = expected.endTime <= expected.startTime;
                expectedEnd = localToInstant(endsNextDay ? addDays(day, 1) : day, eh, em);
            }

            let lateByMinutes: number | null = null;
            let status: DayStatus;

            if (!expected) {
                status = mine.length ? 'unscheduled' : 'off';
            } else if (firstClockIn) {
                const graceEnd = new Date(expectedStart!.getTime() + expected.graceMinutes * 60_000);
                if (firstClockIn > graceEnd) {
                    lateByMinutes = Math.round((firstClockIn.getTime() - expectedStart!.getTime()) / 60_000);
                    status = openSession ? 'working' : 'late';
                } else {
                    status = openSession ? 'working' : 'present';
                }
            } else if (isToday && now < expectedStart!) {
                status = 'upcoming';
            } else if (isToday && now <= new Date(expectedStart!.getTime() + expected.graceMinutes * 60_000)) {
                // Still inside the grace period — not late yet.
                status = 'upcoming';
            } else {
                status = 'absent';
            }

            rows.push({
                userId: user.id,
                fullName: user.fullName,
                employeeId: user.employeeId,
                shift: expected
                    ? {
                        id: expected.shiftId ?? '', name: expected.shiftName,
                        startTime: expected.startTime, endTime: expected.endTime,
                        graceMinutes: expected.graceMinutes,
                        // Where the expectation came from: the person's own
                        // schedule, or a shift an administrator assigned.
                        source: expected.source,
                    }
                    : null,
                expectedStart,
                expectedEnd,
                firstClockIn,
                lastClockOut,
                openSession,
                hours,
                lateByMinutes,
                status,
            });
        }

        const count = (s: DayStatus) => rows.filter((r) => r.status === s).length;
        return {
            date: day,
            timezone: LAB_TZ,
            serverTime: now,
            rows,
            summary: {
                onShift: rows.filter((r) => r.shift).length,
                fromSchedule: rows.filter((r) => r.shift?.source === 'schedule').length,
                fromShift: rows.filter((r) => r.shift?.source === 'shift').length,
                working: count('working'),
                present: count('present'),
                late: count('late'),
                absent: count('absent'),
                off: count('off'),
                unscheduled: count('unscheduled'),
            },
        };
    }

    /** A person's own shift, for their attendance view. */
    async myShift(userId: string, date?: string): Promise<any> {
        const day: LocalDate = isLocalDate(date) ? date : localToday();
        const expected = await this.expectedFor(userId, day);
        const shift = await this.shiftFor(userId, day);
        const assignment = await this.assignmentRepo
            .createQueryBuilder('a')
            .leftJoinAndSelect('a.shift', 'shift')
            .where('a.user_id = :userId', { userId })
            .andWhere('a.start_date <= :date', { date: day })
            .andWhere('(a.end_date IS NULL OR a.end_date >= :date)', { date: day })
            .orderBy('a.start_date', 'DESC')
            .addOrderBy('a.created_at', 'DESC')
            .getOne();

        return {
            date: day,
            timezone: LAB_TZ,
            onShiftToday: !!expected,
            // What is expected today and where it came from — their own
            // schedule, or a shift an administrator assigned them.
            expected: expected ?? null,
            shift: shift ?? null,
            assignment: assignment
                ? { id: assignment.id, startDate: assignment.startDate, endDate: assignment.endDate }
                : null,
            // The whole rota, so somebody can see which days they are expected.
            daysOfWeek: assignment?.shift?.daysOfWeek ?? [],
        };
    }
}
