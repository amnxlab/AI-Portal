import {
    IsString, IsNotEmpty, IsOptional,
    IsDateString, IsIn, IsNumber, Min,
} from 'class-validator';

export const PROJECT_STATUSES = ['Active', 'On Hold', 'Planned', 'Completed', 'Cancelled'] as const;

export class CreateProjectDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsDateString()
    @IsOptional()
    deadline?: string;

    @IsIn(PROJECT_STATUSES)
    @IsOptional()
    status?: string;

    @IsDateString()
    @IsOptional()
    startDate?: string;

    @IsDateString()
    @IsOptional()
    endDate?: string;

    @IsString()
    @IsOptional()
    coverImage?: string;

    /** Allocated budget. Declared here so the form's value is not stripped. */
    @IsNumber()
    @Min(0)
    @IsOptional()
    budget?: number | null;
}
