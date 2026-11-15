import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class UpdateMediaDto {
    @IsString() @IsOptional() title?: string;
    @IsString() @IsOptional() description?: string;
    @IsInt() @Min(0) @IsOptional() sortOrder?: number;
}
