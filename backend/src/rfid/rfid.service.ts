import {
    Injectable, BadRequestException, ConflictException, NotFoundException, Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import * as crypto from 'crypto';
import { RfidDevice, RfidCard, RfidRegistrationSession, RfidEventLog } from './rfid.entity';
import { User } from '../users/user.entity';
import { AttendanceRecord } from '../attendance/attendance-record.entity';
import { AttendanceSession } from '../attendance/attendance-session.entity';
import { AttendanceService } from '../attendance/attendance.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { formatLocalTime, localDateOf, LAB_TZ } from '../common/tz';

/** How long a reader stays in registration mode waiting for a card. */
export const REGISTRATION_TIMEOUT_S = Number(process.env.RFID_REGISTRATION_TIMEOUT_SECONDS ?? 60);
/** A second tap of the same card inside this window is a duplicate, not a clock-out. */
export const DUPLICATE_WINDOW_S = Number(process.env.RFID_DUPLICATE_WINDOW_SECONDS ?? 60);
/** A reader that has not polled for this long is shown as offline. */
export const DEVICE_ONLINE_WINDOW_S = Number(process.env.RFID_ONLINE_WINDOW_SECONDS ?? 20);

export type SyncStatus = 'synced' | 'pending' | 'failed' | 'disabled';

/** The reply a reader renders on its screen. Deliberately small and flat. */
export interface DeviceScanResponse {
    ok: boolean;
    result:
        | 'clock_in' | 'clock_out' | 'registered'
        | 'duplicate' | 'unknown_card' | 'card_removed' | 'inactive_employee'
        | 'pending_signup'
        | 'registration_failed' | 'invalid_card'
        /** The direction chosen on the reader cannot apply right now. */
        | 'wrong_direction';
    title: string;
    line1: string;
    line2: string;
    employeeName?: string;
    employeeId?: string | null;
    /** Authoritative server timestamp of the recorded event. */
    timestamp?: string;
    /** Epoch seconds, so the reader can keep its clock in step. */
    serverTime: number;
    replayed?: boolean;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Card UIDs are compared as upper-case hex with no separators. */
export function normalizeUid(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const uid = raw.replace(/[\s:.\-]/g, '').toUpperCase();
    // MIFARE/ISO14443A UIDs are 4, 7 or 10 bytes.
    return /^[0-9A-F]+$/.test(uid) && [8, 14, 20].includes(uid.length) ? uid : null;
}

const fmtDuration = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60_000));
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

@Injectable()
export class RfidService {
    private readonly logger = new Logger(RfidService.name);

    constructor(
        @InjectRepository(RfidDevice) private readonly deviceRepo: Repository<RfidDevice>,
        @InjectRepository(RfidCard) private readonly cardRepo: Repository<RfidCard>,
        @InjectRepository(RfidRegistrationSession) private readonly regRepo: Repository<RfidRegistrationSession>,
        @InjectRepository(RfidEventLog) private readonly logRepo: Repository<RfidEventLog>,
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        private readonly dataSource: DataSource,
        private readonly attendance: AttendanceService,
        private readonly audit: AuditService,
        private readonly realtime: RealtimeGateway,
    ) {}

    // ════════════════════════════════════════════════════════════════
    //  Reader authentication
    // ════════════════════════════════════════════════════════════════

    async authenticateDevice(deviceId: string, apiKey: string): Promise<{ device?: RfidDevice; reason: string }> {
        if (!deviceId || !apiKey) return { reason: 'missing_credentials' };
        const device = await this.deviceRepo.findOne({ where: { deviceId } });
        // Compare against a dummy hash when the reader is unknown so both
        // paths take the same time.
        const expected = Buffer.from(device?.apiKeyHash ?? sha256('unknown-device'), 'hex');
        const given = Buffer.from(sha256(apiKey), 'hex');
        const match = expected.length === given.length && crypto.timingSafeEqual(expected, given);
        if (!device || !match) return { reason: device ? 'bad_key' : 'unknown_device' };
        if (!device.isActive) return { reason: 'disabled' };
        return { device, reason: 'ok' };
    }

    async touchDevice(device: RfidDevice, ip?: string, firmware?: string | null) {
        const patch: Partial<RfidDevice> = { lastSeenAt: new Date() };
        if (ip && ip !== device.ipAddress) patch.ipAddress = ip.slice(0, 64);
        if (firmware && firmware !== device.firmwareVersion) patch.firmwareVersion = firmware;
        const wasOffline = !this.isOnline(device);
        await this.deviceRepo.update(device.id, patch);
        Object.assign(device, patch);
        if (wasOffline) this.realtime.emitRfidRegistration(null, { sessionId: '', userId: '', stage: 'reader_online' });
    }

