# Credd Bot — Project Notes

Discord RPG bot (The Last Believer), discord.js v14 + PostgreSQL, prefix commands (`crd …`).
Source of truth for game rules: `CREDD_Master_Export_v4.md` (§35 authoritative) +
`CREDD_Technical_Blueprint_v4.md` + `credd_schema_v4.sql`.

## UI design standard — Components V2 container pattern

Inventory/list-style commands (`crd bag`, `crd bag chests`, `crd bag weapons`, summon results)
use **Components V2 containers** (`ContainerBuilder`, requires discord.js ≥14.19 and
`flags: MessageFlags.IsComponentsV2` on the payload), not classic embeds. The standard layout:

```
container: header ("## Title" + "-#" subtext)
  → separator (Small, divider)
  → body (rows / media gallery; lists paginate at 10 rows per page)
  → separator
  → help footer ("-# 💡 `crd …` hints")
  → separator
  → action row (Prev/Next buttons) — only where paginated
```

Conventions:
- Pagination state lives **in the button customId** (`weapons:<prev|next>:<ownerId>:<page>`, 0-based)
  and every button handler **owner-checks** (`interaction.user.id !== ownerId` → ephemeral reject).
- Item icons come from custom emojis via `src/utils/emojis.js`, which parses the registry
  `game_items.txt` at the project root (Display Name | 'emoji_name' | 'emoji_id'). Use
  `emojiForDisplay(name, fallback)` for display-name lookups; always pass a unicode fallback.
- Reference implementations: `src/commands/rpg/bag.js` (weapons page),
  `src/engine/bagViews.js` (overview + boxed chest rows with button accessories),
  `src/engine/renderSummon.js` (canvas grid + two-phase reveal).
- New list/inventory commands should follow this pattern.
