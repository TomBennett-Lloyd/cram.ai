/**
 * A stylelint rule: a `var()` fallback and a custom property's value hold
 * token references and nothing else, so no raw value rides in after one (#280).
 * The value is parsed rather than matched, because a fallback is a
 * `<declaration-value>` that may nest and list (CSS Variables 1 § 3).
 * Its cases: values.probe.css.txt.
 */
import valueParser from 'postcss-value-parser';
import stylelint from 'stylelint';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'cram/var-references-only';

const messages = ruleMessages(ruleName, {
  rejected: (fragment, where) =>
    `Raw value "${fragment}" in ${where}. It may hold only var(--token) references (#280).`,
});

/** @param {valueParser.Node} node */
const isVar = (node) => node.type === 'function' && node.value.toLowerCase() === 'var';

/** @param {valueParser.Node} node */
const isBlank = (node) => node.type === 'space' || node.type === 'comment';

/**
 * What a token list may hold besides `var()` calls: the separators a
 * `<declaration-value>` list uses, whitespace, and comments.
 * @param {valueParser.Node} node
 */
const isSeparator = (node) =>
  isBlank(node) || (node.type === 'div' && (node.value === ',' || node.value === '/'));

/**
 * The first node of a token list that is neither a `var()` nor a separator.
 * @param {valueParser.Node[]} nodes
 */
const firstRaw = (nodes) => nodes.find((node) => !isVar(node) && !isSeparator(node));

/** @type {import('stylelint').Rule} */
const rule = (primary) => (root, result) => {
  if (!validateOptions(result, ruleName, { actual: primary, possible: [true] })) return;

  root.walkDecls((decl) => {
    /** @param {string} fragment @param {string} where */
    const reject = (fragment, where) => {
      report({ result, ruleName, node: decl, message: messages.rejected(fragment, where) });
    };

    const parsed = valueParser(decl.value);

    if (decl.prop.startsWith('--')) {
      const raw = firstRaw(parsed.nodes);
      if (raw !== undefined) reject(valueParser.stringify(raw), `custom property ${decl.prop}`);
      else if (!parsed.nodes.some(isVar)) reject(decl.value, `custom property ${decl.prop}`);
    }

    parsed.walk((node) => {
      if (!isVar(node)) return;
      const [name, ...rest] = node.nodes;
      const comma = rest.findIndex((arg) => arg.type === 'div' && arg.value === ',');
      const head = comma === -1 ? rest : rest.slice(0, comma);
      const fallback = comma === -1 ? [] : rest.slice(comma + 1);
      const raw =
        name?.type === 'word' && name.value.startsWith('--')
          ? (head.find((arg) => !isBlank(arg)) ?? firstRaw(fallback))
          : node;
      if (raw !== undefined) reject(valueParser.stringify(raw), 'a var() reference');
    });
  });
};

rule.ruleName = ruleName;
rule.messages = messages;

export default createPlugin(ruleName, rule);
