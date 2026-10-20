import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kc: KeycloakAdminService,
    private readonly orgs: OrganizationsService,
  ) {}

  @Get()
  async summary() {
    const orgs = await this.kc.listOrganizations();
    let positions = 0;
    for (const org of orgs) {
      positions += (await this.orgs.positions(org.id)).length;
    }
    const [users, documents, pendingBudgets, pendingRequests, recent] = await Promise.all([
      this.kc.countUsers(),
      this.prisma.budgetDocument.count(),
      this.prisma.budgetDocument.count({ where: { status: { in: ['SUBMITTED', 'REVIEWED'] } } }),
      this.prisma.accessRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 8 }),
    ]);
    return {
      organizations: orgs.length,
      users,
      positions,
      budgetDocuments: documents,
      pendingApprovals: pendingBudgets + pendingRequests,
      recent,
    };
  }
}
