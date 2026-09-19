"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AmbientSceneKey } from "../../lib/ambient-time";

type SpiritOrbProps = {
  state: "idle" | "listening" | "thinking" | "responding" | "working";
  tone: AmbientSceneKey;
};

type RibbonConfig = {
  phase: number;
  width: number;
  radius: number;
  speed: number;
  opacity: number;
  color: keyof Palette;
  wobble: number;
};

type Palette = {
  deep: string;
  mid: string;
  light: string;
  cream: string;
  core: string;
};

const PALETTES: Record<AmbientSceneKey, Palette> = {
  "pre-dawn": { deep: "#163d54", mid: "#5c9ca8", light: "#b8dedf", cream: "#eadbc9", core: "#fff7dc" },
  dawn: { deep: "#235061", mid: "#70aeb0", light: "#c5e7df", cream: "#f3dcc2", core: "#fff5da" },
  sunrise: { deep: "#365b57", mid: "#83ad98", light: "#d3edd8", cream: "#ffdda8", core: "#fff0c6" },
  morning: { deep: "#145b54", mid: "#3ca18f", light: "#afeede", cream: "#fff1cf", core: "#fff8dc" },
  noon: { deep: "#125b54", mid: "#36a291", light: "#abeedd", cream: "#fff1cf", core: "#fff8dc" },
  afternoon: { deep: "#185f58", mid: "#4a9f8f", light: "#b6e7d8", cream: "#f9e7c5", core: "#fff4d5" },
  "golden-hour": { deep: "#3e6158", mid: "#83a88d", light: "#d7ead0", cream: "#ffd7a1", core: "#ffedc5" },
  sunset: { deep: "#435a59", mid: "#8b9d8f", light: "#d8dfcf", cream: "#f7c7a0", core: "#ffe5bd" },
  "blue-hour": { deep: "#123b55", mid: "#357f91", light: "#91d6dc", cream: "#dfe7d8", core: "#f4f5df" },
  night: { deep: "#0c3046", mid: "#287f8f", light: "#8ddbdd", cream: "#dfeadf", core: "#f7f8e6" },
};

const RIBBONS: RibbonConfig[] = [
  { phase: 0.15, width: 0.16, radius: 0.73, speed: 0.20, opacity: 0.54, color: "cream", wobble: 0.17 },
  { phase: 1.85, width: 0.12, radius: 0.70, speed: -0.16, opacity: 0.46, color: "light", wobble: 0.21 },
  { phase: 3.50, width: 0.10, radius: 0.67, speed: 0.12, opacity: 0.36, color: "mid", wobble: 0.24 },
  { phase: 5.00, width: 0.075, radius: 0.75, speed: -0.10, opacity: 0.28, color: "cream", wobble: 0.14 },
];

function stateSpeed(state: SpiritOrbProps["state"]) {
  if (state === "listening") return 1.55;
  if (state === "thinking") return 2.15;
  if (state === "responding") return 1.75;
  if (state === "working") return 1.35;
  return 0.72;
}

