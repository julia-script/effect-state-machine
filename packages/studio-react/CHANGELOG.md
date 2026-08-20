# @effect-state-machine/studio-react

## 0.3.0

### Minor Changes

- [`2d05988`](https://github.com/julia-script/effect-state-machine/commit/2d0598854f301eb17f11290ff1d89090da503035) Thanks [@julia-script](https://github.com/julia-script)! - Add guarded and named declarative timers, expose their metadata through the Studio protocol, and surface timer details in Studio.

- [#10](https://github.com/julia-script/effect-state-machine/pull/10) [`20afdc1`](https://github.com/julia-script/effect-state-machine/commit/20afdc171229a0520e2a5d8ce7fe5ba3e2fe64cc) Thanks [@julia-script](https://github.com/julia-script)! - Unify machine execution behind `MachineEngine`, add resumable aggregate persistence with memory and browser-local stores, require stable work identities, and add the optional Effect Workflow integration.
  
  Remove the pre-release `Durable` and process-local execution APIs, and update Studio to replay the persisted machine-tree journal.

### Patch Changes

- Updated dependencies [[`2d05988`](https://github.com/julia-script/effect-state-machine/commit/2d0598854f301eb17f11290ff1d89090da503035), [`20afdc1`](https://github.com/julia-script/effect-state-machine/commit/20afdc171229a0520e2a5d8ce7fe5ba3e2fe64cc)]:
  - effect-state-machine@0.3.0
  - @effect-state-machine/studio-client@0.3.0

## 0.1.1

### Patch Changes

- [`42468ec`](https://github.com/julia-script/effect-state-machine/commit/42468ecf998b0b5f0329e9018be2be33f2f8a064) Thanks [@julia-script](https://github.com/julia-script)! - Add repository, homepage, and bugs metadata plus package READMEs so npm pages link back to GitHub. Trim Studio's runtime dependencies to its true externals and relax studio-react's react peer range to ^19.2.8.
- Updated dependencies [[`42468ec`](https://github.com/julia-script/effect-state-machine/commit/42468ecf998b0b5f0329e9018be2be33f2f8a064)]:
  - effect-state-machine@0.1.1
  - @effect-state-machine/studio-client@0.1.1
