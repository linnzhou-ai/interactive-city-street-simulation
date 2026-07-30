import { describe, expect, it } from "vitest";
import {
  defaultExpansionRoadName,
  expansionRoadDisplayName,
} from "../src/core/expansionRoadNaming";

describe("expansion road naming", () => {
  it("names manually built and municipal roads from their stable sequence", () => {
    expect(defaultExpansionRoadName("expansion-road-7")).toBe("New Street 7");
    expect(defaultExpansionRoadName("municipal-road-12")).toBe("Civic Way 12");
  });

  it("preserves a custom road name", () => {
    expect(expansionRoadDisplayName({
      id: "expansion-road-7",
      name: "Locust Connector",
    })).toBe("Locust Connector");
  });

  it("migrates a road that predates saved names", () => {
    expect(expansionRoadDisplayName({
      id: "expansion-road-4",
    })).toBe("New Street 4");
  });
});
