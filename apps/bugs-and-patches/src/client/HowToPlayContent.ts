export const howToPlaySections = [
  {
    id: "objective",
    title: "Keep production alive",
    copy: "Each player begins at 100 Uptime. Reduce your opponent to 0, or make them surrender, before your own service goes down.",
  },
  {
    id: "setup",
    title: "Shuffle the Stack",
    copy: "Each player gets a separately shuffled 30-card Stack and draws five cards. A random first player draws one extra card.",
  },
  {
    id: "bug",
    title: "Ship a Bug",
    copy: "The active player may play one Bug or pass. Pay its Uptime cost first. A card can never leave you below 1 Uptime.",
  },
  {
    id: "patch",
    title: "Answer with a Patch",
    copy: "The defender may play one Patch or pass. Base damage is attack minus defense, never less than zero. Some Bugs are undefendable.",
  },
  {
    id: "side-effect",
    title: "Resolve Side Effects",
    copy: "After the Bug and Patch resolve, the active player may play one Side Effect or pass. Printed abilities resolve in order.",
  },
  {
    id: "next-turn",
    title: "Hand over the pager",
    copy: "Discarded cards recycle when a Stack runs out. Ongoing effects tick at their stated timing, then the other player becomes active.",
  },
] as const

export const modeCopy = {
  Friendly: "Invite someone you know. Friendly matches never change rating.",
  Ranked: "Meet a random player. Ranked results change rating, and a disconnect has a 60-second reconnect window.",
} as const

export const playAction = (signedIn: boolean, serverUrl: string) =>
  signedIn
    ? { label: "Play now", href: "/", internal: true }
    : { label: "Sign in to play", href: `${serverUrl}/auth/github`, internal: false }
