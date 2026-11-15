import {
    IsString, IsOptional, IsInt,
    IsArray, MaxLength, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePaperDto {
    @IsString()
    @IsOptional()
    @MaxLength(500)
    title?: string;

    @IsString()
    @IsOptional()
    authors?: string;

    @IsInt()
    @Min(1900)
    @Max(2100)
    @IsOptional()
    @Type(() => Number)
    year?: number;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    venue?: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    doi?: string;

    @IsString()
    @IsOptional()
    url?: string;

    @IsString()
    @IsOptional()
    abstract?: string;

    @IsString()
    @IsOptional()
    notes?: string;

    @IsArray()
    @IsString({ each: true })
    @IsOptional()
    tags?: string[];
}
