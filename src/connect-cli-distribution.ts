import gateSpecification from './assets/gate-spec.js.txt';
import type { Hono } from 'hono';
import cliPackageBase64 from './assets/nakwol-connect-cli.tgz.b64.js.txt';
import type { Env } from './types';

export const CONNECT_CLI_VERSION = '0.7.1';
export const CONNECT_CLI_PACKAGE_NAME = 'nakwol-connect';
const SERVER_PROTECTION_GUIDANCE = `Full normative gate specification: /connect/gate-spec.md (also GATE_SPEC.md in the npm package). Role-based access requires Discord verification within 24 hours.

## Managed updates

Opt-in protect automate pins a local npm CLI dependency and generates GitHub patch-update PR checks and deployment-status verification. Commit a reviewed package-lock.json. Existing automation is not overwritten. protect status distinguishes local and observed runtime versions; protect verify --expect-runtime installed requires matching runtime headers. See docs/MANAGED_GATE_UPDATES.md. Opt-in app-scoped reporting feeds /admin/apps; Cloudflare release-check supports explicit verified-baseline rollback under serialized deployments. See docs/DEPLOYMENT_ROLLBACK.md.

## Server protection is separate from browser authentication

## Account recovery for access failures

Offer an explicit "계정 확인·접속 문제 해결" link to AUTH /account?client_id=YOUR_CLIENT_ID&recovery=1 alongside login retry. Do not automatically redirect errors. AUTH resolves the return destination exclusively from registered redirect URIs; never pass arbitrary return URLs. Role refresh cannot resolve administrator restrictions or disabled services.

Central /connect/v1.js includes this error link. Existing generated server gates must regenerate with Connect CLI 0.7.1 and redeploy; custom error pages must add the link. The AUTH-hosted /connect/cli/v0.7.1/package.tgz provides this version independently of npm registry publication.

For Vercel, Netlify or custom servers, import createGate from nakwol-connect/server and supply a protected Request/Response content handler; do not reimplement authentication logic. Automatic generation currently supports only Cloudflare Workers/Pages static builds. GitHub Pages cannot execute this gate; move protected content to server-capable hosting and close old public URLs. See docs/CONNECT_SERVER_PROTECTION.md in the official repository for the gate contract. Run protect verify --provider custom --url https://YOUR-SITE/ --paths /,/data.json,/images/private.png to inspect explicitly listed paths without local installer metadata. This checks anonymous blocking only, not full implementation correctness, and does not replace doctor for official installations.

Connect 0.7.1 preserves the original path, query and fragment across login. Its AES-GCM site/app/auth-origin/policy-bound session contains a fixed five-minute authorization lease. Initial session creation, expired leases and legacy-cookie upgrades call AUTH /me; valid leases use only local cryptographic checks before all protected assets, including ETag/304. Bounded isolate-local completed-result caching and single-flight suppress concurrent renewal checks; different isolates can each revalidate. No per-asset D1/KV/R2 lookup is used. AUTH failures deny expired leases (503), but valid leases remain usable until expiry. Central revocation can therefore take up to five additional minutes; Discord OAuth role freshness can take 24 hours plus that lease. Browser cache headers remain private, no-cache, max-age=0, must-revalidate for ETag responses, otherwise no-store.

Existing ~0.6.3 build hooks do not automatically adopt 0.7.1. After accepting the revocation-delay contract, explicitly run npx --yes nakwol-connect@0.7.1 protect update and rebuild/redeploy/verify. The new hook follows compatible ~0.7.1 releases. Custom hosts update the same official package. No running deployment changes from an AUTH-only deployment. This source version is a release candidate until publication and deployment are recorded.

member means the centrally configured Season 3 role (1553600098661957643). Developers choose member, not a Discord role ID. Active developers manage owned apps with member/guest; admin policy and additional role requirements are operator-only.

Required init and sync return ok:false and exit 1 until server protection and live anonymous blocking checks pass. Embed-only setup is incomplete. Pass --provider and --assets to init to install the gate in the same command. For a static Cloudflare Workers site:

    nakwol-connect init --auth required --access-policy member --url https://SITE/
    # Build the site into dist first.
    nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://SITE/
    # Rebuild to include the server logout bridge and root callback.
    npx wrangler secret put NAKWOL_SESSION_SECRET --config wrangler.nakwol.json
    npx wrangler deploy --config wrangler.nakwol.json
    nakwol-connect protect verify --url https://SITE/ --json
    nakwol-connect doctor --url https://SITE/ --json

Use a random session secret of at least 32 characters via Cloudflare Secret input; never put it in source or conversation. Deployment requires the site owner's Cloudflare access. The generated Worker name is client ID; review naming collisions before deploy. CI must use wrangler.nakwol.json. Custom domains must point to this Worker. Server-side rendering, existing Worker business logic, API servers and other hosting platforms are not automatically installed or certified. Never report them protected based only on an Embed.

configured means installed, configured-not-verified means deployment untested, anonymous-blocking-verified means anonymous requests to the checked URLs were denied. Verify tests all local build asset paths with GET/HEAD/Range/invalid cookies, without login and without following redirects. Only gate-marked 401/403 no-store responses pass; 200/206/302/404/503 and timeouts fail. Doctor verifies the stored production URL when --url is omitted. Offline or local configuration checks cannot certify required installation.

Pass --alternate-origins https://OLD/ and --paths /private-route to protect verify where needed. Unlisted origins, old public deployments and public storage are NOT discovered or protected. Separately verify a real Season 3 login, a non-member denial and awaited NAKWOL_CONNECT.logout(). Do not call blocking checks full login acceptance.

Cloudflare Pages static sites: use --provider cloudflare-pages --project-name EXISTING_PROJECT. Deploy the generated output directory including _worker.js and _routes.json (include /*, no exclusions). Set NAKWOL_SESSION_SECRET with wrangler pages secret put and disable Pages Functions fail-open. Build before installing; do not delete generated gate files in a later build. Old deployment URLs remain a separate exposure to remove or protect.

Current authorization is bot-free OAuth role snapshots. Existing SSO may reuse stale roles; this installer does not promise immediate Discord role revocation. See /connect#server-protection for Korean setup and troubleshooting.

`;
function decodeBase64(value: string): Uint8Array { const binary=atob(value.trim()); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }
function packageResponse(cacheControl: string): Response { return new Response(decodeBase64(cliPackageBase64), { headers:{'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="nakwol-connect-${CONNECT_CLI_VERSION}.tgz"`,'Cache-Control':cacheControl,'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff'} }); }
export function registerConnectCliDistributionRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/gate-spec.md', (c) => c.text(gateSpecification, 200, { 'Cache-Control':'public, max-age=300', 'Access-Control-Allow-Origin':'*' }));
  app.get('/connect/cli/package.tgz', () => packageResponse('public, max-age=300'));
  app.get(`/connect/cli/v${CONNECT_CLI_VERSION}/package.tgz`, () => packageResponse('public, max-age=31536000, immutable'));
  app.get('/connect/cli/manifest.json', (c) => {
    const origin=c.env.AUTH_ORIGIN.replace(/\/$/,''); const tarball=`${origin}/connect/cli/package.tgz`; const dataOrigin='https://nakwol-data.sepsd21.workers.dev';
    const response=c.json({
      ok:true,
      name:CONNECT_CLI_PACKAGE_NAME,
      version:CONNECT_CLI_VERSION,
      default_auth:'required',
      default_access_policy:'member',
      server_protection_providers:['cloudflare-workers','cloudflare-pages'],
      server_protection_install:'nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://SITE/',
      server_protection_verify:'nakwol-connect protect verify --url https://SITE/ --json',
      embed_is_server_protection:false,
      npm_command:'npx --yes nakwol-connect init',
      npm_optional_command:'npx --yes nakwol-connect init --auth optional',
      npm_public_command:'npx --yes nakwol-connect init --auth optional --access-policy guest',
      npm_data_command:'npx --yes nakwol-connect init --scopes roster:read,decks:read',
      npm_describe_command:'npx --yes nakwol-connect data describe --json',
      npm_doctor_command:'npx --yes nakwol-connect doctor --json',
      tarball,
      fallback_command:`npm exec --yes --package=${tarball} -- nakwol-connect init`,
      fallback_doctor_command:`npm exec --yes --package=${tarball} -- nakwol-connect doctor --json`,
      auth_origin:origin,
      data_origin:dataOrigin,
      data_openapi:`${dataOrigin}/openapi.json`,
    });
    response.headers.set('Access-Control-Allow-Origin','*'); response.headers.set('Cache-Control','public, max-age=300'); return response;
  });
  app.get('/llms.txt', (c) => {
    const origin=c.env.AUTH_ORIGIN.replace(/\/$/,''); const dataOrigin='https://nakwol-data.sepsd21.workers.dev';
    return c.text(SERVER_PROTECTION_GUIDANCE + `# NAKWOL AUTH / NAKWOL Connect\n\n## Mandatory agent integration rules\n\nUse the official npm CLI package nakwol-connect. Do not hand-code Discord OAuth, PKCE, Bearer header plumbing, DATA scope database writes, endpoint paths, or secrets.\n\nNAKWOL authentication policy is REQUIRED BY DEFAULT; install a server gate to protect content. Unless the user explicitly says the service is public, preserve BOTH defaults:\n\n    auth = required\n    access_policy = member\n\nThis means the page stays locked until authentication succeeds, and authenticated non-members are denied. Missing or malformed central access-policy settings fail closed to member.\n\nDefault protected integration:\n\n    npx --yes nakwol-connect init\n\nAUTH + shared NAKWOL DATA example, still protected:\n\n    npx --yes nakwol-connect init --scopes roster:read,decks:read\n\nOnly if the user explicitly requests a public page may you relax the page guard:\n\n    npx --yes nakwol-connect init --auth optional\n\nOnly if the user explicitly requests a fully public service may you also relax the access policy:\n\n    npx --yes nakwol-connect init --auth optional --access-policy guest\n\nNever infer optional/guest from the fact that the site is static, a demo, a test page, or hosted on Cloudflare Pages. A test or static NAKWOL service is still required + member unless the user says otherwise.\n\nRegister the exact production callback URL. Reuse an existing NAKWOL Connect integration instead of layering a second OAuth implementation on top of it.\n\nDiscover the current DATA API before implementing DATA calls:\n\n    npx --yes nakwol-connect data describe --json\n\nImplement only paths and request shapes present in that OpenAPI document. Browser code should use window.NAKWOL_CONNECT.data.request(...) or existing convenience methods; do not manually construct Authorization or X-NAKWOL-CLIENT-ID headers. Request only the minimum DATA scopes needed.\n\nAlways verify after integration:\n\n    npx --yes nakwol-connect doctor --json\n\nThen explicitly confirm the installed state is auth=required and access_policy=member unless the user requested an exception. If doctor or the installed marker disagrees, fix it instead of reporting success.\n\nThe first machine authorization may require one short-lived browser approval. After approval the CLI detects the framework, registers/reuses the AUTH app, configures exact DATA scopes, edits the project idempotently, writes .nakwol-connect.json, and verifies local + AUTH + DATA + OpenAPI state.\n\nAvailable DATA scopes: profile:read, profile:write, roster:read, roster:write, equipment:read, equipment:write, decks:read, decks:write.\n\nRegistry-independent fallback:\n\n    npm exec --yes --package=${origin}/connect/cli/package.tgz -- nakwol-connect init\n\n## Machine-readable metadata\n\n- CLI manifest: ${origin}/connect/cli/manifest.json\n- Universal Embed: ${origin}/connect/v1.js\n- Web SDK: ${origin}/sdk/v0.3.0/nakwol-auth-web.js\n- Default auth mode: required\n- Default access policy: member\n- DATA origin: ${dataOrigin}\n- DATA OpenAPI: ${dataOrigin}/openapi.json\n- Admin apps: ${origin}/admin/apps\n- Admin developers: ${origin}/admin/developers\n`, 200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*'});
  });
}
