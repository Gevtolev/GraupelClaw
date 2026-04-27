"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGatewayStore, useAgentStore } from "@/lib/store";
import { getAgentAvatarUrl, isEmojiAvatar, isImageAvatar } from "@/lib/avatar";
import { Check, FolderOpen } from "lucide-react";
import { FolderPickerDialog } from "@/components/folder-picker-dialog";

export function CreateTeamDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { state: gatewayState } = useGatewayStore();
  const agentStore = useAgentStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [tlAgentId, setTlAgentId] = useState<string | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const effectiveTlAgentId =
    tlAgentId && selectedAgentIds.includes(tlAgentId)
      ? tlAgentId
      : (selectedAgentIds[0] ?? null);

  const companyAgents = agentStore.state.agents.filter((a) => a.companyId === gatewayState.activeCompanyId);

  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  function reset() {
    setName("");
    setDescription("");
    setSelectedAgentIds([]);
    setTlAgentId(null);
    setWorkspaceRoot(null);
    setCreating(false);
  }

  const canCreate = name.trim() && selectedAgentIds.length > 0 && workspaceRoot;

  async function handleCreate() {
    if (!canCreate || !gatewayState.activeCompanyId) return;
    setCreating(true);
    try {
      const team = await agentStore.createTeam({
        companyId: gatewayState.activeCompanyId,
        name: name.trim(),
        description: description.trim() || undefined,
        agentIds: selectedAgentIds,
        tlAgentId: effectiveTlAgentId ?? undefined,
      });
      await agentStore.updateTeam(team.id, { workspaceRoot });
      // Best-effort: marker + skill/gpw setup
      const agentNameById: Record<string, string> = {};
      for (const a of agentStore.state.agents) {
        if (selectedAgentIds.includes(a.id)) agentNameById[a.id] = a.name;
      }
      await Promise.all([
        fetch("/api/teams/workspace/marker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: team.id, teamName: name.trim(), workspaceRoot }),
        }).catch(() => {}),
        fetch("/api/teams/workspace/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId: team.id, teamName: name.trim(), workspaceRoot, agentNameById }),
        }).catch(() => {}),
      ]);
      reset();
      onOpenChange(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">Create Team</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Create a group chat with multiple agents.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Team Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dev Team"
                className="mt-2"
              />
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this team do?"
                className="mt-2"
              />
            </div>

            {/* Workspace — mandatory */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Workspace <span className="text-destructive">*</span>
              </label>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 min-w-0 rounded-md border bg-muted/30 px-3 py-2 text-sm truncate">
                  {workspaceRoot ? (
                    <span className="flex items-center gap-1.5">
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      {workspaceRoot}
                    </span>
                  ) : (
                    <span className="text-muted-foreground italic">Not set — required</span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPickerOpen(true)}
                >
                  {workspaceRoot ? "Change…" : "Choose…"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Shared folder for team files, tasks, and decisions.
              </p>
            </div>

            {companyAgents.length > 0 ? (
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Members ({selectedAgentIds.length} selected)
                </label>
                <div className="mt-2 space-y-1 max-h-[200px] overflow-y-auto">
                  {companyAgents.map((agent) => {
                    const selected = selectedAgentIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        onClick={() => toggleAgent(agent.id)}
                        className={`flex w-full items-center gap-2 rounded-md p-2 transition-colors ${
                          selected
                            ? "bg-primary/20 text-foreground"
                            : "hover:bg-accent/50 text-muted-foreground"
                        }`}
                      >
                        {isEmojiAvatar(agent.avatar) ? (
                          <span className="h-6 w-6 flex items-center justify-center text-sm">{agent.avatar}</span>
                        ) : (
                          <img
                            src={isImageAvatar(agent.avatar) ? agent.avatar : getAgentAvatarUrl(agent.id, agent.specialty)}
                            alt={agent.name}
                            className="h-6 w-6 rounded-full bg-muted object-cover"
                          />
                        )}
                        <span className="text-sm flex-1 text-left">{agent.name}</span>
                        <span className="text-[11px] text-muted-foreground">{agent.specialty}</span>
                        {selected && <Check className="h-4 w-4 text-green-600" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Add agents first before creating a team.
              </p>
            )}
            {selectedAgentIds.length > 0 && (
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Team Leader</label>
                <select
                  value={effectiveTlAgentId ?? ""}
                  onChange={(e) => setTlAgentId(e.target.value)}
                  className="mt-2 block w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {selectedAgentIds.map((id) => {
                    const a = companyAgents.find((x) => x.id === id);
                    return (
                      <option key={id} value={id}>
                        {a?.name ?? id}
                      </option>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  TL coordinates the team. Non-mention user messages go to the TL first.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={!canCreate || creating}
              className="w-full"
            >
              {creating ? "Creating…" : "Create Team"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FolderPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        defaultPath={workspaceRoot ?? undefined}
        onSelect={(chosen) => setWorkspaceRoot(chosen)}
      />
    </>
  );
}
