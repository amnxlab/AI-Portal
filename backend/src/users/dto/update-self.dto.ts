import { IsString, IsEmail, IsOptional, MinLength } from 'class-validator';

export class UpdateSelfDto {
    @IsString()
    @IsOptional()
    fullName?: string;

    @IsString()
    @IsOptional()
    username?: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    @MinLength(6)
    password?: string;

    @IsString()
    @IsOptional()
    avatarUrl?: string | null;

    @IsString()
    @IsOptional()
    bio?: string | null;
}
