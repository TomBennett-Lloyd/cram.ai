import type { CourseId } from '@cram/shared';
import { type SubmitEvent, useRef, useState } from 'react';
import { useApi } from '../api/api-context';
import { failureMessage, NEW_QUESTION, PENDING } from '../copy';
import { Failed, Pending } from '../shell/async-states';
import { AnswerView } from './AnswerView';
import type { CitedSlide } from './cited-slide';
import { SlideDialog } from './SlideDialog';
import { type Exchange, useThread } from './use-thread';

const ExchangeState = ({
  state,
  onOpen,
}: {
  readonly state: Exchange['state'];
  readonly onOpen: (cited: CitedSlide) => void;
}) => {
  switch (state.status) {
    case 'pending':
      return <Pending label={PENDING.answer} />;
    case 'ok':
      return <AnswerView reply={state.value} onOpen={onOpen} />;
    default:
      return <Failed messages={[failureMessage(state)]} />;
  }
};

export const AskScreen = ({ courseId }: { readonly courseId: CourseId }) => {
  const { exchanges, ask, reset } = useThread(useApi(), courseId);
  const [question, setQuestion] = useState('');
  const [open, setOpen] = useState<CitedSlide | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (question.trim() === '') return;
    ask(question);
    setQuestion('');
    field.current?.focus();
  };
  return (
    <main className="screen">
      <form className="ask-form" onSubmit={onSubmit}>
        <input
          ref={field}
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
        {exchanges.length > 0 && (
          <button
            type="button"
            onClick={() => {
              reset();
              setQuestion('');
              field.current?.focus();
            }}
          >
            {NEW_QUESTION}
          </button>
        )}
      </form>
      <section className="reply" aria-label="Answer">
        {exchanges.length > 0 && (
          <ol className="thread">
            {exchanges.map((exchange, at) => (
              <li className="exchange" key={at}>
                <p className="exchange-question">{exchange.question}</p>
                <ExchangeState state={exchange.state} onOpen={setOpen} />
              </li>
            ))}
          </ol>
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
