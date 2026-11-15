import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from './project.entity';
import { SubProject } from './sub-project.entity';
import { ProjectMember } from './project-member.entity';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { UsersModule } from '../users/users.module';
import { BudgetModule } from '../budget/budget.module';

@Module({
    imports: [TypeOrmModule.forFeature([Project, SubProject, ProjectMember]), UsersModule, forwardRef(() => BudgetModule)],
    providers: [ProjectsService],
    controllers: [ProjectsController],
    exports: [ProjectsService],
})
export class ProjectsModule { }
