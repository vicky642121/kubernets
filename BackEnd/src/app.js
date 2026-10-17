
const express = require("express");
const cors = require("cors");
const productRoutes = require("./routes/product.routes");

const app = express();

app.use(cors());
app.use(express.json());

// Health-check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Product API is healthy",
  });
});
// Product endpoints
app.use("/api/products", productRoutes);

app.use((err, req, res, next) => {
  console.error(err.message);

  res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;
