// main.js
// This file creates a 3D hex terrain prototype with Three.js.
// All of your gameplay systems—terrain generation, storms, time, water, chasms, forest spread, units—can be added here.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const boardSize = 20;
const hexRadius = 2.2;
const elevationScale = 1.7;
const tileThickness = 1.0;
const MAX_REGION_LOCAL_DEVIATION = 2;
const REGION_TRANSITION_WIDTH = 3;
const MAX_REGION_BASE_ELEVATION = 4;
const CHASM_REGION_THRESHOLD = 0.35;
const CHASM_ELEVATION = -5;
const TERRAIN_TOP_OFFSET = tileThickness * 2;
const TERRAIN_BOTTOM_Y = -8;
const boardCenterOffset = new THREE.Vector3(
  ((boardSize - 1) * hexRadius * 1.5) / 2,
  0,
  (Math.sqrt(3) * hexRadius * (boardSize * 0.5)) / 2
);

// Map boundary constraints
const mapBounds = {
  minX: -5,
  maxX: boardCenterOffset.x * 2 + 5,
  minZ: -5,
  maxZ: boardCenterOffset.z * 2 + 5,
  minY: 1
};

let timeSpeed = 1;
let timeOfDay = 8;
let currentDay = 1;
let weather = 'Clear';
let stormType = null;
let stormRemainingHours = 0;
let nextHighstormDay = 5;
let nextHighstormWarningDay = 3;
let nextEverstormDay = 12;
let paused = false;
let selectedTile = null;
let activeHighlightTile = null;
let devView = false;
let seed = Math.floor(Math.random() * 999999);
let noiseSeed = seed;

const boardData = [];
const regions = new Map();
const regionGrid = [];
const regionBoundaryDistances = [];
const tileMeshes = [];
const waterMeshes = [];
const forestMeshes = [];

// ----- THREE.JS SETUP -----
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#a8d8ff', 0.020);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(30, 42, 36);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#7db3ff', 1);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.panSpeed = 1.2;
controls.minDistance = 12;
controls.maxDistance = 160;
controls.minPolarAngle = 0.2;
controls.maxPolarAngle = Math.PI * 0.72;
controls.target.set(0, 0, 0);
controls.update();

const keyboardState = {
  arrowup: false,
  arrowdown: false,
  arrowleft: false,
  arrowright: false,
  w: false,
  a: false,
  s: false,
  d: false
};

function onKeyDown(event) {
  if (event.key === 'Escape' && selectedTile) {
    event.preventDefault();
    clearTileSelection();
    return;
  }
  const key = event.key.toLowerCase();
  if (key in keyboardState) {
    keyboardState[key] = true;
    event.preventDefault();
  }
}

function onKeyUp(event) {
  const key = event.key.toLowerCase();
  if (key in keyboardState) {
    keyboardState[key] = false;
    event.preventDefault();
  }
}

function updateKeyboardCamera(delta) {
  const moveDistance = 20 * delta; // Adjust speed as needed
  const sideways = new THREE.Vector3();
  const forward = new THREE.Vector3();
  
  // Get camera direction vectors
  camera.getWorldDirection(forward);
  forward.normalize();
  
  sideways.crossVectors(camera.up, forward);
  sideways.normalize();

  if (keyboardState.arrowleft || keyboardState.a) {
    camera.position.addScaledVector(sideways, moveDistance);
    controls.target.addScaledVector(sideways, moveDistance);
  }
  if (keyboardState.arrowright || keyboardState.d) {
    camera.position.addScaledVector(sideways, -moveDistance);
    controls.target.addScaledVector(sideways, -moveDistance);
  }
  if (keyboardState.arrowup || keyboardState.w) {
    camera.position.addScaledVector(forward, moveDistance);
    controls.target.addScaledVector(forward, moveDistance);
  }
  if (keyboardState.arrowdown || keyboardState.s) {
    camera.position.addScaledVector(forward, -moveDistance);
    controls.target.addScaledVector(forward, -moveDistance);
  }

  // Apply boundary constraints
  camera.position.x = Math.max(mapBounds.minX, Math.min(mapBounds.maxX, camera.position.x));
  camera.position.y = Math.max(mapBounds.minY, camera.position.y);
  camera.position.z = Math.max(mapBounds.minZ, Math.min(mapBounds.maxZ, camera.position.z));

  controls.target.x = Math.max(mapBounds.minX, Math.min(mapBounds.maxX, controls.target.x));
  controls.target.y = Math.max(mapBounds.minY - 10, controls.target.y); // Allow target to be below camera
  controls.target.z = Math.max(mapBounds.minZ, Math.min(mapBounds.maxZ, controls.target.z));
}

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const debugGrid = new THREE.GridHelper(220, 220, '#5b7287', '#25303d');
debugGrid.position.y = TERRAIN_BOTTOM_Y;
debugGrid.material.opacity = 0.35;
debugGrid.material.transparent = true;
scene.add(debugGrid);

const directionalLight = new THREE.DirectionalLight('#ffffff', 1.3);
directionalLight.position.set(30, 40, 20);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 5;
directionalLight.shadow.camera.far = 100;
directionalLight.shadow.camera.left = -40;
directionalLight.shadow.camera.right = 40;
directionalLight.shadow.camera.top = 40;
directionalLight.shadow.camera.bottom = -40;
scene.add(directionalLight);

const fillLight = new THREE.HemisphereLight('#cde7ff', '#14213d', 0.35);
scene.add(fillLight);

const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(260, 260),
  new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 1, metalness: 0 })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = TERRAIN_BOTTOM_Y;
groundPlane.receiveShadow = true;
scene.add(groundPlane);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const highlightMaterial = new THREE.MeshBasicMaterial({ color: '#f8f32b', transparent: true, opacity: 0.35 });
const highlightMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(hexRadius * 1.08, hexRadius * 1.08, 0.1, 6),
  highlightMaterial
);
highlightMesh.rotation.x = -Math.PI / 2;
highlightMesh.visible = false;
highlightMesh.renderOrder = 999;
scene.add(highlightMesh);

