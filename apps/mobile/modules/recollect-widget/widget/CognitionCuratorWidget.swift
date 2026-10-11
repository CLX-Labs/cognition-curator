import AppIntents
import SwiftUI
import WidgetKit

private struct ReviewEntry: TimelineEntry {
  let date: Date
  let snapshot: RecollectWidgetSnapshot?
}

private struct ReviewProvider: TimelineProvider {
  func placeholder(in context: Context) -> ReviewEntry { ReviewEntry(date: Date(), snapshot: nil) }
  func getSnapshot(in context: Context, completion: @escaping (ReviewEntry) -> Void) {
    completion(ReviewEntry(date: Date(), snapshot: RecollectWidgetStore.read()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<ReviewEntry>) -> Void) {
    let now = Date()
    completion(Timeline(entries: [ReviewEntry(date: now, snapshot: RecollectWidgetStore.read())], policy: .after(now.addingTimeInterval(900))))
  }
}

private struct ReviewWidgetView: View {
  let entry: ReviewEntry
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Image(systemName: "brain.head.profile")
        Text("Recollect").fontWeight(.semibold)
        Spacer()
        if let snapshot = entry.snapshot { Text("\(snapshot.dueCount) due").font(.caption).foregroundStyle(.secondary) }
      }
      if let card = entry.snapshot?.topCard {
        Text(card.question).font(.headline).lineLimit(5).minimumScaleFactor(0.8).privacySensitive()
        Spacer(minLength: 0)
        Text(card.deckName).font(.caption).foregroundStyle(.secondary).lineLimit(1).privacySensitive()
      } else {
        Text(entry.snapshot == nil ? "Open Recollect to sign in" : "Ready for your next review").font(.headline)
        Spacer(minLength: 0)
        Text("Tap to study").font(.caption).foregroundStyle(.secondary)
      }
    }
    .containerBackground(Color(.systemBackground), for: .widget)
    .widgetURL(URL(string: entry.snapshot?.topCard.map { "cognitioncurator://review/\($0.id)" } ?? "cognitioncurator://review"))
  }
}

struct CognitionCuratorWidget: Widget {
  // Existing installed widgets identify this kind; do not rename during migration.
  let kind = "CognitionCuratorWidget"
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: ReviewProvider()) { ReviewWidgetView(entry: $0) }
      .configurationDisplayName("Flashcard Review")
      .description("Open your next review and see your latest due count.")
      .supportedFamilies([.systemSmall, .systemMedium])
  }
}

struct CognitionCuratorWidgetControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "CognitionCuratorWidgetControl", provider: CountProvider()) { count in
      ControlWidgetButton(action: LaunchReviewIntent()) {
        Label(count > 0 ? "\(count) due" : "Study", systemImage: "brain.head.profile")
      }
    }
    .displayName("Review Cards")
    .description("Open Recollect to review flashcards.")
  }

  struct CountProvider: ControlValueProvider {
    var previewValue: Int { 5 }
    func currentValue() async throws -> Int { RecollectWidgetStore.read()?.dueCount ?? 0 }
  }
}

struct LaunchReviewIntent: AppIntent {
  static let title: LocalizedStringResource = "Launch Flashcard Review"
  static let description = IntentDescription("Opens the app to review flashcards")
  static let openAppWhenRun = true
  func perform() async throws -> some IntentResult {
    if let url = URL(string: "cognitioncurator://review") { try await OpenURLIntent(url).perform() }
    return .result()
  }
}

@main
struct CognitionCuratorWidgetBundle: WidgetBundle {
  var body: some Widget {
    CognitionCuratorWidget()
    CognitionCuratorWidgetControl()
  }
}
