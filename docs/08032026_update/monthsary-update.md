# Monthsary Update — Planning Brief

**Purpose of this document:** a planning brief to hand to Claude Code (or Codex). It contains the requirements and the decisions already made. It is **not** an implementation plan.

**Instructions to the agent reading this:**

1. Read the repository first. Do not write code yet.
2. For each section below, locate the relevant files, schema, and existing patterns.
3. Answer every item under "Open questions — resolve from repo" using what you find.
4. Produce a detailed, file-by-file implementation plan with migration SQL, then stop for review.

**Stack:** Postgres via Supabase. Discord bot.

**Scope:** six updates (A–F). A, C, and F are fully independent. B, D, and E are linked: the Custom Avatar Token is sold in the shop (B), the Custom Deity Token ships with the Eternal Believer package (D), and both redeem into the shared ticket queue (E).

**A and F are the two large ones.** A moves equipped gear out of `user_characters` and requires a full read-path sweep. F touches every cosmetic skin. Both need their scope enumerated from the repo before any code is written.

**This is the permanent update.** Everything here ships to `main` and stays forever.

The **Monthsary Event** is a *separate, temporary* plan in its own document (`monthsary-event.md`). It is built on top of this update and is later removed by a git rollback. **Do not plan or implement any event content from this document.** If something here seems to reference a 7-day event, ignore it — this document is permanent-only.

---

## A. Character Presets

**This is the largest and highest-risk section in this document.** It moves equipped gear out of `user_characters` entirely. Plan it first and review it carefully.

### Context

`user_characters` currently holds the live equipped state:

| current column | meaning |
|---|---|
| `active_deity_id` | deity slot 1 |
| `active_deity_id_2` | deity slot 2 |
| `active_deity_id_3` | deity slot 3 |
| `equipped_armor_id` | armor |
| `equipped_weapon` | weapon |

### Target architecture

**`user_presets` becomes the single source of truth for deities and equipment.** `user_characters` no longer stores gear at all.

| table | owns |
|---|---|
| `user_presets` | 3 deity slots + armor + weapon, per preset |
| `user_characters` | everything else, including `combat_level`, plus a pointer to the active preset |

`user_characters.combat_level` stays where it is. Stat scaling continues to read `combat_level` from `user_characters` and now reads gear from `user_presets` — so **every stat computation becomes a join** instead of a single-row read.

### Decisions already made

- **Two presets per user**: slot 1 (Main) and slot 2.
- **Every registered user gets both rows created during migration.** Not lazy — the active pointer must always resolve to a real row.
- Slot 1 is backfilled from the user's current equipment. Slot 2 starts empty (all NULL).
- **Lookup key is always `(discord_id, slot)`.** The `id` primary key is internal plumbing — never queried by, never stored as a pointer.
- The pointer stores the **slot number (1 or 2)**, not a preset `id`. This makes pointing at another user's preset structurally impossible and needs no composite foreign key.
- **The old `active_deity_id` / `equipped_weapon` columns are dropped from `user_characters`.** They are not renamed there — the clean names are introduced on `user_presets` instead, so the previously-planned rename migration on `user_characters` is no longer needed.

### A1 — New table

```sql
create table user_presets (
  id                  bigserial primary key,   -- internal only, never queried by
  discord_id          text not null,           -- match user_characters.discord_id type
  slot                smallint not null check (slot in (1, 2)),
  name                varchar(32),
  equipped_deity_1_id <fk> references <deities table>(id) on delete set null,
  equipped_deity_2_id <fk> references <deities table>(id) on delete set null,
  equipped_deity_3_id <fk> references <deities table>(id) on delete set null,
  equipped_armor_id   <fk> references <armor table>(id)   on delete set null,
  equipped_weapon_id  <fk> references <weapon table>(id)  on delete set null,
  updated_at          timestamptz not null default now(),
  unique (discord_id, slot)
);

create index on user_presets (discord_id);

alter table user_presets enable row level security;
-- No policies. The bot uses service_role, which bypasses RLS.
-- Without this line the table is exposed through the anon key via PostgREST.
```

