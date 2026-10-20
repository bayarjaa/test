import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertAllowed } from '../common/assert-allowed';
import { AuthorizationService } from '../iam/authorization.service';
import { firstAttr, isDuty } from '../iam/catalog';
import { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { PermissionCache } from '../iam/permission-cache';
import type { KcGroup } from '../iam/iam.gateway';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly kc: KeycloakAdminService,
    private readonly authz: AuthorizationService,
    private readonly cache: PermissionCache,
  ) {}

  list() {
    return this.kc.listOrganizations();
  }

  async create(
    actorId: string,
    input: {
      name: string;
      alias: string;
      code: string;
      orgType: string;
      domain: string;
      parentOrganizationId?: string;
    },
  ) {
    if (!(await this.authz.hasCentralAuthority(actorId))) {
      throw new ForbiddenException('central_authority_required');
    }
    const org = await this.kc.createOrganization(input);
    this.cache.invalidate();
    return org;
  }

  async update(
    actorId: string,
    id: string,
    patch: { name?: string; code?: string; orgType?: string; parentOrganizationId?: string | null },
  ) {
    if (!(await this.authz.hasCentralAuthority(actorId))) {
      throw new ForbiddenException('central_authority_required');
    }
    const org = await this.kc.updateOrganization(id, patch);
    this.cache.invalidate();
    return org;
  }

  async departments(organizationId: string) {
    const groups = await this.kc.listGroups(organizationId);
    const departments = [];
    for (const group of groups) {
      if (firstAttr(group.attributes, 'entity_type') !== 'DEPARTMENT') continue;
      const children = group.subGroups?.length
        ? group.subGroups
        : await this.kc.listChildren(organizationId, group.id);
      departments.push(this.toDepartment({ ...group, subGroups: children }));
    }
    return departments;
  }

  async createDepartment(
    actorId: string,
    organizationId: string,
    input: { name: string; departmentCode: string },
  ) {
    await this.requireOrgPermission(actorId, organizationId, 'iam:position:assign');
    const group = await this.kc.createGroup(organizationId, null, input.name, {
      entity_type: ['DEPARTMENT'],
      department_code: [input.departmentCode],
    });
    this.cache.invalidate();
    return this.toDepartment(group);
  }

  async positions(organizationId: string) {
    const departments = await this.departments(organizationId);
    return departments.flatMap((department) =>
      department.positions.map((position) => ({ ...position, departmentId: department.id, departmentName: department.name })),
    );
  }

  async createPosition(
    actorId: string,
    organizationId: string,
    input: {
      name: string;
      parentGroupId: string;
      positionCode: string;
      positionName: string;
      riskLevel: 'LOW' | 'HIGH';
    },
  ) {
    await this.requireOrgPermission(actorId, organizationId, 'iam:position:assign');
    const parent = await this.kc.getGroup(organizationId, input.parentGroupId);
    if (!parent || firstAttr(parent.attributes, 'entity_type') !== 'DEPARTMENT') {
      throw new BadRequestException('parent_must_be_department');
    }
    const group = await this.kc.createGroup(organizationId, parent.id, input.name, {
      entity_type: ['POSITION'],
      department_code: [firstAttr(parent.attributes, 'department_code') || ''],
      position_code: [input.positionCode],
      position_name: [input.positionName],
      risk_level: [input.riskLevel],
    });
    this.cache.invalidate();
    return this.toPosition(group);
  }

  async updatePosition(
    actorId: string,
    organizationId: string,
    positionId: string,
    patch: { name?: string; positionName?: string; riskLevel?: 'LOW' | 'HIGH' },
  ) {
    await this.requireOrgPermission(actorId, organizationId, 'iam:position:assign');
    const current = await this.requirePosition(organizationId, positionId);
    const attributes = { ...(current.attributes || {}) };
    if (patch.positionName) attributes.position_name = [patch.positionName];
    if (patch.riskLevel) attributes.risk_level = [patch.riskLevel];
    const updated = await this.kc.updateGroup(
      organizationId,
      positionId,
      patch.name || current.name,
      attributes,
    );
    this.cache.invalidate();
    return this.toPosition(updated);
  }

  async duties(organizationId: string, positionId: string) {
    await this.requirePosition(organizationId, positionId);
    const direct = await this.kc.directRoleMappings(organizationId, positionId);
    const effective = await this.kc.compositeRoleNames(organizationId, positionId);
    return {
      duties: direct.filter((role) => isDuty(role.name)),
      effectivePermissions: effective.filter((name) => !isDuty(name)),
    };
  }

  async addDuty(actorId: string, organizationId: string, positionId: string, roleName: string) {
    await this.requireOrgPermission(actorId, organizationId, 'iam:position:assign');
    await this.requirePosition(organizationId, positionId);
    if (!isDuty(roleName)) throw new BadRequestException('role_must_be_duty');
    const role = await this.kc.findClientRole(roleName);
    if (!role) throw new NotFoundException('duty_not_found');
    await this.kc.addGroupClientRoles(organizationId, positionId, [role]);
    this.cache.invalidate();
    return this.duties(organizationId, positionId);
  }

  async removeDuty(actorId: string, organizationId: string, positionId: string, roleName: string) {
    await this.requireOrgPermission(actorId, organizationId, 'iam:position:assign');
    const role = await this.kc.findClientRole(roleName);
    if (!role) throw new NotFoundException('duty_not_found');
    await this.kc.removeGroupClientRoles(organizationId, positionId, [role]);
    this.cache.invalidate();
    return this.duties(organizationId, positionId);
  }

  async roles() {
    const roles = await this.kc.listClientRoles();
    const duties = [];
    for (const role of roles.filter((item) => isDuty(item.name))) {
      const composites = await this.kc.roleComposites(role.name);
      duties.push({ ...role, permissions: composites.map((item) => item.name) });
    }
    return {
      permissions: roles.filter((role) => !isDuty(role.name)),
      duties,
    };
  }

  async matrix() {
    const orgs = await this.kc.listOrganizations();
    const rows = [];
    for (const org of orgs) {
      const departments = await this.departments(org.id);
      for (const department of departments) {
        for (const position of department.positions) {
          const dutyView = await this.duties(org.id, position.id);
          rows.push({
            organizationId: org.id,
            organizationName: org.name,
            organizationCode: firstAttr(org.attributes, 'code'),
            departmentId: department.id,
            departmentName: department.name,
            positionId: position.id,
            positionName: position.positionName,
            riskLevel: position.riskLevel,
            duties: dutyView.duties.map((duty) => duty.name),
            effectivePermissions: dutyView.effectivePermissions,
          });
        }
      }
    }
    return rows;
  }

  private async requireOrgPermission(actorId: string, organizationId: string, permission: string) {
    const central = await this.authz.hasCentralAuthority(actorId);
    if (central) return;
    const decision = await this.authz.authorize({
      userId: actorId,
      organizationId,
      permission,
      fresh: true,
      resourceType: 'iam',
    });
    assertAllowed(decision);
  }

  private async requirePosition(organizationId: string, positionId: string) {
    const group = await this.kc.getGroup(organizationId, positionId);
    if (!group || firstAttr(group.attributes, 'entity_type') !== 'POSITION') {
      throw new NotFoundException('position_not_found');
    }
    return group;
  }

  private toDepartment(group: KcGroup) {
    const positions = (group.subGroups || [])
      .filter((child) => firstAttr(child.attributes, 'entity_type') === 'POSITION')
      .map((child) => this.toPosition(child));
    return {
      id: group.id,
      name: group.name,
      departmentCode: firstAttr(group.attributes, 'department_code'),
      positions,
    };
  }

  private toPosition(group: KcGroup) {
    return {
      id: group.id,
      name: group.name,
      positionCode: firstAttr(group.attributes, 'position_code'),
      positionName: firstAttr(group.attributes, 'position_name') || group.name,
      riskLevel: firstAttr(group.attributes, 'risk_level') || 'LOW',
      departmentCode: firstAttr(group.attributes, 'department_code'),
    };
  }
}
