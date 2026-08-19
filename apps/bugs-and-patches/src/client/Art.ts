import fallback from "./assets/cards/fallback.svg"
import containerize from "./assets/cards/containerize.svg"
import ddos from "./assets/cards/ddos.svg"
import fridayNightRelease from "./assets/cards/friday-night-release.svg"
import gitRevert from "./assets/cards/git-revert.svg"
import heisenbug from "./assets/cards/heisenbug.svg"
import lgtm from "./assets/cards/lgtm.svg"
import mergeConflict from "./assets/cards/merge-conflict.svg"
import nullPointer from "./assets/cards/null-pointer.svg"
import offByOne from "./assets/cards/off-by-one.svg"
import restoreFromBackup from "./assets/cards/restore-from-backup.svg"
import sqlInjection from "./assets/cards/sql-injection.svg"
import stackOverflow from "./assets/cards/stack-overflow.svg"
import switchOnAndOff from "./assets/cards/switch-on-and-off.svg"
import technicalDebt from "./assets/cards/technical-debt.svg"
import worksOnMyMachine from "./assets/cards/works-on-my-machine.svg"
import zeroDay from "./assets/cards/zero-day.svg"

export const cardArt = {
  "off-by-one": offByOne,
  "null-pointer": nullPointer,
  heisenbug,
  ddos,
  "sql-injection": sqlInjection,
  "stack-overflow": stackOverflow,
  "zero-day": zeroDay,
  "git-revert": gitRevert,
  "switch-on-and-off": switchOnAndOff,
  "restore-from-backup": restoreFromBackup,
  "works-on-my-machine": worksOnMyMachine,
  containerize,
  "merge-conflict": mergeConflict,
  "friday-night-release": fridayNightRelease,
  "technical-debt": technicalDebt,
  lgtm,
} as const

export type IllustratedCardId = keyof typeof cardArt

export const artFor = (cardId: string): string =>
  Object.hasOwn(cardArt, cardId) ? cardArt[cardId as IllustratedCardId] : fallback

export const artAliases = {
  "git-revert": "rollback.svg",
  "switch-on-and-off": "off-and-on.svg",
  "restore-from-backup": "restore-backup.svg",
  "works-on-my-machine": "works-machine.svg",
  "friday-night-release": "friday-release.svg",
  "technical-debt": "tech-debt.svg",
} as const
