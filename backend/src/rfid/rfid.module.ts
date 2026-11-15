import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RfidDevice, RfidCard, RfidRegistrationSession, RfidEventLog } from './rfid.entity';
import { RfidService } from './rfid.service';
import { RfidDeviceController, RfidAdminController, UserRfidController } from './rfid.controller';
import { DeviceAuthGuard } from './device-auth.guard';
import { User } from '../users/user.entity';
import { AttendanceModule } from '../attendance/attendance.module';
import { RolesModule } from '../roles/roles.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([RfidDevice, RfidCard, RfidRegistrationSession, RfidEventLog, User]),
        AttendanceModule,
        RolesModule,
        RealtimeModule,
    ],
    providers: [RfidService, DeviceAuthGuard],
    controllers: [RfidDeviceController, RfidAdminController, UserRfidController],
    exports: [RfidService],
})
export class RfidModule {}
