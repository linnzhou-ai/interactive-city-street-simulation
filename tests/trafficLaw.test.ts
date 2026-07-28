import { describe, expect, it } from "vitest";
import {
  laneDirectionAllowsMovement,
  physicalLaneCount,
  safeIntersectionApproachSpeed,
  vehicleMayProceed,
} from "../src/core/liveTraffic";

describe("Pennsylvania traffic-law behavior", () => {
  it("stops on red and only proceeds on the matching green", () => {
    expect(vehicleMayProceed("all-red", "x", 8, 5)).toBe(false);
    expect(vehicleMayProceed("ns-green", "x", 8, 5)).toBe(false);
    expect(vehicleMayProceed("ew-green", "x", 8, 5)).toBe(true);
  });

  it("uses the yellow-light dilemma-zone rule", () => {
    expect(vehicleMayProceed("ew-yellow", "x", 20, 4)).toBe(false);
    expect(vehicleMayProceed("ew-yellow", "x", 4, 12)).toBe(true);
  });

  it("reduces speed on the immediate approach to an intersection", () => {
    const desiredSpeed = 25 * 0.44704;
    expect(safeIntersectionApproachSpeed(desiredSpeed, 40)).toBe(desiredSpeed);
    expect(safeIntersectionApproachSpeed(desiredSpeed, 10)).toBeLessThan(
      desiredSpeed,
    );
  });

  it("obeys configured one-way travel", () => {
    expect(laneDirectionAllowsMovement("two-way", true)).toBe(true);
    expect(laneDirectionAllowsMovement("two-way", false)).toBe(true);
    expect(laneDirectionAllowsMovement("forward", true)).toBe(true);
    expect(laneDirectionAllowsMovement("forward", false)).toBe(false);
    expect(laneDirectionAllowsMovement("reverse", false)).toBe(true);
  });

  it("turns an added lane into a second physical through lane", () => {
    expect(physicalLaneCount(0)).toBe(1);
    expect(physicalLaneCount(1)).toBe(2);
    expect(physicalLaneCount(-1)).toBe(1);
  });
});