`on delete set null` lets presets self-heal when an item or deity is deleted, instead of dangling.

### A2 — Pointer column

```sql
alter table user_characters
  add column active_preset_slot smallint not null default 1
  check (active_preset_slot in (1, 2));
```

Naming note: this was described as "the `preset` column". `active_preset_slot` is proposed for clarity — confirm or rename.

Canonical lookup for a user's live gear:

```sql
select p.*
from user_characters c
join user_presets p
  on p.discord_id = c.discord_id
 and p.slot = c.active_preset_slot
where c.discord_id = $1;
```

### A3 — Migration, in strict order

**Do not deviate from this order, and do not combine steps 5 into the same deploy as steps 1–4.**

**Step 1 — create `user_presets`** (A1) and **add the pointer column** (A2).

**Step 2 — backfill slot 1 from current equipment:**

```sql
insert into user_presets (discord_id, slot, name,
       equipped_deity_1_id, equipped_deity_2_id, equipped_deity_3_id,
       equipped_armor_id, equipped_weapon_id)
select discord_id, 1, 'Main',
       active_deity_id, active_deity_id_2, active_deity_id_3,
       equipped_armor_id, equipped_weapon
from user_characters
on conflict (discord_id, slot) do nothing;
```

**Step 3 — create empty slot 2:**

```sql
insert into user_presets (discord_id, slot, name)
select discord_id, 2, 'Preset 2'
from user_characters
on conflict (discord_id, slot) do nothing;
```

`on conflict do nothing` makes both inserts idempotent. Include it — these will be run twice by accident.

**Step 4 — verify the backfill before touching the old columns:**

```sql
-- must return 0
select count(*) from user_characters c
left join user_presets p
  on p.discord_id = c.discord_id and p.slot = 1
where p.id is null;

-- must return 0
select count(*) from user_characters c
join user_presets p on p.discord_id = c.discord_id and p.slot = 1
where p.equipped_deity_1_id is distinct from c.active_deity_id
   or p.equipped_deity_2_id is distinct from c.active_deity_id_2
   or p.equipped_deity_3_id is distinct from c.active_deity_id_3
   or p.equipped_armor_id   is distinct from c.equipped_armor_id
   or p.equipped_weapon_id  is distinct from c.equipped_weapon;
```

Ship the code sweep (A4) at this point, while the old columns still exist as a safety net.

**Step 5 — drop the old columns, in a LATER migration:**

```sql
alter table user_characters
  drop column active_deity_id,
  drop column active_deity_id_2,
  drop column active_deity_id_3,
  drop column equipped_armor_id,
  drop column equipped_weapon;
```

**This step must not ship in the same deploy as steps 1–4.** Dropping a column is irreversible — the data is gone, and no code rollback brings it back. Let the new system run in production for several days first, confirm nothing reads the old columns, then drop.

If a phased drop is not acceptable, the fallback is to rename them to `deprecated_*` in the first deploy and drop them later. Either way, **do not create and destroy in one step.**

### A4 — Code sweep

This is the bulk of the work. Every read of equipped gear must now resolve through the active preset.

Expect to touch: **`crd stats`** (see A7), combat and damage calculation, stat scaling, profile embeds, bag/inventory display, deity-related commands, equip/unequip commands, leaderboards, and anything rendering a character card.

The agent must **enumerate every one of these call sites** in the plan before writing code.

Recommended: add a **single accessor** (e.g. `getActiveLoadout(discordId)`) that performs the join, and route every call site through it. Do not scatter the join across the codebase.

### A5 — Behaviour: equipping mutates the active preset

Because the active preset **is** the live gear, equipping a weapon through the normal equip command now writes directly into the active preset row.

This is the accepted consequence of the pointer model: your current gear simply *is* preset N. There is no separate "unsaved" state, and there is no way to try equipment on without altering the active preset.

