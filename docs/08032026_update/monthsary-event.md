# Monthsary Event (7 days) — Planning Brief

**Purpose of this document:** a planning brief to hand to Claude Code (or Codex). It contains the requirements and the decisions already made. It is **not** an implementation plan.

**Instructions to the agent reading this:**

1. Read the repository first. Do not write code yet.
2. Locate the relevant files, schema, and existing patterns for each section.
3. Answer every item under "Open questions — resolve from repo" using what you find.
4. Read **Section 1 (Deployment model) before anything else** — it constrains every design decision in this document.
5. Produce a detailed, file-by-file implementation plan, then stop for review.

**Stack:** Postgres via Supabase. Discord bot.

**Prerequisite:** this event is built **on top of** the Monthsary Update (`monthsary-update.md`, sections A–E), which must already be merged to `main` **and running stably in production**. The event assumes the avatar shop, supporter tokens, bag items, and calamity boss tier all exist.

Do not begin event implementation while the update is still being bug-fixed. Two reasons: the rollback baseline must be a version that is known-good, and every update hotfix landed during the event window has to be cherry-picked forward past the rollback.

**The event is intentionally low-risk: it increases rewards, it does not change mechanics.** Reward increases must be applied as an **additive layer** — event config values applied on top of base rewards at grant time — never by editing base reward constants or formulas in place. Base reward files should ideally appear in the event diff zero times, so the rollback is a clean deletion of event-only code.

---

## 1. Deployment model — read this first

This event is **temporary code that gets deleted**, not a feature that gets disabled. That is unusual and it constrains everything below.

### The intended git flow

Deployment only accepts pushes to `main`, so the event ships to `main` as a layer and is removed from `main` afterwards.

1. Monthsary Update (A–E) merges to `main` and stabilizes. This is the permanent baseline.
2. That baseline is **tagged** before any event code is written.
3. Event code merges into `main` as a **single merge commit** and deploys. Event runs 7 days.
4. After day 7, the event merge commit is **reverted** on `main`.

### How to do step 4 — revert, not force-reset

Two ways to remove the event. They reach the same code state, but one is much safer.

**Recommended — revert the merge commit:**

```
git revert -m 1 <event-merge-commit>
git push origin main
```

- No force-push, no history rewrite, no diverged clones.
- **Hotfixes landed during the event window survive automatically** — only the event commits are undone.
- The revert is itself a commit, so there is a permanent record of when the event ended.
- If the event is ever run again, reverting the revert brings it all back.

**Not recommended — hard reset `main` to the backup ref and force-push:**

- Destroys *everything* from the 7-day window indiscriminately, hotfixes included.
- Rewrites history, so every existing clone diverges.
- Requires temporarily unprotecting `main`.

Only do this if the event diff turns out to be too entangled to revert cleanly — which is itself a sign the code was not kept additive enough.

### What the backup tag is actually for

Keep the tag regardless, but its job is **verification, not overwriting**:

```
git tag -a v-pre-monthsary-event -m "Baseline before monthsary event"
git push origin v-pre-monthsary-event

# after the revert, confirm the event is fully gone:
git diff v-pre-monthsary-event main
```

That diff should contain **only** hotfixes made during the window, and zero event code. If any event code appears, the revert was incomplete.

**Do not name the backup ref `latest`.** During the event, it would hold the *older* code while `main` holds the newer — actively misleading. A tag is immutable and cannot drift; if a branch is also wanted, name it `pre-event-baseline`.

### Keep the event diff small and self-contained

All event code goes on a clearly-marked branch and merges with a **merge commit**, so removal is one `git revert -m 1` rather than manual archaeology.

Event code should live in **new files wherever possible**. Existing files should be touched only where a hook is unavoidable — realistically just `crd daily` (Section 4) and wherever event quests plug into the quest system. Each such touch point should be a small, clearly-commented block, not logic woven through existing code.

The smaller and more isolated the diff, the more reliably the revert works.

### The hotfix trap

If a bug is fixed on `main` during the 7 days, the revert approach preserves it automatically — but a force-reset to the baseline tag would **destroy it**.

This is the main reason revert is recommended over force-reset. If a force-reset ever becomes necessary, every non-event commit made during the window must first be identified and cherry-picked forward.

### The hard constraint: code rolls back, data does not

A git rollback removes **code**. It does not remove database tables, columns, or rows.

Therefore event code must be **strictly additive**:

| allowed | forbidden |
|---|---|
| new tables | altering existing table columns |
| new columns that are nullable with defaults | dropping or renaming anything |
| new commands | changing the shape of existing tables |
| new branches inside existing command handlers | changing existing reward/economy formulas in place |

**After rollback, orphaned event tables stay in the database.** That is fine and expected — they are harmless, and they preserve a record of what players earned. Do not plan to drop them. Do not write a teardown migration.

**Everything a player earned during the event is permanent.** Sacred relics, chests, and all other granted items stay in inventories forever. Nothing is ever clawed back, before or after rollback.

