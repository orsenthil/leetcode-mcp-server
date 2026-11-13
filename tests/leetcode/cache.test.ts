import { afterEach, describe, expect, it, vi } from "vitest";
import { TtlCache, withCache } from "../../src/leetcode/cache.js";
import type { LeetCodeBaseService } from "../../src/leetcode/leetcode-base-service.js";

afterEach(() => {
    vi.useRealTimers();
});

describe("TtlCache", () => {
    it("expires entries after their TTL", () => {
        vi.useFakeTimers();
        const cache = new TtlCache<string>();
        cache.set("a", "1", 1000);
        expect(cache.get("a")).toBe("1");
        vi.advanceTimersByTime(1001);
        expect(cache.get("a")).toBeUndefined();
    });

    it("evicts the least recently used entry when full", () => {
        const cache = new TtlCache<number>(2);
        cache.set("a", 1, 10_000);
        cache.set("b", 2, 10_000);
        cache.get("a"); // a is now most recent
        cache.set("c", 3, 10_000);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("a")).toBe(1);
        expect(cache.get("c")).toBe(3);
    });

    it("shares one load between concurrent callers", async () => {
        const cache = new TtlCache<string>();
        const load = vi.fn(async () => "value");
        const [a, b] = await Promise.all([
            cache.getOrLoad("k", 1000, load),
            cache.getOrLoad("k", 1000, load)
        ]);
        expect(a).toBe("value");
        expect(b).toBe("value");
        expect(load).toHaveBeenCalledTimes(1);
    });

    it("does not cache failures or empty results", async () => {
        const cache = new TtlCache<string | null>();
        await expect(
            cache.getOrLoad("k", 1000, async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
        await cache.getOrLoad("k", 1000, async () => null);
        const load = vi.fn(async () => "ok");
        await cache.getOrLoad("k", 1000, load);
        expect(load).toHaveBeenCalledTimes(1);
    });
});

function fakeService() {
    return {
        fetchProblem: vi.fn(async (slug: string) => ({
            slug,
            n: Math.random()
        })),
        fetchProblemSimplified: vi.fn(async (slug: string) => ({ slug })),
        fetchUserStatus: vi.fn(async () => ({ isSignedIn: true })),
        updateProblemNote: vi.fn(async () => undefined),
        submitSolution: vi.fn(async () => ({ check: {} })),
        isCN: () => false
    };
}

describe("withCache", () => {
    it("caches problem lookups per slug", async () => {
        const raw = fakeService();
        const service = withCache(raw as unknown as LeetCodeBaseService, {
            ttlMs: 60_000
        });
        const first = await service.fetchProblem("two-sum");
        const second = await service.fetchProblem("two-sum");
        await service.fetchProblem("3sum");
        expect(second).toBe(first);
        expect(raw.fetchProblem).toHaveBeenCalledTimes(2);
    });

    it("does not cache user-specific calls", async () => {
        const raw = fakeService();
        const service = withCache(raw as unknown as LeetCodeBaseService, {
            ttlMs: 60_000
        });
        await service.fetchUserStatus();
        await service.fetchUserStatus();
        expect(raw.fetchUserStatus).toHaveBeenCalledTimes(2);
        expect(service.isCN()).toBe(false);
    });

    it("drops a problem's entries after its note is updated or a submission", async () => {
        const raw = fakeService();
        const service = withCache(raw as unknown as LeetCodeBaseService, {
            ttlMs: 60_000
        });
        await service.fetchProblem("two-sum");
        await service.fetchProblemSimplified("two-sum");
        await service.updateProblemNote("two-sum", "note");
        await service.fetchProblem("two-sum");
        await service.fetchProblemSimplified("two-sum");
        expect(raw.fetchProblem).toHaveBeenCalledTimes(2);
        expect(raw.fetchProblemSimplified).toHaveBeenCalledTimes(2);

        await service.submitSolution({ titleSlug: "two-sum" } as any);
        await service.fetchProblem("two-sum");
        expect(raw.fetchProblem).toHaveBeenCalledTimes(3);
    });

    it("returns the service unchanged when the TTL is 0", () => {
        const raw = fakeService() as unknown as LeetCodeBaseService;
        expect(withCache(raw, { ttlMs: 0 })).toBe(raw);
    });
});
