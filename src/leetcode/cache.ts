import logger from "../utils/logger.js";
import { LeetCodeBaseService } from "./leetcode-base-service.js";

type Entry<V> = { value: V; expiresAt: number };

/**
 * A small in-memory cache with per-entry TTL, a size bound (oldest entries are
 * evicted first) and de-duplication of concurrent loads for the same key.
 * Failed loads and empty results are never cached.
 */
export class TtlCache<V = unknown> {
    private readonly entries = new Map<string, Entry<V>>();
    private readonly inflight = new Map<string, Promise<V>>();

    constructor(private readonly maxEntries = 500) {}

    get size(): number {
        return this.entries.size;
    }

    get(key: string): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) {
            return undefined;
        }
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return undefined;
        }
        // Re-insert so the Map's insertion order tracks recent use.
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    set(key: string, value: V, ttlMs: number): void {
        if (ttlMs <= 0) {
            return;
        }
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value as string;
            this.entries.delete(oldest);
        }
    }

    /** Removes every key that starts with `prefix`. */
    deletePrefix(prefix: string): void {
        for (const key of [...this.entries.keys()]) {
            if (key.startsWith(prefix)) {
                this.entries.delete(key);
            }
        }
    }

    async getOrLoad(
        key: string,
        ttlMs: number,
        load: () => Promise<V>
    ): Promise<V> {
        const cached = this.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const pending = this.inflight.get(key);
        if (pending) {
            return pending;
        }
        const promise = (async () => {
            try {
                const value = await load();
                if (value !== undefined && value !== null) {
                    this.set(key, value, ttlMs);
                }
                return value;
            } finally {
                this.inflight.delete(key);
            }
        })();
        this.inflight.set(key, promise);
        return promise;
    }
}

export interface CacheOptions {
    /** TTL for problems and solution articles. 0 disables caching. */
    ttlMs: number;
    /** TTL for the daily challenge, which changes once a day. */
    dailyTtlMs?: number;
    maxEntries?: number;
}

/** Methods whose results are cached, with their cache key and TTL. */
type CachePolicy = {
    key: (args: unknown[]) => string;
    ttl: (options: CacheOptions) => number;
};

const SOLUTION_LIST_MAX_TTL_MS = 60 * 60 * 1000;

const POLICIES: Record<string, CachePolicy> = {
    fetchProblem: {
        key: ([slug]) => `problem:${slug}:full`,
        ttl: (o) => o.ttlMs
    },
    fetchProblemSimplified: {
        key: ([slug]) => `problem:${slug}:simple`,
        ttl: (o) => o.ttlMs
    },
    fetchQuestionSolutionArticles: {
        key: (args) => `solutions:${JSON.stringify(args)}`,
        // Lists gain new articles over time, so keep them fresher.
        ttl: (o) => Math.min(o.ttlMs, SOLUTION_LIST_MAX_TTL_MS)
    },
    fetchSolutionArticleDetail: {
        key: ([id]) => `solution:${id}`,
        ttl: (o) => o.ttlMs
    },
    fetchDailyChallenge: {
        key: () => "daily",
        ttl: (o) => (o.ttlMs > 0 ? (o.dailyTtlMs ?? 15 * 60 * 1000) : 0)
    }
};

/**
 * Methods that change a problem's user-specific fields (note, solved status),
 * mapped to the argument that holds the problem slug. Calling one of them
 * drops that problem's cached entries.
 */
const INVALIDATES_PROBLEM: Record<string, (args: unknown[]) => unknown> = {
    updateProblemNote: ([slug]) => slug,
    submitSolution: ([params]) => (params as { titleSlug?: string })?.titleSlug
};

/**
 * Wraps a LeetCode service so problem and solution lookups are served from an
 * in-memory TTL cache. All other calls pass straight through.
 */
export function withCache(
    service: LeetCodeBaseService,
    options: CacheOptions
): LeetCodeBaseService {
    if (options.ttlMs <= 0) {
        return service;
    }
    const cache = new TtlCache(options.maxEntries ?? 500);

    return new Proxy(service, {
        get(target, prop, receiver) {
            const original = Reflect.get(target, prop, receiver);
            if (typeof prop !== "string" || typeof original !== "function") {
                return original;
            }

            const policy = POLICIES[prop];
            if (policy) {
                return (...args: unknown[]) =>
                    cache.getOrLoad(policy.key(args), policy.ttl(options), () =>
                        original.apply(target, args)
                    );
            }

            const slugOf = INVALIDATES_PROBLEM[prop];
            if (slugOf) {
                return async (...args: unknown[]) => {
                    try {
                        return await original.apply(target, args);
                    } finally {
                        const slug = slugOf(args);
                        if (typeof slug === "string") {
                            cache.deletePrefix(`problem:${slug}:`);
                            logger.debug("Cache invalidated for %s", slug);
                        }
                    }
                };
            }

            return original.bind(target);
        }
    });
}
