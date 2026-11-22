import "server-only";

import { POST as generate } from "@/app/api/plans/generate/route";
import { PLAN_STARTER_ASK, planStarterRequestBody, planStarterView, type PlanStarterView } from "@/lib/planStarter";

/**
 * The priced route /plan is prerendered with (lib/planStarter.ts): the
 * generate route's own answer, asked in process once a build or revalidation,
 * never once a visitor. Any refusal or fault answers null, and the page
 * renders without a starter.
 */
export async function prerenderedPlanStarter(): Promise<PlanStarterView | null> {
  try {
    const response = await generate(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(planStarterRequestBody(PLAN_STARTER_ASK)),
    }));
    return response.ok ? planStarterView(PLAN_STARTER_ASK, await response.json()) : null;
  } catch {
    return null;
  }
}
