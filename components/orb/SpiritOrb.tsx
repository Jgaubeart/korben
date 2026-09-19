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
  star: string;
};

const PALETTES: Record<AmbientSceneKey, Palette> = {
  "pre-dawn": { deep: "#14364b", mid: "#4a8c9a", light: "#b8dcdf", cream: "#e8d8c7", core: "#fff6df", star: "#f4eee1" },
  dawn: { deep: "#1b4457", mid: "#69a0a6", light: "#c6e5df", cream: "#f2ddc4", core: "#fff5db", star: "#fff4e7" },
  sunrise: { deep: "#2d554f", mid: "#79a08f", light: "#d5ebd8", cream: "#f6d4a7", core: "#fff1cb", star: "#fff3df" },
  morning: { deep: "#0f4d49", mid: "#399184", light: "#bae8dd", cream: "#f7e8ca", core: "#fff6da", star: "#fff6ea" },
  noon: { deep: "#0d504a", mid: "#359586", light: "#b8eadc", cream: "#f8e8c7", core: "#fff7dc", star: "#fff9ef" },
  afternoon: { deep: "#175650", mid: "#4a9688", light: "#bde5d9", cream: "#f4e2c3", core: "#fff3d5", star: "#fff6e7" },
  "golden-hour": { deep: "#395d55", mid: "#809c88", light: "#d7e4cd", cream: "#f4ca92", core: "#ffeabd", star: "#fff1d8" },
  sunset: { deep: "#3d5455", mid: "#868f8a", light: "#d1d8cd", cream: "#edbc9d", core: "#ffdebc", star: "#fff0de" },
  "blue-hour": { deep: "#12374d", mid: "#36798c", light: "#9ad4db", cream: "#dde6de", core: "#f2f5e4", star: "#f4f7ef" },
  night: { deep: "#0a2a40", mid: "#236d82", light: "#8fd2da", cream: "#dde8df", core: "#f6f8e8", star: "#ffffff" },
};

function speedFor(state: SpiritOrbProps["state"]) {
  if (state === "listening") return 1.2;
  if (state === "thinking") return 1.65;
  if (state === "responding") return 1.38;
  if (state === "working") return 1.1;
  return 0.58;
}

function curlFor(state: SpiritOrbProps["state"]) {
  if (state === "thinking") return 30;
  if (state === "responding") return 27;
  if (state === "listening") return 24;
  if (state === "working") return 21;
  return 17;
}

function splatForceFor(state: SpiritOrbProps["state"]) {
  if (state === "thinking") return 110;
  if (state === "responding") return 102;
  if (state === "listening") return 88;
  if (state === "working") return 82;
  return 62;
}

const QUAD_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const ADVECT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSource;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uDissipation;

  void main() {
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    vec2 coord = vUv - uDt * velocity * uTexel;
    gl_FragColor = texture2D(uSource, coord) * uDissipation;
  }
`;

const CURL_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;

  void main() {
    float left = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).y;
    float right = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).y;
    float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).x;
    float top = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).x;
    float curl = 0.5 * (right - left - top + bottom);
    gl_FragColor = vec4(curl, 0.0, 0.0, 1.0);
  }
`;

