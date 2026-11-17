# Design

Living description of the game and its architecture. Update it in the same commit as any
change that makes it wrong.

## Status

The owner reordered the build after step 2: the neighborhood came first, on top of the
simple arcade handling from the step 2 sandbox, which they like the feel of.

| Step | What                                                         | State   |
| ---- | ------------------------------------------------------------ | ------- |
| 1    | Scaffold, scripts, docs, `brand.ts`                          | Done    |
| 2    | Core loop, renderer with perf caps, debug overlay, input     | Done    |
| 4    | Neighborhood, lighting, fog, colliders                       | Done    |
| 4b   | Map expansion: hillside favela, Niemeyer, Vidigal (layout)   | Started |
| 3    | Cargo and pay pure functions with tests                      | Pending |
| 5    | Bike controller, wheelie, crash and respawn, camera          | Partial |
| 6    | Delivery loop: title, order picker, waypoint, HUD, results   | Pending |
| 7    | Traffic: cars and a bus on fixed routes                      | Pending |
| 8    | Touch controls, placeholder sounds, performance pass, report | Pending |

Step 5 so far: `bike/rider.ts` is a placeholder that keeps the sandbox handling and adds
terrain following, airtime off ramps and crests, and sliding along walls. The chase camera
with its anti-clipping spring arm is in. Still to do: keep or refine the handling the owner
likes, wheelies, crash and respawn, a proper bike model, and the `RideSample` cargo signals.

## The game

You ride a motorcycle for a fictional delivery app in a stylized Rio de Janeiro hillside
neighborhood. Names are placeholders kept in `src/brand.ts`.

The hook: how you ride affects the cargo.

| Cargo kind | Example      | Rule                                                               |
| ---------- | ------------ | ------------------------------------------------------------------ |
| Fragile    | Soup         | Damaged by bumps, hard braking, landings and crashes               |
| Upright    | Drinks       | Spills when you lean hard into turns; a little under hard braking  |
| Timed      | Ice cream    | Melts on a timer; condition falls slowly, then fast past the limit |
| Robust     | Phone        | Unaffected by riding                                               |
| Heavy      | Gas cylinder | Robust, but changes handling: slower lean, longer braking          |

Pay = base (from route distance) + tip (from cargo condition and delivery time against a par
time). Stars 1–5 come from the same two inputs. Pay is shown in R$.

### First version scope

Title screen, one compact neighborhood (steep hills, speed bumps, a cobblestone street,
ramps, buildings), a bike that feels good, simple traffic, the delivery loop with a results
screen and running earnings, HUD, debug overlay, and the performance budget in `CLAUDE.md`.

### Out of scope for now

Big open map, story, upgrades shop, saving progress, real audio, multiplayer, Steam or iOS
packaging. The design leaves room for them: simulation state is plain data separate from
rendering (ready to serialize), input is abstracted, and the build uses a relative base so
it can be wrapped later (for example Capacitor for iOS, a desktop shell for Steam).

## The neighborhood

A fictional 300 m square hillside neighborhood, built entirely in code at startup.
`src/world/layout.ts` is the single source of truth (pure data and functions, unit-tested):
street positions, `heightAt(x, z)`, `surfaceAt(x, z)`, speed bumps, ramps and spawn. Traffic
routes and order locations should read from it too.

- **Shape:** sea and beach to the south, then a mosaic promenade and a flat seafront avenue
  that ends in a tunnel mouth at each side. Four hill streets climb north from the avenue,
  crossed by four level cross streets on terraces at 5, 13, 20 and 28 m. The east side of
  the hill is higher than the west. One block is a park; the second cross street is
  cobblestone.
- **Grid:** everything sits on 2.5 m cells so road and sidewalk edges are exact. Roads are
  10 m wide (the avenue 15 m) with 2.5 m sidewalks raised by a 14 cm kerb.
