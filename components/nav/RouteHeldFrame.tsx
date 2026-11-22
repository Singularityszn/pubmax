// The shape of a page that has not arrived, drawn at the positions the real
// page gives its own parts, so the page lands on its outline. It reads nothing
// and holds no words, so the route shell (RouteLoadingShell) and the tab hop
// (TabHopHeldFrame) draw the same frame.
//
// Three shapes, because the five tabs open three kinds of page:
//   screen   a kicker, a heading, one control and rows: the Screen primitive
//            (components/ui/screen.tsx), which Plan, Social and Stories open on
//   segment  the Day and Tonight switch above that head (NowSegment.tsx)
//   card     one raised card, with a face and a name, and rows: the You page

export type RouteHeldFrameShape = "screen" | "segment" | "card";

export default function RouteHeldFrame({ shape = "screen" }: { shape?: RouteHeldFrameShape }) {
  return (
    <div className={`routeHeldFrame routeHeldFrame--${shape}`} aria-hidden="true">
      {shape === "card" ? (
        <span className="routeHeldFrameCard">
          <span className="routeHeldFrameAvatar" />
          <span className="routeHeldFrameKicker" />
          <span className="routeHeldFrameTitle" />
        </span>
      ) : (
        <>
          {shape === "segment" ? <span className="routeHeldFrameSegment" /> : null}
          <span className="routeHeldFrameKicker" />
          <span className="routeHeldFrameTitle" />
          <span className="routeHeldFrameControl" />
        </>
      )}
      <span className="routeHeldFrameRow" />
      <span className="routeHeldFrameRow" />
      <span className="routeHeldFrameRow" />
    </div>
  );
}
