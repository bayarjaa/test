# Permission matrix

Atomic permissions live as `budget-api` client roles. Duties are composite roles. Positions receive duties through organization-group client role mappings. Effective permissions are the composite expansion of those duties.

| Organization | Department | Position | Risk | Duties |
| --- | --- | --- | --- | --- |
| MOF | Budget Department | Budget Specialist | LOW | duty:budget-preparation |
| MOF | Budget Department | Budget Reviewer | LOW | duty:budget-review |
| MOF | Budget Department | Budget Approver | HIGH | duty:budget-approval |
| MOF | IAM Office | IAM Administrator | HIGH | duty:iam-administration |
| MOE | Finance Department | Budget Specialist | LOW | duty:budget-preparation |
| MOE | Finance Department | Finance Director | HIGH | duty:budget-review, duty:budget-approval, duty:iam-administration |
| PRIVATE001 | Finance Department | Accountant | LOW | duty:budget-preparation |
| PRIVATE001 | Finance Department | Finance Manager | HIGH | duty:budget-review, duty:budget-approval, duty:iam-administration |

Duty contents:

- `duty:budget-preparation`: read, create, update, submit
- `duty:budget-review`: read, review, return
- `duty:budget-approval`: read, approve
- `duty:budget-reporting`: `budget:report:read` (not pre-assigned)
- `duty:iam-administration`: invite, assign, revoke

`mof.admin` additionally has direct `iam:central:approve`.

`multi.user` is MOF Budget Specialist and PRIVATE001 Accountant. That user has preparation rights in those two organizations and none in MOE.

The **Эрх, үүрэг** page lists this matrix from Keycloak and can add or remove a duty on a position.
