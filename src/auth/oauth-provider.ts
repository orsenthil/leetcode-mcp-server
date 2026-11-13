import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
    InvalidGrantError,
    InvalidScopeError,
    InvalidTargetError,
    InvalidTokenError
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
    AuthorizationParams,
    OAuthServerProvider
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
    OAuthClientInformationFull,
    OAuthTokens
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import logger from "../utils/logger.js";
import { renderLoginPage } from "./login-page.js";
import { safeEqual, Signer } from "./signed-token.js";

/** The only scope this server grants. */
export const MCP_SCOPE = "mcp";

const ACCESS_TOKEN_TTL = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days
const AUTH_CODE_TTL = 5 * 60; // 5 minutes
const PENDING_TTL = 10 * 60; // 10 minutes to type the password

export interface StaticOAuthClient {
    clientId: string;
    clientSecret?: string;
    redirectUris: string[];
}

export interface SingleUserOAuthOptions {
    /** Password the owner types on the consent page. */
    password: string;
    /** Secret used to sign every token, code and registered client ID. */
    signingKey: string;
    /** Canonical URL of the protected MCP endpoint (token audience). */
    resourceUrl: URL;
    /** Path the login form posts to. */
    loginPath: string;
    /** Optional pre-configured ("user-defined") OAuth client. */
    staticClient?: StaticOAuthClient;
    /** Optional static bearer token accepted alongside OAuth access tokens. */
    staticBearerToken?: string;
}

type ClientClaims = { r: string[]; a?: string; n?: string };
type PendingClaims = {
    cid: string;
    ru: string;
    cc: string;
    st?: string;
    sc: string[];
};
type CodeClaims = PendingClaims & { jti: string };
type TokenClaims = { cid: string; sc: string[] };

export type LoginResult =
    | { kind: "redirect"; location: string }
    | { kind: "retry"; html: string }
    | { kind: "error"; message: string };

/** Strips a fragment and one trailing slash so URLs compare reliably. */
function comparable(url: URL | string): string {
    const text = String(url);
    const hash = text.indexOf("#");
    return (hash === -1 ? text : text.slice(0, hash)).replace(/\/$/, "");
}

/**
 * A self-contained OAuth 2.1 authorization server for a single owner.
 *
 * - Clients are either one pre-configured client (client ID, secret and
 *   redirect URIs from the environment) or registered dynamically (RFC 7591).
 *   Dynamically registered client IDs are signed blobs carrying the client's
 *   metadata, so nothing has to be stored.
 * - The authorization step shows a password page; only the owner, who knows
 *   the password, can approve a client.
 * - Codes and tokens are signed, so they survive restarts (useful on Fly.io
 *   where idle machines stop). Changing the signing key revokes everything.
 */
export class SingleUserOAuthProvider implements OAuthServerProvider {
    private readonly signer: Signer;
    private readonly usedCodes = new Map<string, number>();

    constructor(private readonly options: SingleUserOAuthOptions) {
        if (!options.password) {
            throw new Error("An OAuth password is required");
        }
        this.signer = new Signer(options.signingKey);
    }

    get clientsStore(): OAuthRegisteredClientsStore {
        return {
            getClient: (clientId) => this.getClient(clientId),
            registerClient: (client) => this.registerClient(client)
        };
    }

    private clientSecretFor(clientId: string): string {
        return this.signer.derive(`client-secret:${clientId}`);
    }

    private getClient(
        clientId: string
    ): OAuthClientInformationFull | undefined {
        const fixed = this.options.staticClient;
        if (fixed && safeEqual(clientId, fixed.clientId)) {
            return {
                client_id: fixed.clientId,
                client_secret: fixed.clientSecret || undefined,
                redirect_uris: fixed.redirectUris,
                token_endpoint_auth_method: fixed.clientSecret
                    ? "client_secret_post"
                    : "none",
                client_name: "Pre-configured client"
            };
        }

        const claims = this.signer.verify<ClientClaims>("client", clientId);
        if (!claims || !Array.isArray(claims.r) || claims.r.length === 0) {
            return undefined;
        }
        const isPublic = claims.a === "none";
        return {
            client_id: clientId,
            client_id_issued_at: claims.iat,
            client_secret: isPublic
                ? undefined
                : this.clientSecretFor(clientId),
            client_secret_expires_at: isPublic ? undefined : 0,
            redirect_uris: claims.r,
            token_endpoint_auth_method: claims.a,
            client_name: claims.n
        };
    }

