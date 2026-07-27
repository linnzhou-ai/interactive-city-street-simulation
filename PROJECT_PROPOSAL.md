# Interactive City Street Simulation

**Final Project Proposal**  
*A browser-based street designer for testing traffic flow, pedestrian safety, and efficiency*

**Group members:** Linn, Albert, Chanyoung  
**Project format:** Interactive browser-based simulation

This project turns street design into an evidence-based experiment: users build a compact street, run realistic scenarios, and compare the results before and after a redesign.

---

## 1. Project Overview

### Recommendation

Approve this project because it combines a meaningful real-world question with a deliberately limited technical scope. The proposed minimum viable product is ambitious enough to demonstrate systems thinking, interaction design, simulation logic, and data interpretation, yet focused enough to complete with existing browser technologies and clearly divided team responsibilities.

### Final Project Title

**Interactive City Street Simulation**

### Group Members

- **Linn** - street environment, pedestrian systems, and safety features
- **Albert** - vehicle systems, traffic signals, congestion, and core simulation logic
- **Chanyoung** - interface, adjustable controls, data collection, visualization, and integration

### Project Goal

Our goal is to create an interactive tool that demonstrates how choices in city-street design affect traffic flow, pedestrian movement, safety, and overall efficiency. Users will design or modify one compact street segment or intersection, adjust operating conditions, run a simulation, and use clear measurements to evaluate the result.

The distinguishing feature will be a comparative **Ghost Run**. After a redesign, the system will replay the same starting vehicles, pedestrians, and scenario conditions so users can compare the original and revised street fairly. This turns the project from a visual toy into a small experiment: one design variable can be changed while the demand pattern remains consistent.

### Why the Project Matters

Street design requires tradeoffs. Adding vehicle capacity may reduce congestion but increase crossing distance; longer signal phases may improve traffic throughput but increase pedestrian waiting time; bike or bus infrastructure may use space that would otherwise serve parking or travel lanes. The simulation will make these tradeoffs visible and measurable in a format that is accessible to non-specialists.

---

## 2. Scope

The project will model one manageable street segment or one intersection rather than an entire city. This boundary is essential: it preserves the central design-and-test experience while keeping pathfinding, rendering, and data collection feasible for a student team.

### Core Deliverable (Required)

| Component | Minimum viable capability |
|---|---|
| Street editor | Grid-based placement or modification of lanes, sidewalks, crosswalks, and traffic signals. |
| Movement systems | Vehicles follow connected lanes; pedestrians use sidewalks and designated crossings. |
| Scenario controls | Vehicle volume, pedestrian volume, speed limit, and signal timing can be adjusted. |
| Simulation results | Average vehicle travel time, congestion, pedestrian wait time, and potential conflicts. |
| Comparison | A before/after Ghost Run uses matched starting conditions to show the effect of a redesign. |

### Stretch Features (Only After the Core Works)

- Bike lanes and bike movement
- Bus stops and transit delays
- Additional scenarios, including school arrival and severe weather
- More advanced graphics, animations, charts, or street-design elements

### Explicitly Out of Scope

- City-scale maps or simulation of multiple neighborhoods
- Photorealistic graphics or professional traffic-engineering accuracy
- Complex autonomous-agent behavior or machine-learning prediction
- Real-world routing, GIS integration, or live traffic data

> **Scope discipline:** The project will be judged on whether the editor, simulation, measurements, and comparison work together clearly - not on the number of optional street elements. Stretch features will not displace core functionality.

---

## 3. Feasibility Within Time and Resource Constraints

We will build the project as a simplified browser application using established programming libraries and AI-assisted development tools. A browser-based format avoids specialized hardware, installation complexity, and expensive software. The simulation will use understandable rules rather than attempting to reproduce a professional transportation model.

### Development Strategy

1. **Build the smallest working street.** Create a fixed or grid-based street with one vehicle route, one pedestrian route, and visible movement.
2. **Make the core behaviors reliable.** Add signals, lane following, sidewalks, crosswalk use, stopping rules, and collision/conflict checks.
3. **Add the editor and controls.** Allow users to place essential elements and change demand, speed, and signal timing.
4. **Measure outcomes.** Record travel time, congestion, pedestrian waiting, and path conflicts during each run.
5. **Add fair comparison.** Save a run's starting conditions and replay them after a redesign as the Ghost Run.
6. **Polish, test, and present.** Use sample designs to demonstrate tradeoffs and explain the limits of the model.

### Milestone Gates

| Phase | Completion gate | Evidence |
|---|---|---|
| 1. Foundation | Street renders; at least one vehicle and one pedestrian complete a route. | Movement demo |
| 2. Rules | Signals and crossing rules affect movement without blocking the simulation. | Working intersection |
| 3. Interaction | A user can edit essential elements and change required settings. | Usable editor |
| 4. Measurement | Every completed run produces all core metrics. | Results panel |
| 5. Comparison | Before/after runs use matched inputs and present a readable difference. | Ghost Run |
| 6. Finalization | Example scenarios pass testing and the team can explain results and limitations. | Presentation-ready build |

### Why This Is Appropriately Ambitious

The proposal requires three connected systems: an editor, a simulation, and an evaluation layer. Completing all three demonstrates more than a static webpage or animation, but the limited map size, simple behavioral rules, and staged feature order prevent the project from becoming unmanageable. Each team member owns a subsystem with a visible output, and integration begins before optional features are attempted.

---

## 4. Team Responsibilities and Collaboration Plan

