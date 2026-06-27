#!/usr/bin/env python3
"""Minimal MCP client for z.ai web-reader MCP server.
Used by Conductor script agents for web research tasks.

Protocol: JSON-RPC 2.0 over HTTP POST to the MCP endpoint.
"""

import json
import sys
import urllib.request
import urllib.error

MCP_URL = "https://api.z.ai/api/mcp/web_reader/mcp"
AUTH_TOKEN = "abc0546a04ac49c2806d2e9d7d137e45.4Iffc3RJZ8PzJBkB"


def mcp_call(method, params=None, request_id=1):
    """Make a JSON-RPC call to the MCP server."""
    payload = {
        "jsonrpc": "2.0",
        "id": request_id,
        "method": method,
        "params": params or {},
    }
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AUTH_TOKEN}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8") if e.fp else ""
        return {"error": f"HTTP {e.code}: {body}"}
    except Exception as e:
        return {"error": str(e)}


def web_search(query, count=5):
    """Search the web for the given query."""
    result = mcp_call("tools/call", {
        "name": "web_search",
        "arguments": {"query": query, "count": count},
    })
    return result


def web_fetch(url):
    """Fetch content from a URL."""
    result = mcp_call("tools/call", {
        "name": "web_fetch",
        "arguments": {"url": url},
    })
    return result


def list_tools():
    """List available MCP tools."""
    result = mcp_call("tools/list")
    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: web-research.py <search|fetch|tools> [args...]"}, ensure_ascii=False))
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "search":
        query = " ".join(sys.argv[2:])
        result = web_search(query)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "fetch":
        url = sys.argv[2]
        result = web_fetch(url)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif cmd == "tools":
        result = list_tools()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
