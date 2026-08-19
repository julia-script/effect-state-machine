/**
 * Browser navigation and non-browser clients may omit Origin. When a browser
 * supplies it for credentialed HTTP or a WebSocket upgrade, it must identify
 * the one configured client deployment.
 */
export const isAllowed = (origin: string | undefined, clientUrl: string): boolean => {
  return origin === undefined || origin === clientUrl
}
