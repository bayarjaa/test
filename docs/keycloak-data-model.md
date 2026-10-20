# Keycloak data model

Realm: `budget-management` with organizations enabled.

## Clients

- `budget-web`: public, standard flow, PKCE S256, local redirect URIs. An audience mapper adds `budget-api` to access tokens. Direct access grants are on for local tests only.
- `budget-api`: client roles for atomic permissions and composite duties. No browser secret is required.
- `budget-iam-admin`: confidential service account used only by the API.

## Organizations

Attributes `code`, `org_type`, and optional `parent_organization_id`.

| Name | Alias | Code | Type | Parent |
| --- | --- | --- | --- | --- |
| Ministry of Finance | mof | MOF | CENTRAL_GOVERNMENT | none |
| Ministry of Education | moe | MOE | GOVERNMENT | MOF |
| Demo Private Company | private001 | PRIVATE001 | PRIVATE | none |

Domains: `mof.local`, `moe.local`, `private001.local`.

## Organization groups

Departments are top-level organization groups. Positions are their children. These are not realm groups. The same display name may exist in more than one organization; the group id is the identifier.

Attributes:

- `entity_type`: `DEPARTMENT` or `POSITION`
- `department_code`
- `position_code`, `position_name`, `risk_level` on positions

Admin paths used by the seeder and API:

- `POST /admin/realms/{realm}/organizations`
- `POST /admin/realms/{realm}/organizations/{orgId}/groups`
- `POST /admin/realms/{realm}/organizations/{orgId}/groups/{groupId}/children`
- `PUT /admin/realms/{realm}/organizations/{orgId}/groups/{groupId}`
- `PUT|DELETE .../groups/{groupId}/members/{userId}`
- `GET .../members/{userId}/groups?briefRepresentation=false`
- `GET|POST|DELETE .../groups/{groupId}/role-mappings/clients/{clientUuid}`
- `GET .../role-mappings/clients/{clientUuid}/composite`

## Duties

Composite client roles on `budget-api`:

- `duty:budget-preparation`
- `duty:budget-review`
- `duty:budget-approval`
- `duty:budget-reporting` (unassigned in the seed)
- `duty:iam-administration` (`iam:user:invite`, `iam:position:assign`, `iam:position:revoke`)

`iam:central:approve` is assigned directly to `mof.admin`, not through an organization group. High-risk approval checks that direct mapping so a position in one organization cannot grant central authority.

Parent organization links are interpreted by the application from `parent_organization_id`. Keycloak does not enforce them.
