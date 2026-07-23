import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

const SurfaceScreen = React.lazy(async () => {
  const module = await import("@/features/surfaces/ui/SurfaceScreen");
  return { default: module.SurfaceScreen };
});

export const Route = createFileRoute("/surfaces/$name")({
  component: SurfaceRouteComponent,
});

function SurfaceRouteComponent() {
  const { name } = Route.useParams();

  return (
    <React.Suspense fallback={null}>
      <SurfaceScreen name={name} />
    </React.Suspense>
  );
}
