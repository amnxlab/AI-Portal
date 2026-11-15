import {
    IsString, IsNotEmpty, IsUUID, IsOptional, IsIn, MaxLength, IsArray,
} from 'class-validator';

export class CreateCommentDto {
    @IsIn(['task', 'ticket', 'project', 'video_media'])
    entityType: string;

    @IsUUID()
    entityId: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(4000)
    content: string;

    /** Parent comment ID for threaded replies. */
    @IsUUID()
    @IsOptional()
    parentId?: string;

    /** Explicit list of user IDs to @mention (from frontend selection). */
    @IsArray()
    @IsUUID('4', { each: true })
    @IsOptional()
    mentions?: string[];
}
