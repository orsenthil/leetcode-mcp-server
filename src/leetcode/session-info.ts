export interface SessionInfo {
    /** When the cookie stops working, if it could be determined. */
    expiresAt?: Date;
    /** Whole days until expiry (negative once expired). */
    daysLeft?: number;
    expired?: boolean;
    /** Which claim the expiry was read from. */
    source?: string;
    /** Claim names in the cookie (names only, never values), for debugging. */
    claimNames?: string[];
    /** Why the expiry is unknown, when it is. */
    reason?: string;
}

/** Extracts the LEETCODE_SESSION value from a bare value or a cookie string. */
export function extractSessionValue(cookie: string): string {
    const match = /(?:^|;\s*)LEETCODE_SESSION=([^;]+)/.exec(cookie);
    return (match ? match[1] : cookie).trim();
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
    const parts = token.split(".");
    if (parts.length !== 3) {
        return undefined;
    }
    try {
        const json = Buffer.from(parts[1], "base64url").toString("utf8");
        const payload = JSON.parse(json);
        return typeof payload === "object" && payload !== null
            ? payload
            : undefined;
    } catch {
        return undefined;
    }
}

function toSeconds(value: unknown): number | undefined {
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
        return undefined;
    }
    // Treat values that look like milliseconds as milliseconds.
    return n > 1e12 ? Math.floor(n / 1000) : n;
}

/**
 * Works out when a LeetCode session cookie expires by decoding its JWT payload
 * (without verifying it; this is informational only). Several claim shapes are
 * recognised: `expired_time_`, the standard `exp`, and
 * `refreshed_at` + `_session_expiry`.
 */
export function inspectSessionCookie(
    cookie: string,
    now: Date = new Date()
): SessionInfo {
    const payload = decodeJwtPayload(extractSessionValue(cookie));
    if (!payload) {
        return { reason: "LEETCODE_SESSION is not a JWT; expiry unknown" };
    }

    let expiry: number | undefined;
    let source: string | undefined;

    const candidates: Array<[string, unknown]> = [
        ["expired_time_", payload.expired_time_],
        ["exp", payload.exp]
    ];
    for (const [name, value] of candidates) {
        expiry = toSeconds(value);
        if (expiry) {
            source = name;
            break;
        }
    }
    if (!expiry) {
        const refreshed = toSeconds(payload.refreshed_at);
        const lifetime = toSeconds(payload._session_expiry);
        if (refreshed && lifetime) {
            expiry = refreshed + lifetime;
            source = "refreshed_at + _session_expiry";
        }
    }

    const claimNames = Object.keys(payload).sort();
    if (!expiry) {
        return {
            claimNames,
            reason: "No expiry claim found in LEETCODE_SESSION"
        };
    }

    const expiresAt = new Date(expiry * 1000);
    const msLeft = expiresAt.getTime() - now.getTime();
    return {
        expiresAt,
        daysLeft: Math.floor(msLeft / 86_400_000),
        expired: msLeft <= 0,
        source,
        claimNames
    };
}
