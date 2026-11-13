import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
    createBearerAuthMiddleware,
    extractBearerToken
} from "../../src/transport/bearer-auth.js";

function run(authorization?: string) {
    const middleware = createBearerAuthMiddleware("s3cret-token");
    const req = { headers: { authorization } } as IncomingMessage;
    const headers: Record<string, string> = {};
    const res = {
        statusCode: 200,
        setHeader: (k: string, v: string) => {
            headers[k] = v;
        },
        end: vi.fn()
    } as unknown as ServerResponse;
    const next = vi.fn();
    middleware(req, res, next);
    return { res, headers, next };
}

describe("extractBearerToken", () => {
    it("parses Bearer headers case-insensitively", () => {
        expect(extractBearerToken("Bearer abc")).toBe("abc");
        expect(extractBearerToken("bearer   abc ")).toBe("abc");
    });

    it("rejects missing or non-bearer headers", () => {
        expect(extractBearerToken(undefined)).toBeUndefined();
        expect(extractBearerToken("Basic abc")).toBeUndefined();
        expect(extractBearerToken("Bearer")).toBeUndefined();
    });
});

describe("createBearerAuthMiddleware", () => {
    it("calls next for the correct token", () => {
        const { next, res } = run("Bearer s3cret-token");
        expect(next).toHaveBeenCalledOnce();
        expect(res.statusCode).toBe(200);
    });

    it("returns 401 when the header is missing", () => {
        const { next, res, headers } = run();
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(headers["WWW-Authenticate"]).toContain("Bearer");
    });

    it("returns 401 for a wrong token, including prefixes", () => {
        for (const value of ["Bearer wrong", "Bearer s3cret", "s3cret-token"]) {
            const { next, res } = run(value);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(401);
        }
    });

    it("refuses to be created with an empty token", () => {
        expect(() => createBearerAuthMiddleware("")).toThrow();
    });
});
