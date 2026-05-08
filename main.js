// main.js
// This file creates a 3D hex terrain prototype with Three.js.
// All of your gameplay systems—terrain generation, storms, time, water, chasms, forest spread, units—can be added here.

// ----- GLOBAL GAME STATE -----
const boardSize = 12;
const hexRadius = 2.2;
const elevationScale = 1.5;
const tileThickness = 1.0;
const boardCenterOffset = new THREE.Vector3(
  ((boardSize - 1) * hexRadius * 1.5) / 2,
  0,
  (Math.sqrt(3) * hexRadius * (boardSize * 0.5)) / 2
);

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

const boardData = [];
const tileMeshes = [];
const waterMeshes = [];
const forestMeshes = [];

// ----- THREE.JS SETUP -----
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2('#a8d8ff', 0.020);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(16, 26, 22);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#7db3ff', 1);
container.appendChild(renderer.domElement);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.45;
controls.target.set(0, 0, 0);
controls.update();

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const debugGrid = new THREE.GridHelper(80, 80, '#5b7287', '#25303d');
debugGrid.position.y = -1.2;
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
  new THREE.PlaneGeometry(180, 180),
  new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 1, metalness: 0 })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.position.y = -1.2;
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
  { name: 'Chasm', color: '#0f172a', icon: '🕳️', elevation: -3 },
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
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

