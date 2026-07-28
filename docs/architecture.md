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
  speed. Movement is split into swept substeps and resolved against nearby
  collision volumes with axis sliding.
- **Walk** uses pointer-lock mouse look, a human-scale capsule, gravity,
  walkable-surface sampling, safe spawn resolution, and optional jumping.
- **Build** selects road meshes and renders modifications above the existing
  3D street.
- **Simulate** preserves the deterministic simulation and metrics while agents
  move across district-scale routes.

## Collision

Rendering and collision remain separate. Generated building volumes register
simplified world-space bounding boxes after scene generation. A spatial hash
provides the broad phase, so movement checks only nearby buildings. Roads,
sidewalks, plazas, lawns, and open ground register independent walkable surface
heights.

`src/core/collision.ts` owns the substepped sliding resolver used to prevent
high-speed tunneling. The developer-only `collisionDebug=1` query parameter
visualizes the collision boxes, player collider, ground probe, navigation mode,
and grounded state.
