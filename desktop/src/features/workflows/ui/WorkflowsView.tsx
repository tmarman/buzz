import {
  Bot,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Plus,
  RefreshCw,
  Zap,
} from "lucide-react";
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { allWorkflowsQueryKey } from "@/features/workflows/hooks";
import {
  discoverAgencyAutomations,
  type AgencyAutomation,
} from "@/features/workflows/agencyAutomations";
import { WorkflowCard } from "@/features/workflows/ui/WorkflowCard";
import { WorkflowDeleteDialog } from "@/features/workflows/ui/WorkflowDeleteDialog";
import { WorkflowDetailPanel } from "@/features/workflows/ui/WorkflowDetailPanel";
import { WorkflowDialog } from "@/features/workflows/ui/WorkflowDialog";
import type { Channel, Workflow } from "@/shared/api/types";
import {
  deleteWorkflow,
  getChannelsWorkflows,
  triggerWorkflow,
} from "@/shared/api/tauriWorkflows";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";

type WorkflowsViewProps = {
  channels: Channel[];
  onCloseWorkflow: () => void;
  onSelectWorkflow: (workflowId: string) => void;
  selectedWorkflowId: string | null;
};

type WorkflowWithChannel = {
  workflow: Workflow;
  channelName: string;
};

type DialogState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; workflow: Workflow }
  | { mode: "duplicate"; workflow: Workflow };

