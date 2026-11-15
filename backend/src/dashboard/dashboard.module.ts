import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../tasks/task.entity';
import { InventoryItem } from '../inventory/inventory.entity';
import { WeeklyReport } from '../reports/weekly-report.entity';
import { Project } from '../projects/project.entity';
import { ProjectMember } from '../projects/project-member.entity';
import { ProjectFile } from '../files/project-file.entity';
import { Notification } from '../notifications/notification.entity';
import { Ticket } from '../tickets/ticket.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { User } from '../users/user.entity';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
    imports: [TypeOrmModule.forFeature([Task, InventoryItem, WeeklyReport, Project, ProjectMember, ProjectFile, Notification, Ticket, AuditLog, User])],
    providers: [DashboardService],
    controllers: [DashboardController],
})
export class DashboardModule { }
