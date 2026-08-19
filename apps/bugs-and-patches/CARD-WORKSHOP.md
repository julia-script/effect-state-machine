# Bugs & Patches card workshop

This is the human design notebook for the larger card pool. The first playable Stack has now been selected and implemented; everything outside that section remains a candidate. All values are intentionally provisional until playtesting gives us better opinions.

No artwork or client presentation is decided here.

## Vocabulary we have chosen

- A player's 30-card deck is their **Stack**.
- **Bugs** are offensive cards.
- **Patches** are reactive defensive cards.
- **Side Effects** introduce one-shot tools, events, workflows, and engineering chaos.
- Bugs and Patches do not need secondary effects. A good plain numeric card is useful for teaching and balance.

## Bug candidates

- **Off-by-one** — A solid attack. After it resolves, discard the most recently drawn card remaining in your hand.
- **Null Pointer** — Our uncomplicated baseline Bug: dependable attack with no secondary effect.
- **Race Condition** — Draw a card and then discard one randomly.
- **Heisenbug** — Undefendable; attempting to observe it would rather spoil the point.
- **0-day** — Expensive, exceptional attack, and undefendable. This should feel rare and frightening.
- **Y2K Bug** — Large attack that also damages its owner.
- **DDoS** — Prevent the opponent from playing a Bug during their next turn.
- **SQL Injection** — Make the opponent discard a random card.
- **Stack Overflow** — Very high attack followed by Uptime damage to its owner.

Still in the wider brainstorm: **Memory Leak**, **Infinite Loop**, **Buffer Overflow**, **Deadlock**, **Segmentation Fault**, **Unhandled Exception**, **Flaky Test**, and **Regex Catastrophe**.

## Unsorted backlog ideas

- **Demo Day** — “Your attacks have a 50% chance of working.” Card type, target, duration, and exact mechanic are intentionally undecided.
- **AI Slop** — Name captured; mechanic intentionally undecided.

## Patch candidates

- **git revert** — Undo the most recently applied ongoing effect on yourself.
- **Switch On and Off** — A costly, extremely strong defense that clears all negative ongoing effects and prohibitions from you.
- **Restore from Backup** — Defend, then recover Uptime.
- **Errors as Values** — Modest defense followed by drawing a card.
- **Works on My Machine** — Almost no conventional defense; reflect the unresolved damage back to the Bug's owner.
- **Cache Invalidation** — Remove all ongoing effects from both players, including helpful ones.
- **Bounds Check** — Dependable plain defense with no secondary effect.
- **Borrow Checker** — Exceptional defense, but you cannot play a Bug during your next turn.
- **Containerize** — Isolate and cancel the Bug's secondary effect while leaving its base attack intact.

## Side Effect candidates

- **Merge Conflict** — Both players discard one random card, then you draw one.
- **Friday Night Release** — Flip a coin: gain Uptime on success or lose Uptime on failure. “The tests were green enough.”
- **Rubber Duck Debugging** — Draw two cards, then discard one.
- **Read the Docs** — Draw two cards. Simple, responsible, suspiciously effective.
- **Coffee Break** — Recover Uptime.
- **Pair Programming** — Draw cards and recover a little Uptime.
- **Technical Debt** — Draw three cards immediately, then lose Uptime over the next three turns.
- **Refactor** — Discard any number of cards, then draw that many plus one.
- **Garbage Collection** — Shuffle your discard pile into your Stack, then draw a card.
- **Feature Flag** — Cancel one ongoing effect from either player.
- **Feature Freeze** — Prevent the opponent from playing a Bug during their next turn.
- **Ship It!** — Make your next Bug undefendable.
- **Hackathon** — Draw three cards, but lose your next Patch opportunity.
- **Force Push** — The opponent discards two random cards; you discard one.
- **Continuous Integration** — Cancel one ongoing-damage effect and draw a card.
- **LGTM** — Draw one card for free. No questions asked.

## Executable v0 Stack

This is the exact 30-card Stack currently used by both players. `src/game/Catalog.ts` is the executable source of truth for wording and mechanics.

### Bugs — 12 cards

- 2 × **Off-by-one** — cost 4, attack 12; discard your most recently drawn remaining hand card.
- 2 × **Null Pointer** — cost 4, attack 12; no secondary effect.
- 2 × **Heisenbug** — cost 8, attack 12; undefendable.
- 2 × **DDoS** — cost 8, attack 8; prohibit the opponent's next Bug opportunity.
- 2 × **SQL Injection** — cost 8, attack 8; the opponent discards one random card.
- 1 × **Stack Overflow** — cost 8, attack 20; its owner loses 8 additional Uptime.
- 1 × **0-day** — cost 20, attack 32; undefendable.

### Patches — 10 cards

- 2 × **git revert** — cost 4, defense 12; remove your latest ongoing effect.
- 2 × **Switch On and Off** — cost 12, defense 28; remove your damaging ongoing effects and prohibitions.
- 2 × **Restore from Backup** — cost 8, defense 12; gain 12 Uptime after defending.
- 2 × **Works on My Machine** — cost 4, defense 4; redirect remaining base damage to the Bug's owner.
- 2 × **Containerize** — cost 4, defense 12; cancel the Bug's secondary abilities.

### Side Effects — 8 cards

- 2 × **Merge Conflict** — cost 4; both players discard one random card, then its owner draws one.
- 2 × **Friday Night Release** — cost 4; a server-seeded 50/50 check gains or loses 20 Uptime.
- 2 × **Technical Debt** — cost 0; draw three, then lose 4 Uptime at the end of each of your next three turns.
- 2 × **LGTM** — cost 0; draw one.

## Later design decisions

1. Playtest before treating any number as final balance.
2. Decide which candidates graduate into the larger collectible pool.
3. Decide how players construct custom Stacks once the fixed demo Stack has done its job.
4. Design card art, presentation, and the real client separately from these mechanics.
