import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClassSerializerInterceptor } from '@nestjs/common';
import { HttpLoggerMiddleware } from './middleware/http-logger.middleware';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AccountHoldInterceptor } from './auth/interceptors/account-hold.interceptor';
import { MailModule } from './mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SchedulesModule } from './schedules/schedules.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { WishlistsModule } from './wishlists/wishlists.module';
import { ReportsModule } from './reports/reports.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DiscordModule } from './discord/discord.module';
import { AuditModule } from './audit/audit.module';
import { UploadsModule } from './uploads/uploads.module';
import { FilesModule } from './files/files.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RolesModule } from './roles/roles.module';
import { TicketsModule } from './tickets/tickets.module';
import { NotificationsModule } from './notifications/notifications.module';
import { CommentsModule } from './comments/comments.module';
import { PapersModule } from './papers/papers.module';
import { BudgetModule } from './budget/budget.module';
import { VideoTutorialsModule } from './video-tutorials/video-tutorials.module';
import { AttendanceModule } from './attendance/attendance.module';
import { RfidModule } from './rfid/rfid.module';
@Module({
  imports: [
    // ─── Config ────────────────────────────────────────────────
    ConfigModule.forRoot({ isGlobal: true }),

    // ─── Rate Limiting ─────────────────────────────────────────
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),

    // ─── Database ──────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres',
        host: cfg.get('POSTGRES_HOST', 'localhost'),
        port: cfg.get<number>('POSTGRES_PORT', 5432),
        username: cfg.get('POSTGRES_USER', 'aiserver'),
        password: cfg.get('POSTGRES_PASSWORD', 'changeme'),
        database: cfg.get('POSTGRES_DB', 'aiserver_db'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false, // use schema.sql migrations in production
        logging: cfg.get('NODE_ENV') === 'development',
        ssl: cfg.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
      }),
    }),

    // ─── Feature Modules ───────────────────────────────────────
    MailModule,
    RolesModule,
    AuthModule,
    UsersModule,
    SchedulesModule,
    InventoryModule,
    ProjectsModule,
    TasksModule,
    WishlistsModule,
    ReportsModule,
    NotificationsModule,
    CommentsModule,
    DashboardModule,
    DiscordModule,
    AuditModule,
    UploadsModule,
    FilesModule,
    RealtimeModule,
    TicketsModule,
    PapersModule,
    BudgetModule,
    VideoTutorialsModule,
    AttendanceModule,
    RfidModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AccountHoldInterceptor },
  ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer.apply(HttpLoggerMiddleware).forRoutes('*path');
    }
}
