import { PAL_VOICE_MAX_SESSION_SECONDS, PAL_VOICE_MONTHLY_MINUTES } from "@/lib/palVoiceMetering";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { postgresSkipReason, startPostgres, type PostgresSession } from "./helpers/postgres";
const owner="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const migration="20260922002000_0157_pub_pal_prepaid_voice_grants";
let db:PostgresSession;
beforeAll(async()=>{
 if(postgresSkipReason())return;
 db=await startPostgres("voice-grants");
 db.sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${owner}'),('${other}');
 create table public.pub_pal_voice_usage(owner_id uuid references auth.users(id),usage_month date,session_count integer not null default 0,used_minutes integer not null default 0,primary key(owner_id,usage_month));
 grant usage on schema public to anon,authenticated,service_role;`);
 db.applyFile(join(process.cwd(),"supabase/migrations",migration+".sql"));
},180000);
beforeEach(()=>{db?.sql("truncate public.pub_pal_voice_grants,public.pub_pal_voice_usage;");});
afterAll(async()=>{await db?.stop();});
function grant(id:string,month="2026-09-01") {return `set role service_role;select public.prepay_pub_pal_voice_grant('${owner}','${month}','${id}');`;}
function id(n:number){return `33333333-3333-4333-8333-${String(n).padStart(12,"0")}`;}
describe.skipIf(postgresSkipReason()!==null)("prepaid voice grants",()=>{
 it("serializes competing grants at the monthly ceiling",async()=>{
  const results=await db.concurrentResults(Array.from({length:15},(_,i)=>grant(id(i))));
  expect(results.filter(x=>x.trim()==="t")).toHaveLength(10);
  expect(db.sql("select used_minutes from public.pub_pal_voice_usage")).toBe(String(PAL_VOICE_MONTHLY_MINUTES));
  expect(db.sql("select count(*) from public.pub_pal_voice_grants")).toBe("10");
 });
 it("refuses replay and refunds exactly once to its original month",()=>{
  expect(db.sql(grant(id(1)))).toBe("t");expect(db.sql(grant(id(1)))).toBe("f");
  expect(db.sql(grant(id(2),"2026-10-01"))).toBe("t");
  expect(db.sql(`set role service_role;select public.refund_pub_pal_voice_grant('${other}','${id(1)}')`)).toBe("f");
  expect(db.sql(`set role service_role;select public.refund_pub_pal_voice_grant('${owner}','${id(1)}')`)).toBe("t");
  expect(db.sql(`set role service_role;select public.refund_pub_pal_voice_grant('${owner}','${id(1)}')`)).toBe("f");
  expect(db.sql(grant(id(1)))).toBe("f");
  expect(db.sql("select used_minutes from public.pub_pal_voice_usage order by usage_month")).toBe("0\n3");
 });
 it("denies browser-role grant, refund, and ledger reads",()=>{
  for(const role of ["anon","authenticated"]){
   db.expectRefusal(`set role ${role};select public.prepay_pub_pal_voice_grant('${owner}','2026-09-01','${id(1)}')`);
   db.expectRefusal(`set role ${role};select public.refund_pub_pal_voice_grant('${owner}','${id(1)}')`);
   db.expectRefusal(`set role ${role};select * from public.pub_pal_voice_grants`);
  }
 });
 it("keeps already charged allowance through rollback",()=>{
  db.sql(grant(id(1)));
  db.applyFile(join(process.cwd(),"supabase/migrations/rollback",migration+"_rollback.sql"));
  expect(db.sql("select used_minutes from public.pub_pal_voice_usage")).toBe(String(Math.ceil(PAL_VOICE_MAX_SESSION_SECONDS / 60)));
  expect(db.sql("select to_regclass('public.pub_pal_voice_grants') is null")).toBe("t");
  db.applyFile(join(process.cwd(),"supabase/migrations",migration+".sql"));
 });
});
