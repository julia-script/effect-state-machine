# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top
- Comments append under a `## Comments` heading

## Publishing and fetching

When a skill publishes to the issue tracker, create the appropriate file under `.scratch/<feature-slug>/`.

When fetching a ticket, read the referenced path or issue number.

## Wayfinding operations

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- `Type:` records `research`, `prototype`, `grilling`, or `task`
- `Status:` records `claimed` or `resolved`
- `Blocked by:` records ticket dependencies
- The frontier consists of open, unblocked, unclaimed tickets
- Claim a ticket before working by setting `Status: claimed`
- Resolve it by adding `## Answer`, setting `Status: resolved`, and linking its decision from the map
