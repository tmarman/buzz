import { Info, Network } from "lucide-react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { RemoteAgencyBinding } from "@/shared/api/remoteAgencyTypes";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";

const MAX_VISIBLE_MEMBER_AVATARS = 4;

type RemoteTeamIdentityCardProps = {
  agents: ManagedAgent[];
  binding: RemoteAgencyBinding;
};

export function RemoteTeamIdentityCard({
  agents,
  binding,
}: RemoteTeamIdentityCardProps) {
  const teamName = binding.name?.trim() || binding.agencyId;
  const members = binding.agentIds.map((agentId) => {
    const proxy = binding.proxies.find(
      (candidate) => candidate.agentId === agentId,
    );
    const agent = agents.find(
      (candidate) => candidate.pubkey === proxy?.pubkey,
    );
    return {
      id: agentId,
      name: agent?.name || agentId,
      avatarUrl: agent?.avatarUrl?.trim() || null,
    };
  });
  const visibleMembers = members.slice(0, MAX_VISIBLE_MEMBER_AVATARS);
  const overflowCount = Math.max(0, members.length - visibleMembers.length);
  const description = binding.description?.trim();

  return (
    <Card
      className="min-w-0 overflow-hidden rounded-2xl p-0 transition-colors hover:border-border hover:bg-muted/65"
      data-testid={`remote-team-card-${binding.agencyId}`}
    >
      <div className="relative aspect-[4/5] min-w-0 overflow-hidden bg-muted/50">
        <div className="absolute top-3 left-3 z-30 flex max-w-[calc(100%-4rem)] items-center gap-1.5">
          <Badge className="gap-1" variant="info">
            <Network className="h-3 w-3" />
            Remote
          </Badge>
          {description ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  aria-label={`${teamName} description`}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-border/65 bg-background/90 text-muted-foreground shadow-xs"
                  type="button"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs" side="bottom">
                <p>{description}</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

        <div className="absolute inset-x-0 top-0 bottom-12 flex items-center justify-center">
          <div
            aria-label={`${teamName} member avatars`}
            className="flex max-w-full items-center justify-center gap-2 px-4"
            role="img"
          >
            {visibleMembers.map((member, index) => (
              <div
                className="h-14 w-14"
                data-team-member-avatar="avatar"
                key={member.id}
              >
                {member.avatarUrl ? (
                  <ProfileAvatar
                    avatarUrl={member.avatarUrl}
                    className="h-full w-full border-[3px] border-background bg-muted shadow-sm"
                    iconClassName="h-6 w-6"
                    label={member.name}
                    testId={`remote-team-member-avatar-${member.id}`}
                  />
                ) : (
                  <IdentityInitialsAvatar
                    colorIndex={index}
                    label={member.name}
                    size={56}
                  />
                )}
              </div>
            ))}
            {overflowCount > 0 ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-background bg-card text-sm font-semibold text-muted-foreground shadow-sm">
                +{overflowCount}
              </span>
            ) : null}
          </div>
        </div>

        <div className="absolute right-3 bottom-3 left-3 z-30 flex min-w-0 flex-col gap-0.5 text-left text-sm leading-5">
          <span className="min-w-0 truncate font-semibold tracking-normal text-foreground">
            {teamName}
          </span>
          <span className="min-w-0 truncate text-xs font-normal text-secondary-foreground/75">
            {members.length} remote agent{members.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </Card>
  );
}
