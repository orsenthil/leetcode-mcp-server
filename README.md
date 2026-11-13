# LeetCode MCP Server

[![NPM Version](https://img.shields.io/npm/v/@jinzcdev/leetcode-mcp-server.svg)](https://www.npmjs.com/package/@jinzcdev/leetcode-mcp-server)
[![Chinese Doc](https://img.shields.io/badge/docs-中文-blue)](README_zh-CN.md)
[![NPM Downloads](https://img.shields.io/npm/dm/@jinzcdev/leetcode-mcp-server.svg)](https://www.npmjs.com/package/@jinzcdev/leetcode-mcp-server)
[![GitHub License](https://img.shields.io/github/license/jinzcdev/leetcode-mcp-server.svg)](./LICENSE)
[![LeetCode MCP Server on Glama](https://glama.ai/mcp/servers/jinzcdev/leetcode-mcp-server/badges/score.svg)](https://glama.ai/mcp/servers/jinzcdev/leetcode-mcp-server)
[![Stars](https://img.shields.io/github/stars/jinzcdev/leetcode-mcp-server)](https://github.com/jinzcdev/leetcode-mcp-server)

The LeetCode MCP Server is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that provides seamless integration with LeetCode APIs, enabling advanced automation and intelligent interaction with LeetCode's programming problems, contests, solutions, and user data.

## Features

- 🌐 **Multi-site Support**: Support​ both leetcode.com (Global) and leetcode.cn (China) platforms
- 🔌 **Dual Transport Modes**: Run as a stdio process (default) or as a [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports) server for web-based integrations
- 📊 **Problem Data Retrieval**: Obtain detailed problem descriptions, constraints, examples, official editorials, and ​user-submitted solutions
- 👤 **User Data Access**: Retrieve user profiles, submission history, and contest performance
- 🔒 **​Private Data Access**: Create and query user notes, manage problem lists, track problem-solving progress, and analyze submission details (AC/WA analysis)
- 🔍 **Advanced Search Capabilities**: Filter problems by tags, difficulty levels, categories, and keywords
- 📅 **Daily Challenge Access**: Easily access daily challenge problems

## Prerequisites

1. Node.js (v20.x or above)
2. (Optional) LeetCode session cookie for authenticated API access

## Installation

```bash
# Install from npm
npm install @jinzcdev/leetcode-mcp-server -g

# Run with Global site configuration (stdio transport, default)
npx -y @jinzcdev/leetcode-mcp-server --site global

# Run with authentication (for accessing private data)
npx -y @jinzcdev/leetcode-mcp-server --site global --session <YOUR_LEETCODE_SESSION_COOKIE>

# Run as a Streamable HTTP server
npx -y @jinzcdev/leetcode-mcp-server --transport http --port 3000 --site global
```

Alternatively, you can clone the repository and run it locally:

```bash
# Clone the repository
git clone https://github.com/jinzcdev/leetcode-mcp-server.git

# Navigate to the project directory
cd leetcode-mcp-server

# Build the project
npm install && npm run build

# Run the server (stdio transport)
node build/index.js --site global

# Or run as a Streamable HTTP server
node build/index.js --transport http --port 3000 --site global
```

## Usage

The server supports two transport modes:

| Transport         | Description                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `stdio` (default) | Standard input/output transport for local MCP clients                                                                              |
| `http`            | [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports) transport for web-based integrations and remote access |

### Command-Line Options

| Option         | Alias | Default     | Description                                                      |
| -------------- | ----- | ----------- | ---------------------------------------------------------------- |
| `--site`       | `-s`  | `global`    | LeetCode API site: `global` (leetcode.com) or `cn` (leetcode.cn) |
| `--session`    | `-c`  | —           | LeetCode session cookie for authenticated requests               |
| `--transport`  | `-t`  | `stdio`     | Transport mode: `stdio` or `http`                                |
| `--port`       | —     | `3000`      | HTTP server port (Streamable HTTP only)                          |
| `--host`       | —     | `127.0.0.1` | HTTP server host (Streamable HTTP only)                          |
| `--endpoint`   | —     | `/mcp`      | HTTP endpoint path (Streamable HTTP only)                        |
| `--auth-token` | —     | —           | Require `Authorization: Bearer <token>` (Streamable HTTP only)   |

### MCP Client Configuration (stdio)

Add the following server entry to your MCP client configuration file:

#### Option 1: Using Environment Variables

```json
{
  "mcpServers": {
    "leetcode": {
      "command": "npx",
      "args": ["-y", "@jinzcdev/leetcode-mcp-server"],
      "env": {
        "LEETCODE_SITE": "global",
        "LEETCODE_SESSION": "<YOUR_LEETCODE_SESSION_COOKIE>"
      }
    }
  }
}
```

#### Option 2: Using Command Line Arguments

```json
{
  "mcpServers": {
    "leetcode": {
      "command": "npx",
      "args": [
        "-y",
        "@jinzcdev/leetcode-mcp-server",
        "--site",
        "global",
        "--session",
        "<YOUR_LEETCODE_SESSION_COOKIE>"
      ]
    }
  }
}
```

For LeetCode China site, modify the `--site` parameter to `cn`.

> [!NOTE]
>
> The exact configuration file location and JSON structure may vary by MCP client. Some clients use an `mcp.servers` wrapper or a `type` field — refer to your client's documentation and adapt the example accordingly.

### MCP Client Configuration (Streamable HTTP)

First, start the server in HTTP mode:

```bash
npx -y @jinzcdev/leetcode-mcp-server --transport http --port 3000 --site global
```

Then connect your MCP client to the running server:

```json
{
  "mcpServers": {
    "leetcode": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

To use authenticated endpoints, pass the session cookie when starting the server:

```bash
npx -y @jinzcdev/leetcode-mcp-server --transport http --port 3000 --site global --session <YOUR_LEETCODE_SESSION_COOKIE>
```

#### Bearer token authentication

Anyone who can reach the HTTP endpoint can call every tool, including `submit_solution` and the note and list tools, using your LeetCode session. If the server listens on anything other than localhost, require a bearer token.

Generate a random token and start the server with it:

```bash
export LEETCODE_HTTP_AUTH_TOKEN="$(openssl rand -hex 32)"
npx -y @jinzcdev/leetcode-mcp-server --transport http --port 3000 --site global
# or pass it explicitly: --auth-token "$LEETCODE_HTTP_AUTH_TOKEN"
```

Prefer the environment variable over `--auth-token`, because command-line arguments are visible to other users in the process list.

Every request to the endpoint must then send the token. Requests with a missing or wrong token get `401 Unauthorized`. Configure your client to send the header:

```json
{
  "mcpServers": {
    "leetcode": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

With Claude Code you can add it from the command line:

```bash
claude mcp add --transport http leetcode http://127.0.0.1:3000/mcp \
  --header "Authorization: Bearer $LEETCODE_HTTP_AUTH_TOKEN"
```

To check the token with curl:

```bash
curl -i -X POST http://127.0.0.1:3000/mcp \
  -H "Authorization: Bearer $LEETCODE_HTTP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

If no token is set and the server listens on a non-localhost address, it logs a warning at startup.

#### OAuth authentication

Some clients, such as ChatGPT's custom MCP connectors, can't send a fixed `Authorization` header and only support OAuth. For them, the server can act as its own single-user OAuth 2.1 authorization server:

- **Discovery:** it serves `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`, so clients find the settings automatically.
- **Clients:** they can register themselves with Dynamic Client Registration (`/register`), or you can configure one client yourself (client ID, secret and redirect URI).
- **Approval:** when a client connects, you're sent to a page on this server where you type a password you chose. Only someone who knows the password can approve a client.
- **Tokens:** PKCE (S256) is required. Access tokens last 1 hour and refresh tokens 30 days.
- **Restarts:** tokens, codes and registered client IDs are signed with a key you provide, not stored, so they survive restarts. Changing the signing key revokes everything at once.
- **Static token:** if `LEETCODE_HTTP_AUTH_TOKEN` is also set, that token keeps working alongside OAuth, so clients that send a fixed header (like Claude Code) don't need to change.

OAuth is turned on by setting `LEETCODE_OAUTH_PASSWORD`. These settings are read only from environment variables, never from command-line arguments:

| Variable                       | Required | Description                                                                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `LEETCODE_OAUTH_PASSWORD`      | yes      | Password you type on the approval page. Use a long random value.                                                 |
| `LEETCODE_OAUTH_SIGNING_KEY`   | yes      | Secret of at least 32 characters used to sign tokens and client IDs.                                             |
| `LEETCODE_OAUTH_ISSUER_URL`    | yes      | Public base URL of the server, with no path, e.g. `https://my-app.fly.dev`. Must be HTTPS except on `localhost`. |
| `LEETCODE_OAUTH_CLIENT_ID`     | no       | ID of a client you configure yourself.                                                                           |
| `LEETCODE_OAUTH_CLIENT_SECRET` | no       | Secret for that client. Clients send it with `client_secret_post`.                                               |
| `LEETCODE_OAUTH_REDIRECT_URIS` | with ID  | Comma-separated callback URL(s) for that client.                                                                 |
| `LEETCODE_HTTP_TRUST_PROXY`    | no       | Reverse-proxy hops in front of the server (`1` on Fly.io), so the password rate limit sees real client IPs.      |

Wrong passwords are limited to 10 attempts per IP every 15 minutes.

To try it locally:

```bash
export LEETCODE_OAUTH_PASSWORD="$(openssl rand -base64 24)"
export LEETCODE_OAUTH_SIGNING_KEY="$(openssl rand -hex 32)"
export LEETCODE_OAUTH_ISSUER_URL="http://localhost:3000"
npx -y @jinzcdev/leetcode-mcp-server --transport http --port 3000
```

> [!NOTE]
> Some MCP clients use `"type": "http"` or `"type": "streamableHttp"` alongside the `url` field. Refer to your client's documentation for the exact HTTP transport configuration format.

> [!TIP]
>
> The server supports the following optional environment variables:
>
> - `LEETCODE_SITE`: LeetCode API endpoint (`global` or `cn`, default: `global`)
> - `LEETCODE_SESSION`: LeetCode session cookie for authenticated API access (default: empty)
> - `LEETCODE_TRANSPORT`: Transport mode (`stdio` or `http`, default: `stdio`)
> - `LEETCODE_HTTP_PORT`: HTTP server port when using Streamable HTTP (default: `3000`)
> - `LEETCODE_HTTP_HOST`: HTTP server host when using Streamable HTTP (default: `127.0.0.1`)
> - `LEETCODE_HTTP_ENDPOINT`: HTTP endpoint path when using Streamable HTTP (default: `/mcp`)
> - `LEETCODE_HTTP_AUTH_TOKEN`: Bearer token required on the HTTP endpoint (default: empty, no auth)
> - `LEETCODE_OAUTH_*` and `LEETCODE_HTTP_TRUST_PROXY`: OAuth settings, see [OAuth authentication](#oauth-authentication)
>
> **Priority Note**:
> Command-line arguments take precedence over environment variables when both are specified. For example:
>
> - If `LEETCODE_SITE=cn` is set but you run `leetcode-mcp-server --site global`, the server will use `global`.
> - If `LEETCODE_SESSION` exists but you provide `--session "new_cookie"`, the command-line session value will be used.

### Deploy to Fly.io

The repository includes a `Dockerfile` and `fly.toml` configured for Streamable HTTP on Fly.io. The container listens on `0.0.0.0:8080` and serves MCP at `/mcp`, for example `https://leetcode-mcp-server.fly.dev/mcp`.

Your `*.fly.dev` URL is public, so the server should never run with your LeetCode session and no authentication. It supports two kinds of authentication, and you can enable both:

- **Bearer token** (`LEETCODE_HTTP_AUTH_TOKEN`) for clients that can send an `Authorization` header, such as Claude Code.
- **OAuth** (`LEETCODE_OAUTH_PASSWORD` and `LEETCODE_OAUTH_SIGNING_KEY`) for clients that only support OAuth, such as ChatGPT.

#### Prerequisites

1. [flyctl](https://fly.io/docs/flyctl/install/) installed
2. A Fly.io account (`fly auth login`)

#### First-time setup

1. Create the app. If you choose a name other than `leetcode-mcp-server`, set `app` and `LEETCODE_OAUTH_ISSUER_URL` in `fly.toml` to match (for example `https://<app-name>.fly.dev`).

   ```bash
   fly apps create leetcode-mcp-server
   ```

2. Generate and stage every secret **before** the first deploy, so the server never runs unprotected. `--stage` stores the secrets without restarting anything.

   ```bash
   AUTH_TOKEN="$(openssl rand -hex 32)"
   OAUTH_PASSWORD="$(openssl rand -base64 24)"

   fly secrets set --stage \
     LEETCODE_HTTP_AUTH_TOKEN="$AUTH_TOKEN" \
     LEETCODE_OAUTH_PASSWORD="$OAUTH_PASSWORD" \
     LEETCODE_OAUTH_SIGNING_KEY="$(openssl rand -hex 32)" \
     LEETCODE_SESSION='<YOUR_LEETCODE_SESSION_COOKIE>'

   echo "Bearer token:   $AUTH_TOKEN"
   echo "OAuth password: $OAUTH_PASSWORD"
   ```

   Save the bearer token and the OAuth password in your password manager. Fly never shows secret values again. You don't need to save the signing key, because no client ever uses it directly.

   Leave out the variables for the kind of authentication you don't need. To use the leetcode.cn site, also set `LEETCODE_SITE=cn`.

3. Deploy one machine. Keep `--ha=false`, because MCP sessions are held in memory on the machine that started them.

   ```bash
   fly deploy --ha=false --smoke-checks=false
   ```

4. Check the deployment (see [Verify a deployment](#verify-a-deployment)), then [connect your clients](#connect-clients).

#### Redeploying

Use this after pulling new code or editing `fly.toml`. Secrets are stored by Fly and carry over to every deploy, so **don't set them again**. Generating a new signing key or password would disconnect ChatGPT and change the password you type.

```bash
git pull
fly secrets list    # names should include LEETCODE_HTTP_AUTH_TOKEN and/or LEETCODE_OAUTH_PASSWORD + LEETCODE_OAUTH_SIGNING_KEY
fly deploy --ha=false --smoke-checks=false
```

Connected clients keep working after a redeploy. OAuth tokens are signed with `LEETCODE_OAUTH_SIGNING_KEY`, not stored on the machine, so ChatGPT doesn't need to reconnect as long as that key doesn't change.

#### Verify a deployment

```bash
APP=https://leetcode-mcp-server.fly.dev

# OAuth discovery: should print JSON with "resource": "$APP/mcp"
curl -s "$APP/.well-known/oauth-protected-resource/mcp"

# Unauthenticated requests must be rejected: should print 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$APP/mcp" \
  -H 'Content-Type: application/json' -d '{}'

# Server logs: look for "OAuth enabled" and/or "Bearer token authentication enabled"
fly logs --no-tail | grep -E 'OAuth enabled|Bearer token'
```

If the second command prints anything other than `401`, no authentication is enabled. Set the secrets before using the server.

#### Changing secrets

Running `fly secrets set` without `--stage` updates the value and restarts the machine; you don't need to run `fly deploy`. A restart drops open MCP sessions, and clients reconnect automatically.

| What you change                              | Command                                                                                    | Effect                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| LeetCode cookie (it expires every few weeks) | `fly secrets set LEETCODE_SESSION='<NEW_COOKIE>'`                                          | Authenticated tools work again. Clients stay connected.               |
| Bearer token                                 | `fly secrets set LEETCODE_HTTP_AUTH_TOKEN="$(openssl rand -hex 32)"`                       | Update the header in every client that uses the token.                |
| OAuth password                               | `fly secrets set LEETCODE_OAUTH_PASSWORD='<NEW_PASSWORD>'`                                 | Affects new approvals only. Clients already connected stay connected. |
| OAuth signing key                            | `fly secrets set LEETCODE_OAUTH_SIGNING_KEY="$(openssl rand -hex 32)"`                     | Revokes every OAuth client. Reconnect ChatGPT and approve again.      |
| Turn off OAuth or the bearer token           | `fly secrets unset LEETCODE_OAUTH_PASSWORD` / `fly secrets unset LEETCODE_HTTP_AUTH_TOKEN` | That kind of authentication stops being accepted.                     |

#### Connect clients

##### ChatGPT (OAuth)

In ChatGPT's **Add custom MCP server** dialog:

1. **Connection:** Server URL `https://leetcode-mcp-server.fly.dev/mcp`
2. **Authentication:** OAuth. Open **Advanced OAuth settings** and click **Retry discovery**. ChatGPT should find the endpoints.
3. **Registration method:** choose **Dynamic Client Registration (DCR)**. ChatGPT registers itself and you don't need to set anything else.
4. Create the connector. ChatGPT opens this server's **Authorize LeetCode MCP** page. Enter your OAuth password and click **Approve**.

If you'd rather use **User-Defined OAuth Client**, copy the **Callback URL** from the dialog and set a client on the server:

```bash
CLIENT_SECRET="$(openssl rand -hex 32)"
fly secrets set \
  LEETCODE_OAUTH_CLIENT_ID="chatgpt" \
  LEETCODE_OAUTH_CLIENT_SECRET="$CLIENT_SECRET" \
  LEETCODE_OAUTH_REDIRECT_URIS="<CALLBACK_URL_FROM_CHATGPT>"
echo "$CLIENT_SECRET"
```

Enter the same client ID and secret in ChatGPT, and set **Token endpoint auth method** to `client_secret_post`.

##### Claude Code and other clients that send headers (bearer token)

```bash
claude mcp add --transport http leetcode https://leetcode-mcp-server.fly.dev/mcp \
  --header "Authorization: Bearer <YOUR_TOKEN>"
```

Or in a JSON client config:

```json
{
  "mcpServers": {
    "leetcode": {
      "type": "http",
      "url": "https://leetcode-mcp-server.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer <YOUR_TOKEN>"
      }
    }
  }
}
```

Replace the hostname with your app's `*.fly.dev` URL if you used a different app name.

> [!WARNING]
>
> Without `LEETCODE_HTTP_AUTH_TOKEN` or OAuth, a public Fly URL with `LEETCODE_SESSION` set lets anyone who can reach the endpoint use your authenticated LeetCode session, including submitting code and editing notes and lists. Always enable at least one of them, or keep the app private (for example Flycast / private networking).

## Available Tools

### Problems

| Tool                    | Global | CN  | Auth Required | Description                                                  |
| ----------------------- | :----: | :-: | :-----------: | ------------------------------------------------------------ |
| **get_daily_challenge** |   ✅   | ✅  |      ❌       | Retrieves today's LeetCode Daily Challenge problem           |
| **get_problem**         |   ✅   | ✅  |      ❌       | Retrieves details for a specific LeetCode problem            |
| **search_problems**     |   ✅   | ✅  |      ❌       | Searches for LeetCode problems with multiple filter criteria |

### Users

| Tool                              | Global | CN  | Auth Required | Description                                                  |
| --------------------------------- | :----: | :-: | :-----------: | ------------------------------------------------------------ |
| **get_user_profile**              |   ✅   | ✅  |      ❌       | Retrieves profile information for a LeetCode user            |
| **get_user_contest_ranking**      |   ✅   | ✅  |      ❌       | Obtains contest ranking statistics for a user                |
| **get_recent_ac_submissions**     |   ✅   | ✅  |      ❌       | Retrieves a user's recent accepted submissions               |
| **get_recent_submissions**        |   ✅   | ❌  |      ❌       | Retrieves a user's recent submissions history                |
| **get_user_status**               |   ✅   | ✅  |      ✅       | Retrieves current user's current status                      |
| **get_problem_submission_report** |   ✅   | ✅  |      ✅       | Provides detailed submission analysis for a specific problem |
| **get_problem_progress**          |   ✅   | ✅  |      ✅       | Retrieves current user's problem-solving progress            |
| **get_all_submissions**           |   ✅   | ✅  |      ✅       | Retrieves current user's submission history                  |

### Submissions

| Tool                | Global | CN  | Auth Required | Description                                                   |
| ------------------- | :----: | :-: | :-----------: | ------------------------------------------------------------- |
| **run_code**        |   ✅   | ✅  |      ✅       | Runs code for a problem and polls `/check/` until finished    |
| **submit_solution** |   ✅   | ✅  |      ✅       | Submits code for a problem and polls `/check/` until finished |

### Notes

| Tool             | Global | CN  | Auth Required | Description                                           |
| ---------------- | :----: | :-: | :-----------: | ----------------------------------------------------- |
| **search_notes** |   ❌   | ✅  |      ✅       | Searches for user notes with filtering options        |
| **get_note**     |   ❌   | ✅  |      ✅       | Retrieves notes for a specific problem by question ID |
| **create_note**  |   ❌   | ✅  |      ✅       | Creates a new note for a specific problem             |
| **update_note**  |   ❌   | ✅  |      ✅       | Updates an existing note with new content             |

### Problem Lists

| Tool                          | Global | CN  | Auth Required | Description                                                  |
| ----------------------------- | :----: | :-: | :-----------: | ------------------------------------------------------------ |
| **list_problem_lists**        |   ✅   | ✅  |      ✅       | Lists the current user's problem lists (favorites)           |
| **get_problem_list**          |   ✅   | ✅  |      ✅       | Retrieves a problem list's metadata and its questions        |
| **create_problem_list**       |   ✅   | ✅  |      ✅       | Creates a new problem list, optionally with initial problems |
| **update_problem_list**       |   ✅   | ✅  |      ✅       | Renames a problem list, edits its description or visibility  |
| **add_problems_to_list**      |   ✅   | ✅  |      ✅       | Adds problems to a problem list by slug or problem number    |
| **remove_problems_from_list** |   ✅   | ✅  |      ✅       | Removes problems from a problem list                         |
| **reorder_problem_list**      |   ✅   | ✅  |      ✅       | Reorders the problems inside a problem list                  |

### Solutions

| Tool                       | Global | CN  | Auth Required | Description                                                    |
| -------------------------- | :----: | :-: | :-----------: | -------------------------------------------------------------- |
| **list_problem_solutions** |   ✅   | ✅  |      ❌       | Retrieves a list of community solutions for a specific problem |
| **get_problem_solution**   |   ✅   | ✅  |      ❌       | Retrieves the complete content of a specific solution          |

## Tool Parameters

### Problems

- **get_daily_challenge** - Retrieves today's LeetCode Daily Challenge problem with complete details

  - No parameters required

- **get_problem** - Retrieves details about a specific LeetCode problem

  - `titleSlug`: The URL slug/identifier of the problem (string, required)

- **search_problems** - Searches for LeetCode problems based on multiple filter criteria
  - `category`: Problem category filter (string, optional, default: "all-code-essentials")
  - `tags`: List of topic tags to filter problems by (string[], optional)
  - `difficulty`: Problem difficulty level filter (enum: "EASY", "MEDIUM", "HARD", optional)
  - `searchKeywords`: Keywords to search in problem titles and descriptions (string, optional)
  - `limit`: Maximum number of problems to return (number, optional, default: 10)
  - `offset`: Number of problems to skip (number, optional)

### Users

- **get_user_profile** - Retrieves profile information about a LeetCode user

  - `username`: LeetCode username (string, required)

- **get_user_contest_ranking** - Retrieves a user's contest ranking information

  - `username`: LeetCode username (string, required)
  - `attended`: Whether to include only the contests the user has participated in (boolean, optional, default: true)

- **get_recent_submissions** - Retrieves a user's recent submissions on LeetCode Global

  - `username`: LeetCode username (string, required)
  - `limit`: Maximum number of submissions to return (number, optional, default: 10)

- **get_recent_ac_submissions** - Retrieves a user's recent accepted submissions

  - `username`: LeetCode username (string, required)
  - `limit`: Maximum number of submissions to return (number, optional, default: 10)

- **get_user_status** - Retrieves the current user's status

  - No parameters required

- **get_problem_submission_report** - Retrieves detailed information about a specific submission

  - `id`: The numerical submission ID (number, required)

- **get_problem_progress** - Retrieves the current user's problem-solving progress

  - `offset`: Number of questions to skip (number, optional, default: 0)
  - `limit`: Maximum number of questions to return (number, optional, default: 100)
  - `questionStatus`: Filter by question status (enum: "ATTEMPTED", "SOLVED", optional)
  - `difficulty`: Filter by difficulty levels (string[], optional)

- **get_all_submissions** - Retrieves paginated list of user's submissions
  - `limit`: Maximum number of submissions to return (number, default: 20)
  - `offset`: Number of submissions to skip (number, default: 0)
  - `questionSlug`: Optional problem identifier (string, optional)
  - `lang`: Programming language filter (string, optional, CN only)
  - `status`: Submission status filter (enum: "AC", "WA", optional, CN only)
  - `lastKey`: Pagination token for retrieving next page (string, optional, CN only)

### Submissions

- **run_code** - Runs code for a specific problem and waits until finished (requires authentication)

  - `titleSlug`: The URL slug/identifier of the problem (string, required)
  - `lang`: Programming language (string enum, required)
  - `typedCode`: Source code to run (string, required)
  - `dataInput`: Custom input to run (string, optional)
  - `timeoutMs`: Polling timeout in milliseconds (number, optional, default: 120000)
  - `pollIntervalMs`: Polling interval in milliseconds (number, optional, default: 1500)

- **submit_solution** - Submits code for a specific problem and waits until finished (requires authentication)

  - `titleSlug`: The URL slug/identifier of the problem (string, required)
  - `lang`: Programming language (string enum, required)
  - `typedCode`: Source code to submit (string, required)
  - `timeoutMs`: Polling timeout in milliseconds (number, optional, default: 120000)
  - `pollIntervalMs`: Polling interval in milliseconds (number, optional, default: 1500)

### Notes

- **search_notes** - Searches for user notes on LeetCode China

  - `keyword`: Search term to filter notes (string, optional)
  - `limit`: Maximum number of notes to return (number, optional, default: 10)
  - `skip`: Number of notes to skip (number, optional, default: 0)
  - `orderBy`: Sort order for returned notes (enum: "ASCENDING", "DESCENDING", optional, default: "DESCENDING")

- **get_note** - Retrieves user notes for a specific LeetCode problem
  - `questionId`: The question ID of the LeetCode problem (string, required)
  - `limit`: Maximum number of notes to return (number, optional, default: 10)
  - `skip`: Number of notes to skip (number, optional, default: 0)
- **create_note** - Creates a new note for a specific LeetCode problem

  - `questionId`: The question ID of the LeetCode problem (string, required)
  - `content`: The content of the note, supports markdown format (string, required)
  - `summary`: An optional short summary or title for the note (string, optional)

- **update_note** - Updates an existing note with new content or summary
  - `noteId`: The ID of the note to update (string, required)
  - `content`: The new content for the note, supports markdown format (string, required)
  - `summary`: An optional new short summary or title for the note (string, optional)

### Problem Lists

Problem lists are identified by their `favoriteSlug`, the path segment after `/problem-list/` in the list URL.

- **list_problem_lists** - Lists the current user's problem lists

  - `includeCollected`: Also return lists saved from other creators (boolean, optional, default: false)

- **get_problem_list** - Retrieves a problem list's metadata and a page of its questions

  - `favoriteSlug`: The slug of the problem list (string, required)
  - `limit`: Maximum number of questions to return (number, optional, default: 50)
  - `skip`: Number of questions to skip (number, optional, default: 0)
  - `searchKeyword`: Keyword to filter questions by title (string, optional)
  - `sortField`: Sort field: `CUSTOM` (the order shown on the website), `FRONTEND_ID`, `DIFFICULTY`, `AC_RATE`, `FREQUENCY` or `CONTEST_POINT` (string, optional, default: `CUSTOM`)
  - `sortOrder`: `ASCENDING` or `DESCENDING` (string, optional, default: `ASCENDING`)

- **create_problem_list** - Creates a new problem list

  - `name`: Display name of the list (string, required)
  - `description`: Description of the list (string, optional, default: "")
  - `isPublic`: Whether the list is publicly visible (boolean, optional, default: false)
  - `questionSlugs`: Problem slugs to add right after creation (string[], optional)
  - `questionIds`: Problem numbers to add right after creation, e.g. `[1, 1143]`; numbers that cannot be resolved are returned in `unresolved` ((string | number)[], optional)

- **update_problem_list** - Renames a problem list, changes its description or toggles its visibility (at least one optional field is required)

  - `favoriteSlug`: The slug of the problem list (string, required)
  - `name`: New display name (string, optional)
  - `description`: New description (string, optional)
  - `isPublic`: New visibility (boolean, optional)

- **add_problems_to_list** - Adds problems to a problem list (at least one of `questionSlugs` / `questionIds` is required; problems are appended in the given order, slugs first)

  - `favoriteSlug`: The slug of the problem list (string, required)
  - `questionSlugs`: Problem slugs to add, e.g. `["two-sum"]` (string[], optional)
  - `questionIds`: Problem numbers to add, e.g. `[1, 1143]` or `["LCP 82"]`; numbers that cannot be resolved are returned in `unresolved` ((string | number)[], optional)

- **remove_problems_from_list** - Removes problems from a problem list

  - `favoriteSlug`: The slug of the problem list (string, required)
  - `questionSlugs`: Problem slugs to remove (string[], required)

- **reorder_problem_list** - Reorders the problems inside a problem list (exactly one of `sortField` / `questionSlugs` is required; one problem is moved per request)
  - `favoriteSlug`: The slug of the problem list (string, required)
  - `sortField`: Sort the whole list by `FRONTEND_ID`, `DIFFICULTY`, `AC_RATE`, `FREQUENCY` or `CONTEST_POINT` (string, optional)
  - `sortOrder`: `ASCENDING` or `DESCENDING` (string, optional, default: `ASCENDING`)
  - `questionSlugs`: Problem slugs to move to the top, in this order; the remaining problems keep their relative order (string[], optional)

### Solutions

- **list_problem_solutions** - Retrieves a list of community solutions for a specific problem

  - `questionSlug`: The URL slug/identifier of the problem (string, required)
  - `limit`: Maximum number of solutions to return (number, optional, default: 10)
  - `skip`: Number of solutions to skip (number, optional)
  - `userInput`: Search term to filter solutions (string, optional)
  - `tagSlugs`: Array of tag identifiers to filter solutions (string[], optional, default: [])
  - `orderBy`: Sorting criteria for the returned solutions
    - Global: enum: "HOT", "MOST_RECENT", "MOST_VOTES", optional, default: "HOT"
    - CN: enum: "DEFAULT", "MOST_UPVOTE", "HOT", "NEWEST_TO_OLDEST", "OLDEST_TO_NEWEST", optional, default: "DEFAULT"

- **get_problem_solution** - Retrieves the complete content of a specific solution
  - `topicId`: Unique topic ID of the solution (string, required, Global only)
  - `slug`: Unique slug/identifier of the solution (string, required, CN only)

## Available Resources

| Resource Name          | Global | CN  | Auth Required | Description                                                  |
| ---------------------- | :----: | :-: | :-----------: | ------------------------------------------------------------ |
| **problem-categories** |   ✅   | ✅  |      ❌       | A list of all problem classification categories              |
| **problem-tags**       |   ✅   | ✅  |      ❌       | A detailed collection of algorithmic and data structure tags |
| **problem-langs**      |   ✅   | ✅  |      ❌       | A complete list of all supported programming languages       |
| **problem-detail**     |   ✅   | ✅  |      ❌       | Provides details about a specific problem                    |
| **problem-solution**   |   ✅   | ✅  |      ❌       | Provides the complete content of a specific solution         |

## Resource URIs

- **problem-categories** - A list of all problem classification categories

  - URI: `categories://problems/all`

- **problem-tags** - A detailed collection of algorithmic and data structure tags

  - URI: `tags://problems/all`

- **problem-langs** - A complete list of all programming languages supported by LeetCode

  - URI: `langs://problems/all`

- **problem-detail** - Provides details about a specific LeetCode problem

  - URI: `problem://{titleSlug}`
  - Parameters:
    - `titleSlug`: Problem identifier as it appears in the LeetCode URL

- **problem-solution** - Provides the complete content of a specific solution
  - Global URI: `solution://{topicId}`
    - Parameters:
      - `topicId`: Unique topic ID of the solution
  - CN URI: `solution://{slug}`
    - Parameters:
      - `slug`: Unique slug/identifier of the solution

## Authentication

User-specific data access requires LeetCode session authentication:

1. Log in to LeetCode ([Global](https://leetcode.com) or [China](https://leetcode.cn) site)
2. Extract `LEETCODE_SESSION` cookie from browser developer tools
3. Configure server with `--session` flag or `LEETCODE_SESSION` environment variable

## Response Format

All tools return JSON-formatted responses with the following structure:

```json
{
  "content": [
    {
      "type": "text",
      "text": "JSON_DATA_STRING"
    }
  ]
}
```

The `JSON_DATA_STRING` contains either the requested data or an error message for failed requests.

## License

This project is licensed under the MIT License.
