import { ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import type { AuthorizationService } from '../iam/authorization.service';
import type { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { PermissionCache } from '../iam/permission-cache';

describe('IAM administration', () => {
  it('denies organization creation without central authority', async () => {
    const authz = { hasCentralAuthority: async () => false } as unknown as AuthorizationService;
    const kc = { createOrganization: jest.fn() } as unknown as KeycloakAdminService;
    const service = new OrganizationsService(kc, authz, new PermissionCache());
    await expect(
      service.create('specialist', {
        name: 'New',
        alias: 'new',
        code: 'NEW',
        orgType: 'PRIVATE',
        domain: 'new.local',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(kc.createOrganization).not.toHaveBeenCalled();
  });
});
