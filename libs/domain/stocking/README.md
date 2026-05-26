# `@aquascape/domain/stocking`

Stocking-guidance rule engine. Plan Stage 7 F7.2.

- **Tags:** `scope:domain`, `framework:none`.
- **Status:** Stage 7 F7.2 — rule-based warnings (bioload, temperature, pH, temperament, schooling, fin-nippers).

Pure deterministic functions over a `Scene` + `Catalog`; no Angular, no DOM, no I/O. Every rule is independently testable and the aggregator concatenates results in a stable order (severity → code → relatedEntryIds).
