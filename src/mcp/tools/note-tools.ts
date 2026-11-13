import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LeetCodeBaseService } from "../../leetcode/leetcode-base-service.js";
import {
    appendNote,
    filterNotes,
    formatNoteEntry,
    type NoteCandidate,
    summarizeAttempts
} from "./problem-notes.js";
import { ToolRegistry } from "./tool-registry.js";

/** Upper bound on problems scanned by search_problem_notes. */
const MAX_NOTE_SCAN = 2000;
const PROGRESS_PAGE_SIZE = 50;
const NOTE_PREVIEW_CHARS = 1500;

function jsonResult(value: unknown) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(value) }]
    };
}

/**
 * Note tool registry class that handles registration of LeetCode note-related tools.
 * This class manages tools for accessing and searching user notes on LeetCode CN.
 */
export class NoteToolRegistry extends ToolRegistry {
    /**
     * Per-problem notes on LeetCode Global: the "Notes" panel on each problem
     * page. These tools build a searchable pattern library from them.
     */
    protected registerAuthenticatedGlobal(): void {
        this.server.tool(
            "get_problem_note",
            "Reads the user's personal note on a problem (the Notes panel on the problem page; read-only, requires auth, Global only).",
            {
                titleSlug: z
                    .string()
                    .min(1)
                    .describe("Problem URL slug (e.g., 'two-sum')")
            },
            async ({ titleSlug }) => {
                try {
                    const note =
                        await this.leetcodeService.fetchProblemNote(titleSlug);
                    return jsonResult({ titleSlug, note });
                } catch (error: any) {
                    return jsonResult({
                        error: "Failed to read problem note",
                        message: error.message
                    });
                }
            }
        );

        this.server.tool(
            "save_problem_note",
            "Saves a short, structured study note on a problem to the user's LeetCode note for it (side effect: writes the Notes panel on the problem page; requires auth, Global only). Use after an Accepted submission to build a personal pattern library. Appends a dated entry by default, keeping earlier notes. The server adds the date, difficulty, topic tags and, from the user's submission history, how many attempts failed before AC. Write concise, specific content in the user's own terms; ask before saving.",
            {
                titleSlug: z
                    .string()
                    .min(1)
                    .describe("Problem URL slug (e.g., 'two-sum')"),
                approach: z
                    .string()
                    .min(1)
                    .max(1000)
                    .describe(
                        "The approach in one or two sentences (e.g., 'Sliding window over the string, shrinking when a character repeats')"
                    ),
                complexity: z
                    .string()
                    .min(1)
                    .max(200)
                    .describe(
                        "Time and space complexity (e.g., 'O(n) time, O(k) space')"
                    ),
                trick: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                        "The key insight that makes it work, phrased so it is recognisable on a new problem"
                    ),
                mistakes: z
                    .string()
                    .max(1000)
                    .optional()
                    .describe(
                        "Mistakes made on the way (wrong ideas, bugs, missed edge cases). Omit if none."
                    ),
                lang: z
                    .string()
                    .optional()
                    .describe(
                        "Language of the accepted solution (e.g., 'python3')"
                    ),
                mode: z
                    .enum(["append", "replace"])
                    .optional()
                    .default("append")
                    .describe(
                        "'append' (default) adds a dated entry below the existing note; 'replace' overwrites the whole note"
                    )
            },
            async ({
                titleSlug,
                approach,
                complexity,
                trick,
                mistakes,
                lang,
                mode
            }) => {
                try {
                    const [problem, history, existing] = await Promise.all([
                        this.leetcodeService
                            .fetchProblemSimplified(titleSlug)
                            .catch(() => undefined),
                        this.leetcodeService
                            .fetchUserAllSubmissions({
                                offset: 0,
                                limit: 20,
                                questionSlug: titleSlug
                            })
                            .catch(() => undefined),
                        mode === "append"
                            ? this.leetcodeService.fetchProblemNote(titleSlug)
                            : Promise.resolve(null)
                    ]);

                    const submissions = Array.isArray(history?.submissions)
                        ? history.submissions
                        : [];
                    const entry = formatNoteEntry({
                        date: new Date(),
                        approach,
                        complexity,
                        trick,
                        mistakes,
                        lang,
                        difficulty: problem?.difficulty,
                        tags: problem?.topicTags,
                        attempts: summarizeAttempts(submissions)
                    });
                    const content =
                        mode === "append" ? appendNote(existing, entry) : entry;

                    await this.leetcodeService.updateProblemNote(
                        titleSlug,
                        content
                    );
                    return jsonResult({
                        titleSlug,
                        saved: true,
                        mode,
                        entry,
                        noteLength: content.length
                    });
                } catch (error: any) {
                    return jsonResult({
                        error: "Failed to save problem note",
                        message: error.message
                    });
                }
            }
        );