**Critical check for the `crd daily` change (Section 4):** the event adds a branch to an existing command. After rollback, that branch vanishes and the command must return to exactly its pre-event behaviour with no leftover state dependency. The agent must verify that the event attendance logic touches **only** new event tables, never the existing daily-attendance tables.

---

## 2. No cosmetic rewards

**The event grants no cosmetics of any kind.**

Cosmetics are the supporter tier's entire value proposition. Giving them away free undercuts the avatar shop and the Custom Avatar Token shipped in the Monthsary Update.

Event rewards are game items only: relics, chests, consumables. Nothing that occupies a cosmetic slot, and nothing that is permanently stronger than what non-participants can obtain.

---

## 3. Event quests

- Completing **all of a given day's quests** grants **1 Sacred Relic**.
- Across the 7 days that is **7 Sacred Relics** from the quest track.

The specific quests are not yet designed. The agent should report what the existing quest system supports — daily quests, quest chains, objective types, reset boundaries — so the 7 days of quests can be designed against real capability rather than invented.

---

## 4. Event attendance in `crd daily`

`crd daily` triggers **two attendance records in one invocation**: the existing regular attendance, and the new event attendance. One command, one reply, both grants, in a **single transaction**.

The reply embed shows both clearly — regular attendance first, event attendance as a visually distinct section — so the user understands they received two things.

### Day numbering

**The day number is the calendar day of the event, not the user's check-in count.**

- Miss a day → that day's reward is simply missed. No reset, no penalty, no catch-up.
- Check in day 1, skip day 2, check in day 3 → the user receives **day 3's** reward. Day 2 is gone permanently.
- Day 7's reward therefore requires checking in on day 7 specifically.

### Rewards per day

| day | reward |
|---|---|
| 1–6 | 1× Sacred Relic + 1× Boss Treasure Chest |
| 7 | 1× Sacred Relic + 1× Boss Treasure Chest + 1× Boss Golden Treasure Chest |

Day 7's golden chest is **in addition to** the normal day reward, not a replacement. Confirm this reading.

---

## 5. Total event payout

| source | Sacred Relics |
|---|---|
| quest track (7 days) | 7 |
| attendance track (7 days) | 7 |
| **maximum total** | **14** |

14 is the intended ceiling for a player who does everything. This is deliberate, not a double-count bug.

---

## 6. Suggested table shape

All event tables are new, additive, and keyed on an `event_key` so the structure is reusable for future events rather than hardcoded to this one.

```sql
create table event_attendance (
  event_key   text not null,              -- e.g. 'monthsary_2026_08'
  user_id     <match users type> not null,
  event_day   smallint not null check (event_day between 1 and 7),
  claimed_at  timestamptz not null default now(),
  primary key (event_key, user_id, event_day)
);

alter table event_attendance enable row level security;
-- No policies. Bot uses service_role.
```

The composite primary key makes double-claiming a day structurally impossible — a second attempt conflicts instead of granting twice.

Quest progress needs equivalent per-day, per-user tracking so the daily relic cannot be claimed twice. Check whether the existing quest system already tracks daily completion before adding a new table.

---

## 7. Event window control

Even though the event is removed by rollback, it still needs a **start and end timestamp plus a manual kill-switch flag** in config.

Reasons this is required and not optional:

- The rollback happens manually and may not land exactly at the 7-day mark. The event must stop granting on schedule regardless of when the deploy is reverted.
- If something goes wrong on day 2, the kill switch stops the bleeding without an emergency rollback.
- Day numbering in Section 4 is derived from the event start timestamp, so it must exist anyway.

Check whether an event or feature-flag system already exists in the repo and reuse it. Only build a new one if nothing suitable exists.

---

## Open questions — resolve from repo, or flag back for a decision

- **What is a Sacred Relic?** Does it already exist in `game_items.txt`, and does it have a use? If it is new, the user uploads the icon and appends the entry manually. **If it has no sink — nothing to spend it on — flag this loudly.** 14 of an unusable item is an anticlimax and undercuts the whole event.
- **What are the actual event quests?** Report what the existing quest system supports so they can be designed against real capability.
- **Does `crd daily` reset on a fixed UTC boundary or a rolling 24h window?** Event day numbering must use the same boundary as the existing daily, or players hit off-by-one confusion at the edges.
- **Which timezone defines "day 1"?** The event start timestamp and the daily reset must agree.
- **Verify the `crd daily` event branch writes only to new event tables.** This is the single biggest rollback risk in the plan.
- What happens if a player's first-ever `crd daily` falls during the event? Confirm both attendance records initialize cleanly.
- Do Boss Treasure Chest and Boss Golden Treasure Chest already exist as grantable items? Report their ids.
- Is there an existing event or feature-flag system to reuse?
- Report how isolated the event code can realistically be kept — which existing files must be touched, and how large that diff is. This directly determines how painful the rollback will be.

---

## Deliverable expected from the agent

The file list, the exact migration SQL, the code changes described concretely, answers to every open question above, and — specifically for this document — **a rollback checklist**: exactly which files and commits must be reverted after day 7, and which database objects will be left behind. Then stop for review before implementing.
