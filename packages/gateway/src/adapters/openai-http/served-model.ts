import { z } from 'zod';
import type { GeneratorPin } from '../../pin';
import type { HttpGeneratorConfig } from '../../role-config';
import type { ServedArtefact } from '../../served-artefact';
import { BODY_EXCERPT_CHARS, describeError } from './http-failure';

/** `mismatch` is the server naming weights the pin does not: the one outcome that refuses a start. */
export type ServedCheck = ServedArtefact | { readonly status: 'mismatch'; readonly detail: string };

/** Ollama's model-inspection reply; only the modelfile is read. */
const ShowReply = z.object({ modelfile: z.string() });

/** Upper case, as `ollama show` prints every directive; `.claude/scripts/models-pull.sh` reads `FROM` the same way. */
const DIRECTIVE = /^(FROM|ADAPTER)\s+(.+)$/;
/** Opens or closes a multi-line value (`SYSTEM`, `TEMPLATE`, `LICENSE`, `MESSAGE`), whose lines are never directives. */
const QUOTE = '"""';
/** Ollama stores every layer under its own sha256, so the weights' blob name is the GGUF's digest. */
const BLOB = /\/blobs\/sha256-([0-9a-f]{64})$/;

const unverified = (reason: string): ServedCheck => ({ status: 'unverified', reason });
const mismatch = (detail: string): ServedCheck => ({ status: 'mismatch', detail });

interface Directive {
  readonly keyword: string;
  readonly argument: string;
}

const directivesOf = (modelfile: string): readonly Directive[] => {
  const directives: Directive[] = [];
  let quoted = false;
  for (const line of modelfile.split('\n')) {
    const match = quoted ? null : DIRECTIVE.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined)
      directives.push({ keyword: match[1], argument: match[2] });
    if (line.split(QUOTE).length % 2 === 0) quoted = !quoted;
  }
  return directives;
};

/** Judges an `ollama show --modelfile` text against the pin's weights. */
export const modelfileCheck = (modelfile: string, pin: GeneratorPin): ServedCheck => {
  const directives = directivesOf(modelfile);
  const adapter = directives.find(({ keyword }) => keyword === 'ADAPTER');
  if (adapter !== undefined)
    return mismatch(`serves ADAPTER ${adapter.argument}, which the pin does not name`);
  const froms = directives.filter(({ keyword }) => keyword === 'FROM');
  const [from] = froms;
  if (from === undefined || froms.length > 1)
    return unverified(`the modelfile has ${String(froms.length)} FROM lines, not one`);
  const blob = BLOB.exec(from.argument)?.[1];
  if (blob === undefined)
    return unverified(`FROM names no content-addressed blob: ${from.argument}`);
  return blob === pin.sha256
    ? { status: 'verified' }
    : mismatch(`serves blob sha256-${blob}, not the pin's sha256-${pin.sha256}`);
};

/**
 * Asks the server which weights it serves as `servedModel`, through Ollama's `/api/show` on the
 * endpoint's origin. Failure policy: one attempt, `timeoutMs` as the bound, redirects refused; a
 * server that cannot be asked is `unverified`, never a failure (#171).
 */
export const checkServedModel = async (config: HttpGeneratorConfig): Promise<ServedCheck> => {
  const url = new URL('/api/show', config.endpoint);
  const at = `POST ${url.href} for ${config.servedModel}`;
  let body: unknown;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.servedModel }),
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      const excerpt = (await response.text()).slice(0, BODY_EXCERPT_CHARS);
      return unverified(`${at}: HTTP ${String(response.status)}: ${excerpt}`);
    }
    body = await response.json();
  } catch (error) {
    return unverified(`${at}: ${describeError(error)}`);
  }
  const show = ShowReply.safeParse(body);
  if (!show.success)
    return unverified(`${at}: not an /api/show reply: ${z.prettifyError(show.error)}`);
  const check = modelfileCheck(show.data.modelfile, config.pin);
  switch (check.status) {
    case 'verified':
      return check;
    case 'unverified':
      return unverified(`${at}: ${check.reason}`);
    case 'mismatch':
      return mismatch(`${at}: ${check.detail}`);
  }
};
