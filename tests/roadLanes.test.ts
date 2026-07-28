import { describe, expect, it } from "vitest";
import {
  chooseLane,
  createRoadSegmentModel,
  isDrivableLane,
  ROAD_SEGMENTS,
} from "../src/data/roadLanes";
import { PENN_ROAD_GRAPH } from "../src/data/pennRoadGraph";

describe("district road lane model", () => {
  it("models every street segment in the Penn road graph", () => {
    const streets = PENN_ROAD_GRAPH.filter((feature) => feature.kind === "street");

    expect(streets).toHaveLength(178);
    expect(ROAD_SEGMENTS).toHaveLength(streets.length);
    expect(new Set(ROAD_SEGMENTS.map((segment) => segment.id)).size).toBe(
      streets.length,
    );
  });

  it("gives arterials more capacity than local streets", () => {
    const market = ROAD_SEGMENTS.find(
      (segment) => segment.streetName === "Market Street",
    );
    const pine = ROAD_SEGMENTS.find(
      (segment) => segment.streetName === "Pine Street",
    );

    expect(market?.roadClass).toBe("major-arterial");
    expect(pine?.roadClass).toBe("local");
    expect(market!.travelLaneCount).toBeGreaterThan(pine!.travelLaneCount);
    expect(market!.demandWeight).toBeGreaterThan(pine!.demandWeight);
  });

  it("represents one-way streets and protected non-driving lanes explicitly", () => {
    const chestnut = ROAD_SEGMENTS.find(
      (segment) => segment.streetName === "Chestnut Street",
    )!;
    const spruce = ROAD_SEGMENTS.find(
      (segment) => segment.streetName === "Spruce Street",
    )!;

    expect(chestnut.directionality).toBe("forward");
    expect(
      chestnut.lanes.filter(isDrivableLane).every((lane) => lane.direction === "forward"),
    ).toBe(true);
    expect(spruce.lanes.some((lane) => lane.type === "bike")).toBe(true);
    expect(spruce.lanes.filter((lane) => lane.type === "bike").every(
      (lane) => !lane.spawnAllowed && !isDrivableLane(lane),
    )).toBe(true);
  });

  it("turning vehicles are assigned to movement-compatible lanes", () => {
    const feature = PENN_ROAD_GRAPH.find(
      (candidate) =>
        candidate.kind === "street" && candidate.name === "Market Street",
    )!;
    const model = createRoadSegmentModel(feature);
    const leftLane = chooseLane(model, "forward", "left", "sedan", 0.1);
    const rightLane = chooseLane(model, "forward", "right", "sedan", 0.8);

    expect(leftLane?.allowedMovements).toContain("left");
    expect(rightLane?.allowedMovements).toContain("right");
    expect(leftLane?.id).not.toBe(rightLane?.id);
  });

  it("rebuilds lane counts and direction from a Build-mode design", () => {
    const feature = PENN_ROAD_GRAPH.find(
      (candidate) =>
        candidate.kind === "street" && candidate.name === "Pine Street",
    )!;
    const base = createRoadSegmentModel(feature);
    const edited = createRoadSegmentModel(feature, {
      laneDelta: 1,
      bikeLane: true,
      laneDirection: "reverse",
    });

    expect(edited.travelLaneCount).toBeGreaterThan(base.travelLaneCount);
    expect(edited.directionality).toBe("reverse");
    expect(edited.lanes.some((lane) => lane.type === "bike")).toBe(true);
    expect(edited.lanes.filter(isDrivableLane).every(
      (lane) => lane.direction === "reverse",
    )).toBe(true);
  });
});
