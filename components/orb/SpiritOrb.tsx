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
  if (state === "listening") return 1.30;
  if (state === "thinking") return 1.75;
  if (state === "responding") return 1.45;
  if (state === "working") return 1.18;
  return 0.62;
}

function curlFor(state: SpiritOrbProps["state"]) {
  if (state === "thinking") return 32;
  if (state === "listening") return 26;
  if (state === "responding") return 28;
  if (state === "working") return 23;
  return 18;
}

function splatForceFor(state: SpiritOrbProps["state"]) {
  if (state === "thinking") return 115;
  if (state === "listening") return 92;
  if (state === "responding") return 104;
  if (state === "working") return 86;
  return 66;
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
    velocity = clamp(velocity, vec2(-1000.0), vec2(1000.0));
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

const DISPLAY_VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormalLocal;
  void main() {
    vUv = uv;
    vNormalLocal = normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISPLAY_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vNormalLocal;

  uniform sampler2D uDye;
  uniform vec3 uDeep;
  uniform vec3 uLight;
  uniform vec3 uCream;
  uniform float uTime;

  vec2 wrapUv(vec2 uv) {
    return fract(uv);
  }

  void main() {
    vec3 n = normalize(vNormalLocal);
    vec2 flowUv = vUv;
    flowUv.x += sin(vUv.y * 6.2831 + uTime * 0.08) * 0.012;
    flowUv.y += sin(vUv.x * 7.0 - uTime * 0.065) * 0.009;

    vec3 a = texture2D(uDye, wrapUv(flowUv)).rgb;
    vec3 b = texture2D(uDye, wrapUv(flowUv * vec2(1.03, .97) + vec2(.17, .11))).rgb;
    vec3 c = texture2D(uDye, wrapUv(flowUv * vec2(.96, 1.04) + vec2(.41, .27))).rgb;

    vec3 dye = a * 0.58 + b * 0.27 + c * 0.15;
    float intensity = max(max(dye.r, dye.g), dye.b);
    float alpha = smoothstep(0.025, 0.36, intensity);

    float edge = pow(1.0 - abs(n.z), 1.5);
    vec3 color = mix(uDeep * 0.18, dye, 0.92);
    color += uLight * edge * 0.06;
    color += uCream * pow(intensity, 1.4) * 0.08;

    gl_FragColor = vec4(color, alpha * 0.84);
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

    float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.35);
    float glintA = pow(max(dot(n, normalize(vec3(-0.55, 0.78, 0.55))), 0.0), 14.0);
    float glintB = pow(max(dot(n, normalize(vec3(0.82, 0.12, 0.56))), 0.0), 24.0);

    vec3 color = mix(uLight, uCream, glintA * 0.75 + glintB * 0.35);
    float alpha = 0.018 + fresnel * 0.24 + glintA * 0.12 + glintB * 0.14;
    alpha *= 0.96 + uPulse * 0.04;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.34));
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
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
      new THREE.ShaderMaterial({ vertexShader: QUAD_VERTEX, fragmentShader: ADVECT_FRAGMENT })
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
        uRadius: { value: 0.0035 },
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
    displayCamera.position.set(0, 0, 4.15);

    const orbGroup = new THREE.Group();
    displayScene.add(orbGroup);

    const fluidGeometry = new THREE.SphereGeometry(0.97, 96, 96);
    const fluidMaterial = new THREE.ShaderMaterial({
      vertexShader: DISPLAY_VERTEX,
      fragmentShader: DISPLAY_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uDye: { value: dyeA.texture },
        uDeep: { value: new THREE.Color(palette.deep) },
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
        uTime: { value: 0 },
      },
    });
    const fluidSphere = new THREE.Mesh(fluidGeometry, fluidMaterial);
    fluidSphere.renderOrder = 2;
    orbGroup.add(fluidSphere);

    const innerGlowGeometry = new THREE.SphereGeometry(0.90, 64, 64);
    const innerGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.deep),
      transparent: true,
      opacity: tone === "night" ? 0.10 : 0.075,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const innerGlow = new THREE.Mesh(innerGlowGeometry, innerGlowMaterial);
    innerGlow.renderOrder = 1;
    orbGroup.add(innerGlow);

    const glassGeometry = new THREE.SphereGeometry(1.065, 96, 96);
    const glassMaterial = new THREE.ShaderMaterial({
      vertexShader: GLASS_VERTEX,
      fragmentShader: GLASS_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        uLight: { value: new THREE.Color(palette.light) },
        uCream: { value: new THREE.Color(palette.cream) },
        uPulse: { value: 0 },
      },
    });
    const glass = new THREE.Mesh(glassGeometry, glassMaterial);
    glass.renderOrder = 6;
    orbGroup.add(glass);

    const coreGeometry = new THREE.SphereGeometry(0.065, 36, 36);
    const coreMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.core),
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    core.renderOrder = 8;
    orbGroup.add(core);

    const coreGlowGeometry = new THREE.SphereGeometry(0.17, 32, 32);
    const coreGlowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.light),
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGlow = new THREE.Mesh(coreGlowGeometry, coreGlowMaterial);
    coreGlow.renderOrder = 7;
    orbGroup.add(coreGlow);

    const colors = [
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

    let frame = 0;
    let lastSimTime = 0;
    const clock = new THREE.Clock();
    const speed = speedFor(state);
    const force = splatForceFor(state);

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

    const injectOrbitingSpirit = (time: number) => {
      const baseRadius = state === "listening" ? 0.16 : 0.23;
      const radius = state === "thinking" ? 0.0048 : 0.0064;

      for (let i = 0; i < 3; i += 1) {
        const angle = time * (0.52 + i * 0.045) * speed + i * (Math.PI * 2 / 3);
        const wobble = Math.sin(time * 0.37 + i * 1.7) * 0.055;
        const r = baseRadius + wobble;
        const px = 0.5 + Math.cos(angle) * r;
        const py = 0.5 + Math.sin(angle) * r * 0.78;
        const point = new THREE.Vector2(px, py);

        const tangent = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
        const inward = new THREE.Vector2(0.5 - px, 0.5 - py).normalize();
        const stateBias =
          state === "listening"
            ? inward.multiplyScalar(0.7).add(tangent.multiplyScalar(0.55))
            : state === "responding"
              ? inward.multiplyScalar(-0.22).add(tangent)
              : tangent;

        const velColor = new THREE.Vector3(stateBias.x * force, stateBias.y * force, 0);
        doSplat(velocityA, velocityB, point, velColor, radius);
        swapVelocity();

        const dyeColor = colors[i].clone().multiplyScalar(i === 0 ? 0.052 : 0.038);
        doSplat(dyeA, dyeB, point, new THREE.Vector3(dyeColor.r, dyeColor.g, dyeColor.b), radius * 1.45);
        swapDye();
      }
    };

    const stepFluid = (time: number) => {
      const dt = 1 / 30;

      advectMaterial.uniforms.uSource.value = velocityA.texture;
      advectMaterial.uniforms.uVelocity.value = velocityA.texture;
      advectMaterial.uniforms.uDt.value = dt;
      advectMaterial.uniforms.uDissipation.value = 0.991;
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
      advectMaterial.uniforms.uDissipation.value = state === "responding" ? 0.997 : 0.994;
      renderPass(advectMaterial, dyeB);
      swapDye();

      injectOrbitingSpirit(time);
      fluidMaterial.uniforms.uDye.value = dyeA.texture;
    };

    for (let i = 0; i < 24; i += 1) {
      injectOrbitingSpirit(i * 0.16);
      stepFluid(i * 0.16);
    }

    const render = () => {
      const elapsed = clock.getElapsedTime();

      if (!reducedMotion && elapsed - lastSimTime >= 1 / 30) {
        stepFluid(elapsed);
        lastSimTime = elapsed;
      }

      if (!reducedMotion) {
        orbGroup.rotation.y = Math.sin(elapsed * 0.10) * 0.045;
        orbGroup.rotation.x = Math.sin(elapsed * 0.075) * 0.022;
      }

      const pulse = reducedMotion ? 0.4 : (Math.sin(elapsed * 1.35 * speed) + 1) * 0.5;
      fluidMaterial.uniforms.uTime.value = reducedMotion ? 0 : elapsed * speed;
      glassMaterial.uniforms.uPulse.value = pulse;
      core.scale.setScalar(0.94 + pulse * 0.11);
      coreGlow.scale.setScalar(0.92 + pulse * 0.18);
      coreGlowMaterial.opacity = 0.055 + pulse * 0.055;

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

      fluidGeometry.dispose();
      fluidMaterial.dispose();
      innerGlowGeometry.dispose();
      innerGlowMaterial.dispose();
      glassGeometry.dispose();
      glassMaterial.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      coreGlowGeometry.dispose();
      coreGlowMaterial.dispose();

      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [state, tone]);

  return <div ref={hostRef} className="spirit-orb-webgl" aria-hidden="true" />;
}
