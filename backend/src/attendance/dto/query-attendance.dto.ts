import { IsOptional, IsDateString, IsUUID, IsIn } from 'class-validator';

export class QueryAttendanceDto {
    @IsOptional()
    @IsDateString()
    weekStart?: string;

    @IsOptional()
    @IsDateString()
    biweekStart?: string;

    @IsOptional()
    @IsDateString()
    date?: string;

    @IsOptional()
    @IsUUID()
    userId?: string;

    @IsOptional()
    @IsIn(['weekly', 'biweekly'])
    type?: 'weekly' | 'biweekly';
}
