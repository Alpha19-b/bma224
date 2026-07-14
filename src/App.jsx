import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleUserRound,
  LogOut,
  Package,
  Search,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import {
  adjustProductColorStock,
  adjustProductStock,
  adjustProductVariantStock,
  confirmDjomiPayment,
  createAccountingEntry,
  createDjomiPaymentSession,
  createOrangeMoneyDeposit,
  createProduct,
  createCheckoutOrder,
  createTreasuryMovement,
  deleteAccountingEntryAsOwner,
  deleteOrderAsOwner,
  deleteProductAsOwner,
  fetchAccountingEntries,
  fetchAdminProducts,
  fetchAdminOrders,
  fetchCurrentAdminContext,
  fetchCustomerOrders,
  fetchProducts,
  fetchProductSalesLedger,
  fetchRolePermissions,
  fetchStaffMembers,
  fetchStockMovements,
  fetchTreasuryMovements,
  inviteStaffMember,
  removeStaffMember,
  replaceProductImages,
  replaceProductOptions,
  syncDjomiPayments,
  updateProduct,
  updateAdminOrderStatus,
  updateRolePermission,
  updateStaffMemberRole,
  uploadOrangeMoneyReceipt,
  uploadProductImage,
} from "./services/shopApi.js";
import {
  fetchCustomerProfile,
  getCurrentSession,
  onAuthChange,
  signInAdmin,
  signOutAdmin,
  signUpCustomer,
  updateAccountMetadata,
  updateCustomerPassword,
  updateCustomerProfile,
} from "./services/authApi.js";

const formatMoney = (value) => `${Number(value || 0).toLocaleString("fr-FR")} GNF`;

const clampQuantity = (value, max) => {
  const stockLimit = Math.max(0, Number(max) || 0);
  if (stockLimit <= 0) return 0;

  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return 1;
  return Math.max(1, Math.min(number, stockLimit));
};

const getProductPrice = (product) => product.promoPrice ?? product.price;
const getPurchasePrice = (product) =>
  product.purchasePrice ?? Math.round(getProductPrice(product) * 0.65);
const getCostPrice = (product) =>
  product.costPrice ?? Math.round(getProductPrice(product) * 0.78);
const lowStockLabel = (stock) => {
  const count = Number(stock || 0);
  if (count <= 0) return "Indisponible";
  if (count <= 3) return `Plus que ${count} en stock`;
  return "Disponible maintenant";
};
const DELIVERY_FEE_GNF = 0;
const staffRoleLabels = {
  owner: "Super admin",
  manager: "Manager",
  staff: "Vendeur",
};

const ORDER_RECEIVED_STATUSES = new Set(["pending_payment", "confirmed"]);
const ORDER_PREPARING_STATUSES = new Set([
  "preparing",
  "ready",
  "ready_for_pickup",
  "assigned_to_delivery",
  "in_delivery",
]);
const ORDER_TERMINAL_STATUSES = new Set(["delivered", "cancelled", "delivery_failed"]);

const orderFilterOptions = [
  { value: "open", label: "Ouvertes" },
  { value: "preparing", label: "Prépa" },
  { value: "unpaid", label: "À payer" },
  { value: "paid", label: "Payées" },
  { value: "delivered", label: "Livrées" },
  { value: "all", label: "Tout" },
];

const clientOrderFilterOptions = [
  { value: "open", label: "En cours" },
  { value: "unpaid", label: "À payer" },
  { value: "paid", label: "Payées" },
  { value: "delivered", label: "Livrées" },
  { value: "all", label: "Tout" },
];

function isOrderPaid(order) {
  return order?.paymentTone === "paid" || order?.payment === "Payé" || order?.payment === "Paye";
}

function matchesOrderFilter(order, filter) {
  if (filter === "all") return true;
  if (filter === "open") return !ORDER_TERMINAL_STATUSES.has(order.rawStatus);
  if (filter === "received") return ORDER_RECEIVED_STATUSES.has(order.rawStatus);
  if (filter === "preparing") return ORDER_PREPARING_STATUSES.has(order.rawStatus);
  if (filter === "unpaid") return !isOrderPaid(order);
  if (filter === "paid") return isOrderPaid(order);
  if (filter === "delivered") return order.rawStatus === "delivered";
  if (filter === "paid_delivered") return order.rawStatus === "delivered" && isOrderPaid(order);
  if (filter === "cancelled") return ["cancelled", "delivery_failed"].includes(order.rawStatus);
  return true;
}

function countOrdersByFilter(orders, filter) {
  return orders.filter((order) => matchesOrderFilter(order, filter)).length;
}

function canMoveOrderStatus(order, nextStatus, isSuperAdmin = false) {
  if (!order?.rawStatus) return false;
  if (order.rawStatus === nextStatus) return false;
  if (ORDER_TERMINAL_STATUSES.has(order.rawStatus)) {
    return isSuperAdmin && nextStatus === "preparing";
  }

  if (nextStatus === "preparing") {
    return ORDER_RECEIVED_STATUSES.has(order.rawStatus);
  }

  if (nextStatus === "delivered") {
    return !ORDER_TERMINAL_STATUSES.has(order.rawStatus) && isOrderPaid(order);
  }

  if (nextStatus === "cancelled") {
    return order.rawStatus !== "delivered";
  }

  return false;
}

function getStatusMoveBlockReason(order, nextStatus, isSuperAdmin = false) {
  if (!order?.rawStatus) return "Commande introuvable.";
  if (ORDER_TERMINAL_STATUSES.has(order.rawStatus) && !isSuperAdmin) {
    return "Cette commande est déjà terminée. Contacte le super admin pour la réouvrir.";
  }
  if (nextStatus === "delivered" && !isOrderPaid(order)) {
    return "Impossible de livrer une commande dont le paiement n'est pas confirmé.";
  }
  if (nextStatus === "preparing" && !ORDER_RECEIVED_STATUSES.has(order.rawStatus)) {
    return "Cette commande ne peut pas revenir en préparation.";
  }
  return "Transition de statut non autorisée.";
}

const emptyCheckout = {
  recipientName: "",
  contactPhone: "",
  city: "",
  commune: "",
  quartier: "",
  landmark: "",
  note: "",
  latitude: "",
  longitude: "",
  mapLabel: "",
};

const emptyClientAuthForm = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  phone: "",
  preferredAddress: "",
  preferredCommune: "",
  preferredQuartier: "",
  latitude: "",
  longitude: "",
};

const emptyClientSettingsForm = {
  firstName: "",
  lastName: "",
  phone: "",
  preferredAddress: "",
  preferredCommune: "",
  preferredQuartier: "",
  latitude: "",
  longitude: "",
  newPassword: "",
  passwordConfirm: "",
};

const emptyAdminAccountForm = {
  fullName: "",
  newPassword: "",
  passwordConfirm: "",
};

const emptyTreasuryForm = {
  date: getTodayDateInput(),
  account: "orange_money",
  direction: "out",
  category: "stock_purchase",
  amount: "",
  label: "",
  note: "",
};

const commonColorSwatches = {
  Noir: "#111820",
  Blanc: "#ffffff",
  Bleu: "#2563eb",
  "Bleu clair": "#93c5fd",
  "Bleu claire": "#93c5fd",
  "Bleu ciel": "#7dd3fc",
  Rouge: "#c94136",
  Orange: "#f97316",
  Vert: "#0f8a5f",
  Beige: "#d8c3a5",
  Kaki: "#8a8f45",
  Marron: "#7a4a28",
  Jaune: "#f4c542",
  Rose: "#ec4899",
  Gris: "#667085",
  "Gris clair": "#cbd5e1",
  "Gris fonce": "#344054",
  "Gris foncé": "#344054",
  Violet: "#7c3aed",
};

