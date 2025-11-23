const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// In-memory cart storage
let cart = {
  items: [],
  total: 0
};

// Products
const products = [
  { id: 1, name: 'Product 1', price: 10.99 },
  { id: 2, name: 'Product 2', price: 19.99 },
  { id: 3, name: 'Product 3', price: 29.99 }
];

// Get products
app.get('/api/products', (req, res) => {
  res.json(products);
});

// Get cart
app.get('/api/cart', (req, res) => {
  res.json(cart);
});

// Add item to cart
app.post('/api/cart/add', (req, res) => {
  const { productId } = req.body;
  const product = products.find(p => p.id === productId);
  if (!product) {
    console.log(`[Backend] Add to cart failed: Product not found (ID: ${productId})`);
    return res.status(404).json({ error: 'Product not found' });
  }

  // INTENTIONAL BACKEND BUG for testing:
  // Simulate a backend failure when adding Product 2.
  if (product.id === 2) {
    console.error(`[Backend BUG] Simulated database failure while adding product ${product.name} (ID: ${product.id})`);
    return res.status(500).json({
      error: 'Simulated backend failure while adding item to cart',
      code: 'CART_DB_ERROR'
    });
  }
  // Find existing item in cart
  const existingItem = cart.items.find(item => item.productId === productId);
  if (existingItem) {
    existingItem.quantity += 1;
    console.log(`[Backend] Increased quantity for product in cart: ${product.name} (ID: ${product.id})`);
  } else {
    cart.items.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: 1
    });
    console.log(`[Backend] Added product to cart: ${product.name} (ID: ${product.id})`);
  }
  // Calculate total
  cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  console.log(`[Backend] Cart updated. Total: $${cart.total.toFixed(2)}, Items: ${cart.items.length}`);
  // BUG: Cart count is calculated but not returned in response
  // The frontend expects a 'count' field but we're not sending it
  res.json({
    success: true,
    cart: cart,
    // count: cart.items.reduce((sum, item) => sum + item.quantity, 0) // This line is commented out - BUG!
  });
});

// Remove item from cart
app.post('/api/cart/remove', (req, res) => {
  const { productId } = req.body;
  const beforeCount = cart.items.length;
  cart.items = cart.items.filter(item => item.productId !== productId);
  cart.total = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const afterCount = cart.items.length;
  console.log(`[Backend] Removed product from cart (ID: ${productId}). Items before: ${beforeCount}, after: ${afterCount}. Total: $${cart.total.toFixed(2)}`);
  res.json({ success: true, cart });
});

// Clear cart
app.post('/api/cart/clear', (req, res) => {
  cart = { items: [], total: 0 };
  console.log(`[Backend] Cart cleared.`);
  res.json({ success: true, cart });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

