import { describe, it, expect } from "vitest";
import { deriveDeliveryResult } from "@/lib/report/deliveryResult";

describe("deriveDeliveryResult", () => {
  it("returns delivered when there's no cancellation record at all", () => {
    expect(deriveDeliveryResult([])).toBe("delivered");
  });

  it("maps a single cancellation type directly", () => {
    expect(deriveDeliveryResult(["cancelled"])).toBe("cancelled");
    expect(deriveDeliveryResult(["delivery_failed"])).toBe("delivery_failed");
    expect(deriveDeliveryResult(["returned_refunded"])).toBe("returned_refunded");
  });

  // Confirmed precedence: returned_refunded > delivery_failed > cancelled.
  it("prefers returned_refunded over the other two", () => {
    expect(deriveDeliveryResult(["cancelled", "returned_refunded"])).toBe("returned_refunded");
    expect(deriveDeliveryResult(["delivery_failed", "returned_refunded"])).toBe("returned_refunded");
    expect(deriveDeliveryResult(["cancelled", "delivery_failed", "returned_refunded"])).toBe("returned_refunded");
  });

  it("prefers delivery_failed over cancelled when returned_refunded is absent", () => {
    expect(deriveDeliveryResult(["cancelled", "delivery_failed"])).toBe("delivery_failed");
  });
});
