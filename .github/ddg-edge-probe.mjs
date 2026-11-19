// A read-only diagnostic Worker. Only targets DuckDuckGo Lite.
const TARGET = "https://lite.duckduckgo.com/lite/";
const QUERY = "Cloudflare Workers official documentation";
function summarize(html, response) {
  const anchors = [...html.matchAll(/<a\b[^>]*\bclass=["'][^"']*(?:result-link|result__a)[^"']*["']/gi)];
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    bytes: html.length,
    results: anchors.length,
    challenged: /anomaly-modal|captcha|unusual traffic|bot detection/i.test(html),
    title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim().slice(0, 100)
  };
}
export default {
  async fetch() {
    const query = new URLSearchParams({ q: QUERY }).toString();
    const observations = [];
    for (const method of ["GET", "POST"]) {
      try {
        const response = await fetch(TARGET + (method === "GET" ? "?" + query : ""), {
          method,
          headers: {
            "Accept": "text/html",
            "User-Agent": "Alpha2FeasibilityTest/1.0",
            ...(method === "POST" ? {"Content-Type": "application/x-www-form-urlencoded"} : {})
          },
          ...(method === "POST" ? {body: query} : {})
        });
        const html = await response.text();
        observations.push({method, ...summarize(html, response)});
      } catch (err) {
        observations.push({method, error: String(err).slice(0,200)});
      }
    }
    return Response.json({environment: "Cloudflare Workers temporary edge", target: "DuckDuckGo Lite", observations}, {
      headers: {"Cache-Control": "no-store"}
    });
  }
};
