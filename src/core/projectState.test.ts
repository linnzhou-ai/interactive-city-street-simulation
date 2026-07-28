import { describe, expect, it } from "vitest";
import {
  EditHistory,
  PROJECT_STATE_VERSION,
  parseProjectSnapshot,
  type EditorSnapshot,
} from "./projectState";

const EMPTY_EDITOR: EditorSnapshot = {
  designs: [],
  buildings: [],
  nextBuildingId: 1,
};

describe("EditHistory", () => {
  it("supports undo and redo with independent snapshots", () => {
    const history = new EditHistory();
    history.record(EMPTY_EDITOR);
    const edited: EditorSnapshot = {
      designs: [],
      buildings: [
        {
          id: "building-1",
          kind: "residential",
          x: 10,
          z: 20,
          rotation: 0,
          floors: 4,
          color: "#bf765f",
        },
      ],
      nextBuildingId: 2,
    };
    expect(history.undo(edited)?.buildings).toHaveLength(0);
    expect(history.redo(EMPTY_EDITOR)?.buildings).toHaveLength(1);
  });
});

describe("parseProjectSnapshot", () => {
  it("validates and normalizes a saved project", () => {
    const parsed = parseProjectSnapshot(
      JSON.stringify({
        version: PROJECT_STATE_VERSION,
        savedAt: "2026-07-28T00:00:00.000Z",
        ...EMPTY_EDITOR,
        settings: {
          simulationSpeed: 1,
          speedLimitMph: 25,
          signalCycleSeconds: 83,
          vehicleVolume: 2,
          pedestrianVolume: 2,
          simulationSeed: 42,
        },
        timeOfDayHours: 25.5,
        weather: "rain",
      }),
    );
    expect(parsed.timeOfDayHours).toBe(1.5);
    expect(parsed.weather).toBe("rain");
  });

  it("rejects malformed building data", () => {
    expect(() =>
      parseProjectSnapshot(
        JSON.stringify({
          version: PROJECT_STATE_VERSION,
          ...EMPTY_EDITOR,
          settings: {},
          timeOfDayHours: 12,
          weather: "clear",
        }),
      ),
    ).toThrow();
  });
});
