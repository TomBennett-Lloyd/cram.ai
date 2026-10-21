// The generator pin and its context length, as models-pull.sh reads them (#20, #302).
//
// argv[2]: the module to read, packages/gateway/src/provisional-pins.ts. stdout: four lines, the
// artefact's repository, its file, its sha256 and PROVISIONAL_GENERATOR_CONTEXT_LENGTH, each read
// from that module's exports and none restated here. models-pull.test.sh runs it on a fixture module.
import { build } from 'esbuild';

const out = await build({
  entryPoints: [process.argv[2]],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'error',
});
const {
  PROVISIONAL_DEFAULT_PINS: { generator },
  PROVISIONAL_GENERATOR_CONTEXT_LENGTH: contextLength,
} = await import('data:text/javascript,' + encodeURIComponent(out.outputFiles[0].text));
console.log(
  [generator.artefact.repository, generator.artefact.file, generator.sha256, contextLength].join(
    '\n',
  ),
);
