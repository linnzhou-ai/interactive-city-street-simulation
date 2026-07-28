import { describe, expect, it } from "vitest";
import { deriveBuildingIssues } from "../src/core/buildingIssues";
import { Simulation } from "../src/core/simulation";

describe("building issue notifications", () => {
  it("only reports issues tied to inspectable buildings", () => {
    const state = new Simulation().getState();
    const issues = deriveBuildingIssues(state.entities, state.city);
    const buildingIds = new Set(state.entities.buildings.map((building) => building.id));

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => buildingIds.has(issue.buildingId))).toBe(true);
  });

  it("detects traffic, losses, happiness, migration, and staffing from model state", () => {
    const state = new Simulation().getState();
    const business = state.entities.buildings.find((building) => building.function === "retail");
    const home = state.entities.buildings.find((building) => building.function === "housing" && building.residentIds.length > 0);
    expect(business).toBeDefined();
    expect(home).toBeDefined();

    const entities = {
      ...state.entities,
      buildings: state.entities.buildings.map((building) => building.id === business?.id
        ? {
            ...building,
            employeeIds: [],
            accounting: {
              ...building.accounting,
              requiredWorkers: 10,
              staffingRatio: 0.2,
              operatingRevenue: 100,
              operatingCost: 500,
              profit: -400,
              lossStreak: 3,
              transportCost: 150,
              importedSupplies: 20,
            },
          }
        : building),
      people: state.entities.people.map((person) => person.homeBuildingId === home?.id
        ? {
            ...person,
            happiness: 30,
            migrationStatus: "moving-out" as const,
          }
        : person),
    };
    const city = {
      ...state.city,
      metrics: {
        ...state.city.metrics,
        congestionPercent: 75,
        annualizedNetMigration: -100,
      },
    };
    const issues = deriveBuildingIssues(entities, city);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ buildingId: business?.id, category: "traffic" }),
      expect.objectContaining({ buildingId: business?.id, category: "profitability" }),
      expect.objectContaining({ buildingId: business?.id, category: "staffing" }),
      expect.objectContaining({ buildingId: home?.id, category: "happiness" }),
      expect.objectContaining({ buildingId: home?.id, category: "migration" }),
    ]));
  });
});
