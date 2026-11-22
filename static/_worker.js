function quality(accept, type) {
  let best = { specificity: -1, quality: 0 };
  for (const range of accept.toLowerCase().split(",")) {
    const [media, ...parameters] = range.trim().split(";");
    const specificity =
      media.trim() === type
        ? 2
        : media.trim() === "text/*"
          ? 1
          : media.trim() === "*/*"
            ? 0
            : -1;
    const parameter = parameters.find((value) => value.trim().startsWith("q="));
    const value =
      parameter === undefined ? 1 : Number(parameter.trim().slice(2));
    if (specificity > best.specificity) {
      best = {
        specificity,
        quality: Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0,
      };
    }
  }
  return best.quality;
}

// Zola can only emit `llms.txt/index.html`; serve it at `llms.txt` instead.
const LLMS_TXT = /^(\/docs\/[^/]+\/llms\.txt)(\/(?:index\.html)?)?$/;

export default {
  async fetch(request, env) {
    const llms = new URL(request.url).pathname.match(LLMS_TXT);
    if (llms?.[2]) {
      const url = new URL(request.url);
      url.pathname = llms[1];
      return new Response(null, {
        status: 301,
        headers: { Location: url.toString(), Vary: "Accept" },
      });
    }
    if (llms) {
      const url = new URL(request.url);
      url.pathname = `${llms[1]}/`;
      request = new Request(url, request);
    }
    const accept = request.headers.get("Accept") || "";
    const wantsMarkdown =
      /(?:^|,)\s*text\/markdown\s*(?:;|,|$)/i.test(accept) &&
      quality(accept, "text/markdown") > 0 &&
      quality(accept, "text/markdown") >= quality(accept, "text/html");
    let response;
    if (
      wantsMarkdown &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const url = new URL(request.url);
      url.pathname =
        url.pathname.replace(/\/index\.html$/, "/").replace(/\/$/, "") +
        "/index.md";
      const markdown = await env.ASSETS.fetch(new Request(url, request));
      if (
        (markdown.ok || markdown.status === 304) &&
        !markdown.headers.get("Content-Type")?.includes("text/html")
      ) {
        response = new Response(markdown.body, markdown);
        response.headers.set("Content-Type", "text/markdown; charset=utf-8");
        response.headers.set("X-Content-Type-Options", "nosniff");
      }
    }
    response ??= await env.ASSETS.fetch(request);
    response = new Response(response.body, response);
    if (llms && !wantsMarkdown && response.ok) {
      response.headers.set("Content-Type", "text/plain; charset=utf-8");
    }
    response.headers.append("Vary", "Accept");
    return response;
  },
};
