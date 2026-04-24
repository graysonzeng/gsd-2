import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"

class StorageMock {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }
}

const originalWindow = (globalThis as Record<string, unknown>).window
const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage
const originalFetch = globalThis.fetch

function installBrowserGlobals(hash = ""): { replaceCalls: number[] } {
  const replaceCalls: number[] = []
  ;(globalThis as Record<string, unknown>).localStorage = new StorageMock()
  ;(globalThis as Record<string, unknown>).window = {
    location: {
      hash,
      pathname: "/",
      search: "",
    },
    history: {
      replaceState: () => {
        replaceCalls.push(1)
      },
    },
    addEventListener: () => {},
  }
  return { replaceCalls }
}

async function importFreshAuthModule() {
  const url = new URL("../auth.ts", import.meta.url)
  url.searchParams.set("t", `${Date.now()}-${Math.random()}`)
  return await import(url.href)
}

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as Record<string, unknown>).window
  } else {
    ;(globalThis as Record<string, unknown>).window = originalWindow
  }

  if (originalLocalStorage === undefined) {
    delete (globalThis as Record<string, unknown>).localStorage
  } else {
    ;(globalThis as Record<string, unknown>).localStorage = originalLocalStorage
  }

  globalThis.fetch = originalFetch
})

describe("authFetch", () => {
  test("falls through to fetch without Authorization when no token is available", async () => {
    installBrowserGlobals("")

    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    const { authFetch } = await importFreshAuthModule()
    const response = await authFetch("http://example.com/api/preferences")

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    const headers = new Headers(calls[0]?.init?.headers)
    assert.equal(headers.has("Authorization"), false)
  })

  test("adds Authorization header after extracting token from URL hash", async () => {
    const { replaceCalls } = installBrowserGlobals("#token=abc123")

    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    }

    const { authFetch } = await importFreshAuthModule()
    const response = await authFetch("http://example.com/api/preferences")

    assert.equal(response.status, 200)
    assert.equal(calls.length, 1)
    const headers = new Headers(calls[0]?.init?.headers)
    assert.equal(headers.get("Authorization"), "Bearer abc123")
    assert.equal(replaceCalls.length, 1)
  })
})
