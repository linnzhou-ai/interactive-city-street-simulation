import { describe, expect, it } from "vitest";
import { PENN_BUILDINGS } from "../data/pennBuildings";
import type {
  ImpactProjectionRequest,
} from "../models/impactTypes";
import { Simulation } from "./simulation";
import { projectCityEditImpact } from "./impactProjection";
import type { EditorSnapshot } from "./projectState";

const emptyDesign = (): EditorSnapshot => ({
  designs: [],
  buildings: [],
  demolishedBuildingIds: [],
  expansionRoads: [],
  expansionStreetObjects: [],
  nextBuildingId: 1,
  nextExpansionRoadId: 1,
  nextExpansionStreetObjectId: 1,
});

function request(
  beforeDesign: EditorSnapshot,
  afterDesign: EditorSnapshot,
  trackedBuildingIds: string[] = [],
  interventionCapitalCost = 0,
): ImpactProjectionRequest {
  const simulation = new Simulation();
  return {
    requestId: 1,
    editLabel: "Test edit",
    checkpoint: {
      city: structuredClone(simulation.getState().city),
      entities: structuredClone(simulation.getState().entities),
      settings: { ...simulation.getSettings() },
      municipalProjectSpending: 0,
    },
    beforeDesign,
    afterDesign,
    interventionCapitalCost,
    trackedBuildingIds,
  };
}

describe("projectCityEditImpact", () => {
  it(
    "produces zero deltas for identical control and intervention cities",
    () => {
      const design = emptyDesign();
      const impact = projectCityEditImpact(request(design, design));

      for (const horizon of [30, 90, 365] as const) {
        expect(
          impact.horizons[horizon].metrics.dailyOutput.delta,
        ).toBe(0);
        expect(
          impact.horizons[horizon].metrics.trafficCostDaily.delta,
        ).toBe(0);
        expect(
          impact.horizons[horizon].metrics.governmentFunds.delta,
        ).toBe(0);
        expect(
          impact.buildingSummaries.every(
            (building) => building.horizons[horizon].delta === 0,
          ),
        ).toBe(true);
      }
    },
    30_000,
  );

  it(
    "retains a demolished tracked building and projects its output at zero",
    () => {
      const building = PENN_BUILDINGS.find(
        (candidate) => candidate.function === "industrial",
      ) ?? PENN_BUILDINGS[0]!;
      const before = emptyDesign();
      const after = {
        ...emptyDesign(),
        demolishedBuildingIds: [building.id],
      };
      const impact = projectCityEditImpact(
        request(before, after, [building.id]),
      );
      const projection = impact.buildings[0]!;

      expect(projection.buildingId).toBe(building.id);
      expect(projection.status).toBe("removed");
      expect(
        projection.horizons[90].metrics.primaryOutput.after,
      ).toBe(0);
      expect(
        projection.horizons[90].metrics.staffing.after,
      ).toBe(0);
      const summary = impact.buildingSummaries.find(
        (candidate) => candidate.buildingId === building.id,
      );
      expect(summary?.status).toBe("removed");
      expect(summary?.horizons[90].after).toBe(0);
    },
    30_000,
  );

  it(
    "includes road capital and recurring maintenance in municipal projections",
    () => {
      const before = emptyDesign();
      const after = {
        ...emptyDesign(),
        expansionRoads: [
          {
            id: "impact-test-road",
            name: "Hamilton Avenue",
            startX: -100,
            startZ: 0,
            endX: 100,
            endZ: 0,
            width: 15,
          },
        ],
      };
      const capitalCost = 520_000;
      const impact = projectCityEditImpact(
        request(before, after, [], capitalCost),
      );

      expect(
        impact.horizons[30].metrics.publicConstruction.delta,
      ).toBe(capitalCost);
      expect(
        impact.horizons[30].metrics.maintenanceCostDaily.delta,
      ).toBeGreaterThan(0);
      expect(
        impact.horizons[30].metrics.governmentFunds.delta,
      ).toBeLessThan(-capitalCost);
    },
    30_000,
  );

  it(
    "treats a new tracked building as absent from the control",
    () => {
      const before = emptyDesign();
      const buildingId = "placed-building-17";
      const after = {
        ...emptyDesign(),
        buildings: [
          {
            id: buildingId,
            kind: "industrial" as const,
            function: "industrial" as const,
            x: 40,
            z: 40,
            rotation: 0,
            floors: 4,
            color: "#8d6a54",
          },
        ],
      };
      const impact = projectCityEditImpact(
        request(before, after, [buildingId]),
      );
      const projection = impact.buildings[0]!;

      expect(projection.status).toBe("added");
      expect(
        projection.horizons[30].metrics.operatingCost.before,
      ).toBe(0);
      expect(
        projection.horizons[30].metrics.operatingCost.after,
      ).toBeGreaterThanOrEqual(0);
      const summary = impact.buildingSummaries.find(
        (candidate) => candidate.buildingId === buildingId,
      );
      expect(summary?.status).toBe("added");
      expect(summary?.horizons[30].before).toBe(0);
    },
    30_000,
  );
});
