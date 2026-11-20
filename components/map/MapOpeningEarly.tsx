"use client";

import type { MouseEvent } from "react";
import type { OpeningPricedVenue } from "@/lib/mapOpeningPricedVenues";
import { venueMapUrl } from "@/lib/venueMapUrl";
import { MAP_OPENING_PREVIEW_CAMERA } from "@/lib/mapOpeningPreview";

const css = `
.mapEarly { display:none; position:fixed; inset:0; z-index:22; pointer-events:none; }
html[data-map-preview="on"][data-map-ground="on"][data-early-map="on"] .mapEarly { display:block; }
html[data-map-preview-discs="off"] .mapEarly { display:none !important; }
html[data-early-map="on"] .mapOpeningPreview { visibility:hidden; }
html[data-early-map="on"][data-map-preview="on"]:not([data-map-preview-discs="off"]) .mapCanvasWrap { pointer-events:none; }
.mapEarlyLink { position:absolute; visibility:hidden; box-sizing:border-box; width:44px; height:44px; display:flex; align-items:center; justify-content:center; border:2px solid currentColor; border-radius:50%; color:var(--ink); background:var(--paper); font-weight:700; text-decoration:none; pointer-events:auto; }
.mapEarlyLink[data-aging="true"] { border-style:dashed; }
.mapEarlyLink:focus-visible { outline:3px solid var(--coral); outline-offset:3px; }
.mapEarlyNote { position:absolute; left:12px; top:12px; padding:6px 10px; border-radius:8px; background:var(--paper); color:var(--ink); font-size:12px; }
`;

const initialise = `(function(){
var root=document.documentElement, layer=document.querySelector('.mapEarly');
if(!layer||root.dataset.mapPreview!=='on'||root.dataset.mapGround!=='on'||!window.CSS||!CSS.supports('container-type','size')||window.innerWidth>440||window.innerHeight>960||window.innerWidth>window.innerHeight)return;
try { if(localStorage.getItem('pubmaxx.mobile-map-session.v1')||localStorage.getItem('map-resume:v2:london:view')||localStorage.getItem('map-resume:v1:london:view'))return; } catch(e) { return; }
var w=window.innerWidth,h=window.innerHeight,d=1.5*h,p=Number(layer.dataset.pitch)*Math.PI/180,chosen=[],rules=[];
layer.querySelectorAll('a').forEach(function(a){
 var x=Number(a.dataset.x),y=Number(a.dataset.y),depth=d-y*Math.sin(p);
 if(!Number.isFinite(x)||!Number.isFinite(y)||depth<=0)return;
 var sx=w/2+x*d/depth,sy=h/2+y*Math.cos(p)*d/depth;
 if(sx<22||sx>w-22||sy<22||sy>h-22||chosen.some(function(q){return Math.abs(q.x-sx)<44&&Math.abs(q.y-sy)<44}))return;
 chosen.push({x:sx,y:sy}); rules.push('.mapEarlyLink[data-index="'+a.dataset.index+'"]{visibility:visible;left:'+(sx-22)+'px;top:'+(sy-22)+'px}');
});
if(!chosen.length)return;
var style=document.createElement('style'); style.textContent=rules.join(''); document.head.appendChild(style); root.dataset.earlyMap='on';
window.addEventListener('resize',function(){root.dataset.earlyMap='off';},{once:true});
window.addEventListener('pubmax:map-data-revision-skew',function(){root.dataset.earlyMap='off';},{once:true});
})();`;

export default function MapOpeningEarly({ venues }: { venues: readonly OpeningPricedVenue[] }) {
  function open(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const selection = new CustomEvent("pubmax:early-venue-select", { cancelable: true, detail: id });
    if (!window.dispatchEvent(selection)) event.preventDefault();
  }
  if (!venues.length) return null;
  return (
    <>
      <style>{css}</style>
      <div className="mapEarly" data-pitch={MAP_OPENING_PREVIEW_CAMERA.pitch} aria-label="Priced pubs while the map loads">
        <div className="mapEarlyNote">More pubs are loading. Open a pub for details.</div>
        {venues.map((venue, index) => (
          <a
            key={venue.id}
            href={venueMapUrl(venue.id)}
            className="mapEarlyLink"
            data-venue-id={venue.id}
            data-index={index}
            data-x={venue.x}
            data-y={venue.y}
            data-aging={venue.aging}
            aria-label={`${venue.name}, ${venue.figure}. Open for details`}
            onClick={(event) => open(event, venue.id)}
          >
            {venue.figure}
          </a>
        ))}
      </div>
      <script dangerouslySetInnerHTML={{ __html: initialise }} />
    </>
  );
}
