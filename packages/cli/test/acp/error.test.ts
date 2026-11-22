import { describe, expect, test } from "bun:test"
import { ACPError } from "../../src/acp/error"
import {
  delivered,
  durableEvent,
  failed,
  rpcError,
  startSession,
  succeeded,
  textDelta,
  type Wire,
} from "./wire-fixture"

describe("acp errors", () => {
  test("wraps unknown defects without leaking raw details", () => {
    const requestError = ACPError.toRequestError(
      ACPError.fromUnknown(
        Object.assign(new Error("stack has sk-ant-secret and oauth refresh token"), {
          status: 429,
          retryAfterMs: 60000,
          response: { body: "synthetic private provider response" },
        }),
      ),
    )
    const serialized = JSON.stringify(requestError.toErrorResponse())

    expect(requestError.code).toBe(-32603)
    expect(requestError.message).toBe("Internal error: Internal service failure")
    expect(requestError.data).toEqual({ errorName: "Error" })
    expect(serialized).not.toContain("sk-ant-secret")
    expect(serialized).not.toContain("oauth refresh token")
    expect(serialized).not.toContain("stack")
  })
})

describe("acp error boundary over the wire", () => {
  test.each(["execution", "step"] as const)(
    "preserves rate-limit metadata from a terminal %s failure",
    async (source) => {
      const error = {
        type: "provider.rate-limit",
        message: "Rate limit reached",
        status: 429,
        retryAfterMs: 60000,
        response: { body: "synthetic private provider response" },
      }
      await using acp = await startSession({
        onPrompt: ({ sessionID, id }) => [
          delivered(sessionID, id),
          ...(source === "execution"
            ? [failed(sessionID, error)]
            : [
                durableEvent("session.step.failed", { sessionID, assistantMessageID: "msg_failed", error }),
                succeeded(sessionID),
              ]),
        ],
      })

      expect(await rpcError(acp.prompt(acp.sessionId, "Try the request"))).toEqual({
        code: -32603,
        message: "Internal error: Rate limit reached",
        data: { service: "session", errorName: "provider.rate-limit", status: 429, retryAfterMs: 60000 },
      })
    },
  )

  test.each([
    [
      "without diagnostics",
      {
        type: "provider.error",
        message: "Request failed",
        response: { body: "synthetic private provider response" },
      },
      { service: "session", errorName: "provider.error" },
    ],
    [
      "with only status",
      { type: "provider.error", message: "Request failed", status: 503 },
      { service: "session", errorName: "provider.error", status: 503 },
    ],
    [
      "with an immediate retry but no status",
      { type: "provider.error", message: "Request failed", retryAfterMs: 0 },
      { service: "session", errorName: "provider.error", retryAfterMs: 0 },
    ],
  ] as const)("serializes a terminal failure %s", async (_, error, expected) => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), failed(sessionID, error)],
    })

    expect(await rpcError(acp.prompt(acp.sessionId, "Try the request"))).toEqual({
      code: -32603,
      message: "Internal error: Request failed",
      data: expected,
    })
  })

  test.each<[string, (acp: Wire) => void, string[]]>([
    ["ends", (acp) => acp.server.closeEvents(), []],
    [
      "drops its connection",
      (acp) => acp.server.dropEvents(),
      ["ACP catalog event stream failed", "ACP selection event stream failed"],
    ],
  ])(
    "reports an unavailable server when the event stream %s mid-turn and once the server stops",
    async (_, lose, logs) => {
      await using acp = await startSession({
        onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), textDelta(sessionID, "msg_held", "working")],
      })
      const unavailable = {
        code: -32603,
        message: "Internal error: OpenCode server is unavailable",
        data: { errorName: "ServerUnavailable" },
      }

      const prompt = acp.prompt(acp.sessionId, "hold")
      await acp.waitForUpdate((item) => item.update.sessionUpdate === "agent_message_chunk")
      await acp.request("session/set_mode", { sessionId: acp.sessionId, modeId: "build" })
      lose(acp)

      expect(await rpcError(prompt)).toEqual(unavailable)
      await acp.server.stop()
      expect(await rpcError(acp.request("session/list", {}))).toEqual(unavailable)
      expect(acp.logs.map((log) => String(log.message)).toSorted()).toEqual(logs)
    },
  )
})
