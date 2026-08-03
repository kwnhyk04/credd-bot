# CLAUDE.md

Project instructions for Claude. Read this before touching anything in `/docs`.

## Project overview

<One paragraph: what this Discord bot is, what it does, who plays it.>

Stack: <language / library, e.g. Python + discord.py, Node + discord.js>
Database: <e.g. PostgreSQL via Prisma, MongoDB via Mongoose>
Entry point: `<path/to/main file>`

## Repo map

- `<src/commands/>` — slash and prefix command handlers, one file per command group
- `<src/systems/>` — game mechanic logic (combat, gacha, runes, etc.)
- `<src/models/>` — database schemas and enums
- `<src/data/>` or `<config/>` — balance tables, drop rates, item definitions
- `<src/utils/>` — shared helpers and formulas
- `/docs` — the RAG source of truth (see rules below)

## Purpose of /docs

Every file in `/docs` is ingested by a RAG chatbot on the bot's website. Players
ask it questions in natural language. This means:

- Chunks are retrieved in isolation. Each document, and ideally each section,
  must make sense on its own. Restate shared context briefly instead of writing
  "see the weapon doc."
- Headings drive retrieval. Phrase H2/H3 headings the way a player would ask the
  question ("How does rune upgrading work", "What are the gacha pity rates"),
  not as bare nouns ("Upgrading", "Pity").
- No cross-file pronouns, no "as mentioned above" across files, no relative
  references that break when a chunk is lifted out.

## Source of truth hierarchy

1. Source code — authoritative for all mechanics, values, formulas, commands
2. Database schema and config/data files — authoritative for structure and balance
3. Existing docs — treated as unverified claims; code overrides them
4. Lore, backstory, name origin, trivia — no code backing; preserve verbatim,
   never invent, never delete

If code and docs disagree, update the doc and note the source file in an HTML
comment.

## Documentation rules

- One Markdown file per game system in `/docs`. Never merge two systems into one
  file, never split one system across files.
- Filenames: lowercase kebab-case, `<system>-system.md`
  (e.g. `gacha-system.md`, `rune-system.md`). Lore lives in `lore-and-meta.md`.
- Every file opens with an H1 title and a 2–3 sentence summary of the system.
- Every command documented with: exact syntax, all arguments and their types,
  aliases, cooldown, permission requirements, and one realistic usage example.
- All numeric or enumerable data goes in a Markdown table. No numbers buried in
  prose.
- Formulas transcribed exactly as implemented, in a fenced code block, with the
  source file cited in an HTML comment directly above:
  `<!-- src: src/systems/combat.js:142 -->`
- Anything not determinable from the code is marked `[UNVERIFIED]` inline. Never
  guess a value to fill a gap.
- No TODOs, no placeholders, no "coming soon" unless the code explicitly gates
  the feature as unreleased.
- Match the heading hierarchy, table style, and tone already present in `/docs`.
  Read an existing file before writing a new one.

## When code changes

Any PR that changes a command signature, a balance value, a formula, a drop
rate, or adds a system must update the matching `/docs` file in the same change.
Docs drifting from code is the failure mode this file exists to prevent.

## Verification before finishing

After writing or editing docs, re-check every number, formula, and command name
against the source file it came from. Report anything that could not be
confirmed rather than leaving it silently in place.

## Things not to do

- Do not rewrite lore, trivia, credits, or the origin of the bot's name. Migrate
  them intact.
- Do not delete an outdated doc until its content has been migrated.
- Do not summarize a system to save space. These docs are reference material,
  completeness beats brevity.
- Do not add commentary, changelogs, or meta-notes into system docs. Those go in
  `lore-and-meta.md` or the docs index.

## Docs index

`/docs/README.md` lists every document with a one-line description and the
systems it covers. Update it whenever a file is added, renamed, or removed.
