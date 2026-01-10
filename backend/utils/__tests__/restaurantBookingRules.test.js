const {
  isCapacityError,
  exceedsOnlinePartySize,
} = require("../restaurantBookingRules");

describe("restaurant booking rules", () => {
  test("isCapacityError detects capacity and allocation errors", () => {
    expect(isCapacityError(new Error("No capacity remaining for this slot."))).toBe(true);
    expect(isCapacityError(new Error("Online allocation for this slot is full."))).toBe(true);
    expect(isCapacityError(new Error("Capacity exceeded"))).toBe(true);
    expect(isCapacityError({ message: "allocation limit hit" })).toBe(true);
    expect(isCapacityError({ code: "MAX_ONLINE_PARTY_SIZE" })).toBe(true);
  });

  test("isCapacityError ignores non-capacity errors", () => {
    expect(isCapacityError(new Error("Booking time is required."))).toBe(false);
    expect(isCapacityError({ message: "" })).toBe(false);
  });

  test("exceedsOnlinePartySize respects online channel and limit", () => {
    const service = { max_online_party_size: 6 };
    expect(exceedsOnlinePartySize(service, 7, "online")).toBe(true);
    expect(exceedsOnlinePartySize(service, 6, "online")).toBe(false);
    expect(exceedsOnlinePartySize(service, 6, "internal")).toBe(false);
  });

  test("exceedsOnlinePartySize handles missing limits", () => {
    expect(exceedsOnlinePartySize({}, 10, "online")).toBe(false);
    expect(exceedsOnlinePartySize({ max_online_party_size: null }, 10, "online")).toBe(false);
  });
});
