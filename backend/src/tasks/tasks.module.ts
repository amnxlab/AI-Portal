import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './task.entity';
import { User } from '../users/user.entity';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { RealtimeModule } from '../realtime/realtime.module';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [TypeOrmModule.forFeature([Task, User]), RealtimeModule, ProjectsModule, NotificationsModule],
    providers: [TasksService],
    controllers: [TasksController],
    exports: [TasksService],
})
export class TasksModule { }
