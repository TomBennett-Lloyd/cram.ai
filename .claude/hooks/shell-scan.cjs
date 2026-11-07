'use strict';
// The lexical shell scanner the command-shape guards share (#692): guard-dirty-revert.sh and
// guard-pgrep-loop.sh each load it with `require(<this file>)`, and a later guard does the same.
// `scan` splits a Bash tool call's text into simple commands and returns no verdict of its own.
//
// `commands` holds, in execution order (a `$(…)` or backtick body after the command that holds
// it), three kinds of entry: an array of one simple command's unquoted words; the
// ENTER_SUBSHELL and LEAVE_SUBSHELL markers bracketing a body the shell runs in a subshell; and
// `{ owner, body }` for a heredoc, the owner being the array of the command that reads it and the
// body its text, unscanned. A caller skips the kinds it does not use.
//
// Lexical only: a command reached through a variable, `xargs` or a function is not seen.
// Cases: .claude/scripts/shell-scan.test.sh, and each guard's own harness.

// Words after which a `case` or `esac` still stands at command position.
const LEADERS = new Set([
  '!',
  '{',
  'if',
  'then',
  'elif',
  'else',
  'do',
  'while',
  'until',
  'time',
  'coproc',
  'function',
]);

// Appends each simple command's words to `commands`; a nested scan is a `"$(...)"` body
// and returns the index past the `)` that closes it: the first at paren depth 0 (#241)
// that does not end a `case` pattern (#268). A paren inside `[…]` counts, because the
// shells' own `$(` readers count it: zsh (the Bash tool's shell here) counts the `(` of
// `[(]`, and both bash and zsh close at the `)` of `[)]`.
function scan(src, i, commands, nested) {
  const heredocs = [];
  // Open parens, innermost last. Each holds the word and command it opened in (`$(`, `<(`,
  // `@(`, `a=(`, a subshell's empty one), which resume at its `)` without the group's text,
  // so zsh's `dirty.txt(N)` names dirty.txt. A `pattern` group is a zsh case pattern's (#287);
  // only a `command` group's words stand at command position (#288).
  const groups = [];
  // Open `case` frames, innermost last, each at the paren depth it opened at. `state` runs
  // head (`case WORD in`) → pattern → body, and back to pattern at each `;;`.
  const cases = [];
  let current = [];
  let word = null;
  commands.push(current);
  const frame = () => (cases.at(-1)?.depth === groups.length ? cases.at(-1) : undefined);
  // `sure` asks whether zsh surely runs the group as a command list, not only may (#288).
  const atCommand = (sure = false) =>
    (groups.at(-1)?.[sure ? 'sure' : 'command'] ?? true) &&
    current.every((w, k) => LEADERS.has(w) || current[k - 1] === 'function');
  const end = () => {
    if (word === null) return;
    const leading = atCommand();
    current.push(word);
    const f = frame();
    if (f?.state === 'head') {
      if (++f.words === 2) Object.assign(f, { state: 'pattern', fresh: true });
    } else if (f?.state === 'pattern') {
      if (f.fresh && word === 'esac') cases.pop();
      else f.fresh = false;
    } else if (leading && word === 'esac' && f) cases.pop();
    else if (leading && word === 'case')
      cases.push({ depth: groups.length, state: 'head', words: 0 });
    word = null;
  };
  const split = () => {
    end();
    current = [];
    commands.push(current);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      split();
      i++;
      for (const h of heredocs) {
        const body = [];
        while (i < src.length) {
          let eol = src.indexOf('\n', i);
          if (eol === -1) eol = src.length;
          const line = src.slice(i, eol);
          i = eol + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
          body.push(line);
        }
        commands.push({ owner: h.owner, body: body.join('\n') });
      }
      // The heredoc bodies sit between the command that reads them and the next command.
      if (heredocs.length > 0) {
        current = [];
        commands.push(current);
      }
      heredocs.length = 0;
    } else if (c === ' ' || c === '\t') {
      end();
      i++;
    } else if (c === '#' && word === null) {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === ';' && /[;&|]/.test(src[i + 1] ?? '') && frame()?.state === 'body') {
      split();
      Object.assign(frame(), { state: 'pattern', fresh: true });
      i += 2;
    } else if (c === '(') {
      const f = frame();
      // Only a `$(` opens a command group mid-pattern; `x(`, `@(` and `(` are glob groups (#287).
      const pattern =
        !word?.endsWith('$') && (f?.state === 'pattern' || groups.at(-1)?.pattern === true);
      // `((` is arithmetic only at command position; in an argument it is a glob group (#288).
      const leading = word === null && atCommand(true);
      // Where zsh may run a command, `((` may be arithmetic: read it so unless a quote in it would
      // end it elsewhere as a glob group, and scan its text as an argument too, for the `<(` a
      // glob group runs (#288).
      const ambiguous = word === null && !leading && (groups.at(-1)?.command ?? true);
      let unit =
        (leading || ambiguous) && !pattern && src[i + 1] === '(' ? arith(src, i + 2, commands) : -1;
      if (ambiguous && unit !== -1 && /['"]/.test(src.slice(i, unit))) unit = -1;
      else if (ambiguous && unit !== -1) {
        commands.push(ENTER_SUBSHELL);
        scan(`: ${src.slice(i + 2, unit - 2)}`, 0, commands, false);
        commands.push(LEAVE_SUBSHELL);
      }
      // The pattern is under way, so an `esac` after the group is part of it (#287).
      if (pattern && f) f.fresh = false;
      if (unit === -1) {
        // `$(`, `<(`, `>(`, `=(`, `{(` and a word-initial `(` open a command list, even in an
        // argument, where scanning one only refuses more (#288); any other `(` a glob group.
        const sure = !pattern && (leading || word === '=' || /[$<>]$/.test(word ?? ''));
        const command =
          !pattern && (word === null || word === '{' || word === '=' || /[$<>]$/.test(word));
        groups.push({ current, word, open: i, pattern, command, sure });
        word = null;
        current = [];
        commands.push(current);
        i++;
      } else {
        word = src.slice(i, unit);
        i = unit;
      }
    } else if (c === ')') {
      end();
      const f = frame();
      if (f?.state === 'pattern') {
        f.state = 'body';
        split();
      } else if (nested && groups.length === 0) return i + 1;
      else {
        const g = groups.pop();
        if (g) {
          current = g.current;
          word = g.word;
          if (frame()?.state === 'pattern' && endsPattern(src, i + 1)) {
            frame().state = 'body';
            split();
          } else if (g.pattern) {
            // The pattern word goes on past the group, so a `#` after it opens no comment (#287).
            word ??= '';
          } else if (
            src.slice(g.open + 1, i).trim() === '' &&
            /^[A-Za-z_]\w*$/.test(word ?? current.at(-1) ?? '')
          ) {
            // `NAME()` defines a function, so its body stands at command position (#287).
            split();
          }
        } else split();
      }
      i++;
    } else if (';&|'.includes(c)) {
      split();
      i++;
    } else if (src.startsWith('<<<', i)) {
      word = (word ?? '') + '<<<';
      i += 3;
    } else if (src.startsWith('<<', i)) {
      end();
      i += 2;
      const strip = src[i] === '-';
      if (strip) i++;
      while (src[i] === ' ') i++;
      let delim = '';
      while (i < src.length && !/[\s;&|()]/.test(src[i])) {
        if (src[i] === "'" || src[i] === '"') {
          const q = src[i++];
          while (i < src.length && src[i] !== q) delim += src[i++];
          i++;
        } else if (src[i] === '\\') {
          delim += src[i + 1] ?? '';
          i += 2;
        } else delim += src[i++];
      }
      heredocs.push({ delim, strip, owner: current });
    } else if (c === "'") {
      word ??= '';
      i++;
      while (i < src.length && src[i] !== "'") word += src[i++];
      i++;
    } else if (c === '"') {
      const quoted = dquote(src, i, commands);
      word = (word ?? '') + quoted.text;
      i = quoted.end;
    } else if (src.startsWith('$((', i)) {
      const unit = arith(src, i + 3, commands);
      word = (word ?? '') + (unit === -1 ? c : src.slice(i, unit));
      i = unit === -1 ? i + 1 : unit;
    } else if (src.startsWith('${', i)) {
      const j = param(src, i, commands, false);
      word = (word ?? '') + src.slice(i, j);
      i = j;
    } else if (src.startsWith("$'", i)) {
      const quoted = ansi(src, i);
      word = (word ?? '') + quoted.text;
      i = quoted.end;
    } else if (c === '`') {
      word ??= '';
      i = backtick(src, i, commands);
    } else if (c === '\\') {
      if (src[i + 1] !== '\n') word = (word ?? '') + (src[i + 1] ?? '');
      i += 2;
    } else {
      word = (word ?? '') + c;
      i++;
    }
  }
  end();
  return i;
}

// Whether the `)` before `i` ends a zsh case pattern: the character after it decides (#287).
function endsPattern(src, i) {
  if (src[i] !== ' ' && src[i] !== '\t') return src[i] === '\n' || src[i] === ';';
  while (src[i] === ' ' || src[i] === '\t') i++;
  return src[i] !== ')' && src[i] !== '|';
}

// Reads the `"…"` at `i`: returns its text and the index past the closing quote. A `$(`
// or backtick inside is scanned as a body; `\$` and `\``, like `\"` and `\\`, are escapes there.
function dquote(src, i, commands) {
  let text = '';
  i++;
  while (i < src.length && src[i] !== '"') {
    if (src.startsWith('$(', i)) {
      i = dollarParen(src, i, commands);
      continue;
    }
    if (src[i] === '`') {
      i = backtick(src, i, commands);
      continue;
    }
    if (src.startsWith('${', i)) {
      const j = param(src, i, commands, true);
      text += src.slice(i, j);
      i = j;
      continue;
    }
    if (src[i] === '\\' && '"\\$`'.includes(src[i + 1] ?? '')) i++;
    text += src[i++];
  }
  return { text, end: i + 1 };
}

// Reads the `${…}` at `i` as one unit and returns the index past its first unquoted `}`.
// Its parens never reach the counter, but a `$(` or backtick inside is still scanned, so
// `${x:-$(git checkout …)}` is seen (#268). `'…'` quotes only outside `"…"` (`dq`), as zsh
// reads `"${x:-'}"`; a bare `{` does not nest, which is bash's reading and the shorter unit.
function param(src, i, commands, dq) {
  i += 2;
  while (i < src.length && src[i] !== '}') {
    if (src.startsWith('${', i)) i = param(src, i, commands, dq);
    else if (src.startsWith('$(', i)) i = dollarParen(src, i, commands);
    else if (src[i] === '`') i = backtick(src, i, commands);
    else if (src.startsWith("$'", i) && !dq) i = ansi(src, i).end;
    else if (src[i] === '"') i = dquote(src, i, commands).end;
    else if (src[i] === "'" && !dq) i = src.indexOf("'", i + 1) + 1 || src.length;
    else i += src[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

// Reads the `$(` at `i` as an arithmetic `$((…))` when it closes as one, else as a command body.
function dollarParen(src, i, commands) {
  const unit = src[i + 2] === '(' ? arith(src, i + 3, commands) : -1;
  return unit === -1 ? scan(src, i + 2, commands, true) : unit;
}

// Reads the arithmetic body at `i`, just past `$((` or `((`, as one unit: returns the index past
// its `))`, or `-1` when the `)` matching the inner `(` is not followed by `)`, which both shells
// then read as a command substitution or subshell. Its body quotes as `"…"` does, as zsh reads
// it (#288).
function arith(src, i, commands) {
  const before = commands.length;
  let depth = 1;
  let k = i;
  while (k < src.length) {
    if (src.startsWith('$(', k)) k = dollarParen(src, k, commands);
    else if (src.startsWith('${', k)) k = param(src, k, commands, true);
    else if (src[k] === '`') k = backtick(src, k, commands);
    else if (src[k] === '\\') k += 2;
    else if (src[k] === ')' && depth === 1) break;
    else depth += { '(': 1, ')': -1 }[src[k++]] ?? 0;
  }
  if (src[k + 1] === ')') return k + 2;
  commands.length = before;
  return -1;
}

const ANSI_ESCAPES = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};
const ANSI_ESCAPE =
  /\\(?:([0-7]{1,3})|x([\da-fA-F]{1,2})|u([\da-fA-F]{1,4})|U([\da-fA-F]{1,8})|(.))/gs;

// Reads the `$'…'` at `i`: returns its decoded text and the index past the closing quote.
// An escaped quote never ends it; an unknown escape drops its backslash, as in zsh (#282).
function ansi(src, i) {
  let j = i + 2;
  while (j < src.length && src[j] !== "'") j += src[j] === '\\' ? 2 : 1;
  const text = src.slice(i + 2, j).replace(ANSI_ESCAPE, (all, oct, x, u, U, other) => {
    if (other !== undefined) return ANSI_ESCAPES[other] ?? other;
    const cp = oct === undefined ? parseInt(x ?? u ?? U, 16) : parseInt(oct, 8);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : all;
  });
  return { text, end: j + 1 };
}

// Bracket, in `commands`, the commands of a body the shell runs in a subshell, so a `cd` among
// them ends with the body. Markers rather than index ranges, so a rescan's truncation drops
// them with the commands they bracket (#282). `$(…)` and `(…)` bodies are not bracketed yet (#357).
const ENTER_SUBSHELL = Symbol('enter subshell');
const LEAVE_SUBSHELL = Symbol('leave subshell');

// Scans the `` `…` `` at `i` as a command body and returns the index past its closing backtick.
// The body is delimited before it is scanned, the shells' order, so a quote inside never holds
// the closing backtick (#282).
function backtick(src, i, commands) {
  let j = i + 1;
  while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
  commands.push(ENTER_SUBSHELL);
  scan(src.slice(i + 1, j).replace(/\\([$`\\])/g, '$1'), 0, commands, false);
  commands.push(LEAVE_SUBSHELL);
  return j + 1;
}

module.exports = { scan, ENTER_SUBSHELL, LEAVE_SUBSHELL };
