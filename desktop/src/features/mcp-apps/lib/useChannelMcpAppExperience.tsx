import { openUrl } from "@tauri-apps/plugin-opener";
import * as React from "react";

import { mcpAppMessageText } from "@/features/mcp-apps/lib/mcpAppMessage";
import { useChannelMcpApps } from "@/features/mcp-apps/lib/useChannelMcpApps";
import { ChannelMcpAppDialog } from "@/features/mcp-apps/ui/ChannelMcpAppDialog";
import { ChannelMcpAppPane } from "@/features/mcp-apps/ui/ChannelMcpAppPane";
import { ChannelMcpAppTabs } from "@/features/mcp-apps/ui/ChannelMcpAppTabs";
import type { Channel } from "@/shared/api/types";

type SendChannelMessage = (
  content: string,
  mentionPubkeys: string[],
  mediaTags?: string[][],
  channelId?: string | null,
) => Promise<void>;

export function useMcpAppUi(
  channel: Channel | null,
  pubkey: string | null | undefined,
  sendMessage: SendChannelMessage,
) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const apps = useChannelMcpApps({
    channelId: channel?.id ?? null,
    pubkey,
  });
  const handleMessage = React.useCallback(
    async (message: Parameters<typeof mcpAppMessageText>[0]) => {
      if (!channel?.isMember || channel.archivedAt) {
        throw new Error("This channel is read-only.");
      }
      const content = mcpAppMessageText(message);
      if (!content) {
        throw new Error("The app message did not contain text.");
      }
      await sendMessage(content, [], undefined, channel.id);
    },
    [channel, sendMessage],
  );
  const handleOpenLink = React.useCallback(async (raw: string) => {
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      await openUrl(url.toString());
      return true;
    } catch {
      return false;
    }
  }, []);
  const dialog =
    channel && pubkey ? (
      <ChannelMcpAppDialog
        apps={apps.apps}
        channelId={channel.id}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        pubkey={pubkey}
      />
    ) : null;
  const navigation =
    channel?.channelType !== "forum" &&
    channel?.isMember &&
    !channel.archivedAt ? (
      <>
        <ChannelMcpAppTabs
          activeAppId={apps.activeAppId}
          apps={apps.apps}
          onActivateApp={apps.activateApp}
          onOpenApps={() => setDialogOpen(true)}
          onShowChat={apps.showChat}
        />
        {dialog}
      </>
    ) : undefined;
  const renderPane = React.useCallback(
    (header: React.ReactNode) =>
      apps.activeApp ? (
        <ChannelMcpAppPane
          app={apps.activeApp}
          header={header}
          onMessage={handleMessage}
          onOpenLink={handleOpenLink}
        />
      ) : null,
    [apps.activeApp, handleMessage, handleOpenLink],
  );

  return {
    active: apps.activeApp !== null,
    navigation,
    renderPane,
  };
}
