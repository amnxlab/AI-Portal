import { IsString, IsNotEmpty, IsEmail } from 'class-validator';

export class ForgotPasswordDto {
    /**
     * The account's registered email address. The endpoint responds
     * identically whether or not the address exists (no enumeration).
     */
    @IsString()
    @IsNotEmpty()
    @IsEmail()
    email: string;
}
