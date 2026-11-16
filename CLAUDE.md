# CLAUDE.md

Conventions for working on this project. Read `DESIGN.md` for what the game is and how it is
built; keep that file up to date when the design changes.

## What this is

An original 3D motorcycle delivery game set in a stylized, fictional Rio de Janeiro hillside
neighborhood. How you ride affects the cargo. It may ship commercially on Steam and iOS, so
write production-quality code, not demo code.

## Commands

- `npm run dev` — dev server
- `npm run build` — typecheck, then production build
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint and Prettier check (`npm run format` to fix formatting)
- `npm test` — Vitest, single run

All of these must pass before every commit.

## Hard rules

- **Names:** the game name and the fictional app name live only in `src/brand.ts`. Never use
  real brands (iFood, Rappi, Uber, etc.) anywhere, including comments and commit messages.
- **Assets:** only free assets that allow commercial use (CC0 preferred). Record creator,
  license and source URL in `CREDITS.md` in the same commit. Never guess a credit. If a
  license is unclear, make a placeholder in code instead.
- **No real landmarks** or real business likenesses in the world.
- **Dependencies:** adding a dependency or changing the structure in `DESIGN.md` needs the
  owner's approval first. Stop and ask.
- **Git:** small commits with clear messages, game playable after each. Push to `origin`
  (github.com/Julian-Reyes/delivery-game) after every commit. Never force-push.
- **TypeScript 6.x:** stay on 6.x until typescript-eslint supports 7.

## Architecture rules

- `src/sim/` is pure game logic (cargo damage, pay, orders, tuning numbers). It must not
  import three.js, Rapier, or touch `window`/`document`. ESLint enforces this. Everything in
  it is unit-tested.
- Game code reads input only through the actions in `src/input/`, never from raw key,
  gamepad or touch events.
- The simulation runs at a fixed 60 Hz step; rendering interpolates. Do not put gameplay
  logic in per-frame render code.
- HUD and menus are plain DOM/CSS over the canvas. No UI framework.
- Tuning numbers live in `src/sim/tuning.ts`, not scattered through the code.
- User-facing text is English for now; keep strings together so translation is easy later.

## Performance budget (phones)

- Under ~100 draw calls; 60 FPS with a 4x CPU slowdown.
- Pixel ratio capped at 1.5, frame rate capped at 60, rendering paused when the tab is hidden.
- Static geometry merged; repeated objects instanced.
- One shadow-casting light with a small shadow area that follows the player. The city does
  not cast real-time shadows.
- Avoid per-frame allocations in the loop (reuse vectors and arrays).
- Check the debug overlay (F3) after any change that adds objects or materials.

## Workflow

- After each major step: run the game in the browser, take a screenshot, check the frame
  rate against the budget, fix problems before moving on.
- Match the style of surrounding code. Comments explain why, not what.
