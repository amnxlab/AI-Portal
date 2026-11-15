import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
    constructor(private readonly inventoryService: InventoryService) { }

    @Get('categories')
    getCategories() {
        return this.inventoryService.getCategories();
    }

    @Post('categories')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    addCategory(@Body() body: { code: string; name: string }) {
        return this.inventoryService.addCategory(body.code, body.name);
    }

    @Get()
    findAll(@Query() q: { search?: string; category?: string; status?: string }) {
        return this.inventoryService.findAll(q);
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.inventoryService.findById(id);
    }

    @Get(':id/logs')
    getLogs(@Param('id') id: string) {
        return this.inventoryService.getLogs(id);
    }

    @Post('bulk')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    bulkCreate(@Body() body: { items: any[] }, @Request() req) {
        return this.inventoryService.bulkCreate(body.items, req.user.id);
    }

    @Post()
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    create(@Body() body: any, @Request() req) {
        return this.inventoryService.create(body, req.user.id);
    }

    @Patch(':id')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    update(@Param('id') id: string, @Body() body: any, @Request() req) {
        return this.inventoryService.update(id, body, req.user.id);
    }

    @Delete(':id')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    remove(@Param('id') id: string, @Request() req) {
        return this.inventoryService.remove(id, req.user.id);
    }

    @Post(':id/checkout')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    checkout(@Param('id') id: string, @Body() body: { notes?: string; quantity?: number }, @Request() req) {
        return this.inventoryService.checkout(id, req.user.id, body.notes, body.quantity);
    }

    @Post(':id/checkin')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    checkin(@Param('id') id: string, @Body() body: { notes?: string; quantity?: number }, @Request() req) {
        return this.inventoryService.checkin(id, req.user.id, body.notes, body.quantity);
    }

    @Post(':id/assign')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    assign(@Param('id') id: string, @Body() body: { assigneeId: string; notes?: string }, @Request() req) {
        return this.inventoryService.assignDevice(id, body.assigneeId, req.user.id, body.notes);
    }

    @Post(':id/unassign')
    @UseGuards(RolesGuard)
    @Permissions('manage_inventory')
    unassign(@Param('id') id: string, @Body() body: { notes?: string }, @Request() req) {
        return this.inventoryService.unassignDevice(id, req.user.id, body?.notes);
    }
}
