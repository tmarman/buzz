import { Boxes, Lock } from "lucide-react";

export function ImportedSpaceIcon({
  className,
  isPrivate = false,
}: {
  className?: string;
  isPrivate?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex shrink-0 items-center justify-center ${className ?? ""}`}
    >
      <Boxes className="h-full w-full" />
      {isPrivate ? (
        <span className="absolute -bottom-1 -right-1 rounded-full bg-sidebar p-px">
          <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
        </span>
      ) : null}
    </span>
  );
}
