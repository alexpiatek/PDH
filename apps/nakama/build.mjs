import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist/pdh.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2019'],
  logLevel: 'info',
};

if (watch) {
  const ctx = await context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(buildOptions);
}
