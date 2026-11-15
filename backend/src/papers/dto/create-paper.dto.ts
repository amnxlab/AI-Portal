import {
    IsString, IsNotEmpty, IsOptional, IsUUID, IsInt,
    IsArray, MaxLength, Min, Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePaperDto {
    @IsUUID()
    @IsNotEmpty()
    projectId: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    title: string;

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

    @IsUUID()
    @IsOptional()
    folderId?: string | null;
}
