import { IsUUID, IsNotEmpty, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class AssignManualDto {
    @IsUUID() @IsNotEmpty() assigneeId: string;
    @IsDateString() @IsOptional() deadline?: string;
    @IsUUID() @IsOptional() subProjectId?: string;
    @IsString() @IsOptional() @IsIn(['Low', 'Medium', 'High', 'Critical']) priority?: string;
    @IsString() @IsOptional() goal?: string;
}
