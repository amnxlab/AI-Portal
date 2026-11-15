import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './schedule.entity';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [TypeOrmModule.forFeature([Schedule]), UsersModule, NotificationsModule],
    providers: [SchedulesService],
    controllers: [SchedulesController],
})
export class SchedulesModule { }
