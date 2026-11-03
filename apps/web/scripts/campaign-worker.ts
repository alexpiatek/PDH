import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
require(
  require.resolve('@next/env', { paths: [dirname(require.resolve('next/package.json'))] })
).loadEnvConfig(webRoot);

async function main() {
  const { processCampaignBatch } = await import('../lib/campaignServer');
  let stopping = false;
  process.on('SIGTERM', () => {
    stopping = true;
  });
  process.on('SIGINT', () => {
    stopping = true;
  });
  do {
    try {
      await processCampaignBatch();
    } catch {
      console.error('Campaign worker unavailable; check database and campaign SMTP configuration.');
    }
    if (process.argv.includes('--once')) break;
    if (!stopping) await new Promise((resolve) => setTimeout(resolve, 60000));
  } while (!stopping);
  const { getEarlyAccessPool } = await import('../lib/earlyAccessServer');
  await getEarlyAccessPool()?.end();
}
void main();
