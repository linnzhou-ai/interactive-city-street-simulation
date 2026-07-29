import { describe, expect, it } from "vitest";
import { findExpansionCrosswalkApproaches } from "../src/rendering/threeRenderer";
import type { ExpansionRoad } from "../src/models/types";

const road = (
  id: string,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number,
  width = 15,
): ExpansionRoad => ({
  id,
  startX,
  startZ,
  endX,
  endZ,
  width,
});

describe("expansion crosswalk placement", () => {
  it("does not treat a straight road seam as an intersection", () => {
    const approaches = findExpansionCrosswalkApproaches([
      road("west", -80, 0, 0, 0),
      road("east", 0, 0, 80, 0),
    ]);

    expect(approaches).toEqual([]);
  });

  it("offers one correctly oriented placement on every side of a four-way intersection", () => {
    const approaches = findExpansionCrosswalkApproaches([
      road("horizontal", -80, 0, 80, 0),
      road("vertical", 0, -80, 0, 80),
    ]);

    expect(approaches).toHaveLength(4);
    expect(approaches.filter((approach) => approach.rotation === 0)).toHaveLength(2);
    expect(
      approaches.filter((approach) => approach.rotation === Math.PI / 2),
    ).toHaveLength(2);
  });

  it("sizes each crossing to the road on that approach", () => {
    const approaches = findExpansionCrosswalkApproaches([
      road("wide-horizontal", -80, 0, 80, 0, 21),
      road("narrow-vertical", 0, -80, 0, 80, 15),
    ]);
    const west = approaches.find((approach) => approach.x < 0);
    const north = approaches.find((approach) => approach.z < 0);

    expect(west?.crossingSpan).toBe(21);
    expect(north?.crossingSpan).toBe(15);
  });
});
