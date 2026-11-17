import SwiftUI

struct ContentView: View {
    @State private var store = TripStore()
    var body: some View {
        List(store.trips, id: \.self) { Text($0) }
    }
}
