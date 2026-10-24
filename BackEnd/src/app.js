
const express = require("express");
const cors = require("cors");
const productRoutes = require("./routes/product.routes");
const pool = require("./db");

const app = express();
let initializationComplete = false;
app.use(cors());
app.use(express.json());


async function initializeApp() {
 try {
    await pool.query("SELECT 1"); // Test database connection
    initializationComplete = true;
    console.log("Application initialized successfully");
  } catch (error) {
    console.error("Error during application initialization:", error);
    throw error; // Rethrow the error to be caught in the outer catch block
  }
}
// Health-check endpoint
app.get("/api/health", (req, res) => {
  if (!initializationComplete) {
    return res.status(503).json({
      success: false,
      message: "Application is initializing",
    });
  }
  res.status(200).json({
    success: true,
    message: "Product API is healthy",
  });
});

app.get("/api/ready", (req, res) => {
  if (!initializationComplete) {
    return res.status(503).json({
      success: false,
      message: "Application is not ready",
    });
  }
  res.status(200).json({
    success: true,
    message: "Application is ready",
  });
});

// liveness endpoint
app.get("/api/live", (req, res) => {
  res.status(200).send("Application alive");
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

initializeApp();

module.exports = app;
