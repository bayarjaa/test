# Budget IAM Lab

Mongolian budget workflow proof of concept. Keycloak 26.8.1 is the source of truth for organizations, departments, positions, duties, and permissions. PostgreSQL stores only budget documents, workflow history, access requests, and audit events.

## Prerequisites

- Docker Engine and Docker Compose v2
- Ports 5173, 3001, and 8080 available

## Start

```bash
cp .env.example .env
docker compose up -d --build
```

`keycloak-init` creates the `budget-management` realm. It is safe to run again; it updates the demo realm instead of duplicating it.

- Web: http://localhost:5173
- API: http://localhost:3001/api
- Swagger: http://localhost:3001/api/docs
- Keycloak: http://localhost:8080

## Demo accounts

Local development only. Every user shares `DEMO_USER_PASSWORD` from `.env` (`ChangeMe123!` in the example).

| Username | Organization and position |
| --- | --- |
| `mof.admin` | Ministry of Finance, IAM Administrator. Direct role `iam:central:approve` for high-risk assignments. |
| `moe.specialist` | Ministry of Education, Budget Specialist |
| `moe.director` | Ministry of Education, Finance Director |
| `private.accountant` | Demo Private Company, Accountant |
| `multi.user` | MOF Budget Specialist and Private Company Accountant |

Keycloak bootstrap admin is `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` (example `admin` / `admin`). The browser never receives the `budget-iam-admin` client secret.

## Assign a user to a position

1. Sign in as `moe.director` or `mof.admin`.
2. Open **Хандалтын хүсэлт**.
3. Create a request for a user and position. Low-risk positions can be approved by an organization admin (`iam:position:assign`). High-risk positions stay pending until `mof.admin` approves them.
4. Approval adds the user to that organization and organization group. Rejection does not change Keycloak.

To remove a position, open **Хэрэглэгчид**, select the user, and choose **Хасах**. That calls `iam:position:revoke` and deletes only the organization group membership.

## Change position permissions

Open **Эрх, үүрэг** or **Хэлтэс, албан тушаал**, select a position, and toggle a `duty:*` role. The API maps or removes that composite client role on the organization group through the Keycloak Admin API. Effective atomic permissions are read from the group's composite role mapping, not from the caller's token.

`duty:budget-reporting` is seeded but not attached to a position, so the matrix can show an assignment change.

## Cross-organization denial

Sign in as `multi.user`. In **Миний профайл**, switch the active organization.

- Ministry of Finance includes `budget:draft:create`.
- Ministry of Education does not include that user, so budget reads and writes are denied.
- `private.accountant` cannot open a Ministry of Finance budget. Membership in the document's organization is required.

The API checks the verified JWT `sub`, organization membership, position groups in that organization, and the roles mapped to those groups. A global token role list is not enough.

## Tests

```bash
cd apps/api
npm ci
npx prisma generate
npm test
```

With the stack running, the live Keycloak scenario is included:

```bash
cd apps/api
export $(grep -v '^#' ../../.env | xargs)
export KEYCLOAK_INTERNAL_URL=http://localhost:8080
export KEYCLOAK_CLIENT_ID=budget-iam-admin
export KEYCLOAK_CLIENT_SECRET=$IAM_ADMIN_CLIENT_SECRET
export DATABASE_URL=postgresql://budget:budget@localhost:5432/budget
export RUN_KEYCLOAK_E2E=1
npm test
```

Publish the budget database port before that command if it is not already exposed. From the API container:

```bash
docker compose exec budget-api npm test
```

does not see `RUN_KEYCLOAK_E2E` unless you pass it. The integration test skips unless `RUN_KEYCLOAK_E2E=1`.

## Known limitations

- Keycloak does not expire organization group membership. The API stores `expiresAt` on the access request and a one-minute job removes the membership. Until that job succeeds, authorization already ignores an expired assignment.
- `parent_organization_id` is an organization attribute. Keycloak does not enforce a parent-child tree.
- Re-running `keycloak-init` restores demo duty mappings and demo passwords.
- `budget-web` has Direct Access Grants enabled so automated tests can obtain tokens. The UI uses Authorization Code and PKCE. Do not enable this grant in production.
- The `budget-iam-admin` service account has the realm-management roles required to manage organizations, users, and client role mappings (`manage-realm`, `manage-users`, `manage-clients`, and the related view/query roles). Human administrators do not receive `realm-admin`.
- Organization-group role mappings use the Keycloak 26.8 Admin API under `/organizations/{orgId}/groups/{groupId}/role-mappings/clients/{clientId}`. They are not realm groups.
- Dev passwords and the service-account secret in `.env.example` are for this lab only.