        this.server.tool(
            "search_problem_notes",
            "Searches the user's personal problem notes (read-only, requires auth, Global only) across problems they have solved or attempted. Filter by keywords (all must appear in the note or title), topic tag and difficulty. Use it to find past problems that used a pattern (e.g., query 'monotonic stack') or to review notes for a topic. Scans the user's problem history, so it can take a few seconds.",
            {
                query: z
                    .string()
                    .optional()
                    .describe(
                        "Keywords that must all appear in the note or problem title (case-insensitive). Omit to list every note."
                    ),
                tag: z
                    .string()
                    .optional()
                    .describe(
                        "Topic tag slug or name (e.g., 'dynamic-programming' or 'Dynamic Programming')"
                    ),
                difficulty: z
                    .enum(["EASY", "MEDIUM", "HARD"])
                    .optional()
                    .describe("Only problems of this difficulty"),
                limit: z
                    .number()
                    .int()
                    .min(1)
                    .max(100)
                    .optional()
                    .default(20)
                    .describe("Max results (default: 20)")
            },
            async ({ query, tag, difficulty, limit }) => {
                try {
                    const candidates = await this.collectNoteCandidates();
                    const matches = filterNotes(candidates, {
                        query,
                        tag,
                        difficulty
                    }).sort((a, b) =>
                        String(b.lastSubmittedAt ?? "").localeCompare(
                            String(a.lastSubmittedAt ?? "")
                        )
                    );
                    return jsonResult({
                        filters: { query, tag, difficulty },
                        scannedProblems: candidates.length,
                        problemsWithNotes: candidates.filter((c) => c.note)
                            .length,
                        totalMatches: matches.length,
                        results: matches.slice(0, limit).map((m) => ({
                            titleSlug: m.titleSlug,
                            title: m.title,
                            difficulty: m.difficulty,
                            tags: m.tags,
                            note:
                                m.note && m.note.length > NOTE_PREVIEW_CHARS
                                    ? `${m.note.slice(0, NOTE_PREVIEW_CHARS)}…`
                                    : m.note
                        }))
                    });
                } catch (error: any) {
                    return jsonResult({
                        error: "Failed to search problem notes",
                        message: error.message
                    });
                }
            }
        );
    }

    /**
     * Lists every problem the user solved or attempted, with its note.
     * Notes can only be read per problem on Global, so this pages through the
     * user's progress and reads notes in batches.
     */
    private async collectNoteCandidates(): Promise<NoteCandidate[]> {
        const bySlug = new Map<string, NoteCandidate>();
        for (const questionStatus of ["SOLVED", "ATTEMPTED"]) {
            for (
                let offset = 0;
                offset < MAX_NOTE_SCAN && bySlug.size < MAX_NOTE_SCAN;
                offset += PROGRESS_PAGE_SIZE
            ) {
                const page =
                    await this.leetcodeService.fetchUserProgressQuestionList({
                        offset,
                        limit: PROGRESS_PAGE_SIZE,
                        questionStatus
                    });
                const questions: any[] = page?.questions ?? [];
                for (const q of questions) {
                    if (q?.titleSlug && !bySlug.has(q.titleSlug)) {
                        bySlug.set(q.titleSlug, {
                            titleSlug: q.titleSlug,
                            title: q.title,
                            difficulty: q.difficulty,
                            tags: (q.topicTags ?? [])
                                .map((t: any) => t?.slug)
                                .filter(Boolean),
                            lastSubmittedAt: q.lastSubmittedAt,
                            note: null
                        });
                    }
                }
                const total = Number(page?.totalNum ?? 0);
                if (
                    questions.length < PROGRESS_PAGE_SIZE ||
                    offset + PROGRESS_PAGE_SIZE >= total
                ) {
                    break;
                }
            }
        }

        const candidates = [...bySlug.values()];
        const notes = await this.leetcodeService.fetchProblemNotes(
            candidates.map((c) => c.titleSlug)
        );
        for (const c of candidates) {
            c.note = notes[c.titleSlug] ?? null;
        }
        return candidates;
    }

    protected registerAuthenticatedChina(): void {
        // Notes search tool (CN-specific)
        this.server.tool(
            "search_notes",
            "Searches the authenticated user's personal notes across all problems (read-only, requires auth, CN only). Keyword search with pagination. Use get_note when you know the specific questionId; use this to find notes by keyword across problems.",
            {
                keyword: z
                    .string()
                    .optional()
                    .describe(
                        "Search term to filter notes by content or title. Omit to list all notes."
                    ),
                limit: z
                    .number()
                    .optional()
                    .default(10)
                    .describe("Max notes per page (default: 10)"),
                skip: z
                    .number()
                    .optional()
                    .default(0)
                    .describe("Notes to skip for pagination (default: 0)"),
                orderBy: z
                    .enum(["ASCENDING", "DESCENDING"])
                    .optional()
                    .default("DESCENDING")
                    .describe(
                        "'DESCENDING' = newest first (default); 'ASCENDING' = oldest first"
                    )
            },
            async ({ keyword, limit, skip, orderBy }) => {
                try {
                    const options = {
                        aggregateType: "QUESTION_NOTE",
                        keyword,
                        orderBy,
                        limit,
                        skip
                    };

                    const data =
                        await this.leetcodeService.fetchUserNotes(options);

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    filters: { keyword, orderBy },
                                    pagination: {
                                        limit,
                                        skip,
                                        totalCount: data.count
                                    },
                                    notes: data.userNotes
                                })
                            }
                        ]
                    };
                } catch (error: any) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: "Failed to search notes",
                                    message: error.message
                                })
                            }
                        ]
                    };
                }
            }
        );

        // Notes detail tool (CN-specific, requires authentication)
        this.server.tool(
            "get_note",
            "Retrieves personal notes for a specific problem by questionId (read-only, requires auth, CN only). Use search_notes to find notes across problems by keyword when you don't know the questionId.",
            {
                questionId: z
                    .string()
                    .describe(
                        "Numeric problem ID (e.g., '42' for Trapping Rain Water)—not the titleSlug"
                    ),
                limit: z
                    .number()
                    .optional()
                    .default(10)
                    .describe("Max notes per page (default: 10)"),
                skip: z
                    .number()
                    .optional()
                    .default(0)
                    .describe("Notes to skip for pagination (default: 0)")
            },
            async ({ questionId, limit = 20, skip = 0 }) => {
                try {
                    const data =
                        await this.leetcodeService.fetchNotesByQuestionId(
                            questionId,
                            limit,
                            skip
                        );

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    questionId,
                                    count: data.count,
                                    pagination: { limit, skip },
                                    notes: data.userNotes
                                })
                            }
                        ]
                    };
                } catch (error: any) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: "Failed to get note for question",
                                    message: error.message
                                })
                            }
                        ]
                    };
                }
            }
        );

        // Note creation tool (CN-specific, requires authentication)
        this.server.tool(
            "create_note",
            "Creates a new personal note for a problem (write operation, requires auth, CN only). Supports markdown content. Returns { success, note } as JSON. Use update_note to modify an existing note by noteId.",
            {
                questionId: z
                    .string()
                    .describe(
                        "Numeric problem ID (e.g., '42')—not the titleSlug"
                    ),
                content: z.string().describe("Note body (markdown supported)"),
                title: z
                    .string()
                    .optional()
                    .default("")
                    .describe("Optional short title or summary")
            },
            async ({ questionId, content, title = "" }) => {
                try {
                    const data = await this.leetcodeService.createUserNote(
                        content,
                        "COMMON_QUESTION",
                        questionId,
                        title
                    );

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: data.ok,
                                    note: data.note
                                })
                            }
                        ]
                    };
                } catch (error: any) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: "Failed to create note",
                                    message: error.message
                                })
                            }
                        ]
                    };
                }
            }
        );

        // Note update tool (CN-specific, requires authentication)
        this.server.tool(
            "update_note",
            "Updates an existing personal note by noteId (write operation, requires auth, CN only). Use create_note for new notes; use get_note or search_notes first to find the noteId.",
            {
                noteId: z
                    .string()
                    .describe("Note ID from get_note or search_notes response"),
                content: z
                    .string()
                    .default("")
                    .describe("New note body (markdown supported)"),
                title: z
                    .string()
                    .default("")
                    .describe("New short title or summary")
            },
            async ({ noteId, content, title = "" }) => {
                try {
                    const data = await this.leetcodeService.updateUserNote(
                        noteId,
                        content,
                        title
                    );

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: data.ok,
                                    note: data.note
                                })
                            }
                        ]
                    };
                } catch (error: any) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    error: "Failed to update note",
                                    message: error.message
                                })
                            }
                        ]
                    };
                }
            }
        );
    }
}

/**
 * Registers all note-related tools with the MCP server.
 *
 * @param server - The MCP server instance to register tools with
 * @param leetcodeService - The LeetCode service implementation to use for API calls
 */
export function registerNoteTools(
    server: McpServer,
    leetcodeService: LeetCodeBaseService
): void {
    const registry = new NoteToolRegistry(server, leetcodeService);
    registry.registerTools();
}