Switching presets is therefore just a pointer update — no copying, no transaction spanning multiple tables.

### A6 — Commands

**Confirmed:**

```
crd equip preset <1|2>      switch the active preset
crd preset                  plain-text status, no arguments
```

`crd preset` takes no arguments and returns a simple text reply — no embed, no buttons — telling the user how many presets they have and which one is active:

> You have 2 presets, currently equipped preset 1.

The count is read from the table rather than hardcoded to 2, so the message stays correct if the number of preset slots ever changes.

Implementation is a single write — `update user_characters set active_preset_slot = $2 where discord_id = $1`. No copying, no multi-table transaction. The reply should show what the user is now wearing, so the switch is visibly confirmed.

Edge cases:

- Already on that slot → reply "already using Preset N", no write.
- Target slot is completely empty → the user ends up with nothing equipped. Confirm whether this is allowed, blocked, or allowed-with-warning.

**Proposed, confirm or cut:**

```
crd preset list             show both slots, mark which is active
crd preset name <1|2> <n>   rename a slot
crd preset clear <1|2>      null out that preset's gear
```

Match the existing command style in the repo — the naming above is a guess at the convention and should follow whatever `crd` commands already do.

There is **no save command** in this model. Presets are edited live by equipping, so there is nothing to save.

### A7 — `crd stats` must read through the active preset

`crd stats` already displays weapons and equipment, so it becomes the most visible consumer of this change and the primary way to verify the migration worked.

- It must resolve gear via the `(discord_id, active_preset_slot)` join, not from `user_characters`.
- It should also display **which preset is currently active**, so the user can see the effect of `crd equip preset` without running a second command.
- It remains the place `combat_level` and scaled stats are shown — those still come from `user_characters`, now combined with gear from `user_presets`.

Treat `crd stats` as the acceptance test for Section A: if it renders correctly for a user on slot 1 and a user on slot 2, including a user with an empty slot 2, the migration and sweep are working.

### Open questions — resolve from repo

- Exact type of `user_characters.discord_id`, and whether it is the primary key.
- Table and PK names for deities, armor, and weapons — needed for the FK targets.
- Can a user have more than one character? If so, presets key on the character, not `discord_id`.
- **Enumerate every read of `active_deity_id`, `active_deity_id_2`, `active_deity_id_3`, `equipped_armor_id`, and `equipped_weapon` across the entire repo.** Report the full list with file paths. This list *is* the scope of A4 and must be complete before any code is written.
- **Check for PL/pgSQL functions, triggers, and views referencing those columns.** Views and RLS policies follow renames automatically but break on drops; SQL text inside function bodies is an opaque string and breaks silently.
- Where exactly does `combat_level` feed into stat scaling, and what does that code currently read alongside it? Confirm the join does not create an N+1 query in combat loops.
- Are Supabase TypeScript types generated and committed? If so, regeneration is part of this change.
- Confirm the naming of `active_preset_slot`.

---

## B. Card Avatar Shop

### Context

Extends the **existing shop**, not a new command. The preview must match the existing **supporter shop preview** — same builder, same look, different asset source.

### Decisions already made

- One avatar per page, image displayed large.
- Preview opens as an **ephemeral** message with its own buttons.
- Includes a **Buy** button (not preview-only).
- Only the command invoker can press the buttons; anyone else gets an ephemeral rejection.

### B1 — Pagination with wrap-around

The core requirement:

```
next  ->  page = (page + 1) % total
prev  ->  page = (page - 1 + total) % total
```

The `+ total` before the modulo is required. In JS, `-1 % 5` returns `-1`, not `4`.

### B2 — Page render

- Embed image: avatar art. Title: avatar name. Footer: `Page {i+1}/{total}`.
- Price line, plus owned / not-owned state.
- Button row: `◀ Prev` · `👁 Preview` · `💰 Buy` · `Next ▶`

Buy button state:

| condition | button |
|---|---|
| already owned | disabled, grey, label "Owned" |
| cannot afford | disabled, grey, label shows price |
| affordable | enabled, green |

