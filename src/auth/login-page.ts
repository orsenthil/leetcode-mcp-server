function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/**
 * Renders the owner's sign-in page. The page is static HTML with inline
 * styles and no scripts.
 */
export function renderLoginPage(options: {
    action: string;
    pending: string;
    clientName?: string;
    redirectUri: string;
    error?: string;
}): string {
    const client = escapeHtml(options.clientName || "An MCP client");
    const host = escapeHtml(hostOf(options.redirectUri));
    const error = options.error
        ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>`
        : "";

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize LeetCode MCP</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --fg:#1b1f24; --muted:#5b6470; --line:#d8dde3; --accent:#1f6feb; --err:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0e1116; --card:#161b22; --fg:#e6edf3; --muted:#9aa4af; --line:#30363d; --accent:#4c8dff; --err:#ff6b6b; } }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding:16px; }
  main { width:100%; max-width:380px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; }
  h1 { font-size:20px; margin:0 0 8px; }
  p { margin:0 0 16px; color:var(--muted); }
  strong { color:var(--fg); }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input[type=password] { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--fg); font:inherit; }
  .actions { display:flex; gap:8px; margin-top:16px; }
  button { flex:1; padding:10px; border-radius:8px; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--line); background:transparent; color:var(--fg); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .error { color:var(--err); font-weight:600; }
</style>
</head>
<body>
<main>
  <h1>Authorize LeetCode MCP</h1>
  <p><strong>${client}</strong> wants to use your LeetCode MCP server. After you approve, you'll be sent back to <strong>${host}</strong>.</p>
  ${error}
  <form method="post" action="${escapeHtml(options.action)}">
    <input type="hidden" name="pending" value="${escapeHtml(options.pending)}">
    <label for="password">Server password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus>
    <div class="actions">
      <button type="submit" name="decision" value="deny" formnovalidate>Deny</button>
      <button type="submit" name="decision" value="approve" class="primary">Approve</button>
    </div>
  </form>
</main>
</body>
</html>`;
}
