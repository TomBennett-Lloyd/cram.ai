import type { CourseId } from '@cram/shared';
import { type SubmitEvent, useState } from 'react';
import { useApi } from '../api/api-context';
import { failureMessage, PENDING } from '../copy';
import { Failed, Pending } from '../shell/async-states';
import { AnswerView } from './AnswerView';
import type { CitedSlide } from './cited-slide';
import { SlideDialog } from './SlideDialog';
import { useAsk } from './use-ask';

export const AskScreen = ({ courseId }: { readonly courseId: CourseId }) => {
  const { state, ask } = useAsk(useApi(), courseId);
  const [question, setQuestion] = useState('');
  const [open, setOpen] = useState<CitedSlide | null>(null);
  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (question.trim() !== '') ask(question);
  };
  return (
    <main className="screen">
      <form className="ask-form" onSubmit={onSubmit}>
        <input
          aria-label="Question"
          name="question"
          autoComplete="off"
          value={question}
          onChange={(event) => {
            setQuestion(event.currentTarget.value);
          }}
        />
        <button type="submit" disabled={question.trim() === ''}>
          Ask
        </button>
      </form>
      <section className="reply" aria-label="Answer">
        {state.status === 'idle' ? null : state.status === 'pending' ? (
          <Pending label={PENDING.answer} />
        ) : state.status === 'ok' ? (
          <AnswerView reply={state.value} onOpen={setOpen} />
        ) : (
          <Failed message={failureMessage(state)} />
        )}
      </section>
      {open !== null && (
        <SlideDialog
          cited={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </main>
  );
};
