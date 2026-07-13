import { jsonNoStore } from "@/lib/apiResponses";
import { getNightArea } from "@/lib/nightAreas";
import { isNightAreaSlug } from "@/lib/nightPlanning";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  const { slug } = await context.params;
  if (!isNightAreaSlug(slug)) return jsonNoStore({ error: "Night Area not found." }, { status: 404 });
  return jsonNoStore(getNightArea(slug));
}
