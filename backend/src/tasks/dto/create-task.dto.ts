import {
    IsString, IsNotEmpty, IsOptional, IsUUID, IsIn,
    IsNumber, IsPositive, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TASK_STATUSES   = ['Todo', 'In Progress', 'Pending Review', 'Needs Revision', 'Blocked', 'Done'] as const;
export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export class CreateTaskDto {
    @IsString()
    @IsNotEmpty()
    title: string;

    @IsUUID()
    @IsNotEmpty()
    projectId: string;

    @IsUUID()
    @IsOptional()
    subProjectId?: string;

    @IsUUID()
    @IsOptional()
    assigneeId?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsIn(TASK_STATUSES)
    @IsOptional()
    status?: string;

    @IsIn(TASK_PRIORITIES)
    @IsOptional()
    priority?: string;

    @IsDateString()
    @IsOptional()
    deadline?: string;

    @IsDateString()
    @IsOptional()
    startDate?: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    @IsOptional()
    @Type(() => Number)
    estimatedHours?: number;

    @IsUUID()
    @IsOptional()
    paperId?: string;
}
