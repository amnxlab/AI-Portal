import {
    IsString, IsEmail, IsOptional, IsObject, IsBoolean, IsNumber, Min, Max, MaxLength,
} from 'class-validator';

/**
 * What an administrator fills in to bring somebody into the portal.
 *
 * Only the email address is required. Everything else is the employment
 * detail an administrator may already know — and deliberately NOT a username
 * or a password, which are the new member's to choose.
 */
export class InviteUserDto {
    @IsEmail({}, { message: 'Enter a valid email address' })
    email: string;

    /** Optional: if omitted, the part before the @ stands in until they register. */
    @IsString()
    @IsOptional()
    @MaxLength(255)
    fullName?: string;

    @IsString()
    @IsOptional()
    @MaxLength(255)
    jobTitle?: string | null;

    @IsString()
    @IsOptional()
    @MaxLength(64)
    employeeId?: string | null;

    @IsObject()
    @IsOptional()
    permissions?: Record<string, boolean>;

    @IsNumber()
    @Min(0)
    @Max(168)
    @IsOptional()
    weeklyHoursCap?: number | null;

    @IsBoolean()
    @IsOptional()
    remoteWorkAllowed?: boolean;

    @IsBoolean()
    @IsOptional()
    isOnHold?: boolean;
}
