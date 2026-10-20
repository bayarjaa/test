export type BudgetStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'APPROVED' | 'RETURNED';

export type BudgetAction = 'create' | 'update' | 'submit' | 'review' | 'return' | 'approve' | 'read';

const ACTION_PERMISSION: Record<BudgetAction, string> = {
  create: 'budget:draft:create',
  update: 'budget:draft:update',
  submit: 'budget:draft:submit',
  review: 'budget:draft:review',
  return: 'budget:draft:return',
  approve: 'budget:draft:approve',
  read: 'budget:draft:read',
};

const ALLOWED_FROM: Record<Exclude<BudgetAction, 'create' | 'read'>, BudgetStatus[]> = {
  update: ['DRAFT', 'RETURNED'],
  submit: ['DRAFT'],
  review: ['SUBMITTED'],
  return: ['SUBMITTED', 'REVIEWED'],
  approve: ['REVIEWED'],
};

export function permissionFor(action: BudgetAction): string {
  return ACTION_PERMISSION[action];
}

export function allowedStatuses(action: BudgetAction): BudgetStatus[] | null {
  if (action === 'create' || action === 'read') return null;
  return ALLOWED_FROM[action];
}

export function nextBudgetStatus(status: BudgetStatus, action: BudgetAction): BudgetStatus | null {
  if (action === 'update') return status === 'RETURNED' ? 'DRAFT' : status === 'DRAFT' ? 'DRAFT' : null;
  if (action === 'submit' && status === 'DRAFT') return 'SUBMITTED';
  if (action === 'review' && status === 'SUBMITTED') return 'REVIEWED';
  if (action === 'return' && (status === 'SUBMITTED' || status === 'REVIEWED')) return 'RETURNED';
  if (action === 'approve' && status === 'REVIEWED') return 'APPROVED';
  return null;
}

export function isAssignmentInactive(
  record: { status: string; expiresAt: Date | null } | null,
  now = new Date(),
): boolean {
  if (!record) return false;
  if (record.status === 'EXPIRED') return true;
  if (record.status === 'APPROVED' && record.expiresAt && record.expiresAt.getTime() <= now.getTime()) {
    return true;
  }
  return false;
}

export function approverKind(riskLevel: string): 'central' | 'organization' {
  return riskLevel === 'HIGH' ? 'central' : 'organization';
}