// ----- BIOME DEFINITIONS -----
const biomeTypes = [
  { name: 'Plains', color: '#fcd34d', icon: '🌾', elevation: 0 },
  { name: 'Forest', color: '#15803d', icon: '🌳', elevation: 1 },
  { name: 'Hilly Forest', color: '#166534', icon: '🌲', elevation: 2 },
  { name: 'Mountain Forest', color: '#25472a', icon: '⛰️', elevation: 4 },
  { name: 'Burned Forest', color: '#7c2d12', icon: '🔥', elevation: 1 },
  { name: 'Chasm', color: '#0f172a', icon: '🕳️', elevation: -2 },
  { name: 'Young Forest', color: '#84cc16', icon: '🌱', elevation: 0 },
  { name: 'Wetlands', color: '#0f766e', icon: '🌿', elevation: 0 },
  { name: 'Rocky Wetlands', color: '#115e59', icon: '🪨', elevation: 1 },
  { name: 'Mountains', color: '#6b7280', icon: '🏔️', elevation: 5 },
  { name: 'Stone Forest', color: '#7c6a4d', icon: '🪨', elevation: 3 },
  { name: 'Crem Flats', color: '#d6b87d', icon: '🟫', elevation: 0 },
  { name: 'Crem Hills', color: '#a9734f', icon: '⛰️', elevation: 2 },
  { name: 'Dust Basin', color: '#b59174', icon: '🏜️', elevation: -1 },
  { name: 'Cliffside', color: '#525252', icon: '🧱', elevation: 3 },
  { name: 'Ancient Crem Fields', color: '#5b4636', icon: '🪨', elevation: 3 }
];

const regionProfiles = [
  { name: 'Open Steppe', icon: '◈', climate: 'Dry grassland', preferred: 'Mounted', movementRule: 'Open ground', hazard: 'Wind exposure', modifiers: { mounted: 40, foot: 25, light: 10 } },
  { name: 'Broken Highlands', icon: '▲', climate: 'Cool uplands', preferred: 'Foot', movementRule: 'Rough ground', hazard: 'Rockfall', modifiers: { mounted: -10, foot: 25, light: 15 } },
  { name: 'Deepwood Reach', icon: '♣', climate: 'Temperate woodland', preferred: 'Light', movementRule: 'Dense undergrowth', hazard: 'Falling limbs', modifiers: { mounted: -20, foot: 15, light: 25 } },
  { name: 'Lowland March', icon: '≈', climate: 'Humid lowland', preferred: 'Foot', movementRule: 'Soft ground', hazard: 'Seasonal flooding', modifiers: { mounted: -10, foot: 15, light: 10 } }
];
const regionColors = ['#e6a84a', '#65aeb5', '#79a96b', '#d17d62', '#aa91c4', '#c7bb72', '#638bc0', '#c77da1'];
const terrainModifiers = {
  Forest: { mounted: -20, foot: 15, light: 20 },
  'Hilly Forest': { mounted: -25, foot: 20, light: 25 },
  'Mountain Forest': { mounted: -30, foot: 15, light: 20 },
  'Burned Forest': { mounted: -5, foot: 0, light: 5 },
  'Young Forest': { mounted: -5, foot: 5, light: 10 },
  'Dense Forest': { mounted: -25, foot: 20, light: 30 },
  'Heavy Forest': { mounted: -30, foot: 20, light: 35 },
  'Crem Hills': { mounted: -5, foot: 10, light: 10 },
  'Rocky Wetlands': { mounted: -15, foot: 5, light: 10 },
  Mountains: { mounted: -20, foot: 10, light: 15 },
  'Stone Forest': { mounted: -15, foot: 10, light: 15 },
  Wetlands: { mounted: -20, foot: 5, light: 10 },
  Chasm: { mounted: -100, foot: -100, light: -100 }
};

const terrainProgression = {
  'Plains': { next: 'Crem Flats', threshold: 100 },
  'Crem Flats': { next: 'Crem Hills', threshold: 175 },
  'Crem Hills': { next: 'Stone Forest', threshold: 275 },
  'Forest': { next: 'Hilly Forest', threshold: 110 },
  'Hilly Forest': { next: 'Mountain Forest', threshold: 200 },
  'Mountain Forest': { next: 'Stone Forest', threshold: 325 },
  'Wetlands': { next: 'Rocky Wetlands', threshold: 100 },
  'Rocky Wetlands': { next: 'Cliffside', threshold: 212 },
  'Cliffside': { next: 'Mountains', threshold: 350 },
  'Mountains': { next: 'Stone Forest', threshold: 400 },
  'Dust Basin': { next: 'Crem Flats', threshold: 90 },
  'Burned Forest': { next: 'Dust Basin', threshold: 150 },
  'Stone Forest': { next: 'Ancient Crem Fields', threshold: 500 }
};

// ----- GAME SYSTEM FUNCTIONS -----
function seededRandom() {
  const value = Math.sin(seed++) * 10000;
  return value - Math.floor(value);
}

function getContrastColor(hexColor) {
  const color = new THREE.Color(hexColor);
  const luminance = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  return luminance > 0.5 ? '#0f172a' : '#f8fafc';
}

function getHexPosition(x, y) {
  const offsetX = hexRadius * 1.5 * x;
  const offsetZ = Math.sqrt(3) * hexRadius * (y + (x % 2 === 0 ? 0 : 0.5));
  return new THREE.Vector3(offsetX, 0, offsetZ).sub(boardCenterOffset);
}

