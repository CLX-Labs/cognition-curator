// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "RecollectLegacyRecoveryTests",
  platforms: [.macOS(.v14), .iOS("18.4")],
  products: [.library(name: "LegacyRecoveryCore", targets: ["cognition_curator"])],
  targets: [
    .target(
      name: "cognition_curator",
      path: "ios",
      exclude: ["LegacyStorageModule.swift", "CognitionLegacyStorage.podspec", "PrivacyInfo.xcprivacy"],
      linkerSettings: [.linkedLibrary("sqlite3")]
    ),
    .testTarget(name: "LegacyStorageTests", dependencies: ["cognition_curator"], path: "tests")
  ]
)
