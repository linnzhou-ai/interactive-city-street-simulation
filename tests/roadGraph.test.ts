import { describe, expect, it } from "vitest";
import { PENN_ROAD_GRAPH } from "../src/data/pennRoadGraph";

describe("Penn road graph", () => {
  it("stores named road geometry in Philadelphia coordinates", () => {
    const walnut = PENN_ROAD_GRAPH.find((feature) => feature.id === "walnut-34-36");

    expect(walnut).toMatchObject({
      name: "Walnut Street",
      description: "Between 34th Street and 36th Street",
      kind: "street",
    });
    expect(walnut?.path).toHaveLength(2);
    expect(walnut?.path[0].longitude).toBeLessThan(-75);
    expect(walnut?.path[0].latitude).toBeGreaterThan(39);
  });

  it("keeps streets and intersections as structured features", () => {
    const streets = PENN_ROAD_GRAPH.filter((feature) => feature.kind === "street");
    const intersections = PENN_ROAD_GRAPH.filter(
      (feature) => feature.kind === "intersection",
    );

    expect(streets.length).toBeGreaterThanOrEqual(40);
    expect(intersections.length).toBe(99);
    expect(PENN_ROAD_GRAPH.find((feature) => feature.id === "38-spruce")?.name).toBe(
      "38th & Spruce",
    );
  });
});
