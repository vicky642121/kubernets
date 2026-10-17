
import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [products, setProducts] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchProducts() {
      try {
        const response = await fetch(
          "http://localhost:3000/api/products"
        );

        if (!response.ok) {
          throw new Error("Failed to fetch products");
        }

        const result = await response.json();
        setProducts(result.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchProducts();
  }, []);

  if (loading) {
    return <main className="container">Loading products...</main>;
  }

  if (error) {
    return <main className="container">Error: {error}</main>;
  }

  return (
    <main className="container">
      <h1>My Product Store</h1>
      <p>Products are now loaded from the backend API.</p>

      <h2>Products</h2>

      <div className="products">
        {products.map((product) => (
          <article className="product" key={product.id}>
            <h3>{product.name}</h3>
            <p>₹{product.price}</p>

            <button onClick={() => setCount(count + 1)}>
              Add to Cart
            </button>
          </article>
        ))}
      </div>

      <p>Cart items: {count}</p>
    </main>
  );
}

export default App;
