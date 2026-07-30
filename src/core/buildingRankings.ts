import type {
  BuildingEconomicImpactSummary,
  ImpactHorizon,
  ImpactMetricPair,
} from "../models/impactTypes";
import type {
  BuildingFunction,
  DetailedBuilding,
} from "../models/entityTypes";

export interface CurrentBuildingRanking {
  buildingId: string;
  buildingName: string;
  buildingFunction: BuildingFunction;
  outputDaily: number;
  inactive: boolean;
}

export interface ImpactBuildingRanking {
  buildingId: string;
  buildingName: string;
  buildingFunction: BuildingFunction;
  status: BuildingEconomicImpactSummary["status"];
  output: ImpactMetricPair;
}

export function rankBuildingsByCurrentOutput(
  buildings: readonly DetailedBuilding[],
): CurrentBuildingRanking[] {
  return buildings
    .map((building) => ({
      buildingId: building.id,
      buildingName: building.name,
      buildingFunction: building.function,
      outputDaily: building.accounting.operatingRevenue,
      inactive:
        building.developmentStage === "construction" ||
        building.accounting.status === "closed" ||
        building.accounting.operatingRevenue <= 0,
    }))
    .sort(
      (left, right) =>
        Number(left.inactive) - Number(right.inactive) ||
        right.outputDaily - left.outputDaily ||
        left.buildingName.localeCompare(right.buildingName) ||
        left.buildingId.localeCompare(right.buildingId),
    );
}

export function rankBuildingsByLatestImpact(
  buildings: readonly BuildingEconomicImpactSummary[],
  horizon: ImpactHorizon,
): ImpactBuildingRanking[] {
  return buildings
    .map((building) => ({
      buildingId: building.buildingId,
      buildingName: building.buildingName,
      buildingFunction: building.buildingFunction,
      status: building.status,
      output: building.horizons[horizon],
    }))
    .sort(
      (left, right) =>
        Math.abs(right.output.delta) - Math.abs(left.output.delta) ||
        left.buildingName.localeCompare(right.buildingName) ||
        left.buildingId.localeCompare(right.buildingId),
    );
}