Prev/Next are always enabled because they wrap — **except when `total <= 1`**, where both are disabled. `total == 0` renders "No avatars available" with no buttons.

### B3 — Invoker guard

Embed the invoker id in the customId: `shop:av:next:<invokerId>:<page>`. On interaction, compare and reject with an ephemeral message on mismatch. Stateless, survives a bot restart, fits well inside the 100-character customId limit.

If the existing shop already has an invoker-guard helper, reuse it rather than introducing a second pattern.

### B4 — Buy flow

Must be a single transaction:

1. Re-read balance and ownership **inside** the transaction. Never trust the button state — it is stale by definition.
2. `unique (user_id, avatar_id)` on the ownership table, so a double-click conflicts instead of double-purchasing.
3. Decrement currency with a `where balance >= price` guard so concurrent spends cannot go negative.
4. On success, re-render the **same page** so Buy immediately flips to "Owned".

### B5 — Custom Avatar Token listing

The shop also carries a **Custom Avatar Token**, priced at **30 supporter tokens** (not the regular shop currency).

- Purchasing it grants the item into the user's **crd bag**.
- It is a consumable item, not an equippable avatar — the shop entry should make that obvious in the description.
- Redemption behaviour, the bag entry, and the resulting ticket are all specified in **Section E**.

### B6 — Collector timeout

Roughly 2–3 minutes, matching whatever the existing shop uses. On end, edit the message to disable all buttons. Dead-but-enabled buttons are a confusing failure mode.

### Open questions — resolve from repo

- Where does the avatar catalog live — DB table or config constant? Needs id, name, price, image URL, and a **stable sort order**. An unstable sort makes page numbers shuffle between invocations.
- Ownership table: a new `user_avatars`, or an existing generic cosmetics/inventory table to reuse?
- Which currency does this shop spend? Confirm the column and the existing spend helper.
- Read the supporter shop preview implementation and mirror it exactly. Report what it does before planning the avatar version.
- How does `/shop` structure categories today? Determine whether avatars slot in as a subcommand, a select-menu category, or a new page.

---

## C. Boss Reorganization

### Requirements

**1. Medusa — remove all immunities.** Every immunity, no exceptions.

**2. Hydra — demote** from greater boss to regular boss.

**3. New tier: Calamity Boss.**

- Fixed level **50** always. No scaling, no randomization.
- Stats strictly greater than greater boss.
- Uses the **same spawn system** as greater boss — a new tier, not a new spawn mechanic.
- **No player-level gate.** Anyone can join; it simply hits very hard.

**4. Two calamity bosses:**

- **Fenrir** — promoted from greater boss (lore-appropriate as a calamity type).
- **Bakunawa** — brand new.

**5. Rewards.** EXP, Credux, and Belief Shard = **highest greater boss values × 2**, on every calamity kill.

Chest drop depends on **spawn origin**, not kill order:

| spawn origin | chest |
|---|---|
| natural spawn | 3× Boss Golden Treasure Chest |
| dev command spawn | Supreme Chest |

The Supreme Chest **replaces** the golden chests on a dev spawn — it is not additive. There is **no first-kill tracking** anywhere in this design.

### C1 — Spawn source flag

The flag lives on the **spawn instance**, not the boss definition:

```
active_bosses.spawn_source   'natural' | 'dev'   not null default 'natural'
```

The reward resolver branches on this single field. Everything else is identical across both paths.

### C2 — Dev spawn command

- Force-spawns a **calamity boss only**. Overrides / short-circuits the normal spawn timer.
- **Queues behind an active boss.** If a boss is currently alive, do not replace it and do not error out — queue the calamity spawn and reply "queued, will spawn after the current boss dies."
- Gate on a **hardcoded dev user-id allowlist**, not Discord admin permissions. A server admin is not a developer.
- **Audit-log every dev spawn**: who invoked it, when, which boss. This command mints the rarest chest in the game — there should be a paper trail.
- Define what the natural spawn timer does after a dev-spawned boss dies (resume as normal is the expected default — confirm against existing timer code).

