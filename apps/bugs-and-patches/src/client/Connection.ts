import * as Effect from "effect/Effect"
import type * as Match from "../game/Match.js"
import * as Protocol from "../protocol/Protocol.js"
import { clearSeat, readSeat, type StorageLike, writeSeat } from "./SeatCredentials.js"

export type ConnectionKind =
  | "Lobby"
  | "Connecting"
  | "Queued"
  | "Waiting"
  | "Active"
  | "Disconnected"
  | "Error"

export interface ConnectionSnapshot {
  readonly kind: ConnectionKind
  readonly view: Protocol.PlayerView | null
  readonly matchId: string | null
  readonly inviteCode: string | null
  readonly agentChallenge: Protocol.AgentChallengeCreatorView | null
  readonly notice: string | null
  readonly pendingRequestId: string | null
  readonly hasSavedSeat: boolean
}

type Listener = () => void

const initialSnapshot = (hasSavedSeat: boolean): ConnectionSnapshot => ({
  kind: "Lobby",
  view: null,
  matchId: null,
  inviteCode: null,
  agentChallenge: null,
  notice: null,
  pendingRequestId: null,
  hasSavedSeat,
})

export const expireOpenChallenge = (
  snapshot: ConnectionSnapshot,
  now: number,
): ConnectionSnapshot =>
  snapshot.agentChallenge?.status === "Open" && snapshot.agentChallenge.expiresAt <= now
    ? {
        ...snapshot,
        kind: "Lobby",
        agentChallenge: { ...snapshot.agentChallenge, status: "Expired" },
        notice: "That agent challenge expired. Create a fresh link when you are ready.",
        hasSavedSeat: false,
      }
    : snapshot

export const applyAgentChallengeUpdate = (
  snapshot: ConnectionSnapshot,
  challenge: Protocol.AgentChallengeCreatorView,
): ConnectionSnapshot => {
  const ended = challenge.status === "Expired" || challenge.status === "Revoked"
  return {
    ...snapshot,
    kind: ended ? "Lobby" : snapshot.kind,
    agentChallenge: challenge,
    notice: null,
    hasSavedSeat: ended ? false : snapshot.hasSavedSeat,
  }
}

export class ConnectionController {
  private socket: WebSocket | null = null
  private seat: { readonly matchId: string; readonly seatToken: string } | null
  private listeners = new Set<Listener>()
  private snapshot: ConnectionSnapshot
  private intentionalClose = false

  constructor(
    private readonly socketUrl: string,
    private readonly storage: StorageLike,
  ) {
    this.seat = readSeat(storage)
    this.snapshot = initialSnapshot(this.seat !== null)
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private update(next: Partial<ConnectionSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next }
    for (const listener of this.listeners) listener()
  }

