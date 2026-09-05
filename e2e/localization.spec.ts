import { expect, test } from '@playwright/test';

test('language links preserve the page, query and changing hash', async ({ page }) => {
  await page.goto('history/?from=language-test#object-biography');
  const english = page.locator('[data-language-link][lang="en"]');
  await expect(english).toHaveAttribute('href', /\/yu\/en\/history\/\?from=language-test#object-biography$/);
  await english.click();
  await expect(page).toHaveURL(/\/en\/history\/\?from=language-test#object-biography$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.evaluate(() => { location.hash = 'timeline-title'; });
  await expect(page.locator('[data-language-link][lang="ru"]')).toHaveAttribute('href', /\/yu\/history\/\?from=language-test#timeline-title$/);
});

test('English interactive states keep English accessible names', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('en/history/#object-biography');
  const object = page.locator('[data-object-explorer]');
  await object.getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(object.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Zoom 2.5×');
  await page.goto('en/material/#material-lens');
  const slider = page.locator('#material-lens-control');
  await slider.fill('35');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Diagram area: nephrite 35%, jadeite 65%');
  await page.goto('en/mythology/#legend-history');
  const tabs = page.locator('legend-history').getByRole('tab');
  await tabs.first().focus();
  await page.keyboard.press('End');
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('legend-history').getByRole('tabpanel').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  expect(errors).toEqual([]);
});

test('a contextual definition opens accessibly and returns keyboard focus', async ({ page }, info) => {
  await page.goto('en/');
  const term = page.locator('a[data-term="jade"]').first();
  await term.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-glossary-entry="jade"]')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close glossary' })).toBeFocused();
  await expect(dialog.locator('[data-glossary-entry="jade"] a').last()).toHaveAttribute('href', '/yu/en/glossary/#jade');
  await dialog.screenshot({ path: info.outputPath('english-glossary-dialog.png') });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(term).toBeFocused();
});

test('both languages render with local fonts and fit narrow screens', async ({ page }) => {
  const fontRequests: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'font') fontRequests.push(request.url()); });
  await page.setViewportSize({ width: 320, height: 740 });
  for (const locale of ['', 'en/']) {
    for (const route of ['', 'history/', 'mythology/', 'material/', 'medicine/', 'sources/', 'glossary/']) {
      await page.goto(`${locale}${route}` || './');
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${locale}${route}`).toBe(true);
      expect(await page.evaluate(() => document.fonts.check('16px Manrope') && document.fonts.check('16px Prata'))).toBe(true);
    }
  }
  expect(fontRequests.length).toBeGreaterThan(0);
  expect(fontRequests.every((url) => url.startsWith('http://127.0.0.1:4321/yu/fonts/'))).toBe(true);
});

test.describe('English without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('opened source cards stay inside a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('en/history/#timeline-title');
    const source = page.locator('.timeline__sources .source-ref').first();
    // Native keyboard activation avoids Playwright's RAF stability polling when JS is disabled.
    await source.locator('summary').focus();
    await page.keyboard.press('Enter');
    const card = source.locator('.source-ref__card');
    await expect(card).toBeVisible();
    expect(await card.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth + 1;
    })).toBe(true);
    await source.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(card).toBeHidden();
  });

  test('navigation and term destinations remain ordinary links', async ({ page }) => {
    await page.goto('en/');
    await expect(page.locator('#primary-navigation')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    const term = page.locator('a[data-term="jade"]').first();
    await expect(term).toHaveAttribute('href', '/yu/en/glossary/#jade');
    await term.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/en\/glossary\/#jade$/);
    await expect(page.locator('article#jade')).toBeVisible();
    await expect(page.locator('.glossary-entry')).toHaveCount(6);
    await expect(page.locator('dialog')).toBeHidden();
  });
});
