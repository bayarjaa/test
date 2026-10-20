# Test scenarios

Unit tests in `apps/api` cover:

1. Login token verification: valid signature, expiry, audience, issuer, and a forged signature (`src/auth/jwt.spec.ts`).
2. Organization membership is required before a permission is allowed.
3. A position's composite duty roles expand to atomic permissions.
4. `multi.user` is allowed in MOF and denied in MOE.
5. A private-organization user is denied for a Ministry of Finance budget.
6. Draft to submitted to reviewed to approved transitions (`src/iam/workflow.spec.ts` and the live test).
7. A different user with the approval duty may approve a reviewed document.
8. The creator cannot approve their own reviewed document.
9. Clearing position groups removes effective permissions.
10. An expired assignment does not grant the position's permissions. `src/access/expiry.spec.ts` also checks that the job removes the Keycloak membership and retries when Keycloak fails.
11. Creating an organization without central authority is denied and does not call Keycloak.
12. A Keycloak outage denies the protected check and still writes an audit row.

`src/keycloak.integration.spec.ts` runs against the real realm when `RUN_KEYCLOAK_E2E=1`. It obtains a `multi.user` token from Keycloak, verifies it with the realm JWKS, checks MOF versus MOE permissions, approves a Ministry of Education draft as `moe.director`, and expects self-approval to fail.
