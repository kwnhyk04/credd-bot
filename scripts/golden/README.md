# Golden characterization baselines (Phase 0 — refactor safety net)

These harnesses lock current behavior so the structural refactor can prove
"nothing changed". They are characterization tests: they assert *whatever the
code does today*, not what it should do.

| Harness | Baseline | Cases |
|---|---|---|
| `battle-golden-selftest.js` (C1) | `battle-hashes.json` | 150 battle sims (50 seeds × raid/duel/boss), SHA-256 of the full sim JSON |
| `render-golden-selftest.js` (C2) | `render-hashes.json` + `renders/*.png` | 5 canvas surfaces: boss status card, battle frame, stats card, profile card, quest rows |

## Running

```bash
node scripts/golden/battle-golden-selftest.js    # verify C1
node scripts/golden/render-golden-selftest.js    # verify C2
```

Both exit non-zero on any mismatch. During the behavior-preserving refactor a
mismatch means the step changed behavior: **revert the step**. Do not "fix" the
baseline to make a refactor step pass.

## Regenerating baselines

Only legitimate when behavior was changed **intentionally** (a feature or a
balance change), never to make a refactor step green. Procedure:

1. Run the harness with `--write`.
2. **Manually open every PNG under `renders/` and visually diff it against the
   previous version (git shows both). Hash-only acceptance is never allowed** —
   a hash tells you *that* pixels changed, only your eyes tell you the change
   is the one you intended.
3. Commit the new baselines together with the change that caused them, and say
   why in the commit message.

## Machine-local caveat (C2)

Canvas/font output varies across platforms and `@napi-rs/canvas` builds, so
`render-hashes.json` is only valid on the machine (and dependency lockfile)
that wrote it. Regenerate locally after `npm ci` changes native deps; C1 battle
hashes are pure JS and portable.
