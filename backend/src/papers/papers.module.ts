import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Paper } from './paper.entity';
import { PaperFile } from './paper-file.entity';
import { PapersService } from './papers.service';
import { PapersController } from './papers.controller';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Paper, PaperFile]),
        ProjectsModule,
        TasksModule,
        FilesModule,
        NotificationsModule,
        UsersModule,
        // AuditModule is @Global() — no import needed
    ],
    providers: [PapersService],
    controllers: [PapersController],
    exports: [PapersService],
})
export class PapersModule {}
