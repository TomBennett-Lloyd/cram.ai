---
name: triage
description: Convert tech-debt log entries into root-cause GitHub issues and mine the friction log for workflow patterns. Run every ~5 merged PRs, or when either log grows past a screenful.
---

Ported from cumulo (https://github.com/TomBennett-Lloyd/cumulo) on 2026-10-13. Citations of the form `cumulo#<n>` are the issues and PRs where each rule was earned there; this repo's own evidence accrues under bare `#<n>`.

You are running the periodic triage pass over both logs. The logs are buffers — your job is to empty them into well-formed issues.

**Tech debt** (`docs/tech-debt.md`):

1. Cluster related entries — same module, same pattern, same underlying cause.
2. For each cluster, identify the ROOT CAUSE, not the symptoms. Three entries about awkward error shapes in three files are one issue about the error model, not three issues.
3. `gh issue create --label tech-debt,discovered` — body: affected files, the entries' content, the root-cause analysis, a proposed fix direction, and acceptance criteria for "debt cleared".
4. Delete captured entries from the log (the issue now owns them). Before deleting each one, run `git grep -nF '<its title>' -- ':/'` and paste the command, output and exit code in the PR body; the entry's own heading is the positive control. Re-point every other hit at the capturing issue in the same PR, or, where that would edit a source file, add a row to the log's `## Captured-entry redirects` table. A grep for the log's path cannot see a citation by title: the #191 pass deleted two entries #133's code cited by title, one with no redirect row (PR #158, #293). Leave genuinely unrelated singletons.
5. Your pruning makes this file conflict with every branch open across the run, so state the resolution rule for whoever hits it: **resolve `docs/tech-debt.md` as a union of CHANGES, never a union of lines** — take main's pruned file as the base and re-apply only the branch's own additions, because a line-union silently resurrects every entry you just deleted. Pruning also breaks relative cross-references by construction: an entry that says "the entry above" now points at something else, so re-point it at the issue that captured its neighbour (cumulo#16's ship step did exactly this, re-pointing at cumulo#112).

**Friction log** (`docs/friction-log.md`):

6. Look for patterns: ≥3 similar entries, or the same phase hurting in ≥50% of recent tasks.
7. Each pattern → `gh issue create --label workflow` with the aggregated evidence and a proposed workflow change. Delete captured entries, after step 4's title grep, re-pointing each hit at the issue.
8. Leave singletons; delete entries stale enough that the workflow has since changed under them.

**Scheduling input for the backlog** (feeds /burn-backlog's debt-first rule): for each new tech-debt issue, note in its body which open feature issues touch the same files — if a debt fix would establish a pattern those features should follow, say so explicitly ("do before #n").

Report: issues created (linked), entries pruned, patterns still brewing below threshold.
