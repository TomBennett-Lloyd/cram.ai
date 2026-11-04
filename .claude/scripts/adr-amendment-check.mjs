// The amendment check behind .claude/workflow.json → merge.amendmentRule, for merge-pr.sh's
// feedback step (#560). Pure: the PR diff and the plan comment are files merge-pr.sh fetched, so
// gh stays in one place and every verdict here is a function of its inputs.
//
//   footprint  <diff> <hit>...                    is this an amendment PR?
//   cite       <pr-url> <verdict-lines> <closes>... prints the cited plan comment's `<id> <issue>`
//   plan-named <diff> <comment.json> <issue> <hit>... arm (a)
//   path-move  <diff> <hit>...                    arm (b)
//
// <hit> is each humanAlways path in the PR. Exit 0 passes, 1 refuses
// with the reason on stdout, 2 means an input was unreadable.
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

const ADR_FILE = /^docs\/adr\/(?!0000-)\d{4}-[^/]+\.md$/;
// The pointer amendmentRule (b) allows beside a moved path, as #465's (f) carries it.
const POINTER = / ?\((?:moved|amended) \d{4}-\d{2}-\d{2}; (?:see )?§ Amendments\)/;
const ENTRY = /^- \*\*\d{4}-\d{2}-\d{2} — /;

const refuse = (reason) => {
  process.stdout.write(reason + '\n');
  process.exit(1);
};
const unreadable = (reason) => {
  process.stderr.write(reason + '\n');
  process.exit(2);
};
const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return unreadable('cannot read ' + path + ': ' + e.message);
  }
};

const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };
/** A path as git prints it: C-quoted, octal bytes and all, when it holds a byte core.quotePath escapes. */
const unquote = (p) => {
  if (!(p.length > 1 && p.startsWith('"') && p.endsWith('"'))) return p;
  const s = p.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') bytes.push(...Buffer.from(s[i]));
    else if (/[0-7]/.test(s[i + 1])) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      i++;
      bytes.push(ESCAPES[s[i]] ?? s.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
};

/** git's unified diff (`gh pr diff`) as files of hunks; `\ No newline` markers are dropped. */
export function parseDiff(text) {
  const files = [];
  let f = null;
  let hunk = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // A header-only diff (a mode change) names its path here alone: `a/P b/P`.
      const rest = line.slice(11);
      const half = rest.slice(2, (rest.length - 3) / 2 + 1);
      const same = rest === 'a/' + half + ' b/' + half ? half : null;
      f = { oldPath: same, newPath: same, kind: 'modify', hunks: [] };
      files.push(f);
      hunk = null;
      continue;
    }
    if (!f) continue;
    if (!hunk) {
      if (line.startsWith('new file mode')) f.kind = 'add';
      else if (line.startsWith('deleted file mode')) f.kind = 'delete';
      else if (line.startsWith('rename from '))
        [f.kind, f.oldPath] = ['rename', unquote(line.slice(12))];
      else if (line.startsWith('rename to ')) f.newPath = unquote(line.slice(10));
      else if (line.startsWith('copy from '))
        [f.kind, f.oldPath] = ['copy', unquote(line.slice(10))];
      else if (line.startsWith('copy to ')) f.newPath = unquote(line.slice(8));
      else if (line.startsWith('--- ')) f.oldPath = unquote(line.slice(4)).replace(/^a\//, '');
      else if (line.startsWith('+++ ')) f.newPath = unquote(line.slice(4)).replace(/^b\//, '');
    }
    if (line.startsWith('@@')) {
      hunk = [];
      f.hunks.push(hunk);
    } else if (hunk && /^[ +-]/.test(line)) hunk.push({ t: line[0], text: line.slice(1) });
  }
  return files;
}

const fileFor = (files, hit) => files.find((g) => g.newPath === hit || g.oldPath === hit);

/** Why `hits` is not an amendment footprint, or null: every hit an existing, still-present ADR. */
export function footprintReason(files, hits) {
  if (!hits.length) return 'the PR touches no humanAlways path';
  for (const hit of hits) {
    if (!ADR_FILE.test(hit)) return hit + ' is not an ADR file (docs/adr/NNNN-*.md, 0000 excluded)';
    const g = fileFor(files, hit);
    if (!g) return hit + ' is in the PR but not in its diff';
    if (g.kind !== 'modify') return hit + ' is a ' + g.kind + ', not an amendment to a merged ADR';
  }
  return null;
}

/**
 * Each run of changed lines between context lines. `eof` marks one no context follows, which is
 * the file's end under git's default three lines of context, the form `gh pr diff` prints.
 */
function blocks(hunks) {
  const out = [];
  for (const hunk of hunks) {
    let cur = null;
    for (const l of hunk) {
      if (l.t === ' ') {
        cur = null;
        continue;
      }
      if (!cur) out.push((cur = { removed: [], added: [], eof: false }));
      (l.t === '-' ? cur.removed : cur.added).push(l.text);
    }
    if (cur) cur.eof = true;
  }
  return out;
}

/** Arm (a): every added line of each ADR is in the comment as itself or `+`-prefixed, every removed line `-`-prefixed. */
export function planNamedReason(files, hits, body) {
  const lines = new Set(body.split('\n').map((l) => l.trimEnd()));
  let seen = 0;
  for (const hit of hits) {
    for (const b of blocks(fileFor(files, hit).hunks)) {
      for (const [sign, list] of [
        ['-', b.removed],
        ['+', b.added],
      ]) {
        for (const raw of list) {
          const l = raw.trimEnd();
          seen++;
          const named = lines.has(sign + l) || (sign === '+' && lines.has(l));
          if (!named)
            return (
              hit +
              ': the plan comment does not carry this ' +
              (sign === '+' ? 'added' : 'removed') +
              ' line: ' +
              l
            );
        }
      }
    }
  }
  return seen
    ? null
    : 'the ADR diff changes no line, so there is nothing the plan could have named';
}

/** null when `before` → `after` changes only backticked paths the PR moves, plus at most one dated pointer. */
function pairReason(before, after, moved) {
  const a = after.replace(POINTER, '');
  const x = before.split(/(`[^`\n]*`)/);
  const y = a.split(/(`[^`\n]*`)/);
  if (x.length !== y.length) return 'the line gains or loses a backticked span';
  let paths = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === y[i]) continue;
    if (i % 2 === 0) return 'words outside a path change';
    const [o, n] = [x[i].slice(1, -1), y[i].slice(1, -1)];
    if (!moved.from.has(o) || !moved.to.has(n))
      return '`' + o + '` → `' + n + '` is not a file this PR moves';
    paths++;
  }
  return { paths };
}

