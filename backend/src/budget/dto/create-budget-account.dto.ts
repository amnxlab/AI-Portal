import { IsString, IsOptional, IsNumber, IsIn, IsUUID, IsArray, ArrayMinSize, Min, IsDateString } from 'class-validator';

export class CreateBudgetAccountDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID('4', { each: true })
    fundingSourceIds: string[];

    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsIn(['Labor', 'ProjectSpending'])
    category: 'Labor' | 'ProjectSpending';

    @IsNumber()
    @Min(0)
    totalAllocated: number;

    @IsDateString()
    @IsOptional()
    expiresAt?: string;
}
