import { type ChunkTag, TopicTag } from '@cram/shared';
import { type SubmitEvent, useRef, useState } from 'react';
import type { ApiFailure } from '../api/api-result';
import { ADD_TAG, addTagLabel, failureMessage, NEW_TAG, removeTagLabel, tagsLabel } from '../copy';
import { Failed } from '../shell/async-states';

/**
 * One chunk's tags, each removable, and a field to add one. A removed tag's button hands the
 * focus to the one that takes its place, else the field (`docs/standards/react.md`'s landing rule).
 */
export const TagEditor = ({
  name,
  tags,
  failure,
  onEdit,
}: {
  readonly name: string;
  readonly tags: readonly ChunkTag[];
  readonly failure: ApiFailure | undefined;
  readonly onEdit: (tags: readonly TopicTag[]) => void;
}) => {
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const held = tags.map(({ tag }) => tag);
  const add = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const tag = TopicTag.safeParse(draft.trim());
    if (!tag.success) return;
    setDraft('');
    if (!held.includes(tag.data)) onEdit([...held, tag.data]);
  };
  const remove = (index: number, button: HTMLButtonElement): void => {
    const focused = document.activeElement === button;
    onEdit(held.filter((_, at) => at !== index));
    if (!focused) return;
    const buttons = [...(list.current?.querySelectorAll('button') ?? [])].filter(
      (each) => each !== button,
    );
    (buttons[Math.min(index, buttons.length - 1)] ?? field.current)?.focus();
  };
  return (
    <div className="tag-editor">
      {tags.length > 0 && (
        <ul ref={list} className="tag-list" aria-label={tagsLabel(name)}>
          {tags.map(({ tag, origin }, index) => (
            <li key={tag} className="tag" data-origin={origin}>
              <span className="tag-text">{tag}</span>
              <button
                type="button"
                className="tag-remove"
                aria-label={removeTagLabel(tag, origin)}
                onClick={(event) => {
                  remove(index, event.currentTarget);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="tag-form" onSubmit={add}>
        <input
          ref={field}
          aria-label={addTagLabel(name)}
          placeholder={NEW_TAG}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
        />
        <button type="submit">{ADD_TAG}</button>
      </form>
      {failure !== undefined && <Failed messages={[failureMessage(failure)]} />}
    </div>
  );
};
