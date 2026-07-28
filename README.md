# Campus Street Simulator

A standalone Three.js urban simulation world inspired by Penn and University
City. The application converts a structured geographic street graph into local
meter coordinates, then generates its own roads, sidewalks, blocks, buildings,
landmarks, vegetation, vehicles, pedestrians, and lighting.

The visible scene does not load or display map imagery, satellite tiles,
provider road graphics, or a globe.

## Development

```bash
pnpm install
pnpm dev
```

Open the local URL printed by Vite. Do not open `index.html` directly with a
`file://` URL because TypeScript modules and styles require the development or
production server.

Run the full verification suite:

```bash
pnpm check
```

## World

- District coverage spans approximately 30th–45th Streets and Market–South.
- Roads and sidewalks are real Three.js geometry generated from the structured
  street graph.
- Twelve architectural archetypes create historic, Gothic, brick, glass,
  research, dormitory, apartment, rowhouse, office, hospital, parking, and
  retail buildings.
- College Hall, Fisher Fine Arts, Huntsman Hall, Van Pelt Library, Penn Museum,
  Franklin Field, Amy Gutmann Hall, Houston Hall, Penn Engineering, and Penn
  Medicine use custom landmark geometry.
- Instanced trees, lights, parked cars, and lower-detail skyline buildings keep
  the district dense while limiting draw overhead.

## Controls

- `Orbit`: drag to rotate and scroll to zoom.
- `Fly`: drag to look, use `W/A/S/D` to move, `E/Q` to rise or descend, and
  hold `Shift` for a speed boost. Scroll adjusts fly speed.
- Search flies the camera to a Penn landmark, street, or intersection.
- `Build`: select an existing 3D street and apply interventions.
- `Simulate`: run, pause, reset, adjust demand, compare baseline/modified
  results, and inspect localized analysis overlays.

See [docs/architecture.md](docs/architecture.md) for subsystem boundaries.
