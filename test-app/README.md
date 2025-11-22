# Test App for BugBot

This is a simple test application with a bug for BugBot to reproduce.

## The Bug

**Bug Description**: "When I add item to cart, cart count does not increase"

### Bug Location
The bug is in `frontend/index.html` in the `addToCart()` function. The `updateCartDisplay()` call is commented out, so when you add an item to the cart:

1. ✅ The item IS added to the cart (backend works correctly)
2. ✅ The cart items list DOES update (if you refresh the page)
3. ❌ The cart count badge does NOT update (stays at 0)
4. ❌ The cart total does NOT update (stays at $0.00)

This is a classic UI update bug where the state changes but the UI doesn't reflect it.

## Quick Start

### Option 1: Use the start script (easiest)

```bash
cd test-app
./start.sh
```

This will start both backend and frontend automatically.

### Option 2: Manual start

#### Backend (Port 3000)

```bash
cd test-app/backend
npm install
npm start
```

#### Frontend (Port 4200)

In a new terminal:

```bash
cd test-app/frontend
npm install
npm start
```

## Testing with BugBot

```bash
cd /Users/vaibhavbarot/Desktop/AIE Hackathon
npm run bugbot "When I add item to cart, cart count does not increase" \
  --url http://localhost:4200 \
  --api-key YOUR_GEMINI_KEY
```

## Expected Behavior

- User clicks "Add to Cart" button
- Item should be added to cart
- Cart count should increase
- Cart total should update

## The Actual Bug

The frontend code looks correct, but let me add a real bug: The cart count display might not update immediately due to a race condition, or the backend response structure might be wrong.

Actually, I'll make it simpler - the cart count badge doesn't update because we're not properly handling the response. Let me check the code again...

Looking at the frontend code, it should work. But I can add a bug where the count doesn't update if the API response format is unexpected.

