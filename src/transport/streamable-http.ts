import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createOAuth, type OAuthConfig } from "../auth/oauth-router.js";
import logger from "../utils/logger.js";
import { createBearerAuthMiddleware } from "./bearer-auth.js";

type McpRequest = IncomingMessage & { body?: unknown };
type McpResponse = ServerResponse & {
    status(code: number): McpResponse;
    json(body: unknown): void;
    send(body: string): void;
};

export interface StreamableHttpOptions {
    host: string;
    port: number;
    endpoint: string;
    /** When set, every request to the endpoint must send `Authorization: Bearer <authToken>`. */
    authToken?: string;
    /** When set, the server acts as an OAuth 2.1 authorization server and requires OAuth access tokens (or `authToken`). */
    oauth?: OAuthConfig;
    /** Number of reverse-proxy hops to trust for the client IP (e.g. 1 on Fly.io). */
    trustProxy?: number;
    createServer: () => Promise<McpServer> | McpServer;
}

/**
 * Starts the MCP server using the Streamable HTTP transport.
 *
 * Implements stateful session management with POST, GET (SSE), and DELETE endpoints
 * as defined in the MCP Streamable HTTP specification.
 */
export async function startStreamableHttpTransport(
    options: StreamableHttpOptions
): Promise<void> {
    const { host, port, endpoint, authToken, oauth, trustProxy, createServer } =
        options;
    const app = createMcpExpressApp({ host });
    if (trustProxy) {
        app.set("trust proxy", trustProxy);
    }

    // Unauthenticated liveness check for load balancers (e.g. Fly.io checks),
    // so they never need to touch the MCP endpoint.
    const startedAt = Date.now();
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000)
        });
    });
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    const mcpPostHandler = async (req: McpRequest, res: McpResponse) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        try {
            let transport: StreamableHTTPServerTransport;

            if (sessionId && transports[sessionId]) {
                transport = transports[sessionId];
            } else if (!sessionId && isInitializeRequest(req.body)) {
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (id) => {
                        transports[id] = transport;
                        logger.info("MCP session initialized: %s", id);
                    }
                });

                transport.onclose = () => {
                    const sid = transport.sessionId;
                    if (sid && transports[sid]) {
                        logger.info("MCP session closed: %s", sid);
                        delete transports[sid];
                    }
                };

                const server = await createServer();
                await server.connect(transport);
                await transport.handleRequest(req, res, req.body);
                return;
            } else {
                res.status(400).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32000,
                        message: "Bad Request: No valid session ID provided"
                    },
                    id: null
                });
                return;
            }

            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error("Error handling MCP POST request: %s", error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: "2.0",
                    error: {
                        code: -32603,
                        message: "Internal server error"
                    },
                    id: null
                });
            }
        }
    };

    const mcpGetHandler = async (req: McpRequest, res: McpResponse) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
    };

    const mcpDeleteHandler = async (req: McpRequest, res: McpResponse) => {
        const sessionId = req.headers["mcp-session-id"] as string | undefined;

        if (!sessionId || !transports[sessionId]) {
            res.status(400).send("Invalid or missing session ID");
            return;
        }

        logger.info("MCP session termination requested: %s", sessionId);

        try {
            const transport = transports[sessionId];
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.error("Error handling MCP session termination: %s", error);
            if (!res.headersSent) {
                res.status(500).send("Error processing session termination");
            }
        }
    };

    if (oauth) {
        const { router, protect } = createOAuth(oauth, endpoint, authToken);
        app.use(router);
        app.use(endpoint, protect);
        logger.info(
            "OAuth enabled: issuer %s, protecting %s%s",
            oauth.issuerUrl.href,
            endpoint,
            authToken ? " (static bearer token also accepted)" : ""
        );
    } else if (authToken) {
        app.use(endpoint, createBearerAuthMiddleware(authToken));
        logger.info("Bearer token authentication enabled for %s", endpoint);
    } else if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
        logger.warn(
            "No auth token configured and listening on %s: anyone who can reach %s can use this server. Set LEETCODE_HTTP_AUTH_TOKEN or --auth-token.",
            host,
            endpoint
        );
    }

    app.post(endpoint, mcpPostHandler);
    app.get(endpoint, mcpGetHandler);
    app.delete(endpoint, mcpDeleteHandler);

    const closeAllTransports = async () => {
        for (const sessionId of Object.keys(transports)) {
            try {
                await transports[sessionId].close();
                delete transports[sessionId];
            } catch (error) {
                logger.error(
                    "Error closing transport for session %s: %s",
                    sessionId,
                    error
                );
            }
        }
    };

    process.on("SIGINT", async () => {
        logger.info("Shutting down Streamable HTTP server...");
        await closeAllTransports();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        logger.info("Shutting down Streamable HTTP server...");
        await closeAllTransports();
        process.exit(0);
    });

    await new Promise<void>((resolve, reject) => {
        app.listen(port, host, (error?: Error) => {
            if (error) {
                reject(error);
                return;
            }

            logger.info(
                "LeetCode MCP Server (Streamable HTTP) listening on http://%s:%d%s",
                host,
                port,
                endpoint
            );
            resolve();
        });
    });
}
