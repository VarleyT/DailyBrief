import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import Parser from "rss-parser";
import type { RawArticle } from "./types";
import { V2EX_OFF_TOPIC_RE } from "./v2ex";

const execFileP = promisify(execFile);
const parser = new Parser({ timeout: 15000 });

/**
 * Resolve the Python interpreter name.
 * Windows ships `python` (no `python3` alias by default); Linux/macOS and
 * GitHub Actions ubuntu runners use `python3`.
 */
const PYTHON = process.platform === "win32" ? "python" : "python3";

/**
 * Path to the curl_cffi-based helper script (repo-relative from cwd).
 * npm scripts always run from the project root, so process.cwd() is stable.
 */
const LINUXDO_FETCH_SCRIPT = join(
  process.cwd(),
  "scripts",
  "linuxdo-fetch.py",
);

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Fetch `url` via `scripts/linuxdo-fetch.py` (curl_cffi with Chrome TLS
 * fingerprint impersonation).  Headers and proxy config live in the Python
 * script; stdout is the raw response body.
 *
 * Falls back with a clear error if curl_cffi is not installed so the
 * per-source try/catch in daily.ts can log it cleanly instead of surfacing
 * an opaque "XML parse failed".
 */
async function pyFetch(url: string): Promise<string> {
  const { stdout, stderr } = await execFileP(
    PYTHON,
    [LINUXDO_FETCH_SCRIPT, url],
    { maxBuffer: 16 * 1024 * 1024 },
  ).catch((err: NodeJS.ErrnoException & { stderr?: string }) => {
    const hint =
      err.code === "ENOENT"
        ? `${PYTHON} not found — install Python 3`
        : (err.stderr ?? err.message);
    throw new Error(`linuxdo-fetch.py failed: ${hint}`);
  });
  if (stderr) {
    // Non-fatal: the script writes progress/warnings to stderr.
    // Re-throw only when stdout is empty (genuine failure).
    if (!stdout) throw new Error(`linuxdo-fetch.py error: ${stderr.trim()}`);
  }
  return stdout;
}

async function fetchFeed(url: string) {
  const xml = await pyFetch(url);
  // A real Discourse feed always starts with an XML/RSS/Atom marker.
  // If we got HTML (e.g. a Cloudflare challenge), surface it as a clear error
  // rather than letting parseString throw an opaque "XML parse failed".
  const head = xml.slice(0, 512).trim().toLowerCase();
  const isFeed =
    head.startsWith("<?xml") ||
    head.startsWith("<rss") ||
    head.startsWith("<feed") ||
    head.includes("<rss") ||
    head.includes("<feed");
  if (!isFeed) {
    throw new Error(
      `blocked or non-feed response from ${url} (likely Cloudflare challenge)`,
    );
  }
  return parser.parseString(xml);
}

/**
 * LinuxDo data source.
 *
 * Uses LinuxDo's public Discourse RSS feeds — the same URLs that any RSS
 * reader subscribes to.
 *
 * Strategy: try /top.rss?period=daily first (matches "today's hot"
 * semantics), fall back to /latest.rss when /top fails.
 *
 * linux.do runs behind Cloudflare with JA3/JA4 TLS fingerprint checks.
 * Standard curl (Schannel/OpenSSL) and Node's built-in fetch are both
 * blocked. We shell out to `scripts/linuxdo-fetch.py`, which uses
 * curl_cffi to impersonate a real Chrome TLS handshake and bypass the
 * check without needing cookies or a headless browser.
 *
 * Requires: `pip install curl_cffi` (see requirements.txt).
 */
export async function fetchLinuxDo(
  sourceId: string,
  limit = 25,
): Promise<RawArticle[]> {
  let feed;
  try {
    feed = await fetchFeed("https://linux.do/top.rss?period=daily");
  } catch {
    feed = await fetchFeed("https://linux.do/latest.rss");
  }

  return (feed.items ?? [])
    .filter(
      (item) =>
        item.title && item.link && !V2EX_OFF_TOPIC_RE.test(item.title),
    )
    .slice(0, limit)
    .map((item) => ({
      sourceId,
      title: (item.title ?? "").trim(),
      url: (item.link ?? "").trim(),
      excerpt: stripHtml(item.contentSnippet ?? item.content ?? "").slice(
        0,
        300,
      ),
      publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
      category: "tech" as const,
    }));
}
