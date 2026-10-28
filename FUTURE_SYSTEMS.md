# Pay KyGame 3D Prototype — Future Systems Guide

## Files to use

Replace your old `m.HTML` prototype with these new files:

- `index.html`
- `style.css`
- `main.js`

You can keep `m.HTML` as a backup, but the working 3D demo is now loaded from `index.html`.

## How to run in GitHub Codespaces

1. Open the terminal in your Codespace.
2. Change to the project directory if needed:
   ```bash
   cd /workspaces/pay-kygame
   ```
3. Start a simple local web server:
   ```bash
   python3 -m http.server 8080
   ```
4. In Codespaces, open the forwarded port `8080` using the browser preview or the ports panel.
5. Visit the URL shown by Codespaces, usually:
   - `http://127.0.0.1:8080`
   - or the forwarded browser preview URL

> Do not use the file path directly in the browser; use a local server so Three.js assets and scripts load correctly.

## Where to add your gameplay systems

The new prototype is intentionally organized in `main.js` with these sections:

- **Global game state**: variables like `boardData`, `timeOfDay`, `currentDay`, `weather`, `stormType`, and `selectedTile`.
- **Biome definitions**: `biomeTypes` and `terrainProgression` hold your procedural terrain rules.
- **Game system functions**: functions such as `processTerrainGrowth`, `processForestSpread`, `processChasmFill`, `processHighstormCollapse`, `startStorm`, and `endStorm`.
- **Hex grid generation**: `generateBoard`, `buildWorldMeshes`, and `createTileMesh` create the 3D map.
- **Simulation loop**: `updateTime` advances the clock, applies daily terrain changes, and triggers storms.
- **Render loop**: `animate` updates water animation, input, camera, and draws the scene.

### Best places to extend logic

- `generateBoard()`
  - add your procedural terrain, biome variety, forest cover, water level, and unit placement here.
- `processTerrainGrowth(tile)`
  - keep your terrain evolution and tile progression rules here.
- `processForestSpread(tile)`
  - hook existing forest spread rules into the 3D world.
- `startStorm(type)` / `endStorm()`
  - add storm effects that change tile data, water, and visuals.
- `updateTime(delta)`
  - connect your existing time-of-day system, storm scheduling, and day transitions here.
- `buildWorldMeshes()`
  - add actual unit markers, 3D unit models, and enhanced tile visuals.
- `updateUI()`
  - display game state, selected tile data, and storm information.

## Two-layer terrain

- `generateRegions()` seeds 16 region centers and expands them over neighboring hexes with a multi-source flood fill, guaranteeing contiguous regions. Region effects are shared by all hexes with the same region ID.
- Every region owns a `baseElevation` in the `0`–`MAX_REGION_BASE_ELEVATION` range (currently 10); high bases are preserved and lower neighbors rise into a one-level gradient. Normal hexes vary by at most `MAX_LOCAL_ELEVATION_DEVIATION` (0.5), with a boundary falloff that eases toward adjacent region bases.
- `sampleWorldFields()` uses smooth, seeded noise fields for height, moisture, temperature, rockiness, and chasms. `chooseBiome()` derives each hex's local terrain from those fields, so neighboring terrain tends to transition naturally.
- Each tile stores both `region` and local fields such as `terrain`, `elevation`, `forestCover`, `obstacle`, and `waterLevel`.
- `buildTileCornerElevations()` assigns shared heights to the corners of neighboring hexes, ignoring chasm floors when calculating normal land corners. `createTileMesh()` triangulates normal terrain; chasms use a separate steep-walled basin mesh at `CHASM_ELEVATION` and never receive forest cover.
- `getTacticalEffects()` keeps regional combat modifiers separate from local terrain and elevation effects, then calculates the combined result shown by `updateUI()`.
- `addRegionBoundaries()` draws colored borders above the terrain. Tile colors retain their biome identity with a subtle tint from the containing region.
- `setTerrain()` keeps CREM terrain changes local and bounded. If a CREM progression would push a tile past its local elevation allowance, `processTerrainGrowth()` transfers its accumulated CREM to adjacent hexes with room to progress. Chasm generation/spread, high-storm collapse, isolated-chasm prevention, and water/CREM filling remain active. Regions reclassify as Chasm Regions at `CHASM_REGION_THRESHOLD` (0.35).

## Recommended future feature slots

- `selectedTile` and `highlightTile()`
  - add hover highlighting, click selection, and more readable tile feedback.
- `waterMeshes` and `updateWaterAnimation()`
  - add animated waves, rainfall, and water rise/fall.
- `forestMeshes`
  - replace low-poly trees with custom models or improved visuals.
- `raycaster` input handling
  - add right-click actions, unit movement, and tile commands.

## Notes for beginners

- `index.html` loads the UI and Three.js scripts.
- `style.css` styles the overlay and canvas.
- `main.js` contains all game logic and 3D rendering.

If you want, I can also add a second version with a small unit marker system and simple rain particle effects next.``