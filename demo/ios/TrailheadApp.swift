// Trailhead — a one-screen demo app for trying Pinpoint's iOS Simulator picker.
// Every element carries an accessibilityIdentifier, the way a real app's testIDs would, so a note
// made on it names something an agent can grep for. Built without an Xcode project:
//   bash demo/ios/run.sh
import SwiftUI

@main
struct TrailheadApp: App {
    var body: some Scene { WindowGroup { TripScreen() } }
}

struct TripScreen: View {
    @State private var day = 1
    @State private var guests = 2
    private let days = ["Fri 24", "Sat 25", "Sun 26"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    Text("Trailhead").font(.title2.bold()).accessibilityIdentifier("app-title")
                    Spacer()
                    Image(systemName: "person.crop.circle").font(.title2)
                        .accessibilityLabel("Account").accessibilityIdentifier("account-button")
                }

                VStack(alignment: .leading, spacing: 12) {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(LinearGradient(colors: [Color(red: 0.16, green: 0.42, blue: 0.33), Color(red: 0.55, green: 0.71, blue: 0.47)],
                                             startPoint: .topLeading, endPoint: .bottomTrailing))
                        .frame(height: 190)
                        .overlay(Image(systemName: "mountain.2.fill").font(.system(size: 64)).foregroundStyle(.white.opacity(0.9)))
                        .accessibilityLabel("Photo of the Granite Ridge loop").accessibilityIdentifier("trip-photo")
                    Text("Granite Ridge loop").font(.title.bold()).accessibilityIdentifier("trip-title")
                    HStack(spacing: 6) {
                        Image(systemName: "star.fill").foregroundStyle(.orange)
                        Text("4.8 · 312 reviews").foregroundStyle(.secondary)
                    }.accessibilityElement(children: .combine).accessibilityIdentifier("trip-rating")
                    Text("A two-day hike past three lakes, with a night at the ridge hut. Moderate, 18 km.")
                        .foregroundStyle(.secondary).accessibilityIdentifier("trip-summary")
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Start date").font(.headline)
                    Picker("Start date", selection: $day) {
                        ForEach(days.indices, id: \.self) { Text(days[$0]).tag($0) }
                    }.pickerStyle(.segmented).accessibilityIdentifier("date-picker")
                    Stepper("Guests: \(guests)", value: $guests, in: 1...8).accessibilityIdentifier("guest-stepper")
                }

                HStack(alignment: .firstTextBaseline) {
                    Text("$\(149 * guests)").font(.title2.bold()).accessibilityIdentifier("price-label")
                    Text("total").foregroundStyle(.secondary)
                    Spacer()
                }

                Button(action: {}) {
                    Text("Book this trip").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent).tint(Color(red: 0.16, green: 0.42, blue: 0.33))
                .accessibilityIdentifier("book-button")
            }
            .padding(20)
        }
    }
}