/** Arm (b): inline pairs that change only moved paths, and one dated entry appended at each file's end. */
export function pathMoveReason(files, hits) {
  const moved = { from: new Set(), to: new Set() };
  for (const g of files) {
    if (g.kind === 'rename' || g.kind === 'delete') moved.from.add(g.oldPath);
    if (g.kind === 'rename' || g.kind === 'add') moved.to.add(g.newPath);
  }
  let paths = 0;
  for (const hit of hits) {
    let entry = false;
    for (const b of blocks(fileFor(files, hit).hunks)) {
      if (!b.removed.length) {
        const first = b.added.find((l) => l.trim() !== '');
        if (
          !b.eof ||
          !(first === '## Amendments' || ENTRY.test(first ?? '')) ||
          !b.added.some((l) => ENTRY.test(l))
        )
          return (
            hit +
            ': an added block that is not the dated entry appended at the end: ' +
            (first ?? '(blank lines)')
          );
        entry = true;
        continue;
      }
      if (b.removed.length !== b.added.length)
        return (
          hit +
          ': ' +
          b.removed.length +
          ' line(s) replaced by ' +
          b.added.length +
          ', not one for one'
        );
      for (let i = 0; i < b.removed.length; i++) {
        const r = pairReason(b.removed[i], b.added[i], moved);
        if (typeof r === 'string') return hit + ': ' + r + ': ' + b.added[i];
        paths += r.paths;
      }
    }
    if (!entry) return hit + ': no dated amendment entry appended at the end';
  }
  return paths ? null : 'no inline path changes, so this is not a path move';
}

/** The plan comment id the Verdict cites: one URL, on an issue this PR closes, in this PR's repo. */
export function citeReason(prUrl, verdict, closes) {
  const repo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+$/.exec(prUrl);
  if (!repo) return { reason: 'cannot read the repository from the PR url ' + prUrl };
  const cites = [
    ...verdict.matchAll(
      /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)#issuecomment-(\d+)/g,
    ),
  ];
  const ids = new Set(cites.map((m) => m[3]));
  if (ids.size !== 1)
    return { reason: 'the Verdict must cite exactly one plan comment URL; it cites ' + ids.size };
  const [, where, issue, id] = cites[0];
  if (where.toLowerCase() !== repo[1].toLowerCase())
    return { reason: 'the cited comment is in ' + where + ', not ' + repo[1] };
  if (!closes.includes(issue))
    return { reason: 'the cited comment is on #' + issue + ', which this PR does not close' };
  return { id, issue };
}

const [mode, ...args] = process.argv.slice(2);
const done = (reason) => (reason ? refuse(reason) : process.exit(0));
if (mode === 'footprint') {
  const [diff, ...hits] = args;
  done(footprintReason(parseDiff(read(diff)), hits));
} else if (mode === 'cite') {
  const [prUrl, verdict, ...closes] = args;
  const r = citeReason(prUrl ?? '', verdict ?? '', closes);
  if (r.reason) refuse(r.reason);
  process.stdout.write(r.id + ' ' + r.issue + '\n');
} else if (mode === 'plan-named') {
  const [diff, commentFile, issue, ...hits] = args;
  let comment;
  try {
    comment = JSON.parse(read(commentFile));
  } catch (e) {
    unreadable('the plan comment is not JSON: ' + e.message);
  }
  if (!String(comment.issue_url ?? '').endsWith('/issues/' + issue))
    refuse('the cited comment is not on #' + issue);
  // A plan comment may lead with `Footprint change:` lines (.claude/agents/ticket-agent.md rule 2).
  if (!/^## Plan\b/m.test(String(comment.body ?? '')))
    refuse('the cited comment is not a plan comment (no "## Plan" heading)');
  const files = parseDiff(read(diff));
  done(footprintReason(files, hits) ?? planNamedReason(files, hits, comment.body));
} else if (mode === 'path-move') {
  const [diff, ...hits] = args;
  const files = parseDiff(read(diff));
  done(footprintReason(files, hits) ?? pathMoveReason(files, hits));
} else {
  unreadable('usage: adr-amendment-check.mjs footprint|cite|plan-named|path-move …');
}
