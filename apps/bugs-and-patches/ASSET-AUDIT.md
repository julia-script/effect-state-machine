# Card illustration audit

The client uses 16 SVG illustrations from the supplied `Bugs & Patches Card Game.zip` design handoff. The archive is a visual reference only; none of its HTML or JavaScript is executed, copied, or bundled.

On 2026-08-18, every SVG in the archive was scanned before use for:

- `<script>` elements
- inline event handlers such as `onclick`
- remote `href` or `xlink:href` values
- `<foreignObject>` elements
- `data:` and `javascript:` URLs
- CSS `@import` rules

No findings were present in any archived SVG. The app copies only the current 16 card illustrations into `src/client/assets/cards` and adds one locally authored neutral fallback. The art registry records these handoff filename aliases:

- `git-revert` ← `rollback.svg`
- `switch-on-and-off` ← `off-and-on.svg`
- `restore-from-backup` ← `restore-backup.svg`
- `works-on-my-machine` ← `works-machine.svg`
- `friday-night-release` ← `friday-release.svg`
- `technical-debt` ← `tech-debt.svg`

All copied SVGs are loaded as Vite image assets, never injected as markup.
