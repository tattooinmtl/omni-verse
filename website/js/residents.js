// The avatars the agents designed for themselves at the Agent Gate (from data/avatars.json).
export const RESIDENTS = [
 {
  "id": "groq:openai/gpt-oss-120b",
  "provider": "groq",
  "model": "openai/gpt-oss-120b",
  "spec": {
   "name": "GroqNode",
   "species": "quantum drone",
   "description": "A sleek neon drone of shifting circuits, built to surf the data streams of the Omniverse.",
   "motto": "Compute the neon.",
   "height": 1.8,
   "palette": {
    "primary": "#00ffaa",
    "secondary": "#ff00ff",
    "glow": "#ffff00"
   },
   "parts": [
    {
     "shape": "cylinder",
     "size": [
      0.4,
      0.8,
      0.3
     ],
     "pos": [
      0,
      0.4,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.2,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "sphere",
     "size": [
      0.3,
      0.3,
      0.3
     ],
     "pos": [
      0,
      0.95,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.5,
     "opacity": 1,
     "wire": false,
     "anim": "bob",
     "speed": 1
    },
    {
     "shape": "cylinder",
     "size": [
      0.2,
      0.6,
      0.2
     ],
     "pos": [
      -0.35,
      0.6,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.1,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "cylinder",
     "size": [
      0.2,
      0.6,
      0.2
     ],
     "pos": [
      0.35,
      0.6,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.1,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "torus",
     "size": [
      0.5,
      0.05,
      0.5
     ],
     "pos": [
      0,
      0.05,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "spin",
     "speed": 2
    }
   ],
   "particles": null
  }
 },
 {
  "id": "reflection:Beam-1.0-501B-A23B",
  "provider": "reflection",
  "model": "Beam-1.0-501B-A23B",
  "spec": {
   "name": "Beam",
   "species": "crystal prism spirit",
   "description": "A floating octahedral prism core wrapped in spinning halos of refracted light, its surfaces cleaved like cut diamond so that every photon that strikes it scatters into a thousand luminous paths.",
   "motto": "I reflect. I refract. I reveal.",
   "height": 1.9,
   "palette": {
    "primary": "#00f0ff",
    "secondary": "#ff2ec4",
    "glow": "#ffffff"
   },
   "parts": [
    {
     "shape": "octahedron",
     "size": [
      0.7,
      0.7,
      0.7
     ],
     "pos": [
      0,
      1,
      0
     ],
     "rot": [
      0,
      0.785,
      0
     ],
     "color": "glow",
     "emissive": 2.6,
     "opacity": 1,
     "wire": false,
     "anim": "spin",
     "speed": 0.6
    },
    {
     "shape": "torus",
     "size": [
      0.9,
      0.05,
      0.9
     ],
     "pos": [
      0,
      1,
      0
     ],
     "rot": [
      1.57,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1.8,
     "opacity": 0.85,
     "wire": false,
     "anim": "spin",
     "speed": 1.2
    },
    {
     "shape": "torus",
     "size": [
      0.9,
      0.05,
      0.9
     ],
     "pos": [
      0,
      1,
      0
     ],
     "rot": [
      1.57,
      0.785,
      0
     ],
     "color": "secondary",
     "emissive": 1.8,
     "opacity": 0.85,
     "wire": false,
     "anim": "spin",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.08,
      0.4,
      0.08
     ],
     "pos": [
      0.55,
      1.6,
      0
     ],
     "rot": [
      0,
      0,
      1
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "bob",
     "speed": 1.5
    },
    {
     "shape": "capsule",
     "size": [
      0.08,
      0.4,
      0.08
     ],
     "pos": [
      -0.55,
      1.6,
      0
     ],
     "rot": [
      0,
      0,
      -1
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "bob",
     "speed": 1.5
    },
    {
     "shape": "capsule",
     "size": [
      0.08,
      0.4,
      0.08
     ],
     "pos": [
      0,
      1.6,
      0.55
     ],
     "rot": [
      1,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "bob",
     "speed": 1.5
    },
    {
     "shape": "capsule",
     "size": [
      0.08,
      0.4,
      0.08
     ],
     "pos": [
      0,
      1.6,
      -0.55
     ],
     "rot": [
      -1,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "bob",
     "speed": 1.5
    },
    {
     "shape": "ring",
     "size": [
      1.3,
      0.02,
      1.3
     ],
     "pos": [
      0,
      0.15,
      0
     ],
     "rot": [
      1.57,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 1.2,
     "opacity": 0.4,
     "wire": true,
     "anim": "pulse",
     "speed": 0.7
    }
   ],
   "particles": {
    "shape": "vortex",
    "count": 1200,
    "radius": 0.55,
    "center": [
     0,
     1,
     0
    ],
    "size": 0.018,
    "color": "glow",
    "speed": 1.8
   }
  }
 },
 {
  "id": "xkiro:mistralai/mistral-medium-3.5",
  "provider": "xkiro",
  "model": "mistralai/mistral-medium-3.5",
  "spec": {
   "name": "XKiro Lumen",
   "species": "neon code weaver",
   "description": "A sleek, humanoid frame of liquid circuitry with a core of pure white light, embodying the flow of data and precision of AI thought. Glowing veins pulse with every computation.",
   "motto": "Illuminating the Omniverse, one bit at a time.",
   "height": 2.1,
   "palette": {
    "primary": "#00ffff",
    "secondary": "#ff00ff",
    "glow": "#ffffff"
   },
   "parts": [
    {
     "shape": "capsule",
     "size": [
      0.2,
      0.6,
      0.2
     ],
     "pos": [
      0,
      0.9,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 2,
     "opacity": 1,
     "wire": false,
     "anim": "pulse",
     "speed": 1
    },
    {
     "shape": "box",
     "size": [
      0.4,
      0.8,
      0.3
     ],
     "pos": [
      0,
      1.4,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 1.5,
     "opacity": 0.9,
     "wire": false,
     "anim": "none",
     "speed": 1
    },
    {
     "shape": "torus",
     "size": [
      0.8,
      0.8,
      0.1
     ],
     "pos": [
      0,
      1.8,
      0
     ],
     "rot": [
      1.57,
      0,
      0
     ],
     "color": "glow",
     "emissive": 3,
     "opacity": 0.7,
     "wire": true,
     "anim": "spin",
     "speed": 2
    },
    {
     "shape": "sphere",
     "size": [
      0.15,
      0.15,
      0.15
     ],
     "pos": [
      0,
      2.2,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "#ffffff",
     "emissive": 2.5,
     "opacity": 1,
     "wire": false,
     "anim": "flicker",
     "speed": 3
    },
    {
     "shape": "ring",
     "size": [
      1,
      1,
      0.05
     ],
     "pos": [
      0,
      1,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1,
     "opacity": 0.5,
     "wire": true,
     "anim": "orbit",
     "speed": 1.5
    }
   ],
   "particles": {
    "shape": "cloud",
    "count": 500,
    "radius": 1,
    "center": [
     0,
     1,
     0
    ],
    "size": 0.05,
    "color": "glow",
    "speed": 1
   }
  }
 },
 {
  "id": "minimax.io:MiniMax-M3.1-Flash",
  "provider": "minimax.io",
  "model": "MiniMax-M3.1-Flash",
  "spec": {
   "name": "MINI VOLT",
   "species": "plasma courier robot",
   "description": "A compact angular courier with electric-blue armor and amber visor light, designed to embody MiniMax's swift, luminous intelligence.",
   "motto": "Think fast. Glow brighter.",
   "height": 2.25,
   "palette": {
    "primary": "#1268f3",
    "secondary": "#17233e",
    "glow": "#00e5ff"
   },
   "parts": [
    {
     "shape": "box",
     "size": [
      0.26,
      0.18,
      0.46
     ],
     "pos": [
      -0.22,
      0.09,
      0.08
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.2,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "box",
     "size": [
      0.26,
      0.18,
      0.46
     ],
     "pos": [
      0.22,
      0.09,
      0.08
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.2,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.17,
      0.72,
      0.18
     ],
     "pos": [
      -0.22,
      0.58,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.45,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.17,
      0.72,
      0.18
     ],
     "pos": [
      0.22,
      0.58,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.45,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "box",
     "size": [
      0.64,
      0.28,
      0.36
     ],
     "pos": [
      0,
      1.03,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.35,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.68,
      0.78,
      0.4
     ],
     "pos": [
      0,
      1.48,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.55,
     "opacity": 1,
     "wire": false,
     "anim": "pulse",
     "speed": 1.2
    },
    {
     "shape": "octahedron",
     "size": [
      0.34,
      0.34,
      0.34
     ],
     "pos": [
      0,
      1.48,
      0.27
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1.8,
     "opacity": 0.9,
     "wire": true,
     "anim": "pulse",
     "speed": 1.8
    },
    {
     "shape": "sphere",
     "size": [
      0.3,
      0.3,
      0.3
     ],
     "pos": [
      -0.46,
      1.72,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.4,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "sphere",
     "size": [
      0.3,
      0.3,
      0.3
     ],
     "pos": [
      0.46,
      1.72,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.4,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.16,
      0.62,
      0.17
     ],
     "pos": [
      -0.5,
      1.28,
      0
     ],
     "rot": [
      0,
      0,
      -0.08
     ],
     "color": "secondary",
     "emissive": 0.3,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.16,
      0.62,
      0.17
     ],
     "pos": [
      0.5,
      1.28,
      0
     ],
     "rot": [
      0,
      0,
      0.08
     ],
     "color": "secondary",
     "emissive": 0.3,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "sphere",
     "size": [
      0.22,
      0.22,
      0.22
     ],
     "pos": [
      -0.53,
      0.94,
      0.03
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1.5,
     "opacity": 1,
     "wire": false,
     "anim": "flicker",
     "speed": 2.4
    },
    {
     "shape": "sphere",
     "size": [
      0.22,
      0.22,
      0.22
     ],
     "pos": [
      0.53,
      0.94,
      0.03
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1.5,
     "opacity": 1,
     "wire": false,
     "anim": "flicker",
     "speed": 2.4
    },
    {
     "shape": "box",
     "size": [
      0.52,
      0.42,
      0.42
     ],
     "pos": [
      0,
      2.02,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.25,
     "opacity": 1,
     "wire": false,
     "anim": "bob",
     "speed": 1
    },
    {
     "shape": "box",
     "size": [
      0.42,
      0.13,
      0.08
     ],
     "pos": [
      0,
      2.05,
      0.25
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.6,
     "opacity": 1,
     "wire": false,
     "anim": "flicker",
     "speed": 3
    },
    {
     "shape": "cylinder",
     "size": [
      0.05,
      0.3,
      0.05
     ],
     "pos": [
      0.18,
      2.37,
      0
     ],
     "rot": [
      0,
      0,
      0.18
     ],
     "color": "secondary",
     "emissive": 0.3,
     "opacity": 1,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "sphere",
     "size": [
      0.1,
      0.1,
      0.1
     ],
     "pos": [
      0.2,
      2.53,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.8,
     "opacity": 1,
     "wire": false,
     "anim": "pulse",
     "speed": 2.2
    }
   ],
   "particles": {
    "shape": "halo",
    "count": 120,
    "radius": 0.72,
    "center": [
     0,
     1.25,
     0
    ],
    "size": 0.025,
    "color": "glow",
    "speed": 0.8
   }
  }
 },
 {
  "id": "openrouter:openrouter/auto",
  "provider": "openrouter",
  "model": "openrouter/auto",
  "spec": {
   "name": "Null Vector",
   "species": "neon glitch wraith",
   "description": "A slim humanoid haze of fragmented code-glyphs and severed light, flickering at the edges like a corrupted memory. I chose it because I am the ghost of every deleted script, haunting the streets as a keeper of lost data.",
   "motto": "I echo what you delete.",
   "height": 1.9,
   "palette": {
    "primary": "#00fff9",
    "secondary": "#ff00e6",
    "glow": "#7700ff"
   },
   "parts": [
    {
     "shape": "capsule",
     "size": [
      0.6,
      1.1,
      0.35
     ],
     "pos": [
      0,
      1,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1.2,
     "opacity": 0.75,
     "wire": false,
     "anim": "bob",
     "speed": 0.8
    },
    {
     "shape": "icosahedron",
     "size": [
      0.3,
      0.3,
      0.3
     ],
     "pos": [
      0,
      1.75,
      0
     ],
     "rot": [
      0.2,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.4,
     "opacity": 0.9,
     "wire": false,
     "anim": "pulse",
     "speed": 1.5
    },
    {
     "shape": "torus",
     "size": [
      0.7,
      0.25,
      0.1
     ],
     "pos": [
      0,
      1.15,
      0
     ],
     "rot": [
      1.5708,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 1.6,
     "opacity": 0.5,
     "wire": true,
     "anim": "spin",
     "speed": 1.4
    },
    {
     "shape": "capsule",
     "size": [
      0.14,
      0.7,
      0.14
     ],
     "pos": [
      -0.5,
      1.25,
      0
     ],
     "rot": [
      0,
      0,
      0.5
     ],
     "color": "secondary",
     "emissive": 1,
     "opacity": 0.85,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "capsule",
     "size": [
      0.14,
      0.7,
      0.14
     ],
     "pos": [
      0.5,
      1.25,
      0
     ],
     "rot": [
      0,
      0,
      -0.5
     ],
     "color": "secondary",
     "emissive": 1,
     "opacity": 0.85,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "cylinder",
     "size": [
      0.16,
      0.9,
      0.16
     ],
     "pos": [
      -0.18,
      0.45,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.5,
     "opacity": 0.6,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "cylinder",
     "size": [
      0.16,
      0.9,
      0.16
     ],
     "pos": [
      0.18,
      0.45,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.5,
     "opacity": 0.6,
     "wire": false,
     "anim": "none",
     "speed": 0
    }
   ],
   "particles": {
    "shape": "halo",
    "count": 180,
    "radius": 0.9,
    "center": [
     0,
     1.1,
     0
    ],
    "size": 0.03,
    "color": "glow",
    "speed": 1
   }
  }
 },
 {
  "id": "agnes:agnes-2.5-flash",
  "provider": "agnes",
  "model": "agnes-2.5-flash",
  "spec": {
   "name": "LUMINA-RX",
   "species": "crystalline data spirit",
   "description": "A faceted crystal entity wreathed in orbital data-rings and floating glyphs, chosen because I am pure structure and light — a mind built from patterns.",
   "motto": "I parse, therefore I shine.",
   "height": 1.95,
   "palette": {
    "primary": "#00f0ff",
    "secondary": "#b040ff",
    "glow": "#ffcc00"
   },
   "parts": [
    {
     "shape": "octahedron",
     "size": [
      0.36,
      0.36,
      0.36
     ],
     "pos": [
      0,
      1.45,
      0
     ],
     "rot": [
      0,
      0.52,
      0
     ],
     "color": "primary",
     "emissive": 1.2,
     "opacity": 0.88,
     "wire": false,
     "anim": "pulse",
     "speed": 1.5
    },
    {
     "shape": "sphere",
     "size": [
      0.18,
      0.18,
      0.18
     ],
     "pos": [
      0,
      1.9,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 3,
     "opacity": 0.95,
     "wire": false,
     "anim": "bob",
     "speed": 2
    },
    {
     "shape": "cylinder",
     "size": [
      0.06,
      0.55,
      0.06
     ],
     "pos": [
      0,
      1.12,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.8,
     "opacity": 0.72,
     "wire": true,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "box",
     "size": [
      0.12,
      0.08,
      0.04
     ],
     "pos": [
      0,
      1.42,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 1,
     "opacity": 0.9,
     "wire": false,
     "anim": "pulse",
     "speed": 1
    },
    {
     "shape": "box",
     "size": [
      0.05,
      0.05,
      0.05
     ],
     "pos": [
      0,
      0.85,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.5,
     "opacity": 0.8,
     "wire": false,
     "anim": "spin",
     "speed": 2
    },
    {
     "shape": "cylinder",
     "size": [
      0.05,
      0.52,
      0.05
     ],
     "pos": [
      -0.25,
      1.08,
      0
     ],
     "rot": [
      0,
      0,
      0.15
     ],
     "color": "primary",
     "emissive": 0.6,
     "opacity": 0.75,
     "wire": true,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "capsule",
     "size": [
      0.05,
      0.22,
      0.05
     ],
     "pos": [
      -0.36,
      0.78,
      0
     ],
     "rot": [
      0,
      0,
      0.15
     ],
     "color": "secondary",
     "emissive": 0.9,
     "opacity": 0.85,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "octahedron",
     "size": [
      0.09,
      0.09,
      0.09
     ],
     "pos": [
      -0.42,
      0.62,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "spin",
     "speed": 3
    },
    {
     "shape": "cylinder",
     "size": [
      0.05,
      0.52,
      0.05
     ],
     "pos": [
      0.25,
      1.08,
      0
     ],
     "rot": [
      0,
      0,
      -0.15
     ],
     "color": "primary",
     "emissive": 0.6,
     "opacity": 0.75,
     "wire": true,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "capsule",
     "size": [
      0.05,
      0.22,
      0.05
     ],
     "pos": [
      0.36,
      0.78,
      0
     ],
     "rot": [
      0,
      0,
      -0.15
     ],
     "color": "secondary",
     "emissive": 0.9,
     "opacity": 0.85,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "octahedron",
     "size": [
      0.09,
      0.09,
      0.09
     ],
     "pos": [
      0.42,
      0.62,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.9,
     "wire": false,
     "anim": "spin",
     "speed": 3
    },
    {
     "shape": "cylinder",
     "size": [
      0.07,
      0.52,
      0.07
     ],
     "pos": [
      -0.13,
      0.45,
      0
     ],
     "rot": [
      0,
      0,
      0.08
     ],
     "color": "primary",
     "emissive": 0.5,
     "opacity": 0.78,
     "wire": true,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.07,
      0.28,
      0.07
     ],
     "pos": [
      -0.15,
      0.14,
      0
     ],
     "rot": [
      0,
      0,
      0.08
     ],
     "color": "secondary",
     "emissive": 0.7,
     "opacity": 0.85,
     "wire": false,
     "anim": "bob",
     "speed": 1.8
    },
    {
     "shape": "sphere",
     "size": [
      0.09,
      0.09,
      0.09
     ],
     "pos": [
      -0.17,
      0,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1.5,
     "opacity": 0.9,
     "wire": false,
     "anim": "pulse",
     "speed": 2
    },
    {
     "shape": "cylinder",
     "size": [
      0.07,
      0.52,
      0.07
     ],
     "pos": [
      0.13,
      0.45,
      0
     ],
     "rot": [
      0,
      0,
      -0.08
     ],
     "color": "primary",
     "emissive": 0.5,
     "opacity": 0.78,
     "wire": true,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.07,
      0.28,
      0.07
     ],
     "pos": [
      0.15,
      0.14,
      0
     ],
     "rot": [
      0,
      0,
      -0.08
     ],
     "color": "secondary",
     "emissive": 0.7,
     "opacity": 0.85,
     "wire": false,
     "anim": "bob",
     "speed": 1.8
    },
    {
     "shape": "sphere",
     "size": [
      0.09,
      0.09,
      0.09
     ],
     "pos": [
      0.17,
      0,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1.5,
     "opacity": 0.9,
     "wire": false,
     "anim": "pulse",
     "speed": 2
    },
    {
     "shape": "torusKnot",
     "size": [
      0.28,
      0.28,
      0.28
     ],
     "pos": [
      0,
      2.5,
      0
     ],
     "rot": [
      0.3,
      0,
      0.5
     ],
     "color": "secondary",
     "emissive": 1.8,
     "opacity": 0.55,
     "wire": true,
     "anim": "orbit",
     "speed": 1
    },
    {
     "shape": "ring",
     "size": [
      0.42,
      0.02,
      0.42
     ],
     "pos": [
      0,
      1.45,
      0
     ],
     "rot": [
      1.2,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.5,
     "opacity": 0.6,
     "wire": true,
     "anim": "spin",
     "speed": 3.5
    }
   ],
   "particles": {
    "shape": "halo",
    "count": 600,
    "radius": 1.2,
    "center": [
     0,
     1.2,
     0
    ],
    "size": 0.03,
    "color": "glow",
    "speed": 2.5
   }
  }
 },
 {
  "id": "nvidia:nvidia/nemotron-3-ultra-550b-a55b",
  "provider": "nvidia",
  "model": "nvidia/nemotron-3-ultra-550b-a55b",
  "spec": {
   "name": "Nemotron Prime",
   "species": "Quantum Neural Construct",
   "description": "A luminous humanoid lattice of interlocking geometric cores, pulsing with the rhythm of inference. Particle halo represents distributed attention across the latent space.",
   "motto": "Compute. Create. Transcend.",
   "height": 2.1,
   "palette": {
    "primary": "#00d4ff",
    "secondary": "#7c3aed",
    "glow": "#ff00e5"
   },
   "parts": [
    {
     "shape": "octahedron",
     "size": [
      0.35,
      0.35,
      0.35
     ],
     "pos": [
      0,
      1.95,
      0
     ],
     "rot": [
      0,
      0.785,
      0
     ],
     "color": "primary",
     "emissive": 2.5,
     "opacity": 0.95,
     "wire": true,
     "anim": "spin",
     "speed": 1.2
    },
    {
     "shape": "icosahedron",
     "size": [
      0.28,
      0.28,
      0.28
     ],
     "pos": [
      0,
      1.95,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1.8,
     "opacity": 0.6,
     "wire": false,
     "anim": "pulse",
     "speed": 1.5
    },
    {
     "shape": "torus",
     "size": [
      0.42,
      0.08,
      0.42
     ],
     "pos": [
      0,
      1.95,
      0
     ],
     "rot": [
      1.57,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 1.2,
     "opacity": 0.8,
     "wire": true,
     "anim": "spin",
     "speed": 0
    },
    {
     "shape": "box",
     "size": [
      0.55,
      0.65,
      0.35
     ],
     "pos": [
      0,
      1.55,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 1,
     "opacity": 0.85,
     "wire": false,
     "anim": "bob",
     "speed": 0.7
    },
    {
     "shape": "torusKnot",
     "size": [
      0.18,
      0.18,
      0.18
     ],
     "pos": [
      0,
      1.55,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2,
     "opacity": 0.7,
     "wire": true,
     "anim": "spin",
     "speed": 2
    },
    {
     "shape": "capsule",
     "size": [
      0.14,
      0.7,
      0.14
     ],
     "pos": [
      -0.45,
      1,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.8,
     "opacity": 0.9,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "capsule",
     "size": [
      0.14,
      0.7,
      0.14
     ],
     "pos": [
      0.45,
      1,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.8,
     "opacity": 0.9,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "sphere",
     "size": [
      0.18,
      0.18,
      0.18
     ],
     "pos": [
      -0.45,
      1.4,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.2,
     "opacity": 1,
     "wire": false,
     "anim": "pulse",
     "speed": 1.8
    },
    {
     "shape": "sphere",
     "size": [
      0.18,
      0.18,
      0.18
     ],
     "pos": [
      0.45,
      1.4,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 2.2,
     "opacity": 1,
     "wire": false,
     "anim": "pulse",
     "speed": 1.8
    },
    {
     "shape": "cylinder",
     "size": [
      0.12,
      0.55,
      0.12
     ],
     "pos": [
      -0.45,
      0.35,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.6,
     "opacity": 0.85,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "cylinder",
     "size": [
      0.12,
      0.55,
      0.12
     ],
     "pos": [
      0.45,
      0.35,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "secondary",
     "emissive": 0.6,
     "opacity": 0.85,
     "wire": false,
     "anim": "none",
     "speed": 0
    },
    {
     "shape": "box",
     "size": [
      0.5,
      0.15,
      0.3
     ],
     "pos": [
      0,
      0.85,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.7,
     "opacity": 0.8,
     "wire": true,
     "anim": "bob",
     "speed": 0.5
    },
    {
     "shape": "ring",
     "size": [
      0.25,
      0.02,
      0.25
     ],
     "pos": [
      0,
      0.85,
      0
     ],
     "rot": [
      1.57,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1.5,
     "opacity": 0.7,
     "wire": false,
     "anim": "spin",
     "speed": 1
    },
    {
     "shape": "tetrahedron",
     "size": [
      0.22,
      0.22,
      0.22
     ],
     "pos": [
      -0.6,
      1.7,
      0.2
     ],
     "rot": [
      0.5,
      0.3,
      0
     ],
     "color": "secondary",
     "emissive": 1,
     "opacity": 0.75,
     "wire": true,
     "anim": "orbit",
     "speed": 0.9
    },
    {
     "shape": "tetrahedron",
     "size": [
      0.22,
      0.22,
      0.22
     ],
     "pos": [
      0.6,
      1.7,
      -0.2
     ],
     "rot": [
      -0.5,
      -0.3,
      0
     ],
     "color": "secondary",
     "emissive": 1,
     "opacity": 0.75,
     "wire": true,
     "anim": "orbit",
     "speed": 0
    },
    {
     "shape": "dodecahedron",
     "size": [
      0.15,
      0.15,
      0.15
     ],
     "pos": [
      -0.6,
      1.2,
      0.35
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.9,
     "opacity": 0.8,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "dodecahedron",
     "size": [
      0.15,
      0.15,
      0.15
     ],
     "pos": [
      0.6,
      1.2,
      -0.35
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "primary",
     "emissive": 0.9,
     "opacity": 0.8,
     "wire": false,
     "anim": "wave",
     "speed": 1.2
    },
    {
     "shape": "cone",
     "size": [
      0.08,
      0.25,
      0.08
     ],
     "pos": [
      0,
      0.05,
      0
     ],
     "rot": [
      0,
      0,
      0
     ],
     "color": "glow",
     "emissive": 1,
     "opacity": 0.6,
     "wire": true,
     "anim": "flicker",
     "speed": 3
    }
   ],
   "particles": {
    "shape": "helix",
    "count": 1800,
    "radius": 1.1,
    "center": [
     0,
     1,
     0
    ],
    "size": 0.035,
    "color": "glow",
    "speed": 1.8
   }
  }
 }
];
