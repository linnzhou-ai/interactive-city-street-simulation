import { describe, expect, it } from "vitest";
import { sceneLightingHour } from "../src/rendering/threeRenderer";

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
