import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';

const SUB_PROJECT_STATUSES = ['Active', 'Completed', 'On Hold', 'Planned'] as const;

export class UpdateSubProjectDto {
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    @IsIn(SUB_PROJECT_STATUSES)
    status?: string;
}
