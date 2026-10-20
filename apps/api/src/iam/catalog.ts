export const ATOMIC_PERMISSIONS = [
  'budget:draft:read',
  'budget:draft:create',
  'budget:draft:update',
  'budget:draft:submit',
  'budget:draft:review',
  'budget:draft:return',
  'budget:draft:approve',
  'budget:report:read',
  'iam:user:invite',
  'iam:position:assign',
  'iam:position:revoke',
  'iam:central:approve',
] as const;

export type AtomicPermission = (typeof ATOMIC_PERMISSIONS)[number];

export const GOVERNMENT_ORG_TYPES = new Set(['GOVERNMENT', 'CENTRAL_GOVERNMENT']);

export function firstAttr(
  attributes: Record<string, string[]> | undefined,
  key: string,
): string | undefined {
  return attributes?.[key]?.[0];
}

export function isDuty(roleName: string): boolean {
  return roleName.startsWith('duty:');
}
