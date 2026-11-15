import { IsString, IsEmail, IsOptional, IsObject } from 'class-validator';

export class CreateUserDto {
    @IsString()
    username: string;

    @IsString()
    fullName: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsString()
    password: string;

    /**
     * @deprecated The unified role model ignores this — every user is a
     * 'Member'. Accepted for API compatibility only.
     */
    @IsString()
    @IsOptional()
    role?: string;

    /** Modular per-user access permissions (subset of the permission flags). */
    @IsObject()
    @IsOptional()
    permissions?: Record<string, boolean>;
}
