import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { WishlistsService } from './wishlists.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectsService } from '../projects/projects.service';
import { CreateWishlistItemDto } from './dto/create-wishlist-item.dto';
import { UpdateWishlistItemDto } from './dto/update-wishlist-item.dto';
import { PurchaseWishlistItemDto } from './dto/purchase-wishlist-item.dto';

/** Statuses that require manage_projects permission to set */
const MANAGER_STATUSES = ['Approved', 'Rejected', 'Purchased'];

@Controller('wishlists')
@UseGuards(JwtAuthGuard)
export class WishlistsController {
    constructor(
        private readonly wishlistsService: WishlistsService,
        private readonly projectsService: ProjectsService,
    ) { }

    @Get() findAll(@Query('project') project?: string) { return this.wishlistsService.findAll(project); }
    @Get('budget/:projectId') getBudget(@Param('projectId') id: string) { return this.wishlistsService.getBudgetSummary(id); }
    @Get(':id') findOne(@Param('id') id: string) { return this.wishlistsService.findById(id); }

    @Post()
    async create(@Body() dto: CreateWishlistItemDto, @Request() req) {
        // Anyone signed in may request something for any project. A request
        // is a submission, not a change: it is created pending and an
        // administrator approves it.
        return this.wishlistsService.create(dto, req.user.id);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateWishlistItemDto, @Request() req) {
        const item = await this.wishlistsService.findById(id);
        const perms = req.user.permissions;

        // Only managers can approve / reject / mark purchased
        if (dto.status && MANAGER_STATUSES.includes(dto.status) && !perms.manage_projects) {
            throw new ForbiddenException('Only project managers can approve, reject, or mark items as purchased');
        }

        // Non-managers can only edit their own items
        if (!perms.manage_projects && item.requestedBy !== req.user.id) {
            throw new ForbiddenException('You can only update your own wishlist items');
        }

        return this.wishlistsService.update(id, dto, req.user.id);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Request() req) {
        const item = await this.wishlistsService.findById(id);
        const perms = req.user.permissions;

        if (!perms.manage_projects && item.requestedBy !== req.user.id) {
            throw new ForbiddenException('You can only delete your own wishlist items');
        }
        return this.wishlistsService.remove(id, req.user.id);
    }

    @Post(':id/purchase')
    async purchase(@Param('id') id: string, @Body() dto: PurchaseWishlistItemDto, @Request() req) {
        const perms = req.user.permissions;
        if (!perms.manage_projects || !perms.manage_budget) {
            throw new ForbiddenException('Purchasing a wishlist item requires both project and budget management permissions');
        }
        return this.wishlistsService.purchase(id, dto, req.user.id);
    }
}
