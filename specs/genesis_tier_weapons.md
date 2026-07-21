# GENESIS TIER: The Five First Arms

**Tier:** Genesis (above Supreme)
**Base Stats (all weapons):** Attack 1600 | Crit Rate 20% | Crit Damage +50%

*Before the world had a name, the Forger-Before-Gods shaped five instruments to carve existence out of the void. When creation was finished, the Forger vanished, but the tools remained, scattered and waiting for hands worthy of the beginning.*

---

## Weapon Overview

| Name | Type | Class | Mythology | Role |
|---|---|---|---|---|
| Kiri | Sword | Swordsman | Japanese | Ramping sustained damage |
| Moira | Bow | Archer | Greek | Armor penetration |
| Sophia | Staff | Mage | Greek | Glass cannon |
| Atlas | Gloves | Brawler | Greek | High damage |
| Titan | Greatsword | Knight | Greek | Damage sustain |

---

## Full Weapon Details

### KIRI, The First Cut (Sword, Swordsman)
**Mythology:** Japanese. From 切り (kiri), meaning "cut," and 霧 (kiri), meaning "mist." One word, two truths: the blade that cuts, and the mist it leaves behind.

**Lore:** When nothing yet had edges, Kiri made the first one. It divided light from dark, sky from sea. The blade is said to have no true form, only the memory of separation itself, wrapped in mist. Those who wield it don't swing a sword. They remind the world where things end.

**Passive: Thousand Partings**
Each attack increases damage by 20%, stacking up to +120%. Every attack has a 25% chance to strike twice.

### MOIRA, The Thread-Loosed (Bow, Archer)
**Mythology:** Greek. From Μοῖρα (Moira), meaning "fate" or "allotted portion." The Moirai were the three Fates who spun, measured, and cut the thread of every mortal life.

**Lore:** The Forger strung this bow with a single thread pulled from the tapestry of fate. Every arrow fired is a destiny fulfilled. It does not fly toward its target; the target was simply always meant to be struck. Moira never misses, because Moira never aims. It remembers.

**Passive: Fate Ignores Iron**
All attacks reduce the target's defense by 10%, stacking up to 50%. Ignores 50% of defense against targets with a defense buff active. Attacks cannot miss.

### SOPHIA, The Knowing Light (Staff, Mage)
**Mythology:** Greek. From σοφία (sophia), meaning "wisdom," the same root as "philosophy." In ancient tradition, Sophia was wisdom personified as a divine figure.

**Lore:** The first question ever asked was answered by Sophia. It holds the accumulated understanding of everything the Forger learned while building the world. It does not cast magic. It explains to reality, patiently, why things should be otherwise. And reality, humbled, obeys.

**Passive: The Price of Knowing**
All damage dealt is increased by 75%, but the wielder takes 20% more damage. When the wielder drops below 30% HP, damage dealt increases to +150% for the rest of the battle.

### ATLAS, The Bearer's Hands (Gloves, Brawler)
**Mythology:** Greek. From Ἄτλας (Atlas), the Titan condemned to hold up the heavens for eternity, from the root "tlenai," meaning "to bear" or "to endure."

**Lore:** When the newborn sky threatened to collapse back into the void, the Forger shaped gauntlets strong enough to hold it up until creation could stand on its own. Atlas has carried the weight of the world once already. No burden since has ever felt heavy.

**Passive: Worldbreaker's Grip**
Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their attack reduced by 30% for 1 turn.

### TITAN, The Unfinished Colossus (Greatsword, Knight)
**Mythology:** Greek. From Τιτάν (Titan), the primordial race of giants who ruled before the gods themselves. Elder even than Olympus, they were the raw first draft of divinity.

**Lore:** The last weapon the Forger made, and the only one never completed. Titan was meant to be a mountain given a hilt, abandoned mid-forging when the Forger vanished. It still burns with unfinished creation fire at its core. Legends say the blade grows closer to completion with every worthy Knight who carries it.

**Passive: Forgefire Veins**
The wielder heals for 30% of all damage dealt. Healing increases to 50% while below 50% HP. Once per battle, upon taking fatal damage, survive at 1 HP and gain +100% damage until the end of battle.

---

## SQL Insert Scripts

Table reference: `weapon_roster (weapon_roster_id, name, type, tier, mythology, passive_key, passive_name, passive_description, lore, image_filename, is_available)`

