import { expect, test, type Page } from '@playwright/test';

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test('home leads to all three investigations', async ({ page }, info) => {
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Интерактивные исследования' });
  await expect(nav.getByRole('link')).toHaveCount(3);
  for (const path of ['history/#object-biography', 'mythology/#legend-history', 'material/#material-lens']) {
    await expect(nav.locator(`a[href="/yu/${path}"]`)).toBeVisible();
  }
  await noOverflow(page);
  await page.locator('.experience-gateway').screenshot({ path: info.outputPath('home-gateway.png') });
});

test('object zoom, details, keyboard and reset work', async ({ page, isMobile }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('history/#object-biography');
  const root = page.locator('[data-object-explorer]');
  const detail = root.getByRole('button', { name: '03 · Край' });
  if (isMobile) await detail.tap(); else await detail.click();
  await expect(detail).toHaveAttribute('aria-pressed', 'true');
  await expect(root.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Увеличение 2,5×');
  const viewport = root.locator('[data-object-viewport]');
  await viewport.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(detail).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Escape');
  await expect(root.getByRole('slider')).toHaveValue('1');
  await root.getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(root.getByRole('slider')).toHaveValue('2.5');
  await root.getByRole('button', { name: 'Показать диск целиком' }).click();
  await expect(root).toHaveAttribute('data-zoomed', 'false');
  await expect(page.locator('.object-chapters > li')).toHaveCount(5);
  await noOverflow(page);
  await page.locator('#object-biography').screenshot({ path: info.outputPath('object-biography.png') });
  expect(errors).toEqual([]);
});

test('mineral slider reveals distinct structures with clear limits', async ({ page }, info) => {
  await page.goto('material/#material-lens');
  const slider = page.locator('#material-lens-control');
  await expect(slider).toBeVisible();
  await slider.focus();
  await page.keyboard.press('End');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Область схемы: нефрит 100%, жадеит 0%');
  await expect(page.locator('material-lens')).toHaveCSS('--lens', '100%');
  await page.keyboard.press('Home');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Область схемы: нефрит 0%, жадеит 100%');
  await slider.fill('50');
  await expect(page.getByRole('img', { name: 'Схема структуры нефрита' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Схема структуры жадеита' })).toBeVisible();
  await expect(page.locator('.lens__notice')).toContainText('не микрофотографии, не диагностика');
  await noOverflow(page);
  await page.locator('.lens__figure').screenshot({ path: info.outputPath('material-lens.png') });
});

test('legend witnesses support touch and a complete keyboard tab pattern', async ({ page, isMobile }, info) => {
  await page.goto('mythology/#legend-history');
  const root = page.locator('legend-history');
  const tabs = root.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(root.getByRole('tabpanel')).toHaveCount(1);
  if (isMobile) await tabs.nth(1).tap(); else await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(root.getByRole('tabpanel')).toContainText('Сокровище между двумя царствами');
  await tabs.nth(1).focus();
  await page.keyboard.press('End');
  await expect(tabs.nth(2)).toBeFocused();
  await expect(root.getByRole('tabpanel')).toContainText('2 марта 2015 года');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(0)).toBeFocused();
  await expect(root.getByRole('tabpanel')).toContainText('Время внутри сюжета');
  await noOverflow(page);
  await root.screenshot({ path: info.outputPath('legend-history.png') });
});

test('reduced-motion reading remains available at narrow widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  for (const [path, heading] of [
    ['history/#object-biography', '#object-title'],
    ['material/#material-lens', '.lens__notice'],
    ['mythology/#legend-history', '#legend-history-title'],
  ]) {
    await page.goto(path);
    await expect(page.locator(heading)).toBeVisible();
    await noOverflow(page);
    if (path.startsWith('material/')) {
      const headingsFit = await page.locator('.lens__key h3').evaluateAll((headings) => headings.every((heading) => {
        const range = document.createRange();
        range.selectNodeContents(heading);
        return range.getBoundingClientRect().right <= heading.getBoundingClientRect().right + 1;
      }));
      expect(headingsFit, 'mineral labels must stay inside their comparison columns').toBe(true);
    }
  }
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('all evidence stays readable and inactive controls are hidden', async ({ page }) => {
    await page.goto('history/#object-biography');
    await expect(page.locator('[data-object-controls]')).toBeHidden();
    await expect(page.locator('.object-chapters > li')).toHaveCount(5);
    // Exercise native keyboard activation without relying on pointer-stability
    // polling while page scripts are disabled.
    await page.getByText('На что смотреть?', { exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.looking-notes')).toHaveAttribute('open', '');
    await expect(page.locator('.looking-notes li').first()).toBeVisible();
    await noOverflow(page);
    await page.goto('material/#material-lens');
    await expect(page.locator('[data-lens-controls]')).toBeHidden();
    await expect(page.locator('[data-structure="fibres"]')).toBeVisible();
    await expect(page.locator('[data-structure="grains"]')).toBeVisible();
    await noOverflow(page);
    await page.goto('mythology/#legend-history');
    await expect(page.locator('[data-witness-controls]')).toBeHidden();
    await expect(page.locator('[data-witness-panel]')).toHaveCount(3);
    for (const panel of await page.locator('[data-witness-panel]').all()) await expect(panel).toBeVisible();
    await noOverflow(page);
  });
});
