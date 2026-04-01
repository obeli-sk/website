const { chromium } = require('/nix/store/mb8fzf7hjf5f9ycdvzx3x7wdi157pvyx-playwright-test-1.58.2/lib/node_modules/playwright-core/index.js');

const LAUNCH_OPTS = {
  executablePath: '/nix/store/mwmmlaalpfnaaknbrh333agk5a01cg68-chromium-146.0.7680.164/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--disable-gpu'],
};

async function screenshotTrace(page, execId, outputPath) {
  await page.goto(`http://localhost:8080/execution/${execId}/trace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Enable "Autoload children" if present and not already checked
  const autoload = page.getByLabel('Autoload children');
  if (await autoload.count() > 0) {
    if (!(await autoload.isChecked())) await autoload.check();
    console.log('Enabled Autoload children');
    await page.waitForTimeout(4000); // wait for children to load
  }

  await page.screenshot({ path: outputPath });
  console.log(`Saved ${outputPath}`);
}

(async () => {
  const browser = await chromium.launch(LAUNCH_OPTS);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Load executions page
  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Get only execution trace links (not filter links)
  const traceLinks = await page.locator('a[href^="/execution/E_"]').all();
  console.log(`Found ${traceLinks.length} trace links`);

  const rows = [];
  for (const link of traceLinks) {
    const href = await link.getAttribute('href');
    // Extract execution ID from href like /execution/E_01.../trace
    const match = href.match(/\/execution\/(E_[^/]+)/);
    if (!match) continue;
    const execId = match[1];
    // Get the timing cell from the table row
    const row = link.locator('xpath=ancestor::tr[1]');
    const cells = await row.locator('td').all();
    const timingText = cells.length > 0 ? await cells[cells.length - 1].innerText() : '';
    rows.push({ execId, timingText });
    console.log(`  ${execId}: ${timingText.replace(/\n/g, ' ')}`);
  }

  if (rows.length < 2) {
    console.log('Not enough executions found, got:', rows);
    await browser.close();
    return;
  }

  // Serial took ~24s, parallel took ~8s
  // Identify by timing text
  let serialId, parallelId;
  for (const r of rows) {
    const secs = parseInt(r.timingText.match(/Took (\d+)/)?.[1] || '0');
    if (secs >= 15) serialId = r.execId;
    else parallelId = r.execId;
  }

  // Fallback: older ID = serial (triggered first), newer ID = parallel
  if (!serialId || !parallelId) {
    rows.sort((a, b) => a.execId < b.execId ? -1 : 1);
    serialId = rows[0].execId;
    parallelId = rows[1].execId;
  }

  console.log(`Serial exec: ${serialId}`);
  console.log(`Parallel exec: ${parallelId}`);

  await screenshotTrace(page, serialId, '/tmp/js-tutorial-trace.png');
  await screenshotTrace(page, parallelId, '/tmp/js-tutorial-trace-parallel.png');

  await browser.close();
})();