function getHexNeighborCoordinates(x, y) {
  const directions = x % 2 === 0
    ? [[1, 0], [0, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
    : [[1, 1], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, 0]];
  return directions.map(([dx, dy]) => [x + dx, y + dy]);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function calculateRegionBaseElevation(fields) {
  const terrainHeight = clamp((fields.height - 0.3) * 8, 0, MAX_REGION_BASE_ELEVATION);
  return Math.round(terrainHeight * 2) / 2;
}

function noiseHash(x, y, channel) {
  const value = Math.sin(x * 127.1 + y * 311.7 + noiseSeed * 0.017 + channel * 74.7) * 43758.5453;
  return value - Math.floor(value);
}

function valueNoise(x, y, scale, channel) {
  const gridX = x / scale;
  const gridY = y / scale;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const smoothX = tx * tx * (3 - 2 * tx);
  const smoothY = ty * ty * (3 - 2 * ty);
  const top = noiseHash(x0, y0, channel) * (1 - smoothX) + noiseHash(x0 + 1, y0, channel) * smoothX;
  const bottom = noiseHash(x0, y0 + 1, channel) * (1 - smoothX) + noiseHash(x0 + 1, y0 + 1, channel) * smoothX;
  return top * (1 - smoothY) + bottom * smoothY;
}

function sampleWorldFields(x, y) {
  return {
    height: valueNoise(x, y, 7, 1) * 0.68 + valueNoise(x + 8, y - 5, 3.5, 2) * 0.32,
    moisture: valueNoise(x - 6, y + 4, 8, 3) * 0.68 + valueNoise(x + 3, y - 7, 3.5, 4) * 0.32,
    temperature: valueNoise(x + 10, y - 3, 10, 5),
    rockiness: valueNoise(x - 13, y + 11, 2.5, 6),
    chasm: valueNoise(x + 17, y - 14, 2.4, 7)
  };
}

function generateRegions() {
  regions.clear();
  regionGrid.length = 0;
  const regionRows = 4;
  const regionColumns = 4;
  const centers = [];

  for (let row = 0; row < regionRows; row += 1) {
    for (let column = 0; column < regionColumns; column += 1) {
      const x = Math.max(0, Math.min(boardSize - 1, Math.round((column + 0.5) * boardSize / regionColumns + (seededRandom() - 0.5) * 1.6)));
      const y = Math.max(0, Math.min(boardSize - 1, Math.round((row + 0.5) * boardSize / regionRows + (seededRandom() - 0.5) * 1.6)));
      const fields = sampleWorldFields(x, y);
      let profile;
      if (fields.height > 0.64) profile = regionProfiles[1];
      else if (fields.moisture > 0.48) profile = regionProfiles[2];
      else if (fields.temperature > 0.58 && fields.moisture < 0.45) profile = regionProfiles[0];
      else profile = regionProfiles[3];

      const index = centers.length;
      const regionColor = regionColors[index % regionColors.length];
      const region = {
        id: `R${String(index + 1).padStart(2, '0')}`,
        name: profile.name,
        icon: profile.icon,
        climate: profile.climate,
        preferred: profile.preferred,
        movementRule: profile.movementRule,
        hazard: profile.hazard,
        modifiers: { ...profile.modifiers },
        color: regionColor,
        normalProfile: { ...profile, modifiers: { ...profile.modifiers }, color: regionColor },
        center: { x, y },
        centerHeight: fields.height,
        baseElevation: calculateRegionBaseElevation(fields),
        elevationMode: 'Regional base with local variation',
        tileCount: 0,
        chasmCount: 0,
        neighboringRegions: new Set(),
        isChasmRegion: false
      };
      regions.set(region.id, region);
      centers.push(region);
    }
  }

  for (let y = 0; y < boardSize; y += 1) {
    regionGrid.push(Array(boardSize).fill(null));
  }

  const frontier = centers.map(region => {
    regionGrid[region.center.y][region.center.x] = region;
    region.tileCount = 1;
    return { ...region.center, region };
  });
  for (let index = 0; index < frontier.length; index += 1) {
    const current = frontier[index];
    getHexNeighborCoordinates(current.x, current.y).forEach(([x, y]) => {
      if (x < 0 || x >= boardSize || y < 0 || y >= boardSize || regionGrid[y][x]) return;
      regionGrid[y][x] = current.region;
      current.region.tileCount += 1;
      frontier.push({ x, y, region: current.region });
    });
  }

  buildRegionElevationRules();
}

function buildRegionElevationRules() {
  regions.forEach(region => region.neighboringRegions.clear());
  regionGrid.forEach((row, y) => row.forEach((region, x) => {
    getHexNeighborCoordinates(x, y).forEach(([neighborX, neighborY]) => {
      if (neighborX < 0 || neighborX >= boardSize || neighborY < 0 || neighborY >= boardSize) return;
      const neighborRegion = regionGrid[neighborY][neighborX];
      if (region !== neighborRegion) region.neighboringRegions.add(neighborRegion);
    });
  }));

  regionBoundaryDistances.length = 0;
  const frontier = [];
  for (let y = 0; y < boardSize; y += 1) {
    regionBoundaryDistances.push(Array(boardSize).fill(Infinity));
    for (let x = 0; x < boardSize; x += 1) {
      const region = regionGrid[y][x];
      const isBoundary = getHexNeighborCoordinates(x, y).some(([neighborX, neighborY]) =>
        neighborX >= 0 && neighborX < boardSize && neighborY >= 0 && neighborY < boardSize && regionGrid[neighborY][neighborX] !== region
      );
      if (isBoundary) {
        regionBoundaryDistances[y][x] = 0;
        frontier.push({ x, y });
      }
    }
  }

  for (let index = 0; index < frontier.length; index += 1) {
    const current = frontier[index];
    getHexNeighborCoordinates(current.x, current.y).forEach(([x, y]) => {
      if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return;
      if (regionGrid[y][x] !== regionGrid[current.y][current.x] || regionBoundaryDistances[y][x] !== Infinity) return;
      regionBoundaryDistances[y][x] = regionBoundaryDistances[current.y][current.x] + 1;
      frontier.push({ x, y });
    });
  }
}

function calculateLocalElevationOffset(region, x, y, fields) {
  const neighboringBase = region.neighboringRegions.size > 0
    ? [...region.neighboringRegions].reduce((sum, neighbor) => sum + neighbor.baseElevation, 0) / region.neighboringRegions.size
    : region.baseElevation;
  const boundaryDistance = regionBoundaryDistances[y][x];
  const boundaryWeight = Number.isFinite(boundaryDistance)
    ? Math.max(0, 1 - boundaryDistance / REGION_TRANSITION_WIDTH)
    : 0;
  const boundaryBias = clamp(
    (neighboringBase - region.baseElevation) * 0.5,
    -MAX_REGION_LOCAL_DEVIATION,
    MAX_REGION_LOCAL_DEVIATION
  ) * boundaryWeight;
  const localNoise = (fields.height - region.centerHeight) * 1.2 + (valueNoise(x, y, 2.6, 9) - 0.5) * 0.4;
  return clamp(
    boundaryBias + localNoise,
    -MAX_REGION_LOCAL_DEVIATION,
    MAX_REGION_LOCAL_DEVIATION
  );
}

function updateRegionClassification(region) {
  if (!region || region.tileCount === 0) return;
  const chasmFraction = region.chasmCount / region.tileCount;
  const isChasmRegion = chasmFraction >= CHASM_REGION_THRESHOLD;
  if (isChasmRegion === region.isChasmRegion) return;

  region.isChasmRegion = isChasmRegion;
  if (isChasmRegion) {
    region.name = 'Chasm Region';
    region.icon = '🕳️';
    region.climate = 'Fractured ravine';
    region.preferred = 'Light';
    region.movementRule = 'Unstable fissures';
    region.hazard = 'Collapse';
    region.modifiers = { mounted: -100, foot: -60, light: -25 };
    region.color = '#53455d';
    region.elevationMode = 'Abyssal; chasms ignore the regional base';
  } else {
    const profile = region.normalProfile;
    region.name = profile.name;
    region.icon = profile.icon;
    region.climate = profile.climate;
    region.preferred = profile.preferred;
    region.movementRule = profile.movementRule;
    region.hazard = profile.hazard;
    region.modifiers = { ...profile.modifiers };
    region.color = profile.color;
    region.elevationMode = 'Regional base with local variation';
  }
}

function getTileDisplayColor(tile) {
  return new THREE.Color(tile.color).lerp(new THREE.Color(tile.region.color), 0.08);
}

function getTileSurfaceHeight(tile) {
  return tile.elevation * elevationScale + TERRAIN_TOP_OFFSET;
}

function getTacticalEffects(tile, unitType) {
  const regionalCombat = tile.region.modifiers[unitType];
  const terrainName = terrainModifiers[tile.forestCover] ? tile.forestCover : tile.terrain;
  let terrainCombat = terrainModifiers[tile.terrain]?.[unitType] || 0;
  if (['Dense Forest', 'Heavy Forest'].includes(tile.forestCover)) {
    const coverCombat = terrainModifiers[tile.forestCover][unitType];
    terrainCombat = terrainModifiers[tile.terrain]
      ? terrainCombat + coverCombat - terrainModifiers.Forest[unitType]
      : coverCombat;
  } else if (!terrainModifiers[tile.terrain] && terrainModifiers[tile.forestCover]) {
    terrainCombat = terrainModifiers[tile.forestCover][unitType];
  }
  const elevationCombat = Math.min(25, Math.max(0, tile.elevation) * 5);
  const localCombat = terrainCombat + elevationCombat;
  const blocked = tile.terrain === 'Chasm' || (tile.obstacle === 'Boulder' && unitType === 'mounted');
  let movementTax = Math.max(0, tile.elevation - 2);

  if (['Forest', 'Hilly Forest', 'Mountain Forest', 'Dense Forest', 'Heavy Forest'].includes(terrainName)) {
    movementTax += unitType === 'light' ? 0 : unitType === 'mounted' ? 2 : 1;
  }
  if (tile.obstacle === 'Boulder') movementTax += unitType === 'light' ? 1 : 2;
  if (tile.terrain === 'Wetlands' || tile.terrain === 'Rocky Wetlands') movementTax += 1;
  if (['Broken Highlands', 'Deepwood Reach', 'Lowland March'].includes(tile.region.name)) movementTax += 1;
  if (tile.region.isChasmRegion && tile.terrain !== 'Chasm') movementTax += 3;

  return {
    regionalCombat,
    localCombat,
    finalCombat: regionalCombat + localCombat,
    movement: blocked ? 'Blocked' : `${1 + movementTax} AP`
  };
}

function isForestTile(tile) {
  if (tile.terrain === 'Chasm') return false;
  const forestTerrains = ['Forest', 'Hilly Forest', 'Mountain Forest'];
  return (
    forestTerrains.includes(tile.terrain) ||
    ['Young Forest', 'Dense Forest', 'Heavy Forest'].includes(tile.forestCover)
  );
}

function getAdjacentTiles(tile) {
  const neighbors = [];
  getHexNeighborCoordinates(tile.x, tile.y).forEach(([nx, ny]) => {
    if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
      neighbors.push(boardData[ny][nx]);
    }
  });

  return neighbors;
}

function setTerrain(tile, terrainName) {
  const wasChasm = tile.terrain === 'Chasm';
  tile.terrain = terrainName;
  const biome = biomeTypes.find(b => b.name === terrainName) || biomeTypes[0];
  tile.color = biome.color;
  tile.icon = biome.icon;
  const isChasm = terrainName === 'Chasm';
  if (isChasm) {
    tile.elevation = CHASM_ELEVATION;
    tile.forestCover = null;
    tile.obstacle = null;
  } else if (tile.region) {
    tile.regionElevationOffset ??= 0;
    tile.elevation = tile.region.baseElevation + tile.regionElevationOffset + getBiomeElevationOffset(biome);
  } else {
    tile.elevation = biome.elevation;
  }

  if (tile.region && wasChasm !== isChasm) {
    tile.region.chasmCount += isChasm ? 1 : -1;
    updateRegionClassification(tile.region);
  }
}

function getBiomeElevationOffset(biome) {
  return biome.elevation * 0.75;
}

function wouldTerrainGrowthBreakElevationLimit(tile, nextTerrain) {
  if (!tile.region || tile.terrain === 'Chasm') return false;
  const currentBiome = biomeTypes.find(biome => biome.name === tile.terrain) || biomeTypes[0];
  const nextBiome = biomeTypes.find(biome => biome.name === nextTerrain) || biomeTypes[0];
  return Math.abs(getBiomeElevationOffset(nextBiome) - getBiomeElevationOffset(currentBiome)) > MAX_REGION_LOCAL_DEVIATION;
}

function transferCremToEligibleNeighbors(tile) {
  const eligibleNeighbors = getAdjacentTiles(tile).filter(neighbor =>
    neighbor.terrain !== 'Chasm' &&
    terrainProgression[neighbor.terrain] &&
    !wouldTerrainGrowthBreakElevationLimit(neighbor, terrainProgression[neighbor.terrain].next)
  );
  if (eligibleNeighbors.length === 0 || tile.crem <= 0) return false;

  const transferredCrem = tile.crem;
  const baseShare = Math.floor(transferredCrem / eligibleNeighbors.length);
  let remainder = transferredCrem % eligibleNeighbors.length;
  eligibleNeighbors.forEach(neighbor => {
    neighbor.crem += baseShare + (remainder > 0 ? 1 : 0);
    remainder -= remainder > 0 ? 1 : 0;
  });
  tile.crem = 0;
  return true;
}

function processTerrainGrowth(tile) {
  const progression = terrainProgression[tile.terrain];
  if (!progression || tile.crem < progression.threshold) return;
  if (wouldTerrainGrowthBreakElevationLimit(tile, progression.next)) {
    transferCremToEligibleNeighbors(tile);
    return;
  }
  setTerrain(tile, progression.next);
  tile.crem = 0;
}

function processForestSpread(tile) {
  if (tile.terrain === 'Chasm' || tile.terrain === 'Burned Forest') return;
  const adjacent = getAdjacentTiles(tile);
  const forestNeighbors = adjacent.filter(isForestTile).length;

  if (!tile.forestCover) {
    if (forestNeighbors > 0 && seededRandom() > 0.8) {
      tile.forestCover = 'Young Forest';
    }
    return;
  }

  if (tile.forestCover === 'Young Forest') {
    if (forestNeighbors >= 2 && seededRandom() > 0.5) {
      tile.forestCover = 'Forest';
    }
  } else if (tile.forestCover === 'Forest') {
    if (forestNeighbors >= 3 && seededRandom() > 0.5) {
      tile.forestCover = 'Dense Forest';
    }
  } else if (tile.forestCover === 'Dense Forest') {
    if (forestNeighbors >= 3 && seededRandom() > 0.7) {
      tile.forestCover = 'Heavy Forest';
    }
  }
}

function processChasmFill(tile) {
  if (tile.terrain !== 'Chasm') return;
  if ((tile.waterLevel > 90 && seededRandom() > 0.96) || (tile.crem > 200 && seededRandom() > 0.98)) {
    setTerrain(tile, 'Wetlands');
    tile.collapseChance = 0;
  }
}

function processHighstormCollapse(tile) {
  if (tile.terrain === 'Chasm') return;
  const adjacent = getAdjacentTiles(tile);
  const erosionNeighbors = adjacent.filter(neighbor =>
    neighbor.waterLevel > 70 || ['Wetlands', 'Rocky Wetlands', 'Cliffside', 'Mountains'].includes(neighbor.terrain)
  ).length;

  if (erosionNeighbors < 3) return;
  if (seededRandom() > 0.5) {
    tile.collapseChance += 0.03 + seededRandom() * 0.02;
  }

  if (seededRandom() < tile.collapseChance) {
    setTerrain(tile, 'Chasm');
    tile.forestCover = null;
    tile.hazard = null;
    tile.collapseChance = 0;
  }
}

function scheduleHighstorm(fromDay = currentDay) {
  const interval = 4 + Math.floor(seededRandom() * 3);
  const scheduledDay = fromDay + interval;
  const warningLead = 1 + Math.floor(seededRandom() * 2);
  nextHighstormWarningDay = Math.max(fromDay + 1, scheduledDay - warningLead);
  return scheduledDay;
}

function scheduleEverstorm(fromDay = currentDay) {
  const interval = 12 + Math.floor(seededRandom() * 5);
  return fromDay + interval;
}

function initializeStormSchedule() {
  nextHighstormDay = scheduleHighstorm(currentDay);
  nextEverstormDay = scheduleEverstorm(currentDay);
}

function startStorm(type) {
  stormType = type;
  weather = type;
  stormRemainingHours = 10;

  boardData.flat().forEach(tile => {
    const cremGain = Math.floor(seededRandom() * (type === 'Everstorm' ? 15 : 30));
    const waterGain = Math.floor(seededRandom() * (type === 'Everstorm' ? 4 : 12));
    tile.crem += cremGain;
    tile.waterLevel = Math.min(100, tile.waterLevel + waterGain);
    processTerrainGrowth(tile);
    processHazardHealing(tile);
    processChasmFill(tile);

    if (type === 'Everstorm' && isForestTile(tile) && seededRandom() > 0.85) {
      setTerrain(tile, 'Burned Forest');
      tile.forestCover = null;
    }

    if (type === 'Highstorm') {
      processHighstormCollapse(tile);
    }

    if (seededRandom() > (type === 'Everstorm' ? 0.8 : 0.94)) {
      tile.hazard = 'lightning_blasted';
    }
  });

  rebuildVisuals();

  if (type === 'Highstorm') {
    nextHighstormDay = scheduleHighstorm(currentDay);
  } else {
    nextEverstormDay = scheduleEverstorm(currentDay);
  }
}

function endStorm() {
  stormType = null;
  weather = 'Clear';
}

function processHazardHealing(tile) {
  if (tile.hazard === 'lightning_blasted' && tile.crem >= 50) {
    tile.hazard = null;
  }
}

function formatCollapseRisk(label, tiles) {
  const riskTiles = tiles.filter(tile => tile.collapseChance > 0);
  const totalChance = tiles.reduce((sum, tile) => sum + tile.collapseChance, 0);
  const average = tiles.length ? (totalChance / tiles.length * 100).toFixed(2) : '0.00';
  const highest = tiles.length ? (Math.max(...tiles.map(tile => tile.collapseChance)) * 100).toFixed(1) : '0.0';
  const activity = riskTiles.length ? `${riskTiles.length}/${tiles.length} tiles at risk` : 'no active risk';
  return `<div class="risk-level"><span>${label}</span><span>${activity} · avg ${average}% · peak ${highest}%</span></div>`;
}

function getCollapseInfo(tile) {
  const regionTiles = boardData.flat().filter(candidate => candidate.region.id === tile.region.id);
  const mapTiles = boardData.flat();
  return `
    <div class="collapse-risk">
      <strong class="rules-heading">Chasm collapse risk</strong>
      <div class="risk-level"><span>This hex</span><span>${(tile.collapseChance * 100).toFixed(1)}%</span></div>
      ${formatCollapseRisk(`Region ${tile.region.id}`, regionTiles)}
      ${formatCollapseRisk('Whole map', mapTiles)}
    </div>`;
}

function clearTileSelection() {
  selectedTile = null;
  highlightTile(null);
  updateUI();
}

function getTileCornerPosition(tile, cornerIndex) {
  const tilePosition = getHexPosition(tile.x, tile.y);
  const angle = cornerIndex * Math.PI / 3;
  return new THREE.Vector3(
    tilePosition.x + Math.cos(angle) * hexRadius,
    0,
    tilePosition.z + Math.sin(angle) * hexRadius
  );
}

function getTileCornerKey(position) {
  return `${Math.round(position.x * 10000)}:${Math.round(position.z * 10000)}`;
}

function buildTileCornerElevations() {
  const cornerSamples = new Map();
  boardData.flat().forEach(tile => {
    tile.cornerKeys = [];
    for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
      const position = getTileCornerPosition(tile, cornerIndex);
      const key = getTileCornerKey(position);
      tile.cornerKeys.push(key);
      if (!cornerSamples.has(key)) cornerSamples.set(key, []);
      cornerSamples.get(key).push({ elevation: tile.elevation, chasm: tile.terrain === 'Chasm' });
    }
  });

  boardData.flat().forEach(tile => {
    tile.cornerElevations = tile.cornerKeys.map(key => {
      const samples = cornerSamples.get(key);
      const landSamples = samples.filter(sample => !sample.chasm);
      const values = landSamples.length ? landSamples : samples;
      return values.reduce((sum, sample) => sum + sample.elevation, 0) / values.length;
    });
  });
}