const VORTICITY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform sampler2D uCurl;
  uniform vec2 uTexel;
  uniform float uDt;
  uniform float uCurlStrength;

  void main() {
    float left = abs(texture2D(uCurl, vUv - vec2(uTexel.x, 0.0)).x);
    float right = abs(texture2D(uCurl, vUv + vec2(uTexel.x, 0.0)).x);
    float bottom = abs(texture2D(uCurl, vUv - vec2(0.0, uTexel.y)).x);
    float top = abs(texture2D(uCurl, vUv + vec2(0.0, uTexel.y)).x);
    float center = texture2D(uCurl, vUv).x;

    vec2 force = 0.5 * vec2(top - bottom, right - left);
    force /= length(force) + 0.0001;
    force *= uCurlStrength * center;
    force.y *= -1.0;

    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity += force * uDt;
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const DIVERGENCE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;

  void main() {
    float left = texture2D(uVelocity, vUv - vec2(uTexel.x, 0.0)).x;
    float right = texture2D(uVelocity, vUv + vec2(uTexel.x, 0.0)).x;
    float bottom = texture2D(uVelocity, vUv - vec2(0.0, uTexel.y)).y;
    float top = texture2D(uVelocity, vUv + vec2(0.0, uTexel.y)).y;
    float div = 0.5 * (right - left + top - bottom);
    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
  }
`;

const PRESSURE_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;
  uniform vec2 uTexel;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    float divergence = texture2D(uDivergence, vUv).x;
    float pressure = (left + right + bottom + top - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
  }
`;

const GRADIENT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPressure;
  uniform sampler2D uVelocity;
  uniform vec2 uTexel;

  void main() {
    float left = texture2D(uPressure, vUv - vec2(uTexel.x, 0.0)).x;
    float right = texture2D(uPressure, vUv + vec2(uTexel.x, 0.0)).x;
    float bottom = texture2D(uPressure, vUv - vec2(0.0, uTexel.y)).x;
    float top = texture2D(uPressure, vUv + vec2(0.0, uTexel.y)).x;
    vec2 velocity = texture2D(uVelocity, vUv).xy;
    velocity -= 0.5 * vec2(right - left, top - bottom);
    gl_FragColor = vec4(velocity, 0.0, 1.0);
  }
`;

const SPLAT_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTarget;
  uniform vec2 uPoint;
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uAspect;

  void main() {
    vec2 p = vUv - uPoint;
    p.x *= uAspect;
    float falloff = exp(-dot(p, p) / max(uRadius, 0.00001));
    vec3 base = texture2D(uTarget, vUv).rgb;
    gl_FragColor = vec4(base + uColor * falloff, 1.0);
  }
`;

const FLUID_VERTEX = `
  varying vec2 vUv;
  varying vec3 vLocalNormal;
  varying vec3 vLocalPos;

  void main() {
    vUv = uv;
    vLocalNormal = normal;
    vLocalPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLUID_FRAGMENT = `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vLocalNormal;
  varying vec3 vLocalPos;

  uniform sampler2D uDye;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uLight;
  uniform vec3 uCream;
  uniform float uTime;

  vec2 wrapUv(vec2 uv) {
    return fract(uv);
  }

  vec3 sampleFluid(vec2 uv, float scale, vec2 offset) {
    return texture2D(uDye, wrapUv(uv * scale + offset)).rgb;
  }

  void main() {
    vec3 n = normalize(vLocalNormal);
    vec3 p = normalize(vLocalPos);

    float depthBack = (p.z + 1.0) * 0.5;
    float edge = pow(1.0 - abs(n.z), 1.45);

    vec2 flow0 = vUv;
    flow0.x += sin(vUv.y * 6.2831 + uTime * 0.11) * 0.015;
    flow0.y += cos(vUv.x * 7.1 - uTime * 0.08) * 0.012;

    vec2 flow1 = vUv + vec2(p.x, p.y) * 0.06;
    flow1.x += sin(vUv.y * 9.0 - uTime * 0.07) * 0.025;
    flow1.y += sin(vUv.x * 8.0 + uTime * 0.05) * 0.018;

    vec2 flow2 = vUv - vec2(p.x, p.y) * 0.045;
    flow2.x += cos(vUv.y * 5.0 + uTime * 0.05) * 0.012;
    flow2.y += sin(vUv.x * 4.5 - uTime * 0.04) * 0.014;

    vec3 backLayer = sampleFluid(flow0, 0.94, vec2(0.03, 0.07));
    vec3 mainLayer = sampleFluid(flow1, 1.06, vec2(0.17, 0.11));
    vec3 frontLayer = sampleFluid(flow2, 1.14, vec2(0.41, 0.27));

    float backI = max(max(backLayer.r, backLayer.g), backLayer.b);
    float mainI = max(max(mainLayer.r, mainLayer.g), mainLayer.b);
    float frontI = max(max(frontLayer.r, frontLayer.g), frontLayer.b);

    vec3 color = vec3(0.0);

    color += mix(uDeep * 0.35, backLayer, 0.75) * (0.18 + backI * 0.55) * (0.7 + depthBack * 0.4);
    color += mix(uMid * 0.55, mainLayer, 0.88) * (0.2 + mainI * 0.95);
    color += mix(uLight * 0.7, frontLayer + uCream * 0.10, 0.92) * (0.12 + frontI * 0.75) * (0.55 + edge * 0.55);

    float intensity = max(max(color.r, color.g), color.b);
    float alpha = smoothstep(0.025, 0.34, intensity);
    alpha *= 0.68 + edge * 0.18;

    color += uLight * edge * 0.05;
    color += uCream * pow(mainI, 1.6) * 0.10;

    gl_FragColor = vec4(color, alpha);
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

const OUTER_GLASS_FRAGMENT = `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  uniform vec3 uLight;
  uniform vec3 uCream;
  uniform float uPulse;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.15);
    float highlightA = pow(max(dot(n, normalize(vec3(-0.52, 0.78, 0.54))), 0.0), 22.0);
    float highlightB = pow(max(dot(n, normalize(vec3(0.92, 0.20, 0.44))), 0.0), 32.0);
    float highlightC = pow(max(dot(n, normalize(vec3(-0.18, -0.55, 0.92))), 0.0), 18.0);

    vec3 color = mix(uLight, uCream, highlightA * 0.72 + highlightB * 0.35 + highlightC * 0.18);

    float alpha =
      0.02 +
      fresnel * 0.30 +
      highlightA * 0.20 +
      highlightB * 0.16 +
      highlightC * 0.08;

    alpha *= 0.95 + uPulse * 0.05;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.5));
  }
`;

const INNER_GLASS_FRAGMENT = `
  precision highp float;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  uniform vec3 uLight;
  uniform vec3 uCream;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 v = normalize(cameraPosition - vWorldPos);

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 1.8);
    vec3 color = mix(uLight * 0.65, uCream * 0.85, fresnel * 0.6);
    float alpha = 0.02 + fresnel * 0.09;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.18));
  }
`;

function makeTarget(size: number) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function setMaterial(
  quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>,
  material: THREE.ShaderMaterial
) {
  quad.material = material;
}

export function SpiritOrb({ state, tone }: SpiritOrbProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const palette = PALETTES[tone];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const simSize = 128;
    const texel = new THREE.Vector2(1 / simSize, 1 / simSize);

    let velocityA = makeTarget(simSize);
    let velocityB = makeTarget(simSize);
    let dyeA = makeTarget(simSize);
    let dyeB = makeTarget(simSize);
    let pressureA = makeTarget(simSize);
    let pressureB = makeTarget(simSize);
    const divergence = makeTarget(simSize);
    const curl = makeTarget(simSize);

    const simScene = new THREE.Scene();
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quadGeometry = new THREE.PlaneGeometry(2, 2);

    const quad = new THREE.Mesh(
      quadGeometry,
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VERTEX,
        fragmentShader: ADVECT_FRAGMENT,
      })
    );
    simScene.add(quad);

    const advectMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: ADVECT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uSource: { value: null },
        uVelocity: { value: null },
        uTexel: { value: texel },
        uDt: { value: 1 / 30 },
        uDissipation: { value: 0.99 },
      },
    });

    const curlMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: CURL_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVelocity: { value: null },
        uTexel: { value: texel },
      },
    });

    const vorticityMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: VORTICITY_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVelocity: { value: null },
        uCurl: { value: curl.texture },
        uTexel: { value: texel },
        uDt: { value: 1 / 30 },
        uCurlStrength: { value: curlFor(state) },
      },
    });

    const divergenceMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: DIVERGENCE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uVelocity: { value: null },
        uTexel: { value: texel },
      },
    });

    const pressureMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: PRESSURE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPressure: { value: null },
        uDivergence: { value: divergence.texture },
        uTexel: { value: texel },
      },
    });

    const gradientMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: GRADIENT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPressure: { value: null },
        uVelocity: { value: null },
        uTexel: { value: texel },
      },
    });

    const splatMaterial = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERTEX,
      fragmentShader: SPLAT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTarget: { value: null },
        uPoint: { value: new THREE.Vector2(0.5, 0.5) },
        uColor: { value: new THREE.Vector3() },
        uRadius: { value: 0.004 },
        uAspect: { value: 1 },
      },
    });

    const renderPass = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) => {
      setMaterial(quad, material);
      renderer.setRenderTarget(target);
      renderer.render(simScene, simCamera);
    };

    const clearTarget = (target: THREE.WebGLRenderTarget) => {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
    };

    [velocityA, velocityB, dyeA, dyeB, pressureA, pressureB, divergence, curl].forEach(clearTarget);

    const displayScene = new THREE.Scene();
    const displayCamera = new THREE.PerspectiveCamera(31, 1, 0.1, 20);
    displayCamera.position.set(0, 0, 4.2);

    const orbGroup = new THREE.Group();
    displayScene.add(orbGroup);

    const innerBackGeometry = new THREE.SphereGeometry(0.88, 72, 72);
    const innerBackMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.deep),
      transparent: true,
      opacity: tone === "night" ? 0.12 : 0.08,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const innerBack = new THREE.Mesh(innerBackGeometry, innerBackMaterial);
    innerBack.renderOrder = 0;
    orbGroup.add(innerBack);

    const fluidGeometry = new THREE.SphereGeometry(0.97, 96, 96);
    const fluidMaterial = new THREE.ShaderMaterial({
      vertexShader: FLUID_VERTEX,
      fragmentShader: FLUID_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uDye: { value: dyeA.texture },
        uDeep: { value: new THREE.Color(palette.deep) },
        uMid: { value: new THREE.Color(palette.mid) },
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
        uTime: { value: 0 },
      },
    });
    const fluidSphere = new THREE.Mesh(fluidGeometry, fluidMaterial);
    fluidSphere.renderOrder = 2;
    orbGroup.add(fluidSphere);

    const innerShellGeometry = new THREE.SphereGeometry(1.0, 96, 96);
    const innerShellMaterial = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERTEX,
      fragmentShader: INNER_GLASS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
      },
    });
    const innerShell = new THREE.Mesh(innerShellGeometry, innerShellMaterial);
    innerShell.renderOrder = 4;
    orbGroup.add(innerShell);

    const outerGlassGeometry = new THREE.SphereGeometry(1.07, 120, 120);
    const outerGlassMaterial = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERTEX,
      fragmentShader: OUTER_GLASS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
        uPulse: { value: 0 },
      },
    });
    const outerGlass = new THREE.Mesh(outerGlassGeometry, outerGlassMaterial);
    outerGlass.renderOrder = 8;
    orbGroup.add(outerGlass);

    const coreGeometry = new THREE.SphereGeometry(0.064, 36, 36);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.core),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 10;
    orbGroup.add(core);

    const coreGlowGeometry = new THREE.SphereGeometry(0.18, 32, 32);
    const coreGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.light),
      transparent: true,
      opacity: tone === "night" ? 0.13 : 0.09,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
    coreGlow.renderOrder = 9;
    orbGroup.add(coreGlow);

    const starCount = 95;
    const starPositions = new Float32Array(starCount * 3);
    const starSizes = new Float32Array(starCount);
    for (let i = 0; i < starCount; i += 1) {
      const r = 0.75 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      starSizes[i] = 0.4 + Math.random() * 1.1;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute("aSize", new THREE.BufferAttribute(starSizes, 1));

    const starMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(palette.star) },
        uOpacity: { value: tone === "night" ? 0.72 : 0.42 },
      },
      vertexShader: `
        attribute float aSize;
        varying float vSize;
        void main() {
          vSize = aSize;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * 2.6;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vSize;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float d = length(p);
          float alpha = smoothstep(0.5, 0.0, d);
          alpha *= uOpacity;
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    });

    const stars = new THREE.Points(starGeometry, starMaterial);
    stars.renderOrder = 6;
    orbGroup.add(stars);

    const shimmerGeometry = new THREE.TorusGeometry(0.73, 0.01, 16, 120, Math.PI * 0.9);
    const shimmerMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.cream),
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shimmerArcA = new THREE.Mesh(shimmerGeometry, shimmerMaterial);
    shimmerArcA.position.set(0.04, 0.06, 0.46);
    shimmerArcA.rotation.set(0.45, 0.22, -0.22);
    shimmerArcA.renderOrder = 7;
    orbGroup.add(shimmerArcA);

    const shimmerArcB = shimmerArcA.clone();
    shimmerArcB.scale.setScalar(0.84);
    shimmerArcB.position.set(-0.08, 0.28, 0.36);
    shimmerArcB.rotation.set(0.2, -0.4, 0.8);
    shimmerArcB.material = shimmerMaterial.clone();
    (shimmerArcB.material as THREE.MeshBasicMaterial).opacity = 0.08;
    orbGroup.add(shimmerArcB);

    const fluidColors = [
      new THREE.Color(palette.cream),
      new THREE.Color(palette.light),
      new THREE.Color(palette.mid),
    ];

    const doSplat = (
      targetA: THREE.WebGLRenderTarget,
      targetB: THREE.WebGLRenderTarget,
      point: THREE.Vector2,
      color: THREE.Vector3,
      radius: number
    ) => {
      splatMaterial.uniforms.uTarget.value = targetA.texture;
      splatMaterial.uniforms.uPoint.value.copy(point);
      splatMaterial.uniforms.uColor.value.copy(color);
      splatMaterial.uniforms.uRadius.value = radius;
      renderPass(splatMaterial, targetB);
    };

    const swapVelocity = () => {
      const temp = velocityA;
      velocityA = velocityB;
      velocityB = temp;
    };

    const swapDye = () => {
      const temp = dyeA;
      dyeA = dyeB;
      dyeB = temp;
    };

    const swapPressure = () => {
      const temp = pressureA;
      pressureA = pressureB;
      pressureB = temp;
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);

      renderer.setSize(width, height, false);
      displayCamera.aspect = width / height;
      displayCamera.updateProjectionMatrix();
      splatMaterial.uniforms.uAspect.value = width / height;
    };

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const speed = speedFor(state);
    const baseForce = splatForceFor(state);
    const clock = new THREE.Clock();
    let frame = 0;
    let lastStep = 0;

    const injectStructuredSpirit = (time: number) => {
      const ringRadius = state === "listening" ? 0.16 : 0.22;
      const radius = state === "thinking" ? 0.0046 : 0.0062;

      for (let i = 0; i < 4; i += 1) {
        const angle = time * (0.48 + i * 0.03) * speed + i * (Math.PI * 0.5);
        const wobble = Math.sin(time * 0.28 + i * 1.2) * 0.045;
        const r = ringRadius + wobble;
        const px = 0.5 + Math.cos(angle) * r;
        const py = 0.5 + Math.sin(angle) * r * 0.78;
        const point = new THREE.Vector2(px, py);

        const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
        const inward = new THREE.Vector2(0.5 - px, 0.5 - py).normalize();

        let velocityVec = tangent.clone();
        if (state === "listening") {
          velocityVec = tangent.multiplyScalar(0.55).add(inward.multiplyScalar(0.8));
        } else if (state === "responding") {
          velocityVec = tangent.multiplyScalar(1.05).add(inward.multiplyScalar(-0.18));
        } else if (state === "thinking") {
          velocityVec = tangent.multiplyScalar(1.15).add(inward.multiplyScalar(0.12));
        }

        const velColor = new THREE.Vector3(
          velocityVec.x * baseForce,
          velocityVec.y * baseForce,
          0
        );

        doSplat(velocityA, velocityB, point, velColor, radius);
        swapVelocity();

        const color = fluidColors[i % fluidColors.length].clone();
        const amt = i === 0 ? 0.053 : i === 1 ? 0.04 : 0.032;

        doSplat(
          dyeA,
          dyeB,
          point,
          new THREE.Vector3(color.r * amt, color.g * amt, color.b * amt),
          radius * 1.7
        );
        swapDye();
      }

      doSplat(
        dyeA,
        dyeB,
        new THREE.Vector2(0.5, 0.5),
        new THREE.Vector3(0.010, 0.011, 0.012),
        0.02
      );
      swapDye();
    };

    const stepFluid = (time: number) => {
      const dt = 1 / 30;

      advectMaterial.uniforms.uSource.value = velocityA.texture;
      advectMaterial.uniforms.uVelocity.value = velocityA.texture;
      advectMaterial.uniforms.uDt.value = dt;
      advectMaterial.uniforms.uDissipation.value = 0.992;
      renderPass(advectMaterial, velocityB);
      swapVelocity();

      curlMaterial.uniforms.uVelocity.value = velocityA.texture;
      renderPass(curlMaterial, curl);

      vorticityMaterial.uniforms.uVelocity.value = velocityA.texture;
      vorticityMaterial.uniforms.uCurl.value = curl.texture;
      vorticityMaterial.uniforms.uDt.value = dt;
      vorticityMaterial.uniforms.uCurlStrength.value = curlFor(state);
      renderPass(vorticityMaterial, velocityB);
      swapVelocity();

      divergenceMaterial.uniforms.uVelocity.value = velocityA.texture;
      renderPass(divergenceMaterial, divergence);

      clearTarget(pressureA);
      clearTarget(pressureB);
      for (let i = 0; i < 10; i += 1) {
        pressureMaterial.uniforms.uPressure.value = pressureA.texture;
        pressureMaterial.uniforms.uDivergence.value = divergence.texture;
        renderPass(pressureMaterial, pressureB);
        swapPressure();
      }

      gradientMaterial.uniforms.uPressure.value = pressureA.texture;
      gradientMaterial.uniforms.uVelocity.value = velocityA.texture;
      renderPass(gradientMaterial, velocityB);
      swapVelocity();

      advectMaterial.uniforms.uSource.value = dyeA.texture;
      advectMaterial.uniforms.uVelocity.value = velocityA.texture;
      advectMaterial.uniforms.uDt.value = dt;
      advectMaterial.uniforms.uDissipation.value =
        state === "responding" ? 0.997 : 0.995;
      renderPass(advectMaterial, dyeB);
      swapDye();

      injectStructuredSpirit(time);
      fluidMaterial.uniforms.uDye.value = dyeA.texture;
    };

    for (let i = 0; i < 28; i += 1) {
      injectStructuredSpirit(i * 0.14);
      stepFluid(i * 0.14);
    }

    const render = () => {
      const elapsed = clock.getElapsedTime();

      if (!reducedMotion && elapsed - lastStep >= 1 / 30) {
        stepFluid(elapsed);
        lastStep = elapsed;
      }

      if (!reducedMotion) {
        orbGroup.rotation.y = Math.sin(elapsed * 0.09) * 0.045;
        orbGroup.rotation.x = Math.sin(elapsed * 0.07) * 0.022;
        stars.rotation.y = elapsed * 0.04;
        stars.rotation.x = Math.sin(elapsed * 0.11) * 0.08;
        shimmerArcA.rotation.z += 0.0017;
        shimmerArcB.rotation.z -= 0.0011;
      }

      const pulse = reducedMotion ? 0.4 : (Math.sin(elapsed * 1.28 * speed) + 1) * 0.5;
      fluidMaterial.uniforms.uTime.value = reducedMotion ? 0 : elapsed * speed;
      outerGlassMaterial.uniforms.uPulse.value = pulse;

      core.scale.setScalar(0.94 + pulse * 0.10);
      coreGlow.scale.setScalar(0.92 + pulse * 0.22);
      coreGlowMaterial.opacity = (tone === "night" ? 0.09 : 0.06) + pulse * 0.05;

      renderer.setRenderTarget(null);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(displayScene, displayCamera);

      frame = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();

      velocityA.dispose();
      velocityB.dispose();
      dyeA.dispose();
      dyeB.dispose();
      pressureA.dispose();
      pressureB.dispose();
      divergence.dispose();
      curl.dispose();

      quadGeometry.dispose();
      advectMaterial.dispose();
      curlMaterial.dispose();
      vorticityMaterial.dispose();
      divergenceMaterial.dispose();
      pressureMaterial.dispose();
      gradientMaterial.dispose();
      splatMaterial.dispose();

      innerBackGeometry.dispose();
      innerBackMaterial.dispose();
      fluidGeometry.dispose();
      fluidMaterial.dispose();
      innerShellGeometry.dispose();
      innerShellMaterial.dispose();
      outerGlassGeometry.dispose();
      outerGlassMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      coreGlowGeometry.dispose();
      coreGlowMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
      shimmerGeometry.dispose();
      shimmerMaterial.dispose();
      (shimmerArcB.material as THREE.Material).dispose();

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [state, tone]);

  return <div ref={hostRef} className="spirit-orb-webgl" aria-hidden="true" />;
}
