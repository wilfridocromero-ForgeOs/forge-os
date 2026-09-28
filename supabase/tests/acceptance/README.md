# Staging acceptance suites

## Email Marketing V1 Inc1–2 Human Acceptance

- **File:** `email_marketing_v1_inc1_inc2_human_acceptance.sql`
- **Last Staging validation:** PASS 170/170
- **Run ID:** `20260928t161242-043216`
- **Staging project:** `vkvaispeujpsvotojyvz`
- **Production:** NEVER RUN AGAINST PRODUCTION

### How it works

- Run it manually in the Supabase SQL Editor of the Staging project. It returns one row: a text summary and a JSON report.
- An environment guard runs first. If the database is not Staging with Inc1 and Inc2 recorded byte-exact, the runner reports `BLOCKED` and writes nothing.
- The runner uses an isolated QA scenario: synthetic users, organizations, CRM leads, contacts, consent, lists, tags, fields, segments, suppressions and audit rows, all tagged with the run ID.
- Every scenario write must end in rollback. The scenario runs inside a savepoint that always ends by raising a sentinel, and a final section checks that no rows from the run remain.
- The validated run confirmed:
  - Production contacted: NO
  - Staging writes committed: NONE

### Maintenance

- Extend this suite with each future Email Marketing increment, or add a sibling suite per increment. Keep the existing checks as the regression baseline.
- The file is preserved exactly as it was validated in Staging. Change it only as part of an increment, and re-validate it in Staging afterwards.
- It does not replace unit or local tests. It is the acceptance and regression gate for Staging.