function normalizeColorLookupLabel(label) {
  return String(label || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getKnownColorHex(label) {
  const normalizedLabel = normalizeColorLookupLabel(label);

  const match = Object.entries(commonColorSwatches).find(
    ([name]) => normalizeColorLookupLabel(name) === normalizedLabel
  );

  return match?.[1] || "";
}

function getColorParts(label) {
  return uniqueOptionValues(
    String(label || "")
      .split(/\s*(?:\/|\+|,|&|\bet\b)\s*/i)
      .map((part) => part.trim())
  );
}

function getSwatchStops(colors) {
  const segment = 100 / colors.length;

  return colors
    .map((color, index) => {
      const start = Math.round(segment * index);
      const end = Math.round(segment * (index + 1));
      return `${color} ${start}% ${end}%`;
    })
    .join(", ");
}

function ActionIcon({ name }) {
  const commonProps = {
    className: "action-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
  };

  switch (name) {
    case "trash":
      return (
        <svg {...commonProps}>
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M6 6l1 15h10l1-15" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      );
    case "download":
      return (
        <svg {...commonProps}>
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      );
    case "select":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 12l3 3 5-6" />
        </svg>
      );
    case "user":
      return (
        <svg {...commonProps}>
          <path d="M20 21a8 8 0 0 0-16 0" />
          <circle cx="12" cy="8" r="4" />
        </svg>
      );
    case "plus":
      return (
        <svg {...commonProps}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "minus":
      return (
        <svg {...commonProps}>
          <path d="M5 12h14" />
        </svg>
      );
    case "edit":
      return (
        <svg {...commonProps}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5l4 4L8 20H4v-4L16.5 3.5z" />
        </svg>
      );
    case "package":
      return (
        <svg {...commonProps}>
          <path d="M21 8l-9-5-9 5 9 5 9-5z" />
          <path d="M3 8v8l9 5 9-5V8" />
          <path d="M12 13v8" />
        </svg>
      );
    case "check":
      return (
        <svg {...commonProps}>
          <path d="M20 6L9 17l-5-5" />
        </svg>
      );
    case "x":
      return (
        <svg {...commonProps}>
          <path d="M18 6L6 18" />
          <path d="M6 6l12 12" />
        </svg>
      );
    case "arrow-left":
      return (
        <svg {...commonProps}>
          <path d="M19 12H5" />
          <path d="M11 18l-6-6 6-6" />
        </svg>
      );
    case "arrow-right":
      return (
        <svg {...commonProps}>
          <path d="M5 12h14" />
          <path d="M13 6l6 6-6 6" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...commonProps}>
          <path d="M4 7h16v12H4z" />
          <path d="M16 12h4" />
          <path d="M4 7l3-4h12" />
        </svg>
      );
    default:
      return null;
  }
}

function ActionButton({
  icon,
  label,
  count,
  className = "secondary",
  type = "button",
  title,
  disabled,
  onClick,
  iconOnly = false,
}) {
  const buttonLabel = title || label;

  return (
    <button
      className={[
        "btn compact-btn action-icon-button",
        className,
        iconOnly ? "icon-only" : "",
        count ? "has-count" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      type={type}
      title={buttonLabel}
      aria-label={buttonLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <ActionIcon name={icon} />
      <span className="action-label">{label}</span>
      {count ? <strong className="action-count">{count}</strong> : null}
    </button>
  );
}

function matchesStyleFilter(product, filter) {
  if (filter === "all") return true;
  if (filter === "promo") return Boolean(product.promoPrice);

  const text = `${product.name} ${product.category} ${product.description ?? ""}`.toLowerCase();
  const accessoryWords = ["accessoire", "sac", "bijou", "lunette", "ceinture", "montre", "chaussure"];
  const outfitWords = ["robe", "ensemble", "chemise", "pantalon", "veste", "jupe", "haut", "t-shirt"];

  if (filter === "accessories") {
    return accessoryWords.some((word) => text.includes(word));
  }

  if (filter === "outfits") {
    return outfitWords.some((word) => text.includes(word));
  }

  return true;
}

function normalizeVariantKey(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function uniqueOptionValues(values = []) {
  return [
    ...new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    ),
  ];
}

function getProductSizeOptions(product, colorValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const sizesByColor = product.sizesByColor ?? {};
  const colorSizes = colorKey ? sizesByColor[colorKey] ?? [] : [];
  const hasColorSpecificSizes = Object.keys(sizesByColor).length > 0;
  const fallbackSizes = product.globalSizes?.length
    ? product.globalSizes
    : hasColorSpecificSizes
      ? []
      : product.sizes ?? [];
  return uniqueOptionValues(colorSizes.length ? colorSizes : fallbackSizes);
}

function getProductColorOptions(product) {
  const seen = new Set();

  return (product.colors ?? [])
    .map((color) => {
      if (typeof color === "string") {
        const value = color.trim();
        return { value, hex: getKnownColorHex(value) };
      }

      const value = String(color?.value ?? "").trim();
      return {
        value,
        hex: color?.hex || getKnownColorHex(value),
      };
    })
    .filter((color) => {
      if (!color.value || seen.has(color.value)) return false;
      seen.add(color.value);
      return true;
    });
}

function getColorSwatchStyle(color) {
  const label = typeof color === "string" ? color : color?.value;
  const hex = typeof color === "string" ? "" : color?.hex;
  const parts = getColorParts(label);
  const colors = parts
    .map((part) => getKnownColorHex(part))
    .filter(Boolean);

  if (colors.length > 1) {
    return {
      background:
        colors.length === 2
          ? `linear-gradient(135deg, ${colors[0]} 0 50%, ${colors[1]} 50% 100%)`
          : `conic-gradient(${getSwatchStops(colors)})`,
    };
  }

  return { background: hex || colors[0] || getKnownColorHex(label) || "#d9e1ea" };
}

function getProductGalleryForColor(product, colorValue = "") {
  const allGallery = uniqueOptionValues([
    ...(product.imageEntries ?? []).map((entry) => entry.imageUrl || entry.image_url || entry.url || ""),
    ...(product.images ?? []),
    product.image,
  ]);
  const colorKey = normalizeVariantKey(colorValue);

  if (!colorKey) {
    return allGallery;
  }

  const colorGallery = uniqueOptionValues([
    ...((product.imageEntries ?? [])
      .filter((entry) => normalizeVariantKey(entry.color || entry.color_value) === colorKey)
      .map((entry) => entry.imageUrl || entry.image_url || entry.url || "")),
    ...(product.imagesByColor?.[colorKey] ?? []),
  ]);

  return colorGallery.length ? colorGallery : allGallery;
}

function getProductStockForColor(product, colorValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const stockByColor = product.stockByColor ?? {};
  let stockValue = Math.max(0, Number(product.stock || 0));

  // Des que le total global et les options divergent, les options sont
  // historiques ou incompletes. Le total global reste la valeur canonique
  // jusqu'a ce que la repartition couleur/taille soit resynchronisee.
  if (hasDetailedStockMismatch(product)) {
    return stockValue;
  }

  if (colorKey && stockByColor[colorKey] !== undefined && stockByColor[colorKey] !== null) {
    stockValue = Math.max(0, Number(stockByColor[colorKey]) || 0);
  }

  return applyMissingSoldToStock(product, stockValue, colorValue);
}

function getVariantStockMap(product, colorValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const stockByVariant = product.stockByVariant ?? {};
  const stockMap = stockByVariant[colorKey] ?? stockByVariant[colorValue] ?? {};

  return stockMap && typeof stockMap === "object" ? stockMap : {};
}

function hasTrackedVariantStock(product, colorValue = "") {
  return Object.keys(getVariantStockMap(product, colorValue)).length > 0;
}

function getProductStockForSelection(product, colorValue = "", sizeValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const sizeKey = normalizeVariantKey(sizeValue);
  const stockForColor = getVariantStockMap(product, colorValue);

  if (hasDetailedStockMismatch(product)) {
    return Math.max(0, Number(product.stock || 0));
  }

  const exactStock =
    colorKey && sizeKey ? stockForColor[sizeKey] ?? stockForColor[sizeValue] : undefined;

  if (exactStock !== undefined && exactStock !== null) {
    return applyMissingSoldToStock(
      product,
      Math.max(0, Number(exactStock) || 0),
      colorValue,
      sizeValue
    );
  }

  if (colorKey && sizeKey && hasTrackedVariantStock(product, colorValue)) {
    return 0;
  }

  return getProductStockForColor(product, colorValue);
}

function getMissingSoldScale(product) {
  const ledger = product?.salesLedger ?? {};
  const soldTotal = Math.max(0, Number(ledger.soldTotal || 0));
  const missingSoldTotal = Math.max(0, Number(ledger.missingSoldTotal || 0));

  if (!soldTotal || !missingSoldTotal) return 0;
  return Math.min(1, missingSoldTotal / soldTotal);
}

function scaleMissingSold(quantity, scale) {
  if (!quantity || !scale) return 0;
  return Math.min(Number(quantity || 0), Math.ceil(Number(quantity || 0) * scale));
}

function getRawDetailedStockTotal(product) {
  const colorTotals = Object.values(product?.stockByColor ?? {}).map((value) =>
    Math.max(0, Number(value || 0))
  );
  const variantTotals = Object.values(product?.stockByVariant ?? {}).flatMap((stockForColor) =>
    Object.values(stockForColor ?? {}).map((value) => Math.max(0, Number(value || 0)))
  );

  if (variantTotals.length) return variantTotals.reduce((sum, value) => sum + value, 0);
  if (colorTotals.length) return colorTotals.reduce((sum, value) => sum + value, 0);
  return null;
}

function hasDetailedStockMismatch(product) {
  const rawDetailedTotal = getRawDetailedStockTotal(product);
  if (rawDetailedTotal === null) return false;

  return rawDetailedTotal !== Math.max(0, Number(product?.stock || 0));
}

function getMissingSoldForStock(product, colorValue = "", sizeValue = "") {
  const ledger = product?.salesLedger ?? {};
  const colorKey = normalizeVariantKey(colorValue);
  const sizeKey = normalizeVariantKey(sizeValue);

  // Quand le total global et les options détaillées ne correspondent plus,
  // les options sont historiques. On déduit alors les ventes retrouvées
  // directement des couleurs/tailles pour éviter qu'elles réapparaissent.
  if (hasDetailedStockMismatch(product)) {
    if (colorKey && sizeKey) {
      return Math.max(
        0,
        Number(
          ledger.soldByVariant?.[colorKey]?.[sizeKey] ??
            ledger.soldByVariant?.[colorValue]?.[sizeValue] ??
            0
        )
      );
    }

    if (colorKey) {
      return Math.max(
        0,
        Number(ledger.soldByColor?.[colorKey] ?? ledger.soldByColor?.[colorValue] ?? 0)
      );
    }

    return Math.max(0, Number(ledger.soldTotal || 0));
  }

  const scale = getMissingSoldScale(product);

  if (!scale) return 0;

  if (colorKey && sizeKey) {
    const rawVariantSold =
      ledger.soldByVariant?.[colorKey]?.[sizeKey] ??
      ledger.soldByVariant?.[colorValue]?.[sizeValue] ??
      0;
    return scaleMissingSold(rawVariantSold, scale);
  }

  if (colorKey) {
    const rawColorSold = ledger.soldByColor?.[colorKey] ?? ledger.soldByColor?.[colorValue] ?? 0;
    return scaleMissingSold(rawColorSold, scale);
  }

  return Math.max(0, Number(ledger.missingSoldTotal || 0));
}

function applyMissingSoldToStock(product, stockValue, colorValue = "", sizeValue = "") {
  const nextStock = Math.max(
    0,
    Number(stockValue || 0) - getMissingSoldForStock(product, colorValue, sizeValue)
  );

  return nextStock;
}

function hasExactVariantStock(product, colorValue = "", sizeValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const sizeKey = normalizeVariantKey(sizeValue);
  const stockForColor = getVariantStockMap(product, colorValue);
  const exactStock = stockForColor[sizeKey] ?? stockForColor[sizeValue];

  return Boolean(
    colorKey &&
      sizeKey &&
      exactStock !== undefined &&
      exactStock !== null
  );
}

function getSizeCandidatesForColor(sizesByColor = {}, globalSizes = [], colorValue = "") {
  const colorKey = normalizeVariantKey(colorValue);
  const colorSizes = sizesByColor[colorKey] ?? sizesByColor[colorValue] ?? [];
  return uniqueOptionValues(colorSizes.length ? colorSizes : globalSizes);
}

function parseStockDetailText(value, sizesByColor = {}, globalSizes = []) {
  return String(value ?? "")
    .split(/\n+/)
    .reduce(
      (result, line) => {
        const [colorPart, ...detailParts] = line.split(":");
        const color = colorPart?.trim();
        const detail = detailParts.join(":").trim();

        if (!color || !detail) return result;

        const colorKey = normalizeVariantKey(color);
        const sizeCandidates = getSizeCandidatesForColor(sizesByColor, globalSizes, color);
        const pieces = detail
          .split(",")
          .map((piece) => piece.trim())
          .filter(Boolean);

        pieces.forEach((piece) => {
          const numericOnly = piece.match(/^\d+$/);
          const quantityMatch = piece.match(/^(.*?)(?:\s*[=:x*]\s*|\s+)(\d+)$/i);
          const quantity = Number(numericOnly?.[0] ?? quantityMatch?.[2]);

          if (!Number.isFinite(quantity)) return;

          const rawSize = numericOnly
            ? sizeCandidates.length === 1
              ? sizeCandidates[0]
              : ""
            : quantityMatch?.[1]?.replace(/^taille\s+/i, "").trim();

          result.stockByColor[colorKey] = (result.stockByColor[colorKey] ?? 0) + Math.max(0, quantity);

          if (!rawSize) return;

          const sizeKey = normalizeVariantKey(rawSize);
          result.stockByVariant[colorKey] = result.stockByVariant[colorKey] || {};
          result.stockByVariant[colorKey][sizeKey] =
            (result.stockByVariant[colorKey][sizeKey] ?? 0) + Math.max(0, quantity);
          result.sizesByColor[colorKey] = uniqueOptionValues([
            ...(result.sizesByColor[colorKey] ?? []),
            rawSize,
          ]);
        });

        return result;
      },
      { stockByVariant: {}, stockByColor: {}, sizesByColor: {} }
    );
}

function mergeSizesByColor(primary = {}, additions = {}) {
  const merged = { ...primary };

  Object.entries(additions).forEach(([colorKey, sizes]) => {
    merged[colorKey] = uniqueOptionValues([...(merged[colorKey] ?? []), ...(sizes ?? [])]);
  });

  return merged;
}

function formatStockDetailText(stockByVariant = {}, sizesByColor = {}, colors = []) {
  const lines = [];
  const usedKeys = new Set();

  function addLine(colorLabel, colorKey) {
    const stockForColor = stockByVariant[colorKey] ?? stockByVariant[colorLabel] ?? {};
    const sizes = sizesByColor[colorKey] ?? sizesByColor[colorLabel] ?? Object.keys(stockForColor);
    const parts = uniqueOptionValues(sizes)
      .map((size) => {
        const quantity = stockForColor[normalizeVariantKey(size)] ?? stockForColor[size];
        return quantity === undefined || quantity === null ? "" : `${size} ${quantity}`;
      })
      .filter(Boolean);

    if (colorLabel && parts.length) {
      lines.push(`${colorLabel}: ${parts.join(", ")}`);
      usedKeys.add(colorKey);
    }
  }

  colors.forEach((color) => {
    const label = typeof color === "string" ? color : color?.value;
    addLine(label, normalizeVariantKey(label));
  });

  Object.entries(stockByVariant).forEach(([colorKey, stockForColor]) => {
    if (usedKeys.has(colorKey)) return;
    const sizes = sizesByColor[colorKey] ?? Object.keys(stockForColor);
    addLine(colorKey, colorKey, sizes);
  });

  return lines.join("\n");
}

function getProductStockBreakdown(product, limit = 3) {
  const lines = [];
  const colors = getProductColorOptions(product);
  const usedKeys = new Set();

  colors.forEach((color) => {
    const colorKey = normalizeVariantKey(color.value);
    const stockForColor = getVariantStockMap(product, color.value);
    const sizes = getProductSizeOptions(product, color.value);
    const sizeParts = sizes
      .map((size) => {
        const rawQuantity = stockForColor[normalizeVariantKey(size)] ?? stockForColor[size];
        const quantity =
          rawQuantity === undefined || rawQuantity === null
            ? rawQuantity
            : getProductStockForSelection(product, color.value, size);
        return quantity === undefined || quantity === null ? "" : `${size} ${quantity}`;
      })
      .filter(Boolean);

    if (sizeParts.length) {
      lines.push(`${color.value}: ${sizeParts.join(", ")}`);
    } else if (product.stockByColor?.[colorKey] !== undefined) {
      lines.push(`${color.value}: ${getProductStockForColor(product, color.value)}`);
    }

    usedKeys.add(colorKey);
  });

  Object.entries(product.stockByVariant ?? {}).forEach(([colorKey, stockForColor]) => {
    if (usedKeys.has(colorKey)) return;
    const parts = Object.entries(stockForColor).map(
      ([sizeKey, quantity]) =>
        `${sizeKey} ${applyMissingSoldToStock(product, quantity, colorKey, sizeKey)}`
    );
    if (parts.length) lines.push(`${colorKey}: ${parts.join(", ")}`);
  });

  if (!lines.length) return "";

  return lines.length > limit
    ? `${lines.slice(0, limit).join(" · ")} · +${lines.length - limit}`
    : lines.join(" · ");
}

function getProductStockDetailRows(product) {
  const rows = [];
  const colors = getProductColorOptions(product);
  const usedKeys = new Set();

  colors.forEach((color) => {
    const colorKey = normalizeVariantKey(color.value);
    const stockForColor = getVariantStockMap(product, color.value);
    const sizeRows = getProductSizeOptions(product, color.value)
      .map((size) => {
        const rawQuantity = stockForColor[normalizeVariantKey(size)] ?? stockForColor[size];

        return {
          size,
          quantity:
            rawQuantity === undefined || rawQuantity === null
              ? rawQuantity
              : applyMissingSoldToStock(product, rawQuantity, color.value, size),
        };
      });
    const trackedSizeRows = sizeRows.filter(
      (row) => row.quantity !== undefined && row.quantity !== null
    );
    const hasExactSizeStock = trackedSizeRows.length > 0;
    const colorTotal = hasExactSizeStock
      ? trackedSizeRows.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
      : product.stockByColor?.[colorKey] ?? null;
    const adjustedColorTotal =
      colorTotal === null
        ? null
        : hasExactSizeStock
          ? colorTotal
          : applyMissingSoldToStock(product, colorTotal, color.value);

    if (colorTotal !== null || sizeRows.length) {
      rows.push({
        color: color.value,
        hex: color.hex,
        total: Math.max(0, Number(adjustedColorTotal || 0)),
        sizes: sizeRows,
        hasExactSizeStock,
      });
    }

    usedKeys.add(colorKey);
  });

  Object.entries(product.stockByColor ?? {}).forEach(([colorKey, quantity]) => {
    if (usedKeys.has(colorKey)) return;
    rows.push({
      color: colorKey,
      hex: getKnownColorHex(colorKey),
      total: applyMissingSoldToStock(product, Math.max(0, Number(quantity || 0)), colorKey),
      sizes: [],
      hasExactSizeStock: false,
    });
    usedKeys.add(colorKey);
  });

  Object.entries(product.stockByVariant ?? {}).forEach(([colorKey, stockForColor]) => {
    if (usedKeys.has(colorKey)) return;

    const sizes = Object.entries(stockForColor).map(([size, quantity]) => ({
      size,
      quantity: applyMissingSoldToStock(product, quantity, colorKey, size),
    }));

    rows.push({
      color: colorKey,
      hex: getKnownColorHex(colorKey),
      total: sizes.reduce((sum, row) => sum + Number(row.quantity || 0), 0),
      sizes,
      hasExactSizeStock: true,
    });
  });

  return rows;
}

function getProductEffectiveStock(product) {
  const baseStock = Math.max(0, Number(product.stock || 0));
  const hasDetailedColorStock = Object.keys(product.stockByColor ?? {}).length > 0;
  const hasDetailedVariantStock = Object.values(product.stockByVariant ?? {}).some(
    (stockForColor) =>
      stockForColor && typeof stockForColor === "object" && Object.keys(stockForColor).length > 0
  );

  if (!hasDetailedColorStock && !hasDetailedVariantStock) {
    return applyMissingSoldToStock(product, baseStock);
  }

  if (hasDetailedStockMismatch(product)) {
    return baseStock;
  }

  return getProductStockDetailRows(product).reduce(
    (sum, row) => sum + Math.max(0, Number(row.total || 0)),
    0
  );
}

function parseManualVariantRows(rawText, product) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length || !product) return [];

  const colorOptions = getProductColorOptions(product);
  const allSizes = uniqueOptionValues([
    ...getProductSizeOptions(product),
    ...colorOptions.flatMap((color) => getProductSizeOptions(product, color.value)),
  ]);

  return lines.map((line) => {
    const quantityMatch =
      line.match(/(?:x|\*)\s*(\d+)\s*$/i) ||
      line.match(/:\s*(\d+)\s*$/) ||
      line.match(/\b(?:qte|qté|quantite|quantité|nombre|nb)\s*(\d+)\s*$/i);
    const quantity = Math.max(1, Number(quantityMatch?.[1] || 1));
    const searchable = quantityMatch ? line.slice(0, quantityMatch.index).trim() : line;
    const normalizedLine = normalizeVariantKey(searchable || line);
    const color = colorOptions.find((option) =>
      normalizedLine.includes(normalizeVariantKey(option.value))
    )?.value;
    const size = allSizes.find((option) =>
      normalizedLine.includes(normalizeVariantKey(option))
    );

    return {
      line,
      color: color || "",
      size: size || "",
      quantity,
    };
  });
}

function getManualSaleColorDeltas(product, accountingForm, quantity) {
  if (!product) return [];

  const grouped = new Map();
  const rows = parseManualVariantRows(accountingForm.saleVariantLines, product);
  const usefulRows = rows.filter((row) => row.color);

  if (usefulRows.length) {
    usefulRows.forEach((row) => {
      const key = normalizeVariantKey(row.color);
      const current = grouped.get(key) || { color: row.color, quantity: 0 };
      current.quantity += row.quantity;
      grouped.set(key, current);
    });
  } else if (accountingForm.saleColor) {
    const key = normalizeVariantKey(accountingForm.saleColor);
    grouped.set(key, { color: accountingForm.saleColor, quantity });
  }

  return [...grouped.values()].filter((row) => row.color && row.quantity > 0);
}

function getManualSaleVariantDeltas(product, accountingForm, quantity) {
  if (!product) return [];

  const grouped = new Map();
  const rows = parseManualVariantRows(accountingForm.saleVariantLines, product);
  const usefulRows = rows.filter((row) => row.color && row.size);

  if (usefulRows.length) {
    usefulRows.forEach((row) => {
      const key = `${normalizeVariantKey(row.color)}|${normalizeVariantKey(row.size)}`;
      const current = grouped.get(key) || {
        color: row.color,
        size: row.size,
        quantity: 0,
      };
      current.quantity += row.quantity;
      grouped.set(key, current);
    });
  } else if (accountingForm.saleColor && accountingForm.saleSize) {
    const key = `${normalizeVariantKey(accountingForm.saleColor)}|${normalizeVariantKey(accountingForm.saleSize)}`;
    grouped.set(key, {
      color: accountingForm.saleColor,
      size: accountingForm.saleSize,
      quantity,
    });
  }

  return [...grouped.values()].filter(
    (row) => row.color && row.size && row.quantity > 0
  );
}

function getProductImageEntries(product) {
  const entries = product.imageEntries?.length
    ? product.imageEntries
    : (product.images ?? []).map((imageUrl) => ({ imageUrl, color: "" }));

  return entries
    .map((entry) => ({
      imageUrl: entry.imageUrl || entry.image_url || entry.url || "",
      color: String(entry.color || entry.color_value || "").trim(),
    }))
    .filter((entry) => entry.imageUrl);
}

function buildImagesByColor(imageEntries = []) {
  return imageEntries.reduce((grouped, entry) => {
    const colorKey = normalizeVariantKey(entry.color);
    if (!colorKey || !entry.imageUrl) return grouped;
    grouped[colorKey] = grouped[colorKey] || [];
    grouped[colorKey].push(entry.imageUrl);
    return grouped;
  }, {});
}

function sortImageEntriesForCover(imageEntries = []) {
  return [...imageEntries].sort((first, second) => {
    const firstHasColor = Boolean(String(first.color || "").trim());
    const secondHasColor = Boolean(String(second.color || "").trim());

    if (firstHasColor === secondHasColor) return 0;
    return firstHasColor ? 1 : -1;
  });
}

function getAccountingReceiptEntries(record) {
  const historyReceipts = (record?.depositHistory ?? [])
    .filter((deposit) => deposit.receiptUrl || deposit.receiptName)
    .map((deposit, index) => ({
      key: `${deposit.orangeMoneyRef || deposit.receiptName || "receipt"}-${index}`,
      label: deposit.orangeMoneyRef || `Recu ${index + 1}`,
      receiptUrl: deposit.receiptUrl || "",
      receiptName: deposit.receiptName || "",
      amount: Number(deposit.amount || 0),
      depositedAt: deposit.depositedAt || "",
      depositedBy: deposit.depositedBy || "",
    }));

  if (historyReceipts.length) return historyReceipts;

  if (record?.receiptUrl || record?.receiptName) {
    return [
      {
        key: "main-receipt",
        label: record.orangeMoneyRef || "Recu",
        receiptUrl: record.receiptUrl || "",
        receiptName: record.receiptName || "",
        amount: Number(record.depositAmount || record.saleAmount || 0),
        depositedAt: record.depositedAt || "",
        depositedBy: record.depositedBy || "",
      },
    ];
  }

  return [];
}

function getSessionProfile(session, profile = null) {
  const metadata = session?.user?.user_metadata ?? {};
  const firstName = profile?.firstName ?? metadata.first_name ?? "";
  const lastName = profile?.lastName ?? metadata.last_name ?? "";
  return {
    firstName,
    lastName,
    fullName: profile?.fullName || metadata.full_name || [firstName, lastName].filter(Boolean).join(" "),
    phone: profile?.phone ?? metadata.phone ?? "",
    preferredAddress:
      profile?.preferredAddress ?? metadata.preferred_delivery_address ?? "",
    preferredCommune:
      profile?.preferredCommune ?? metadata.preferred_delivery_commune ?? "",
    preferredQuartier:
      profile?.preferredQuartier ?? metadata.preferred_delivery_quartier ?? "",
    latitude: profile?.latitude ?? metadata.preferred_latitude ?? "",
    longitude: profile?.longitude ?? metadata.preferred_longitude ?? "",
  };
}

function getSettingsFormFromProfile(profile) {
  return {
    ...emptyClientSettingsForm,
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    phone: profile.phone || "",
    preferredAddress: profile.preferredAddress || "",
    preferredCommune: profile.preferredCommune || "",
    preferredQuartier: profile.preferredQuartier || "",
    latitude: profile.latitude || "",
    longitude: profile.longitude || "",
  };
}

function splitOptionText(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

function parseColorText(value) {
  return splitOptionText(value).map((entry) => {
    const match = entry.match(/^(.+?)(?:\s*[:|]\s*|\s+)(#[0-9a-fA-F]{6})$/);
    const label = (match ? match[1] : entry).trim();
    const hex = match?.[2] || getKnownColorHex(label);
    return { value: label, hex };
  });
}

function formatColorText(colors = []) {
  return colors
    .map((color) => {
      const value = typeof color === "string" ? color : color.value;
      const hex = typeof color === "string" ? "" : color.hex;
      return [value, hex].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(", ");
}

function parseSizesByColorText(value) {
  return String(value ?? "")
    .split(/\n+/)
    .reduce((grouped, line) => {
      const [colorPart, ...sizeParts] = line.split(":");
      const color = colorPart?.trim();
      const sizes = splitOptionText(sizeParts.join(":"));

      if (color && sizes.length) {
        grouped[color] = sizes;
      }

      return grouped;
    }, {});
}

function formatSizesByColorText(sizesByColor = {}, colors = []) {
  const lines = [];
  const usedKeys = new Set();

  colors.forEach((color) => {
    const label = typeof color === "string" ? color : color?.value;
    const key = normalizeVariantKey(label);
    const sizes = sizesByColor[key] ?? sizesByColor[label] ?? [];

    if (label && sizes.length) {
      lines.push(`${label}: ${sizes.join(", ")}`);
      usedKeys.add(key);
    }
  });

  Object.entries(sizesByColor).forEach(([color, sizes]) => {
    const key = normalizeVariantKey(color);
    if (usedKeys.has(key) || !sizes?.length) return;
    lines.push(`${color}: ${sizes.join(", ")}`);
  });

  return lines.join("\n");
}

function parseStockByColorText(value) {
  return String(value ?? "")
    .split(/\n+/)
    .reduce((grouped, line) => {
      const [colorPart, ...quantityParts] = line.split(":");
      const color = colorPart?.trim();
      const quantity = Number(String(quantityParts.join(":")).replace(/[^\d]/g, ""));

      if (color && Number.isFinite(quantity)) {
        grouped[normalizeVariantKey(color)] = Math.max(0, quantity);
      }

      return grouped;
    }, {});
}

function formatStockByColorText(stockByColor = {}, colors = []) {
  const lines = [];
  const usedKeys = new Set();

  colors.forEach((color) => {
    const label = typeof color === "string" ? color : color?.value;
    const key = normalizeVariantKey(label);
    const quantity = stockByColor[key] ?? stockByColor[label];

    if (label && quantity !== undefined && quantity !== null) {
      lines.push(`${label}: ${quantity}`);
      usedKeys.add(key);
    }
  });

  Object.entries(stockByColor).forEach(([color, quantity]) => {
    const key = normalizeVariantKey(color);
    if (usedKeys.has(key) || quantity === undefined || quantity === null) return;
    lines.push(`${color}: ${quantity}`);
  });

  return lines.join("\n");
}

function formatCartVariant(row) {
  return [
    row.selectedSize ? `Taille ${row.selectedSize}` : null,
    row.selectedColor ? `Couleur ${row.selectedColor}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function getCustomerKey({ name, phone, userId }) {
  const cleanPhone = normalizePhone(phone);
  if (userId) return `user:${userId}`;
  if (cleanPhone) return `phone:${cleanPhone}`;
  return `name:${String(name || "client").trim().toLowerCase()}`;
}

function getPersonKey(name) {
  return String(name || "-")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase() || "-";
}

function getWhatsappUrl(phone) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return "";
  const internationalPhone =
    cleanPhone.length === 9 ? `224${cleanPhone}` : cleanPhone.replace(/^00/, "");
  return `https://wa.me/${internationalPhone}`;
}

function normalizeCoordinate(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function formatLocationAccuracy(accuracy) {
  const meters = Number(accuracy);
  if (!Number.isFinite(meters) || meters <= 0) return "";

  if (meters >= 1000) {
    return `précision environ ±${(meters / 1000).toFixed(1).replace(".", ",")} km`;
  }

  return `précision environ ±${Math.round(meters)} m`;
}

function formatLocationReadyMessage(accuracy) {
  const precision = formatLocationAccuracy(accuracy);
  if (!precision) return "Position enregistrée.";

  const meters = Number(accuracy);
  const hint = meters > 120 ? " Ajoute un repère pour aider la livraison." : "";
  return `Position enregistrée, ${precision}.${hint}`;
}

function getLocationMapLabel(accuracy) {
  const precision = formatLocationAccuracy(accuracy);
  return precision ? `Position actuelle (${precision})` : "Position actuelle";
}

function getPaymentCallbackUrl(path) {
  const configuredUrl = import.meta.env.VITE_PUBLIC_SITE_URL?.trim();
  const baseUrl =
    configuredUrl || (window.location.protocol === "https:" ? window.location.origin : "");

  if (!baseUrl || !baseUrl.startsWith("https://")) return "";

  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

function getPaymentCallbackConfig() {
  const returnUrl = getPaymentCallbackUrl("/payment-success");
  const cancelUrl = getPaymentCallbackUrl("/payment-cancelled");

  if (!returnUrl || !cancelUrl) {
    return {
      error:
        "Djomi exige une URL de retour HTTPS. Configure VITE_PUBLIC_SITE_URL avec le domaine HTTPS public du site avant de lancer un paiement.",
    };
  }

  return { returnUrl, cancelUrl, error: null };
}

function parseGnfInput(value, label, options = {}) {
  const { required = false, fallback = null, allowZero = true, allowNegative = false } = options;
  const rawValue = String(value ?? "").trim();

  if (!rawValue) {
    if (required) return { error: `${label} est obligatoire.` };
    return { value: fallback };
  }

  const normalized = rawValue.replace(/\s/g, "").replace(",", ".");
  const number = Number(normalized);
  const minimum = allowZero ? 0 : 1;

  if (!Number.isFinite(number) || (!allowNegative && number < minimum)) {
    return {
      error: `${label} doit être un nombre ${allowNegative ? "valide" : allowZero ? "positif" : "supérieur à 0"}.`,
    };
  }

  return { value: Math.round(number) };
}

function translateTechnicalErrorText(value) {
  let text = String(value || "").trim();
  if (!text) return "Action impossible pour le moment.";

  const replacements = [
    [
      /column reference "product_id" is ambiguous/gi,
      "référence produit ambiguë dans une fonction SQL Supabase. La fonction de suppression des articles doit être corrigée côté base.",
    ],
    [
      /column reference "order_id" is ambiguous/gi,
      "référence commande ambiguë dans une fonction SQL Supabase. La fonction de suppression des commandes doit être corrigée côté base.",
    ],
    [
      /column reference "accounting_entry_id" is ambiguous/gi,
      "référence comptable ambiguë dans une fonction SQL Supabase. La fonction de suppression des lignes comptables doit être corrigée côté base.",
    ],
    [
      /column reference "([^"]+)" is ambiguous/gi,
      "référence SQL ambiguë ($1). Une fonction Supabase doit être corrigée côté base.",
    ],
    [
      /new row violates row-level security policy/gi,
      "action refusée par les règles de sécurité Supabase",
    ],
    [
      /violates row-level security policy/gi,
      "action refusée par les règles de sécurité Supabase",
    ],
    [
      /duplicate key value violates unique constraint/gi,
      "cette référence existe déjà",
    ],
    [
      /null value in column "([^"]+)" of relation "([^"]+)" violates not-null constraint/gi,
      "information obligatoire manquante ($1)",
    ],
    [
      /invalid input syntax for type uuid/gi,
      "identifiant invalide",
    ],
    [
      /violates foreign key constraint/gi,
      "cet élément est encore lié à d'autres données",
    ],
  ];

  replacements.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });

  return text;
}

function getFriendlyErrorMessage(error, context = "") {
  const message = String(error?.message || error || "");
  const details = String(error?.details || "");
  const hint = String(error?.hint || "");
  const code = String(error?.code || "");
  const source = `${message} ${details} ${hint}`.toLowerCase();

  if (code === "23505" || source.includes("duplicate key") || source.includes("already exists")) {
    if (source.includes("orange_money_reference") || context === "orange_money_deposit") {
      return "Cette référence Orange Money existe déjà. Utilise une autre référence.";
    }

    if (source.includes("receipt") || source.includes("reçu") || context === "receipt_upload") {
      return "Ce reçu existe déjà. Renomme le fichier ou choisis un autre reçu.";
    }

    if (source.includes("order_number") || source.includes("accounting")) {
      return "Cette référence de vente existe déjà. Change la référence.";
    }

    return "Cette information existe déjà. Vérifie la référence saisie.";
  }

  if (source.includes("row-level security") || source.includes("violates row-level security") || source.includes("rls")) {
    if (context === "receipt_upload") {
      return "Le reçu n'a pas pu être envoyé : les droits Storage ne sont pas encore ouverts.";
    }

    return "Action refusée par les droits Supabase. Vérifie le rôle du compte connecté.";
  }

  if (source.includes("acces refuse") || source.includes("accès refusé")) {
    return "Action réservée au super admin.";
  }

  if (source.includes("order_id") && source.includes("ambiguous")) {
    return "La fonction SQL de suppression commande n'est pas encore corrigée dans Supabase. Exécute le fichier supabase_owner_delete_order_fix.sql puis réessaie.";
  }

  if (source.includes("product_id") && source.includes("ambiguous")) {
    return "La fonction SQL de suppression des articles n'est pas encore corrigée dans Supabase. Corrige la référence product_id dans la fonction de suppression puis réessaie.";
  }

  if (source.includes("accounting_entry_id") && source.includes("ambiguous")) {
    return "La fonction SQL de suppression comptable n'est pas encore corrigée dans Supabase. Exécute le fichier supabase_owner_delete_accounting_fix.sql puis réessaie.";
  }

  if (source.includes("bucket") || source.includes("storage")) {
    return "Le stockage des reçus n'est pas encore configuré.";
  }

  if (source.includes("not found") || source.includes("introuvable")) {
    return "Élément introuvable. Recharge la page puis réessaie.";
  }

  return translateTechnicalErrorText(message) || "Action impossible pour le moment.";
}

function escapeExcelValue(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadExcelWorkbook(fileName, sheets) {
  const safeSheets = sheets.filter((sheet) => sheet.rows?.length);

  if (!safeSheets.length) {
    window.alert("Aucune donnee a exporter pour le moment.");
    return;
  }

  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; }
          h2 { color: #111820; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 28px; }
          th { background: #111820; color: #ffffff; }
          th, td { border: 1px solid #cfd8e3; padding: 8px; mso-number-format:"\\@"; }
        </style>
      </head>
      <body>
        ${safeSheets
          .map((sheet) => {
            const headers = Object.keys(sheet.rows[0] ?? {});
            return `
              <h2>${escapeExcelValue(sheet.name)}</h2>
              <table>
                <thead>
                  <tr>${headers.map((header) => `<th>${escapeExcelValue(header)}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${sheet.rows
                    .map(
                      (row) =>
                        `<tr>${headers
                          .map((header) => `<td>${escapeExcelValue(row[header])}</td>`)
                          .join("")}</tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            `;
          })
          .join("")}
      </body>
    </html>
  `;

  const blob = new Blob(["\ufeff", html], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getTodayDateInput() {
  return new Date().toLocaleDateString("fr-CA");
}

function getDraftAmount(value, fallback = 0) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return fallback;

  const number = Number(rawValue.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function getSignedDraftAmount(value, fallback = 0) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return fallback;

  const number = Number(rawValue.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function getAdminDisplayName(session) {
  return (
    session?.user?.user_metadata?.full_name ||
    "Admin"
  );
}

function getMarginRate(saleAmount, costAmount) {
  if (!saleAmount) return 0;
  return Math.round(((saleAmount - costAmount) / saleAmount) * 100);
}

function getAccountingSourceLabel(source) {
  const normalized = String(source || "").toLowerCase();

  if (normalized.includes("order") || normalized.includes("site")) {
    return "Commande du site";
  }

  if (normalized.includes("manual")) {
    return "Vente manuelle";
  }

  if (normalized.includes("djomi")) {
    return "Paiement Djomi";
  }

  return "Ligne comptable";
}

function App() {
  const host = window.location.hostname;
  const path = window.location.pathname;
  const isAdmin = host.startsWith("admin.") || path.startsWith("/admin");

  return isAdmin ? <AdminPage /> : <ClientPage />;
}

function ClientPage() {
  const [query, setQuery] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [styleFilter, setStyleFilter] = useState("all");
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogSource, setCatalogSource] = useState("connected");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [customerSession, setCustomerSession] = useState(null);
  const [customerProfileRecord, setCustomerProfileRecord] = useState(null);
  const [clientAuthOpen, setClientAuthOpen] = useState(false);
  const [clientAuthMode, setClientAuthMode] = useState("login");
  const [clientAuthForm, setClientAuthForm] = useState(emptyClientAuthForm);
  const [clientAuthMessage, setClientAuthMessage] = useState(null);
  const [clientSettingsOpen, setClientSettingsOpen] = useState(false);
  const [clientSettingsForm, setClientSettingsForm] = useState(emptyClientSettingsForm);
  const [clientSettingsMessage, setClientSettingsMessage] = useState(null);
  const [clientOrdersOpen, setClientOrdersOpen] = useState(false);
  const [clientOrders, setClientOrders] = useState([]);
  const [clientOrdersLoading, setClientOrdersLoading] = useState(false);
  const [clientOrdersMessage, setClientOrdersMessage] = useState(null);
  const [clientOrderPaymentId, setClientOrderPaymentId] = useState("");
  const [clientLocationStatus, setClientLocationStatus] = useState("");
  const [clientSettingsLocationStatus, setClientSettingsLocationStatus] = useState("");
  const [checkoutLocationStatus, setCheckoutLocationStatus] = useState("");
  const [sortMode, setSortMode] = useState("recent");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cart, setCart] = useState({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState("cart");
  const [deliveryMode, setDeliveryMode] = useState("manual");
  const [checkoutStatus, setCheckoutStatus] = useState(null);
  const [isCheckoutSubmitting, setIsCheckoutSubmitting] = useState(false);
  const [checkout, setCheckout] = useState(emptyCheckout);
  const [paymentReturnStatus, setPaymentReturnStatus] = useState(null);
  const catalogSearchRef = useRef(null);
  const paymentReturnHandledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      setCatalogLoading(true);
      const { data, error } = await fetchProducts();

      if (cancelled) return;

      setCatalogLoading(false);

      if (error) {
        setCatalogSource("error");
        setCatalogProducts([]);
        setCatalogMessage(`Impossible de charger les articles : ${error.message}`);
        return;
      }

      const products = data ?? [];

      if (!products.length) {
        setCatalogSource("connected");
        setCatalogProducts([]);
        setCatalogMessage("");
        return;
      }

      setCatalogProducts(products);
      setCatalogSource("connected");
      setCatalogMessage("");
    }

    loadProducts();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    getCurrentSession().then(({ session }) => {
      if (!mounted) return;
      setCustomerSession(session);
    });

    const subscription = onAuthChange((session) => {
      setCustomerSession(session);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!customerSession) {
      setCustomerProfileRecord(null);
      setClientSettingsForm(emptyClientSettingsForm);
      setClientOrders([]);
      setClientOrdersOpen(false);
      setClientOrdersMessage(null);
      setClientOrderPaymentId("");
      return undefined;
    }

    let cancelled = false;

    async function loadCustomerProfile() {
      const fallbackProfile = getSessionProfile(customerSession);
      const { data, error } = await fetchCustomerProfile();

      if (cancelled) return;

      const nextProfile = data ?? fallbackProfile;
      setCustomerProfileRecord(nextProfile);
      setClientSettingsForm(getSettingsFormFromProfile(nextProfile));

      if (error) {
        setClientSettingsMessage({
          tone: "waiting",
          text: `Profil client charge depuis la session. Execute le SQL customer_profiles si les reglages ne s'enregistrent pas : ${error.message}`,
        });
      }
    }

    loadCustomerProfile();

    return () => {
      cancelled = true;
    };
  }, [customerSession]);

  async function loadClientOrders() {
    if (!customerSession) {
      setClientOrders([]);
      return;
    }

    setClientOrdersLoading(true);
    setClientOrdersMessage(null);

    const { data, error } = await fetchCustomerOrders();

    setClientOrdersLoading(false);

    if (error) {
      setClientOrders([]);
      setClientOrdersMessage({
        tone: "issue",
        text: `Historique indisponible : ${error.message}`,
      });
      return;
    }

    setClientOrders(data ?? []);
  }

  useEffect(() => {
    if (!customerSession) return undefined;

    let cancelled = false;

    async function loadOrders() {
      setClientOrdersLoading(true);
      setClientOrdersMessage(null);

      const { data, error } = await fetchCustomerOrders();

      if (cancelled) return;

      setClientOrdersLoading(false);

      if (error) {
        setClientOrders([]);
        setClientOrdersMessage({
          tone: "issue",
          text: `Historique indisponible : ${error.message}`,
        });
        return;
      }

      setClientOrders(data ?? []);
    }

    loadOrders();

    return () => {
      cancelled = true;
    };
  }, [customerSession]);

  useEffect(() => {
    const pathname = window.location.pathname;

    if (pathname === "/payment-cancelled") {
      setPaymentReturnStatus({
        tone: "waiting",
        text: "Paiement annulé. Tu peux reprendre la commande depuis Mes achats.",
      });
      window.history.replaceState({}, "", "/");
      return undefined;
    }

    if (pathname !== "/payment-success" || paymentReturnHandledRef.current) {
      return undefined;
    }

    paymentReturnHandledRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const payload = {
      order_id: params.get("order_id"),
      transaction_ref: params.get("transaction_ref"),
      amount: params.get("amount"),
      token: params.get("token"),
    };

    if (!payload.order_id || !payload.transaction_ref || !payload.token) {
      setPaymentReturnStatus({
        tone: "issue",
        text: "Paiement reçu, mais retour incomplet. Contacte BMA avec ta référence de commande.",
      });
      window.history.replaceState({}, "", "/");
      return undefined;
    }

    let cancelled = false;

    async function confirmPayment() {
      setPaymentReturnStatus({
        tone: "waiting",
        text: "Vérification du paiement...",
      });

      const { data, error } = await confirmDjomiPayment(payload);

      if (cancelled) return;

      if (error) {
        setPaymentReturnStatus({
          tone: "issue",
          text: `Paiement non confirmé automatiquement : ${getFriendlyErrorMessage(error, "payment")}`,
        });
        window.history.replaceState({}, "", "/");
        return;
      }

      if (data?.paid === false) {
        setPaymentReturnStatus({
          tone: "waiting",
          text:
            data.message ||
            "Paiement en cours de verification. Reviens dans Mes achats pour reessayer.",
        });
        window.history.replaceState({}, "", "/");

        if (customerSession) {
          loadClientOrders();
        }

        return;
      }

      setPaymentReturnStatus({
        tone: "paid",
        text: "Paiement confirmé. Ta commande est maintenant marquée payée.",
      });
      setClientOrdersMessage({
        tone: "paid",
        text: "Paiement confirmé.",
      });
      window.history.replaceState({}, "", "/");

      if (customerSession) {
        loadClientOrders();
      }
    }

    confirmPayment();

    return () => {
      cancelled = true;
    };
  }, [customerSession]);

  const availableCatalogProducts = useMemo(
    () => catalogProducts.filter((product) => getProductEffectiveStock(product) > 0),
    [catalogProducts]
  );

  const visibleFilters = useMemo(() => {
    const categories = [
      ...new Set(
        availableCatalogProducts
          .map((product) => product.category)
          .filter((category) => category && category !== "Produit")
      ),
    ];
    const filters = [["all", "Tout"], ...categories.map((category) => [category, category])];

    if (availableCatalogProducts.some((product) => product.promoPrice)) {
      filters.push(["promo", "Promos"]);
    }

    return filters;
  }, [availableCatalogProducts]);

  useEffect(() => {
    const activeFilterExists = visibleFilters.some(([value]) => value === styleFilter);

    if (!activeFilterExists) {
      setStyleFilter("all");
    }
  }, [styleFilter, visibleFilters]);

  const filteredProducts = useMemo(() => {
    const products = availableCatalogProducts.filter((product) => {
      const text = `${product.name} ${product.category} ${product.description ?? ""}`.toLowerCase();
      const matchesSearch = text.includes(query.toLowerCase());
      const matchesFilter =
        styleFilter === "all" ||
        (styleFilter === "promo" ? Boolean(product.promoPrice) : product.category === styleFilter);

      return matchesSearch && matchesFilter;
    });

    return [...products].sort((first, second) => {
      if (sortMode === "price_asc") return getProductPrice(first) - getProductPrice(second);
      if (sortMode === "price_desc") return getProductPrice(second) - getProductPrice(first);
      if (sortMode === "stock") return Number(second.stock || 0) - Number(first.stock || 0);
      return 0;
    });
  }, [availableCatalogProducts, query, styleFilter, sortMode]);

  const cartRows = useMemo(() => {
    return Object.values(cart).map((row) => ({
      ...row,
      total: getProductPrice(row) * row.quantity,
    }));
  }, [cart]);

  const itemCount = cartRows.reduce((sum, row) => sum + row.quantity, 0);
  const subtotal = cartRows.reduce((sum, row) => sum + row.total, 0);
  const fulfillment = "delivery";
  const deliveryFee = DELIVERY_FEE_GNF;
  const total = subtotal + deliveryFee;
  const customerProfile = useMemo(
    () => getSessionProfile(customerSession, customerProfileRecord),
    [customerSession, customerProfileRecord]
  );

  function addToCart(product, options = {}) {
    const selectedSize = options.size || getProductSizeOptions(product)[0] || "";
    const selectedColor = options.color || "";
    const productNeedsColor = getProductColorOptions(product).length > 0;
    const stockLimit = getProductStockForSelection(product, selectedColor, selectedSize);
    const requestedQuantity = clampQuantity(options.quantity ?? 1, stockLimit);

    if ((productNeedsColor && !selectedColor) || stockLimit <= 0 || requestedQuantity <= 0) {
      return;
    }

    const cartKey = `${product.id}|${selectedSize || "no-size"}|${selectedColor || "no-color"}`;

    setCart((current) => {
      const existing = current[cartKey];
      const nextQuantity = clampQuantity(
        (existing?.quantity ?? 0) + requestedQuantity,
        stockLimit
      );

      return {
        ...current,
        [cartKey]: {
          ...product,
          id: cartKey,
          productId: product.id,
          selectedSize,
          selectedColor,
          quantity: nextQuantity,
          stock: stockLimit,
        },
      };
    });

    setCheckoutStep("cart");
    setCheckoutStatus(null);
    setSelectedProduct(null);
  }

  function setCartQuantity(productId, value) {
    setCart((current) => {
      const row = current[productId];
      if (!row) return current;

      return {
        ...current,
        [productId]: {
          ...row,
          quantity: clampQuantity(value, row.stock),
        },
      };
    });
  }

  function removeFromCart(productId) {
    setCart((current) => {
      const next = { ...current };
      delete next[productId];
      return next;
    });
  }

  function updateCheckout(field, value) {
    setCheckout((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function updateClientAuthForm(field, value) {
    setClientAuthForm((current) => ({ ...current, [field]: value }));
  }

  function updateClientSettingsForm(field, value) {
    setClientSettingsForm((current) => ({ ...current, [field]: value }));
  }

  async function handleClientAuth(event) {
    event.preventDefault();

    if (!clientAuthForm.email || !clientAuthForm.password) {
      setClientAuthMessage({ tone: "issue", text: "Email et mot de passe obligatoires." });
      return;
    }

    if (
      clientAuthMode === "signup" &&
      (!clientAuthForm.firstName ||
        !clientAuthForm.lastName ||
        !clientAuthForm.phone ||
        !clientAuthForm.preferredAddress)
    ) {
      setClientAuthMessage({
        tone: "issue",
        text: "Prénom, nom, téléphone et adresse préférée sont obligatoires.",
      });
      return;
    }

    const result =
      clientAuthMode === "signup"
        ? await signUpCustomer(clientAuthForm.email, clientAuthForm.password, clientAuthForm)
        : await signInAdmin(clientAuthForm.email, clientAuthForm.password);

    if (result.error) {
      setClientAuthMessage({
        tone: "issue",
        text: `Connexion impossible : ${result.error.message}`,
      });
      return;
    }

    setClientAuthForm(emptyClientAuthForm);
    setClientAuthMessage({
      tone: "paid",
      text:
        clientAuthMode === "signup"
          ? "Compte créé. Vérifie ton email si une confirmation est demandée."
          : "Connexion réussie.",
    });
    setClientAuthOpen(false);
  }

  async function handleClientSignOut() {
    await signOutAdmin();
    setCustomerSession(null);
    setCustomerProfileRecord(null);
    setClientSettingsOpen(false);
    setClientOrdersOpen(false);
    setClientOrders([]);
    setClientOrderPaymentId("");
    setClientAuthMessage({ tone: "waiting", text: "Session fermée." });
  }

  async function handleClientSettingsSubmit(event) {
    event.preventDefault();

    if (!customerSession) {
      setClientSettingsMessage({ tone: "issue", text: "Connecte-toi avant de modifier ton profil." });
      return;
    }

    if (
      !clientSettingsForm.firstName.trim() ||
      !clientSettingsForm.lastName.trim() ||
      !clientSettingsForm.phone.trim() ||
      !clientSettingsForm.preferredAddress.trim()
    ) {
      setClientSettingsMessage({
        tone: "issue",
        text: "Prenom, nom, telephone et adresse preferee sont obligatoires.",
      });
      return;
    }

    if (clientSettingsForm.newPassword || clientSettingsForm.passwordConfirm) {
      if (clientSettingsForm.newPassword.length < 6) {
        setClientSettingsMessage({
          tone: "issue",
          text: "Le nouveau mot de passe doit contenir au moins 6 caracteres.",
        });
        return;
      }

      if (clientSettingsForm.newPassword !== clientSettingsForm.passwordConfirm) {
        setClientSettingsMessage({
          tone: "issue",
          text: "Les deux mots de passe ne correspondent pas.",
        });
        return;
      }
    }

    setClientSettingsMessage({ tone: "waiting", text: "Enregistrement du profil..." });

    const profilePayload = {
      firstName: clientSettingsForm.firstName.trim(),
      lastName: clientSettingsForm.lastName.trim(),
      phone: clientSettingsForm.phone.trim(),
      preferredAddress: clientSettingsForm.preferredAddress.trim(),
      preferredCommune: clientSettingsForm.preferredCommune.trim(),
      preferredQuartier: clientSettingsForm.preferredQuartier.trim(),
      latitude: clientSettingsForm.latitude,
      longitude: clientSettingsForm.longitude,
    };

    const profileResult = await updateCustomerProfile(profilePayload);

    if (profileResult.error) {
      setClientSettingsMessage({
        tone: "issue",
        text: `Profil non enregistre : ${profileResult.error.message}`,
      });
      return;
    }

    if (clientSettingsForm.newPassword) {
      const passwordResult = await updateCustomerPassword(clientSettingsForm.newPassword);

      if (passwordResult.error) {
        setClientSettingsMessage({
          tone: "issue",
          text: `Profil enregistre, mais mot de passe non modifie : ${passwordResult.error.message}`,
        });
        return;
      }
    }

    const savedProfile = profileResult.data ?? profilePayload;
    setCustomerProfileRecord(savedProfile);
    setClientSettingsForm(getSettingsFormFromProfile(savedProfile));
    setClientSettingsMessage({ tone: "paid", text: "Profil client enregistre." });
  }

  function requestBrowserLocation(onSuccess, onStatus) {
    if (!navigator.geolocation) {
      onStatus("La géolocalisation n'est pas disponible sur ce navigateur.");
      return;
    }

    let bestPosition = null;
    let finished = false;
    let watchId = null;
    let fallbackTimer = null;

    const options = {
      enableHighAccuracy: true,
      timeout: 22000,
      maximumAge: 0,
    };

    const clearTracking = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }

      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
      }
    };

    const finishWithPosition = (position) => {
      if (finished || !position) return;
      finished = true;
      clearTracking();

      const accuracy = Number(position.coords.accuracy);
      const cleanAccuracy = Number.isFinite(accuracy) ? Math.round(accuracy) : null;
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);

      onSuccess({ latitude, longitude, accuracy: cleanAccuracy });
      onStatus(formatLocationReadyMessage(cleanAccuracy));
    };

    const handlePosition = (position) => {
      if (
        !bestPosition ||
        Number(position.coords.accuracy || Infinity) < Number(bestPosition.coords.accuracy || Infinity)
      ) {
        bestPosition = position;
      }

      const accuracy = Math.round(Number(position.coords.accuracy || 0));
      const precision = formatLocationAccuracy(accuracy);
      onStatus(precision ? `GPS trouvé, stabilisation... ${precision}.` : "GPS trouvé, stabilisation...");

      if (accuracy > 0 && accuracy <= 35) {
        finishWithPosition(position);
      }
    };

    const handleError = (error) => {
      if (bestPosition) {
        finishWithPosition(bestPosition);
        return;
      }

      finished = true;
      clearTracking();

      const message =
        error.code === error.PERMISSION_DENIED
          ? "Autorise la localisation dans le navigateur, puis réessaie."
          : "Position introuvable. Mets-toi près d'une fenêtre ou active le GPS.";
      onStatus(message);
    };

    onStatus("Recherche GPS précise... reste quelques secondes sur place.");

    watchId = navigator.geolocation.watchPosition(handlePosition, handleError, options);

    fallbackTimer = window.setTimeout(() => {
      if (bestPosition) {
        finishWithPosition(bestPosition);
        return;
      }

      navigator.geolocation.getCurrentPosition(finishWithPosition, handleError, options);
    }, 9000);
  }

  function useLocationForAccount() {
    requestBrowserLocation(
      ({ latitude, longitude }) => {
        setClientAuthForm((current) => ({ ...current, latitude, longitude }));
      },
      setClientLocationStatus
    );
  }

  function useLocationForSettings() {
    requestBrowserLocation(
      ({ latitude, longitude }) => {
        setClientSettingsForm((current) => ({ ...current, latitude, longitude }));
      },
      setClientSettingsLocationStatus
    );
  }

  function useLocationForCheckout() {
    requestBrowserLocation(
      ({ latitude, longitude, accuracy }) => {
        setCheckout((current) => ({
          ...current,
          city: "",
          commune: "",
          quartier: "",
          latitude,
          longitude,
          mapLabel: getLocationMapLabel(accuracy),
        }));
      },
      setCheckoutLocationStatus
    );
  }

  function changeDeliveryMode(nextMode) {
    setDeliveryMode(nextMode);

    if (nextMode === "current_location") {
      setCheckout((current) => ({
        ...current,
        mapLabel: "Position actuelle",
      }));
      useLocationForCheckout();
    }

    if (nextMode === "manual") {
      setCheckout((current) => ({
        ...current,
        latitude: "",
        longitude: "",
        mapLabel: "",
      }));
      setCheckoutLocationStatus("");
    }
  }

  function useSavedCustomerInfo() {
    setCheckout((current) => ({
      ...current,
      recipientName: customerProfile.fullName || current.recipientName,
      contactPhone: customerProfile.phone || current.contactPhone,
      commune: customerProfile.preferredCommune || current.commune,
      quartier: customerProfile.preferredQuartier || current.quartier,
      landmark: customerProfile.preferredAddress || current.landmark,
      note: customerProfile.preferredAddress || current.note,
      latitude: customerProfile.latitude || current.latitude,
      longitude: customerProfile.longitude || current.longitude,
      mapLabel:
        customerProfile.latitude && customerProfile.longitude
          ? "Adresse préférée"
          : current.mapLabel,
    }));
  }

  async function createTestOrder() {
    if (isCheckoutSubmitting) return;

    if (!cartRows.length) {
      window.alert("Ajoute au moins un article au panier.");
      return;
    }

    if (catalogSource !== "connected") {
      setCheckoutStatus({
        tone: "waiting",
        text: "Les articles ne sont pas chargés. Recharge la page avant de créer une commande.",
      });
      return;
    }

    if (!checkout.recipientName.trim() || !checkout.contactPhone.trim()) {
      setCheckoutStatus({
        tone: "issue",
        text: "Nom et téléphone sont obligatoires pour finaliser la commande.",
      });
      return;
    }

    if (deliveryMode === "manual" && !checkout.note.trim() && !checkout.landmark.trim()) {
      setCheckoutStatus({
        tone: "issue",
        text: "Ajoute un repère clair pour guider la livraison.",
      });
      return;
    }

    const needsCoordinates = deliveryMode === "current_location";
    const latitude = normalizeCoordinate(checkout.latitude);
    const longitude = normalizeCoordinate(checkout.longitude);

    if (needsCoordinates && (latitude === null || longitude === null)) {
      setCheckoutStatus({
        tone: "issue",
        text: "Active la localisation avant de continuer.",
      });
      return;
    }

    const paymentCallbacks = getPaymentCallbackConfig();

    if (paymentCallbacks.error) {
      setCheckoutStatus({
        tone: "issue",
        text: paymentCallbacks.error,
      });
      return;
    }

    setIsCheckoutSubmitting(true);
    setCheckoutStatus({ tone: "waiting", text: "Création de la commande..." });

    const variantNotes = cartRows
      .map((row) => {
        const variant = formatCartVariant(row);
        return variant ? `${row.name} : ${variant}, quantite ${row.quantity}` : "";
      })
      .filter(Boolean)
      .join("\n");

    const { data, error } = await createCheckoutOrder({
      p_items: cartRows.map((row) => ({
        product_id: row.productId ?? row.id,
        quantity: row.quantity,
        selected_size: row.selectedSize || null,
        selected_color: row.selectedColor || null,
      })),
      p_fulfillment_type: fulfillment,
      p_payment_provider: "djomi",
      p_guest_name: checkout.recipientName,
      p_guest_phone: checkout.contactPhone,
      p_delivery_location_type: deliveryMode,
      p_delivery_country: "Guinée",
      p_delivery_city: needsCoordinates ? null : checkout.city,
      p_delivery_commune: needsCoordinates ? null : checkout.commune,
      p_delivery_quartier: needsCoordinates ? null : checkout.quartier,
      p_delivery_landmark: needsCoordinates ? checkout.note : checkout.landmark,
      p_delivery_address: needsCoordinates ? checkout.note : checkout.landmark || checkout.note,
      p_delivery_latitude: needsCoordinates ? latitude : null,
      p_delivery_longitude: needsCoordinates ? longitude : null,
      p_delivery_map_label: needsCoordinates ? checkout.mapLabel : null,
      p_delivery_contact_phone: checkout.contactPhone,
      p_delivery_recipient_name: checkout.recipientName,
      p_delivery_notes: [checkout.note, variantNotes].filter(Boolean).join("\n\n"),
      p_delivery_fee: deliveryFee,
    });

    if (error) {
      setIsCheckoutSubmitting(false);
      setCheckoutStatus({
        tone: "issue",
        text: `Commande non créée : ${error.message}`,
      });
      return;
    }

    setCheckoutStatus({
      tone: "waiting",
      text: "Commande créée. Redirection vers le paiement...",
    });

    const paymentResult = await createDjomiPaymentSession({
      order_id: data.order_id ?? data.id,
      order_number: data.order_number,
      reference_id: data.order_number ?? data.order_id ?? data.id,
      amount: total,
      currency: "GNF",
      phone: checkout.contactPhone,
      customer_name: checkout.recipientName,
      customer_phone: checkout.contactPhone,
      return_url: paymentCallbacks.returnUrl,
      cancel_url: paymentCallbacks.cancelUrl,
    });

    if (paymentResult.error) {
      setIsCheckoutSubmitting(false);
      setCheckoutStatus({
        tone: "issue",
        text: `Paiement non initialisé : ${getFriendlyErrorMessage(paymentResult.error, "payment")}`,
      });
      return;
    }

    window.location.assign(paymentResult.data.paymentUrl);
  }

  async function handlePayCustomerOrder(order) {
    if (clientOrderPaymentId) return;

    if (!order?.rawId) {
      setClientOrdersMessage({
        tone: "issue",
        text: "Commande introuvable. Actualise tes achats puis reessaie.",
      });
      return;
    }

    if (order.paymentTone === "paid") {
      setClientOrdersMessage({
        tone: "paid",
        text: "Cette commande est deja payee.",
      });
      return;
    }

    if (["cancelled", "delivery_failed"].includes(order.rawStatus)) {
      setClientOrdersMessage({
        tone: "issue",
        text: "Cette commande ne peut plus etre payee. Contacte BMA si besoin.",
      });
      return;
    }

    const amount = Number(order.total || 0);
    const phone = order.phone || customerProfile.phone;

    if (!amount || amount <= 0) {
      setClientOrdersMessage({
        tone: "issue",
        text: "Montant de commande invalide. Contacte BMA avant de payer.",
      });
      return;
    }

    if (!phone) {
      setClientOrdersMessage({
        tone: "issue",
        text: "Ajoute ton numero dans ton compte avant de relancer le paiement.",
      });
      return;
    }

    const paymentCallbacks = getPaymentCallbackConfig();

    if (paymentCallbacks.error) {
      setClientOrdersMessage({
        tone: "issue",
        text: paymentCallbacks.error,
      });
      return;
    }

    setClientOrderPaymentId(order.rawId);
    setClientOrdersMessage({
      tone: "waiting",
      text: "Redirection vers le paiement...",
    });

    const paymentResult = await createDjomiPaymentSession({
      order_id: order.rawId,
      order_number: order.id,
      reference_id: order.id || order.rawId,
      amount,
      currency: "GNF",
      phone,
      customer_name: order.customer || customerProfile.fullName || "Client BMA",
      customer_phone: phone,
      return_url: paymentCallbacks.returnUrl,
      cancel_url: paymentCallbacks.cancelUrl,
    });

    if (paymentResult.error) {
      setClientOrderPaymentId("");
      setClientOrdersMessage({
        tone: "issue",
        text: `Paiement non initialise : ${getFriendlyErrorMessage(paymentResult.error, "payment")}`,
      });
      return;
    }

    window.location.assign(paymentResult.data.paymentUrl);
  }

  return (
    <div className="storefront storefront-v2">
      <header className="store-header">
        <button
          className="store-logo"
          type="button"
          aria-label="Accueil BMA"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <LogoMark className="store-logo-mark" />
        </button>

        <div className="store-actions">
          {customerSession ? (
            <>
              <button
                className="btn secondary history-button"
                type="button"
                title="Mes achats"
                aria-label="Mes achats"
                onClick={() => {
                  setClientOrdersOpen(true);
                  loadClientOrders();
                }}
              >
                  <Package className="store-action-icon" aria-hidden="true" />
                <span className="history-label">Mes achats</span>
                {clientOrders.length ? (
                  <span className="history-count">{clientOrders.length}</span>
                ) : null}
              </button>
              <button
                className="account-button"
                type="button"
                aria-label="Paramètres du compte"
                title="Paramètres du compte"
                onClick={() => setClientSettingsOpen(true)}
              >
                  <CircleUserRound className="store-action-icon" aria-hidden="true" />
              </button>
              <button
                className="logout-icon-button store-logout"
                type="button"
                aria-label="Déconnexion"
                title="Déconnexion"
                onClick={handleClientSignOut}
              >
                  <LogOut className="store-action-icon" aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              className="btn secondary client-login-button"
              type="button"
              title="Se connecter"
              aria-label="Se connecter"
              onClick={() => setClientAuthOpen(true)}
            >
                <UserRound className="store-action-icon" aria-hidden="true" />
              <span>Se connecter</span>
            </button>
          )}
          <button
            className="cart-button"
            type="button"
            aria-label={`Panier, ${itemCount} article${itemCount > 1 ? "s" : ""}`}
            onClick={() => {
              setCartOpen(true);
              setCheckoutStep("cart");
            }}
          >
              <ShoppingBag className="store-action-icon" aria-hidden="true" />
            <span className="cart-label">Panier</span>
            <span className="cart-count">{itemCount}</span>
          </button>
        </div>
      </header>

      <main className="store-main">

        {catalogSource === "error" ? (
          <div className="checkout-status issue">{catalogMessage}</div>
        ) : null}
        {paymentReturnStatus ? (
          <div className={`checkout-status ${paymentReturnStatus.tone}`}>
            {paymentReturnStatus.text}
          </div>
        ) : null}
        {clientAuthMessage ? (
          <div className={`checkout-status ${clientAuthMessage.tone}`}>
            {clientAuthMessage.text}
          </div>
        ) : null}
        {clientAuthOpen ? (
          <div className="auth-overlay">
            <ClientAuthPanel
              form={clientAuthForm}
              locationStatus={clientLocationStatus}
              mode={clientAuthMode}
              onChange={updateClientAuthForm}
              onClose={() => setClientAuthOpen(false)}
              onModeChange={setClientAuthMode}
              onSubmit={handleClientAuth}
              onUseLocation={useLocationForAccount}
            />
          </div>
        ) : null}
        {clientSettingsOpen ? (
          <div className="auth-overlay">
            <ClientSettingsPanel
              email={customerSession?.user?.email}
              form={clientSettingsForm}
              locationStatus={clientSettingsLocationStatus}
              message={clientSettingsMessage}
              onChange={updateClientSettingsForm}
              onClose={() => setClientSettingsOpen(false)}
              onSubmit={handleClientSettingsSubmit}
              onUseLocation={useLocationForSettings}
            />
          </div>
        ) : null}
        {clientOrdersOpen ? (
          <div className="auth-overlay">
            <ClientOrdersPanel
              loading={clientOrdersLoading}
              message={clientOrdersMessage}
              orders={clientOrders}
              payingOrderId={clientOrderPaymentId}
              onClose={() => setClientOrdersOpen(false)}
              onPay={handlePayCustomerOrder}
              onRefresh={loadClientOrders}
            />
          </div>
        ) : null}

        <section className="store-catalog" id="articles">
          <div className="catalog-toolbar">
            <div>
              <h1>Drop BMA</h1>
              {!catalogLoading && filteredProducts.length ? (
                <span>
                  {filteredProducts.length} article{filteredProducts.length > 1 ? "s" : ""} disponible{filteredProducts.length > 1 ? "s" : ""}
                </span>
              ) : null}
            </div>
            <div className={`catalog-controls ${mobileSearchOpen || query ? "search-open" : ""}`}>
              <div className={`catalog-search-wrap ${mobileSearchOpen || query ? "is-open" : ""}`}>
                <button
                  className="catalog-search-toggle"
                  type="button"
                  aria-label="Rechercher"
                  onClick={() => {
                    if (!mobileSearchOpen) {
                      setMobileSearchOpen(true);
                      window.setTimeout(() => catalogSearchRef.current?.focus(), 0);
                    } else if (!query) {
                      setMobileSearchOpen(false);
                    } else {
                      catalogSearchRef.current?.focus();
                    }
                  }}
                >
                  <Search className="store-action-icon" aria-hidden="true" />
                </button>
                <input
                  ref={catalogSearchRef}
                  className="search catalog-search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setMobileSearchOpen(true);
                  }}
                  onFocus={() => setMobileSearchOpen(true)}
                  onBlur={() => {
                    if (!query) setMobileSearchOpen(false);
                  }}
                  placeholder="Rechercher un article"
                />
              </div>
              <div className="style-filters">
                {visibleFilters.map(([value, label]) => (
                  <button
                    className={styleFilter === value ? "active" : ""}
                    key={value}
                    type="button"
                    onClick={() => setStyleFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select
                className="catalog-sort"
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value)}
                aria-label="Trier les articles"
              >
                <option value="recent">Plus récents</option>
                <option value="price_asc">Prix croissant</option>
                <option value="price_desc">Prix décroissant</option>
                <option value="stock">Stock disponible</option>
              </select>
            </div>
          </div>

          <div
            className={`catalog catalog-count-${Math.min(filteredProducts.length, 4)}`}
          >
            {catalogLoading ? (
              Array.from({ length: 5 }, (_, index) => (
                <div className="product-skeleton" key={`product-skeleton-${index}`} aria-hidden="true">
                  <span />
                  <i />
                  <b />
                </div>
              ))
            ) : filteredProducts.length ? (
              filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={() => setSelectedProduct(product)}
                />
              ))
            ) : (
              <div className="empty-state">
                Aucun article disponible.
              </div>
            )}
          </div>
        </section>

        {selectedProduct ? (
          <ProductDetailModal
            product={selectedProduct}
            onAdd={addToCart}
            onClose={() => setSelectedProduct(null)}
          />
        ) : null}

        <CartPanel
          isOpen={cartOpen}
          onClose={() => setCartOpen(false)}
          checkoutStep={checkoutStep}
          setCheckoutStep={setCheckoutStep}
          rows={cartRows}
          itemCount={itemCount}
          subtotal={subtotal}
          deliveryFee={deliveryFee}
          total={total}
          deliveryMode={deliveryMode}
          setDeliveryMode={changeDeliveryMode}
          checkout={checkout}
          customerProfile={customerProfile}
          locationStatus={checkoutLocationStatus}
          updateCheckout={updateCheckout}
          checkoutStatus={checkoutStatus}
          isCheckoutSubmitting={isCheckoutSubmitting}
          onUseCurrentLocation={useLocationForCheckout}
          onUseSavedCustomerInfo={useSavedCustomerInfo}
          onQuantityChange={setCartQuantity}
          onRemove={removeFromCart}
          onCheckout={createTestOrder}
        />
        <footer className="store-footer">
          <div className="store-footer-brand">
            <LogoMark className="store-footer-logo" />
            <div>
              <strong>BMA Family</strong>
              <span>Bien Mieux A plusieurs.</span>
            </div>
          </div>

          <div className="store-footer-grid">
            <section>
              <h2>Commander</h2>
              <button
                type="button"
                onClick={() =>
                  document.getElementById("articles")?.scrollIntoView({ behavior: "smooth" })
                }
              >
                Voir les articles
              </button>
              <button
                type="button"
                onClick={() => {
                  setCartOpen(true);
                  setCheckoutStep("cart");
                }}
              >
                Ouvrir le panier
              </button>
            </section>

            <section>
              <h2>Compte</h2>
              {customerSession ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setClientOrdersOpen(true);
                      loadClientOrders();
                    }}
                  >
                    Mes achats
                  </button>
                  <button type="button" onClick={() => setClientSettingsOpen(true)}>
                    Mes informations
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setClientAuthOpen(true)}>
                  Se connecter
                </button>
              )}
            </section>

            <section>
              <h2>Service</h2>
              <p>Livraison en Guinee avec position GPS ou repere clair.</p>
              <p>Paiement Djomi, Orange Money ou suivi de commande.</p>
            </section>
          </div>

          <div className="store-footer-bottom">
            <span>BMA 224</span>
            <span>Mode, accessoires et bons plans selectionnes.</span>
          </div>
        </footer>
        {itemCount > 0 ? (
          <button
            className="mobile-cart-bar"
            type="button"
            onClick={() => {
              setCartOpen(true);
              setCheckoutStep("cart");
            }}
          >
            <span>
              {itemCount} article{itemCount > 1 ? "s" : ""}
            </span>
            <strong>{formatMoney(total)}</strong>
            <span>Mon panier</span>
          </button>
        ) : null}
      </main>
    </div>
  );
}

