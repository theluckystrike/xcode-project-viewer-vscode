import XCTest
@testable import ZovoDemo

final class TripStoreTests: XCTestCase {
    func testTrips() { XCTAssertEqual(TripStore().trips.count, 3) }
}
