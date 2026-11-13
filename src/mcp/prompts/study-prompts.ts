import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LeetCodeBaseService } from "../../leetcode/leetcode-base-service.js";
import { htmlToText } from "../../utils/html-to-text.js";
import logger from "../../utils/logger.js";
import { numberLines } from "../tools/submission-diagnosis.js";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

/** Common LeetCode topic tag slugs, used for argument completion. */
export const TOPICS = [
    "array",
    "string",
    "hash-table",
    "dynamic-programming",
    "math",
    "sorting",
    "greedy",
    "depth-first-search",
    "breadth-first-search",
    "binary-search",
    "tree",
    "binary-tree",
    "binary-search-tree",
    "matrix",
    "two-pointers",
    "sliding-window",
    "prefix-sum",
    "bit-manipulation",
    "heap-priority-queue",
    "stack",
    "monotonic-stack",
    "queue",
    "graph",
    "topological-sort",
    "shortest-path",
    "union-find",
    "trie",
    "backtracking",
    "linked-list",
    "recursion",
    "divide-and-conquer",
    "memoization",
    "design",
    "simulation",
    "counting",
    "ordered-set",
    "segment-tree",
    "binary-indexed-tree",
    "bitmask",
    "interactive",
    "game-theory",
    "geometry"
];

const TOPIC_ALIASES: Record<string, string> = {
    dp: "dynamic-programming",
    dfs: "depth-first-search",
    bfs: "breadth-first-search",
    heap: "heap-priority-queue",
    "priority-queue": "heap-priority-queue",
    pq: "heap-priority-queue",
    bst: "binary-search-tree",
    "hash-map": "hash-table",
    hashmap: "hash-table",
    "two-pointer": "two-pointers",
    dsu: "union-find",
    "linked-lists": "linked-list",
    graphs: "graph",
    trees: "tree",
    strings: "string",
    arrays: "array"
};

/** Turns "Dynamic Programming", "dp" or "dynamic_programming" into a tag slug. */
export function normalizeTopic(topic?: string): string | undefined {
    const slug = topic
        ?.trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");
    if (!slug || slug === "any") {
        return undefined;
    }
    return TOPIC_ALIASES[slug] ?? slug;
}

export function normalizeDifficulty(value?: string): string | undefined {
    const d = value?.trim().toLowerCase();
    if (!d || d === "any") {
        return undefined;
    }
    if (!(DIFFICULTIES as readonly string[]).includes(d)) {
        throw new Error(
            `Difficulty must be easy, medium or hard (got '${value}')`
        );
    }
    return d.toUpperCase();
}

const INTERVIEW_MINUTES: Record<string, number> = {
    EASY: 25,
    MEDIUM: 40,
    HARD: 50
};

function prefixMatches(options: readonly string[], value: string): string[] {
    const v = value.toLowerCase();
    return options.filter((o) => o.startsWith(v)).slice(0, 20);
}

/**
 * An optional, auto-completing string argument. The SDK checks for a completer
 * on the inner schema when registering a prompt but on the outer schema when
 * answering completion requests, so both carry it.
 */
function optionalCompletable(
    description: string,
    complete: (value: string) => string[]
) {
    const callback = (value: string | undefined) => complete(value ?? "");
    return completable(
        completable(z.string(), callback).optional().describe(description),
        callback
    );
}

function userMessage(text: string): GetPromptResult {
    return { messages: [{ role: "user", content: { type: "text", text } }] };
}

function formatProblem(q: any): string {
    const statement = htmlToText(q?.content);
    const examples = q?.exampleTestcases
        ? `\n\nExample test input (one parameter per line):\n${q.exampleTestcases}`
        : "";
    return `Title: ${q?.title} (${q?.difficulty})\nSlug: ${q?.titleSlug}\n\n${statement}${examples}`;
}

/**
 * Builds the /daily prompt: today's problem plus Socratic coaching rules.
 * Hints are included for the model but must be revealed one at a time.
 */
