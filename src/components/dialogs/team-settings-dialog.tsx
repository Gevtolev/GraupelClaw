"use client";

import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAgentStore, useActions } from "@/lib/store";
import { getAgentAvatarUrl, isEmojiAvatar, isImageAvatar } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import {
  Users, UserPlus, Wrench, Trash2, ChevronRight, Check, X, Crown,
} from "lucide-react";
import { AvatarPicker } from "@/components/avatar-picker";
import { resolveTlAgentId } from "@/lib/team";
import type { AgentTeam } from "@/types";

type Section = "general" | "members" | "advanced";

const sections: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "general", label: "General", icon: Users },
  { id: "members", label: "Members", icon: UserPlus },
  { id: "advanced", label: "Advanced", icon: Wrench },
];

export function TeamSettingsDialog({
  team,
  open,
  onOpenChange,
}: {
  team: AgentTeam;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const agentStore = useAgentStore();
  const actions = useActions();
  const [name, setName] = useState(team.name);
  const [avatar, setAvatar] = useState(team.avatar || "");
  const [description, setDescription] = useState(team.description || "");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(team.agentIds);
  const [localTlAgentId, setLocalTlAgentId] = useState<string | undefined>(
    team.tlAgentId ?? undefined,
  );
  const [activeSection, setActiveSection] = useState<Section>("general");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const companyAgents = agentStore.state.agents.filter((a) => a.companyId === team.companyId);
  const effectiveTeam: AgentTeam = {
    ...team,
    agentIds: selectedAgentIds,
    tlAgentId: localTlAgentId,
  };
  const currentTlId = resolveTlAgentId(effectiveTeam);

  useEffect(() => {
    setName(team.name);
    setAvatar(team.avatar || "");
    setDescription(team.description || "");
    setSelectedAgentIds(team.agentIds);
    setLocalTlAgentId(team.tlAgentId ?? undefined);
    setActiveSection("general");
  }, [team]);

  async function autoSaveTeam(updates: Partial<{ name: string; avatar: string; description: string; agentIds: string[] }>) {
    const merged = {
      name: (updates.name ?? name).trim(),
      avatar: (updates.avatar ?? avatar) || undefined,
      description: (updates.description ?? description).trim() || undefined,
      agentIds: updates.agentIds ?? selectedAgentIds,
    };
    if (!merged.name || merged.agentIds.length === 0) return;
    await agentStore.updateTeam(team.id, merged);
  }

  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) => {
      const next = prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id];
      const merged: Partial<AgentTeam> = {
        name: name.trim(),
        avatar: avatar || undefined,
        description: description.trim() || undefined,
        agentIds: next,
      };
      if (team.tlAgentId === id && !next.includes(id)) {
        merged.tlAgentId = null;
        setLocalTlAgentId(undefined);
      }
      if (merged.name && next.length > 0) {
        agentStore.updateTeam(team.id, merged);
      }
      return next;
    });
  }

  function handleGeneralBlur() {
    autoSaveTeam({});
  }

  function handleAvatarChange(newAvatar: string) {
    setAvatar(newAvatar);
    autoSaveTeam({ avatar: newAvatar });
  }

  function handleDelete() {
    setShowDeleteConfirm(true);
  }

  async function confirmDelete() {
    await actions.deleteTeam(team.id);
    setShowDeleteConfirm(false);
    onOpenChange(false);
  }

  const sectionLabel = sections.find((s) => s.id === activeSection)?.label ?? "General";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden [&>button]:hidden">
        <DialogTitle className="sr-only">Team Settings</DialogTitle>
        <div className="flex h-[550px]">
          {/* LEFT - Sidebar */}
          <div className="w-[200px] border-r bg-muted/40 flex flex-col">
            {/* Team icon + name */}
            <div className="flex items-center gap-3 px-4 py-3 border-b">
              <div className="shrink-0">
                {isEmojiAvatar(avatar) ? (
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-lg">{avatar}</span>
                ) : avatar && (avatar.startsWith("data:") || avatar.startsWith("http")) ? (
                  <img src={avatar} alt={team.name} className="h-8 w-8 rounded-lg bg-muted object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Users className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{team.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {team.agentIds.length} member{team.agentIds.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex flex-col gap-1 p-2 flex-1">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-background text-foreground font-medium shadow-sm"
                        : "text-muted-foreground hover:bg-background/60"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <Separator />

            {/* Delete button */}
            <div className="p-2">
              <button
                onClick={handleDelete}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete Team
              </button>
            </div>
          </div>

          {/* RIGHT - Content */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Breadcrumb header */}
            <div className="flex items-center gap-1.5 px-6 py-3 text-sm text-muted-foreground border-b">
              <span>Team Settings</span>
              <ChevronRight className="h-3.5 w-3.5" />
              <span className="text-foreground font-medium">{sectionLabel}</span>
              <button
                onClick={() => onOpenChange(false)}
                className="ml-auto rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {activeSection === "general" && (
                <div className="space-y-5">
                  <AvatarPicker
                    value={avatar}
                    onChange={handleAvatarChange}
                    shape="rounded"
                    seed={team.id}
                    fallback={
                      <div className="flex h-full w-full items-center justify-center bg-primary text-primary-foreground">
                        <Users className="h-6 w-6" />
                      </div>
                    }
                  />
                  <div>
                    <Label>Team Name</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={handleGeneralBlur}
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      onBlur={handleGeneralBlur}
                      placeholder="What does this team do?"
                      className="mt-2"
                    />
                  </div>
                </div>
              )}

              {activeSection === "members" && (
                <div className="space-y-3">
                  <div>
                    <Label>Team Members ({selectedAgentIds.length} selected)</Label>
                    <p className="text-sm text-muted-foreground mt-1">
                      Select which agents belong to this team.
                    </p>
                  </div>
                  <div className="space-y-1">
                    {companyAgents.map((agent) => {
                      const selected = selectedAgentIds.includes(agent.id);
                      const isTl = selected && agent.id === currentTlId;
                      return (
                        <div
                          key={agent.id}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md p-2",
                            selected ? "bg-primary/20" : "hover:bg-accent/50",
                          )}
                        >
                          <button
                            onClick={() => toggleAgent(agent.id)}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            {isEmojiAvatar(agent.avatar) ? (
                              <span className="h-6 w-6 flex items-center justify-center text-sm">{agent.avatar}</span>
                            ) : (
                              <img
                                src={isImageAvatar(agent.avatar) ? agent.avatar : getAgentAvatarUrl(agent.id)}
                                alt={agent.name}
                                className="h-6 w-6 rounded-full bg-muted object-cover"
                              />
                            )}
                            <span className="text-sm">{agent.name}</span>
                            {isTl && (
                              <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                                TL
                              </span>
                            )}
                            {selected && <Check className="ml-auto h-4 w-4 text-green-600" />}
                          </button>
                          {selected && (
                            <button
                              onClick={() => {
                                if (agent.id !== currentTlId) {
                                  setLocalTlAgentId(agent.id);
                                  agentStore.updateTeam(team.id, { tlAgentId: agent.id });
                                }
                              }}
                              title={isTl ? "Current Team Leader" : "Set as Team Leader"}
                              className={cn(
                                "rounded p-1 transition-colors",
                                isTl
                                  ? "text-amber-500"
                                  : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10",
                              )}
                            >
                              <Crown className={cn("h-4 w-4", isTl && "fill-current")} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {companyAgents.length === 0 && (
                      <p className="text-sm text-muted-foreground italic">
                        No agents available. Add agents first.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {activeSection === "advanced" && (
                <div className="space-y-5">
                  <div>
                    <Label>Team ID</Label>
                    <code className="mt-2 block rounded-md bg-muted px-3 py-2 text-sm font-mono">
                      {team.id}
                    </code>
                  </div>
                  <Separator />
                  <div>
                    <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Permanently delete this team. Agents will not be affected. This action cannot be undone.
                    </p>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      className="mt-3"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Team
                    </Button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </DialogContent>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{team.name}&quot;? Agents will not be affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
