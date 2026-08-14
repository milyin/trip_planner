import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

interface OcrFixture {
  languages: string[];
  now: string;
  note?: string;
  expected: Record<string, unknown>;
  absent?: string[];
}

const ASSETS = join(import.meta.dirname, 'assets');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const imageFiles = readdirSync(ASSETS)
  .filter((file) => IMAGE_EXTENSIONS.has(extname(file).toLowerCase()))
  .sort();

if (!imageFiles.length) throw new Error(`No OCR images found in ${ASSETS}`);

const fixtures = imageFiles.map((imageFile) => {
  const expectationFile = join(ASSETS, `${basename(imageFile, extname(imageFile))}.expected.json`);
  if (!existsSync(expectationFile)) {
    throw new Error(`OCR image ${imageFile} has no expectation file: ${expectationFile}`);
  }
  return {
    imageFile,
    imageBase64: readFileSync(join(ASSETS, imageFile)).toString('base64'),
    fixture: JSON.parse(readFileSync(expectationFile, 'utf8')) as OcrFixture,
  };
});

test.describe('local Scribe.js OCR fixtures', () => {
  test.describe.configure({ mode: 'serial' });

  for (const { imageFile, imageBase64, fixture } of fixtures) {
    test(imageFile, async ({ context, page }, testInfo) => {
      await context.route('https://nominatim.openstreetmap.org/**', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      await page.addInitScript(({ languages, fixedNow }) => {
        const RealDate = Date;
        class FixedDate extends RealDate {
          constructor(...args: unknown[]) {
            if (args.length === 0) super(fixedNow);
            else if (args.length === 1) super(args[0] as string | number | Date);
            else if (args.length === 2) super(args[0] as number, args[1] as number);
            else if (args.length === 3) super(args[0] as number, args[1] as number, args[2] as number);
            else if (args.length === 4) super(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
            else if (args.length === 5) super(args[0] as number, args[1] as number, args[2] as number, args[3] as number, args[4] as number);
            else if (args.length === 6) super(args[0] as number, args[1] as number, args[2] as number, args[3] as number, args[4] as number, args[5] as number);
            else super(args[0] as number, args[1] as number, args[2] as number, args[3] as number, args[4] as number, args[5] as number, args[6] as number);
          }

          static now(): number { return new RealDate(fixedNow).getTime(); }
        }
        globalThis.Date = FixedDate as DateConstructor;
        localStorage.clear();
        localStorage.setItem('tripPlanner.settings.v1', JSON.stringify({
          accounts: [],
          parsers: [],
          activeParser: null,
          scribeEnabled: true,
          scribeLanguages: languages,
          theme: 'dark',
          baseCurrency: 'EUR',
        }));
      }, { languages: fixture.languages, fixedNow: fixture.now });

      await page.goto('/trip_planner/');
      const result = await page.evaluate(async ({ base64, fileName, note }) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
        const type = extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : `image/${extension}`;
        const file = new File([bytes], fileName, { type });
        const localModulePath = '/trip_planner/src/import/local.ts';
        const { extractLocalLegs } = await import(/* @vite-ignore */ localModulePath) as typeof import('../src/import/local');
        return extractLocalLegs({ files: [file], note });
      }, { base64: imageBase64, fileName: imageFile, note: fixture.note ?? '' });

      await testInfo.attach('parsed-result.json', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject(fixture.expected);
      for (const field of fixture.absent ?? []) expect(result[0]).not.toHaveProperty(field);
    });
  }
});
