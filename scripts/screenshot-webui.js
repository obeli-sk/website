/**
 * Playwright script to capture Web UI screenshots for the homepage carousel.
 *
 * Prerequisites:
 *   1. Start the demo-tutorial server:
 *        cd /workspace/apps/demo-tutorial
 *        obelisk server run --deployment deployment.toml
 *   2. Trigger the workflows (webhooks spawn both serial and parallel):
 *        curl http://localhost:9090/serial & curl http://localhost:9090/parallel; wait
 *      Wait ~30s for the serial workflow to finish.
 *   3. Run this script from the website/ directory:
 *        nix develop .#screenshots -c node scripts/screenshot-webui.js
 *
 *   4. Copy outputs to static/:
 *        cp /tmp/sc-*.png static/
 *
 * Captured views (all clipped to 1280×680, saved to /tmp/sc-*.png):
 *   sc-executions.png   — execution list (home page)
 *   sc-trace.png        — parallel workflow execution trace
 *   sc-events.png       — execution event log
 *   sc-logs.png         — execution logs
 */

const { chromium } = require('playwright-core');

const LAUNCH_OPTS = {
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--disable-gpu'],
};

const VIEWPORT = { width: 1280, height: 680 };

async function shot(page, path) {
  await page.waitForTimeout(2000);
  await page.screenshot({ path, clip: { x: 0, y: 0, ...VIEWPORT } });
  console.log(`Saved ${path}`);
}

(async () => {
  const browser = await chromium.launch(LAUNCH_OPTS);
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();

  // --- Execution list ---
  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });
  await shot(page, '/tmp/sc-executions.png');

  // Find execution IDs from the list
  const traceLinks = await page.locator('a[href^="/execution/E_"]').all();
  const rows = [];
  for (const link of traceLinks) {
    const href = await link.getAttribute('href');
    const match = href.match(/\/execution\/(E_[^/]+)/);
    if (!match) continue;
    const execId = match[1];
    const row = link.locator('xpath=ancestor::tr[1]');
    const cells = await row.locator('td').all();
    const timingText = cells.length > 0 ? await cells[cells.length - 1].innerText() : '';
    rows.push({ execId, timingText });
    console.log(`  ${execId}: ${timingText.replace(/\n/g, ' ')}`);
  }

  if (rows.length < 2) {
    console.error('Not enough executions found:', rows.length);
    await browser.close();
    return;
  }

  // Pick the two most recently created executions (first two in the list).
  // Among those, the one that took longer is serial, the faster one is parallel.
  const recent = rows.slice(0, 2);
  const secsOf = r => {
    const m = r.timingText.match(/Took (\d+) secs?/);
    return m ? parseInt(m[1]) : 0;
  };
  let serialId, parallelId;
  if (secsOf(recent[0]) >= secsOf(recent[1])) {
    serialId = recent[0].execId;
    parallelId = recent[1].execId;
  } else {
    serialId = recent[1].execId;
    parallelId = recent[0].execId;
  }
  console.log(`Serial: ${serialId}  Parallel: ${parallelId}`);

  // The top-level executions are webhooks; the workflow is the first child (.o:1_1).
  // Use the workflow child for trace/events/logs so we see the actual workflow detail.
  const parallelWorkflowId = `${parallelId}.o:1_1`;
  console.log(`Parallel workflow: ${parallelWorkflowId}`);

  // --- Execution trace (parallel workflow child, with children autoloaded) ---
  await page.goto(`http://localhost:8080/execution/${parallelWorkflowId}/trace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const autoload = page.getByLabel('Autoload children');
  if (await autoload.count() > 0 && !(await autoload.isChecked())) {
    await autoload.check();
    await page.waitForTimeout(4000);
  }
  await shot(page, '/tmp/sc-trace.png');

  // --- Execution event log (default route: /execution/{id}) ---
  await page.goto(`http://localhost:8080/execution/${parallelWorkflowId}`, { waitUntil: 'domcontentloaded' });
  await shot(page, '/tmp/sc-events.png');

  // --- Logs ---
  await page.goto(`http://localhost:8080/execution/${parallelWorkflowId}/logs`, { waitUntil: 'domcontentloaded' });
  await shot(page, '/tmp/sc-logs.png');

  await browser.close();
})();