function makeRibbonGeometry(config: RibbonConfig, elapsed = 0) {
  const segments = 170;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];
  const points: THREE.Vector3[] = [];

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const u = t * Math.PI * 2;
    const a = u * 1.08 + config.phase + elapsed * config.speed;
    const b =
      0.62 * Math.sin(u * 0.82 + config.phase * 0.9 + elapsed * config.speed * 0.62) +
      config.wobble * Math.sin(u * 2.6 - elapsed * config.speed * 0.45);
    const radial =
      config.radius +
      0.055 * Math.sin(u * 3.1 + config.phase) +
      0.035 * Math.sin(u * 5.2 - elapsed * config.speed * 0.4);

    points.push(
      new THREE.Vector3(
        radial * Math.cos(a) * Math.cos(b),
        radial * Math.sin(b),
        radial * Math.sin(a) * Math.cos(b)
      )
    );
  }

  const worldUp = new THREE.Vector3(0, 1, 0);
  const fallback = new THREE.Vector3(1, 0, 0);

  for (let i = 0; i <= segments; i += 1) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(segments, i + 1)];
    const tangent = next.clone().sub(prev).normalize();
    const radialNormal = points[i].clone().normalize();
    let side = new THREE.Vector3().crossVectors(tangent, radialNormal).normalize();
    if (side.lengthSq() < 0.01) {
      side = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
      if (side.lengthSq() < 0.01) side.crossVectors(tangent, fallback).normalize();
    }

    const t = i / segments;
    const taper = Math.pow(Math.sin(Math.PI * t), 0.38);
    const pulse = 0.78 + 0.22 * Math.sin(t * Math.PI * 6 + config.phase + elapsed * 0.7);
    const width = config.width * taper * pulse;
    const twist = Math.sin(t * Math.PI * 4 + config.phase + elapsed * 0.35) * 0.34;
    side.applyAxisAngle(tangent, twist);

    const left = points[i].clone().addScaledVector(side, width);
    const right = points[i].clone().addScaledVector(side, -width);
    const pIndex = i * 6;
    positions[pIndex] = left.x;
    positions[pIndex + 1] = left.y;
    positions[pIndex + 2] = left.z;
    positions[pIndex + 3] = right.x;
    positions[pIndex + 4] = right.y;
    positions[pIndex + 5] = right.z;

    const uvIndex = i * 4;
    uvs[uvIndex] = t;
    uvs[uvIndex + 1] = 0;
    uvs[uvIndex + 2] = t;
    uvs[uvIndex + 3] = 1;

    if (i < segments) {
      const a0 = i * 2;
      const b0 = a0 + 1;
      const c0 = a0 + 2;
      const d0 = a0 + 3;
      indices.push(a0, b0, c0, b0, d0, c0);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function makeMistTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();
  const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,255,255,.42)");
  gradient.addColorStop(0.28, "rgba(255,255,255,.20)");
  gradient.addColorStop(0.62, "rgba(255,255,255,.07)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function SpiritOrb({ state, tone }: SpiritOrbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const palette = PALETTES[tone];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    camera.position.set(0, 0, 4.15);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const orbGroup = new THREE.Group();
    scene.add(orbGroup);

    const glassGeometry = new THREE.SphereGeometry(1.08, 96, 96);
    const glassMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color("#d9fff6"),
      roughness: 0.08,
      metalness: 0,
      transmission: 0.94,
      thickness: 0.48,
      ior: 1.22,
      transparent: true,
      opacity: 0.34,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      attenuationColor: new THREE.Color(palette.mid),
      attenuationDistance: 2.5,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    glass.renderOrder = 6;
    orbGroup.add(glass);

    const innerGeometry = new THREE.SphereGeometry(0.99, 72, 72);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.deep),
      transparent: true,
      opacity: tone === "night" ? 0.28 : 0.20,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);
    inner.renderOrder = 0;
    orbGroup.add(inner);

    const ribbonMeshes = RIBBONS.map((config, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette[config.color]),
        transparent: true,
        opacity: config.opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: index < 2 ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(makeRibbonGeometry(config), material);
      mesh.renderOrder = 2 + index;
      orbGroup.add(mesh);
      return { mesh, config, material };
    });

    const coreGeometry = new THREE.SphereGeometry(0.075, 36, 36);
    const coreMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.core) });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 7;
    orbGroup.add(core);

    const coreGlowGeometry = new THREE.SphereGeometry(0.17, 32, 32);
    const coreGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.light),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
    coreGlow.renderOrder = 5;
    orbGroup.add(coreGlow);

    const pointLight = new THREE.PointLight(new THREE.Color(palette.cream), 3.2, 5, 2);
    pointLight.position.set(0, 0, 0.2);
    orbGroup.add(pointLight);

    scene.add(new THREE.HemisphereLight(0xffffff, new THREE.Color(palette.deep), 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(-2.4, 3.0, 4.0);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(palette.light), 1.8);
    rim.position.set(3, -1.5, 2);
    scene.add(rim);

    const mistTexture = makeMistTexture();
    const mistSprites: THREE.Sprite[] = [];
    for (let i = 0; i < 7; i += 1) {
      const material = new THREE.SpriteMaterial({
        map: mistTexture,
        color: new THREE.Color(i % 2 ? palette.light : palette.mid),
        transparent: true,
        opacity: 0.07 + (i % 3) * 0.018,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      const angle = (i / 7) * Math.PI * 2;
      sprite.position.set(Math.cos(angle) * 0.42, Math.sin(angle * 1.3) * 0.35, Math.sin(angle) * 0.36);
      sprite.scale.setScalar(0.62 + (i % 3) * 0.12);
      sprite.renderOrder = 1;
      orbGroup.add(sprite);
      mistSprites.push(sprite);
    }

    const particleCount = 54;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const r = 0.72 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      particlePositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * Math.cos(phi);
      particlePositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: new THREE.Color(palette.cream),
      size: 0.018,
      transparent: true,
      opacity: 0.72,
      sizeAttenuation: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    particles.renderOrder = 4;
    orbGroup.add(particles);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const speed = stateSpeed(state);

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const motionTime = reducedMotion ? 0 : elapsed * speed;

      ribbonMeshes.forEach(({ mesh, config }, index) => {
        const oldGeometry = mesh.geometry;
        mesh.geometry = makeRibbonGeometry(config, motionTime + index * 0.35);
        oldGeometry.dispose();
      });

      if (!reducedMotion) {
        orbGroup.rotation.y = Math.sin(elapsed * 0.18) * 0.12;
        orbGroup.rotation.x = Math.sin(elapsed * 0.13) * 0.045;
        core.scale.setScalar(0.92 + Math.sin(elapsed * 2.0 * speed) * 0.10);
        coreGlow.scale.setScalar(0.94 + Math.sin(elapsed * 1.45 * speed) * 0.16);
        coreGlowMaterial.opacity = 0.13 + (Math.sin(elapsed * 1.7 * speed) + 1) * 0.035;
        particles.rotation.y = elapsed * 0.055 * speed;
        particles.rotation.x = Math.sin(elapsed * 0.11) * 0.16;
        mistSprites.forEach((sprite, i) => {
          const phase = elapsed * (0.10 + i * 0.007) * speed + i;
          sprite.position.x += Math.sin(phase) * 0.0007;
          sprite.position.y += Math.cos(phase * 1.3) * 0.00055;
          sprite.material.rotation = Math.sin(phase * 0.5) * 0.35;
        });
      }

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      ribbonMeshes.forEach(({ mesh, material }) => {
        mesh.geometry.dispose();
        material.dispose();
      });
      glassGeometry.dispose();
      glassMaterial.dispose();
      innerGeometry.dispose();
      innerMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      coreGlowGeometry.dispose();
      coreGlowMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      mistSprites.forEach((sprite) => sprite.material.dispose());
      mistTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [state, tone]);

  return <div ref={hostRef} className="spirit-orb-webgl" aria-hidden="true" />;
}
