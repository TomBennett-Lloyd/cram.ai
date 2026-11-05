// The one reader of a `gh pr view --json` answer, for merge-pr.sh and fill-verdict.sh (#180).
//
// stdin: the JSON object. stdout: one TAB-separated record per fact, `<kind>\t<a>[\t<b>\t<c>]`,
// for a bash `while IFS=$'\t' read` loop — deliberately not `gh --jq`, which would put jq in
// every gh stub's contract, and not an `eval`'d assignment block, which would make a PR body a
// code-execution surface. A field the caller did not ask gh for comes out empty or absent.
// With `--squash-message`, stdout is instead the message merge-pr.sh squashes with: subject,
// a blank line, body (#617). Exit 2 when stdin is not JSON; 3 when that message has no subject
// or no summary to carry.
const LANE_REPORT = /^## Lane report — issue #(\d+)/m;
const BATCH_REPORT = /^## TASK REPORT — .*?batch: anchor #(\d+)/m;

// A closing keyword and the reference after it. Wider than GitHub's grammar on purpose (the
// `R` rows of merge-pr.test.sh section 25), because a false refusal costs a body edit and a
// miss closes an issue: `fixes: #404` in beddd61's message closed #404 (#617). Letters and
// digits bound the keyword, not `\b`, so `_Fixes_` is read too.
const CLOSING_REF =
  /(?<![a-z0-9])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?![a-z0-9])[\s:*_~`]*(https?:\/\/\S*?\/(?:issues|pull)\/\d+|GH-\d+|[\w./-]*#\d+)/gi;

// The squash message is what review read, never the branch's commit messages (#617): the PR
// title, and the body above its first lane declaration, which is where a lane corrects a claim.
// Co-authored-by trailers are the one thing taken from the commits, as GitHub's default does.
// Where its shape is restated: .claude/ledgers/squash-message.ledger.
function squashMessage(pr) {
  const title = String(pr.title || '').trim();
  if (!title) return { ok: false, reason: 'the PR has no title to squash under' };
  const body = String(pr.body || '').replace(/\r\n?/g, '\n');
  let cut = body.length;
  for (const declRe of [LANE_REPORT, BATCH_REPORT]) {
    const at = body.search(declRe);
    if (at >= 0 && at < cut) cut = at;
  }
  const summary = body.slice(0, cut).trim();
  if (!summary)
    return {
      ok: false,
      reason: 'the PR body holds no summary above its lane report to squash with',
    };
  const trailers = new Map();
  for (const c of pr.commits || [])
    for (const t of String((c && c.messageBody) || '').matchAll(
      /^co-authored-by:[ \t]*(\S.*?)[ \t]*$/gim,
    ))
      if (!trailers.has(t[1].toLowerCase()))
        trailers.set(t[1].toLowerCase(), `Co-authored-by: ${t[1]}`);
  const tail = trailers.size ? `\n\n${[...trailers.values()].join('\n')}` : '';
  return { ok: true, text: `${title} (#${pr.number})\n\n${summary}${tail}\n` };
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let pr;
  try {
    pr = JSON.parse(raw);
  } catch (e) {
    process.stderr.write('gh returned output that is not JSON: ' + e.message + '\n');
    process.exit(2);
  }
  if (process.argv[2] === '--squash-message') {
    const msg = squashMessage(pr);
    if (!msg.ok) {
      process.stderr.write(msg.reason + '\n');
      process.exit(3);
    }
    process.stdout.write(msg.text);
    return;
  }
  const out = [];
  // Tabs and newlines are the record separators, so anything carrying them is flattened rather
  // than allowed to invent extra fields or extra records.
  const put = (...f) =>
    out.push(f.map((v) => String(v == null ? '' : v).replace(/[\t\r\n]/g, ' ')).join('\t'));
  for (const k of ['state', 'baseRefName', 'headRefName', 'headRefOid', 'mergeStateStatus', 'url'])
    put(k, pr[k]);
  for (const l of pr.labels || []) put('label', l && l.name);
  for (const c of pr.commits || []) put('commit', c && c.messageHeadline);

  // One record per check: the latest run of each (workflow, name), so that a label re-run is
  // counted once (#55). "Latest" is the later real startedAt. Whenever that cannot decide (a tie,
  // or a run with no start time yet, which gh spells as empty or 0001-01-01), the entry that is
  // not a SUCCESS wins, so the undecidable case is never settled toward green.
  const realStart = (t) => (t && !String(t).startsWith('0001-') ? String(t) : '');
  const green = (e) => e.status === 'COMPLETED' && e.conclusion === 'SUCCESS';
  const supersedes = (e, h) => {
    if (e.startedAt && h.startedAt && e.startedAt !== h.startedAt) return e.startedAt > h.startedAt;
    return green(h) && !green(e);
  };
  const latest = new Map();
  for (const c of pr.statusCheckRollup || []) {
    // Two shapes share this array. A CheckRun carries status + conclusion; a StatusContext (the
    // older commit-status API, which the rollup still mixes in) carries only "state". An
    // unrecognised shape reports an empty status, which merge-pr.sh counts as pending.
    const name = (c && (c.name || c.context)) || '(unnamed check)';
    let status = c && c.status;
    let conclusion = c && c.conclusion;
    if (!status && c && c.state) {
      status = c.state === 'PENDING' || c.state === 'EXPECTED' ? 'PENDING' : 'COMPLETED';
      conclusion = c.state;
    }
    const entry = { name, status, conclusion, startedAt: realStart(c && c.startedAt) };
    const key = String((c && c.workflowName) || '') + '\u0000' + name;
    const held = latest.get(key);
    if (!held || supersedes(entry, held)) latest.set(key, entry);
  }
  for (const e of latest.values()) put('check', e.name, e.status, e.conclusion);

  // The strict closing-keyword form, read from the body rather than from
  // closingIssuesReferences: the body is what the author wrote and a reviewer read, and the
  // squash-vs-rebase decision has to turn on the text a human would count.
  const body = pr.body || '';
  const seen = new Set();
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;
  let m;
  while ((m = re.exec(body))) {
    if (!seen.has(m[1])) put('closes', m[1]);
    seen.add(m[1]);
  }
  // Every closing reference that would close something at merge without a Closes record naming
  // it: in the body, which GitHub links whatever the method, and in the text that lands on main,
  // which is the squash message for a squash and every commit message for a rebase.
  const named = new Set([...seen].map(Number));
  const strays = (text) => {
    const found = new Set();
    for (const r of text.matchAll(CLOSING_REF)) {
      const bare = /^#(\d+)/.exec(r[1]);
      if (!(bare && named.has(Number(bare[1])))) found.add(r[0]);
    }
    return found;
  };
  const squash = squashMessage(pr);
  const commitText = (pr.commits || [])
    .map((c) => `${(c && c.messageHeadline) || ''}\n${(c && c.messageBody) || ''}`)
    .join('\n');
  for (const [scope, text] of [
    ['squash', `${body}\n${squash.ok ? squash.text : ''}`],
    ['rebase', `${body}\n${commitText}`],
  ])
    for (const r of strays(text)) put('stray', scope, r);
  // Each lane declares itself in the body: a ticket-agent lane by its report header
  // (.claude/agents/ticket-agent.md rule 8), a task-orchestrator batch by its TASK REPORT header
  // line (.claude/agents/task-orchestrator.md rule 7). A line opening `Part of #<n>` declares that
  // the PR leaves issue n open, the form a PARTIAL lane's deferred criterion takes
  // (.claude/agents/ticket-agent.md rule 5); like the headers it is read only at a line's start, so prose that
  // mentions being part of an issue declares nothing.
  for (const [kind, declRe] of [
    ['lane', new RegExp(LANE_REPORT.source, 'gm')],
    ['batch', new RegExp(BATCH_REPORT.source, 'gm')],
    ['partof', /^Part of #(\d+)\b/gm],
  ]) {
    const found = new Set();
    while ((m = declRe.exec(body))) found.add(m[1]);
    for (const n of found) put(kind, n);
  }
  process.stdout.write(out.join('\n') + '\n');
});
