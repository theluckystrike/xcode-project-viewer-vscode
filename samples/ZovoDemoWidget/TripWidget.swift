import WidgetKit
import SwiftUI

struct TripWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "TripWidget", provider: TripProvider()) { _ in Text("Next trip") }
    }
}
