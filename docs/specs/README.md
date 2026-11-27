# Specs

A spec says **what** a change must do and **how we'll know it's done**,
before any code is written. It's the contract between whoever asks for a
change, whoever implements it (a person or an agent) and whoever reviews it.

## When to write one

Write a spec for anything that changes behavior people or sources can see:
a new source, a new filter, a change to closing, dedup or the API. Skip it
for refactors, dependency bumps, copy fixes and bug fixes with an obvious
expected behavior (the issue is the spec).

## Lifecycle

1. **Draft:** copy [`TEMPLATE.md`](TEMPLATE.md) to `NNNN-short-name.md`
   (next free number) and fill it in. Link the issue.
2. **Open questions answered:** anything marked as unknown is checked
   (a spike: a few requests or a quick script, nothing merged) and the answer
   written into the spec. A spec with open questions isn't ready.
3. **Approved:** a person reads it and sets `Status: Approved`. From here,
   changing scope means editing the spec first: in the implementing PR,
   before the code that depends on the change.
4. **Implemented:** the PR that ships it links the spec, maps every
   acceptance criterion to the test or check that proves it, and sets
   `Status: Implemented`. Criteria tagged **[post-deploy]** can only be
   checked on production: they're checked after the first production run
   and their proof is added in a follow-up commit. If one fails, the spec
   goes back to `Approved` with a note.

The status lives only in the spec's header, so it can't drift.

## Rules for acceptance criteria

- Each one has an id made of the spec number and its own number
  (`0001-AC1`, `0001-AC2`, …), is written as *Given / When / Then*, and can
  be checked by a test or a command, not by opinion. "Handles errors well"
  isn't a criterion; "a 404 board closes nothing and is reported once" is.
- Every criterion is proved by a test whose name starts with its id
  (`it("0001-AC3: a 404 board closes nothing", …)`), or by a check named in
  the PR (a command and its output) when a test can't prove it. A grep for
  the id finds its proof.
- Non-goals are as important as goals: they stop scope creep, for people
  and for agents.

## For agents

Implement against the acceptance criteria, not the prose. If a criterion
is ambiguous, or the code shows it can't be met as written, stop and ask:
don't reinterpret the spec. The reviewer checks the diff against the spec
too, criterion by criterion.

## Index

- [0001 Teamtailor source](0001-teamtailor-source.md)