function getContrastColor(hexColor) {
  const color = new THREE.Color(hexColor);
  const luminance = (0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
  return luminance > 0.5 ? '#0f172a' : '#f8fafc';
}

function getHexPosition(x, y) {
  const offsetX = hexRadius * 1.5 * x;
  const offsetZ = Math.sqrt(3) * hexRadius * (y + (x % 2 === 0 ? 0 : 0.5));
  return new THREE.Vector3(offsetX, 0, offsetZ).sub(boardCenterOffset);
}

function isForestTile(tile) {
  const forestTerrains = ['Forest', 'Hilly Forest', 'Mountain Forest'];
  return (
    forestTerrains.includes(tile.terrain) ||
    ['Young Forest', 'Dense Forest', 'Heavy Forest'].includes(tile.forestCover)
  );
}

function getAdjacentTiles(tile) {
  const neighbors = [];
  const evenColumn = tile.x % 2 === 0;
  const directions = evenColumn
    ? [
        [1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]
      ]
    : [
        [1, 0], [1, -1], [0, -1], [-1, 0], [1, 1], [0, 1]
      ];

  directions.forEach(([dx, dy]) => {
    const nx = tile.x + dx;
    const ny = tile.y + dy;
    if (nx >= 0 && nx < boardSize && ny >= 0 && ny < boardSize) {
      neighbors.push(boardData[ny][nx]);
    }
  });

  return neighbors;
}

function setTerrain(tile, terrainName) {
  tile.terrain = terrainName;
  const biome = biomeTypes.find(b => b.name === terrainName) || biomeTypes[0];
  tile.color = biome.color;
  tile.icon = biome.icon;
  tile.elevation = biome.elevation;
}

function processTerrainGrowth(tile) {
  const progression = terrainProgression[tile.terrain];
  if (!progression || tile.crem < progression.threshold) return;
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

function getCollapseInfo() {
  const riskTiles = boardData.flat().filter(tile => tile.collapseChance > 0);
  if (riskTiles.length === 0) return 'Chasm risk: none detected.';
  const totalChance = riskTiles.reduce((sum, tile) => sum + tile.collapseChance, 0);
  const maxChance = Math.max(...riskTiles.map(tile => tile.collapseChance));
  const avgChance = ((totalChance / riskTiles.length) * 100).toFixed(1);
  return `Chasm risk: ${riskTiles.length} tiles — avg ${avgChance}%, max ${(maxChance * 100).toFixed(1)}%.`;
}

function createTileMesh(tile) {
  const geometry = new THREE.CylinderGeometry(hexRadius, hexRadius, tileThickness, 6, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: tile.color,
    roughness: 0.7,
    metalness: 0,
    flatShading: true
  });
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

function buildWorldMeshes() {
  while (worldGroup.children.length > 0) {
    const child = worldGroup.children[0];
    worldGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  tileMeshes.length = 0;
  waterMeshes.length = 0;
  forestMeshes.length = 0;

  const treePrototype = createTreePrototype();

  boardData.forEach(row => {
    row.forEach(tile => {
      const tilePos = getHexPosition(tile.x, tile.y);
      const tileMesh = createTileMesh(tile);
      tile.mesh = tileMesh;
      tileMesh.position.copy(tilePos);
      tileMesh.position.y = tile.elevation * elevationScale + tileThickness * 0.5;
      tileMesh.material.color = new THREE.Color(tile.color);
      tileMeshes.push(tileMesh);
      worldGroup.add(tileMesh);

      if (tile.waterLevel > 30 || tile.terrain.includes('Wetlands')) {
        const water = createWaterPlane(tile, tilePos);
        water.position.y = tileMesh.position.y + 0.18 + tile.waterLevel * 0.01;
        waterMeshes.push(water);
        worldGroup.add(water);
      }

      if (tile.forestCover) {
        const treeCount = 1 + Math.floor(seededRandom() * 2);
        for (let i = 0; i < treeCount; i += 1) {
          const tree = treePrototype.clone();
          const offsetX = (seededRandom() - 0.5) * 1.2;
          const offsetZ = (seededRandom() - 0.5) * 1.2;
          tree.position.set(tilePos.x + offsetX, tileMesh.position.y + 0.6, tilePos.z + offsetZ);
          tree.rotation.y = seededRandom() * Math.PI * 2;
          forestMeshes.push(tree);
          worldGroup.add(tree);
        }
      }
    });
  });
}

function updateTileVisual(tile) {
  const biome = biomeTypes.find(b => b.name === tile.terrain) || biomeTypes[0];
  tile.color = biome.color;
  tile.icon = biome.icon;
  tile.mesh.material.color.set(biome.color);
  tile.mesh.position.y = tile.elevation * elevationScale + tileThickness * 0.5;
}

function rebuildVisuals() {
  buildWorldMeshes();
  updateUI();
}

function generateBoard() {
  boardData.length = 0;
  seed = Math.floor(Math.random() * 999999);
  currentDay = 1;
  timeOfDay = 8;
  weather = 'Clear';
  paused = false;
  stormType = null;
  initializeStormSchedule();

  for (let y = 0; y < boardSize; y += 1) {
    const row = [];
    for (let x = 0; x < boardSize; x += 1) {
      const biome = biomeTypes[Math.floor(seededRandom() * biomeTypes.length)];
      const elevation = biome.elevation + Math.floor(seededRandom() * 2);
      const tile = {
        x,
        y,
        terrain: biome.name,
        icon: biome.icon,
        color: biome.color,
        elevation,
        discovered: seededRandom() > 0.12,
        crem: Math.floor(seededRandom() * 120),
        waterLevel: Math.floor(seededRandom() * 100),
        hazard: null,
        forestCover: ['Forest', 'Hilly Forest', 'Mountain Forest', 'Young Forest', 'Dense Forest', 'Heavy Forest'].includes(biome.name)
          ? (['Young Forest', 'Dense Forest', 'Heavy Forest'].includes(biome.name) ? biome.name : 'Forest')
          : null,
        collapseChance: 0,
        stability: 40 + Math.floor(seededRandom() * 60)
      };
      row.push(tile);
    }
    boardData.push(row);
  }

  buildWorldMeshes();
  updateUI();
}

function updateUI() {
  const statusText = document.getElementById('statusText');
  const tileDetails = document.getElementById('tileDetails');

  statusText.innerText = `Day ${currentDay} · ${timeOfDay.toFixed(1)}h · ${weather} · ${stormType ? stormType + ' ongoing' : 'No storm'}`;

  if (selectedTile) {
    tileDetails.innerHTML = `
      <strong>${selectedTile.terrain}</strong> ${selectedTile.icon}<br>
      X:${selectedTile.x} Y:${selectedTile.y}<br>
      Elevation: ${selectedTile.elevation}<br>
      Water: ${selectedTile.waterLevel}<br>
      Crem: ${selectedTile.crem}<br>
      ${selectedTile.hazard ? '⚡ ' + selectedTile.hazard + '<br>' : ''}
      ${selectedTile.forestCover ? '🌲 ' + selectedTile.forestCover + '<br>' : ''}
      ${getCollapseInfo()}
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
  highlightMesh.position.set(tile.mesh.position.x, tile.mesh.position.y + 0.05, tile.mesh.position.z);
  highlightMesh.visible = true;
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const tile = getIntersectedTile();
  highlightTile(tile);
}

function onClick(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  const tile = getIntersectedTile();
  if (tile) {
    selectedTile = tile;
    updateUI();
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
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('click', onClick);
}

function initialize() {
  connectUI();
  initializeStormSchedule();
  generateBoard();
  requestAnimationFrame(animate);
}

initialize();
