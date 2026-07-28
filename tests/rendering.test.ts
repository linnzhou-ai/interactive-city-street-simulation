import { describe, expect, it } from "vitest";
import {
  isVisiblePedestrianSegment,
  isVisibleVehicleSegment,
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
