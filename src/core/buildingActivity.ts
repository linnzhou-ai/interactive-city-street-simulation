import type { PlacedBuilding } from "../models/types";

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
  building: Pick<PlacedBuilding, "kind" | "floors">,
): BuildingRoleStats {
  const floors = Math.max(1, Math.min(20, Math.round(building.floors)));
  if (building.kind === "residential") {
    return {
      residents: floors * 14,
      jobs: floors,
      dailyVisitors: floors * 2,
      dailyFreightTrips: Math.ceil(floors / 4),
    };
  }
  if (building.kind === "commercial") {
    return {
      residents: 0,
      jobs: floors * 18,
      dailyVisitors: floors * 90,
      dailyFreightTrips: floors * 3,
    };
  }
  if (building.kind === "industrial") {
    return {
      residents: 0,
      jobs: floors * 10,
      dailyVisitors: floors * 4,
      dailyFreightTrips: floors * 16,
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
  buildings: readonly Pick<PlacedBuilding, "kind" | "floors">[],
): BuildingActivitySummary {
  const summary = { ...EMPTY_BUILDING_ACTIVITY };
  for (const building of buildings) {
    const role = deriveBuildingRole(building);
    summary.residents += role.residents;
    summary.jobs += role.jobs;
    summary.dailyVisitors += role.dailyVisitors;
    summary.dailyFreightTrips += role.dailyFreightTrips;
  }
  summary.vehicleDemandBoost = Math.min(
    1,
    summary.residents / 180 +
      summary.jobs / 300 +
      summary.dailyFreightTrips / 120,
  );
  summary.pedestrianDemandBoost = Math.min(
    1,
    summary.residents / 350 + summary.dailyVisitors / 600,
  );
  return summary;
}
