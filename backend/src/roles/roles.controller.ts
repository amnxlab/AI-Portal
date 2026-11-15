import {
    Controller, Get, Post, Patch, Delete, Param, Body, UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('roles')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RolesController {
    constructor(private readonly rolesService: RolesService) {}

    /** Public to any authenticated user — needed for dropdowns across the app */
    @Get()
    findAll() {
        return this.rolesService.findAll();
    }

    /** Returns the list of permission flag keys + labels for dynamic UI rendering */
    @Get('permissions-schema')
    permissionsSchema() {
        return this.rolesService.getPermissionsSchema();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.rolesService.findOne(id);
    }

    @Post()
    @Permissions('manage_users')
    create(@Body() dto: CreateRoleDto) {
        return this.rolesService.create(dto);
    }

    @Patch(':id')
    @Permissions('manage_users')
    update(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
        return this.rolesService.update(id, dto);
    }

    @Delete(':id')
    @Permissions('manage_users')
    remove(@Param('id') id: string) {
        return this.rolesService.remove(id);
    }
}
