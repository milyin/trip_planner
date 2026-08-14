import { expect, test } from '@playwright/test';

test('remote recognition keeps omitted fields blank on pasted and queued legs', async ({ context, page }) => {
  await context.route('https://nominatim.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await context.route('https://openrouter.ai/api/v1/chat/completions', async (route) => {
    const request = JSON.parse(route.request().postData() ?? '{}') as {
      response_format?: { json_schema?: { name?: string } };
    };
    const auto = request.response_format?.json_schema?.name === 'trip_import';
    const content = auto
      ? { kind: 'legs', legs: [{ depCity: 'Auto departure', arrCity: 'Auto arrival', transport: 'Plane' }] }
      : { legs: [
        { depCity: 'First departure', arrCity: 'First arrival', transport: 'Train' },
        { depCity: 'Second departure', arrCity: 'Second arrival', transport: 'Bus' },
      ] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
    });
  });

  await page.goto('/trip_planner/');
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('tripPlanner.settings.v1', JSON.stringify({
      accounts: [{ id: 'account', provider: 'openrouter', apiKey: 'test-key' }],
      parsers: [{ accountId: 'account', model: 'test-model' }],
      activeParser: 0,
      scribeEnabled: false,
      scribeLanguages: ['eng'],
      theme: 'dark',
      baseCurrency: 'EUR',
    }));
  });
  await page.reload();

  const expectBlankRequiredDates = async (): Promise<void> => {
    for (const id of ['fDepDate', 'fDepTime', 'fArrDate', 'fArrTime']) {
      await expect(page.locator(`#${id}`)).toHaveValue('');
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-invalid', 'true');
    }
  };

  await page.locator('#hamBtn').click();
  await page.locator('#addLegBtn').click();
  await page.locator('#mtabRecognize').click();
  await page.locator('#fNote').fill('two incomplete legs');
  await page.locator('#recogniseBtn').click();
  await expect(page.locator('#fDepCity')).toHaveValue('First departure');
  await expectBlankRequiredDates();

  await page.locator('#cancelBtn').click();
  await expect(page.locator('#fDepCity')).toHaveValue('Second departure');
  await expectBlankRequiredDates();
  await page.locator('#cancelBtn').click();

  await page.evaluate(async () => {
    const modulePath = '/trip_planner/src/ui/modal.ts';
    const { importPastedImage } = await import(/* @vite-ignore */ modulePath) as typeof import('../src/ui/modal');
    await importPastedImage(new File(['image'], 'incomplete.png', { type: 'image/png' }));
  });
  await expect(page.locator('#fDepCity')).toHaveValue('Auto departure');
  await expectBlankRequiredDates();
});
