import { isAssignmentInactive, nextBudgetStatus } from './workflow';

describe('budget workflow', () => {
  it('creates a draft path through review to approval', () => {
    expect(nextBudgetStatus('DRAFT', 'submit')).toBe('SUBMITTED');
    expect(nextBudgetStatus('SUBMITTED', 'review')).toBe('REVIEWED');
    expect(nextBudgetStatus('REVIEWED', 'approve')).toBe('APPROVED');
  });

  it('returns a submitted or reviewed document and reopens a returned draft', () => {
    expect(nextBudgetStatus('SUBMITTED', 'return')).toBe('RETURNED');
    expect(nextBudgetStatus('REVIEWED', 'return')).toBe('RETURNED');
    expect(nextBudgetStatus('RETURNED', 'update')).toBe('DRAFT');
    expect(nextBudgetStatus('DRAFT', 'approve')).toBeNull();
    expect(nextBudgetStatus('APPROVED', 'update')).toBeNull();
  });

  it('treats an expired assignment as inactive and a seed membership as active', () => {
    expect(isAssignmentInactive(null)).toBe(false);
    expect(isAssignmentInactive({ status: 'APPROVED', expiresAt: null })).toBe(false);
    expect(isAssignmentInactive({ status: 'EXPIRED', expiresAt: null })).toBe(true);
    expect(
      isAssignmentInactive({ status: 'APPROVED', expiresAt: new Date(Date.now() - 1000) }),
    ).toBe(true);
  });
});
