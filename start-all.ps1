# BugBot - Start All Services Script for Windows
# This script starts Runner, Webhook, and provides instructions for ngrok

Write-Host "🚀 Starting BugBot Services..." -ForegroundColor Cyan
Write-Host ""

# Check if Node.js is installed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Function to start a service in a new window
function Start-ServiceInNewWindow {
    param(
        [string]$ServiceName,
        [string]$Command,
        [string]$WorkingDirectory = "."
    )
    
    Write-Host "📦 Starting $ServiceName..." -ForegroundColor Yellow
    
    $scriptBlock = [scriptblock]::Create(@"
        cd '$WorkingDirectory'
        Write-Host "🚀 $ServiceName starting..." -ForegroundColor Green
        $Command
        Write-Host "Press any key to close this window..."
        `$null = `$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
"@)
    
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $scriptBlock
    Start-Sleep -Seconds 2
}

# Start Runner
Write-Host "1️⃣  Starting Runner (Playwright Browser Controller)..." -ForegroundColor Cyan
Start-ServiceInNewWindow -ServiceName "Runner" -Command "npm run dev" -WorkingDirectory "packages/runner"

# Start Webhook
Write-Host "2️⃣  Starting Webhook Server (GitHub Webhook Handler)..." -ForegroundColor Cyan
Start-ServiceInNewWindow -ServiceName "Webhook" -Command "npm run dev" -WorkingDirectory "packages/webhook"

Write-Host ""
Write-Host "✅ Services started in separate windows!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Next Steps:" -ForegroundColor Cyan
Write-Host "   1. Start ngrok in a new terminal:" -ForegroundColor Yellow
Write-Host "      ngrok http 3002" -ForegroundColor White
Write-Host ""
Write-Host "   2. Copy the ngrok HTTPS URL (e.g., https://xxxx.ngrok.io)" -ForegroundColor Yellow
Write-Host ""
Write-Host "   3. Configure GitHub webhook:" -ForegroundColor Yellow
Write-Host "      - URL: https://xxxx.ngrok.io/webhook" -ForegroundColor White
Write-Host "      - Content type: application/json" -ForegroundColor White
Write-Host "      - Events: Pull requests" -ForegroundColor White
Write-Host ""
Write-Host "🔗 Service URLs:" -ForegroundColor Cyan
Write-Host "   Runner:  http://localhost:3001" -ForegroundColor White
Write-Host "   Webhook: http://localhost:3002" -ForegroundColor White
Write-Host "   Health:  http://localhost:3002/health" -ForegroundColor White
Write-Host ""
Write-Host "Press any key to exit this script (services will keep running)..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

