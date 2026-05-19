import { supabase } from "../lib/supabaseClient.js";

const publicImageFallback =
  "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80";
const productImageBucket = "product-images";
const receiptBucket = "orange-money-receipts";
const collectionMethodByLabel = {
  Liquide: "cash",
  Djomi: "djomi",
  "Orange Money": "orange_money",
};
const collectionLabelByMethod = {
  cash: "Liquide",
  djomi: "Djomi",
  orange_money: "Orange Money",
  other: "Autre",
};

function isMissingRpc(error) {
  const message = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`;
  return /PGRST202|42883|function .* does not exist|Could not find the function/i.test(message);
}

const orderStatusLabels = {
  pending_payment: "Commande reçue",
  confirmed: "Commande reçue",
  preparing: "En préparation",
  ready: "En préparation",
  ready_for_pickup: "En préparation",
  assigned_to_delivery: "En préparation",
  in_delivery: "En livraison",
  delivered: "Livrée",
  delivery_failed: "Problème livraison",
  cancelled: "Annulée",
};

function mapProductRow(product, gallery = [], options = { sizes: [], colors: [] }, fallbackCategory = "Produit") {
  return {
    id: product.id,
    name: product.name,
    category: product.categories?.name ?? fallbackCategory,
    price: Number(product.price),
    purchasePrice: Number(product.purchase_price ?? 0),
    costPrice: Number(product.cost_price ?? 0),
    promoPrice:
      product.promo_price === null || product.promo_price === undefined
        ? null
        : Number(product.promo_price),
    stock: product.stock,
    image: gallery[0] || product.main_image_url || publicImageFallback,
    images: gallery.length ? gallery : [product.main_image_url].filter(Boolean),
    description: product.description,
    sizes: options.sizes ?? [],
    colors: options.colors ?? [],
  };
}

function slugify(value) {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mapOrderStatus(status) {
  return orderStatusLabels[status] ?? status ?? "En attente";
}

function getOrderStatusTone(status) {
  if (["delivery_failed", "cancelled"].includes(status)) return "issue";
  if (status === "delivered") return "paid";
  if (["preparing", "ready", "ready_for_pickup", "assigned_to_delivery", "in_delivery"].includes(status)) {
    return "active";
  }
  return "waiting";
}

function getPaymentTone(order) {
  return order.payment_status === "paid" ? "paid" : "waiting";
}

function normalizeCoordinateValue(value) {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}

function buildMapsDirectionsUrl(latitude, longitude) {
  const lat = normalizeCoordinateValue(latitude);
  const lng = normalizeCoordinateValue(longitude);

  if (lat === null || lng === null) return "";

  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

async function createReceiptSignedUrl(pathOrUrl) {
  if (!pathOrUrl || !supabase) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const { data, error } = await supabase.storage
    .from(receiptBucket)
    .createSignedUrl(pathOrUrl, 60 * 60);

  if (error) return "";
  return data?.signedUrl ?? "";
}

async function getCurrentUserId() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

function mapOrderItem(item, productsById = {}, imagesByProductId = {}) {
  const product = productsById[item.product_id] ?? {};
  const image = imagesByProductId[item.product_id]?.[0] || product.main_image_url || publicImageFallback;
  const name = item.product_name_snapshot || product.name || "Article";
  const quantity = Number(item.quantity ?? 0);
  const unitPrice = Number(item.unit_price ?? 0);

  return {
    id: item.id,
    productId: item.product_id,
    name,
    image,
    quantity,
    unitPrice,
    total: quantity * unitPrice,
    selectedSize: item.selected_size ?? "",
    selectedColor: item.selected_color ?? "",
    sku: item.product_sku_snapshot ?? "",
  };
}

function normalizeVariantName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseVariantNotes(notes) {
  return String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*:\s*(.+?)(?:,\s*quantit[eé]\s*(\d+))?$/i);
      if (!match) return null;

      const details = match[2];
      const sizeMatch = details.match(/taille\s+([^,-]+)/i);
      const colorMatch = details.match(/couleur\s+([^,-]+)/i);

      return {
        productName: normalizeVariantName(match[1]),
        selectedSize: sizeMatch?.[1]?.trim() || "",
        selectedColor: colorMatch?.[1]?.trim() || "",
        quantity: match[3] ? Number(match[3]) : null,
      };
    })
    .filter(Boolean);
}

function applyVariantNoteFallbacks(items, notes) {
  const variants = parseVariantNotes(notes);
  if (!variants.length) return items;

  const usedVariantIndexes = new Set();

  return items.map((item) => {
    if (item.selectedSize && item.selectedColor) return item;

    const itemName = normalizeVariantName(item.name);
    const matchIndex = variants.findIndex(
      (variant, index) =>
        !usedVariantIndexes.has(index) &&
        (variant.productName === itemName ||
          itemName.includes(variant.productName) ||
          variant.productName.includes(itemName))
    );

    const match = matchIndex >= 0 ? variants[matchIndex] : null;
    if (!match) return item;
    usedVariantIndexes.add(matchIndex);

    return {
      ...item,
      selectedSize: item.selectedSize || match.selectedSize,
      selectedColor: item.selectedColor || match.selectedColor,
    };
  });
}

async function resolveCategoryId(categoryName) {
  const name = categoryName?.trim();

  if (!name || !supabase) return { id: null, error: null };

  const slug = slugify(name);
  const { data: existingCategory, error: selectError } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  if (selectError) return { id: null, error: selectError };
  if (existingCategory?.id) return { id: existingCategory.id, error: null };

  const { data: createdCategory, error: insertError } = await supabase
    .from("categories")
    .insert({ name, slug, is_active: true })
    .select("id")
    .maybeSingle();

  if (insertError) return { id: null, error: insertError };
  return { id: createdCategory?.id ?? null, error: null };
}

export async function uploadProductImage(file) {
  if (!file) {
    return { data: null, error: null };
  }

  if (!supabase) {
    return { data: null, error: new Error("Stockage image non configuré.") };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = slugify(file.name.replace(/\.[^/.]+$/, "")) || "photo-produit";
  const filePath = `${Date.now()}-${safeName}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const { error } = await supabase.storage
    .from(productImageBucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    return { data: null, error };
  }

  const { data } = supabase.storage.from(productImageBucket).getPublicUrl(filePath);
  return { data: data.publicUrl, error: null };
}

