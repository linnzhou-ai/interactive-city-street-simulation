# Simulation architecture

The application separates deterministic domain systems from Three.js rendering:

- `src/core/simulation.ts` coordinates the city clock, fixed-step updates, demand,
  domain update order, events, settings, and aggregate metrics.
- `src/core/population.ts` creates households and demographics, assigns daily
  schedules, and emits explainable travel choices.
- `src/core/network.ts` builds the multimodal graph and calculates generalized
  route cost from time, congestion, price, comfort, and turns.
- `src/core/mobility.ts` moves cars, freight, buses, and pedestrians while applying
  signals, capacity, queues, following gaps, transit dwell, and conflict proxies.
- `src/core/economy.ts` handles jobs, wages, household consumption, production,
  retail inventory, imports, exports, and freight requests.
- `src/core/infrastructure.ts` allocates power, water, and waste capacity and tracks
  roads, parking, condition, and transit service.
- `src/core/landUse.ts` applies zoning, terrain and height constraints, then updates
  suitability, land value, rent, and permitted building growth.
- `src/models/types.ts` defines shared contracts used by all three contributors.
- `src/rendering/threeRenderer.ts` translates state into an interactive 3D scene without
  changing state.
- `src/main.ts` connects controls, animation timing, rendering, and metric output.

Domain updates are deterministic. Population creates trips, the economy creates
jobs and freight, mobility consumes trips, infrastructure allocates services, and
land use responds to the resulting accessibility, demand, and service conditions.

## Team boundaries

- **Linn:** street environment, sidewalks, crosswalks, pedestrians, and safety logic.
- **Albert:** vehicles, traffic signals, congestion, and the simulation loop.
- **Chanyoung:** interface, controls, metrics, build tooling, and integration.

Changes to shared types should be discussed before implementation because they affect every
subsystem. Completed work should be merged into `main` through small pull requests, and each
personal branch should be updated from `main` frequently.
