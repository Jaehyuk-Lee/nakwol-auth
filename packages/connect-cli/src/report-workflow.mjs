export function reportWorkflowStep(authOrigin) {
  if (new URL(authOrigin).protocol !== 'https:' || new URL(authOrigin).origin !== authOrigin) throw new Error('HTTPS AUTH origin is required for CI reports.');
  // No secret reaches a PR job. Use a protected environment and the trusted default branch.
  return `      - name: Send verification summary to AUTH
        if: always() && steps.trusted.outcome == 'success' && hashFiles('.nakwol/reports/deployed.json') != ''
        env:
          NAKWOL_GATE_REPORT_TOKEN: \${{ secrets.NAKWOL_GATE_REPORT_TOKEN }}
          NAKWOL_REPORT_AUTH_ORIGIN: ${JSON.stringify(authOrigin)}
          DEPLOYED_SHA: \${{ github.event.deployment.sha || github.sha }}
        run: node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect report --report .nakwol/reports/deployed.json --commit "$DEPLOYED_SHA" --json
`;
}
