import { join, posix, win32 } from 'node:path';
import type { CourseId } from '@cram/shared';

const APP_DIRECTORY = 'cram.ai';

/** The process facts the default depends on, passed in so resolution stays pure. */
export interface DataDirectoryHost {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
}

export type DataDirectory =
  | { readonly status: 'resolved'; readonly path: string }
  | { readonly status: 'relative-override'; readonly value: string };

type PathApi = typeof posix;

const absolute = (value: string | undefined, paths: PathApi): string | undefined =>
  value !== undefined && paths.isAbsolute(value) ? value : undefined;

const platformDefault = ({ platform, env, homedir }: DataDirectoryHost): string => {
  switch (platform) {
    case 'win32':
      return win32.join(
        absolute(env.APPDATA, win32) ?? win32.join(homedir, 'AppData', 'Roaming'),
        APP_DIRECTORY,
      );
    case 'darwin':
      return posix.join(homedir, 'Library', 'Application Support', APP_DIRECTORY);
    default:
      return posix.join(
        absolute(env.XDG_DATA_HOME, posix) ?? posix.join(homedir, '.local', 'share'),
        APP_DIRECTORY,
      );
  }
};

/** `CRAM_DATA_DIR` when set, else the OS app-data folder (`docs/adr/0004-storage.md` § Decision (a)). */
export const resolveDataDir = (host: DataDirectoryHost): DataDirectory => {
  const override = host.env.CRAM_DATA_DIR;
  if (override === undefined || override === '')
    return { status: 'resolved', path: platformDefault(host) };
  const paths = host.platform === 'win32' ? win32 : posix;
  return paths.isAbsolute(override)
    ? { status: 'resolved', path: override }
    : { status: 'relative-override', value: override };
};

/** The directory holding every course file. */
export const coursesDirectory = (dataDir: string): string => join(dataDir, 'courses');

/** Its extension is one `.claude/scripts/check-no-course-content.sh` refuses. */
export const COURSE_FILE_EXTENSION = '.sqlite';

export const courseFilePath = (dataDir: string, courseId: CourseId): string =>
  join(coursesDirectory(dataDir), `${courseId}${COURSE_FILE_EXTENSION}`);