function ProductCard({ product, onOpen }) {
  const price = getProductPrice(product);
  const gallery = getProductGalleryForColor(product, "");
  const colorOptions = getProductColorOptions(product);
  const visibleColors = colorOptions.slice(0, 4);
  const effectiveStock = getProductEffectiveStock(product);
  const lowStock = effectiveStock > 0 && effectiveStock <= 3;

  return (
    <article
      className="product"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="product-media">
        <div className="product-badges">
          {product.promoPrice ? <span className="product-badge deal">Promo</span> : null}
          {lowStock ? <span className="product-badge urgent">Stock limité</span> : null}
        </div>
        <img
          className="product-main-image"
          src={gallery[0]}
          alt={product.name}
        />
        {gallery[1] ? (
          <img
            className="product-alt-image"
            src={gallery[1]}
            alt=""
            aria-hidden="true"
          />
        ) : null}
        {effectiveStock <= 0 ? <span className="stock-badge">Rupture</span> : null}
      </div>
      <div className="product-body">
        <div className="product-meta">
          <span>{product.category}</span>
        </div>
        <h3>{product.name}</h3>
        <div className="product-price-row">
          <span className="price">{formatMoney(price)}</span>
          {product.promoPrice ? <span className="old-price">{formatMoney(product.price)}</span> : null}
        </div>
        {visibleColors.length ? (
          <div className="product-color-row" aria-label="Couleurs disponibles">
            {visibleColors.map((color) => (
              <span
                className="color-dot"
                key={color.value}
                style={getColorSwatchStyle(color)}
                title={color.value}
              />
            ))}
            {colorOptions.length > visibleColors.length ? (
              <small>+{colorOptions.length - visibleColors.length}</small>
            ) : null}
          </div>
        ) : null}
        {effectiveStock <= 0 ? <span className="product-unavailable">Indisponible</span> : null}
      </div>
    </article>
  );
}

