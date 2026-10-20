import { ForbiddenException } from '@nestjs/common';
import type { Decision } from '../iam/authorization.service';

export function assertAllowed(decision: Decision): void {
  if (decision.decision === 'DENY') {
    throw new ForbiddenException(decision.reason);
  }
}
