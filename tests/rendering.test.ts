import { describe, expect, it } from "vitest";
import {
  calculateDaylight,
  colorForVisualLayer,
  flowForConnection,
  isVisiblePedestrianSegment,
  isVisibleVehicleSegment,
  resolveLightingTime,
  resolveSceneDetailMode,
  valueForVisualLayer,
  type VisualLayer,
  type VisualLayerMetrics,
} from "../src/rendering/threeRenderer";

describe("vehicle rendering", () => {
  it("displays vehicles only while their exact position is on a public road", () => {
    expect(isVisibleVehicleSegment("access-building-home-road-out")).toBe(false);
    expect(isVisibleVehicleSegment("bus-west-eastbound-out")).toBe(false);
    expect(isVisibleVehicleSegment("road-west-approach")).toBe(true);
    expect(isVisibleVehicleSegment("movement-west-straight")).toBe(true);
  });

  it("displays pedestrians after they leave private building access links", () => {
    expect(isVisiblePedestrianSegment("access-building-home-walk-out")).toBe(false);
    expect(isVisiblePedestrianSegment("sidewalk-west-n-out")).toBe(true);
    expect(isVisiblePedestrianSegment("crosswalk-north-center-out")).toBe(true);
  });
});

describe("scene inspection modes", () => {
  it("uses aggregate city detail only beyond the distant zoom threshold", () => {
    expect(resolveSceneDetailMode(205, false)).toBe("street");
    expect(resolveSceneDetailMode(205.01, false)).toBe("city");
  });

  it("forces entity detail whenever an object is selected", () => {
    expect(resolveSceneDetailMode(230, true)).toBe("entity");
    expect(resolveSceneDetailMode(40, true)).toBe("entity");
  });
});

describe("simulation daylight", () => {
  it("follows the displayed local hour and seasonal sunrise window", () => {
    const winterNoon = calculateDaylight(12 * 60, 1);
    const winterMidnight = calculateDaylight(0, 1);
    const summer = calculateDaylight(12 * 60, 6);

    expect(winterNoon.daylight).toBeCloseTo(1);
    expect(winterMidnight.daylight).toBe(0.04);
    expect(winterNoon.sunriseMinutes).toBeGreaterThan(7 * 60);
    expect(summer.sunriseMinutes).toBeLessThan(6 * 60);
    expect(summer.sunsetMinutes).toBeGreaterThan(18 * 60);
  });

  it("keeps the simulation clock but fixes lighting at midday when the cycle is disabled", () => {
    expect(resolveLightingTime(23 * 60, true)).toBe(23 * 60);
    expect(resolveLightingTime(23 * 60, false)).toBe(12 * 60);
  });
});

describe("inspection flow controls", () => {
  it("maps each modeled building connection to its independent flow toggle", () => {
    expect(flowForConnection("commute")).toBe("commute");
    expect(flowForConnection("customer")).toBe("customer");
    expect(flowForConnection("supply")).toBe("supply");
  });
});

describe("visual layer values", () => {
  const metrics: VisualLayerMetrics = {
    congestion: 0.11,
    pedestrianWait: 0.22,
    landValue: 0.33,
    utilities: 0.44,
    jobs: 0.55,
    shortages: 0.66,
    migration: 0.77,
    freight: 0.88,
    profit: 0.99,
  };

  it.each<[VisualLayer, number]>([
    ["none", 0.5],
    ["congestion", 0.11],
    ["pedestrian-wait", 0.22],
    ["land-value", 0.33],
    ["utilities", 0.44],
    ["jobs", 0.55],
    ["shortages", 0.66],
    ["migration", 0.77],
    ["freight", 0.88],
    ["profit", 0.99],
  ])("reads the %s score from deterministic scene metrics", (layer, expected) => {
    expect(valueForVisualLayer(layer, metrics)).toBe(expected);
  });

  it("uses distinct low and high colors and clamps values to the layer range", () => {
    expect(colorForVisualLayer("congestion", 0)).not.toBe(colorForVisualLayer("congestion", 1));
    expect(colorForVisualLayer("utilities", 0)).not.toBe(colorForVisualLayer("utilities", 1));
    expect(colorForVisualLayer("congestion", -3)).toBe(colorForVisualLayer("congestion", 0));
    expect(colorForVisualLayer("profit", 4)).toBe(colorForVisualLayer("profit", 1));
  });
});
