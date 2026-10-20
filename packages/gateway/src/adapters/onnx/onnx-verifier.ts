import { join } from 'node:path';
import { type EntailmentResult, EntailRequest } from '../../encoder-requests';
import type { Verifier } from '../../model-gateway';
import type { VerifierPin } from '../../pin';
import { VerifierConfig } from '../../role-config';
import {
  type EncoderLoad,
  invalid,
  loadedOrRefused,
  MODEL_CONFIG_FILE,
  readJson,
} from './encoder-artefact';
import {
  brokenInvariant,
  type EncoderSession,
  logitsOf,
  openEncoderSession,
} from './encoder-session';
import { entailmentScores, type LabelIndex, labelIndexOf, ModelLabels } from './entailment-labels';

const NLI_CLASSES = 3;

export class OnnxVerifier implements Verifier {
  readonly pin: VerifierPin;
  readonly #session: EncoderSession;
  readonly #labels: LabelIndex;

  constructor(pin: VerifierPin, session: EncoderSession, labels: LabelIndex) {
    this.pin = pin;
    this.#session = session;
    this.#labels = labels;
  }

  /** The premise is the first segment and the hypothesis the second, the order NLI models are trained in. */
  async entail(request: EntailRequest): Promise<readonly EntailmentResult[]> {
    const results: EntailmentResult[] = [];
    for (const { premise, hypothesis } of EntailRequest.parse(request).pairs) {
      const output = await this.#session.run(premise, hypothesis);
      if (output.status === 'over-length') {
        results.push(output);
        continue;
      }
      const logits = logitsOf(output, NLI_CLASSES);
      if (logits === null) throw brokenInvariant('OnnxVerifier', output);
      results.push({ status: 'scored', scores: entailmentScores(logits, this.#labels) });
    }
    return results;
  }
}

export const loadOnnxVerifier = async (
  config: VerifierConfig,
): Promise<EncoderLoad<OnnxVerifier>> => {
  const { pin, directory } = VerifierConfig.parse(config);
  return loadedOrRefused('verifier', async () => {
    const session = await openEncoderSession({ pin, directory, output: 'logits' });
    const configPath = join(directory, MODEL_CONFIG_FILE);
    const { id2label } = await readJson(configPath, ModelLabels);
    const labels = labelIndexOf(id2label);
    if (labels === null) {
      throw invalid(
        configPath,
        `id2label ${JSON.stringify(id2label)} is not the three NLI classes`,
      );
    }
    await session.probe((output) => logitsOf(output, NLI_CLASSES) !== null, '');
    return new OnnxVerifier(pin, session, labels);
  });
};
