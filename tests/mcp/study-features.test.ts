import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import type { LeetCodeBaseService } from "../../src/leetcode/leetcode-base-service.js";
import {
    normalizeDifficulty,
    normalizeTopic,
    registerStudyPrompts
} from "../../src/mcp/prompts/study-prompts.js";
import { NoteToolRegistry } from "../../src/mcp/tools/note-tools.js";
import { SubmissionToolRegistry } from "../../src/mcp/tools/submission-tools.js";
import { UserToolRegistry } from "../../src/mcp/tools/user-tools.js";
import { htmlToText } from "../../src/utils/html-to-text.js";

const PROBLEM = {
    questionId: "1",
    title: "Two Sum",
    titleSlug: "two-sum",
    difficulty: "Easy",
    content:
        "<p>Given an array <code>nums</code>, return indices.</p><ul><li>2 &lt;= n &lt;= 10<sup>4</sup></li></ul>",
    exampleTestcases: "[2,7,11,15]\n9\n[3,2,4]\n6",
    hints: ["Use a <b>hash map</b>.", "Check the complement."],
    topicTags: ["array", "hash-table"]
};

function makeService(overrides: Record<string, unknown> = {}) {
    return {
        isCN: () => false,
        isAuthenticated: () => true,
        fetchDailyChallenge: vi.fn(async () => ({
            date: "2026-11-13",
            question: {
                ...PROBLEM,
                topicTags: [{ slug: "array" }, { slug: "hash-table" }]
            }
        })),
        fetchProblemSimplified: vi.fn(async () => PROBLEM),
        fetchProblemNote: vi.fn(async () => null),
        fetchProblemNotes: vi.fn(async (slugs: string[]) =>
            Object.fromEntries(
                slugs.map((s) => [
                    s,
                    s === "two-sum" ? "hash map complement" : null
                ])
            )
        ),
        updateProblemNote: vi.fn(async () => undefined),
        fetchUserAllSubmissions: vi.fn(async () => ({
            submissions: [
                {
                    id: 11,
                    statusDisplay: "Wrong Answer",
                    timestamp: 100,
                    lang: "python3"
                },
                {
                    id: 12,
                    statusDisplay: "Accepted",
                    timestamp: 200,
                    lang: "python3",
                    runtime: "50 ms"
                }
            ]
        })),
        fetchUserSubmissionDetail: vi.fn(async () => ({
            code: "class Solution:\n    pass",
            lang: { name: "python3" },
            runtimeDisplay: "50 ms",
            runtimePercentile: 91.234
        })),
        fetchUserProgressQuestionList: vi.fn(async ({ questionStatus }: any) =>
            questionStatus === "SOLVED"
                ? {
                      totalNum: 2,
                      questions: [
                          {
                              titleSlug: "two-sum",
                              title: "Two Sum",
                              difficulty: "Easy",
                              topicTags: [{ slug: "hash-table" }],
                              lastSubmittedAt: "2026-11-10"
                          },
                          {
                              titleSlug: "3sum",
                              title: "3Sum",
                              difficulty: "Medium",
                              topicTags: [],
                              lastSubmittedAt: "2026-11-11"
                          }
                      ]
                  }
                : { totalNum: 0, questions: [] }
        ),
        pickRandomProblem: vi.fn(async () => ({
            titleSlug: "two-sum",
            title: "Two Sum",
            difficulty: "Easy",
            topicTags: ["array"],
            unsolvedOnly: true
        })),
        runCode: vi.fn(async () => ({
            start: {},
            checkUrl: "u",
            check: {
                status_msg: "Accepted",
                correct_answer: false,
                compare_result: "10",
                code_answer: ["[0,1]", "[0,0]"],
                expected_code_answer: ["[0,1]", "[1,2]"]
            }
        })),
        submitSolution: vi.fn(async () => ({
            start: {},
            checkUrl: "u",
            check: { status_msg: "Accepted" }
        })),
        inspectSession: vi.fn(() => ({
            expiresAt: new Date("2026-11-20T00:00:00Z"),
            daysLeft: 5,
            expired: false,
            source: "expired_time_"
        })),
        fetchUserStatus: vi.fn(async () => ({
            isSignedIn: true,
            username: "me"
        })),
        ...overrides
    } as unknown as LeetCodeBaseService & Record<string, any>;
}

