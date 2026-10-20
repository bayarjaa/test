import { AccessService } from './access.service';
import type { AuthorizationService } from '../iam/authorization.service';
import type { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { PermissionCache } from '../iam/permission-cache';
import type { PrismaService } from '../prisma/prisma.service';

describe('position assignment expiry', () => {
  it('removes the Keycloak group membership and marks the request expired', async () => {
    const removed: string[] = [];
    const updates: string[] = [];
    const request = {
      id: 'req-1',
      organizationId: 'mof',
      positionGroupId: 'pos-1',
      targetKeycloakId: 'user-1',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() - 60_000),
    };
    const prisma = {
      accessRequest: {
        findMany: async () => [request],
        update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
          updates.push(`${where.id}:${data.status}`);
          return request;
        },
      },
    } as unknown as PrismaService;
    const kc = {
      removeGroupMember: async (org: string, group: string, user: string) => {
        removed.push(`${org}:${group}:${user}`);
      },
    } as unknown as KeycloakAdminService;
    const cache = new PermissionCache();
    const invalidate = jest.spyOn(cache, 'invalidate');
    const service = new AccessService(prisma, kc, {} as AuthorizationService, cache);
    const count = await service.expireDue();
    expect(count).toBe(1);
    expect(removed).toEqual(['mof:pos-1:user-1']);
    expect(updates).toEqual(['req-1:EXPIRED']);
    expect(invalidate).toHaveBeenCalledWith('user-1');
  });

  it('leaves the request approved when Keycloak removal fails so the job can retry', async () => {
    const prisma = {
      accessRequest: {
        findMany: async () => [
          {
            id: 'req-2',
            organizationId: 'mof',
            positionGroupId: 'pos-1',
            targetKeycloakId: 'user-1',
          },
        ],
        update: jest.fn(),
      },
    } as unknown as PrismaService;
    const kc = {
      removeGroupMember: async () => {
        throw new Error('keycloak down');
      },
    } as unknown as KeycloakAdminService;
    const service = new AccessService(prisma, kc, {} as AuthorizationService, new PermissionCache());
    await expect(service.expireDue()).resolves.toBe(0);
    expect(prisma.accessRequest.update).not.toHaveBeenCalled();
  });
});
