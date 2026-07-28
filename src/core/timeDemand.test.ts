import { describe, expect, it } from "vitest";
import {
  getTimeDemandAdjustment,
  getTimeViolationRiskMultiplier,
} from "./simulation";

describe("time-of-day demand", () => {
  it("raises traffic during commute peaks", () => {
    expect(getTimeDemandAdjustment(8).vehicle).toBeGreaterThan(0);
    expect(getTimeDemandAdjustment(17.5).vehicle).toBeGreaterThan(0);
  });

  it("raises walking demand at lunch and reduces demand overnight", () => {
    expect(getTimeDemandAdjustment(12).pedestrian).toBeGreaterThan(0);
    expect(getTimeDemandAdjustment(2).pedestrian).toBeLessThan(0);
    expect(getTimeDemandAdjustment(2).vehicle).toBeLessThan(0);
  });

  it("raises traffic-law violation risk after dark", () => {
    expect(getTimeViolationRiskMultiplier(13)).toBe(1);
    expect(getTimeViolationRiskMultiplier(21)).toBeGreaterThan(1);
    expect(getTimeViolationRiskMultiplier(2)).toBe(1.8);
  });
});
