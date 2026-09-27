const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('CLOUDFLARE_CI_CREDENTIALS_MISSING');
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/nakwol-auth`;
const read = async (path) => {
  const response = await fetch(`${base}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw new Error(`AUTH_PREFLIGHT_HTTP_${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error('AUTH_PREFLIGHT_API_FAILED');
  return body.result;
};
const secrets = await read('secrets');
const names = secrets.map(entry => entry.name).sort();
console.log(JSON.stringify({ worker: 'nakwol-auth', secretNames: names }));
const settings = await read('settings');
for (const name of ['NAKWOL_GUILD_ID', 'NAKWOL_MEMBER_ROLE_ID']) {
  const binding = settings.bindings?.find(entry => entry.name === name);
  console.log(JSON.stringify({ binding: name, type: binding?.type ?? 'missing', value: binding?.type === 'plain_text' ? binding.text : '(not printed)' }));
}
const missing = ['DISCORD_CLIENT_SECRET', 'DISCORD_BOT_TOKEN'].filter(name => !names.includes(name));
if (missing.length) throw new Error(`AUTH_REQUIRED_SECRETS_MISSING:${missing.join(',')}`);
console.log('AUTH_DEPLOY_PREFLIGHT_OK');
