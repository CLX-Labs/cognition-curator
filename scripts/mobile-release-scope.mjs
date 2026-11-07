import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const mobilePath = 'apps/mobile';
const rootManifestFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
  'peerDependenciesMeta', 'overrides', 'resolutions', 'workspaces', 'engines', 'packageManager', 'config'];
const rootBuildFiles = new Set(['tsconfig.base.json', '.nvmrc', '.node-version', '.npmrc', '.yarnrc',
  '.easignore', '.gitignore', '.gitattributes',
  '.yarnrc.yml', '.pnp.cjs', '.pnp.loader.mjs', 'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'bun.lock', 'bun.lockb', 'babel.config.js', 'babel.config.cjs', 'babel.config.mjs',
  'metro.config.js', 'metro.config.cjs', 'metro.config.mjs']);

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));

export function rootManifestChanged(before, after) {
  const buildHooks = (manifest) => Object.fromEntries(Object.entries(manifest.scripts ?? {}).filter(([name]) =>
    /^(?:(?:pre|post)?install|(?:pre|post)?prepare|(?:pre|post)?publish|prepublishOnly|prepack|postpack|dependencies)$/.test(name) ||
    name.startsWith('eas-build-')));
  return rootManifestFields.some((field) => !same(before[field], after[field])) ||
    !same(buildHooks(before), buildHooks(after));
}

function safePath(path) {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') ||
    posix.normalize(path) !== path || path.split('/').includes('..')) throw new Error('Invalid package-lock path.');
  return path;
}

function dependencyEntries(record, workspace) {
  const required = { ...record.dependencies, ...(workspace ? record.devDependencies : {}) };
  const optional = { ...record.optionalDependencies };
  for (const [name, version] of Object.entries(record.peerDependencies ?? {})) {
    if (record.peerDependenciesMeta?.[name]?.optional) optional[name] ??= version;
    else required[name] ??= version;
  }
  // Optional dependencies can override a dependency of the same name.
  return [...new Set([...Object.keys(required), ...Object.keys(optional)])].sort().map((name) => {
    if (!/^(?:@[a-zA-Z0-9_.~-]+\/)?[a-zA-Z0-9_.~-]+$/.test(name)) throw new Error('Invalid dependency name in package-lock.');
    return { name, optional: Object.hasOwn(optional, name) };
  });
}

function resolveDependency(packages, from, name) {
  let directory = from;
  while (true) {
    if (posix.basename(directory) !== 'node_modules') {
      const candidate = posix.join(directory, 'node_modules', name);
      if (Object.hasOwn(packages, candidate)) return candidate;
    }
    if (!directory || directory === '.') return null;
    const parent = posix.dirname(directory);
    directory = parent === '.' ? '' : parent;
  }
}

/** Npm lock v3 records reachable from the app, including nested installs and workspace links. */
export function mobileDependencySnapshot(lock) {
  if (lock?.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object' ||
    !lock.packages[''] || !lock.packages[mobilePath]) throw new Error('A complete npm lockfile v3 is required to determine mobile release scope.');
  const records = new Map();
  const workspaces = new Set();
  const visit = (path) => {
    safePath(path);
    if (records.has(path)) return;
    const record = lock.packages[path];
    if (!record || typeof record !== 'object') throw new Error('Missing reachable dependency in package-lock.');
    // Hoisting/dev/optional bookkeeping can change after an unrelated backend update.
    // Version, integrity, resolved source, dependency edges, platform and build metadata remain compared.
    const { dev, optional, devOptional, ...relevant } = record;
    records.set(path, relevant);
    if (record.link) {
      const target = safePath(record.resolved);
      visit(target);
      return;
    }
    const workspace = !path.split('/').includes('node_modules');
    if (workspace) workspaces.add(path);
    for (const dependency of dependencyEntries(record, workspace)) {
      const target = resolveDependency(lock.packages, path, dependency.name);
      if (target) visit(target);
      else if (!dependency.optional) throw new Error('A required mobile dependency is missing from package-lock.');
    }
  };
  visit(mobilePath);
  return { records: Object.fromEntries([...records.entries()].sort(([a], [b]) => a.localeCompare(b))),
    workspaces: [...workspaces].sort() };
}

export function isDocumentationOrTest(path) {
  return path.split('/').some((part) => ['test', 'tests', '__tests__', '__snapshots__', 'docs', 'coverage'].includes(part)) ||
    /(?:^|\/)(?:readme|changelog|license|contributing)(?:\.[^/]*)?$/i.test(path) ||
    /\.(?:test|spec)\.[^/]+$/.test(path) || /\.(?:md|mdx|rst)$/.test(path);
}

