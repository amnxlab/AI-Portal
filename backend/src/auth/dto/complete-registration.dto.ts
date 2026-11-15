import { IsString, MinLength, MaxLength, Matches, IsOptional } from 'class-validator';

/** What the new member chooses for themselves, from the invitation link. */
export class CompleteRegistrationDto {
    @IsString()
    token: string;

    @IsString()
    @MinLength(3, { message: 'Username must be at least 3 characters' })
    @MaxLength(32, { message: 'Username must be 32 characters or fewer' })
    @Matches(/^[a-zA-Z0-9._-]+$/, {
        message: 'Username may contain only letters, numbers, dots, dashes and underscores',
    })
    username: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters' })
    @MaxLength(128)
    password: string;

    /** Offered pre-filled from the invitation; they may correct it. */
    @IsString()
    @IsOptional()
    @MaxLength(255)
    fullName?: string;
}