async function withClient<T>(
    service: LeetCodeBaseService,
    run: (client: Client) => Promise<T>
): Promise<T> {
    const server = new McpServer({ name: "t", version: "1" });
    registerStudyPrompts(server, service);
    new NoteToolRegistry(server, service).registerTools();
    new SubmissionToolRegistry(server, service).registerTools();
    new UserToolRegistry(server, service).registerTools();
    const client = new Client({ name: "c", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
        return await run(client);
    } finally {
        await client.close();
        await server.close();
    }
}

const textOf = (result: any) =>
    result.messages?.[0]?.content?.text ?? JSON.parse(result.content[0].text);

describe("study prompts", () => {
    it("lists daily, mock-interview and review when authenticated", async () => {
        const names = await withClient(makeService(), async (c) =>
            (await c.listPrompts()).prompts.map((p) => p.name).sort()
        );
        expect(names).toEqual(["daily", "mock-interview", "review"]);
    });

    it("hides review without a session", async () => {
        const names = await withClient(
            makeService({ isAuthenticated: () => false }),
            async (c) => (await c.listPrompts()).prompts.map((p) => p.name)
        );
        expect(names).not.toContain("review");
    });

    it("daily embeds the problem and keeps hints and tags for the coach", async () => {
        const text = await withClient(makeService(), async (c) =>
            textOf(await c.getPrompt({ name: "daily" }))
        );
        expect(text).toContain("Two Sum (Easy)");
        expect(text).toContain("2 <= n <= 10^4");
        expect(text).toMatch(/Never show a full solution/);
        expect(text).toContain("1. Use a hash map.");
        expect(text).toContain("Topic tags: array, hash-table");
    });

    it("daily falls back to the tool when LeetCode is unreachable", async () => {
        const service = makeService({
            fetchDailyChallenge: vi.fn(async () => {
                throw new Error("down");
            })
        });
        const text = await withClient(service, async (c) =>
            textOf(await c.getPrompt({ name: "daily" }))
        );
        expect(text).toContain("call get_daily_challenge");
    });

    it("review uses the latest accepted submission with line numbers", async () => {
        const service = makeService();
        const text = await withClient(service, async (c) =>
            textOf(
                await c.getPrompt({
                    name: "review",
                    arguments: { slug: "two-sum" }
                })
            )
        );
        expect(service.fetchUserSubmissionDetail).toHaveBeenCalledWith(12);
        expect(text).toContain("accepted with runtime 50 ms (beats 91.2%)");
        expect(text).toContain("1 | class Solution:");
        expect(text).toMatch(/Complexity/);
    });

    it("mock-interview time-boxes by difficulty and normalizes the topic", async () => {
        const service = makeService();
        const text = await withClient(service, async (c) =>
            textOf(
                await c.getPrompt({
                    name: "mock-interview",
                    arguments: { difficulty: "Hard", topic: "dp" }
                })
            )
        );
        expect(service.pickRandomProblem).toHaveBeenCalledWith({
            difficulty: "HARD",
            tag: "dynamic-programming"
        });
        expect(text).toContain("50-minute");
        expect(text).toMatch(/get_elapsed_time with startedAt '\d{4}-/);
        expect(text).toContain("haven't attempted");
        expect(text).toMatch(/scorecard/);
    });

    it("completes difficulty and topic arguments", async () => {
        const values = await withClient(makeService(), async (c) => {
            const d = await c.complete({
                ref: { type: "ref/prompt", name: "mock-interview" },
                argument: { name: "difficulty", value: "m" }
            });
            const t = await c.complete({
                ref: { type: "ref/prompt", name: "mock-interview" },
                argument: { name: "topic", value: "sli" }
            });
            return [d.completion.values, t.completion.values];
        });
        expect(values).toEqual([["medium"], ["sliding-window"]]);
    });

    it("normalizes arguments", () => {
        expect(normalizeTopic("Dynamic Programming")).toBe(
            "dynamic-programming"
        );
        expect(normalizeTopic("BFS")).toBe("breadth-first-search");
        expect(normalizeTopic("any")).toBeUndefined();
        expect(normalizeDifficulty("Medium")).toBe("MEDIUM");
        expect(() => normalizeDifficulty("impossible")).toThrow();
    });
});

describe("problem note tools", () => {
    it("save_problem_note appends a dated entry with attempt history", async () => {
        const service = makeService({
            fetchProblemNote: vi.fn(async () => "earlier note")
        });
        const result = await withClient(service, async (c) =>
            textOf(
                await c.callTool({
                    name: "save_problem_note",
                    arguments: {
                        titleSlug: "two-sum",
                        approach: "hash map",
                        complexity: "O(n)",
                        trick: "complement",
                        mistakes: "self-match"
                    }
                })
            )
        );
        expect(result.saved).toBe(true);
        const [slug, content] = service.updateProblemNote.mock.calls[0];
        expect(slug).toBe("two-sum");
        expect(content).toMatch(
            /^earlier note\n\n=== \d{4}-\d{2}-\d{2} · python3 · Easy ===/
        );
        expect(content).toContain(
            "Attempts: 1 failed before AC (Wrong Answer); AC 50 ms"
        );
        expect(content).toContain("Tags: array, hash-table");
    });

    it("search_problem_notes scans solved problems and filters", async () => {
        const result = await withClient(makeService(), async (c) =>
            textOf(
                await c.callTool({
                    name: "search_problem_notes",
                    arguments: { query: "complement" }
                })
            )
        );
        expect(result.scannedProblems).toBe(2);
        expect(result.problemsWithNotes).toBe(1);
        expect(result.results.map((r: any) => r.titleSlug)).toEqual([
            "two-sum"
        ]);
    });

    it("note tools are not registered on CN", async () => {
        const tools = await withClient(
            makeService({ isCN: () => true }),
            async (c) => (await c.listTools()).tools.map((t) => t.name)
        );
        expect(tools).not.toContain("save_problem_note");
    });
});

describe("submission tools", () => {
    it("run_code attaches a diagnosis for wrong outputs", async () => {
        const result = await withClient(makeService(), async (c) =>
            textOf(
                await c.callTool({
                    name: "run_code",
                    arguments: {
                        titleSlug: "two-sum",
                        lang: "python3",
                        typedCode: "x = 1"
                    }
                })
            )
        );
        expect(result.diagnosis.verdict).toBe("Wrong Answer");
        expect(result.diagnosis.failingCase).toMatchObject({
            caseNumber: 2,
            input: "[3,2,4]\n6",
            expected: "[1,2]",
            actual: "[0,0]"
        });
    });

    it("submit_solution suggests a note on Accepted", async () => {
        const result = await withClient(makeService(), async (c) =>
            textOf(
                await c.callTool({
                    name: "submit_solution",
                    arguments: {
                        titleSlug: "two-sum",
                        lang: "python3",
                        typedCode: "x = 1"
                    }
                })
            )
        );
        expect(result.diagnosis).toBeUndefined();
        expect(result.nextStep).toContain("save_problem_note");
    });
});

describe("utility tools", () => {
    it("get_session_status reports expiry and warns when close", async () => {
        const result = await withClient(makeService(), async (c) =>
            textOf(
                await c.callTool({ name: "get_session_status", arguments: {} })
            )
        );
        expect(result).toMatchObject({
            configured: true,
            signedIn: true,
            username: "me",
            daysLeft: 5
        });
        expect(result.advice).toMatch(/expires in 5 day/);
    });

    it("get_session_status flags a rejected session", async () => {
        const service = makeService({
            fetchUserStatus: vi.fn(async () => ({ isSignedIn: false }))
        });
        const result = await withClient(service, async (c) =>
            textOf(
                await c.callTool({ name: "get_session_status", arguments: {} })
            )
        );
        expect(result.advice).toMatch(/no longer works/);
    });

    it("get_elapsed_time measures from a start time", async () => {
        const start = new Date(Date.now() - 90_000).toISOString();
        const result = await withClient(makeService(), async (c) =>
            textOf(
                await c.callTool({
                    name: "get_elapsed_time",
                    arguments: { startedAt: start }
                })
            )
        );
        expect(result.elapsedMinutes).toBeCloseTo(1.5, 0);
    });
});

describe("htmlToText", () => {
    it("keeps structure and decodes entities once", () => {
        expect(htmlToText(PROBLEM.content)).toBe(
            "Given an array nums, return indices.\n\n- 2 <= n <= 10^4"
        );
        expect(htmlToText("a &amp;lt; b")).toBe("a &lt; b");
    });
});
