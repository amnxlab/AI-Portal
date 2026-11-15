import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from './comment.entity';
import { User } from '../users/user.entity';
import { PlaylistMedia } from '../video-tutorials/entities/playlist-media.entity';
import { CommentsService } from './comments.service';
import { CommentsController } from './comments.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Comment, User, PlaylistMedia]),
        NotificationsModule,
        RealtimeModule,
        // AuditModule is @Global() — no need to import it here
    ],
    providers: [CommentsService],
    controllers: [CommentsController],
    exports: [CommentsService],
})
export class CommentsModule {}
