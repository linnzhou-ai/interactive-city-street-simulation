import { describe, expect, it } from "vitest";
import { createCitySectionState, createDemoCitySectionDefinition } from "../src/core/cityModel";
import { createDetailedEntityState } from "../src/core/entitySimulation";
import { ResidentMobilitySystem } from "../src/core/residentMobility";
import { PENN_BUILDINGS } from "../src/data/pennBuildings";

describe("Albert sampled resident mobility", () => {
  it("moves a scheduled resident continuously between buildings", () => {
    const city = createCitySectionState(createDemoCitySectionDefinition());
    const entities = createDetailedEntityState(PENN_BUILDINGS, city);
    const person = entities.people.find(
      (candidate) =>
        candidate.schedule.length > 1 &&
        candidate.schedule[1].travelMinutes > 0,
    );
    expect(person).toBeDefined();
    if (!person) return;
    const destination = person.schedule[1];
    const departure = Math.max(
      person.schedule[0].startMinute,
      destination.startMinute - destination.travelMinutes,
    );
    const system = new ResidentMobilitySystem();

    const first = system.update(
      [person],
      entities.buildings,
      departure + destination.travelMinutes * 0.25,
      [],
    )[0];
    const second = system.update(
      [person],
      entities.buildings,
      departure + destination.travelMinutes * 0.75,
      [],
    )[0];

    expect(["walking", "driving", "transit"]).toContain(first.mobility.phase);
    expect(second.mobility.routeProgress).toBeGreaterThan(
      first.mobility.routeProgress,
    );
    expect(
      Math.hypot(
        second.mobility.x - first.mobility.x,
        second.mobility.z - first.mobility.z,
      ),
    ).toBeGreaterThan(0);
  });

  it("keeps the current active trip stable across repeated updates", () => {
    const city = createCitySectionState(createDemoCitySectionDefinition());
    const entities = createDetailedEntityState(PENN_BUILDINGS, city);
    const person = entities.people.find(
      (candidate) =>
        candidate.schedule.length > 1 &&
        candidate.schedule[1].travelMinutes > 0,
    );
    expect(person).toBeDefined();
    if (!person) return;
    const destination = person.schedule[1];
    const departure = Math.max(
      person.schedule[0].startMinute,
      destination.startMinute - destination.travelMinutes,
    );
    const minute = departure + destination.travelMinutes * 0.5;
    const system = new ResidentMobilitySystem();

    const first = system.update(
      [person],
      entities.buildings,
      minute,
      [],
    )[0];
    const repeated = system.update(
      [first],
      entities.buildings,
      minute,
      [],
    )[0];

    expect(repeated.mobility).toEqual(first.mobility);
  });
});
