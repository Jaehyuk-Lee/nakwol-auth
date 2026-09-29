# Opt-in deployment recovery

`rollbackProtection(options)` in `packages/connect-cli/src/deployment-rollback.mjs` supports Cloudflare Workers and Pages. It does not run during ordinary verification. The deployment job must explicitly invoke it after an observed anonymous HTTP 2xx response on a protected path. Timeouts, DNS failures and HTTP 5xx are ineligible.

`readCurrentDeployment(config, { apiToken, fetchImpl })` returns the current deployment object, including `id` and `created_on`, using only GET requests. It validates the opt-in provider/resource/serialization settings but permits an absent baseline. A release job can read before and after live verification and require unchanged identity before attaching the deployment ID to the report and saving a baseline. The configured rollback provider must match the installed protection provider.

Store the policy inside `.nakwol-connect.json` under `protection.rollback`:

```json
{
  "enabled": true,
  "provider": "cloudflare-workers",
  "accountId": "ACCOUNT_ID",
  "scriptName": "WORKER_NAME",
  "serializedDeployments": true,
  "previousVerified": {
    "deploymentId": "PREVIOUS_VERIFIED_DEPLOYMENT_ID",
    "runtimeVersion": "0.7.1",
    "report": "REPLACE_WITH_COMPLETE_SUCCESSFUL_VERIFICATION_REPORT_OBJECT"
  }
}
```

For Pages use `provider: "cloudflare-pages"` and `projectName` instead of `scriptName`. The report must be the actual successful installed-assets verification, including checks, request count, timestamp, origins, exact expected/observed runtime version and the deployment ID attached by the deployment job. A minimal `{ "ok": true }` is rejected. Capture it after verifying the baseline production deployment and confirming its ID stayed current through verification. Keep this trusted artifact under the same access controls as deployment credentials. The code validates the report structure; it does not provide cryptographic attestation.

Pass `failedDeploymentId` and `failureReport` (the full failed verification report plus its bound `deploymentId`). Hold the same deployment concurrency lock from deployment through verification and rollback. Set `CLOUDFLARE_API_TOKEN` in the job secret environment with access to the specific account/resource; never commit it. Supply `config` directly for embedding, or let the module read project configuration. Tests can inject `fetchImpl` for the management API, `verificationFetchImpl` for HTTP probes and `verifyImpl` for the recovery verifier.

The function reads the current deployment twice, refuses mismatched IDs, retrieves only the explicitly selected older baseline, and never chooses history automatically. Workers baselines must contain exactly one version at 100%; Pages baselines must be successful production deployments. It submits one rollback and calls `verifyProtection` with the baseline runtime version. `rollbackAccepted` records API acceptance; `recoveryVerification` and `status` separately record recovery success, failure or indeterminate verification. A failed recovery does not trigger another rollback.

Cloudflare's endpoints do not expose an atomic compare-and-swap deployment precondition. `serializedDeployments: true` is an operator assertion that all deployment writers share a lock, including dashboard/manual changes; it is not a lock supplied by this package. Without that external serialization, a deployment can race the final read and POST. Do not enable this policy in such an environment.

This restores deployment traffic only. Database migrations, secrets, bindings, external storage and irreversible side effects are outside its scope. Successful anonymous blocking checks do not establish authenticated user flows. After a rollback, the local checkout may still contain the failed release's asset inventory; mismatched recovery paths can fail verification and require inspection.

## Official API references

- [List Worker deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) defines the first item as currently serving traffic.
- [Create Worker deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/) accepts percentage strategy and version IDs.
- [Pages deployment rollback](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/) provides the deployment-specific rollback endpoint.
- [Pages project](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/) supplies the canonical production deployment.

Validation: `node --test packages/connect-cli/test/deployment-rollback.test.mjs`. These are local fixture tests; no production rollback was performed.

## CLI and CI integration

```sh
# First known-good deployment: read its provider ID, verify it, save full baseline.
nakwol-connect protect release-check --deployment-id "$PROVIDER_DEPLOYMENT_ID" --output-file baseline.json --baseline --json
# Keep baseline.json in trusted deployment storage and set previousVerified from it.

# After the next provider deployment, in that SAME serialized job:
nakwol-connect protect release-check --deployment-id "$PROVIDER_DEPLOYMENT_ID" --output-file release.json --json
```

Example steps appended to an existing GitHub deployment job (the job must use a protected `environment: production` and share the deployment concurrency group with every writer):

```yaml
- name: Verify deployed gate and recover observed exposure
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    PROVIDER_DEPLOYMENT_ID: ${{ steps.deploy.outputs.deployment_id }}
  run: |
    mkdir -p .nakwol/reports
    node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect release-check --deployment-id "$PROVIDER_DEPLOYMENT_ID" --output-file .nakwol/reports/release.json --json
- name: Report attempted release and recovery
  if: always() && hashFiles('.nakwol/reports/release.json') != ''
  env:
    NAKWOL_GATE_REPORT_TOKEN: ${{ secrets.NAKWOL_GATE_REPORT_TOKEN }}
    NAKWOL_REPORT_AUTH_ORIGIN: https://nakwol-auth.sepsd21.workers.dev
    DEPLOYED_SHA: ${{ github.sha }}
  run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect report --report .nakwol/reports/release.json --commit "$DEPLOYED_SHA" --json
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: gate-release-${{ github.run_id }}
    path: .nakwol/reports/release.json
```

`steps.deploy.outputs.deployment_id` must be the real Cloudflare **deployment ID**, not a GitHub deployment ID or Workers version ID; adapt this one output to the existing provider deploy action. The CLI checks it against the provider's current deployment before and after probing. Wrong/changed IDs fail before rollback. This snippet does not supply a provider deploy step or lock other deployment systems. Only run trusted reviewed code with these credentials, never a pull request head. The candidate does not automatically install Cloudflare credentials or change repository environment permissions.

A report's commit SHA is the attempted release workflow source. A recovered report separately identifies the recovery deployment and failed deployment; it does not claim the recovery bytes have that attempted-release SHA.