    private registerClient(
        client: Omit<
            OAuthClientInformationFull,
            "client_id" | "client_id_issued_at"
        >
    ): OAuthClientInformationFull {
        const authMethod =
            client.token_endpoint_auth_method ?? "client_secret_post";
        const clientId = this.signer.sign(
            "client",
            {
                r: client.redirect_uris,
                a: authMethod,
                n: client.client_name?.slice(0, 100)
            },
            0
        );
        const isPublic = authMethod === "none";
        return {
            ...client,
            client_id: clientId,
            client_id_issued_at: Math.floor(Date.now() / 1000),
            token_endpoint_auth_method: authMethod,
            client_secret: isPublic
                ? undefined
                : this.clientSecretFor(clientId),
            client_secret_expires_at: isPublic ? undefined : 0
        };
    }

    /**
     * Checks the RFC 8707 `resource` a client asked for. Clients differ in what
     * they send (the MCP endpoint URL, the bare origin, with or without a
     * trailing slash), so any URL on this server's origin is accepted; tokens
     * are always issued for the MCP endpoint. Other origins are refused.
     */
    private checkResource(resource: URL | undefined, step: string): void {
        if (!resource) {
            return;
        }
        const expected = this.options.resourceUrl;
        if (comparable(resource) === comparable(expected)) {
            return;
        }
        if (resource.origin === expected.origin) {
            logger.info(
                "OAuth %s: client requested resource %s; issuing token for %s",
                step,
                resource.href,
                expected.href
            );
            return;
        }
        logger.warn(
            "OAuth %s: rejected resource %s (expected %s)",
            step,
            resource.href,
            expected.href
        );
        throw new InvalidTargetError(
            `This server only issues tokens for ${expected.href}`
        );
    }

    async authorize(
        client: OAuthClientInformationFull,
        params: AuthorizationParams,
        res: Response
    ): Promise<void> {
        this.checkResource(params.resource, "authorize");
        const pending = this.signer.sign(
            "pending",
            {
                cid: client.client_id,
                ru: params.redirectUri,
                cc: params.codeChallenge,
                st: params.state,
                sc: [MCP_SCOPE]
            },
            PENDING_TTL
        );
        this.respondHtml(
            res,
            renderLoginPage({
                action: this.options.loginPath,
                pending,
                clientName: client.client_name,
                redirectUri: params.redirectUri
            })
        );
    }

    /**
     * Handles the login form: checks the password and, when approved, redirects
     * back to the client with an authorization code.
     */
    async completeLogin(form: {
        pending?: unknown;
        password?: unknown;
        decision?: unknown;
    }): Promise<LoginResult> {
        const pendingValue =
            typeof form.pending === "string" ? form.pending : "";
        const pending = this.signer.verify<PendingClaims>(
            "pending",
            pendingValue
        );
        if (!pending) {
            return {
                kind: "error",
                message:
                    "This sign-in request has expired or is invalid. Start again from your MCP client."
            };
        }

        const client = this.getClient(pending.cid);
        if (!client) {
            return { kind: "error", message: "Unknown client." };
        }

        const redirect = new URL(pending.ru);
        if (pending.st) {
            redirect.searchParams.set("state", pending.st);
        }

        if (form.decision === "deny") {
            redirect.searchParams.set("error", "access_denied");
            redirect.searchParams.set(
                "error_description",
                "The owner denied access"
            );
            return { kind: "redirect", location: redirect.href };
        }

        const password = typeof form.password === "string" ? form.password : "";
        if (!safeEqual(password, this.options.password)) {
            return {
                kind: "retry",
                html: renderLoginPage({
                    action: this.options.loginPath,
                    pending: pendingValue,
                    clientName: client.client_name,
                    redirectUri: pending.ru,
                    error: "Incorrect password."
                })
            };
        }

        const code = this.signer.sign(
            "code",
            {
                cid: pending.cid,
                ru: pending.ru,
                cc: pending.cc,
                sc: pending.sc,
                jti: randomUUID()
            },
            AUTH_CODE_TTL
        );
        redirect.searchParams.set("code", code);
        return { kind: "redirect", location: redirect.href };
    }

