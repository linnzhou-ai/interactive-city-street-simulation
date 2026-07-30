import { describe, expect, it } from "vitest";
import {
  insetSegmentLength,
  sceneLightingHour,
} from "../src/rendering/threeRenderer";

describe("scene lighting hour", () => {
  it("follows the simulation clock when the brightness cycle is enabled", () => {
    expect(sceneLightingHour(7.5, true)).toBe(7.5);
    expect(sceneLightingHour(25, true)).toBe(1);
  });

  it("uses fixed daytime lighting when the brightness cycle is disabled", () => {
    expect(sceneLightingHour(2, false)).toBe(12);
    expect(sceneLightingHour(19, false)).toBe(12);
  });
});

describe("road marking geometry", () => {
  it("removes markings from both ends of an intersection approach", () => {
    expect(insetSegmentLength(100, 11.4)).toBeCloseTo(77.2);
    expect(insetSegmentLength(18, 11.4)).toBe(0.01);
  });
});
