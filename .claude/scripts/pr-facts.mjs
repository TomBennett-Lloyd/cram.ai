// The one reader of a `gh pr view --json` answer, for merge-pr.sh and fill-verdict.sh (#180).
//
// stdin: the JSON object. stdout: one TAB-separated record per fact, `<kind>\t<a>[\t<b>\t<c>]`,
// for a bash `while IFS=$'\t' read` loop — deliberately not `gh --jq`, which would put jq in
// every gh stub's contract, and not an `eval`'d assignment block, which would make a PR body a
// code-execution surface. A field the caller did not ask gh for comes out empty or absent.
// Exit 2 when stdin is not JSON.
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

  // The closing keywords GitHub itself honours, read from the body rather than from
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
  // Each lane declares itself in the body: a ticket-agent lane by its report header
  // (.claude/agents/ticket-agent.md rule 8), a task-orchestrator batch by its TASK REPORT header
  // line (.claude/agents/task-orchestrator.md rule 7).
  for (const [kind, declRe] of [
    ['lane', /^## Lane report — issue #(\d+)/gm],
    ['batch', /^## TASK REPORT — .*?batch: anchor #(\d+)/gm],
  ]) {
    const found = new Set();
    while ((m = declRe.exec(body))) found.add(m[1]);
    for (const n of found) put(kind, n);
  }
  process.stdout.write(out.join('\n') + '\n');
});
