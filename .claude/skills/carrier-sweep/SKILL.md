---
name: carrier-sweep
description: The restatement (carrier) sweep a plan comment must carry when a lane changes or deletes a stated value, name, path or rule - the three declarations, one scripted git grep into a file, positive control, classified hits. Run it in a fresh agent, not grep by grep in the lane. Use at plan time, before the first edit.
---

Moved out of `.claude/agents/ticket-agent.md` rule 2 by #628, which keeps the obligation; this file owns the procedure. The rule it answers is `docs/standards/architecture.md` rule 9 (the recorded-sweep form) and rule 10 (the derived figures), and `docs/standards/evidence.md` form 5 (the positive control). Citations of the form `cumulo#<n>` point at cumulo's issues and PRs; bare `#<n>` is this repo's.

**Why a skill and not grep by grep.** The #560 lane (PR #606) ran 778 `grep`, `sed` and `cat` calls in a context that reached 752k tokens, 68.5M effective, for a result that was a list of carrier files (#624). A sweep is one command, its output goes to a file, and the answer is a count and a short list; a fresh agent starting near 60k tokens does that for about a fortieth of the cost.

## What the lane gives the agent

In the dispatch prompt (a `general-purpose` agent on Sonnet, synchronous, `.claude/agents/ticket-agent.md` rule 3(f)), invoking this skill by name:

- the issue number `<n>` and the scratchpad directory;
- the **claim** in one sentence, and the old and new wording if it moves a value;
- the **literal arm**: the identifier, path or figure, as an ERE;
- the **claim arm**: two or three content words of the sentence the value lives in, matched `-i`, so a paraphrase that never names the literal still hits (architecture.md rule 10);
- the **positive control**: one file already known to carry the value;
- any exclusion, each with its reason (the three append-only logs are history, not carriers).

## The three declarations

Declare these three parts ahead of the output. **(1) The claim family**: the behaviour and the rule, not the identifier, test wording or list that carries them. It covers every direction the change moves the rule, so adding an exemption sweeps what the gate exempts as well as what it refuses. **(2) The search space**: the tree (`-- ':/'`), plus open PRs (`gh pr list --search`) whenever the plan adds a helper or a value. **(3) The output**: pasted from the run, after its command, with the command's exit code. Each hit the sweep leaves unedited carries its reason, which `.claude/skills/plan-issue/SKILL.md` step 4's classification check reads against the hit's text. Five lanes each missed by a different one of these: #254 pasted a recollection before running the command (PR #267); #247 swept the test's wording, not the behaviour (PR #270); #273 swept the lists it merged, not the rule they widened (PR #285); #145 missed open PR #214 building the same helper (PR #224); #311 swept what the gate refuses, not what it exempts (PR #323) — #293. Two lanes swept only the file the issue named and review found the twin: #17's gate name at three sites (PR #33), #37's line locator in the sibling script (PR #85) — #87.

## The command

One command, into a file, never one `grep` per candidate. Write the pattern as an ERE with no `\b` (`git grep -E` on macOS reads it as the letter `b`) and no repetition bound above 255 (`docs/standards/evidence.md` § Host conventions member 5).

```
git grep -n -i -E '<literal-arm>|<claim-arm>' -- ':/' ':/!<excluded path>' > <scratchpad>/sweep-<n>.out 2>&1; rc=$?
n=$(wc -l < <scratchpad>/sweep-<n>.out)
c=$(command grep -c '^<control path>:' <scratchpad>/sweep-<n>.out)
echo "RC=$rc hits=$n control=$c"
cut -d: -f1 <scratchpad>/sweep-<n>.out | sort | uniq -c
```

`git grep` exits 0 on a hit, 1 on none and 128 on an error. A `control` of 0 is a failed sweep whatever the exit code says: fix the pattern before reading a single hit. Where the plan adds a helper or a value, add the open-PR arm: `gh pr list --state open --search '<two content words>' --json number,title > <scratchpad>/sweep-<n>-prs.out; echo RC=$?`.

## What the agent returns

Write `<scratchpad>/sweep-<n>.md`, a block ready to paste: the three declarations, the command, its exit code, the output, the control line and the open-PR output. Return to the lane only:

1. the path of that file, the exit code, the hit count and the per-file count table;
2. the control's count;
3. each file the agent proposes to edit, with its line numbers and the sentence that makes it a carrier;
4. each file it proposes to leave, with a one-line reason: the matched words in another sense, or an owner this change cites without stating the mechanism or literal it moves. `.claude/skills/plan-issue/SKILL.md` step 4's classification check reads each reason against the hit's text, so a reason the text contradicts is a misclassified carrier.

Not the hit lines themselves, and not file contents.

## What the lane does with it

Paste the file into the plan comment by shell (`cat <scratchpad>/sweep-<n>.md >> <plan body file>`), so the output arrives pasted without passing through the lane's context; read only the lines of the files you edit. The proposed leaves are yours to own: the reviewer reads each against its hit.
