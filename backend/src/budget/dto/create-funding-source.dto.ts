import { IsString, IsOptional, IsNumber, IsIn, IsBoolean, Min } from 'class-validator';

export class CreateFundingSourceDto {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsNumber()
    @Min(0)
    totalAmount: number;

    @IsIn(['grant', 'institutional', 'donation', 'external', 'other'])
    sourceType: 'grant' | 'institutional' | 'donation' | 'external' | 'other';

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    /** Whether this source keeps applying after its budget year closes. */
    @IsBoolean()
    @IsOptional()
    carriesOver?: boolean;
}
