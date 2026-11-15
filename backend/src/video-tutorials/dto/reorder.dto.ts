import { IsArray, ValidateNested, IsUUID, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class ReorderItem {
    @IsUUID() id: string;
    @IsInt() @Min(0) sortOrder: number;
}

export class ReorderDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ReorderItem)
    items: ReorderItem[];
}
