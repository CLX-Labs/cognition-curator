import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const xcode = require('xcode');
const plist = require('@expo/plist').default;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ios = path.join(root, 'apps/mobile/ios');
const projectFile = path.join(ios, 'RecollectAI.xcodeproj/project.pbxproj');
assert(
  fs.existsSync(projectFile),
  'Run Expo prebuild for iOS before checking native configuration.',
);
const project = xcode.project(projectFile);
project.parseSync();
const clean = (value) => String(value ?? '').replace(/^"|"$/g, '');
const targetEntries = Object.entries(project.pbxNativeTargetSection()).filter(
  ([key]) => !key.endsWith('_comment'),
);
const widget = targetEntries.filter(
  ([, target]) => clean(target.name) === 'CognitionCuratorWidget',
);
assert.equal(widget.length, 1, 'Exactly one legacy widget extension must be generated.');
const configurations = project.pbxXCBuildConfigurationSection();
for (const [name, bundle, entitlements] of [
  ['RecollectAI', 'collect.software.cognition-curator', 'RecollectAI/RecollectAI.entitlements'],
  [
    'CognitionCuratorWidget',
    'collect.software.cognition-curator.CognitionCuratorWidget',
    'CognitionCuratorWidget/CognitionCuratorWidget.entitlements',
  ],
]) {
  const entry = targetEntries.find(([, target]) => clean(target.name) === name);
  assert(entry, `Missing native target ${name}`);
  const list = project.pbxXCConfigurationList()[entry[1].buildConfigurationList];
  assert.equal(list.buildConfigurations.length, 2);
  for (const configuration of list.buildConfigurations) {
    const settings = configurations[configuration.value].buildSettings;
    assert.equal(
      clean(settings.PRODUCT_BUNDLE_IDENTIFIER),
      bundle,
      `${name}: bundle identity changed`,
    );
    assert.equal(
      clean(settings.CODE_SIGN_ENTITLEMENTS),
      entitlements,
      `${name}: missing signed entitlements`,
    );
    assert.equal(clean(settings.DEVELOPMENT_TEAM), 'KF8643NB33', `${name}: Apple team changed`);
    assert.equal(clean(settings.IPHONEOS_DEPLOYMENT_TARGET), '18.4');
  }
  const parsed = plist.parse(fs.readFileSync(path.join(ios, entitlements), 'utf8'));
  assert(
    parsed['com.apple.security.application-groups'].includes(
      'group.collect.software.cognition-curator',
    ),
  );
}
const appInfo = plist.parse(fs.readFileSync(path.join(ios, 'RecollectAI/Info.plist'), 'utf8'));
assert(
  appInfo.CFBundleURLTypes.some((entry) => entry.CFBundleURLSchemes.includes('cognitioncurator')),
);
const widgetInfo = plist.parse(
  fs.readFileSync(path.join(ios, 'CognitionCuratorWidget/Info.plist'), 'utf8'),
);
assert.equal(widgetInfo.NSExtension.NSExtensionPointIdentifier, 'com.apple.widgetkit-extension');
const projectText = fs.readFileSync(projectFile, 'utf8');
for (const source of [
  'CognitionCuratorWidget.swift in Sources',
  'WidgetSnapshot.swift in Sources',
]) {
  assert(projectText.includes(source), `Missing extension source or embedding: ${source}`);
}
const widgetGroup = project.getPBXGroupByKey(
  project.findPBXGroupKey({ name: 'CognitionCuratorWidget' }),
);
assert.equal(widgetGroup.path, undefined, 'Widget file paths must resolve from the project root.');
const widgetProduct = widget[0][1].productReference;
const embedFile = Object.entries(project.pbxBuildFileSection()).find(
  ([key, value]) => !key.endsWith('_comment') && value.fileRef === widgetProduct,
);
assert(embedFile, 'The widget product must have an embedding build file.');
const copies = Object.entries(project.hash.project.objects.PBXCopyFilesBuildPhase ?? {}).filter(
  ([key]) => !key.endsWith('_comment'),
);
const embedPhase = copies.find(
  ([, phase]) =>
    Number(phase.dstSubfolderSpec) === 13 &&
    phase.files.some((file) => file.value === embedFile[0]),
);
assert(embedPhase, 'The widget extension must be copied to the app PlugIns directory.');
const appTarget = targetEntries.find(([, target]) => clean(target.name) === 'RecollectAI')[1];
assert(
  appTarget.buildPhases.some((phase) => phase.value === embedPhase[0]),
  'The main application must embed the widget extension.',
);
const widgetSource = fs.readFileSync(
  path.join(ios, 'CognitionCuratorWidget/CognitionCuratorWidget.swift'),
  'utf8',
);
assert(
  widgetSource.includes('CognitionCuratorWidgetControl'),
  'Preserve the installed Control Center widget identity.',
);
const moduleConfig = JSON.parse(
  fs.readFileSync(
    path.join(root, 'apps/mobile/modules/legacy-storage/expo-module.config.json'),
    'utf8',
  ),
);
assert.equal(
  moduleConfig.apple.swiftModuleName,
  'cognition_curator',
  'The legacy SwiftData model module identity must be preserved.',
);
console.log(
  'Verified app/widget identities, Debug and Release entitlements, iOS target, deep links, source embedding, and legacy module identity.',
);
