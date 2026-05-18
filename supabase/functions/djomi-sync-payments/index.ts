import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bma-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DJOMI_BASE_URL = "https://api.djomy.africa";
const DEFAULT_PARTNER_DOMAIN_KEY =
  "57e21c78551a4e9429ad5d1d43fc9a49a37e1e971fc9013668bf0b68ecfbda8a";

async function generateHmacSignature(message, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(message)
  );

  return Array.from(new Uint8Array(signatureBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getRequiredEnv(name) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Secret manquant: ${name}.`);
  return value;
}

function getDjomiSecrets() {
  const clientId = Deno.env.get("djomi_id") ?? Deno.env.get("DJOMI_CLIENT_ID");
  const clientSecret = Deno.env.get("djomi_key") ?? Deno.env.get("DJOMI_CLIENT_SECRET");
  const partnerDomainKey =
    Deno.env.get("djomi_partner_domain_key") ??
    Deno.env.get("DJOMI_PARTNER_DOMAIN_KEY") ??
    DEFAULT_PARTNER_DOMAIN_KEY;

  if (!clientId || !clientSecret) {
    throw new Error("Configuration Djomi incomplete: secrets manquants.");
  }

  return { clientId, clientSecret, partnerDomainKey };
}

function getServiceClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function assertCanSync(request, serviceClient) {
  const syncSecret = Deno.env.get("BMA_SYNC_SECRET");
  const providedSecret = request.headers.get("x-bma-sync-secret");

  if (syncSecret && providedSecret && syncSecret === providedSecret) {
    return;
  }

  const authHeader = request.headers.get("Authorization") || "";
  const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
  const authClient = createClient(getRequiredEnv("SUPABASE_URL"), anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();

  if (userError || !userData.user) {
    throw new Error("Acces refuse: session admin requise.");
  }

  const { data: adminUser, error: adminError } = await serviceClient
    .from("admin_users")
    .select("id, role")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (adminError || !adminUser || !["owner", "manager", "staff"].includes(adminUser.role)) {
    throw new Error("Acces refuse: role admin requis.");
  }
}

async function getDjomiAccessToken(clientId, clientSecret, partnerDomainKey) {
  const signature = await generateHmacSignature(clientId, clientSecret);
  const response = await fetch(`${DJOMI_BASE_URL}/v1/auth`, {
    method: "POST",
    headers: {
      "X-API-KEY": `${clientId}:${signature}`,
      "X-PARTNER-DOMAIN": partnerDomainKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.data?.accessToken) {
    throw new Error(result.error?.message || result.message || "Authentification Djomi impossible.");
  }

  return result.data.accessToken;
}

async function verifyDjomiPayment(
  transactionId,
  clientId,
  clientSecret,
  partnerDomainKey,
  accessToken
) {
  const signature = await generateHmacSignature(clientId, clientSecret);
  const response = await fetch(`${DJOMI_BASE_URL}/v1/payments/${transactionId}/status`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-API-KEY": `${clientId}:${signature}`,
      "X-PARTNER-DOMAIN": partnerDomainKey,
    },
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success === false) {
    throw new Error(result.error?.message || result.message || "Verification Djomi impossible.");
  }

  return result.data ?? result;
}

function isMissingAccountingSync(error) {
  const source = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`;
  return /PGRST202|42883|sync_order_accounting_entry|Could not find the function/i.test(source);
}

async function syncAccountingEntry(serviceClient, orderId) {
  const { error } = await serviceClient.rpc("sync_order_accounting_entry", {
    p_order_id: orderId,
  });

  if (!error) {
    return { synced: true, warning: "" };
  }

  if (isMissingAccountingSync(error)) {
    return {
      synced: false,
      warning: "Fonction SQL sync_order_accounting_entry non installee.",
    };
  }

  return { synced: false, warning: error.message || "Comptabilite non synchronisee." };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const serviceClient = getServiceClient();
    await assertCanSync(request, serviceClient);

    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit || 50), 100));
    const { clientId, clientSecret, partnerDomainKey } = getDjomiSecrets();
    const accessToken = await getDjomiAccessToken(clientId, clientSecret, partnerDomainKey);

    const { data: orders, error: ordersError } = await serviceClient
      .from("orders")
      .select(
        "id, order_number, total_amount, payment_status, order_status, djomi_transaction_id, djomi_merchant_reference"
      )
      .neq("payment_status", "paid")
      .not("djomi_transaction_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (ordersError) {
      throw ordersError;
    }

    const checked = [];
    let updated = 0;
    let pending = 0;
    let failed = 0;

    for (const order of orders ?? []) {
      try {
        const djomiPayment = await verifyDjomiPayment(
          order.djomi_transaction_id,
          clientId,
          clientSecret,
          partnerDomainKey,
          accessToken
        );
        const djomiStatus = String(djomiPayment.status || "").toUpperCase();
        const paidAmount = Number(djomiPayment.paidAmount ?? 0);
        const receivedAmount = Number(djomiPayment.receivedAmount ?? 0);
        const expectedAmount = Number(order.total_amount || 0);
        const baseUpdate = {
          djomi_payment_status: djomiStatus || "UNKNOWN",
          djomi_paid_amount: paidAmount || null,
          djomi_received_amount: receivedAmount || null,
          djomi_payment_method: djomiPayment.paymentMethod || null,
          djomi_provider_reference: djomiPayment.providerReference || null,
          djomi_verified_at: new Date().toISOString(),
        };

        if (
          djomiPayment.merchantPaymentReference &&
          order.djomi_merchant_reference &&
          djomiPayment.merchantPaymentReference !== order.djomi_merchant_reference
        ) {
          failed += 1;
          checked.push({
            order_id: order.id,
            order_number: order.order_number,
            status: "REFERENCE_MISMATCH",
          });
          continue;
        }

        if (["SUCCESS", "CAPTURED"].includes(djomiStatus) && paidAmount >= expectedAmount) {
          const nextOrderStatus =
            order.order_status === "pending_payment" ? "confirmed" : order.order_status;

          const { error: updateError } = await serviceClient
            .from("orders")
            .update({
              ...baseUpdate,
              payment_status: "paid",
              payment_provider: "djomi",
              order_status: nextOrderStatus,
              payment_completed_at: new Date().toISOString(),
            })
            .eq("id", order.id);

          if (updateError) throw updateError;

          const accountingSync = await syncAccountingEntry(serviceClient, order.id);

          updated += 1;
          checked.push({
            order_id: order.id,
            order_number: order.order_number,
            status: djomiStatus,
            paid: true,
            accounting_synced: accountingSync.synced,
            accounting_warning: accountingSync.warning,
          });
        } else {
          const { error: updateError } = await serviceClient
            .from("orders")
            .update(baseUpdate)
            .eq("id", order.id);

          if (updateError) throw updateError;

          pending += 1;
          checked.push({
            order_id: order.id,
            order_number: order.order_number,
            status: djomiStatus,
            paid: false,
          });
        }
      } catch (error) {
        failed += 1;
        checked.push({
          order_id: order.id,
          order_number: order.order_number,
          status: "ERROR",
          error: error instanceof Error ? error.message : "Erreur inconnue",
        });
      }
    }

    return Response.json(
      {
        success: true,
        scanned: orders?.length ?? 0,
        updated,
        pending,
        failed,
        checked,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sync Djomi impossible." },
      { status: 400, headers: corsHeaders }
    );
  }
});