- **Buildings** (`buildings.ts`): rows fill every block edge wall to wall, which also seals
  the map. Four styles by height up the hill: balconied apartment blocks on the seafront,
  shops with roller shutters, awnings and signs, painted houses with a contrasting base
  band and clay tile roofs, and unfinished brick-and-concrete houses with blue water tanks
  towards the top.
- **Street life** (`props.ts`): utility poles with tangled overhead wires, coconut palms,
  shade trees, festa junina bunting over the cobblestone street, parked cars and vans,
  plastic bar tables, beach parasols, kiosks, and hills with hillside houses as a backdrop.
- **Textures** (`textures.ts`): painted with the 2D canvas at startup, so there are no image
  files. Shop names are invented and generic; the fictional app appears on a few signs.
- **Draw calls:** one mesh per ground texture (7), one for all vertex-colored geometry, one
  each for ramps and bumps, road markings, signs, wires, sea and sky. About 24 in total
  with the rider and its shadow pass, at roughly 80k triangles.
- **Shade:** building shadows on the ground are baked into the ground's vertex colors from
  the sun direction. Only the rider casts a real-time shadow.
- **Physics:** the ground, ramps and speed bumps are triangle-mesh colliders; buildings,
  parked cars, kiosks and the map boundary are boxes.

Known gaps: the city is one merged mesh, so nothing is frustum-culled (split it by block if
triangle count becomes a problem on phones); ramps can be ridden into from behind; poles
and trees have no colliders.

## Map expansion (step 4b)

The owner asked for two favela areas added to the same continuous world, structure first:
plain blocks, no texturing or detail until both layouts play well. Real Rio district and
street names are allowed for these (owner's decision); real landmarks and businesses still
are not.

- **Area 1, hillside (first):** behind the top of the city, x about −200..200, z 150..560.
  The ground rises from the top terrace (28 m) to a ridge at about 130 m. A hand-drawn main
  road climbs it in switchback legs and comes back down, entering the city at the x = −30
  and x = 90 hill streets; a stair climbs from the x = 30 street. Secondary streets, lanes,
  alleys, stairs and dead ends are generated from a seed off the main roads.
- **Area 2, Avenida Niemeyer and Vidigal (second):** the west tunnel mouth becomes a winding
  cliff road along the coast, with one entrance to Vidigal and its steep main road climbing
  a headland. A ridge keeps it apart from Area 1.
- **Edges:** steep wooded slopes with walls hidden in them, backdrop hills further out, fog.

Order of work: road graph and debug map (done), terrain system and extended world, Area 1
main roads, Area 1 small streets, Area 1 buildings and delivery spots, then Area 2.

### Road graph

`src/world/roads/` is the source of truth for where you can ride and walk, pure and unit-
tested. Nodes are junctions and dead ends; edges carry the full centreline with heights, a
kind, a width, a surface and an area. The original city is mirrored into it from
`layout.ts` (a test checks they agree). `buildRoadNetwork(seed)` builds the whole network;
`?seed=N` in the address picks a layout.

| Kind      | Width | Max grade | Min radius | Bike |
| --------- | ----- | --------- | ---------- | ---- |
| avenue    | 15 m  | 2%        | 40 m       | yes  |
| street    | 10 m  | 36%       | 20 m       | yes  |
| main      | 7 m   | 12%       | 10 m       | yes  |
| secondary | 5 m   | 18%       | 7 m        | yes  |
| lane      | 3 m   | 25%       | 4.5 m      | yes  |
| alley     | 2 m   | 25%       | 4.5 m      | yes  |
| stairs    | 2 m   | any       | –          | no   |

The city's grid streets keep their steep straight climbs (up to 35%). Everything new winds.

The bike can't reverse and turns no tighter than about 3.7 m radius, so the validator
(`validate.ts`) checks turns as the bike would ride them: a corner is passable if the line
from outside edge to inside corner and back has enough radius. It reports grades and curves
beyond each kind's limit, roads running into each other except at junctions (bridges more
than 4 m apart vertically are fine), dead ends without a turning pad, edges the bike can't
reach from the spawn, and edges it can enter but never leave. `route.ts` finds the shortest
riding or walking route, for delivery distances and the waypoint later.

