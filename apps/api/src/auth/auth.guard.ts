import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { remoteJwks, verifyAccessToken, type AccessClaims } from './jwt';
import { IS_PUBLIC } from './public.decorator';

export interface AuthenticatedRequest extends Request {
  user: AccessClaims;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private jwks: ReturnType<typeof remoteJwks> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization') || '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('missing bearer token');
    try {
      request.user = await verifyAccessToken(match[1], {
        jwks: this.keys(),
        issuer: this.config.get<string>('KEYCLOAK_ISSUER') || '',
        audience: this.config.get<string>('KEYCLOAK_AUDIENCE') || 'budget-api',
      });
      return true;
    } catch {
      throw new UnauthorizedException('invalid token');
    }
  }

  private keys() {
    if (!this.jwks) {
      this.jwks = remoteJwks(
        this.config.get<string>('KEYCLOAK_INTERNAL_URL') || 'http://localhost:8080',
        this.config.get<string>('KEYCLOAK_REALM') || 'budget-management',
      );
    }
    return this.jwks;
  }
}
