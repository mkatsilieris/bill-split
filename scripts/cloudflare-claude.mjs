#!/usr/bin/env node
// Lets Claude reach the MCP endpoint of Bill Split from the Internet.
//
// The whole hostname sits behind the Cloudflare Access login (one-time code by e-mail). Claude is a
// program: it cannot type that code. This script adds a second, more specific Access application
// for <hostname>/api/mcp only, with a "bypass" policy, so those requests pass Cloudflare without the
// login. The API itself then asks for a personal access token on every call (docs/CLAUDE.md).
// Everything else on the hostname stays behind the Access login.
//
//   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-claude.mjs [--hostname bills.ninblack.com] [--account <id>]
//   CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-claude.mjs --remove      # close it again
//
// Token scope: Account > Access: Apps and Policies: Edit. Re-running is safe.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) fail('Set CLOUDFLARE_API_TOKEN');

const args = process.argv.slice(2);
const arg = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const hostname = arg('hostname') ?? 'bills.ninblack.com';
const envFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'cloudflare-access.env'), 'utf8');
const account = arg('account') ?? envFile.match(/^ACCESS_ACCOUNT_ID=(\S+)$/m)?.[1] ?? fail('No account: pass --account <id>');
const domain = `${hostname}/api/mcp`;

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!data?.success) {
    const reason = data?.errors?.map((e) => `${e.code} ${e.message}`).join('; ') ?? `HTTP ${res.status}`;
    throw new Error(`${method} ${path}: ${reason}`);
  }
  return data.result;
}

const apps = await cf('GET', `/accounts/${account}/access/apps`);
let app = apps.find((a) => a.domain === domain);

if (args.includes('--remove')) {
  if (!app) step(`no Access application for ${domain}, nothing to remove`);
  else {
    await cf('DELETE', `/accounts/${account}/access/apps/${app.id}`);
    step(`Access application "${app.name}" removed: ${domain} is behind the Access login again`);
  }
  process.exit(0);
}

if (!apps.some((a) => a.domain === hostname)) fail(`No Access application protects ${hostname}; is the hostname right?`);
if (app) step(`Access application "${app.name}" exists (${app.id})`);
else {
  app = await cf('POST', `/accounts/${account}/access/apps`, {
    name: 'Bill Split - Claude (MCP)',
    domain,
    type: 'self_hosted',
    session_duration: '24h',
    app_launcher_visible: false,
  });
  step(`Access application "${app.name}" created (${app.id})`);
}
const policies = await cf('GET', `/accounts/${account}/access/apps/${app.id}/policies`);
if (policies.length > 0) step(`policy "${policies[0].name}" of ${domain} already exists, left as is`);
else {
  await cf('POST', `/accounts/${account}/access/apps/${app.id}/policies`, {
    name: 'Token checked by the API',
    decision: 'bypass',
    precedence: 1,
    include: [{ everyone: {} }],
  });
  step(`policy "bypass" created for ${domain} (the API asks for a personal access token)`);
}
console.log(`\nDone. Claude connects to https://${domain} with a personal token (Profile > Claude in the app).`);

function step(text) {
  console.log(`>> ${text}`);
}
function fail(text) {
  console.error(text);
  process.exit(1);
}
