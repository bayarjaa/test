import { Injectable, NotFoundException } from '@nestjs/common';
import { assertAllowed } from '../common/assert-allowed';
import { AuthorizationService } from '../iam/authorization.service';
import { firstAttr, isDuty } from '../iam/catalog';
import { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { PermissionCache } from '../iam/permission-cache';

@Injectable()
export class UsersService {
  constructor(
    private readonly kc: KeycloakAdminService,
    private readonly authz: AuthorizationService,
    private readonly cache: PermissionCache,
  ) {}

  search(search = '') {
    return this.kc.searchUsers(search);
  }

  async positions(userId: string, organizationId?: string) {
    const orgs = organizationId
      ? [await this.kc.getOrganization(organizationId)].filter((org) => org !== null)
      : await this.kc.organizationsForMember(userId);
    const result = [];
    for (const org of orgs) {
      if (!org) continue;
      const groups = await this.kc.memberGroups(org.id, userId);
      for (const group of groups) {
        if (firstAttr(group.attributes, 'entity_type') !== 'POSITION') continue;
        const roles = await this.kc.compositeRoleNames(org.id, group.id);
        result.push({
          organizationId: org.id,
          organizationName: org.name,
          positionId: group.id,
          positionName: firstAttr(group.attributes, 'position_name') || group.name,
          positionCode: firstAttr(group.attributes, 'position_code'),
          riskLevel: firstAttr(group.attributes, 'risk_level'),
          duties: roles.filter(isDuty),
          effectivePermissions: roles.filter((role) => !isDuty(role)),
        });
      }
    }
    return result;
  }

  async revoke(actorId: string, userId: string, organizationId: string, positionId: string) {
    const central = await this.authz.hasCentralAuthority(actorId);
    if (!central) {
      const decision = await this.authz.authorize({
        userId: actorId,
        organizationId,
        permission: 'iam:position:revoke',
        fresh: true,
        resourceType: 'position',
        resourceId: positionId,
      });
      assertAllowed(decision);
    }
    const group = await this.kc.getGroup(organizationId, positionId);
    if (!group) throw new NotFoundException('position_not_found');
    await this.kc.removeGroupMember(organizationId, positionId, userId);
    this.cache.invalidate(userId);
    return { removed: true };
  }
}
