import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginSchema, RegisterSchema, RefreshTokenSchema, type LoginDto, type RegisterDto, type RefreshTokenDto } from 'resume-builder-shared';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() body: RegisterDto) {
    const parsed = RegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.authService.register(parsed.data);
  }

  @Post('login')
  login(@Body() body: LoginDto) {
    const parsed = LoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.authService.login(parsed.data);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshTokenDto) {
    const parsed = RefreshTokenSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.authService.refresh(parsed.data.userId, parsed.data.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  logout(@Req() req: { user: { userId: string } }) {
    return this.authService.logout(req.user.userId);
  }
}
