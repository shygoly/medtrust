import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import {
  User,
  RefreshToken,
  SsoTicket,
  AuthCaptcha,
  VerificationCode,
  OrgCertificationApplication,
} from "@medtrust/database";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { CaptchaService } from "./captcha.service";
import { MailService } from "./mail.service";
import { SmsService } from "./sms.service";
import { TotpService } from "./totp.service";
import { JwtStrategy } from "./jwt.strategy";
import { getJwtSecret } from "./jwt-secret.util";
import { SpaceModule } from "../runtime/space/space.module";

@Module({
  imports: [
    // User + RefreshToken + AuthCaptcha + VerificationCode on the default connection (D2).
    TypeOrmModule.forFeature([
      User,
      RefreshToken,
      SsoTicket,
      AuthCaptcha,
      VerificationCode,
    ]),
    // P2-1 CA 登录读取机构认证里的用户 CA 凭证(公钥/指纹)。
    TypeOrmModule.forFeature([OrgCertificationApplication], "controlplane"),
    PassportModule.register({ defaultStrategy: "jwt" }),
    SpaceModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: getJwtSecret(), // required; fail-fast in prod (no insecure default)
        signOptions: {
          expiresIn: configService.get("JWT_EXPIRES_IN") || "15m",
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    CaptchaService,
    MailService,
    SmsService,
    TotpService,
    JwtStrategy,
  ],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
