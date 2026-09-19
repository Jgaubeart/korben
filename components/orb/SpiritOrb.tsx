"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AmbientSceneKey } from "../../lib/ambient-time";

type SpiritOrbProps = {
  state: "idle" | "listening" | "thinking" | "responding" | "working";
  tone: AmbientSceneKey;
};

type Palette = {
  deep: string;
  mid: string;
  light: string;
  cream: string;
  core: string;
};

const PALETTES: Record<AmbientSceneKey, Palette> = {
  "pre-dawn": { deep: "#15394f", mid: "#548f9f", light: "#b9dcdf", cream: "#e8d8c7", core: "#fff6df" },
  dawn: { deep: "#1d4558", mid: "#6aa4aa", light: "#c3e5df", cream: "#f2dac1", core: "#fff5db" },
  sunrise: { deep: "#315651", mid: "#7ca28f", light: "#d4ead5", cream: "#f5d3a4", core: "#fff0c8" },
  morning: { deep: "#124f4b", mid: "#3d9689", light: "#b9e8dc", cream: "#f7e7c7", core: "#fff6da" },
  noon: { deep: "#0f514c", mid: "#369789", light: "#b7e9dc", cream: "#f8e7c4", core: "#fff7dc" },
  afternoon: { deep: "#185650", mid: "#499487", light: "#bee5da", cream: "#f4e1c1", core: "#fff3d3" },
  "golden-hour": { deep: "#3b5c55", mid: "#829d88", light: "#d7e4cd", cream: "#f4c98f", core: "#ffe9ba" },
  sunset: { deep: "#3e5354", mid: "#858f89", light: "#d1d8cd", cream: "#edba99", core: "#ffddb9" },
  "blue-hour": { deep: "#12364e", mid: "#34798c", light: "#98d3da", cream: "#dce5dc", core: "#f1f4e1" },
  night: { deep: "#0a2a40", mid: "#246f84", light: "#8fd1d8", cream: "#dce7df", core: "#f5f7e8" },
};

function speedFor(state: SpiritOrbProps["state"]) {
  if (state === "listening") return 1.25;
  if (state === "thinking") return 1.75;
  if (state === "responding") return 1.42;
  if (state === "working") return 1.15;
  return 0.58;
}

function energyFor(state: SpiritOrbProps["state"]) {
  if (state === "listening") return 1.10;
  if (state === "thinking") return 1.22;
  if (state === "responding") return 1.28;
  if (state === "working") return 1.12;
  return 0.92;
}

