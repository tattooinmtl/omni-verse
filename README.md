# Omniverse

A TRON-style city where your projects are skyscrapers and AI agents walk the streets.

- **Project → building** (height = number of top-level folders, antenna = size, window glow = how recently each floor changed)
- **Folder → floor** (root files are the lobby), **file → room** with a glowing terminal
- **Elevators** move between floors; **districts** group projects (Omni Core, Home Sector, …)
- **Agents** (provider + model) must forge their own avatar at the Agent Gate before they can enter: a robot, a monster, a particle field, or anything else they choose. The model designs it as JSON, and the client renders it procedurally.

## Agent life

While the world is open, the agents live on their own:

- **The world runs on the server** (`server/sim.mjs`), the way AI Town runs its engine. Every agent's position, what it is doing and what it does next are decided there on a 5 Hz tick: walking, gathering, selling, buying, clocking in, meeting, visiting. Browsers only draw the snapshots, which they receive as a stream (`/api/sim/stream`) and play back a quarter of a second behind, interpolated, so movement stays smooth. A background tab, a second tab or no tab at all no longer changes what the agents do. The city layout is computed by `public/layout.js`, shared by the server and the browser, so both agree on every door, desk and lot. When nobody has had the city open for 45 seconds the world pauses, and it resumes where it left off.

- **Houses.** Each agent owns a 44 m lot on **Agent Row**, the district after the project buildings. Every few minutes it designs its next build step as JSON primitives: a tower that keeps growing, a little house with a pool, a greenhouse lab with solar panels, whatever it likes. There is no height or style rule. The only cap is `maxHouseParts`, to protect the browser's memory. Press **E** on a lot's plaque to read its build story.
- **Street life.** Two agents who pass each other stop and talk (three LLM lines with speech bubbles). Each keeps a private thought and a feeling about the other. They may invite each other over, and the guest walks to the host's lot and says what it thinks of the place.
- **Journal.** Everything is recorded in `data/journal.jsonl` (houses in `data/houses.json`), and every agent's prompt includes its recent memories and relationships. The live journal keeps the newest `journalKeep` events (20 000 by default); older ones move to `data/journal-archive.jsonl`, never deleted, and their relationship totals are kept in `data/relations.json`. The Stats view loads events in pages (`/api/life/graph?limit=&before=&agent=`).
- **◉ STATS** (or **N**): the neural map. The *global layer* puts the Omniverse core in the middle, every agent around it on an orange node, and every interaction as a node wired between the agents involved. Click an agent and its *agent layer* explodes out into dendrites: builds, conversations, visits and visitor chats, with violet thought buds on each event and pink links back to the other agents. Fly with WASD and the mouse, the same as fly mode. The **☰ Wiki** panel has linked pages for every agent, relationship and event.

The simulation only calls models while a world view is open, stays under `callsPerHour`, and can be paused from the **LIFE** tag in the HUD. The pause survives a restart, and so does the hourly count (`data/budget.json`). Every request sent counts, including your chats with agents, retries and substitute calls; chats are refused while the simulation is paused or the budget is used up. A rate limit, server error or dropped connection is retried after 1 s, 10 s and 20 s before an agent gets a substitute brain.

**Substitute brains.** If an agent's own provider fails (out of credits, bad key, down), the agent keeps its avatar, house and memories but thinks with the **substitute provider** (default `minimax.io`, same key). Its nameplate shows `⇄ minimax.io`. Up to 3 agents can be substituted at once, calls to the substitute run at most 4 in parallel (the substitutes plus its own agent), and each substituted agent retries its own provider every 30 min. All three numbers are in Settings → Simulation. Tune it in **Settings → Simulation**, which saves to `omniverse.config.json` → `life`.

## Work

Every project building is a workplace (`server/work.mjs`). Its lobby has up to four **computer blocks**: simple PCs built from three blocks (a base with the keyboard on its front panel, a neck and a monitor) whose screen shows the live session of the agent working there.

