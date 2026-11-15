import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WishlistItem } from './wishlist-item.entity';
import { AuditService } from '../audit/audit.service';
import { BudgetService } from '../budget/budget.service';
import { InventoryService } from '../inventory/inventory.service';
import { PurchaseWishlistItemDto } from './dto/purchase-wishlist-item.dto';

@Injectable()
export class WishlistsService {
    constructor(
        @InjectRepository(WishlistItem) private readonly repo: Repository<WishlistItem>,
        private readonly auditService: AuditService,
        private readonly budgetService: BudgetService,
        private readonly inventoryService: InventoryService,
    ) { }

    findAll(projectId?: string) {
        const where = projectId ? { projectId } : {};
        return this.repo.find({ where, relations: ['requester', 'approver', 'project'], order: { createdAt: 'DESC' } });
    }

    async findById(id: string) {
        const item = await this.repo.findOne({ where: { id } });
        if (!item) throw new NotFoundException(`Wishlist item ${id} not found`);
        return item;
    }

    async create(data: Partial<WishlistItem>, userId: string) {
        const item = await this.repo.save(this.repo.create({ ...data, requestedBy: userId }));
        await this.auditService.log({
            actorId:    userId,
            entityType: 'WishlistItem',
            entityId:   item.id,
            action:     'CREATE',
            newValue:   { itemName: item.itemName, cost: item.cost, status: item.status },
        });
        return item;
    }

    /** Valid status transitions: fromStatus → allowedNextStatuses */
    private static readonly STATUS_TRANSITIONS: Record<string, string[]> = {
        'Requested': ['Approved', 'Rejected'],
        'Approved':  ['Purchased', 'Rejected'],
        'Rejected':  ['Requested'],          // allows re-submission after rejection
        'Purchased': [],                     // terminal state
    };

    async update(id: string, data: Partial<WishlistItem>, actorId?: string) {
        const item = await this.findById(id);
        const oldValue = { status: item.status, itemName: item.itemName, cost: item.cost };

        if (data.status && data.status !== item.status) {
            const allowed = WishlistsService.STATUS_TRANSITIONS[item.status] ?? [];
            if (!allowed.includes(data.status)) {
                throw new BadRequestException(
                    `Cannot transition wishlist item from '${item.status}' to '${data.status}'. Allowed: [${allowed.join(', ') || 'none'}]`,
                );
            }
            if (data.status === 'Approved' || data.status === 'Rejected') {
                data.approvedBy = actorId;
            }
        }

        Object.assign(item, data);
        const saved = await this.repo.save(item);

        if (actorId) {
            await this.auditService.log({
                actorId,
                entityType: 'WishlistItem',
                entityId:   id,
                action:     'UPDATE',
                oldValue,
                newValue:   { status: saved.status, itemName: saved.itemName, cost: saved.cost },
            });
        }

        return saved;
    }

    async remove(id: string, actorId?: string) {
        const item = await this.findById(id);
        await this.repo.remove(item);
        if (actorId) {
            await this.auditService.log({
                actorId,
                entityType: 'WishlistItem',
                entityId:   id,
                action:     'DELETE',
                oldValue:   { itemName: item.itemName, cost: item.cost, status: item.status },
            });
        }
    }

    async getBudgetSummary(projectId: string) {
        return this.repo
            .createQueryBuilder('w')
            .select('SUM(CASE WHEN w.status = \'Purchased\' THEN w.cost ELSE 0 END)', 'spent')
            .addSelect('SUM(CASE WHEN w.status = \'Requested\' THEN w.cost ELSE 0 END)', 'requested')
            .addSelect('SUM(CASE WHEN w.status = \'Approved\' THEN w.cost ELSE 0 END)', 'approved')
            .addSelect('COUNT(*)', 'total_items')
            .where('w.projectId = :projectId', { projectId })
            .getRawOne();
    }

    /**
     * Purchase an approved wishlist item:
     * 1. Hard-block if the chosen allocation has insufficient balance.
     * 2. Create a budget expense linked to this wishlist item.
     * 3. Auto-create an inventory item sourced from this wishlist item.
     * 4. Mark the wishlist item as Purchased.
     */
    async purchase(id: string, dto: PurchaseWishlistItemDto, actorId: string): Promise<WishlistItem> {
        const item = await this.repo.findOne({ where: { id }, relations: ['project'] });
        if (!item) throw new NotFoundException(`Wishlist item ${id} not found`);

        if (item.status !== 'Approved') {
            throw new BadRequestException('Only Approved items can be purchased');
        }

        // 1. Balance check — find the specific allocation and verify balance >= item cost
        const allocations = await this.budgetService.findAllocations(item.projectId ?? undefined);
        const allocation = allocations.find((a) => a.id === dto.allocationId);
        if (!allocation) {
            throw new NotFoundException('Allocation not found or does not belong to this project');
        }
        if (allocation.balance < Number(item.cost)) {
            throw new ForbiddenException(
                `Insufficient allocation balance ($${allocation.balance.toFixed(2)} available, $${Number(item.cost).toFixed(2)} needed)`,
            );
        }

        // 2. Create budget expense
        await this.budgetService.createExpense(
            {
                allocationId:   dto.allocationId,
                projectId:      item.projectId,
                description:    item.itemName,
                amount:         Number(item.cost),
                category:       dto.category ?? 'other',
                vendor:         dto.vendor,
                receiptUrl:     dto.receiptUrl,
                expenseDate:    dto.expenseDate,
                wishlistItemId: item.id,
            },
            actorId,
        );

        // 3. Auto-create inventory item
        await this.inventoryService.create(
            {
                name:                  dto.inventoryName ?? item.itemName,
                category:              dto.inventoryCategory,
                description:           item.description,
                quantity:              dto.inventoryQuantity ?? 1,
                unit:                  dto.inventoryUnit ?? 'pcs',
                location:              dto.inventoryLocation,
                condition:             dto.inventoryCondition ?? 'New',
                sourceWishlistItemId:  item.id,
                sourceWishlistNote:    item.itemName,
            },
            actorId,
        );

        // 4. Mark as Purchased
        item.status = 'Purchased';
        (item as any).approvedBy = actorId;
        const saved = await this.repo.save(item);
        await this.auditService.log({
            actorId,
            entityType: 'WishlistItem',
            entityId:   id,
            action:     'PURCHASE',
            oldValue:   { status: 'Approved' },
            newValue:   { status: 'Purchased', allocationId: dto.allocationId },
        });
        return saved;
    }
}
