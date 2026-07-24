import * as React from "react";
import { Bot, Network, Search, Sparkles } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";

import {
  fetchVoxelboxRemoteAgents,
  importVoxelboxAgentIdentity,
  type VoxelboxRemoteAgent,
} from "@/features/agents/lib/voxelboxAgentDiscovery";
import {
  managedAgentsQueryKey,
  relayAgentsQueryKey,
} from "@/features/agents/hooks";
import { resolveManagedAgentAvatarUrl } from "@/features/agents/ui/managedAgentAvatar";
import type { RelayAgent } from "@/shared/api/types";
import { createManagedAgent, deleteManagedAgent } from "@/shared/api/tauri";
import { startManagedAgent } from "@/shared/api/tauriManagedAgents";
import { PresenceBadge } from "@/features/presence/ui/PresenceBadge";
import {
  type Project,
  type ProjectActivitySummary,
  useProjectActivitySummariesQuery,
  useProjectsQuery,
} from "@/features/projects/hooks";
import { useUserProfileQuery } from "@/features/profile/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import type { ProfilePanelOpenOptions } from "@/shared/context/ProfilePanelContext";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { AgentIdentityCard } from "./AgentIdentityCard";

const REMOTE_AGENT_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(220px,240px))] justify-start gap-3";

export function remoteAgentProvenanceLabel(agentType: string): string {
  const source = agentType.trim();
  if (!source || source.toLowerCase() === "agent") {
    return "Remote";
  }

  const label = source
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
  return `Remote · ${label}`;
}

export function remoteAgentProjectNames(
  pubkey: string,
  projects: readonly Project[],
  summaries: Readonly<Record<string, ProjectActivitySummary>>,
): string[] {
  const normalizedPubkey = normalizePubkey(pubkey);

  return projects
    .filter((project) => {
      const declaredParticipants = [project.owner, ...project.contributors];
      const observedParticipants =
        summaries[project.repoAddress]?.participantPubkeys ?? [];
      return [...declaredParticipants, ...observedParticipants].some(
        (participant) => normalizePubkey(participant) === normalizedPubkey,
      );
    })
    .map((project) => project.name)
    .sort((left, right) => left.localeCompare(right));
}

export function isVoxelboxAgentJoined(
  agent: VoxelboxRemoteAgent,
  relayAgents: readonly RelayAgent[],
): boolean {
  if (agent.publicKey) {
    const publicKey = normalizePubkey(agent.publicKey);
    return relayAgents.some(
      (candidate) => normalizePubkey(candidate.pubkey) === publicKey,
    );
  }

  const name = agent.name.trim().toLowerCase();
  return relayAgents.some(
    (candidate) =>
      candidate.agentType.trim().toLowerCase() === "voxelbox" &&
      candidate.name.trim().toLowerCase() === name,
  );
}

