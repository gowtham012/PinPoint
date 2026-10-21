// A production-style component: once minified, nothing in the page says where it came from.
export function Badge({ text }) {
  const el = document.createElement("span");
  el.className = "badge";
  el.textContent = text;
  return el;
}

export function PriceTag({ amount, currency = "USD" }) {
  const el = document.createElement("button");
  el.id = "price";
  el.className = "price-tag";
  el.textContent = new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  return el;
}
