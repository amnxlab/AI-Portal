import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshToken } from './refresh-token.entity';
import { PasswordResetToken } from './password-reset-token.entity';
import { RegistrationToken } from './registration-token.entity';
import { UsersModule } from '../users/users.module';

@Module({
    imports: [
        UsersModule,
        PassportModule,
        TypeOrmModule.forFeature([RefreshToken, PasswordResetToken, RegistrationToken]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (cfg: ConfigService) => ({
                secret: cfg.get('JWT_SECRET'),
                signOptions: { expiresIn: cfg.get('JWT_EXPIRES_IN', '15m') },
            }),
        }),
    ],
    providers: [AuthService, JwtStrategy],
    controllers: [AuthController],
    exports: [AuthService],
})
export class AuthModule { }
