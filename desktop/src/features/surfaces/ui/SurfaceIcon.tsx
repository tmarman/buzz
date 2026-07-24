import {
  AppWindow,
  AudioLines,
  ChartNoAxesCombined,
  ContactRound,
  Grid3X3,
  House,
  Radar,
  SlidersHorizontal,
  Workflow,
} from "lucide-react";

const ICONS = {
  "audio-lines": AudioLines,
  "chart-no-axes-combined": ChartNoAxesCombined,
  "contact-round": ContactRound,
  "grid-3x3": Grid3X3,
  house: House,
  radar: Radar,
  "sliders-horizontal": SlidersHorizontal,
  workflow: Workflow,
} as const;

export function SurfaceIcon({
  className,
  icon,
}: {
  className?: string;
  icon?: string;
}) {
  const Icon = ICONS[icon?.trim() as keyof typeof ICONS] ?? AppWindow;
  return <Icon aria-hidden="true" className={className} />;
}
