#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import minimist from "minimist";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthConfig } from "./auth/oauth-router.js";
import { MAX_TOOL_INPUT_ARRAY_ITEMS } from "./common/constants.js";
import { LeetCodeBaseService } from "./leetcode/leetcode-base-service.js";
import { LeetCodeServiceFactory } from "./leetcode/leetcode-service-factory.js";
import { registerProblemResources } from "./mcp/resources/problem-resources.js";
import { registerSolutionResources } from "./mcp/resources/solution-resources.js";
import { registerContestTools } from "./mcp/tools/contest-tools.js";
import { registerFavoriteTools } from "./mcp/tools/favorite-tools.js";
import { registerNoteTools } from "./mcp/tools/note-tools.js";
import { registerProblemTools } from "./mcp/tools/problem-tools.js";
import { registerSolutionTools } from "./mcp/tools/solution-tools.js";
import { registerSubmissionTools } from "./mcp/tools/submission-tools.js";
import { registerUserTools } from "./mcp/tools/user-tools.js";
import { startStreamableHttpTransport } from "./transport/streamable-http.js";
import logger from "./utils/logger.js";

type TransportMode = "stdio" | "http";

/**
 * Parses and validates command line arguments for the LeetCode MCP Server.
 *
 * @returns Configuration object with site, transport, and optional session information
 */
function parseArgs() {
    const args = minimist(process.argv.slice(2), {
        string: [
            "site",
            "session",
            "transport",
            "host",
            "endpoint",
            "auth-token"
        ],
        boolean: ["help"],
        alias: {
            s: "site",
            c: "session",
            h: "help",
            t: "transport"
        }
    });

    if (args.help) {
        logger.info(`LeetCode MCP Server - Model Context Protocol server for LeetCode

  Usage: leetcode-mcp-server [options]

  Options:
    --site, -s <site>              LeetCode API site: 'global' (leetcode.com) or 'cn' (leetcode.cn), default is 'global'
    --session, -c <cookie>         Optional LeetCode session cookie for authenticated requests
    --transport, -t <transport>    Transport mode: 'stdio' (default) or 'http' (Streamable HTTP)
    --port <port>                  HTTP server port when using Streamable HTTP transport (default: 3000)
    --host <host>                  HTTP server host when using Streamable HTTP transport (default: 127.0.0.1)
    --endpoint <path>              HTTP endpoint path when using Streamable HTTP transport (default: /mcp)
    --auth-token <token>           Require 'Authorization: Bearer <token>' on the HTTP endpoint (Streamable HTTP only)
    --help, -h                     Show this help message

  Environment variables:
    LEETCODE_SITE                  Same as --site
    LEETCODE_SESSION               Same as --session
    LEETCODE_TRANSPORT             Same as --transport
    LEETCODE_HTTP_PORT             Same as --port
    LEETCODE_HTTP_HOST             Same as --host
    LEETCODE_HTTP_ENDPOINT         Same as --endpoint
    LEETCODE_HTTP_AUTH_TOKEN       Same as --auth-token
    LEETCODE_HTTP_TRUST_PROXY      Number of reverse-proxy hops to trust for client IPs (e.g. 1 on Fly.io)

  OAuth (Streamable HTTP only; enabled when LEETCODE_OAUTH_PASSWORD is set):
    LEETCODE_OAUTH_PASSWORD        Password you type to approve a client
    LEETCODE_OAUTH_SIGNING_KEY     Secret (32+ chars) used to sign tokens and client IDs
    LEETCODE_OAUTH_ISSUER_URL      Public base URL of this server, e.g. https://my-app.fly.dev
    LEETCODE_OAUTH_CLIENT_ID       Optional pre-configured client ID
    LEETCODE_OAUTH_CLIENT_SECRET   Optional pre-configured client secret
    LEETCODE_OAUTH_REDIRECT_URIS   Comma-separated redirect URIs for the pre-configured client`);
        process.exit(0);
    }

    const transport = (args.transport ||
        process.env.LEETCODE_TRANSPORT ||
        "stdio") as TransportMode;

    const options = {
        site: args.site || process.env.LEETCODE_SITE || "global",
        session: args.session || process.env.LEETCODE_SESSION,
        transport,
        port: Number(args.port || process.env.LEETCODE_HTTP_PORT || 3000),
        host: args.host || process.env.LEETCODE_HTTP_HOST || "127.0.0.1",
        endpoint: args.endpoint || process.env.LEETCODE_HTTP_ENDPOINT || "/mcp",
        trustProxy: Number(process.env.LEETCODE_HTTP_TRUST_PROXY || 0),
        oauth: parseOAuthConfig(),
        authToken: (
            args["auth-token"] ||
            process.env.LEETCODE_HTTP_AUTH_TOKEN ||
            ""
        ).trim()
    };

    if (options.site !== "global" && options.site !== "cn") {
        logger.error("The site must be either 'global' or 'cn'");
        process.exit(1);
    }

    if (options.transport !== "stdio" && options.transport !== "http") {
        logger.error("The transport must be either 'stdio' or 'http'");
        process.exit(1);
    }

    if (
        !Number.isInteger(options.port) ||
        options.port < 1 ||
        options.port > 65535
    ) {
        logger.error("The port must be an integer between 1 and 65535");
        process.exit(1);
    }

    if (!options.endpoint.startsWith("/")) {
        logger.error("The endpoint must start with '/'");
        process.exit(1);
    }

    return options;
}

