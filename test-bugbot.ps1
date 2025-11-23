# BugBot - Manual Test Script
# Tests BugBot against the test app

Write-Host "🧪 Testing BugBot..." -ForegroundColor Cyan
Write-Host ""

# Check if services are running
Write-Host "📡 Checking services..." -ForegroundColor Yellow

$runnerRunning = $false
$testAppRunning = $false

try {
    $response = Invoke-WebRequest -Uri "http://localhost:3001/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $runnerRunning = $true
    Write-Host "✅ BugBot Runner is running" -ForegroundColor Green
} catch {
    Write-Host "❌ BugBot Runner is NOT running on port 3001" -ForegroundColor Red
    Write-Host "   Start it with: cd packages/runner && npm run dev" -ForegroundColor Yellow
}

try {
    $response = Invoke-WebRequest -Uri "http://localhost:4200" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    $testAppRunning = $true
    Write-Host "✅ Test App is running" -ForegroundColor Green
} catch {
    Write-Host "❌ Test App is NOT running on port 4200" -ForegroundColor Red
    Write-Host "   Start it with: cd test-app && ./start.sh" -ForegroundColor Yellow
}

Write-Host ""

if (-not $runnerRunning -or -not $testAppRunning) {
    Write-Host "⚠️  Cannot run test - services not ready" -ForegroundColor Yellow
    exit 1
}

# Get bug description from user or use default
$bugDescription = $args[0]
if (-not $bugDescription) {
    $bugDescription = "Test the application to ensure it works correctly"
    Write-Host "ℹ️  No bug description provided, using default:" -ForegroundColor Gray
    Write-Host "   `"$bugDescription`"" -ForegroundColor Gray
    Write-Host ""
}

# Check for API key
if (-not $env:GEMINI_API_KEY -and -not $env:OPENAI_API_KEY) {
    Write-Host "⚠️  Warning: No API key found in environment" -ForegroundColor Yellow
    Write-Host "   Set GEMINI_API_KEY or OPENAI_API_KEY environment variable" -ForegroundColor Yellow
    Write-Host ""
}

Write-Host "🚀 Running BugBot..." -ForegroundColor Cyan
Write-Host "   Target: http://localhost:4200" -ForegroundColor Gray
Write-Host "   Bug: `"$bugDescription`"" -ForegroundColor Gray
Write-Host ""

# Run BugBot
npm run bugbot:dev -- "$bugDescription" --url "http://localhost:4200" --runner-url "http://localhost:3001" --max-steps 20 --headless

Write-Host ""
Write-Host "✅ Test completed!" -ForegroundColor Green
Write-Host "   Check the 'runs' directory for the report" -ForegroundColor Gray

