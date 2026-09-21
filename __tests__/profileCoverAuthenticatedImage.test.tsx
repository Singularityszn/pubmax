// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ accountRevision: 1, user: { id: "owner" }, providerAuthState: "authenticated" }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
const transport = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authedFetch", () => ({ authedFetch: transport }));
vi.mock("next/image", () => ({ default: ({ src, alt, className }: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement("img", { src, alt, className }) }));
import ProfileCoverCarousel from "@/components/profile/ProfileCoverCarousel";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(()=>vi.restoreAllMocks());
it("loads cover bytes with viewer credentials and releases them on account change",async()=>{
 const create=vi.fn(()=>"blob:cover-1"),revoke=vi.fn();
 Object.defineProperty(URL,"createObjectURL",{configurable:true,value:create});Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
 transport.mockResolvedValue(new Response(new Blob(["cover"],{type:"image/jpeg"})));
 const el=document.createElement("div"); const root=createRoot(el);
 const cover="/api/cover/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
 await act(async()=>root.render(<ProfileCoverCarousel covers={[cover]}/>));
 expect(transport).toHaveBeenCalledWith(expect.stringContaining(cover),expect.objectContaining({cache:"no-store",redirect:"error"}),{requiresIdentity:true});
 expect(el.querySelector("img")?.getAttribute("src")).toBe("blob:cover-1");
 transport.mockResolvedValue(new Response(null,{status:404}));auth.accountRevision=2;auth.user={id:"stranger"};
 await act(async()=>root.render(<ProfileCoverCarousel covers={[cover]}/>));
 expect(revoke).toHaveBeenCalledWith("blob:cover-1");
 expect(el.querySelector("img")).toBeNull();
 await act(async()=>root.unmount());
});
