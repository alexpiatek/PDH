import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function deploymentScope(paths) {
  const dependencies = paths.some(
    (path) =>
      /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc|\.pnpmfile\.cjs)$/.test(
        path
      ) || path.startsWith('patches/')
  );
  const backend =
    dependencies ||
    paths.some((path) =>
      /^(apps\/(nakama|server)\/|packages\/|docker-compose\.prod\.yml$|tsconfig\.base\.json$)/.test(
        path
      )
    );
  return { dependencies, backend };
}

export function scopeBetween(previous, next, cwd = process.cwd()) {
  // Include both sides of renames so moving a server file cannot look web-only.
  const paths = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', previous, next, '--'],
    {
      cwd,
      encoding: 'utf8',
    }
  )
    .split('\0')
    .filter(Boolean);
  return deploymentScope(paths);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [previous, next] = process.argv.slice(2);
  if (!previous || !next) throw new Error('Previous and next deployment revisions are required');
  const scope = scopeBetween(previous, next);
  console.log(`${Number(scope.dependencies)} ${Number(scope.backend)}`);
}
