export * as ConfigMarkdown from "./markdown.js"

import matter from "gray-matter"
export function parse(content: string) {
  // Passing options bypasses gray-matter's module-global content cache, which
  // it populates before parsing: a failed YAML parse poisons the entry and
  // every later parse of the same content replays it without throwing, so the
  // sanitize fallback below never runs. Upstream: jonschlinkert/gray-matter#166.
  try {
    return matter(content, {})
  } catch {
    return matter(sanitize(content), {})
  }
}

export function parseOption(content: string) {
  try {
    return parse(content)
  } catch {
    return undefined
  }
}

// Other coding agents accept unquoted colons and leading tags like `[Tag] text`
// in frontmatter values. Retry those values as YAML block scalars so existing
// config files keep working.
export function sanitize(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return content
  const lines = match[1].split(/\r?\n/)
  while (true) {
    let depth = 0
    let line = -1
    try {
      // Parse together so continuations and aliases keep their context. The YAML listener identifies
      // the top-level field being read when parsing fails, even when the error is reported on a later line.
      matter(`---\n${lines.join("\n")}\n---`, {
        language: "yaml",
        listener: (event: "open" | "close", state: { line: number }) => {
          if (event === "open") {
            depth++
            if (depth === 2) line = state.line - 1
          }
          if (event === "close") depth--
        },
      })
      break
    } catch {
      const entry = lines[line]?.match(/^([a-zA-Z_][a-zA-Z0-9_]*)[ \t]*:[ \t]*(.*)$/)
      if (!entry) break
      const value = entry[2].trim()
      if (value === "" || value === ">" || value === "|" || value.startsWith('"') || value.startsWith("'")) break
      if (!value.includes(":") && !/^[[{].*[\]}]\s*\S/.test(value)) break
      lines.splice(line, 1, `${entry[1]}: |-`, `  ${value}`)
    }
  }
  return content.replace(match[1], () => lines.join("\n"))
}
