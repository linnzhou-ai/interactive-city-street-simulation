import type { PlacedBuilding } from "../models/types";
import { functionForPlacedBuilding } from "./expansionEconomy";

export interface BuildingRoleStats {
  residents: number;
  jobs: number;
  dailyVisitors: number;
  dailyFreightTrips: number;
}

export interface BuildingActivitySummary extends BuildingRoleStats {
  vehicleDemandBoost: number;
  pedestrianDemandBoost: number;
}

export const EMPTY_BUILDING_ACTIVITY: BuildingActivitySummary = {
  residents: 0,
  jobs: 0,
  dailyVisitors: 0,
  dailyFreightTrips: 0,
  vehicleDemandBoost: 0,
  pedestrianDemandBoost: 0,
};

export function deriveBuildingRole(
  building: Pick<PlacedBuilding, "kind" | "function" | "floors">,
): BuildingRoleStats {
  const floors = Math.max(1, Math.min(20, Math.round(building.floors)));
  const buildingFunction = functionForPlacedBuilding(building);
  if (buildingFunction === "housing") {
    return {
      residents: floors * 14,
      jobs: floors,
      dailyVisitors: floors * 2,
      dailyFreightTrips: Math.ceil(floors / 4),
    };
  }
  if (buildingFunction === "retail") {
    return {
      residents: 0,
      jobs: floors * 18,
      dailyVisitors: floors * 90,
      dailyFreightTrips: floors * 3,
    };
  }
  if (buildingFunction === "industrial") {
    return {
      residents: 0,
      jobs: floors * 10,
      dailyVisitors: floors * 4,
      dailyFreightTrips: floors * 16,
    };
  }
  if (buildingFunction === "office") {
    return {
      residents: 0,
      jobs: floors * 20,
      dailyVisitors: floors * 12,
      dailyFreightTrips: Math.ceil(floors / 2),
    };
  }
  if (buildingFunction === "parking") {
    return {
      residents: 0,
      jobs: Math.max(1, Math.ceil(floors / 3)),
      dailyVisitors: floors * 80,
      dailyFreightTrips: 0,
    };
  }
  return {
    residents: 0,
    jobs: floors * 12,
    dailyVisitors: floors * 65,
    dailyFreightTrips: floors,
  };
}

export function summarizeBuildingActivity(
  buildings: readonly Pick<PlacedBuilding, "kind" | "function" | "floors">[],
): BuildingActivitySummary {
  const summary = { ...EMPTY_BUILDING_ACTIVITY };
  for (const building of buildings) {
    const role = deriveBuildingRole(building);
    summary.residents += role.residents;
    summary.jobs += role.jobs;
    summary.dailyVisitors += role.dailyVisitors;
    summary.dailyFreightTrips += role.dailyFreightTrips;
  }
  // Traffic is generated from detailed work, visit, and delivery connections.
  summary.vehicleDemandBoost = 0;
  summary.pedestrianDemandBoost = 0;
  return summary;
}
