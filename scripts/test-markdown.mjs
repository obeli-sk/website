import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import worker from "../static/_worker.js";

const assets = {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    try {
      const file = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
      const body = await readFile(new URL(`../public${file}`, import.meta.url));
      return new Response(request.method === "HEAD" ? null : body, {
        headers: {
          "Content-Type": file.endsWith(".md") ? "text/markdown" : "text/html",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  },
};

function fetchPage(path, accept, method = "GET") {
  const headers = accept === undefined ? {} : { Accept: accept };
  return worker.fetch(
    new Request(`https://obeli.sk${path}`, { headers, method }),
    { ASSETS: assets },
  );
}

test("negotiates Markdown for rendered pages, aliases, and llms.txt", async () => {
  for (const path of [
    "/",
    "/install/",
    "/blog/",
    "/docs/latest/",
    "/docs/latest/js/js-workflows/",
    "/docs/v0.42.0/js/js-workflows/",
    "/docs/latest/llms.txt",
    "/install",
    "/install/index.html",
  ]) {
    const response = await fetchPage(path, "text/markdown");
    assert.equal(response.status, 200, path);
    assert.equal(
      response.headers.get("Content-Type"),
      "text/markdown; charset=utf-8",
      path,
    );
    assert.match(response.headers.get("Vary"), /Accept/);
    const body = await response.text();
    assert.match(body, /Obelisk/, path);
    assert.doesNotMatch(
      body,
      /<main>|<script|class="docs-nav"|\{\{.*doc_link/,
      path,
    );
  }
});

test("honors media preferences and explicit Markdown opt-out", async () => {
  for (const accept of [
    undefined,
    "*/*",
    "text/*",
    "text/html",
    "text/markdown;q=0, */*",
    "text/markdown;q=0.2, text/html;q=0.9",
  ]) {
    const response = await fetchPage("/install/", accept);
    assert.equal(response.headers.get("Content-Type"), "text/html", accept);
    assert.match(await response.text(), /<main>/);
    assert.match(response.headers.get("Vary"), /Accept/);
  }
  for (const accept of [
    "TEXT/MARKDOWN",
    "text/markdown, text/html",
    "text/html;q=0.5, text/markdown;q=0.9",
    "text/*;q=0, text/markdown",
  ]) {
    const response = await fetchPage("/install/", accept);
    assert.equal(
      response.headers.get("Content-Type"),
      "text/markdown; charset=utf-8",
      accept,
    );
  }
});

test("HEAD has the negotiated headers and no body; missing pages keep their status", async () => {
  const head = await fetchPage("/install/", "text/markdown", "HEAD");
  assert.equal(
    head.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  assert.equal(await head.text(), "");
  assert.equal(
    (await fetchPage("/missing-page/", "text/markdown")).status,
    404,
  );
});

test("preserves resolved links, code blocks, tables, and template content", async () => {
  const install = await (await fetchPage("/install/", "text/markdown")).text();
  assert.match(install, /```[\s\S]*obelisk/);
  const workflows = await (
    await fetchPage("/docs/latest/js/js-workflows/", "text/markdown")
  ).text();
  assert.match(workflows, /https:\/\/[^\s)]+\/docs\/latest\//);
  assert.match(workflows, /```/);
  assert.doesNotMatch(workflows, /\]\(@\//);
  const reference = await (
    await fetchPage("/docs/latest/concepts/wit-reference/", "text/markdown")
  ).text();
  assert.match(reference, /\|.*\|/);
});

test("keeps Markdown conditional responses and rejects HTML asset fallbacks", async () => {
  const request = new Request("https://obeli.sk/install/", {
    headers: { Accept: "text/markdown" },
  });
  const notModified = await worker.fetch(request, {
    ASSETS: {
      fetch: async () =>
        new Response(null, { status: 304, headers: { ETag: '"markdown"' } }),
    },
  });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("ETag"), '"markdown"');
  assert.equal(
    notModified.headers.get("Content-Type"),
    "text/markdown; charset=utf-8",
  );
  const fallback = await worker.fetch(request, {
    ASSETS: {
      fetch: async () =>
        new Response("<html>Fallback</html>", {
          headers: { "Content-Type": "text/html" },
        }),
    },
  });
  assert.equal(fallback.headers.get("Content-Type"), "text/html");
});

test("serves llms.txt without a trailing slash", async () => {
  const response = await fetchPage("/docs/latest/llms.txt");
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("Content-Type"),
    "text/plain; charset=utf-8",
  );
  assert.match(await response.text(), /^# Obelisk/m);
  for (const path of [
    "/docs/latest/llms.txt/",
    "/docs/latest/llms.txt/index.html",
  ]) {
    const redirect = await fetchPage(`${path}?x=1`);
    assert.equal(redirect.status, 301, path);
    assert.equal(
      redirect.headers.get("Location"),
      "https://obeli.sk/docs/latest/llms.txt?x=1",
      path,
    );
  }
});
