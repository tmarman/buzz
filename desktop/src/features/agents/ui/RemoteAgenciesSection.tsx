import * as React from "react";
import { Network, Plus } from "lucide-react";

import { useChannelsQuery } from "@/features/channels/hooks";
import {
  REMOTE_AGENCY_AGENT_NAME_PREFIX,
  isRemoteAgencyManagedAgent,
} from "@/features/agents/lib/remoteAgencyJoin";
import { useManagedAgentRuntimesQuery } from "@/features/agents/managedAgentRuntimeHooks";
import { findManagedAgentRuntime } from "@/features/agents/managedAgentRuntimeStatus";
import type { RemoteAgencyBinding } from "@/shared/api/remoteAgencyTypes";
import { listRemoteAgencies } from "@/shared/api/tauriRemoteAgencies";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { RemoteAgencyDialog } from "./RemoteAgencyDialog";

function remoteDisplayName(agent: ManagedAgent) {
  return isRemoteAgencyManagedAgent(agent)
    ? agent.name.slice(REMOTE_AGENCY_AGENT_NAME_PREFIX.length)
    : agent.name;
}

type CommunityScope = { id: string; name: string; relayUrl: string };

/** Community-scoped entry point for projecting an Agency runtime into Buzz. */
export function RemoteAgenciesSection({
  agents,
  community,
}: {
  agents: ManagedAgent[];
  community: CommunityScope;
}) {
  const [open, setOpen] = React.useState(false);
  const [bindings, setBindings] = React.useState<RemoteAgencyBinding[]>([]);
  const channelsQuery = useChannelsQuery();
  const runtimesQuery = useManagedAgentRuntimesQuery();
  const refreshBindings = React.useCallback(() => {
    void listRemoteAgencies(community.id)
      .then(setBindings)
      .catch(() => setBindings([]));
  }, [community.id]);
  React.useEffect(refreshBindings, [refreshBindings]);
  const channelNames = React.useMemo(
    () =>
      new Map(
        (channelsQuery.data ?? []).map((channel) => [channel.id, channel.name]),
      ),
    [channelsQuery.data],
  );

  return (
    <section className="space-y-3" data-testid="remote-agencies-section">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Network className="size-4 text-primary" />
            Agency connections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connections on this device are scoped to {community.name}. Add more
            than one Agency runtime; each channel can name one primary Space.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} size="sm" variant="outline">
          <Plus />
          Add connection
        </Button>
      </div>
      {bindings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-5 text-sm text-muted-foreground">
          No Agency runtime is connected to {community.name} on this device. A
          connection projects reviewed agents and Space bindings through local
          Buzz proxy identities.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {bindings.map((binding) => {
            const proxyPubkeys = new Set(
              binding.proxies.map((proxy) => proxy.pubkey),
            );
            const connectionAgents = agents.filter((agent) =>
              proxyPubkeys.has(agent.pubkey),
            );
            const connected = connectionAgents.some((agent) => {
              const runtime = findManagedAgentRuntime(
                runtimesQuery.data ?? [],
                agent.pubkey,
                community.relayUrl,
              );
              return Boolean(
                runtime &&
                  runtime.lifecycle !== "stopped" &&
                  runtime.lifecycle !== "failed",
              );
            });
            return (
              <article
                className="rounded-xl border border-border/60 bg-card p-4"
                key={`${binding.agencyId}:${binding.sourceUrl}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Network className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">
                      {binding.agencyName || binding.agencyId}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {binding.sourceUrl}
                    </p>
                  </div>
                  <span
                    aria-hidden
                    className={`mt-1 size-2 rounded-full ${
                      connected ? "bg-success" : "bg-muted-foreground/50"
                    }`}
                  />
                  <span className="sr-only">
                    {connected ? "Connection running" : "Connection stopped"}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  <Badge variant="secondary">
                    {connectionAgents.length} agent
                    {connectionAgents.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline">
                    {binding.spaceBindings.length} Space
                    {binding.spaceBindings.length === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline">A2A</Badge>
                </div>
                {binding.spaceBindings.length > 0 ? (
                  <div className="mt-4 space-y-1.5 border-t border-border/50 pt-3 text-xs">
                    {binding.spaceBindings.map((spaceBinding) => (
                      <div
                        className="flex items-center justify-between gap-3"
                        key={`${spaceBinding.channelId}:${spaceBinding.spaceId}`}
                      >
                        <span className="truncate font-medium">
                          {spaceBinding.spaceName || spaceBinding.spaceId}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          → #
                          {channelNames.get(spaceBinding.channelId) ??
                            spaceBinding.channelId}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {connectionAgents.length > 0 ? (
                  <div className="mt-3 flex -space-x-2">
                    {connectionAgents.slice(0, 5).map((agent) => (
                      <UserAvatar
                        accent
                        avatarUrl={agent.avatarUrl}
                        className="size-7 border-2 border-card"
                        displayName={remoteDisplayName(agent)}
                        key={agent.pubkey}
                      />
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <RemoteAgencyDialog
        community={community}
        onBindingChange={refreshBindings}
        onOpenChange={setOpen}
        open={open}
      />
    </section>
  );
}
