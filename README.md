# Browser Minecraft Clone

A from-scratch voxel world in the browser — Vite + TypeScript + Three.js.

Built **phase by phase** (correct → feel → look → persist → extras). This is
**Phase 0: Foundations + a correct, freeze-free world.**

## Run it

```bash
npm install
npm run dev      # open the printed localhost URL
```

Other scripts:

```bash
npm run build      # tsc --noEmit + vite build
npm run typecheck  # tsc --noEmit
```

Optional world seed: `http://localhost:5173/?seed=12345` (defaults to `1337`).

## Controls (Phase 0 — free-fly)

- **Click** the canvas to capture the mouse (Pointer Lock); **Esc** releases it.
- **Mouse** — look around.
- **W A S D** — move horizontally; **Space** — up; **Shift** — down (or sprint while moving).

A debug HUD (top-left) shows fps, position, current chunk, loaded chunk count,
mesh-queue length, seed, and worker count.

## Phase 0 playtest gate

- Fly around freely — **no freeze / hitch** when crossing chunk borders
  (generation runs in Web Workers; meshing is throttled to a few chunks/frame).
- **Trees are whole across chunk borders** (no half-trees at seams).
- Reloading with the **same seed produces the same world**.
- Glass / water / leaves show **no internal faces** between same-type blocks.

## Architecture (Phase 0)

```
src/
  core/      DOM-free, THREE-free — importable by the worker
    constants.ts   dimensions, indexing, throttles
    BlockTypes.ts  Block enum + flat lookup tables + canonical TILE_INDEX
    Chunk.ts       data + light (flat in P0) + height map
    WorldGen.ts    terrain + caves (cheese+spaghetti) + ore + feature decisions
    features.ts    tree/grass templates (pure offset lists)
    noise/         seeded hash + gradient noise + fBm/ridged
  world/
    World.ts       chunk map, edit deltas, pending cross-chunk features, save/load
  gen/
    worker.ts          generation worker (core only; zero-copy ArrayBuffer transfer)
    workerProtocol.ts  shared message types
    GenScheduler.ts    main-thread worker pool + request queue
  render/      THREE only
    atlas.ts       procedural structured texture atlas
    materials.ts   one opaque + one transparent ShaderMaterial (shared uniforms)
    ChunkMesh.ts   geometry builder (corrected cull rule, per-vertex light attr)
    ChunkRenderer.ts  scene meshes; disposes geometry on unload
  player/Camera.ts    raw Pointer Lock fly camera (manual yaw/pitch)
  game/ChunkManager.ts  load/unload ring + per-frame generation/mesh throttle
  main.ts             bootstrap + render loop
```

### Deferred hooks (wired but inert until later phases)
- `Chunk.light` + `LIGHT_EMISSION` + the per-vertex `light` attribute — **Phase 3** lighting.
- `IS_SOLID` + `World.queueLightUpdate` — **Phase 1** collision / **Phase 3** light updates.
- `World.editBlock` / edit deltas — used by **Phase 1** break/place.

### Dev checks

```bash
npx tsx scripts/determinism-check.ts   # same seed -> identical chunks
npx tsx scripts/terrain-sample.ts      # terrain/ore/cave sanity sample
```
