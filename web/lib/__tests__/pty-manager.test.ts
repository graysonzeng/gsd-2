import { afterEach, describe, mock, test } from "node:test"
import assert from "node:assert/strict"

import {
  __clearTestSessions,
  __getTestSession,
  __registerTestSession,
  addListener,
  type PtySession,
} from "../pty-manager.ts"

type TestPtySession = PtySession & { __killed: boolean }

function makeTestSession(id: string, commandLabel: string): TestPtySession {
  let killed = false
  return {
    id,
    pty: {
      pid: 12345,
      kill() {
        killed = true
      },
    } as never,
    listeners: new Set(),
    alive: true,
    buffer: [],
    bufferedBytes: 0,
    commandLabel,
    orphanCleanupTimer: null,
    get __killed() {
      return killed
    },
  } as TestPtySession
}

afterEach(() => {
  __clearTestSessions()
  mock.timers.reset()
})

describe("pty-manager orphan gsd session cleanup", () => {
  test("destroys gsd session after last listener disconnects", () => {
    mock.timers.enable({ apis: ["setTimeout"] })
    const session = makeTestSession("gsd:test", "gsd")
    __registerTestSession(session)

    const remove = addListener("gsd:test", () => {})
    assert.ok(remove)
    remove?.()

    assert.ok(__getTestSession("gsd:test"), "session should remain until cleanup timer fires")
    mock.timers.tick(5_001)

    assert.equal(__getTestSession("gsd:test"), undefined, "gsd session should be destroyed after orphan cleanup delay")
    assert.equal(session.__killed, true, "orphan cleanup should kill the PTY process")
  })

  test("reconnecting before timer fires cancels gsd orphan cleanup", () => {
    mock.timers.enable({ apis: ["setTimeout"] })
    const session = makeTestSession("gsd:reconnect", "gsd")
    __registerTestSession(session)

    const remove = addListener("gsd:reconnect", () => {})
    remove?.()
    const reconnectRemove = addListener("gsd:reconnect", () => {})

    mock.timers.tick(5_001)

    assert.ok(__getTestSession("gsd:reconnect"), "reconnected gsd session should survive orphan cleanup window")
    assert.equal(session.__killed, false, "reconnected session should not kill the PTY process")
    reconnectRemove?.()
  })

  test("non-gsd sessions are not auto-destroyed when listeners disconnect", () => {
    mock.timers.enable({ apis: ["setTimeout"] })
    const session = makeTestSession("shell:test", "zsh")
    __registerTestSession(session)

    const remove = addListener("shell:test", () => {})
    remove?.()
    mock.timers.tick(5_001)

    assert.ok(__getTestSession("shell:test"), "non-gsd session should not be auto-destroyed")
    assert.equal(session.__killed, false, "non-gsd session should remain alive")
  })
})
