#!/usr/bin/env python3
"""
Fetches a URL using curl_cffi with Chrome TLS fingerprint impersonation.
Called by lib/sources/linuxdo.ts to bypass Cloudflare's JA3/JA4 fingerprint
check, which blocks Node's built-in fetch and standard curl (Schannel/OpenSSL).

Usage:
  python scripts/linuxdo-fetch.py <url>

Writes the response body to stdout (binary), exits non-zero on error.
Proxy: reads HTTPS_PROXY / HTTP_PROXY / https_proxy / http_proxy from env.
"""
import os
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: linuxdo-fetch.py <url>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        print(
            "curl_cffi not installed — run: pip install curl_cffi",
            file=sys.stderr,
        )
        sys.exit(2)

    proxy = (
        os.environ.get("HTTPS_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("HTTP_PROXY")
        or os.environ.get("http_proxy")
    )
    proxies = {"http": proxy, "https": proxy} if proxy else None

    try:
        resp = cffi_requests.get(
            url,
            impersonate="chrome",
            proxies=proxies,
            timeout=25,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (compatible; DailyBriefBot/1.0;"
                    " +https://github.com/leiting-eric/DailyBrief)"
                ),
                "Accept": (
                    "application/atom+xml, application/rss+xml,"
                    " application/xml, text/xml, */*"
                ),
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            },
        )
        sys.stdout.buffer.write(resp.content)
    except Exception as exc:  # noqa: BLE001
        print(f"fetch error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
