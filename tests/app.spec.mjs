import { test, expect } from '@playwright/test';

const TABS = ['list', 'write', 'cards', 'quiz', 'pairs'];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text() + ' @ ' + (m.location().url || '')); });
  return errors;
}
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const state = (page) => page.evaluate(() => window.__zoshyt.state());
const wstate = (page) => page.evaluate(() => { const w = window.__zoshyt.write(); return w && { miss: w.miss, stroke: w.stroke, total: w.total, ci: w.ci, done: w.done, charDone: w.charDone, grade: w.grade, chars: w.chars }; });

// Відкриває режим письма для одного запису через його картку
async function writeEntry(page, h, { level, strict } = {}) {
  await page.goto('#list');
  await page.locator(".tile").first().waitFor();
  await page.locator(`.tile[aria-label^="${h} "], .tile[aria-label="${h}"]`).first().click();
  await page.locator('#dlgEntry [data-act="eWrite"]').click();
  await expect(page.locator('#field svg')).toBeVisible();
  if (strict) await page.locator('[data-opt="strict"]').selectOption(strict);
  if (level) await page.locator(`[data-k="level"][data-v="${level}"]`).click();
  await expect(page.locator('#field svg')).toBeVisible();
}

// Малює одну риску мишею по лінії medians; dx, dy — зсув у частках поля
async function drawStroke(page, ch, k, { dx = 0, dy = 0 } = {}) {
  const field = page.locator('#field');
  await field.scrollIntoViewIfNeeded();
  const box = await field.boundingBox();
  const size = box.width, pad = size * 0.07, scale = (size - 2 * pad) / 1024;
  const median = await page.evaluate(([c, i]) => window.__zoshyt.DB[c].m[i], [ch, k]);
  const pts = median.map(([x, y]) => [box.x + pad + x * scale + dx * size, box.y + size - pad - (y + 124) * scale + dy * size]);
  const before = await wstate(page);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction((b) => {
    const w = window.__zoshyt.write();
    return w.miss !== b.miss || w.stroke !== b.stroke || w.ci !== b.ci || w.done || w.charDone;
  }, before, { timeout: 5000 });
  return wstate(page);
}
async function drawChar(page, ch, offset) {
  const n = await page.evaluate((c) => window.__zoshyt.DB[c].m.length, ch);
  for (let k = 0; k < n; k++) await drawStroke(page, ch, k, offset);
}

test('ключі перекладів збігаються у трьох мовах', async ({ page }) => {
  await page.goto('');
  const keys = await page.evaluate(() => Object.fromEntries(Object.entries(window.__zoshyt.T).map(([l, d]) => [l, Object.keys(d).sort()])));
  expect(Object.keys(keys).sort()).toEqual(['en', 'uk', 'zh']);
  expect(keys.en).toEqual(keys.uk);
  expect(keys.zh).toEqual(keys.uk);
  const empty = await page.evaluate(() => Object.entries(window.__zoshyt.T).flatMap(([l, d]) => Object.entries(d).filter(([, v]) => !v).map(([k]) => l + '.' + k)));
  expect(empty).toEqual([]);
});

for (const width of [400, 1100]) {
  test(`вкладки без горизонтальної прокрутки та помилок, ширина ${width}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width, height: 800 });
    for (const tab of TABS) {
      await page.goto('#' + tab);
      await expect(page.locator('nav.tabs a[aria-current="page"]')).toHaveAttribute('href', '#' + tab);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#net')).toBeHidden();
      expect(await noHScroll(page), `прокрутка на #${tab}`).toBe(true);
    }
    // картка запису та налаштування, найбільші розміри
    await page.goto('#list');
    await page.locator('.tile').last().click();
    await expect(page.locator('#eField svg')).toBeVisible();
    await expect(page.locator('#eInfo dl')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    await page.locator('#dlgEntry [data-act="close"]').click();
    await page.locator('[data-act="settings"]').click();
    for (const k of ['text', 'tile', 'field']) await page.locator(`#sBody [data-k="${k}"][data-v="XL"]`).click();
    await page.locator('#sBody [data-k="theme"][data-v="dark"]').click();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    for (const scheme of ['tush', 'jade', 'plum', 'contrast']) await page.locator(`#sBody [data-k="scheme"][data-v="${scheme}"]`).click();
    for (const lang of ['en', 'zh']) await page.locator(`#sBody [data-k="lang"][data-v="${lang}"]`).click();
    await expect(page.locator('header h1')).toHaveText('汉字练习本');
    await page.locator('#dlgSet [data-act="close"]').click();
    for (const tab of TABS) {
      await page.goto('#' + tab);
      await page.waitForLoadState('networkidle');
      expect(await noHScroll(page), `прокрутка на #${tab} (XL)`).toBe(true);
    }
    // «стандартний вигляд» не скидає мову
    await page.locator('[data-act="settings"]').click();
    await page.locator('#sBody [data-act="uiReset"]').click();
    const s = await state(page);
    expect(s.ui).toMatchObject({ lang: 'zh', theme: 'auto', scheme: 'zoshyt', text: 'M', tile: 'M', field: 'M' });
    expect(errors).toEqual([]);
  });
}