### Data entry

**The user inserts and updates the boss rows manually.** Do not write data seed scripts or INSERT statements for boss records.

What the plan **should** deliver:

- The schema/enum change that makes the calamity tier possible.
- The code changes that make the tier behave correctly.
- A clear list of exactly which columns need values for a calamity row, so the user can fill them in by hand.

### Open questions — resolve from repo

- **How is boss tier represented?** A Postgres enum, a `boss_type`/`tier` text column with a check constraint, or a hardcoded list in code? If it is an enum, `alter type ... add value 'calamity'` **cannot run inside a transaction block** on older Postgres — flag this for the migration.
- **Find every hardcoded reference to the greater-boss tier**: spawn tables, reward multipliers, announcement embeds, leaderboards, `/bossinfo`-style commands, cooldowns. Both the Hydra demotion and the Fenrir promotion will surface stale assumptions here.
- **How are Medusa's immunities stored** — a column, a JSON field, or a join table? Confirm that removing them does not break status-effect code that assumes at least one immunity exists, or that divides by an immunity count.
- **Where is boss level determined?** Confirm how to pin calamity to a fixed 50 while other tiers scale.
- **Where do reward values live?** Determine whether "highest greater boss ×2" should be a stored literal on the boss row or a computed tier multiplier. Recommend one and explain the trade-off.
- **Is there an existing spawn queue?** If not, the dev command needs one built. Report what exists.
- Do historical records, leaderboards, or kill logs store the tier at time of kill? If they store a live FK to the boss, promoting Fenrir will silently rewrite history. Report what happens.

### Acceptance criteria

- Medusa takes damage from every damage type and status effect.
- Hydra appears wherever regular bosses appear, and nowhere greater bosses appear.
- Fenrir and Bakunawa spawn as calamity, always at level 50, with stats above greater tier.
- Natural calamity kills drop 3× Boss Golden Treasure Chest; dev-spawned calamity kills drop a Supreme Chest instead.
- Calamity kills award 2× EXP/Credux/Belief Shard relative to the highest greater boss.
- The dev command queues rather than replacing or failing when a boss is already active.
- No code path still treats Fenrir as greater or Hydra as greater.

---

## D. Supporter Token Amounts

### Requirements

Increase the supporter tokens granted per tier:

| tier | tokens | extra |
|---|---|---|
| Believer (base) | 10 | — |
| Chosen Believer | 20 | — |
| Eternal Believer | 60 | **1× Custom Deity Token** |

**Eternal Believer additionally receives one Custom Deity Token** as part of the package. The dev grant-eternal-believer command must grant both the 60 supporter tokens and the single deity token, in one transaction. The item itself is specified in **Section E**.

### Scope — deliberately small

**The supporter grant already exists in the codebase.** This is a values-only change.

- **Do not create a new config, constant map, or module.** Locate the existing supporter grant configuration and edit the numbers in place.
- **Do not refactor** the grant logic, the command, or the surrounding structure.
- **There are no supporters in production yet**, so: no backfill, no top-up migration, no grant-cadence logic, no mid-cycle upgrade rule.

The entire change is three numbers in the existing config.

### Consistency check

After editing, **grep the repo for the old values**. If the tier perks are also written out in a `/supporter` info command, a shop embed, an onboarding message, or documentation, update those too so nothing drifts.

Only if such a duplicate is found: report it and recommend pointing it at the existing config. Do not perform that consolidation without approval.

### Open questions — resolve from repo

- Where is the existing supporter grant config? Report the exact file and the current values.
- Are the tier identifiers in code the same three used above? Report the actual enum/string values.
- Every other location in the repo holding one of the old numbers.

---

## E. Custom Content Tokens & Ticket Queue

Two new consumable bag items, one shared redemption flow, one shared ticket queue, one dev review command. Sections B and D both feed into this.

