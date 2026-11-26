import { describe, expect, it } from "vitest";
import { fileUnderTracked, NOT_FILED_AS_TRACKED } from "../../src/engine/tracked.js";
import { snapshot } from "../../src/provider/snapshot.js";

// Made-up codes only.
const found = (trackingNumber: string) =>
  snapshot({ carrier: "fakepost", trackingNumber, status: "in_transit", rawStatus: "x" });

function run(codes: string[], trackingNumbers: string[]) {
  const warnings: string[] = [];
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (_context: Record<string, unknown>, message: string) => {
      warnings.push(message);
    },
  };
  const result = fileUnderTracked(
    "fakepost",
    codes,
    { snapshots: trackingNumbers.map(found), complete: false },
    logger,
  );
  return { result, warnings };
}

describe("filing lookup answers under the tracked code", () => {
  it("keeps answers already filed under an asked code, without a warning", () => {
    const { result, warnings } = run(["FP1", "FP2"], ["FP2"]);
    expect(result.snapshots.map((s) => s.trackingNumber)).toEqual(["FP2"]);
    expect(warnings).toEqual([]);
  });

  it("refiles a reformatted echo under the code asked, without a reference for a respelling", () => {
    const { result, warnings } = run(["fp 0001", "FP2"], ["FP-0001"]);
    // The same code spelled differently is no number of its own (OP-100).
    expect(result.snapshots[0]).toMatchObject({
      trackingNumber: "fp 0001",
      externalRef: null,
    });
    expect(warnings).toEqual([NOT_FILED_AS_TRACKED]);
  });

  it("refiles a different number under the only code asked, and drops it among several", () => {
    expect(run(["FP1"], ["SHIPMENT9"]).result.snapshots[0]).toMatchObject({
      trackingNumber: "FP1",
      externalRef: "SHIPMENT9",
    });
    const several = run(["FP1", "FP2"], ["SHIPMENT9"]);
    expect(several.result.snapshots).toEqual([]);
    expect(several.warnings).toEqual([NOT_FILED_AS_TRACKED]);
  });
});