Responsibilities are divided by subsystem so that each member has a clear primary area while still contributing to testing, integration, and the final presentation. "Primary" means responsible for planning, implementation, documentation, and first-line debugging of that subsystem - not working in isolation.

| Owner | Primary area | Specific responsibilities | Acceptance evidence |
|---|---|---|---|
| Linn | Street and pedestrian systems | Grid/street environment; sidewalks; crosswalks; pedestrian movement; safety-conflict logic | Working pedestrian route and safety metrics |
| Albert | Vehicle and simulation systems | Traffic lanes; vehicle movement; signal behavior; congestion; core update loop; vehicle travel time | Stable vehicle flow and signal-controlled intersection |
| Chanyoung | Interface, data, and integration | Building tools; adjustable controls; run/reset workflow; metric collection; results visualization; subsystem integration | Usable interface and readable results |
| All members | Quality and communication | Integration testing; bug triage; example designs; results analysis; documentation; final presentation | Tested build and coordinated presentation |

### Coordination Rules

- Agree on shared data formats early: grid cells, agents, signals, scenario settings, and metric output.
- Integrate small working changes frequently instead of waiting until all subsystems are "finished."
- Use a shared issue list with one owner and a clear definition of done for each task.
- Demonstrate subsystem progress to the group at each milestone gate.
- Escalate blockers quickly; after a short debugging attempt, pair with the teammate whose subsystem connects to the issue.
- Keep shared tasks - testing, analysis, and presentation - visible and assigned rather than assuming someone else will complete them.

### Integration Ownership

Chanyoung will coordinate the application-level integration because the interface and results layer connect to both the pedestrian and vehicle systems. Linn and Albert will each provide documented inputs and outputs for their subsystem and will remain responsible for fixing defects inside it. Integration decisions that change more than one subsystem will be made by the group, recorded, and tested with a shared example street.

---

## 5. Evaluation and Success Criteria

The project will be considered successful when a user can complete the full design-simulate-compare cycle without developer assistance and the results respond plausibly to meaningful street-design changes.

| Area | Success criterion |
|---|---|
| Usability | A user can place or modify all core street elements and start, pause/reset, and rerun the simulation. |
| Behavior | Vehicles respond to lanes and signals; pedestrians use sidewalks and crosswalks; agents do not move through invalid cells. |
| Measurement | Every run reports vehicle travel time, congestion, pedestrian waiting time, and potential safety conflicts. |
| Comparison | Ghost Run preserves the starting scenario and clearly shows before/after differences. |
| Reliability | The provided example configurations run repeatedly without freezing or producing unusable results. |
| Communication | The team can explain assumptions, tradeoffs, limitations, and why a result changed. |

### Example Demonstration Scenarios

- **Rush hour:** High vehicle volume tests congestion and signal timing.
- **School arrival:** High pedestrian volume tests crossing access and waiting time.
- **Street redesign:** A crosswalk, signal timing, or lane configuration is changed and compared with a matched Ghost Run.

If severe weather is implemented as a stretch scenario, it will use simple rule changes - such as lower speeds or slower pedestrian movement - rather than a separate weather-physics system.

---

## 6. Risks and Backup Plan

The backup plan preserves the project's central claim: users should still be able to test how a street-design choice affects movement and safety. Reductions will remove breadth or realism before removing the design-simulate-compare loop.

| Risk | Fallback action | What is preserved |
|---|---|---|
| Editor is too complex | Limit the design area to one intersection and four elements: lanes, sidewalks, crosswalks, and signals. | User still designs a meaningful street. |
| Pathfinding is unreliable | Use predetermined routes generated from a small set of valid configurations. | Vehicles and pedestrians still respond to the design. |
| Real-time conflict detection is difficult | Count vehicle-pedestrian path overlaps, close approaches, or blocked crossings as proxy conflicts. | Safety remains visible with a clearly labeled simplified metric. |
| Performance or graphics are weak | Use simpler shapes, fewer agents, fixed time steps, and preconfigured scenarios. | The simulation remains understandable and responsive. |
| Ghost Run replay is unstable | Run the same saved demand values and route sequence side by side or sequentially instead of overlaying animation. | The comparison remains fair and readable. |
| Integration falls behind | Freeze stretch work, lock the core interface, and test one shared reference configuration. | The team converges on one complete, presentable build. |

### Decision Triggers

- If a milestone gate cannot be demonstrated when planned, pause new features and resolve or simplify that gate.
- If a stretch feature threatens a core feature, remove the stretch feature.
- If a subsystem cannot integrate through the agreed data format, use the simplest compatible interface and document the limitation.
- If repeated debugging does not restore a core behavior, activate the corresponding fallback rather than allowing the entire project to stall.

---

## 7. Final Deliverables

- A functioning browser-based street editor and simulation
- At least two example street designs or scenarios
- A results display with the four core performance measures
- A before/after Ghost Run comparison
- Brief documentation of controls, assumptions, and model limitations
- A coordinated final presentation in which each member explains their subsystem and the group interprets the results

## Conclusion

Interactive City Street Simulation is a feasible and appropriately ambitious collaborative project. It addresses a recognizable real-world problem, gives users meaningful control, produces measurable evidence, and creates opportunities to discuss tradeoffs rather than declare a single "perfect" street.

The project's limited geographic scope, staged implementation, explicit ownership, milestone gates, and layered fallback plan reduce execution risk without weakening the main idea. We therefore believe it is a strong investment of the group's available time and resources.