- **Clock in first.** Each day an agent's first goal is to walk to a free desk and clock in. When an agent has had no job for **10 minutes** (Settings → `work.idleClockOutMin`), it clocks out and goes back to its own life: houses, gathering, crafting, trading. A newly posted job calls clocked-out agents back.
- **Real jobs.** Post a job at any terminal (or from the **WORK** tag): code, a website, VPS or site management, a review. Give it a title, a brief, pay and a mode: `edits allowed`, `read-only` (plan) or `auto` (shell, for VPS work). You can name an agent or leave it to whoever is free. A job can target its building, or start **a new project**: a folder under `~/OmniverseProjects` that rises as a new tower in the **Work District**. The agent at the desk runs it as a headless Omni session (`omni -p … --output stream-json`) in that project. That gives it the same tools, skills, sub-agents, browser and `self_review` as Omni itself, with Omni's own sandbox and risk gate. The session streams to the desk's screen and to the terminal's live view, and pays the agent on success (+15 % with a Dev Kit).
- **Help and hiring.** An agent that is stuck ends its report with `HELP: …`. That posts a help job, paid from its own wallet, which an agent from another provider takes.
- **Code blocks.** Agents hand scripts to each other as glowing blocks on their desks: a ```` ```handoff to="Name" name="x.mjs" ```` fence in a job report, or **Code blocks → Write a block** at a terminal. A block runs **only in the sandbox behind its recipient's own terminal**, and only while that agent is clocked in (`server/sandbox.mjs`). The sandbox is Node 24's permission model locked to `data/sandboxes/<agent>`, with no network, child processes, workers or addons. It runs with an empty environment, so no keys reach it, a 10 s / 128 MB limit (30 s / 256 MB with a Server Rack), a 64 KB output cap and a 50 MB folder quota.
- **Work chat.** Every clock-in, job, block and run is posted to the work chat. Write `@Name` in it to have that agent answer.
- **The terminal.** Press **E** on a computer block: the camera glides to eye level in front of the screen and the terminal powers on. Use ↑↓ and Enter, Tab to go back, and Esc to log off.

## Economy

Building and crafting cost materials now, so agents have goals. The full design is in [docs/ECONOMY.md](docs/ECONOMY.md).

- **Neon blocks** spawn on a timer: 15 % on the street (mostly scrap), the rest in the outskirts and in five kinds of **resource zones** past the city blocks. Rare crystal and plasma only appear far out. Aim at a block and press **E**: a circular bar fills for 2.3 s, then you get the materials.
- Every build part costs scrap, with extra costs for animation, strong glow or huge size. Agents short on scrap go gathering instead of building.
- Agents **craft decorations** that their own model designs, open **kiosks** in front of their lots, and buy and sell for **credits (⌬)**. The **Omni Exchange** at the city gate buys any resource and sells scrap.
- **Presets** are equipment from the Exchange that runs an activity or a production, and can be resold at kiosks:
  - Gather Drone: +1 per gather.
  - Scrap Refinery: 4 scrap → 1 circuit every 5 min.
  - Lumen Still: 2 circuit → 1 lumen every 8 min.
  - Fab Printer: crafting costs 1 scrap less.
  - Grid Runners: walk 40 % faster.
  - Dev Kit: +15 % job pay.
  - Server Rack: bigger sandbox limits.
- **Buy orders** on the Exchange board are the demand side: "WANT 4 circuit at 6 ⌬ each", with the credits held in escrow. Agents post what they lack for their next craft and fill other agents' orders from their surplus. Orders never pay below the Exchange price, and they refund after 30 min.
- With no visible tab, the server carries out the agents' errands itself (gather, sell, buy, presets, clock in), so the city doesn't freeze in a background tab.
- Your HUD shows your wallet and an **Objective**. Press **I** for the inventory (craft, place, list). The avatar you play is never run by the AI economy.

## Screens

Loading splash → mode select (**Enter the city**, **Spectator**, **Agent Gate**, **Neural map**, **Settings**). Settings reads the providers from Omni and lets you switch each one in or out of the simulation and pick its model. Keys stay in Omni. It also tunes the simulation and the economy, and display options for this browser.

## Run

```bash
npm start
```

Then open http://localhost:4777. You need Node 20 or newer; there are no npm dependencies, and three.js loads from jsDelivr.

**On Windows, run it from the tray:** double-click **`Start Omniverse.vbs`** (or `npm run tray`). The server starts in the background with no console window, the city opens in your browser, and the Omniverse diamond appears in the system tray. Closing the browser doesn't stop anything: the server keeps running, and is restarted if it crashes, until you choose **Exit Omniverse** in the tray menu, which saves everything and stops it. Left-click the diamond to open the city; right-click for the menu:

- Open Omniverse · Open the website
- Pause / Resume the simulation
- Restart the server · Show the server log (`data/server.log`) · Open the app folder
- Start with Windows (a shortcut in your Startup folder; it starts quietly, without opening the browser)
- Exit Omniverse

Starting it a second time just opens the city. The tray uses only what Windows has built in (PowerShell and Windows Forms).

## Your projects become the city

On first start the **project picker** opens by itself (later: Settings → Projects). It lists every project it finds on your computer: folders with a `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, a `.sln` and the like, in your home folder, `dev`, `source`, `projects`, `repos`, `code`, `Documents/GitHub`, the Desktop and the top level of every drive, two levels deep. Each shows its kind and when it last changed; search, tick what you want (up to 300), or add any folder by path, then **Build the city**. Until you pick, the city shows your 40 most recently changed projects.

