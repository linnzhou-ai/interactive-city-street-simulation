# Simulation architecture

The application separates district-scale systems, street-detail systems, and
schematic Three.js rendering:

- `src/core/cityModel.ts` validates external district/network input and provides
  the replaceable demo city section.
- `src/core/cityEngine.ts` advances aggregate demographics, employment, goods,
  migration, land, housing, transport, utilities, taxation, maintenance, and
  municipal balance in deterministic daily steps.
- `src/core/cityEconomy.ts` matches workers and jobs, updates household and
  business accounts, clears local goods markets, allocates bounded outside trade,
  and generates commute, shopping, pedestrian, and freight demand.
- `src/core/timeScale.ts` maps day, week, month, and year horizons to calendar time.
- `src/core/simulation.ts` coordinates the long-term engine with the bounded
  street-detail model, controls, events, and metrics.
- `src/core/population.ts` creates households and demographics, assigns daily
  schedules, and emits explainable travel choices.
- `src/core/network.ts` builds the multimodal graph and calculates generalized
  route cost from time, congestion, price, comfort, and turns.
- `src/core/mobility.ts` moves cars, freight, buses, and pedestrians while applying
  signals, capacity, queues, following gaps, transit dwell, and conflict proxies.
- `src/core/economy.ts` handles jobs, wages, household consumption, production,
  retail inventory, imports, exports, and freight requests in the street-detail
  layer.
- `src/core/infrastructure.ts` allocates power, water, and waste capacity and tracks
  roads, parking, condition, and transit service.
- `src/core/landUse.ts` applies zoning, terrain and height constraints, then updates
  suitability, land value, rent, and permitted building growth.
- `src/models/types.ts` defines shared contracts used by all three contributors.
- `src/models/cityTypes.ts` is the integration contract for partner city data.
- `src/rendering/threeRenderer.ts` draws a low-detail district and network schematic
  without changing simulation state.
- `src/main.ts` connects controls, animation timing, rendering, and metric output.

Long-horizon state advances only in completed daily steps. This keeps annual runs
frame-rate independent and avoids minute-by-minute loops. The street layer advances
at most five representative seconds per browser update so vehicles never dominate
the cost of a month- or year-scale scenario.

## Team boundaries

- **Linn:** street environment, sidewalks, crosswalks, pedestrians, and safety logic.
- **Albert:** vehicles, traffic signals, congestion, and the simulation loop.
- **Chanyoung:** interface, controls, metrics, build tooling, and integration.

Changes to shared types should be discussed before implementation because they affect every
subsystem. Completed work should be merged into `main` through small pull requests, and each
personal branch should be updated from `main` frequently.
