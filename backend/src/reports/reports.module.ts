import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BudgetModule } from '../budget/budget.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Task } from '../tasks/task.entity';
import { Comment } from '../comments/comment.entity';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
    imports: [TypeOrmModule.forFeature([WeeklyReport, Task, Comment]), UsersModule, NotificationsModule, forwardRef(() => BudgetModule), RealtimeModule, AttendanceModule],
    providers: [ReportsService],
    controllers: [ReportsController],
    exports: [ReportsService],
})
export class ReportsModule { }
