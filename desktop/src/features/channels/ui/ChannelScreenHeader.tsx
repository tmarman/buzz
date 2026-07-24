import { LayoutGrid, LogIn, MessageSquare, Pencil } from "lucide-react";
import type * as React from "react";

import { ChatHeader } from "@/features/chat/ui/ChatHeader";
import { ChannelSurfacePickerSection } from "@/features/channels/ui/ChannelSurfacePicker";
import type { ChannelSurfaceTabHandle } from "@/features/channels/ui/useChannelSurfaceTab";
import type { EphemeralChannelDisplay } from "@/features/channels/lib/ephemeralChannel";
import type { ActiveDmHeaderParticipant } from "@/features/channels/useActiveChannelHeader";
import { getChannelDescription } from "@/features/channels/lib/channelDescription";
import { getDmParticipantPreview } from "@/features/channels/lib/dmParticipantDisplay";
import { ChannelHeaderStatusBadge } from "@/features/channels/ui/ChannelHeaderStatusBadge";
import { ChannelMembersBar } from "@/features/channels/ui/ChannelMembersBar";
import { ImportedSpaceIcon } from "@/features/channels/ui/ImportedSpaceIcon";
import { SurfaceIcon } from "@/features/surfaces/ui/SurfaceIcon";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "@/features/profile/ui/ProfileAvatarWithStatus";
import { Button } from "@/shared/ui/button";
import type { Channel, PresenceStatus } from "@/shared/api/types";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { UserAvatar } from "@/shared/ui/UserAvatar";

const DM_HEADER_AVATAR_SIZE = 32;
const DM_HEADER_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_HEADER_AVATAR_SIZE,
);

type ChannelScreenHeaderProps = {
  activeChannel: Channel | null;
  activeChannelEphemeralDisplay: EphemeralChannelDisplay | null;
  activeChannelTitle: string;
  actionsVariant?: "inline" | "compact";
  activeDmAvatarUrl: string | null;
  activeDmHeaderParticipants: ActiveDmHeaderParticipant[];
  activeDmPresenceStatus: PresenceStatus | null;
  chromeWrapperRef?: React.Ref<HTMLDivElement>;
  currentPubkey?: string;
  isAddBotOpen?: boolean;
  isJoining?: boolean;
  showHeaderContent?: boolean;
  surfaceTab?: ChannelSurfaceTabHandle;
  transparentChrome?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onJoinChannel?: () => Promise<void>;
  onManageChannel: () => void;
  onToggleMembers: () => void;
};