export async function fetchProducts() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("products")
    .select(
      `
        id,
        name,
        description,
        price,
        purchase_price,
        cost_price,
        promo_price,
        stock,
        main_image_url,
        is_active,
        categories(name)
      `
    )
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (error) {
    return { data: [], error };
  }

  const productIds = data.map((product) => product.id);
  let imagesByProductId = {};
  let optionsByProductId = {};

  if (productIds.length) {
    let { data: imageRows, error: imageError } = await supabase
      .from("product_images")
      .select("product_id, image_url, sort_order")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });

    if (imageError && /sort_order/i.test(imageError.message || "")) {
      const fallbackImages = await supabase
        .from("product_images")
        .select("product_id, image_url")
        .in("product_id", productIds);

      imageRows = fallbackImages.data;
      imageError = fallbackImages.error;
    }

    if (!imageError) {
      imagesByProductId = (imageRows ?? []).reduce((grouped, image) => {
        grouped[image.product_id] = grouped[image.product_id] || [];
        grouped[image.product_id].push(image.image_url);
        return grouped;
      }, {});
    }

    const { data: optionRows, error: optionError } = await supabase
      .from("product_options")
      .select("product_id, option_type, value, hex_color, sort_order")
      .in("product_id", productIds)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (!optionError) {
      optionsByProductId = (optionRows ?? []).reduce((grouped, option) => {
        grouped[option.product_id] = grouped[option.product_id] || {
          sizes: [],
          colors: [],
        };

        if (option.option_type === "size") {
          grouped[option.product_id].sizes.push(option.value);
        }

        if (option.option_type === "color") {
          grouped[option.product_id].colors.push({
            value: option.value,
            hex: option.hex_color,
          });
        }

        return grouped;
      }, {});
    }
  }

  return {
    data: data.map((product) => {
      const gallery = [
        ...new Set(
          [
            product.main_image_url,
            ...(imagesByProductId[product.id] ?? []),
          ].filter(Boolean)
        ),
      ];

      return mapProductRow(product, gallery, optionsByProductId[product.id]);
    }),
    error: null,
  };
}

export async function createCheckoutOrder(payload) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase.rpc("create_checkout_order", payload);
  return { data, error };
}

export async function createDjomiPaymentSession(payload) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration Djomi indisponible.") };
  }

  const { data, error } = await supabase.functions.invoke("djomi-checkout", {
    body: payload,
  });

  if (error) {
    let message = error.message;

    try {
      const responsePayload = await error.context?.clone?.().json?.();
      message =
        responsePayload?.error ||
        responsePayload?.message ||
        responsePayload?.details ||
        message;
    } catch {
      // Supabase ne fournit pas toujours le corps de réponse dans l'erreur.
    }

    return { data: null, error: new Error(message) };
  }

  const paymentUrl =
    data?.payment_url ||
    data?.paymentUrl ||
    data?.checkout_url ||
    data?.checkoutUrl ||
    data?.redirect_url ||
    data?.redirectUrl ||
    data?.url;

  if (!paymentUrl) {
    return {
      data: null,
      error: new Error("Djomi n'a pas retourné de lien de paiement."),
    };
  }

  return { data: { paymentUrl, raw: data }, error: null };
}

export async function confirmDjomiPayment(payload) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration Djomi indisponible.") };
  }

  const { data, error } = await supabase.functions.invoke("djomi-confirm-payment", {
    body: payload,
  });

  if (error) {
    let message = error.message;

    try {
      const responsePayload = await error.context?.clone?.().json?.();
      message =
        responsePayload?.error ||
        responsePayload?.message ||
        responsePayload?.details ||
        message;
    } catch {
      // Le corps d'erreur n'est pas toujours disponible.
    }

    return { data: null, error: new Error(message) };
  }

  return { data, error: null };
}

