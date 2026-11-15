import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './role.entity';
import { RolesService } from './roles.service';
import { RolesController } from './roles.controller';

@Global()
@Module({
    imports: [TypeOrmModule.forFeature([Role])],
    providers: [RolesService],
    controllers: [RolesController],
    exports: [RolesService],
})
export class RolesModule {}
