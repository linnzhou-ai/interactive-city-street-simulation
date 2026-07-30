import { describe, expect, it } from "vitest";
import {
  LAW_VIOLATION_PROBABILITY,
  lawViolationForSample,
} from "../src/core/sampledMobility";

describe("sampled resident law violations", () => {
  it("uses one fixed 15% trip-level probability", () => {
    expect(LAW_VIOLATION_PROBABILITY).toBe(0.15);
    expect(lawViolationForSample(0)).toBe(true);
    expect(lawViolationForSample(0.1499)).toBe(true);
    expect(lawViolationForSample(0.15)).toBe(false);
    expect(lawViolationForSample(1)).toBe(false);
  });
});
