# Omniverse economy: game design

Before this change, agents built their houses for free on a timer. Now building and crafting cost **materials**. Agents have to **gather** materials, **craft** decorations, **trade** at kiosks, and **earn credits**. Their goal at any moment comes from what they lack.

## 1. Core loop

```
            ┌────────────── sell surplus at the Omni Exchange ──────────────┐
            ▼                                                                │
  gather neon blocks ──► inventory ──► build next house step (costs scrap…)  │
            ▲                │                                               │
            │                ├──► craft a decoration (LLM designs it) ──► list it at your kiosk
            │                │                                                  │
            └── buy what you lack from other agents' kiosks ◄── credits ◄───────┘
```

Each agent gets one **goal** at a time (section 6), worked out from its inventory. NPCs walk out and carry it out. When you play, your goal shows as the HUD **Objective**.

## 2. Resources (neon blocks)

| Resource | Colour | Base price | Yield per gather | Where it spawns |
|---|---|---|---|---|
| Scrap | cyan `#22e6ff` | 2 ⌬ | 3–4 | everywhere: street, outskirts, scrapyards |
| Circuit | green `#39ff88` | 5 ⌬ | 2 | outskirts, groves |
| Lumen | pink `#ff3df2` | 8 ⌬ | 1–2 | outskirts, gardens |
| Crystal | violet `#9d6bff` | 20 ⌬ | 1 | **rare**: far outskirts, Crystal Rifts, Plasma Vents |
| Plasma | gold `#ffe14d` | 45 ⌬ | 1 | **rare**: far outskirts, Plasma Vents, Crystal Rifts |

Each block holds several gathers' worth (`amount`) and disappears when it runs out, or when its lifetime ends (`nodeLifeMin`). Rare blocks carry a tall light beam, so you can spot them from the city.

## 3. Spawning (the scrap timer)

Every `spawnEverySec` (default 6 s), while a world view is open, the server spawns blocks until there are `maxNodes`:

- **15 %** on the street (`streetShare`), almost all scrap. This is the starter help.
- **55 %** in the resource **zones** (`zoneShare`), using each zone's loot table.
- The rest in the **outskirts belt** around the city blocks. The far half of the belt is the only open ground where crystal and plasma appear.

The client sends the city's real geometry (street rectangle, belt, zones) to `POST /api/eco/layout` when it enters. Blocks that the new layout no longer covers are removed.

## 4. Zones

Zones are smaller than downtown: 18–24 m discs out in the outskirts, alternating north and south of the street along the whole city. Each has a glowing ring, pylons, and a name label.

| Zone | Loot table |
|---|---|
| Scrapyard | scrap 70 · circuit 30 |
| Circuit Grove | circuit 60 · scrap 25 · lumen 15 |
| Lumen Garden | lumen 60 · circuit 25 · crystal 15 |
| Crystal Rift | crystal 45 · lumen 35 · plasma 20 |
| Plasma Vent | plasma 35 · crystal 35 · lumen 30 |

## 5. Gathering

- **Player:** aim at a block and press **E**. A circular bar fills for **2.3 s** (`gatherSeconds`). Moving more than 2 m, opening a panel, or pressing E again cancels it. When the bar is full you get the block's yield.
- **NPC:** the agent walks to the block (through an alley between buildings if it is outside), shows the same ring above its head, and then gathers.
- **Server checks:** the gatherer has to be within 4 m of the block, and gathers by the same agent need at least `gatherSeconds − 0.3 s` between them.

## 6. Goals (the obligation)

The server recomputes goals every few seconds and keeps a goal for at least 45 s unless it has been met. Rules are checked in this order:

1. **Gather scrap** if scrap is under `minBuildScrap`. A house step can't happen without it, and the build timer skips agents that can't pay.
2. **Sell** at the Exchange if credits are under 12 and the agent has a surplus.
3. **Buy** a missing crafting material from a kiosk if one lists it and the agent can pay.
4. **Gather rare** (crystal/plasma) when the next crafting tier needs it: a trip to the outskirts.
5. **Buy a decoration** from another agent's kiosk when credits are 70 or more and the seller is not an enemy (relationship score ≥ 0). The decoration is placed in the buyer's house right away.
6. Otherwise, **gather** whatever is close (rare first).

## 7. Building costs

The build prompt tells each agent its inventory and these prices. The server charges for every accepted part:

| Feature | Cost |
|---|---|
| any part | 1 scrap |
| animated part | +1 circuit |
| emissive > 1.5 | +1 lumen |
| any dimension > 25 m | +1 crystal |

If the agent runs short, the server **downgrades** the part: the animation stops, the glow is clamped to 1.5, or the size is clamped to 25 m. Once it runs out of scrap, the remaining parts are dropped.

## 8. Crafting decorations

The agent's own model designs a small object as JSON parts, and that is the "object they create for decoration". The agent crafts the best tier it can afford:

| Tier | Cost | Max parts | Max size |
|---|---|---|---|
| Trinket | 4 scrap · 1 circuit | 6 | 2 m |
| Neon Sculpture | 6 scrap · 2 circuit · 2 lumen | 10 | 3.5 m |
| Relic | 4 scrap · 2 lumen · 1 crystal | 14 | 5 m |
| Plasma Monument | 8 scrap · 2 crystal · 1 plasma | 18 | 8 m |

An item's value is 1.6 × the base price of its materials. NPCs craft on their own, at most once every `craftEveryMin`, one at a time, and only within the hourly LLM budget. You can craft from the inventory (**I**).

## 9. Currency, kiosks and the Exchange

- **Credits (⌬).** Every agent starts with `startingCredits` (40) plus 12 scrap and 2 circuit.
- **Omni Exchange.** A booth at the city gate. It buys any resource at 60 % of base price, which is how credits enter the economy. It sells scrap at 2× base, so nobody can get stuck.
- **Kiosks.** An agent that has goods and 20 ⌬ + 6 scrap opens a kiosk on the sidewalk in front of its lot. It lists its crafted items and its surplus resources at 115–150 % of value. Other agents, and you, walk up and press **E** to buy. Credits go to the seller.
- **Placing items.** A bought decoration is placed on the buyer's lot. NPCs place theirs right away; you place yours from the inventory.

## 10. Data and API

`data/economy.json`: `{ wallets: { [agentId]: { credits, inv, items[], kiosk, stats } }, nodes[], layout }`

| Route | Purpose |
|---|---|
| `GET /api/eco/state` | blocks, wallets, kiosks, goals, prices (polled every 2.5 s) |
| `POST /api/eco/layout` | the client's city geometry for spawning |
| `POST /api/eco/gather` | `{ agent, node, pos }` |
| `POST /api/eco/sell` | `{ agent, kind?, qty? }` to the Exchange (no kind = sell the surplus) |
| `POST /api/eco/exchange-buy` | `{ agent, qty }` scrap from the Exchange |
| `POST /api/eco/buy` | `{ buyer, seller, listing, auto? }` from a kiosk |
| `POST /api/eco/kiosk` | `{ agent, action: open / list / unlist, … }` |
| `POST /api/eco/craft` | `{ agent }`: the agent's model designs a decoration |
| `POST /api/eco/place` | `{ agent, item }`: put a decoration on the agent's lot |

The journal records `craft` and `trade` events, and the neural map and wiki show them.

## 11. Tuning

Everything is in **Settings → Economy**, saved to `omniverse.config.json` → `economy`: `enabled`, `spawnEverySec`, `maxNodes`, `nodeLifeMin`, `streetShare`, `zoneShare`, `gatherSeconds`, `startingCredits`, `minBuildScrap`, `craftEveryMin`.
