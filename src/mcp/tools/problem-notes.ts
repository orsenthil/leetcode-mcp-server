/** Minimal submission shape used to summarise attempts. */
export interface SubmissionLike {
    statusDisplay?: string;
    timestamp?: number | string;
    lang?: string;
    runtime?: number | string;
    memory?: number | string;
}

export interface AttemptSummary {
    /** Failed submissions between the previous AC (if any) and the latest AC. */
    failedBeforeAccepted: number;
    failedVerdicts: string[];
    acceptedLang?: string;
    acceptedRuntime?: string;
    acceptedMemory?: string;
}

/**
 * Summarises the submissions leading to the most recent Accepted one: how many
 * failed attempts came right before it and what their verdicts were.
 * Returns undefined when there is no Accepted submission.
 */
export function summarizeAttempts(
    submissions: SubmissionLike[]
): AttemptSummary | undefined {
    const sorted = [...submissions].sort(
        (a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0)
    );
    const acIndex = sorted.findIndex((s) => s.statusDisplay === "Accepted");
    if (acIndex === -1) {
        return undefined;
    }
    const accepted = sorted[acIndex];
    const failedVerdicts: string[] = [];
    for (const s of sorted.slice(acIndex + 1)) {
        if (s.statusDisplay === "Accepted") {
            break;
        }
        failedVerdicts.push(s.statusDisplay ?? "Unknown");
    }
    const text = (v: unknown) =>
        v === undefined || v === null || v === "" ? undefined : String(v);
    return {
        failedBeforeAccepted: failedVerdicts.length,
        // Oldest first reads naturally: "Wrong Answer, then TLE, then AC".
        failedVerdicts: failedVerdicts.reverse(),
        acceptedLang: text(accepted.lang),
        acceptedRuntime: text(accepted.runtime),
        acceptedMemory: text(accepted.memory)
    };
}

export interface NoteEntryInput {
    date: Date;
    approach: string;
    complexity: string;
    trick: string;
    mistakes?: string;
    lang?: string;
    difficulty?: string;
    tags?: string[];
    attempts?: AttemptSummary;
}

/** Marker at the start of every entry this server writes. */
export const NOTE_ENTRY_MARKER = "===";

/**
 * Formats one dated note entry. Plain text, because LeetCode's note panel
 * shows notes as plain text.
 */
export function formatNoteEntry(input: NoteEntryInput): string {
    const day = input.date.toISOString().slice(0, 10);
    const lang = input.lang ?? input.attempts?.acceptedLang;
    const header = [day, lang, input.difficulty].filter(Boolean).join(" · ");
    const lines = [
        `${NOTE_ENTRY_MARKER} ${header} ${NOTE_ENTRY_MARKER}`,
        `Approach: ${input.approach.trim()}`,
        `Complexity: ${input.complexity.trim()}`,
        `Trick: ${input.trick.trim()}`
    ];
    if (input.mistakes?.trim()) {
        lines.push(`Mistakes: ${input.mistakes.trim()}`);
    }
    const a = input.attempts;
    if (a) {
        const verdicts = a.failedVerdicts.length
            ? ` (${a.failedVerdicts.join(", ")})`
            : "";
        const perf = [a.acceptedRuntime, a.acceptedMemory]
            .filter(Boolean)
            .join(", ");
        lines.push(
            `Attempts: ${a.failedBeforeAccepted} failed before AC${verdicts}${perf ? `; AC ${perf}` : ""}`
        );
    }
    if (input.tags?.length) {
        lines.push(`Tags: ${input.tags.join(", ")}`);
    }
    return lines.join("\n");
}

/** Appends an entry to an existing note, separated by a blank line. */
export function appendNote(existing: string | null, entry: string): string {
    const base = existing?.trimEnd();
    return base ? `${base}\n\n${entry}` : entry;
}

export interface NoteCandidate {
    titleSlug: string;
    title?: string;
    difficulty?: string;
    tags?: string[];
    lastSubmittedAt?: string;
    note: string | null;
}

export interface NoteSearchFilters {
    query?: string;
    tag?: string;
    difficulty?: string;
}

const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s_]+/g, "-");

/**
 * Keeps candidates that have a note and match every filter. `query` terms must
 * all appear (case-insensitively) in the note or the problem title; `tag`
 * matches a topic tag slug or name ("dynamic programming" matches
 * "dynamic-programming").
 */
export function filterNotes(
    candidates: NoteCandidate[],
    filters: NoteSearchFilters
): NoteCandidate[] {
    const terms = (filters.query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const tag = filters.tag ? normalize(filters.tag) : undefined;
    const difficulty = filters.difficulty?.toLowerCase();

    return candidates.filter((c) => {
        if (!c.note) {
            return false;
        }
        if (difficulty && c.difficulty?.toLowerCase() !== difficulty) {
            return false;
        }
        if (tag && !(c.tags ?? []).some((t) => normalize(t) === tag)) {
            return false;
        }
        const haystack =
            `${c.title ?? ""}\n${c.titleSlug}\n${c.note}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
    });
}
