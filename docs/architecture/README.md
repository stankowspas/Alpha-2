# Architecture — Alpha Chat 2.0

The current source of truth is `CANONICAL_ARCHITECTURE.md`.

Current core rule: every user request is executed as one `MODEL` step. There is no automatic routing, no request-type classification and no regex/heuristic capability selection in `ApplicationCore`.

Lower-level Search, Retrieval, Weather, Time and Calculator code may exist as independent modules, but the active chat core does not choose or execute them automatically.

Historical architecture documents were moved into the snapshot created before the routing/heuristic removal.
