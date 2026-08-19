import { randomUUID } from "node:crypto"
import * as Effect from "effect/Effect"
import { Client } from "pg"
import * as Storage from "../src/server/Storage.js"

const defaultUrl =
  "postgresql://bugs_and_patches:bugs_and_patches_dev@127.0.0.1:55432/bugs_and_patches"

const adminUrl = process.env.BUGS_PATCHES_TEST_DATABASE_URL ?? defaultUrl

const databaseName = () => `bugs_patches_test_${randomUUID().replaceAll("-", "")}`

const urlFor = (name: string) => {
  const url = new URL(adminUrl)
  url.pathname = `/${name}`
  return url.toString()
}

const executeAdmin = (statement: string) =>
  Effect.acquireUseRelease(
    Effect.tryPromise({
      try: async () => {
        const client = new Client({ connectionString: adminUrl })
        await client.connect()
        return client
      },
      catch: (cause) => cause,
    }),
    (client) => Effect.tryPromise({ try: () => client.query(statement), catch: (cause) => cause }),
    (client) => Effect.promise(() => client.end()),
  )

export const withDatabase = <A, E, R>(
  use: (databaseUrl: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | unknown, R> => {
  const name = databaseName()
  return Effect.acquireUseRelease(
    executeAdmin(`CREATE DATABASE "${name}"`).pipe(Effect.as(urlFor(name))),
    use,
    () => executeAdmin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`).pipe(Effect.asVoid),
  )
}

export const storageLayer = (databaseUrl: string) => Storage.layer(databaseUrl, "drizzle")