function automationName(name: string): string {
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function AgencyAutomationCard({
  automation,
}: {
  automation: AgencyAutomation;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bot className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {automationName(automation.name)}
            </span>
            <Badge variant={automation.enabled ? "success" : "secondary"}>
              {automation.enabled ? "active" : "paused"}
            </Badge>
          </div>
          {automation.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {automation.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {automation.ownerAgent ? (
              <Badge variant="outline">{automation.ownerAgent}</Badge>
            ) : null}
            {automation.triggers.map((trigger) => (
              <Badge key={trigger} variant="secondary">
                {trigger}
              </Badge>
            ))}
            <Badge className="gap-1" variant="outline">
              <MessageSquare className="h-3 w-3" />
              Thread contract
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

function WorkflowsListSkeleton() {
  return (
    <div className="space-y-2">
      {["first", "second", "third", "fourth"].map((card) => (
        <Card className="p-4" key={card}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full max-w-2xl" />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
            <div className="hidden shrink-0 gap-2 sm:flex">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function WorkflowsView({
  channels,
  onCloseWorkflow,
  onSelectWorkflow,
  selectedWorkflowId,
}: WorkflowsViewProps) {
  const [dialogState, setDialogState] = React.useState<DialogState>({
    mode: "closed",
  });
  const [deleteTarget, setDeleteTarget] = React.useState<Workflow | null>(null);
  const [showAllAgencyAutomations, setShowAllAgencyAutomations] =
    React.useState(false);
  const queryClient = useQueryClient();

  const memberChannels = channels.filter((c) => c.isMember);
  const channelIds = memberChannels.map((c) => c.id).sort();
  const channelIdKey = channelIds.join(",");

  const allWorkflowsQuery = useQuery({
    queryKey: allWorkflowsQueryKey(channelIdKey),
    queryFn: async () => {
      // Single batched relay query for all member channels, then group by the
      // channel_id each workflow carries — replaces the per-channel fanout.
      const channelNameById = new Map(
        memberChannels.map((channel) => [channel.id, channel.name]),
      );
      const workflows = await getChannelsWorkflows(channelIds);
      const results: WorkflowWithChannel[] = [];
      for (const workflow of workflows) {
        results.push({
          workflow,
          channelName: workflow.channelId
            ? (channelNameById.get(workflow.channelId) ?? "")
            : "",
        });
      }
      return results;
    },
    enabled: memberChannels.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const allWorkflows = allWorkflowsQuery.data ?? [];
  const agencyAutomationsQuery = useQuery({
    queryKey: ["agency-automations"],
    queryFn: discoverAgencyAutomations,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const agencyAutomations = agencyAutomationsQuery.data ?? [];
  const visibleAgencyAutomations = showAllAgencyAutomations
    ? agencyAutomations
    : agencyAutomations.slice(0, 6);
  const isRefreshing =
    allWorkflowsQuery.isFetching || agencyAutomationsQuery.isFetching;

  const triggerMutation = useMutation({
    mutationFn: (workflowId: string) => triggerWorkflow(workflowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "workflow-runs",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => deleteWorkflow(workflowId),
    onSuccess: (_data, workflowId) => {
      if (selectedWorkflowId === workflowId) {
        onCloseWorkflow();
      }
      void queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "workflows" ||
          query.queryKey[0] === "workflows-all",
      });
    },
  });

  const triggerOne = triggerMutation.mutate;
  const handleTrigger = React.useCallback(
    (workflowId: string) => triggerOne(workflowId),
    [triggerOne],
  );

  const handleDelete = React.useCallback(
    (workflow: Workflow) => setDeleteTarget(workflow),
    [],
  );

  const deleteOne = deleteMutation.mutate;
  const handleConfirmDelete = React.useCallback(
    (workflow: Workflow) => {
      deleteOne(workflow.id);
      setDeleteTarget(null);
    },
    [deleteOne],
  );

  const handleEdit = React.useCallback(
    (workflow: Workflow) => setDialogState({ mode: "edit", workflow }),
    [],
  );

  const handleDuplicate = React.useCallback(
    (workflow: Workflow) => setDialogState({ mode: "duplicate", workflow }),
    [],
  );

  const handleDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      setDialogState({ mode: "closed" });
    }
  }, []);

  return (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden"
      data-testid="workflows-view"
    >
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4 pt-4"
        data-scroll-restoration-id="workflows-list"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Workflows</h2>
            <Button
              aria-label="Refresh workflows"
              disabled={isRefreshing}
              onClick={() => {
                void allWorkflowsQuery.refetch();
                void agencyAutomationsQuery.refetch();
              }}
              size="icon"
              variant="ghost"
            >
              <RefreshCw
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>
          <Button onClick={() => setDialogState({ mode: "create" })} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            Create Workflow
          </Button>
        </div>

        {agencyAutomations.length > 0 ? (
          <section className="mb-6">
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Agency automations</h3>
                <Badge variant="secondary">{agencyAutomations.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Scheduled work from connected runtimes. The Agency contract
                projects each run into an ordinary task thread.
              </p>
            </div>
            <div className="grid gap-2 xl:grid-cols-2">
              {visibleAgencyAutomations.map((automation) => (
                <AgencyAutomationCard
                  automation={automation}
                  key={automation.id}
                />
              ))}
            </div>
            {agencyAutomations.length > 6 ? (
              <Button
                className="mt-2"
                onClick={() => setShowAllAgencyAutomations((value) => !value)}
                size="sm"
                variant="ghost"
              >
                {showAllAgencyAutomations ? (
                  <ChevronUp className="mr-1 h-4 w-4" />
                ) : (
                  <ChevronDown className="mr-1 h-4 w-4" />
                )}
                {showAllAgencyAutomations
                  ? "Show fewer"
                  : `Show all ${agencyAutomations.length}`}
              </Button>
            ) : null}
          </section>
        ) : null}

        {allWorkflowsQuery.isLoading ? (
          <WorkflowsListSkeleton />
        ) : allWorkflowsQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-sm text-red-400">Failed to load workflows</p>
            <Button
              onClick={() => void allWorkflowsQuery.refetch()}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : allWorkflows.length === 0 && agencyAutomations.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Zap className="h-10 w-10 opacity-30" />
            <p className="text-sm">No workflows yet</p>
            <Button
              onClick={() => setDialogState({ mode: "create" })}
              size="sm"
              variant="outline"
            >
              <Plus className="mr-1 h-4 w-4" />
              Create your first workflow
            </Button>
          </div>
        ) : allWorkflows.length > 0 ? (
          <section>
            {agencyAutomations.length > 0 ? (
              <h3 className="mb-3 text-sm font-semibold">Buzz workflows</h3>
            ) : null}
            <div className="space-y-2">
              {allWorkflows.map(({ workflow, channelName }) => (
                <WorkflowCard
                  channelName={channelName}
                  isActive={selectedWorkflowId === workflow.id}
                  key={workflow.id}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onEdit={handleEdit}
                  onSelect={onSelectWorkflow}
                  onTrigger={handleTrigger}
                  workflow={workflow}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {selectedWorkflowId ? (
        <div className="w-[400px] shrink-0">
          <WorkflowDetailPanel
            key={selectedWorkflowId}
            onClose={onCloseWorkflow}
            onEdit={handleEdit}
            workflowId={selectedWorkflowId}
          />
        </div>
      ) : null}

      <WorkflowDialog
        channels={memberChannels}
        mode={dialogState.mode === "closed" ? "create" : dialogState.mode}
        onOpenChange={handleDialogOpenChange}
        open={dialogState.mode !== "closed"}
        workflow={
          dialogState.mode === "edit" || dialogState.mode === "duplicate"
            ? dialogState.workflow
            : null
        }
      />

      <WorkflowDeleteDialog
        onConfirm={handleConfirmDelete}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        workflow={deleteTarget}
      />
    </div>
  );
}