function ProductDetailModal({ product, onAdd, onClose }) {
  const colorOptions = getProductColorOptions(product);
  const effectiveStock = getProductEffectiveStock(product);
  const [selectedColor, setSelectedColor] = useState("");
  const gallery = getProductGalleryForColor(product, selectedColor);
  const sizeOptions = getProductSizeOptions(product, selectedColor);
  const [activeImage, setActiveImage] = useState(gallery[0]);
  const [selectedSize, setSelectedSize] = useState(sizeOptions[0] || "");
  const selectedStock = getProductStockForSelection(product, selectedColor, selectedSize);
  const [quantity, setQuantity] = useState(1);
  const swipeStartRef = useRef(null);
  const price = getProductPrice(product);

  function getPreferredAvailableSize(sizes, colorValue) {
    return (
      sizes.find((size) => getProductStockForSelection(product, colorValue, size) > 0) ||
      sizes[0] ||
      ""
    );
  }

  function moveGallery(direction) {
    if (gallery.length <= 1) return;

    const currentIndex = Math.max(0, gallery.indexOf(activeImage));
    const nextIndex = (currentIndex + direction + gallery.length) % gallery.length;
    setActiveImage(gallery[nextIndex]);
  }

  function handleGalleryTouchStart(event) {
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }

  function handleGalleryTouchEnd(event) {
    const start = swipeStartRef.current;
    const touch = event.changedTouches?.[0];
    swipeStartRef.current = null;

    if (!start || !touch || gallery.length <= 1) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 45 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return;

    moveGallery(deltaX < 0 ? 1 : -1);
  }

  useEffect(() => {
    const nextGallery = getProductGalleryForColor(product, "");
    const nextSizeOptions = getProductSizeOptions(product, "");
    const preferredSize = getPreferredAvailableSize(nextSizeOptions, "");
    setSelectedColor("");
    setActiveImage(nextGallery[0]);
    setSelectedSize(preferredSize);
    setQuantity(1);
  }, [product.id]);

  useEffect(() => {
    const nextGallery = getProductGalleryForColor(product, selectedColor);
    const nextSizeOptions = getProductSizeOptions(product, selectedColor);
    const preferredSize = getPreferredAvailableSize(nextSizeOptions, selectedColor);

    setActiveImage((current) =>
      nextGallery.includes(current) ? current : nextGallery[0]
    );
    setSelectedSize((current) => {
      const currentIsAvailable =
        nextSizeOptions.includes(current) &&
        getProductStockForSelection(product, selectedColor, current) > 0;

      return currentIsAvailable ? current : preferredSize;
    });
    setQuantity((current) =>
      clampQuantity(
        current,
        getProductStockForSelection(product, selectedColor, preferredSize)
      )
    );
  }, [product.id, selectedColor]);

  useEffect(() => {
    setQuantity((current) =>
      clampQuantity(current, getProductStockForSelection(product, selectedColor, selectedSize))
    );
  }, [product.id, selectedColor, selectedSize]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      className="product-detail-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="product-detail" role="dialog" aria-modal="true" aria-label={product.name}>
        <button className="detail-close" type="button" aria-label="Fermer" onClick={onClose}>
          <ActionIcon name="x" />
        </button>

        <div className="detail-gallery">
          <div
            className="detail-main-image"
            onTouchStart={handleGalleryTouchStart}
            onTouchEnd={handleGalleryTouchEnd}
          >
            <img src={activeImage} alt={product.name} />
            {gallery.length > 1 ? (
              <div className="detail-gallery-controls">
                <button type="button" aria-label="Photo précédente" onClick={() => moveGallery(-1)}>
                  <ActionIcon name="arrow-left" />
                </button>
                <span>{Math.max(1, gallery.indexOf(activeImage) + 1)} / {gallery.length}</span>
                <button type="button" aria-label="Photo suivante" onClick={() => moveGallery(1)}>
                  <ActionIcon name="arrow-right" />
                </button>
              </div>
            ) : null}
          </div>
          {gallery.length > 1 ? (
            <div className="detail-thumbs">
              {gallery.map((imageUrl, index) => (
                <button
                  className={activeImage === imageUrl ? "active" : ""}
                  key={imageUrl}
                  type="button"
                  onClick={() => setActiveImage(imageUrl)}
                >
                  <img src={imageUrl} alt={`Photo ${index + 1} ${product.name}`} />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="detail-info">
          <span className="detail-category">{product.category}</span>
          <h2>{product.name}</h2>
          <div className="detail-price-row">
            <strong>{formatMoney(price)}</strong>
            {product.promoPrice ? <span>{formatMoney(product.price)}</span> : null}
          </div>
          {product.description ? <p>{product.description}</p> : null}
          {effectiveStock > 0 ? (
            <div className="detail-stock-note">
              <strong>{lowStockLabel(selectedStock)}</strong>
              <span>Taille, couleur et quantité enregistrées dans la commande.</span>
            </div>
          ) : null}

          {colorOptions.length ? (
            <div className="option-group">
              <div className="option-head">
                <strong>Couleur</strong>
                <span>{selectedColor || "A choisir"}</span>
              </div>
              <div className="option-list color-list">
                {colorOptions.map((color) => (
                  <button
                    className={selectedColor === color.value ? "active" : ""}
                    key={color.value}
                    type="button"
                    onClick={() => setSelectedColor(color.value)}
                  >
                    <span className="color-dot" style={getColorSwatchStyle(color)} />
                    <span>{color.value}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {sizeOptions.length ? (
            <div className="option-group">
              <div className="option-head">
                <strong>Taille</strong>
                <span>{selectedSize}</span>
              </div>
              <div className="option-list">
                {sizeOptions.map((size) => {
                  const sizeStock = getProductStockForSelection(product, selectedColor, size);
                  const sizeHasTrackedStock =
                    hasExactVariantStock(product, selectedColor, size) ||
                    (selectedColor && hasTrackedVariantStock(product, selectedColor));
                  const sizeIsOut = sizeHasTrackedStock && sizeStock <= 0;

                  return (
                    <button
                      className={[selectedSize === size ? "active" : "", sizeIsOut ? "is-out" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      disabled={sizeIsOut}
                      key={size}
                      type="button"
                      onClick={() => setSelectedSize(size)}
                    >
                      <span>{size}</span>
                      {sizeHasTrackedStock ? <small>{sizeStock}</small> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {colorOptions.length && !selectedColor && !sizeOptions.length ? (
            <p className="variant-note">Choisis une couleur pour voir les tailles disponibles.</p>
          ) : null}

          {!sizeOptions.length && !colorOptions.length ? (
            <p className="variant-note">Cet article est vendu comme présenté, sans option spéciale.</p>
          ) : null}

          <div className="detail-actions">
            <QuantityControl
              value={quantity}
              max={selectedStock}
              onChange={(value) => setQuantity(clampQuantity(value, selectedStock))}
            />
            <button
              className="btn"
              type="button"
              disabled={effectiveStock <= 0 || (colorOptions.length > 0 && !selectedColor) || selectedStock <= 0}
              onClick={() =>
                onAdd(product, {
                  quantity,
                  size: selectedSize,
                  color: selectedColor,
                })
              }
            >
              Ajouter au panier
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductStockDetailPanel({ product, onClose, onSaveDistribution }) {
  const rows = getProductStockDetailRows(product);
  const detailedRows = rows.filter((row) => row.hasExactSizeStock);
  const displayedColorTotal = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const productTotal = getProductEffectiveStock(product);
  const ledgerSoldTotal = Math.max(0, Number(product.salesLedger?.soldTotal || 0));
  const ledgerMovementTotal = Math.max(0, Number(product.salesLedger?.movementSoldTotal || 0));
  const stockUsesGlobalSource = hasDetailedStockMismatch(product);
  const ledgerAdjustment = stockUsesGlobalSource
    ? 0
    : Math.max(0, Number(product.salesLedger?.missingSoldTotal || 0));
  const stockIsInconsistent = Boolean(rows.length && displayedColorTotal !== productTotal);
  const reliableRows = stockIsInconsistent
    ? rows.filter((row) => row.hasExactSizeStock)
    : rows;
  const lowRows = reliableRows.filter((row) => row.total > 0 && row.total <= 3);
  const outRows = reliableRows.filter((row) => row.total <= 0);
  const stockNeedsDistribution = detailedRows.length !== rows.length || stockIsInconsistent;
  const [isDistributing, setIsDistributing] = useState(false);
  const [distributionDraft, setDistributionDraft] = useState(() => {
    const draft = {};

    rows.forEach((row) => {
      const colorKey = normalizeVariantKey(row.color);

      if (row.sizes.length) {
        row.sizes.forEach((sizeRow) => {
          const key = `${colorKey}::${normalizeVariantKey(sizeRow.size)}`;
          draft[key] = row.hasExactSizeStock ? String(sizeRow.quantity ?? 0) : "";
        });
      } else {
        draft[`${colorKey}::__color`] = row.hasExactSizeStock ? String(row.total) : "";
      }
    });

    return draft;
  });
  const [isSavingDistribution, setIsSavingDistribution] = useState(false);

  const distributedTotal = Object.values(distributionDraft).reduce(
    (sum, value) => sum + Math.max(0, Number(value) || 0),
    0
  );

  function updateDistributionValue(key, value) {
    const cleanValue = String(value ?? "").replace(/[^\d]/g, "");
    setDistributionDraft((current) => ({ ...current, [key]: cleanValue }));
  }

  async function saveDistribution() {
    if (distributedTotal !== productTotal || !onSaveDistribution) return;

    const stockByColor = {};
    const stockByVariant = {};

    rows.forEach((row) => {
      const colorKey = normalizeVariantKey(row.color);

      if (row.sizes.length) {
        stockByVariant[colorKey] = {};
        row.sizes.forEach((sizeRow) => {
          const sizeKey = normalizeVariantKey(sizeRow.size);
          const quantity = Math.max(
            0,
            Number(distributionDraft[`${colorKey}::${sizeKey}`]) || 0
          );
          stockByVariant[colorKey][sizeKey] = quantity;
        });
        stockByColor[colorKey] = Object.values(stockByVariant[colorKey]).reduce(
          (sum, quantity) => sum + quantity,
          0
        );
      } else {
        stockByColor[colorKey] = Math.max(
          0,
          Number(distributionDraft[`${colorKey}::__color`]) || 0
        );
      }
    });

    setIsSavingDistribution(true);
    const saved = await onSaveDistribution(product, { stockByColor, stockByVariant });
    setIsSavingDistribution(false);

    if (saved) setIsDistributing(false);
  }

  return (
    <section className="section admin-action-panel stock-detail-panel" role="dialog" aria-modal="true">
      <div className="section-head">
        <div>
          <h2>Stock de {product.name}</h2>
          <span>Total, couleurs, tailles et ruptures</span>
        </div>
        <button className="icon-btn" type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <div className="stock-detail-body">
        <div className="stock-detail-summary">
          <div>
            <span>Total reel</span>
            <strong>{productTotal}</strong>
          </div>
          <div>
            <span>Détail par taille</span>
            <strong>{detailedRows.length}/{rows.length}</strong>
          </div>
          <div>
            <span>À surveiller</span>
            <strong>{lowRows.length + outRows.length}</strong>
          </div>
        </div>

        {stockNeedsDistribution && !isDistributing ? (
          <div className="stock-consistency-alert">
            <div>
              <strong>Répartition à corriger</strong>
              <span>
                Le stock réel est de {productTotal}. Répartis-le une fois entre les couleurs et tailles.
              </span>
            </div>
            <button className="btn" type="button" onClick={() => setIsDistributing(true)}>
              Répartir le stock
            </button>
          </div>
        ) : null}

        {isDistributing ? (
          <div className="stock-distribution-editor">
            <div className="stock-distribution-head">
              <div>
                <strong>Stock restant par variante</strong>
                <span>Indique où se trouvent les {productTotal} pièces restantes.</span>
              </div>
              <b className={distributedTotal === productTotal ? "complete" : ""}>
                {distributedTotal} / {productTotal}
              </b>
            </div>

            <div className="stock-distribution-colors">
              {rows.map((row) => {
                const colorKey = normalizeVariantKey(row.color);
                return (
                  <div className="stock-distribution-color" key={`distribution-${row.color}`}>
                    <div className="stock-distribution-color-name">
                      <span className="color-dot" style={getColorSwatchStyle({ value: row.color, hex: row.hex })} />
                      <strong>{row.color}</strong>
                    </div>
                    <div className="stock-distribution-inputs">
                      {row.sizes.length ? (
                        row.sizes.map((sizeRow) => {
                          const key = `${colorKey}::${normalizeVariantKey(sizeRow.size)}`;
                          return (
                            <label key={key}>
                              <span>{sizeRow.size}</span>
                              <input
                                inputMode="numeric"
                                min="0"
                                type="number"
                                value={distributionDraft[key] ?? ""}
                                onChange={(event) => updateDistributionValue(key, event.target.value)}
                              />
                            </label>
                          );
                        })
                      ) : (
                        <label>
                          <span>Quantité</span>
                          <input
                            inputMode="numeric"
                            min="0"
                            type="number"
                            value={distributionDraft[`${colorKey}::__color`] ?? ""}
                            onChange={(event) =>
                              updateDistributionValue(`${colorKey}::__color`, event.target.value)
                            }
                          />
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {distributedTotal !== productTotal ? (
              <p className="stock-distribution-help">
                {distributedTotal < productTotal
                  ? `Il reste ${productTotal - distributedTotal} pièce(s) à répartir.`
                  : `Retire ${distributedTotal - productTotal} pièce(s) pour retrouver le total réel.`}
              </p>
            ) : (
              <p className="stock-distribution-help complete">La répartition correspond au stock réel.</p>
            )}

            <div className="stock-distribution-actions">
              <button className="btn ghost" type="button" onClick={() => setIsDistributing(false)}>
                Annuler
              </button>
              <button
                className="btn"
                type="button"
                disabled={distributedTotal !== productTotal || isSavingDistribution}
                onClick={saveDistribution}
              >
                {isSavingDistribution ? "Enregistrement..." : "Enregistrer la répartition"}
              </button>
            </div>
          </div>
        ) : null}

        {rows.length && !isDistributing ? (
          <div className="stock-detail-list">
            {ledgerSoldTotal > 0 ? (
              <div className="stock-ledger-note">
                Ventes retrouvées : {ledgerSoldTotal} · mouvements historiques : {ledgerMovementTotal}
                {stockUsesGlobalSource
                  ? ` · stock global retenu : ${productTotal} · répartition couleur/taille à resynchroniser`
                  : ` · correction appliquée : ${ledgerAdjustment}${ledgerAdjustment > 0 ? ` · stock calculé : ${productTotal}` : ""}`}
              </div>
            ) : null}
            {rows.map((row) => (
              <article className="stock-detail-card" key={row.color}>
                <div className="stock-detail-card-head">
                  <span className="color-dot" style={getColorSwatchStyle({ value: row.color, hex: row.hex })} />
                  <strong>{row.color}</strong>
                  <b
                    className={
                      stockIsInconsistent && !row.hasExactSizeStock
                        ? "pending"
                        : row.total <= 0
                          ? "out"
                          : row.total <= 3
                            ? "low"
                            : ""
                    }
                  >
                    {stockIsInconsistent && !row.hasExactSizeStock
                      ? "À répartir"
                      : `Reste : ${row.total}`}
                  </b>
                </div>
                {row.hasExactSizeStock ? (
                  <div className="stock-size-breakdown-label">Reste par taille</div>
                ) : null}
                {row.hasExactSizeStock ? (
                  <div className="stock-size-grid">
                    {row.sizes
                      .filter(
                        (sizeRow) =>
                          sizeRow.quantity !== undefined && sizeRow.quantity !== null
                      )
                      .map((sizeRow) => (
                      <span
                        className={Number(sizeRow.quantity || 0) <= 0 ? "out" : Number(sizeRow.quantity || 0) <= 1 ? "low" : ""}
                        key={`${row.color}-${sizeRow.size}`}
                      >
                        <b>{sizeRow.quantity}</b>
                        {sizeRow.size}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="stock-size-missing">
                    <div>
                      <strong>Détail par taille non renseigné</strong>
                      {row.sizes.length ? (
                        <span>Tailles connues : {row.sizes.map((sizeRow) => sizeRow.size).join(", ")}</span>
                      ) : (
                        <span>Ce stock est suivi uniquement par couleur.</span>
                      )}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : !isDistributing ? (
          <div className="empty-state compact">
            Aucun détail couleur/taille enregistré pour cet article.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ClientAuthPanel({
  form,
  locationStatus,
  mode,
  onChange,
  onClose,
  onModeChange,
  onSubmit,
  onUseLocation,
}) {
  return (
    <section className="section client-auth-panel auth-card">
      <div className="section-head">
        <div>
          <h2>Connexion BMA</h2>
          <span>Retrouve tes achats, ton adresse et tes paiements plus vite.</span>
        </div>
        <button className="btn ghost" type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
      <div className="auth-tabs">
        <button
          className={mode === "login" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("login")}
        >
          Connexion
        </button>
        <button
          className={mode === "signup" ? "active" : ""}
          type="button"
          onClick={() => onModeChange("signup")}
        >
          Créer un compte
        </button>
      </div>
      <form className="admin-form auth-form" onSubmit={onSubmit}>
        <Field
          autoComplete="email"
          label="Email"
          type="email"
          value={form.email}
          onChange={(value) => onChange("email", value)}
        />
        <Field
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          label="Mot de passe"
          type="password"
          value={form.password}
          onChange={(value) => onChange("password", value)}
        />
        {mode === "signup" ? (
          <>
            <Field
              autoComplete="given-name"
              label="Prénom"
              value={form.firstName}
              onChange={(value) => onChange("firstName", value)}
            />
            <Field
              autoComplete="family-name"
              label="Nom"
              value={form.lastName}
              onChange={(value) => onChange("lastName", value)}
            />
            <Field
              autoComplete="tel"
              label="Numéro"
              value={form.phone}
              onChange={(value) => onChange("phone", value)}
            />
            <div className="field full">
              <label>Adresse de livraison préférée</label>
              <textarea
                placeholder="Ex : quartier, repère, couleur du portail..."
                value={form.preferredAddress}
                onChange={(event) => onChange("preferredAddress", event.target.value)}
              />
            </div>
            <div className="location-box full">
              <button className="btn secondary" type="button" onClick={onUseLocation}>
                Utiliser ma position
              </button>
              <span>{locationStatus || "Optionnel : ajoute ta position GPS pour une livraison plus précise."}</span>
              {form.latitude && form.longitude ? (
                <span>Position prête pour les prochaines livraisons.</span>
              ) : null}
            </div>
          </>
        ) : null}
        <div className="inline-actions">
          <button className="btn" type="submit">
            {mode === "signup" ? "Créer mon compte" : "Me connecter"}
          </button>
          <button className="btn secondary" type="button" onClick={onClose}>
            Continuer sans compte
          </button>
        </div>
      </form>
    </section>
  );
}

function ClientSettingsPanel({
  email,
  form,
  locationStatus,
  message,
  onChange,
  onClose,
  onSubmit,
  onUseLocation,
}) {
  return (
    <section className="section client-auth-panel auth-card client-settings-panel">
      <div className="section-head">
        <div>
          <h2>Paramètres du compte</h2>
          <span>Infos, livraison et sécurité</span>
        </div>
        <button className="btn ghost" type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
      {message ? (
        <div className={`checkout-status ${message.tone}`}>
          {message.text}
        </div>
      ) : null}
      <form className="admin-form auth-form settings-form" onSubmit={onSubmit}>
        <Field
          autoComplete="given-name"
          label="Prénom"
          value={form.firstName}
          onChange={(value) => onChange("firstName", value)}
        />
        <Field
          autoComplete="family-name"
          label="Nom"
          value={form.lastName}
          onChange={(value) => onChange("lastName", value)}
        />
        <Field
          autoComplete="tel"
          label="Téléphone"
          value={form.phone}
          onChange={(value) => onChange("phone", value)}
        />
        <Field
          label="Commune"
          value={form.preferredCommune}
          onChange={(value) => onChange("preferredCommune", value)}
        />
        <Field
          label="Quartier"
          value={form.preferredQuartier}
          onChange={(value) => onChange("preferredQuartier", value)}
        />
        <div className="field full">
          <label>Adresse / repère de livraison préféré</label>
          <textarea
            placeholder="Ex : près de la pharmacie, portail noir, étage..."
            value={form.preferredAddress}
            onChange={(event) => onChange("preferredAddress", event.target.value)}
          />
        </div>
        <div className="location-box full">
          <button className="btn secondary" type="button" onClick={onUseLocation}>
            Mettre à jour ma position GPS
          </button>
          <span>{locationStatus || "Optionnel : utile si tu veux livrer souvent au même endroit."}</span>
          {form.latitude && form.longitude ? (
            <div className="mini-grid">
              <Field
                label="Latitude"
                value={form.latitude}
                onChange={(value) => onChange("latitude", value)}
              />
              <Field
                label="Longitude"
                value={form.longitude}
                onChange={(value) => onChange("longitude", value)}
              />
            </div>
          ) : null}
        </div>
        <div className="field full settings-password-box">
          <label>Nouveau mot de passe</label>
          <div className="mini-grid">
            <input
              autoComplete="new-password"
              placeholder="Laisser vide pour ne pas changer"
              type="password"
              value={form.newPassword}
              onChange={(event) => onChange("newPassword", event.target.value)}
            />
            <input
              autoComplete="new-password"
              placeholder="Confirmer"
              type="password"
              value={form.passwordConfirm}
              onChange={(event) => onChange("passwordConfirm", event.target.value)}
            />
          </div>
        </div>
        <div className="inline-actions">
          <button className="btn" type="submit">
            Enregistrer
          </button>
          <button className="btn secondary" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </form>
    </section>
  );
}

function ClientOrdersPanel({
  loading,
  message,
  orders,
  payingOrderId,
  onClose,
  onPay,
  onRefresh,
}) {
  const [clientOrderFilter, setClientOrderFilter] = useState("open");
  const paidCount = orders.filter((order) => order.paymentTone === "paid").length;
  const openCount = orders.filter(
    (order) => !["delivered", "cancelled", "delivery_failed"].includes(order.rawStatus)
  ).length;
  const visibleOrders = orders.filter((order) => matchesOrderFilter(order, clientOrderFilter));

  return (
    <section className="section client-auth-panel auth-card client-orders-panel">
      <div className="section-head">
        <div>
          <h2>Mes achats</h2>
          <span>Historique, paiement et suivi de commande</span>
        </div>
        <div className="client-orders-actions">
          <button className="btn secondary" type="button" onClick={onRefresh} disabled={loading}>
            Actualiser
          </button>
          <button className="btn ghost" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>

      <div className="client-order-stats">
        <div>
          <span>Commandes</span>
          <strong>{orders.length}</strong>
        </div>
        <div>
          <span>Payées</span>
          <strong>{paidCount}</strong>
        </div>
        <div>
          <span>En cours</span>
          <strong>{openCount}</strong>
        </div>
      </div>

      {message ? (
        <div className={`checkout-status ${message.tone}`}>
          {message.text}
        </div>
      ) : null}

      <div className="order-filter-tabs client-order-tabs" aria-label="Filtrer mes achats">
        {clientOrderFilterOptions.map((filter) => (
          <button
            className={clientOrderFilter === filter.value ? "active" : ""}
            key={filter.value}
            type="button"
            onClick={() => setClientOrderFilter(filter.value)}
          >
            <span>{filter.label}</span>
            <strong>{countOrdersByFilter(orders, filter.value)}</strong>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-state compact">Chargement de tes achats...</div>
      ) : visibleOrders.length ? (
        <div className="client-order-list">
          {visibleOrders.map((order) => {
            const canPay =
              order.paymentTone !== "paid" &&
              !["cancelled", "delivery_failed", "delivered"].includes(order.rawStatus);
            const isPaying = payingOrderId === order.rawId;

            return (
              <article
                className={`client-order-card ${canPay ? "payable" : ""}`}
                key={order.rawId || order.id}
              >
                <div className="client-order-head">
                  <div>
                    <strong>{order.id}</strong>
                    <span>
                      {order.createdDate || order.createdAt?.slice(0, 10) || "Date non precisee"}
                    </span>
                  </div>
                  <div className="client-order-statuses">
                    <span className={`status ${order.paymentTone}`}>{order.payment}</span>
                    <span className={`status ${order.statusTone}`}>{order.status}</span>
                  </div>
                </div>

                <div className="client-order-summary">
                  <span>{order.itemsCount || order.items || 0} article{(order.itemsCount || order.items || 0) > 1 ? "s" : ""}</span>
                  <strong>{formatMoney(order.total)}</strong>
                </div>

                {order.landmark || order.zone ? (
                  <p className="client-order-address">
                    {[order.zone, order.landmark].filter(Boolean).join(" - ")}
                  </p>
                ) : null}

                <OrderItemsList items={order.orderItems} />

                {canPay ? (
                  <div className="client-order-payment-actions">
                    <button
                      className={`btn ${isPaying ? "loading" : ""}`}
                      type="button"
                      disabled={Boolean(payingOrderId)}
                      onClick={() => onPay(order)}
                    >
                      {isPaying ? "Ouverture du paiement..." : "Payer cette commande"}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state compact">
          {orders.length
            ? "Aucune commande dans cette vue."
            : "Aucun achat pour le moment. Tes commandes connectées apparaîtront ici."}
        </div>
      )}
    </section>
  );
}

function AdminAccountPanel({ email, form, message, onChange, onClose, onSubmit }) {
  return (
    <section className="section client-auth-panel auth-card client-settings-panel">
      <div className="section-head">
        <div>
          <h2>Compte administrateur</h2>
          <span>Nom affiché et mot de passe</span>
        </div>
        <button className="btn ghost" type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
      {message ? (
        <div className={`checkout-status ${message.tone}`}>
          {message.text}
        </div>
      ) : null}
      <form className="admin-form auth-form settings-form" onSubmit={onSubmit}>
        <Field
          label="Nom affiché"
          value={form.fullName}
          onChange={(value) => onChange("fullName", value)}
        />
        <div className="field full settings-password-box">
          <label>Nouveau mot de passe</label>
          <div className="mini-grid">
            <input
              autoComplete="new-password"
              placeholder="Laisser vide pour ne pas changer"
              type="password"
              value={form.newPassword}
              onChange={(event) => onChange("newPassword", event.target.value)}
            />
            <input
              autoComplete="new-password"
              placeholder="Confirmer"
              type="password"
              value={form.passwordConfirm}
              onChange={(event) => onChange("passwordConfirm", event.target.value)}
            />
          </div>
        </div>
        <div className="inline-actions">
          <button className="btn" type="submit">
            Enregistrer
          </button>
          <button className="btn secondary" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </form>
    </section>
  );
}

function CartPanel({
  isOpen,
  onClose,
  checkoutStep,
  setCheckoutStep,
  rows,
  itemCount,
  subtotal,
  deliveryFee,
  total,
  deliveryMode,
  setDeliveryMode,
  checkout,
  customerProfile,
  locationStatus,
  updateCheckout,
  checkoutStatus,
  isCheckoutSubmitting,
  onUseCurrentLocation,
  onUseSavedCustomerInfo,
  onQuantityChange,
  onRemove,
  onCheckout,
}) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const showCheckout = checkoutStep === "checkout" && rows.length > 0;

  return (
    <div
      className="cart-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-label="Panier BMA">
        <div className="drawer-head">
          <div>
            <h2>{showCheckout ? "Finaliser la commande" : "Ton panier BMA"}</h2>
            <span>
              {itemCount} article{itemCount > 1 ? "s" : ""}
            </span>
          </div>
          <button className="icon-btn" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>

        <div className={`cart-list ${showCheckout ? "summary-list" : ""}`}>
          {rows.length ? (
            rows.map((row) => (
              <div className={`cart-row ${showCheckout ? "summary-row" : ""}`} key={row.id}>
                <div className="row-main">
                  <div className="cart-product-title">
                    <strong>{row.name}</strong>
                    {formatCartVariant(row) ? (
                      <span className="cart-variant">{formatCartVariant(row)}</span>
                    ) : null}
                  </div>
                  <span>{formatMoney(row.total)}</span>
                </div>
                {showCheckout ? (
                  <span className="cart-summary-meta">
                    {row.quantity} x {formatMoney(getProductPrice(row))}
                  </span>
                ) : (
                  <div className="row-main cart-row-actions">
                    <QuantityControl
                      compact
                      value={row.quantity}
                      max={row.stock}
                      onChange={(value) => onQuantityChange(row.id, value)}
                    />
                    <ActionButton
                      icon="trash"
                      label="Retirer"
                      className="ghost cart-remove-button"
                      title={`Retirer ${row.name} du panier`}
                      iconOnly
                      onClick={() => onRemove(row.id)}
                    />
                  </div>
                )}
              </div>
            ))
          ) : (
            <span className="empty">Aucun article dans ton panier.</span>
          )}
        </div>

        {showCheckout ? (
          <div className="checkout">
            {customerProfile?.fullName || customerProfile?.phone || customerProfile?.preferredAddress ? (
              <button className="btn secondary" type="button" onClick={onUseSavedCustomerInfo}>
                Utiliser mes infos de compte
              </button>
            ) : null}
            <div className="tabs two checkout-choice">
              <button
                className={deliveryMode === "manual" ? "active" : ""}
                onClick={() => setDeliveryMode("manual")}
              >
                Donner un repère
              </button>
              <button
                className={deliveryMode === "current_location" ? "active" : ""}
                onClick={() => setDeliveryMode("current_location")}
              >
                Utiliser mon GPS
              </button>
            </div>

            
                <div className="field-grid">
                  <Field
                    label="Nom complet"
                    value={checkout.recipientName}
                    onChange={(value) => updateCheckout("recipientName", value)}
                  />
                  <Field
                    label="Téléphone"
                    value={checkout.contactPhone}
                    onChange={(value) => updateCheckout("contactPhone", value)}
                  />
                  {deliveryMode === "manual" ? (
                    <div className="field full">
                      <label>Où doit-on te livrer ?</label>
                      <textarea
                        placeholder="Ex : Lambanyi, près de la pharmacie, portail noir."
                        value={checkout.note}
                        onChange={(event) => {
                          updateCheckout("note", event.target.value);
                          updateCheckout("landmark", event.target.value);
                        }}
                      />
                    </div>
                  ) : (
                    <>
                    <div className="location-box full">
                      <button
                        className="btn secondary"
                        type="button"
                        onClick={onUseCurrentLocation}
                      >
                        Utiliser ma position actuelle
                      </button>
                      <span>
                        {locationStatus ||
                          "Autorise la localisation, puis ajoute une petite indication si besoin."}
                      </span>
                    </div>
                    <div className="field full">
                      <label>Petit repère en plus</label>
                      <textarea
                        placeholder="Optionnel : portail, étage, boutique proche..."
                        value={checkout.note}
                        onChange={(event) => updateCheckout("note", event.target.value)}
                      />
                    </div>
                    </>
                  )}
                </div>
          </div>
        ) : null}

        <div className="cart-total">
          {deliveryFee > 0 ? (
            <>
              <div className="total-line muted-line">
                <span>Sous-total</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              <div className="total-line muted-line">
                <span>Livraison</span>
                <span>{formatMoney(deliveryFee)}</span>
              </div>
            </>
          ) : null}
          <div className="total-line">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
          {checkoutStatus ? (
            <div className={`checkout-status ${checkoutStatus.tone}`}>
              {checkoutStatus.text}
            </div>
          ) : null}
          <div className="cart-actions">
            {showCheckout ? (
              <>
                <button
                  className={`btn ${isCheckoutSubmitting ? "loading" : ""}`}
                  onClick={onCheckout}
                  disabled={!rows.length || isCheckoutSubmitting}
                >
                  {isCheckoutSubmitting ? "Préparation du paiement..." : "Payer maintenant"}
                </button>
                <button className="btn ghost" type="button" onClick={() => setCheckoutStep("cart")}>
                  Retour au panier
                </button>
              </>
            ) : (
              <>
                <button
                  className="btn"
                  type="button"
                  disabled={!rows.length}
                  onClick={() => setCheckoutStep("checkout")}
                >
                  Valider mon panier
                </button>
                <button className="btn ghost" type="button" onClick={onClose}>
                  Continuer mes achats
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function AdminPage() {
  const [activeSection, setActiveSection] = useState("dashboard");
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [adminContext, setAdminContext] = useState(null);
  const [adminAccessStatus, setAdminAccessStatus] = useState("idle");
  const [authReady, setAuthReady] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [adminOrders, setAdminOrders] = useState([]);
  const [adminProducts, setAdminProducts] = useState([]);
  const [productSalesLedger, setProductSalesLedger] = useState({});
  const [accountingRecords, setAccountingRecords] = useState([]);
  const [stockMovements, setStockMovements] = useState([]);
  const [treasuryMovements, setTreasuryMovements] = useState([]);
  const [treasurySetupMissing, setTreasurySetupMissing] = useState(false);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [selectedAccountingIds, setSelectedAccountingIds] = useState([]);
  const [accountingSearch, setAccountingSearch] = useState("");
  const [accountingPaymentFilter, setAccountingPaymentFilter] = useState("all");
  const [accountingSellerFilter, setAccountingSellerFilter] = useState("all");
  const [accountingSort, setAccountingSort] = useState("date_desc");
  const [selectedAccountingDetailId, setSelectedAccountingDetailId] = useState("");
  const [selectedCustomerKeys, setSelectedCustomerKeys] = useState([]);
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [selectedAuditPersonKey, setSelectedAuditPersonKey] = useState("");
  const [staffAuditOpen, setStaffAuditOpen] = useState(false);
  const [orderFilter, setOrderFilter] = useState("open");
  const [adminMessage, setAdminMessage] = useState("Connexion à l'administration...");
  const [adminToast, setAdminToast] = useState(null);
  const [adminConfirm, setAdminConfirm] = useState(null);
  const [staffInviteForm, setStaffInviteForm] = useState({ email: "", role: "staff" });
  const [isStaffInviteSubmitting, setIsStaffInviteSubmitting] = useState(false);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isStaffLoading, setIsStaffLoading] = useState(false);
  const [staffActionId, setStaffActionId] = useState("");
  const [adminAccountOpen, setAdminAccountOpen] = useState(false);
  const [adminAccountForm, setAdminAccountForm] = useState(emptyAdminAccountForm);
  const [adminAccountMessage, setAdminAccountMessage] = useState(null);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [deletingActionId, setDeletingActionId] = useState("");
  const [isDepositSubmitting, setIsDepositSubmitting] = useState(false);
  const [depositMessage, setDepositMessage] = useState(null);
  const [editingProductId, setEditingProductId] = useState(null);
  const [stockDetailProductId, setStockDetailProductId] = useState("");
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [manualSaleOpen, setManualSaleOpen] = useState(false);
  const [depositPanelOpen, setDepositPanelOpen] = useState(false);
  const [treasuryPanelOpen, setTreasuryPanelOpen] = useState(false);
  const [isTreasurySubmitting, setIsTreasurySubmitting] = useState(false);
  const [productStockView, setProductStockView] = useState("available");
  const [productForm, setProductForm] = useState({
    name: "",
    category: "",
    description: "",
    sizes: "",
    sizesByColor: "",
    stockByColor: "",
    stockDetails: "",
    colors: "",
    price: "",
    purchasePrice: "",
    extraCost: "",
    stock: "",
    imageFiles: [],
    imagePreviews: [],
    imageColors: [],
  });
  const [accountingForm, setAccountingForm] = useState({
    orderId: "",
    saleProductId: "",
    saleQuantity: "1",
    saleColor: "",
    saleSize: "",
    saleVariantLines: "",
    saleVariantDraftColor: "",
    saleVariantDraftSize: "",
    saleVariantDraftQuantity: "1",
    date: getTodayDateInput(),
    customer: "",
    saleAmount: "",
    purchaseAmount: "",
    extraCost: "",
    discountAmount: "",
    note: "",
    paymentMethod: "Liquide",
  });
  const [manualSaleItems, setManualSaleItems] = useState([]);
  const [depositForm, setDepositForm] = useState({
    recordId: "",
    amount: "",
    orangeMoneyRef: "",
    receiptName: "",
    receiptFile: null,
  });
  const [treasuryForm, setTreasuryForm] = useState(emptyTreasuryForm);

  useEffect(() => {
    let mounted = true;

    getCurrentSession().then(({ session: currentSession }) => {
      if (!mounted) return;
      setSession(currentSession);
      setAuthReady(true);
    });

    const subscription = onAuthChange((nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!authReady) return undefined;

    let cancelled = false;
    async function loadAdminData() {
      if (!session) {
        setAdminContext(null);
        setAdminAccessStatus("idle");
        setAdminProducts([]);
        setProductSalesLedger({});
        setAdminOrders([]);
        setAccountingRecords([]);
        setStockMovements([]);
        setTreasuryMovements([]);
        setTreasurySetupMissing(false);
        setRolePermissions([]);
        setStaffMembers([]);
        setSelectedOrder(null);
        setSelectedOrderIds([]);
        setSelectedProductIds([]);
        setSelectedAccountingIds([]);
        setSelectedAccountingDetailId("");
        setSelectedCustomerKeys([]);
        setAdminConfirm(null);
        setAdminMessage("Connecte-toi avec ton compte admin pour gérer BMA.");
        return;
      }

      setAdminAccessStatus("checking");
      const contextResult = await fetchCurrentAdminContext();
      if (cancelled) return;

      if (contextResult.error || !contextResult.data?.isInternal) {
        setAdminContext(null);
        setAdminAccessStatus("denied");
        setAdminProducts([]);
        setProductSalesLedger({});
        setAdminOrders([]);
        setAccountingRecords([]);
        setStockMovements([]);
        setTreasuryMovements([]);
        setTreasurySetupMissing(false);
        setRolePermissions([]);
        setStaffMembers([]);
        setSelectedOrder(null);
        setSelectedOrderIds([]);
        setSelectedProductIds([]);
        setSelectedAccountingIds([]);
        setSelectedCustomerKeys([]);
        setAdminConfirm(null);
        setAdminMessage(
          contextResult.error
            ? `Acces administration refuse : ${contextResult.error.message}`
            : "Ce compte est un compte client. Utilise un compte administrateur BMA."
        );
        return;
      }

      setAdminContext(contextResult.data);
      setAdminAccessStatus("allowed");

      const canReadManagementData =
        contextResult.data?.isOwner || contextResult.data?.role === "manager";
      const syncResult = canReadManagementData
        ? await syncDjomiPayments({ limit: 50 })
        : { data: null, error: null };
      const productsResult = canReadManagementData
        ? await fetchAdminProducts()
        : await fetchProducts();
      const ordersResult = canReadManagementData
        ? await fetchAdminOrders()
        : { data: [], error: null };
      const accountingResult = canReadManagementData
        ? await fetchAccountingEntries()
        : { data: [], error: null };
      const stockMovementsResult = canReadManagementData
        ? await fetchStockMovements()
        : { data: [], error: null };
      const productSalesLedgerResult = canReadManagementData
        ? await fetchProductSalesLedger()
        : { data: {}, error: null };
      const treasuryMovementsResult = canReadManagementData
        ? await fetchTreasuryMovements()
        : { data: [], error: null, setupMissing: false };
      const permissionsResult = canReadManagementData
        ? await fetchRolePermissions()
        : { data: [], error: null };
      const canLoadStaffMembers = canReadManagementData;
      const staffResult = canLoadStaffMembers
        ? await fetchStaffMembers()
        : { data: null, error: null };

      if (cancelled) return;

      if (productsResult.error) {
        setAdminProducts([]);
        setProductSalesLedger({});
      } else {
        const ledgerByProductId = productSalesLedgerResult.error
          ? {}
          : productSalesLedgerResult.data ?? {};
        setProductSalesLedger(ledgerByProductId);
        setAdminProducts(
          productsResult.data.map((product) => ({
            ...product,
            purchasePrice: getPurchasePrice(product),
            costPrice: getCostPrice(product),
            salesLedger: ledgerByProductId[product.id] ?? null,
          }))
        );
      }

      if (accountingResult.error) {
        setAccountingRecords([]);
      } else {
        setAccountingRecords(accountingResult.data);
        setDepositForm((current) => ({
          ...current,
          recordId: accountingResult.data[0]?.id ?? "",
        }));
      }

      setStockMovements(stockMovementsResult.error ? [] : stockMovementsResult.data);
      setTreasuryMovements(treasuryMovementsResult.error ? [] : treasuryMovementsResult.data);
      setTreasurySetupMissing(Boolean(treasuryMovementsResult.setupMissing));

      if (permissionsResult.error) {
        setRolePermissions([]);
      } else {
        setRolePermissions(permissionsResult.data);
      }

      setStaffMembers(
        canLoadStaffMembers && !staffResult.error
          ? staffResult.data?.members ?? []
          : []
      );

      if (ordersResult.error) {
        setAdminMessage(
          `Articles chargés. Commandes non chargées : ${ordersResult.error.message}`
        );
        return;
      }

      if (!ordersResult.data.length) {
        setAdminOrders([]);
        setSelectedOrder(null);
        setSelectedOrderIds([]);
        setAdminMessage(
          accountingResult.error
            ? `Comptabilité non chargée : ${accountingResult.error.message}`
            : ""
        );
        return;
      }

      setAdminOrders(ordersResult.data);
      setSelectedOrder(null);
      setSelectedOrderIds([]);
      setAdminMessage(
        accountingResult.error
          ? `Commandes chargées. Comptabilité non chargée : ${accountingResult.error.message}`
          : syncResult.data?.updated
            ? `${syncResult.data.updated} paiement(s) Djomi confirmÃ©(s) automatiquement.`
            : ""
      );
    }

    loadAdminData();

    return () => {
      cancelled = true;
    };
  }, [authReady, session]);

  useEffect(() => {
    if (!session || adminAccessStatus !== "allowed" || adminContext?.role === "staff") {
      return undefined;
    }

    let cancelled = false;

    async function syncPendingDjomiOrders() {
      const { data, error } = await syncDjomiPayments({ limit: 50 });

      if (cancelled || error || !data?.updated) return;

      const ordersResult = await fetchAdminOrders();
      if (cancelled || ordersResult.error) return;

      const accountingResult = await fetchAccountingEntries();
      if (!cancelled && !accountingResult.error) {
        setAccountingRecords(accountingResult.data);
        setDepositForm((current) => ({
          ...current,
          recordId:
            current.recordId && accountingResult.data.some((record) => record.id === current.recordId)
              ? current.recordId
              : accountingResult.data[0]?.id ?? "",
        }));
      }

      const stockMovementsResult = await fetchStockMovements();
      if (!cancelled && !stockMovementsResult.error) {
        setStockMovements(stockMovementsResult.data);
      }

      setAdminOrders(ordersResult.data);
      setSelectedOrder((current) =>
        current
          ? ordersResult.data.find((order) => order.rawId === current.rawId) ?? current
          : current
      );
      setAdminMessage(`${data.updated} paiement(s) Djomi confirmes automatiquement.`);
    }

    syncPendingDjomiOrders();
    const intervalId = window.setInterval(syncPendingDjomiOrders, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [session, adminAccessStatus, adminContext?.role]);

  useEffect(() => {
    if (!session) {
      setAdminAccountOpen(false);
      setAdminAccountForm(emptyAdminAccountForm);
      return;
    }

    setAdminAccountForm({
      ...emptyAdminAccountForm,
      fullName: session.user.user_metadata?.full_name || "",
    });
  }, [session]);

  useEffect(() => {
    const hasBlockingPanel =
      adminAccountOpen ||
      productEditorOpen ||
      manualSaleOpen ||
      depositPanelOpen ||
      treasuryPanelOpen ||
      Boolean(selectedAccountingDetailId) ||
      Boolean(stockDetailProductId);

    if (!hasBlockingPanel) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      setAdminAccountOpen(false);
      setProductEditorOpen(false);
      setManualSaleOpen(false);
      setDepositPanelOpen(false);
      setTreasuryPanelOpen(false);
      setSelectedAccountingDetailId("");
      setStockDetailProductId("");
      setDepositMessage(null);
      setEditingProductId(null);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [
    adminAccountOpen,
    productEditorOpen,
    manualSaleOpen,
    depositPanelOpen,
    treasuryPanelOpen,
    selectedAccountingDetailId,
    stockDetailProductId,
  ]);

  const cashFlowRevenueRecords = accountingRecords.filter((record) =>
    ["Liquide", "Orange Money", "Djomi"].includes(record.paymentMethod)
  );
  const totalRevenue = cashFlowRevenueRecords.reduce(
    (sum, record) => sum + Number(record.saleAmount || 0),
    0
  );
  const totalCost = cashFlowRevenueRecords.reduce(
    (sum, record) => sum + Number(record.costAmount || 0),
    0
  );
  const totalCash = accountingRecords
    .filter((record) => record.paymentMethod === "Liquide")
    .reduce((sum, record) => sum + Number(record.saleAmount || 0), 0);
  const depositedCash = accountingRecords
    .filter((record) => record.paymentMethod === "Liquide")
    .reduce((sum, record) => sum + Number(record.depositAmount || 0), 0);
  const cashToDeposit = Math.max(0, totalCash - depositedCash);
  const pendingCashRecords = accountingRecords.filter(
    (record) =>
      record.paymentMethod === "Liquide" &&
      Number(record.remainingDepositAmount ?? record.saleAmount ?? 0) > 0
  );
  const directOrangeMoneyReceiptRecords = accountingRecords.filter(
    (record) =>
      record.paymentMethod === "Orange Money" &&
      !(record.receiptUrl || record.receiptName) &&
      !(record.depositHistory ?? []).some((deposit) => deposit.receiptUrl || deposit.receiptName)
  );
  const depositableRecords = [...pendingCashRecords, ...directOrangeMoneyReceiptRecords];
  const selectedDepositRecordId = depositableRecords.some(
    (record) => record.id === depositForm.recordId
  )
    ? depositForm.recordId
    : depositableRecords[0]?.id || "";
  const selectedDepositRecord = accountingRecords.find(
    (record) => record.id === selectedDepositRecordId
  );
  const selectedDepositIsDirectOrangeMoney =
    selectedDepositRecord?.paymentMethod === "Orange Money";
  const selectedDepositRemainingAmount = Math.max(
    0,
    Number(
      selectedDepositIsDirectOrangeMoney
        ? selectedDepositRecord?.saleAmount
        : selectedDepositRecord?.remainingDepositAmount ?? selectedDepositRecord?.saleAmount ?? 0
    )
  );
  const adminDisplayName = getAdminDisplayName(session);
  const isSuperAdmin = Boolean(adminContext?.isOwner);
  const adminRole = adminContext?.role || (adminContext?.isOwner ? "owner" : "");
  const isManager = adminRole === "manager";
  const isSeller = adminRole === "staff";
  const canViewTeamSettings = isSuperAdmin || isManager;
  const canViewDeleteControls = isSuperAdmin || isManager;
  const canSeeAccountingFinancials = !isSeller;
  const ownerDeleteMessage =
    "Action réservée au super admin. Rapproche-toi du super admin pour supprimer.";
  const productSalePreview = getDraftAmount(productForm.price);
  const productPurchasePreview = getDraftAmount(productForm.purchasePrice);
  const productExtraCostPreview = getDraftAmount(productForm.extraCost);
  const productCostPreview = productPurchasePreview + productExtraCostPreview;
  const productMarginPreview = productSalePreview - productCostPreview;
  const accountingSalePreview = getDraftAmount(accountingForm.saleAmount);
  const accountingPurchasePreview = getDraftAmount(accountingForm.purchaseAmount);
  const accountingExtraCostPreview = getDraftAmount(accountingForm.extraCost);
  const accountingAdjustmentPreview = getSignedDraftAmount(accountingForm.discountAmount);
  const accountingCostPreview = accountingPurchasePreview + accountingExtraCostPreview;
  const selectedSaleProduct = adminProducts.find(
    (product) => product.id === accountingForm.saleProductId
  );
  const stockDetailProduct = adminProducts.find((product) => product.id === stockDetailProductId);
  const availableAdminProducts = adminProducts.filter((product) => getProductEffectiveStock(product) > 0);
  const outOfStockProducts = adminProducts.filter((product) => getProductEffectiveStock(product) <= 0);
  const displayedAdminProducts =
    productStockView === "out_of_stock" ? outOfStockProducts : availableAdminProducts;
  const saleQuantity = Math.max(1, getDraftAmount(accountingForm.saleQuantity, 1));
  const selectedSaleColorOptions = selectedSaleProduct
    ? getProductColorOptions(selectedSaleProduct)
    : [];
  const selectedSaleSizeOptions = selectedSaleProduct
    ? getProductSizeOptions(selectedSaleProduct, accountingForm.saleColor)
    : [];
  const selectedSaleDraftSizeOptions = selectedSaleProduct
    ? getProductSizeOptions(selectedSaleProduct, accountingForm.saleVariantDraftColor)
    : [];
  const manualVariantRows = selectedSaleProduct
    ? parseManualVariantRows(accountingForm.saleVariantLines, selectedSaleProduct)
    : [];
  const manualVariantQuantity = manualVariantRows.reduce(
    (sum, row) => sum + Number(row.quantity || 0),
    0
  );
  const showManualVariantFields =
    Boolean(selectedSaleProduct) &&
    (selectedSaleColorOptions.length > 0 || selectedSaleSizeOptions.length > 0);
  const selectedSaleColorStock =
    selectedSaleProduct && accountingForm.saleColor
      ? getProductStockForColor(selectedSaleProduct, accountingForm.saleColor)
      : Number(selectedSaleProduct?.stock || 0);
  const manualVariantDraftQuantity = Math.max(
    1,
    getDraftAmount(accountingForm.saleVariantDraftQuantity, 1)
  );
  const selectedSaleDraftStock =
    selectedSaleProduct && accountingForm.saleVariantDraftColor
      ? accountingForm.saleVariantDraftSize
        ? getProductStockForSelection(
            selectedSaleProduct,
            accountingForm.saleVariantDraftColor,
            accountingForm.saleVariantDraftSize
          )
        : getProductStockForColor(selectedSaleProduct, accountingForm.saleVariantDraftColor)
      : Number(selectedSaleProduct?.stock || 0);
  const selectedSaleBaseAmount = selectedSaleProduct
    ? getProductPrice(selectedSaleProduct) * saleQuantity
    : accountingSalePreview;
  const selectedPurchaseAmount = selectedSaleProduct
    ? getPurchasePrice(selectedSaleProduct) * saleQuantity
    : accountingPurchasePreview;
  const selectedCostAmount = selectedSaleProduct
    ? getCostPrice(selectedSaleProduct) * saleQuantity
    : accountingCostPreview;
  const selectedExtraCostAmount = Math.max(0, selectedCostAmount - selectedPurchaseAmount);
  const hasManualSaleItems = manualSaleItems.length > 0;
  const manualSaleItemsQuantity = manualSaleItems.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0
  );
  const manualSaleItemsBaseAmount = manualSaleItems.reduce(
    (sum, item) => sum + Number(item.saleAmount || 0),
    0
  );
  const manualSaleItemsPurchaseAmount = manualSaleItems.reduce(
    (sum, item) => sum + Number(item.purchaseAmount || 0),
    0
  );
  const manualSaleItemsCostAmount = manualSaleItems.reduce(
    (sum, item) => sum + Number(item.costAmount || 0),
    0
  );
  const manualSaleItemsExtraCostAmount = Math.max(
    0,
    manualSaleItemsCostAmount - manualSaleItemsPurchaseAmount
  );
  const manualSaleBaseAmount = hasManualSaleItems
    ? manualSaleItemsBaseAmount
    : selectedSaleBaseAmount;
  const manualSalePurchaseAmount = hasManualSaleItems
    ? manualSaleItemsPurchaseAmount
    : selectedPurchaseAmount;
  const manualSaleCostAmount = hasManualSaleItems
    ? manualSaleItemsCostAmount
    : selectedCostAmount;
  const manualSaleExtraCostAmount = hasManualSaleItems
    ? manualSaleItemsExtraCostAmount
    : selectedExtraCostAmount;
  const manualSaleFinalAmount = Math.max(
    0,
    manualSaleBaseAmount + accountingAdjustmentPreview
  );
  const manualSaleMarginAmount = manualSaleFinalAmount - manualSaleCostAmount;
  const openOrders = adminOrders.filter(
    (order) => !["delivered", "cancelled"].includes(order.rawStatus)
  );
  const unpaidOrders = adminOrders.filter((order) => order.payment !== "Payé");
  const lowStockProducts = adminProducts.filter((product) => {
    const stock = getProductEffectiveStock(product);
    return stock > 0 && stock <= 3;
  });
  const customerGroups = useMemo(() => {
    const groups = new Map();
    const existingOrderRefs = new Set(adminOrders.map((order) => order.id));

    adminOrders.forEach((order) => {
      const key = getCustomerKey({
        name: order.customer,
        phone: order.phone,
        userId: order.userId,
      });
      const current = groups.get(key) ?? {
        key,
        name: order.customer || "Client",
        phone: order.phone || "-",
        orders: [],
        totalSpent: 0,
        lastOrderDate: "",
        paidOrders: 0,
      };

      current.orders.push(order);
      current.totalSpent += Number(order.total || 0);
      if (order.payment === "Payé") current.paidOrders += 1;
      current.lastOrderDate =
        !current.lastOrderDate || order.createdAt > current.lastOrderDate
          ? order.createdAt
          : current.lastOrderDate;
      groups.set(key, current);
    });

    accountingRecords.forEach((record) => {
      if (!record.customer) return;
      if (existingOrderRefs.has(record.orderId)) return;

      const fallbackKey = getCustomerKey({ name: record.customer, phone: "" });
      const normalizedCustomerName = String(record.customer || "")
        .trim()
        .toLowerCase();
      const existingCustomer = [...groups.values()].find(
        (customer) =>
          String(customer.name || "").trim().toLowerCase() === normalizedCustomerName
      );
      const key = existingCustomer?.key || fallbackKey;
      const current = existingCustomer ?? groups.get(fallbackKey) ?? {
        key,
        name: record.customer,
        phone: "-",
        orders: [],
        totalSpent: 0,
        lastOrderDate: "",
        paidOrders: 0,
      };

      current.orders.push({
        id: record.orderId,
        rawId: record.id,
        customer: record.customer,
        phone: current.phone,
        zone: record.paymentMethod,
        addressType: "Vente manuelle",
        payment: record.paymentMethod,
        status: "Vente manuelle",
        tone: "paid",
        total: Number(record.saleAmount || 0),
        createdAt: record.date,
        createdDate: record.date,
        isManualSale: true,
      });
      current.totalSpent += Number(record.saleAmount || 0);
      current.paidOrders += record.paymentMethod ? 1 : 0;
      current.lastOrderDate =
        !current.lastOrderDate || record.date > current.lastOrderDate
          ? record.date
          : current.lastOrderDate;
      groups.set(key, {
        ...current,
        key,
      });
    });

    return [...groups.values()]
      .map((customer) => ({
        ...customer,
        orders: [...customer.orders].sort((first, second) =>
          String(second.createdAt || "").localeCompare(String(first.createdAt || ""))
        ),
      }))
      .sort((first, second) => Number(second.totalSpent) - Number(first.totalSpent));
  }, [accountingRecords, adminOrders]);
  const selectedCustomer =
    customerGroups.find((customer) => customer.key === selectedCustomerKey) ??
    customerGroups[0] ??
    null;

  useEffect(() => {
    if (!customerGroups.length) {
      setSelectedCustomerKey("");
      setSelectedCustomerKeys([]);
      return;
    }

    if (!customerGroups.some((customer) => customer.key === selectedCustomerKey)) {
      setSelectedCustomerKey(customerGroups[0].key);
    }
  }, [customerGroups, selectedCustomerKey]);

  useEffect(() => {
    setSelectedCustomerKeys((current) => {
      const existingKeys = new Set(customerGroups.map((customer) => customer.key));
      return current.filter((customerKey) => existingKeys.has(customerKey));
    });
  }, [customerGroups]);

  useEffect(() => {
    setSelectedOrderIds((current) => {
      const existingIds = new Set(adminOrders.map((order) => order.rawId));
      return current.filter((orderId) => existingIds.has(orderId));
    });
  }, [adminOrders]);

  useEffect(() => {
    setSelectedProductIds((current) => {
      const existingIds = new Set(adminProducts.map((product) => product.id));
      return current.filter((productId) => existingIds.has(productId));
    });
  }, [adminProducts]);

  useEffect(() => {
    setSelectedAccountingIds((current) => {
      const existingIds = new Set(accountingRecords.map((record) => record.id));
      return current.filter((recordId) => existingIds.has(recordId));
    });
  }, [accountingRecords]);

  useEffect(() => {
    if (!adminToast || adminToast.tone === "issue") return undefined;

    const timeoutId = window.setTimeout(() => setAdminToast(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [adminToast]);

  const grossProfitAmount = totalRevenue - totalCost;
  const marginAmount = grossProfitAmount;
  const marginRate = getMarginRate(totalRevenue, totalCost);
  const financeHealth =
    marginAmount < 0 ? "À vérifier" : cashToDeposit > 0 ? "Dépôt à faire" : "Stable";
  const djomiRevenue = accountingRecords
    .filter((record) => record.paymentMethod === "Djomi")
    .reduce((sum, record) => sum + Number(record.saleAmount || 0), 0);
  const orangeMoneyRevenue = accountingRecords
    .filter((record) => record.paymentMethod === "Orange Money")
    .reduce((sum, record) => sum + Number(record.saleAmount || 0), 0);
  const inventoryCostValue = adminProducts.reduce(
    (sum, product) => sum + getProductEffectiveStock(product) * getCostPrice(product),
    0
  );
  const inventorySaleValue = adminProducts.reduce(
    (sum, product) => sum + getProductEffectiveStock(product) * getProductPrice(product),
    0
  );
  const depositedAccountTotal = depositedCash + orangeMoneyRevenue + djomiRevenue;
  const totalCashIn = totalCash + orangeMoneyRevenue;
  const totalCashOut = totalCost + inventoryCostValue;
  const availableAccountBalance = totalCashIn - totalCashOut;
  const deliveredUnpaidOrders = adminOrders.filter(
    (order) => order.rawStatus === "delivered" && order.payment !== "Payé"
  );
  const visibleAdminOrders = adminOrders.filter((order) => matchesOrderFilter(order, orderFilter));
  const selectedOrders = visibleAdminOrders.filter((order) => selectedOrderIds.includes(order.rawId));
  const allOrdersSelected =
    visibleAdminOrders.length > 0 &&
    visibleAdminOrders.every((order) => selectedOrderIds.includes(order.rawId));
  const canPrepareSelectedOrders = selectedOrders.some((order) =>
    canMoveOrderStatus(order, "preparing", isSuperAdmin)
  );
  const canDeliverSelectedOrders = selectedOrders.some((order) =>
    canMoveOrderStatus(order, "delivered", isSuperAdmin)
  );
  const canCancelSelectedOrders = selectedOrders.some((order) =>
    canMoveOrderStatus(order, "cancelled", isSuperAdmin)
  );
  const selectedProducts = adminProducts.filter((product) => selectedProductIds.includes(product.id));
  const allDisplayedProductsSelected =
    displayedAdminProducts.length > 0 &&
    displayedAdminProducts.every((product) => selectedProductIds.includes(product.id));
  const accountingSellerOptions = useMemo(
    () =>
      uniqueOptionValues(accountingRecords.map((record) => record.collectedBy)).sort((first, second) =>
        first.localeCompare(second, "fr", { sensitivity: "base" })
      ),
    [accountingRecords]
  );
  const visibleAccountingRecords = useMemo(() => {
    const search = normalizeSearchText(accountingSearch);
    const filtered = accountingRecords.filter((record) => {
      const matchesPayment =
        accountingPaymentFilter === "all" || record.paymentMethod === accountingPaymentFilter;
      const matchesSeller =
        accountingSellerFilter === "all" || record.collectedBy === accountingSellerFilter;
      const searchable = normalizeSearchText(
        [record.date, record.orderId, record.customer, record.paymentMethod, record.collectedBy, record.note]
          .filter(Boolean)
          .join(" ")
      );

      return matchesPayment && matchesSeller && (!search || searchable.includes(search));
    });

    return filtered
      .map((record, index) => ({ record, index }))
      .sort((first, second) => {
        const firstRecord = first.record;
        const secondRecord = second.record;
        let comparison = 0;

        if (accountingSort === "date_asc") {
          comparison = String(firstRecord.date || "").localeCompare(String(secondRecord.date || ""));
        } else if (accountingSort === "sale_desc") {
          comparison = Number(secondRecord.saleAmount || 0) - Number(firstRecord.saleAmount || 0);
        } else if (accountingSort === "sale_asc") {
          comparison = Number(firstRecord.saleAmount || 0) - Number(secondRecord.saleAmount || 0);
        } else if (accountingSort === "margin_desc") {
          comparison =
            Number(secondRecord.saleAmount || 0) - Number(secondRecord.costAmount || 0) -
            (Number(firstRecord.saleAmount || 0) - Number(firstRecord.costAmount || 0));
        } else if (accountingSort === "customer_asc") {
          comparison = String(firstRecord.customer || "").localeCompare(
            String(secondRecord.customer || ""),
            "fr",
            { sensitivity: "base" }
          );
        } else if (accountingSort === "seller_asc") {
          comparison = String(firstRecord.collectedBy || "").localeCompare(
            String(secondRecord.collectedBy || ""),
            "fr",
            { sensitivity: "base" }
          );
        } else {
          comparison = String(secondRecord.date || "").localeCompare(String(firstRecord.date || ""));
        }

        return comparison || first.index - second.index;
      })
      .map(({ record }) => record);
  }, [
    accountingRecords,
    accountingSearch,
    accountingPaymentFilter,
    accountingSellerFilter,
    accountingSort,
  ]);
  const selectedAccountingRecords = visibleAccountingRecords.filter((record) =>
    selectedAccountingIds.includes(record.id)
  );
  const selectedAccountingDetail =
    accountingRecords.find((record) => record.id === selectedAccountingDetailId) ?? null;
  const selectedAccountingProduct = selectedAccountingDetail?.productId
    ? adminProducts.find((product) => product.id === selectedAccountingDetail.productId)
    : null;
  const allAccountingSelected =
    visibleAccountingRecords.length > 0 &&
    visibleAccountingRecords.every((record) => selectedAccountingIds.includes(record.id));
  const selectedCustomers = customerGroups.filter((customer) =>
    selectedCustomerKeys.includes(customer.key)
  );
  const allCustomersSelected =
    customerGroups.length > 0 && selectedCustomerKeys.length === customerGroups.length;
  const negativeMarginRecords = accountingRecords.filter(
    (record) => Number(record.saleAmount || 0) - Number(record.costAmount || 0) < 0
  );
  const staffAuditRows = (() => {
    const groups = new Map();
    const ensurePerson = (name) => {
      const cleanName = String(name || "-").trim() || "-";
      const key = getPersonKey(cleanName);
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: cleanName,
          records: [],
          depositRecords: [],
          articlesSold: 0,
          saleAmount: 0,
          costAmount: 0,
          cashCollected: 0,
          cashDepositedFromSales: 0,
          cashToDeposit: 0,
          depositsMade: 0,
          djomiAmount: 0,
          orangeMoneyAmount: 0,
        });
      }
      return groups.get(key);
    };

    accountingRecords.forEach((record) => {
      const seller = ensurePerson(record.collectedBy || "-");
      const quantity = Number(record.quantity || 1);
      const saleAmount = Number(record.saleAmount || 0);
      const costAmount = Number(record.costAmount || 0);

      seller.records.push(record);
      seller.articlesSold += quantity;
      seller.saleAmount += saleAmount;
      seller.costAmount += costAmount;

      if (record.paymentMethod === "Liquide") {
        const depositedAmount = Number(record.depositAmount || 0);
        const remainingAmount = Number(record.remainingDepositAmount ?? saleAmount);

        seller.cashCollected += saleAmount;
        seller.cashDepositedFromSales += depositedAmount;
        seller.cashToDeposit += Math.max(0, remainingAmount);
      }

      if (record.paymentMethod === "Djomi") seller.djomiAmount += saleAmount;
      if (record.paymentMethod === "Orange Money") seller.orangeMoneyAmount += saleAmount;

      if (record.depositedBy && Number(record.depositAmount || 0) > 0) {
        const depositor = ensurePerson(record.depositedBy);
        depositor.depositRecords.push(record);
        depositor.depositsMade += Number(record.depositAmount || 0);
      }
    });

    return [...groups.values()]
      .map((person) => ({
        ...person,
        marginAmount: person.saleAmount - person.costAmount,
      }))
      .sort((first, second) => second.saleAmount - first.saleAmount);
  })();
  const selectedAuditPerson =
    staffAuditRows.find((person) => person.key === selectedAuditPersonKey) ?? null;
  const auditIssues = [
    treasurySetupMissing
      ? {
          tone: "warning",
          title: "Suivi trésorerie à activer",
          text: "Le SQL treasury_movements n'est pas encore appliqué. Les sorties d'achat/frais ne peuvent pas être déduites avec certitude.",
        }
      : null,
    cashToDeposit > 0
      ? {
          tone: "warning",
          title: "Liquide à déposer",
          text: `${formatMoney(cashToDeposit)} doivent encore aller sur le compte Orange Money général.`,
        }
      : null,
    deliveredUnpaidOrders.length
      ? {
          tone: "danger",
          title: "Commandes livrées non payées",
          text: `${deliveredUnpaidOrders.length} commande(s) marquées livrées ont encore un paiement en attente.`,
        }
      : null,
    negativeMarginRecords.length
      ? {
          tone: "danger",
          title: "Marge négative",
          text: `${negativeMarginRecords.length} ligne(s) comptables vendent sous le prix de revient.`,
        }
      : null,
    outOfStockProducts.length
      ? {
          tone: "warning",
          title: "Stock épuisé",
          text: `${outOfStockProducts.length} article(s) ne sont plus disponibles à la vente.`,
        }
      : null,
    lowStockProducts.length
      ? {
          tone: "info",
          title: "Stock faible",
          text: `${lowStockProducts.length} article(s) sont presque épuisés.`,
        }
      : null,
  ].filter(Boolean);

  const navItems = [
    { id: "dashboard", label: "Accueil", hint: "Aujourd'hui" },
    { id: "orders", label: "Commandes", hint: "A préparer" },
    { id: "customers", label: "Clients", hint: "Historique" },
    { id: "products", label: "Articles", hint: "Stock & photos" },
    {
      id: "accounting",
      label: isSeller ? "Vendre" : "Ventes & caisse",
      hint: isSeller ? "Vente simple" : "Manuel + dépôts",
    },
    { id: "audit", label: "Audit", hint: "Argent + stock" },
    { id: "settings", label: "Réglages", hint: "Permissions" },
  ];
  const visibleNavItems = navItems.filter((item) => canAccessAdminSection(item.id));
  const sectionMeta = {
    dashboard: {
      title: "Accueil",
      description: "Les priorités du jour, sans doublon.",
    },
    products: {
      title: "Articles",
      description: "Créer, modifier, gérer les variantes et le stock.",
    },
    orders: {
      title: "Commandes",
      description: "Suivre les commandes client jusqu'à livraison.",
    },
    customers: {
      title: "Clients",
      description: "Regrouper les commandes par client et repérer les fidèles.",
    },
    accounting: {
      title: isSeller ? "Vendre" : "Ventes & caisse",
      description: isSeller
        ? "Enregistrer une vente sans afficher les marges ni les chiffres sensibles."
        : "Vente manuelle, marge, liquide encaissé et dépôts Orange Money.",
    },
    audit: {
      title: "Audit",
      description: "Contrôler où sont l'argent, le stock et les incohérences.",
    },
    settings: {
      title: "Réglages",
      description: "Modifier les permissions de l'équipe.",
    },
  }[activeSection];

  useEffect(() => {
    if (adminAccessStatus !== "allowed") return;

    if (!canAccessAdminSection(activeSection)) {
      setActiveSection(isSeller ? "accounting" : "dashboard");
      setAdminNavOpen(false);
    }
  }, [activeSection, adminAccessStatus, isSeller]);

  function canAccessAdminSection(sectionId) {
    if (!adminContext?.isInternal) return false;
    if (isSeller) return sectionId === "accounting";
    return isSuperAdmin || isManager;
  }

  function navigateAdmin(sectionId) {
    if (!canAccessAdminSection(sectionId)) {
      showToast("Cet espace est réservé aux managers et au super admin.", "issue");
      return;
    }

    setActiveSection(sectionId);
    setAdminNavOpen(false);
  }

  function showOwnerDeleteBlocked() {
    showToast(ownerDeleteMessage, "issue");
  }

  function showToast(text, tone = "paid") {
    setAdminToast({
      text: tone === "issue" ? translateTechnicalErrorText(text) : text,
      tone,
    });
  }

  function requestAdminConfirm(options) {
    setAdminConfirm({
      title: options.title || "Confirmer l'action",
      message: options.message || "Tu confirmes cette action ?",
      confirmLabel: options.confirmLabel || "Confirmer",
      tone: options.tone || "danger",
      onConfirm: options.onConfirm,
    });
  }

  async function confirmAdminAction() {
    const action = adminConfirm?.onConfirm;
    setAdminConfirm(null);

    if (typeof action === "function") {
      await action();
    }
  }

  async function refreshAdminLists({ keepSelected = true } = {}) {
    const canRefreshManagementData = isSuperAdmin || isManager;
    const [
      productsResult,
      ordersResult,
      accountingResult,
      stockMovementsResult,
      productSalesLedgerResult,
      treasuryMovementsResult,
    ] = await Promise.all([
      canRefreshManagementData ? fetchAdminProducts() : fetchProducts(),
      canRefreshManagementData ? fetchAdminOrders() : { data: [], error: null },
      canRefreshManagementData ? fetchAccountingEntries() : { data: [], error: null },
      canRefreshManagementData ? fetchStockMovements() : { data: [], error: null },
      canRefreshManagementData ? fetchProductSalesLedger() : { data: {}, error: null },
      canRefreshManagementData
        ? fetchTreasuryMovements()
        : { data: [], error: null, setupMissing: false },
    ]);

    if (!productsResult.error) {
      const ledgerByProductId = productSalesLedgerResult.error
        ? productSalesLedger
        : productSalesLedgerResult.data ?? {};
      setProductSalesLedger(ledgerByProductId);
      setAdminProducts(
        productsResult.data.map((product) => ({
          ...product,
          purchasePrice: getPurchasePrice(product),
          costPrice: getCostPrice(product),
          salesLedger: ledgerByProductId[product.id] ?? null,
        }))
      );
    }

    if (!ordersResult.error) {
      setAdminOrders(ordersResult.data);
      setSelectedOrder((current) =>
        keepSelected && current
          ? ordersResult.data.find((order) => order.rawId === current.rawId) ?? null
          : null
      );
    }

    if (!accountingResult.error) {
      setAccountingRecords(accountingResult.data);
      setDepositForm((current) => ({
        ...current,
        recordId:
          current.recordId && accountingResult.data.some((record) => record.id === current.recordId)
            ? current.recordId
            : accountingResult.data[0]?.id ?? "",
      }));
    }

    if (!stockMovementsResult.error) {
      setStockMovements(stockMovementsResult.data);
    }

    if (!treasuryMovementsResult.error) {
      setTreasuryMovements(treasuryMovementsResult.data);
      setTreasurySetupMissing(Boolean(treasuryMovementsResult.setupMissing));
    }
  }

  function exportProductsToExcel() {
    const rowsToExport = selectedProducts.length ? selectedProducts : adminProducts;

    downloadExcelWorkbook(`bma-articles-${getTodayDateInput()}`, [
      {
        name: "Articles",
        rows: rowsToExport.map((product) => ({
          Article: product.name,
          Categorie: product.category,
          Prix_vente_GNF: getProductPrice(product),
          Prix_achat_GNF: getPurchasePrice(product),
          Prix_revient_GNF: getCostPrice(product),
          Marge_GNF: getProductPrice(product) - getCostPrice(product),
          Stock: product.stock,
          Tailles: (product.sizes ?? []).join(", "),
          Couleurs: (product.colors ?? [])
            .map((color) => (typeof color === "string" ? color : color.value))
            .filter(Boolean)
            .join(", "),
          Image: product.image,
        })),
      },
    ]);
  }

  function exportOrdersToExcel() {
    const rowsToExport = selectedOrders.length ? selectedOrders : visibleAdminOrders;

    downloadExcelWorkbook(`bma-commandes-${getTodayDateInput()}`, [
      {
        name: "Commandes",
        rows: rowsToExport.map((order) => ({
          Commande: order.id,
          Date: order.createdDate,
          Client: order.customer,
          Telephone: order.phone,
          Zone: order.zone,
          Adresse: order.landmark,
          Total_GNF: order.total,
          Paiement: order.payment,
          Statut: order.status,
          Articles: order.itemsSummary,
          Position_Maps: order.mapsUrl || "",
        })),
      },
    ]);
  }

  function exportAccountingToExcel() {
    const rowsToExport = selectedAccountingRecords.length
      ? selectedAccountingRecords
      : visibleAccountingRecords;

    downloadExcelWorkbook(`bma-comptabilite-${getTodayDateInput()}`, [
      {
        name: "Comptabilite",
        rows: rowsToExport.map((record) => {
          const receipts = getAccountingReceiptEntries(record);

          return {
            Date: record.date,
            Commande: record.orderId,
            Client: record.customer,
            Vente_GNF: record.saleAmount,
            Achat_GNF: record.purchaseAmount,
            Frais_GNF: record.extraCost,
            Revient_GNF: record.costAmount,
            Marge_GNF: record.saleAmount - record.costAmount,
            Encaissement: record.paymentMethod,
            Encaisse_par: record.collectedBy,
            Depot_Orange_Money:
              record.orangeMoneyRef ||
              (record.paymentMethod === "Orange Money" ? "Orange Money direct - recu a joindre" : "A deposer"),
            Montant_depose_GNF: record.depositAmount || 0,
            Reste_a_deposer_GNF: record.remainingDepositAmount || 0,
            Recus: receipts
              .map((receipt, index) =>
                [
                  `${index + 1}. ${receipt.label}`,
                  receipt.amount ? formatMoney(receipt.amount) : "",
                  receipt.receiptUrl || receipt.receiptName,
                ]
                  .filter(Boolean)
                  .join(" - ")
              )
              .join("\n"),
            Note: record.note || "",
          };
        }),
      },
    ]);
  }

  function exportAuditToExcel() {
    downloadExcelWorkbook(`bma-audit-${getTodayDateInput()}`, [
      {
        name: "Audit",
        rows: [
          { Indicateur: "Rentrees argent", Valeur: totalCashIn },
          { Indicateur: "Sorties argent", Valeur: totalCashOut },
          { Indicateur: "Disponible sur compte", Valeur: availableAccountBalance },
          { Indicateur: "Liquide encaisse", Valeur: totalCash },
          { Indicateur: "Orange Money direct", Valeur: orangeMoneyRevenue },
          { Indicateur: "Cout articles vendus", Valeur: totalCost },
          { Indicateur: "Cout stock restant", Valeur: inventoryCostValue },
          { Indicateur: "Articles epuises", Valeur: outOfStockProducts.length },
          { Indicateur: "Stock faible", Valeur: lowStockProducts.length },
        ],
      },
      {
        name: "Par personne",
        rows: staffAuditRows.map((person) => ({
          Personne: person.name,
          Articles_vendus: person.articlesSold,
          Ventes_GNF: person.saleAmount,
          Revient_GNF: person.costAmount,
          Marge_GNF: person.marginAmount,
          Liquide_encaisse_GNF: person.cashCollected,
          Liquide_depose_depuis_ses_ventes_GNF: person.cashDepositedFromSales,
          Liquide_a_deposer_GNF: person.cashToDeposit,
          Depots_effectues_GNF: person.depositsMade,
          Djomi_GNF: person.djomiAmount,
          Orange_Money_direct_GNF: person.orangeMoneyAmount,
        })),
      },
      {
        name: "Mouvements stock",
        rows: stockMovements.map((movement) => ({
          Date: movement.createdAt,
          Article: movement.productName,
          Variation: movement.delta,
          Stock_avant: movement.stockBefore,
          Stock_apres: movement.stockAfter,
          Raison: movement.reason,
          Reference: [movement.referenceType, movement.referenceId].filter(Boolean).join(" - "),
          Par: movement.actor,
          Note: movement.note,
        })),
      },
    ]);
  }

  function exportCustomersToExcel() {
    const rowsToExport = selectedCustomers.length ? selectedCustomers : customerGroups;

    downloadExcelWorkbook(`bma-clients-${getTodayDateInput()}`, [
      {
        name: "Clients",
        rows: rowsToExport.map((customer) => ({
          Client: customer.name,
          Telephone: customer.phone,
          Commandes: customer.orders.length,
          Commandes_payees: customer.paidOrders,
          Total_GNF: customer.totalSpent,
          Derniere_commande: customer.lastOrderDate,
          Historique: customer.orders.map((order) => `${order.id} (${formatMoney(order.total)})`).join(" | "),
        })),
      },
    ]);
  }

  function exportAllAdminData() {
    downloadExcelWorkbook(`bma-export-complet-${getTodayDateInput()}`, [
      {
        name: "Articles",
        rows: adminProducts.map((product) => ({
          Article: product.name,
          Categorie: product.category,
          Vente_GNF: getProductPrice(product),
          Achat_GNF: getPurchasePrice(product),
          Revient_GNF: getCostPrice(product),
          Stock: product.stock,
          Tailles: (product.sizes ?? []).join(", "),
          Couleurs: (product.colors ?? [])
            .map((color) => (typeof color === "string" ? color : color.value))
            .filter(Boolean)
            .join(", "),
        })),
      },
      {
        name: "Commandes",
        rows: adminOrders.map((order) => ({
          Commande: order.id,
          Date: order.createdDate,
          Client: order.customer,
          Telephone: order.phone,
          Total_GNF: order.total,
          Paiement: order.payment,
          Statut: order.status,
          Articles: order.itemsSummary,
        })),
      },
      {
        name: "Comptabilite",
        rows: accountingRecords.map((record) => ({
          Date: record.date,
          Commande: record.orderId,
          Client: record.customer,
          Vente_GNF: record.saleAmount,
          Revient_GNF: record.costAmount,
          Marge_GNF: record.saleAmount - record.costAmount,
          Encaissement: record.paymentMethod,
          Depot_OM: record.orangeMoneyRef || "",
          Montant_depose_GNF: record.depositAmount || 0,
          Reste_a_deposer_GNF: record.remainingDepositAmount || 0,
        })),
      },
      {
        name: "Clients",
        rows: customerGroups.map((customer) => ({
          Client: customer.name,
          Telephone: customer.phone,
          Commandes: customer.orders.length,
          Commandes_payees: customer.paidOrders,
          Total_GNF: customer.totalSpent,
          Derniere_commande: customer.lastOrderDate,
        })),
      },
      {
        name: "Stock",
        rows: stockMovements.map((movement) => ({
          Date: movement.createdAt,
          Article: movement.productName,
          Variation: movement.delta,
          Stock_avant: movement.stockBefore,
          Stock_apres: movement.stockAfter,
          Raison: movement.reason,
        })),
      },
      {
        name: "Tresorerie",
        rows: treasuryMovements.map((movement) => ({
          Date: movement.date,
          Compte: movement.accountLabel,
          Sens: movement.directionLabel,
          Categorie: movement.category,
          Montant_GNF: movement.direction === "out" ? -movement.amount : movement.amount,
          Libelle: movement.label,
          Note: movement.note,
          Saisi_par: movement.recordedBy,
        })),
      },
    ]);
  }

  async function deleteProductOwnerOnly(product) {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    requestAdminConfirm({
      title: "Retirer cet article ?",
      message: `"${product.name}" sera retiré de la boutique. Cette action est réservée au super admin.`,
      confirmLabel: "Retirer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId(`product:${product.id}`);
        const { error } = await deleteProductAsOwner(product.id);
        setDeletingActionId("");

        if (error) {
          showToast(`Article non retiré : ${getFriendlyErrorMessage(error, "delete")}`, "issue");
          return;
        }

        setSelectedProductIds((current) => current.filter((productId) => productId !== product.id));
        showToast("Article retiré de la vente.");
        await refreshAdminLists({ keepSelected: true });
      },
    });
  }

  async function deleteOrderOwnerOnly(order) {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    requestAdminConfirm({
      title: "Supprimer cette commande ?",
      message: `${order.id} sera supprimée avec ses articles et sa ligne comptable liée.`,
      confirmLabel: "Supprimer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId(`order:${order.rawId}`);
        const { error } = await deleteOrderAsOwner(order.rawId);
        setDeletingActionId("");

        if (error) {
          showToast(`Commande non supprimée : ${getFriendlyErrorMessage(error, "delete")}`, "issue");
          return;
        }

        showToast("Commande supprimée.");
        await refreshAdminLists({ keepSelected: false });
      },
    });
  }

  async function deleteAccountingOwnerOnly(record) {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    requestAdminConfirm({
      title: "Supprimer cette ligne ?",
      message: `${record.orderId} sera retirée de l'historique comptable.`,
      confirmLabel: "Supprimer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId(`accounting:${record.id}`);
        const { error } = await deleteAccountingEntryAsOwner(record.id);
        setDeletingActionId("");

        if (error) {
          showToast(`Ligne non supprimée : ${getFriendlyErrorMessage(error, "delete")}`, "issue");
          return;
        }

        setSelectedAccountingIds((current) => current.filter((recordId) => recordId !== record.id));
        showToast("Ligne comptable supprimée.");
        await refreshAdminLists({ keepSelected: true });
      },
    });
  }

  function toggleOrderSelection(orderId) {
    setSelectedOrderIds((current) =>
      current.includes(orderId)
        ? current.filter((currentId) => currentId !== orderId)
        : [...current, orderId]
    );
  }

  function toggleAllOrdersSelection() {
    setSelectedOrderIds(allOrdersSelected ? [] : visibleAdminOrders.map((order) => order.rawId));
  }

  function toggleProductSelection(productId) {
    setSelectedProductIds((current) =>
      current.includes(productId)
        ? current.filter((currentId) => currentId !== productId)
        : [...current, productId]
    );
  }

  function toggleAllDisplayedProductsSelection() {
    const displayedIds = displayedAdminProducts.map((product) => product.id);

    setSelectedProductIds((current) => {
      if (allDisplayedProductsSelected) {
        return current.filter((productId) => !displayedIds.includes(productId));
      }

      return [...new Set([...current, ...displayedIds])];
    });
  }

  function toggleCustomerSelection(customerKey) {
    setSelectedCustomerKeys((current) =>
      current.includes(customerKey)
        ? current.filter((currentKey) => currentKey !== customerKey)
        : [...current, customerKey]
    );
  }

  function toggleAllCustomersSelection() {
    setSelectedCustomerKeys(allCustomersSelected ? [] : customerGroups.map((customer) => customer.key));
  }

  async function bulkDeleteProducts() {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    if (!selectedProducts.length) {
      showToast("Sélectionne au moins un article.", "issue");
      return;
    }

    requestAdminConfirm({
      title: "Retirer les articles ?",
      message: `${selectedProducts.length} article(s) seront retirés de la boutique.`,
      confirmLabel: "Retirer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId("bulk:products");
        const results = await Promise.all(
          selectedProducts.map((product) => deleteProductAsOwner(product.id))
        );
        setDeletingActionId("");

        const failed = results.filter((result) => result.error);

        if (failed.length) {
          showToast(
            `${failed.length} article(s) non retiré(s) : ${getFriendlyErrorMessage(
              failed[0].error,
              "delete"
            )}`,
            "issue"
          );
          await refreshAdminLists({ keepSelected: true });
          return;
        }

        showToast(`${selectedProducts.length} article(s) retiré(s) de la boutique.`);
        setSelectedProductIds([]);
        await refreshAdminLists({ keepSelected: true });
      },
    });
  }

  async function bulkUpdateOrders(nextStatus) {
    if (!selectedOrders.length) {
      showToast("Selectionne au moins une commande.", "issue");
      return;
    }

    const movableOrders = selectedOrders.filter((order) =>
      canMoveOrderStatus(order, nextStatus, isSuperAdmin)
    );

    if (!movableOrders.length) {
      showToast(getStatusMoveBlockReason(selectedOrders[0], nextStatus, isSuperAdmin), "issue");
      return;
    }

    setUpdatingOrderId("bulk");
    const results = await Promise.all(
      movableOrders.map((order) => updateAdminOrderStatus(order.rawId, nextStatus))
    );
    setUpdatingOrderId("");

    const failed = results.filter((result) => result.error);

    if (failed.length) {
      showToast(`${failed.length} commande(s) non modifiee(s).`, "issue");
    } else {
      const skippedCount = selectedOrders.length - movableOrders.length;
      showToast(
        skippedCount
          ? `${movableOrders.length} commande(s) mise(s) a jour, ${skippedCount} ignoree(s).`
          : `${movableOrders.length} commande(s) mise(s) a jour.`
      );
      setSelectedOrderIds([]);
    }

    await refreshAdminLists({ keepSelected: true });
  }

  async function bulkDeleteOrders() {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    if (!selectedOrders.length) {
      showToast("Selectionne au moins une commande.", "issue");
      return;
    }

    requestAdminConfirm({
      title: "Supprimer les commandes ?",
      message: `${selectedOrders.length} commande(s) sélectionnée(s) seront supprimées avec leurs lignes liées.`,
      confirmLabel: "Supprimer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId("bulk:orders");
        const results = await Promise.all(
          selectedOrders.map((order) => deleteOrderAsOwner(order.rawId))
        );
        setDeletingActionId("");

        const failed = results.filter((result) => result.error);

        if (failed.length) {
          showToast(
            `${failed.length} commande(s) non supprimée(s) : ${getFriendlyErrorMessage(
              failed[0].error,
              "delete"
            )}`,
            "issue"
          );
        } else {
          showToast(`${selectedOrders.length} commande(s) supprimée(s).`);
          setSelectedOrderIds([]);
        }

        await refreshAdminLists({ keepSelected: false });
      },
    });
  }

  function toggleAccountingSelection(recordId) {
    setSelectedAccountingIds((current) =>
      current.includes(recordId)
        ? current.filter((currentId) => currentId !== recordId)
        : [...current, recordId]
    );
  }

  function toggleAllAccountingSelection() {
    const visibleIds = new Set(visibleAccountingRecords.map((record) => record.id));
    setSelectedAccountingIds((current) =>
      allAccountingSelected
        ? current.filter((id) => !visibleIds.has(id))
        : [...new Set([...current, ...visibleIds])]
    );
  }

  async function bulkDeleteAccountingRecords() {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    if (!selectedAccountingRecords.length) {
      showToast("Sélectionne au moins une ligne comptable.", "issue");
      return;
    }

    requestAdminConfirm({
      title: "Supprimer les lignes ?",
      message: `${selectedAccountingRecords.length} ligne(s) comptable(s) seront supprimées.`,
      confirmLabel: "Supprimer",
      tone: "danger",
      onConfirm: async () => {
        setDeletingActionId("bulk:accounting");
        const results = await Promise.all(
          selectedAccountingRecords.map((record) => deleteAccountingEntryAsOwner(record.id))
        );
        setDeletingActionId("");

        const failed = results.filter((result) => result.error);

        if (failed.length) {
          showToast(
            `${failed.length} ligne(s) non supprimée(s) : ${getFriendlyErrorMessage(
              failed[0].error,
              "delete"
            )}`,
            "issue"
          );
          await refreshAdminLists({ keepSelected: true });
          return;
        }

        showToast(`${selectedAccountingRecords.length} ligne(s) supprimée(s).`);
        setSelectedAccountingIds([]);
        await refreshAdminLists({ keepSelected: true });
      },
    });
  }

  function updateLoginForm(field, value) {
    setLoginForm((current) => ({ ...current, [field]: value }));
  }

  function updateAdminAccountForm(field, value) {
    setAdminAccountForm((current) => ({ ...current, [field]: value }));
  }

  async function handleAdminLogin(event) {
    event.preventDefault();

    if (!loginForm.email || !loginForm.password) {
      showToast("Email et mot de passe admin obligatoires.", "issue");
      return;
    }

    const { error } = await signInAdmin(loginForm.email, loginForm.password);

    if (error) {
      showToast(`Connexion admin refusée : ${error.message}`, "issue");
      return;
    }

    setAdminAccessStatus("checking");
    const contextResult = await fetchCurrentAdminContext();

    if (contextResult.error || !contextResult.data?.isInternal) {
      await signOutAdmin();
      setSession(null);
      setAdminContext(null);
      setAdminAccessStatus("idle");
      showToast(
        contextResult.error
          ? `Accès administration refusé : ${contextResult.error.message}`
          : "Ce compte est un compte client. Il ne peut pas ouvrir l'administration BMA.",
        "issue"
      );
      return;
    }

    setAdminContext(contextResult.data);
    setAdminAccessStatus("allowed");

    setLoginForm({ email: "", password: "" });
    setAdminToast(null);
  }

  async function handleAdminSignOut() {
    const { error } = await signOutAdmin();

    if (error) {
      showToast(`Déconnexion impossible : ${error.message}`, "issue");
      return;
    }

    setSession(null);
    setAdminContext(null);
    setAdminAccessStatus("idle");
    setAdminAccountOpen(false);
    showToast("Session admin fermée.", "waiting");
  }

  async function handleAdminAccountSubmit(event) {
    event.preventDefault();

    if (!session) return;

    if (adminAccountForm.newPassword || adminAccountForm.passwordConfirm) {
      if (adminAccountForm.newPassword.length < 6) {
        setAdminAccountMessage({
          tone: "issue",
          text: "Le nouveau mot de passe doit contenir au moins 6 caracteres.",
        });
        return;
      }

      if (adminAccountForm.newPassword !== adminAccountForm.passwordConfirm) {
        setAdminAccountMessage({
          tone: "issue",
          text: "Les deux mots de passe ne correspondent pas.",
        });
        return;
      }
    }

    setAdminAccountMessage({ tone: "waiting", text: "Mise a jour du compte..." });

    const metadataResult = await updateAccountMetadata({
      fullName: adminAccountForm.fullName.trim(),
    });

    if (metadataResult.error) {
      setAdminAccountMessage({
        tone: "issue",
        text: `Compte non modifie : ${metadataResult.error.message}`,
      });
      return;
    }

    if (adminAccountForm.newPassword) {
      const passwordResult = await updateCustomerPassword(adminAccountForm.newPassword);

      if (passwordResult.error) {
        setAdminAccountMessage({
          tone: "issue",
          text: `Nom mis a jour, mais mot de passe non modifie : ${passwordResult.error.message}`,
        });
        return;
      }
    }

    setSession((current) =>
      current && metadataResult.data?.user
        ? { ...current, user: metadataResult.data.user }
        : current
    );
    setAdminAccountForm((current) => ({
      ...current,
      newPassword: "",
      passwordConfirm: "",
    }));
    setAdminAccountMessage({ tone: "paid", text: "Compte admin mis a jour." });
  }

  function updateProductForm(field, value) {
    setProductForm((current) => ({ ...current, [field]: value }));
  }

  function updateProductImages(files) {
    const nextFiles = Array.from(files ?? []);

    if (!nextFiles.length) return;

    setProductForm((current) => ({
      ...current,
      imageFiles: [
        ...current.imagePreviews.map((_, index) => current.imageFiles[index] ?? null),
        ...nextFiles,
      ],
      imagePreviews: [
        ...current.imagePreviews,
        ...nextFiles.map((file) => URL.createObjectURL(file)),
      ],
      imageColors: [...current.imageColors, ...nextFiles.map(() => "")],
    }));
  }

  function updateProductImageColor(index, color) {
    setProductForm((current) => ({
      ...current,
      imageColors: current.imagePreviews.map((_, imageIndex) =>
        imageIndex === index ? color : current.imageColors[imageIndex] || ""
      ),
    }));
  }

  function removeProductImage(index) {
    setProductForm((current) => {
      const removedPreview = current.imagePreviews[index];

      if (removedPreview && String(removedPreview).startsWith("blob:")) {
        URL.revokeObjectURL(removedPreview);
      }

      return {
        ...current,
        imageFiles: current.imageFiles.filter((_, imageIndex) => imageIndex !== index),
        imagePreviews: current.imagePreviews.filter((_, imageIndex) => imageIndex !== index),
        imageColors: current.imageColors.filter((_, imageIndex) => imageIndex !== index),
      };
    });
  }

  function updateAccountingForm(field, value) {
    setAccountingForm((current) => ({ ...current, [field]: value }));
  }

  function updateManualSaleQuantity(value) {
    setAccountingForm((current) => ({ ...current, saleQuantity: value }));
  }

  function getManualVariantLineText({ color, size, quantity }) {
    return `${[color, size].filter(Boolean).join(" / ")} x${Math.max(1, Number(quantity || 1))}`;
  }

  function getManualVariantLines() {
    return String(accountingForm.saleVariantLines || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function updateManualVariantLines(nextLines) {
    const nextText = nextLines.join("\n");
    const nextRows = selectedSaleProduct
      ? parseManualVariantRows(nextText, selectedSaleProduct)
      : [];
    const nextQuantity = nextRows.reduce(
      (sum, row) => sum + Number(row.quantity || 0),
      0
    );

    setAccountingForm((current) => ({
      ...current,
      saleVariantLines: nextText,
      saleQuantity: nextQuantity > 0 ? String(nextQuantity) : current.saleQuantity,
      saleColor: nextQuantity > 0 ? "" : current.saleColor,
      saleSize: nextQuantity > 0 ? "" : current.saleSize,
    }));
  }

  function addManualVariantSelection() {
    if (!selectedSaleProduct) return;

    const color = accountingForm.saleVariantDraftColor.trim();
    const size = accountingForm.saleVariantDraftSize.trim();

    if (selectedSaleColorOptions.length && !color) {
      showToast("Choisis une couleur à ajouter.", "issue");
      return;
    }

    if (selectedSaleDraftSizeOptions.length && !size) {
      showToast("Choisis la taille ou la pointure à ajouter.", "issue");
      return;
    }

    if (manualVariantDraftQuantity > selectedSaleDraftStock) {
      showToast(
        `Stock insuffisant pour ${[color, size].filter(Boolean).join(" / ")} : il reste ${selectedSaleDraftStock} article(s).`,
        "issue"
      );
      return;
    }

    const nextLines = [
      ...getManualVariantLines(),
      getManualVariantLineText({
        color: color || "Option non précisée",
        size,
        quantity: manualVariantDraftQuantity,
      }),
    ];

    updateManualVariantLines(nextLines);
    setAccountingForm((current) => ({
      ...current,
      saleVariantDraftSize: "",
      saleVariantDraftQuantity: "1",
    }));
  }

  function removeManualVariantSelection(index) {
    const nextLines = getManualVariantLines().filter((_, lineIndex) => lineIndex !== index);
    updateManualVariantLines(nextLines);
  }

  function getReservedManualSaleQuantity(productId) {
    return manualSaleItems
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }

  function getReservedManualSaleColorQuantity(productId, color) {
    const colorKey = normalizeVariantKey(color);
    return manualSaleItems
      .filter((item) => item.productId === productId)
      .flatMap((item) => item.colorDeltas ?? [])
      .filter((delta) => normalizeVariantKey(delta.color) === colorKey)
      .reduce((sum, delta) => sum + Number(delta.quantity || 0), 0);
  }

  function getReservedManualSaleVariantQuantity(productId, color, size) {
    const colorKey = normalizeVariantKey(color);
    const sizeKey = normalizeVariantKey(size);
    return manualSaleItems
      .filter((item) => item.productId === productId)
      .flatMap((item) => item.variantDeltas ?? [])
      .filter(
        (delta) =>
          normalizeVariantKey(delta.color) === colorKey &&
          normalizeVariantKey(delta.size) === sizeKey
      )
      .reduce((sum, delta) => sum + Number(delta.quantity || 0), 0);
  }

  function resetManualSaleDraft() {
    setAccountingForm((current) => ({
      ...current,
      saleProductId: "",
      saleQuantity: "1",
      saleColor: "",
      saleSize: "",
      saleVariantLines: "",
      saleVariantDraftColor: "",
      saleVariantDraftSize: "",
      saleVariantDraftQuantity: "1",
      saleAmount: "",
      purchaseAmount: "",
      extraCost: "",
    }));
  }

  function buildManualSaleDraftItem() {
    if (!selectedSaleProduct) {
      showToast("Choisis un article avant de l'ajouter à la vente.", "issue");
      return null;
    }

    const quantity = Math.max(1, saleQuantity);
    const alreadyReserved = getReservedManualSaleQuantity(selectedSaleProduct.id);
    const availableStock = Math.max(0, Number(selectedSaleProduct.stock || 0) - alreadyReserved);

    if (quantity > availableStock) {
      showToast(
        `Stock insuffisant : il reste ${availableStock} article(s) disponibles pour cette vente.`,
        "issue"
      );
      return null;
    }

    const colorDeltas = getManualSaleColorDeltas(selectedSaleProduct, accountingForm, quantity);
    const variantDeltas = getManualSaleVariantDeltas(selectedSaleProduct, accountingForm, quantity);
    const hasDetailedVariants = Boolean(accountingForm.saleVariantLines.trim());

    if (hasDetailedVariants) {
      const incompleteVariant = manualVariantRows.find((row) => {
        if (selectedSaleColorOptions.length && !row.color) return true;
        return getProductSizeOptions(selectedSaleProduct, row.color).length > 0 && !row.size;
      });

      if (incompleteVariant) {
        showToast(
          "Précise la couleur et la taille de chaque article avant de l'ajouter.",
          "issue"
        );
        return null;
      }
    } else {
      if (selectedSaleColorOptions.length && !accountingForm.saleColor) {
        showToast("Choisis la couleur de l'article avant de l'ajouter.", "issue");
        return null;
      }

      const requiredSizes = getProductSizeOptions(
        selectedSaleProduct,
        accountingForm.saleColor
      );

      if (requiredSizes.length && !accountingForm.saleSize) {
        showToast("Choisis la taille ou la pointure avant d'ajouter l'article.", "issue");
        return null;
      }
    }

    if (accountingForm.saleVariantLines.trim() && manualVariantQuantity !== quantity) {
      showToast(
        `Le détail couleurs/tailles indique ${manualVariantQuantity} article(s), mais la quantité est ${quantity}.`,
        "issue"
      );
      return null;
    }

    for (const colorDelta of colorDeltas) {
      const reservedColor = getReservedManualSaleColorQuantity(
        selectedSaleProduct.id,
        colorDelta.color
      );
      const colorStock = Math.max(
        0,
        getProductStockForColor(selectedSaleProduct, colorDelta.color) - reservedColor
      );

      if (colorDelta.quantity > colorStock) {
        showToast(
          `Stock insuffisant pour ${colorDelta.color} : il reste ${colorStock} article(s) disponibles dans cette vente.`,
          "issue"
        );
        return null;
      }
    }

    for (const variantDelta of variantDeltas) {
      const reservedVariant = getReservedManualSaleVariantQuantity(
        selectedSaleProduct.id,
        variantDelta.color,
        variantDelta.size
      );
      const variantStock = Math.max(
        0,
        getProductStockForSelection(selectedSaleProduct, variantDelta.color, variantDelta.size) -
          reservedVariant
      );

      if (variantDelta.quantity > variantStock) {
        showToast(
          `Stock insuffisant pour ${variantDelta.color} / ${variantDelta.size} : il reste ${variantStock} article(s) disponibles dans cette vente.`,
          "issue"
        );
        return null;
      }
    }

    const optionParts = [
      accountingForm.saleVariantLines.trim()
        ? accountingForm.saleVariantLines.trim().replace(/\n/g, " ; ")
        : "",
      !accountingForm.saleVariantLines.trim() && accountingForm.saleColor
        ? `Couleur ${accountingForm.saleColor}`
        : "",
      !accountingForm.saleVariantLines.trim() && accountingForm.saleSize
        ? `Taille ${accountingForm.saleSize}`
        : "",
    ].filter(Boolean);

    return {
      id: `sale-item-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      productId: selectedSaleProduct.id,
      productName: selectedSaleProduct.name,
      image: selectedSaleProduct.image,
      quantity,
      unitPrice: getProductPrice(selectedSaleProduct),
      unitPurchasePrice: getPurchasePrice(selectedSaleProduct),
      unitCostPrice: getCostPrice(selectedSaleProduct),
      saleAmount: getProductPrice(selectedSaleProduct) * quantity,
      purchaseAmount: getPurchasePrice(selectedSaleProduct) * quantity,
      costAmount: getCostPrice(selectedSaleProduct) * quantity,
      color: accountingForm.saleColor,
      size: accountingForm.saleSize,
      variantLines: accountingForm.saleVariantLines.trim(),
      colorDeltas,
      variantDeltas,
      optionSummary: optionParts.join(" - "),
      stockBefore: Number(selectedSaleProduct.stock || 0),
    };
  }

  function addManualSaleItem() {
    const item = buildManualSaleDraftItem();
    if (!item) return;

    setManualSaleItems((current) => [...current, item]);
    resetManualSaleDraft();
  }

  function removeManualSaleItem(itemId) {
    setManualSaleItems((current) => current.filter((item) => item.id !== itemId));
  }

  function selectManualSaleProduct(productId) {
    setAccountingForm((current) => ({
      ...current,
      saleProductId: productId,
      saleColor: "",
      saleSize: "",
      saleVariantLines: "",
      saleVariantDraftColor: "",
      saleVariantDraftSize: "",
      saleVariantDraftQuantity: "1",
      saleAmount: productId ? "" : current.saleAmount,
    }));
  }

  function resetProductForm() {
    setEditingProductId(null);
    setProductForm({
      name: "",
      category: "",
      description: "",
      sizes: "",
      sizesByColor: "",
      stockByColor: "",
      stockDetails: "",
      colors: "",
      price: "",
      purchasePrice: "",
      extraCost: "",
      stock: "",
      imageFiles: [],
      imagePreviews: [],
      imageColors: [],
    });
  }

  function openProductCreator() {
    resetProductForm();
    setProductEditorOpen(true);
  }

  function closeProductEditor() {
    resetProductForm();
    setProductEditorOpen(false);
  }

  function openProductStockDetails(product) {
    setStockDetailProductId(product.id);
  }

  function closeProductStockDetails() {
    setStockDetailProductId("");
  }

  function openManualSalePanel() {
    setManualSaleOpen(true);
  }

  function closeManualSalePanel() {
    setManualSaleOpen(false);
    setManualSaleItems([]);
    resetManualSaleDraft();
  }

  function openDepositPanel(recordId = "") {
    setDepositMessage(null);
    setSelectedAccountingDetailId("");
    setDepositForm((current) => ({
      ...current,
      recordId: recordId || current.recordId,
      amount: "",
    }));
    setDepositPanelOpen(true);
  }

  function closeDepositPanel() {
    setDepositMessage(null);
    setDepositPanelOpen(false);
  }

  function openTreasuryPanel() {
    setTreasuryForm({
      ...emptyTreasuryForm,
      date: getTodayDateInput(),
    });
    setTreasuryPanelOpen(true);
  }

  function closeTreasuryPanel() {
    setTreasuryPanelOpen(false);
    setTreasuryForm({
      ...emptyTreasuryForm,
      date: getTodayDateInput(),
    });
  }

  function updateTreasuryForm(field, value) {
    setTreasuryForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function startProductEdit(product) {
    const imageEntries = getProductImageEntries(product);
    setEditingProductId(product.id);
    setProductForm({
      name: product.name || "",
      category: product.category || "",
      description: product.description || "",
      sizes: (product.globalSizes ?? product.sizes ?? []).join(", "),
      sizesByColor: formatSizesByColorText(product.sizesByColor ?? {}, product.colors ?? []),
      stockByColor: formatStockByColorText(product.stockByColor ?? {}, product.colors ?? []),
      stockDetails: formatStockDetailText(
        product.stockByVariant ?? {},
        product.sizesByColor ?? {},
        product.colors ?? []
      ),
      colors: formatColorText(product.colors ?? []),
      price: String(getProductPrice(product) || ""),
      purchasePrice: String(getPurchasePrice(product) || ""),
      extraCost: String(Math.max(0, getCostPrice(product) - getPurchasePrice(product)) || ""),
      stock: String(product.stock ?? ""),
      imageFiles: imageEntries.map(() => null),
      imagePreviews: imageEntries.map((entry) => entry.imageUrl),
      imageColors: imageEntries.map((entry) => entry.color || ""),
    });
    setProductEditorOpen(true);
  }

  async function addLocalProduct(event) {
    event.preventDefault();

    if (!session) {
      showToast("Connecte-toi en admin avant d'ajouter un article.", "issue");
      return;
    }

    if (!productForm.name.trim()) {
      showToast("Le nom de l'article est obligatoire.", "issue");
      return;
    }

    const salePriceResult = parseGnfInput(productForm.price, "Prix de vente", {
      required: true,
      allowZero: false,
    });

    if (salePriceResult.error) {
      showToast(salePriceResult.error, "issue");
      return;
    }

    const purchasePriceResult = parseGnfInput(productForm.purchasePrice, "Prix d'achat", {
      required: true,
    });

    if (purchasePriceResult.error) {
      showToast(purchasePriceResult.error, "issue");
      return;
    }

    const extraCostResult = parseGnfInput(productForm.extraCost, "Frais annexes", {
      fallback: 0,
    });

    if (extraCostResult.error) {
      showToast(extraCostResult.error, "issue");
      return;
    }

    const costPrice = purchasePriceResult.value + extraCostResult.value;
    const sizes = splitOptionText(productForm.sizes);
    const declaredSizesByColor = parseSizesByColorText(productForm.sizesByColor);
    const exactStock = parseStockDetailText(productForm.stockDetails, declaredSizesByColor, sizes);
    const sizesByColor = mergeSizesByColor(declaredSizesByColor, exactStock.sizesByColor);
    const allSizes = uniqueOptionValues([
      ...sizes,
      ...Object.values(sizesByColor).flat(),
    ]);
    const colors = parseColorText(productForm.colors);
    const stockByColor = {
      ...parseStockByColorText(productForm.stockByColor),
      ...exactStock.stockByColor,
    };

    const stockResult = parseGnfInput(productForm.stock, "Stock", {
      required: true,
      fallback: 0,
    });

    if (stockResult.error) {
      showToast(stockResult.error, "issue");
      return;
    }

    const existingProduct = adminProducts.find((product) => product.id === editingProductId);
    const finalImageUrls = [];

    for (const [index, imagePreview] of productForm.imagePreviews.entries()) {
      if (!imagePreview) continue;

      if (!String(imagePreview).startsWith("blob:")) {
        finalImageUrls.push(imagePreview);
        continue;
      }

      const imageFile = productForm.imageFiles[index];

      if (!imageFile) continue;

      const uploadResult = await uploadProductImage(imageFile);

      if (uploadResult.error) {
        showToast(
          `Photo non ajoutée : ${uploadResult.error.message}. Vérifie le bucket product-images.`,
          "issue"
        );
        return;
      }

      if (uploadResult.data) finalImageUrls.push(uploadResult.data);
    }

    const imageEntries = sortImageEntriesForCover(
      finalImageUrls.map((imageUrl, index) => ({
        imageUrl,
        color: productForm.imageColors[index] || "",
      }))
    );
    const imagesByColor = buildImagesByColor(imageEntries);
    const coverImage =
      imageEntries.find((entry) => !String(entry.color || "").trim())?.imageUrl ||
      imageEntries[0]?.imageUrl ||
      existingProduct?.image ||
      "";

    const productPayload = {
      name: productForm.name.trim(),
      category: productForm.category.trim(),
      description: productForm.description.trim(),
      price: salePriceResult.value,
      promoPrice: null,
      purchasePrice: purchasePriceResult.value,
      costPrice,
      stock: stockResult.value,
      image: coverImage,
      sizes: allSizes,
      globalSizes: sizes,
      sizesByColor,
      stockByColor,
      stockByVariant: exactStock.stockByVariant,
      colors,
      imageEntries,
      imagesByColor,
    };

    const productResult = editingProductId
      ? await updateProduct(editingProductId, productPayload)
      : await createProduct(productPayload);
    const { data, error } = productResult;

    if (error) {
      showToast(
        `Article non enregistré : ${error.message}. Vérifie les colonnes et les droits admin.`,
        "issue"
      );
      return;
    }

    const optionsResult = await replaceProductOptions(data.id, {
      sizes,
      colors,
      sizesByColor,
      stockByColor,
      stockByVariant: exactStock.stockByVariant,
    });

    if (optionsResult.error) {
      showToast(
        `Article enregistré, mais options non enregistrées : ${optionsResult.error.message}`,
        "waiting"
      );
      return;
    }

    const galleryResult = imageEntries.length || editingProductId
      ? await replaceProductImages(data.id, imageEntries)
      : { error: null };

    if (galleryResult.error) {
      showToast(
        `Article enregistré, mais galerie incomplète : ${galleryResult.error.message}`,
        "waiting"
      );
    }

    const savedProduct = {
      ...data,
      images: imageEntries.length
        ? imageEntries.map((entry) => entry.imageUrl)
        : existingProduct?.images ?? data.images,
      imageEntries: imageEntries.length
        ? imageEntries
        : existingProduct?.imageEntries ?? data.imageEntries,
      imagesByColor: imageEntries.length
        ? imagesByColor
        : existingProduct?.imagesByColor ?? data.imagesByColor,
      purchasePrice: purchasePriceResult.value,
      costPrice,
      globalSizes: sizes,
      sizes: allSizes,
      sizesByColor,
      stockByColor,
      stockByVariant: exactStock.stockByVariant,
      colors,
      stock: stockResult.value,
    };

    setAdminProducts((current) =>
      editingProductId
        ? current.map((product) => (product.id === editingProductId ? savedProduct : product))
        : [savedProduct, ...current]
    );
    resetProductForm();
    setProductEditorOpen(false);
    if (!galleryResult.error) {
      showToast(editingProductId ? "Article modifié." : "Article ajouté.");
    }
  }

  async function adjustStock(productId, quantityChange) {
    const currentProduct = adminProducts.find((product) => product.id === productId);
    if (!currentProduct) return;

    const nextStock = Math.max(0, Number(currentProduct.stock || 0) + quantityChange);
    const { error } = await adjustProductStock({
      productId,
      quantityDelta: nextStock - Number(currentProduct.stock || 0),
      reason: quantityChange > 0 ? "restock" : "admin_adjustment",
      referenceType: "admin_products",
      referenceId: productId,
      note: `Ajustement par ${adminDisplayName}`,
    });

    if (error) {
      showToast(`Stock non enregistré : ${error.message}`, "issue");
      return;
    }

    setAdminProducts((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, stock: nextStock } : product
      )
    );
    setStockMovements((current) => [
      {
        id: `local-${Date.now()}`,
        productId,
        productName: currentProduct.name,
        image: currentProduct.image,
        delta: nextStock - Number(currentProduct.stock || 0),
        stockBefore: Number(currentProduct.stock || 0),
        stockAfter: nextStock,
        reason: quantityChange > 0 ? "restock" : "admin_adjustment",
        actor: adminDisplayName,
        createdDate: getTodayDateInput(),
      },
      ...current,
    ]);
    showToast("Stock enregistré.");
  }

  async function saveProductStockDistribution(product, { stockByColor, stockByVariant }) {
    const optionsResult = await replaceProductOptions(product.id, {
      sizes: product.globalSizes ?? [],
      colors: product.colors ?? [],
      sizesByColor: product.sizesByColor ?? {},
      stockByColor,
      stockByVariant,
    });

    if (optionsResult.error) {
      showToast(
        `Répartition non enregistrée : ${getFriendlyErrorMessage(optionsResult.error, "stock")}`,
        "issue"
      );
      return false;
    }

    setAdminProducts((current) =>
      current.map((currentProduct) =>
        currentProduct.id === product.id
          ? { ...currentProduct, stockByColor, stockByVariant }
          : currentProduct
      )
    );
    showToast("Répartition du stock enregistrée.");
    return true;
  }

  async function updateOrderStatus(orderOrId, nextStatus) {
    const targetOrder =
      typeof orderOrId === "string"
        ? adminOrders.find((order) => order.id === orderOrId || order.rawId === orderOrId)
        : orderOrId;

    if (!targetOrder?.rawId) {
      showToast("Commande introuvable.", "issue");
      return;
    }

    if (!canMoveOrderStatus(targetOrder, nextStatus, isSuperAdmin)) {
      showToast(getStatusMoveBlockReason(targetOrder, nextStatus, isSuperAdmin), "issue");
      return;
    }

    setUpdatingOrderId(targetOrder.id);

    const { data, error } = await updateAdminOrderStatus(targetOrder.rawId, nextStatus);

    setUpdatingOrderId("");

    if (error) {
      showToast(`Statut non enregistré : ${error.message}`, "issue");
      return;
    }

    const patch = {
      rawStatus: data.rawStatus,
      status: data.status,
      statusTone: data.statusTone,
      paymentTone: data.paymentTone,
      tone: data.statusTone,
    };

    setAdminOrders((current) =>
      current.map((order) =>
        order.id === targetOrder.id ? { ...order, ...patch } : order
      )
    );
    setSelectedOrder((current) =>
      current?.id === targetOrder.id ? { ...current, ...patch } : current
    );
    showToast(`Commande ${targetOrder.id} : ${data.status}.`);
  }

  async function addAccountingRecord(event) {
    event.preventDefault();

    if (!accountingForm.customer.trim()) {
      showToast("Le nom du client est obligatoire.", "issue");
      return;
    }

    if (!accountingForm.date) {
      showToast("La date est obligatoire.", "issue");
      return;
    }

    if (hasManualSaleItems && selectedSaleProduct) {
      showToast(
        "Ajoute l'article sélectionné à la vente avant de l'enregistrer.",
        "issue"
      );
      return;
    }

    const saleItems = hasManualSaleItems
      ? manualSaleItems
      : selectedSaleProduct
        ? [buildManualSaleDraftItem()].filter(Boolean)
        : [];
    const hasCatalogSale = saleItems.length > 0;

    if (!hasCatalogSale && !accountingForm.saleAmount) {
      showToast("Choisis un article ou saisis un montant manuel.", "issue");
      return;
    }

    if (selectedSaleProduct && !hasManualSaleItems && !hasCatalogSale) return;

    const saleItemsQuantity = saleItems.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
    const saleItemsBaseAmount = saleItems.reduce(
      (sum, item) => sum + Number(item.saleAmount || 0),
      0
    );
    const saleItemsPurchaseAmount = saleItems.reduce(
      (sum, item) => sum + Number(item.purchaseAmount || 0),
      0
    );
    const saleItemsCostAmount = saleItems.reduce(
      (sum, item) => sum + Number(item.costAmount || 0),
      0
    );
    const saleItemsExtraCostAmount = Math.max(0, saleItemsCostAmount - saleItemsPurchaseAmount);

    const saleAmountResult = hasCatalogSale
      ? { value: saleItemsBaseAmount }
      : parseGnfInput(accountingForm.saleAmount, "Prix de vente", {
          required: true,
          allowZero: false,
        });
    const purchaseAmountResult = hasCatalogSale
      ? { value: saleItemsPurchaseAmount }
      : parseGnfInput(accountingForm.purchaseAmount, "Prix d'achat", { fallback: 0 });
    const extraCostResult = hasCatalogSale
      ? { value: saleItemsExtraCostAmount }
      : parseGnfInput(accountingForm.extraCost, "Frais annexes", {
          fallback: 0,
        });
    const adjustmentAmountResult = parseGnfInput(
      accountingForm.discountAmount,
      "Surplus / remise",
      {
        fallback: 0,
        allowNegative: true,
      }
    );

    const validationError =
      saleAmountResult.error ||
      purchaseAmountResult.error ||
      extraCostResult.error ||
      adjustmentAmountResult.error;

    if (validationError) {
      showToast(validationError, "issue");
      return;
    }

    const finalSaleAmount = saleAmountResult.value + adjustmentAmountResult.value;
    if (finalSaleAmount <= 0) {
      showToast("Le total encaissé doit rester supérieur à 0.", "issue");
      return;
    }

    const costAmount = purchaseAmountResult.value + extraCostResult.value;

    const generatedSaleReference = `MANUEL-${Date.now().toString(36).toUpperCase()}`;
    const saleItemNotes = saleItems.map((item) => {
      const optionText = item.variantLines
        ? ` (${item.variantLines.replace(/\n/g, " ; ")})`
        : item.optionSummary
          ? ` (${item.optionSummary})`
          : "";

      return `- ${item.productName} x${item.quantity}${optionText} = ${formatMoney(item.saleAmount)}`;
    });
    const singleItem = saleItems.length === 1 ? saleItems[0] : null;
    const saleNotes = [
      accountingForm.note?.trim(),
      saleItems.length > 1
        ? `Articles :\n${saleItemNotes.join("\n")}`
        : singleItem
          ? `Article : ${singleItem.productName}`
          : "Vente libre",
      saleItems.length > 1 ? `Quantité totale : ${saleItemsQuantity}` : `Quantité : ${saleItemsQuantity || saleQuantity}`,
      singleItem?.color ? `Couleur : ${singleItem.color}` : "",
      singleItem?.size ? `Taille : ${singleItem.size}` : "",
      singleItem?.variantLines ? `Détail couleurs/tailles :\n${singleItem.variantLines}` : "",
      adjustmentAmountResult.value > 0
        ? `Surplus : ${formatMoney(adjustmentAmountResult.value)}`
        : "",
      adjustmentAmountResult.value < 0
        ? `Remise : ${formatMoney(Math.abs(adjustmentAmountResult.value))}`
        : "",
    ].filter(Boolean);

    const record = {
      orderId: accountingForm.orderId || generatedSaleReference,
      productId: saleItems.length === 1 ? singleItem.productId : "",
      quantity: saleItemsQuantity || saleQuantity,
      date: accountingForm.date,
      customer:
        accountingForm.customer.trim(),
      saleAmount: finalSaleAmount,
      purchaseAmount: purchaseAmountResult.value,
      extraCost: extraCostResult.value,
      costAmount,
      paymentMethod: accountingForm.paymentMethod,
      collectedBy: adminDisplayName,
      depositedBy: "",
      orangeMoneyRef: "",
      receiptName: "",
      depositedAt: "",
      note: saleNotes.join("\n"),
    };

    const { data, error } = await createAccountingEntry(record);

    if (error && !data) {
      showToast(
        `Ligne comptable non enregistrée : ${getFriendlyErrorMessage(error, "accounting_entry")}`,
        "issue"
      );
      return;
    }

    setAccountingRecords((current) => (data ? [data, ...current] : current));
    const productDeltas = new Map();
    const colorDeltasByProduct = new Map();
    const variantDeltasByProduct = new Map();

    saleItems.forEach((item) => {
      const currentProductDelta = productDeltas.get(item.productId) || {
        productId: item.productId,
        productName: item.productName,
        image: item.image,
        quantity: 0,
        stockBefore: item.stockBefore,
      };
      currentProductDelta.quantity += Number(item.quantity || 0);
      productDeltas.set(item.productId, currentProductDelta);

      item.colorDeltas.forEach((delta) => {
        const grouped = colorDeltasByProduct.get(item.productId) || new Map();
        const key = normalizeVariantKey(delta.color);
        const currentDelta = grouped.get(key) || { color: delta.color, quantity: 0 };
        currentDelta.quantity += Number(delta.quantity || 0);
        grouped.set(key, currentDelta);
        colorDeltasByProduct.set(item.productId, grouped);
      });

      item.variantDeltas.forEach((delta) => {
        const grouped = variantDeltasByProduct.get(item.productId) || new Map();
        const key = `${normalizeVariantKey(delta.color)}|${normalizeVariantKey(delta.size)}`;
        const currentDelta = grouped.get(key) || {
          color: delta.color,
          size: delta.size,
          quantity: 0,
        };
        currentDelta.quantity += Number(delta.quantity || 0);
        grouped.set(key, currentDelta);
        variantDeltasByProduct.set(item.productId, grouped);
      });
    });

    let baseStockError = null;
    let colorStockError = null;
    let variantStockError = null;

    if (saleItems.length > 1 && !error) {
      for (const productDelta of productDeltas.values()) {
        const stockResult = await adjustProductStock({
          productId: productDelta.productId,
          quantityDelta: -productDelta.quantity,
          reason: "manual_sale",
          referenceType: "accounting_entry",
          referenceId: data?.id || record.orderId,
          note: record.note,
        });

        if (stockResult.error) {
          baseStockError = stockResult.error;
          break;
        }
      }
    }

    if (saleItems.length && !error && !baseStockError) {
      for (const [productId, groupedDeltas] of colorDeltasByProduct.entries()) {
        for (const colorDelta of groupedDeltas.values()) {
        const colorResult = await adjustProductColorStock({
          productId,
          color: colorDelta.color,
          quantityDelta: -colorDelta.quantity,
          reason: "manual_sale",
          referenceType: "accounting_entry",
          referenceId: data?.id || record.orderId,
          note: record.note,
        });

        if (colorResult.error) {
          colorStockError = colorResult.error;
          break;
        }
      }
        if (colorStockError) break;
    }

      for (const [productId, groupedDeltas] of variantDeltasByProduct.entries()) {
        for (const variantDelta of groupedDeltas.values()) {
        const variantResult = await adjustProductVariantStock({
          productId,
          color: variantDelta.color,
          size: variantDelta.size,
          quantityDelta: -variantDelta.quantity,
        });

        if (variantResult.error) {
          variantStockError = variantResult.error;
          break;
        }
      }
        if (variantStockError) break;
    }
    }

    if (saleItems.length && !error && !baseStockError) {
      setAdminProducts((current) =>
        current.map((product) => {
          const productDelta = productDeltas.get(product.id);
          if (!productDelta) return product;

          const nextProduct = {
            ...product,
            stock: Math.max(0, Number(product.stock || 0) - productDelta.quantity),
          };

          const colorDeltas = [...(colorDeltasByProduct.get(product.id)?.values() ?? [])];
          if (!colorStockError && colorDeltas.length) {
            nextProduct.stockByColor = { ...(product.stockByColor ?? {}) };
            colorDeltas.forEach((colorDelta) => {
              const key = normalizeVariantKey(colorDelta.color);
              if (!(key in nextProduct.stockByColor)) return;

              nextProduct.stockByColor[key] = Math.max(
                0,
                getProductStockForColor(nextProduct, colorDelta.color) - colorDelta.quantity
              );
            });
          }

          const variantDeltas = [...(variantDeltasByProduct.get(product.id)?.values() ?? [])];
          if (!variantStockError && variantDeltas.length) {
            nextProduct.stockByVariant = { ...(product.stockByVariant ?? {}) };
            variantDeltas.forEach((variantDelta) => {
              const colorKey = normalizeVariantKey(variantDelta.color);
              const sizeKey = normalizeVariantKey(variantDelta.size);
              if (!(colorKey in nextProduct.stockByVariant)) return;
              if (!(sizeKey in (nextProduct.stockByVariant[colorKey] ?? {}))) return;

              nextProduct.stockByVariant[colorKey] = {
                ...nextProduct.stockByVariant[colorKey],
                [sizeKey]: Math.max(
                  0,
                  getProductStockForSelection(nextProduct, variantDelta.color, variantDelta.size) -
                    variantDelta.quantity
                ),
              };
            });
          }

          return nextProduct;
        })
      );
      const nextMovements = [...productDeltas.values()].map((productDelta, index) => ({
          id: `local-${Date.now()}-${index}`,
          productId: productDelta.productId,
          productName: productDelta.productName,
          image: productDelta.image,
          delta: -productDelta.quantity,
          stockBefore: Number(productDelta.stockBefore || 0),
          stockAfter: Math.max(0, Number(productDelta.stockBefore || 0) - productDelta.quantity),
          reason: "manual_sale",
          referenceId: data?.id || record.orderId,
          actor: adminDisplayName,
          createdDate: accountingForm.date,
        }));
      setStockMovements((current) => [...nextMovements, ...current]);
    }
    setDepositForm((current) => ({ ...current, recordId: data?.id || current.recordId }));
    setAccountingForm({
      orderId: "",
      saleProductId: "",
      saleQuantity: "1",
      saleColor: "",
      saleSize: "",
      saleVariantLines: "",
      saleVariantDraftColor: "",
      saleVariantDraftSize: "",
      saleVariantDraftQuantity: "1",
      date: getTodayDateInput(),
      customer: "",
      saleAmount: "",
      purchaseAmount: "",
      extraCost: "",
      discountAmount: "",
      note: "",
      paymentMethod: "Liquide",
    });
    setManualSaleItems([]);
    setManualSaleOpen(false);
    showToast(
      error
        ? `Vente enregistrée, mais stock à vérifier : ${getFriendlyErrorMessage(error, "stock")}`
        : baseStockError
          ? `Vente enregistrée. Stock article à vérifier : ${getFriendlyErrorMessage(baseStockError, "stock")}`
        : variantStockError
          ? `Vente enregistrée. Stock détaillé à vérifier : ${getFriendlyErrorMessage(variantStockError, "stock")}`
        : colorStockError
          ? `Vente enregistrée. Stock couleur à vérifier : ${getFriendlyErrorMessage(colorStockError, "stock")}`
          : "Vente enregistrée et stock mis à jour.",
      error || baseStockError || colorStockError || variantStockError ? "waiting" : "paid"
    );
  }

  async function saveOrangeMoneyDeposit(event) {
    event.preventDefault();
    if (isDepositSubmitting) return;

    if (!selectedDepositRecordId) {
      const message = "Choisis une ligne à compléter.";
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    const selectedRecord = selectedDepositRecord;

    if (!selectedRecord) {
      const message = "Ligne comptable introuvable.";
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    if (!selectedDepositIsDirectOrangeMoney && !depositForm.orangeMoneyRef) {
      const message = "Indique la référence Orange Money du dépôt.";
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    if (selectedDepositIsDirectOrangeMoney && !depositForm.receiptFile) {
      const message = "Ajoute le reçu Orange Money avant d'enregistrer.";
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    if (!["Liquide", "Orange Money"].includes(selectedRecord.paymentMethod)) {
      const message = "Cette ligne ne peut pas recevoir de dépôt Orange Money.";
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    const depositAmountResult = selectedDepositIsDirectOrangeMoney
      ? { value: Number(selectedRecord.saleAmount || 0) }
      : parseGnfInput(depositForm.amount, "Montant verse", {
          required: true,
          allowZero: false,
        });

    if (depositAmountResult.error) {
      setDepositMessage({ tone: "issue", text: depositAmountResult.error });
      showToast(depositAmountResult.error, "issue");
      return;
    }

    if (!selectedDepositIsDirectOrangeMoney && depositAmountResult.value > selectedDepositRemainingAmount) {
      const message = `Montant trop eleve : il reste seulement ${formatMoney(
        selectedDepositRemainingAmount
      )} a deposer pour cette vente.`;
      setDepositMessage({ tone: "issue", text: message });
      showToast(message, "issue");
      return;
    }

    setIsDepositSubmitting(true);
    setDepositMessage({
      tone: "waiting",
      text: selectedDepositIsDirectOrangeMoney
        ? "Enregistrement du reçu Orange Money..."
        : "Enregistrement du dépôt...",
    });

    try {
      const receiptUpload = await uploadOrangeMoneyReceipt(depositForm.receiptFile);
      const receiptUploadFailed = Boolean(receiptUpload.error);

      if (selectedDepositIsDirectOrangeMoney && receiptUploadFailed) {
        const message = getFriendlyErrorMessage(receiptUpload.error, "receipt_upload");
        setDepositMessage({ tone: "issue", text: message });
        showToast(message, "issue");
        return;
      }

      const { data, error } = await createOrangeMoneyDeposit({
        record: selectedRecord,
        reference: depositForm.orangeMoneyRef || `OM-${selectedRecord.orderId}-${Date.now()}`,
        amount: depositAmountResult.value,
        receiptName: receiptUpload.data?.name || depositForm.receiptName,
        receiptPath: receiptUpload.data?.path || "",
        depositedBy: adminDisplayName,
      });

      if (error) {
        const message = `Dépôt non enregistré : ${getFriendlyErrorMessage(
          error,
          "orange_money_deposit"
        )}`;
        setDepositMessage({ tone: "issue", text: message });
        showToast(message, "issue");
        return;
      }

      setAccountingRecords((current) =>
        current.map((record) =>
          record.id === selectedDepositRecordId
            ? (() => {
                const nextDepositAmount =
                  record.paymentMethod === "Orange Money"
                    ? Number(record.saleAmount || 0)
                    : Math.min(
                        Number(record.saleAmount || 0),
                        Number(record.depositAmount || 0) + Number(data.depositAmount || 0)
                      );
                const nextRemainingAmount = Math.max(
                  0,
                  Number(record.saleAmount || 0) - nextDepositAmount
                );
                const nextDepositHistory = [
                  ...(record.depositHistory ?? []),
                  {
                    amount: Number(data.depositAmount || 0),
                    orangeMoneyRef: data.orangeMoneyRef,
                    depositedBy: data.depositedBy,
                    receiptName: data.receiptName,
                    receiptPath: data.receiptPath,
                    receiptUrl: data.receiptUrl,
                    depositedAt: data.depositedAt,
                  },
                ];

                return {
                  ...record,
                  depositedBy: data.depositedBy,
                  orangeMoneyRef: data.orangeMoneyRef,
                  receiptName: data.receiptName,
                  receiptPath: data.receiptPath,
                  receiptUrl: data.receiptUrl,
                  depositedAt: data.depositedAt,
                  depositAmount: nextDepositAmount,
                  remainingDepositAmount: nextRemainingAmount,
                  depositHistory: nextDepositHistory,
                  depositCount: nextDepositHistory.length,
                };
              })()
            : record
        )
      );
      const remainingAfterDeposit = Math.max(
        0,
        selectedDepositIsDirectOrangeMoney
          ? 0
          : selectedDepositRemainingAmount - depositAmountResult.value
      );
      setDepositForm({
        recordId: remainingAfterDeposit > 0 ? selectedDepositRecordId : "",
        amount: "",
        orangeMoneyRef: "",
        receiptName: "",
        receiptFile: null,
      });

      const successMessage = receiptUploadFailed
        ? `${selectedDepositIsDirectOrangeMoney ? "Justificatif enregistré" : "Dépôt enregistré"}. ${getFriendlyErrorMessage(receiptUpload.error, "receipt_upload")}`
        : selectedDepositIsDirectOrangeMoney
          ? "Reçu Orange Money enregistré."
          : remainingAfterDeposit > 0
            ? `Dépôt partiel enregistré. Reste ${formatMoney(remainingAfterDeposit)}.`
            : "Dépôt Orange Money enregistré avec reçu.";
      setDepositMessage({
        tone: receiptUploadFailed ? "waiting" : "paid",
        text: successMessage,
      });
      if (!receiptUploadFailed && remainingAfterDeposit <= 0) {
        setDepositPanelOpen(false);
      }
      showToast(successMessage, receiptUploadFailed ? "waiting" : "paid");
    } finally {
      setIsDepositSubmitting(false);
    }
  }

  async function saveTreasuryMovement(event) {
    event.preventDefault();
    if (isTreasurySubmitting) return;

    const amountResult = parseGnfInput(treasuryForm.amount, "Montant", {
      required: true,
      allowZero: false,
    });

    if (amountResult.error) {
      showToast(amountResult.error, "issue");
      return;
    }

    if (!treasuryForm.label.trim()) {
      showToast("Indique clairement pourquoi l'argent entre ou sort.", "issue");
      return;
    }

    setIsTreasurySubmitting(true);
    try {
      const { data, error } = await createTreasuryMovement({
        ...treasuryForm,
        amount: amountResult.value,
        recordedBy: adminDisplayName,
      });

      if (error) {
        showToast(`Mouvement non enregistré : ${getFriendlyErrorMessage(error, "treasury")}`, "issue");
        return;
      }

      setTreasuryMovements((current) => [data, ...current]);
      setTreasurySetupMissing(false);
      closeTreasuryPanel();
      showToast("Mouvement de trésorerie enregistré.", "paid");
    } finally {
      setIsTreasurySubmitting(false);
    }
  }

  async function toggleRolePermission(permission) {
    if (!isSuperAdmin) {
      showToast("Seul le super admin peut modifier les permissions de l'équipe.", "issue");
      return;
    }

    const nextValue = !permission.is_enabled;
    const { data, error } = await updateRolePermission(
      permission.role,
      permission.permission_key,
      nextValue
    );

    if (error) {
      showToast(
        `Permission non modifiée : ${error.message}. Seul le owner peut changer ces réglages.`,
        "issue"
      );
      return;
    }

    setRolePermissions((current) =>
      current.map((row) =>
        row.role === data.role && row.permission_key === data.permission_key
          ? data
          : row
      )
    );
    showToast("Permission mise à jour.");
  }

  function updateStaffInviteForm(field, value) {
    setStaffInviteForm((current) => ({ ...current, [field]: value }));
  }

  async function refreshStaffMembers({ silent = false } = {}) {
    if (!canViewTeamSettings) return;

    setIsStaffLoading(true);
    const { data, error } = await fetchStaffMembers();
    setIsStaffLoading(false);

    if (error) {
      if (!silent) showToast(`Personnel non chargé : ${error.message}`, "issue");
      setStaffMembers([]);
      return;
    }

    setStaffMembers(data?.members ?? []);
  }

  async function handleStaffInviteSubmit(event) {
    event.preventDefault();

    if (!isSuperAdmin) {
      showToast("Seul le super admin peut inviter du personnel.", "issue");
      return;
    }

    const email = staffInviteForm.email.trim();
    if (!email) {
      showToast("Entre l'email de la personne à inviter.", "issue");
      return;
    }

    setIsStaffInviteSubmitting(true);
    const { data, error } = await inviteStaffMember({
      email,
      role: staffInviteForm.role,
    });
    setIsStaffInviteSubmitting(false);

    if (error) {
      showToast(`Invitation non envoyée : ${error.message}`, "issue");
      return;
    }

    setStaffInviteForm({ email: "", role: "staff" });
    showToast(data?.message || "Invitation envoyée par email.");
    await refreshStaffMembers({ silent: true });
  }

  async function handleStaffRoleChange(member, nextRole) {
    if (member.role === nextRole) return;

    if (!isSuperAdmin) {
      showToast("Seul le super admin peut modifier les rôles du personnel.", "issue");
      return;
    }

    setStaffActionId(member.id);
    const { data, error } = await updateStaffMemberRole(member.id, nextRole);
    setStaffActionId("");

    if (error) {
      showToast(`Rôle non modifié : ${error.message}`, "issue");
      return;
    }

    setStaffMembers(data?.members ?? []);
    showToast("Rôle du membre mis à jour.");
  }

  function requestRemoveStaffMember(member) {
    if (!isSuperAdmin) {
      showOwnerDeleteBlocked();
      return;
    }

    requestAdminConfirm({
      title: "Retirer l'accès admin",
      message: `Retirer ${member.email || member.name || "ce membre"} du personnel BMA ? Son compte client restera intact.`,
      confirmLabel: "Retirer",
      onConfirm: async () => {
        setStaffActionId(member.id);
        const { data, error } = await removeStaffMember(member.id);
        setStaffActionId("");

        if (error) {
          showToast(`Membre non retiré : ${error.message}`, "issue");
          return;
        }

        setStaffMembers(data?.members ?? []);
        showToast("Accès admin retiré.");
      },
    });
  }

  function renderDashboard() {
    return (
      <>
        <div className="section-tools">
          <ActionButton
            icon="download"
            label="Export"
            title="Exporter toutes les données"
            onClick={exportAllAdminData}
          />
        </div>
        <div className="stats admin-stats">
          <Stat label="Commandes ouvertes" value={openOrders.length} />
          <Stat label="Clients suivis" value={customerGroups.length} />
          <Stat label="Articles disponibles" value={availableAdminProducts.length} />
          <Stat label="Disponible compte" value={formatCompact(availableAccountBalance)} />
        </div>

        <div className="admin-overview">
          <section className="section priority-panel">
            <div className="section-head">
              <div>
                <h2>À traiter maintenant</h2>
                <span>Les points importants avant de vendre plus</span>
              </div>
            </div>
            <div className="priority-grid">
              <button className="priority-card" type="button" onClick={() => navigateAdmin("orders")}>
                <span>Commandes à gérer</span>
                <strong>{openOrders.length}</strong>
                <small>Préparation, livraison, annulation si besoin</small>
              </button>
              <button className="priority-card" type="button" onClick={() => navigateAdmin("accounting")}>
                <span>Ventes à vérifier</span>
                <strong>{unpaidOrders.length}</strong>
                <small>Paiements, liquide et lignes manuelles</small>
              </button>
              <button className="priority-card" type="button" onClick={() => navigateAdmin("accounting")}>
                <span>Liquide non déposé</span>
                <strong>{formatCompact(cashToDeposit)}</strong>
                <small>À verser sur le compte Orange Money général</small>
              </button>
              <button className="priority-card" type="button" onClick={() => navigateAdmin("customers")}>
                <span>Clients à suivre</span>
                <strong>{customerGroups.length}</strong>
                <small>Historique, fidélité et contact direct</small>
              </button>
            </div>
          </section>

          <section className="section">
            <div className="section-head">
              <div>
                <h2>Stock à surveiller</h2>
                <span>Articles bientôt en rupture</span>
              </div>
            </div>
            {lowStockProducts.length ? (
              <div className="watch-list">
                {lowStockProducts.slice(0, 5).map((product) => {
                  const effectiveStock = getProductEffectiveStock(product);

                  return (
                    <button
                      className="watch-row"
                      key={product.id}
                      type="button"
                      onClick={() => navigateAdmin("products")}
                    >
                      <img src={product.image} alt="" />
                      <span>
                        <strong>{product.name}</strong>
                        <small>{product.category}</small>
                      </span>
                      <b>{effectiveStock}</b>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="empty-state compact">Aucun stock critique.</div>
            )}
          </section>
        </div>
      </>
    );
  }

  function renderProducts() {
    return (
      <div className="admin-stack product-admin-grid">
        <section className="section">
          <div className="section-head action-head">
            <div>
              <h2>Articles</h2>
              <span>Vêtements, accessoires, photos, prix et stock</span>
            </div>
            <div className="accounting-actions">
              <ActionButton
                icon="select"
                label={allDisplayedProductsSelected ? "Décocher" : "Tout"}
                title={allDisplayedProductsSelected ? "Tout décocher" : "Tout cocher"}
                disabled={!displayedAdminProducts.length}
                onClick={toggleAllDisplayedProductsSelection}
              />
              {canViewDeleteControls ? (
                <ActionButton
                  icon="trash"
                  label="Supprimer"
                  count={selectedProductIds.length}
                  className="danger"
                  title="Supprimer les articles sélectionnés"
                  iconOnly
                  disabled={!selectedProductIds.length || deletingActionId === "bulk:products"}
                  onClick={bulkDeleteProducts}
                />
              ) : null}
              <ActionButton
                icon="download"
                label="Excel"
                title={selectedProductIds.length ? "Exporter la sélection" : "Exporter les articles"}
                onClick={exportProductsToExcel}
              />
              <button
                className="product-add-button"
                type="button"
                aria-label="Ajouter un article"
                title="Ajouter un article"
                onClick={openProductCreator}
              >
                <ActionIcon name="plus" />
                <b>Ajouter</b>
              </button>
            </div>
          </div>
          <div className="stock-tabs" role="tablist" aria-label="Filtrer les articles">
            <button
              className={productStockView === "available" ? "active" : ""}
              type="button"
              onClick={() => setProductStockView("available")}
            >
              Disponibles <span>{availableAdminProducts.length}</span>
            </button>
            <button
              className={productStockView === "out_of_stock" ? "active warning" : "warning"}
              type="button"
              onClick={() => setProductStockView("out_of_stock")}
            >
              Stock épuisé <span>{outOfStockProducts.length}</span>
            </button>
          </div>
          <div className="table-wrap">
            <table className="table products-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Catégorie</th>
                  <th>Vente</th>
                  <th>Achat</th>
                  <th>Revient</th>
                  <th>Stock</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayedAdminProducts.length ? (
                  displayedAdminProducts.map((product) => {
                    const isChecked = selectedProductIds.includes(product.id);
                    const effectiveStock = getProductEffectiveStock(product);

                    return (
                    <tr className={isChecked ? "bulk-selected-row" : ""} key={product.id}>
                      <td data-label="Article">
                        <div className="product-cell">
                          <label className="order-select-control product-select-control">
                            <input
                              type="checkbox"
                              aria-label={`Sélectionner ${product.name}`}
                              checked={isChecked}
                              onChange={() => toggleProductSelection(product.id)}
                            />
                            <span>Sélectionner</span>
                          </label>
                          <img src={product.image} alt="" />
                          <span>
                            <strong>{product.name}</strong>
                            <small>
                              {[
                                product.sizes?.length ? `${product.sizes.length} tailles` : null,
                                product.colors?.length ? `${product.colors.length} couleurs` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "Options non définies"}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td data-label="Catégorie">{product.category}</td>
                      <td data-label="Vente">{formatMoney(getProductPrice(product))}</td>
                      <td data-label="Achat">{formatMoney(getPurchasePrice(product))}</td>
                      <td data-label="Revient">{formatMoney(getCostPrice(product))}</td>
                      <td data-label="Stock">
                        <button
                          className={`stock-pill stock-pill-button ${effectiveStock <= 0 ? "out" : effectiveStock <= 3 ? "low" : ""}`}
                          type="button"
                          title={`Voir le détail du stock de ${product.name}`}
                          onClick={() => openProductStockDetails(product)}
                        >
                          {effectiveStock}
                        </button>
                        {getProductStockBreakdown(product, 2) ? (
                          <button
                            className="stock-detail-text stock-detail-button"
                            type="button"
                            onClick={() => openProductStockDetails(product)}
                          >
                            {getProductStockBreakdown(product, 2)}
                          </button>
                        ) : null}
                      </td>
                      <td data-label="Actions">
                        <div className="inline-actions">
                          <ActionButton
                            icon="edit"
                            label="Modifier"
                            title={`Modifier ${product.name}`}
                            onClick={() => startProductEdit(product)}
                          />
                          <ActionButton
                            icon="plus"
                            label="Stock"
                            title={`Ajouter une pièce au stock de ${product.name}`}
                            onClick={() => adjustStock(product.id, 1)}
                          />
                          <ActionButton
                            icon="minus"
                            label="Stock"
                            className="ghost"
                            title={`Retirer une pièce du stock de ${product.name}`}
                            onClick={() => adjustStock(product.id, -1)}
                          />
                          {canViewDeleteControls ? (
                            <ActionButton
                              icon="trash"
                              label="Supprimer"
                              className="danger"
                              title={`Supprimer ${product.name}`}
                              iconOnly
                              disabled={deletingActionId === `product:${product.id}`}
                              onClick={() => deleteProductOwnerOnly(product)}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="7">
                      <div className="empty-state compact">
                        {productStockView === "out_of_stock"
                          ? "Aucun article en rupture."
                          : "Aucun article disponible."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {productEditorOpen ? (
          <div
            className="product-editor-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeProductEditor();
            }}
          >
        <section className="section product-editor-panel" role="dialog" aria-modal="true">
          <div className="section-head action-head">
            <div>
              <h2>{editingProductId ? "Modifier article" : "Ajouter article"}</h2>
              <span>Photos, variantes, prix de revient et stock</span>
            </div>
            <button className="icon-btn" type="button" onClick={closeProductEditor}>
              Fermer
            </button>
          </div>
          <form className="admin-form product-editor" onSubmit={addLocalProduct}>
            <div className="field photo-drop">
              <label>Photos de l'article</label>
              <input
                accept="image/*"
                multiple
                type="file"
                onChange={(event) => {
                  updateProductImages(event.target.files);
                  event.target.value = "";
                }}
              />
              <span className="muted">
                Ajoute autant de photos que nécessaire. Les nouvelles photos s'ajoutent à la galerie existante.
              </span>
              {productForm.imagePreviews.length ? (
                <div className="image-preview-grid">
                  {productForm.imagePreviews.map((imageUrl, index) => (
                    <div className="image-preview-card" key={`${imageUrl}-${index}`}>
                      <button
                        className="image-remove-btn"
                        type="button"
                        aria-label="Retirer cette photo"
                        title="Retirer cette photo"
                        onClick={() => removeProductImage(index)}
                      >
                        X
                      </button>
                      <img
                        className="image-preview"
                        src={imageUrl}
                        alt="Aperçu article"
                      />
                      <select
                        aria-label="Couleur de la photo"
                        value={productForm.imageColors[index] || ""}
                        onChange={(event) => updateProductImageColor(index, event.target.value)}
                      >
                        <option value="">Photo generale</option>
                        {parseColorText(productForm.colors).map((color) => (
                          <option key={color.value} value={color.value}>
                            {color.value}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <Field
              label="Nom"
              value={productForm.name}
              onChange={(value) => updateProductForm("name", value)}
            />
            <Field
              label="Catégorie"
              value={productForm.category}
              onChange={(value) => updateProductForm("category", value)}
            />
            <div className="field">
              <label>Description courte</label>
              <textarea
                placeholder="Coupe, taille, matière, style..."
                value={productForm.description}
                onChange={(event) => updateProductForm("description", event.target.value)}
              />
            </div>
            <div className="field">
              <label>Tailles disponibles</label>
              <textarea
                placeholder="Vetement : S, M, L, XL. Chaussure : 39, 40, 41. Accessoire : laisser vide si taille unique."
                value={productForm.sizes}
                onChange={(event) => updateProductForm("sizes", event.target.value)}
              />
            </div>
            <div className="field">
              <label>Couleurs disponibles</label>
              <textarea
                placeholder="Ex : Noir #111820, Bleu #2563eb, Beige #d8c3a5"
                value={productForm.colors}
                onChange={(event) => updateProductForm("colors", event.target.value)}
              />
            </div>
            <div className="field">
              <label>Tailles selon la couleur</label>
              <textarea
                placeholder={"Rouge: 40, 41, 42\nBleu: 39, 40\nNoir: S, M, L"}
                value={productForm.sizesByColor}
                onChange={(event) => updateProductForm("sizesByColor", event.target.value)}
              />
              <small className="muted">
                Optionnel. Si une couleur a ses propres tailles, elle remplace la liste generale.
              </small>
            </div>
            <div className="field">
              <label>Quantite selon la couleur</label>
              <textarea
                placeholder={"Noir: 57\nBlanc: 40\nRose: 40"}
                value={productForm.stockByColor}
                onChange={(event) => updateProductForm("stockByColor", event.target.value)}
              />
              <small className="muted">
                Optionnel. Si rempli, le stock total est calcule avec ces quantites.
              </small>
            </div>
            <div className="field">
              <label>Détail exact du stock</label>
              <textarea
                placeholder={"Noir: L 1, XL 1\nBlanc: L 2\nOrange: 2"}
                value={productForm.stockDetails}
                onChange={(event) => updateProductForm("stockDetails", event.target.value)}
              />
              <small className="muted">
                Optionnel. Pour couleur + taille exacte. Si une couleur n'a qu'une taille, un simple nombre suffit.
              </small>
            </div>
            <div className="price-form-grid">
            <Field
              label="Prix de vente GNF"
              value={productForm.price}
              type="number"
              min="1"
              step="1"
              onChange={(value) => updateProductForm("price", value)}
            />
            <Field
              label="Prix d'achat GNF"
              value={productForm.purchasePrice}
              type="number"
              min="0"
              step="1"
              onChange={(value) => updateProductForm("purchasePrice", value)}
            />
            <Field
              label="Frais annexes GNF"
              value={productForm.extraCost}
              type="number"
              min="0"
              step="1"
              onChange={(value) => updateProductForm("extraCost", value)}
            />
            <Field
              label="Stock global reel"
              value={productForm.stock}
              type="number"
              min="0"
              step="1"
              onChange={(value) => updateProductForm("stock", value)}
            />
            <small className="muted stock-form-help">
              Reference physique de l'article. Les details couleur/taille doivent etre repartis a part.
            </small>
            </div>
            <div className="calc-preview">
              <div>
                <span>Revient calculé</span>
                <strong>{formatMoney(productCostPreview)}</strong>
              </div>
              <div>
                <span>Marge estimée</span>
                <strong className={productMarginPreview < 0 ? "negative" : ""}>
                  {formatMoney(productMarginPreview)}
                </strong>
              </div>
              <div>
                <span>Taux marge</span>
                <strong>{getMarginRate(productSalePreview, productCostPreview)}%</strong>
              </div>
            </div>
            <button className="btn" type="submit">
              {editingProductId ? "Enregistrer les modifications" : "Ajouter"}
            </button>
          </form>
        </section>
          </div>
        ) : null}

        {stockDetailProduct ? (
          <div
            className="admin-action-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeProductStockDetails();
            }}
          >
            <ProductStockDetailPanel
              product={stockDetailProduct}
              onClose={closeProductStockDetails}
              onSaveDistribution={saveProductStockDistribution}
            />
          </div>
        ) : null}
      </div>
    );
  }

  function renderOrders() {
    return (
      <div className="admin-stack">
        <div className="order-filter-tabs" aria-label="Filtrer les commandes">
          {orderFilterOptions.map((filter) => (
            <button
              className={orderFilter === filter.value ? "active" : ""}
              key={filter.value}
              type="button"
              onClick={() => {
                setOrderFilter(filter.value);
                setSelectedOrderIds([]);
              }}
            >
              <span>{filter.label}</span>
              <strong>{countOrdersByFilter(adminOrders, filter.value)}</strong>
            </button>
          ))}
        </div>
        <div className="section-tools orders-bulk-bar">
          <strong>
            <span className="selection-label">
              {selectedOrderIds.length} sélectionnée{selectedOrderIds.length > 1 ? "s" : ""}
            </span>
            <span className="selection-count-mobile">{selectedOrderIds.length}</span>
          </strong>
          <ActionButton
            icon="package"
            label="Préparer"
            title="Mettre les commandes sélectionnées en préparation"
            disabled={!canPrepareSelectedOrders || updatingOrderId === "bulk"}
            onClick={() => bulkUpdateOrders("preparing")}
          />
          <ActionButton
            icon="check"
            label="Livrer"
            title="Marquer les commandes sélectionnées comme livrées"
            disabled={!canDeliverSelectedOrders || updatingOrderId === "bulk"}
            onClick={() => bulkUpdateOrders("delivered")}
          />
          <ActionButton
            icon="x"
            label="Annuler"
            className="ghost"
            title="Annuler les commandes sélectionnées"
            disabled={!canCancelSelectedOrders || updatingOrderId === "bulk"}
            onClick={() => bulkUpdateOrders("cancelled")}
          />
          {canViewDeleteControls ? (
            <ActionButton
              icon="trash"
              label="Supprimer"
              count={selectedOrderIds.length}
              className="danger"
              title="Supprimer les commandes sélectionnées"
              iconOnly
              disabled={!selectedOrderIds.length || deletingActionId === "bulk:orders"}
              onClick={bulkDeleteOrders}
            />
          ) : null}
          <ActionButton
            icon="download"
            label="Excel"
            title={selectedOrderIds.length ? "Exporter la sélection" : "Exporter les commandes"}
            onClick={exportOrdersToExcel}
          />
        </div>
        <div className="admin-columns">
          <OrdersTable
            orders={visibleAdminOrders}
            onSelect={setSelectedOrder}
            onToggleAll={toggleAllOrdersSelection}
            onToggleOrder={toggleOrderSelection}
            allSelected={allOrdersSelected}
            filterLabel={orderFilterOptions.find((filter) => filter.value === orderFilter)?.label}
            selectedOrderId={selectedOrder?.id}
            selectedOrderIds={selectedOrderIds}
            updatingOrderId={updatingOrderId}
          />
          <div
            className={`order-detail-shell ${selectedOrder ? "open" : ""}`}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedOrder(null);
            }}
          >
          <DetailPanel
            title="Détail commande"
            emptyText="Clique sur une commande."
            onClose={selectedOrder ? () => setSelectedOrder(null) : null}
          >
            {selectedOrder ? (
              <>
                <strong>{selectedOrder.id}</strong>
                <span className="muted">
                  {selectedOrder.customer} - {selectedOrder.phone}
                </span>
                <span className="muted">
                  {selectedOrder.zone} - {selectedOrder.addressType}
                </span>
                {selectedOrder.landmark ? (
                  <span className="muted">{selectedOrder.landmark}</span>
                ) : null}
                {selectedOrder.mapsUrl ? (
                  <div className="order-location-card">
                    <div>
                      <strong>Position client</strong>
                      <span className="muted">
                        {selectedOrder.mapLabel || "GPS enregistre pour cette livraison"}
                      </span>
                    </div>
                    <a
                      className="maps-action"
                      href={selectedOrder.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ouvrir dans Maps
                    </a>
                  </div>
                ) : null}
                <div className="order-detail-summary">
                  <span>Total</span>
                  <strong>{formatMoney(selectedOrder.total)}</strong>
                  <span>Paiement</span>
                  <strong>{selectedOrder.payment}</strong>
                </div>
                <OrderItemsList items={selectedOrder.orderItems} />
                <div className="inline-actions vertical">
                  {canMoveOrderStatus(selectedOrder, "preparing", isSuperAdmin) ? (
                    <ActionButton
                      icon="package"
                      label={ORDER_TERMINAL_STATUSES.has(selectedOrder.rawStatus) ? "Réouvrir" : "Préparer"}
                      disabled={updatingOrderId === selectedOrder.id}
                      onClick={() => updateOrderStatus(selectedOrder, "preparing")}
                    />
                  ) : null}
                  {canMoveOrderStatus(selectedOrder, "delivered", isSuperAdmin) ? (
                    <ActionButton
                      icon="check"
                      label="Marquer livrée"
                      disabled={updatingOrderId === selectedOrder.id}
                      onClick={() => updateOrderStatus(selectedOrder, "delivered")}
                    />
                  ) : null}
                  {canMoveOrderStatus(selectedOrder, "cancelled", isSuperAdmin) ? (
                    <ActionButton
                      icon="x"
                      label="Annuler"
                      className="ghost"
                      disabled={updatingOrderId === selectedOrder.id}
                      onClick={() => updateOrderStatus(selectedOrder, "cancelled")}
                    />
                  ) : null}
                  {ORDER_PREPARING_STATUSES.has(selectedOrder.rawStatus) && !isOrderPaid(selectedOrder) ? (
                    <div className="order-flow-note waiting">
                      <strong>Paiement attendu</strong>
                      <span>Cette commande pourra être livrée après confirmation du paiement.</span>
                    </div>
                  ) : null}
                  {ORDER_TERMINAL_STATUSES.has(selectedOrder.rawStatus) ? (
                    <div className="order-flow-note">
                      <strong>Statut final</strong>
                      <span>
                        {isSuperAdmin
                          ? "Tu peux la réouvrir si une correction est vraiment nécessaire."
                          : "Contacte le super admin si ce statut doit être corrigé."}
                      </span>
                    </div>
                  ) : null}
                  {canViewDeleteControls ? (
                    <ActionButton
                      icon="trash"
                      label="Supprimer"
                      className="danger"
                      disabled={deletingActionId === `order:${selectedOrder.rawId}`}
                      onClick={() => deleteOrderOwnerOnly(selectedOrder)}
                    />
                  ) : null}
                </div>
              </>
            ) : null}
          </DetailPanel>
          </div>
        </div>
      </div>
    );
  }

  function renderAccounting() {
    const accountingDetailNoteLines = String(selectedAccountingDetail?.note || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const accountingDetailImage =
      selectedAccountingProduct ? getProductImageEntries(selectedAccountingProduct)[0]?.imageUrl : "";
    const accountingDetailTitle =
      selectedAccountingProduct?.name ||
      accountingDetailNoteLines
        .find((line) => /^article\s*:/i.test(line))
        ?.replace(/^article\s*:\s*/i, "") ||
      selectedAccountingDetail?.orderId ||
      "Vente";
    const accountingDetailMargin = selectedAccountingDetail
      ? Number(selectedAccountingDetail.saleAmount || 0) -
        Number(selectedAccountingDetail.costAmount || 0)
      : 0;
    const accountingDetailDepositHistory = selectedAccountingDetail?.depositHistory ?? [];
    const accountingDetailDeposits = accountingDetailDepositHistory.length
      ? accountingDetailDepositHistory
      : selectedAccountingDetail && Number(selectedAccountingDetail.depositAmount || 0) > 0
        ? [
            {
              amount: selectedAccountingDetail.depositAmount,
              orangeMoneyRef: selectedAccountingDetail.orangeMoneyRef,
              depositedBy: selectedAccountingDetail.depositedBy,
              receiptName: selectedAccountingDetail.receiptName,
              receiptUrl: selectedAccountingDetail.receiptUrl,
              depositedAt: selectedAccountingDetail.depositedAt,
            },
          ]
        : [];

    return (
      <div className="admin-stack">
        {isSeller ? (
          <section className="section seller-sale-section">
            <div className="section-head">
              <div>
                <h2>Enregistrer une vente</h2>
                <span>Choisis l'article vendu, la quantité et le mode d'encaissement.</span>
              </div>
              <button
                className="product-add-button"
                type="button"
                title="Ajouter une vente"
                aria-label="Ajouter une vente"
                onClick={openManualSalePanel}
              >
                <ActionIcon name="plus" />
                <b>Vente</b>
              </button>
            </div>
            <div className="empty-state compact">
              Les données de marge, prix d'achat, audit et dépôts sont réservées aux managers.
            </div>
          </section>
        ) : (
          <>
        <div className="stats">
          <Stat label="CA généré" value={formatCompact(totalRevenue)} />
          <Stat label="Disponible compte" value={formatCompact(availableAccountBalance)} />
          <Stat label="Bénéfice brut" value={formatCompact(grossProfitAmount)} />
          <Stat label="Sur comptes" value={formatCompact(depositedAccountTotal)} />
          <Stat label="Liquide à déposer" value={formatCompact(cashToDeposit)} />
        </div>

        <AccountingCharts
          depositedCash={depositedCash}
          records={accountingRecords}
          totalCash={totalCash}
          totalCost={totalCost}
          totalRevenue={totalRevenue}
        />

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Historique comptable</h2>
              <span>Commandes, achats, revient, encaissement et dépôt Orange Money</span>
            </div>
            <div className="accounting-actions">
              <ActionButton
                icon="select"
                label={allAccountingSelected ? "Décocher" : "Tout"}
                title={allAccountingSelected ? "Tout décocher" : "Tout cocher"}
                disabled={!visibleAccountingRecords.length}
                onClick={toggleAllAccountingSelection}
              />
              {canViewDeleteControls ? (
                <ActionButton
                  icon="trash"
                  label="Supprimer"
                  count={selectedAccountingIds.length}
                  className="danger"
                  title="Supprimer les lignes sélectionnées"
                  iconOnly
                  disabled={!selectedAccountingIds.length || deletingActionId === "bulk:accounting"}
                  onClick={bulkDeleteAccountingRecords}
                />
              ) : null}
              <ActionButton
                icon="download"
                label="Excel"
                title={selectedAccountingIds.length ? "Exporter la sélection" : "Exporter la comptabilité"}
                onClick={exportAccountingToExcel}
              />
              <button
                className="product-add-button"
                type="button"
                title="Ajouter une vente manuelle"
                aria-label="Ajouter une vente manuelle"
                onClick={openManualSalePanel}
              >
                <ActionIcon name="plus" />
                <b>Vente</b>
              </button>
              <button
                className="product-add-button secondary-action deposit-action"
                type="button"
                title="Enregistrer un dépôt Orange Money"
                aria-label="Enregistrer un dépôt Orange Money"
                onClick={openDepositPanel}
              >
                <ActionIcon name="wallet" />
                <b>Dépôt</b>
              </button>
            </div>
          </div>
          <div className="accounting-history-filters">
            <label className="accounting-history-search">
              <span>Rechercher</span>
              <input
                type="search"
                placeholder="Client, commande, vendeur..."
                value={accountingSearch}
                onChange={(event) => {
                  setAccountingSearch(event.target.value);
                  setSelectedAccountingIds([]);
                }}
              />
            </label>
            <label>
              <span>Encaissement</span>
              <select
                value={accountingPaymentFilter}
                onChange={(event) => {
                  setAccountingPaymentFilter(event.target.value);
                  setSelectedAccountingIds([]);
                }}
              >
                <option value="all">Tous</option>
                <option value="Liquide">Liquide</option>
                <option value="Orange Money">Orange Money</option>
                <option value="Djomi">Djomi</option>
              </select>
            </label>
            <label>
              <span>Enregistrée par</span>
              <select
                value={accountingSellerFilter}
                onChange={(event) => {
                  setAccountingSellerFilter(event.target.value);
                  setSelectedAccountingIds([]);
                }}
              >
                <option value="all">Toute l'équipe</option>
                {accountingSellerOptions.map((seller) => (
                  <option value={seller} key={seller}>{seller}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Trier par</span>
              <select value={accountingSort} onChange={(event) => setAccountingSort(event.target.value)}>
                <option value="date_desc">Plus récentes</option>
                <option value="date_asc">Plus anciennes</option>
                <option value="sale_desc">Vente la plus élevée</option>
                <option value="sale_asc">Vente la plus faible</option>
                <option value="margin_desc">Marge la plus élevée</option>
                <option value="customer_asc">Client A à Z</option>
                <option value="seller_asc">Vendeur A à Z</option>
              </select>
            </label>
            <span className="accounting-filter-count">
              {visibleAccountingRecords.length} ligne{visibleAccountingRecords.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table accounting-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Commande</th>
                  <th>Client</th>
                  <th>Vente</th>
                  <th>Achat</th>
                  <th>Frais</th>
                  <th>Revient</th>
                  <th>Marge</th>
                  <th>Encaissement</th>
                  {canViewDeleteControls ? <th>Actions</th> : null}
                  <th>Dépôt OM</th>
                  <th>Reçu</th>
                </tr>
              </thead>
              <tbody>
                {visibleAccountingRecords.length ? (
                  visibleAccountingRecords.map((record) => {
                    const isChecked = selectedAccountingIds.includes(record.id);
                    const depositedAmount = Number(record.depositAmount || 0);
                    const remainingAmount = Number(
                      record.remainingDepositAmount ?? record.saleAmount ?? 0
                    );
                    const isPartiallyDeposited = depositedAmount > 0 && remainingAmount > 0;
                    const isFullyDeposited = depositedAmount > 0 && remainingAmount <= 0;
                    const receiptEntries = getAccountingReceiptEntries(record);
                    const canAddReceipt =
                      (record.paymentMethod === "Liquide" && remainingAmount > 0) ||
                      (record.paymentMethod === "Orange Money" && !receiptEntries.length);

                    return (
                    <tr
                      className={[
                        isChecked ? "bulk-selected-row" : "",
                        selectedAccountingDetailId === record.id ? "active-row" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={record.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedAccountingDetailId(record.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedAccountingDetailId(record.id);
                        }
                      }}
                    >
                      <td data-label="Date">
                        <label
                          className="order-select-control"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${record.orderId}`}
                            checked={isChecked}
                            onChange={() => toggleAccountingSelection(record.id)}
                          />
                          <span>Sélectionner</span>
                        </label>
                        <span className="table-date-value">{record.date}</span>
                      </td>
                      <td data-label="Commande">
                        <strong>{record.orderId}</strong>
                        {record.note ? (
                          <>
                            <br />
                            <span className="muted">{record.note.split("\n")[0]}</span>
                          </>
                        ) : null}
                      </td>
                      <td data-label="Client">{record.customer}</td>
                      <td data-label="Vente">{formatMoney(record.saleAmount)}</td>
                      <td data-label="Achat">{formatMoney(record.purchaseAmount)}</td>
                      <td data-label="Frais">{formatMoney(record.extraCost)}</td>
                      <td data-label="Revient">{formatMoney(record.costAmount)}</td>
                      <td data-label="Marge">{formatMoney(record.saleAmount - record.costAmount)}</td>
                      <td data-label="Encaissement">
                        {record.paymentMethod}
                        <br />
                        <span className="muted">Par: {record.collectedBy}</span>
                      </td>
                      {canViewDeleteControls ? (
                        <td data-label="Actions" onClick={(event) => event.stopPropagation()}>
                          <ActionButton
                            icon="trash"
                            label="Supprimer"
                            className="danger"
                            title={`Supprimer ${record.orderId}`}
                            iconOnly
                            disabled={deletingActionId === `accounting:${record.id}`}
                            onClick={() => deleteAccountingOwnerOnly(record)}
                          />
                        </td>
                      ) : null}
                      <td data-label="Dépôt OM">
                        {isFullyDeposited || isPartiallyDeposited ? (
                          <>
                            <span className={`status ${isFullyDeposited ? "paid" : "waiting"}`}>
                              {isFullyDeposited ? "Déposé" : "Partiel"}
                            </span>
                            <br />
                            <span>{formatMoney(depositedAmount)} / {formatMoney(record.saleAmount)}</span>
                            {remainingAmount > 0 ? (
                              <>
                                <br />
                                <span className="muted">Reste {formatMoney(remainingAmount)}</span>
                              </>
                            ) : null}
                            <br />
                            {record.orangeMoneyRef ? (
                              <span className="muted">
                                {record.orangeMoneyRef} - {record.depositedBy}
                              </span>
                            ) : record.paymentMethod === "Orange Money" ? (
                              <span className="muted">Reçu à joindre</span>
                            ) : null}
                          </>
                        ) : (
                          <span className="status waiting">À déposer</span>
                        )}
                      </td>
                      <td data-label="Reçu" onClick={(event) => event.stopPropagation()}>
                        <div className="receipt-actions">
                          {receiptEntries.length > 1 ? (
                            <button
                              className="receipt-link receipt-button"
                              type="button"
                              onClick={() => setSelectedAccountingDetailId(record.id)}
                            >
                              {receiptEntries.length} reçus
                            </button>
                          ) : receiptEntries[0]?.receiptUrl ? (
                            <a
                              className="receipt-link"
                              href={receiptEntries[0].receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Voir le reçu
                            </a>
                          ) : receiptEntries[0]?.receiptName ? (
                            <span className="muted">{receiptEntries[0].receiptName}</span>
                          ) : null}
                          {canAddReceipt ? (
                            <button
                              className="receipt-link receipt-button receipt-add-button"
                              type="button"
                              onClick={() => openDepositPanel(record.id)}
                            >
                              Ajouter reçu
                            </button>
                          ) : null}
                          {!receiptEntries.length && !canAddReceipt ? "-" : null}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={canViewDeleteControls ? 12 : 11}>
                      <div className="empty-state compact">
                        {accountingRecords.length
                          ? "Aucune ligne ne correspond aux filtres."
                          : "Aucune ligne comptable enregistrée."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {selectedAccountingDetail ? (
          <div
            className="admin-action-overlay accounting-detail-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSelectedAccountingDetailId("");
            }}
          >
            <section className="section admin-action-panel accounting-detail-panel">
              <div className="section-head">
                <div>
                  <h2>Détail de la vente</h2>
                  <span>
                    {selectedAccountingDetail.orderId} ·{" "}
                    {getAccountingSourceLabel(selectedAccountingDetail.source)}
                  </span>
                </div>
                <button
                  className="icon-btn"
                  type="button"
                  onClick={() => setSelectedAccountingDetailId("")}
                >
                  Fermer
                </button>
              </div>
              <div className="accounting-detail-body">
                <div className="accounting-detail-hero">
                  {accountingDetailImage ? (
                    <img src={accountingDetailImage} alt={accountingDetailTitle} />
                  ) : (
                    <div className="accounting-detail-image-fallback">
                      {accountingDetailTitle.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div>
                    <span className="status paid">
                      {getAccountingSourceLabel(selectedAccountingDetail.source)}
                    </span>
                    <h3>{accountingDetailTitle}</h3>
                    <p>
                      {selectedAccountingDetail.customer} · {selectedAccountingDetail.date} ·{" "}
                      {selectedAccountingDetail.quantity} article
                      {selectedAccountingDetail.quantity > 1 ? "s" : ""}
                    </p>
                    <small>
                      Encaissement : {selectedAccountingDetail.paymentMethod} par{" "}
                      {selectedAccountingDetail.collectedBy}
                    </small>
                  </div>
                </div>

                <div className="accounting-detail-grid">
                  <AuditRow label="Vente" value={formatMoney(selectedAccountingDetail.saleAmount)} tone="paid" />
                  <AuditRow label="Achat" value={formatMoney(selectedAccountingDetail.purchaseAmount)} />
                  <AuditRow label="Frais" value={formatMoney(selectedAccountingDetail.extraCost)} />
                  <AuditRow label="Prix de revient" value={formatMoney(selectedAccountingDetail.costAmount)} />
                  <AuditRow
                    label="Marge"
                    value={`${formatMoney(accountingDetailMargin)} · ${getMarginRate(
                      selectedAccountingDetail.saleAmount,
                      selectedAccountingDetail.costAmount
                    )}%`}
                    tone={accountingDetailMargin < 0 ? "warning" : "paid"}
                  />
                  <AuditRow
                    label="Reste à déposer"
                    value={formatMoney(selectedAccountingDetail.remainingDepositAmount)}
                    tone={selectedAccountingDetail.remainingDepositAmount ? "warning" : "paid"}
                  />
                </div>

                <div className="accounting-detail-section">
                  <h3>Comment ça a été vendu</h3>
                  {accountingDetailNoteLines.length ? (
                    <div className="accounting-note-list">
                      {accountingDetailNoteLines.map((line, index) => {
                        const separatorIndex = line.indexOf(":");
                        const label = separatorIndex > -1 ? line.slice(0, separatorIndex) : "";
                        const value = separatorIndex > -1 ? line.slice(separatorIndex + 1).trim() : line;

                        return (
                          <div className="accounting-note-row" key={`${line}-${index}`}>
                            {label ? <span>{label}</span> : null}
                            <strong>{value}</strong>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state compact">
                      Aucun détail saisi pour cette vente.
                    </div>
                  )}
                </div>

                <div className="accounting-detail-section">
                  <h3>Dépôts Orange Money</h3>
                  <div className="deposit-summary">
                    <span>
                      Déjà déposé
                      <strong>{formatMoney(selectedAccountingDetail.depositAmount)}</strong>
                    </span>
                    <span>
                      Reste
                      <strong>{formatMoney(selectedAccountingDetail.remainingDepositAmount)}</strong>
                    </span>
                    <span>
                      Versements
                      <strong>{selectedAccountingDetail.depositCount || accountingDetailDeposits.length}</strong>
                    </span>
                  </div>
                  {Number(selectedAccountingDetail.remainingDepositAmount || 0) > 0 ? (
                    <button
                      className="receipt-link receipt-button deposit-more-button"
                      type="button"
                      onClick={() => openDepositPanel(selectedAccountingDetail.id)}
                    >
                      Ajouter un paiement / reçu
                    </button>
                  ) : null}
                  {accountingDetailDeposits.length ? (
                    <div className="deposit-history-list">
                      {accountingDetailDeposits.map((deposit, index) => (
                        <div className="deposit-history-row" key={`${deposit.orangeMoneyRef}-${index}`}>
                          <span>
                            <strong>{formatMoney(deposit.amount)}</strong>
                            <small>
                              {deposit.orangeMoneyRef || "Référence non précisée"} ·{" "}
                              {deposit.depositedBy || "Responsable non précisé"}
                            </small>
                          </span>
                          <span>{deposit.depositedAt || "-"}</span>
                          {deposit.receiptUrl ? (
                            <a
                              className="receipt-link"
                              href={deposit.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Reçu
                            </a>
                          ) : (
                            <em>{deposit.receiptName || "Sans reçu"}</em>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state compact">Aucun dépôt enregistré.</div>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : null}
          </>
        )}

        {manualSaleOpen ? (
          <div
            className="admin-action-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeManualSalePanel();
            }}
          >
            <section className="section admin-action-panel manual-sale-panel">
              <div className="section-head manual-sale-head">
                <div>
                  <h2>Nouvelle vente</h2>
                  <span>Ajoute les articles, puis confirme l'encaissement.</span>
                </div>
                <button
                  className="icon-btn manual-sale-close"
                  type="button"
                  aria-label="Fermer"
                  title="Fermer"
                  onClick={closeManualSalePanel}
                >
                  <ActionIcon name="x" />
                </button>
              </div>

              <form className="admin-form manual-sale-form" onSubmit={addAccountingRecord}>
                <section className="manual-sale-step">
                  <div className="manual-sale-step-head">
                    <span>1</span>
                    <div>
                      <strong>Articles vendus</strong>
                      <small>Les prix et le stock viennent automatiquement de BMA.</small>
                    </div>
                  </div>

                  <div className="field full">
                    <label>Choisir un article</label>
                    <select
                      value={accountingForm.saleProductId}
                      onChange={(event) => selectManualSaleProduct(event.target.value)}
                    >
                      <option value="">Sélectionner dans le stock</option>
                      {availableAdminProducts.map((product) => (
                        <option value={product.id} key={product.id}>
                          {product.name} · {formatMoney(getProductPrice(product))} · stock {getProductEffectiveStock(product)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedSaleProduct ? (
                    <div className="manual-sale-draft">
                      <div className="manual-sale-product-summary">
                        {selectedSaleProduct.image ? (
                          <img src={selectedSaleProduct.image} alt="" />
                        ) : (
                          <div className="manual-sale-image-fallback">
                            <ActionIcon name="package" />
                          </div>
                        )}
                        <span>
                          <strong>{selectedSaleProduct.name}</strong>
                          <small>{Number(selectedSaleProduct.stock || 0)} en stock</small>
                        </span>
                        <b>{formatMoney(getProductPrice(selectedSaleProduct))}</b>
                      </div>

                      <div className="manual-sale-selection-grid">
                        <Field
                          label={manualVariantRows.length ? "Quantité totale" : "Quantité"}
                          value={accountingForm.saleQuantity}
                          type="number"
                          min="1"
                          step="1"
                          disabled={Boolean(manualVariantRows.length)}
                          onChange={updateManualSaleQuantity}
                        />
                        {!manualVariantRows.length && selectedSaleColorOptions.length ? (
                          <div className="field">
                            <label>Couleur *</label>
                            <select
                              value={accountingForm.saleColor}
                              onChange={(event) => {
                                updateAccountingForm("saleColor", event.target.value);
                                updateAccountingForm("saleSize", "");
                              }}
                            >
                              <option value="">Non précisée</option>
                              {selectedSaleColorOptions.map((color) => (
                                <option value={color.value} key={color.value}>
                                  {color.value} · stock {getProductStockForColor(selectedSaleProduct, color.value)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                        {!manualVariantRows.length && selectedSaleSizeOptions.length ? (
                          <div className="field">
                            <label>Taille / pointure *</label>
                            <select
                              value={accountingForm.saleSize}
                              onChange={(event) => updateAccountingForm("saleSize", event.target.value)}
                            >
                              <option value="">Non précisée</option>
                              {selectedSaleSizeOptions.map((size) => (
                                <option value={size} key={size}>{size}</option>
                              ))}
                            </select>
                          </div>
                        ) : null}
                      </div>

                      {accountingForm.saleColor && !manualVariantRows.length ? (
                        <small className="manual-sale-stock-note">
                          {selectedSaleColorStock} article(s) disponible(s) dans cette couleur.
                        </small>
                      ) : null}

                      {showManualVariantFields ? (
                        <details className="manual-sale-options">
                          <summary>
                            <span>Vendre plusieurs couleurs ou tailles</span>
                            <small>{manualVariantRows.length ? `${manualVariantQuantity} article(s) détaillé(s)` : "Facultatif"}</small>
                          </summary>
                          <div className="manual-variant-builder">
                            <div className="manual-variant-add-row">
                              {selectedSaleColorOptions.length ? (
                                <div className="field">
                                  <label>Couleur *</label>
                                  <select
                                    value={accountingForm.saleVariantDraftColor}
                                    onChange={(event) => {
                                      updateAccountingForm("saleVariantDraftColor", event.target.value);
                                      updateAccountingForm("saleVariantDraftSize", "");
                                    }}
                                  >
                                    <option value="">Choisir</option>
                                    {selectedSaleColorOptions.map((color) => (
                                      <option value={color.value} key={color.value}>
                                        {color.value} · stock {getProductStockForColor(selectedSaleProduct, color.value)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              {selectedSaleDraftSizeOptions.length ? (
                                <div className="field">
                                  <label>Taille / pointure *</label>
                                  <select
                                    value={accountingForm.saleVariantDraftSize}
                                    onChange={(event) =>
                                      updateAccountingForm("saleVariantDraftSize", event.target.value)
                                    }
                                  >
                                    <option value="">Non précisée</option>
                                    {selectedSaleDraftSizeOptions.map((size) => (
                                      <option value={size} key={size}>{size}</option>
                                    ))}
                                  </select>
                                </div>
                              ) : null}
                              <div className="field">
                                <label>Quantité</label>
                                <input
                                  min="1"
                                  step="1"
                                  type="number"
                                  value={accountingForm.saleVariantDraftQuantity}
                                  onChange={(event) =>
                                    updateAccountingForm("saleVariantDraftQuantity", event.target.value)
                                  }
                                />
                              </div>
                              <button
                                className="icon-btn manual-variant-add"
                                type="button"
                                onClick={addManualVariantSelection}
                              >
                                <ActionIcon name="plus" />
                                Ajouter
                              </button>
                            </div>
                            {accountingForm.saleVariantDraftColor ? (
                              <p className="manual-variant-note">
                                Stock disponible : {selectedSaleDraftStock} article(s).
                              </p>
                            ) : null}
                            {manualVariantRows.length ? (
                              <div className="manual-variant-lines">
                                {manualVariantRows.map((row, index) => (
                                  <div className="manual-variant-line" key={`${row.line}-${index}`}>
                                    <span>
                                      <strong>{row.color || "Option"}</strong>
                                      {row.size ? ` / ${row.size}` : ""}
                                    </span>
                                    <b>x{row.quantity}</b>
                                    <button
                                      type="button"
                                      aria-label={`Retirer ${row.line}`}
                                      title="Retirer"
                                      onClick={() => removeManualVariantSelection(index)}
                                    >
                                      <ActionIcon name="trash" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </details>
                      ) : null}

                      <button
                        className="btn secondary manual-sale-add-item"
                        type="button"
                        onClick={addManualSaleItem}
                      >
                        <ActionIcon name="plus" />
                        Ajouter à la vente
                      </button>
                    </div>
                  ) : null}

                  {manualSaleItems.length ? (
                    <div className="manual-sale-items">
                      <div className="manual-variant-head">
                        <strong>Vente en cours</strong>
                        <span>{manualSaleItemsQuantity} article(s) · {formatMoney(manualSaleItemsBaseAmount)}</span>
                      </div>
                      <div className="manual-sale-item-list">
                        {manualSaleItems.map((item) => (
                          <div className="manual-sale-item" key={item.id}>
                            {item.image ? (
                              <img src={item.image} alt="" />
                            ) : (
                              <div className="manual-sale-image-fallback">
                                <ActionIcon name="package" />
                              </div>
                            )}
                            <span>
                              <strong>{item.productName}</strong>
                              <small>
                                x{item.quantity}{item.optionSummary ? ` · ${item.optionSummary}` : ""}
                              </small>
                            </span>
                            <b>{formatMoney(item.saleAmount)}</b>
                            <button
                              type="button"
                              aria-label={`Retirer ${item.productName}`}
                              title="Retirer"
                              onClick={() => removeManualSaleItem(item.id)}
                            >
                              <ActionIcon name="trash" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {!selectedSaleProduct && !hasManualSaleItems && !isSeller ? (
                    <details className="manual-sale-advanced manual-free-sale">
                      <summary>Vente sans article du catalogue</summary>
                      <div className="manual-sale-detail-grid">
                        <Field
                          label="Prix de vente total"
                          value={accountingForm.saleAmount}
                          type="number"
                          min="1"
                          step="1"
                          placeholder="Montant encaissé"
                          onChange={(value) => updateAccountingForm("saleAmount", value)}
                        />
                        <Field
                          label="Quantité"
                          value={accountingForm.saleQuantity}
                          type="number"
                          min="1"
                          step="1"
                          onChange={updateManualSaleQuantity}
                        />
                        {canSeeAccountingFinancials ? (
                          <>
                            <Field
                              label="Prix d'achat total"
                              value={accountingForm.purchaseAmount}
                              type="number"
                              min="0"
                              step="1"
                              onChange={(value) => updateAccountingForm("purchaseAmount", value)}
                            />
                            <Field
                              label="Frais annexes"
                              value={accountingForm.extraCost}
                              type="number"
                              min="0"
                              step="1"
                              onChange={(value) => updateAccountingForm("extraCost", value)}
                            />
                          </>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                </section>

                <section className="manual-sale-step">
                  <div className="manual-sale-step-head">
                    <span>2</span>
                    <div>
                      <strong>Client et paiement</strong>
                      <small>Seul le numéro est utile pour retrouver la vente.</small>
                    </div>
                  </div>

                  <div className="manual-sale-customer-grid">
                    <Field
                      label="Numéro du client"
                      value={accountingForm.orderId}
                      type="tel"
                      autoComplete="tel"
                      placeholder="Ex. 622 00 00 00"
                      onChange={(value) => updateAccountingForm("orderId", value)}
                    />
                    <Field
                      label="Nom du client"
                      value={accountingForm.customer}
                      placeholder="Nom du client"
                      required
                      onChange={(value) => updateAccountingForm("customer", value)}
                    />
                  </div>

                  <div className="field">
                    <label>Encaissement</label>
                    <div className="manual-payment-options" role="group" aria-label="Mode d'encaissement">
                      {["Liquide", "Orange Money", "Djomi"].map((method) => (
                        <button
                          className={accountingForm.paymentMethod === method ? "active" : ""}
                          type="button"
                          key={method}
                          onClick={() => updateAccountingForm("paymentMethod", method)}
                        >
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field
                    label="Ajustement du total (+ surplus / - remise)"
                    value={accountingForm.discountAmount}
                    type="number"
                    step="1"
                    placeholder="0"
                    onChange={(value) => updateAccountingForm("discountAmount", value)}
                  />

                  <details className="manual-sale-advanced">
                    <summary>Date et note</summary>
                    <div className="manual-sale-detail-grid">
                      <Field
                        label="Date"
                        value={accountingForm.date}
                        type="date"
                        onChange={(value) => updateAccountingForm("date", value)}
                      />
                      <div className="field">
                        <label>Note (facultatif)</label>
                        <textarea
                          value={accountingForm.note}
                          placeholder="Précision utile sur la vente"
                          onChange={(event) => updateAccountingForm("note", event.target.value)}
                        />
                      </div>
                    </div>
                  </details>

                  {canSeeAccountingFinancials && (selectedSaleProduct || hasManualSaleItems) ? (
                    <details className="manual-sale-advanced manual-sale-finance">
                      <summary>Détails financiers internes</summary>
                      <div className="manual-sale-finance-grid">
                        <span>
                          <small>Prix prévu</small>
                          <strong>{formatMoney(manualSaleBaseAmount)}</strong>
                        </span>
                        <span>
                          <small>Prix de revient</small>
                          <strong>{formatMoney(manualSaleCostAmount)}</strong>
                        </span>
                        <span>
                          <small>Marge estimée</small>
                          <strong className={manualSaleMarginAmount < 0 ? "negative" : ""}>
                            {formatMoney(manualSaleMarginAmount)}
                          </strong>
                        </span>
                      </div>
                    </details>
                  ) : null}
                </section>

                <div className="manual-sale-footer">
                  <span>
                    <small>Total encaissé</small>
                    <strong>{formatMoney(manualSaleFinalAmount)}</strong>
                    <em>Par {adminDisplayName}</em>
                  </span>
                  <button className="btn" type="submit">
                    <ActionIcon name="check" />
                    Enregistrer la vente
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}

        {depositPanelOpen && !isSeller ? (
          <div
            className="admin-action-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeDepositPanel();
            }}
          >
          <section className="section admin-action-panel">
            <div className="section-head">
              <div>
                <h2>Dépôt Orange Money général</h2>
                <span>Chaque manager joint son reçu</span>
              </div>
              <button className="icon-btn" type="button" onClick={closeDepositPanel}>
                Fermer
              </button>
            </div>
            <form className="admin-form" onSubmit={saveOrangeMoneyDeposit}>
              <label>Ligne à compléter</label>
              {depositableRecords.length ? (
                <select
                  value={selectedDepositRecordId}
                  onChange={(event) =>
                    {
                      setDepositMessage(null);
                    setDepositForm((current) => ({
                      ...current,
                      recordId: event.target.value,
                      amount: "",
                    }));
                    }
                  }
                >
                  {depositableRecords.map((record) => (
                      <option value={record.id} key={record.id}>
                        {record.paymentMethod === "Orange Money"
                          ? `${record.orderId} - reçu Orange Money à joindre`
                          : `${record.orderId} - reste ${formatMoney(record.remainingDepositAmount)}`}
                      </option>
                    ))}
                </select>
              ) : (
                <div className="empty-state compact">
                  Aucun dépôt ou reçu Orange Money en attente.
                </div>
              )}
              {selectedDepositRecord ? (
                <div className="deposit-summary">
                  <span>
                    Vente
                    <strong>{formatMoney(selectedDepositRecord.saleAmount)}</strong>
                  </span>
                  <span>
                    {selectedDepositIsDirectOrangeMoney ? "Déjà sur OM" : "Déjà déposé"}
                    <strong>{formatMoney(selectedDepositRecord.depositAmount)}</strong>
                  </span>
                  <span>
                    {selectedDepositIsDirectOrangeMoney ? "Montant OM" : "Reste"}
                    <strong>{formatMoney(selectedDepositRemainingAmount)}</strong>
                  </span>
                </div>
              ) : null}
              {selectedDepositIsDirectOrangeMoney ? (
                <div className="trace-box">
                  <span>Montant déjà encaissé sur Orange Money</span>
                  <strong>{formatMoney(selectedDepositRecord?.saleAmount || 0)}</strong>
                  <small>Ajoute seulement la référence et le reçu.</small>
                </div>
              ) : (
                <Field
                  label="Montant versé maintenant"
                  value={depositForm.amount}
                  type="number"
                  min="1"
                  step="1"
                  disabled={!depositableRecords.length || isDepositSubmitting}
                  onChange={(value) =>
                    {
                      setDepositMessage(null);
                    setDepositForm((current) => ({
                      ...current,
                      amount: value,
                    }));
                    }
                  }
                />
              )}
              <Field
                label={
                  selectedDepositIsDirectOrangeMoney
                    ? "Référence Orange Money (facultative)"
                    : "Référence Orange Money"
                }
                value={depositForm.orangeMoneyRef}
                disabled={!depositableRecords.length || isDepositSubmitting}
                onChange={(value) =>
                  {
                    setDepositMessage(null);
                  setDepositForm((current) => ({
                    ...current,
                    orangeMoneyRef: value,
                  }));
                  }
                }
              />
              <div className="field">
                <label>Reçu du dépôt</label>
                <label
                  className={`file-picker ${!depositableRecords.length || isDepositSubmitting ? "disabled" : ""}`}
                >
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={!depositableRecords.length || isDepositSubmitting}
                    onChange={(event) =>
                      {
                        setDepositMessage(null);
                      setDepositForm((current) => ({
                        ...current,
                        receiptFile: event.target.files?.[0] ?? null,
                        receiptName: event.target.files?.[0]?.name ?? "",
                      }));
                      }
                    }
                  />
                  <span>Choisir un reçu</span>
                  <strong>{depositForm.receiptName || "Image ou PDF"}</strong>
                </label>
                <span className="muted">
                  {depositForm.receiptName || "Aucun reçu sélectionné"}
                </span>
              </div>
              <div className="trace-box">
                <span>{selectedDepositIsDirectOrangeMoney ? "Reçu ajouté par" : "Dépôt enregistré par"}</span>
                <strong>{adminDisplayName}</strong>
              </div>
              {depositMessage ? (
                <div className={`checkout-status ${depositMessage.tone}`}>
                  {depositMessage.text}
                </div>
              ) : null}
              <button
                className={`btn ${isDepositSubmitting ? "loading" : ""}`}
                disabled={!depositableRecords.length || isDepositSubmitting}
                type="submit"
              >
                {isDepositSubmitting ? "Enregistrement..." : "Enregistrer le dépôt"}
              </button>
            </form>
          </section>
          </div>
        ) : null}
      </div>
    );
  }

  function renderAudit() {
    const productsToAudit = [...outOfStockProducts, ...lowStockProducts].slice(0, 8);

    return (
      <div className="admin-stack">
        <section className="section audit-command-center">
          <div className="section-head action-head">
            <div>
              <h2>Argent disponible</h2>
              <span>Le chiffre à suivre, puis les explications essentielles.</span>
            </div>
            <div className="accounting-actions">
              <ActionButton
                icon="user"
                label={staffAuditOpen ? "Masquer" : "Par personne"}
                title={staffAuditOpen ? "Masquer l'audit par personne" : "Ouvrir l'audit par personne"}
                onClick={() => setStaffAuditOpen((open) => !open)}
              />
              <ActionButton
                icon="download"
                label="Excel"
                title="Exporter l'audit"
                onClick={exportAuditToExcel}
              />
            </div>
          </div>
          <div className="audit-money-summary">
            <div className="audit-money-main">
              <span>Disponible sur compte</span>
              <strong>{formatMoney(availableAccountBalance)}</strong>
              <small>
                Rentrées d'argent moins sorties d'argent. C'est le solde cash à suivre.
              </small>
            </div>
            <div className="audit-money-breakdown">
              <AuditRow label="Rentrées d'argent" value={formatMoney(totalCashIn)} tone="paid" />
              <AuditRow label="Sorties d'argent" value={formatMoney(totalCashOut)} tone={totalCashOut ? "warning" : ""} />
              <AuditRow label="Disponible sur compte" value={formatMoney(availableAccountBalance)} tone="bank" />
            </div>
          </div>
          <div className="audit-note">
            Lecture simple : tout ce qui est rentré moins tout ce qui a servi à acheter la marchandise vendue ou encore en stock.
          </div>
        </section>

        {staffAuditOpen ? (
        <section className="section staff-audit-section">
          <div className="section-head">
            <div>
              <h2>Audit par personne</h2>
              <span>Ventes, dépôts, liquide restant et historique par manager ou vendeur</span>
            </div>
          </div>
          {staffAuditRows.length ? (
            <div className="staff-audit-layout">
              <div className="staff-audit-list">
                {staffAuditRows.map((person) => (
                  <button
                    className={selectedAuditPerson?.key === person.key ? "active" : ""}
                    key={person.key}
                    type="button"
                    onClick={() => setSelectedAuditPersonKey(person.key)}
                  >
                    <span>
                      <strong>{person.name}</strong>
                      <small>{person.articlesSold} article{person.articlesSold > 1 ? "s" : ""} vendu{person.articlesSold > 1 ? "s" : ""}</small>
                    </span>
                    <b>{formatMoney(person.cashToDeposit)}</b>
                  </button>
                ))}
              </div>
              {selectedAuditPerson ? (
                <div className="staff-audit-detail">
                  <div className="staff-audit-head">
                    <div>
                      <h3>{selectedAuditPerson.name}</h3>
                      <span>{selectedAuditPerson.records.length} vente{selectedAuditPerson.records.length > 1 ? "s" : ""} suivie{selectedAuditPerson.records.length > 1 ? "s" : ""}</span>
                    </div>
                    <strong>{formatMoney(selectedAuditPerson.saleAmount)}</strong>
                  </div>
                  <div className="staff-audit-metrics">
                    <AuditRow label="Articles vendus" value={selectedAuditPerson.articlesSold} />
                    <AuditRow label="Ventes" value={formatMoney(selectedAuditPerson.saleAmount)} tone="paid" />
                    <AuditRow label="Marge" value={formatMoney(selectedAuditPerson.marginAmount)} tone={selectedAuditPerson.marginAmount < 0 ? "warning" : "paid"} />
                    <AuditRow label="Liquide encaissé" value={formatMoney(selectedAuditPerson.cashCollected)} />
                    <AuditRow label="Liquide à déposer" value={formatMoney(selectedAuditPerson.cashToDeposit)} tone={selectedAuditPerson.cashToDeposit ? "warning" : "paid"} />
                    <AuditRow label="Dépôts effectués" value={formatMoney(selectedAuditPerson.depositsMade)} />
                  </div>
                  <div className="staff-history">
                    {selectedAuditPerson.records.slice(0, 8).map((record) => (
                      <div className="staff-history-row" key={record.id}>
                        <span>
                          <strong>{record.orderId}</strong>
                          <small>{record.date} · {record.customer}</small>
                        </span>
                        <span>{record.quantity} art.</span>
                        <b>{formatMoney(record.saleAmount)}</b>
                        <em>
                          {Number(record.remainingDepositAmount || 0) <= 0 && Number(record.depositAmount || 0) > 0
                            ? "Déposé"
                            : Number(record.depositAmount || 0) > 0
                              ? "Partiel"
                              : record.paymentMethod}
                        </em>
                      </div>
                    ))}
                  </div>
                  {selectedAuditPerson.depositRecords.length ? (
                    <div className="staff-deposit-history">
                      <strong>Dépôts effectués</strong>
                      {selectedAuditPerson.depositRecords.slice(0, 5).map((record) => (
                        <div className="staff-history-row compact" key={`deposit-${record.id}`}>
                          <span>
                            <strong>{record.orangeMoneyRef || record.orderId}</strong>
                            <small>{record.depositedAt || record.date}</small>
                          </span>
                          <b>{formatMoney(record.depositAmount)}</b>
                          <em>Orange Money</em>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="empty-state compact">
                  Choisis une personne à gauche pour voir ses ventes, ses dépôts et son liquide restant.
                </div>
              )}
            </div>
          ) : (
            <div className="empty-state compact">Aucune vente attribuée pour l'instant.</div>
          )}
        </section>
        ) : null}

        <section className="section audit-panel">
          <div className="section-head">
            <div>
              <h2>À vérifier</h2>
              <span>Uniquement les points qui demandent une action.</span>
            </div>
          </div>
          <div className="audit-issues">
            {auditIssues.length ? (
              auditIssues.map((issue) => (
                <div className={`audit-issue ${issue.tone}`} key={issue.title}>
                  <strong>{issue.title}</strong>
                  <span>{issue.text}</span>
                </div>
              ))
            ) : (
              <div className="empty-state compact">Rien d'urgent à corriger.</div>
            )}
          </div>
        </section>

        <div className="audit-simple-grid">
          <section className="section audit-panel">
            <div className="section-head">
              <div>
                <h2>Détails argent</h2>
                <span>Résumé court pour comprendre le disponible.</span>
              </div>
            </div>
            <div className="audit-list">
              <AuditRow label="Liquide encaissé" value={formatMoney(totalCash)} />
              <AuditRow label="Orange Money direct" value={formatMoney(orangeMoneyRevenue)} />
              <AuditRow label="Coût articles vendus" value={formatMoney(totalCost)} />
              <AuditRow label="Coût stock restant" value={formatMoney(inventoryCostValue)} />
            </div>
          </section>

          <section className="section audit-panel">
            <div className="section-head">
              <div>
                <h2>Produits</h2>
                <span>Stock et valeur immobilisée.</span>
              </div>
            </div>
            <div className="audit-list">
              <AuditRow label="Articles disponibles" value={availableAdminProducts.length} tone="paid" />
              <AuditRow label="Épuisés / faibles" value={`${outOfStockProducts.length} / ${lowStockProducts.length}`} tone={outOfStockProducts.length || lowStockProducts.length ? "warning" : "paid"} />
              <AuditRow label="Stock au prix de revient" value={formatMoney(inventoryCostValue)} />
            </div>
          </section>
        </div>

        <section className="section">
          <div className="section-head action-head">
            <div>
              <h2>Articles à contrôler</h2>
              <span>Ruptures et stocks bas, accessibles en un clic</span>
            </div>
            <button className="btn secondary" type="button" onClick={() => navigateAdmin("products")}>
              Voir articles
            </button>
          </div>
          {productsToAudit.length ? (
            <div className="audit-products">
              {productsToAudit.map((product) => (
                <button
                  className="audit-product-row"
                  key={product.id}
                  type="button"
                  onClick={() => {
                    setProductStockView(getProductEffectiveStock(product) <= 0 ? "out_of_stock" : "available");
                    navigateAdmin("products");
                  }}
                >
                  <img src={product.image} alt="" />
                  <span>
                    <strong>{product.name}</strong>
                    <small>{product.category}</small>
                  </span>
                  <b className={getProductEffectiveStock(product) <= 0 ? "danger" : ""}>
                    {getProductEffectiveStock(product)}
                  </b>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">Aucun stock à contrôler.</div>
          )}
        </section>

        <details className="section audit-collapsible">
          <summary>
            <span>
              <strong>Mouvements de stock</strong>
              <small>Dernières sorties, entrées et corrections</small>
            </span>
            <b>{stockMovements.length}</b>
          </summary>
          {stockMovements.length ? (
            <div className="stock-movement-list">
              {stockMovements.slice(0, 10).map((movement) => (
                <div className="stock-movement-row" key={movement.id}>
                  <img src={movement.image} alt="" />
                  <span>
                    <strong>{movement.productName}</strong>
                    <small>
                      {movement.reason} · {movement.createdDate || movement.createdAt?.slice(0, 10)}
                    </small>
                  </span>
                  <b className={movement.delta < 0 ? "negative" : "positive"}>
                    {movement.delta > 0 ? "+" : ""}
                    {movement.delta}
                  </b>
                  <em>
                    {movement.stockBefore} → {movement.stockAfter}
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              Aucun mouvement chargé. Exécute le patch SQL stock/audit pour activer l'historique.
            </div>
          )}
        </details>
        {treasuryPanelOpen ? (
          <div
            className="admin-action-overlay"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) closeTreasuryPanel();
            }}
          >
            <section className="section admin-action-panel">
              <div className="section-head">
                <div>
                  <h2>Mouvement de trésorerie</h2>
                  <span>Sortie, entrée ou correction à rapprocher des comptes BMA</span>
                </div>
                <button className="icon-btn" type="button" onClick={closeTreasuryPanel}>
                  Fermer
                </button>
              </div>
              <form className="admin-form" onSubmit={saveTreasuryMovement}>
                <Field
                  label="Date"
                  value={treasuryForm.date}
                  type="date"
                  onChange={(value) => updateTreasuryForm("date", value)}
                />
                <div className="field">
                  <label>Compte concerné</label>
                  <select
                    value={treasuryForm.account}
                    onChange={(event) => updateTreasuryForm("account", event.target.value)}
                  >
                    <option value="orange_money">Orange Money</option>
                    <option value="djomi">Djomi</option>
                    <option value="cash">Caisse liquide</option>
                    <option value="bank">Banque</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <div className="field">
                  <label>Sens</label>
                  <select
                    value={treasuryForm.direction}
                    onChange={(event) => updateTreasuryForm("direction", event.target.value)}
                  >
                    <option value="out">Sortie d'argent</option>
                    <option value="in">Entrée manuelle</option>
                    <option value="adjustment">Correction positive</option>
                  </select>
                </div>
                <div className="field">
                  <label>Catégorie</label>
                  <select
                    value={treasuryForm.category}
                    onChange={(event) => updateTreasuryForm("category", event.target.value)}
                  >
                    <option value="stock_purchase">Achat de stock</option>
                    <option value="delivery">Transport / livraison</option>
                    <option value="fee">Frais</option>
                    <option value="withdrawal">Retrait</option>
                    <option value="correction">Correction</option>
                    <option value="other">Autre</option>
                  </select>
                </div>
                <Field
                  label="Montant GNF"
                  value={treasuryForm.amount}
                  type="number"
                  min="1"
                  step="1"
                  onChange={(value) => updateTreasuryForm("amount", value)}
                />
                <Field
                  label="Libellé"
                  value={treasuryForm.label}
                  placeholder="Ex : achat cagoules Chine, frais transport, retrait..."
                  onChange={(value) => updateTreasuryForm("label", value)}
                />
                <div className="field full">
                  <label>Note</label>
                  <textarea
                    value={treasuryForm.note}
                    placeholder="Détails utiles pour l'audit."
                    onChange={(event) => updateTreasuryForm("note", event.target.value)}
                  />
                </div>
                <div className="calc-preview full">
                  <div>
                    <span>Impact sur disponible vérifié</span>
                    <strong>
                      {treasuryForm.direction === "out" ? "-" : "+"}
                      {formatMoney(getDraftAmount(treasuryForm.amount))}
                    </strong>
                  </div>
                  <div>
                    <span>Saisi par</span>
                    <strong>{adminDisplayName}</strong>
                  </div>
                </div>
                <button
                  className={`btn ${isTreasurySubmitting ? "loading" : ""}`}
                  disabled={isTreasurySubmitting}
                  type="submit"
                >
                  {isTreasurySubmitting ? "Enregistrement..." : "Enregistrer le mouvement"}
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  function renderCustomers() {
    return (
      <div className="admin-columns customer-admin-grid">
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Clients</h2>
              <span>Commandes groupées par nom, téléphone ou compte connecté</span>
            </div>
            <div className="accounting-actions">
              <ActionButton
                icon="select"
                label={allCustomersSelected ? "Décocher" : "Tout"}
                title={allCustomersSelected ? "Tout décocher" : "Tout cocher"}
                disabled={!customerGroups.length}
                onClick={toggleAllCustomersSelection}
              />
              <ActionButton
                icon="download"
                label="Excel"
                title={selectedCustomerKeys.length ? "Exporter la sélection" : "Exporter les clients"}
                onClick={exportCustomersToExcel}
              />
            </div>
          </div>
          <div className="customer-list">
            {customerGroups.length ? (
              customerGroups.map((customer) => {
                const isChecked = selectedCustomerKeys.includes(customer.key);

                return (
                <div
                  className={`customer-card ${selectedCustomer?.key === customer.key ? "active" : ""} ${
                    isChecked ? "bulk-selected-row" : ""
                  }`}
                  key={customer.key}
                >
                  <label className="order-select-control">
                    <input
                      type="checkbox"
                      aria-label={`Sélectionner ${customer.name}`}
                      checked={isChecked}
                      onChange={() => toggleCustomerSelection(customer.key)}
                    />
                    <span>Sélectionner</span>
                  </label>
                  <button
                    className="customer-card-main"
                    type="button"
                    onClick={() => setSelectedCustomerKey(customer.key)}
                  >
                    <span>
                      <strong>{customer.name}</strong>
                      <small>{customer.phone}</small>
                    </span>
                    <span>
                      <strong>{formatCompact(customer.totalSpent)}</strong>
                      <small>
                        {customer.orders.length} commande{customer.orders.length > 1 ? "s" : ""}
                      </small>
                    </span>
                  </button>
                </div>
                );
              })
            ) : (
              <div className="empty-state compact">Aucun client à afficher pour l'instant.</div>
            )}
          </div>
        </section>

        <section className="section customer-detail">
          <div className="section-head">
            <div>
              <h2>{selectedCustomer?.name || "Client"}</h2>
              <span>{selectedCustomer?.phone || "Aucun téléphone enregistré"}</span>
            </div>
            {selectedCustomer?.phone && selectedCustomer.phone !== "-" ? (
              <a className="btn secondary" href={getWhatsappUrl(selectedCustomer.phone)} target="_blank" rel="noreferrer">
                Contacter
              </a>
            ) : null}
          </div>

          {selectedCustomer ? (
            <div className="customer-detail-body">
              <div className="stats compact-stats">
                <Stat label="Total client" value={formatMoney(selectedCustomer.totalSpent)} />
                <Stat label="Commandes" value={selectedCustomer.orders.length} />
                <Stat label="Payées" value={selectedCustomer.paidOrders} />
              </div>

              <div className="customer-order-list">
                {selectedCustomer.orders.length ? (
                  selectedCustomer.orders.map((order) => (
                    <button
                    className="customer-order-row"
                    key={order.id}
                    type="button"
                    onClick={() => {
                      if (order.isManualSale) {
                        navigateAdmin("accounting");
                        return;
                      }
                      setSelectedOrder(order);
                      navigateAdmin("orders");
                    }}
                  >
                      <span>
                        <strong>{order.id}</strong>
                        <small>{order.createdDate || order.zone}</small>
                      </span>
                      <span>{formatMoney(order.total)}</span>
                      <span className={`status ${order.statusTone || order.tone}`}>{order.status}</span>
                    </button>
                  ))
                ) : (
                  <div className="empty-state compact">
                    Client issu d'une vente manuelle. Les commandes site apparaîtront ici.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state">Sélectionne un client.</div>
          )}
        </section>
      </div>
    );
  }

  function renderSettings() {
    return (
      <div className="admin-stack">
        {isSuperAdmin ? (
          <section className="section">
            <div className="section-head">
              <div>
                <h2>Ajouter du personnel</h2>
                <span>Envoyer une invitation admin par email</span>
              </div>
            </div>
            <form className="staff-invite-form" onSubmit={handleStaffInviteSubmit}>
              <Field
                autoComplete="email"
                label="Email"
                type="email"
                value={staffInviteForm.email}
                onChange={(value) => updateStaffInviteForm("email", value)}
              />
              <div className="field">
                <label>Rôle</label>
                <select
                  value={staffInviteForm.role}
                  onChange={(event) => updateStaffInviteForm("role", event.target.value)}
                >
                  <option value="staff">Vendeur</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <button className="btn" type="submit" disabled={isStaffInviteSubmitting}>
                {isStaffInviteSubmitting ? "Envoi..." : "Envoyer l'invitation"}
              </button>
            </form>
          </section>
        ) : null}

        {canViewTeamSettings ? (
          <section className="section">
            <div className="section-head">
              <div>
                <h2>Personnel</h2>
                <span>
                  {isSuperAdmin
                    ? "Voir les accès, modifier les rôles ou retirer un membre"
                    : "Voir les accès de l'équipe. Les changements sont réservés au super admin."}
                </span>
              </div>
              <ActionButton
                icon="select"
                label="Actualiser"
                title="Actualiser le personnel"
                disabled={isStaffLoading}
                onClick={() => refreshStaffMembers()}
              />
            </div>
            {isStaffLoading && !staffMembers.length ? (
              <div className="empty-state compact">Chargement du personnel...</div>
            ) : staffMembers.length ? (
              <div className="staff-members-list">
                {staffMembers.map((member) => (
                  <div className="staff-member-row" key={member.id}>
                    <div className="staff-member-main">
                      <strong>{member.name || member.email || "Membre BMA"}</strong>
                      <span>
                        {member.email || "Email indisponible"}
                        {member.is_current_user ? " · toi" : ""}
                      </span>
                    </div>
                    <div className="staff-member-meta">
                      <span>{staffRoleLabels[member.role] || member.role}</span>
                      {member.last_sign_in_at ? (
                        <small>Vu le {String(member.last_sign_in_at).slice(0, 10)}</small>
                      ) : (
                        <small>Pas encore connecté</small>
                      )}
                    </div>
                    <select
                      aria-label={`Rôle de ${member.email || member.name}`}
                      value={member.role}
                      disabled={!isSuperAdmin || member.is_current_user || staffActionId === member.id}
                      onChange={(event) => handleStaffRoleChange(member, event.target.value)}
                    >
                      <option value="staff">Vendeur</option>
                      <option value="manager">Manager</option>
                      <option value="owner">Super admin</option>
                    </select>
                    <ActionButton
                      icon="trash"
                      label="Retirer"
                      title="Retirer l'accès admin"
                      className="danger"
                      iconOnly
                      disabled={member.is_current_user || staffActionId === member.id}
                      onClick={() => requestRemoveStaffMember(member)}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact">
                Aucun membre du personnel chargé. Vérifie que l'Edge Function manage-staff est déployée.
              </div>
            )}
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <div>
              <h2>Permissions équipe</h2>
              <span>Changer qui voit quoi sans modifier le code</span>
            </div>
          </div>
          {rolePermissions.length ? (
            <div className="permission-grid">
              {rolePermissions.map((permission) => (
                <div className="permission-row" key={`${permission.role}-${permission.permission_key}`}>
                  <div>
                    <strong>{permission.label}</strong>
                    <span>{permission.role}</span>
                  </div>
                  <button
                    className={`toggle ${permission.is_enabled ? "on" : ""}`}
                    type="button"
                    onClick={() => toggleRolePermission(permission)}
                  >
                    {permission.is_enabled ? "Visible" : "Masqué"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              Les réglages d'équipe ne sont pas encore créés. Exécute le SQL de permissions.
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderActiveSection() {
    if (!canAccessAdminSection(activeSection)) return renderAccounting();
    if (activeSection === "products") return renderProducts();
    if (activeSection === "orders") return renderOrders();
    if (activeSection === "customers") return renderCustomers();
    if (activeSection === "accounting") return renderAccounting();
    if (activeSection === "audit") return renderAudit();
    if (activeSection === "settings") return renderSettings();
    return renderDashboard();
  }

  if (!session) {
    return (
      <div className="admin-login-screen">
        <AdminLogin
          authReady={authReady}
          loginForm={loginForm}
          message={adminToast}
          onChange={updateLoginForm}
          onSubmit={handleAdminLogin}
        />
      </div>
    );
  }

  if (adminAccessStatus === "idle" || adminAccessStatus === "checking") {
    return (
      <div className="admin-login-screen">
        <AdminAccessMessage
          title="Vérification"
          text="On vérifie que ce compte appartient bien à l'équipe BMA."
        />
      </div>
    );
  }

  if (adminAccessStatus === "denied" || !adminContext?.isInternal) {
    return (
      <div className="admin-login-screen">
        <AdminAccessMessage
          title="Accès refusé"
          text="Ce compte est un compte client. Il ne peut pas ouvrir l'administration BMA."
          actionLabel="Se déconnecter"
          onAction={handleAdminSignOut}
        />
      </div>
    );
  }

  return (
    <div className="app admin-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <Brand subtitle="Administration" />
          <div className="sidebar-mobile-actions">
            <button
              className="account-button"
              type="button"
              aria-label="Réglages du compte"
              title="Réglages du compte"
              onClick={() => setAdminAccountOpen(true)}
            >
              <span className="account-icon" aria-hidden="true" />
            </button>
            <button
              className="logout-icon-button"
              type="button"
              aria-label="Déconnexion"
              title="Déconnexion"
              onClick={handleAdminSignOut}
            >
              <span aria-hidden="true" />
            </button>
          </div>
          <button
            className={`admin-menu-button ${adminNavOpen ? "open" : ""}`}
            type="button"
            aria-expanded={adminNavOpen}
            aria-controls="admin-mobile-nav"
            aria-label="Ouvrir le menu administration"
            onClick={() => setAdminNavOpen((current) => !current)}
          >
            <span aria-hidden="true" />
          </button>
        </div>
        <nav
          className={`nav ${adminNavOpen ? "open" : ""}`}
          id="admin-mobile-nav"
          aria-label="Navigation administration"
        >
          {visibleNavItems.map((item) => (
            <button
              aria-current={activeSection === item.id ? "page" : undefined}
              className={activeSection === item.id ? "active" : ""}
              key={item.id}
              onClick={() => navigateAdmin(item.id)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-desktop-actions" aria-label="Compte administrateur">
          <button
            className="account-button"
            type="button"
            aria-label="Reglages du compte"
            title="Compte"
            onClick={() => setAdminAccountOpen(true)}
          >
            <span className="account-icon" aria-hidden="true" />
            <span>Compte</span>
          </button>
          <button
            className="logout-icon-button"
            type="button"
            aria-label="Deconnexion"
            title="Sortir"
            onClick={handleAdminSignOut}
          >
            <span aria-hidden="true" />
          </button>
        </div>
      </aside>

      <main className="admin-main">
        {adminMessage.includes("non charg") ? (
          <div className="checkout-status waiting">{adminMessage}</div>
        ) : null}
        {adminToast && adminToast.tone !== "issue" ? (
          <AdminNoticeToast message={adminToast.text} tone={adminToast.tone} onClose={() => setAdminToast(null)} />
        ) : null}
        {adminToast?.tone === "issue" ? (
          <AdminIssuePopup message={adminToast.text} onClose={() => setAdminToast(null)} />
        ) : null}
        {adminConfirm ? (
          <AdminConfirmDialog
            confirmLabel={adminConfirm.confirmLabel}
            message={adminConfirm.message}
            onCancel={() => setAdminConfirm(null)}
            onConfirm={confirmAdminAction}
            title={adminConfirm.title}
            tone={adminConfirm.tone}
          />
        ) : null}
        {adminAccountOpen ? (
          <div className="auth-overlay">
            <AdminAccountPanel
              email={session?.user?.email}
              form={adminAccountForm}
              message={adminAccountMessage}
              onChange={updateAdminAccountForm}
              onClose={() => setAdminAccountOpen(false)}
              onSubmit={handleAdminAccountSubmit}
            />
          </div>
        ) : null}

        {renderActiveSection()}
      </main>
    </div>
  );
}

function AdminSectionHeader({ activeSection, meta, onNavigate }) {
  const quickActions = [
    ["orders", "Voir commandes"],
    ["accounting", "Vente manuelle"],
    ["customers", "Clients fidèles"],
    ["products", "Ajouter article"],
  ].filter(([id]) => id !== activeSection);

  return (
    <section className="admin-section-header">
      <div>
        <h2>{meta.title}</h2>
        <p>{meta.description}</p>
      </div>
      <div className="admin-section-actions">
        {quickActions.slice(0, 3).map(([id, label]) => (
          <button className="btn secondary" type="button" key={id} onClick={() => onNavigate(id)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function AdminIssuePopup({ message, onClose }) {
  return (
    <div className="admin-error-overlay" role="alertdialog" aria-modal="true">
      <section className="admin-error-popup">
        <div>
          <span>Ça n'a pas marché</span>
          <h2>Action impossible</h2>
          <p>{message}</p>
        </div>
        <button className="btn danger" type="button" onClick={onClose}>
          Fermer
        </button>
      </section>
    </div>
  );
}

function AdminConfirmDialog({ title, message, confirmLabel, tone = "danger", onCancel, onConfirm }) {
  return (
    <div className="admin-modal-overlay" role="dialog" aria-modal="true">
      <section className="admin-confirm-card">
        <div>
          <span>{tone === "danger" ? "Action sensible" : "Confirmation"}</span>
          <h2>{title}</h2>
          <p>{message}</p>
        </div>
        <div className="admin-confirm-actions">
          <button className="btn secondary" type="button" onClick={onCancel}>
            Annuler
          </button>
          <button className={`btn ${tone === "danger" ? "danger" : ""}`} type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function AdminNoticeToast({ message, tone = "paid", onClose }) {
  return (
    <div className={`admin-floating-toast ${tone}`} role="status">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Fermer la notification">
        ×
      </button>
    </div>
  );
}

function AdminLogin({ authReady, loginForm, message, onChange, onSubmit }) {
  return (
    <div className="admin-login-layout">
      <section className="section auth-panel admin-login-card">
        <div className="login-card-head">
          <LogoMark className="login-logo-mark" />
          <h1>Connexion</h1>
        </div>
        {message?.tone === "issue" ? (
          <div className="checkout-status issue">{message.text}</div>
        ) : null}
        <form className="admin-form" onSubmit={onSubmit}>
          <Field
            autoComplete="email"
            label="Email"
            type="email"
            value={loginForm.email}
            onChange={(value) => onChange("email", value)}
          />
          <Field
            autoComplete="current-password"
            label="Mot de passe"
            type="password"
            value={loginForm.password}
            onChange={(value) => onChange("password", value)}
          />
          <button className="btn" disabled={!authReady} type="submit">
            {authReady ? "Se connecter" : "Chargement..."}
          </button>
        </form>
      </section>
    </div>
  );
}

function AdminAccessMessage({ title, text, actionLabel, onAction }) {
  return (
    <div className="admin-login-layout">
      <section className="section auth-panel admin-login-card admin-access-card">
        <div className="login-card-head">
          <LogoMark className="login-logo-mark" />
          <h1>{title}</h1>
        </div>
        <p className="admin-access-text">{text}</p>
        {actionLabel && onAction ? (
          <button className="btn" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </section>
    </div>
  );
}

function AdminHero({
  cashToDeposit,
  financeHealth,
  marginAmount,
  marginRate,
  meta,
  onNavigate,
  openOrders,
  totalRevenue,
}) {
  return (
    <section className="admin-hero-panel">
      <div className="admin-hero-copy">
        <span>{meta.kicker}</span>
        <h2>{meta.title}</h2>
        <p>{meta.description}</p>
        <div className="admin-quick-actions">
          <button type="button" onClick={() => onNavigate("products")}>
            Nouvel article
          </button>
          <button type="button" onClick={() => onNavigate("orders")}>
            Voir commandes
          </button>
          <button type="button" onClick={() => onNavigate("accounting")}>
            Caisse
          </button>
        </div>
      </div>
      <div className="admin-hero-metrics" aria-label="Résumé administration">
        <div>
          <span>Commandes ouvertes</span>
          <strong>{openOrders}</strong>
        </div>
        <div>
          <span>Ventes suivies</span>
          <strong>{formatCompact(totalRevenue)}</strong>
        </div>
        <div>
          <span>Marge</span>
          <strong className={marginAmount < 0 ? "negative" : ""}>
            {formatCompact(marginAmount)}
          </strong>
          <small>{marginRate}%</small>
        </div>
        <div>
          <span>État caisse</span>
          <strong>{financeHealth}</strong>
          <small>{formatCompact(cashToDeposit)}</small>
        </div>
      </div>
    </section>
  );
}

function AccountingCharts({ records, totalRevenue, totalCost, totalCash, depositedCash }) {
  const margin = totalRevenue - totalCost;
  const pendingCash = Math.max(0, totalCash - depositedCash);
  const traceableCash = records
    .filter((record) => ["Liquide", "Djomi", "Orange Money"].includes(record.paymentMethod))
    .reduce((sum, record) => sum + Number(record.saleAmount || 0), 0);
  const maxMainValue = Math.max(totalRevenue, totalCost, Math.abs(margin), 1);
  const methodRows = ["Liquide", "Djomi", "Orange Money"].map((method) => ({
    label: method,
    value: records
      .filter((record) => record.paymentMethod === method)
      .reduce((sum, record) => sum + Number(record.saleAmount || 0), 0),
  }));
  const maxMethodValue = Math.max(...methodRows.map((row) => row.value), 1);

  const mainRows = [
    { label: "Chiffre d'affaires", value: totalRevenue, tone: "revenue" },
    { label: "Achats réels", value: totalCost, tone: "cost" },
    { label: "Bénéfice brut", value: margin, tone: margin < 0 ? "danger" : "profit" },
    { label: "Disponible tracé", value: traceableCash, tone: "method" },
    { label: "Liquide non déposé", value: pendingCash, tone: "cash" },
  ];

  return (
    <div className="chart-grid">
      <section className="section chart-panel">
        <div className="section-head">
          <div>
            <h2>Vue comptable</h2>
            <span>Ventes, achats réels, bénéfice et liquide restant</span>
          </div>
        </div>
        <div className="bar-chart">
          {mainRows.map((row) => (
            <BarRow
              key={row.label}
              label={row.label}
              max={maxMainValue}
              tone={row.tone}
              value={row.value}
            />
          ))}
        </div>
      </section>

      <section className="section chart-panel">
        <div className="section-head">
          <div>
            <h2>Encaissements</h2>
            <span>Répartition par mode de paiement</span>
          </div>
        </div>
        <div className="bar-chart">
          {methodRows.map((row) => (
            <BarRow
              key={row.label}
              label={row.label}
              max={maxMethodValue}
              tone="method"
              value={row.value}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function BarRow({ label, value, max, tone }) {
  const width = `${Math.min(100, Math.round((Math.abs(value) / max) * 100))}%`;

  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <strong className={value < 0 ? "negative" : ""}>{formatMoney(value)}</strong>
      </div>
      <div className="bar-track" aria-hidden="true">
        <div className={`bar-fill ${tone}`} style={{ width }} />
      </div>
    </div>
  );
}

function formatOrderVariant(item) {
  return [
    item.selectedSize ? `Taille ${item.selectedSize}` : null,
    item.selectedColor ? `Couleur ${item.selectedColor}` : null,
  ]
    .filter(Boolean)
    .join(" - ");
}

function OrderItemsPreview({ items = [] }) {
  const visibleItems = items.slice(0, 3);

  if (!items.length) {
    return <span className="muted order-item-empty">Articles non chargés</span>;
  }

  return (
    <div className="order-items-preview" aria-label="Articles commandés">
      <div className="order-preview-images">
        {visibleItems.map((item) => (
          <img src={item.image} alt="" key={item.id} />
        ))}
      </div>
      <span>
        {items[0].name}
        {formatOrderVariant(items[0]) ? <small>{formatOrderVariant(items[0])}</small> : null}
      </span>
      {items.length > 1 ? <small>+{items.length - 1}</small> : null}
    </div>
  );
}

function OrderItemsList({ items = [] }) {
  if (!items.length) {
    return <div className="empty-state compact">Articles de cette commande non chargés.</div>;
  }

  return (
    <div className="order-items-list">
      {items.map((item) => {
        const variant = formatOrderVariant(item);

        return (
          <div className="order-item-detail" key={item.id}>
            <img src={item.image} alt="" />
            <div>
              <strong>{item.name}</strong>
              <span>
                Qté {item.quantity} - {formatMoney(item.unitPrice)}
              </span>
              <div className="order-option-list">
                {item.selectedSize ? (
                  <span className="order-option-pill">Taille {item.selectedSize}</span>
                ) : null}
                {item.selectedColor ? (
                  <span className="order-option-pill">Couleur {item.selectedColor}</span>
                ) : null}
                {!variant ? <small>Option non précisée</small> : null}
              </div>
            </div>
            <b>{formatMoney(item.total)}</b>
          </div>
        );
      })}
    </div>
  );
}

function OrdersTable({
  orders,
  onSelect,
  onToggleAll,
  onToggleOrder,
  allSelected = false,
  filterLabel = "",
  selectedOrderId = "",
  selectedOrderIds = [],
  updatingOrderId = "",
}) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{filterLabel ? `Commandes - ${filterLabel}` : "Commandes"}</h2>
          <span>
            {orders.length} commande{orders.length > 1 ? "s" : ""} dans cette vue
          </span>
        </div>
        <ActionButton
          icon="select"
          label={allSelected ? "Décocher" : "Tout"}
          title={allSelected ? "Tout décocher" : "Tout cocher"}
          disabled={!orders.length || updatingOrderId === "bulk"}
          onClick={onToggleAll}
        />
      </div>
      <div className="table-wrap orders-table-wrap">
        <table className="table orders-table">
          <thead>
            <tr>
              <th>Commande</th>
              <th>Client</th>
              <th>Zone</th>
              <th>Total</th>
              <th>Suivi</th>
            </tr>
          </thead>
          <tbody>
            {orders.length ? (
              orders.map((order) => {
                const isChecked = selectedOrderIds.includes(order.rawId);

                return (
                  <tr
                    className={[
                      selectedOrderId === order.id ? "selected-row" : "",
                      isChecked ? "bulk-selected-row" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={order.id}
                    onClick={() => onSelect(order)}
                    tabIndex="0"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(order);
                      }
                    }}
                  >
                    <td>
                      <label className="order-select-control" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${order.id}`}
                          checked={isChecked}
                          onChange={() => onToggleOrder(order.rawId)}
                        />
                        <span>Sélectionner</span>
                      </label>
                      <strong>{order.id}</strong>
                      <br />
                      <span className="muted">
                        {order.itemsCount || order.items || 0} article
                        {(order.itemsCount || order.items || 0) > 1 ? "s" : ""}
                      </span>
                      <OrderItemsPreview items={order.orderItems} />
                    </td>
                    <td>
                      {order.customer}
                      <br />
                      <span className="muted">{order.phone}</span>
                    </td>
                    <td>
                      {order.zone}
                      <br />
                      <span className="muted">{order.addressType}</span>
                    </td>
                    <td>{formatMoney(order.total)}</td>
                    <td>
                      <div className="order-status-stack">
                        <span className={`status ${order.paymentTone || order.tone}`}>
                          {order.payment}
                        </span>
                        <span className={`status ${order.statusTone || order.tone}`}>
                          {order.status}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan="5">
                  <div className="empty-state compact">Aucune commande pour le moment.</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function QuantityControl({ value, max, onChange, compact = false }) {
  const currentValue = clampQuantity(value, max);
  const maxValue = Math.max(0, Number(max) || 0);

  return (
    <div className={`quantity-control ${compact ? "compact" : ""}`}>
      <button
        type="button"
        aria-label="Diminuer la quantite"
        disabled={currentValue <= 1 || maxValue <= 0}
        onClick={() => onChange(currentValue - 1)}
      >
        -
      </button>
      <input
        aria-label="Quantite"
        inputMode="numeric"
        pattern="[0-9]*"
        type="text"
        value={currentValue || ""}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
      />
      <button
        type="button"
        aria-label="Augmenter la quantite"
        disabled={currentValue >= maxValue || maxValue <= 0}
        onClick={() => onChange(currentValue + 1)}
      >
        +
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  step,
  autoComplete,
  placeholder,
  disabled = false,
  required = false,
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        autoComplete={autoComplete}
        min={min}
        step={step}
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function DetailPanel({ title, emptyText, children, onClose }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <span>{emptyText}</span>
        </div>
        {onClose ? (
          <button className="icon-btn order-detail-close" type="button" onClick={onClose}>
            Fermer
          </button>
        ) : null}
      </div>
      <div className="detail-panel">{children}</div>
    </section>
  );
}

function LogoMark({ className = "" }) {
  return (
    <span className={`logo-frame ${className}`.trim()} aria-hidden="true">
      <img className="bma-logo-image" src="/bma-logo.png" alt="" />
    </span>
  );
}

function Brand({ subtitle }) {
  return (
    <div className="brand">
      <LogoMark className="brand-logo-mark" />
      <div>
        <strong>BMA</strong>
        <span>{subtitle}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AuditRow({ label, value, tone = "" }) {
  return (
    <div className={`audit-row ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatCompact(value) {
  const number = Number(value || 0);

  if (number >= 1000000) {
    return `${(number / 1000000).toFixed(1)}M`;
  }

  if (number >= 1000) {
    return `${Math.round(number / 1000)}K`;
  }

  return number.toString();
}

export default App;