export function RemoteAgentsSection({
  error,
  isLoading,
  managedPubkeys,
  onOpenAgentProfile,
  relayAgents,
}: {
  error: Error | null;
  isLoading: boolean;
  managedPubkeys: Set<string>;
  onOpenAgentProfile: (
    pubkey: string,
    options?: ProfilePanelOpenOptions,
  ) => void;
  relayAgents: RelayAgent[];
}) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = React.useState("");
  const [joinTarget, setJoinTarget] =
    React.useState<VoxelboxRemoteAgent | null>(null);
  const [joinNotice, setJoinNotice] = React.useState<string | null>(null);
  const normalizedManagedPubkeys = React.useMemo(
    () => new Set([...managedPubkeys].map(normalizePubkey)),
    [managedPubkeys],
  );

  const otherAgents = React.useMemo(
    () =>
      relayAgents.filter(
        (agent) => !normalizedManagedPubkeys.has(normalizePubkey(agent.pubkey)),
      ),
    [relayAgents, normalizedManagedPubkeys],
  );
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const summariesQuery = useProjectActivitySummariesQuery(
    otherAgents.length > 0 ? projects : [],
  );
  const summaries = summariesQuery.data ?? {};
  const voxelboxAgentsQuery = useQuery({
    queryKey: ["voxelbox-remote-agents"],
    queryFn: fetchVoxelboxRemoteAgents,
    staleTime: 60_000,
  });
  const availableVoxelboxAgents = React.useMemo(
    () =>
      (voxelboxAgentsQuery.data ?? [])
        .filter((agent) => !isVoxelboxAgentJoined(agent, otherAgents))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [otherAgents, voxelboxAgentsQuery.data],
  );
  const joinMutation = useMutation({
    mutationFn: async (agent: VoxelboxRemoteAgent) => {
      if (!isTauri()) {
        throw new Error("Joining a Voxelbox agent requires the native app.");
      }
      const avatarUrl = await resolveManagedAgentAvatarUrl(agent.avatarUrl);
      const created = await createManagedAgent({
        name: agent.name,
        acpCommand: "buzz-acp",
        agentCommand: "voxelbox-agent",
        harnessOverride: true,
        systemPrompt: agent.description || undefined,
        avatarUrl,
        envVars: { VOXELBOX_STEWARD: agent.name },
        spawnAfterCreate: false,
        startOnAppLaunch: true,
        backend: { type: "local" },
        respondTo: "owner-only",
      });

      try {
        if (!created.ownerAuthTag) {
          throw new Error("Buzz did not return an owner attestation.");
        }
        await importVoxelboxAgentIdentity({
          steward: agent.name,
          nsec: created.privateKeyNsec,
          ownerAuthTag: created.ownerAuthTag,
          replaceExisting: agent.identityReady,
        });
      } catch (error) {
        await deleteManagedAgent(created.agent.pubkey, true).catch(() => {});
        throw error;
      }

      await startManagedAgent(created.agent.pubkey);
      return created.agent;
    },
    onSuccess: async (agent) => {
      setJoinNotice(`${agent.name} joined and is starting.`);
      setJoinTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: relayAgentsQueryKey }),
        queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey }),
        queryClient.invalidateQueries({
          queryKey: ["voxelbox-remote-agents"],
        }),
      ]);
    },
  });

  const filteredAgents = React.useMemo(() => {
    if (!searchQuery.trim()) return otherAgents;
    const query = searchQuery.toLowerCase();
    return otherAgents.filter((agent) => {
      const projectNames = remoteAgentProjectNames(
        agent.pubkey,
        projects,
        summaries,
      );
      return (
        agent.name.toLowerCase().includes(query) ||
        agent.agentType.toLowerCase().includes(query) ||
        agent.channels.some((channel) =>
          channel.toLowerCase().includes(query),
        ) ||
        projectNames.some((project) => project.toLowerCase().includes(query))
      );
    });
  }, [otherAgents, projects, searchQuery, summaries]);

  const sortedAgents = React.useMemo(
    () =>
      [...filteredAgents].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [filteredAgents],
  );
  const filteredAvailableVoxelboxAgents = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return availableVoxelboxAgents;
    return availableVoxelboxAgents.filter((agent) =>
      [agent.name, agent.agentType, agent.description, agent.org].some(
        (value) => value.toLowerCase().includes(query),
      ),
    );
  }, [availableVoxelboxAgents, searchQuery]);
  const remoteAgentCount = otherAgents.length + availableVoxelboxAgents.length;
  const isRemoteAgentsLoading = isLoading || voxelboxAgentsQuery.isLoading;

  return (
    <section className="space-y-4" data-testid="remote-agents-section">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            Remote agents
          </h2>
          <span className="text-sm text-muted-foreground">
            ({remoteAgentCount})
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Community participants and agents available from connected runtimes.
        </p>
      </div>

      {remoteAgentCount > 0 ? (
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search remote agents, channels, or projects..."
            value={searchQuery}
          />
        </div>
      ) : null}

      {isRemoteAgentsLoading ? (
        <p className="text-sm text-muted-foreground">Loading remote agents…</p>
      ) : sortedAgents.length > 0 ||
        filteredAvailableVoxelboxAgents.length > 0 ? (
        <div className={REMOTE_AGENT_GRID_CLASS}>
          {sortedAgents.map((agent) => (
            <RemoteAgentCard
              agent={agent}
              key={agent.pubkey}
              onOpenAgentProfile={onOpenAgentProfile}
              projectNames={remoteAgentProjectNames(
                agent.pubkey,
                projects,
                summaries,
              )}
            />
          ))}
          {filteredAvailableVoxelboxAgents.map((agent) => (
            <AvailableVoxelboxAgentCard
              agent={agent}
              key={`${agent.org}:${agent.name}`}
              onJoin={() => {
                joinMutation.reset();
                setJoinNotice(null);
                setJoinTarget(agent);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-4 text-sm text-muted-foreground">
          {searchQuery.trim()
            ? "No remote agents match your search."
            : "No remote agents have joined this community yet."}
        </p>
      )}

      {error ? (
        <p className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}

      {joinNotice ? (
        <p className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          {joinNotice}
        </p>
      ) : null}

      <Dialog
        onOpenChange={(open) => {
          if (!open && !joinMutation.isPending) setJoinTarget(null);
        }}
        open={joinTarget !== null}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Join {joinTarget?.name ?? "Voxelbox agent"}
            </DialogTitle>
            <DialogDescription>
              Buzz will create an owner-attested community identity, bind it to
              this Voxelbox agent, and start its local runtime.
            </DialogDescription>
          </DialogHeader>

          {joinTarget ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-muted/25 p-4">
                <p className="font-medium">{joinTarget.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {joinTarget.description ||
                    remoteAgentProvenanceLabel(joinTarget.agentType)}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Initially responds only to you. Channel participation can be
                  granted after enrollment.
                </p>
              </div>

              {joinTarget.identityReady ? (
                <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warning">
                  This agent already has a local Buzz identity. Joining replaces
                  it with the identity for this community; Foundry preserves a
                  restricted backup for recovery.
                </p>
              ) : null}

              {joinMutation.error instanceof Error ? (
                <p
                  className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {joinMutation.error.message}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button
                  disabled={joinMutation.isPending}
                  onClick={() => setJoinTarget(null)}
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  disabled={joinMutation.isPending}
                  onClick={() => joinMutation.mutate(joinTarget)}
                  type="button"
                >
                  {joinMutation.isPending ? "Joining…" : "Join agent"}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RemoteAgentCard({
  agent,
  onOpenAgentProfile,
  projectNames,
}: {
  agent: RelayAgent;
  onOpenAgentProfile: (
    pubkey: string,
    options?: ProfilePanelOpenOptions,
  ) => void;
  projectNames: string[];
}) {
  const profileQuery = useUserProfileQuery(agent.pubkey);
  const participationLabel =
    projectNames.length > 0
      ? `${projectNames.length} ${
          projectNames.length === 1 ? "project" : "projects"
        }`
      : agent.channels.length > 0
        ? `${agent.channels.length} ${
            agent.channels.length === 1 ? "channel" : "channels"
          }`
        : null;

  return (
    <AgentIdentityCard
      ariaLabel={`${agent.name} remote agent profile`}
      avatarUrl={profileQuery.data?.avatarUrl}
      dataTestId={`remote-agent-${agent.pubkey}`}
      label={agent.name}
      modelLabel={remoteAgentProvenanceLabel(agent.agentType)}
      onClick={() => onOpenAgentProfile(agent.pubkey)}
      statusBadge={
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <PresenceBadge
            className="px-2 py-0.5 text-2xs"
            status={agent.status}
          />
          {participationLabel ? (
            <Badge
              className="max-w-full truncate normal-case tracking-normal"
              title={projectNames.join(", ") || agent.channels.join(", ")}
              variant="outline"
            >
              {participationLabel}
            </Badge>
          ) : null}
        </div>
      }
    />
  );
}

function AvailableVoxelboxAgentCard({
  agent,
  onJoin,
}: {
  agent: VoxelboxRemoteAgent;
  onJoin: () => void;
}) {
  return (
    <AgentIdentityCard
      actions={
        <Button
          aria-label={`Join ${agent.name}`}
          className="pointer-events-auto h-7 px-2 text-xs"
          onClick={onJoin}
          size="sm"
          type="button"
          variant="secondary"
        >
          Join
        </Button>
      }
      ariaLabel={`${agent.name} is available from Voxelbox`}
      avatar={
        agent.avatarUrl ? undefined : (
          <VoxelboxAgentFallbackIcon agentType={agent.agentType} />
        )
      }
      avatarUrl={agent.avatarUrl}
      dataTestId={`available-voxelbox-agent-${agent.name}`}
      description={agent.description}
      label={agent.name}
      modelLabel={`${remoteAgentProvenanceLabel("voxelbox")} · ${agent.agentType
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase())}`}
      statusBadge={
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge variant="outline">
            {agent.identityReady ? "Local identity" : "Available"}
          </Badge>
          {agent.hasVoice ? (
            <Badge
              title={agent.voiceDescription || "Voice profile available"}
              variant="outline"
            >
              Voice
            </Badge>
          ) : null}
          {agent.org ? (
            <Badge
              className="max-w-full truncate normal-case tracking-normal"
              title={agent.description || agent.org}
              variant="secondary"
            >
              {agent.org}
            </Badge>
          ) : null}
        </div>
      }
    />
  );
}

function VoxelboxAgentFallbackIcon({ agentType }: { agentType: string }) {
  const normalizedType = agentType.trim().toLowerCase();
  const Icon =
    normalizedType === "orchestrator"
      ? Network
      : normalizedType.includes("autonomous")
        ? Sparkles
        : Bot;

  return (
    <div className="flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-background bg-primary/15 text-primary">
      <Icon className="h-10 w-10" />
    </div>
  );
}
