import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { CaptchaService } from "./captcha.service";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { SendSmsCodeDto } from "./dto/send-sms-code.dto";
import { SmsLoginDto } from "./dto/sms-login.dto";
import { SmsResetPasswordDto } from "./dto/sms-reset-password.dto";
import { CaChallengeDto } from "./dto/ca-challenge.dto";
import { CaLoginDto } from "./dto/ca-login.dto";
import { MfaCodeDto } from "./dto/mfa-code.dto";
import { SsoExchangeDto } from "./dto/sso-exchange.dto";
import { JwtAuthGuard } from "./jwt-auth.guard";

@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(
    private authService: AuthService,
    private captchaService: CaptchaService,
  ) {}

  @Get("captcha")
  @ApiOperation({ summary: "Issue a graphic captcha challenge (P0-3)" })
  @ApiResponse({ status: 200, description: "Captcha challenge issued" })
  async captcha() {
    return this.captchaService.generate();
  }

  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Register a new user" })
  @ApiResponse({ status: 201, description: "User registered successfully" })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 401, description: "User already exists" })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: "Login with account (email/phone), password and graphic captcha",
  })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 400, description: "Missing captcha" })
  @ApiResponse({ status: 401, description: "Invalid credentials or captcha" })
  async login(@Body() loginDto: LoginDto) {
    if (this.captchaRequired()) {
      if (!loginDto.captchaId || !loginDto.captchaCode) {
        throw new BadRequestException("请输入图形验证码");
      }
      const captchaOk = await this.captchaService.verify(
        loginDto.captchaId,
        loginDto.captchaCode,
      );
      if (!captchaOk) {
        throw new UnauthorizedException("图形验证码错误或已过期");
      }
    }
    return this.authService.login(loginDto);
  }

  // P0-3:生产环境默认强制图形验证码;开发/测试可用 AUTH_CAPTCHA_REQUIRED
  // 显式切换(默认不强制,保证 E2E 脚本可用)。
  private captchaRequired(): boolean {
    const flag = process.env.AUTH_CAPTCHA_REQUIRED?.trim().toLowerCase();
    if (flag === "true") return true;
    if (flag === "false") return false;
    return process.env.NODE_ENV === "production";
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: "Send a password reset code by email (P0-6)" })
  @ApiResponse({ status: 200, description: "Accepted" })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.sendPasswordResetCode(dto.email);
    // 防账号枚举:无论邮箱是否存在都返回相同结果。
    return { ok: true };
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Reset password with the emailed code (P0-6)" })
  @ApiResponse({ status: 200, description: "Password reset" })
  @ApiResponse({ status: 401, description: "Invalid/expired code" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
    return { ok: true };
  }

  @Post("sms/reset-code")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: "Send a phone password-reset code (P1-8)" })
  @ApiResponse({ status: 200, description: "Accepted" })
  async sendSmsResetCode(@Body() dto: SendSmsCodeDto) {
    await this.authService.sendSmsPasswordResetCode(dto.phone);
    return { ok: true };
  }

  @Post("reset-password/sms")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Reset password with phone SMS code (P1-8)" })
  @ApiResponse({ status: 200, description: "Password reset" })
  @ApiResponse({ status: 401, description: "Invalid/expired code" })
  async resetPasswordBySms(@Body() dto: SmsResetPasswordDto) {
    await this.authService.resetPasswordByPhone(
      dto.phone,
      dto.code,
      dto.newPassword,
    );
    return { ok: true };
  }

  @Post("sms/send")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: "Send a phone login code (P1-2)" })
  @ApiResponse({ status: 200, description: "Accepted" })
  async sendSmsCode(@Body() dto: SendSmsCodeDto) {
    await this.authService.sendSmsLoginCode(dto.phone);
    return { ok: true };
  }

  @Post("login/sms")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Login with phone and SMS code (P1-2)" })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 401, description: "Invalid/expired code" })
  async smsLogin(@Body() dto: SmsLoginDto) {
    return this.authService.loginWithSmsCode(dto.phone, dto.code);
  }

  @Post("ca/challenge")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Issue a CA login challenge (P2-1)" })
  @ApiResponse({ status: 200, description: "Challenge issued" })
  @ApiResponse({ status: 401, description: "Account unusable" })
  async caChallenge(@Body() dto: CaChallengeDto) {
    return this.authService.createCaChallenge(dto.account);
  }

  @Post("login/ca")
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: "Login with CA certificate signature (P2-1)" })
  @ApiResponse({ status: 200, description: "Login successful" })
  @ApiResponse({ status: 401, description: "Signature verification failed" })
  async caLogin(@Body() dto: CaLoginDto) {
    return this.authService.loginWithCa(
      dto.account,
      dto.challengeId,
      dto.signature,
    );
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Rotate a refresh token for a new access + refresh pair",
  })
  @ApiResponse({ status: 200, description: "Rotated" })
  @ApiResponse({
    status: 401,
    description: "Invalid/expired/reused refresh token",
  })
  async refresh(@Body("refresh_token") refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke a refresh token" })
  async logout(@Body("refresh_token") refreshToken: string) {
    await this.authService.logout(refreshToken);
    return { ok: true };
  }

  @Post("sso/exchange")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Exchange a one-time Xian SSO ticket for a session",
  })
  @ApiResponse({ status: 200, description: "Session issued" })
  @ApiResponse({ status: 401, description: "Invalid/expired/reused ticket" })
  async exchangeSso(@Body() dto: SsoExchangeDto) {
    return this.authService.exchangeSsoTicket(dto.ticket);
  }

  @Post("mfa/setup")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "发起 MFA 绑定(P2-4)" })
  async setupMfa(@Request() req: any) {
    return this.authService.setupMfa(req.user.userId);
  }

  @Post("mfa/enable")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "校验 TOTP 并启用 MFA(P2-4)" })
  async enableMfa(@Request() req: any, @Body() dto: MfaCodeDto) {
    return this.authService.enableMfa(req.user.userId, dto.code);
  }

  @Post("mfa/disable")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "禁用 MFA(P2-4)" })
  async disableMfa(@Request() req: any, @Body() dto: MfaCodeDto) {
    return this.authService.disableMfa(req.user.userId, dto.code);
  }

  @Get("profile")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Current user identity (incl. participant role)" })
  async profile(@Request() req: any) {
    return req.user; // { userId, email, participantId, role }
  }
}
