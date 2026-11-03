import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deploymentScope, scopeBetween } from './deployment-scope.mjs';

test('website assets, copy and deploy tooling retain installed dependencies and game server', () => {
  assert.deepEqual(
    deploymentScope([
      'apps/web/components/HeroSection.tsx',
      'apps/web/public/brand/coastal-hero.jpg',
      'scripts/deploy-tested.sh',
      'scripts/deployment-scope.mjs',
      'docs/PROD_RUNBOOK.md',
    ]),
    { dependencies: false, backend: false }
  );
});

test('dependency inputs require an install and server activation, including deleted manifests', () => {
  for (const path of [
    'package.json',
    'apps/web/package.json',
    'packages/protocol/package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    '.npmrc',
    '.pnpmfile.cjs',
    'patches/fix.patch',
  ]) {
    assert.deepEqual(deploymentScope([path]), { dependencies: true, backend: true }, path);
  }
});

test('server, shared engine, protocol and compose changes activate the backend', () => {
  for (const path of [
    'apps/nakama/src/main.ts',
    'packages/engine/src/hand.ts',
    'packages/protocol/src/index.ts',
    'docker-compose.prod.yml',
    'tsconfig.base.json',
  ]) {
    assert.deepEqual(deploymentScope([path]), { dependencies: false, backend: true }, path);
  }
});

test('invalid revisions fail closed instead of being classified as a website-only release', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'pdh-deploy-scope-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd });
    writeFileSync(join(cwd, 'README.md'), 'test\n');
    execFileSync('git', ['add', 'README.md'], { cwd });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        'commit',
        '--quiet',
        '-m',
        'initial',
      ],
      { cwd }
    );
    assert.deepEqual(scopeBetween('HEAD', 'HEAD', cwd), { dependencies: false, backend: false });
    assert.throws(() => scopeBetween('HEAD', 'missing-revision', cwd));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
