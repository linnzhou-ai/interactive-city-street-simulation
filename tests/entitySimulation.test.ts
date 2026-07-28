import { describe, expect, it } from "vitest";
import { Simulation } from "../src/core/simulation";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";

describe("University City entities", () => {
  it("assigns a function and stable identity to Main's rendered buildings", () => {
    expect(PENN_BUILDINGS.length).toBeGreaterThan(100);
    expect(new Set(PENN_BUILDINGS.map((building) => building.id)).size).toBe(
      PENN_BUILDINGS.length,
    );
    for (const requiredFunction of [
      "housing",
      "retail",
      "office",
      "industrial",
      "school",
      "library",
      "clinic",
      "recreation",
    ]) {
      expect(PENN_BUILDINGS.some((building) => building.function === requiredFunction)).toBe(true);
    }
  });

  it("creates inspectable residents, schedules, households, and connections", () => {
    const state = new Simulation().getState();

    expect(state.entities.buildings).toHaveLength(PENN_BUILDINGS.length);
    expect(state.entities.people.length).toBeGreaterThan(300);
    expect(state.entities.households.length).toBeGreaterThan(100);
    expect(state.entities.people.every((person) => person.schedule.length >= 3)).toBe(true);
    expect(state.entities.people.some((person) => person.employment === "external")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "commute")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "customer")).toBe(true);
    expect(state.entities.connections.some((connection) => connection.kind === "supply")).toBe(true);
  });

  it("uses distinct accounting for businesses, housing, and civic services", () => {
    const buildings = new Simulation().getState().entities.buildings;
    const business = buildings.find((building) => building.function === "retail");
    const housing = buildings.find((building) => building.function === "housing");
    const civic = buildings.find((building) => building.function === "library");

    expect(business?.accounting.salesRevenue).toBeGreaterThanOrEqual(0);
    expect(business?.accounting.requiredWorkers).toBeGreaterThan(0);
    expect(housing?.accounting.rentIncome).toBeGreaterThan(0);
    expect(housing?.accounting.salesRevenue).toBe(0);
    expect(civic?.accounting.municipalFunding).toBeGreaterThan(0);
    expect(civic?.accounting.serviceDemand).toBeGreaterThan(0);
    const businesses = buildings.filter((building) =>
      ["retail", "office", "industrial", "parking"].includes(building.function),
    );
    expect(businesses.some((building) => building.accounting.profit > 0)).toBe(true);
    expect(businesses.some((building) => building.accounting.profit < 0)).toBe(true);
  });

  it("advances detailed labor and accounting on long time scales", () => {
    const simulation = new Simulation();
    simulation.setTimeHorizon("year");
    simulation.start();
    simulation.update(1);

    const state = simulation.getState();
    expect(state.entities.lastUpdatedDay).toBe(7);
    expect(state.entities.buildings.every((building) => Number.isFinite(building.accounting.profit))).toBe(true);
    expect(state.entities.people.every((person) => Number.isFinite(person.money))).toBe(true);
  });
});
