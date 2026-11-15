import {
    Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Request, ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSelfDto } from './dto/update-self.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { effectivePermissions } from '../roles/role.entity';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    /**
     * Guards the employment settings — hours cap, hold, remote-work policy,
     * Employee ID, position title, portal clock.
     *
     * These belong to an administrator to set, INCLUDING on their own account:
     * the person running the lab has an Employee ID and an hours cap like
     * everybody else, and previously could not set their own.
     *
     * What must not happen is one administrator changing another's. Otherwise
     * any admin could quietly cap a colleague's hours, put them on hold, or
     * take their Employee ID — and with everyone holding the same permission
     * there would be nothing to stop it.
     */
    private async assertMayChangeEmployment(actor: { id: string }, targetId: string): Promise<void> {
        if (actor.id === targetId) return;          // your own account is yours to set

        const target = await this.usersService.findById(targetId);
        if (effectivePermissions(target.permissions).manage_users) {
            throw new ForbiddenException(
                'This account belongs to another administrator. '
                + 'Administrators can change these settings only on their own account.',
            );
        }
    }

    /** Self — no manage_users permission required */
    @Get('me')
    getMe(@Request() req) {
        return this.usersService.findById(req.user.id);
    }

    /** Directory — id + fullName + role for all active users, accessible to all authenticated users */
    @Get('directory')
    directory() {
        return this.usersService.findDirectory();
    }

    /** Public profile card — accessible to any authenticated user */
    @Get(':id/profile')
    getProfile(@Param('id') id: string) {
        return this.usersService.findProfile(id);
    }

    @Patch('me')
    updateMe(@Request() req, @Body() dto: UpdateSelfDto) {
        return this.usersService.updateSelf(req.user.id, dto);
    }

    @Get()
    @Permissions('manage_users')
    findAll() {
        return this.usersService.findAll();
    }

    /**
     * What permanent deletion would destroy, before anyone commits to it.
     *
     * The confirmation dialog asks for this first so it can say what is
     * actually attached to the account rather than a generic warning.
     */
    @Get(':id/deletion-blockers')
    @Permissions('manage_users')
    async deletionBlockers(@Param('id') id: string) {
        const blockers = await this.usersService.getDeletionBlockers(id);
        return {
            canDelete: blockers.length === 0,
            blockers,
        };
    }

    @Get(':id')
    @Permissions('manage_users')
    findOne(@Param('id') id: string) {
        return this.usersService.findOneView(id);
    }

    @Post()
    @Permissions('manage_users')
    create(@Body() dto: CreateUserDto) {
        return this.usersService.create(dto);
    }

    @Patch(':id')
    @Permissions('manage_users')
    async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Request() req) {
        // This route carries two different kinds of change. Account details —
        // name, email, username, password, module permissions — stay open
        // between administrators, because locking those would mean nobody
        // could ever fix a colleague's account.
        //
        // The employment fields are the restricted ones, so the check only
        // applies when the body actually carries one of them.
        const employmentFields: (keyof UpdateUserDto)[] = [
            'jobTitle', 'employeeId', 'isOnHold', 'hourlyRate', 'weeklyHoursCap',
            'onlineClockEnabled', 'remoteWorkAllowed', 'remoteWorkPercent', 'remoteMaxHours',
            'remoteWorkRestricted',
        ];
        if (employmentFields.some((f) => dto[f] !== undefined)) {
            await this.assertMayChangeEmployment(req.user, id);
        }
        return this.usersService.update(id, dto);
    }

    /** User administrator: set or clear the weekly hours cap for a user */
    @Patch(':id/hours-cap')
    @Permissions('cap_hours')
    async setHoursCap(
        @Param('id') id: string,
        @Body() body: { cap: number | null },
        @Request() req,
    ) {
        // Consistent rule for everyone (previously only non-admins were
        // blocked from self-capping): nobody caps their own hours.
        await this.assertMayChangeEmployment(req.user, id);
        return this.usersService.setHoursCap(id, body.cap ?? null);
    }

    /** User administrator: place a user's account on hold (read-only mode) or release it */
    @Patch(':id/on-hold')
    @Permissions('manage_users')
    async setOnHold(
        @Param('id') id: string,
        @Body() body: { onHold: boolean },
        @Request() req,
    ) {
        await this.assertMayChangeEmployment(req.user, id);
        return this.usersService.setOnHold(id, body.onHold ?? false);
    }

    /**
     * User administrator: set the employee's remote-work policy.
     *
     * This is the canonical route. Authorising remote work is also what
     * allows the employee to clock in from the portal — otherwise the RFID
     * reader is their only clock.
     */
    @Patch(':id/remote-work')
    @Permissions('manage_users')
    async setRemoteWork(
        @Param('id') id: string,
        @Body() body: { allowed?: boolean; percent?: number; maxHours?: number | null },
        @Request() req,
    ) {
        await this.assertMayChangeEmployment(req.user, id);
        return this.usersService.setRemoteWorkPolicy(id, body);
    }

    /**
     * @deprecated Superseded by `PATCH :id/remote-work`. Kept so existing
     * clients keep working; `enabled` is applied as `allowed`.
     */
    @Patch(':id/online-clock')
    @Permissions('manage_users')
    async setOnlineClock(
        @Param('id') id: string,
        @Body() body: { enabled: boolean },
        @Request() req,
    ) {
        await this.assertMayChangeEmployment(req.user, id);
        return this.usersService.setOnlineClockEnabled(id, body.enabled ?? false);
    }

    /**
     * @deprecated Superseded by `PATCH :id/remote-work`. Kept so existing
     * clients keep working; `restricted` is the inverse of `allowed`.
     */
    @Patch(':id/remote-work-restriction')
    @Permissions('manage_users')
    async setRemoteWorkRestriction(
        @Param('id') id: string,
        @Body() body: { restricted: boolean },
        @Request() req,
    ) {
        await this.assertMayChangeEmployment(req.user, id);
        return this.usersService.setRemoteWorkRestricted(id, body.restricted ?? false);
    }

    /**
     * Archives an account: the person leaves the lab, their work stays.
     *
     * Nothing is deleted. The account is deactivated, its RFID card revoked,
     * and — the reason this exists rather than plain deactivation — its
     * Employee ID is released so the number can be issued to somebody new.
     */
    @Post(':id/archive')
    @Permissions('manage_users')
    archive(@Param('id') id: string, @Request() req) {
        if (req.user.id === id) throw new ForbiddenException('Cannot archive your own account');
        return this.usersService.archiveUser(id, req.user.id);
    }

    @Post(':id/restore')
    @Permissions('manage_users')
    restore(@Param('id') id: string) {
        return this.usersService.restoreUser(id);
    }

    /**
     * Removes the account row permanently. No undo.
     *
     * Distinct from DELETE /users/:id, which keeps every record the person
     * produced and only retires the account. This one is refused outright if
     * any such record exists.
     */
    @Delete(':id/permanent')
    @Permissions('manage_users')
    async permanentlyDelete(@Param('id') id: string, @Request() req) {
        await this.assertMayChangeEmployment(req.user, id);
        const gone = await this.usersService.permanentlyDelete(id, req.user.id);
        return {
            ...gone,
            message: `${gone.fullName} has been permanently deleted. The account no longer exists.`,
        };
    }

    @Delete(':id')
    @Permissions('manage_users')
    deactivate(@Param('id') id: string, @Request() req) {
        if (req.user.id === id) throw new ForbiddenException('Cannot deactivate yourself');
        return this.usersService.deactivate(id);
    }

    @Post(':id/reactivate')
    @Permissions('manage_users')
    reactivate(@Param('id') id: string) {
        return this.usersService.reactivate(id);
    }
}
