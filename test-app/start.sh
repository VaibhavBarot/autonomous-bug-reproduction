#!/bin/bash

# Start script for test app

echo "🚀 Starting Test App for BugBot..."
echo ""

# Check if ports are available
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Port 3000 is already in use. Backend might already be running."
else
    echo "📦 Starting backend on port 3000..."
    cd backend
    npm install > /dev/null 2>&1
    npm start &
    BACKEND_PID=$!
    cd ..
    sleep 2
fi

if lsof -Pi :4200 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "⚠️  Port 4200 is already in use. Frontend might already be running."
else
    echo "🌐 Starting frontend on port 4200..."
    cd frontend
    npm install > /dev/null 2>&1
    npm start &
    FRONTEND_PID=$!
    cd ..
    sleep 2
fi

echo ""
echo "✅ Test app is running!"
echo "   Backend:  http://localhost:3000"
echo "   Frontend: http://localhost:4200"
echo ""
echo "Press Ctrl+C to stop all servers"

# Wait for user interrupt
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT
wait

