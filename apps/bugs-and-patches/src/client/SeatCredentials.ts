export interface SeatCredentials {
  readonly matchId: string
  readonly seatToken: string
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const seatStorageKey = "bugs-and-patches:seat"

export const readSeat = (storage: StorageLike): SeatCredentials | null => {
  const raw = storage.getItem(seatStorageKey)
  if (raw === null) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === "object" &&
      value !== null &&
      "matchId" in value &&
      "seatToken" in value &&
      typeof value.matchId === "string" &&
      typeof value.seatToken === "string"
    ) {
      return { matchId: value.matchId, seatToken: value.seatToken }
    }
  } catch {
    // Invalid credentials are cleared below.
  }
  storage.removeItem(seatStorageKey)
  return null
}

export const writeSeat = (storage: StorageLike, credentials: SeatCredentials): void => {
  storage.setItem(seatStorageKey, JSON.stringify(credentials))
}

export const clearSeat = (storage: StorageLike): void => storage.removeItem(seatStorageKey)
