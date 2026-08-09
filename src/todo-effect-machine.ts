import { Context, Data, Effect, Layer, Ref } from "effect"
import { Machine, type MachineHandle, type MachineRequirements } from "./effect-machine"

export type Todo = Readonly<{
  id: string
  title: string
  completed: boolean
}>

class EmptyTitle extends Data.TaggedError("EmptyTitle")<{
  readonly message: string
}> {}

class DuplicateTitle extends Data.TaggedError("DuplicateTitle")<{
  readonly message: string
}> {}

class TodoNotFound extends Data.TaggedError("TodoNotFound")<{
  readonly message: string
}> {}

class StorageUnavailable extends Data.TaggedError("StorageUnavailable")<{
  readonly message: string
}> {}

export type TodoError = EmptyTitle | DuplicateTitle | TodoNotFound | StorageUnavailable

const unavailable: Effect.Effect<ReadonlyArray<Todo>, TodoError> = Effect.gen(function* () {
  yield* Effect.sleep("1400 millis")
  return yield* Effect.fail(
    new StorageUnavailable({
      message: "The selected Todos adapter rejects writes.",
    }),
  )
})

type TodosShape = Readonly<{
  list: Effect.Effect<ReadonlyArray<Todo>, TodoError>
  add: (title: string) => Effect.Effect<ReadonlyArray<Todo>, TodoError>
  toggle: (id: string) => Effect.Effect<ReadonlyArray<Todo>, TodoError>
  remove: (id: string) => Effect.Effect<ReadonlyArray<Todo>, TodoError>
  clearCompleted: Effect.Effect<ReadonlyArray<Todo>, TodoError>
}>

/** The capability required by the machine. No implementation is selected here. */
export class Todos extends Context.Service<Todos, TodosShape>()("Todos") {
  static readonly Memory = Layer.effect(this)(
    Effect.gen(function* () {
      const store = yield* Ref.make({
        todos: [] as ReadonlyArray<Todo>,
        nextId: 1,
      })

      return {
        list: Effect.gen(function* () {
          yield* Effect.sleep("900 millis")
          return (yield* Ref.get(store)).todos
        }),

        add: (untrimmedTitle) =>
          Effect.gen(function* () {
            yield* Effect.sleep("1400 millis")
            const title = untrimmedTitle.trim()
            const current = yield* Ref.get(store)

            if (title.length === 0) {
              return yield* Effect.fail(new EmptyTitle({ message: "A todo needs a title." }))
            }
            if (
              current.todos.some(
                (todo) => todo.title.toLocaleLowerCase() === title.toLocaleLowerCase(),
              )
            ) {
              return yield* Effect.fail(
                new DuplicateTitle({
                  message: `“${title}” is already on the list.`,
                }),
              )
            }

            const next = {
              todos: [
                ...current.todos,
                {
                  id: `todo-${current.nextId}`,
                  title,
                  completed: false,
                },
              ],
              nextId: current.nextId + 1,
            }
            yield* Ref.set(store, next)
            return next.todos
          }),

        toggle: (id) =>
          Effect.gen(function* () {
            yield* Effect.sleep("1400 millis")
            const current = yield* Ref.get(store)
            const todo = current.todos.find((candidate) => candidate.id === id)
            if (todo === undefined) {
              return yield* Effect.fail(
                new TodoNotFound({ message: "That todo no longer exists." }),
              )
            }

            const todos = current.todos.map((candidate) =>
              candidate.id === id ? { ...candidate, completed: !candidate.completed } : candidate,
            )
            yield* Ref.set(store, { ...current, todos })
            return todos
          }),

        remove: (id) =>
          Effect.gen(function* () {
            yield* Effect.sleep("1400 millis")
            const current = yield* Ref.get(store)
            if (!current.todos.some((candidate) => candidate.id === id)) {
              return yield* Effect.fail(
                new TodoNotFound({ message: "That todo no longer exists." }),
              )
            }

            const todos = current.todos.filter((candidate) => candidate.id !== id)
            yield* Ref.set(store, { ...current, todos })
            return todos
          }),

        clearCompleted: Effect.gen(function* () {
          yield* Effect.sleep("1400 millis")
          const current = yield* Ref.get(store)
          const todos = current.todos.filter((todo) => !todo.completed)
          yield* Ref.set(store, { ...current, todos })
          return todos
        }),
      }
    }),
  )

  static readonly Failing = Layer.succeed(this)({
    list: Effect.succeed([]),
    add: () => unavailable,
    toggle: () => unavailable,
    remove: () => unavailable,
    clearCompleted: unavailable,
  })
}

export type TodoState =
  | Readonly<{ _tag: "Loading" }>
  | Readonly<{
      _tag: "Idle"
      todos: ReadonlyArray<Todo>
      error: TodoError | null
      outcome: string
    }>
  | Readonly<{
      _tag: "Adding"
      todos: ReadonlyArray<Todo>
      title: string
    }>
  | Readonly<{
      _tag: "Toggling"
      todos: ReadonlyArray<Todo>
      id: string
    }>
  | Readonly<{
      _tag: "Deleting"
      todos: ReadonlyArray<Todo>
      id: string
    }>
  | Readonly<{
      _tag: "Clearing"
      todos: ReadonlyArray<Todo>
    }>
  | Readonly<{
      _tag: "Crashed"
      cause: string
    }>

