import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { RfidService } from './rfid.service';

/**
 * Authenticates an RFID reader.
 *
 * Readers do not have user accounts or JWTs. Each one is created by an
 * administrator and holds its own API key, sent with its identifier on every
 * request:
 *
 *     X-Device-Id:  RFID-SM2-001
 *     X-Api-Key:    <64 hex chars>
 *
 * Only the SHA-256 of the key is stored. A reader that is unknown, disabled
 * or presents the wrong key gets no information beyond the status code.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
    constructor(private readonly rfid: RfidService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        const deviceId = String(req.headers['x-device-id'] ?? '').trim();
        const apiKey = String(req.headers['x-api-key'] ?? '').trim();
        const ip = req.ip as string | undefined;

        const outcome = await this.rfid.authenticateDevice(deviceId, apiKey);
        if (outcome.device) {
            req.device = outcome.device;
            await this.rfid.touchDevice(outcome.device, ip, String(req.headers['x-firmware-version'] ?? '').slice(0, 32) || null);
            return true;
        }
        await this.rfid.logAuthFailure(deviceId, outcome.reason, ip);
        if (outcome.reason === 'disabled') throw new ForbiddenException('Reader is disabled');
        throw new UnauthorizedException('Invalid reader credentials');
    }
}
