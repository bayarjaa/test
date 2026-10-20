import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IamGateway,
  KeycloakUnavailableError,
  type KcGroup,
  type KcOrg,
  type KcRole,
  type KcUser,
} from './iam.gateway';

interface TokenCache {
  value: string;
  exp: number;
}

@Injectable()
export class KeycloakAdminService extends IamGateway {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private token: TokenCache | null = null;
  private apiClientId: string | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  private internalUrl(): string {
    return (this.config.get<string>('KEYCLOAK_INTERNAL_URL') || 'http://localhost:8080').replace(/\/$/, '');
  }

  private realm(): string {
    return this.config.get<string>('KEYCLOAK_REALM') || 'budget-management';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.exp > Date.now() + 15_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.get<string>('KEYCLOAK_CLIENT_ID') || 'budget-iam-admin',
      client_secret: this.config.get<string>('KEYCLOAK_CLIENT_SECRET') || '',
    });
    let response: Response;
    try {
      response = await fetch(`${this.internalUrl()}/realms/${this.realm()}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KeycloakUnavailableError(error instanceof Error ? error.message : 'token request failed');
    }
    if (!response.ok) {
      throw new KeycloakUnavailableError(`token endpoint returned ${response.status}`);
    }
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    expected: number[] = [200, 201, 204],
  ): Promise<{ status: number; body: T | null; location: string | null }> {
    const token = await this.accessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let response: Response;
    try {
      response = await fetch(`${this.internalUrl()}/admin/realms/${this.realm()}${path}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new KeycloakUnavailableError(error instanceof Error ? error.message : 'admin request failed');
    }
    if (response.status === 401) {
      this.token = null;
      throw new KeycloakUnavailableError('admin token rejected');
    }
    const text = await response.text();
    let parsed: T | null = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as T;
      } catch {
        parsed = text as T;
      }
    }
    if (!expected.includes(response.status)) {
      this.logger.warn(`${method} ${path} -> ${response.status}`);
      const error = new Error(`${method} ${path} -> ${response.status} ${text.slice(0, 400)}`);
      (error as Error & { status: number }).status = response.status;
      throw error;
    }
    return { status: response.status, body: parsed, location: response.headers.get('location') };
  }

  private async apiClientUuid(): Promise<string> {
    if (this.apiClientId) return this.apiClientId;
    const audience = this.config.get<string>('KEYCLOAK_AUDIENCE') || 'budget-api';
    const { body } = await this.request<Array<{ id: string; clientId: string }>>(
      'GET',
      `/clients?clientId=${encodeURIComponent(audience)}`,
    );
    const client = (body || []).find((item) => item.clientId === audience);
    if (!client) throw new KeycloakUnavailableError('budget-api client was not found');
    this.apiClientId = client.id;
    return client.id;
  }

  async isMember(organizationId: string, userId: string): Promise<boolean> {
    try {
      await this.request('GET', `/organizations/${organizationId}/members/${userId}`, undefined, [200]);
      return true;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return false;
      throw this.wrap(error);
    }
  }

  async memberGroups(organizationId: string, userId: string): Promise<KcGroup[]> {
    try {
      const { body } = await this.request<KcGroup[]>(
        'GET',
        `/organizations/${organizationId}/members/${userId}/groups?briefRepresentation=false&max=100`,
        undefined,
        [200],
      );
      const groups = body || [];
      const hydrated: KcGroup[] = [];
      for (const group of groups) {
        if (group.attributes && Object.keys(group.attributes).length > 0) {
          hydrated.push(group);
          continue;
        }
        const full = await this.getGroup(organizationId, group.id);
        hydrated.push(full || group);
      }
      return hydrated;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return [];
      throw this.wrap(error);
    }
  }

  async compositeRoleNames(organizationId: string, groupId: string): Promise<string[]> {
    const clientId = await this.apiClientUuid();
    const { body } = await this.request<Array<{ name: string }>>(
      'GET',
      `/organizations/${organizationId}/groups/${groupId}/role-mappings/clients/${clientId}/composite`,
    );
    return (body || []).map((role) => role.name);
  }

  async directRoleMappings(organizationId: string, groupId: string): Promise<KcRole[]> {
    const clientId = await this.apiClientUuid();
    const { body } = await this.request<KcRole[]>(
      'GET',
      `/organizations/${organizationId}/groups/${groupId}/role-mappings/clients/${clientId}`,
    );
    return body || [];
  }

  async getOrganization(organizationId: string): Promise<KcOrg | null> {
    try {
      const { body } = await this.request<KcOrg>('GET', `/organizations/${organizationId}`);
      return body;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw this.wrap(error);
    }
  }

  async directClientRoleNames(userId: string): Promise<string[]> {
    const clientId = await this.apiClientUuid();
    const { body } = await this.request<Array<{ name: string }>>(
      'GET',
      `/users/${userId}/role-mappings/clients/${clientId}`,
    );
    return (body || []).map((role) => role.name);
  }

  async listOrganizations(): Promise<KcOrg[]> {
    const { body } = await this.request<KcOrg[]>('GET', '/organizations?briefRepresentation=false&max=200');
    return body || [];
  }

  async createOrganization(input: {
    name: string;
    alias: string;
    code: string;
    orgType: string;
    domain: string;
    parentOrganizationId?: string;
  }): Promise<KcOrg> {
    const attributes: Record<string, string[]> = {
      code: [input.code],
      org_type: [input.orgType],
    };
    if (input.parentOrganizationId) attributes.parent_organization_id = [input.parentOrganizationId];
    const created = await this.request(
      'POST',
      '/organizations',
      {
        name: input.name,
        alias: input.alias,
        enabled: true,
        domains: [{ name: input.domain, verified: false }],
        attributes,
      },
      [201],
    );
    const id = created.location?.split('/').filter(Boolean).pop();
    if (!id) throw new Error('organization create did not return an id');
    const org = await this.getOrganization(decodeURIComponent(id));
    if (!org) throw new Error('created organization was not readable');
    return org;
  }

  async updateOrganization(
    id: string,
    patch: { name?: string; code?: string; orgType?: string; parentOrganizationId?: string | null },
  ): Promise<KcOrg> {
    const current = await this.getOrganization(id);
    if (!current) throw Object.assign(new Error('organization not found'), { status: 404 });
    const attributes = { ...(current.attributes || {}) };
    if (patch.code) attributes.code = [patch.code];
    if (patch.orgType) attributes.org_type = [patch.orgType];
    if (patch.parentOrganizationId !== undefined) {
      attributes.parent_organization_id = patch.parentOrganizationId ? [patch.parentOrganizationId] : [];
    }
    await this.request('PUT', `/organizations/${id}`, {
      ...current,
      name: patch.name || current.name,
      attributes,
    });
    const updated = await this.getOrganization(id);
    if (!updated) throw new Error('updated organization was not readable');
    return updated;
  }

  async listGroups(organizationId: string): Promise<KcGroup[]> {
    const { body } = await this.request<KcGroup[]>(
      'GET',
      `/organizations/${organizationId}/groups?briefRepresentation=false&populateHierarchy=true&max=200`,
    );
    return body || [];
  }

  async listChildren(organizationId: string, groupId: string): Promise<KcGroup[]> {
    const { body } = await this.request<KcGroup[]>(
      'GET',
      `/organizations/${organizationId}/groups/${groupId}/children?max=100`,
    );
    const children = body || [];
    const hydrated: KcGroup[] = [];
    for (const child of children) {
      const full = await this.getGroup(organizationId, child.id);
      hydrated.push(full || child);
    }
    return hydrated;
  }

  async getGroup(organizationId: string, groupId: string): Promise<KcGroup | null> {
    try {
      const { body } = await this.request<KcGroup>('GET', `/organizations/${organizationId}/groups/${groupId}`);
      return body;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw this.wrap(error);
    }
  }

  async createGroup(
    organizationId: string,
    parentId: string | null,
    name: string,
    attributes: Record<string, string[]>,
  ): Promise<KcGroup> {
    const path = parentId
      ? `/organizations/${organizationId}/groups/${parentId}/children`
      : `/organizations/${organizationId}/groups`;
    const created = await this.request('POST', path, { name }, [201]);
    const id = created.location?.split('/').filter(Boolean).pop();
    if (!id) throw new Error('group create did not return an id');
    const groupId = decodeURIComponent(id);
    await this.request('PUT', `/organizations/${organizationId}/groups/${groupId}`, {
      name,
      attributes,
    });
    const group = await this.getGroup(organizationId, groupId);
    if (!group) throw new Error('created group was not readable');
    return group;
  }

  async updateGroup(
    organizationId: string,
    groupId: string,
    name: string,
    attributes: Record<string, string[]>,
  ): Promise<KcGroup> {
    await this.request('PUT', `/organizations/${organizationId}/groups/${groupId}`, { name, attributes });
    const group = await this.getGroup(organizationId, groupId);
    if (!group) throw new Error('updated group was not readable');
    return group;
  }

  async listClientRoles(): Promise<KcRole[]> {
    const clientId = await this.apiClientUuid();
    const { body } = await this.request<KcRole[]>('GET', `/clients/${clientId}/roles`);
    return body || [];
  }

  async roleComposites(roleName: string): Promise<KcRole[]> {
    const clientId = await this.apiClientUuid();
    const { body } = await this.request<KcRole[]>(
      'GET',
      `/clients/${clientId}/roles/${encodeURIComponent(roleName)}/composites`,
    );
    return body || [];
  }

  async findClientRole(roleName: string): Promise<KcRole | null> {
    const clientId = await this.apiClientUuid();
    try {
      const { body } = await this.request<KcRole>(
        'GET',
        `/clients/${clientId}/roles/${encodeURIComponent(roleName)}`,
      );
      return body;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw this.wrap(error);
    }
  }

  async addGroupClientRoles(organizationId: string, groupId: string, roles: KcRole[]): Promise<void> {
    if (!roles.length) return;
    const clientId = await this.apiClientUuid();
    await this.request(
      'POST',
      `/organizations/${organizationId}/groups/${groupId}/role-mappings/clients/${clientId}`,
      roles.map((role) => ({ id: role.id, name: role.name })),
    );
  }

  async removeGroupClientRoles(organizationId: string, groupId: string, roles: KcRole[]): Promise<void> {
    if (!roles.length) return;
    const clientId = await this.apiClientUuid();
    await this.request(
      'DELETE',
      `/organizations/${organizationId}/groups/${groupId}/role-mappings/clients/${clientId}`,
      roles.map((role) => ({ id: role.id, name: role.name })),
    );
  }

  async countUsers(): Promise<number> {
    const { body } = await this.request<number>('GET', '/users/count');
    return typeof body === 'number' ? body : Number(body) || 0;
  }

  async searchUsers(search: string): Promise<KcUser[]> {
    const query = search ? `search=${encodeURIComponent(search)}&max=30` : 'max=30';
    const { body } = await this.request<KcUser[]>('GET', `/users?${query}`);
    return (body || []).filter((user) => user.username && !user.username.startsWith('service-account-'));
  }

  async getUser(userId: string): Promise<KcUser | null> {
    try {
      const { body } = await this.request<KcUser>('GET', `/users/${userId}`);
      return body;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw this.wrap(error);
    }
  }

  async organizationsForMember(userId: string): Promise<KcOrg[]> {
    try {
      const { body } = await this.request<KcOrg[]>(
        'GET',
        `/organizations/members/${userId}/organizations?briefRepresentation=false`,
        undefined,
        [200],
      );
      return body || [];
    } catch (error) {
      if ((error as { status?: number }).status === 404) return [];
      throw this.wrap(error);
    }
  }

  async addOrganizationMember(organizationId: string, userId: string): Promise<void> {
    await this.request('POST', `/organizations/${organizationId}/members`, userId, [201, 409]);
  }

  async addGroupMember(organizationId: string, groupId: string, userId: string): Promise<void> {
    await this.request('PUT', `/organizations/${organizationId}/groups/${groupId}/members/${userId}`, undefined, [
      204,
      409,
    ]);
  }

  async removeGroupMember(organizationId: string, groupId: string, userId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/organizations/${organizationId}/groups/${groupId}/members/${userId}`,
      undefined,
      [204, 404],
    );
  }

  private wrap(error: unknown): Error {
    if (error instanceof KeycloakUnavailableError) return error;
    if (error instanceof Error && /fetch failed|ECONNREFUSED|AbortError|network/i.test(error.message)) {
      return new KeycloakUnavailableError(error.message);
    }
    return error instanceof Error ? error : new Error('keycloak error');
  }
}
