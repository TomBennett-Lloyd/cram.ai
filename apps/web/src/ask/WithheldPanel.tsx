import type { WithheldUnit } from '@cram/shared';
import { withheldMessage } from '../copy';

/**
 * The one place a withheld unit's text appears, folded and never styled as the answer
 * (`docs/standards/grounding.md` rule 7).
 */
export const WithheldPanel = ({ withheld }: { readonly withheld: readonly WithheldUnit[] }) =>
  withheld.length === 0 ? null : (
    <details className="withheld">
      <summary>Withheld ({withheld.length})</summary>
      <ul>
        {withheld.map((entry, index) => (
          <li key={index}>
            <p className="withheld-text">{entry.unit.text}</p>
            <p className="withheld-reason">{withheldMessage(entry)}</p>
          </li>
        ))}
      </ul>
    </details>
  );
