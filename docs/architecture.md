# Foundation architecture

The foundation separates deterministic simulation state from Canvas rendering:

- `src/core/simulation.ts` owns time, agent progress, signal phases, and metrics.
- `src/models/types.ts` defines shared contracts used by all three contributors.
- `src/rendering/canvasRenderer.ts` translates state into pixels without changing state.
- `src/main.ts` connects controls, animation timing, rendering, and metric output.

## Team boundaries

- **Linn:** street environment, sidewalks, crosswalks, pedestrians, and safety logic.
- **Albert:** vehicles, traffic signals, congestion, and the simulation loop.
- **Chanyoung:** interface, controls, metrics, build tooling, and integration.

Changes to shared types should be discussed before implementation because they affect every
subsystem. Completed work should be merged into `main` through small pull requests, and each
personal branch should be updated from `main` frequently.
