import { supabase } from "../lib/supabaseClient.js";

function profileMetadata(profile = {}) {
  return {
    first_name: profile.firstName || null,
    last_name: profile.lastName || null,
    full_name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
    phone: profile.phone || null,
    preferred_delivery_address: profile.preferredAddress || null,
    preferred_delivery_commune: profile.preferredCommune || null,
    preferred_delivery_quartier: profile.preferredQuartier || null,
    preferred_latitude: profile.latitude || null,
    preferred_longitude: profile.longitude || null,
  };
}

function mapCustomerProfile(row, metadata = {}) {
  return {
    firstName: row?.first_name ?? metadata.first_name ?? "",
    lastName: row?.last_name ?? metadata.last_name ?? "",
    fullName:
      row?.full_name ??
      metadata.full_name ??
      [row?.first_name ?? metadata.first_name, row?.last_name ?? metadata.last_name]
        .filter(Boolean)
        .join(" "),
    phone: row?.phone ?? metadata.phone ?? "",
    preferredAddress:
      row?.preferred_delivery_address ?? metadata.preferred_delivery_address ?? "",
    preferredCommune:
      row?.preferred_delivery_commune ?? metadata.preferred_delivery_commune ?? "",
    preferredQuartier:
      row?.preferred_delivery_quartier ?? metadata.preferred_delivery_quartier ?? "",
    latitude: row?.preferred_latitude ?? metadata.preferred_latitude ?? "",
    longitude: row?.preferred_longitude ?? metadata.preferred_longitude ?? "",
  };
}

export async function getCurrentSession() {
  if (!supabase) {
    return { session: null, error: new Error("Connexion indisponible.") };
  }

  const { data, error } = await supabase.auth.getSession();
  return { session: data?.session ?? null, error };
}

export function onAuthChange(callback) {
  if (!supabase) return null;

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return data.subscription;
}

export async function signInAdmin(email, password) {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  return supabase.auth.signInWithPassword({ email, password });
}

export async function signUpCustomer(email, password, profile = {}) {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  const result = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: profileMetadata(profile),
    },
  });

  if (!result.error && result.data?.session) {
    await updateCustomerProfile(profile);
  }

  return result;
}

export async function signOutAdmin() {
  if (!supabase) {
    return { error: new Error("Connexion indisponible.") };
  }

  return supabase.auth.signOut();
}

export async function fetchCustomerProfile() {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData?.user) {
    return { data: null, error: userError ?? new Error("Client non connecte.") };
  }

  const { data, error } = await supabase
    .from("customer_profiles")
    .select(
      `
        first_name,
        last_name,
        full_name,
        phone,
        preferred_delivery_address,
        preferred_delivery_commune,
        preferred_delivery_quartier,
        preferred_latitude,
        preferred_longitude
      `
    )
    .eq("id", userData.user.id)
    .maybeSingle();

  if (error) {
    return {
      data: mapCustomerProfile(null, userData.user.user_metadata ?? {}),
      error,
    };
  }

  return {
    data: mapCustomerProfile(data, userData.user.user_metadata ?? {}),
    error: null,
  };
}

export async function updateCustomerProfile(profile) {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData?.user) {
    return { data: null, error: userError ?? new Error("Client non connecte.") };
  }

  const row = {
    id: userData.user.id,
    first_name: profile.firstName || null,
    last_name: profile.lastName || null,
    full_name: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
    phone: profile.phone || null,
    preferred_delivery_address: profile.preferredAddress || null,
    preferred_delivery_commune: profile.preferredCommune || null,
    preferred_delivery_quartier: profile.preferredQuartier || null,
    preferred_latitude: profile.latitude || null,
    preferred_longitude: profile.longitude || null,
  };

  const { data, error } = await supabase
    .from("customer_profiles")
    .upsert(row)
    .select(
      `
        first_name,
        last_name,
        full_name,
        phone,
        preferred_delivery_address,
        preferred_delivery_commune,
        preferred_delivery_quartier,
        preferred_latitude,
        preferred_longitude
      `
    )
    .single();

  if (error) {
    return { data: null, error };
  }

  const authResult = await supabase.auth.updateUser({
    data: profileMetadata(profile),
  });

  if (authResult.error) {
    return { data: mapCustomerProfile(data), error: authResult.error };
  }

  return { data: mapCustomerProfile(data), error: null };
}

export async function updateCustomerPassword(password) {
  return updateAccountPassword(password);
}

export async function updateAccountPassword(password) {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  return supabase.auth.updateUser({ password });
}

export async function updateAccountMetadata({ fullName }) {
  if (!supabase) {
    return { data: null, error: new Error("Connexion indisponible.") };
  }

  return supabase.auth.updateUser({
    data: {
      full_name: fullName || null,
    },
  });
}
