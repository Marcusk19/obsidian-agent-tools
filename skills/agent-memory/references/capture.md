# Memory capture

Store individual durable memories under `3_Resource/agent memory/` with stable
semantic filenames:

- `Correction - <short rule>.md`
- `Preference - <short preference>.md`
- `Recurring problem - <short problem>.md`

Do not put dates in filenames.

## Capture criteria

- **Correction:** the user clearly provides a replacement rule. Mark clear user
  corrections `confirmed`. Tentative discussion or the agent changing its own
  plan is not a correction.
- **Preference:** the user explicitly states a durable reusable preference. Do
  not infer one from a single incidental choice.
- **Recurring problem:** a failure reveals a behavior-changing reusable rule.
  A strong first incident may be `provisional`; promote it after recurrence,
  successful validation, documentation, or user confirmation.

Ignore transient network failures, typos, and isolated errors without a reusable
lesson. Never capture secrets, sensitive personal data, or raw transcripts.

## Search before writing

1. Search the memory folder for the rule, tool/repository, key terms, and synonyms.
2. Read close matches and compare status, confidence, and scope.
3. Update an existing note when it expresses the same rule.
4. Do not leave contradictory active rules. Update the existing note or mark it
   superseded and link a distinct replacement.
5. Refresh `last_confirmed` when confirmed evidence reinforces a memory.

Project/workstream context belongs in a stable living note under `1_Projects/`,
not in the durable-memory folder. Ordinary always-on capture must not create or
update project files unless the user explicitly requests consolidation or
handover.
