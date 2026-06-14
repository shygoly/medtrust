import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private readonly users: Map<string, any> = new Map(); // Temporary in-memory storage

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {
    // 初始化演示账号
    this.initDemoUsers();
  }

  private async initDemoUsers() {
    const demoUsers = [
      { email: 'admin@huashan-hospital.com', password: 'demo123456', name: '华山医院管理员', participantId: 'p-huashan', participantRole: 'provider' },
      { email: 'admin@rjh.com.cn', password: 'demo123456', name: '瑞金医院管理员', participantId: 'p-ruijin', participantRole: 'provider' },
      { email: 'research@meddata-inst.edu.cn', password: 'demo123456', name: '研究院研究员', participantId: 'p-meddata', participantRole: 'consumer' },
      { email: 'contact@smartmed-ai.com', password: 'demo123456', name: '智慧医疗AI科技', participantId: 'p-smartmed', participantRole: 'consumer' },
      { email: 'data-governance@health.gov.cn', password: 'demo123456', name: '区域卫健委监管员', participantId: 'p-health-gov', participantRole: 'operator' },
    ];

    for (const demoUser of demoUsers) {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(demoUser.password, saltRounds);
      const user = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        email: demoUser.email,
        name: demoUser.name,
        passwordHash,
        participantId: demoUser.participantId,
        participantRole: demoUser.participantRole,
        createdAt: new Date(),
      };
      this.users.set(demoUser.email, user);
    }
    console.log(`Initialized ${demoUsers.length} demo users`);
  }

  async register(registerDto: RegisterDto) {
    const { email, password, name } = registerDto;

    // Check if user exists
    if (this.users.has(email)) {
      throw new UnauthorizedException('User already exists');
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user (in production, save to database). Self-registered users have
    // no participant binding yet — an operator assigns it later.
    const user = {
      id: Date.now(),
      email,
      name: name || email.split('@')[0],
      passwordHash,
      participantId: null as string | null,
      participantRole: null as 'provider' | 'consumer' | 'operator' | null,
      createdAt: new Date(),
    };

    this.users.set(email, user);

    // Generate JWT
    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        participantId: user.participantId,
        role: user.participantRole,
      },
      access_token: token,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    // Find user (in production, query database)
    const user = this.users.get(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Generate JWT
    const token = this.generateToken(user);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        participantId: user.participantId,
        role: user.participantRole,
      },
      access_token: token,
    };
  }

  private generateToken(user: any): string {
    const payload = {
      sub: user.id,
      email: user.email,
      participantId: user.participantId,
      role: user.participantRole,
    };
    return this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET') || 'default-secret',
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '15m',
    });
  }

  async validateUser(userId: number) {
    // In production, query database
    for (const user of this.users.values()) {
      if (user.id === userId) {
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          participantId: user.participantId,
          role: user.participantRole,
        };
      }
    }
    return null;
  }
}
