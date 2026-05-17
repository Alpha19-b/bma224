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

async function generateSignature(clientId, clientSecret) {
  return generateHmacSignature(clientId, clientSecret);
}

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

function appendPaymentParams(url, params) {
  try {
    const nextUrl = new URL(url);

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        nextUrl.searchParams.set(key, String(value));
      }
    });

    return nextUrl.toString();
  } catch {
    const query = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        query.set(key, String(value));
      }
    });

    return `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
  }
}

function formatGuineaPhone(phone) {
  let clean = phone.replace(/\D/g, "");

  if (clean.length === 9) {
    clean = `00224${clean}`;
  } else if (clean.length === 12 && clean.startsWith("224")) {
    clean = `00${clean}`;
  } else if (!clean.startsWith("00")) {
    clean = `00${clean}`;
  }

  return clean;
}

function getDjomiSecrets() {
  const clientId = Deno.env.get("djomi_id") ?? Deno.env.get("DJOMI_CLIENT_ID");
  const clientSecret = Deno.env.get("djomi_key") ?? Deno.env.get("DJOMI_CLIENT_SECRET");
  const partnerDomainKey =
    Deno.env.get("djomi_partner_domain_key") ??
    Deno.env.get("DJOMI_PARTNER_DOMAIN_KEY") ??
    DEFAULT_PARTNER_DOMAIN_KEY;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Configuration Djomi incomplète. Secrets attendus : djomi_id et djomi_key."
    );
  }

  return { clientId, clientSecret, partnerDomainKey };
}

function getServiceSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) return null;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

function getDjomiErrorMessage(payload) {
  const error = payload.error;
  const errors = payload.errors;

  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const nestedError = error;
    const nestedMessage = nestedError.message || nestedError.detail || nestedError.details;
    if (typeof nestedMessage === "string") return nestedMessage;
  }

  if (Array.isArray(errors)) {
    return errors
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const record = item;
          return record.message || record.detail || JSON.stringify(record);
        }
        return String(item);
      })
      .join(", ");
  }

  if (errors && typeof errors === "object") {
    return Object.entries(errors)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join(", ");
  }

  return (
    (typeof payload.message === "string" && payload.message) ||
    (typeof payload.detail === "string" && payload.detail) ||
    "Djomi a refusé la demande."
  );
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { clientId, clientSecret, partnerDomainKey } = getDjomiSecrets();
    const body = await request.json();

    const amount = Number(body.amount);
    const phone = body.phone ?? body.customer_phone;
    const referenceId = body.reference_id ?? body.order_number ?? body.order_id ?? "BMA";
    const returnUrl = body.return_url ?? body.success_url ?? "https://bma.store";
    const cancelUrl = body.cancel_url ?? returnUrl;
    const orderId = body.order_id;

    if (!amount || amount <= 0) {
      throw new Error("Montant manquant ou invalide.");
    }

    if (!phone) {
      throw new Error("Le numéro de téléphone est obligatoire pour le paiement.");
    }

    const signature = await generateSignature(clientId, clientSecret);
    const xApiKey = `${clientId}:${signature}`;
    const commonHeaders = {
      "Content-Type": "application/json",
      "X-API-KEY": xApiKey,
      "X-PARTNER-DOMAIN": partnerDomainKey,
    };

    const authResponse = await fetch(`${DJOMI_BASE_URL}/v1/auth`, {
      method: "POST",
      headers: commonHeaders,
      body: JSON.stringify({}),
    });

    const authData = await authResponse.json().catch(() => ({}));

    if (!authResponse.ok || !authData.data?.accessToken) {
      throw new Error(
        authData.error?.message ||
          authData.message ||
          "Echec authentification Djomi. Token non reçu."
      );
    }

    const transactionRef = `${referenceId}-${Date.now()}`;
    const returnToken = await generateHmacSignature(
      `${orderId ?? ""}:${transactionRef}:${amount}`,
      clientSecret
    );
    const successUrl = appendPaymentParams(returnUrl, {
      order_id: orderId,
      transaction_ref: transactionRef,
      amount,
      token: returnToken,
    });
    const finalCancelUrl = appendPaymentParams(cancelUrl, {
      order_id: orderId,
      transaction_ref: transactionRef,
    });
    const paymentPayload = {
      merchantPaymentReference: transactionRef,
      amount,
      currency: body.currency ?? "GNF",
      countryCode: "GN",
      description: `Paiement BMA ${referenceId}`,
      returnUrl: successUrl,
      cancelUrl: finalCancelUrl,
      payerNumber: formatGuineaPhone(phone),
    };

    console.log("Djomi payment payload", JSON.stringify(paymentPayload));

    const paymentResponse = await fetch(`${DJOMI_BASE_URL}/v1/payments/gateway`, {
      method: "POST",
      headers: {
        ...commonHeaders,
        Authorization: `Bearer ${authData.data.accessToken}`,
      },
      body: JSON.stringify(paymentPayload),
    });

    const paymentData = await paymentResponse.json().catch(() => ({}));

    if (!paymentResponse.ok) {
      const message = getDjomiErrorMessage(paymentData);
      console.error("Djomi payment refused", JSON.stringify(paymentData));
      throw new Error(`Refus Djomi: ${message}`);
    }

    const paymentUrl =
      paymentData.data?.redirectUrl ||
      paymentData.data?.paymentUrl ||
      paymentData.payment_url ||
      paymentData.paymentUrl;
    const transactionId =
      paymentData.data?.transactionId ||
      paymentData.data?.id ||
      paymentData.transactionId ||
      paymentData.id;

    if (!paymentUrl) {
      throw new Error("Pas de lien de redirection reçu de Djomi.");
    }

    if (orderId) {
      if (!transactionId) {
        throw new Error("Djomi n'a pas retourné d'identifiant de transaction.");
      }

      const supabase = getServiceSupabaseClient();

      if (!supabase) {
        throw new Error("Configuration Supabase service role manquante.");
      }

      const { error: paymentUpdateError } = await supabase
        .from("orders")
        .update({
          djomi_transaction_id: transactionId,
          djomi_merchant_reference: transactionRef,
          djomi_payment_status: paymentData.data?.status ?? "REDIRECTED",
          djomi_payment_url: paymentUrl,
        })
        .eq("id", orderId);

      if (paymentUpdateError) {
        throw new Error(
          `Transaction Djomi non enregistrée dans Supabase : ${paymentUpdateError.message}`
        );
      }
    }

    return Response.json(
      {
        success: true,
        payment_url: paymentUrl,
        transaction_ref: transactionRef,
        transaction_id: transactionId,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Erreur Djomi inconnue." },
      { status: 400, headers: corsHeaders }
    );
  }
});
