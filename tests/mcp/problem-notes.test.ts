import { describe, expect, it } from "vitest";
import {
    appendNote,
    filterNotes,
    formatNoteEntry,
    summarizeAttempts
} from "../../src/mcp/tools/problem-notes.js";

describe("summarizeAttempts", () => {
    it("counts failed submissions right before the latest AC, oldest first", () => {
        const summary = summarizeAttempts([
            {
                statusDisplay: "Accepted",
                timestamp: 100,
                lang: "python3",
                runtime: "40 ms"
            },
            { statusDisplay: "Wrong Answer", timestamp: 300 },
            {
                statusDisplay: "Accepted",
                timestamp: 500,
                lang: "python3",
                runtime: "35 ms",
                memory: "17 MB"
            },
            { statusDisplay: "Time Limit Exceeded", timestamp: 400 },
            { statusDisplay: "Wrong Answer", timestamp: 350 }
        ]);
        expect(summary).toEqual({
            failedBeforeAccepted: 3,
            failedVerdicts: [
                "Wrong Answer",
                "Wrong Answer",
                "Time Limit Exceeded"
            ],
            acceptedLang: "python3",
            acceptedRuntime: "35 ms",
            acceptedMemory: "17 MB"
        });
    });

    it("returns undefined without an accepted submission", () => {
        expect(
            summarizeAttempts([{ statusDisplay: "Wrong Answer" }])
        ).toBeUndefined();
        expect(summarizeAttempts([])).toBeUndefined();
    });
});

describe("formatNoteEntry / appendNote", () => {
    const entry = formatNoteEntry({
        date: new Date("2026-11-13T10:00:00Z"),
        approach: "Hash map of value to index",
        complexity: "O(n) time, O(n) space",
        trick: "Look up target - x before inserting x",
        mistakes: "Inserted before checking, matched an element with itself",
        difficulty: "Easy",
        tags: ["array", "hash-table"],
        attempts: {
            failedBeforeAccepted: 1,
            failedVerdicts: ["Wrong Answer"],
            acceptedLang: "python3",
            acceptedRuntime: "52 ms"
        }
    });

    it("formats a dated, structured entry", () => {
        expect(entry).toBe(
            [
                "=== 2026-11-13 · python3 · Easy ===",
                "Approach: Hash map of value to index",
                "Complexity: O(n) time, O(n) space",
                "Trick: Look up target - x before inserting x",
                "Mistakes: Inserted before checking, matched an element with itself",
                "Attempts: 1 failed before AC (Wrong Answer); AC 52 ms",
                "Tags: array, hash-table"
            ].join("\n")
        );
    });

    it("appends below existing notes", () => {
        expect(appendNote(null, entry)).toBe(entry);
        expect(appendNote("old note\n\n", entry)).toBe(`old note\n\n${entry}`);
    });
});

describe("filterNotes", () => {
    const candidates = [
        {
            titleSlug: "two-sum",
            title: "Two Sum",
            difficulty: "Easy",
            tags: ["array", "hash-table"],
            note: "Trick: complement lookup in a hash map"
        },
        {
            titleSlug: "daily-temperatures",
            title: "Daily Temperatures",
            difficulty: "Medium",
            tags: ["stack", "monotonic-stack"],
            note: "Monotonic stack of indices"
        },
        {
            titleSlug: "no-note",
            title: "No Note",
            difficulty: "Easy",
            tags: ["array"],
            note: null
        }
    ];

    it("requires every query term, case-insensitively", () => {
        expect(
            filterNotes(candidates, { query: "MONOTONIC stack" }).map(
                (c) => c.titleSlug
            )
        ).toEqual(["daily-temperatures"]);
        expect(filterNotes(candidates, { query: "monotonic hash" })).toEqual(
            []
        );
    });

    it("filters by tag name or slug, and difficulty", () => {
        expect(
            filterNotes(candidates, { tag: "Hash Table" }).map(
                (c) => c.titleSlug
            )
        ).toEqual(["two-sum"]);
        expect(
            filterNotes(candidates, { difficulty: "MEDIUM" }).map(
                (c) => c.titleSlug
            )
        ).toEqual(["daily-temperatures"]);
    });

    it("skips problems without notes", () => {
        expect(filterNotes(candidates, {}).map((c) => c.titleSlug)).toEqual([
            "two-sum",
            "daily-temperatures"
        ]);
    });
});
