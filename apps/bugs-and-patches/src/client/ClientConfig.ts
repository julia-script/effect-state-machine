export const serverUrlFromEnv = (value: string | undefined, fallback: string): string => {
  const parsed = new URL(value ?? fallback)
  if (
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0 ||
    (parsed.protocol !== "https:" &&
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "localhost")
  ) {
    throw new Error(
      "VITE_BUGS_PATCHES_SERVER_URL must be an HTTPS origin, except for loopback development.",
    )
  }
  return parsed.origin
}
