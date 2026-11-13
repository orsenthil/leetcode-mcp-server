import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compares two strings in constant time. Both values are hashed first so that
 * inputs of different lengths can be compared without leaking the length.
 */
export function safeEqual(a: string, b: string): boolean {
    const da = createHash("sha256").update(a, "utf8").digest();
    const db = createHash("sha256").update(b, "utf8").digest();
    return timingSafeEqual(da, db);
}

/**
 * Kinds of signed values this server issues. The kind is covered by the
 * signature, so a value issued as one kind can never be accepted as another
 * (for example, a refresh token used as an access token).
 */
export type SignedKind = "access" | "refresh" | "code" | "pending" | "client";

/**
 * Issues and verifies compact HMAC-SHA256 signed values of the form
 * `<base64url(json)>.<base64url(signature)>`.
 *
 * Every OAuth artifact (client IDs from dynamic registration, authorization
 * codes, access and refresh tokens) is self-contained and signed, so the server
 * keeps no state and survives restarts. Rotating the signing key invalidates
 * everything issued with the old key.
 */
export class Signer {
    private readonly key: Buffer;

    constructor(secret: string) {
        if (secret.length < 32) {
            throw new Error("The signing key must be at least 32 characters");
        }
        this.key = createHash("sha256").update(secret, "utf8").digest();
    }

    private mac(kind: SignedKind, body: string): string {
        return createHmac("sha256", this.key)
            .update(`${kind}.${body}`)
            .digest("base64url");
    }

    /**
     * Derives a stable secret value from the signing key (used for the client
     * secret of dynamically registered clients).
     */
    derive(label: string): string {
        return createHmac("sha256", this.key)
            .update(`derive.${label}`)
            .digest("base64url");
    }

    /**
     * Signs `payload` as `kind`, expiring `ttlSeconds` from now (0 = never).
     */
    sign(
        kind: SignedKind,
        payload: Record<string, unknown>,
        ttlSeconds: number
    ): string {
        const now = Math.floor(Date.now() / 1000);
        const claims = {
            ...payload,
            iat: now,
            ...(ttlSeconds > 0 ? { exp: now + ttlSeconds } : {})
        };
        const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
        return `${body}.${this.mac(kind, body)}`;
    }

    /**
     * Verifies a value signed as `kind` and returns its claims, or `undefined`
     * if the signature is wrong, the value is malformed, or it has expired.
     */
    verify<T extends Record<string, unknown>>(
        kind: SignedKind,
        value: string
    ): (T & { iat: number; exp?: number }) | undefined {
        const parts = value.split(".");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            return undefined;
        }
        const [body, signature] = parts;
        if (!safeEqual(signature, this.mac(kind, body))) {
            return undefined;
        }
        let claims: T & { iat: number; exp?: number };
        try {
            claims = JSON.parse(
                Buffer.from(body, "base64url").toString("utf8")
            );
        } catch {
            return undefined;
        }
        if (typeof claims !== "object" || claims === null) {
            return undefined;
        }
        if (
            typeof claims.exp === "number" &&
            claims.exp < Math.floor(Date.now() / 1000)
        ) {
            return undefined;
        }
        return claims;
    }
}