function createTileMesh(tile) {
  if (tile.terrain === 'Chasm') return createChasmTileMesh(tile);

  const positions = [0, tile.elevation * elevationScale + TERRAIN_TOP_OFFSET, 0];
  const indices = [];
  for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
    const angle = cornerIndex * Math.PI / 3;
    positions.push(
      Math.cos(angle) * hexRadius,
      tile.cornerElevations[cornerIndex] * elevationScale + TERRAIN_TOP_OFFSET,
      Math.sin(angle) * hexRadius
    );
    const nextCorner = (cornerIndex + 1) % 6;
    indices.push(0, 1 + nextCorner, 1 + cornerIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: getTileDisplayColor(tile),
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.tile = tile;
  return mesh;
}

function createChasmTileMesh(tile) {
  const positions = [];
  const indices = [];
  const centerHeight = tile.elevation * elevationScale + TERRAIN_TOP_OFFSET;
  const roughness = (valueNoise(tile.x, tile.y, 1.8, 10) - 0.5) * 0.65;

  for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
    const angle = cornerIndex * Math.PI / 3;
    positions.push(
      Math.cos(angle) * hexRadius,
      tile.cornerElevations[cornerIndex] * elevationScale + TERRAIN_TOP_OFFSET,
      Math.sin(angle) * hexRadius
    );
  }

  for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
    const angle = cornerIndex * Math.PI / 3 + roughness * 0.12;
    const cliffHeight = centerHeight + 0.35 + valueNoise(tile.x + cornerIndex, tile.y - cornerIndex, 1.3, 11) * 0.55;
    positions.push(
      Math.cos(angle) * hexRadius * 0.62,
      cliffHeight,
      Math.sin(angle) * hexRadius * 0.62
    );
  }
  positions.push(0, centerHeight + roughness * 0.2, 0);

  for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
    const nextCorner = (cornerIndex + 1) % 6;
    indices.push(cornerIndex, nextCorner, 6 + nextCorner, cornerIndex, 6 + nextCorner, 6 + cornerIndex);
  }
  const cliffIndexCount = indices.length;
  for (let cornerIndex = 0; cornerIndex < 6; cornerIndex += 1) {
    const nextCorner = (cornerIndex + 1) % 6;
    indices.push(12, 6 + nextCorner, 6 + cornerIndex);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.addGroup(0, cliffIndexCount, 1);
  geometry.addGroup(cliffIndexCount, 18, 2);
  geometry.computeVertexNormals();
  const material = [
    new THREE.MeshStandardMaterial({ color: tile.color, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: '#554b46', roughness: 1, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: '#080d17', roughness: 1, side: THREE.DoubleSide })
  ];
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.tile = tile;
  return mesh;
}

