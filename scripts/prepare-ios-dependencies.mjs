import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const requireApp = createRequire(new URL('../apps/mobile/package.json', import.meta.url));
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const checksumPattern = /^[a-fA-F0-9]{64}$/;
const configurations = ['debug', 'release'];

export async function installedReactNativeVersion() {
  const packageFile = requireApp.resolve('react-native/package.json');
  const { version } = JSON.parse(await readFile(packageFile, 'utf8'));
  if (!stableVersion.test(version ?? '')) throw new Error('iOS prefetch requires an installed stable React Native version.');
  return version;
}

export function dependencyArtifact(version, configuration) {
  if (!stableVersion.test(version ?? '') || !configurations.includes(configuration))
    throw new Error('Expected a stable React Native version and debug or release configuration.');
  // Matches installed RN scripts/cocoapods/rndependencies.rb. Preserve its
  // official Maven source and follow only HTTPS redirects from that source.
  const artifact = `react-native-artifacts-${version}-reactnative-dependencies-${configuration}.tar.gz`;
  return {
    url: `https://repo1.maven.org/maven2/com/facebook/react/react-native-artifacts/${version}/${artifact}`,
    filename: `reactnative-dependencies-${version}-${configuration}.tar.gz`,
  };
}

async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function retry(stage, work, { pause, log }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await work(); }
    catch {
      // Do not surface child-process output or redirect URLs in CI logs.
      if (attempt === 3) throw new Error(`${stage} failed after 3 bounded attempts; no unverified archive was cached.`);
      log(`${stage}: retrying (${attempt}/3).`);
      await pause(attempt * 1_000);
    }
  }
}

export async function prepareIosDependencies({
  configuration = 'all',
  version,
  cacheDir = join(homedir(), 'Library', 'Caches', 'ReactNative'),
  run = exec,
  pause = sleep,
  log = console.log,
} = {}) {
  if (![...configurations, 'all'].includes(configuration))
    throw new Error('Use --configuration debug, release, or all.');
  version ??= await installedReactNativeVersion();
  const selected = configuration === 'all' ? configurations : [configuration];
  const results = [];
  for (const kind of selected) {
    const { url, filename } = dependencyArtifact(version, kind);
    const stage = `React Native ${version} ${kind}`;
    const baseArgs = ['--fail', '--silent', '--show-error', '--location',
      '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10', '--retry', '0'];
    const expected = await retry(`${stage} SHA-256 metadata`, async () => {
      const response = await run('curl', [...baseArgs, '--max-time', '20', `${url}.sha256`],
        { timeout: 25_000, maxBuffer: 64 * 1024, killSignal: 'SIGKILL' });
      const checksum = response.stdout.trim();
      if (!checksumPattern.test(checksum)) throw new Error('Official SHA-256 metadata was missing or malformed.');
      return checksum.toLowerCase();
    }, { pause, log });
    await mkdir(cacheDir, { recursive: true });
    const cachePath = join(cacheDir, filename);
    let cached;
    try { cached = await lstat(cachePath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (cached) {
      if (!cached.isFile()) throw new Error('React Native cache entry must be a regular file.');
      if (await sha256File(cachePath) === expected) {
        log(`${stage}: verified existing cache.`);
        results.push({ version, configuration: kind, cachePath, sha256: expected, downloaded: false });
        continue;
      }
      // Never let CocoaPods consume an already detected partial/corrupt cache.
      await rm(cachePath);
    }
    const temporary = await mkdtemp(join(cacheDir, '.recollect-prefetch-'));
    const download = join(temporary, filename);
    try {
      await retry(`${stage} archive`, async () => {
        await rm(download, { force: true });
        await run('curl', [...baseArgs, '--max-time', '55', '--output', download, url],
          { timeout: 60_000, maxBuffer: 64 * 1024, killSignal: 'SIGKILL' });
        if (await sha256File(download) !== expected) throw new Error('Downloaded artifact checksum mismatch.');
      }, { pause, log });
      // Download and final cache live on the same filesystem. Publish only the
      // complete file whose bytes match the official SHA-256 metadata.
      await rename(download, cachePath);
      log(`${stage}: downloaded and verified cache.`);
      results.push({ version, configuration: kind, cachePath, sha256: expected, downloaded: true });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--configuration'))
      throw new Error('Usage: node scripts/prepare-ios-dependencies.mjs [--configuration debug|release|all]');
    // RN 0.86 downloads both variants during pod installation, independently of
    // the chosen Xcode configuration. `all` avoids either unbounded pod download.
    await prepareIosDependencies({ configuration: args[1] ?? 'all' });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
