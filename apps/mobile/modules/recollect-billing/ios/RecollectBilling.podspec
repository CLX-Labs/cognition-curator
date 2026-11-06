Pod::Spec.new do |s|
  s.name = 'RecollectBilling'
  s.version = '0.1.0'
  s.summary = 'StoreKit 2 transaction delivery for Recollect generation tokens.'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'Collect Software'
  s.homepage = 'https://github.com/CLX-Labs/cognition-curator'
  s.source = { :git => '' }
  s.platforms = { :ios => '18.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'
  s.source_files = '*.swift'
  s.resource_bundles = { 'RecollectBillingPrivacy' => ['PrivacyInfo.xcprivacy'] }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
