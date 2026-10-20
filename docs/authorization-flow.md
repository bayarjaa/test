# Authorization flow

`AuthorizationService.authorize(userId, organizationId, permission, resourceContext)`:

1. `userId` is the verified access-token `sub`. The API rejects missing, expired, wrong-issuer, wrong-audience, and badly signed tokens.
2. Membership is `GET /organizations/{id}/members/{userId}`.
3. Position groups are `GET /organizations/{id}/members/{userId}/groups`, kept only when `entity_type=POSITION`.
4. A position is ignored when the latest approved access request for that user and group is `EXPIRED` or `APPROVED` with `expiresAt` in the past. Seeded memberships have no request row and stay active.
5. Effective roles come from the organization group's client composite role mapping for `budget-api`.
6. The permission must be in that set. Token role claims are not consulted for budget or organization administration.
7. For a budget, the document organization must equal the selected organization, the status must allow the action, and the creator cannot approve it.
8. The decision is `ALLOW` or `DENY` and is written to `AuditEvent`.

Membership and role lookups are cached for 15 seconds. Budget mutations, duty changes, and access decisions use a fresh read. IAM changes clear the cache. If Keycloak cannot be reached, the decision is `DENY` with reason `keycloak_unavailable`.

Low-risk access requests require `iam:position:assign` in that organization. High-risk requests require the direct role `iam:central:approve`. Rejection uses the same rule and does not change group membership. Approval adds the organization member and the organization group member.

A background job every 60 seconds deletes group membership for approved requests whose `expiresAt` has passed, then marks the request `EXPIRED`. If Keycloak is down, the row stays `APPROVED` so the job can retry, while authorization already denies the expired assignment.
