import { AuthorizationService } from './authorization.service';
import { IamGateway, KeycloakUnavailableError, type KcGroup, type KcOrg } from './iam.gateway';
import { PermissionCache } from './permission-cache';
import type { PrismaService } from '../prisma/prisma.service';

const prep = ['duty:budget-preparation', 'budget:draft:read', 'budget:draft:create', 'budget:draft:update', 'budget:draft:submit'];
const review = ['duty:budget-review', 'budget:draft:read', 'budget:draft:review', 'budget:draft:return'];
const approve = ['duty:budget-approval', 'budget:draft:read', 'budget:draft:approve'];

function group(id: string, roles: string[]): KcGroup {
  return { id, name: id, attributes: { entity_type: ['POSITION'], risk_level: ['LOW'] } };
}

class FakeIam extends IamGateway {
  members = new Set<string>();
  groups = new Map<string, Array<{ group: KcGroup; roles: string[] }>>();
  orgs = new Map<string, KcOrg>();
  down = false;

  isMember(organizationId: string, userId: string): Promise<boolean> {
    if (this.down) throw new KeycloakUnavailableError('down');
    return Promise.resolve(this.members.has(`${userId}:${organizationId}`));
  }

  memberGroups(organizationId: string, userId: string): Promise<KcGroup[]> {
    if (this.down) throw new KeycloakUnavailableError('down');
    return Promise.resolve((this.groups.get(`${userId}:${organizationId}`) || []).map((item) => item.group));
  }

  compositeRoleNames(_organizationId: string, groupId: string): Promise<string[]> {
    if (this.down) throw new KeycloakUnavailableError('down');
    for (const items of this.groups.values()) {
      const found = items.find((item) => item.group.id === groupId);
      if (found) return Promise.resolve(found.roles);
    }
    return Promise.resolve([]);
  }

  getOrganization(organizationId: string): Promise<KcOrg | null> {
    if (this.down) throw new KeycloakUnavailableError('down');
    return Promise.resolve(this.orgs.get(organizationId) || null);
  }

  directClientRoleNames(): Promise<string[]> {
    return Promise.resolve([]);
  }
}

function org(id: string, type: string): KcOrg {
  return { id, name: id, attributes: { org_type: [type], code: [id] } };
}

