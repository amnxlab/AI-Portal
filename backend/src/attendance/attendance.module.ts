import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceRecord } from './attendance-record.entity';
import { AttendanceSession, AttendanceCorrection, SystemSetting } from './attendance-session.entity';
import { Shift, ShiftAssignment } from './shift.entity';
import { Schedule } from '../schedules/schedule.entity';
import { AttendanceService } from './attendance.service';
import { ShiftsService } from './shifts.service';
import { AttendanceController } from './attendance.controller';
import { User } from '../users/user.entity';
import { WeeklyReport } from '../reports/weekly-report.entity';
import { RolesModule } from '../roles/roles.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([
            AttendanceRecord, AttendanceSession, AttendanceCorrection, SystemSetting, User, WeeklyReport,
            Shift, ShiftAssignment, Schedule,
        ]),
        RolesModule,
        RealtimeModule,
        NotificationsModule,
    ],
    providers: [AttendanceService, ShiftsService],
    controllers: [AttendanceController],
    exports: [AttendanceService, ShiftsService],
})
export class AttendanceModule {}
