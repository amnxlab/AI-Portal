import {
    IsString, IsNotEmpty, IsOptional, IsUUID,
    IsNumber, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWishlistItemDto {
    @IsString()
    @IsNotEmpty()
    itemName: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0)
    @IsOptional()
    @Type(() => Number)
    cost?: number;

    @IsString()
    @IsOptional()
    link?: string;

    @IsUUID()
    @IsOptional()
    projectId?: string;

    @IsUUID()
    @IsOptional()
    subProjectId?: string;
}
