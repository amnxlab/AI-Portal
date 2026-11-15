import { IsUUID, IsNotEmpty, IsOptional, IsDateString, IsString, IsIn } from 'class-validator';

export class AssignPaperDto {
    @IsUUID() @IsNotEmpty() assigneeId: string;
    @IsDateString() @IsOptional() deadline?: string;
    @IsUUID() @IsOptional() subProjectId?: string;
    @IsString() @IsOptional() @IsIn(['Low', 'Medium', 'High', 'Critical']) priority?: string;
    @IsString() @IsOptional() goal?: string;
}
