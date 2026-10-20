export interface KcAttributes {
  attributes?: Record<string, string[]>;
}

export interface KcGroup extends KcAttributes {
  id: string;
  name: string;
  path?: string;
  subGroups?: KcGroup[];
}

export interface KcOrg extends KcAttributes {
  id: string;
  name: string;
  alias?: string;
  enabled?: boolean;
  domains?: Array<{ name: string; verified?: boolean }>;
}

export interface KcRole {
  id: string;
  name: string;
  composite?: boolean;
  description?: string;
}

export interface KcUser {
  id: string;
  username?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
}

export abstract class IamGateway {
  abstract isMember(organizationId: string, userId: string): Promise<boolean>;
  abstract memberGroups(organizationId: string, userId: string): Promise<KcGroup[]>;
  abstract compositeRoleNames(organizationId: string, groupId: string): Promise<string[]>;
  abstract getOrganization(organizationId: string): Promise<KcOrg | null>;
  abstract directClientRoleNames(userId: string): Promise<string[]>;
}

export class KeycloakUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeycloakUnavailableError';
  }
}
