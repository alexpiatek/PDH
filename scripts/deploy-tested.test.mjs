import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));

for (const failRestart of [false, true]) {
  test(
    `website activation ${failRestart ? 'rolls back after a restart failure' : 'succeeds'} without touching dependencies or Nakama`,
    { skip: process.platform === 'win32' },
    () => {
      const base = mkdtempSync(join(tmpdir(), 'pdh-deploy-test-'));
      const root = join(base, 'repo');
      const bin = join(base, 'bin');
      const log = join(base, 'commands.log');
      const put = (path, text, executable = false) => {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, { mode: executable ? 0o755 : 0o644 });
      };
      const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      try {
        mkdirSync(root);
        mkdirSync(bin);
        put(join(root, '.gitignore'), '.next\ndist\n');
        put(join(root, 'apps/web/page.txt'), 'previous');
        mkdirSync(join(root, 'scripts'));
        for (const file of ['deploy-tested.sh', 'deployment-scope.mjs']) {
          copyFileSync(join(scripts, file), join(root, 'scripts', file));
        }
        put(
          join(root, 'scripts/run-pnpm.sh'),
          `#!/usr/bin/env bash
set -eu
printf 'pnpm:%s:%s\\n' "$PWD" "$*" >> "$TEST_LOG"
if [[ "$1" == '-C' ]]; then
  target="$2/dist"
  [[ "$2" != 'apps/web' ]] || target="$2/.next"
  mkdir -p "$target"
  printf 'new' > "$target/version"
fi
`
        );
        put(join(bin, 'docker'), '#!/bin/sh\nprintf "docker:%s\\n" "$*" >> "$TEST_LOG"\n', true);
        put(join(bin, 'curl'), '#!/bin/sh\nexit 0\n', true);
        put(join(bin, 'flock'), '#!/bin/sh\nexit 0\n', true);
        put(
          join(bin, 'sudo'),
          `#!/bin/sh
printf 'sudo:%s\\n' "$*" >> "$TEST_LOG"
if [ "$TEST_FAIL_RESTART" = 1 ] && [ ! -f "$TEST_FAILED" ]; then
  touch "$TEST_FAILED"
  exit 1
fi
`,
          true
        );
        git('init', '--quiet');
        git('config', 'user.name', 'Deploy Test');
        git('config', 'user.email', 'test@example.com');
        git('add', '.');
        git('commit', '--quiet', '-m', 'previous');
        const previous = git('rev-parse', 'HEAD');
        put(join(root, 'apps/web/page.txt'), 'next');
        git('commit', '--quiet', '-am', 'website');
        const next = git('rev-parse', 'HEAD');
        git('update-ref', 'refs/remotes/origin/main', next);
        git('switch', '--quiet', '--detach', previous);
        for (const artifact of ['apps/web/.next', 'apps/nakama/dist', 'packages/engine/dist']) {
          put(join(root, artifact, 'version'), 'previous');
        }
        const result = spawnSync('bash', ['scripts/deploy-tested.sh', next], {
          cwd: root,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TEST_LOG: log,
            TEST_FAIL_RESTART: failRestart ? '1' : '0',
            TEST_FAILED: join(base, 'failed'),
          },
        });
        assert.equal(result.status === 0, !failRestart, result.stdout + result.stderr);
        assert.equal(git('rev-parse', 'HEAD'), failRestart ? previous : next);
        assert.equal(
          readFileSync(join(root, 'apps/web/.next/version'), 'utf8'),
          failRestart ? 'previous' : 'new'
        );
        for (const artifact of ['apps/nakama/dist', 'packages/engine/dist']) {
          assert.equal(readFileSync(join(root, artifact, 'version'), 'utf8'), 'previous');
        }
        const commands = readFileSync(log, 'utf8');
        assert.equal(commands.split('\n').filter((line) => line.includes(':install ')).length, 1);
        assert.ok(!commands.includes(`pnpm:${root}:install`), commands);
        assert.ok(!commands.includes('--force-recreate'), commands);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  );
}