  private async send(message: Protocol.ClientMessage): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.update({
        kind: "Disconnected",
        notice: "The game connection is not open. Reconnect and try again.",
      })
      return
    }
    this.socket.send(await Effect.runPromise(Protocol.encodeClient(message)))
  }

  private connect(firstMessage: Protocol.ClientMessage): void {
    this.closeSocket()
    this.intentionalClose = false
    this.update({ kind: "Connecting", notice: null })
    const socket = new WebSocket(this.socketUrl)
    this.socket = socket
    socket.addEventListener("open", () => void this.send(firstMessage))
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      void Effect.runPromise(Protocol.decodeServer(event.data)).then(
        (message) => this.receive(message),
        () =>
          this.update({
            kind: "Error",
            notice: "The server sent a message this client could not read.",
          }),
      )
    })
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return
      if (!this.intentionalClose && this.snapshot.kind !== "Lobby") {
        this.update({
          kind: "Disconnected",
          notice: "Connection lost. Your seat is still saved on this device.",
        })
      }
    })
    socket.addEventListener("error", () => {
      if (this.socket !== socket) return
      this.update({
        kind: "Error",
        notice: "The game server could not be reached. Check that it is running, then retry.",
      })
    })
  }

  private receive(message: Protocol.ServerMessage): void {
    switch (message._tag) {
      case "FriendlyCreated":
      case "Joined":
      case "Matched": {
        this.seat = { matchId: message.matchId, seatToken: message.seatToken }
        writeSeat(this.storage, this.seat)
        this.update({
          kind: "Waiting",
          matchId: message.matchId,
          inviteCode: message._tag === "FriendlyCreated" ? message.inviteCode : null,
          agentChallenge: null,
          hasSavedSeat: true,
          notice: null,
        })
        return
      }
      case "AgentChallengeCreated": {
        this.seat = { matchId: message.matchId, seatToken: message.seatToken }
        writeSeat(this.storage, this.seat)
        this.update({
          kind: "Waiting",
          matchId: message.matchId,
          inviteCode: null,
          agentChallenge: message.challenge,
          hasSavedSeat: true,
          notice: null,
        })
        return
      }
      case "AgentChallengeUpdated": {
        this.update(applyAgentChallengeUpdate(this.snapshot, message.challenge))
        if (message.challenge.status === "Expired" || message.challenge.status === "Revoked") {
          this.clearSavedSeat()
          this.closeSocket()
        }
        return
      }
      case "Waiting":
        this.update({ kind: "Queued", notice: null })
        return
      case "LeftQueue":
        this.update({ kind: "Lobby", notice: null })
        this.closeSocket()
        return
      case "View": {
        const agentPlayer = message.view.players.find(({ identity }) => identity.kind === "Agent")
        const agentIdentity = agentPlayer?.identity.kind === "Agent" ? agentPlayer.identity : null
        this.update({
          kind: message.view.phase === "Waiting" ? "Waiting" : "Active",
          view: message.view,
          matchId: message.view.matchId,
          notice: null,
          agentChallenge:
            this.snapshot.agentChallenge === null
              ? null
              : {
                  ...this.snapshot.agentChallenge,
                  status: message.view.phase === "Finished" ? "Completed" : "Active",
                  agent: agentIdentity ?? this.snapshot.agentChallenge.agent,
                  agentPresence:
                    agentPlayer?.presence ?? this.snapshot.agentChallenge.agentPresence,
                },
        })
        if (message.view.phase === "Finished") this.clearSavedSeat()
        return
      }
      case "Acknowledged":
        this.update({
          kind: "Active",
          view: message.view,
          pendingRequestId: null,
          notice: null,
        })
        if (message.view.phase === "Finished") this.clearSavedSeat()
        return
      case "Rejected":
        if (message.code === "AccountRetired" || message.code === "InvalidToken") {
          this.clearSavedSeat()
        }
        this.update({
          kind: message.view === null ? "Error" : "Active",
          view: message.view ?? this.snapshot.view,
          pendingRequestId: null,
          notice: message.message,
        })
        return
    }
  }

  createFriendly(): void {
    this.connect({ _tag: "CreateFriendly" })
  }

  createAgentChallenge(): void {
    this.connect({ _tag: "CreateAgentChallenge" })
  }

  revokeAgentChallenge(): void {
    void this.send({ _tag: "RevokeAgentChallenge" })
  }

  refreshChallengeExpiry(now = Date.now()): void {
    const expired = expireOpenChallenge(this.snapshot, now)
    if (expired === this.snapshot) return
    this.snapshot = expired
    for (const listener of this.listeners) listener()
    this.seat = null
    clearSeat(this.storage)
    this.closeSocket()
  }

  joinFriendly(inviteCode: string): void {
    this.connect({ _tag: "JoinFriendly", inviteCode: inviteCode.trim().toUpperCase() })
  }

  joinRanked(): void {
    this.connect({ _tag: "JoinRankedQueue" })
  }

  leaveRanked(): void {
    void this.send({ _tag: "LeaveRankedQueue" })
  }

  reconnect(): void {
    const seat = this.seat ?? readSeat(this.storage)
    if (seat === null) {
      this.update({
        kind: "Lobby",
        hasSavedSeat: false,
        notice: "No saved match seat was found on this device.",
      })
      return
    }
    this.seat = seat
    this.connect({ _tag: "Reconnect", matchId: seat.matchId, seatToken: seat.seatToken })
  }

  command(event: Match.Event): void {
    if (this.snapshot.pendingRequestId !== null) return
    const requestId = crypto.randomUUID()
    this.update({ pendingRequestId: requestId, notice: null })
    void this.send({ _tag: "Command", requestId, event })
  }

  clearNotice(): void {
    this.update({ notice: null })
  }

  clearSavedSeat(): void {
    this.seat = null
    clearSeat(this.storage)
    this.update({ hasSavedSeat: false })
  }

  reset(): void {
    this.closeSocket()
    this.clearSavedSeat()
    this.snapshot = initialSnapshot(false)
    for (const listener of this.listeners) listener()
  }

  dispose(): void {
    this.closeSocket()
    this.listeners.clear()
  }

  private closeSocket(): void {
    this.intentionalClose = true
    this.socket?.close()
    this.socket = null
  }
}

export const websocketUrl = (serverUrl: string): string => {
  const url = new URL(Protocol.PATH, serverUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}
