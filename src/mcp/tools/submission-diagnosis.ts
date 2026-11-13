type Check = Record<string, unknown>;

export interface FailingCase {
    /** 1-based index among the cases that were run (run_code only). */
    caseNumber?: number;
    input?: string;
    expected?: string;
    actual?: string;
    stdout?: string;
}

export interface Diagnosis {
    verdict: string;
    passed?: string;
    failingCase?: FailingCase;
    error?: string;
    runtime?: string;
    yourCode: string;
    language: string;
    guidance: string;
}

function str(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.map((v) => String(v)).join("\n");
    }
    const text = String(value);
    return text === "" ? undefined : text;
}

function at(value: unknown, index: number): string | undefined {
    return Array.isArray(value) ? str(value[index]) : undefined;
}

/** Prefixes each line with its number so feedback can point at lines. */
export function numberLines(code: string): string {
    const lines = code.replace(/\r\n/g, "\n").split("\n");
    const width = String(lines.length).length;
    return lines
        .map((line, i) => `${String(i + 1).padStart(width, " ")} | ${line}`)
        .join("\n");
}

/**
 * Splits a run_code input blob into per-case inputs when every case uses the
 * same number of lines (the usual LeetCode layout: one line per parameter).
 */
function splitCases(input: string, caseCount: number): string[] | undefined {
    const lines = input.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
    if (caseCount <= 0 || lines.length % caseCount !== 0) {
        return undefined;
    }
    const per = lines.length / caseCount;
    return Array.from({ length: caseCount }, (_, i) =>
        lines.slice(i * per, (i + 1) * per).join("\n")
    );
}

const GUIDANCE: Record<string, string> = {
    "Wrong Answer":
        "Help the user debug THEIR solution; do not write a new one. Trace their code on the failing input, name the exact line(s) where the behavior diverges from the expected output, explain the flawed assumption or missed edge case, and suggest the smallest change that fixes it. Ask a guiding question first if the user is practicing.",
    "Time Limit Exceeded":
        "Help the user see why THEIR approach is too slow; do not write a new solution. State the time complexity of their code, compare it with the input size this test implies, point to the hot loop or repeated work, and hint at the idea (data structure, memoization, pruning) that removes it.",
    "Memory Limit Exceeded":
        "Help the user find what in THEIR code uses too much memory (which structure grows, and how large for this input) and hint at how to reduce it, without rewriting the solution.",
    "Runtime Error":
        "Help the user find the cause of the runtime error in THEIR code: point to the line from the error message, explain which input value triggers it (index out of range, null access, recursion depth, overflow), and suggest the minimal guard or fix.",
    "Compile Error":
        "Point to the line and the cause of the compile error in the user's code and give the minimal fix.",
    "Output Limit Exceeded":
        "Help the user find where THEIR code prints too much output (often leftover debug prints or an infinite loop) and suggest the fix."
};

const DEFAULT_GUIDANCE =
    "Help the user understand why THEIR code failed and how to fix it with the smallest change. Do not rewrite the solution unless asked.";

/**
 * Builds a debugging brief from a LeetCode check result, or returns undefined
 * when everything passed.
 *
 * @param mode - "run" for run_code (interpret) results, "submit" for submissions
 * @param check - The final /check/ JSON
 * @param code - The code that was run
 * @param lang - Language slug
 * @param input - The input used for run_code (custom or the example cases)
 */
export function buildDiagnosis(params: {
    mode: "run" | "submit";
    check: Check;
    code: string;
    lang: string;
    input?: string;
}): Diagnosis | undefined {
    const { mode, check, code, lang } = params;
    const statusMsg = str(check.status_msg) ?? "Unknown";
    const compileError = str(check.full_compile_error ?? check.compile_error);
    const runtimeError = str(check.full_runtime_error ?? check.runtime_error);

    let verdict = statusMsg;
    if (compileError) {
        verdict = "Compile Error";
    } else if (runtimeError) {
        verdict = "Runtime Error";
    } else if (mode === "run" && statusMsg === "Accepted") {
        // For run_code, "Accepted" only means the code ran; outputs may differ.
        if (check.correct_answer !== false) {
            return undefined;
        }
        verdict = "Wrong Answer";
    } else if (statusMsg === "Accepted") {
        return undefined;
    }

    const total = Number(check.total_testcases);
    const correct = Number(check.total_correct);
    const passed =
        Number.isFinite(total) && total > 0 && Number.isFinite(correct)
            ? `${correct}/${total} test cases passed`
            : undefined;

    let failingCase: FailingCase | undefined;
    if (mode === "submit") {
        failingCase = {
            input: str(
                check.input_formatted ?? check.input ?? check.last_testcase
            ),
            expected: str(check.expected_output),
            actual: str(check.code_output),
            stdout: str(check.std_output)
        };
    } else {
        const compare =
            typeof check.compare_result === "string"
                ? check.compare_result
                : "";
        const index = compare.indexOf("0");
        const caseCount =
            compare.length || (Number.isFinite(total) ? total : 0);
        const cases = params.input
            ? splitCases(params.input, caseCount)
            : undefined;
        if (index >= 0) {
            failingCase = {
                caseNumber: index + 1,
                input: cases?.[index] ?? params.input,
                expected: at(check.expected_code_answer, index),
                actual: at(check.code_answer, index),
                stdout: at(check.std_output_list, index)
            };
        } else if (params.input) {
            failingCase = { input: params.input };
        }
    }
    if (
        failingCase &&
        Object.values(failingCase).every((v) => v === undefined)
    ) {
        failingCase = undefined;
    }

    return {
        verdict,
        passed,
        failingCase,
        error: compileError ?? runtimeError,
        runtime: str(check.status_runtime),
        yourCode: numberLines(code),
        language: lang,
        guidance: GUIDANCE[verdict] ?? DEFAULT_GUIDANCE
    };
}
