/**
 * Idempotent Keycloak 26.8 seed for the budget-management realm.
 * Uses the Admin REST API. Organization groups are not realm groups.
 */
const base = (process.env.KEYCLOAK_URL || 'http://localhost:8080').replace(/\/$/, '');
const adminUser = process.env.KEYCLOAK_ADMIN || 'admin';
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || 'admin';
const realm = process.env.KEYCLOAK_REALM || 'budget-management';
const demoPassword = process.env.DEMO_USER_PASSWORD || 'ChangeMe123!';
const iamSecret = process.env.IAM_ADMIN_CLIENT_SECRET || 'budget-iam-admin-dev-secret';
const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';

const ATOMIC = [
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
];

const DUTIES = {
  'duty:budget-preparation': [
    'budget:draft:read',
    'budget:draft:create',
    'budget:draft:update',
    'budget:draft:submit',
  ],
  'duty:budget-review': ['budget:draft:read', 'budget:draft:review', 'budget:draft:return'],
  'duty:budget-approval': ['budget:draft:read', 'budget:draft:approve'],
  'duty:budget-reporting': ['budget:report:read'],
  'duty:iam-administration': ['iam:user:invite', 'iam:position:assign', 'iam:position:revoke'],
};

const SERVICE_ACCOUNT_ROLES = [
  'manage-realm',
  'view-realm',
  'manage-users',
  'view-users',
  'query-users',
  'query-groups',
  'view-clients',
  'query-clients',
  'manage-clients',
];

let tokenCache = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function adminToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 10_000) return tokenCache.value;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: adminUser,
    password: adminPassword,
  });
  const res = await fetch(`${base}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`admin token ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  tokenCache = { value: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function kc(method, path, body, expected = [200, 201, 204]) {
  const token = await adminToken();
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? JSON.stringify(body) : JSON.stringify(body);
  }
  const res = await fetch(`${base}/admin/realms/${realm}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!expected.includes(res.status)) {
    const error = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 800)}`);
    error.status = res.status;
    throw error;
  }
  return { status: res.status, body: parsed, location: res.headers.get('location') };
}