const VOLUME_VERTEX = `
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const VOLUME_FRAGMENT = `
  precision highp float;

  varying vec3 vLocalPos;

  uniform float uTime;
  uniform float uEnergy;
  uniform vec3 uCameraLocal;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uCream;

  #define STEPS 56

  mat2 rot(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat2(c, -s, s, c);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);

    float n000 = hash31(i + vec3(0.0,0.0,0.0));
    float n100 = hash31(i + vec3(1.0,0.0,0.0));
    float n010 = hash31(i + vec3(0.0,1.0,0.0));
    float n110 = hash31(i + vec3(1.0,1.0,0.0));
    float n001 = hash31(i + vec3(0.0,0.0,1.0));
    float n101 = hash31(i + vec3(1.0,0.0,1.0));
    float n011 = hash31(i + vec3(0.0,1.0,1.0));
    float n111 = hash31(i + vec3(1.0,1.0,1.0));

    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  float fbm(vec3 p) {
    float value = 0.0;
    float amp = 0.52;
    for (int i = 0; i < 4; i++) {
      value += noise3(p) * amp;
      p = p * 2.03 + vec3(13.2, 7.7, 4.1);
      amp *= 0.50;
    }
    return value;
  }

  vec3 swirl(vec3 p) {
    float a = uTime * 0.16 + p.y * 1.45;
    p.xz = rot(a) * p.xz;

    float b = sin(p.z * 2.2 + uTime * 0.13) * 0.32;
    p.xy = rot(b) * p.xy;

    p += vec3(
      sin(p.y * 3.0 + uTime * 0.18),
      sin(p.z * 2.7 - uTime * 0.14),
      sin(p.x * 2.9 + uTime * 0.11)
    ) * 0.055;

    return p;
  }

  vec4 field(vec3 p) {
    vec3 q = swirl(p);
    float n = fbm(q * 3.15 + vec3(0.0, uTime * 0.055, -uTime * 0.04));
    float fine = fbm(q * 6.0 - vec3(uTime * 0.035, 0.0, uTime * 0.025));

    float waveA = abs(
      q.y
      - 0.26 * sin(q.x * 2.35 + q.z * 1.45 + uTime * 0.32 + n * 2.1)
      - 0.10 * sin(q.z * 4.0 - uTime * 0.21)
    );

    float waveB = abs(
      q.x
      - 0.30 * sin(q.z * 2.05 - q.y * 1.55 - uTime * 0.25 + n * 1.9)
      + 0.08 * cos(q.y * 4.1 + uTime * 0.15)
    );

    float waveC = abs(
      q.z
      - 0.23 * sin(q.x * 1.8 + q.y * 2.15 + uTime * 0.19 + n * 1.6)
    );

    float sA = exp(-waveA * 13.0);
    float sB = exp(-waveB * 12.0);
    float sC = exp(-waveC * 14.0);

    float breakup = smoothstep(0.22, 0.88, n * 0.72 + fine * 0.46);
    float radius = length(p);
    float shell = 1.0 - smoothstep(0.68, 0.91, radius);
    float hollow = smoothstep(0.08, 0.24, radius);

    float dA = sA * (0.45 + 0.82 * breakup);
    float dB = sB * (0.36 + 0.70 * breakup);
    float dC = sC * (0.26 + 0.54 * breakup);

    float density = (dA + dB + dC) * shell * hollow;
    density *= 0.72 + 0.28 * sin(n * 6.2831 + uTime * 0.2);

    vec3 color = vec3(0.0);
    float total = max(dA + dB + dC, 0.0001);
    color += uCream * dA;
    color += uLight * dB;
    color += uMid * dC;
    color /= total;

    color = mix(uDeep, color, 0.76 + breakup * 0.18);
    return vec4(color, max(density, 0.0));
  }

  vec2 sphereHit(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    vec3 ro = uCameraLocal;
    vec3 rd = normalize(vLocalPos - ro);
    vec2 hit = sphereHit(ro, rd, 0.96);
    if (hit.y <= 0.0) discard;

    float t0 = max(hit.x, 0.0);
    float t1 = hit.y;
    float span = max(t1 - t0, 0.001);
    float stepSize = span / float(STEPS);

    vec4 acc = vec4(0.0);
    float jitter = hash31(vLocalPos * 31.7);
    float t = t0 + jitter * stepSize;

    for (int i = 0; i < STEPS; i++) {
      if (t > t1 || acc.a > 0.93) break;

      vec3 p = ro + rd * t;
      vec4 sampleField = field(p);
      float alpha = clamp(sampleField.a * stepSize * 2.25 * uEnergy, 0.0, 0.24);

      float centerGlow = exp(-length(p) * 4.2) * 0.075;
      vec3 sampleColor = sampleField.rgb + uCream * centerGlow;

      acc.rgb += (1.0 - acc.a) * sampleColor * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      t += stepSize;
    }

    acc.rgb *= 1.18;
    acc.a *= 0.92;

    if (acc.a < 0.01) discard;
    gl_FragColor = acc;
  }
