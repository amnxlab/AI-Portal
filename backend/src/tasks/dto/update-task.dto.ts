import {
    IsString, IsOptional, IsUUID, IsIn,
    IsNumber, IsPositive, IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TASK_STATUSES, TASK_PRIORITIES } from './create-task.dto';

export class UpdateTaskDto {
    @IsString()
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsIn(TASK_STATUSES)
    @IsOptional()
    status?: string;

    @IsIn(TASK_PRIORITIES)
    @IsOptional()
    priority?: string;

    @IsUUID()
    @IsOptional()
    assigneeId?: string;

    @IsUUID()
    @IsOptional()
    subProjectId?: string;

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

    @IsNumber({ maxDecimalPlaces: 2 })
    @IsPositive()
    @IsOptional()
    @Type(() => Number)
    actualHours?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    position?: number;
}
