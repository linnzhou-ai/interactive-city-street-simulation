import { describe, expect, it } from "vitest";
import { getPhillyCrashRiskProfile } from "./phillyCrashProfile";

describe("Philadelphia crash risk profile", () => {
  it("matches the published PM-peak crash shares per hour", () => {
    const profile = getPhillyCrashRiskProfile(17);
    expect(profile).toEqual({
      period: "pm-peak",
      trafficMultiplier: 1.61,
      pedestrianMultiplier: 1.92,
    });
  });

  it("uses lower observed crash frequency overnight", () => {
    const night = getPhillyCrashRiskProfile(2);
    const pmPeak = getPhillyCrashRiskProfile(17);
    expect(night.trafficMultiplier).toBe(0.45);
    expect(night.pedestrianMultiplier).toBe(0.25);
    expect(night.pedestrianMultiplier).toBeLessThan(
      pmPeak.pedestrianMultiplier,
    );
  });

  it("wraps clock values onto a 24-hour day", () => {
    expect(getPhillyCrashRiskProfile(25)).toEqual(
      getPhillyCrashRiskProfile(1),
    );
  });
});