### E1 — The two items

| item | acquired by | bag id | quantity |
|---|---|---|---|
| Custom Avatar Token | bought in avatar shop for 30 supporter tokens | `at` (short for "avatar token") | stackable |
| Custom Deity Token | granted with Eternal Believer tier | `dt` (proposed — confirm) | 1 per grant |

**Manual steps handled by the user, not the agent:**

- Icons are uploaded to the Discord bot by the user.
- Entries are appended to `game_items.txt` by the user.

The agent should read `game_items.txt` and report the **exact format** of an existing entry, so the user knows precisely what to append and which fields are required.

### E2 — Bag display

Both items appear in the **crd bag** only when the user holds at least one. Zero quantity means the item is **not rendered at all** — no greyed-out row, no "0×" entry.

Check how the existing bag renderer decides visibility. If it already hides zero-quantity items, no change is needed; if it renders a fixed item list, this needs handling.

### E3 — Redemption

Redeeming (the user described this as "equipping") a token:

1. Consumes exactly **1** token from the bag.
2. Creates a **ticket** row with status `queued`.
3. Both steps in a **single transaction** — never consume without a ticket, never ticket without consuming.
4. Reply to the user with their ticket id so they can reference it.

**Ticket id generation reuses the existing weapon-id generator.** The agent should locate that generator and report how it works, including its uniqueness guarantee and collision handling, before reusing it.

**Double-click guard:** two rapid redemptions must not consume one token and mint two tickets. Guard with a conditional decrement (`where quantity >= 1`) plus a returning-row check, matching the pattern used in the shop buy flow (B4).

### E4 — Tickets table

One table for both types, discriminated by a `type` column — the dev command's dropdown filters on it.

```sql
create table tickets (
  ticket_id     text primary key,          -- generated by the weapon-id generator
  type          text not null check (type in ('avatar', 'deity')),
  user_id       <match users type> not null,
  status        text not null default 'queued'
                  check (status in ('queued', 'in_progress', 'done')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  completed_at  timestamptz,               -- set when status becomes done
  completed_by  <dev user id>,
  notes         text
);

create index on tickets (status, type, created_at);

alter table tickets enable row level security;
-- No policies. Bot uses service_role.
```

**Status values and display labels:**

| DB value | displayed as |
|---|---|
| `queued` | Queued |
| `in_progress` | Ongoing |
| `done` | Done |

Store `in_progress`; render "Ongoing". Do not use "ongoing" as the stored value — the update command's argument is `in_progress`, and the two must match.

**There is no cancelled state.** Every redeemed token is guaranteed to be fulfilled, so a ticket only ever moves forward: `queued → in_progress → done`. Do not add a cancel path, and do not build token-refund logic.

### E5 — Dev command: `crd supporter tickets`

- **Dev accounts only.** Same hardcoded dev allowlist used by the calamity dev-spawn command (Section C2) — reuse it, do not add a second allowlist.
- Embed styled consistently with the bot's existing embeds.
- **Dropdown with four categories:**

| category | filter |
|---|---|
| Avatar | `type = 'avatar'` and status in (`queued`, `in_progress`) |
| Custom Deity | `type = 'deity'` and status in (`queued`, `in_progress`) |
| Completed Avatar Tickets | `type = 'avatar'` and `status = 'done'` |
| Completed Custom Deity Tickets | `type = 'deity'` and `status = 'done'` |

The first two are the **work queues**; the last two are the archive.

Each ticket row displays:

- `ticket_id`
- the requesting user, as a mention
- when the ticket was created
- current status label (Queued / Ongoing in the work queues)

Sort **oldest first** in the work queues. Sort **most recently resolved first** in the completed views.

Paginate if the list can exceed embed limits. Reuse the avatar shop paginator (B1) rather than writing a second one.

### E6 — Dev command: `crd update ticket <ticket_id> <status>`

Dev accounts only, same allowlist.

```
crd update ticket <ticket_id> <in_progress | done>
```

