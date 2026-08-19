export type Route = "lobby" | "battle" | "how-to-play" | "stack" | "leaderboard" | "settings"

const routePaths: Readonly<Record<Route, string>> = {
  lobby: "/",
  battle: "/battle",
  "how-to-play": "/how-to-play",
  stack: "/stack",
  leaderboard: "/leaderboard",
  settings: "/settings",
}

export const pathFor = (route: Route): string => routePaths[route]

export const routeFromPath = (pathname: string): Route => {
  const found = (Object.entries(routePaths) as ReadonlyArray<readonly [Route, string]>).find(
    ([, path]) => path === pathname,
  )
  return found?.[0] ?? "lobby"
}

export const navigate = (route: Route): void => {
  history.pushState({}, "", pathFor(route))
  scrollTo(0, 0)
  dispatchEvent(new PopStateEvent("popstate"))
}
