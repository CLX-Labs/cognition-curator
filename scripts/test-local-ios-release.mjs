import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { iosIdentity, verifyIosArchive, readSigningProfile } from './local-ios-release.mjs';

const hash = 'b'.repeat(40);
async function artifact(t, change = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'recollect-ipa-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'app.ipa');
  await writeFile(archive, 'signed test artifact');
  const info = {
    CFBundleIdentifier: iosIdentity.bundleIdentifier,
    CFBundleShortVersionString: '7.0.0',
    CFBundleVersion: '8',
    DTPlatformName: 'iphoneos',
    ...change.info,
  };
  const updates = {
    EXUpdatesEnabled: true,
    EXUpdatesRuntimeVersion: hash,
    EXUpdatesURL: `https://u.expo.dev/${iosIdentity.projectId}`,
    EXUpdatesRequestHeaders: { 'expo-channel-name': 'testflight' },
    ...change.updates,
  };
  const provision = {
    TeamIdentifier: [iosIdentity.teamId],
    ExpirationDate: '2099-01-01T00:00:00Z',
    Entitlements: {
      'application-identifier': `${iosIdentity.teamId}.${iosIdentity.bundleIdentifier}`,
      'get-task-allow': false,
    },
    ...change.provision,
  };
  const commands = [];
  const run = async (command, args) => {
    commands.push([command, ...args]);
    if (command.endsWith('/ditto')) {
      await mkdir(join(args.at(-1), 'Payload', 'Recollect.app'), { recursive: true });
      if (change.embeddedFingerprint !== undefined) {
        const bundle = join(args.at(-1), 'Payload', 'Recollect.app', 'EXUpdates.bundle');
        await mkdir(bundle);
        await writeFile(join(bundle, 'fingerprint'), change.embeddedFingerprint);
      }
    }
    if (command.endsWith('/plutil'))
      return {
        stdout: JSON.stringify(
          basename(args.at(-1)) === 'Info.plist'
            ? info
            : basename(args.at(-1)) === 'Expo.plist'
              ? updates
              : provision,
        ),
      };
    if (command.endsWith('/python3')) return { stdout: JSON.stringify(provision) };
    if (command.endsWith('/codesign') && args.includes('--display'))
      return { stderr: `TeamIdentifier=${change.team || iosIdentity.teamId}\n` };
    return { stdout: '<plist/>', stderr: '' };
  };
  return { archive, run, commands };
}

test('actual artifact verifier checks code signature and store provisioning before returning archive digest', async (t) => {
  const f = await artifact(t);
  assert.deepEqual(
    await verifyIosArchive(
      f.archive,
      { nativeVersion: '7.0.0', runtimeVersion: hash },
      { run: f.run },
    ),
    {
      buildNumber: '8',
      archiveSha256: createHash('sha256').update('signed test artifact').digest('hex'),
    },
  );
  assert.ok(
    f.commands.some(
      (args) => args.includes('--verify') && args.includes('--deep') && args.includes('--strict'),
    ),
  );
  assert.ok(f.commands.some((args) => args[0] === '/usr/bin/security'));
});

test('artifact verifier refuses a wrong runtime, different Apple team, or development provisioning', async (t) => {
  for (const change of [
    { updates: { EXUpdatesRuntimeVersion: 'wrong' } },
    { updates: { EXUpdatesEnabled: false } },
    { team: 'OTHERTEAM' },
    { provision: { ProvisionedDevices: ['device-id'] } },
    { provision: { ExpirationDate: undefined } },
  ]) {
    const f = await artifact(t, change);
    await assert.rejects(
      verifyIosArchive(f.archive, { nativeVersion: '7.0.0', runtimeVersion: hash }, { run: f.run }),
    );
  }
});

test('real plist date objects are decoded as UTC without plutil JSON conversion', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'recollect-profile-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'profile.plist');
  await writeFile(
    path,
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>ExpirationDate</key><date>2099-01-01T00:00:00Z</date>
<key>TeamIdentifier</key><array><string>KF8643NB33</string></array>
<key>Entitlements</key><dict><key>get-task-allow</key><false/></dict>
</dict></plist>`,
  );
  const profile = await readSigningProfile(path);
  assert.equal(Date.parse(profile.ExpirationDate), Date.parse('2099-01-01T00:00:00Z'));
  assert.deepEqual(profile.TeamIdentifier, ['KF8643NB33']);
  assert.equal(profile.ProvisionedDevices, false);
  assert.equal(profile.Entitlements['get-task-allow'], false);
});

test('SDK 57 file:fingerprint runtime is read from the signed resource bundle and fails closed if absent or different', async (t) => {
  const f = await artifact(t, {
    updates: { EXUpdatesRuntimeVersion: 'file:fingerprint' },
    embeddedFingerprint: hash,
  });
  const expected = { nativeVersion: '7.0.0', runtimeVersion: hash };
  assert.equal((await verifyIosArchive(f.archive, expected, { run: f.run })).buildNumber, '8');
  for (const embeddedFingerprint of [undefined, 'c'.repeat(40), hash + '\n']) {
    const bad = await artifact(t, {
      updates: { EXUpdatesRuntimeVersion: 'file:fingerprint' },
      embeddedFingerprint,
    });
    await assert.rejects(verifyIosArchive(bad.archive, expected, { run: bad.run }));
  }
});