Note: IDs continue from your latest row (77), so these use 78 to 82. If `weapon_roster_id` is auto-increment in your database, remove the ID column and its values from each statement.

```sql
INSERT INTO weapon_roster (weapon_roster_id, name, type, tier, mythology, passive_key, passive_name, passive_description, lore, image_filename, is_available)
VALUES
(78, 'Kiri', 'Sword', 'Genesis', 'Japanese', 'kiri', 'Thousand Partings',
 'Each attack increases damage by 20%, stacking up to +120%. Every attack has a 25% chance to strike twice.',
 'From the Japanese word for both "cut" and "mist." When nothing yet had edges, Kiri made the first one. It divided light from dark, sky from sea. The blade has no true form, only the memory of separation itself, wrapped in mist. Those who wield it do not swing a sword. They remind the world where things end.',
 'kiri.png', true),

(79, 'Moira', 'Bow', 'Genesis', 'Greek', 'moira', 'Fate Ignores Iron',
 'All attacks reduce the target''s defense by 10%, stacking up to 50%. Ignores 50% of defense against targets with a defense buff active. Attacks cannot miss.',
 'From the Greek word for "fate." The Moirai were the three Fates who spun, measured, and cut the thread of every mortal life. The Forger strung this bow with a single thread pulled from the tapestry of fate. Every arrow fired is a destiny fulfilled. Moira never misses, because Moira never aims. It remembers.',
 'moira.png', true),

(80, 'Sophia', 'Staff', 'Genesis', 'Greek', 'sophia', 'The Price of Knowing',
 'All damage dealt is increased by 75%, but the wielder takes 20% more damage. When the wielder drops below 30% HP, damage dealt increases to +150% for the rest of the battle.',
 'From the Greek word for "wisdom," the root of "philosophy." The first question ever asked was answered by Sophia. It holds everything the Forger learned while building the world. It does not cast magic. It explains to reality, patiently, why things should be otherwise. And reality, humbled, obeys.',
 'sophia.png', true),

(81, 'Atlas', 'Gloves', 'Genesis', 'Greek', 'atlas', 'Worldbreaker''s Grip',
 'Base attack increased by 50%. Every 3rd turn is a guaranteed critical strike. Enemies hit by a critical strike have their attack reduced by 30% for 1 turn.',
 'From the Greek Titan condemned to hold up the heavens, whose name means "to bear." When the newborn sky threatened to collapse back into the void, the Forger shaped gauntlets strong enough to hold it up until creation could stand on its own. Atlas has carried the weight of the world once already. No burden since has ever felt heavy.',
 'atlas.png', true),

(82, 'Titan', 'Greatsword', 'Genesis', 'Greek', 'titan', 'Forgefire Veins',
 'The wielder heals for 30% of all damage dealt. Healing increases to 50% while below 50% HP. Once per battle, upon taking fatal damage, survive at 1 HP and gain +100% damage until the end of battle.',
 'From the Greek primordial giants who ruled before the gods, the raw first draft of divinity. The last weapon the Forger made, and the only one never completed. It still burns with unfinished creation fire at its core. Legends say the blade grows closer to completion with every worthy Knight who carries it.',
 'titan.png', true);
```

Schema notes:
- Type values follow your existing table convention, so "Gloves" is used instead of "Gauntlets." If your bot uses a different value for greatswords, change "Greatsword" to match your existing type list.
- If your table stores base stats in separate columns (attack, crit_rate, crit_damage), add them with the values 1600, 20, and 50.
- Single quotes inside text are escaped as doubled quotes ('') for SQL compatibility.

---

## items.txt Append (Emoji Registry)

The five Genesis weapons were also appended into `items.txt` for their emoji name and emoji ID. Upload the five weapon images as custom emojis in your Discord server first, then replace the placeholder IDs below with the real emoji IDs.

```txt
kiri:<EMOJI_ID_HERE>
moira:<EMOJI_ID_HERE>
sophia:<EMOJI_ID_HERE>
atlas:<EMOJI_ID_HERE>
titan:<EMOJI_ID_HERE>
```

Tip: to get an emoji ID in Discord, type the emoji in chat with a backslash in front (for example `\:kiri:`) and it will print the full form `<:kiri:123456789012345678>`. The long number is the ID.

---

*Genesis Tier design complete. Five weapons, five classes, five colors, zero overlap.*
