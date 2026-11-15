import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Schedule } from './schedule.entity';
import { DiscordService } from '../discord/discord.service';
import { UsersService } from '../users/users.service';
import { NotificationsService } from '../notifications/notifications.service';
import { effectivePermissions } from '../roles/role.entity';

@Injectable()
export class SchedulesService {
    constructor(
        @InjectRepository(Schedule)
        private readonly schedRepo: Repository<Schedule>,
        private readonly discordService: DiscordService,
        private readonly usersService: UsersService,
        private readonly notificationsService: NotificationsService,
    ) { }

    /** Convert "HH:MM" to total minutes since midnight */
    private toMinutes(time: string): number {
        if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            throw new BadRequestException(`Invalid time format: "${time}" — expected HH:MM (24h)`);
        }
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    }

    /**
     * Saves the schedule somebody submits for a week.
     *
     * Days an administrator assigned are carried through. A submission
     * replaces the whole week's row, so without this, filling in Monday would
     * silently delete an assigned Tuesday — and the person would have no idea
     * they had just cancelled their own shift. A day the person does specify
     * is theirs: their entry replaces the assigned one, which is the same
     * precedence the attendance view uses.
     */
    async submit(userId: string, weekStart: string, shifts: any[], notes?: string) {
        // ── Shift time validation ─────────────────────────────────────────────
        for (const shift of shifts) {
            // Explicit guard against empty strings that bypass DTO string validation
            if (!shift.start || !shift.end) {
                throw new BadRequestException(
                    `Shift on ${shift.day}: start and end times are required`,
                );
            }
            const startMins = this.toMinutes(shift.start);
            const endMins   = this.toMinutes(shift.end);
            if (endMins <= startMins) {
                throw new BadRequestException(
                    `Shift on ${shift.day}: end time (${shift.end}) must be after start time (${shift.start})`,
                );
            }
        }

        // ── Overlap detection (same day) ─────────────────────────────────────
        const byDay: Record<string, { start: number; end: number }[]> = {};
        for (const shift of shifts) {
            if (!byDay[shift.day]) byDay[shift.day] = [];
            byDay[shift.day].push({ start: this.toMinutes(shift.start), end: this.toMinutes(shift.end) });
        }
        for (const [day, dayShifts] of Object.entries(byDay)) {
            const sorted = [...dayShifts].sort((a, b) => a.start - b.start);
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i].start < sorted[i - 1].end) {
                    throw new BadRequestException(`Overlapping shifts detected on ${day}`);
                }
            }
        }

        // ── Hours cap enforcement ──────────────────────────────────────────────
        const user = await this.usersService.findById(userId);
        if (user.weeklyHoursCap !== null && user.weeklyHoursCap !== undefined) {
            const totalHours = shifts.reduce((sum, s) => {
                const hrs = (this.toMinutes(s.end) - this.toMinutes(s.start)) / 60;
                return sum + (hrs > 0 ? hrs : 0);
            }, 0);
            if (totalHours > user.weeklyHoursCap) {
                throw new ForbiddenException(
                    `Schedule exceeds your weekly hours cap of ${user.weeklyHoursCap}h (submitted: ${totalHours.toFixed(1)}h)`,
                );
            }
        }

        let schedule = await this.schedRepo.findOne({ where: { userId, weekStart } });

        // Carry over assigned days this submission did not write over.
        const submittedDays = new Set(shifts.map((x: any) => x?.day));
        const carriedFromShift = (schedule?.shifts ?? []).filter(
            (x: any) => x?.source === 'shift' && !submittedDays.has(x.day),
        );
        const merged = carriedFromShift.length ? [...shifts, ...carriedFromShift] : shifts;

        if (schedule) {
            schedule.shifts = merged;
            schedule.notes = notes ?? null;
            schedule.submittedAt = new Date();
            schedule.status = 'Submitted';
            schedule.reviewNote = null;
            schedule.reviewedBy = null;
            schedule.reviewedAt = null;
            schedule.discordPosted = false;
        } else {
            schedule = this.schedRepo.create({ userId, weekStart, shifts: merged, notes, status: 'Submitted' });
        }
        const saved = await this.schedRepo.save(schedule);

        // Notify everyone who can review schedules: schedule managers and
        // project leaders (who lead the teams whose hours are being planned).
        const allUsers = await this.usersService.findAll();
        const managers = allUsers.filter((u) => {
            if (!u.isActive) return false;
            const perms = effectivePermissions(u.permissions);
            return perms.manage_schedules || perms.lead_projects;
        });
        const submitter = await this.usersService.findById(userId);
        for (const mgr of managers) {
            await this.notificationsService.create(
                mgr.id,
                'schedule_submitted',
                'Schedule Submitted',
                `${submitter.fullName} submitted a schedule for week of ${weekStart}`,
                saved.id,
            );
        }

        return saved;
    }

    async findByWeek(weekStart: string) {
        return this.schedRepo.find({
            where: { weekStart },
            relations: ['user'],
            order: { submittedAt: 'ASC' },
        });
    }

    async findMySchedules(userId: string) {
        return this.schedRepo.find({
            where: { userId },
            order: { weekStart: 'DESC' },
        });
    }

    async postToDiscord(weekStart: string) {
        // Permission is enforced at the controller layer via @Permissions('post_discord').
        const allSchedules = await this.findByWeek(weekStart);
        const approved = allSchedules.filter((s) => s.status === 'Approved');
        if (approved.length === 0) {
            throw new BadRequestException('No approved schedules to post — review and approve submissions first');
        }
        await this.discordService.postSchedule(weekStart, approved);

        // Mark only approved as posted
        const ids = approved.map((s) => s.id);
        if (ids.length) {
            await this.schedRepo
                .createQueryBuilder()
                .update()
                .set({ discordPosted: true })
                .whereInIds(ids)
                .execute();
        }
        return { posted: approved.length };
    }

    async postToDiscordImage(weekStart: string, imageBuffer: Buffer): Promise<{ message: string }> {
        // Permission is enforced at the controller layer via @Permissions('post_discord').
        const allSchedules = await this.findByWeek(weekStart);
        const approved = allSchedules.filter((s) => s.status === 'Approved');
        if (approved.length === 0) {
            throw new BadRequestException('No approved schedules to post — review and approve submissions first');
        }
        await this.discordService.postScheduleImage(weekStart, imageBuffer);
        // Mark only approved schedules as posted
        const ids = approved.map((s) => s.id);
        if (ids.length) {
            await this.schedRepo
                .createQueryBuilder()
                .update()
                .set({ discordPosted: true })
                .whereInIds(ids)
                .execute();
        }
        return { message: 'Schedule image posted to Discord!' };
    }

    async review(
        scheduleId: string,
        reviewerId: string,
        action: 'approve' | 'deny' | 'revision',
        note?: string,
    ) {
        const schedule = await this.schedRepo.findOne({ where: { id: scheduleId } });
        if (!schedule) throw new NotFoundException(`Schedule ${scheduleId} not found`);

        if (schedule.status !== 'Submitted' && schedule.status !== 'Needs Revision') {
            throw new BadRequestException(`Cannot review a schedule with status "${schedule.status}"`);
        }

        const statusMap = {
            approve: 'Approved',
            deny: 'Denied',
            revision: 'Needs Revision',
        };
        schedule.status = statusMap[action];
        schedule.reviewedBy = reviewerId;
        schedule.reviewedAt = new Date();
        schedule.reviewNote = note ?? null;

        const saved = await this.schedRepo.save(schedule);

        // Notify the schedule owner
        const reviewer = await this.usersService.findById(reviewerId);
        const titleMap = {
            approve: 'Schedule Approved',
            deny: 'Schedule Denied',
            revision: 'Schedule Needs Revision',
        };
        await this.notificationsService.create(
            schedule.userId,
            'schedule_reviewed',
            titleMap[action],
            `Your schedule for week of ${schedule.weekStart} was ${statusMap[action].toLowerCase()} by ${reviewer.fullName}${note ? ': ' + note : ''}`,
            saved.id,
        );

        return saved;
    }

    async deleteSchedule(id: string): Promise<void> {
        const schedule = await this.schedRepo.findOne({ where: { id } });
        if (!schedule) throw new NotFoundException(`Schedule ${id} not found`);
        await this.schedRepo.remove(schedule);
    }
}
