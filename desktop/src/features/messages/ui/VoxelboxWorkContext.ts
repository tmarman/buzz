import * as React from "react";

export type VoxelboxWorkContextValue = {
  participantId: string | null;
  space: string | null;
};

export const VoxelboxWorkContext =
  React.createContext<VoxelboxWorkContextValue>({
    participantId: null,
    space: null,
  });
