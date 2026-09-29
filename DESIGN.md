# Account page

`/account` is an ordinary user's profile, membership check, and login recovery page.

- One column, maximum 720px; 20px side gutters (16px on mobile).
- Existing AUTH dark palette: background #0b1020, surface #111a2b, text #f1f5f9, muted #a6b3c7, border #29364b, action #5865f2.
- Section spacing 16–24px, cards radius 16px, buttons 44px minimum height, visible keyboard focus.
- Profile → last confirmed membership → explicit Discord recheck → previously used services → logout → collapsed support details.
- Membership is the last OAuth observation, not live presence or a guarantee of service access. Manual service grants do not turn someone into a season3 member.
- Account/client identifiers and policy details belong in support details. Existing account and permission deep links remain valid.
- Never show deck/favorite placeholders before those capabilities exist.
- Recheck clears only this browser's central SSO session through a bearer-protected same-origin POST, then uses the pinned official SDK's PKCE login. It does not revoke other devices or service tokens. Global logout is separate and confirmed.

## Access recovery entry

- Common failure screens offer a separate account recovery link; never automatically send users away from the original error.
- `/account?client_id=...&recovery=1` shows the registered service name and an explicit return button.
- Return targets come exclusively from stored application redirect URIs (HTTP(S), no credentials). Query-supplied return URLs are ignored; disabled/unknown apps receive no return target.
- Only the client ID and a 30-minute timestamp survive OAuth in session storage. No access token or arbitrary return URL is transported between services.
- Verified account diagnostics distinguish role refresh from administrator-only action. The recovery UI does not grant access or change service policies.
- Central Embed updates apply on reload. Generated server login pages require Connect 0.6.1 protection regeneration and redeployment; custom consumer error pages must add the documented link themselves.

## Administrator deployment reports

- Reuse `/admin/apps`' existing `content-card`, `section-head`, `event-row`, `muted`, `error-text`, `ghost` and `el()` primitives. No new palette or layout system.
- Selected app: latest reported runtime and installed version, receipt time, then newest-first verification history (100 retained). Use text labels as well as existing success/error colors.
- Empty, loading and API-error states are distinct. Never present missing reports as a healthy deployment. Reports are publisher observations, not central attestation.
- Switching apps invalidates pending responses; render report values through textContent only. Refresh is keyboard accessible, results use a polite live region.
- This is an operator surface; do not add deployment details to ordinary users' account page.