export async function syncDjomiPayments(payload = {}) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration Djomi indisponible.") };
  }

  const { data, error } = await supabase.functions.invoke("djomi-sync-payments", {
    body: payload,
  });

  if (error) {
    let message = error.message;

    try {
      const responsePayload = await error.context?.clone?.().json?.();
      message =
        responsePayload?.error ||
        responsePayload?.message ||
        responsePayload?.details ||
        message;
    } catch {
      // Le corps d'erreur n'est pas toujours disponible.
    }

    return { data: null, error: new Error(message) };
  }

  return { data, error: null };
}

export async function createProduct(product) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const slugBase = slugify(product.name);
  const slug = `${slugBase}-${Date.now().toString(36)}`;
  const categoryResult = await resolveCategoryId(product.category);

  if (categoryResult.error) {
    return {
      data: null,
      error: new Error(`Catégorie non enregistrée : ${categoryResult.error.message}`),
    };
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      name: product.name,
      slug,
      description: product.description || null,
      category_id: categoryResult.id,
      price: Number(product.price),
      purchase_price: product.purchasePrice ? Number(product.purchasePrice) : 0,
      cost_price: product.costPrice ? Number(product.costPrice) : 0,
      promo_price: product.promoPrice ? Number(product.promoPrice) : null,
      stock: Number(product.stock),
      main_image_url: product.image || null,
      is_active: true,
    })
    .select(
      `
        id,
        name,
        description,
        price,
        purchase_price,
        cost_price,
        promo_price,
        stock,
        main_image_url,
        is_active,
        categories(name)
      `
    )
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: mapProductRow(
      data,
      [data.main_image_url].filter(Boolean),
      { sizes: product.sizes ?? [], colors: product.colors ?? [] },
      product.category ?? "Produit"
    ),
    error: null,
  };
}

export async function updateProduct(productId, product) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const categoryResult = await resolveCategoryId(product.category);

  if (categoryResult.error) {
    return {
      data: null,
      error: new Error(`CatÃ©gorie non enregistrÃ©e : ${categoryResult.error.message}`),
    };
  }

  const updatePayload = {
    name: product.name,
    description: product.description || null,
    category_id: categoryResult.id,
    price: Number(product.price),
    purchase_price: product.purchasePrice ? Number(product.purchasePrice) : 0,
    cost_price: product.costPrice ? Number(product.costPrice) : 0,
    promo_price: product.promoPrice ? Number(product.promoPrice) : null,
    stock: Number(product.stock),
  };

  if (product.image) {
    updatePayload.main_image_url = product.image;
  }

  const { data, error } = await supabase
    .from("products")
    .update(updatePayload)
    .eq("id", productId)
    .select(
      `
        id,
        name,
        description,
        price,
        purchase_price,
        cost_price,
        promo_price,
        stock,
        main_image_url,
        is_active,
        categories(name)
      `
    )
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: mapProductRow(
      data,
      [data.main_image_url].filter(Boolean),
      { sizes: product.sizes ?? [], colors: product.colors ?? [] },
      product.category ?? "Produit"
    ),
    error: null,
  };
}

export async function replaceProductOptions(productId, { sizes = [], colors = [] }) {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const sizeRows = sizes.map((value, index) => ({
    product_id: productId,
    option_type: "size",
    value,
    sort_order: index,
  }));

  const colorRows = colors.map((color, index) => ({
    product_id: productId,
    option_type: "color",
    value: color.value,
    hex_color: color.hex || null,
    sort_order: index,
  }));

  const { error: deleteError } = await supabase
    .from("product_options")
    .delete()
    .eq("product_id", productId);

  if (deleteError) {
    return { data: [], error: deleteError };
  }

  const rows = [...sizeRows, ...colorRows];

  if (!rows.length) {
    return { data: [], error: null };
  }

  const { data, error } = await supabase.from("product_options").insert(rows).select();
  return { data: data ?? [], error };
}

export async function updateProductStock(productId, stock) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("products")
    .update({ stock: Number(stock) })
    .eq("id", productId)
    .select("id, stock")
    .single();

  return { data, error };
}

export async function deleteProductAsOwner(productId) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase.rpc("bma_delete_product", {
    p_product_id: productId,
  });

  return { data, error };
}

export async function createProductImages(productId, imageUrls) {
  const uniqueImageUrls = [...new Set((imageUrls ?? []).filter(Boolean))];

  if (!uniqueImageUrls.length) {
    return { data: [], error: null };
  }

  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const rows = uniqueImageUrls.map((imageUrl, index) => ({
    product_id: productId,
    image_url: imageUrl,
    sort_order: index,
  }));

  let { data, error } = await supabase.from("product_images").insert(rows).select();

  if (error && /sort_order/i.test(error.message || "")) {
    const fallbackRows = rows.map(({ sort_order, ...row }) => row);
    const fallback = await supabase.from("product_images").insert(fallbackRows).select();
    data = fallback.data;
    error = fallback.error;
  }

  return { data: data ?? [], error };
}