export function classifyChangedPaths(paths, workspacePaths) {
  const roots = new Set([mobilePath, ...workspacePaths]);
  return paths.some((path) => rootBuildFiles.has(path) || path.startsWith('.yarn/') ||
    [...roots].some((root) => path.startsWith(`${root}/`) && !isDocumentationOrTest(path) &&
      path !== `${mobilePath}/eas.json` && !path.startsWith(`${mobilePath}/.eas/workflows/`)));
}

export function createGitReader(cwd = process.cwd()) {
  return async (...args) => (await exec('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;
}

async function readJson(run, sha, path) {
  try { return JSON.parse(await run('show', `${sha}:${path}`)); }
  catch { throw new Error(`Cannot read valid ${path} at the release comparison commit.`); }
}

/** Invalid or unavailable history throws: uncertainty must never silently skip a release. */
export async function determineMobileRelease(env, { run = createGitReader() } = {}) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Mobile release scope must run on main.');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || /^0+$/.test(env.GITHUB_SHA)) throw new Error('A full nonzero GITHUB_SHA is required.');
  await run('cat-file', '-e', `${env.GITHUB_SHA}^{commit}`);
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') return { releaseRequired: true, reason: 'Explicit manual mobile release.' };
  if (env.GITHUB_EVENT_NAME !== 'push') throw new Error('Unsupported event for mobile release scope.');
  const before = env.GITHUB_EVENT_BEFORE;
  if (!/^[a-f0-9]{40}$/.test(before ?? '')) throw new Error('A full push before SHA is required.');
  const initial = /^0+$/.test(before);
  if (!initial) await run('cat-file', '-e', `${before}^{commit}`);
  const paths = (initial ? await run('ls-tree', '-r', '--name-only', '-z', env.GITHUB_SHA) :
    await run('diff', '--name-only', '--no-renames', '-z', before, env.GITHUB_SHA, '--')).split('\0').filter(Boolean);
  const afterLock = await readJson(run, env.GITHUB_SHA, 'package-lock.json');
  const afterSnapshot = mobileDependencySnapshot(afterLock);
  if (initial) return { releaseRequired: true, reason: 'Initial main push contains the mobile app.' };
  const beforeLock = await readJson(run, before, 'package-lock.json');
  const beforeSnapshot = mobileDependencySnapshot(beforeLock);
  if (classifyChangedPaths(paths, [...beforeSnapshot.workspaces, ...afterSnapshot.workspaces]))
    return { releaseRequired: true, reason: 'Mobile app, shared mobile code, or build configuration changed.' };
  if (paths.includes(`${mobilePath}/eas.json`)) {
    try {
      const [beforeEas, afterEas] = await Promise.all([
        readJson(run, before, `${mobilePath}/eas.json`), readJson(run, env.GITHUB_SHA, `${mobilePath}/eas.json`),
      ]);
      if (!same(beforeEas.build, afterEas.build))
        return { releaseRequired: true, reason: 'Mobile build profiles changed.' };
    } catch {
      // Addition, deletion, or invalid configuration cannot safely be classified as submit-only.
      return { releaseRequired: true, reason: 'Mobile build configuration changed.' };
    }
  }
  if (paths.includes('package.json')) {
    const [beforeManifest, afterManifest] = await Promise.all([
      readJson(run, before, 'package.json'), readJson(run, env.GITHUB_SHA, 'package.json'),
    ]);
    if (rootManifestChanged(beforeManifest, afterManifest))
      return { releaseRequired: true, reason: 'Root dependency or build configuration changed.' };
  }
  if (!same(beforeSnapshot.records, afterSnapshot.records))
    return { releaseRequired: true, reason: 'A dependency reachable from the mobile app changed.' };
  return { releaseRequired: false, reason: 'No mobile app, shared mobile code, or mobile dependency changes.' };
}

export async function writeScopeResult(result, env = process.env) {
  // Only fixed strings and a boolean are emitted: filenames never become workflow commands or Markdown.
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `release_required=${result.releaseRequired}\n`);
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY,
    `Mobile release: **${result.releaseRequired ? 'required' : 'skipped'}**. ${result.reason}\n`);
  console.log(`Mobile release ${result.releaseRequired ? 'required' : 'skipped'}: ${result.reason}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await writeScopeResult(await determineMobileRelease(process.env)); }
  catch (error) {
    // Never expose untrusted git output or allow an uncertain comparison to pass as a skip.
    console.error('Cannot safely determine mobile release scope. Check the main push SHAs, full git history and npm lockfile.');
    process.exitCode = 1;
  }
}
