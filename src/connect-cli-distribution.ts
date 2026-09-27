import type { Hono } from 'hono';
import cliPackageBase64 from './assets/nakwol-connect-cli.tgz.b64.js.txt';
import type { Env } from './types';

export const CONNECT_CLI_VERSION = '0.5.0';
export const CONNECT_CLI_PACKAGE_NAME = 'nakwol-connect';
function decodeBase64(value: string): Uint8Array { const binary=atob(value.trim()); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }
function packageResponse(cacheControl: string): Response { return new Response(decodeBase64(cliPackageBase64), { headers:{'Content-Type':'application/gzip','Content-Disposition':`attachment; filename="nakwol-connect-${CONNECT_CLI_VERSION}.tgz"`,'Cache-Control':cacheControl,'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin','X-Content-Type-Options':'nosniff'} }); }
export function registerConnectCliDistributionRoutes(app: Hono<{ Bindings: Env }>): void {
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
    return c.text(`# NAKWOL AUTH / NAKWOL Connect\n\n## Mandatory agent integration rules\n\nUse the official npm CLI package nakwol-connect. Do not hand-code Discord OAuth, PKCE, Bearer header plumbing, DATA scope database writes, endpoint paths, or secrets.\n\nNAKWOL services are PROTECTED BY DEFAULT. Unless the user explicitly says the service is public, preserve BOTH defaults:\n\n    auth = required\n    access_policy = member\n\nThis means the page stays locked until authentication succeeds, and authenticated non-members are denied. Missing or malformed central access-policy settings fail closed to member.\n\nDefault protected integration:\n\n    npx --yes nakwol-connect init\n\nAUTH + shared NAKWOL DATA example, still protected:\n\n    npx --yes nakwol-connect init --scopes roster:read,decks:read\n\nOnly if the user explicitly requests a public page may you relax the page guard:\n\n    npx --yes nakwol-connect init --auth optional\n\nOnly if the user explicitly requests a fully public service may you also relax the access policy:\n\n    npx --yes nakwol-connect init --auth optional --access-policy guest\n\nNever infer optional/guest from the fact that the site is static, a demo, a test page, or hosted on Cloudflare Pages. A test or static NAKWOL service is still required + member unless the user says otherwise.\n\nRegister the exact production callback URL. Reuse an existing NAKWOL Connect integration instead of layering a second OAuth implementation on top of it.\n\nDiscover the current DATA API before implementing DATA calls:\n\n    npx --yes nakwol-connect data describe --json\n\nImplement only paths and request shapes present in that OpenAPI document. Browser code should use window.NAKWOL_CONNECT.data.request(...) or existing convenience methods; do not manually construct Authorization or X-NAKWOL-CLIENT-ID headers. Request only the minimum DATA scopes needed.\n\nAlways verify after integration:\n\n    npx --yes nakwol-connect doctor --json\n\nThen explicitly confirm the installed state is auth=required and access_policy=member unless the user requested an exception. If doctor or the installed marker disagrees, fix it instead of reporting success.\n\nThe first machine authorization may require one short-lived browser approval. After approval the CLI detects the framework, registers/reuses the AUTH app, configures exact DATA scopes, edits the project idempotently, writes .nakwol-connect.json, and verifies local + AUTH + DATA + OpenAPI state.\n\nAvailable DATA scopes: profile:read, profile:write, roster:read, roster:write, equipment:read, equipment:write, decks:read, decks:write.\n\nRegistry-independent fallback:\n\n    npm exec --yes --package=${origin}/connect/cli/package.tgz -- nakwol-connect init\n\n## Machine-readable metadata\n\n- CLI manifest: ${origin}/connect/cli/manifest.json\n- Universal Embed: ${origin}/connect/v1.js\n- Web SDK: ${origin}/sdk/v0.3.0/nakwol-auth-web.js\n- Default auth mode: required\n- Default access policy: member\n- DATA origin: ${dataOrigin}\n- DATA OpenAPI: ${dataOrigin}/openapi.json\n- Admin apps: ${origin}/admin/apps\n- Admin developers: ${origin}/admin/developers\n`, 200, {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'public, max-age=300','Access-Control-Allow-Origin':'*'});
  });
}