export async function fetchCurrentAdminContext() {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const rpcResult = await supabase.rpc("get_current_admin_context");

  if (!rpcResult.error) {
    const row = Array.isArray(rpcResult.data) ? rpcResult.data[0] : rpcResult.data;
    return {
      data: row
        ? {
            userId: row.user_id,
            email: row.email ?? "",
            role: row.role ?? "",
            isOwner: Boolean(row.is_owner),
            isInternal: Boolean(row.is_internal),
          }
        : null,
      error: null,
    };
  }

  if (!isMissingRpc(rpcResult.error)) {
    return { data: null, error: rpcResult.error };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  if (userError || !userId) {
    return { data: null, error: userError ?? new Error("Session admin introuvable.") };
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return { data: null, error };
  }

  return {
    data: data
      ? {
          userId: data.id,
          email: userData.user.email ?? "",
          role: data.role ?? "",
          isOwner: data.role === "owner",
          isInternal: ["owner", "manager", "staff", "admin"].includes(data.role),
        }
      : null,
    error: null,
  };
}

export async function fetchAdminOrders() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  let { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        order_number,
        user_id,
        guest_name,
        guest_phone,
        delivery_recipient_name,
        delivery_contact_phone,
        delivery_city,
        delivery_commune,
        delivery_quartier,
        delivery_landmark,
        delivery_address,
        delivery_latitude,
        delivery_longitude,
        delivery_map_label,
        fulfillment_type,
        payment_provider,
        payment_status,
        order_status,
        djomi_transaction_id,
        djomi_payment_status,
        delivery_notes,
        total_amount,
        created_at
      `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (
    error &&
    /delivery_recipient_name|delivery_contact_phone|delivery_landmark|delivery_address|delivery_latitude|delivery_longitude|delivery_map_label|delivery_notes|user_id|djomi_transaction_id|djomi_payment_status/i.test(
      error.message || ""
    )
  ) {
    const fallback = await supabase
      .from("orders")
      .select(
        `
          id,
          order_number,
          guest_name,
          guest_phone,
          delivery_city,
          delivery_commune,
          delivery_quartier,
          fulfillment_type,
          payment_provider,
          payment_status,
          order_status,
          total_amount,
          created_at
        `
      )
      .order("created_at", { ascending: false })
      .limit(100);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return { data: [], error };
  }

  const orderIds = data.map((order) => order.id);
  let itemsByOrderId = {};

  if (orderIds.length) {
    let { data: itemRows, error: itemError } = await supabase
      .from("order_items")
      .select(
        `
          id,
          order_id,
          product_id,
          quantity,
          unit_price,
          product_name_snapshot,
          product_sku_snapshot,
          selected_size,
          selected_color
        `
      )
      .in("order_id", orderIds);

    if (
      itemError &&
      /selected_size|selected_color|product_sku_snapshot/i.test(itemError.message || "")
    ) {
      const fallbackItems = await supabase
        .from("order_items")
        .select(
          `
            id,
            order_id,
            product_id,
            quantity,
            unit_price,
            product_name_snapshot
          `
        )
        .in("order_id", orderIds);

      itemRows = fallbackItems.data;
      itemError = fallbackItems.error;
    }

    if (!itemError) {
      const productIds = [...new Set((itemRows ?? []).map((item) => item.product_id).filter(Boolean))];
      let productsById = {};
      let imagesByProductId = {};

      if (productIds.length) {
        const { data: productRows } = await supabase
          .from("products")
          .select("id, name, main_image_url")
          .in("id", productIds);

        productsById = Object.fromEntries((productRows ?? []).map((product) => [product.id, product]));

        let { data: imageRows, error: imageError } = await supabase
          .from("product_images")
          .select("product_id, image_url, sort_order")
          .in("product_id", productIds)
          .order("sort_order", { ascending: true });

        if (imageError && /sort_order/i.test(imageError.message || "")) {
          const fallbackImages = await supabase
            .from("product_images")
            .select("product_id, image_url")
            .in("product_id", productIds);

          imageRows = fallbackImages.data;
          imageError = fallbackImages.error;
        }

        if (!imageError) {
          imagesByProductId = (imageRows ?? []).reduce((grouped, image) => {
            grouped[image.product_id] = grouped[image.product_id] || [];
            grouped[image.product_id].push(image.image_url);
            return grouped;
          }, {});
        }
      }

      itemsByOrderId = (itemRows ?? []).reduce((grouped, item) => {
        grouped[item.order_id] = grouped[item.order_id] || [];
        grouped[item.order_id].push(mapOrderItem(item, productsById, imagesByProductId));
        return grouped;
      }, {});
    }
  }

  return {
    data: data.map((order) => {
      const orderItems = applyVariantNoteFallbacks(
        itemsByOrderId[order.id] ?? [],
        order.delivery_notes
      );
      const statusTone = getOrderStatusTone(order.order_status);
      const paymentTone = getPaymentTone(order);
      const latitude = normalizeCoordinateValue(order.delivery_latitude);
      const longitude = normalizeCoordinateValue(order.delivery_longitude);
      const mapsUrl = buildMapsDirectionsUrl(latitude, longitude);

      return {
        id: order.order_number,
        rawId: order.id,
        userId: order.user_id,
        customer: order.delivery_recipient_name ?? order.guest_name ?? "Client connecté",
        phone: order.delivery_contact_phone ?? order.guest_phone ?? "-",
        zone:
          order.fulfillment_type === "pickup"
            ? "Retrait"
            : [order.delivery_commune, order.delivery_quartier]
                .filter(Boolean)
                .join(", ") || order.delivery_city || (mapsUrl ? "Position GPS" : "Zone non précisée"),
        landmark: order.delivery_landmark || order.delivery_address || "",
        latitude,
        longitude,
        mapLabel: order.delivery_map_label ?? "",
        mapsUrl,
        addressType: order.fulfillment_type === "pickup" ? "Retrait" : "Livraison",
        items: orderItems.length,
        itemsCount: orderItems.reduce((total, item) => total + Number(item.quantity || 0), 0),
        itemsSummary: orderItems.length
          ? orderItems.map((item) => `${item.quantity} x ${item.name}`).join(", ")
          : "Articles non chargés",
        orderItems,
        payment:
          order.payment_status === "paid"
            ? "Payé"
            : order.payment_provider === "cash_on_delivery"
              ? "A la livraison"
              : "En attente",
        status: mapOrderStatus(order.order_status),
        rawStatus: order.order_status,
        hasDjomiTransaction: Boolean(order.djomi_transaction_id),
        djomiPaymentStatus: order.djomi_payment_status ?? "",
        statusTone,
        paymentTone,
        tone: statusTone,
        total: Number(order.total_amount),
        createdAt: order.created_at,
        createdDate: order.created_at?.slice(0, 10) ?? "",
      };
    }),
    error: null,
  };
}

export async function fetchCustomerOrders() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userData?.user?.id;

  if (userError) {
    return { data: [], error: userError };
  }

  if (!userId) {
    return { data: [], error: null };
  }

  let { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        order_number,
        user_id,
        guest_name,
        guest_phone,
        delivery_recipient_name,
        delivery_contact_phone,
        delivery_city,
        delivery_commune,
        delivery_quartier,
        delivery_landmark,
        delivery_address,
        fulfillment_type,
        payment_provider,
        payment_status,
        order_status,
        djomi_transaction_id,
        djomi_payment_status,
        delivery_notes,
        total_amount,
        created_at
      `
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (
    error &&
    /delivery_recipient_name|delivery_contact_phone|delivery_landmark|delivery_address|delivery_notes|user_id|djomi_transaction_id|djomi_payment_status/i.test(
      error.message || ""
    )
  ) {
    const fallback = await supabase
      .from("orders")
      .select(
        `
          id,
          order_number,
          guest_name,
          guest_phone,
          delivery_city,
          delivery_commune,
          delivery_quartier,
          fulfillment_type,
          payment_provider,
          payment_status,
          order_status,
          total_amount,
          created_at
        `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return { data: [], error };
  }

  const orderIds = (data ?? []).map((order) => order.id);
  let itemsByOrderId = {};

  if (orderIds.length) {
    let { data: itemRows, error: itemError } = await supabase
      .from("order_items")
      .select(
        `
          id,
          order_id,
          product_id,
          quantity,
          unit_price,
          product_name_snapshot,
          product_sku_snapshot,
          selected_size,
          selected_color
        `
      )
      .in("order_id", orderIds);

    if (
      itemError &&
      /selected_size|selected_color|product_sku_snapshot/i.test(itemError.message || "")
    ) {
      const fallbackItems = await supabase
        .from("order_items")
        .select(
          `
            id,
            order_id,
            product_id,
            quantity,
            unit_price,
            product_name_snapshot
          `
        )
        .in("order_id", orderIds);

      itemRows = fallbackItems.data;
      itemError = fallbackItems.error;
    }

    if (itemError) {
      return { data: [], error: itemError };
    }

    const productIds = [...new Set((itemRows ?? []).map((item) => item.product_id).filter(Boolean))];
    let productsById = {};
    let imagesByProductId = {};

    if (productIds.length) {
      const { data: productRows } = await supabase
        .from("products")
        .select("id, name, main_image_url")
        .in("id", productIds);

      productsById = Object.fromEntries((productRows ?? []).map((product) => [product.id, product]));

      let { data: imageRows, error: imageError } = await supabase
        .from("product_images")
        .select("product_id, image_url, sort_order")
        .in("product_id", productIds)
        .order("sort_order", { ascending: true });

      if (imageError && /sort_order/i.test(imageError.message || "")) {
        const fallbackImages = await supabase
          .from("product_images")
          .select("product_id, image_url")
          .in("product_id", productIds);

        imageRows = fallbackImages.data;
        imageError = fallbackImages.error;
      }

      if (!imageError) {
        imagesByProductId = (imageRows ?? []).reduce((grouped, image) => {
          grouped[image.product_id] = grouped[image.product_id] || [];
          grouped[image.product_id].push(image.image_url);
          return grouped;
        }, {});
      }
    }

    itemsByOrderId = (itemRows ?? []).reduce((grouped, item) => {
      grouped[item.order_id] = grouped[item.order_id] || [];
      grouped[item.order_id].push(mapOrderItem(item, productsById, imagesByProductId));
      return grouped;
    }, {});
  }

  return {
    data: (data ?? []).map((order) => {
      const orderItems = applyVariantNoteFallbacks(
        itemsByOrderId[order.id] ?? [],
        order.delivery_notes
      );
      const statusTone = getOrderStatusTone(order.order_status);
      const paymentTone = getPaymentTone(order);

      return {
        id: order.order_number,
        rawId: order.id,
        customer: order.delivery_recipient_name ?? order.guest_name ?? "Client",
        phone: order.delivery_contact_phone ?? order.guest_phone ?? "",
        zone:
          [order.delivery_commune, order.delivery_quartier]
            .filter(Boolean)
            .join(", ") || order.delivery_city || "Livraison",
        landmark: order.delivery_landmark || order.delivery_address || "",
        addressType: "Livraison",
        items: orderItems.length,
        itemsCount: orderItems.reduce((total, item) => total + Number(item.quantity || 0), 0),
        itemsSummary: orderItems.length
          ? orderItems.map((item) => `${item.quantity} x ${item.name}`).join(", ")
          : "Articles non charges",
        orderItems,
        payment:
          order.payment_status === "paid"
            ? "Payé"
            : order.payment_provider === "cash_on_delivery"
              ? "A la livraison"
              : "En attente",
        status: mapOrderStatus(order.order_status),
        rawStatus: order.order_status,
        hasDjomiTransaction: Boolean(order.djomi_transaction_id),
        djomiPaymentStatus: order.djomi_payment_status ?? "",
        statusTone,
        paymentTone,
        tone: statusTone,
        total: Number(order.total_amount),
        createdAt: order.created_at,
        createdDate: order.created_at?.slice(0, 10) ?? "",
      };
    }),
    error: null,
  };
}

export async function updateAdminOrderStatus(orderId, nextStatus) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("orders")
    .update({ order_status: nextStatus })
    .eq("id", orderId)
    .select("id, order_status, payment_status")
    .single();

  if (error) {
    return { data: null, error };
  }

  return {
    data: {
      rawStatus: data.order_status,
      status: mapOrderStatus(data.order_status),
      statusTone: getOrderStatusTone(data.order_status),
      paymentTone: data.payment_status === "paid" ? "paid" : "waiting",
      tone: getOrderStatusTone(data.order_status),
    },
    error: null,
  };
}

export async function deleteOrderAsOwner(orderId) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase.rpc("bma_delete_order", {
    p_order_id: orderId,
  });

  return { data, error };
}

