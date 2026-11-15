import {
    IsString, IsOptional, IsIn, IsNumber, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const WISHLIST_STATUSES = ['Requested', 'Approved', 'Rejected', 'Purchased'] as const;

export class UpdateWishlistItemDto {
    @IsString()
    @IsOptional()
    itemName?: string;

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

    @IsIn(WISHLIST_STATUSES)
    @IsOptional()
    status?: string;
}
