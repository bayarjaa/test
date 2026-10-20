# Architecture

The browser talks only to `budget-web` and `budget-api`. `budget-api` verifies access tokens with the realm JWKS and calls Keycloak with the confidential `budget-iam-admin` service account.

```text
budget-web (PKCE) -> Keycloak 26.8.1 realm budget-management
budget-web (Bearer) -> budget-api -> Keycloak Admin API
budget-api -> budget-db (Prisma)
Keycloak -> keycloak-db
```

Keycloak holds organizations, organization groups (departments and positions), client roles, and user memberships. PostgreSQL holds `User`, `BudgetDocument`, `BudgetLine`, `BudgetWorkflowHistory`, `AccessRequest`, `AccessApproval`, and `AuditEvent`.

`User.keycloakId` is the JWT `sub`. `User.activeOrganizationId` and `BudgetDocument.organizationId` store Keycloak identifiers. There is no local organization, department, position, role, or permission table.

Containers are defined in `docker-compose.yml`. `keycloak-init` runs `infra/keycloak/init.mjs` after Keycloak accepts admin login.