    private readCode(
        client: OAuthClientInformationFull,
        code: string
    ): CodeClaims & { exp?: number } {
        const claims = this.signer.verify<CodeClaims>("code", code);
        if (!claims || claims.cid !== client.client_id) {
            throw new InvalidGrantError(
                "Invalid or expired authorization code"
            );
        }
        if (this.usedCodes.has(claims.jti)) {
            throw new InvalidGrantError(
                "Authorization code has already been used"
            );
        }
        return claims;
    }

    async challengeForAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string
    ): Promise<string> {
        return this.readCode(client, authorizationCode).cc;
    }

    async exchangeAuthorizationCode(
        client: OAuthClientInformationFull,
        authorizationCode: string,
        _codeVerifier?: string,
        redirectUri?: string,
        resource?: URL
    ): Promise<OAuthTokens> {
        const claims = this.readCode(client, authorizationCode);
        if (redirectUri !== undefined && redirectUri !== claims.ru) {
            throw new InvalidGrantError("redirect_uri does not match");
        }
        this.checkResource(resource, "token");
        this.markCodeUsed(claims.jti, claims.exp);
        return this.issueTokens(client.client_id, claims.sc);
    }

    async exchangeRefreshToken(
        client: OAuthClientInformationFull,
        refreshToken: string,
        scopes?: string[],
        resource?: URL
    ): Promise<OAuthTokens> {
        const claims = this.signer.verify<TokenClaims>("refresh", refreshToken);
        if (!claims || claims.cid !== client.client_id) {
            throw new InvalidGrantError("Invalid or expired refresh token");
        }
        if (scopes && !scopes.every((s) => claims.sc.includes(s))) {
            throw new InvalidScopeError(
                "Requested scope exceeds the original grant"
            );
        }
        this.checkResource(resource, "token");
        return this.issueTokens(client.client_id, scopes ?? claims.sc);
    }

    async verifyAccessToken(token: string): Promise<AuthInfo> {
        const resource = this.options.resourceUrl;
        const staticToken = this.options.staticBearerToken;
        if (staticToken && safeEqual(token, staticToken)) {
            return {
                token,
                clientId: "static-bearer-token",
                scopes: [MCP_SCOPE],
                // The static token does not expire; report a far-future time.
                expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
                resource
            };
        }

        const claims = this.signer.verify<TokenClaims>("access", token);
        if (!claims || typeof claims.exp !== "number") {
            throw new InvalidTokenError("Invalid or expired access token");
        }
        return {
            token,
            clientId: claims.cid,
            scopes: claims.sc,
            expiresAt: claims.exp,
            resource
        };
    }

    private issueTokens(clientId: string, scopes: string[]): OAuthTokens {
        const claims = { cid: clientId, sc: scopes };
        return {
            access_token: this.signer.sign("access", claims, ACCESS_TOKEN_TTL),
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_TTL,
            refresh_token: this.signer.sign(
                "refresh",
                claims,
                REFRESH_TOKEN_TTL
            ),
            scope: scopes.join(" ")
        };
    }

    private markCodeUsed(jti: string, exp?: number): void {
        const now = Math.floor(Date.now() / 1000);
        for (const [id, expiry] of this.usedCodes) {
            if (expiry < now) {
                this.usedCodes.delete(id);
            }
        }
        this.usedCodes.set(jti, exp ?? now + AUTH_CODE_TTL);
    }

    /** Sends an HTML page with the security headers used by the login flow. */
    respondHtml(res: Response, html: string, status = 200): void {
        res.status(status)
            .set({
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Frame-Options": "DENY",
                "Content-Security-Policy":
                    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
                "Referrer-Policy": "no-referrer"
            })
            .send(html);
    }
}