async function master(method, path, body, expected = [200, 201, 204]) {
  const token = await adminToken();
  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  if (!expected.includes(res.status)) {
    throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 800)}`);
  }
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed };
}

function idFromLocation(location) {
  if (!location) return null;
  const parts = location.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1]);
}

async function waitForKeycloak() {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      await adminToken();
      console.log('Keycloak admin token acquired');
      return;
    } catch (error) {
      console.log(`waiting for Keycloak (${attempt}): ${error.message}`);
      tokenCache = null;
      await sleep(3000);
    }
  }
  throw new Error('Keycloak did not become ready');
}

async function ensureRealm() {
  const existing = await master('GET', `/admin/realms/${realm}`, undefined, [200, 404]);
  if (existing.status === 404) {
    await master('POST', '/admin/realms', {
      realm,
      enabled: true,
      displayName: 'Budget Management',
      organizationsEnabled: true,
      loginWithEmailAllowed: true,
      duplicateEmailsAllowed: false,
    });
    console.log(`created realm ${realm}`);
  } else {
    const current = existing.body;
    current.organizationsEnabled = true;
    current.enabled = true;
    await master('PUT', `/admin/realms/${realm}`, current);
    console.log(`realm ${realm} already present; organizations enabled`);
  }
}

async function findClient(clientId) {
  const { body } = await kc('GET', `/clients?clientId=${encodeURIComponent(clientId)}`);
  return Array.isArray(body) ? body.find((client) => client.clientId === clientId) : null;
}

async function ensureClient(representation) {
  const existing = await findClient(representation.clientId);
  if (!existing) {
    const created = await kc('POST', '/clients', representation);
    const id = idFromLocation(created.location);
    console.log(`created client ${representation.clientId}`);
    return (await kc('GET', `/clients/${id}`)).body;
  }
  await kc('PUT', `/clients/${existing.id}`, { ...existing, ...representation, id: existing.id });
  console.log(`updated client ${representation.clientId}`);
  return (await kc('GET', `/clients/${existing.id}`)).body;
}

async function ensureAudienceMapper(webClientId) {
  const { body: mappers } = await kc('GET', `/clients/${webClientId}/protocol-mappers/models`);
  if (mappers.some((mapper) => mapper.name === 'budget-api-audience')) return;
  await kc('POST', `/clients/${webClientId}/protocol-mappers/models`, {
    name: 'budget-api-audience',
    protocol: 'openid-connect',
    protocolMapper: 'oidc-audience-mapper',
    config: {
      'included.client.audience': 'budget-api',
      'id.token.claim': 'false',
      'access.token.claim': 'true',
    },
  });
  console.log('added budget-api audience mapper');
}

async function ensureRole(clientUuid, name, description, composite = false) {
  try {
    return (await kc('GET', `/clients/${clientUuid}/roles/${encodeURIComponent(name)}`)).body;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await kc('POST', `/clients/${clientUuid}/roles`, { name, description, composite });
  return (await kc('GET', `/clients/${clientUuid}/roles/${encodeURIComponent(name)}`)).body;
}

async function ensureComposites(clientUuid, roleByName) {
  for (const [duty, children] of Object.entries(DUTIES)) {
    const current = await kc(
      'GET',
      `/clients/${clientUuid}/roles/${encodeURIComponent(duty)}/composites`,
    );
    const have = new Set((current.body || []).map((role) => role.name));
    const missing = children.filter((name) => !have.has(name)).map((name) => roleByName[name]);
    if (missing.length) {
      await kc('POST', `/clients/${clientUuid}/roles/${encodeURIComponent(duty)}/composites`, missing);
    }
  }
}

async function ensureServiceAccount(client) {
  const sa = (await kc('GET', `/clients/${client.id}/service-account-user`)).body;
  const realmMgmt = await findClient('realm-management');
  if (!realmMgmt) throw new Error('realm-management client missing');
  const roles = [];
  for (const name of SERVICE_ACCOUNT_ROLES) {
    roles.push((await kc('GET', `/clients/${realmMgmt.id}/roles/${name}`)).body);
  }
  const assigned = await kc('GET', `/users/${sa.id}/role-mappings/clients/${realmMgmt.id}`);
  const have = new Set((assigned.body || []).map((role) => role.name));
  const missing = roles.filter((role) => !have.has(role.name));
  if (missing.length) {
    await kc('POST', `/users/${sa.id}/role-mappings/clients/${realmMgmt.id}`, missing);
  }
  console.log('service account roles ensured');
}

async function listOrganizations() {
  const { body } = await kc('GET', '/organizations?max=100');
  return body || [];
}

async function ensureOrganization(spec) {
  const all = await listOrganizations();
  let org = all.find((item) => item.alias === spec.alias);
  const attributes = {
    code: [spec.code],
    org_type: [spec.orgType],
  };
  if (spec.parentOrganizationId) attributes.parent_organization_id = [spec.parentOrganizationId];
  if (!org) {
    const created = await kc('POST', '/organizations', {
      name: spec.name,
      alias: spec.alias,
      enabled: true,
      domains: [{ name: spec.domain, verified: true }],
      attributes,
    });
    const id = idFromLocation(created.location);
    org = (await kc('GET', `/organizations/${id}`)).body;
    console.log(`created organization ${spec.code}`);
  } else {
    await kc('PUT', `/organizations/${org.id}`, {
      ...org,
      name: spec.name,
      enabled: true,
      domains: org.domains?.length ? org.domains : [{ name: spec.domain, verified: true }],
      attributes: { ...(org.attributes || {}), ...attributes },
    });
    org = (await kc('GET', `/organizations/${org.id}`)).body;
    console.log(`updated organization ${spec.code}`);
  }
  return org;
}

async function organizationGroups(orgId) {
  const { body } = await kc(
    'GET',
    `/organizations/${orgId}/groups?briefRepresentation=false&populateHierarchy=true&max=200`,
  );
  return body || [];
}

async function groupCandidates(orgId, parentId) {
  if (!parentId) return organizationGroups(orgId);
  const { body } = await kc('GET', `/organizations/${orgId}/groups/${parentId}/children?max=100`);
  return body || [];
}

async function ensureGroup(orgId, parentId, spec) {
  const code = spec.attributes.position_code?.[0] || spec.attributes.department_code?.[0];
  let found = (await groupCandidates(orgId, parentId)).find((group) => {
    const groupCode = group.attributes?.position_code?.[0] || group.attributes?.department_code?.[0];
    return group.name === spec.name || (code && groupCode === code);
  });
  if (!found) {
    const path = parentId
      ? `/organizations/${orgId}/groups/${parentId}/children`
      : `/organizations/${orgId}/groups`;
    try {
      const created = await kc('POST', path, { name: spec.name });
      const id = idFromLocation(created.location);
      found = (await kc('GET', `/organizations/${orgId}/groups/${id}`)).body;
      console.log(`created group ${spec.name}`);
    } catch (error) {
      if (error.status !== 409) throw error;
      found = (await groupCandidates(orgId, parentId)).find((group) => group.name === spec.name);
      if (!found) throw error;
      console.log(`reused group ${spec.name}`);
    }
  }
  await kc('PUT', `/organizations/${orgId}/groups/${found.id}`, {
    id: found.id,
    name: spec.name,
    attributes: spec.attributes,
  });
  return (await kc('GET', `/organizations/${orgId}/groups/${found.id}`)).body;
}

async function mapRoles(orgId, groupId, clientUuid, roles) {
  const current = await kc('GET', `/organizations/${orgId}/groups/${groupId}/role-mappings/clients/${clientUuid}`);
  const have = new Set((current.body || []).map((role) => role.name));
  const missing = roles.filter((role) => !have.has(role.name));
  if (missing.length) {
    await kc('POST', `/organizations/${orgId}/groups/${groupId}/role-mappings/clients/${clientUuid}`, missing);
  }
}

async function ensureUser(spec) {
  const { body } = await kc('GET', `/users?username=${encodeURIComponent(spec.username)}&exact=true`);
  let user = Array.isArray(body) ? body[0] : null;
  if (!user) {
    const created = await kc('POST', '/users', {
      username: spec.username,
      email: spec.email,
      firstName: spec.firstName,
      lastName: spec.lastName,
      enabled: true,
      emailVerified: true,
      requiredActions: [],
    });
    const id = idFromLocation(created.location);
    user = (await kc('GET', `/users/${id}`)).body;
    console.log(`created user ${spec.username}`);
  }
  await kc('PUT', `/users/${user.id}/reset-password`, {
    type: 'password',
    value: demoPassword,
    temporary: false,
  });
  return user;
}

async function ensureMembership(orgId, userId) {
  await kc('POST', `/organizations/${orgId}/members`, userId, [201, 409]);
}

async function ensureGroupMember(orgId, groupId, userId) {
  await kc('PUT', `/organizations/${orgId}/groups/${groupId}/members/${userId}`, undefined, [204, 409]);
}

async function assignDirectRoles(userId, clientUuid, roles) {
  const current = await kc('GET', `/users/${userId}/role-mappings/clients/${clientUuid}`);
  const have = new Set((current.body || []).map((role) => role.name));
  const missing = roles.filter((role) => !have.has(role.name));
  if (missing.length) {
    await kc('POST', `/users/${userId}/role-mappings/clients/${clientUuid}`, missing);
  }
}

async function main() {
  await waitForKeycloak();
  await ensureRealm();

  const web = await ensureClient({
    clientId: 'budget-web',
    name: 'Budget Web',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: true,
    implicitFlowEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${webOrigin}/*`, 'http://127.0.0.1:5173/*'],
    webOrigins: [webOrigin, 'http://127.0.0.1:5173'],
    attributes: { 'pkce.code.challenge.method': 'S256' },
  });
  await ensureAudienceMapper(web.id);

  const api = await ensureClient({
    clientId: 'budget-api',
    name: 'Budget API',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    secret: 'budget-api-not-used-by-browser',
  });

  await ensureClient({
    clientId: 'budget-iam-admin',
    name: 'Budget IAM Admin',
    enabled: true,
    protocol: 'openid-connect',
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    secret: iamSecret,
  });
  const iam = await findClient('budget-iam-admin');
  await ensureServiceAccount(iam);

  const roleByName = {};
  for (const name of ATOMIC) {
    roleByName[name] = await ensureRole(api.id, name, name, false);
  }
  for (const name of Object.keys(DUTIES)) {
    roleByName[name] = await ensureRole(api.id, name, name, true);
  }
  await ensureComposites(api.id, roleByName);

  const mof = await ensureOrganization({
    name: 'Ministry of Finance',
    alias: 'mof',
    code: 'MOF',
    orgType: 'CENTRAL_GOVERNMENT',
    domain: 'mof.local',
  });
  const moe = await ensureOrganization({
    name: 'Ministry of Education',
    alias: 'moe',
    code: 'MOE',
    orgType: 'GOVERNMENT',
    domain: 'moe.local',
    parentOrganizationId: mof.id,
  });
  const priv = await ensureOrganization({
    name: 'Demo Private Company',
    alias: 'private001',
    code: 'PRIVATE001',
    orgType: 'PRIVATE',
    domain: 'private001.local',
  });

  const structures = [
    {
      org: mof,
      departments: [
        {
          name: 'Budget Department',
          code: 'MOF-BUD',
          positions: [
            { name: 'Budget Specialist', code: 'MOF-BUD-SPEC', risk: 'LOW', duties: ['duty:budget-preparation'] },
            { name: 'Budget Reviewer', code: 'MOF-BUD-REV', risk: 'LOW', duties: ['duty:budget-review'] },
            { name: 'Budget Approver', code: 'MOF-BUD-APP', risk: 'HIGH', duties: ['duty:budget-approval'] },
          ],
        },
        {
          name: 'IAM Office',
          code: 'MOF-IAM',
          positions: [
            {
              name: 'IAM Administrator',
              code: 'MOF-IAM-ADMIN',
              risk: 'HIGH',
              duties: ['duty:iam-administration'],
            },
          ],
        },
      ],
    },
    {
      org: moe,
      departments: [
        {
          name: 'Finance Department',
          code: 'MOE-FIN',
          positions: [
            { name: 'Budget Specialist', code: 'MOE-FIN-SPEC', risk: 'LOW', duties: ['duty:budget-preparation'] },
            {
              name: 'Finance Director',
              code: 'MOE-FIN-DIR',
              risk: 'HIGH',
              duties: ['duty:budget-review', 'duty:budget-approval', 'duty:iam-administration'],
            },
          ],
        },
      ],
    },
    {
      org: priv,
      departments: [
        {
          name: 'Finance Department',
          code: 'PRIV-FIN',
          positions: [
            { name: 'Accountant', code: 'PRIV-FIN-ACC', risk: 'LOW', duties: ['duty:budget-preparation'] },
            {
              name: 'Finance Manager',
              code: 'PRIV-FIN-MGR',
              risk: 'HIGH',
              duties: ['duty:budget-review', 'duty:budget-approval', 'duty:iam-administration'],
            },
          ],
        },
      ],
    },
  ];

  const positionByCode = {};
  for (const structure of structures) {
    for (const department of structure.departments) {
      const dept = await ensureGroup(structure.org.id, null, {
        name: department.name,
        attributes: {
          entity_type: ['DEPARTMENT'],
          department_code: [department.code],
        },
      });
      for (const position of department.positions) {
        const group = await ensureGroup(structure.org.id, dept.id, {
          name: position.name,
          attributes: {
            entity_type: ['POSITION'],
            department_code: [department.code],
            position_code: [position.code],
            position_name: [position.name],
            risk_level: [position.risk],
          },
        });
        await mapRoles(
          structure.org.id,
          group.id,
          api.id,
          position.duties.map((duty) => roleByName[duty]),
        );
        positionByCode[position.code] = { orgId: structure.org.id, groupId: group.id };
      }
    }
  }

  const users = [
    {
      username: 'mof.admin',
      email: 'mof.admin@mof.local',
      firstName: 'Бат',
      lastName: 'Админ',
      memberships: [{ orgId: mof.id, positions: ['MOF-IAM-ADMIN'] }],
      directRoles: ['iam:central:approve'],
    },
    {
      username: 'moe.specialist',
      email: 'moe.specialist@moe.local',
      firstName: 'Сара',
      lastName: 'Мэргэжилтэн',
      memberships: [{ orgId: moe.id, positions: ['MOE-FIN-SPEC'] }],
    },
    {
      username: 'moe.director',
      email: 'moe.director@moe.local',
      firstName: 'Дорж',
      lastName: 'Захирал',
      memberships: [{ orgId: moe.id, positions: ['MOE-FIN-DIR'] }],
    },
    {
      username: 'private.accountant',
      email: 'private.accountant@private001.local',
      firstName: 'Болд',
      lastName: 'Нягтлан',
      memberships: [{ orgId: priv.id, positions: ['PRIV-FIN-ACC'] }],
    },
    {
      username: 'multi.user',
      email: 'multi.user@mof.local',
      firstName: 'Оюун',
      lastName: 'Хос',
      memberships: [
        { orgId: mof.id, positions: ['MOF-BUD-SPEC'] },
        { orgId: priv.id, positions: ['PRIV-FIN-ACC'] },
      ],
    },
  ];

  for (const spec of users) {
    const user = await ensureUser(spec);
    for (const membership of spec.memberships) {
      await ensureMembership(membership.orgId, user.id);
      for (const code of membership.positions) {
        const position = positionByCode[code];
        await ensureGroupMember(position.orgId, position.groupId, user.id);
      }
    }
    if (spec.directRoles?.length) {
      await assignDirectRoles(
        user.id,
        api.id,
        spec.directRoles.map((name) => roleByName[name]),
      );
    }
  }

  console.log('Keycloak seed complete');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
