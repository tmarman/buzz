const SURFACE_BASE_URL = "http://localhost:1337/surfaces/";

// Sandbox set for a first-party, locally-served surface loaded cross-origin
// from :1337. Surfaces are trusted (we ship them) but still run untrusted-shaped
// code, so we grant exactly what an app-like surface needs and withhold the
// tokens that would let it break out of its frame.
//
//   allow-scripts                  surfaces run JS
//   allow-same-origin              keeps the frame on the :1337 origin so it can
//                                  call its OWN API on :1337 with cookies/storage;
//                                  without it the frame gets an opaque origin and
//                                  every request to its API becomes cross-origin
//   allow-forms                    surfaces submit forms
//   allow-popups                   surfaces open links / auxiliary windows
//   allow-popups-to-escape-sandbox popups aren't themselves re-sandboxed
//   allow-modals                   alert / confirm / prompt
//   allow-downloads                surfaces export files
//
// Deliberately withheld: allow-top-navigation(-*) so a surface can never
// navigate the host desktop shell away from under the user.
const SURFACE_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

export function SurfaceFrame({ name }: { name: string }) {
  const src = `${SURFACE_BASE_URL}${encodeURIComponent(name)}/`;

  return (
    <iframe
      allow="clipboard-write; microphone"
      className="min-h-0 w-full flex-1 border-0"
      sandbox={SURFACE_SANDBOX}
      src={src}
      title={name}
    />
  );
}
