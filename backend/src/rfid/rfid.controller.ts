import {
    Controller, Get, Post, Patch, Delete, Param, Query, Body, Request, UseGuards, ParseUUIDPipe, HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { DeviceAuthGuard } from './device-auth.guard';
import { RfidService } from './rfid.service';
import {
    DeviceScanDto, CreateDeviceDto, UpdateDeviceDto, StartRegistrationDto, RemoveCardDto,
} from './dto/rfid.dto';

/**
 * Reader-facing API.
 *
 * Authenticated by device ID + API key (DeviceAuthGuard), never by a user
 * token. These are the only two endpoints a reader needs: it polls for its
 * mode and posts the cards it sees. All decisions are made server-side.
 */
@Controller('rfid/device')
@UseGuards(DeviceAuthGuard)
export class RfidDeviceController {
    constructor(private readonly rfid: RfidService) {}

    @Get('poll')
    poll(@Request() req: any) {
        return this.rfid.poll(req.device);
    }

    @Post('scan')
    @HttpCode(200)
    scan(@Request() req: any, @Body() dto: DeviceScanDto) {
        return this.rfid.handleScan(req.device, dto, req.ip);
    }
}

/** Administrator-facing RFID management. */
@Controller('rfid')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RfidAdminController {
    constructor(private readonly rfid: RfidService) {}

    // ─── Readers ──────────────────────────────────────────────────

    @Get('devices')
    @Permissions('manage_attendance')
    listDevices() {
        return this.rfid.listDevices();
    }

    /** The API key is in the response of this call only — it is never readable again. */
    @Post('devices')
    @Permissions('manage_attendance')
    createDevice(@Request() req: any, @Body() dto: CreateDeviceDto) {
        return this.rfid.createDevice(req.user.id, dto);
    }

    @Patch('devices/:id')
    @Permissions('manage_attendance')
    updateDevice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto) {
        return this.rfid.updateDevice(req.user.id, id, dto);
    }

    @Post('devices/:id/rotate-key')
    @Permissions('manage_attendance')
    rotateKey(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
        return this.rfid.rotateDeviceKey(req.user.id, id);
    }

    @Delete('devices/:id')
    @Permissions('manage_attendance')
    deleteDevice(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
        return this.rfid.deleteDevice(req.user.id, id);
    }

    // ─── Status and logs ──────────────────────────────────────────

    /** Per-employee RFID status for the employee-management list. */
    @Get('status')
    @Permissions('manage_users', 'manage_attendance')
    statuses() {
        return this.rfid.employeeStatuses();
    }

    @Get('events')
    @Permissions('manage_attendance')
    events(@Query('limit') limit?: string, @Query('deviceId') deviceId?: string, @Query('userId') userId?: string) {
        return this.rfid.listEvents({ limit: Number(limit) || undefined, deviceId, userId });
    }

    // ─── Registration sessions ────────────────────────────────────

    @Get('registrations/:id')
    @Permissions('manage_users')
    getRegistration(@Param('id', ParseUUIDPipe) id: string) {
        return this.rfid.getRegistration(id);
    }

    @Delete('registrations/:id')
    @Permissions('manage_users')
    cancelRegistration(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
        return this.rfid.cancelRegistration(req.user.id, id);
    }
}

/**
 * The employee's RFID card, under their profile — this is where an
 * administrator registers, replaces and removes cards. It needs
 * manage_users, the same permission that governs employee accounts.
 */
@Controller('users/:userId/rfid')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UserRfidController {
    constructor(private readonly rfid: RfidService) {}

    @Get()
    @Permissions('manage_users')
    get(@Param('userId', ParseUUIDPipe) userId: string) {
        return this.rfid.getUserRfid(userId);
    }

    /** Puts a reader into registration mode for this employee. */
    @Post('registration')
    @Permissions('manage_users')
    start(@Request() req: any, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: StartRegistrationDto) {
        return this.rfid.startRegistration(req.user.id, userId, dto);
    }

    @Delete('card')
    @Permissions('manage_users')
    removeCard(@Request() req: any, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: RemoveCardDto) {
        return this.rfid.removeCard(req.user.id, userId, dto.reason);
    }
}
