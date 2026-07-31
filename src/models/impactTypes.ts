import type { EditorSnapshot } from "../core/projectState";
import type {
  BuildingFunction,
  DetailedEntityState,
} from "./entityTypes";
import type {
  CitySectionState,
} from "./cityTypes";
import type {
  ScenarioSettings,
} from "./types";

export type ImpactHorizon = 30 | 90 | 365;

export const IMPACT_HORIZONS: readonly ImpactHorizon[] = [30, 90, 365];

export interface ImpactProjectionCheckpoint {
  city: CitySectionState;
  entities: DetailedEntityState;
  settings: ScenarioSettings;
  municipalProjectSpending: number;
}

export interface ImpactMetricPair {
  before: number;
  after: number;
  delta: number;
  percentDelta: number | null;
  deltaRange: ImpactDeltaRange;
}

export interface ImpactDeltaRange {
  median: number;
  minimum: number;
  maximum: number;
}

export interface CityImpactMetrics {
  dailyOutput: number;
  unemploymentPercent: number;
  trafficCostDaily: number;
  annualizedNetMigration: number;
  governmentFunds: number;
  publicConstruction: number;
  jobs: number;
  businessProfitDaily: number;
  householdSpendingDaily: number;
  taxRevenueDaily: number;
  maintenanceCostDaily: number;
  averageLandValue: number;
  averageRentIndex: number;
  civicServiceCoveragePercent: number;
}

export interface CityImpactHorizon {
  horizonDays: ImpactHorizon;
  metrics: {
    [Key in keyof CityImpactMetrics]: ImpactMetricPair;
  };
  drivers: ImpactDriver[];
}

export interface ImpactDriver {
  label: string;
  before: number;
  after: number;
  delta: number;
  unit:
    | "currency"
    | "currency-per-day"
    | "percent"
    | "minutes"
    | "people"
    | "trips"
    | "units"
    | "score";
  lowerIsBetter?: boolean;
  deltaRange?: ImpactDeltaRange;
}

export interface BuildingImpactMetrics {
  primaryOutput: number;
  staffing: number;
  operatingScale: number;
  customers: number;
  serviceQuality: number;
  supplies: number;
  inventory: number;
  transportCost: number;
  operatingRevenue: number;
  operatingCost: number;
  profit: number;
  accessibility: number;
  routeDelayMinutes: number;
  landValue: number;
  rentDaily: number;
  residentIncome: number;
  rentBurdenPercent: number;
}

export interface BuildingImpactHorizon {
  horizonDays: ImpactHorizon;
  metrics: {
    [Key in keyof BuildingImpactMetrics]: ImpactMetricPair;
  };
  drivers: ImpactDriver[];
  affectedRoads: string[];
}

export interface BuildingImpactProjection {
  buildingId: string;
  buildingName: string;
  buildingFunction: BuildingFunction;
  status: "active" | "added" | "removed";
  primaryMetricLabel: string;
  horizons: Record<ImpactHorizon, BuildingImpactHorizon>;
}

export interface BuildingEconomicImpactSummary {
  buildingId: string;
  buildingName: string;
  buildingFunction: BuildingFunction;
  status: "active" | "added" | "removed";
  horizons: Record<ImpactHorizon, ImpactMetricPair>;
}

export interface CityEditImpact {
  requestId: number;
  editLabel: string;
  createdAtDay: number;
  horizons: Record<ImpactHorizon, CityImpactHorizon>;
  buildings: BuildingImpactProjection[];
  buildingSummaries: BuildingEconomicImpactSummary[];
  projectionRuns: number;
}

export interface ImpactProjectionRequest {
  requestId: number;
  editLabel: string;
  checkpoint: ImpactProjectionCheckpoint;
  beforeDesign: EditorSnapshot;
  afterDesign: EditorSnapshot;
  interventionCapitalCost: number;
  trackedBuildingIds: string[];
  projectionRuns?: number;
  projectionRunIndex?: number;
}

export type ImpactProjectionWorkerResponse =
  | {
      requestId: number;
      ok: true;
      impact: CityEditImpact;
    }
  | {
      requestId: number;
      ok: false;
      error: string;
    };
