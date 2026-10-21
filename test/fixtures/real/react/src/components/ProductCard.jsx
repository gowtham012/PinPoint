import Price from "./Price.jsx";

export default function ProductCard({ title, price }) {
  return (
    <div className="card">
      <h3 className="card-title">{title}</h3>
      <Price value={price} />
    </div>
  );
}
