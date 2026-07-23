const SURFACE_BASE_URL = "http://localhost:1337/surfaces/";

export function SurfaceScreen({ name }: { name: string }) {
  const src = `${SURFACE_BASE_URL}${encodeURIComponent(name)}/`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <iframe
        allow="clipboard-write; microphone"
        className="min-h-0 w-full flex-1 border-0"
        src={src}
        title={name}
      />
    </div>
  );
}