test('розбір введення різних форматів', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('#list');
  const first = await state(page);
  expect(first.sets).toHaveLength(1);
  expect(first.sets[0].demo).toBe(true);
  expect(first.sets[0].items.map((i) => i.h)).toEqual(['永', '学', '写', '字', '书', '语', '茶', '猫', '朋友']);

  await page.locator('#addIn').fill([
    '你好 谢谢, 再见', '猫 māo кіт', '狗 gou собака', '朋友 — péngyou — друг', '书\tshū\tbook', '水 water', '山 | гора', '火 huǒ fire', '',
  ].join('\n'));
  await page.locator('[data-act="add"]').click();
  await expect(page.locator('#addMsg')).toContainText('Додано: 10, вже було: 0');
  await expect(page.locator('#addMsg')).toContainText('Мій список');
  await page.waitForFunction(() => { const s = window.__zoshyt.state(); return s.sets.find((x) => x.id === s.cur).items.every((i) => i.p); });

  let s = await state(page);
  expect(s.sets).toHaveLength(2);
  const mine = () => s.sets.find((x) => x.id === s.cur);
  expect(mine().demo).toBeFalsy();
  const by = (h) => mine().items.find((i) => i.h === h);
  expect(mine().items.map((i) => i.h)).toEqual(['你好', '谢谢', '再见', '猫', '狗', '朋友', '书', '水', '山', '火']);
  expect(by('你好')).toMatchObject({ p: 'nǐ hǎo', m: '', ap: true });
  expect(by('猫')).toEqual({ h: '猫', p: 'māo', m: 'кіт' });
  expect(by('狗')).toEqual({ h: '狗', p: 'gou', m: 'собака' });
  expect(by('朋友')).toEqual({ h: '朋友', p: 'péngyou', m: 'друг' });
  expect(by('书')).toEqual({ h: '书', p: 'shū', m: 'book' });
  expect(by('水')).toEqual({ h: '水', p: 'shuǐ', m: 'water', ap: true });
  expect(by('山')).toEqual({ h: '山', p: 'shān', m: 'гора', ap: true });
  expect(by('火')).toEqual({ h: '火', p: 'huǒ', m: 'fire' });

  // дублікати та автопереклад одного знака
  await page.locator('#addIn').fill('猫\n月');
  await page.locator('[data-act="add"]').click();
  await expect(page.locator('#addMsg')).toHaveText('Додано: 1, вже було: 1.');
  await page.waitForFunction(() => { const s = window.__zoshyt.state(); return s.sets.find((x) => x.id === s.cur).items.some((i) => i.h === '月' && i.m); });
  s = await state(page);
  expect(by('月')).toMatchObject({ p: 'yuè', ap: true, a: true });
  expect(by('月').m.split(', ')).toHaveLength(2);

  // розбиття слів на знаки
  await page.locator('#splitCk').check();
  await page.locator('#addIn').fill('明天 míngtiān завтра');
  await page.locator('[data-act="add"]').click();
  await expect(page.locator('#addMsg')).toHaveText('Додано: 2, вже було: 0.');
  s = await state(page);
  expect(mine().items.slice(-2).map((i) => i.h)).toEqual(['明', '天']);
  await expect(page.locator('.tile')).toHaveCount(13);
  await expect(page.locator('.tile svg.gl').first()).toBeVisible();

  // сам розбирач
  const parsed = await page.evaluate(() => {
    const p = window.__zoshyt.parseInput;
    return { a: p('大；小；多', false), b: p('1. 喝 hē to drink', false), c: p('no hanzi here', false), d: p('吃 chi1 їсти', false), e: p('吃 — їсти; жерти', false) };
  });
  expect(parsed.a.map((x) => x.h)).toEqual(['大', '小', '多']);
  expect(parsed.b).toEqual([{ h: '喝', p: 'hē', m: 'to drink' }]);
  expect(parsed.c).toEqual([]);
  expect(parsed.d).toEqual([{ h: '吃', p: 'chi1', m: 'їсти' }]);
  expect(parsed.e).toEqual([{ h: '吃', p: '', m: 'їсти; жерти' }]);

  // видалення набору у два натискання
  const del = page.locator('[data-act="setDel"]');
  await del.click();
  await expect(del).toHaveText('Точно видалити?');
  expect((await state(page)).sets).toHaveLength(2);
  await del.click();
  s = await state(page);
  expect(s.sets).toHaveLength(1);
  expect(s.sets[0].demo).toBe(true);

  // стан переживає перезавантаження
  await page.reload();
  expect((await state(page)).sets).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('письмо: обводка та з пам\'яті, печатка і прогрес', async ({ page }) => {
  const errors = watchErrors(page);
  await writeEntry(page, '永', { level: 'trace' });
  expect((await state(page)).prog['永']).toBeUndefined();
  await expect(page.locator('#wStroke')).toHaveText('риска 1 з 5');
  await expect(page.locator('#stamp')).toBeHidden();
  await drawChar(page, '永');
  await expect(page.locator('#stamp')).toBeVisible();
  await expect(page.locator('#stamp')).toHaveText('好');
  await expect(page.locator('#wMiss')).toHaveText('промахів: 0');
  expect((await state(page)).prog['永'].b).toBe(1);
  await page.locator('#wNext').click();
  await expect(page.locator('#wResults li')).toHaveCount(1);
  await expect(page.locator('#wResults li')).toHaveAttribute('data-grade', 'clean');

  // з пам'яті: +1 за чисту роботу
  await writeEntry(page, '永', { level: 'memory' });
  await drawChar(page, '永');
  await expect(page.locator('#stamp')).toHaveText('好');
  expect((await state(page)).prog['永'].b).toBe(2);

  // слово: знаки пишуться по черзі, фішки показують прогрес
  await writeEntry(page, '朋友', { level: 'trace' });
  await expect(page.locator('#wChips .chip')).toHaveCount(2);
  await drawChar(page, '朋');
  await expect(page.locator('#wChips .chip.done')).toHaveCount(1);
  await expect(page.locator('#stamp')).toBeHidden();
  await page.waitForFunction(() => window.__zoshyt.write().ci === 1);
  await expect(page.locator('#field svg')).toBeVisible();
  await drawChar(page, '友');
  await expect(page.locator('#stamp')).toHaveText('好');
  await expect(page.locator('#wChips .chip.done')).toHaveCount(2);
  expect((await state(page)).prog['朋友'].b).toBe(1);

  // підказка рахується як промах; показ порядку в режимі з пам'яті дає +3
  await writeEntry(page, '字', { level: 'memory' });
  await page.locator('#wHint').click();
  await expect(page.locator('#wMiss')).toHaveText('промахів: 1');
  await page.locator('#wShow').click();
  await expect(page.locator('#wMiss')).toHaveText('промахів: 4');
  await page.locator('#wSkip').click();
  await expect(page.locator('#wResults li')).toHaveAttribute('data-grade', 'skip');
  await expect(page.locator('[data-act="wRepeat"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('три рівні суворості на зсунутих рисках', async ({ page }) => {
  const errors = watchErrors(page);
  // зсув угору в одиницях сітки 1024: «малий» має відхилити лише сувора перевірка, «великий» — ще й звичайна
  const SHIFTS = { small: 225, large: 400 };
  const result = {};
  for (const strict of ['soft', 'normal', 'strict']) {
    result[strict] = {};
    for (const [name, units] of Object.entries(SHIFTS)) {
      await page.goto('');
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.locator('#addIn').fill('一');
      await page.locator('[data-act="add"]').click();
      await writeEntry(page, '一', { level: 'trace', strict });
      const dy = -units * 0.86 / 1024;
      let now = await drawStroke(page, '一', 0, { dy });
      const rejected = now.miss;
      for (let tries = 0; !now.done && tries < 8; tries++) now = await drawStroke(page, '一', 0);
      await expect(page.locator('#stamp')).toBeVisible();
      result[strict][name] = { rejected, grade: now.grade };
    }
  }
  console.log('суворість:', JSON.stringify(result));
  const cfg = await page.evaluate(() => window.__zoshyt.STRICT);
  expect(cfg.soft).toEqual({ len: 2.3, dist: 480, hint: [1, 2], auto: [2, 4], clean: 1, ok: 4 });
  expect(cfg.normal).toEqual({ len: 1.5, dist: 380, hint: [1, 3], auto: [4, 6], clean: 0, ok: 2 });
  expect(cfg.strict).toEqual({ len: 1.0, dist: 350, hint: [1, 3], auto: [false, false], clean: 0, ok: 2 });
  expect(result.soft).toEqual({ small: { rejected: 0, grade: 'clean' }, large: { rejected: 0, grade: 'clean' } });
  expect(result.normal).toEqual({ small: { rejected: 0, grade: 'clean' }, large: { rejected: 1, grade: 'ok' } });
  expect(result.strict).toEqual({ small: { rejected: 1, grade: 'ok' }, large: { rejected: 1, grade: 'ok' } });
  expect(errors).toEqual([]);
});

test('картки, вікторина і пари', async ({ page }) => {
  const errors = watchErrors(page);
  // картки
  await page.goto('#cards');
  await expect(page.locator('#cLeft')).toHaveText('залишилось: 9');
  await expect(page.locator('#fc svg.gl').first()).toBeVisible();
  await page.locator('#fc').click();
  await expect(page.locator('#fc .mean')).toBeVisible();
  await page.locator('[data-act="cAgain"]').click();
  await expect(page.locator('#cLeft')).toHaveText('залишилось: 9');
  await page.locator('[data-act="cKnow"]').click();
  await expect(page.locator('#cLeft')).toHaveText('залишилось: 8');
  await page.locator('[data-k="dir"][data-v="mh"]').click();
  await expect(page.locator('#fc .mean')).toBeVisible();
  await expect(page.locator('#fc svg.gl')).toHaveCount(0);

  // вікторина: відповідаємо правильно клавішами
  await page.goto('#quiz');
  await expect(page.locator('#qOpts .qopt')).toHaveCount(4);
  const total = await page.evaluate(() => 0 + document.querySelector('#view .mute').textContent.match(/(\d+)\D*$/)[1] * 1);
  expect(total).toBe(12);
  const seenTypes = new Set();
  for (let n = 0; n < total; n++) {
    await expect(page.locator('#view .mute').first()).toContainText(`питання ${n + 1} з`);
    seenTypes.add(await page.locator('#qPrompt').getAttribute('data-type'));
    const texts = await page.locator('#qOpts .qopt').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent));
    expect(texts).toHaveLength(4);
    const right = await page.locator('#qOpts .qopt').evaluateAll((els) => els.findIndex((e) => e.dataset.right));
    if (n === 0) {
      // перша відповідь навмисно хибна: перехід лише кнопкою «Далі»
      await page.keyboard.press(String(((right + 1) % 4) + 1));
      await expect(page.locator('#qOpts .qopt.wrong')).toHaveCount(1);
      await expect(page.locator('#qOpts .qopt.right')).toHaveCount(1);
      await page.keyboard.press('Enter');
    } else await page.keyboard.press(String(right + 1));
  }
  await expect(page.locator('#qScore')).toHaveText(`Результат: ${total - 1} з ${total}`);
  expect(seenTypes.size).toBeGreaterThan(1);

  // пари
  await page.goto('#pairs');
  await expect(page.locator('#pGrid .pc')).toHaveCount(12);
  const ids = await page.locator('#pGrid .pc').evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, kind: e.dataset.kind, pair: e.dataset.pair })));
  const hs = ids.filter((c) => c.kind === 'h'), ms = ids.filter((c) => c.kind === 'm');
  // одна хибна спроба
  await page.locator(`.pc[data-id="${hs[0].id}"]`).click();
  await page.locator(`.pc[data-id="${ms.find((c) => c.pair !== hs[0].pair).id}"]`).click();
  await expect(page.locator('#pTries')).toHaveText('спроб: 1');
  for (const h of hs) {
    await page.locator(`.pc[data-id="${h.id}"]`).click();
    await page.locator(`.pc[data-id="${ms.find((c) => c.pair === h.pair).id}"]`).click();
  }
  await expect(page.locator('#pDone')).toBeVisible();
  await expect(page.locator('#pTries')).toHaveText('спроб: 7');
  const best = Object.values((await state(page)).best);
  expect(best).toHaveLength(1);
  expect(best[0]).toBeGreaterThan(0);

  // вимкнений режим зникає з навігації
  await page.locator('[data-act="settings"]').click();
  await page.locator('#sBody [data-mode="pairs"]').uncheck();
  await page.locator('#dlgSet [data-act="close"]').click();
  await expect(page.locator('nav.tabs a')).toHaveCount(4);
  await expect(page.locator('nav.tabs a[aria-current="page"]')).toHaveAttribute('href', '#list');
  expect(errors).toEqual([]);
});

test('помилка мережі дозволяє повторити завантаження', async ({ page }) => {
  let block = true;
  await page.route('**/d/*.json', (r) => (block ? r.abort() : r.continue()));
  await page.goto('#list');
  await expect(page.locator('#net')).toBeVisible();
  await expect(page.locator('.tile .gl-t').first()).toBeVisible(); // запасний показ шрифтом кайті
  block = false;
  await page.locator('[data-act="retry"]').click();
  await expect(page.locator('#net')).toBeHidden();
  await expect(page.locator('.tile svg.gl').first()).toBeVisible();
  await expect(page.locator('.tile .gl-t')).toHaveCount(0);
});
