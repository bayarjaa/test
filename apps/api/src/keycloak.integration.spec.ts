import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { verifyAccessToken, remoteJwks } from './auth/jwt';
import { BudgetsService } from './budgets/budgets.service';
import { AuthorizationService } from './iam/authorization.service';
import { KeycloakAdminService } from './iam/keycloak-admin.service';
import { PermissionCache } from './iam/permission-cache';
import type { PrismaService } from './prisma/prisma.service';

const enabled = process.env.RUN_KEYCLOAK_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

describeLive('live Keycloak organization authorization', () => {
  let prisma: PrismaClient;
  let kc: KeycloakAdminService;
  let authz: AuthorizationService;
  let budgets: BudgetsService;
  const password = process.env.DEMO_USER_PASSWORD || 'ChangeMe123!';
  const base = (process.env.KEYCLOAK_INTERNAL_URL || 'http://localhost:8080').replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM || 'budget-management';
  const created: string[] = [];

  beforeAll(() => {
    prisma = new PrismaClient();
    const config = { get: (key: string) => process.env[key] } as ConfigService;
    kc = new KeycloakAdminService(config);
    authz = new AuthorizationService(kc, prisma as unknown as PrismaService, new PermissionCache());
    budgets = new BudgetsService(prisma as unknown as PrismaService, authz);
  });

  async function token(username: string) {
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: 'budget-web',
      username,
      password,
    });
    const response = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(await response.text());
    return (await response.json()) as { access_token: string };
  }

  async function userId(username: string) {
    const users = await kc.searchUsers(username);
    const user = users.find((item) => item.username === username);
    if (!user) throw new Error(`missing ${username}`);
    return user.id;
  }

  async function orgId(code: string) {
    const orgs = await kc.listOrganizations();
    const org = orgs.find((item) => item.attributes?.code?.[0] === code);
    if (!org) throw new Error(`missing org ${code}`);
    return org.id;
  }

  afterAll(async () => {
    if (created.length) {
      await prisma.budgetWorkflowHistory.deleteMany({ where: { documentId: { in: created } } });
      await prisma.budgetLine.deleteMany({ where: { documentId: { in: created } } });
      await prisma.budgetDocument.deleteMany({ where: { id: { in: created } } });
    }
    await prisma.$disconnect();
  });

  it('verifies a real access token and scopes multi.user to MOF but not MOE', async () => {
    const issued = await token('multi.user');
    const claims = await verifyAccessToken(issued.access_token, {
      jwks: remoteJwks(base, realm),
      issuer: process.env.KEYCLOAK_ISSUER || `${base}/realms/${realm}`,
      audience: process.env.KEYCLOAK_AUDIENCE || 'budget-api',
    });
    expect(claims.preferredUsername).toBe('multi.user');
    const mof = await orgId('MOF');
    const moe = await orgId('MOE');
    const allowed = await authz.authorize({
      userId: claims.sub,
      organizationId: mof,
      permission: 'budget:draft:create',
      fresh: true,
    });
    const denied = await authz.authorize({
      userId: claims.sub,
      organizationId: moe,
      permission: 'budget:draft:read',
      fresh: true,
    });
    expect(allowed.decision).toBe('ALLOW');
    expect(denied.decision).toBe('DENY');
  });

  it('lets a director approve a specialist draft and blocks self-approval', async () => {
    const moe = await orgId('MOE');
    const specialist = await userId('moe.specialist');
    const director = await userId('moe.director');
    const draft = await budgets.create(specialist, {
      organizationId: moe,
      title: 'Жилийн төсөв',
      fiscalYear: 2026,
      lines: [{ description: 'Цалин', amount: 1000 }],
    });
    created.push(draft.id);
    const submitted = await budgets.submit(specialist, draft.id, 'Илгээв');
    expect(submitted.status).toBe('SUBMITTED');
    const reviewed = await budgets.review(director, draft.id, 'Хянав');
    expect(reviewed.status).toBe('REVIEWED');
    const approved = await budgets.approve(director, draft.id, 'Баталсан');
    expect(approved.status).toBe('APPROVED');

    const directorUser = await prisma.user.upsert({
      where: { keycloakId: director },
      update: {},
      create: { keycloakId: director },
    });
    const own = await prisma.budgetDocument.create({
      data: {
        organizationId: moe,
        title: 'Өөрийн төсөв',
        fiscalYear: 2026,
        status: 'REVIEWED',
        creatorId: directorUser.id,
        creatorKeycloakId: director,
        lines: { create: [{ description: 'Тест', amount: 1 }] },
      },
    });
    created.push(own.id);
    await expect(budgets.approve(director, own.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
