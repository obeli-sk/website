// Capture the published Web UI for SCREENSHOT_EXECUTION_ID, or a completed tutorial workflow.
// Run with nix develop .#screenshots -c node scripts/screenshot-webui.js.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const webuiUrl = process.env.WEBUI_URL || 'http://127.0.0.1:8080';
const apiUrl = process.env.OBELISK_API_URL || 'http://127.0.0.1:5005';
const token = process.env.OBELISK_API_TOKEN;
const outputDir = process.env.SCREENSHOT_DIR || '/tmp';
const viewport = { width: 1280, height: 800 };

if (!token) throw new Error('Set OBELISK_API_TOKEN to the demo server token');

(async () => {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport });
    await context.addInitScript(value => localStorage.setItem('obelisk-api-token', value), token);
    const apiGet = async route => {
      const response = await context.request.get(apiUrl + route, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      if (!response.ok()) throw new Error(`GET ${route}: HTTP ${response.status()}`);
      return response.json();
    };
    const deploymentId = await apiGet('/v1/deployment-id');
    let executionId = process.env.SCREENSHOT_EXECUTION_ID;
    if (!executionId) {
      const executions = await apiGet('/v1/executions?show_derived=true&function=tutorial:demo/workflow.parallel');
      const parallel = executions.find(execution => execution.pending_state.status === 'finished');
      if (!parallel) throw new Error('Set SCREENSHOT_EXECUTION_ID or complete the tutorial /parallel workflow');
      executionId = parallel.execution_id;
    }
    const page = await context.newPage();
    const capture = async (route, name, selector, prepare) => {
      await page.goto(webuiUrl + route, { waitUntil: 'networkidle' });
      await page.locator(selector).first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      if (prepare) await prepare();
      await page.screenshot({ path: path.join(outputDir, `sc-${name}.png`) });
      console.log(`Saved sc-${name}.png`);
    };

    await capture('/', 'executions', 'a[href^="/execution/E_"]');
    await capture('/deployments', 'deployments', '.deployment-list-item');
    await capture(`/deployment/${deploymentId}#graph`, 'deployment-graph', '.component-graph svg');
    await page.goto(webuiUrl + `/execution/${executionId}`, { waitUntil: 'networkidle' });
    await page.locator('.trace-view').waitFor();
    await page.locator('.trace-view .step-row').nth(1).waitFor();
    await page.locator('.trace-view').evaluate(element => element.style.width = '580px');
    await page.screenshot({ path: path.join(outputDir, 'sc-trace.png') });
    console.log('Saved sc-trace.png');
    await capture(`/execution/${executionId}/log`, 'events', '.timeline-row');
    const persisted = await context.request.put(`${apiUrl}/v1/executions/${executionId}/backtrace/persist`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!persisted.ok()) throw new Error(`Persist backtraces: HTTP ${persisted.status()}`);
    const { events } = await apiGet(`/v1/executions/${executionId}/events?length=200&include_backtrace_id=true`);
    const call = events.find(event => event.backtrace_id != null &&
      event.event?.history_event?.event?.request?.target_ffqn === 'obelisk-agent:llm/chat.completion');
    const debuggerVersion = process.env.SCREENSHOT_DEBUGGER_VERSION ?? call?.backtrace_id ??
      events.find(event => event.backtrace_id != null)?.backtrace_id;
    if (debuggerVersion == null) throw new Error('No persisted backtrace in the selected execution');
    await capture(`/execution/${executionId}/debug/${debuggerVersion}`, 'debugger', '.syntect-block', async () => {
      await page.locator('#hide-frames').check();
      await page.locator('.version-slider-container').evaluate(element =>
        window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 76));
    });
    await page.goto(webuiUrl + `/execution/${executionId}/applogs`, { waitUntil: 'networkidle' });
    const derived = page.getByRole('button', { name: 'Derived', exact: true });
    if (await derived.getAttribute('aria-pressed') !== 'true') await derived.click();
    await page.getByRole('columnheader', { name: 'Child', exact: true }).waitFor();
    await page.locator('.logs-table .log-row').first().waitFor();
    if (process.env.SCREENSHOT_LOG_TEXT) {
      await page.locator('.logs-table .log-row').filter({ hasText: process.env.SCREENSHOT_LOG_TEXT })
        .first().evaluate(row => row.closest('.logs-list').scrollTop = row.offsetTop - 40);
    }
    await page.screenshot({ path: path.join(outputDir, 'sc-logs.png') });
    console.log('Saved sc-logs.png');
    await capture('/admin/system-events?all_deployments=true', 'system-events', '.system-event-list-item');
    fs.writeFileSync(path.join(outputDir, 'capture.json'), JSON.stringify({
      viewport, deploymentId, executionId,
      capturedAt: new Date().toISOString(),
    }, null, 2) + '\n');
  } finally {
    await browser.close();
  }
})();