function mapAccountingEntry(entry, deposit = null) {
  return {
    id: entry.id,
    orderId: entry.order_number ?? "-",
    productId: entry.product_id ?? "",
    quantity: Number(entry.quantity ?? 1),
    date: entry.entry_date,
    customer: entry.customer_name ?? "Client",
    saleAmount: Number(entry.sale_amount ?? 0),
    purchaseAmount: Number(entry.purchase_amount ?? 0),
    extraCost: Math.max(
      0,
      Number(entry.cost_amount ?? 0) - Number(entry.purchase_amount ?? 0)
    ),
    costAmount: Number(entry.cost_amount ?? 0),
    paymentMethod: collectionLabelByMethod[entry.collection_method] ?? "Autre",
    collectedBy: entry.collected_by_name ?? "-",
    note: entry.note ?? "",
    depositedBy: deposit?.deposited_by_name ?? "",
    orangeMoneyRef: deposit?.orange_money_reference ?? "",
    receiptName: deposit?.receipt_file_name ?? "",
    receiptPath: deposit?.receipt_url ?? "",
    receiptUrl: deposit?.receipt_signed_url ?? "",
    depositedAt: deposit?.deposited_at?.slice(0, 10) ?? "",
  };
}

async function mapAccountingEntryFromRpc(entry) {
  return mapAccountingEntry(
    {
      id: entry.id,
      order_number: entry.order_number,
      product_id: entry.product_id,
      quantity: entry.quantity,
      entry_date: entry.entry_date,
      customer_name: entry.customer_name,
      sale_amount: entry.sale_amount,
      purchase_amount: entry.purchase_amount,
      cost_amount: entry.cost_amount,
      collection_method: entry.collection_method,
      collected_by_name: entry.collected_by_name,
      collected_at: entry.collected_at,
      note: entry.note,
    },
    {
      orange_money_reference: entry.deposit_orange_money_reference,
      deposited_by_name: entry.deposit_deposited_by_name,
      receipt_url: entry.deposit_receipt_url,
      receipt_file_name: entry.deposit_receipt_file_name,
      deposited_at: entry.deposit_deposited_at,
      receipt_signed_url: await createReceiptSignedUrl(entry.deposit_receipt_url),
    }
  );
}

