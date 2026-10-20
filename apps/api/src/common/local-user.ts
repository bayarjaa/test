import type { PrismaService } from '../prisma/prisma.service';

export function ensureLocalUser(prisma: PrismaService, keycloakId: string) {
  return prisma.user.upsert({
    where: { keycloakId },
    update: {},
    create: { keycloakId },
  });
}
