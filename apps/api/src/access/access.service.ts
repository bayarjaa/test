import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { assertAllowed } from '../common/assert-allowed';
import { ensureLocalUser } from '../common/local-user';
import { AuthorizationService } from '../iam/authorization.service';
import { firstAttr } from '../iam/catalog';
import { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { KeycloakUnavailableError } from '../iam/iam.gateway';
import { PermissionCache } from '../iam/permission-cache';
import { approverKind } from '../iam/workflow';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AccessService {
  private readonly logger = new Logger(AccessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kc: KeycloakAdminService,
    private readonly authz: AuthorizationService,
    private readonly cache: PermissionCache,
  ) {}

  async create(
    actorId: string,
    input: { organizationId: string; positionGroupId: string; targetKeycloakId: string; expiresAt?: string; comment?: string },
  ) {
    const central = await this.authz.hasCentralAuthority(actorId);
    if (!central) {
      const invite = await this.authz.authorize({
        userId: actorId,
        organizationId: input.organizationId,
        permission: 'iam:user:invite',
        fresh: true,
        resourceType: 'access-request',
      });
      if (invite.decision === 'DENY') {
        const assign = await this.authz.authorize({
          userId: actorId,
          organizationId: input.organizationId,
          permission: 'iam:position:assign',
          fresh: true,
          resourceType: 'access-request',
        });
        assertAllowed(assign);
      }
    }
    const group = await this.kc.getGroup(input.organizationId, input.positionGroupId);
    if (!group || firstAttr(group.attributes, 'entity_type') !== 'POSITION') {
      throw new BadRequestException('position_not_found');
    }
    const target = await this.kc.getUser(input.targetKeycloakId);
    if (!target) throw new NotFoundException('user_not_found');
    const requester = await ensureLocalUser(this.prisma, actorId);
    return this.prisma.accessRequest.create({
      data: {
        organizationId: input.organizationId,
        positionGroupId: input.positionGroupId,
        targetKeycloakId: input.targetKeycloakId,
        requesterId: requester.id,
        riskLevel: firstAttr(group.attributes, 'risk_level') || 'LOW',
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        comment: input.comment,
      },
    });
  }

  list(organizationId?: string) {
    return this.prisma.accessRequest.findMany({
      where: organizationId ? { organizationId } : undefined,
      include: { approvals: true, requester: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approve(actorId: string, requestId: string, comment?: string) {
    const request = await this.requirePending(requestId);
    await this.assertCanDecide(actorId, request.organizationId, request.riskLevel);
    const approver = await ensureLocalUser(this.prisma, actorId);
    try {
      await this.kc.addOrganizationMember(request.organizationId, request.targetKeycloakId);
      await this.kc.addGroupMember(request.organizationId, request.positionGroupId, request.targetKeycloakId);
    } catch (error) {
      if (error instanceof KeycloakUnavailableError) {
        throw new ForbiddenException('keycloak_unavailable');
      }
      throw error;
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.accessRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'APPROVED' },
      });
      if (changed.count !== 1) throw new BadRequestException('request_not_pending');
      await tx.accessApproval.create({
        data: { requestId, approverId: approver.id, decision: 'APPROVED', comment },
      });
      return tx.accessRequest.findUnique({ where: { id: requestId }, include: { approvals: true } });
    });
    this.cache.invalidate(request.targetKeycloakId);
    return updated;
  }

  async reject(actorId: string, requestId: string, comment?: string) {
    const request = await this.requirePending(requestId);
    await this.assertCanDecide(actorId, request.organizationId, request.riskLevel);
    const approver = await ensureLocalUser(this.prisma, actorId);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.accessRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });
      if (changed.count !== 1) throw new BadRequestException('request_not_pending');
      await tx.accessApproval.create({
        data: { requestId, approverId: approver.id, decision: 'REJECTED', comment },
      });
      return tx.accessRequest.findUnique({ where: { id: requestId }, include: { approvals: true } });
    });
  }

  @Interval(60_000)
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.accessRequest.findMany({
      where: { status: 'APPROVED', expiresAt: { lt: now } },
    });
    let expired = 0;
    for (const request of due) {
      try {
        await this.kc.removeGroupMember(request.organizationId, request.positionGroupId, request.targetKeycloakId);
        await this.prisma.accessRequest.update({ where: { id: request.id }, data: { status: 'EXPIRED' } });
        this.cache.invalidate(request.targetKeycloakId);
        expired += 1;
      } catch (error) {
        this.logger.warn(
          `expiry failed for ${request.id}: ${error instanceof Error ? error.message : 'unknown'}`,
        );
      }
    }
    return expired;
  }

  private async requirePending(id: string) {
    const request = await this.prisma.accessRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('request_not_found');
    if (request.status !== 'PENDING') throw new BadRequestException('request_not_pending');
    return request;
  }

  private async assertCanDecide(actorId: string, organizationId: string, riskLevel: string) {
    if (approverKind(riskLevel) === 'central') {
      if (!(await this.authz.hasCentralAuthority(actorId))) {
        throw new ForbiddenException('central_authority_required');
      }
      return;
    }
    const decision = await this.authz.authorize({
      userId: actorId,
      organizationId,
      permission: 'iam:position:assign',
      fresh: true,
      resourceType: 'access-request',
    });
    assertAllowed(decision);
  }
}
