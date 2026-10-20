import { Injectable } from '@nestjs/common';

interface CacheEntry {
  expiresAt: number;
  permissions: Set<string>;
}

@Injectable()
export class PermissionCache {
  private readonly entries = new Map<string, CacheEntry>();
  readonly ttlMs = 15_000;

  get(userId: string, organizationId: string): Set<string> | null {
    const key = `${userId}:${organizationId}`;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.permissions;
  }

  set(userId: string, organizationId: string, permissions: Set<string>): void {
    this.entries.set(`${userId}:${organizationId}`, {
      expiresAt: Date.now() + this.ttlMs,
      permissions,
    });
  }

  invalidate(userId?: string): void {
    if (!userId) {
      this.entries.clear();
      return;
    }
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${userId}:`)) this.entries.delete(key);
    }
  }
}
