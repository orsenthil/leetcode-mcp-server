const ENTITIES: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&le;": "≤",
    "&ge;": "≥",
    "&ne;": "≠",
    "&times;": "×",
    "&minus;": "−",
    "&amp;": "&"
};

/**
 * Converts LeetCode problem HTML into readable plain text: keeps line breaks,
 * list bullets, `<pre>` blocks and exponents (10<sup>5</sup> → 10^5).
 */
export function htmlToText(html: string | null | undefined): string {
    if (!html) {
        return "";
    }
    let text = html
        .replace(/\r\n/g, "\n")
        .replace(/<sup>\s*([^<]*?)\s*<\/sup>/gi, "^$1")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/(p|div|pre|ul|ol|h\d)>/gi, "\n")
        .replace(/<(p|div|pre|ul|ol|h\d)[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "");
    text = text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&[a-z]+;|&#39;/gi, (entity) => ENTITIES[entity] ?? entity)
        // LeetCode pads some statements with zero-width spaces.
        .replace(/[\u200b-\u200d\ufeff]/g, "");
    return text
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, ""))
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