**M** shows the debug map: relief and 5 m contours, roads coloured by area, pedestrian routes
dashed, rings where areas meet, red crosses on validation problems, and the rider. Scroll to
zoom, drag to pan, double-click to reset.

## Tech

- three.js, TypeScript (strict), Vite. No UI framework; HUD and menus are DOM/CSS.
- `@dimforge/rapier3d-compat` for collision and queries only.
- Vitest for unit tests, ESLint + typescript-eslint + Prettier.
- No asset files yet: geometry in code, WebAudio-synthesized sounds, system fonts.

## Folder structure

```
src/
  brand.ts     display name + fictional app name
  main.ts      boot, screen switching
  core/        fixed-step loop, renderer setup, perf caps, debug overlay
  input/       actions + keyboard, gamepad, touch sources
  sim/         pure logic: cargo, pay, orders, tuning (+ tests). No three.js/Rapier/DOM.
  physics/     Rapier world, colliders, queries
  bike/        controller, bike mesh, camera rig
  world/       neighborhood layout, merged geometry, lighting, fog
    roads/     road graph, city streets, validation, routing (pure, tested)
  traffic/     routes, vehicles (instanced)
  game/        delivery state machine, session earnings
  ui/          title, order picker, HUD, results, debug map (DOM)
  audio/       synthesized placeholder sounds
```

Folders are created when their step is built.

## Physics approach

A custom arcade bike controller, with Rapier used only for collision and queries.

- **Bike:** our code integrates speed, heading, lean, pitch (wheelie) and airtime at a fixed
  60 Hz step. Rendering interpolates between steps.
- **Ground:** two wheel raycasts against Rapier colliders give ground height and slope, so
  hills, speed bumps and ramps need no special cases.
- **Collisions:** a shape-cast on the bike's capsule detects buildings and traffic. Impact
  speed above a threshold triggers crash and respawn.
- **Traffic:** kinematic bodies on fixed routes.
- **Camera:** a spring arm with a ray cast that pulls in before clipping.

Why not a fully simulated rigid-body bike: two-wheelers are unstable and the solver fights
the feel. Why not drop the physics library: hand-written collision for ramps, buildings and
traffic gets expensive as the map grows. Cost accepted: roughly 1–2 MB of WASM.

## Cargo damage model

Each physics step the bike emits a plain `RideSample`: vertical jolt, braking deceleration,
lean angle, airtime, landing impact, collision impact and `dt`. The pure function
`stepCargo(state, sample, spec)` returns the new cargo state; condition runs from 1 to 0.
`computePay(...)` is a second pure function. Both live in `src/sim/` with tests, and all
their numbers live in `src/sim/tuning.ts`.

Heavy cargo carries handling modifiers in its spec that the bike controller reads.

## Performance plan

- City merged into a few vertex-colored meshes; traffic and props instanced.
- One directional light with a small shadow frustum that follows the bike. Only the bike
  and vehicles cast; building shade is baked into vertex colors.
- Pixel ratio at most 1.5, 60 FPS limiter, loop stops on `visibilitychange`.
- Debug overlay (F3): FPS, draw calls, triangles.
- 4x CPU slowdown: keep main-thread time under about 4 ms per frame unthrottled, and confirm
  by hand with DevTools CPU throttling.

## Decisions

- Fictional hillside neighborhood in the spirit of Rio; no real landmarks. The expansion may
  use real district and street names (owner's decision).
- Touch layout: steer buttons on one side, throttle and brake on the other. Tilt steering
  later.
- UI text in English, pay in R$.
- TypeScript pinned to 6.x because typescript-eslint does not yet support 7.
