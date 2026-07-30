import { describe, expect, it } from "vitest";
import type {
  BuildingEconomicImpactSummary,
  ImpactMetricPair,
} from "../models/impactTypes";
import type { DetailedBuilding } from "../models/entityTypes";
import { Simulation } from "./simulation";
import {
  rankBuildingsByCurrentOutput,
  rankBuildingsByLatestImpact,
} from "./buildingRankings";

function building(
  index: number,
  name: string,
  outputDaily: number,
): DetailedBuilding {
  const source = new Simulation().getState().entities.buildings[index]!;
  const result = structuredClone(source);
  result.name = name;
  result.accounting.operatingRevenue = outputDaily;
  return result;
}

function pair(before: number, after: number): ImpactMetricPair {
  const delta = after - before;
  return {
    before,
    after,
    delta,
    percentDelta: before === 0 ? null : delta / before * 100,
  };
}

function summary(
  buildingId: string,
  buildingName: string,
  output: ImpactMetricPair,
): BuildingEconomicImpactSummary {
  return {
    buildingId,
    buildingName,
    buildingFunction: "office",
    status: "active",
    horizons: {
      30: output,
      90: output,
      365: output,
    },
  };
}

describe("building rankings", () => {
  it("ranks active buildings by current output with deterministic ties", () => {
    const alpha = building(0, "Alpha Hall", 400);
    const beta = building(1, "Beta Hall", 400);
    const inactive = building(2, "Closed Hall", 0);
    inactive.accounting.status = "closed";

    const ranking = rankBuildingsByCurrentOutput([
      beta,
      inactive,
      alpha,
    ]);

    expect(ranking.map((row) => row.buildingName)).toEqual([
      "Alpha Hall",
      "Beta Hall",
      "Closed Hall",
    ]);
    expect(ranking.at(-1)?.inactive).toBe(true);
  });

  it("ranks latest impacts by absolute output change", () => {
    const ranking = rankBuildingsByLatestImpact(
      [
        summary("small-gain", "Small gain", pair(100, 120)),
        summary("large-loss", "Large loss", pair(300, 210)),
        summary("medium-gain", "Medium gain", pair(100, 150)),
      ],
      90,
    );

    expect(ranking.map((row) => row.buildingId)).toEqual([
      "large-loss",
      "medium-gain",
      "small-gain",
    ]);
  });
});
