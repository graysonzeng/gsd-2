import { collectAutoExecutionTimeline } from "../../../../../src/web/auto-execution-service.ts"
import { NoProjectError, requireProjectCwd } from "../../../../../src/web/bridge-service.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  try {
    const projectCwd = requireProjectCwd(request)
    const { searchParams } = new URL(request.url)
    const runId = searchParams.get("runId")
    const cursor = searchParams.get("cursor")
    const limitValue = searchParams.get("limit")
    const limit = limitValue ? Number.parseInt(limitValue, 10) : undefined
    const payload = collectAutoExecutionTimeline(projectCwd, { runId, cursor, limit })
    return Response.json(payload, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (error) {
    if (error instanceof NoProjectError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
