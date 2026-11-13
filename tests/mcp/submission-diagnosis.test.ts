import { describe, expect, it } from "vitest";
import {
    buildDiagnosis,
    numberLines
} from "../../src/mcp/tools/submission-diagnosis.js";

const CODE = "class Solution:\n    def f(self, x):\n        return x";

describe("buildDiagnosis (run_code)", () => {
    it("treats run_code 'Accepted' with wrong outputs as Wrong Answer and finds the failing case", () => {
        const d = buildDiagnosis({
            mode: "run",
            lang: "python3",
            code: CODE,
            input: "[1,2]\n3\n[4,5]\n6\n[7]\n8",
            check: {
                status_msg: "Accepted",
                correct_answer: false,
                compare_result: "101",
                total_correct: 2,
                total_testcases: 3,
                code_answer: ["1", "2", "3"],
                expected_code_answer: ["1", "9", "3"],
                std_output_list: ["", "debug", ""]
            }
        });
        expect(d?.verdict).toBe("Wrong Answer");
        expect(d?.passed).toBe("2/3 test cases passed");
        expect(d?.failingCase).toEqual({
            caseNumber: 2,
            input: "[4,5]\n6",
            expected: "9",
            actual: "2",
            stdout: "debug"
        });
        expect(d?.guidance).toMatch(/do not write a new one/);
        expect(d?.yourCode).toContain("2 |     def f(self, x):");
    });

    it("returns nothing when every case passes", () => {
        expect(
            buildDiagnosis({
                mode: "run",
                lang: "python3",
                code: CODE,
                check: {
                    status_msg: "Accepted",
                    correct_answer: true,
                    compare_result: "11"
                }
            })
        ).toBeUndefined();
    });

    it("falls back to the whole input when cases can't be split evenly", () => {
        const d = buildDiagnosis({
            mode: "run",
            lang: "python3",
            code: CODE,
            input: "a\nb\nc",
            check: {
                status_msg: "Accepted",
                correct_answer: false,
                compare_result: "10"
            }
        });
        expect(d?.failingCase?.input).toBe("a\nb\nc");
    });

    it("reports compile errors", () => {
        const d = buildDiagnosis({
            mode: "run",
            lang: "cpp",
            code: "int main(",
            check: {
                status_msg: "Compile Error",
                full_compile_error: "Line 1: expected ')'"
            }
        });
        expect(d?.verdict).toBe("Compile Error");
        expect(d?.error).toBe("Line 1: expected ')'");
    });
});

describe("buildDiagnosis (submit_solution)", () => {
    it("returns nothing for Accepted", () => {
        expect(
            buildDiagnosis({
                mode: "submit",
                lang: "python3",
                code: CODE,
                check: {
                    status_msg: "Accepted",
                    total_correct: 63,
                    total_testcases: 63
                }
            })
        ).toBeUndefined();
    });

    it("captures the failing test case on Wrong Answer", () => {
        const d = buildDiagnosis({
            mode: "submit",
            lang: "python3",
            code: CODE,
            check: {
                status_msg: "Wrong Answer",
                total_correct: 57,
                total_testcases: 63,
                input_formatted: "[3,3], 6",
                input: "[3,3]\n6",
                expected_output: "[0,1]",
                code_output: "[0,0]",
                std_output: ""
            }
        });
        expect(d?.verdict).toBe("Wrong Answer");
        expect(d?.passed).toBe("57/63 test cases passed");
        expect(d?.failingCase).toEqual({
            input: "[3,3], 6",
            expected: "[0,1]",
            actual: "[0,0]",
            stdout: undefined
        });
    });

    it("uses last_testcase for Time Limit Exceeded", () => {
        const d = buildDiagnosis({
            mode: "submit",
            lang: "python3",
            code: CODE,
            check: {
                status_msg: "Time Limit Exceeded",
                last_testcase: "[1,1,1,...]\n100000"
            }
        });
        expect(d?.verdict).toBe("Time Limit Exceeded");
        expect(d?.failingCase?.input).toBe("[1,1,1,...]\n100000");
        expect(d?.guidance).toMatch(/too slow/);
    });

    it("reports runtime errors with the failing input", () => {
        const d = buildDiagnosis({
            mode: "submit",
            lang: "python3",
            code: CODE,
            check: {
                status_msg: "Runtime Error",
                full_runtime_error:
                    "IndexError: list index out of range\nLine 3",
                last_testcase: "[]"
            }
        });
        expect(d?.verdict).toBe("Runtime Error");
        expect(d?.error).toContain("IndexError");
        expect(d?.failingCase?.input).toBe("[]");
    });
});

describe("numberLines", () => {
    it("pads line numbers to the same width", () => {
        const code = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
        const lines = numberLines(code).split("\n");
        expect(lines[0]).toBe(" 1 | l0");
        expect(lines[9]).toBe("10 | l9");
    });
});
