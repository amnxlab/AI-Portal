import { IsUUID } from 'class-validator';

export class LaborDeductDto {
    @IsUUID()
    weeklyReportId: string;

    @IsUUID()
    budgetAccountId: string;
}