/**
 * Reads OAuth settings from the environment. OAuth is enabled when
 * LEETCODE_OAUTH_PASSWORD is set; secrets are only read from the environment so
 * they never show up in the process list.
 */
function parseOAuthConfig(): OAuthConfig | undefined {
    const env = process.env;
    const password = env.LEETCODE_OAUTH_PASSWORD?.trim();
    if (!password) {
        return undefined;
    }

    const fail = (message: string): never => {
        logger.error(message);
        process.exit(1);
    };

    const signingKey = env.LEETCODE_OAUTH_SIGNING_KEY?.trim() ?? "";
    if (signingKey.length < 32) {
        fail(
            "LEETCODE_OAUTH_SIGNING_KEY must be set to at least 32 characters when OAuth is enabled"
        );
    }

    const issuer = env.LEETCODE_OAUTH_ISSUER_URL?.trim();
    if (!issuer || !URL.canParse(issuer)) {
        fail(
            "LEETCODE_OAUTH_ISSUER_URL must be set to this server's public URL (e.g. https://my-app.fly.dev) when OAuth is enabled"
        );
    }
    const issuerUrl = new URL(issuer!);
    if (issuerUrl.pathname !== "/" || issuerUrl.search || issuerUrl.hash) {
        fail("LEETCODE_OAUTH_ISSUER_URL must be a bare origin without a path");
    }

    const clientId = env.LEETCODE_OAUTH_CLIENT_ID?.trim();
    let staticClient: OAuthConfig["staticClient"];
    if (clientId) {
        const redirectUris = (env.LEETCODE_OAUTH_REDIRECT_URIS ?? "")
            .split(",")
            .map((uri) => uri.trim())
            .filter(Boolean);
        if (
            redirectUris.length === 0 ||
            !redirectUris.every((u) => URL.canParse(u))
        ) {
            fail(
                "LEETCODE_OAUTH_REDIRECT_URIS must list the client's callback URL(s) when LEETCODE_OAUTH_CLIENT_ID is set"
            );
        }
        staticClient = {
            clientId,
            clientSecret: env.LEETCODE_OAUTH_CLIENT_SECRET?.trim() || undefined,
            redirectUris
        };
    }

    return { issuerUrl, password, signingKey, staticClient };
}

/**
 * Retrieves the package.json object containing metadata about the project.
 *
 * @returns The package.json object containing metadata about the project.
 */
function getPackageJson() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const packageJSONPath = join(__dirname, "..", "package.json");
    const packageJSON = JSON.parse(readFileSync(packageJSONPath, "utf-8"));
    return packageJSON;
}

/**
 * Number of top-level keys in the search_problems input schema: category,
 * tags, difficulty, searchKeywords, limit and offset. The SDK counts the root
 * arguments object's own keys as well as every array element, so the element
 * ceiling is sized one above the largest allowed input of that tool.
 */
const SEARCH_PROBLEMS_ENVELOPE_KEYS = 6;

/**
 * Tool-input element ceiling: the 1,000-element array bound declared on
 * search_problems.tags plus that tool's six envelope keys plus one, so the
 * schema's own declared maximum is accepted while a larger call is refused by
 * the SDK before argument validation.
 */
const MAX_TOOL_INPUT_ELEMENTS =
    MAX_TOOL_INPUT_ARRAY_ITEMS + SEARCH_PROBLEMS_ENVELOPE_KEYS + 1;

/**
 * Creates and configures the LeetCode MCP Server instance.
 */
function createMcpServer(leetcodeService: LeetCodeBaseService): McpServer {
    const packageJSON = getPackageJson();

    const server = new McpServer(
        {
            name: "LeetCode MCP Server",
            version: packageJSON.version
        },
        {
            maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS
        }
    );

    registerProblemTools(server, leetcodeService);
    registerUserTools(server, leetcodeService);
    registerContestTools(server, leetcodeService);
    registerSolutionTools(server, leetcodeService);
    registerNoteTools(server, leetcodeService);
    registerFavoriteTools(server, leetcodeService);
    registerSubmissionTools(server, leetcodeService);

    registerProblemResources(server, leetcodeService);
    registerSolutionResources(server, leetcodeService);

    return server;
}

/**
 * Main function that initializes and starts the LeetCode MCP Server.
 */
async function main() {
    const options = parseArgs();

    const leetcodeService: LeetCodeBaseService =
        await LeetCodeServiceFactory.createService(
            options.site,
            options.session
        );

    if (options.transport === "http") {
        await startStreamableHttpTransport({
            host: options.host,
            port: options.port,
            endpoint: options.endpoint,
            authToken: options.authToken || undefined,
            oauth: options.oauth,
            trustProxy: options.trustProxy,
            createServer: () => createMcpServer(leetcodeService)
        });
        return;
    }

    const server = createMcpServer(leetcodeService);
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((error) => {
    logger.error("Failed to start LeetCode MCP Server: %s", error);
    process.exit(1);
});
