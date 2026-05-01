import { execFileSync } from "node:child_process"
import { resolve, relative } from "node:path"
import { queryJournal } from "../../../../../src/resources/extensions/gsd/journal.ts"
import { NoProjectError, requireProjectCwd } from "../../../../../src/web/bridge-service.ts"

const MAX_DIFF_SIZE = 50 * 1024 // 50KB

function isPathWithinProject(projectCwd: string, targetPath: string): boolean {
  try {
    // Reject paths with null bytes (poison byte attacks)
    if (targetPath.includes('\0')) return false;
    const resolvedProject = resolve(projectCwd);
    const resolvedTarget = resolve(projectCwd, targetPath);
    // Use relative() to ensure the target doesn't escape the project boundary
    const rel = relative(resolvedProject, resolvedTarget);
    // If relative path starts with ".." or is absolute, it escapes the project
    if (rel.startsWith('..') || resolve(rel) === rel) return false;
    return true;
  } catch {
    return false;
  }
}

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  try {
    const projectCwd = requireProjectCwd(request)
    const { searchParams } = new URL(request.url)
    const unitRunId = searchParams.get("unitRunId")
    const file = searchParams.get("file")

    if (!unitRunId) {
      return Response.json(
        { error: "unitRunId parameter is required" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    // Validate file parameter if provided
    if (file && !isPathWithinProject(projectCwd, file)) {
      return Response.json(
        { error: "Invalid file path" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      )
    }

    // Query journal to find commitSha and changedFiles for the unit
    const allEntries = queryJournal(projectCwd)
    const unitEndEntry = allEntries.find(
      (entry) =>
        entry.eventType === "unit-end" &&
        (entry.data?.unitRunId === unitRunId || entry.flowId === unitRunId)
    )

    if (!unitEndEntry) {
      return Response.json(
        { diff: "", files: [], commitSha: null },
        { headers: { "Cache-Control": "no-store" } }
      )
    }

    const data = unitEndEntry.data ?? {}
    const rawSha = typeof data.commitSha === "string" ? data.commitSha : null
    const changedFiles = Array.isArray(data.changedFiles)
      ? data.changedFiles.filter((f): f is string => typeof f === "string")
      : []

    // Validate commitSha is a valid hex string (defense-in-depth against shell injection)
    const commitSha = rawSha && /^[0-9a-f]{7,40}$/i.test(rawSha) ? rawSha : null

    if (!commitSha) {
      return Response.json(
        { diff: "", files: changedFiles, commitSha: null },
        { headers: { "Cache-Control": "no-store" } }
      )
    }

    try {
      let diffOutput = ""
      try {
        if (file) {
          // Restrict file to changedFiles recorded in journal (defense-in-depth)
          if (changedFiles.length > 0 && !changedFiles.includes(file)) {
            return Response.json(
              { error: "File not in changedFiles for this unit" },
              { status: 400, headers: { "Cache-Control": "no-store" } }
            )
          }
          // Use execFileSync with argv array — no shell interpretation
          diffOutput = execFileSync(
            "git",
            ["diff", `${commitSha}~1`, commitSha, "--", file],
            { cwd: projectCwd, encoding: "utf-8", maxBuffer: MAX_DIFF_SIZE + 10240 }
          )
        } else {
          // Full diff for the commit — also uses execFileSync
          diffOutput = execFileSync(
            "git",
            ["diff", `${commitSha}~1`, commitSha],
            { cwd: projectCwd, encoding: "utf-8", maxBuffer: MAX_DIFF_SIZE + 10240 }
          )
        }
      } catch (err) {
        // Git command might fail if commit is initial or other issues
        // Return empty diff
        diffOutput = ""
      }

      if (diffOutput.length > MAX_DIFF_SIZE) {
        diffOutput = diffOutput.slice(0, MAX_DIFF_SIZE) + `\n\n... diff truncated (original size: ${diffOutput.length} bytes) ...`
      }

      return Response.json(
        { diff: diffOutput, files: changedFiles, commitSha },
        { headers: { "Cache-Control": "no-store" } }
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Response.json(
        { error: `Failed to generate diff: ${message}` },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      )
    }
  } catch (error) {
    if (error instanceof NoProjectError) {
      return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
