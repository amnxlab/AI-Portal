import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WishlistItem } from './wishlist-item.entity';
import { WishlistsService } from './wishlists.service';
import { WishlistsController } from './wishlists.controller';
import { ProjectsModule } from '../projects/projects.module';
import { BudgetModule } from '../budget/budget.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
    imports: [TypeOrmModule.forFeature([WishlistItem]), ProjectsModule, BudgetModule, InventoryModule],
    providers: [WishlistsService],
    controllers: [WishlistsController],
})
export class WishlistsModule { }
