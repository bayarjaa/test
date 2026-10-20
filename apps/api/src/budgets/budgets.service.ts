import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { assertAllowed } from '../common/assert-allowed';
import { ensureLocalUser } from '../common/local-user';
import { AuthorizationService } from '../iam/authorization.service';
import { nextBudgetStatus, permissionFor, type BudgetAction, type BudgetStatus } from '../iam/workflow';
import { PrismaService } from '../prisma/prisma.service';

interface LineInput {
  description: string;
  amount: number;
}

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthorizationService,
  ) {}

  async list(actorId: string, organizationId: string) {
    await this.permit(actorId, organizationId, 'read');
    const rows = await this.prisma.budgetDocument.findMany({
      where: { organizationId },
      include: { lines: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(present);
  }

  async get(actorId: string, id: string) {
    const doc = await this.require(id);
    await this.permit(actorId, doc.organizationId, 'read', doc);
    return present(await this.load(id));
  }

  async create(actorId: string, input: { organizationId: string; title: string; fiscalYear: number; lines: LineInput[] }) {
    await this.permit(actorId, input.organizationId, 'create');
    const user = await ensureLocalUser(this.prisma, actorId);
    const created = await this.prisma.budgetDocument.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        fiscalYear: input.fiscalYear,
        creatorId: user.id,
        creatorKeycloakId: actorId,
        lines: { create: input.lines.map(lineData) },
        history: {
          create: { toStatus: 'DRAFT', actorKeycloakId: actorId, comment: 'Ноорог үүсгэв' },
        },
      },
      include: { lines: true, history: true },
    });
    return present(created);
  }

  async update(
    actorId: string,
    id: string,
    input: { title?: string; fiscalYear?: number; lines?: LineInput[] },
  ) {
    const doc = await this.require(id);
    const next = nextBudgetStatus(doc.status, 'update');
    if (!next) throw new BadRequestException('invalid_state');
    await this.permit(actorId, doc.organizationId, 'update', doc);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.lines) {
        await tx.budgetLine.deleteMany({ where: { documentId: id } });
      }
      const changed = await tx.budgetDocument.updateMany({
        where: { id, status: doc.status },
        data: {
          title: input.title ?? doc.title,
          fiscalYear: input.fiscalYear ?? doc.fiscalYear,
          status: next,
        },
      });
      if (changed.count !== 1) throw new ConflictException('status_changed');
      if (input.lines) {
        await tx.budgetLine.createMany({ data: input.lines.map((line) => ({ documentId: id, ...lineData(line) })) });
      }
      if (next !== doc.status) {
        await tx.budgetWorkflowHistory.create({
          data: {
            documentId: id,
            fromStatus: doc.status,
            toStatus: next,
            actorKeycloakId: actorId,
            comment: 'Ноорог болгон зассан',
          },
        });
      }
      return tx.budgetDocument.findUniqueOrThrow({ where: { id }, include: { lines: true, history: true } });
    });
    return present(updated);
  }

  submit(actorId: string, id: string, comment?: string) {
    return this.transition(actorId, id, 'submit', comment);
  }

  review(actorId: string, id: string, comment?: string) {
    return this.transition(actorId, id, 'review', comment);
  }

  approve(actorId: string, id: string, comment?: string) {
    return this.transition(actorId, id, 'approve', comment);
  }

  returnToDraft(actorId: string, id: string, comment?: string) {
    return this.transition(actorId, id, 'return', comment);
  }

  private async transition(actorId: string, id: string, action: Exclude<BudgetAction, 'create' | 'read' | 'update'>, comment?: string) {
    const doc = await this.require(id);
    const next = nextBudgetStatus(doc.status, action);
    if (!next) throw new BadRequestException('invalid_state');
    await this.permit(actorId, doc.organizationId, action, doc);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.budgetDocument.updateMany({
        where: { id, status: doc.status },
        data: { status: next },
      });
      if (changed.count !== 1) throw new ConflictException('status_changed');
      await tx.budgetWorkflowHistory.create({
        data: {
          documentId: id,
          fromStatus: doc.status,
          toStatus: next,
          actorKeycloakId: actorId,
          comment,
        },
      });
      return tx.budgetDocument.findUniqueOrThrow({ where: { id }, include: { lines: true, history: true } });
    });
    return present(updated);
  }

  private async permit(
    actorId: string,
    organizationId: string,
    action: BudgetAction,
    doc?: { organizationId: string; status: BudgetStatus; creatorKeycloakId: string; id?: string },
  ) {
    const decision = await this.authz.authorize({
      userId: actorId,
      organizationId,
      permission: permissionFor(action),
      fresh: action !== 'read',
      resourceType: 'budget',
      resourceId: doc?.id,
      budget: doc
        ? {
            organizationId: doc.organizationId,
            status: doc.status,
            creatorKeycloakId: doc.creatorKeycloakId,
            action,
          }
        : undefined,
    });
    assertAllowed(decision);
  }

  private async require(id: string) {
    const doc = await this.prisma.budgetDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('budget_not_found');
    return doc;
  }

  private load(id: string) {
    return this.prisma.budgetDocument.findUniqueOrThrow({
      where: { id },
      include: { lines: true, history: { orderBy: { createdAt: 'asc' } } },
    });
  }
}

function lineData(line: LineInput) {
  return { description: line.description, amount: new Prisma.Decimal(line.amount) };
}

function present(doc: {
  id: string;
  organizationId: string;
  title: string;
  fiscalYear: number;
  status: string;
  creatorKeycloakId: string;
  createdAt: Date;
  updatedAt: Date;
  lines: Array<{ id: string; description: string; amount: Prisma.Decimal }>;
  history?: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    actorKeycloakId: string;
    comment: string | null;
    createdAt: Date;
  }>;
}) {
  return {
    ...doc,
    lines: doc.lines.map((line) => ({ ...line, amount: line.amount.toString() })),
  };
}
