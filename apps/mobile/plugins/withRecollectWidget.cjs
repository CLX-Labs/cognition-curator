const fs = require('node:fs');
const path = require('node:path');
const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');

const TARGET = 'CognitionCuratorWidget';
const BUNDLE = 'collect.software.cognition-curator.CognitionCuratorWidget';
const GROUP = 'group.collect.software.cognition-curator';
const unquote = (value) => String(value ?? '').replace(/^"|"$/g, '');

function configureProject(project, config) {
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency ||= {};
  objects.PBXContainerItemProxy ||= {};
  let uuid = Object.keys(project.pbxNativeTargetSection()).find(
    (key) =>
      !key.endsWith('_comment') && unquote(project.pbxNativeTargetSection()[key].name) === TARGET,
  );
  if (!uuid) {
    const target = project.addTarget(TARGET, 'app_extension', TARGET, BUNDLE);
    uuid = target.uuid;
    project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', uuid);
    project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', uuid);
    project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', uuid);
  }

  let groupKey = project.findPBXGroupKey({ name: TARGET });
  if (!groupKey) {
    const group = project.addPbxGroup([], TARGET);
    groupKey = group.uuid;
    const main = project.getPBXGroupByKey(project.getFirstProject().firstProject.mainGroup);
    main.children.push({ value: group.uuid, comment: TARGET });
  }
  // File references already include TARGET; keep this group relative to the project root.
  // node-xcode serializes an omitted addPbxGroup path as the literal 'undefined'.
  delete project.getPBXGroupByKey(groupKey).path;
  for (const file of ['CognitionCuratorWidget.swift', 'WidgetSnapshot.swift']) {
    const filePath = `${TARGET}/${file}`;
    if (!project.hasFile(filePath)) project.addSourceFile(filePath, { target: uuid }, groupKey);
  }
  const privacyPath = `${TARGET}/PrivacyInfo.xcprivacy`;
  if (!project.hasFile(privacyPath)) {
    // node-xcode's addResourceFile assumes a global Resources group, which Expo's template does not have.
    const resource = project.addFile(privacyPath, groupKey);
    resource.uuid = project.generateUuid();
    resource.target = uuid;
    project.addToPbxBuildFileSection(resource);
    project.addToPbxResourcesBuildPhase(resource);
  }
  for (const file of ['Info.plist', `${TARGET}.entitlements`]) {
    const filePath = `${TARGET}/${file}`;
    if (!project.hasFile(filePath)) project.addFile(filePath, groupKey);
  }

  const target = project.pbxNativeTargetSection()[uuid];
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configurations = project.pbxXCBuildConfigurationSection();
  for (const item of list.buildConfigurations) {
    Object.assign(configurations[item.value].buildSettings, {
      PRODUCT_BUNDLE_IDENTIFIER: `"${BUNDLE}"`,
      PRODUCT_NAME: `"${TARGET}"`,
      INFOPLIST_FILE: `"${TARGET}/Info.plist"`,
      CODE_SIGN_ENTITLEMENTS: `"${TARGET}/${TARGET}.entitlements"`,
      GENERATE_INFOPLIST_FILE: 'NO',
      CODE_SIGN_STYLE: 'Automatic',
      IPHONEOS_DEPLOYMENT_TARGET: '18.4',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
      APPLICATION_EXTENSION_API_ONLY: 'YES',
      CLANG_ENABLE_MODULES: 'YES',
      SKIP_INSTALL: 'YES',
      MARKETING_VERSION: config.version || '2.0.0',
      CURRENT_PROJECT_VERSION: config.ios?.buildNumber || '1',
      ...(config.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {}),
    });
  }
  // Xcode's generated embed build file must preserve normal extension-copy attributes.
  for (const entry of Object.values(project.pbxBuildFileSection())) {
    if (entry && typeof entry === 'object' && entry.fileRef === target.productReference) {
      entry.settings = { ATTRIBUTES: ['RemoveHeadersOnCopy'] };
    }
  }
  return project;
}

function withRecollectWidget(config) {
  if (config.ios?.bundleIdentifier !== 'collect.software.cognition-curator') {
    throw new Error('The legacy widget plugin requires the original Recollect bundle identity.');
  }
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.security.application-groups'] = [
      ...new Set([...(mod.modResults['com.apple.security.application-groups'] || []), GROUP]),
    ];
    return mod;
  });
  // EAS needs extension entitlements before prebuild to provision both targets.
  config.extra ||= {};
  config.extra.eas ||= {};
  config.extra.eas.build ||= {};
  config.extra.eas.build.experimental ||= {};
  config.extra.eas.build.experimental.ios ||= {};
  const ios = config.extra.eas.build.experimental.ios;
  ios.appExtensions = [
    ...(ios.appExtensions || []).filter((extension) => extension.targetName !== TARGET),
    {
      targetName: TARGET,
      bundleIdentifier: BUNDLE,
      entitlements: { 'com.apple.security.application-groups': [GROUP] },
    },
  ];
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      const source = path.join(mod.modRequest.projectRoot, 'modules', 'recollect-widget');
      const destination = path.join(mod.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(destination, { recursive: true });
      for (const file of ['CognitionCuratorWidget.swift', 'Info.plist', `${TARGET}.entitlements`]) {
        fs.copyFileSync(path.join(source, 'widget', file), path.join(destination, file));
      }
      for (const file of ['WidgetSnapshot.swift', 'PrivacyInfo.xcprivacy']) {
        fs.copyFileSync(path.join(source, 'ios', file), path.join(destination, file));
      }
      return mod;
    },
  ]);
  return withXcodeProject(config, (mod) => {
    mod.modResults = configureProject(mod.modResults, mod);
    return mod;
  });
}

module.exports = withRecollectWidget;
module.exports.configureProject = configureProject;
