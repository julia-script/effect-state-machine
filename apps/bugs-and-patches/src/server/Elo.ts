export interface Ratings {
  readonly winner: number
  readonly loser: number
}

const K = 32

const expected = (rating: number, opponent: number) => 1 / (1 + 10 ** ((opponent - rating) / 400))

export const apply = (winner: number, loser: number): Ratings => ({
  winner: Math.round(winner + K * (1 - expected(winner, loser))),
  loser: Math.round(loser + K * (0 - expected(loser, winner))),
})
