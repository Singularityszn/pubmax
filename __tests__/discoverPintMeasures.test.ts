import {expect,it} from 'vitest';
import {cheapestTonight} from '@/lib/leaderboard';
import {pickDiscoverDrops} from '@/lib/discoverDrops';
it('preserves servings from the API and ranks only pints, including legacy pints',()=>{
 const now=Date.parse('2026-09-21T18:00:00Z');
 const drops=pickDiscoverDrops({drops:[{venueId:'half',drink:'Lager',measure:'half',priceGbp:2.6},{venueId:'pint',drink:'Lager',measure:'pint',priceGbp:5},{venueId:'legacy',drink:'Lager',priceGbp:6},{venueId:'bad',drink:'Lager',measure:'invalid',priceGbp:1}].map(d=>({...d,createdAt:new Date(now).toISOString()}))});
 expect(drops[0]).toMatchObject({drink:'Lager',measure:'half'});
 expect(cheapestTonight(drops,{now}).map(d=>d.venueId)).toEqual(['pint','legacy']);
});
