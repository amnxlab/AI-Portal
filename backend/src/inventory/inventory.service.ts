import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { InventoryItem, InventoryLog, InventoryCategory } from './inventory.entity';
import { DiscordService } from '../discord/discord.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class InventoryService {
    constructor(
        @InjectRepository(InventoryItem) private readonly itemRepo: Repository<InventoryItem>,
        @InjectRepository(InventoryLog) private readonly logRepo: Repository<InventoryLog>,
        @InjectRepository(InventoryCategory) private readonly categoryRepo: Repository<InventoryCategory>,
        private readonly discordService: DiscordService,
        private readonly auditService: AuditService,
    ) { }

    async findAll(query: { search?: string; category?: string; status?: string }) {
        const qb = this.itemRepo.createQueryBuilder('item')
            .leftJoinAndSelect('item.assignee', 'assignee');
        if (query.search) qb.andWhere('(item.name ILIKE :s OR item.description ILIKE :s OR item.code ILIKE :s)', { s: `%${query.search}%` });
        if (query.category) qb.andWhere('item.category = :c', { c: query.category });
        if (query.status) qb.andWhere('item.status = :st', { st: query.status });
        return qb.orderBy('item.name', 'ASC').getMany();
    }

    async findById(id: string) {
        const item = await this.itemRepo.findOne({ where: { id }, relations: ['assignee'] });
        if (!item) throw new NotFoundException(`Item ${id} not found`);
        return item;
    }

    // Statuses that are auto-derived from quantity
    private readonly AUTO_STATUSES = new Set(['Available', 'Low Stock', 'Out of Stock']);

    async create(data: Partial<InventoryItem>, actorId: string) {
        const item = this.itemRepo.create({ ...data, createdBy: actorId });
        // Auto-derive status from quantity unless a manual status was explicitly chosen
        if (!item.status || this.AUTO_STATUSES.has(item.status)) {
            item.status = this.calcStatus(item);
        }
        const saved = await this.itemRepo.save(item);
        await this.auditService.log({ actorId, entityType: 'inventory', entityId: saved.id, action: 'add', newValue: saved });
        return saved;
    }

    async bulkCreate(items: Partial<InventoryItem>[], actorId: string) {
        const results: InventoryItem[] = [];
        const errors: { index: number; error: string }[] = [];
        for (let i = 0; i < items.length; i++) {
            try {
                const data = items[i];
                if (!data.name) { errors.push({ index: i, error: 'Name is required' }); continue; }
                const entity = this.itemRepo.create({ ...data, createdBy: actorId });
                // Auto-derive status from quantity unless a manual status was explicitly set
                if (!entity.status || this.AUTO_STATUSES.has(entity.status)) {
                    entity.status = this.calcStatus(entity);
                }
                const saved = await this.itemRepo.save(entity);
                await this.auditService.log({ actorId, entityType: 'inventory', entityId: saved.id, action: 'add', newValue: saved });
                results.push(saved);
            } catch (e: any) {
                errors.push({ index: i, error: e.message ?? 'Unknown error' });
            }
        }
        return { imported: results.length, failed: errors.length, errors };
    }

    async update(id: string, data: Partial<InventoryItem>, actorId: string) {
        const item = await this.findById(id);
        const old = { ...item };
        Object.assign(item, data);
        // Auto-derive status from quantity when no explicit manual status was provided,
        // or if the current status is one of the auto-managed ones
        if (!data.status || this.AUTO_STATUSES.has(item.status)) {
            item.status = this.calcStatus(item);
        }
        item.updatedAt = new Date();
        const saved = await this.itemRepo.save(item);
        await this.auditService.log({ actorId, entityType: 'inventory', entityId: id, action: 'edit', oldValue: old, newValue: saved });
        await this.checkLowStock(saved);
        return saved;
    }

    async remove(id: string, actorId: string) {
        const item = await this.findById(id);
        await this.auditService.log({ actorId, entityType: 'inventory', entityId: id, action: 'delete', oldValue: item });
        await this.itemRepo.remove(item);
    }

    async checkout(id: string, userId: string, notes?: string, quantity?: number) {
        const item = await this.findById(id);
        const qty = quantity != null && quantity > 0 ? quantity : 1;
        if (qty > item.quantity) {
            throw new BadRequestException(`Cannot check out ${qty} — only ${item.quantity} available`);
        }
        item.quantity -= qty;
        item.status = item.quantity === 0 ? 'Checked Out' : this.calcStatus(item);
        await this.itemRepo.save(item);
        await this.logRepo.save(this.logRepo.create({ itemId: id, userId, action: 'check_out', quantityDelta: -qty, notes }));
        return item;
    }

    async checkin(id: string, userId: string, notes?: string, quantity?: number) {
        const item = await this.findById(id);
        const qty = quantity != null && quantity > 0 ? quantity : 1;
        item.quantity += qty;
        item.status = this.calcStatus(item);
        await this.itemRepo.save(item);
        await this.logRepo.save(this.logRepo.create({ itemId: id, userId, action: 'check_in', quantityDelta: qty, notes }));
        return item;
    }

    async assignDevice(id: string, assigneeId: string, actorId: string, notes?: string) {
        const item = await this.findById(id);
        if (item.assignedTo) throw new BadRequestException('Item is already assigned. Unassign it first.');
        item.assignedTo = assigneeId;
        item.status = 'Checked Out';
        await this.itemRepo.save(item);
        await this.logRepo.save(this.logRepo.create({ itemId: id, userId: actorId, action: 'assign', notes: notes ? `Assigned to user ${assigneeId}: ${notes}` : `Assigned to user ${assigneeId}` }));
        await this.auditService.log({ actorId, entityType: 'inventory', entityId: id, action: 'assign', newValue: { assignedTo: assigneeId } });
        return this.findById(id);
    }

    async unassignDevice(id: string, actorId: string, notes?: string) {
        const item = await this.findById(id);
        if (!item.assignedTo) throw new BadRequestException('Item is not currently assigned.');
        const previousAssignee = item.assignedTo;
        item.assignedTo = null as any;
        item.status = this.calcStatus(item);
        await this.itemRepo.save(item);
        await this.logRepo.save(this.logRepo.create({ itemId: id, userId: actorId, action: 'unassign', notes: notes ? `Unassigned from user ${previousAssignee}: ${notes}` : `Unassigned from user ${previousAssignee}` }));
        await this.auditService.log({ actorId, entityType: 'inventory', entityId: id, action: 'unassign', oldValue: { assignedTo: previousAssignee } });
        return this.findById(id);
    }

    async getLogs(id: string) {
        return this.logRepo.find({ where: { itemId: id }, relations: ['user'], order: { loggedAt: 'DESC' } });
    }

    async getCategories() {
        const predefined = await this.categoryRepo.find({ order: { name: 'ASC' } });
        const customCats = await this.itemRepo.createQueryBuilder('item')
            .select('DISTINCT item.category', 'category')
            .where('item.category IS NOT NULL')
            .getRawMany();
        const predefinedNames = new Set(predefined.map(c => c.name));
        const custom = customCats
            .map(r => r.category)
            .filter(Boolean)
            .filter((c: string) => !predefinedNames.has(c))
            .map((c: string) => ({ code: '', name: c }));
        return [...predefined, ...custom];
    }

    async addCategory(code: string, name: string) {
        const existing = await this.categoryRepo.findOne({ where: [{ code }, { name }] });
        if (existing) throw new BadRequestException('Category code or name already exists');
        const cat = this.categoryRepo.create({ code: code.toUpperCase(), name });
        return this.categoryRepo.save(cat);
    }

    private calcStatus(item: InventoryItem): string {
        if (item.quantity === 0) return 'Out of Stock';
        if (item.quantity <= item.minQuantity) return 'Low Stock';
        return 'Available';
    }

    private async checkLowStock(item: InventoryItem) {
        if (item.quantity <= item.minQuantity) {
            await this.discordService.postInventoryAlert(item.name, item.quantity, item.location ?? '');
        }
    }
}