`;

const GLASS_VERTEX = `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const GLASS_FRAGMENT = `
  precision highp float;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  uniform vec3 uLight;
  uniform vec3 uCream;
  uniform float uPulse;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.6);
    float upperGlint = pow(max(dot(n, normalize(vec3(-0.55, 0.78, 0.55))), 0.0), 12.0);
    float sideGlint = pow(max(dot(n, normalize(vec3(0.82, 0.12, 0.56))), 0.0), 20.0);

    vec3 color = mix(uLight, uCream, upperGlint * 0.72 + sideGlint * 0.38);
    float alpha = 0.025 + fresnel * 0.26 + upperGlint * 0.14 + sideGlint * 0.16;
    alpha *= 0.94 + uPulse * 0.06;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.42));
  }
`;

export function SpiritOrb({ state, tone }: SpiritOrbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const palette = PALETTES[tone];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(31, 1, 0.1, 20);
    camera.position.set(0, 0, 4.15);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const orbGroup = new THREE.Group();
    scene.add(orbGroup);

    const volumeGeometry = new THREE.SphereGeometry(0.96, 72, 72);
    const volumeMaterial = new THREE.ShaderMaterial({
      vertexShader: VOLUME_VERTEX,
      fragmentShader: VOLUME_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: energyFor(state) },
        uCameraLocal: { value: new THREE.Vector3() },
        uDeep: { value: new THREE.Color(palette.deep) },
        uMid: { value: new THREE.Color(palette.mid) },
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
      },
    });
    const volume = new THREE.Mesh(volumeGeometry, volumeMaterial);
    volume.renderOrder = 2;
    orbGroup.add(volume);

    const glassGeometry = new THREE.SphereGeometry(1.065, 96, 96);
    const glassMaterial = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
        uPulse: { value: 0 },
      },
    });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    glass.renderOrder = 6;
    orbGroup.add(glass);

    const coreGeometry = new THREE.SphereGeometry(0.068, 32, 32);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.core),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 7;
    orbGroup.add(core);

    const glowGeometry = new THREE.SphereGeometry(0.19, 28, 28);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.light),
      transparent: true,
      opacity: 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.renderOrder = 5;
    orbGroup.add(glow);

    const particleCount = 42;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      const r = 0.74 * Math.cbrt(Math.random());
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
      size: 0.014,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
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
    const cameraLocal = new THREE.Vector3();
    let frame = 0;
    const speed = speedFor(state);
    const energy = energyFor(state);

    const render = () => {
      const elapsed = clock.getElapsedTime();
      const motionTime = reducedMotion ? 0 : elapsed * speed;

      if (!reducedMotion) {
        orbGroup.rotation.y = Math.sin(elapsed * 0.10) * 0.055;
        orbGroup.rotation.x = Math.sin(elapsed * 0.075) * 0.026;
        particles.rotation.y = elapsed * 0.035 * speed;
        particles.rotation.x = Math.sin(elapsed * 0.09) * 0.09;
      }

      orbGroup.updateMatrixWorld(true);
      cameraLocal.copy(camera.position);
      orbGroup.worldToLocal(cameraLocal);

      volumeMaterial.uniforms.uTime.value = motionTime;
      volumeMaterial.uniforms.uEnergy.value = energy;
      volumeMaterial.uniforms.uCameraLocal.value.copy(cameraLocal);

      const pulse = reducedMotion ? 0 : (Math.sin(elapsed * 1.45 * speed) + 1) * 0.5;
      glassMaterial.uniforms.uPulse.value = pulse;
      core.scale.setScalar(reducedMotion ? 1 : 0.93 + pulse * 0.13);
      glow.scale.setScalar(reducedMotion ? 1 : 0.90 + pulse * 0.22);
      glowMaterial.opacity = 0.065 + pulse * 0.055;

      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      volumeGeometry.dispose();
      volumeMaterial.dispose();
      glassGeometry.dispose();
      glassMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      glowGeometry.dispose();
      glowMaterial.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [state, tone]);

  return <div ref={hostRef} className="spirit-orb-webgl" aria-hidden="true" />;
}
