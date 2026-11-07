# Merge order

Moved out of `.claude/skills/run-issue/SKILL.md` step 4 by #668, which keeps the trigger: read this
file whenever a PR is ready and another PR is ready or another lane is in flight. It is the merge
owner's, in both lanes. Its step numbers without a file name are that skill's.

**Merge order** — whenever a PR is ready (`SKILL.md` step 4's diff check done, CI green on the
reported head) and another PR is ready or another lane is in flight, in both lanes
(`batch-lane.md` step 4 cites this). It orders ready PRs, and holds one only for the
single wait key (2) prices below, never as a blanket hold. Its inputs: the ready set;
the in-flight table (`batch-lane.md` step 1) — each lane's phase (before its first
`pnpm verify`, reviewer pass or PR, or PR open; for a ticket-agent row, read from
`git log origin/main..<H>`, the plan comment's ticks and `gh pr list --head <H>`) and
the `Depends on` lines of its issue body and plan comment; and, after `git fetch origin`, the overlap
read for each ready PR `R` against each other in-flight branch `H`, read as the local
ref `<H>`, since worktrees share `refs/heads` and a lane pushes nothing before its PR
(a lane with no commits yet is priced on its plan comment's footprint against
`gh pr diff <R> --name-only` instead):
`bash .claude/scripts/overlap-read.sh origin/<R> <H>`, whose header owns the three
`git merge-tree` reads, the probe commit and the log exclusion. It prints each read's exit code,
then the paths `R`'s landing adds to `H`'s conflicts, or `adds none`; it exits 1, printing
`not-ready <path>`, when `R` conflicts with `origin/main` on a path outside the logs
`.claude/scripts/merge-pr.sh`'s `APPEND_ONLY_LOGS` names (that script unions them): `R` is not ready. When
each open head pays, and what, is `SKILL.md` step 5's: a head is brought current as it comes next in
this order, save the two exceptions `SKILL.md` step 5 names — a single-issue PR `BEHIND` by
`merge-pr.sh`'s own update-branch, `DIRTY` on a non-log path by a `REBASE —` bounce,
lane-side; a `--rebase` batch,
`BEHIND` or `DIRTY` alike, is refused by `.claude/scripts/merge-pr.sh`'s merge step and
takes a "curate onto latest main" round, lane-side (`batch-lane.md` step 4) — PR #394 paid
two, the second landing only while other merges were held (#413). Two keys order the set, in
precedence. (1) Unblocking impact: a ready PR an in-flight lane `Depends on`, or whose
read against an in-flight branch that is still before its verify, review or PR comes
back non-empty, goes first, so the conflict lands before that lane's PR rather than
after it; neither lane's agent file yet takes a rebase before its first report, so the
lane still pays it at `SKILL.md` step 5, and #448 owns the entry that would let it rebase before
it invests. (2) Among the rest, the PR
whose landing costs the other open heads the fewest lane-side rounds goes first, ties
to the one ready longest. The one wait this order prices is `SKILL.md` step 5's: a PR whose round
`SKILL.md` step 5 started as next keeps its place until it merges or that round stops, so a
curated batch whose checks are still running on its new head is not overtaken by a
ready PR whose landing would cost it another round, and only a key (1) PR goes ahead of
it. A curated batch is priced by (2), not special-cased (owner direction 2026-11-02,
#413); PR #449 paid three curate rounds with no content change because #455 and then
#443 were moved ahead of it mid-curate (#614). Two
ready eval-bearing PRs (`SKILL.md` step 1) overlap whatever the read prints, since each committed
run stands for its whole tree (`docs/adr/0005-evaluation-as-gate.md` § Decision (f)):
the one whose tier-2 run is committed goes first, and the other, once it is next, takes
one `SKILL.md` step 5 `REBASE —` bounce to re-record, even when it reads only `BEHIND`, because
`gh pr update-branch` cannot re-record. No run in progress is overtaken (#486). The
order and the read it rests on — commands, output and exit codes, written from the captured run
(`docs/standards/evidence.md`) — go in the in-flight table rows, never into issues.
