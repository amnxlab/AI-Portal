import { IsString, IsOptional, IsObject, MinLength, MaxLength } from 'class-validator';
import { RolePermissions } from '../role.entity';

export class UpdateRoleDto {
    @IsString()
    @IsOptional()
    @MinLength(2)
    @MaxLength(40)
    label?: string;

    @IsString()
    @IsOptional()
    color?: string;

    @IsObject()
    @IsOptional()
    permissions?: Partial<RolePermissions>;
}