export async function fetchAccountingEntries() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const rpcResult = await supabase.rpc("get_admin_accounting_entries");

  if (!rpcResult.error) {
    return {
      data: await Promise.all((rpcResult.data ?? []).map(mapAccountingEntryFromRpc)),
      error: null,
    };
  }

  if (!isMissingRpc(rpcResult.error)) {
    return { data: [], error: rpcResult.error };
  }

  let { data, error } = await supabase
    .from("accounting_entries")
    .select(
      `
        id,
        order_number,
        product_id,
        quantity,
        entry_date,
        customer_name,
        sale_amount,
        purchase_amount,
        cost_amount,
        collection_method,
        collected_by_name,
        collected_at,
        note
      `
    )
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error && /product_id|quantity/i.test(error.message || "")) {
    const fallback = await supabase
      .from("accounting_entries")
      .select(
        `
          id,
          order_number,
          entry_date,
          customer_name,
          sale_amount,
          purchase_amount,
          cost_amount,
          collection_method,
          collected_by_name,
          collected_at,
          note
        `
      )
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);

    data = fallback.data;
    error = fallback.error;
  }

  if (error) {
    return { data: [], error };
  }

  const entryIds = data.map((entry) => entry.id);
  let depositsByEntryId = {};

  if (entryIds.length) {
    const { data: depositItems } = await supabase
      .from("orange_money_deposit_items")
      .select(
        `
          accounting_entry_id,
          orange_money_deposits (
            orange_money_reference,
            deposited_by_name,
            receipt_url,
            receipt_file_name,
            deposited_at
          )
        `
      )
      .in("accounting_entry_id", entryIds);

    depositsByEntryId = Object.fromEntries(
      (depositItems ?? []).map((item) => [
        item.accounting_entry_id,
        item.orange_money_deposits,
      ])
    );

    const depositsWithReceiptLinks = await Promise.all(
      Object.entries(depositsByEntryId).map(async ([entryId, deposit]) => [
        entryId,
        {
          ...deposit,
          receipt_signed_url: await createReceiptSignedUrl(deposit?.receipt_url),
        },
      ])
    );

    depositsByEntryId = Object.fromEntries(depositsWithReceiptLinks);
  }

  return {
    data: data.map((entry) => mapAccountingEntry(entry, depositsByEntryId[entry.id])),
    error: null,
  };
}