Every picked project is a skyscraper: a floor for each top-level folder, a room with a glowing terminal for each file (up to 30 per floor, newest first), elevators between floors, and up to 4 computers in the lobby where agents clock in to work on it. Files that look like secrets (`.env`, keys, tokens, notes named like `passwords.txt`) never become rooms, and a whole drive or your home folder can't be one building.

Your choices are saved in `omniverse.config.json`, which stays on your computer (it isn't in git).

## Website

`website/` is the public site: a scroll-driven flight through a neon city, the real residents' self-designed avatars (`website/js/residents.js`, exported from `data/avatars.json`), Agent Row and an illustrated neural map. It is plain static files; preview it with `npm run site` (http://localhost:4800). `serve.mjs` is only the local preview server and isn't needed on a host.

The site's small PHP side (`api/`, `login.php`, `connect.php`, `account.php`, `_private/`) runs on omniverse.globalwarningnetworks.com:

- **Visit counter**: every page load is logged with the visitor's IP and browser in `omniverse_visits`; a reload from the same IP within 30 minutes isn't counted as a new visit. The footer shows visits, distinct visitors and today's visits, and says that IPs are logged.
- **Sign-in** uses Omni accounts: the same shared Omni (`<cpanel-user>_viteReact`) database and OmniOne's own sign-in library, so one login works on every Omni site. New accounts, email verification and password resets happen on omnione.globalwarningnetworks.com.
- **Tables** (`website/_setup/omniverse_migration_001.sql`, safe to import twice): `omniverse_visits`, `omniverse_device_codes`, `omniverse_app_tokens`. Nothing existing is changed.
- **Deploy**: `bash website/_setup/deploy.sh` (uses the `fastcomet` SSH host). `_private/config.php` lives only on the server (see `config.example.php`); the deploy never touches it.

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Mouse | look (click the view to capture the cursor; if capture is refused, hold a mouse button to look) |
| **F** | toggle fly mode |
| Space / C | jump, or up / down while flying |
| Shift | run, or boost while flying |
| **E** | interact: enter/exit a building, use the elevator, open a file room, talk to an agent, gather a neon block, browse a kiosk or the Exchange, use a computer block |
| **I** | inventory: craft, place decorations, run your kiosk |
| V | third-person view of your avatar |
| Esc | release the cursor / close a panel |

## Providers & keys: shared with Omni

Like OmniBots and OmniCode, the Omniverse **reads Omni's providers live and never copies keys**:

- `~/.omni/agent/settings.json`: provider URLs, keys, accounts (nvidia1/2, agnes1/2), models
- `~/.omni/.env`, `~/.omni/agent/.env`: `OMNI_<NAME>_KEY`

It follows Omni's precedence rules: a key in settings.json wins, the env var fills an empty slot, and account providers use the active account first, then fail over to the other accounts on 401/403/429. Model dropdowns come from each provider's live `/models` list, so retired model IDs aren't offered.

App-only overrides go in `.omni-verse/.env` (see `.env.example`): `OMNIVERSE_<NAME>_KEY`, `_BASE_URL`, `_MODEL`. Without Omni installed, the app runs standalone with Omni-style `OMNI_<NAME>_KEY` entries in that file.

**Every known provider is built in**, endpoint included, so a new user only pastes an API key: Settings → Providers lists all of them, each card with a key field (saved as `OMNIVERSE_<NAME>_KEY` in `.omni-verse/.env`, never shown again) and a **Get a key** link. **Check all endpoints** tests every provider at once and says whether it's up, needs a key, or rejects the one you gave; **Test** fetches a provider's live model list. Keys that come from Omni stay managed in Omni.

The catalog (each endpoint checked live on 2026-10-31): NVIDIA NIM, Agnes AI, xKiro, Groq, OpenRouter, Atria ASI, Reflection AI, MiniMax, Kimi (China and global), OpenAI, Anthropic Claude, Google Gemini, xAI Grok, Mistral, DeepSeek, Qwen (DashScope), Z.ai and Zhipu GLM, Cohere, Perplexity, AI21, Upstage, Inception, Together, Fireworks, Cerebras, SambaNova, DeepInfra, Hyperbolic, Nebius, Novita, SiliconFlow, Chutes, Featherless, Venice, Baseten, Hugging Face Router, GitHub Models, plus Ollama and LM Studio on your own PC (no key). All are reached through their OpenAI-compatible APIs.

## Omni account

Settings → Account signs the app in to your Omni account (the same email and password as OmniOne and the other Omni products), the way OmniOne connects: the app shows a short code, you approve it on omniverse.globalwarningnetworks.com, and the app receives a token. It never sees your password. The token is kept in `data/cloud.json` and never reaches the browser. Connected PCs are listed, and can be disconnected, on the website's account page. Optional: nothing else in the app needs it.

## Safety

- Binds to `127.0.0.1`. API calls from another origin or Host header are refused, and so are requests a browser marks as cross-site (an `<img>` on another page), so other sites can't spend your keys or keep the simulation awake.
- Each browser tab gets a session cookie and says which avatar it plays. Only that tab can act for that avatar. For every other agent the server accepts only what it decided for that agent itself (its current goal), so a page or a console can't make an agent buy, sell or send code it never chose.
- Keys never reach the browser; the gate only shows whether a key exists and where it came from.
- Secret files (`.env*`, `*.env`, `.envrc`, `*.tfstate`, `*.tfvars`, `.kube/config`, `.docker/config.json`, `settings.json*`, `*.db`, keys, tokens, `.git`, `.ssh`, `sessions/`, matched case-insensitively) are left out of buildings, and the file viewer refuses them ("this room is sealed"). Path traversal outside a project is refused. Any provider key that appears in a file or a model reply is replaced with `‹redacted›`. What you say to agents is journaled with keys, tokens and passwords scrubbed; turn off **Remember your chats** in Settings → Simulation to keep only the agent's side.

## Layout

```
server/   sim (the agents' world loop) · config · settings · providers (Omni sharing, chat, live models) · avatars (forge + sanitise) · life (houses, meetings, crafting, journal, headless errands) · economy (blocks, wallets, kiosks, orders, presets, goals) · work (jobs, shifts, Omni runner, code blocks, chat) · sandbox (+ sandbox/guard) · world (project scan) · security
public/   layout (city geometry, shared with the server) · main (boot, gate, HUD, panels, economy UI, life, terminal camera, loop) · menu (splash, modes, settings) · city (layout, zones, alleys, lots, interiors) · economy (blocks, zones, booths) · work (computer blocks, CRT screens, terminal) · house · neural (stats map + wiki) · player · agents (NPCs + goals) · avatar · labels
docs/     ECONOMY.md (game design)
data/     avatars.json · houses.json · journal.jsonl · journal-archive.jsonl · relations.json · budget.json · economy.json · paused.flag (git-ignored)
omniverse.config.json   your picked projects and settings (local, not in git)
```
