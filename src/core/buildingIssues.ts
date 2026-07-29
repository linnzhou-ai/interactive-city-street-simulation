import type { CitySectionState } from "../models/cityTypes";
import type {
  BuildingFunction,
  DetailedBuilding,
  DetailedEntityState,
  DetailedPerson,
} from "../models/entityTypes";

export type BuildingIssueCategory =
  | "traffic"
  | "profitability"
  | "happiness"
  | "migration"
  | "staffing";

export interface BuildingIssue {
  id: string;
  buildingId: string;
  buildingName: string;
  category: BuildingIssueCategory;
  severity: "warning" | "critical";
  title: string;
  detail: string;
  value: number;
}

const CIVIC_FUNCTIONS: ReadonlySet<BuildingFunction> = new Set([
  "university",
  "library",
  "school",
  "clinic",
  "culture",
  "recreation",
]);

export function deriveBuildingIssues(
  entities: Readonly<DetailedEntityState>,
  city: Readonly<CitySectionState>,
): BuildingIssue[] {
  const issues: BuildingIssue[] = [];
  const residentsByHome = groupResidentsByHome(entities.people);

  for (const building of entities.buildings) {
    const residents = residentsByHome.get(building.id) ?? [];
    addTrafficIssue(issues, building, city);
    addProfitabilityIssue(issues, building);
    addHappinessIssue(issues, building, residents);
    addMigrationIssue(issues, building, residents, city);
    addStaffingIssue(issues, building);
  }

  return issues.sort((left, right) => {
    if (left.severity !== right.severity) return left.severity === "critical" ? -1 : 1;
    if (left.category !== right.category) return categoryRank(left.category) - categoryRank(right.category);
    return right.value - left.value;
  });
}

function addTrafficIssue(
  issues: BuildingIssue[],
  building: Readonly<DetailedBuilding>,
  city: Readonly<CitySectionState>,
): void {
  const cost = building.accounting.transportCost;
  const costShare = cost / Math.max(1, building.accounting.operatingCost);
  if (cost < 35 || costShare < 0.08) return;
  issues.push({
    id: `traffic:${building.id}`,
    buildingId: building.id,
    buildingName: building.name,
    category: "traffic",
    severity: costShare >= 0.22 || city.metrics.congestionPercent >= 70 ? "critical" : "warning",
    title: "High transport cost",
    detail: `${Math.round(costShare * 100)}% of operating costs; ${building.accounting.importedSupplies.toFixed(0)} imported supply units and ${city.metrics.congestionPercent.toFixed(0)}% city congestion.`,
    value: cost,
  });
}

function addProfitabilityIssue(
  issues: BuildingIssue[],
  building: Readonly<DetailedBuilding>,
): void {
  if (building.function === "housing" || CIVIC_FUNCTIONS.has(building.function)) return;
  const loss = -building.accounting.profit;
  if (loss <= 0) return;
  const lossShare = loss / Math.max(1, building.accounting.operatingRevenue);
  if (building.accounting.status === "understaffed" && building.accounting.staffingRatio < 0.65) return;
  if (
    building.accounting.status !== "closed"
    && (building.accounting.lossStreak < 3 || loss < 50 || lossShare < 0.08)
  ) return;
  issues.push({
    id: `profitability:${building.id}`,
    buildingId: building.id,
    buildingName: building.name,
    category: "profitability",
    severity: building.accounting.status === "closed" || lossShare >= 0.25 || building.accounting.lossStreak >= 7 ? "critical" : "warning",
    title: building.accounting.status === "closed" ? "Business closed" : "Business losing money",
    detail: `$${Math.round(building.accounting.operatingRevenue).toLocaleString()} revenue minus $${Math.round(building.accounting.operatingCost).toLocaleString()} costs; ${building.accounting.lossStreak} consecutive loss-making days.`,
    value: loss,
  });
}

function addHappinessIssue(
  issues: BuildingIssue[],
  building: Readonly<DetailedBuilding>,
  residents: readonly DetailedPerson[],
): void {
  if (building.function !== "housing" || residents.length === 0) return;
  const averageHappiness = average(residents.map((person) => person.happiness));
  if (averageHappiness >= 52) return;
  issues.push({
    id: `happiness:${building.id}`,
    buildingId: building.id,
    buildingName: building.name,
    category: "happiness",
    severity: averageHappiness < 38 ? "critical" : "warning",
    title: "Low resident happiness",
    detail: `${residents.length} sampled residents average ${averageHappiness.toFixed(0)}% happiness; inspect their needs, employment, and finances.`,
    value: 100 - averageHappiness,
  });
}

function addMigrationIssue(
  issues: BuildingIssue[],
  building: Readonly<DetailedBuilding>,
  residents: readonly DetailedPerson[],
  city: Readonly<CitySectionState>,
): void {
  if (building.function !== "housing" || residents.length === 0) return;
  const leaving = residents.filter((person) => person.migrationStatus !== "staying");
  if (leaving.length === 0) return;
  const movingOut = leaving.filter((person) => person.migrationStatus === "moving-out").length;
  issues.push({
    id: `migration:${building.id}`,
    buildingId: building.id,
    buildingName: building.name,
    category: "migration",
    severity: movingOut > 0 || city.metrics.annualizedNetMigration < 0 ? "critical" : "warning",
    title: movingOut > 0 ? "Residents moving out" : "Residents considering departure",
    detail: `${leaving.length} of ${residents.length} sampled residents face departure pressure; ${movingOut} are preparing to move.`,
    value: movingOut * 10 + leaving.length,
  });
}

function addStaffingIssue(
  issues: BuildingIssue[],
  building: Readonly<DetailedBuilding>,
): void {
  const accounting = building.accounting;
  if (accounting.status === "closed" || accounting.requiredWorkers === 0 || accounting.staffingRatio >= 0.65) return;
  const vacancies = Math.max(0, accounting.requiredWorkers - building.employeeIds.length);
  issues.push({
    id: `staffing:${building.id}`,
    buildingId: building.id,
    buildingName: building.name,
    category: "staffing",
    severity: accounting.staffingRatio < 0.4 ? "critical" : "warning",
    title: "Severe staff shortage",
    detail: `${building.employeeIds.length} of ${accounting.requiredWorkers} required positions filled; ${vacancies} vacancies are limiting output or service.`,
    value: vacancies,
  });
}

function groupResidentsByHome(
  people: readonly DetailedPerson[],
): Map<string, DetailedPerson[]> {
  const result = new Map<string, DetailedPerson[]>();
  for (const person of people) {
    const residents = result.get(person.homeBuildingId) ?? [];
    residents.push(person);
    result.set(person.homeBuildingId, residents);
  }
  return result;
}

function categoryRank(category: BuildingIssueCategory): number {
  return ["profitability", "traffic", "happiness", "migration", "staffing"].indexOf(category);
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}
