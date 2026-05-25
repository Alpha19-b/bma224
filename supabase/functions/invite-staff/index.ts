import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedRoles = new Set(["manager", "staff"]);

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders,
  });
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

async function assertOwner(request: Request, serviceClient: ReturnType<typeof getServiceClient>) {
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
    throw new Error("Acces refuse: connecte-toi avec le compte super admin.");
  }

  const { data: adminUser, error: adminError } = await serviceClient
    .from("admin_users")
    .select("role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (adminError || adminUser?.role !== "owner") {
    throw new Error("Acces refuse: seul le super admin peut inviter du personnel.");
  }

  return userData.user;
}

async function findExistingUserByEmail(
  serviceClient: ReturnType<typeof getServiceClient>,
  email: string
) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 100,
    });

    if (error) throw error;

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    );

    if (match) return match;
    if (data.users.length < 100) return null;
  }

  return null;
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
    const owner = await assertOwner(request, serviceClient);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "staff").trim().toLowerCase();
    const siteUrl = Deno.env.get("BMA_SITE_URL") || "https://bma224.com";
    const redirectTo = `${siteUrl.replace(/\/$/, "")}/admin`;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Email invalide.");
    }

    if (!allowedRoles.has(role)) {
      throw new Error("Role invalide. Choisis manager ou staff.");
    }

    const { data: inviteData, error: inviteError } =
      await serviceClient.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: {
          invited_by: owner.email || owner.id,
          bma_role: role,
        },
      });

    let user = inviteData?.user ?? null;
    let alreadyExists = false;

    if (inviteError) {
      const message = `${inviteError.message || ""}`;
      if (!/already|registered|exists|User.*exist/i.test(message)) {
        throw inviteError;
      }

      alreadyExists = true;
      user = await findExistingUserByEmail(serviceClient, email);
      if (!user) {
        throw new Error(
          "Ce compte existe peut-etre deja, mais il est introuvable pour lui attribuer un role."
        );
      }
    }

    const { error: roleError } = await serviceClient
      .from("admin_users")
      .upsert({ id: user.id, role }, { onConflict: "id" });

    if (roleError) {
      throw new Error(`Invitation envoyee, mais role non enregistre: ${roleError.message}`);
    }

    return jsonResponse({
      success: true,
      invited: !alreadyExists,
      already_exists: alreadyExists,
      email,
      role,
      message: alreadyExists
        ? "Compte deja existant. Le role BMA a ete mis a jour."
        : "Invitation envoyee par email.",
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Invitation impossible." },
      400
    );
  }
});
