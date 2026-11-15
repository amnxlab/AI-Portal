import {
    IsUUID, IsDateString, IsIn, IsString, IsNumber, IsOptional, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseWishlistItemDto {
    /** The budget allocation to charge this purchase against */
    @IsUUID()
    allocationId: string;

    /** Date of the expense */
    @IsDateString()
    expenseDate: string;

    /** Expense category */
    @IsIn(['equipment', 'supplies', 'travel', 'other'])
    @IsOptional()
    category?: 'equipment' | 'supplies' | 'travel' | 'other';

    @IsString()
    @IsOptional()
    vendor?: string;

    @IsString()
    @IsOptional()
    receiptUrl?: string;

    // ── Inventory item fields (all optional — omit to skip inventory creation) ──

    @IsString()
    @IsOptional()
    inventoryName?: string;

    @IsString()
    @IsOptional()
    inventoryCategory?: string;

    @IsNumber()
    @Min(1)
    @IsOptional()
    @Type(() => Number)
    inventoryQuantity?: number;

    @IsString()
    @IsOptional()
    inventoryUnit?: string;

    @IsString()
    @IsOptional()
    inventoryLocation?: string;

    @IsIn(['New', 'Good', 'Alright', 'Unknown', 'Damaged'])
    @IsOptional()
    inventoryCondition?: string;
}