- Validates that `ticket_id` exists; replies with a clear error if not.
- Writes the new status, bumps `updated_at`, and on `done` also sets `completed_at` and `completed_by`.
- Replies with a confirmation showing the before → after status.
- **No-op guard:** if the ticket is already at the requested status, say so rather than rewriting timestamps.

`queued` is deliberately **not** an accepted argument — tickets only move forward. Confirm this is intended.

### Open questions — resolve from repo, or flag back for a decision

- **Confirm the bag item ids.** `at` for the avatar token was specified; `dt` for the deity token is a proposal. Also confirm whether existing bag ids are this short — check `game_items.txt` for the established convention before committing to two-letter ids.
- **Multiple open tickets per user:** a user with two avatar tokens can redeem both and hold two open tickets. Confirm this is allowed, or whether a one-open-ticket-per-type cap is wanted.
- Report the exact format of a `game_items.txt` entry.
- Report how the weapon-id generator works and whether it is safe to reuse for tickets.
- Report how the bag renderer currently decides item visibility.
- Report the existing dev-allowlist mechanism so both dev commands share it.

---
## F. Profile & Stats Panel Revamp

Applies to **every cosmetic skin**, not just the default. All skins already have their own rendered panels — the "Rank Combat Record" block on `crd profile` and the "Combat Stats" block on `crd stats`.

### F1 — STRICT RULE: no layout changes

**Nothing about position, geometry, or layout may change.** Not box coordinates, not box sizes, not spacing, not the number of boxes, not their order on screen, not colours, not the panel frame.

The existing positions are the fixed basis for the new information. Only the **contents** of the boxes and the panel heading change.

If content does not fit, **the content adapts to the box — never the box to the content.** Do not resize, reflow, or re-position anything. If some value genuinely cannot be made to fit even at the minimum readable font size, stop and report it rather than adjusting the layout.

### F1b — Auto-fit and auto-centering

Text inside each box must be **measured against the box and fitted automatically**, rather than relying on a hardcoded font size that happens to work for the default skin.

Required behaviour:

1. **Measure** the rendered text width and height against the box's inner bounds.
2. **Scale the font down** until it fits. Never scale up beyond the current design size — the default appearance must stay as it is today.
3. **Center** the result within the box, both horizontally and vertically.
4. The box itself is **never** resized, moved, or re-padded.

**A minimum font size floor is required.** Auto-shrinking without a floor produces unreadable 4px text. Below the floor, fall back to an abbreviated string instead of shrinking further. The agent should propose the floor value and the fallback abbreviations together.

This fitting logic should live in **one shared helper** used by every skin, not reimplemented per skin. It applies to both the label and the value in each box.

### F1c — Panel heading rename

Both panel headings are renamed to the same thing:

| panel | current heading | new heading |
|---|---|---|
| `crd profile` | Rank Combat Record | **Character Records** |
| `crd stats` | Combat Stats | **Character Records** |

This applies to **every skin**. The heading is text content, so F1 still holds — the heading's position and style do not change, only its wording.

### F2 — The six boxes

Current contents (both panels, left to right):

| # | current |
|---|---|
| 1 | RAIDS |
| 2 | RAIDS WON |
| 3 | RAID STREAK |
| 4 | RANK DUELS |
| 5 | RANK WINS |
| 6 | RANK STREAK |

New contents, in the order specified:

| # | new value | type |
|---|---|---|
| 1 | Highest raid streak | integer |
| 2 | Current raid streak | integer |
| 3 | Current rank, as a word (e.g. "Ascendant") | **text** |
| 4 | Current rank, as a number | integer |
| 5 | Highest rank streak | integer |
| 6 | Rank win rate | **percentage** |

**Confirm this position mapping.** The order above is taken directly from how the values were listed, assuming it maps left-to-right onto boxes 1–6. If the intended arrangement differs, correct it before implementing — this is the one thing that cannot be adjusted later without breaking F1.

### F3 — Labels change, positions do not

