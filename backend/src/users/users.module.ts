import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Project } from '../projects/project.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
    imports: [TypeOrmModule.forFeature([User, Project])],
    providers: [UsersService],
    controllers: [UsersController],
    exports: [UsersService],
})
export class UsersModule { }
