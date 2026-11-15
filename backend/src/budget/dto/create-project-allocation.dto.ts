import { IsString, IsOptional, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateProjectAllocationDto {
    @IsUUID()
    budgetAccountId: string;

    @IsUUID()
    projectId: string;

    @IsNumber()
    @Min(0)
    allocatedAmount: number;

    @IsString()
    @IsOptional()
    notes?: string;
}