The box **labels** must change along with the values — "RAIDS" cannot label a highest-raid-streak figure. The label text is content, not layout.

The new labels are substantially longer than the old ones:

| old label | new label | growth |
|---|---|---|
| `RAIDS` | `HIGHEST RAID STREAK` | 5 → 19 chars |
| `RANK STREAK` | `HIGHEST RANK STREAK` | 11 → 19 chars |
| `RANK WINS` | `RANK WIN RATE` | 9 → 13 chars |

The auto-fit in F1b absorbs most of this by shrinking the text — but a 19-character label shrunk into a box sized for 5 characters will be tiny and hard to read even though it technically fits. **Auto-fit is the safety net, not the plan.**

So the agent should still propose a **short label set** that reads comfortably at close to the original size, with auto-fit handling only the remainder. Examples to consider: `BEST RAID STK` / `RAID STREAK` / `RANK` / `RANK #` / `BEST RANK STK` / `WIN RATE`.

Propose the label set and get it approved **before** applying it across all skins — changing it afterwards means redoing every skin.

### F4 — Two boxes are no longer plain integers

Boxes 3 and 6 change data type, which the existing rendering may not handle.

**Box 3 — rank as a word.** These boxes currently render short green numbers. A rank name like "Ascendant" is longer and is text. Determine the **longest possible rank name** in the system and check it against the box width. Auto-fit (F1b) will shrink it, but if the longest name shrinks below the readable floor, an abbreviation scheme is needed for the long names.

**Box 6 — win rate percentage.** Requires a division. Specify:

- Rounding: whole percent, or one decimal? (`97%` vs `97.1%`)
- **Divide-by-zero:** a player with zero ranked duels. Render `0%`, `—`, or `N/A`? This must be defined, not left to crash.

### F5 — Data availability

Some of these values may not currently be tracked.

The existing panels show *current* raid streak and *current* rank streak. **"Highest raid streak" and "highest rank streak" are new concepts** — if the schema only stores the current value, the historical maximum does not exist and **cannot be reconstructed**.

If that is the case:

- Add the columns (`highest_raid_streak`, `highest_rank_streak`), defaulting to the player's current streak at migration time — that is the best available approximation.
- Update them going forward whenever the current streak exceeds the stored maximum.
- Be aware and communicate that historical highs before this update are lost. There is no way around this.

Same check applies to rank number and rank word — confirm both are derivable from existing data.

### F6 — Apply across every skin

Each skin has its own panel. Every one must be updated, and every one must still satisfy F1.

The agent must **enumerate all skins** and report the list before starting, so coverage can be verified. A skin missed here ships broken, showing stale labels against new values.

Strongly prefer a **shared data layer**: one function produces the six label/value pairs, and every skin renders from it. If each skin computes its own values, they will drift.

### Open questions — resolve from repo

- **Enumerate every cosmetic skin** and the file for each panel. This list is the scope of F6.
- Are `highest_raid_streak` and `highest_rank_streak` already tracked anywhere? If not, they need new columns (see F5).
- How is rank represented — is there both a numeric rank and a named tier? Report the full list of rank names and the **longest** one.
- Is win rate already computed anywhere in the codebase? If so, reuse that definition rather than inventing a second one that disagrees.
- How are these panels rendered — canvas, HTML-to-image, static templates? This determines how text measurement and auto-fit (F1b) can be implemented. Report whether a text-measurement API is available in that rendering path.
- Confirm both `crd profile` and `crd stats` use the same six boxes and the same underlying data, or report how they differ.
- Report the exact box inner width and height in the render, so proposed labels and the minimum font floor can be checked against real numbers rather than guessed.
- Is the panel heading currently hardcoded per skin, or drawn from a shared string? This determines how many places the "Character Records" rename touches.

---

## Deliverable expected from the agent

For each section: the file list, the exact migration SQL, the code changes described concretely, answers to every open question above, and any risks discovered while reading the repo. Then stop for review before implementing.
