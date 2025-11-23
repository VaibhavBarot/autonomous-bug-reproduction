#!/bin/bash

# Daytona‑friendly start script for test app

set -e

echo "🚀 Starting Test App for BugBot..."
echo ""

echo "📦 Starting backend on port 3000..."
cd backend
npm install
npm start &
BACKEND_PID=$!
cd ..

echo "🌐 Starting frontend on port 4200..."
cd frontend
npm install
npm start &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Test app is starting!"
echo "   Backend:  http://localhost:3000"
echo "   Frontend: http://localhost:4200"
echo ""
echo "Press Ctrl+C to stop all servers"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait

