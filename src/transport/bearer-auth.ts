import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type NextFunction = (err?: unknown) => void;

/**
 * Hashes a value to a fixed-length digest so tokens of different lengths can
 * be compared with `timingSafeEqual` without leaking the expected length.
 */
function digest(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Extracts the token from an `Authorization: Bearer <token>` header.
 *
 * @returns The token, or `undefined` when the header is missing or malformed.
 */
export function extractBearerToken(
    header: string | string[] | undefined
): string | undefined {
    if (typeof header !== "string") {
        return undefined;
    }
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match ? match[1].trim() : undefined;
}

/**
 * Creates an Express-compatible middleware that rejects requests whose
 * `Authorization` header does not carry the expected bearer token.
 *
 * @param expectedToken - The shared secret clients must present.
 */
export function createBearerAuthMiddleware(expectedToken: string) {
    if (!expectedToken) {
        throw new Error("Bearer auth requires a non-empty token");
    }
    const expectedDigest = digest(expectedToken);

    return (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        const token = extractBearerToken(req.headers.authorization);

        if (token && timingSafeEqual(digest(token), expectedDigest)) {
            next();
            return;
        }

        res.statusCode = 401;
        res.setHeader(
            "WWW-Authenticate",
            token
                ? 'Bearer error="invalid_token"'
                : 'Bearer realm="leetcode-mcp-server"'
        );
        res.setHeader("Content-Type", "application/json");
        res.end(
            JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32001, message: "Unauthorized" },
                id: null
            })
        );
    };
}
