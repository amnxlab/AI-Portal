import { IsUUID, IsString, IsOptional, IsIn, IsISO8601, MinLength, MaxLength, ValidateIf } from 'class-validator';

export class ReasonDto {
    @IsString()
    @MinLength(3, { message: 'A reason of at least 3 characters is required.' })
    @MaxLength(500)
    reason: string;
}

export class CreateSessionDto extends ReasonDto {
    @IsUUID()
    userId: string;

    @IsISO8601({}, { message: 'clockInAt must be an ISO 8601 date-time.' })
    clockInAt: string;

    @IsISO8601({}, { message: 'clockOutAt must be an ISO 8601 date-time.' })
    clockOutAt: string;

    @IsOptional()
    @IsIn(['onsite', 'remote'])
    mode?: 'onsite' | 'remote';
}

export class CorrectSessionDto extends ReasonDto {
    @IsOptional()
    @IsISO8601({}, { message: 'clockInAt must be an ISO 8601 date-time.' })
    clockInAt?: string;

    @IsOptional()
    @IsISO8601({}, { message: 'clockOutAt must be an ISO 8601 date-time.' })
    clockOutAt?: string;

    @IsOptional()
    @IsIn(['onsite', 'remote'])
    mode?: 'onsite' | 'remote';
}

export class EnforcementDto {
    /** A date (YYYY-MM-DD) — snapped to its Monday — or null to switch enforcement off. */
    @ValidateIf((o) => o.enforcementStart !== null && o.enforcementStart !== undefined && o.enforcementStart !== '')
    @IsString()
    enforcementStart?: string | null;
}
