/**
 * Public durable-execution façade.
 *
 * Protocol declarations live in a package-private leaf so adapters and the runner never depend
 * back through this public module.
 *
 * @since 0.2.0
 */

export {
  type StoreConformanceCase,
  type StoreConformanceTopic,
  storeConformance,
  storeConformanceTopics,
} from "./DurableConformance.js"
export { layerMemory, makeMemoryStore } from "./DurableMemory.js"
export * from "./DurableProtocol.js"
export { run } from "./DurableRunner.js"