describe('organization-scoped authorization', () => {
  let iam: FakeIam;
  let assignments: Array<{ targetKeycloakId: string; positionGroupId: string; status: 'APPROVED' | 'EXPIRED'; expiresAt: Date | null; createdAt: Date }>;
  let audits: unknown[];
  let service: AuthorizationService;

  beforeEach(() => {
    iam = new FakeIam();
    assignments = [];
    audits = [];
    iam.orgs.set('mof', org('mof', 'CENTRAL_GOVERNMENT'));
    iam.orgs.set('moe', org('moe', 'GOVERNMENT'));
    iam.orgs.set('priv', org('priv', 'PRIVATE'));
    const prisma = {
      accessRequest: {
        findFirst: async ({ where }: { where: { targetKeycloakId: string; positionGroupId: string } }) => {
          return (
            assignments
              .filter((row) => row.targetKeycloakId === where.targetKeycloakId && row.positionGroupId === where.positionGroupId)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] || null
          );
        },
      },
      auditEvent: { create: async ({ data }: { data: unknown }) => audits.push(data) },
    };
    service = new AuthorizationService(iam, prisma as unknown as PrismaService, new PermissionCache());
  });

  function grant(user: string, organization: string, groupId: string, roles: string[]) {
    iam.members.add(`${user}:${organization}`);
    const key = `${user}:${organization}`;
    const current = iam.groups.get(key) || [];
    current.push({ group: group(groupId, roles), roles });
    iam.groups.set(key, current);
  }

  it('resolves membership and inherited duty permissions', async () => {
    grant('specialist', 'moe', 'spec', prep);
    const allowed = await service.authorize({
      userId: 'specialist',
      organizationId: 'moe',
      permission: 'budget:draft:create',
      fresh: true,
    });
    expect(allowed.decision).toBe('ALLOW');
    expect(allowed.permissions).toEqual(expect.arrayContaining(['duty:budget-preparation', 'budget:draft:submit']));
  });

  it('gives the same user different permissions in two organizations', async () => {
    grant('multi', 'mof', 'mof-spec', prep);
    grant('multi', 'priv', 'acc', prep);
    const mof = await service.authorize({ userId: 'multi', organizationId: 'mof', permission: 'budget:draft:submit', fresh: true });
    const moe = await service.authorize({ userId: 'multi', organizationId: 'moe', permission: 'budget:draft:read', fresh: true });
    expect(mof.decision).toBe('ALLOW');
    expect(moe.decision).toBe('DENY');
    expect(moe.reason).toBe('not_member');
  });

  it('denies a private user reading a government budget from another organization', async () => {
    grant('accountant', 'priv', 'acc', prep);
    const decision = await service.authorize({
      userId: 'accountant',
      organizationId: 'mof',
      permission: 'budget:draft:read',
      fresh: true,
      budget: { organizationId: 'mof', status: 'DRAFT', creatorKeycloakId: 'someone', action: 'read' },
    });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('not_member');
  });

  it('denies self-approval even when the user holds the approval duty', async () => {
    grant('director', 'moe', 'dir', approve);
    const decision = await service.authorize({
      userId: 'director',
      organizationId: 'moe',
      permission: 'budget:draft:approve',
      fresh: true,
      budget: { organizationId: 'moe', status: 'REVIEWED', creatorKeycloakId: 'director', action: 'approve' },
    });
    expect(decision).toMatchObject({ decision: 'DENY', reason: 'self_approval' });
  });

  it('allows a different approver and a reviewer to act on the matching state', async () => {
    grant('director', 'moe', 'dir', [...review, ...approve]);
    const reviewDecision = await service.authorize({
      userId: 'director',
      organizationId: 'moe',
      permission: 'budget:draft:review',
      fresh: true,
      budget: { organizationId: 'moe', status: 'SUBMITTED', creatorKeycloakId: 'specialist', action: 'review' },
    });
    const approveDecision = await service.authorize({
      userId: 'director',
      organizationId: 'moe',
      permission: 'budget:draft:approve',
      fresh: true,
      budget: { organizationId: 'moe', status: 'REVIEWED', creatorKeycloakId: 'specialist', action: 'approve' },
    });
    expect(reviewDecision.decision).toBe('ALLOW');
    expect(approveDecision.decision).toBe('ALLOW');
  });

  it('drops permissions after the position is revoked', async () => {
    grant('specialist', 'moe', 'spec', prep);
    iam.groups.set('specialist:moe', []);
    const decision = await service.authorize({
      userId: 'specialist',
      organizationId: 'moe',
      permission: 'budget:draft:create',
      fresh: true,
    });
    expect(decision).toMatchObject({ decision: 'DENY', reason: 'missing_permission' });
  });

  it('does not grant access from an expired position assignment', async () => {
    grant('specialist', 'moe', 'spec', prep);
    assignments.push({
      targetKeycloakId: 'specialist',
      positionGroupId: 'spec',
      status: 'EXPIRED',
      expiresAt: new Date(Date.now() - 1000),
      createdAt: new Date(),
    });
    const decision = await service.authorize({
      userId: 'specialist',
      organizationId: 'moe',
      permission: 'budget:draft:create',
      fresh: true,
    });
    expect(decision).toMatchObject({ decision: 'DENY', reason: 'missing_permission' });
  });

  it('denies a protected mutation when Keycloak cannot be reached', async () => {
    grant('specialist', 'moe', 'spec', prep);
    iam.down = true;
    const decision = await service.authorize({
      userId: 'specialist',
      organizationId: 'moe',
      permission: 'budget:draft:submit',
      fresh: true,
    });
    expect(decision).toMatchObject({ decision: 'DENY', reason: 'keycloak_unavailable' });
    expect(audits).toHaveLength(1);
  });
});
