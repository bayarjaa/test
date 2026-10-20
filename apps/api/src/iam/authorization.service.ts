import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { firstAttr, GOVERNMENT_ORG_TYPES } from './catalog';
import { IamGateway, KeycloakUnavailableError } from './iam.gateway';
import { PermissionCache } from './permission-cache';
import { allowedStatuses, isAssignmentInactive, type BudgetAction, type BudgetStatus } from './workflow';

export interface BudgetResource {
  organizationId: string;
  status: BudgetStatus;
  creatorKeycloakId: string;
  action: BudgetAction;
}

export interface AuthorizeInput {
  userId: string;
  organizationId: string;
  permission: string;
  fresh?: boolean;
  budget?: BudgetResource;
  resourceType?: string;
  resourceId?: string;
}

export interface Decision {
  decision: 'ALLOW' | 'DENY';
  reason: string;
  permissions: string[];
}

@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);

  constructor(
    private readonly iam: IamGateway,
    private readonly prisma: PrismaService,
    private readonly cache: PermissionCache,
  ) {}

  async authorize(input: AuthorizeInput): Promise<Decision> {
    try {
      const permissions = await this.effectivePermissions(input.userId, input.organizationId, Boolean(input.fresh));
      const decision = await this.evaluate(input, permissions);
      await this.audit(input, decision);
      this.logger.log(
        JSON.stringify({
          decision: decision.decision,
          reason: decision.reason,
          userId: input.userId,
          organizationId: input.organizationId,
          permission: input.permission,
        }),
      );
      return decision;
    } catch (error) {
      const reason = error instanceof KeycloakUnavailableError ? 'keycloak_unavailable' : 'authorization_error';
      const decision: Decision = { decision: 'DENY', reason, permissions: [] };
      this.logger.warn(
        JSON.stringify({
          decision: 'DENY',
          reason,
          userId: input.userId,
          organizationId: input.organizationId,
          permission: input.permission,
          detail: error instanceof Error ? error.message : 'unknown',
        }),
      );
      await this.audit(input, decision);
      return decision;
    }
  }

  async hasCentralAuthority(userId: string): Promise<boolean> {
    const names = await this.iam.directClientRoleNames(userId);
    return names.includes('iam:central:approve');
  }

  private async effectivePermissions(userId: string, organizationId: string, fresh: boolean): Promise<Set<string>> {
    if (!fresh) {
      const cached = this.cache.get(userId, organizationId);
      if (cached) return cached;
    }
    const member = await this.iam.isMember(organizationId, userId);
    if (!member) {
      const empty = new Set<string>();
      if (!fresh) this.cache.set(userId, organizationId, empty);
      return empty;
    }
    const groups = await this.iam.memberGroups(organizationId, userId);
    const permissions = new Set<string>();
    for (const group of groups) {
      if (firstAttr(group.attributes, 'entity_type') !== 'POSITION') continue;
      const assignment = await this.loadAssignment(userId, group.id);
      if (isAssignmentInactive(assignment)) continue;
      const roles = await this.iam.compositeRoleNames(organizationId, group.id);
      for (const role of roles) permissions.add(role);
    }
    if (!fresh) this.cache.set(userId, organizationId, permissions);
    return permissions;
  }

  protected async loadAssignment(userId: string, positionGroupId: string) {
    return this.prisma.accessRequest.findFirst({
      where: {
        targetKeycloakId: userId,
        positionGroupId,
        status: { in: ['APPROVED', 'EXPIRED'] },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async evaluate(input: AuthorizeInput, permissions: Set<string>): Promise<Decision> {
    const list = [...permissions];
    const member = await this.iam.isMember(input.organizationId, input.userId);
    if (!member) return { decision: 'DENY', reason: 'not_member', permissions: list };
    if (input.budget) {
      if (input.budget.organizationId !== input.organizationId) {
        return { decision: 'DENY', reason: 'cross_organization', permissions: list };
      }
      const org = await this.iam.getOrganization(input.budget.organizationId);
      if (!org) return { decision: 'DENY', reason: 'organization_missing', permissions: list };
      const orgType = firstAttr(org.attributes, 'org_type');
      if (orgType && GOVERNMENT_ORG_TYPES.has(orgType)) {
        const actorIsPrivateOnly = await this.privateWithoutGovernmentMembership(
          input.userId,
          input.organizationId,
          orgType,
        );
        if (actorIsPrivateOnly) {
          return { decision: 'DENY', reason: 'private_government_boundary', permissions: list };
        }
      }
      const allowed = allowedStatuses(input.budget.action);
      if (allowed && !allowed.includes(input.budget.status)) {
        return { decision: 'DENY', reason: 'invalid_state', permissions: list };
      }
      if (input.budget.action === 'approve' && input.budget.creatorKeycloakId === input.userId) {
        return { decision: 'DENY', reason: 'self_approval', permissions: list };
      }
    }
    if (!permissions.has(input.permission)) {
      return { decision: 'DENY', reason: 'missing_permission', permissions: list };
    }
    return { decision: 'ALLOW', reason: 'allowed', permissions: list };
  }

  private async privateWithoutGovernmentMembership(
    userId: string,
    organizationId: string,
    documentOrgType: string,
  ): Promise<boolean> {
    if (!GOVERNMENT_ORG_TYPES.has(documentOrgType)) return false;
    const org = await this.iam.getOrganization(organizationId);
    const selectedType = firstAttr(org?.attributes, 'org_type');
    if (selectedType === 'PRIVATE') return true;
    const member = await this.iam.isMember(organizationId, userId);
    return !member;
  }

  private async audit(input: AuthorizeInput, decision: Decision): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          actorKeycloakId: input.userId,
          organizationId: input.organizationId,
          action: input.budget?.action || input.permission,
          permission: input.permission,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          decision: decision.decision,
          reason: decision.reason,
        },
      });
    } catch (error) {
      this.logger.warn(`audit write failed: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
}
