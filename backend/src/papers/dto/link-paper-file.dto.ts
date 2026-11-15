import { IsUUID, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

export const PAPER_FILE_TYPES = ['pdf', 'supplementary', 'slides', 'poster', 'code'] as const;

export class LinkPaperFileDto {
    @IsUUID()
    @IsNotEmpty()
    fileId: string;

    @IsIn(PAPER_FILE_TYPES)
    @IsOptional()
    fileType?: string;
}
