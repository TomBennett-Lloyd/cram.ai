import { describe, expect, it } from 'vitest';
import { courseFilePath, resolveDataDir } from './data-directory';
import { CourseId } from '@cram/shared';

const resolved = (path: string) => ({ status: 'resolved', path });

describe('resolveDataDir', () => {
  it('defaults to the OS app-data folder on each platform', () => {
    expect(resolveDataDir({ platform: 'darwin', env: {}, homedir: '/Users/ann' })).toEqual(
      resolved('/Users/ann/Library/Application Support/cram.ai'),
    );
    expect(
      resolveDataDir({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\ann\\AppData\\Roaming' },
        homedir: 'C:\\Users\\ann',
      }),
    ).toEqual(resolved('C:\\Users\\ann\\AppData\\Roaming\\cram.ai'));
    expect(
      resolveDataDir({
        platform: 'linux',
        env: { XDG_DATA_HOME: '/data/ann' },
        homedir: '/home/ann',
      }),
    ).toEqual(resolved('/data/ann/cram.ai'));
  });

  it('falls back from an absent or relative APPDATA and XDG_DATA_HOME', () => {
    const windows = { platform: 'win32', homedir: 'C:\\Users\\ann' } as const;
    const fallback = resolved('C:\\Users\\ann\\AppData\\Roaming\\cram.ai');
    expect(resolveDataDir({ ...windows, env: {} })).toEqual(fallback);
    expect(resolveDataDir({ ...windows, env: { APPDATA: 'Roaming' } })).toEqual(fallback);
    const linux = { platform: 'linux', homedir: '/home/ann' } as const;
    const share = resolved('/home/ann/.local/share/cram.ai');
    expect(resolveDataDir({ ...linux, env: {} })).toEqual(share);
    expect(resolveDataDir({ ...linux, env: { XDG_DATA_HOME: 'data' } })).toEqual(share);
  });

  it('takes an absolute CRAM_DATA_DIR over the default, by the platform’s own path rules', () => {
    expect(
      resolveDataDir({
        platform: 'linux',
        env: { CRAM_DATA_DIR: '/srv/cram' },
        homedir: '/home/ann',
      }),
    ).toEqual(resolved('/srv/cram'));
    expect(
      resolveDataDir({
        platform: 'win32',
        env: { CRAM_DATA_DIR: 'D:\\cram' },
        homedir: 'C:\\Users\\ann',
      }),
    ).toEqual(resolved('D:\\cram'));
    expect(
      resolveDataDir({
        platform: 'linux',
        env: { CRAM_DATA_DIR: 'D:\\cram' },
        homedir: '/home/ann',
      }),
    ).toEqual({
      status: 'relative-override',
      value: 'D:\\cram',
    });
  });

  it('refuses a relative CRAM_DATA_DIR rather than resolve it against the working directory', () => {
    expect(
      resolveDataDir({ platform: 'darwin', env: { CRAM_DATA_DIR: 'data' }, homedir: '/Users/ann' }),
    ).toEqual({
      status: 'relative-override',
      value: 'data',
    });
  });

  it('treats an empty CRAM_DATA_DIR as unset', () => {
    expect(
      resolveDataDir({ platform: 'darwin', env: { CRAM_DATA_DIR: '' }, homedir: '/Users/ann' }),
    ).toEqual(resolved('/Users/ann/Library/Application Support/cram.ai'));
  });
});

describe('courseFilePath', () => {
  it('names the course file after its course id, under courses/', () => {
    expect(courseFilePath('/srv/cram', CourseId.parse('bio-101'))).toBe(
      '/srv/cram/courses/bio-101.sqlite',
    );
  });
});
