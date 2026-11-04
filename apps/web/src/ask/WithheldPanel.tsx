import type { WithheldSentence } from '@cram/shared';
import { withheldMessage } from '../copy';
import { WithheldDetails, WithheldItem } from '../shell/WithheldDetails';

export const WithheldPanel = ({ withheld }: { readonly withheld: readonly WithheldSentence[] }) =>
  withheld.length === 0 ? null : (
    <WithheldDetails count={withheld.length}>
      <ul>
        {withheld.map((entry, index) => (
          <WithheldItem key={index} text={entry.text} reason={withheldMessage(entry)} />
        ))}
      </ul>
    </WithheldDetails>
  );
