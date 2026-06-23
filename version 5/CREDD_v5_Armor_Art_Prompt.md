# CREDD v5 — ARMOR ART GENERATION PROMPT

Use the master prompt below, swapping in each piece's descriptor. Generate one image per piece,
square, transparent or dark-neutral background, consistent style across all 10 so they sit together
in the bag/info cards. Output filename = the slug (e.g. `kalasag.png`) into `/assets/armors/`.

---

## MASTER PROMPT (paste once, fill the [BRACKETS] per piece)

> A single piece of mythological [ARMOR TYPE] armor: **[PIECE NAME]**, [PIECE DESCRIPTOR].
> Rendered as a centered game item icon — the armor piece alone, no character wearing it, no
> background scene. [MYTHOLOGY] aesthetic, [TIER MOOD]. Painterly semi-realistic RPG item art,
> dramatic rim lighting, rich material detail (metal, leather, cloth, wood as appropriate), subtle
> magical glow matching the tier color. Clean silhouette, fills the frame, faces the viewer at a
> slight 3/4 angle. Transparent or dark neutral background. High detail, cohesive fantasy art style,
> no text, no UI, no watermark.

**TIER MOOD values:**

- Common → plain, humble, worn, no glow
- Rare → solid craftsmanship, faint blue glow
- Mythic → ornate, purple arcane glow
- Legendary → masterwork, radiant gold glow, intricate engraving
- Supreme → divine artifact, intense red-gold aura, otherworldly

**ARMOR TYPE silhouette cue:** Heavy → bulky plate/large shield · Medium → balanced mail/round shield ·
Light → cloth/leather/sash/light buckler.

---

## PER-PIECE DESCRIPTORS

| File                   | Name               | Type   | Myth          | TIER MOOD | DESCRIPTOR                                                                                                                                       |
| ---------------------- | ------------------ | ------ | ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| initiates_garb.png     | Initiate's Garb    | Medium | Common        | Common    | simple padded cloth-and-leather travelling tunic, plain belt, humble and unadorned                                                               |
| kalasag.png            | Kalasag            | Heavy  | PH (Filipino) | Rare      | large rectangular hardwood war shield with carabao-hide facing and carved tribal patterns, sturdy and broad                                      |
| baluti_vest.png        | Baluti Vest        | Light  | PH (Filipino) | Rare      | woven abaca-fiber and carabao-hide light vest, layered cords, tribal weave texture, flexible                                                     |
| salakot_ward.png       | Salakot Ward       | Medium | PH (Filipino) | Mythic    | a salakot (wide dome helmet) of woven rattan and bamboo banded with engraved silver, faint spirit-ward glyphs glowing purple                     |
| wolfskin_cloak.png     | Wolfskin Cloak     | Light  | Norse         | Mythic    | a Norse wolf-pelt cloak with the wolf's head as a hood, bone clasps, fur detail, runic trim glowing purple                                       |
| hoplite_panoply.png    | Hoplite Panoply    | Heavy  | Greek         | Legendary | a masterwork bronze hoplite cuirass with a large round aspis, embossed Greek meander and a lion motif, radiant gold engraving                    |
| anting_anting_sash.png | Anting-Anting Sash | Light  | PH (Filipino) | Legendary | a woven cloth sash hung with brass anting-anting amulets and Latin-Tagalog charm medallions, glowing gold protective sigils                      |
| valkyrie_mantle.png    | Valkyrie's Mantle  | Light  | Norse         | Legendary | a feathered winged shoulder-mantle of silver and white swan/raven feathers, valkyrie wing motif, radiant gold light                              |
| mail_of_brokkr.png     | Mail of Brokkr     | Heavy  | Norse         | Supreme   | a dwarven-forged black-iron and gold mail hauberk by the smith Brokkr, glowing forge-runes, molten seams, divine red-gold aura                   |
| mantle_of_bathala.png  | Mantle of Bathala  | Medium | PH (Filipino) | Supreme   | a divine sky-blue and gold ceremonial mantle of the supreme creator Bathala, sun-and-bird regalia, celestial cloth, intense red-gold divine aura |

---

## NOTES

- Keep lighting direction and camera angle identical across all 10 so the set looks uniform in-grid.
- PH pieces: lean on authentic pre-colonial Filipino material culture (rattan, abaca, carabao hide,
  silver inlay, anting-anting amulets, salakot) — avoid generic-fantasy substitutes.
- Migrated shields (Steel Kite Shield, Aegis, Helm of Darkness, etc.) already have art — do NOT
  regenerate; only the 10 above are new.
- If your generator drifts on style between runs, generate all 10 in one batch/session with the same
  seed family and a fixed style suffix.
