import { IsNotEmpty, IsOptional, IsString, IsUUID, IsInt, Min } from 'class-validator';

export class CreatePlaylistDto {
    @IsUUID() @IsNotEmpty() projectId: string;
    @IsString() @IsNotEmpty() title: string;
    @IsString() @IsOptional() description?: string;
    @IsInt() @Min(0) @IsOptional() sortOrder?: number;
}
