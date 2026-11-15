import { IsString, IsNumber, IsIn, IsUUID, IsOptional, Min } from 'class-validator';

export class CreateTransferDto {
    @IsUUID()
    @IsOptional()
    fromAccountId?: string;

    @IsUUID()
    @IsOptional()
    toAccountId?: string;

    @IsUUID()
    @IsOptional()
    fromAllocationId?: string;

    @IsUUID()
    @IsOptional()
    toAllocationId?: string;

    @IsIn(['account_to_account', 'project_to_project', 'account_to_project', 'project_to_account'])
    transferType: 'account_to_account' | 'project_to_project' | 'account_to_project' | 'project_to_account';

    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsString()
    reason: string;
}
