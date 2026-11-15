import { IsNumber, IsOptional, IsArray, IsBoolean, IsString, IsDateString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SimulationEmployeeDto {
    @IsString()
    @IsOptional()
    userId?: string;

    @IsString()
    name: string;

    @IsNumber()
    @Min(0)
    hourlyRate: number;

    @IsNumber()
    @Min(0)
    weeklyHours: number;

    @IsBoolean()
    included: boolean;
}

export class SimulateDto {
    @IsNumber()
    @Min(0)
    laborBalance: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SimulationEmployeeDto)
    employees: SimulationEmployeeDto[];

    @IsDateString()
    @IsOptional()
    targetDate?: string;
}
