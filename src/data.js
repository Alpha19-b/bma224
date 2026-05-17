export const products = [
  {
    id: "rice",
    name: "Riz local premium",
    category: "Epicerie",
    price: 185000,
    promoPrice: 165000,
    stock: 24,
    image:
      "https://images.unsplash.com/photo-1586201375761-83865001e31c?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "oil",
    name: "Huile végétale 5L",
    category: "Cuisine",
    price: 98000,
    promoPrice: null,
    stock: 16,
    image:
      "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "soap",
    name: "Pack savon familial",
    category: "Maison",
    price: 42000,
    promoPrice: 36000,
    stock: 39,
    image:
      "https://images.unsplash.com/photo-1607006483224-4605a808bb3f?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "juice",
    name: "Jus bissap artisanal",
    category: "Boissons",
    price: 18000,
    promoPrice: null,
    stock: 52,
    image:
      "https://images.unsplash.com/photo-1621263764928-df1444c5e859?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "shirt",
    name: "T-shirt coton",
    category: "Mode",
    price: 75000,
    promoPrice: null,
    stock: 11,
    image:
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "phone",
    name: "Accessoire téléphone",
    category: "Tech",
    price: 35000,
    promoPrice: 29000,
    stock: 8,
    image:
      "https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=900&q=80",
  },
];

export const orders = [
  {
    id: "CMD-20260508-A19F",
    customer: "Aminata",
    phone: "+224 622...",
    zone: "Kaloum",
    addressType: "Retrait",
    items: 2,
    payment: "Payé",
    status: "Prêt retrait",
    tone: "paid",
  },
  {
    id: "CMD-20260508-B72C",
    customer: "Mamadou",
    phone: "+224 620...",
    zone: "Ratoma, Nongo",
    addressType: "Repère manuel",
    items: 4,
    payment: "A la livraison",
    status: "Confirmée",
    tone: "waiting",
  },
  {
    id: "CMD-20260508-C04E",
    customer: "Fatoumata",
    phone: "+224 628...",
    zone: "Matoto",
    addressType: "Point carte",
    items: 1,
    payment: "Djomi",
    status: "Echec livraison",
    tone: "issue",
  },
];

export const deliveries = [
  {
    order: "CMD-20260508-B72C",
    driver: "Ibrahima",
    zone: "Ratoma, Nongo",
    status: "Assignée",
  },
  {
    order: "CMD-20260508-D31A",
    driver: "Mariama",
    zone: "Matam, Madina",
    status: "En route",
  },
];