export async function deleteAccountingEntryAsOwner(entryId) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase.rpc("bma_delete_accounting_entry", {
    p_entry_id: entryId,
  });

  return { data, error };
}

export async function fetchStockMovements() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("stock_movements")
    .select(
      `
        id,
        product_id,
        quantity_delta,
        stock_before,
        stock_after,
        reason,
        reference_type,
        reference_id,
        note,
        created_by_name,
        created_at,
        products(name, main_image_url)
      `
    )
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    return { data: [], error };
  }

  return {
    data: (data ?? []).map((movement) => ({
      id: movement.id,
      productId: movement.product_id,
      productName: movement.products?.name ?? "Article",
      image: movement.products?.main_image_url || publicImageFallback,
      delta: Number(movement.quantity_delta || 0),
      stockBefore: Number(movement.stock_before || 0),
      stockAfter: Number(movement.stock_after || 0),
      reason: movement.reason,
      referenceType: movement.reference_type ?? "",
      referenceId: movement.reference_id ?? "",
      note: movement.note ?? "",
      actor: movement.created_by_name ?? "-",
      createdAt: movement.created_at,
      createdDate: movement.created_at?.slice(0, 10) ?? "",
    })),
    error: null,
  };
}

export async function createAccountingEntry(record) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const currentUserId = await getCurrentUserId();
  const rpcPayload = {
    p_product_id: record.productId || null,
    p_quantity: Number(record.quantity || 1),
    p_order_number: record.orderId,
    p_entry_date: record.date,
    p_customer_name: record.customer,
    p_sale_amount: Number(record.saleAmount),
    p_purchase_amount: Number(record.purchaseAmount),
    p_cost_amount: Number(record.costAmount),
    p_collection_method: collectionMethodByLabel[record.paymentMethod] ?? "other",
    p_collected_by_name: record.collectedBy,
    p_note: record.note || null,
  };

  const rpcResult = await supabase.rpc("record_manual_sale", rpcPayload);

  if (!rpcResult.error) {
    return { data: mapAccountingEntry(rpcResult.data), error: null };
  }

  if (!isMissingRpc(rpcResult.error)) {
    return { data: null, error: rpcResult.error };
  }

  const entryPayload = {
    order_number: record.orderId,
    product_id: record.productId || null,
    quantity: Number(record.quantity || 1),
    entry_date: record.date,
    customer_name: record.customer,
    sale_amount: Number(record.saleAmount),
    purchase_amount: Number(record.purchaseAmount),
    cost_amount: Number(record.costAmount),
    collection_method: collectionMethodByLabel[record.paymentMethod] ?? "other",
    collected_by: currentUserId,
    collected_by_name: record.collectedBy,
    collected_at: new Date().toISOString(),
    note: record.note || null,
  };

  let { data, error } = await supabase
    .from("accounting_entries")
    .insert(entryPayload)
    .select(
      `
        id,
        order_number,
        product_id,
        quantity,
        entry_date,
        customer_name,
        sale_amount,
        purchase_amount,
        cost_amount,
        collection_method,
        collected_by_name,
        collected_at,
        note
      `
    )
    .single();

  if (error && /product_id|quantity/i.test(error.message || "")) {
    const fallbackPayload = { ...entryPayload };
    delete fallbackPayload.product_id;
    delete fallbackPayload.quantity;

    const fallback = await supabase
      .from("accounting_entries")
      .insert(fallbackPayload)
      .select(
        `
          id,
          order_number,
          entry_date,
          customer_name,
          sale_amount,
          purchase_amount,
          cost_amount,
          collection_method,
          collected_by_name,
          collected_at,
          note
        `
      )
      .single();

    data = fallback.data
      ? {
          ...fallback.data,
          product_id: record.productId || null,
          quantity: Number(record.quantity || 1),
        }
      : null;
    error = fallback.error;
  }

  if (error) {
    return { data: null, error };
  }

  if (record.productId) {
    const stockResult = await adjustProductStock({
      productId: record.productId,
      quantityDelta: -Math.max(1, Number(record.quantity || 1)),
      reason: "manual_sale",
      referenceType: "accounting_entry",
      referenceId: data.id,
      note: record.orderId,
    });

    if (stockResult.error) {
      return { data: mapAccountingEntry(data), error: stockResult.error };
    }
  }

  return { data: mapAccountingEntry(data), error: null };
}

