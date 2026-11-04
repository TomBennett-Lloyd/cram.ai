import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SlideImage } from '@cram/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDeck, type FixtureLine } from './deck-fixture';
import { renderPdfDeck, SLIDE_IMAGE_LONG_EDGE_PX } from './render-page';

const TITLE = 48;
const BODY = 28;

const line = (text: string, size = BODY): FixtureLine => ({ text, size });

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image's size in pixels, and how many of its pixels are darker than mid-grey. */
const decoded = async ({ content }: SlideImage) => {
  const image = await loadImage(content);
  const context = createCanvas(image.width, image.height).getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 255) < 128) inked++;
  return { width: image.width, height: image.height, inked };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('renderPdfDeck', () => {
  it('renders each page once, as a PNG under its page number, inked where the page has text', async () => {
    const images = await renderPdfDeck(
      await buildDeck({
        pages: [
          { lines: [line('Kinetics', TITLE), line('Rates and orders of reaction')] },
          { lines: [] },
          { lines: [line('Orders', TITLE)] },
        ],
      }),
    );
    expect(images.map(({ slideNo }) => slideNo)).toEqual([1, 2, 3]);
    for (const image of images) {
      expect(image.mediaType).toBe('image/png');
      expect([...image.content.subarray(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE);
    }
    const [text, blank, last] = await Promise.all(images.map(decoded));
    expect(text?.inked).toBeGreaterThan(0);
    expect(blank?.inked).toBe(0);
    expect(last?.inked).toBeGreaterThan(0);
  });

  it('renders a page at the long edge along its longer side, landscape or portrait', async () => {
    const images = await renderPdfDeck(
      await buildDeck({
        pages: [
          { lines: [line('Kinetics', TITLE)], size: [960, 540] },
          { lines: [line('Kinetics', TITLE)], size: [540, 960] },
          { lines: [line('Kinetics', TITLE)], size: [704, 396] },
        ],
      }),
    );
    const short = Math.round((SLIDE_IMAGE_LONG_EDGE_PX * 540) / 960);
    const [landscape, portrait, inexact] = await Promise.all(images.map(decoded));
    expect(landscape).toMatchObject({ width: SLIDE_IMAGE_LONG_EDGE_PX, height: short });
    expect(portrait).toMatchObject({ width: short, height: SLIDE_IMAGE_LONG_EDGE_PX });
    expect(inexact).toMatchObject({ width: SLIDE_IMAGE_LONG_EDGE_PX, height: short });
  });

  it('leaves the caller buffer intact, since the caller stores it as the deck', async () => {
    const bytes = await buildDeck({ pages: [{ lines: [line('Kinetics', TITLE)] }] });
    const digest = createHash('sha256').update(bytes).digest('hex');
    await renderPdfDeck(bytes);
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
  });

  it('makes no network request while rendering a deck', async () => {
    const refuse = vi.fn(() => {
      throw new Error('network request during rendering');
    });
    vi.stubGlobal('fetch', refuse);
    vi.stubGlobal('XMLHttpRequest', refuse);
    for (const client of [http, https]) {
      vi.spyOn(client, 'request').mockImplementation(refuse);
      vi.spyOn(client, 'get').mockImplementation(refuse);
    }
    await renderPdfDeck(await buildDeck({ pages: [{ lines: [line('Kinetics', TITLE)] }] }));
    expect(refuse).not.toHaveBeenCalled();
  });
});
