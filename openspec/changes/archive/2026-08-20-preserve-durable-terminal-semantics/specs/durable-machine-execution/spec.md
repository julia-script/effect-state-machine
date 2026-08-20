## ADDED Requirements

### Requirement: Durable activity exit classification preserves Cause semantics

An activity worker SHALL route only a terminal Cause containing typed failure values and no defects or interruptions through the authored allowed-failure Schema. A Cause containing interruption MUST leave the activity outcome uncommitted so the same command can be redelivered with its stable execution key. A Cause containing a defect MUST be represented as a durable defect outcome and MUST NOT be reduced as an authored failure, including when the Cause also contains a typed failure.

#### Scenario: Activity fails only in the typed channel

- **WHEN** an activity terminates with a typed failure and no defect or interruption
- **THEN** the worker encodes that failure with the declared error Schema and publishes a failure outcome

#### Scenario: Activity is interrupted by scope shutdown

- **WHEN** an activity worker is interrupted before its outcome commit succeeds
- **THEN** it does not acknowledge the activity or publish a failure or defect outcome, and the command remains eligible for redelivery

#### Scenario: Parallel activity has a compound failure and defect

- **WHEN** an activity terminates with a Cause containing both a typed failure and a defect
- **THEN** the durable instance observes a defect outcome and does not select the authored failure transition

### Requirement: Terminal checkpoints isolate owned durable work

A checkpoint committed as completed or defected SHALL atomically make all timers, activity commands, aggregate progress, and queued outcomes owned by its former active entry ineligible. No later delivery from that entry MAY advance, revive, or otherwise update the terminal instance.

#### Scenario: Another lane finishes after a defect

- **WHEN** one aggregate lane defects the instance while another activity for the same entry is still running
- **THEN** the other activity cannot publish an applicable outcome or advance the defected checkpoint

#### Scenario: Terminal instance is polled

- **WHEN** machine and activity workers poll an instance whose authoritative checkpoint is completed or defected
- **THEN** the store returns no claim for work owned by that instance

#### Scenario: Already claimed outcome arrives after termination

- **WHEN** a delivery that was claimed before termination attempts to commit afterward
- **THEN** fencing or terminal-state validation rejects it without changing the terminal checkpoint
