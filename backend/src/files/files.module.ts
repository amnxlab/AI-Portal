import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { ProjectFile } from './project-file.entity';
import { FileFolder } from './file-folder.entity';
import { User } from '../users/user.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { FileFoldersService } from './file-folders.service';
import { FileFoldersController } from './file-folders.controller';
import { RolesModule } from '../roles/roles.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { Paper } from '../papers/paper.entity';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([ProjectFile, FileFolder, User, Paper]),
        MulterModule.register({}),
        RolesModule,
        NotificationsModule,
        ProjectsModule,
        RealtimeModule,
        TasksModule,
        UsersModule,
    ],
    providers: [FilesService, FileFoldersService],
    controllers: [FilesController, FileFoldersController],
    exports: [FilesService, FileFoldersService],
})
export class FilesModule {}
