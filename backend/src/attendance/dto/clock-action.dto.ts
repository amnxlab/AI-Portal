import { IsUUID, IsNotEmpty, IsString, MinLength, MaxLength } from 'class-validator';

/** An administrator clocking an employee in or out by hand. */
export class ClockActionDto {
    @IsUUID()
    @IsNotEmpty()
    userId: string;

    /** Mandatory: every manual clock event is written to the audit log with its reason. */
    @IsString()
    @MinLength(3, { message: 'A reason of at least 3 characters is required.' })
    @MaxLength(500)
    reason: string;
}
