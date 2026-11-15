import { Module }       from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule }  from '@nestjs/platform-express';
import { Ticket }            from './ticket.entity';
import { TicketsService }    from './tickets.service';
import { TicketsController } from './tickets.controller';
import { RolesModule }       from '../roles/roles.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule }         from '../users/users.module';

@Module({
    imports: [
        TypeOrmModule.forFeature([Ticket]),
        MulterModule.register({}),
        RolesModule,
        NotificationsModule,
        UsersModule,
    ],
    providers:   [TicketsService],
    controllers: [TicketsController],
    exports:     [TicketsService],
})
export class TicketsModule {}