function createWaterPlane(tile, position) {
  const geometry = new THREE.CircleGeometry(hexRadius * 0.86, 32);
  const material = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.72,
    roughness: 0.2,
    metalness: 0.4
  });
  const water = new THREE.Mesh(geometry, material);
  water.rotation.x = -Math.PI / 2;
  water.position.copy(position);
  water.position.y += 0.15;
  water.userData = { tile, baseY: water.position.y, phase: seededRandom() * Math.PI * 2 };
  return water;
}

function createTreePrototype() {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6),
    new THREE.MeshStandardMaterial({ color: '#7c4518', roughness: 0.85 })
  );
  trunk.position.y = 0.45;
  tree.add(trunk);

  const leaves = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 1.8, 7),
    new THREE.MeshStandardMaterial({ color: '#16a34a', roughness: 0.55, flatShading: true })
  );
  leaves.position.y = 1.4;
  tree.add(leaves);

  tree.castShadow = true;
  tree.receiveShadow = false;
  return tree;
}

function createBoulderMesh(tile, position) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.65, 0),
    new THREE.MeshStandardMaterial({ color: '#77766f', roughness: 0.95, flatShading: true })
  );
  rock.position.set(position.x, tile.elevation * elevationScale + tileThickness * 2.5, position.z);
  rock.scale.set(1.25, 0.9, 1);
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

