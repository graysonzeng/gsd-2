"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, TerminalSquare, Wrench } from "lucide-react"
import { AutoModeConsole } from "@/components/gsd/auto-mode-console"
import { MainSessionTerminal } from "@/components/gsd/main-session-terminal"
import { PowerModeChip } from "@/components/gsd/power-mode-context"
import { ShellTerminal } from "@/components/gsd/shell-terminal"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { useGSDWorkspaceState } from "@/lib/gsd-workspace-store"
import { deriveAutoModeRuntimeSummary, type InteractivePaneStatus, type MainSessionPaneStatus } from "@/lib/power-mode-context"
import { useTerminalFontSize } from "@/lib/use-terminal-font-size"

function terminalStatusLabel(status: MainSessionPaneStatus | InteractivePaneStatus): string {
  if (status.connectionState === "error") return "Error"
  if (status.connectionState === "connected") return status.hasOutput ? "Connected" : "Waiting"
  return "Connecting"
}

export function DualTerminal() {
  const [interactiveOpen, setInteractiveOpen] = useState(false)
  const [rawTuiOpen, setRawTuiOpen] = useState(false)
  const [terminalFontSize] = useTerminalFontSize()
  const diagnosticFontSize = Math.min(terminalFontSize, 11)
  const workspace = useGSDWorkspaceState()
  const [mainStatus, setMainStatus] = useState<MainSessionPaneStatus>({ connectionState: "connecting", hasOutput: false })
  const [interactiveStatus, setInteractiveStatus] = useState<InteractivePaneStatus>({
    connectionState: "connecting",
    hasOutput: false,
    tabCount: 1,
    commandLabel: "gsd",
  })
  const projectCwd = workspace.boot?.project.cwd
  const runtime = useMemo(() => deriveAutoModeRuntimeSummary(workspace), [workspace])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
        <span className="font-medium">Power User Mode</span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <TerminalSquare className="h-3.5 w-3.5" />
          <span>Auto-first observability</span>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-2 border-b border-border bg-card/60 px-4 py-2"
        data-testid="power-mode-context-strip"
        role="region"
        aria-label="Power User Mode run context"
      >
        <PowerModeChip label="Project" value={runtime.projectLabel} />
        <PowerModeChip label="Auto" value={runtime.autoPresentation.label} tone={runtime.autoPresentation.tone} />
        <PowerModeChip label="Bridge" value={runtime.bridgePresentation.label} tone={runtime.bridgePresentation.tone} />
        {runtime.phase ? <PowerModeChip label="Phase" value={runtime.phase} tone="info" /> : null}
        {runtime.unitId ? <PowerModeChip label="Unit" value={runtime.unitId} title={runtime.scopeLabel} /> : null}
        {runtime.activeToolLabel ? <PowerModeChip label="Tool" value={runtime.activeToolLabel} tone="info" title={runtime.activeToolLabel} /> : null}
        {runtime.issueSummary ? <PowerModeChip label="Issue" value={runtime.issueSummary} tone="danger" title={runtime.issueSummary} /> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setInteractiveOpen((open) => !open)}>
            <Wrench className="h-3.5 w-3.5" />
            {interactiveOpen ? "Hide Interactive Console" : "Open Interactive Console"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setRawTuiOpen((open) => !open)}>
            <TerminalSquare className="h-3.5 w-3.5" />
            {rawTuiOpen ? "Hide Raw TUI" : "View Raw TUI"}
          </Button>
          {workspace.commandInFlight ? (
            <span className="text-xs text-muted-foreground">Command in flight: {workspace.commandInFlight}</span>
          ) : null}
        </div>

        <AutoModeConsole className="min-h-0 flex-1" />

        <div className="space-y-3">
          <Collapsible open={interactiveOpen} onOpenChange={setInteractiveOpen}>
            <div className="rounded-lg border border-border/70 bg-card/60">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
                  <div>
                    <div className="text-sm font-medium text-foreground">Interactive Console</div>
                    <div className="text-xs text-muted-foreground">Manual recovery and command input · {terminalStatusLabel(interactiveStatus)}</div>
                  </div>
                  {interactiveOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="h-[280px] border-t border-border/70">
                  <ShellTerminal
                    key={`power-mode-shell:${projectCwd ?? "default"}`}
                    className="h-full"
                    command="gsd"
                    sessionPrefix="gsd-interactive"
                    fontSize={diagnosticFontSize}
                    hideInitialGsdHeader
                    projectCwd={projectCwd}
                    onStatusChange={setInteractiveStatus}
                  />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          <Collapsible open={rawTuiOpen} onOpenChange={setRawTuiOpen}>
            <div className="rounded-lg border border-border/70 bg-card/60">
              <CollapsibleTrigger asChild>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
                  <div>
                    <div className="text-sm font-medium text-foreground">Raw Main Session TUI</div>
                    <div className="text-xs text-muted-foreground">Primary auto session output for deep diagnostics · {terminalStatusLabel(mainStatus)}</div>
                  </div>
                  {rawTuiOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="h-[320px] border-t border-border/70">
                  <MainSessionTerminal
                    className="min-h-0 h-full"
                    fontSize={diagnosticFontSize}
                    projectCwd={projectCwd}
                    onStatusChange={setMainStatus}
                  />
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        </div>
      </div>
    </div>
  )
}
