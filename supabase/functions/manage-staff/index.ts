import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["owner", "manager", "staff"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}.`);
  return value;
}

function getServiceClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function getStaffRequester(
  request: Request,
  serviceClient: ReturnType<typeof getServiceClient>
) {
  const authHeader = request.headers.get("Authorization") || "";
  const authClient = createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    }
  );

  const { data: userData, error: userError } = await authClient.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("Acces refuse: session equipe requise.");
  }

  const { data: adminUser, error: adminError } = await serviceClient
    .from("admin_users")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (adminError || !["owner", "manager"].includes(String(adminUser?.role || ""))) {
    throw new Error("Acces refuse: personnel reserve au manager et au super admin.");
  }

  return {
    ...userData.user,
    role: String(adminUser?.role || ""),
  };
}

async function listAllAuthUsers(serviceClient: ReturnType<typeof getServiceClient>) {
  const users = [];

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 100) break;
  }

  return users;
}

async function listStaffMembers(
  serviceClient: ReturnType<typeof getServiceClient>,
  currentUserId: string
) {
  const { data: adminRows, error: adminError } = await serviceClient
    .from("admin_users")
    .select("id, role")
    .order("role", { ascending: true });

  if (adminError) throw adminError;

  const authUsers = await listAllAuthUsers(serviceClient);
  const authById = new Map(authUsers.map((user) => [user.id, user]));

  return (adminRows ?? []).map((row) => {
    const authUser = authById.get(row.id);
    const metadata = authUser?.user_metadata ?? {};
    return {
      id: row.id,
      role: row.role,
      email: authUser?.email ?? "",
      name: metadata.full_name || metadata.name || "",
      created_at: authUser?.created_at ?? null,
      last_sign_in_at: authUser?.last_sign_in_at ?? null,
      invited_at: authUser?.invited_at ?? null,
      is_current_user: row.id === currentUserId,
    };
  });
}

async function ensureCanChangeOwnerRole(
  serviceClient: ReturnType<typeof getServiceClient>,
  targetUserId: string,
  nextRole?: string
) {
  const { data: target, error } = await serviceClient
    .from("admin_users")
    .select("role")
    .eq("id", targetUserId)
    .maybeSingle();

  if (error) throw error;
  if (!target) throw new Error("Membre introuvable.");
  if (target.role !== "owner" || nextRole === "owner") return;

  const { count, error: countError } = await serviceClient
    .from("admin_users")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");

  if (countError) throw countError;
  if ((count ?? 0) <= 1) {
    throw new Error("Impossible de retirer le dernier super admin.");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Methode non autorisee." }, 405);
  }

  try {
    const serviceClient = getServiceClient();
    const requester = await getStaffRequester(request, serviceClient);
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "list");
    const userId = String(body.user_id || "");
    const role = String(body.role || "").toLowerCase();

    if (action === "update_role") {
      if (requester.role !== "owner") {
        throw new Error("Action reservee au super admin: rapproche-toi du responsable.");
      }
      if (!userId) throw new Error("Utilisateur manquant.");
      if (userId === requester.id) {
        throw new Error("Tu ne peux pas modifier ton propre role depuis cette page.");
      }
      if (!allowedRoles.has(role)) {
        throw new Error("Role invalide.");
      }

      await ensureCanChangeOwnerRole(serviceClient, userId, role);

      const { error } = await serviceClient
        .from("admin_users")
        .update({ role })
        .eq("id", userId);

      if (error) throw error;
    }

    if (action === "remove") {
      if (requester.role !== "owner") {
        throw new Error("Action reservee au super admin: rapproche-toi du responsable.");
      }
      if (!userId) throw new Error("Utilisateur manquant.");
      if (userId === requester.id) {
        throw new Error("Tu ne peux pas retirer ton propre acces admin.");
      }

      await ensureCanChangeOwnerRole(serviceClient, userId);

      const { error } = await serviceClient
        .from("admin_users")
        .delete()
        .eq("id", userId);

      if (error) throw error;
    }

    if (!["list", "update_role", "remove"].includes(action)) {
      throw new Error("Action inconnue.");
    }

    const members = await listStaffMembers(serviceClient, requester.id);

    return jsonResponse({
      success: true,
      members,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Gestion du personnel impossible." },
      400
    );
  }
});
