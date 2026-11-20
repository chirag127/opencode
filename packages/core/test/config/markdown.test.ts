import { describe, expect, test } from "bun:test"
import { ConfigMarkdown } from "@opencode/core/config/markdown"

const invalidYaml = `---
description: Use when the user needs to crawl pages. Keywords: crawl, scrape
---
body`

describe("ConfigMarkdown.parse", () => {
  test("recovers unquoted-colon frontmatter via the sanitize fallback", () => {
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
    expect(parsed.content.trim()).toBe("body")
  })

  test("recovers a frontmatter value that starts with a bracketed tag", () => {
    const parsed = ConfigMarkdown.parse("---\ndescription: [Team] Does a thing\ntools: [read, edit]\n---\nbody")
    expect(parsed.data.description).toBe("[Team] Does a thing")
    expect(parsed.data.tools).toEqual(["read", "edit"])
  })

  test.each([
    {
      name: "single-line",
      fields: `model: { providerID: example, model: chat, variant: high }
permissions: [{ action: read, resource: "*", effect: allow }]`,
    },
    {
      name: "multiline",
      fields: `model: { providerID: example,
  model: chat, variant: high }
permissions: [{ action: read,
  resource: "*", effect: allow }]`,
    },
    {
      name: "unindented multiline",
      fields: `model: { providerID: example,
model: chat, variant: high }
permissions: [{ action: read,
resource: "*", effect: allow }]`,
    },
  ])("preserves $name flow collections when repairing other frontmatter fields", (input) => {
    const parsed = ConfigMarkdown.parse(`---
# A leading comment

description: Review changes. Keywords: review, audit
# Keep the selected model and permissions.
${input.fields}
note: [Team] Review carefully
---
Review carefully.`)

    expect(parsed.data).toEqual({
      description: "Review changes. Keywords: review, audit",
      model: { providerID: "example", model: "chat", variant: "high" },
      permissions: [{ action: "read", resource: "*", effect: "allow" }],
      note: "[Team] Review carefully",
    })
    expect(parsed.content).toBe("Review carefully.")
  })

  test("preserves scalar continuations while repairing descriptions", () => {
    const parsed = ConfigMarkdown.parse(`---
# A leading comment

description: Review changes. Keywords: review, audit
# These continuations are content, not top-level fields.
quoted: "before
model: text inside the quote"
plain: https://example.com
  with more text
literal: |-
  model: { untouched: text }
  [Team] more
folded: >-
  first
  second
note: [Team] Review carefully
---
body`)

    expect(parsed.data).toEqual({
      description: "Review changes. Keywords: review, audit",
      quoted: "before model: text inside the quote",
      plain: "https://example.com with more text",
      literal: "model: { untouched: text }\n[Team] more",
      folded: "first second",
      note: "[Team] Review carefully",
    })
    expect(parsed.content).toBe("body")
  })

  test("preserves flow aliases to earlier anchors when repairing a description", () => {
    const parsed = ConfigMarkdown.parse(`---
defaults: &model { providerID: example, model: chat, variant: high }
description: Review changes. Keywords: review, audit
model: { <<: *model }
---
Review carefully.`)

    expect(parsed.data.model).toEqual({ providerID: "example", model: "chat", variant: "high" })
    expect(parsed.data.description).toBe("Review changes. Keywords: review, audit")
    expect(parsed.content).toBe("Review carefully.")
  })

  test("recovers the same content again after a previous failed parse", () => {
    // gray-matter caches by content before parsing; a poisoned entry used to
    // make every later parse of the same text return silently without data.
    expect(() => ConfigMarkdown.parse("---\ndescription: [unclosed\n---\nbody")).toThrow()
    const parsed = ConfigMarkdown.parse(invalidYaml)
    expect(parsed.data.description).toBe("Use when the user needs to crawl pages. Keywords: crawl, scrape")
  })

  test("keeps throwing for the same unparseable content on every call", () => {
    const input = "---\ndescription: [unclosed\n---\nbody"
    expect(() => ConfigMarkdown.parse(input)).toThrow()
    expect(() => ConfigMarkdown.parse(input)).toThrow()
  })

  test("parses plain content without frontmatter", () => {
    const parsed = ConfigMarkdown.parse("just body")
    expect(parsed.content).toBe("just body")
    expect(parsed.data).toEqual({})
  })
})
