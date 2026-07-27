# Interactive City Street Simulation

A browser-based street designer for testing how street layouts and operating
conditions affect traffic flow, pedestrian safety, and efficiency.

The project’s core workflow is:

1. Design or modify a compact street segment or intersection.
2. Configure vehicle volume, pedestrian volume, speed limits, and signal timing.
3. Run the simulation and review travel, congestion, wait-time, and conflict metrics.
4. Use a matched “Ghost Run” to compare the original design with a redesign.

See [PROJECT_PROPOSAL.md](PROJECT_PROPOSAL.md) for the full scope, milestones,
team responsibilities, success criteria, and fallback plan.

## Development

Install a supported Node.js version, then run:

```bash
npm install
npm run dev
```

Before opening a pull request, verify the complete foundation:

```bash
npm run check
```

The application uses Vite, TypeScript, Three.js, Vitest, and ESLint.
See [docs/architecture.md](docs/architecture.md) for subsystem boundaries and
team ownership.
