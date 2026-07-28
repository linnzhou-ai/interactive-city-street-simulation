import { describe, expect, it } from "vitest";
import {
  driverSpeedFactor,
  laneDirectionAllowsMovement,
  physicalLaneCount,
  safeIntersectionApproachSpeed,
  sampleComplianceProbability,
  vehicleMayProceed,
  vehicleMayProceedWithBehavior,
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

  it("samples a high-skew individual compliance distribution", () => {
    expect(sampleComplianceProbability(0)).toBeCloseTo(0.7);
    expect(sampleComplianceProbability(0.5)).toBeCloseTo(0.9625);
    expect(sampleComplianceProbability(1)).toBe(1);
  });

  it("makes speeding an individual probabilistic decision", () => {
    expect(driverSpeedFactor(0.95, 0.5, 0.5)).toBeLessThan(1);
    expect(driverSpeedFactor(0.75, 0.9, 0.5)).toBeGreaterThan(1);
  });

  it("allows rare risky signal behavior without bypassing all-red", () => {
    expect(
      vehicleMayProceedWithBehavior("ew-yellow", "x", 14, 4, true, false),
    ).toBe(true);
    expect(
      vehicleMayProceedWithBehavior("ns-green", "x", 8, 4, false, true),
    ).toBe(true);
    expect(
      vehicleMayProceedWithBehavior("all-red", "x", 3, 4, true, true),
    ).toBe(false);
    expect(
      vehicleMayProceedWithBehavior(
        "pedestrian-walk",
        "x",
        3,
        4,
        true,
        true,
      ),
    ).toBe(false);
  });
});
