import { describe, expect, it } from "vitest";
import {
    extractSessionValue,
    inspectSessionCookie
} from "../../src/leetcode/session-info.js";

const NOW = new Date("2026-11-13T00:00:00Z");
const nowSeconds = NOW.getTime() / 1000;

function jwt(payload: Record<string, unknown>): string {
    const part = (v: unknown) =>
        Buffer.from(JSON.stringify(v)).toString("base64url");
    return `${part({ alg: "HS256", typ: "JWT" })}.${part(payload)}.signature`;
}

describe("inspectSessionCookie", () => {
    it("reads expired_time_", () => {
        const info = inspectSessionCookie(
            jwt({ expired_time_: nowSeconds + 10 * 86400, username: "x" }),
            NOW
        );
        expect(info.daysLeft).toBe(10);
        expect(info.expired).toBe(false);
        expect(info.source).toBe("expired_time_");
        expect(info.claimNames).toEqual(["expired_time_", "username"]);
    });

    it("reads the standard exp claim, including millisecond values", () => {
        const info = inspectSessionCookie(
            jwt({ exp: (nowSeconds + 3 * 86400) * 1000 }),
            NOW
        );
        expect(info.daysLeft).toBe(3);
        expect(info.source).toBe("exp");
    });

    it("derives expiry from refreshed_at + _session_expiry", () => {
        const info = inspectSessionCookie(
            jwt({ refreshed_at: nowSeconds - 86400, _session_expiry: 1209600 }),
            NOW
        );
        expect(info.daysLeft).toBe(13);
        expect(info.source).toBe("refreshed_at + _session_expiry");
    });

    it("reports an expired cookie", () => {
        const info = inspectSessionCookie(
            jwt({ expired_time_: nowSeconds - 60 }),
            NOW
        );
        expect(info.expired).toBe(true);
        expect(info.daysLeft).toBeLessThan(0);
    });

    it("accepts a full cookie string", () => {
        const cookie = `csrftoken=abc; LEETCODE_SESSION=${jwt({ exp: nowSeconds + 86400 })}; other=1`;
        expect(inspectSessionCookie(cookie, NOW).daysLeft).toBe(1);
        expect(extractSessionValue("plainvalue")).toBe("plainvalue");
    });

    it("explains when the expiry is unknown, without leaking values", () => {
        expect(inspectSessionCookie("not-a-jwt", NOW).reason).toMatch(
            /not a JWT/
        );
        const info = inspectSessionCookie(jwt({ secret: "s3cr3t" }), NOW);
        expect(info.expiresAt).toBeUndefined();
        expect(JSON.stringify(info)).not.toContain("s3cr3t");
    });
});
