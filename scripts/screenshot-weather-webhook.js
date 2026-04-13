// Captures two screenshots for the 0.37 announcement weather webhook example:
//   /tmp/weather-trace-parallel.png  — city-temperatures workflow (parallel activity trace)
//   /tmp/weather-webhook-debugger.png — webhook execution debugger (shows JS + schedule call)
//
// Usage:
//   WEBHOOK_EXEC_ID=<id> WORKFLOW_EXEC_ID=<id> node scripts/screenshot-weather-webhook.js
// or without args (script will auto-detect from the executions list).

const { chromium } = require('/nix/store/bazma324ghwnil93pvkwcg0llmin46rm-wrangler-4.38.0/lib/node_modules/.pnpm/playwright-core@1.49.1/node_modules/playwright-core/index.js');

const LAUNCH_OPTS = {
  executablePath: '/nix/store/77w1x7d7k3p5yjn224gmkbhkm06b426x-chromium-146.0.7680.153/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox', '--disable-gpu'],
};

async function screenshotTrace(page, execId, outputPath, { autoloadChildren = false } = {}) {
  await page.goto(`http://localhost:8080/execution/${execId}/trace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  if (autoloadChildren) {
    const autoload = page.getByLabel('Autoload children');
    if (await autoload.count() > 0) {
      if (!(await autoload.isChecked())) await autoload.check();
      console.log('Enabled Autoload children');
      await page.waitForTimeout(4000);
    }
  }

  await page.screenshot({ path: outputPath });
  console.log(`Saved ${outputPath}`);
}

(async () => {
  const webhookExecId = process.env.WEBHOOK_EXEC_ID;
  const workflowExecId = process.env.WORKFLOW_EXEC_ID;

  const browser = await chromium.launch(LAUNCH_OPTS);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  let wkExecId = webhookExecId;
  let wfExecId = workflowExecId;

  if (!wkExecId || !wfExecId) {
    // Auto-detect: load executions list and identify by FFQN
    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const traceLinks = await page.locator('a[href^="/execution/E_"]').all();
    console.log(`Found ${traceLinks.length} trace links`);

    for (const link of traceLinks) {
      const href = await link.getAttribute('href');
      const match = href.match(/\/execution\/(E_[^/]+)/);
      if (!match) continue;
      const execId = match[1];
      const row = link.locator('xpath=ancestor::tr[1]');
      const rowText = await row.innerText();
      console.log(`  ${execId}: ${rowText.replace(/\n/g, ' ').slice(0, 80)}`);
      if (!wkExecId && rowText.includes('webhook')) wkExecId = execId;
      if (!wfExecId && rowText.includes('workflow')) wfExecId = execId;
    }
  }

  if (!wkExecId) { console.error('Could not find webhook execution'); await browser.close(); process.exit(1); }
  if (!wfExecId) { console.error('Could not find workflow execution'); await browser.close(); process.exit(1); }

  console.log(`Webhook exec: ${wkExecId}`);
  console.log(`Workflow exec: ${wfExecId}`);

  // 1. Parallel city-temperatures workflow trace (Autoload children to show London + Tokyo)
  await screenshotTrace(page, wfExecId, '/tmp/weather-trace-parallel.png', { autoloadChildren: true });

  // 2. Webhook debugger view — shows JS source and the schedule() call
  await page.goto(`http://localhost:8080/execution/${wkExecId}/trace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // Click the Debugger tab
  const debuggerTab = page.getByRole('link', { name: 'Debugger' });
  if (await debuggerTab.count() > 0) {
    await debuggerTab.click();
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: '/tmp/weather-webhook-debugger.png' });
  console.log('Saved /tmp/weather-webhook-debugger.png');

  await browser.close();
})();