function addRegionBoundaries() {
  const positions = [];
  const colors = [];
  boardData.flat().forEach(tile => {
    getAdjacentTiles(tile).forEach(neighbor => {
      if (tile.region.id === neighbor.region.id) return;
      if (tile.x > neighbor.x || (tile.x === neighbor.x && tile.y > neighbor.y)) return;

      const center = getHexPosition(tile.x, tile.y);
      const direction = getHexPosition(neighbor.x, neighbor.y).sub(center).normalize();
      const edgeCenter = center.addScaledVector(direction, hexRadius * Math.sqrt(3) / 2);
      const sharedElevations = tile.cornerKeys.flatMap((key, cornerIndex) =>
        neighbor.cornerKeys.includes(key) ? [tile.cornerElevations[cornerIndex]] : []
      );
      const edgeElevation = sharedElevations.reduce((sum, elevation) => sum + elevation, 0) / sharedElevations.length;
      edgeCenter.y = edgeElevation * elevationScale + TERRAIN_TOP_OFFSET + 0.08;
      const tangent = new THREE.Vector3(-direction.z, 0, direction.x).multiplyScalar(hexRadius * 0.5);
      const boundaryColor = new THREE.Color(tile.region.color).lerp(new THREE.Color(neighbor.region.color), 0.5);
      const endpoints = [edgeCenter.clone().sub(tangent), edgeCenter.clone().add(tangent)];
      endpoints.forEach(point => {
        positions.push(point.x, point.y, point.z);
        colors.push(boundaryColor.r, boundaryColor.g, boundaryColor.b);
      });
    });
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  worldGroup.add(new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 })
  ));
}

function buildWorldMeshes() {
  while (worldGroup.children.length > 0) {
    const child = worldGroup.children[0];
    worldGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => material.dispose());
    }
  }
  tileMeshes.length = 0;
  waterMeshes.length = 0;
  forestMeshes.length = 0;
  buildTileCornerElevations();

  const treePrototype = createTreePrototype();

  boardData.forEach(row => {
    row.forEach(tile => {
      const tilePos = getHexPosition(tile.x, tile.y);
      const tileMesh = createTileMesh(tile);
      tile.mesh = tileMesh;
      tileMesh.position.copy(tilePos);
      tileMesh.position.y = 0;
      tileMeshes.push(tileMesh);
      worldGroup.add(tileMesh);

      if (tile.waterLevel > 30 || tile.terrain.includes('Wetlands')) {
        const water = createWaterPlane(tile, tilePos);
        water.position.y = getTileSurfaceHeight(tile) + 0.05 + tile.waterLevel * 0.001;
        waterMeshes.push(water);
        worldGroup.add(water);
      }

      if (tile.forestCover && tile.terrain !== 'Chasm') {
        const treeCount = 1 + Math.floor(seededRandom() * 2);
        for (let i = 0; i < treeCount; i += 1) {
          const tree = treePrototype.clone();
          const offsetX = (seededRandom() - 0.5) * 1.2;
          const offsetZ = (seededRandom() - 0.5) * 1.2;
          tree.position.set(tilePos.x + offsetX, getTileSurfaceHeight(tile), tilePos.z + offsetZ);
          tree.rotation.y = seededRandom() * Math.PI * 2;
          forestMeshes.push(tree);
          worldGroup.add(tree);
        }
      }

      if (tile.obstacle === 'Boulder') {
        worldGroup.add(createBoulderMesh(tile, tilePos));
      }
    });
  });

  addRegionBoundaries();
}

