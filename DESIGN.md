# Design

Living description of the game and its architecture. Update it in the same commit as any
change that makes it wrong.

## Status

| Step | What                                                         | State   |
| ---- | ------------------------------------------------------------ | ------- |
| 1    | Scaffold, scripts, docs, `brand.ts`                          | Done    |
| 2    | Core loop, renderer with perf caps, debug overlay, input     | Done    |
| 3    | Cargo and pay pure functions with tests                      | Pending |
| 4    | Neighborhood, lighting, fog, colliders                       | Pending |
| 5    | Bike controller, wheelie, crash and respawn, camera          | Pending |
| 6    | Delivery loop: title, order picker, waypoint, HUD, results   | Pending |
| 7    | Traffic: cars and a bus on fixed routes                      | Pending |
| 8    | Touch controls, placeholder sounds, performance pass, report | Pending |

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
  traffic/     routes, vehicles (instanced)
  game/        delivery state machine, session earnings
  ui/          title, order picker, HUD, results (DOM)
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

- Fictional hillside neighborhood in the spirit of Rio; no real landmarks.
- Touch layout: steer buttons on one side, throttle and brake on the other. Tilt steering
  later.
- UI text in English, pay in R$.
- TypeScript pinned to 6.x because typescript-eslint does not yet support 7.
