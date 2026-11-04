/** CommonMark 0.31.2 § 2.1's blank line: the end of a line ending (`\n`, or a `\r` no `\n` follows), spaces or tabs, the next. */
export const BLANK_LINE = /(?:\n|\r(?!\n))[ \t]*[\r\n]/;
