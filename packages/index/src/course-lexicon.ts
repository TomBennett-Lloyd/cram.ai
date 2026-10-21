import Database from 'better-sqlite3';
import { SlideKind } from '@cram/shared';
import { z } from 'zod';
import { chunkFromRow, ftsValues } from './chunk-row';
import { COMMON_WORDS } from './common-words';
import {
  correctSpelling,
  type CourseTerm,
  type Lexicon,
  type SpellingCorrection,
} from './spelling-correction';

const VocabularyRow = z.object({ term: z.string(), doc: z.number().int() });
const LectureTitle = z.object({ lecture_title: z.string() });

const quoted = (token: string): string => `"${token}"`;

/** In memory, as a `query_only` reader (`openCourseReadOnly`) refuses temp tables; `vocabulary` tokenizes as `slides_fts` does. */
const SIDE_TABLES = `
  create virtual table vocabulary using fts5(text);
  create virtual table vocabulary_terms using fts5vocab(vocabulary, row);
  create virtual table common_words using fts5(words, tokenize = 'porter unicode61');
  create virtual table stem_probe using fts5(word, tokenize = 'porter unicode61');
`;

const CHUNK_TEXT = `select slides.lecture_title, chunks.chunk_no, chunks.title, chunks.body,
    chunks.speaker_notes, chunks.image_captions
  from chunks join slides on slides.id = chunks.slide_id where slides.kind != '${SlideKind.enum.references}'`;

/** Answered by FTS5: the index's own tokenizer, and FTS5's `porter` over it for word forms (#393). */
export class CourseLexicon implements Lexicon {
  readonly #course: Database.Database;
  readonly #side: Database.Database;
  #vocabularyBuilt = false;

  constructor(course: Database.Database) {
    this.#course = course;
    this.#side = new Database(':memory:');
    this.#side.exec(SIDE_TABLES);
    this.#side.prepare('insert into common_words (words) values (?)').run(COMMON_WORDS.join(' '));
  }

  #buildVocabulary(): void {
    if (this.#vocabularyBuilt) return;
    const insert = this.#side.prepare('insert into vocabulary (text) values (?)');
    this.#side.transaction(() => {
      for (const row of this.#course.prepare(CHUNK_TEXT).iterate()) {
        const { lecture_title } = LectureTitle.parse(row);
        insert.run(ftsValues(lecture_title, chunkFromRow(row)).join('\n'));
      }
    })();
    this.#vocabularyBuilt = true;
  }

  isCourseTerm(token: string): boolean {
    return (
      this.#course
        .prepare('select rowid from slides_fts where slides_fts match ? limit 1')
        .get(quoted(token)) !== undefined
    );
  }

  isCommonWord(token: string): boolean {
    return (
      this.#side
        .prepare('select rowid from common_words where common_words match ?')
        .get(quoted(token)) !== undefined
    );
  }

  termsOfLength(min: number, max: number): readonly CourseTerm[] {
    this.#buildVocabulary();
    return this.#side
      .prepare('select term, doc from vocabulary_terms where length(term) between ? and ?')
      .all(min, max)
      .map((row) => {
        const { term, doc } = VocabularyRow.parse(row);
        return { term, documents: doc };
      });
  }

  isInflection(typed: string, term: string): boolean {
    this.#side.prepare('insert into stem_probe (word) values (?)').run(typed);
    try {
      return (
        this.#side
          .prepare('select rowid from stem_probe where stem_probe match ?')
          .get(quoted(term)) !== undefined
      );
    } finally {
      this.#side.prepare('delete from stem_probe').run();
    }
  }

  close(): void {
    this.#side.close();
  }
}

/** `correctSpelling` against the course file `course` holds (`CourseIndex.correctSpelling`). */
export const correctCourseSpelling = (
  course: Database.Database,
  text: string,
): SpellingCorrection => {
  const lexicon = new CourseLexicon(course);
  try {
    return correctSpelling(text, lexicon);
  } finally {
    lexicon.close();
  }
};
