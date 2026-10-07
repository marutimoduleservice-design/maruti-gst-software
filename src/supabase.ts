import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://pawbjcpiwspstdqhuhgt.supabase.co";

const supabaseKey =
  "sb_publishable_PvJ_hLB1vucFR8xD0Vmn5w_C4X2H9I8";

export const supabase = createClient(supabaseUrl, supabaseKey);