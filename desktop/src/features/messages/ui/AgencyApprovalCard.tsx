import { Check, Clock, ShieldAlert, X } from "lucide-react";

import type { AgencyApprovalBlock } from "@/features/messages/lib/agencyMessageBlocks";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

export function AgencyApprovalCard({
  approval,
}: {
  approval: AgencyApprovalBlock;
}) {
  const pending = approval.status === "pending";

  return (
    <section
      className="mt-2 max-w-xl rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
      data-testid="agency-approval-card"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {approval.title}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide",
                pending
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {approval.status}
            </span>
          </div>
          {approval.summary ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {approval.summary}
            </p>
          ) : null}
          <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-[6rem_1fr]">
            <dt className="text-muted-foreground">Capability</dt>
            <dd className="break-all font-mono text-foreground">
              {approval.capability}
            </dd>
            <dt className="text-muted-foreground">Target</dt>
            <dd className="break-all text-foreground">{approval.target}</dd>
            <dt className="text-muted-foreground">Requested by</dt>
            <dd className="text-foreground">{approval.requested_by}</dd>
            {approval.owner ? (
              <>
                <dt className="text-muted-foreground">Owner</dt>
                <dd className="text-foreground">{approval.owner}</dd>
              </>
            ) : null}
            {approval.risk ? (
              <>
                <dt className="text-muted-foreground">Risk</dt>
                <dd className="capitalize text-foreground">{approval.risk}</dd>
              </>
            ) : null}
          </dl>
          {approval.expires_at ? (
            <p className="mt-2 flex items-center gap-1 text-2xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              Expires {new Date(approval.expires_at).toLocaleString()}
            </p>
          ) : null}
          {pending ? (
            <>
              <div className="mt-3 flex gap-2">
                <Button disabled size="sm" type="button">
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button disabled size="sm" type="button" variant="outline">
                  <X className="mr-1 h-3.5 w-3.5" />
                  Deny
                </Button>
              </div>
              <p className="mt-1.5 text-2xs text-muted-foreground">
                Join this remote agent to respond with a signed decision.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
