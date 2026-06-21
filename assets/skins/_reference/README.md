# Skin alignment references

`scripts/alignSkins.js` aligns each profile skin's rendered content against a
**human-approved** reference image kept here, named `<skin_key>.png`.

Skin keys (printed by the script): `base_profile`, `store_<basename>`,
`founder_profile`, `testers_default`, `testers_<discord_id>`.

## Workflow

1. Run `node scripts/alignSkins.js`. Skins with no reference render a first pass
   and are flagged **PENDING_REF**, writing `tmp/align/<skin_key>/proposed_reference.png`.
2. Open the proposal, tune the colocated `<basename>.layout.json` by hand until the
   placement is correct (or accept it as-is), then copy the approved image here as
   `<skin_key>.png`.
3. Re-run the script. It now measures the render against your reference and nudges
   the config until every element is within ±2 px (or 25 iterations), saving
   `iterN.png` + a `diff.png` heatmap under `tmp/align/<skin_key>/`.

Do **not** drop the auto-generated `proposed_reference.png` straight in here unchecked —
that makes the loop converge on its own output. References are the intended final look.
