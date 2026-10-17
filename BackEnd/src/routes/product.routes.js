
const express = require("express");

const router = express.Router();
const pool = require("../db.js");

// Temporary data; PostgreSQL comes later.
const products = [
  { id: 1, name: "Wireless Headphones", price: 1999 },
  { id: 2, name: "Smart Watch", price: 2999 },
  { id: 3, name: "Keyboard", price: 1499 },
];

// GET /api/products
router.get("/", async (req, res, next) => {
try {
    const result = await pool.query(
      "SELECT id, name, price FROM products ORDER BY id"
    );

    res.status(200).json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/products/1
router.get("/:id", async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT id, name, price FROM products WHERE id = $1",
      [Number(req.params.id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