    async logAuthFailure(deviceCode: string, reason: string, ip?: string) {
        try {
            await this.logRepo.save(this.logRepo.create({
                kind: 'auth_failed', result: reason, deviceCode: deviceCode.slice(0, 64) || null, ipAddress: ip?.slice(0, 64) ?? null,
            }));
        } catch { /* logging must never mask the 401 */ }
    }

    isOnline(device: Pick<RfidDevice, 'lastSeenAt' | 'isActive'>): boolean {
        return !!device.isActive && !!device.lastSeenAt
            && Date.now() - new Date(device.lastSeenAt).getTime() < DEVICE_ONLINE_WINDOW_S * 1000;
    }

    // ════════════════════════════════════════════════════════════════
    //  Reader endpoints
    // ════════════════════════════════════════════════════════════════

    /** Heartbeat + "what should I be showing?" */
    async poll(device: RfidDevice) {
        const reg = await this.waitingSession(device.id);
        const now = new Date();
        const base = {
            deviceName: device.name,
            serverTime: Math.floor(now.getTime() / 1000),
            localTime: formatLocalTime(now),
            localDate: localDateOf(now),
            timezone: LAB_TZ,
            pollSeconds: 2,
        };
        if (!reg) return { mode: 'attendance' as const, ...base };
        return {
            mode: 'registration' as const,
            ...base,
            registration: {
                employeeName: reg.user?.fullName ?? '',
                employeeId: reg.user?.employeeId ?? '',
                replace: reg.mode === 'replace',
                secondsLeft: Math.max(0, Math.ceil((new Date(reg.expiresAt).getTime() - now.getTime()) / 1000)),
            },
        };
    }

    /** The live registration session for a reader, expiring it first if it timed out. */
    private async waitingSession(deviceDbId: string, manager?: EntityManager): Promise<RfidRegistrationSession | null> {
        const repo = manager ? manager.getRepository(RfidRegistrationSession) : this.regRepo;
        const reg = await repo.findOne({ where: { deviceId: deviceDbId, status: 'waiting' }, relations: ['user'] });
        if (!reg) return null;
        if (new Date(reg.expiresAt).getTime() <= Date.now()) {
            reg.status = 'expired';
            reg.failureReason = 'No card was presented before the registration window closed.';
            reg.completedAt = new Date();
            await repo.save(reg);
            this.realtime.emitRfidRegistration(reg.initiatedBy, {
                sessionId: reg.id, userId: reg.userId, stage: 'expired', message: reg.failureReason,
            });
            return null;
        }
        return reg;
    }