function updateTileVisual(tile) {
  const biome = biomeTypes.find(b => b.name === tile.terrain) || biomeTypes[0];
  tile.color = biome.color;
  tile.icon = biome.icon;
  if (!Array.isArray(tile.mesh.material)) {
    tile.mesh.material.color.copy(getTileDisplayColor(tile));
  }
  tile.mesh.position.y = 0;
}

function rebuildVisuals() {
  buildWorldMeshes();
  updateUI();
}

function smoothElevations() {
  for (let y = 0; y < boardSize; y += 1) {
    for (let x = 0; x < boardSize; x += 1) {
      const tile = boardData[y][x];
      if (tile.terrain !== 'Chasm') continue;
      const neighbors = getAdjacentTiles(tile);
      if (neighbors.some(neighbor => neighbor.terrain === 'Chasm')) {
        tile.elevation = CHASM_ELEVATION;
        continue;
      }

      const nearbyTerrains = neighbors.map(neighbor => neighbor.terrain);
      const commonTerrain = nearbyTerrains.sort((first, second) =>
        nearbyTerrains.filter(terrain => terrain === second).length - nearbyTerrains.filter(terrain => terrain === first).length
      )[0] || 'Plains';
      setTerrain(tile, commonTerrain);
    }
  }
  regions.forEach(updateRegionClassification);
}

function chooseBiome(fields) {
  if (fields.chasm > 0.94 && fields.height < 0.38) return biomeTypes.find(biome => biome.name === 'Chasm');
  if (fields.height < 0.33 && fields.moisture > 0.5) return biomeTypes.find(biome => biome.name === 'Wetlands');
  if (fields.height > 0.77) {
    return biomeTypes.find(biome => biome.name === (fields.moisture > 0.48 ? 'Mountain Forest' : 'Mountains'));
  }
  if (fields.height > 0.65) {
    return biomeTypes.find(biome => biome.name === (fields.moisture > 0.44 ? 'Hilly Forest' : 'Crem Hills'));
  }
  if (fields.height > 0.54 && fields.moisture > 0.46) return biomeTypes.find(biome => biome.name === 'Forest');
  if (fields.moisture > 0.54 && fields.height < 0.42) return biomeTypes.find(biome => biome.name === 'Wetlands');
  if (fields.temperature > 0.63 && fields.moisture < 0.34) return biomeTypes.find(biome => biome.name === 'Dust Basin');
  if (fields.temperature > 0.57 && fields.moisture < 0.4) return biomeTypes.find(biome => biome.name === 'Crem Flats');
  if (fields.moisture > 0.48) return biomeTypes.find(biome => biome.name === 'Forest');
  return biomeTypes.find(biome => biome.name === 'Plains');
}

function calculateGeneratedElevation(biome, region, regionElevationOffset) {
  if (biome.name === 'Chasm') return CHASM_ELEVATION;
  return region.baseElevation + regionElevationOffset + getBiomeElevationOffset(biome);
}

function generateBoard() {
  boardData.length = 0;
  seed = Math.floor(Math.random() * 999999);
  noiseSeed = seed;
  currentDay = 1;
  timeOfDay = 8;
  weather = 'Clear';
  paused = false;
  stormType = null;
  initializeStormSchedule();
  generateRegions();

  for (let y = 0; y < boardSize; y += 1) {
    const row = [];
    for (let x = 0; x < boardSize; x += 1) {
      const fields = sampleWorldFields(x, y);
      const region = regionGrid[y][x];
      const priorNeighbors = getHexNeighborCoordinates(x, y).flatMap(([neighborX, neighborY]) => {
        if (neighborX < 0 || neighborX >= boardSize || neighborY < 0 || neighborY > y) return [];
        if (neighborY === y) return neighborX < x && row[neighborX] ? [row[neighborX]] : [];
        return boardData[neighborY][neighborX] ? [boardData[neighborY][neighborX]] : [];
      });
      const chasmNeighbors = priorNeighbors.filter(neighbor => neighbor.terrain === 'Chasm').length;
      const chasmChance = chasmNeighbors > 0 ? 0.35 : 0.02;
      const biome = seededRandom() < chasmChance
        ? biomeTypes.find(candidate => candidate.name === 'Chasm')
        : chooseBiome(fields);
      const regionElevationOffset = calculateLocalElevationOffset(region, x, y, fields);
      const elevation = calculateGeneratedElevation(biome, region, regionElevationOffset);
      const forestDensity = valueNoise(x, y, 2.8, 8);
      const forestTerrain = ['Forest', 'Hilly Forest', 'Mountain Forest'].includes(biome.name);
      const forestCover = biome.name === 'Chasm'
        ? null
        : forestTerrain
          ? (forestDensity > 0.82 ? 'Heavy Forest' : forestDensity > 0.58 ? 'Dense Forest' : 'Forest')
          : fields.moisture > 0.68 && forestDensity > 0.8 ? 'Young Forest' : null;
      const hasBoulder = fields.rockiness > 0.72 && !['Chasm', 'Wetlands', 'Rocky Wetlands'].includes(biome.name);
      const waterLevel = biome.name === 'Wetlands'
        ? 40 + Math.floor(seededRandom() * 50)
        : fields.moisture > 0.74 && fields.height < 0.38
          ? Math.floor(seededRandom() * 48)
          : Math.floor(seededRandom() * 20);
      const tile = {
        x,
        y,
        region,
        regionElevationOffset,
        obstacle: hasBoulder ? 'Boulder' : null,
        terrain: biome.name,
        icon: biome.icon,
        color: biome.color,
        elevation,
        discovered: seededRandom() > 0.12,
        crem: Math.floor(seededRandom() * 120),
        waterLevel,
        hazard: null,
        forestCover,
        collapseChance: 0,
        stability: 40 + Math.floor(seededRandom() * 60)
      };
      if (biome.name === 'Chasm') region.chasmCount += 1;
      row.push(tile);
    }
    boardData.push(row);
  }

  smoothElevations();
  regions.forEach(updateRegionClassification);

  buildWorldMeshes();
  updateUI();
}

