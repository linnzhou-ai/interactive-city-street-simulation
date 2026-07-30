import { describe, expect, it } from "vitest";
import {
  defaultExpansionRoadName,
  expansionRoadDisplayName,
  randomExpansionRoadName,
} from "../src/core/expansionRoadNaming";

describe("expansion road naming", () => {
  it("gives older roads stable proper names", () => {
    expect(defaultExpansionRoadName("expansion-road-7")).toMatch(
      /^[A-Z][a-z]+ (Avenue|Lane|Road|Street|Way)$/,
    );
    expect(defaultExpansionRoadName("expansion-road-7")).toBe(
      defaultExpansionRoadName("expansion-road-7"),
    );
  });

  it("randomly selects an unused proper name", () => {
    expect(randomExpansionRoadName([], () => 0)).toBe("Addison Avenue");
    expect(randomExpansionRoadName(["Addison Avenue"], () => 0)).toBe(
      "Addison Lane",
    );
  });

  it("preserves a custom road name", () => {
    expect(expansionRoadDisplayName({
      id: "expansion-road-7",
      name: "Locust Connector",
    })).toBe("Locust Connector");
  });

  it("migrates a road that predates saved names", () => {
    const name = expansionRoadDisplayName({
      id: "expansion-road-4",
    });
    expect(name).not.toMatch(/^New Street/);
    expect(name).toMatch(/ (Avenue|Lane|Road|Street|Way)$/);
  });

  it("replaces an earlier placeholder name", () => {
    expect(expansionRoadDisplayName({
      id: "expansion-road-4",
      name: "New Street 4",
    })).toBe(defaultExpansionRoadName("expansion-road-4"));
  });
});