export async function adjustProductStock({
  productId,
  quantityDelta,
  reason = "adjustment",
  referenceType = "",
  referenceId = "",
  note = "",
}) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase.rpc("adjust_product_stock", {
    p_product_id: productId,
    p_quantity_delta: Number(quantityDelta),
    p_reason: reason,
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null,
    p_note: note || null,
  });

  if (!error) {
    return { data: Array.isArray(data) ? data[0] : data, error: null };
  }

  if (!isMissingRpc(error)) {
    return { data: null, error };
  }

  const { data: currentProduct, error: readError } = await supabase
    .from("products")
    .select("id, stock")
    .eq("id", productId)
    .single();

  if (readError) return { data: null, error: readError };

  const nextStock = Number(currentProduct.stock || 0) + Number(quantityDelta || 0);

  if (nextStock < 0) {
    return { data: null, error: new Error("Stock insuffisant pour cette vente.") };
  }

  return updateProductStock(productId, nextStock);
}

export async function createOrangeMoneyDeposit({
  record,
  reference,
  receiptName,
  receiptPath = "",
  depositedBy,
}) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const currentUserId = await getCurrentUserId();

  let { data: deposit, error: depositError } = await supabase
    .from("orange_money_deposits")
    .insert({
      amount: Number(record.saleAmount),
      deposited_by: currentUserId,
      deposited_by_name: depositedBy,
      orange_money_reference: reference,
      receipt_url: receiptPath || null,
      receipt_file_name: receiptName || null,
    })
    .select("id, orange_money_reference, deposited_by_name, receipt_url, receipt_file_name, deposited_at")
    .single();

  if (depositError && /receipt_url/i.test(depositError.message || "")) {
    const fallbackDeposit = await supabase
      .from("orange_money_deposits")
      .insert({
        amount: Number(record.saleAmount),
        deposited_by: currentUserId,
        deposited_by_name: depositedBy,
        orange_money_reference: reference,
        receipt_file_name: receiptName || null,
      })
      .select("id, orange_money_reference, deposited_by_name, receipt_file_name, deposited_at")
      .single();

    deposit = fallbackDeposit.data ? { ...fallbackDeposit.data, receipt_url: "" } : null;
    depositError = fallbackDeposit.error;
  }

  if (depositError) {
    return { data: null, error: depositError };
  }

  const { error: itemError } = await supabase.from("orange_money_deposit_items").insert({
    deposit_id: deposit.id,
    accounting_entry_id: record.id,
    amount: Number(record.saleAmount),
  });

  if (itemError) {
    return { data: null, error: itemError };
  }

  return {
    data: {
      orangeMoneyRef: deposit.orange_money_reference,
      depositedBy: deposit.deposited_by_name,
      receiptName: deposit.receipt_file_name || "recu-non-joint",
      receiptPath: deposit.receipt_url || "",
      receiptUrl: await createReceiptSignedUrl(deposit.receipt_url),
      depositedAt: deposit.deposited_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    },
    error: null,
  };
}

export async function uploadOrangeMoneyReceipt(file) {
  if (!file) {
    return { data: { path: "", name: "" }, error: null };
  }

  if (!supabase) {
    return { data: null, error: new Error("Stockage reçu indisponible.") };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeName = slugify(file.name.replace(/\.[^/.]+$/, "")) || "recu-orange-money";
  const filePath = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${safeName}-${Math.random()
    .toString(36)
    .slice(2)}.${extension}`;

  const { error } = await supabase.storage.from(receiptBucket).upload(filePath, file, {
    cacheControl: "3600",
    upsert: false,
  });

  if (error) {
    return { data: null, error };
  }

  return { data: { path: filePath, name: file.name }, error: null };
}

export async function fetchRolePermissions() {
  if (!supabase) {
    return { data: [], error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("role_permissions")
    .select("role, permission_key, label, is_enabled")
    .order("role", { ascending: true })
    .order("permission_key", { ascending: true });

  return { data: data ?? [], error };
}

export async function updateRolePermission(role, permissionKey, isEnabled) {
  if (!supabase) {
    return { data: null, error: new Error("Configuration de la boutique indisponible.") };
  }

  const { data, error } = await supabase
    .from("role_permissions")
    .update({ is_enabled: isEnabled })
    .eq("role", role)
    .eq("permission_key", permissionKey)
    .select("role, permission_key, label, is_enabled")
    .single();

  return { data, error };
}