function updateUI() {
  const statusText = document.getElementById('statusText');
  const tileDetails = document.getElementById('tileDetails');
  const clearTileButton = document.getElementById('clearTileButton');

  statusText.innerText = `Day ${currentDay} · ${timeOfDay.toFixed(1)}h · ${weather} · ${regions.size} regions · ${stormType ? stormType + ' ongoing' : 'No storm'}`;
  clearTileButton.disabled = !selectedTile;

  if (selectedTile) {
    const unitTypes = [
      ['Mounted', 'mounted'],
      ['Foot', 'foot'],
      ['Light', 'light']
    ];
    const effectsByType = unitTypes.map(([label, type]) => ({ label, ...getTacticalEffects(selectedTile, type) }));
    const effectTable = (key, title, movement = false) => `
      <strong class="rules-heading">${title}</strong>
      <table class="tactical-table"><thead><tr><th>Class</th><th>Combat</th>${movement ? '<th>Move</th>' : ''}</tr></thead><tbody>
        ${effectsByType.map(effects => `<tr><th>${effects.label}</th><td>${effects[key] >= 0 ? '+' : ''}${effects[key]}%</td>${movement ? `<td>${effects.movement}</td>` : ''}</tr>`).join('')}
      </tbody></table>`;
    tileDetails.innerHTML = `
      <strong>Region</strong>
      <span class="region-name"><span class="region-swatch" style="--region-color:${selectedTile.region.color}"></span>${selectedTile.region.id} · ${selectedTile.region.icon} ${selectedTile.region.name} · ${selectedTile.region.tileCount} hexes</span><br>
      Base elevation: ${selectedTile.region.isChasmRegion ? `Abyssal (normal ${selectedTile.region.baseElevation.toFixed(1)})` : selectedTile.region.baseElevation.toFixed(1)}<br>
      ${selectedTile.region.isChasmRegion ? `Chasm coverage: ${Math.round(selectedTile.region.chasmCount / selectedTile.region.tileCount * 100)}%<br>` : ''}
      ${selectedTile.region.climate} · Favored: ${selectedTile.region.preferred}<br>
      Movement: ${selectedTile.region.movementRule}<br>
      Regional hazard: ${selectedTile.region.hazard}<br>
      ${effectTable('regionalCombat', 'Regional effects')}
      <strong class="rules-heading">Local hex</strong>
      ${selectedTile.terrain} ${selectedTile.icon} · Elevation ${selectedTile.elevation.toFixed(2)}<br>
      X:${selectedTile.x} Y:${selectedTile.y} · Water: ${selectedTile.waterLevel}<br>
      ${selectedTile.forestCover ? `Forest cover: ${selectedTile.forestCover}<br>` : ''}
      ${selectedTile.obstacle ? `Obstacle: ${selectedTile.obstacle}<br>` : ''}
      ${selectedTile.hazard ? '⚡ ' + selectedTile.hazard + '<br>' : ''}
      ${effectTable('localCombat', 'Local effects')}
      ${effectTable('finalCombat', 'Final effects', true)}
      <span class="rules-note">Local effects include terrain and high ground. Movement includes both regional and hex rules.</span><br>
      ${getCollapseInfo(selectedTile)}
    `;
  } else {
    tileDetails.innerHTML = '<span style="opacity:0.85;">No tile selected.</span>';
  }
}

function getIntersectedTile() {
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(tileMeshes, false);
  if (intersects.length > 0) {
    return intersects[0].object.userData.tile;
  }
  return null;
}

function highlightTile(tile) {
  if (!tile) {
    highlightMesh.visible = false;
    activeHighlightTile = null;
    return;
  }
  activeHighlightTile = tile;
  highlightMesh.position.set(tile.mesh.position.x, getTileSurfaceHeight(tile) + 0.05, tile.mesh.position.z);
  highlightMesh.visible = true;
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const tile = getIntersectedTile();
  highlightTile(tile);
}

function onClick(event) {
  if (event.target !== renderer.domElement) return;
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const tile = getIntersectedTile();
  if (tile) {
    selectedTile = tile;
    updateUI();
  } else if (selectedTile) {
    clearTileSelection();
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function updateWaterAnimation(delta) {
  waterMeshes.forEach(mesh => {
    mesh.position.y = mesh.userData.baseY + Math.sin(performance.now() * 0.002 + mesh.userData.phase) * 0.03;
  });
}

function updateTime(delta) {
  if (paused) return;
  timeOfDay += delta * timeSpeed;
  if (timeOfDay >= 24) {
    timeOfDay -= 24;
    currentDay += 1;
    boardData.flat().forEach(tile => {
      tile.crem += Math.floor(seededRandom() * 5);
      processTerrainGrowth(tile);
      processHazardHealing(tile);
      processForestSpread(tile);
      processChasmFill(tile);
    });
    regions.forEach(updateRegionClassification);
    rebuildVisuals();
    if (!stormType) {
      if (currentDay >= nextEverstormDay) {
        startStorm('Everstorm');
      } else if (currentDay >= nextHighstormDay) {
        startStorm('Highstorm');
      }
    }
  }
  if (stormType) {
    stormRemainingHours -= delta * timeSpeed;
    if (stormRemainingHours <= 0) {
      endStorm();
    }
  }
}

let lastFrameTime = performance.now();

function animate(time) {
  const deltaSeconds = Math.min(0.05, (time - lastFrameTime) / 1000);
  lastFrameTime = time;
  updateTime(deltaSeconds);
  updateWaterAnimation(deltaSeconds);
  updateKeyboardCamera(deltaSeconds);
  updateUI();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function togglePause() {
  paused = !paused;
  document.getElementById('pauseButton').innerText = paused ? 'Resume' : 'Pause';
}

function rebuildTileStyles() {
  boardData.flat().forEach(tile => updateTileVisual(tile));
}

function connectUI() {
  document.getElementById('regenButton').addEventListener('click', () => {
    generateBoard();
    selectedTile = null;
    highlightTile(null);
  });
  document.getElementById('pauseButton').addEventListener('click', togglePause);
  document.getElementById('clearTileButton').addEventListener('click', clearTileSelection);
  document.getElementById('timeSpeedSlider').addEventListener('input', (event) => {
    timeSpeed = parseFloat(event.target.value);
    document.getElementById('timeSpeedValue').innerText = timeSpeed.toFixed(1) + 'x';
  });
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('click', onClick);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
}

function initialize() {
  connectUI();
  initializeStormSchedule();
  generateBoard();
  requestAnimationFrame(animate);
}

initialize();
