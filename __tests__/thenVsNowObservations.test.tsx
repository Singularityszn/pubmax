import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import ThenVsNowCard from '@/components/discovery/ThenVsNowCard';
import {computeThenVsNow} from '@/lib/thenVsNow';
it('prints drink, serving and dates without a movement claim for unlike observations',()=>{
 const [item]=computeThenVsNow([{id:'a',name:'A',cheapestPrice:4,cheapestPint:'Lager',observedAt:'2026-01-01T00:00:00Z'}],[{venueId:'a',priceGbp:7,drink:'Stout',measure:'half',createdAt:'2026-09-21T18:00:00Z'}]);
 const html=renderToStaticMarkup(createElement(ThenVsNowCard,{item}));
 expect(html).toContain('2026-01-01');expect(html).toContain('2026-09-21');
 expect(html).toContain('Lager');expect(html).toContain('Stout');
 expect(html).toContain('No price-change comparison');expect(html).not.toContain('%');expect(html).not.toContain('tvnDelta-up');
});
