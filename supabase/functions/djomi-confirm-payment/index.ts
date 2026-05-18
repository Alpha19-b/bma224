import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-partner-domain",
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

function safeEqual(first, second) {
  if (first.length !== second.length) return false;

  let diff = 0;
  for (let index = 0; index < first.length; index += 1) {
    diff |= first.charCodeAt(index) ^ second.charCodeAt(index);
  }

  return diff === 0;
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

async function verifyDjomiPayment(transactionId) {
  const { clientId, clientSecret, partnerDomainKey } = getDjomiSecrets();
  const accessToken = await getDjomiAccessToken(clientId, clientSecret, partnerDomainKey);
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

async function syncAccountingEntry(supabase, orderId) {
  const { error } = await supabase.rpc("sync_order_accounting_entry", {
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
    const body = await request.json();
    const orderId = String(body.order_id || "");
    let transactionRef = String(body.transaction_ref || "");
    const token = String(body.token || "");
    let amount = Number(body.amount);

    if (!orderId) {
      throw new Error("Retour paiement incomplet.");
    }

    const supabaseUrl = getRequiredEnv("SUPABASE_URL");
    const serviceRoleKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(
        "id, order_number, user_id, total_amount, payment_status, order_status, djomi_transaction_id, djomi_merchant_reference"
      )
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Commande introuvable.");
    }

    const hasSignedReturn = Boolean(transactionRef && token && amount && amount > 0);

    if (hasSignedReturn) {
      const { clientSecret } = getDjomiSecrets();
      const expectedToken = await generateHmacSignature(
        `${orderId}:${transactionRef}:${amount}`,
        clientSecret
      );

      if (!safeEqual(expectedToken, token)) {
        throw new Error("Signature paiement invalide.");
      }
    } else {
      const authHeader = request.headers.get("Authorization") || "";
      const anonKey = getRequiredEnv("SUPABASE_ANON_KEY");
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false },
      });
      const { data: userData, error: userError } = await authClient.auth.getUser();

      if (userError || !userData.user || userData.user.id !== order.user_id) {
        throw new Error("Connecte-toi avec le compte de la commande pour verifier le paiement.");
      }

      transactionRef = order.djomi_merchant_reference || transactionRef;
      amount = Number(order.total_amount || 0);
    }

    if (!transactionRef || !amount || amount <= 0) {
      throw new Error("Reference paiement incomplete. Relance le paiement depuis Mes achats.");
    }

    const expectedAmount = Number(order.total_amount || 0);
    if (Math.round(expectedAmount) !== Math.round(amount)) {
      throw new Error("Montant paiement different du total de commande.");
    }

    if (order.djomi_merchant_reference && order.djomi_merchant_reference !== transactionRef) {
      throw new Error("Reference Djomi differente de la commande.");
    }

    const transactionId = String(body.transaction_id || order.djomi_transaction_id || "");

    if (!transactionId) {
      throw new Error("Transaction Djomi introuvable. Relance le paiement depuis Mes achats.");
    }

    const djomiPayment = await verifyDjomiPayment(transactionId);
    const djomiStatus = String(djomiPayment.status || "").toUpperCase();
    const paidAmount = Number(djomiPayment.paidAmount ?? 0);
    const receivedAmount = Number(djomiPayment.receivedAmount ?? 0);

    if (
      djomiPayment.merchantPaymentReference &&
      djomiPayment.merchantPaymentReference !== transactionRef
    ) {
      throw new Error("La reference retour ne correspond pas au paiement Djomi.");
    }

    if (!["SUCCESS", "CAPTURED"].includes(djomiStatus)) {
      await supabase
        .from("orders")
        .update({
          djomi_payment_status: djomiStatus || "UNKNOWN",
          djomi_paid_amount: paidAmount || null,
          djomi_received_amount: receivedAmount || null,
          djomi_payment_method: djomiPayment.paymentMethod || null,
          djomi_provider_reference: djomiPayment.providerReference || null,
          djomi_verified_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      return Response.json(
        {
          success: true,
          paid: false,
          order_id: orderId,
          order_number: order.order_number,
          djomi_status: djomiStatus,
          message: `Paiement Djomi non confirme (${djomiStatus || "INCONNU"}).`,
        },
        { headers: corsHeaders }
      );
    }

    if (Math.round(paidAmount) < Math.round(expectedAmount)) {
      throw new Error("Montant paye inferieur au total de commande.");
    }

    const nextOrderStatus =
      order.order_status === "pending_payment" ? "confirmed" : order.order_status;

    const { error: updateError } = await supabase
      .from("orders")
      .update({
        payment_status: "paid",
        payment_provider: "djomi",
        order_status: nextOrderStatus,
        djomi_transaction_id: transactionId,
        djomi_merchant_reference: transactionRef,
        djomi_payment_status: djomiStatus,
        djomi_paid_amount: paidAmount || expectedAmount,
        djomi_received_amount: receivedAmount || null,
        djomi_payment_method: djomiPayment.paymentMethod || null,
        djomi_provider_reference: djomiPayment.providerReference || null,
        djomi_verified_at: new Date().toISOString(),
        payment_completed_at: new Date().toISOString(),
      })
      .eq("id", orderId);

    if (updateError) {
      throw updateError;
    }

    const accountingSync = await syncAccountingEntry(supabase, orderId);

    return Response.json(
      {
        success: true,
        paid: true,
        order_id: orderId,
        order_number: order.order_number,
        payment_status: "paid",
        order_status: nextOrderStatus,
        djomi_status: djomiStatus,
        transaction_ref: transactionRef,
        accounting_synced: accountingSync.synced,
        accounting_warning: accountingSync.warning,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Confirmation paiement impossible." },
      { status: 400, headers: corsHeaders }
    );
  }
});
