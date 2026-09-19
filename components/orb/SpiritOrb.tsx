"use client";

import type { AmbientSceneKey } from "../../lib/ambient-time";

type SpiritOrbProps = {
  state: "idle" | "listening" | "thinking" | "responding" | "working";
  tone: AmbientSceneKey;
};

const toneClass: Record<AmbientSceneKey, string> = {
  "pre-dawn": "orb-tone-pre-dawn",
  dawn: "orb-tone-dawn",
  sunrise: "orb-tone-sunrise",
  morning: "orb-tone-morning",
  noon: "orb-tone-noon",
  afternoon: "orb-tone-afternoon",
  "golden-hour": "orb-tone-golden-hour",
  sunset: "orb-tone-sunset",
  "blue-hour": "orb-tone-blue-hour",
  night: "orb-tone-night",
};

export function SpiritOrb({ state, tone }: SpiritOrbProps) {
  return (
    <div className={`static-glass-orb ${state} ${toneClass[tone]}`} aria-hidden="true">
      <svg className="static-glass-orb-svg" viewBox="0 0 420 420" role="presentation">
        <defs>
          <radialGradient id="orbBody" cx="35%" cy="25%" r="76%">
            <stop offset="0%" stopColor="rgba(255,255,255,.30)" />
            <stop offset="26%" stopColor="rgba(221,245,242,.18)" />
            <stop offset="55%" stopColor="rgba(87,150,148,.20)" />
            <stop offset="78%" stopColor="rgba(25,74,79,.27)" />
            <stop offset="100%" stopColor="rgba(9,42,49,.34)" />
          </radialGradient>

          <radialGradient id="orbInnerDepth" cx="50%" cy="56%" r="62%">
            <stop offset="0%" stopColor="rgba(17,79,76,.20)" />
            <stop offset="55%" stopColor="rgba(12,63,67,.18)" />
            <stop offset="100%" stopColor="rgba(5,42,49,.38)" />
          </radialGradient>

          <linearGradient id="glassStroke" x1="8%" y1="4%" x2="90%" y2="96%">
            <stop offset="0%" stopColor="rgba(255,255,255,.94)" />
            <stop offset="22%" stopColor="rgba(241,252,251,.70)" />
            <stop offset="60%" stopColor="rgba(150,212,208,.42)" />
            <stop offset="100%" stopColor="rgba(255,230,190,.64)" />
          </linearGradient>

          <linearGradient id="waveCream" x1="0%" y1="25%" x2="100%" y2="75%">
            <stop offset="0%" stopColor="rgba(255,246,222,0)" />
            <stop offset="18%" stopColor="rgba(255,246,222,.58)" />
            <stop offset="45%" stopColor="rgba(255,255,255,.88)" />
            <stop offset="72%" stopColor="rgba(235,250,245,.66)" />
            <stop offset="100%" stopColor="rgba(210,242,235,0)" />
          </linearGradient>

          <linearGradient id="waveMint" x1="100%" y1="10%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(119,205,188,0)" />
            <stop offset="22%" stopColor="rgba(119,205,188,.32)" />
            <stop offset="58%" stopColor="rgba(200,240,231,.56)" />
            <stop offset="100%" stopColor="rgba(255,236,201,0)" />
          </linearGradient>

          <linearGradient id="waveGold" x1="0%" y1="50%" x2="100%" y2="50%">
            <stop offset="0%" stopColor="rgba(255,231,190,0)" />
            <stop offset="38%" stopColor="rgba(255,236,204,.28)" />
            <stop offset="68%" stopColor="rgba(255,248,228,.58)" />
            <stop offset="100%" stopColor="rgba(255,231,190,0)" />
          </linearGradient>

          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,247,1)" />
            <stop offset="34%" stopColor="rgba(255,246,218,.88)" />
            <stop offset="100%" stopColor="rgba(255,240,200,0)" />
          </radialGradient>

          <filter id="softWave" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>

          <filter id="coreBlur" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="10" />
          </filter>

          <filter id="glassGlow" x="-35%" y="-35%" width="170%" height="170%">
            <feGaussianBlur stdDeviation="5" />
          </filter>

          <clipPath id="orbClip">
            <circle cx="210" cy="210" r="166" />
          </clipPath>
        </defs>

        <circle className="orb-shadow-ring" cx="210" cy="210" r="174" fill="rgba(11,47,52,.06)" />
        <circle cx="210" cy="210" r="174" fill="url(#orbBody)" stroke="url(#glassStroke)" strokeWidth="2.6" />
        <circle cx="210" cy="210" r="165" fill="url(#orbInnerDepth)" opacity=".72" />

        <g clipPath="url(#orbClip)">
          <ellipse cx="210" cy="248" rx="148" ry="100" fill="rgba(13,55,60,.10)" />
          <ellipse cx="188" cy="125" rx="118" ry="60" fill="rgba(255,255,255,.045)" transform="rotate(-8 188 125)" />

          <path
            className="orb-wave orb-wave-back"
            d="M38 271 C88 235 126 209 163 204 C206 198 234 222 266 234 C301 248 334 242 380 208 C343 261 301 287 257 290 C212 293 183 271 155 250 C125 228 86 239 38 271 Z"
            fill="url(#waveMint)"
            opacity=".40"
            filter="url(#softWave)"
          />

          <path
            className="orb-wave orb-wave-main"
            d="M43 258 C92 218 128 190 166 188 C207 186 232 212 264 228 C304 248 340 239 386 196 C352 258 304 294 251 296 C207 298 179 274 151 244 C120 211 87 220 43 258 Z"
            fill="url(#waveCream)"
            opacity=".72"
          />

          <path
            className="orb-wave orb-wave-front"
            d="M79 312 C118 289 144 262 164 231 C186 199 214 175 249 173 C286 171 320 190 354 226 C321 204 290 205 267 221 C240 240 229 267 204 287 C174 311 132 321 79 312 Z"
            fill="url(#waveMint)"
            opacity=".34"
            filter="url(#softWave)"
          />

          <path
            d="M51 260 C105 219 139 194 174 193 C207 193 232 214 263 229 C297 245 331 239 373 204"
            fill="none"
            stroke="url(#waveGold)"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity=".80"
          />

          <path
            d="M90 309 C129 285 151 258 169 232 C190 203 217 181 249 180 C281 179 312 194 341 221"
            fill="none"
            stroke="rgba(219,248,241,.42)"
            strokeWidth="1.7"
            strokeLinecap="round"
            opacity=".82"
          />

          <g className="orb-stars">
            <circle cx="112" cy="116" r="1.5" fill="rgba(255,255,255,.92)" />
            <circle cx="295" cy="112" r="1.25" fill="rgba(255,255,255,.78)" />
            <circle cx="322" cy="166" r="1.05" fill="rgba(255,244,216,.76)" />
            <circle cx="120" cy="206" r="1.15" fill="rgba(255,255,255,.72)" />
            <circle cx="280" cy="267" r="1.05" fill="rgba(255,255,255,.82)" />
            <circle cx="151" cy="292" r="1.0" fill="rgba(255,242,212,.72)" />
            <circle cx="236" cy="120" r=".9" fill="rgba(255,255,255,.76)" />
            <circle cx="337" cy="241" r=".9" fill="rgba(255,255,255,.64)" />
            <circle cx="89" cy="174" r=".9" fill="rgba(255,255,255,.68)" />
            <circle cx="300" cy="304" r="1.05" fill="rgba(255,255,255,.76)" />
            <circle cx="185" cy="141" r=".9" fill="rgba(255,255,255,.62)" />
            <circle cx="253" cy="329" r=".85" fill="rgba(255,255,255,.66)" />
            <circle cx="147" cy="163" r=".8" fill="rgba(255,255,255,.62)" />
            <circle cx="272" cy="151" r=".85" fill="rgba(255,255,255,.72)" />
          </g>
        </g>

        <circle className="orb-core-halo" cx="210" cy="212" r="26" fill="url(#coreGlow)" filter="url(#coreBlur)" />
        <circle className="orb-core" cx="210" cy="212" r="11" fill="rgba(255,253,239,.98)" />
        <circle cx="210" cy="212" r="4.5" fill="rgba(255,255,255,1)" />

        <path
          d="M91 94 C131 55 186 42 239 48"
          fill="none"
          stroke="rgba(255,255,255,.84)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity=".72"
        />

        <path
          d="M103 78 C142 51 195 42 244 50"
          fill="none"
          stroke="rgba(255,255,255,.20)"
          strokeWidth="11"
          strokeLinecap="round"
          opacity=".55"
          filter="url(#glassGlow)"
        />

        <path
          d="M329 113 C350 143 360 177 358 208"
          fill="none"
          stroke="rgba(255,236,202,.38)"
          strokeWidth="2.6"
          strokeLinecap="round"
          opacity=".68"
        />

        <ellipse cx="150" cy="103" rx="34" ry="10" fill="rgba(255,255,255,.08)" transform="rotate(-22 150 103)" />
      </svg>
    </div>
  );
}
