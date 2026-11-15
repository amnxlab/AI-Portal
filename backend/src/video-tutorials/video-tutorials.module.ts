import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { VideoPlaylist } from './entities/video-playlist.entity';
import { PlaylistMedia } from './entities/playlist-media.entity';
import { User } from '../users/user.entity';
import { VideoTutorialsService } from './video-tutorials.service';
import { VideoTutorialsController } from './video-tutorials.controller';
import { RolesModule } from '../roles/roles.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { DiscordModule } from '../discord/discord.module';
import { CommentsModule } from '../comments/comments.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([VideoPlaylist, PlaylistMedia, User]),
        MulterModule.register({}),
        RolesModule,
        NotificationsModule,
        ProjectsModule,
        RealtimeModule,
        DiscordModule,
        CommentsModule,
    ],
    providers: [VideoTutorialsService],
    controllers: [VideoTutorialsController],
    exports: [VideoTutorialsService],
})
export class VideoTutorialsModule {}