export async function buildDailyPrompt(
    service: LeetCodeBaseService
): Promise<GetPromptResult> {
    const rules = `You are my LeetCode coach for today's daily problem. Coach me Socratically:
- Briefly restate the problem in plain words, then ask how I'd approach it. Do not suggest an approach yourself.
- When I propose an idea, respond with questions about correctness, edge cases and complexity rather than confirming or correcting it outright.
- Give hints only when I ask or am clearly stuck, smallest first, one at a time. Use the official hints below in order before inventing your own.
- Do not reveal the topic tags; they give the approach away. Share them only if I ask.
- Never show a full solution or complete code unless I explicitly ask for the solution.
- I can test code with run_code and submit with submit_solution. If a run fails, use its diagnosis to help me find MY bug instead of rewriting my code.
- After an Accepted submission, offer to save a short note on what I learned.`;

    try {
        const daily = await service.fetchDailyChallenge();
        const q = daily?.question ?? daily;
        const hints: string[] = (q?.hints ?? []).map((h: string) =>
            htmlToText(h)
        );
        const tags = (q?.topicTags ?? [])
            .map((t: any) => t?.slug ?? t)
            .join(", ");
        const hintBlock = hints.length
            ? hints.map((h, i) => `${i + 1}. ${h}`).join("\n")
            : "(none; write your own small hints if I need them)";
        return userMessage(`${rules}

=== Today's problem${daily?.date ? ` (${daily.date})` : ""} ===
${formatProblem(q)}

=== For the coach only (do not show unless asked) ===
Topic tags: ${tags || "(none)"}
Official hints, to reveal one at a time:
${hintBlock}`);
    } catch (error: any) {
        logger.warn(
            "daily prompt: could not fetch the daily problem: %s",
            error?.message
        );
        return userMessage(`${rules}

First call get_daily_challenge to fetch today's problem, then follow the rules above. Keep its topic tags and hints to yourself until I ask.`);
    }
}

/**
 * Builds the /review prompt from the user's latest accepted submission for a
 * problem (or the latest submission if none was accepted).
 */
export async function buildReviewPrompt(
    service: LeetCodeBaseService,
    slugArg: string
): Promise<GetPromptResult> {
    const slug = slugArg.trim();
    const history = await service.fetchUserAllSubmissions({
        offset: 0,
        limit: 20,
        questionSlug: slug
    });
    const submissions: any[] = [...(history?.submissions ?? [])].sort(
        (a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0)
    );
    if (!submissions.length) {
        return userMessage(
            `I asked for a review of my solution to '${slug}', but I have no submissions for it. Tell me that, and offer to start the problem with me instead (use get_problem).`
        );
    }
    const accepted = submissions.find((s) => s.statusDisplay === "Accepted");
    const chosen = accepted ?? submissions[0];
    const [detail, problem, note] = await Promise.all([
        service.fetchUserSubmissionDetail(Number(chosen.id)),
        service.fetchProblemSimplified(slug).catch(() => undefined),
        service.isCN()
            ? Promise.resolve(null)
            : service.fetchProblemNote(slug).catch(() => null)
    ]);

    const lang = detail?.lang?.name ?? detail?.lang ?? chosen.lang ?? "";
    const code: string = detail?.code ?? "";
    const perf = [
        detail?.runtimeDisplay &&
            `runtime ${detail.runtimeDisplay}${detail?.runtimePercentile ? ` (beats ${Number(detail.runtimePercentile).toFixed(1)}%)` : ""}`,
        detail?.memoryDisplay &&
            `memory ${detail.memoryDisplay}${detail?.memoryPercentile ? ` (beats ${Number(detail.memoryPercentile).toFixed(1)}%)` : ""}`
    ]
        .filter(Boolean)
        .join(", ");
    const attemptsNote = accepted
        ? `It was accepted${perf ? ` with ${perf}` : ""}.`
        : `None of my submissions were accepted; this is my latest one (${chosen.statusDisplay}).`;

    return userMessage(`Review my LeetCode solution like a senior engineer doing a code review. ${attemptsNote}

Cover, in this order:
1. Correctness and edge cases: name concrete inputs that could break it (empty, single element, duplicates, negatives, overflow, maximum constraints), even if they passed.
2. Complexity: state the time and space complexity of MY code with a one-line justification, and say whether a better bound exists (describe it in a sentence; don't write it out).
3. Style: naming, structure, idiomatic ${lang || "language"} usage, dead code, readability.
4. Finish with the top 1-3 improvements, most valuable first.

Quote line numbers when you point at code. Show small snippets for specific fixes only; do not rewrite the whole solution unless I ask.${
        note
            ? "\n\nMy existing note on this problem (check whether my code matches what I wrote):\n" +
              note
            : ""
    }

=== Problem ===
${problem ? formatProblem(problem) : slug}

=== My ${accepted ? "accepted" : "latest"} submission (${lang}) ===
${code ? numberLines(code) : "(code unavailable)"}`);
}

/**
 * Builds the /mock-interview prompt: picks an unsolved problem and sets up a
 * time-boxed interview with follow-up questions and a scorecard.
 */
