# Foundation architecture

The application separates deterministic simulation state, structured
geographic data, and standalone Three.js rendering:

- `src/core/simulation.ts` owns time, signal phases, design impacts, and metrics.
- `src/data/pennRoadGraph.ts` owns Penn/University City street, intersection,
  and landmark coordinates.
- `src/models/types.ts` defines shared simulation, geographic, and UI contracts.
- `src/rendering/threeRenderer.ts` converts latitude/longitude to local meters
  and generates the complete visible 3D district.
- `src/main.ts` connects UI controls, animation timing, editing, and metrics.

## World generation

Penn center is the local origin. Geographic points are converted to X/Z meters
before rendering. The geographic graph is only an input; there is no visible
map, basemap, satellite imagery, globe, or provider-generated ground.

The renderer generates:

- ground, lawns, plazas, asphalt roads, markings, sidewalks, and crosswalks;
- district blocks using twelve building archetypes and irregular volume
  combinations;
- ten custom Penn landmark models;
- rooftop details, varied instanced trees, streetlights, campus furniture, and
  parked vehicles;
- moving vehicles, pedestrians, animated signals, selection geometry, and
  intervention overlays;
- a sky dome, sunlight, ambient fill, soft shadows, tone mapping, and distance
  fog.

## Interaction model

- **Orbit** uses damped Three.js orbit controls.
- **Fly** uses drag-to-look, `W/A/S/D`, `E/Q`, `Shift`, and altitude-dependent
  speed.
- **Build** selects road meshes and renders modifications above the existing
  3D street.
- **Simulate** preserves the deterministic simulation and metrics while agents
  move across district-scale routes.
