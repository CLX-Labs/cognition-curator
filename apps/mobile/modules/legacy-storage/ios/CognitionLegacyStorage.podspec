Pod::Spec.new do |s|
  s.name = 'CognitionLegacyStorage'
  s.version = '0.1.0'
  s.summary = 'Protected, read-only recovery of the original Recollect SwiftData store.'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Collect Software'
  s.homepage = 'https://github.com/CLX-Labs/cognition-curator'
  s.source = { :git => '' }
  s.platforms = { :ios => '18.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  # Keep qualified SwiftData type identity from the original cognition.curator target.
  s.module_name = 'cognition_curator'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'SwiftData', 'CoreData', 'CryptoKit'
  s.libraries = 'sqlite3'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'CognitionLegacyStoragePrivacy' => ['PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
end
