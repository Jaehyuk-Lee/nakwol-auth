# Managed gate updates v1

## Accepted direction
Official SDK ownership; reproducible consumer builds; dependency update PRs; CI;
post-deployment blocking verification; distinguish configured from deployed.
No per-request remote code download, new authentication bypass, secret sharing,
or changes to another site's source/deployment without authorization.

## This increment
- Opt-in `protect automate`: preserve existing site configuration, pin the local
  CLI package in devDependencies, use its local binary in build hooks, generate
  Dependabot (patch-only proposals), PR build validation and deployment-status
  verification workflows. No auto-merge or automatic production deployment.
- Install/update retains managed mode and consumes the exact installed package.
  A lockfile must be generated/reviewed and committed before CI (`npm ci`).
- Runtime version header on gate responses; optional exact-version verification.
  Deployed version is observed, never inferred from the local package version.
- `protect status` reports local integrity and a live HEAD version observation.
- Workflows keep immutable per-run verification artifacts associated with commit;
  failed checks require operator rollback through existing host tooling.

## Rollout and constraints
npm/GitHub root projects and official Workers/Pages gates only in v1. Existing
Dependabot/workflow files cause a preflight refusal rather than an overwrite.
Application-provided build scripts run in read-only, secret-free PR jobs; avoid
pull_request_target. Production verification uses the successful deployment SHA,
checks the configured production URL and exact installed version; it is not an
attestation that every production byte came from that SHA. Only a successful
GitHub deployment_status for the configured environment triggers this workflow.
Hosts without that event require manual dispatch of the deployed commit ref.
Artifacts and version headers are diagnostics, not authentication credentials.

## Follow-up implementation
App-scoped report credentials and ingestion, administrator history, and opt-in
Cloudflare deployment verification/rollback are implemented in this candidate.
See MANAGED_GATE_UPDATES.md and DEPLOYMENT_ROLLBACK.md for configuration,
trust boundaries and deployment serialization. Staged traffic rollout and
non-Cloudflare rollback are outside the current supported providers.

## Implementation/verification
1. Version and runtime observation; preserve existing verifier contracts.
2. Opt-in reproducible hooks and workflow generator with preflight checks.
3. CLI commands and operator documentation.
4. Temp-site install/automate/update/status/verify drivers, custom-file refusal,
   both providers, full regression and package/typecheck.
