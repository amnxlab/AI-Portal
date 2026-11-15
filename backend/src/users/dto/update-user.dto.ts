import { IsString, IsEmail, IsOptional, IsBoolean, IsNumber, IsObject, Min, Max } from 'class-validator';

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    fullName?: string;

    @IsString()
    @IsOptional()
    username?: string;

    @IsEmail()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    password?: string;

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

    @IsBoolean()
    @IsOptional()
    isActive?: boolean;

    @IsString()
    @IsOptional()
    avatarUrl?: string;

    @IsString()
    @IsOptional()
    jobTitle?: string | null;

    @IsNumber()
    @Min(0)
    @IsOptional()
    hourlyRate?: number | null;

    @IsBoolean()
    @IsOptional()
    isOnHold?: boolean;

    /**
     * @deprecated Superseded by `remoteWorkAllowed`. The portal clock and
     * remote-hour reporting are one authorisation now, not two: an employee
     * who may work remotely may clock in from the portal, and one who may
     * not has the RFID reader as their only clock. Still accepted so older
     * clients keep working — it is applied as `remoteWorkAllowed`.
     */
    @IsBoolean()
    @IsOptional()
    onlineClockEnabled?: boolean;

    /** Whether this employee may work (and report) remote hours at all. */
    @IsBoolean()
    @IsOptional()
    remoteWorkAllowed?: boolean;

    /** Share of the weekly hours allowed remotely. Default policy: 20%. */
    @IsNumber()
    @Min(0)
    @Max(100)
    @IsOptional()
    remoteWorkPercent?: number;

    /** Hard weekly ceiling on remote hours. null = only the percentage applies. */
    @IsNumber()
    @Min(0)
    @IsOptional()
    remoteMaxHours?: number | null;

    @IsString()
    @IsOptional()
    employeeId?: string | null;

    /**
     * Max hours this member may report per week. null = no cap.
     *
     * It was missing from this DTO while the form sent it on every save, and
     * the global ValidationPipe runs with `whitelist: true` — so it was
     * stripped from the body before the controller ever saw it, silently.
     * That is what the separate /hours-cap request was working around.
     */
    @IsNumber()
    @Min(0)
    @Max(168)
    @IsOptional()
    weeklyHoursCap?: number | null;

    /**
     * @deprecated The inverse of `remoteWorkAllowed`, which is the field the
     * database actually holds. Accepted because the user form still speaks in
     * terms of a restriction.
     */
    @IsBoolean()
    @IsOptional()
    remoteWorkRestricted?: boolean;
}