export function ChannelScreenHeader({
  activeChannel,
  activeChannelEphemeralDisplay,
  activeChannelTitle,
  actionsVariant = "inline",
  activeDmAvatarUrl,
  activeDmHeaderParticipants,
  activeDmPresenceStatus,
  chromeWrapperRef,
  currentPubkey,
  isAddBotOpen,
  isJoining = false,
  onAddBotOpenChange,
  showHeaderContent = true,
  transparentChrome = false,
  onJoinChannel,
  onManageChannel,
  onToggleMembers,
  surfaceTab,
}: ChannelScreenHeaderProps) {
  const isGroupDm =
    activeChannel?.channelType === "dm" &&
    activeDmHeaderParticipants.length > 1;
  const showJoinButton =
    activeChannel !== null &&
    !activeChannel.isMember &&
    activeChannel.visibility === "open" &&
    !activeChannel.archivedAt &&
    onJoinChannel;

  const surfaceTabs =
    surfaceTab && surfaceTab.tabs.length > 0 ? (
      <div
        aria-label="Channel views"
        className="flex items-center gap-0.5"
        data-testid="channel-surface-tabs"
        role="tablist"
      >
        <Button
          aria-pressed={!surfaceTab.isAppActive}
          data-testid="channel-chat-tab"
          onClick={surfaceTab.deactivate}
          size="sm"
          type="button"
          variant={!surfaceTab.isAppActive ? "secondary" : "ghost"}
        >
          <MessageSquare className="mr-1.5 h-4 w-4" />
          Chat
        </Button>
        {surfaceTab.tabs.map((tab) => {
          const active = surfaceTab.activeSurface === tab.surface;
          return (
            <Button
              aria-pressed={active}
              data-testid={`channel-surface-tab-${tab.surface}`}
              key={tab.surface}
              onClick={() => surfaceTab.activate(tab.surface)}
              size="sm"
              type="button"
              variant={active ? "secondary" : "ghost"}
            >
              <SurfaceIcon
                className="mr-1.5 h-4 w-4"
                icon={tab.mode === "frame" ? tab.descriptor.icon : tab.surface}
              />
              {tab.surface}
            </Button>
          );
        })}
        {surfaceTab.activeState?.mode === "frame" &&
        surfaceTab.activeState.descriptor.ownerAgent ? (
          <span
            title={`Editing will open a chat with ${surfaceTab.activeState.descriptor.ownerAgent}`}
          >
            <Button
              aria-label={`Edit ${surfaceTab.activeState.surface}`}
              disabled
              size="icon"
              type="button"
              variant="ghost"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </span>
        ) : null}
      </div>
    ) : null;

  const surfacePicker =
    activeChannel && currentPubkey ? (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            aria-label={
              surfaceTab?.tabs.length
                ? "Manage channel apps"
                : "Add channel app"
            }
            data-testid="channel-surface-picker-trigger"
            size={actionsVariant === "compact" ? "icon" : "sm"}
            type="button"
            variant="outline"
          >
            <LayoutGrid className="h-4 w-4" />
            {actionsVariant === "inline" ? (
              <span>{surfaceTab?.tabs.length ? "Apps" : "Add app"}</span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-3">
          <ChannelSurfacePickerSection
            channelId={activeChannel.id}
            pubkey={currentPubkey}
          />
        </PopoverContent>
      </Popover>
    ) : null;

  const actions = activeChannel ? (
    <div className="flex items-center gap-1">
      {surfaceTabs}
      {surfacePicker}
      {showJoinButton ? (
        <Button
          disabled={isJoining}
          onClick={() => void onJoinChannel()}
          size="sm"
          variant="default"
        >
          <LogIn className="mr-1.5 h-4 w-4" />
          {isJoining ? "Joining…" : "Join"}
        </Button>
      ) : (
        <ChannelMembersBar
          channel={activeChannel}
          currentPubkey={currentPubkey}
          isAddBotOpen={isAddBotOpen}
          onAddBotOpenChange={onAddBotOpenChange}
          onManageChannel={onManageChannel}
          onToggleMembers={onToggleMembers}
          variant={actionsVariant}
        />
      )}
    </div>
  ) : null;

  if (!showHeaderContent) {
    return null;
  }

  return (
    <ChatHeader
      belowSystemChrome
      chromeWrapperRef={chromeWrapperRef}
      actions={actions}
      channelType={activeChannel?.channelType}
      description={getChannelDescription(activeChannel)}
      leadingContent={
        activeChannel?.channelType === "dm" ? (
          isGroupDm ? (
            <DmHeaderParticipantStack
              participants={activeDmHeaderParticipants}
            />
          ) : (
            <ProfileAvatarWithStatus
              avatarClassName="text-xs"
              avatarUrl={activeDmAvatarUrl}
              className="mr-1.5 h-8 w-8"
              geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY}
              iconClassName="h-4 w-4"
              label={activeChannelTitle}
              size={DM_HEADER_AVATAR_SIZE}
              status={activeDmPresenceStatus ?? "offline"}
              statusTestId="chat-presence-badge"
              testId="chat-header-dm-avatar"
            />
          )
        ) : surfaceTab?.space ? (
          <ImportedSpaceIcon
            className="mr-1.5 h-5 w-5 text-primary"
            isPrivate={activeChannel?.visibility === "private"}
          />
        ) : undefined
      }
      statusBadge={
        <ChannelHeaderStatusBadge
          ephemeralDisplay={activeChannelEphemeralDisplay}
        />
      }
      title={activeChannelTitle}
      transparentChrome={transparentChrome}
      visibility={activeChannel?.visibility}
    />
  );
}

function DmHeaderParticipantStack({
  participants,
}: {
  participants: ActiveDmHeaderParticipant[];
}) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);

  return (
    <div
      aria-hidden="true"
      className="mr-1.5 flex shrink-0 items-center"
      data-testid="chat-header-dm-avatar-stack"
    >
      {visibleParticipants.map((participant, index) => (
        <div
          className={index > 0 ? "-ml-2" : ""}
          data-testid="chat-header-dm-avatar-stack-participant"
          key={participant.pubkey}
          style={{
            zIndex: index + 1,
            ...(index < stackItemCount - 1 && {
              mask: "radial-gradient(circle 18px at calc(100% + 4px) 50%, transparent 99%, #fff 100%)",
              WebkitMask:
                "radial-gradient(circle 18px at calc(100% + 4px) 50%, transparent 99%, #fff 100%)",
            }),
          }}
        >
          <UserAvatar
            avatarUrl={participant.avatarUrl}
            className="h-8 w-8 text-xs"
            displayName={participant.displayName}
            size="sm"
          />
        </div>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={visibleParticipants.length > 0 ? "-ml-2" : ""}
          data-testid="chat-header-dm-avatar-stack-more"
          style={{ zIndex: stackItemCount }}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-2xs leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