    /**
     * A card was presented at a reader.
     *
     * The reader sends only the card UID and an event id. Everything else is
     * decided here: who owns the card, whether they may clock, whether this
     * is a clock-in or a clock-out, the authoritative time, and whether the
     * event is a duplicate. The response is returned only after the
     * transaction has committed — so "success" on the reader's screen always
     * means the event is in the central database.
     */
    async handleScan(
        device: RfidDevice,
        dto: {
            eventId: string; uid: string; deviceTime?: string;
            intent?: 'clock_in' | 'clock_out';
        },
        ip?: string,
    ): Promise<DeviceScanResponse> {
        const afterCommit: Array<() => void> = [];
        const response = await this.dataSource.transaction(async (manager) => {
            const now = new Date();
            const serverTime = Math.floor(now.getTime() / 1000);
            const uid = normalizeUid(dto.uid);
            const deviceTime = dto.deviceTime && !isNaN(Date.parse(dto.deviceTime)) ? new Date(dto.deviceTime) : null;

            // Claim the event id. If this exact event was already processed
            // (the reader retried after a lost response) return what was
            // answered the first time instead of recording it again.
            const claimed: Array<{ id: string }> = await manager.query(
                `INSERT INTO rfid_event_log (event_id, device_id, device_code, kind, uid, result, ip_address, device_time)
                 VALUES ($1, $2, $3, 'scan', $4, 'processing', $5, $6)
                 ON CONFLICT (device_id, event_id) WHERE event_id IS NOT NULL DO NOTHING
                 RETURNING id`,
                [dto.eventId, device.id, device.deviceId, uid ?? String(dto.uid).slice(0, 32), ip?.slice(0, 64) ?? null, deviceTime],
            );
            if (!claimed.length) {
                const prior = await manager.getRepository(RfidEventLog).findOne({
                    where: { deviceId: device.id, eventId: dto.eventId },
                });
                const stored = prior?.response as DeviceScanResponse | undefined;
                if (stored?.result) return { ...stored, serverTime, replayed: true };
                throw new ConflictException('This event is still being processed. Retry shortly.');
            }
            const logId = claimed[0].id;

            const finish = async (
                res: Omit<DeviceScanResponse, 'serverTime'>, kind: string, userId: string | null, detail?: string,
            ): Promise<DeviceScanResponse> => {
                const full: DeviceScanResponse = { ...res, serverTime };
                await manager.query(
                    `UPDATE rfid_event_log SET kind = $2, result = $3, user_id = $4, detail = $5, response = $6 WHERE id = $1`,
                    [logId, kind, res.result, userId, detail ?? null, JSON.stringify(full)],
                );
                return full;
            };

            await manager.getRepository(RfidDevice).update(device.id, { lastScanAt: now });

            if (!uid) {
                return finish({
                    ok: false, result: 'invalid_card', title: 'Card Not Readable', line1: 'Please try again', line2: '',
                }, 'scan', null, `unreadable uid "${String(dto.uid).slice(0, 40)}"`);
            }

            // ── Registration mode: this reader is waiting for one employee's card ──
            const reg = await this.waitingSession(device.id, manager);
            if (reg) return this.completeRegistration(manager, device, reg, uid, now, finish, afterCommit);

            // ── Attendance ──────────────────────────────────────────────
            const card = await manager.getRepository(RfidCard).findOne({ where: { uid, status: 'active' }, relations: ['user'] });
            if (!card) {
                const revoked = await manager.getRepository(RfidCard).count({ where: { uid } });
                return finish(
                    revoked
                        ? { ok: false, result: 'card_removed', title: 'Card Not Valid', line1: 'This card was removed', line2: 'See an administrator' }
                        : { ok: false, result: 'unknown_card', title: 'Unknown Card', line1: 'Card is not registered', line2: 'See an administrator' },
                    'scan', null,
                );
            }
            const user = card.user;
            if (user && RfidService.isPendingSignup(user)) {
                // The card is theirs and was issued deliberately; the account
                // is simply not finished. Telling them to see an administrator
                // would send them to the one person who cannot help.
                return finish({
                    ok: false, result: 'pending_signup', title: 'Account Not Ready',
                    line1: 'Finish setting up your account', line2: 'See your invitation email',
                }, 'scan', user.id);
            }
            if (!user || !user.isActive) {
                return finish({
                    ok: false, result: 'inactive_employee', title: 'Access Denied', line1: 'Account is disabled', line2: 'See an administrator',
                }, 'scan', user?.id ?? null);
            }

            // Serialise per employee before reading their latest event.
            await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]);

            const last = await manager.getRepository(AttendanceRecord).findOne({
                where: { userId: user.id }, order: { timestamp: 'DESC' },
            });
            if (last && now.getTime() - new Date(last.timestamp).getTime() < DUPLICATE_WINDOW_S * 1000) {
                const verb = last.action === 'clock_in' ? 'Clocked in' : 'Clocked out';
                return finish({
                    ok: false, result: 'duplicate', title: 'Already Recorded',
                    line1: user.fullName, line2: `${verb} at ${formatLocalTime(new Date(last.timestamp))}`,
                    employeeName: user.fullName, employeeId: user.employeeId,
                    timestamp: new Date(last.timestamp).toISOString(),
                }, 'scan', user.id, `repeat tap within ${DUPLICATE_WINDOW_S}s`);
            }

            /*
             * The direction comes from the reader when the reader offered a
             * choice, and from here when it did not.
             *
             * `recordClock` already refuses an impossible direction — clocking
             * in twice, or out without being in. Those throw, and a throw
             * would reach the reader as a bare 400 with no words to show. The
             * employee is standing at the device holding a card, so the
             * refusal is turned into the same three-line answer as every other
             * outcome, naming them and saying what to do instead.
             */
            const requested = dto.intent ?? 'toggle';
            let clock: Awaited<ReturnType<AttendanceService['recordClock']>>;
            try {
                clock = await this.attendance.recordClock(manager, {
                    userId: user.id, action: requested, source: 'rfid', mode: 'onsite', at: now,
                    uid, deviceId: device.id, cardId: card.id, eventId: dto.eventId,
                });
            } catch (e: unknown) {
                if (!(e instanceof BadRequestException)) throw e;

                const open = await manager.getRepository(AttendanceSession).findOne({
                    where: { userId: user.id, status: 'open' },
                });
                const since = open ? formatLocalTime(new Date(open.clockInAt)) : null;

                return finish({
                    ok: false,
                    result: 'wrong_direction',
                    title: requested === 'clock_in' ? 'Already Clocked In' : 'Not Clocked In',
                    line1: user.fullName,
                    line2: requested === 'clock_in'
                        ? (since ? `In since ${since} — clock out` : 'Clock out first')
                        : 'Clock in first',
                    employeeName: user.fullName,
                    employeeId: user.employeeId,
                }, 'scan', user.id, `refused ${requested}: ${(e as BadRequestException).message}`);
            }

            afterCommit.push(() => this.attendance.notifyChanged(user.id));
            const time = formatLocalTime(now);
            return finish(
                clock.action === 'clock_in'
                    ? {
                        ok: true, result: 'clock_in', title: 'Welcome', line1: user.fullName, line2: `Clocked in ${time}`,
                        employeeName: user.fullName, employeeId: user.employeeId, timestamp: now.toISOString(),
                    }
                    : {
                        ok: true, result: 'clock_out', title: 'Goodbye', line1: user.fullName,
                        line2: `Out ${time}  ${fmtDuration(clock.workedMs ?? 0)}`,
                        employeeName: user.fullName, employeeId: user.employeeId, timestamp: now.toISOString(),
                    },
                'scan', user.id,
            );
        });
        for (const fn of afterCommit) { try { fn(); } catch { /* best effort */ } }
        return response;
    }

    private async completeRegistration(
        manager: EntityManager, device: RfidDevice, reg: RfidRegistrationSession, uid: string, now: Date,
        finish: (res: Omit<DeviceScanResponse, 'serverTime'>, kind: string, userId: string | null, detail?: string) => Promise<DeviceScanResponse>,
        afterCommit: Array<() => void>,
    ): Promise<DeviceScanResponse> {
        const stage = (s: string, message?: string) =>
            this.realtime.emitRfidRegistration(reg.initiatedBy, { sessionId: reg.id, userId: reg.userId, stage: s, message });
        stage('card_detected');
        stage('validating');

        const cards = manager.getRepository(RfidCard);
        const regs = manager.getRepository(RfidRegistrationSession);
        reg.cardUid = uid;

        const fail = async (adminMessage: string, readerLine: string) => {
            reg.status = 'failed';
            reg.failureReason = adminMessage;
            reg.completedAt = now;
            await regs.save(reg);
            afterCommit.push(() => stage('failed', adminMessage));
            afterCommit.push(() => void this.audit.log({
                actorId: reg.initiatedBy as string, entityType: 'rfid_registration', entityId: reg.id,
                action: 'registration_failed', newValue: { employeeId: reg.userId, reason: adminMessage, device: device.deviceId },
            }).catch(() => undefined));
            return finish({
                ok: false, result: 'registration_failed', title: 'Registration Failed', line1: readerLine, line2: 'See the portal',
            }, 'registration', reg.userId, adminMessage);
        };

        const user = await manager.getRepository(User).findOne({ where: { id: reg.userId } });
        if (!user) return fail('The employee account is disabled.', 'Account is disabled');
        if (!user.isActive && !RfidService.isPendingSignup(user)) {
            return fail('The employee account is disabled.', 'Account is disabled');
        }
        if (!user.employeeId) return fail('The employee has no Employee ID.', 'No Employee ID');

        await manager.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [user.id]);

        const holder = await cards.findOne({ where: { uid, status: 'active' }, relations: ['user'] });
        if (holder && holder.userId === user.id) {
            return fail('This card is already registered to this employee.', 'Card already yours');
        }
        if (holder) {
            return fail(
                `This card is already assigned to ${holder.user?.fullName ?? 'another employee'}`
                + `${holder.user?.employeeId ? ` (${holder.user.employeeId})` : ''}. Remove it from that employee first.`,
                'Card already in use',
            );
        }

        const current = await cards.findOne({ where: { userId: user.id, status: 'active' } });
        if (current && reg.mode !== 'replace') {
            return fail('The employee already has a card. Use "Replace card" instead.', 'Has a card already');
        }

        stage('registering');
        if (current) {
            current.status = 'replaced';
            current.revokedBy = reg.initiatedBy;
            current.revokedAt = now;
            current.revokeReason = 'Replaced with a new card';
            await cards.save(current);
        }
        const card = await cards.save(cards.create({
            userId: user.id, uid, status: 'active', assignedBy: reg.initiatedBy,
            assignedAt: now, registeredDeviceId: device.id,
        }));
        reg.status = 'success';
        reg.cardId = card.id;
        reg.completedAt = now;
        await regs.save(reg);

        afterCommit.push(() => stage('success'));
        afterCommit.push(() => void this.audit.log({
            actorId: reg.initiatedBy as string, entityType: 'rfid_card', entityId: card.id,
            action: current ? 'card_replaced' : 'card_registered',
            oldValue: current ? { cardId: current.id, uid: current.uid } : null,
            newValue: { employeeId: user.id, employeeCode: user.employeeId, uid, device: device.deviceId },
        }).catch(() => undefined));

        return finish({
            ok: true, result: 'registered', title: 'Card Registered', line1: user.fullName, line2: `ID ${user.employeeId}`,
            employeeName: user.fullName, employeeId: user.employeeId, timestamp: now.toISOString(),
        }, 'registration', user.id);
    }

    // ════════════════════════════════════════════════════════════════
    //  Administrator: readers
    // ════════════════════════════════════════════════════════════════

    private deviceView(d: RfidDevice) {
        return {
            id: d.id, deviceId: d.deviceId, name: d.name, location: d.location, isActive: d.isActive,
            firmwareVersion: d.firmwareVersion, ipAddress: d.ipAddress,
            lastSeenAt: d.lastSeenAt, lastScanAt: d.lastScanAt, createdAt: d.createdAt,
            online: this.isOnline(d),
        };
    }

    async listDevices() {
        const devices = await this.deviceRepo.find({ order: { createdAt: 'ASC' } });
        return devices.map((d) => this.deviceView(d));
    }

    /** Creates a reader. The API key is returned once and cannot be read back. */
    async createDevice(adminId: string, dto: { deviceId: string; name: string; location?: string }) {
        const deviceId = dto.deviceId.trim();
        if (await this.deviceRepo.findOne({ where: { deviceId } })) {
            throw new ConflictException(`A reader with the ID "${deviceId}" already exists.`);
        }
        const apiKey = crypto.randomBytes(32).toString('hex');
        const device = await this.deviceRepo.save(this.deviceRepo.create({
            deviceId, name: dto.name.trim(), location: dto.location?.trim() || null,
            apiKeyHash: sha256(apiKey), createdBy: adminId,
        }));
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_device', entityId: device.id, action: 'device_created',
            newValue: { deviceId, name: device.name, location: device.location },
        });
        return { device: this.deviceView(device), apiKey };
    }

    async updateDevice(adminId: string, id: string, dto: { name?: string; location?: string; isActive?: boolean }) {
        const device = await this.deviceRepo.findOne({ where: { id } });
        if (!device) throw new NotFoundException('Reader not found');
        const before = { name: device.name, location: device.location, isActive: device.isActive };
        if (dto.name !== undefined) device.name = dto.name.trim();
        if (dto.location !== undefined) device.location = dto.location.trim() || null;
        if (dto.isActive !== undefined) device.isActive = dto.isActive;
        await this.deviceRepo.save(device);
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_device', entityId: device.id, action: 'device_updated',
            oldValue: before, newValue: { name: device.name, location: device.location, isActive: device.isActive },
        });
        this.realtime.emitRfidRegistration(null, { sessionId: '', userId: '', stage: 'reader_updated' });
        return this.deviceView(device);
    }

    /** Issues a new key; the old one stops working immediately. */
    async rotateDeviceKey(adminId: string, id: string) {
        const device = await this.deviceRepo.findOne({ where: { id } });
        if (!device) throw new NotFoundException('Reader not found');
        const apiKey = crypto.randomBytes(32).toString('hex');
        device.apiKeyHash = sha256(apiKey);
        await this.deviceRepo.save(device);
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_device', entityId: device.id, action: 'device_key_rotated',
            newValue: { deviceId: device.deviceId },
        });
        return { device: this.deviceView(device), apiKey };
    }

    async deleteDevice(adminId: string, id: string) {
        const device = await this.deviceRepo.findOne({ where: { id } });
        if (!device) throw new NotFoundException('Reader not found');
        // Attendance records and the event log keep their rows (device_id → NULL,
        // device_code text is retained in the log).
        await this.deviceRepo.remove(device);
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_device', entityId: id, action: 'device_deleted',
            oldValue: { deviceId: device.deviceId, name: device.name },
        });
        return { success: true };
    }

    // ════════════════════════════════════════════════════════════════
    //  Administrator: cards and registration
    // ════════════════════════════════════════════════════════════════

    private computeStatus(user: Pick<User, 'isActive'>, card: RfidCard | null, lastReg: RfidRegistrationSession | null): SyncStatus {
        if (!user.isActive) return 'disabled';
        if (card) return 'synced';
        if (lastReg && (lastReg.status === 'failed' || lastReg.status === 'expired')) return 'failed';
        return 'pending';
    }

    /** RFID status of every employee — drives the indicator in employee management. */
    async employeeStatuses() {
        const [users, cards, regs, devices] = await Promise.all([
            this.userRepo.find({ order: { fullName: 'ASC' } }),
            this.cardRepo.find({ where: { status: 'active' } }),
            this.dataSource.query(
                `SELECT DISTINCT ON (user_id) user_id AS "userId", status, failure_reason AS "failureReason",
                        created_at AS "createdAt", expires_at AS "expiresAt"
                 FROM rfid_registration_sessions ORDER BY user_id, created_at DESC`,
            ),
            this.deviceRepo.find(),
        ]);
        const cardBy = new Map(cards.map((c) => [c.userId, c]));
        const regBy = new Map<string, any>(regs.map((r: any) => [r.userId, r]));
        return {
            readers: { total: devices.length, online: devices.filter((d) => this.isOnline(d)).length },
            employees: users.map((u) => {
                const card = cardBy.get(u.id) ?? null;
                const reg = regBy.get(u.id) ?? null;
                const waiting = reg?.status === 'waiting' && new Date(reg.expiresAt).getTime() > Date.now();
                return {
                    userId: u.id, fullName: u.fullName, employeeId: u.employeeId, isActive: u.isActive,
                    status: this.computeStatus(u, card, reg),
                    registering: waiting,
                    hasEmployeeId: !!u.employeeId,
                    card: card ? { id: card.id, uid: card.uid, assignedAt: card.assignedAt } : null,
                    lastRegistration: reg ? { status: reg.status, failureReason: reg.failureReason, createdAt: reg.createdAt } : null,
                };
            }),
        };
    }

    private regView(reg: RfidRegistrationSession, device?: RfidDevice | null) {
        const secondsLeft = reg.status === 'waiting'
            ? Math.max(0, Math.ceil((new Date(reg.expiresAt).getTime() - Date.now()) / 1000)) : 0;
        return {
            id: reg.id, userId: reg.userId, deviceId: reg.deviceId, mode: reg.mode, status: reg.status,
            cardUid: reg.cardUid, failureReason: reg.failureReason,
            expiresAt: reg.expiresAt, createdAt: reg.createdAt, completedAt: reg.completedAt,
            secondsLeft,
            device: device ? { id: device.id, deviceId: device.deviceId, name: device.name, online: this.isOnline(device) } : undefined,
        };
    }

    /** Everything the RFID section of an employee's profile shows. */
    async getUserRfid(userId: string) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const [cards, regs, events, devices] = await Promise.all([
            this.cardRepo.find({ where: { userId }, order: { assignedAt: 'DESC' }, take: 20 }),
            this.regRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 5, relations: ['device'] }),
            this.logRepo.find({ where: { userId }, order: { createdAt: 'DESC' }, take: 10 }),
            this.listDevices(),
        ]);
        // Lazily expire a timed-out session so the status shown is truthful.
        for (const r of regs) {
            if (r.status === 'waiting' && new Date(r.expiresAt).getTime() <= Date.now()) await this.waitingSession(r.deviceId);
        }
        const fresh = regs.length ? await this.regRepo.find({ where: { id: In(regs.map((r) => r.id)) }, order: { createdAt: 'DESC' }, relations: ['device'] }) : [];
        const active = cards.find((c) => c.status === 'active') ?? null;
        const names = await this.namesOf([...cards.map((c) => c.assignedBy), ...cards.map((c) => c.revokedBy)]);
        return {
            userId, fullName: user.fullName, employeeId: user.employeeId, isActive: user.isActive,
            // Distinct from isActive=false: nobody switched this account
            // off, it is waiting on the employee. The portal needs the
            // difference to know whether to block or to offer a choice.
            pendingSignup: RfidService.isPendingSignup(user),
            status: this.computeStatus(user, active, fresh[0] ?? null),
            card: active ? { id: active.id, uid: active.uid, assignedAt: active.assignedAt, assignedByName: names.get(active.assignedBy ?? '') ?? null } : null,
            activeRegistration: fresh.find((r) => r.status === 'waiting') ? this.regView(fresh.find((r) => r.status === 'waiting')!, fresh.find((r) => r.status === 'waiting')!.device) : null,
            lastRegistration: fresh[0] ? this.regView(fresh[0], fresh[0].device) : null,
            history: cards.map((c) => ({
                id: c.id, uid: c.uid, status: c.status, assignedAt: c.assignedAt,
                assignedByName: names.get(c.assignedBy ?? '') ?? null,
                revokedAt: c.revokedAt, revokedByName: names.get(c.revokedBy ?? '') ?? null, revokeReason: c.revokeReason,
            })),
            recentEvents: events.map((e) => ({ id: e.id, kind: e.kind, result: e.result, detail: e.detail, createdAt: e.createdAt })),
            devices,
        };
    }

    private async namesOf(ids: Array<string | null>): Promise<Map<string, string>> {
        const unique = [...new Set(ids.filter((x): x is string => !!x))];
        if (!unique.length) return new Map();
        const users = await this.userRepo.find({ where: { id: In(unique) }, select: ['id', 'fullName'] });
        return new Map(users.map((u) => [u.id, u.fullName]));
    }

    /**
     * Puts a reader into registration mode for ONE employee.
     * This is the only way a card can ever become assigned: a card that is
     * merely seen by a reader is never registered on its own.
     */
    /**
     * Invited, but has never finished signing up.
     *
     * This is not a disabled account and must not be treated as one. A
     * disabled account was switched off by an administrator and can be
     * switched back on by one. This account is waiting on the employee to
     * follow their invitation and set a password, which nobody else can do
     * for them -- so "re-enable it first" is advice that cannot be taken.
     */
    static isPendingSignup(u: Pick<User, 'isActive' | 'invitedAt' | 'registeredAt'>): boolean {
        return !u.isActive && !u.registeredAt && !!u.invitedAt;
    }

    async startRegistration(adminId: string, userId: string, dto: { deviceId?: string; mode?: 'register' | 'replace'; allowPending?: boolean }) {
        const user = await this.userRepo.findOne({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const pendingSignup = RfidService.isPendingSignup(user);
        if (!user.isActive && !pendingSignup) {
            throw new BadRequestException('This account is disabled. Re-enable it before registering a card.');
        }
        if (pendingSignup && !dto.allowPending) {
            // Refused by default, because issuing a card to someone who has not
            // accepted their invitation should be a decision somebody makes,
            // not a side effect. `code` lets the portal offer that decision
            // instead of printing the sentence and stopping.
            throw new BadRequestException({
                code: 'pending_signup',
                message: `${user.fullName} has not finished setting up their account yet. `
                    + 'The card can be issued now and will work as soon as they do.',
            });
        }
        if (!user.employeeId) throw new BadRequestException('Assign an Employee ID to this employee before registering a card.');

        const devices = await this.deviceRepo.find({ where: { isActive: true } });
        if (!devices.length) throw new BadRequestException('No RFID reader has been set up yet. Add one under Attendance → Readers.');
        let device: RfidDevice | undefined;
        if (dto.deviceId) {
            device = devices.find((d) => d.id === dto.deviceId);
            if (!device) throw new NotFoundException('Reader not found or disabled');
        } else {
            const online = devices.filter((d) => this.isOnline(d));
            if (online.length > 1) throw new BadRequestException('Several readers are online — choose which one to use.');
            device = online[0] ?? (devices.length === 1 ? devices[0] : undefined);
            if (!device) throw new BadRequestException('Choose which reader to use.');
        }
        if (!this.isOnline(device)) {
            throw new ConflictException(`Reader "${device.name}" is offline. Check its power and network connection.`);
        }

        const current = await this.cardRepo.findOne({ where: { userId, status: 'active' } });
        const mode: 'register' | 'replace' = current ? 'replace' : 'register';
        if (current && dto.mode !== 'replace') {
            throw new ConflictException('This employee already has a card. Use "Replace card".');
        }

        const busy = await this.waitingSession(device.id);
        if (busy) {
            if (busy.userId === userId) return this.regView(busy, device);
            throw new ConflictException(`Reader "${device.name}" is busy registering a card for ${busy.user?.fullName ?? 'another employee'}.`);
        }

        let reg: RfidRegistrationSession;
        try {
            reg = await this.regRepo.save(this.regRepo.create({
                userId, deviceId: device.id, initiatedBy: adminId, mode, status: 'waiting',
                expiresAt: new Date(Date.now() + REGISTRATION_TIMEOUT_S * 1000),
            }));
        } catch (e: any) {
            if (e?.code === '23505') throw new ConflictException(`Reader "${device.name}" is already in registration mode.`);
            throw e;
        }
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_registration', entityId: reg.id, action: 'registration_started',
            newValue: {
                employeeId: userId, employeeCode: user.employeeId, mode, device: device.deviceId,
                ...(pendingSignup ? { issuedBeforeSignup: true } : {}),
            },
        });
        this.realtime.emitRfidRegistration(adminId, { sessionId: reg.id, userId, stage: 'waiting' });
        return this.regView(reg, device);
    }

    async getRegistration(id: string) {
        let reg = await this.regRepo.findOne({ where: { id }, relations: ['device'] });
        if (!reg) throw new NotFoundException('Registration session not found');
        if (reg.status === 'waiting' && new Date(reg.expiresAt).getTime() <= Date.now()) {
            await this.waitingSession(reg.deviceId);
            reg = (await this.regRepo.findOne({ where: { id }, relations: ['device'] }))!;
        }
        return this.regView(reg, reg.device);
    }

    async cancelRegistration(adminId: string, id: string) {
        const reg = await this.regRepo.findOne({ where: { id }, relations: ['device'] });
        if (!reg) throw new NotFoundException('Registration session not found');
        if (reg.status === 'waiting') {
            reg.status = 'cancelled';
            reg.failureReason = 'Cancelled by the administrator.';
            reg.completedAt = new Date();
            await this.regRepo.save(reg);
            await this.audit.log({
                actorId: adminId, entityType: 'rfid_registration', entityId: reg.id, action: 'registration_cancelled',
                newValue: { employeeId: reg.userId },
            });
            this.realtime.emitRfidRegistration(reg.initiatedBy, { sessionId: reg.id, userId: reg.userId, stage: 'cancelled' });
        }
        return this.regView(reg, reg.device);
    }

    /** Revokes the employee's card. It stops producing attendance immediately. */
    async removeCard(adminId: string, userId: string, reason: string) {
        const card = await this.cardRepo.findOne({ where: { userId, status: 'active' } });
        if (!card) throw new NotFoundException('This employee has no active card.');
        card.status = 'removed';
        card.revokedBy = adminId;
        card.revokedAt = new Date();
        card.revokeReason = reason.trim();
        await this.cardRepo.save(card);
        await this.audit.log({
            actorId: adminId, entityType: 'rfid_card', entityId: card.id, action: 'card_removed',
            oldValue: { uid: card.uid }, newValue: { employeeId: userId, reason: card.revokeReason },
        });
        this.realtime.emitRfidRegistration(null, { sessionId: '', userId, stage: 'card_removed' });
        return { success: true };
    }

    async listEvents(q: { limit?: number; deviceId?: string; userId?: string }) {
        const qb = this.logRepo.createQueryBuilder('e')
            .leftJoin(User, 'u', 'u.id = e.user_id')
            .addSelect(['u.full_name AS employee_name', 'u.employee_id AS employee_code'])
            .orderBy('e.createdAt', 'DESC')
            .take(Math.min(Math.max(Number(q.limit) || 100, 1), 500));
        if (q.deviceId) qb.andWhere('e.device_id = :d', { d: q.deviceId });
        if (q.userId) qb.andWhere('e.user_id = :u', { u: q.userId });
        const { entities, raw } = await qb.getRawAndEntities();
        return entities.map((e, i) => ({
            id: e.id, kind: e.kind, result: e.result, detail: e.detail, uid: e.uid,
            deviceCode: e.deviceCode, ipAddress: e.ipAddress, createdAt: e.createdAt,
            employeeName: raw[i]?.employee_name ?? null, employeeId: raw[i]?.employee_code ?? null,
        }));
    }
}
