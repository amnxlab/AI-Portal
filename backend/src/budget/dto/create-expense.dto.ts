import { IsString, IsNumber, IsIn, IsUUID, IsOptional, IsDateString, Min } from 'class-validator';

export class CreateExpenseDto {
    @IsUUID()
    allocationId: string;

    @IsUUID()
    projectId: string;

    @IsString()
    description: string;

    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsIn(['equipment', 'supplies', 'travel', 'other'])
    @IsOptional()
    category?: 'equipment' | 'supplies' | 'travel' | 'other';

    @IsString()
    @IsOptional()
    vendor?: string;

    @IsString()
    @IsOptional()
    receiptUrl?: string;

    @IsDateString()
    expenseDate: string;

    @IsUUID()
    @IsOptional()
    wishlistItemId?: string;
}
