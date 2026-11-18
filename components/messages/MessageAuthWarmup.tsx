"use client";

import { createClient } from "@supabase/supabase-js";
import { preloadSupabaseBrowserFactory } from "@/lib/authClient";

preloadSupabaseBrowserFactory(createClient);

export default function MessageAuthWarmup() {
  return null;
}
