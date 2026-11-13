import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import {
    getOAuthProtectedResourceMetadataUrl,
    mcpAuthRouter
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import express, { type RequestHandler, type Router } from "express";
import { rateLimit } from "express-rate-limit";
import logger from "../utils/logger.js";
import {
    MCP_SCOPE,
    SingleUserOAuthProvider,
    type StaticOAuthClient
} from "./oauth-provider.js";

export const LOGIN_PATH = "/oauth/login";

export interface OAuthConfig {
    /** Public base URL of this server, e.g. https://my-app.fly.dev */
    issuerUrl: URL;
    password: string;
    signingKey: string;
    staticClient?: StaticOAuthClient;
}

/**
 * Builds the OAuth routes (discovery metadata, /authorize, /token, /register
 * and the login form) plus the middleware that protects the MCP endpoint.
 *
 * `staticBearerToken`, when set, is accepted on the MCP endpoint alongside
 * OAuth access tokens so clients that send a fixed header keep working.
 */
export function createOAuth(
    config: OAuthConfig,
    endpoint: string,
    staticBearerToken?: string
): { router: Router; protect: RequestHandler } {
    const resourceUrl = new URL(endpoint, config.issuerUrl);
    const provider = new SingleUserOAuthProvider({
        password: config.password,
        signingKey: config.signingKey,
        resourceUrl,
        loginPath: LOGIN_PATH,
        staticClient: config.staticClient,
        staticBearerToken
    });

    const router = express.Router();
    router.use(
        mcpAuthRouter({
            provider,
            issuerUrl: config.issuerUrl,
            resourceServerUrl: resourceUrl,
            scopesSupported: [MCP_SCOPE],
            resourceName: "LeetCode MCP Server",
            // Dynamically registered client secrets never expire; they are
            // derived from the signing key, so rotating the key revokes them.
            clientRegistrationOptions: { clientSecretExpirySeconds: 0 }
        })
    );

    router.post(
        LOGIN_PATH,
        rateLimit({
            windowMs: 15 * 60 * 1000,
            limit: 10,
            standardHeaders: true,
            legacyHeaders: false,
            // Only failed password attempts count against the limit.
            skipSuccessfulRequests: true,
            requestWasSuccessful: (_req, res) => res.statusCode < 400
        }),
        express.urlencoded({ extended: false, limit: "16kb" }),
        async (req, res) => {
            try {
                const result = await provider.completeLogin(req.body ?? {});
                if (result.kind === "redirect") {
                    res.set("Cache-Control", "no-store").redirect(
                        302,
                        result.location
                    );
                } else if (result.kind === "retry") {
                    logger.warn("OAuth login failed: incorrect password");
                    provider.respondHtml(res, result.html, 401);
                } else {
                    provider.respondHtml(
                        res,
                        `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>${result.message}</p>`,
                        400
                    );
                }
            } catch (error) {
                logger.error("OAuth login error: %s", error);
                res.status(500).send("Internal server error");
            }
        }
    );

    const protect = requireBearerAuth({
        verifier: provider,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
        expectedResource: resourceUrl
    });

    return { router, protect };
}
