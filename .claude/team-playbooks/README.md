# Team playbooks

Claude Code agent teams are **experimental** (toggled on for this repo via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in `.claude/settings.json`) and **runtime-only** — there is no declarative team file the harness reads. Teams are created by _describing_ them in natural language inside an interactive Claude Code session, and Claude spawns teammates referencing the sub-agent definitions in `../agents/`.

This directory holds the **kickoff prompts** — the exact text to paste into Claude Code to spin up a team for a given task. Treat each file as a script: the prompt at the top is what you say to Claude; the rest is rationale and role expectations.

## Why playbooks instead of a config file

Per the Claude Code docs, `.claude/teams/*` is **not** recognized as configuration; runtime team state lives at `~/.claude/teams/{team-name}/`. So the only way to make a team reproducible across contributors is to commit the exact prompt that spawns it.

## When to use a team vs. a sub-agent

**Reach for a sub-agent (single `Task(subagent_type=…)` call) when:**

- The work is bounded to one specialist area.
- The plan or spec already dictates the interface — there's nothing to negotiate.
- You want a deterministic result back to the main session.
- Cost matters and you don't need cross-domain back-and-forth.

**Reach for an agent team when:**

- The work spans 3+ specialist areas that must _agree_ on an interface or contract.
- Designs are ambiguous and benefit from devil's-advocate / second-opinion teammates.
- You want emergent ordering (teammates self-coordinate via shared task list and direct messaging) rather than orchestrating yourself.
- Parallel exploration adds genuine value beyond what one specialist could produce.

## How a team is spawned

1. Open Claude Code in this repo.
2. Confirm the experimental flag is active (it's set in `.claude/settings.json`; new shells inherit it via Claude Code's env load).
3. Paste the relevant playbook's kickoff prompt into the session.
4. Claude creates the team, spawns teammates, and seeds a shared task list.
5. Use `Shift+Down` to cycle between teammate panes; `Ctrl+T` to view the task list.

## Playbooks in this directory

- [`stage-0-kickoff.md`](stage-0-kickoff.md) — Stage 0 foundation. Provided for completeness; **sub-agents are the recommended pattern here** (see the file for why).
- [`stage-4-planting-and-growth.md`](stage-4-planting-and-growth.md) — Stage 4. Strong fit for a team: planting tool, growth-sim engine, layers panel, and scatter all need to agree on contracts simultaneously.
