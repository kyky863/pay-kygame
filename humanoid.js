import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const container = document.getElementById('characterCanvas');
const designStatus = document.getElementById('designStatus');
const designControls = [...document.querySelectorAll('[data-setting]')];
const designSchema = 'pay-kygame.humanoid-design';
const defaultDesignUrl = './humanoid-design.json';
const importedModelUrl = './models/heroic-warrior/heroic-warrior.glb';
let defaultDesign = null;
let design = null;
let modelMode = 'imported';
let animationMixer = null;
let activeAnimation = null;
let importedModelLoaded = false;
const animationActions = new Map();

const scene = new THREE.Scene();
scene.background = new THREE.Color('#292e2a');
scene.fog = new THREE.Fog('#292e2a', 13, 26);

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
camera.position.set(2.5, 2.15, 4.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 3.1;
controls.maxDistance = 10;
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight('#e5e0d1', '#38382f', 1.5));

const keyLight = new THREE.DirectionalLight('#fff0d6', 3);
keyLight.position.set(-3, 7, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 5;
keyLight.shadow.camera.bottom = -2;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight('#b8c9d1', 1.1);
fillLight.position.set(4, 3, -4);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight('#d5c6a9', 1.6);
rimLight.position.set(2.5, 4, -5);
scene.add(rimLight);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: '#383b33', roughness: 1 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.04;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(16, 32, '#777565', '#4b4d43');
grid.position.y = -0.025;
grid.material.transparent = true;
grid.material.opacity = 0.3;
scene.add(grid);

const figureRoot = new THREE.Group();
scene.add(figureRoot);
const importedRoot = new THREE.Group();
importedRoot.visible = false;
scene.add(importedRoot);

function material(color, roughness = 0.9, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function makeSurfaceTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  const skinSurface = kind === 'skin';

  for (let index = 0; index < image.data.length; index += 4) {
    const variation = Math.sin(index * 0.17) * 2 + Math.cos(index * 0.037) * 2;
    const base = skinSurface ? 248 : 242;
    const value = THREE.MathUtils.clamp(Math.round(base + variation), 0, 255);
    image.data[index] = value;
    image.data[index + 1] = Math.max(0, value - (skinSurface ? 2 : 1));
    image.data[index + 2] = Math.max(0, value - (skinSurface ? 3 : 2));
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  if (!skinSurface) {
    context.globalAlpha = 0.12;
    context.strokeStyle = '#77736a';
    context.lineWidth = 1;
    for (let line = 0; line < 16; line += 1) {
      const offset = line * 8;
      context.beginPath();
      context.moveTo(offset, 0);
      context.lineTo(offset, 128);
      context.moveTo(0, offset);
      context.lineTo(128, offset);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(skinSurface ? 3 : 4, skinSurface ? 3 : 5);
  texture.anisotropy = 4;
  return texture;
}

const skinTexture = makeSurfaceTexture('skin');
const fabricTexture = makeSurfaceTexture('fabric');

function addMesh(geometry, surfaceMaterial, position, parent = figureRoot) {
  const mesh = new THREE.Mesh(geometry, surfaceMaterial);
  mesh.position.copy(position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addTube(points, radius, surfaceMaterial, segments = 20) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  return addMesh(new THREE.TubeGeometry(curve, segments, radius, 8, false), surfaceMaterial, new THREE.Vector3());
}

function createLoft(profile, segments = 32, verticalSegments = 24) {
  const vertices = [];
  const uvs = [];
  const indices = [];

  for (let ring = 0; ring <= verticalSegments; ring += 1) {
    const progress = ring / verticalSegments;
    const profilePosition = progress * (profile.length - 1);
    const start = Math.floor(profilePosition);
    const end = Math.min(profile.length - 1, start + 1);
    const rawBlend = profilePosition - start;
    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const y = THREE.MathUtils.lerp(profile[start][0], profile[end][0], blend);
    const radiusX = THREE.MathUtils.lerp(profile[start][1], profile[end][1], blend);
    const radiusZ = THREE.MathUtils.lerp(profile[start][2], profile[end][2], blend);

    for (let side = 0; side <= segments; side += 1) {
      const angle = side / segments * Math.PI * 2;
      vertices.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
      uvs.push(side / segments, progress);
      if (ring < verticalSegments && side < segments) {
        const current = ring * (segments + 1) + side;
        const nextRing = current + segments + 1;
        indices.push(current, nextRing, current + 1, current + 1, nextRing, nextRing + 1);
      }
    }
  }

  const bottomCenter = vertices.length / 3;
  vertices.push(0, profile[0][0], 0);
  uvs.push(0.5, 0);
  const topCenter = vertices.length / 3;
  vertices.push(0, profile[profile.length - 1][0], 0);
  uvs.push(0.5, 1);
  for (let side = 0; side < segments; side += 1) {
    indices.push(bottomCenter, side, side + 1);
    const topStart = verticalSegments * (segments + 1) + side;
    indices.push(topCenter, topStart + 1, topStart);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addCapsuleBetween(start, end, radius, surfaceMaterial) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
  const geometry = new THREE.CapsuleGeometry(radius, Math.max(0.01, direction.length() - radius * 2), 5, 8);
  const mesh = addMesh(geometry, surfaceMaterial, startPoint.clone().add(endPoint).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addTaperedLimb(start, end, startRadius, endRadius, surfaceMaterial) {
  const startPoint = new THREE.Vector3(...start);
  const endPoint = new THREE.Vector3(...end);
  const direction = new THREE.Vector3().subVectors(endPoint, startPoint);
  const geometry = new THREE.CylinderGeometry(endRadius, startRadius, direction.length(), 12, 1);
  const mesh = addMesh(geometry, surfaceMaterial, startPoint.clone().add(endPoint).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function addOrganicLimb(points, surfaceMaterial, segments = 16) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const frames = curve.computeFrenetFrames(segments, false);
  const vertices = [];
  const uvs = [];
  const indices = [];
  for (let ring = 0; ring <= segments; ring += 1) {
    const progress = ring / segments;
    const pointIndex = progress * (points.length - 1);
    const start = Math.floor(pointIndex);
    const end = Math.min(points.length - 1, start + 1);
    const rawBlend = pointIndex - start;
    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const radius = THREE.MathUtils.lerp(points[start][3], points[end][3], blend);
    const depth = THREE.MathUtils.lerp(points[start][4], points[end][4], blend);
    const center = curve.getPointAt(progress);
    for (let side = 0; side <= 12; side += 1) {
      const angle = side / 12 * Math.PI * 2;
      const offset = frames.normals[ring].clone().multiplyScalar(Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[ring], Math.sin(angle) * depth);
      vertices.push(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      uvs.push(side / 12, progress);
      if (ring < segments && side < 12) {
        const current = ring * 13 + side;
        const next = current + 13;
        indices.push(current, current + 1, next, current + 1, next + 1, next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return addMesh(geometry, surfaceMaterial, new THREE.Vector3());
}

function addJoint(position, radius, surfaceMaterial) {
  return addMesh(new THREE.SphereGeometry(radius, 12, 8), surfaceMaterial, new THREE.Vector3(...position));
}

function clearFigure() {
  while (figureRoot.children.length) {
    const child = figureRoot.children[0];
    figureRoot.remove(child);
    child.traverse(object => {
      if (!object.isMesh) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(surfaceMaterial => surfaceMaterial.dispose());
    });
  }
}

function buildFigure() {
  clearFigure();

  const { height, build, headSize, shoulderWidth, armLength, legLength, tunicLength } = design.proportions;
  const scale = height / 1.87;
  const width = build;
  const scalePoint = (x, y, z) => new THREE.Vector3(x * width, y * scale, z * width);
  const skin = new THREE.MeshPhysicalMaterial({
    color: design.colors.skin,
    map: skinTexture,
    roughness: 0.76,
    metalness: 0,
    sheen: 0.12,
    sheenColor: '#c78e7c',
    sheenRoughness: 0.86
  });
  const tunic = new THREE.MeshStandardMaterial({
    color: design.colors.tunic,
    map: fabricTexture,
    roughness: 0.96
  });
  const trousers = new THREE.MeshStandardMaterial({
    color: design.colors.trousers,
    map: fabricTexture,
    roughness: 0.98
  });
  const leather = material(design.colors.leather);
  const metal = material(design.colors.metal, 0.45, 0.45);
  const hair = material(design.colors.hair);
  const eyeWhite = material('#eee4d3');
  const eyeColor = material('#49392e', 0.35);
  const featureShade = material('#886a59');
  const lipColor = material('#704d43');
  const nailMaterial = material('#d9c7b5', 0.75);

  addMesh(
    new THREE.SphereGeometry(0.2 * width, 16, 12),
    trousers,
    scalePoint(0, 0.88, 0)
  ).scale.set(1, 0.48, 0.88);

  const tunicHem = 0.88 - (tunicLength - 1) * 0.18;
  const tunicProfile = [
    [0, 0.23 * width, 0.13 * width],
    [0.035 * scale, 0.245 * width, 0.14 * width],
    [0.12 * scale, 0.23 * width, 0.135 * width],
    [0.23 * scale, 0.245 * width, 0.145 * width],
    [0.34 * scale, 0.275 * width, 0.155 * width],
    [0.45 * scale, 0.315 * width * shoulderWidth, 0.17 * width],
    [0.52 * scale, 0.33 * width * shoulderWidth, 0.165 * width],
    [0.58 * scale, 0.145 * width, 0.12 * width]
  ];
  addMesh(
    createLoft(tunicProfile),
    tunic,
    new THREE.Vector3(0, tunicHem * scale, 0)
  );

  const seamMaterial = material(new THREE.Color(design.colors.tunic).multiplyScalar(0.72));
  addTube([
    [-0.018 * width, 1.14 * scale, 0.15 * width],
    [0, 1.25 * scale, 0.16 * width],
    [0.018 * width, 1.4 * scale, 0.164 * width]
  ], 0.0045 * width, seamMaterial, 18);
  [-1, 1].forEach(side => {
    addTube([
      [side * 0.02 * width, 1.4 * scale, 0.163 * width],
      [side * 0.035 * width, 1.36 * scale, 0.166 * width],
      [side * 0.05 * width, 1.4 * scale, 0.163 * width]
    ], 0.008 * width, leather, 8);
  });
  [[1.22, 0.155], [1.28, 0.16], [1.34, 0.166]].forEach(([y, frontDepth]) => {
    const button = addMesh(
      new THREE.SphereGeometry(0.009 * width, 10, 8),
      leather,
      scalePoint(0, y, frontDepth)
    );
    button.scale.set(0.8, 1, 0.45);
  });

  if (design.features.belt) {
    addMesh(
      new THREE.CylinderGeometry(0.258 * width, 0.258 * width, 0.075 * scale, 10),
      leather,
      scalePoint(0, 0.98, 0)
    ).rotation.y = Math.PI / 10;
    const buckle = addMesh(
      new THREE.BoxGeometry(0.09 * width, 0.09 * scale, 0.035),
      metal,
      scalePoint(0.04, 0.98, 0.255)
    );
    buckle.rotation.y = -0.08;
  }

  addCapsuleBetween([0, 1.47 * scale, 0], [0, 1.59 * scale, 0], 0.075 * width, skin);
  const collar = addMesh(
    new THREE.TorusGeometry(0.09 * width, 0.025 * width, 8, 16),
    leather,
    scalePoint(0, 1.49, 0)
  );
  collar.rotation.x = Math.PI / 2;

  const headRadius = 0.12 * width * headSize;
  const headCenter = 1.72;
  const headCenterWorld = headCenter * scale;
  const head = addMesh(
    new THREE.LatheGeometry([
      new THREE.Vector2(0, -0.12 * scale * headSize),
      new THREE.Vector2(0.055 * headRadius, -0.112 * scale * headSize),
      new THREE.Vector2(0.42 * headRadius, -0.09 * scale * headSize),
      new THREE.Vector2(0.72 * headRadius, -0.065 * scale * headSize),
      new THREE.Vector2(0.91 * headRadius, -0.025 * scale * headSize),
      new THREE.Vector2(headRadius, 0.02 * scale * headSize),
      new THREE.Vector2(0.96 * headRadius, 0.065 * scale * headSize),
      new THREE.Vector2(0.76 * headRadius, 0.105 * scale * headSize),
      new THREE.Vector2(0.32 * headRadius, 0.12 * scale * headSize),
      new THREE.Vector2(0, 0.12 * scale * headSize)
    ], 24),
    skin,
    scalePoint(0, headCenter, 0)
  );
  head.geometry.computeVertexNormals();

  const nose = addMesh(
    new THREE.SphereGeometry(0.027 * width * headSize, 16, 12),
    skin,
    scalePoint(0, headCenter - 0.005 * headSize, 0.108 * headSize)
  );
  nose.scale.set(0.65, 1.35, 1.35);
  const noseBridge = addMesh(
    new THREE.SphereGeometry(0.022 * width * headSize, 14, 10),
    skin,
    scalePoint(0, headCenter + 0.025 * headSize, 0.09 * headSize)
  );
  noseBridge.scale.set(0.55, 1.8, 0.9);

  [-1, 1].forEach(side => {
    const eyeSocket = addMesh(
      new THREE.SphereGeometry(0.027 * width * headSize, 14, 10),
      featureShade,
      scalePoint(side * 0.043 * headSize, headCenter + 0.027 * headSize, 0.108 * headSize)
    );
    eyeSocket.scale.set(1.35, 0.75, 0.35);
    const eye = addMesh(
      new THREE.SphereGeometry(0.019 * width * headSize, 16, 12),
      eyeWhite,
      scalePoint(side * 0.043 * headSize, headCenter + 0.027 * headSize, 0.119 * headSize)
    );
    eye.scale.set(1.15, 0.65, 0.5);
    addTube([
      [side * 0.022 * width * headSize, (headCenter + 0.027 * headSize) * scale, 0.12 * width * headSize],
      [side * 0.043 * width * headSize, (headCenter + 0.043 * headSize) * scale, 0.121 * width * headSize],
      [side * 0.064 * width * headSize, (headCenter + 0.027 * headSize) * scale, 0.115 * width * headSize]
    ], 0.0045 * width * headSize, skin, 12);
    addTube([
      [side * 0.024 * width * headSize, (headCenter + 0.021 * headSize) * scale, 0.12 * width * headSize],
      [side * 0.043 * width * headSize, (headCenter + 0.013 * headSize) * scale, 0.12 * width * headSize],
      [side * 0.062 * width * headSize, (headCenter + 0.021 * headSize) * scale, 0.115 * width * headSize]
    ], 0.0035 * width * headSize, skin, 12);
    const iris = addMesh(
      new THREE.SphereGeometry(0.009 * width * headSize, 12, 10),
      eyeColor,
      scalePoint(side * 0.043 * headSize, headCenter + 0.027 * headSize, 0.128 * headSize)
    );
    iris.scale.set(1, 1, 0.45);

    addTube([
      [side * 0.018 * width * headSize, headCenterWorld + 0.057 * scale * headSize, 0.094 * width * headSize],
      [side * 0.042 * width * headSize, headCenterWorld + 0.062 * scale * headSize, 0.092 * width * headSize],
      [side * 0.068 * width * headSize, headCenterWorld + 0.05 * scale * headSize, 0.082 * width * headSize]
    ], 0.008 * width * headSize, hair, 12);

    const ear = addMesh(
      new THREE.SphereGeometry(0.032 * width * headSize, 14, 10),
      skin,
      scalePoint(side * 0.112 * headSize, headCenter - 0.015 * headSize, 0)
    );
    ear.scale.set(0.55, 1.2, 0.38);
    const earFold = addMesh(
      new THREE.SphereGeometry(0.017 * width * headSize, 12, 8),
      featureShade,
      scalePoint(side * 0.12 * headSize, headCenter - 0.015 * headSize, 0.014 * headSize)
    );
    earFold.scale.set(0.42, 0.8, 0.35);

    const nostril = addMesh(
      new THREE.SphereGeometry(0.005 * width * headSize, 8, 6),
      featureShade,
      scalePoint(side * 0.013 * headSize, headCenter - 0.023 * headSize, 0.13 * headSize)
    );
    nostril.scale.set(1.2, 0.65, 0.55);
  });

  addTube([
    [-0.027 * width * headSize, (headCenter - 0.066 * headSize) * scale, 0.104 * width * headSize],
    [0, (headCenter - 0.061 * headSize) * scale, 0.108 * width * headSize],
    [0.027 * width * headSize, (headCenter - 0.066 * headSize) * scale, 0.104 * width * headSize]
  ], 0.005 * width * headSize, lipColor, 12);
  addTube([
    [-0.021 * width * headSize, (headCenter - 0.073 * headSize) * scale, 0.104 * width * headSize],
    [0, (headCenter - 0.078 * headSize) * scale, 0.106 * width * headSize],
    [0.021 * width * headSize, (headCenter - 0.073 * headSize) * scale, 0.104 * width * headSize]
  ], 0.004 * width * headSize, lipColor, 12);

  if (design.features.hairStyle !== 'bald') {
    const hairCap = addMesh(
      new THREE.SphereGeometry(headRadius * 1.04, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
      hair,
      scalePoint(0, headCenter + 0.005, 0)
    );
    hairCap.scale.y = (scale / width) * (design.features.hairStyle === 'long' ? 1.04 : 0.94);
    if (design.features.hairStyle === 'long') {
      [-1, 1].forEach(side => {
        addCapsuleBetween(
          [side * headRadius * 0.72, 1.75 * scale, 0],
          [side * headRadius * 0.78, 1.52 * scale, 0],
          headRadius * 0.3,
          hair
        );
      });
    }
  }

  [-1, 1].forEach(side => {
    const hip = [side * 0.115 * width, 0.84 * scale, 0];
    const kneeHeight = 0.47 + (legLength - 1) * 0.48;
    const knee = [side * 0.13 * width, kneeHeight * scale, 0.015];
    const ankle = [side * 0.14 * width, 0.13 * scale, 0];
    addOrganicLimb([
      [hip[0], 0.86 * scale, hip[2], 0.115 * width, 0.105 * width],
      [side * 0.12 * width, 0.72 * scale, 0.005, 0.108 * width, 0.09 * width],
      [side * 0.125 * width, knee[1] + 0.025 * scale, knee[2], 0.078 * width, 0.073 * width],
      [knee[0], knee[1], knee[2], 0.071 * width, 0.07 * width]
    ], trousers, 20);
    addJoint(knee, 0.07 * width, trousers);
    addOrganicLimb([
      [knee[0], knee[1], knee[2], 0.07 * width, 0.07 * width],
      [side * 0.14 * width, 0.38 * scale, 0.025, 0.083 * width, 0.074 * width],
      [side * 0.14 * width, 0.25 * scale, 0.018, 0.068 * width, 0.064 * width],
      [ankle[0], ankle[1], ankle[2], 0.047 * width, 0.046 * width]
    ], trousers, 20);
    if (design.features.boots) {
      addOrganicLimb([
        [ankle[0], 0.12 * scale, ankle[2], 0.066 * width, 0.06 * width],
        [side * 0.14 * width, 0.24 * scale, 0.01, 0.072 * width, 0.063 * width],
        [side * 0.14 * width, 0.31 * scale, 0.005, 0.076 * width, 0.065 * width]
      ], leather, 14);
      const cuff = addMesh(
        new THREE.TorusGeometry(0.067 * width, 0.009 * width, 8, 16),
        leather,
        scalePoint(side * 0.14, 0.29, 0.005)
      );
      cuff.rotation.x = Math.PI / 2;
    }
    const foot = addMesh(
      new THREE.SphereGeometry(0.15 * width, 20, 14),
      design.features.boots ? leather : skin,
      scalePoint(side * 0.14, 0.09, 0.09)
    );
    foot.scale.set(0.72, 0.5, 1.45);
    if (design.features.boots) {
      const sole = addMesh(
        new THREE.SphereGeometry(0.145 * width, 16, 10),
        material('#30271f'),
        scalePoint(side * 0.14, 0.035, 0.095)
      );
      sole.scale.set(0.73, 0.16, 1.48);
    }

    const shoulderX = side * 0.3 * width * shoulderWidth;
    const shoulder = [shoulderX, 1.4 * scale, 0];
    const elbow = [shoulderX + side * 0.12 * width * armLength, 1.16 * scale, 0.015];
    const wrist = [shoulderX + side * 0.17 * width * armLength, 0.91 * scale, 0.06];
    addJoint(shoulder, 0.1 * width, tunic);
    addOrganicLimb([
      [shoulder[0], shoulder[1], shoulder[2], 0.09 * width, 0.09 * width],
      [shoulderX + side * 0.06 * width * armLength, 1.3 * scale, 0.005, 0.09 * width, 0.08 * width],
      [elbow[0], elbow[1], elbow[2], 0.06 * width, 0.06 * width]
    ], tunic, 18);
    addJoint(elbow, 0.06 * width, skin);
    addOrganicLimb([
      [elbow[0], elbow[1], elbow[2], 0.06 * width, 0.06 * width],
      [elbow[0] + side * 0.035 * width * armLength, 1.04 * scale, 0.035, 0.055 * width, 0.05 * width],
      [wrist[0], wrist[1], wrist[2], 0.04 * width, 0.04 * width]
    ], skin, 18);
    addJoint(wrist, 0.04 * width, skin);

    const palm = addMesh(
      new THREE.SphereGeometry(0.065 * width, 12, 10),
      skin,
      new THREE.Vector3(wrist[0], 0.85 * scale, 0.065 * width)
    );
    palm.scale.set(0.72, 1.2, 0.55);
    for (let finger = 0; finger < 4; finger += 1) {
      const fingerOffset = (finger - 1.5) * 0.025 * width;
      const fingerX = wrist[0] + fingerOffset;
      const fingerLength = (finger === 1 || finger === 2 ? 0.09 : 0.075) * scale;
      const fingerTipY = (0.82 * scale) - fingerLength;
      addOrganicLimb([
        [fingerX, 0.82 * scale, 0.085 * width, 0.012 * width, 0.01 * width],
        [fingerX + side * 0.003 * width, (0.82 * scale) - fingerLength * 0.55, 0.09 * width, 0.01 * width, 0.009 * width],
        [fingerX + side * 0.006 * width, fingerTipY, 0.085 * width, 0.007 * width, 0.007 * width]
      ], skin, 8);
      addJoint([fingerX + side * 0.006 * width, fingerTipY, 0.085 * width], 0.007 * width, skin);
      const nail = addMesh(
        new THREE.SphereGeometry(0.009 * width, 8, 6),
        nailMaterial,
        new THREE.Vector3(fingerX + side * 0.006 * width, fingerTipY + 0.004 * scale, 0.091 * width)
      );
      nail.scale.set(0.58, 0.75, 0.24);
    }
    addOrganicLimb([
      [wrist[0] + side * 0.04 * width, 0.86 * scale, 0.075 * width, 0.016 * width, 0.012 * width],
      [wrist[0] + side * 0.07 * width, 0.82 * scale, 0.09 * width, 0.012 * width, 0.01 * width],
      [wrist[0] + side * 0.08 * width, 0.79 * scale, 0.085 * width, 0.008 * width, 0.008 * width]
    ], skin, 8);
    const thumbnail = addMesh(
      new THREE.SphereGeometry(0.009 * width, 8, 6),
      nailMaterial,
      new THREE.Vector3(wrist[0] + side * 0.08 * width, 0.794 * scale, 0.091 * width)
    );
    thumbnail.scale.set(0.58, 0.75, 0.24);

    if (design.features.bracers) {
      const interpolate = fraction => elbow.map((coordinate, index) =>
        THREE.MathUtils.lerp(coordinate, wrist[index], fraction)
      );
      const bracerTrim = material(design.colors.metal, 0.55, 0.22);
      addOrganicLimb([
        [...interpolate(0.45), 0.066 * width, 0.06 * width],
        [...interpolate(0.65), 0.068 * width, 0.061 * width],
        [...interpolate(0.84), 0.058 * width, 0.053 * width]
      ], leather, 12);
      const forearmAxis = new THREE.Vector3(...wrist).sub(new THREE.Vector3(...elbow)).normalize();
      [0.48, 0.82].forEach((fraction, index) => {
        const trim = addMesh(
          new THREE.TorusGeometry(index === 0 ? 0.067 : 0.059, 0.004, 6, 16),
          bracerTrim,
          new THREE.Vector3(...interpolate(fraction))
        );
        trim.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forearmAxis);
      });
    }
  });

  if (design.features.satchel) {
    addTaperedLimb(
      [0.25 * width, 1.48 * scale, 0.19 * width],
      [-0.22 * width, 0.88 * scale, 0.15 * width],
      0.025 * width,
      0.025 * width,
      leather
    );
    const pouch = addMesh(
      new THREE.SphereGeometry(0.12 * width, 14, 12),
      leather,
      scalePoint(-0.23, 0.84, 0.16)
    );
    pouch.scale.set(0.85, 1.2, 0.55);
  }

}

function setModelMode(mode) {
  modelMode = mode;
  const imported = mode === 'imported';
  const badge = document.getElementById('modelBadge');
  importedRoot.visible = imported;
  figureRoot.visible = !imported;
  badge.dataset.state = imported ? 'loaded' : importedModelLoaded ? 'procedural' : 'fallback';
  badge.textContent = imported
    ? 'AssetFurnace Warrior · GLB active'
    : importedModelLoaded ? 'Editable procedural figure active' : 'Procedural fallback active';
  designControls.forEach(control => {
    if (control.dataset.setting !== 'name') control.disabled = imported;
  });
  document.getElementById('modelSource').value = mode;
  document.getElementById('modelNotice').textContent = imported
    ? 'Imported armor and proportions are part of this model. Switch to the procedural figure to edit its sliders.'
    : 'This procedural figure is editable with the design controls below.';
}

function playAnimation(name) {
  if (!animationMixer) return;
  const nextAnimation = animationActions.get(name);
  if (!nextAnimation || nextAnimation === activeAnimation) return;
  nextAnimation.reset().fadeIn(0.25).play();
  activeAnimation?.fadeOut(0.25);
  activeAnimation = nextAnimation;
}

async function loadImportedModel() {
  const gltf = await new GLTFLoader().loadAsync(importedModelUrl);
  if (!gltf.scene) throw new Error('The imported file does not contain a 3D scene.');

  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) {
    throw new Error('The imported character has invalid dimensions.');
  }

  const modelScale = 1.8 / size.y;
  const center = bounds.getCenter(new THREE.Vector3());
  model.scale.setScalar(modelScale);
  model.position.set(-center.x * modelScale, -bounds.min.y * modelScale, -center.z * modelScale);
  model.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  importedRoot.add(model);
  importedModelLoaded = true;

  if (gltf.animations.length > 0) {
    animationMixer = new THREE.AnimationMixer(model);
    const select = document.getElementById('animationSelect');
    const animationControl = document.getElementById('animationControl');
    select.replaceChildren(...gltf.animations.map(clip => {
      const option = document.createElement('option');
      option.value = clip.name;
      option.textContent = clip.name.replaceAll('_', ' ');
      animationActions.set(clip.name, animationMixer.clipAction(clip));
      return option;
    }));
    animationControl.hidden = false;
    const initialAnimation = gltf.animations.find(clip => clip.name.toLowerCase().includes('idle'))
      ?? gltf.animations[0];
    select.value = initialAnimation.name;
    playAnimation(initialAnimation.name);
  }

  return gltf.animations.length;
}

function getDesignValue(path) {
  return path.split('.').reduce((value, key) => value[key], design);
}

function setDesignValue(path, value) {
  const keys = path.split('.');
  const key = keys.pop();
  const parent = keys.reduce((object, part) => object[part], design);
  parent[key] = value;
}

function updateLabels() {
  document.querySelectorAll('[data-output]').forEach(output => {
    const key = output.dataset.output;
    const value = design.proportions[key];
    if (key === 'height') output.value = `${Number(value).toFixed(2)} m`;
    else if (key === 'build') output.value = value < 0.94 ? 'Lean' : value > 1.13 ? 'Broad' : 'Average';
    else output.value = `${Number(value).toFixed(2)}×`;
  });
}

function syncControls() {
  designControls.forEach(control => {
    const value = getDesignValue(control.dataset.setting);
    if (control.type === 'checkbox') control.checked = value;
    else control.value = value;
  });
  updateLabels();
}

function validateDesign(candidate) {
  if (!candidate || candidate.schema !== designSchema || candidate.version !== 1) {
    throw new Error('Unsupported humanoid design file or version.');
  }
  if (typeof candidate.name !== 'string' || !candidate.name.trim() || candidate.name.length > 48) {
    throw new Error('Design name must contain 1–48 characters.');
  }

  const ranges = {
    height: [1.5, 2.1],
    build: [0.8, 1.3],
    headSize: [0.8, 1.25],
    shoulderWidth: [0.8, 1.3],
    armLength: [0.75, 1.25],
    legLength: [0.8, 1.2],
    tunicLength: [0.65, 1.35]
  };
  Object.entries(ranges).forEach(([key, [minimum, maximum]]) => {
    const value = candidate.proportions?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid ${key} value in design file.`);
    }
  });

  ['skin', 'tunic', 'trousers', 'leather', 'hair', 'metal'].forEach(key => {
    if (typeof candidate.colors?.[key] !== 'string' || !/^#[0-9a-f]{6}$/i.test(candidate.colors[key])) {
      throw new Error(`Invalid ${key} color in design file.`);
    }
  });
  if (!['bald', 'short', 'long'].includes(candidate.features?.hairStyle)) {
    throw new Error('Invalid hairstyle in design file.');
  }
  ['belt', 'bracers', 'satchel', 'boots'].forEach(key => {
    if (typeof candidate.features?.[key] !== 'boolean') {
      throw new Error(`Invalid ${key} setting in design file.`);
    }
  });

  return {
    schema: designSchema,
    version: 1,
    name: candidate.name.trim(),
    proportions: { ...candidate.proportions },
    colors: { ...candidate.colors },
    features: { ...candidate.features }
  };
}

function applyDesign(nextDesign, message) {
  design = validateDesign(nextDesign);
  syncControls();
  buildFigure();
  if (modelMode === 'imported') figureRoot.visible = false;
  designStatus.textContent = message;
}

function exportDesign() {
  const blob = new Blob([`${JSON.stringify(design, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const filename = design.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'humanoid-design';
  link.href = url;
  link.download = `${filename}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  designStatus.textContent = `Exported ${link.download}. Send that JSON file to reuse this design.`;
}

async function importDesign(file) {
  try {
    const contents = await file.text();
    let imported;
    try {
      imported = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Could not parse JSON: ${error.message}`);
    }
    applyDesign(imported, `Imported ${file.name}.`);
  } catch (error) {
    designStatus.textContent = `Import failed: ${error.message}`;
    console.error(error);
  }
}

function handleDesignInput(event) {
  const control = event.currentTarget;
  const value = control.type === 'checkbox'
    ? control.checked
    : control.type === 'range'
      ? Number(control.value)
      : control.value;
  setDesignValue(control.dataset.setting, value);
  updateLabels();
  buildFigure();
  designStatus.textContent = 'Unsaved design changes.';
}

document.getElementById('modelSource').addEventListener('change', event => {
  const requestedMode = event.currentTarget.value;
  if (requestedMode === 'imported' && !importedModelLoaded) {
    setModelMode('procedural');
    designStatus.textContent = 'Imported model is not available; showing the editable procedural figure.';
    return;
  }
  setModelMode(requestedMode);
});
document.getElementById('animationSelect').addEventListener('change', event => {
  playAnimation(event.currentTarget.value);
});

function resize() {
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

designControls.forEach(control => {
  const eventName = control.type === 'checkbox' || control.tagName === 'SELECT' ? 'change' : 'input';
  control.addEventListener(eventName, handleDesignInput);
});
document.getElementById('exportDesign').addEventListener('click', exportDesign);
document.getElementById('importDesign').addEventListener('change', event => {
  const [file] = event.target.files;
  if (file) importDesign(file);
  event.target.value = '';
});
document.getElementById('resetDesign').addEventListener('click', () => {
  applyDesign(defaultDesign, 'Reset to the default design.');
});
document.getElementById('resetView').addEventListener('click', () => {
  camera.position.set(2.5, 2.15, 4.6);
  controls.target.set(0, 1, 0);
  controls.update();
});
window.addEventListener('resize', resize);

let lastFrameTime = performance.now();
function animate(time) {
  const delta = Math.min(0.05, (time - lastFrameTime) / 1000);
  lastFrameTime = time;
  animationMixer?.update(delta);
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

async function initialize() {
  document.getElementById('modelBadge').textContent = 'Loading AssetFurnace character…';
  designStatus.textContent = 'Loading default design and imported character…';
  try {
    const response = await fetch(defaultDesignUrl);
    if (!response.ok) throw new Error(`Could not load default design (${response.status}).`);
    defaultDesign = validateDesign(await response.json());
    applyDesign(defaultDesign, 'Default design loaded. Export your changes when ready.');
    try {
      const animationCount = await loadImportedModel();
      setModelMode('imported');
      designStatus.textContent = `AssetFurnace Warrior loaded${animationCount ? ` with ${animationCount} animations` : ''}. The map game is unchanged.`;
    } catch (error) {
      setModelMode('procedural');
      designStatus.textContent = `Warrior model could not load: ${error.message}. Showing the editable procedural figure.`;
      console.error(error);
    }
    resize();
    controls.update();
    requestAnimationFrame(animate);
  } catch (error) {
    designStatus.textContent = `Design studio failed to load: ${error.message}`;
    console.error(error);
  }
}

initialize();
