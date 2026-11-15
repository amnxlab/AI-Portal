import { IsString, IsOptional, IsObject, MinLength, MaxLength, Matches } from 'class-validator';
import { RolePermissions } from '../role.entity';

export class CreateRoleDto {
    @IsString()
    @MinLength(2)
    @MaxLength(32)
    @Matches(/^[A-Za-z0-9_]+$/, { message: 'name may only contain letters, digits and underscores' })
    name: string;

    @IsString()
    @MinLength(2)
    @MaxLength(40)
    label: string;

    @IsString()
    @IsOptional()
    color?: string;

    @IsObject()
    @IsOptional()
    permissions?: Partial<RolePermissions>;
}
