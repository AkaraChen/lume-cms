import { spawn } from 'node:child_process';

const port = 31_000 + Math.floor(Math.random() * 1_000);
const origin = `http://127.0.0.1:${port}`;
const markers = ['UNPUBLISHED_TITLE_KIT_614', 'UNPUBLISHED_BODY_SENTINEL_KIT_614'];
const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
server.stdout.on('data', (chunk) => { logs += chunk; });
server.stderr.on('data', (chunk) => { logs += chunk; });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  const body = await response.text();
  for (const marker of markers) {
    if (body.includes(marker)) throw new Error(`${path} leaked ${marker}`);
  }
  return { status: response.status, body };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) { ready = true; break; }
    } catch {}
    if (server.exitCode !== null) break;
    await delay(100);
  }
  if (!ready) throw new Error(`Next.js server failed to start:\n${logs}`);

  const publicRoutes = [
    '/docs',
    '/api/search?query=UNPUBLISHED_TITLE_KIT_614',
    '/llms.txt',
    '/llms-full.txt',
    '/rss.xml',
    '/sitemap.xml',
  ];
  for (const path of publicRoutes) {
    const result = await request(path);
    if (result.status !== 200) throw new Error(`${path} returned ${result.status}`);
  }

  const hiddenRoutes = [
    ['/docs/scheduled'],
    ['/llms.mdx/docs/scheduled/content.md'],
    ['/docs/scheduled', { headers: { Accept: 'text/markdown' } }],
    ['/og/docs/scheduled/image.png'],
  ];
  for (const [path, init] of hiddenRoutes) {
    const result = await request(path, init);
    if (result.status < 400) throw new Error(`${path} unexpectedly returned ${result.status}`);
  }

  console.log('Verified seven Fumadocs read paths plus RSS and sitemap; no unpublished marker leaked.');
} finally {
  server.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => server.once('exit', resolve)),
    delay(5_000).then(() => server.kill('SIGKILL')),
  ]);
}
