import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
export const iosIdentity = {
  projectId: '2d6f42f7-8c17-4f27-9c69-7ce868abdb74',
  bundleIdentifier: 'collect.software.cognition-curator',
  teamId: 'KF8643NB33',
  profile: 'testflight',
  channel: 'testflight',
};
const hashPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export async function readSigningProfile(path, { run = exec } = {}) {
  // plutil cannot convert plist date objects to JSON. Decode only the public
  // distribution attributes needed here, normalizing Apple's UTC expiry date.
  const script = `import datetime,json,plistlib,sys
p=plistlib.load(open(sys.argv[1],'rb'))
expiry=p.get('ExpirationDate')
print(json.dumps({'TeamIdentifier':p.get('TeamIdentifier'),'Entitlements':p.get('Entitlements'),
'ExpirationDate':expiry.replace(tzinfo=datetime.timezone.utc).isoformat() if isinstance(expiry,datetime.datetime) else None,
'ProvisionedDevices':'ProvisionedDevices' in p,'ProvisionsAllDevices':p.get('ProvisionsAllDevices',False)}))`;
  return JSON.parse(
    (await run('/usr/bin/python3', ['-c', script, path], { maxBuffer: 1024 * 1024 })).stdout,
  );
}

export function validLocalRuntimeProof(proof, record, { hash, nativeVersion } = {}) {
  return (
    !!proof &&
    proof.schema === 1 &&
    proof.delivery === 'local-ios-store-upload' &&
    record.kind === 'native' &&
    record.version === record.nativeVersion &&
    proof.commit === record.commit &&
    proof.nativeVersion === record.nativeVersion &&
    Object.entries(iosIdentity).every(([key, value]) => proof[key] === value) &&
    hashPattern.test(proof.runtimeVersion ?? '') &&
    /^[a-f0-9]{64}$/.test(proof.archiveSha256 ?? '') &&
    /^\d+(?:\.\d+){0,2}$/.test(proof.buildNumber ?? '') &&
    Number.isFinite(Date.parse(proof.uploadedAt)) &&
    (!hash || proof.runtimeVersion === hash) &&
    (!nativeVersion || proof.nativeVersion === nativeVersion)
  );
}

// Verify the actual signed artifact, not the intended app configuration. Nothing
// from the decoded provisioning profile or signing commands is printed.
export async function verifyIosArchive(archive, expected, { run = exec } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'recollect-verify-ipa-'));
  try {
    const execute = async (command, args) => run(command, args, { maxBuffer: 8 * 1024 * 1024 });
    await execute('/usr/bin/ditto', ['-x', '-k', archive, dir]);
    const apps = (await readdir(join(dir, 'Payload'))).filter((name) => name.endsWith('.app'));
    if (apps.length !== 1) throw new Error('Expected one signed iOS application.');
    const app = join(dir, 'Payload', apps[0]);
    const plist = async (path) =>
      JSON.parse((await execute('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path])).stdout);
    const info = await plist(join(app, 'Info.plist'));
    const updates = await plist(join(app, 'Expo.plist'));
    let runtimeVersion = updates.EXUpdatesRuntimeVersion;
    if (runtimeVersion === 'file:fingerprint') {
      // Expo SDK 57 resolves this sentinel from its signed resource bundle.
      // Our static-pod configuration puts EXUpdates.bundle in the main app;
      // a framework build puts it inside the corresponding framework instead.
      const candidates = [
        join(app, 'EXUpdates.bundle', 'fingerprint'),
        join(app, 'Frameworks', 'EXUpdates.framework', 'EXUpdates.bundle', 'fingerprint'),
      ];
      const fingerprints = [];
      for (const candidate of candidates) {
        try {
          fingerprints.push(await readFile(candidate, 'utf8'));
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      if (fingerprints.length !== 1)
        throw new Error('Expected one embedded Expo runtime fingerprint.');
      runtimeVersion = fingerprints[0];
    }
    if (
      info.CFBundleIdentifier !== iosIdentity.bundleIdentifier ||
      info.CFBundleShortVersionString !== expected.nativeVersion ||
      !/^\d+(?:\.\d+){0,2}$/.test(info.CFBundleVersion ?? '') ||
      info.DTPlatformName !== 'iphoneos' ||
      updates.EXUpdatesEnabled !== true ||
      runtimeVersion !== expected.runtimeVersion ||
      updates.EXUpdatesURL !== `https://u.expo.dev/${iosIdentity.projectId}` ||
      updates.EXUpdatesRequestHeaders?.['expo-channel-name'] !== iosIdentity.channel
    )
      throw new Error(
        'Signed iOS artifact identity, version, or update runtime does not match the release.',
      );
    await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const signature = await execute('/usr/bin/codesign', ['--display', '--verbose=4', app]);
    if (!new RegExp(`^TeamIdentifier=${iosIdentity.teamId}$`, 'm').test(signature.stderr ?? ''))
      throw new Error('Signed iOS artifact belongs to a different Apple team.');
    const profile = await execute('/usr/bin/security', [
      'cms',
      '-D',
      '-i',
      join(app, 'embedded.mobileprovision'),
    ]);
    // plutil reads stdin with `-`; execFile has no input option, so use the
    // decoded XML only to check its small public signing entitlements.
    const profilePath = join(dir, 'profile.plist');
    await writeFile(profilePath, profile.stdout);
    const provision = await readSigningProfile(profilePath, { run });
    if (
      !provision.TeamIdentifier?.includes(iosIdentity.teamId) ||
      provision.Entitlements?.['application-identifier'] !==
        `${iosIdentity.teamId}.${iosIdentity.bundleIdentifier}` ||
      provision.Entitlements?.['get-task-allow'] !== false ||
      provision.ProvisionedDevices ||
      provision.ProvisionsAllDevices ||
      !Number.isFinite(Date.parse(provision.ExpirationDate)) ||
      Date.parse(provision.ExpirationDate) <= Date.now()
    )
      throw new Error('iOS artifact does not have a current App Store distribution profile.');
    return {
      buildNumber: info.CFBundleVersion,
      archiveSha256: createHash('sha256')
        .update(await readFile(archive))
        .digest('hex'),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