export type TodoEvent =
  | Readonly<{ _tag: "Add"; title: string }>
  | Readonly<{ _tag: "Toggle"; id: string }>
  | Readonly<{ _tag: "Delete"; id: string }>
  | Readonly<{ _tag: "ClearCompleted" }>
  | Readonly<{ _tag: "Cancel" }>
  | Readonly<{ _tag: "Restart" }>

const idle = (
  todos: ReadonlyArray<Todo>,
  outcome: string,
  error: TodoError | null = null,
): TodoState => ({ _tag: "Idle", todos, outcome, error })

const crashed = (cause: string): TodoState => ({ _tag: "Crashed", cause })

const todo = Machine.builder<TodoState, TodoEvent>()

export const todoDefinition = todo.make({
  id: "effectTodo",
  initial: { _tag: "Loading" },
  nodes: [
    todo.invoke("Loading", {
      source: "Todos.list",
      effect: () => Effect.flatMap(Todos, (_) => _.list),
      onSuccess: {
        target: "Idle",
        reduce: ({ value }) => idle(value, "Loaded todos through the provided adapter."),
      },
      onFailure: {
        target: "Idle",
        reduce: ({ error }) => idle([], `Loading failed: ${error.message}`, error),
      },
      onDefect: {
        target: "Crashed",
        reduce: ({ cause }) => crashed(cause),
      },
    }),

    todo.state("Idle", {
      on: {
        Add: {
          target: "Adding",
          reduce: ({ state, event }) => ({
            _tag: "Adding",
            todos: state.todos,
            title: event.title,
          }),
        },
        Toggle: {
          target: "Toggling",
          reduce: ({ state, event }) => ({
            _tag: "Toggling",
            todos: state.todos,
            id: event.id,
          }),
        },
        Delete: {
          target: "Deleting",
          reduce: ({ state, event }) => ({
            _tag: "Deleting",
            todos: state.todos,
            id: event.id,
          }),
        },
        ClearCompleted: {
          target: "Clearing",
          reduce: ({ state }) => ({
            _tag: "Clearing",
            todos: state.todos,
          }),
        },
      },
    }),

    todo.invoke("Adding", {
      source: "Todos.add",
      effect: (state) => Effect.flatMap(Todos, (_) => _.add(state.title)),
      onSuccess: {
        target: "Idle",
        reduce: ({ state, value }) => idle(value, `Added “${state.title}”.`),
      },
      onFailure: {
        target: "Idle",
        reduce: ({ state, error }) => idle(state.todos, `Add failed: ${error.message}`, error),
      },
      onDefect: {
        target: "Crashed",
        reduce: ({ cause }) => crashed(cause),
      },
      on: {
        Cancel: {
          target: "Idle",
          reduce: ({ state }) => idle(state.todos, "Add cancelled."),
        },
      },
    }),

    todo.invoke("Toggling", {
      source: "Todos.toggle",
      effect: (state) => Effect.flatMap(Todos, (_) => _.toggle(state.id)),
      onSuccess: {
        target: "Idle",
        reduce: ({ value }) => idle(value, "Todo toggled."),
      },
      onFailure: {
        target: "Idle",
        reduce: ({ state, error }) => idle(state.todos, `Toggle failed: ${error.message}`, error),
      },
      onDefect: {
        target: "Crashed",
        reduce: ({ cause }) => crashed(cause),
      },
      on: {
        Cancel: {
          target: "Idle",
          reduce: ({ state }) => idle(state.todos, "Toggle cancelled."),
        },
      },
    }),

    todo.invoke("Deleting", {
      source: "Todos.remove",
      effect: (state) => Effect.flatMap(Todos, (_) => _.remove(state.id)),
      onSuccess: {
        target: "Idle",
        reduce: ({ value }) => idle(value, "Todo deleted."),
      },
      onFailure: {
        target: "Idle",
        reduce: ({ state, error }) => idle(state.todos, `Delete failed: ${error.message}`, error),
      },
      onDefect: {
        target: "Crashed",
        reduce: ({ cause }) => crashed(cause),
      },
      on: {
        Cancel: {
          target: "Idle",
          reduce: ({ state }) => idle(state.todos, "Delete cancelled."),
        },
      },
    }),

    todo.invoke("Clearing", {
      source: "Todos.clearCompleted",
      effect: () => Effect.flatMap(Todos, (_) => _.clearCompleted),
      onSuccess: {
        target: "Idle",
        reduce: ({ value }) => idle(value, "Completed todos cleared."),
      },
      onFailure: {
        target: "Idle",
        reduce: ({ state, error }) => idle(state.todos, `Clear failed: ${error.message}`, error),
      },
      onDefect: {
        target: "Crashed",
        reduce: ({ cause }) => crashed(cause),
      },
      on: {
        Cancel: {
          target: "Idle",
          reduce: ({ state }) => idle(state.todos, "Clear cancelled."),
        },
      },
    }),

    todo.state("Crashed", {
      on: {
        Restart: {
          target: "Loading",
          reduce: () => ({ _tag: "Loading" }),
        },
      },
    }),
  ],
})

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assert<T extends true> = T

// This fails compilation if the machine stops inferring its Todos requirement.
type TodoMachineRequiresTodos = Assert<Equal<MachineRequirements<typeof todoDefinition>, Todos>>
void (null as unknown as TodoMachineRequiresTodos)

/** The Effect-native application API. Consumers choose how and where to run it. */
export class TodoApp extends Context.Service<TodoApp, MachineHandle<TodoState, TodoEvent>>()(
  "TodoApp",
) {
  static readonly layer = Layer.effect(this)(Machine.run(todoDefinition))
}

export type TodoAdapter = "memory" | "failing"
