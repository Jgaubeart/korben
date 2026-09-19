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
          <radialGradient id="orbBody" cx="32%" cy="24%" r="78%">
            <stop offset="0%" stopColor="rgba(255,255,255,.34)" />
            <stop offset="28%" stopColor="rgba(220,248,244,.16)" />
            <stop offset="62%" stopColor="rgba(119,179,176,.13)" />
            <stop offset="100%" stopColor="rgba(20,67,72,.16)" />
          </radialGradient>

          <linearGradient id="glassStroke" x1="12%" y1="8%" x2="88%" y2="94%">
            <stop offset="0%" stopColor="rgba(255,255,255,.94)" />
            <stop offset="24%" stopColor="rgba(232,249,248,.62)" />
            <stop offset="60%" stopColor="rgba(164,219,215,.42)" />
            <stop offset="100%" stopColor="rgba(255,235,201,.74)" />
          </linearGradient>

          <linearGradient id="waveCream" x1="0%" y1="20%" x2="100%" y2="80%">
            <stop offset="0%" stopColor="rgba(255,246,224,0)" />
            <stop offset="18%" stopColor="rgba(255,246,224,.72)" />
            <stop offset="52%" stopColor="rgba(255,255,255,.92)" />
            <stop offset="82%" stopColor="rgba(212,243,236,.58)" />
            <stop offset="100%" stopColor="rgba(212,243,236,0)" />
          </linearGradient>

          <linearGradient id="waveMint" x1="100%" y1="10%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(160,224,209,0)" />
            <stop offset="18%" stopColor="rgba(160,224,209,.42)" />
            <stop offset="54%" stopColor="rgba(228,250,244,.66)" />
            <stop offset="82%" stopColor="rgba(255,239,206,.36)" />
            <stop offset="100%" stopColor="rgba(255,239,206,0)" />
          </linearGradient>

          <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,245,1)" />
            <stop offset="38%" stopColor="rgba(255,244,210,.92)" />
            <stop offset="100%" stopColor="rgba(255,244,210,0)" />
          </radialGradient>

          <filter id="softWave" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>

          <filter id="coreBlur" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="9" />
          </filter>

          <filter id="softAura" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="14" />
          </filter>

          <clipPath id="orbClip">
            <circle cx="210" cy="210" r="174" />
          </clipPath>
        </defs>

        <circle className="orb-aura-circle" cx="210" cy="210" r="180" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="10" filter="url(#softAura)" />
        <circle cx="210" cy="210" r="176" fill="url(#orbBody)" stroke="url(#glassStroke)" strokeWidth="3.4" />
        <circle cx="210" cy="210" r="166" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="1.4" />

        <g clipPath="url(#orbClip)">
          <ellipse cx="207" cy="218" rx="150" ry="118" fill="rgba(25,72,72,.09)" />

          <path
            className="orb-wave orb-wave-back"
            d="M38 266 C95 219 127 174 174 169 C220 164 245 201 280 211 C319 223 350 204 386 170 C353 238 309 268 259 273 C210 279 179 252 148 233 C111 211 78 224 38 266 Z"
            fill="url(#waveMint)"
            opacity=".58"
            filter="url(#softWave)"
          />

          <path
            className="orb-wave orb-wave-main"
            d="M26 250 C83 194 118 152 165 151 C211 149 235 187 268 204 C309 226 345 215 396 168 C360 252 310 298 251 296 C201 294 170 264 143 232 C112 196 75 204 26 250 Z"
            fill="url(#waveCream)"
            opacity=".78"
          />

          <path
            className="orb-wave orb-wave-front"
            d="M62 309 C109 281 136 244 160 211 C186 175 210 154 246 150 C289 146 325 171 364 219 C321 185 286 186 259 206 C230 228 218 259 191 281 C159 307 117 319 62 309 Z"
            fill="url(#waveMint)"
            opacity=".48"
            filter="url(#softWave)"
          />

          <path
            d="M47 265 C111 215 140 178 179 174 C215 171 238 196 269 210 C304 225 337 216 377 181"
            fill="none"
            stroke="rgba(255,255,255,.62)"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity=".72"
          />

          <path
            d="M76 310 C119 285 145 253 166 220 C188 186 216 160 250 157 C286 154 320 174 353 214"
            fill="none"
            stroke="rgba(213,246,238,.46)"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity=".74"
          />

          <g className="orb-stars">
            <circle cx="124" cy="116" r="1.6" fill="rgba(255,255,255,.95)" />
            <circle cx="294" cy="105" r="1.4" fill="rgba(255,255,255,.82)" />
            <circle cx="321" cy="160" r="1.2" fill="rgba(255,244,216,.82)" />
            <circle cx="111" cy="211" r="1.4" fill="rgba(255,255,255,.78)" />
            <circle cx="272" cy="259" r="1.2" fill="rgba(255,255,255,.88)" />
            <circle cx="151" cy="290" r="1.1" fill="rgba(255,242,212,.75)" />
            <circle cx="234" cy="104" r="1.0" fill="rgba(255,255,255,.8)" />
            <circle cx="342" cy="240" r="1.0" fill="rgba(255,255,255,.7)" />
            <circle cx="84" cy="171" r="1.0" fill="rgba(255,255,255,.72)" />
            <circle cx="299" cy="307" r="1.2" fill="rgba(255,255,255,.84)" />
            <circle cx="188" cy="128" r="1.0" fill="rgba(255,255,255,.66)" />
            <circle cx="251" cy="330" r="1.0" fill="rgba(255,255,255,.7)" />
          </g>
        </g>

        <circle className="orb-core-halo" cx="210" cy="210" r="28" fill="url(#coreGlow)" filter="url(#coreBlur)" />
        <circle className="orb-core" cx="210" cy="210" r="13" fill="rgba(255,253,236,.98)" />
        <circle cx="210" cy="210" r="5.5" fill="rgba(255,255,255,1)" />

        <path
          d="M92 82 C132 46 201 34 257 49 C293 59 321 78 340 102"
          fill="none"
          stroke="rgba(255,255,255,.56)"
          strokeWidth="9"
          strokeLinecap="round"
          opacity=".56"
          filter="url(#softWave)"
        />

        <path
          d="M72 118 C105 80 147 61 192 57"
          fill="none"
          stroke="rgba(255,255,255,.86)"
          strokeWidth="4.2"
          strokeLinecap="round"
          opacity=".76"
        />

        <path
          d="M332 116 C360 148 371 188 369 224"
          fill="none"
          stroke="rgba(255,237,204,.46)"
          strokeWidth="3.6"
          strokeLinecap="round"
          opacity=".7"
        />

        <ellipse cx="151" cy="107" rx="42" ry="14" fill="rgba(255,255,255,.10)" transform="rotate(-22 151 107)" />
      </svg>
    </div>
  );
}