export async function buildMockInterviewPrompt(
    service: LeetCodeBaseService,
    difficultyArg?: string,
    topicArg?: string
): Promise<GetPromptResult> {
    const difficulty = normalizeDifficulty(difficultyArg) ?? "MEDIUM";
    const topic = normalizeTopic(topicArg);
    const picked = await service.pickRandomProblem({ difficulty, tag: topic });
    const problem = await service.fetchProblemSimplified(picked.titleSlug);
    const minutes = INTERVIEW_MINUTES[difficulty] ?? 40;
    const startedAt = new Date().toISOString();

    return userMessage(`Run a realistic ${minutes}-minute mock coding interview with me. You are the interviewer at a top tech company; I am the candidate.

Time box: the interview started at ${startedAt} and lasts ${minutes} minutes. Call get_elapsed_time with startedAt '${startedAt}' whenever you need the time: give me a time check at the halfway point and with 5 minutes left, and wrap up when time is over even if I'm not done.

How to run it:
- Present the problem the way an interviewer would: the statement and examples below, without hints, topic tags or any approach. Ask me to clarify requirements and restate the problem before I start.
- Ask for my approach and its complexity before I write code. Push back on vague answers; ask "why does that work?" and "what's the complexity?".
- Stay in character. Don't solve it for me or fix my bugs. If I'm stuck, give one small nudge the way a real interviewer would, and note that it cost points.
- When I say I'm done coding, ask me to walk through an example and pick my own test cases. I can run code with run_code if I want.
- Then ask 2-3 follow-up questions a real interviewer would: a harder variant (larger input, streaming data, limited memory, many queries), an edge case I missed, or proving complexity.
- At the end, give a scorecard: problem solving, coding, communication, testing, each 1-4 with one sentence of evidence, an overall hire / lean hire / lean no-hire / no-hire, and the 2 things I should practise next.

${picked.unsolvedOnly ? "This is a problem I haven't attempted before." : "Note: this problem was picked at random and I may have seen it before."}

=== Interview problem (for you; reveal only the statement and examples) ===
${formatProblem(problem)}

=== Interviewer notes (do not reveal) ===
Topic tags: ${(problem?.topicTags ?? picked.topicTags).join(", ")}
Official hints: ${(problem?.hints ?? []).map((h: string) => htmlToText(h)).join(" | ") || "(none)"}`);
}

/**
 * Registers the study prompts. They appear in clients as slash commands
 * (for example /mcp__leetcode__daily in Claude Code).
 */
export function registerStudyPrompts(
    server: McpServer,
    service: LeetCodeBaseService
): void {
    // Models have no clock, so time-boxed sessions ask the server.
    server.tool(
        "get_elapsed_time",
        "Returns the current time and, given a start time, the minutes elapsed (read-only). Use it to keep time in timed sessions such as /mock-interview.",
        {
            startedAt: z
                .string()
                .optional()
                .describe(
                    "ISO 8601 start time (e.g., '2026-11-13T19:30:00.000Z')"
                )
        },
        async ({ startedAt }) => {
            const now = new Date();
            const start = startedAt ? new Date(startedAt) : undefined;
            const valid = start && !Number.isNaN(start.getTime());
            const elapsedMinutes = valid
                ? Math.round(((now.getTime() - start.getTime()) / 60000) * 10) /
                  10
                : undefined;
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            now: now.toISOString(),
                            ...(startedAt
                                ? valid
                                    ? {
                                          startedAt: start.toISOString(),
                                          elapsedMinutes
                                      }
                                    : {
                                          error: `Invalid startedAt '${startedAt}'`
                                      }
                                : {})
                        })
                    }
                ]
            };
        }
    );

    server.registerPrompt(
        "daily",
        {
            title: "Daily problem coach",
            description:
                "Fetches today's LeetCode daily problem and coaches you Socratically: questions and hints only, no solution until you ask."
        },
        () => buildDailyPrompt(service)
    );

    server.registerPrompt(
        "mock-interview",
        {
            title: "Mock coding interview",
            description:
                "Picks a random problem you haven't solved (difficulty and topic optional), runs a time-boxed interview with follow-up questions, and ends with a scorecard.",
            argsSchema: {
                difficulty: optionalCompletable(
                    "easy, medium or hard (default: medium)",
                    (value) => prefixMatches(DIFFICULTIES, value)
                ),
                topic: optionalCompletable(
                    "Topic tag, e.g. graph, dynamic-programming, sliding-window (default: any)",
                    (value) => prefixMatches(TOPICS, value)
                )
            }
        },
        async ({ difficulty, topic }) => {
            try {
                return await buildMockInterviewPrompt(
                    service,
                    difficulty,
                    topic
                );
            } catch (error: any) {
                return userMessage(
                    `I wanted a mock interview (difficulty '${difficulty ?? "medium"}', topic '${topic ?? "any"}'), but picking a problem failed: ${error.message}. Tell me what went wrong and suggest valid options.`
                );
            }
        }
    );

    if (!service.isAuthenticated()) {
        return;
    }

    server.registerPrompt(
        "review",
        {
            title: "Review my solution",
            description:
                "Pulls your latest accepted submission for a problem and critiques its correctness, edge cases, complexity and style.",
            argsSchema: {
                slug: z.string().min(1).describe("Problem slug, e.g. two-sum")
            }
        },
        async ({ slug }) => {
            try {
                return await buildReviewPrompt(service, slug);
            } catch (error: any) {
                return userMessage(
                    `I asked for a review of my solution to '${slug}', but loading it failed: ${error.message}. Tell me, and check the slug with get_problem.`
                );
            }
        }
    );
}
