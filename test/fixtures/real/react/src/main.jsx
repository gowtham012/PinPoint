import { createRoot } from "react-dom/client";
import ProductCard from "./components/ProductCard.jsx";

const products = ["Kettle", "Toaster", "Blender"].map((title, i) => ({ id: i, title, price: 10 + i * 5 }));

function App() {
  return (
    <main>
      <h1 className="site-title">Shop</h1>
      <section className="grid">
        {products.map((p) => <ProductCard key={p.id} title={p.title} price={p.price} />)}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
