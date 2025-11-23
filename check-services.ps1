# BugBot - Service Verification Script for Windows
# Checks if all services are running and accessible

Write-Host "🔍 Checking BugBot Services..." -ForegroundColor Cyan
Write-Host ""

$allRunning = $true

# Function to check if a service is running on a port
function Test-Service {
    param(
        [string]$ServiceName,
        [int]$Port,
        [string]$Url = $null
    )
    
    Write-Host "Checking $ServiceName (Port $Port)..." -ForegroundColor Yellow -NoNewline
    
    try {
        $connection = Test-NetConnection -ComputerName localhost -Port $Port -WarningAction SilentlyContinue -InformationLevel Quiet -ErrorAction Stop
        
        if ($connection) {
            Write-Host " ✅ RUNNING" -ForegroundColor Green
            
            # If URL provided, try to access it
            if ($Url) {
                try {
                    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
                    Write-Host "   Status: $($response.StatusCode) - Accessible" -ForegroundColor Gray
                    return $true
                } catch {
                    Write-Host "   ⚠️  Port open but service may not be responding" -ForegroundColor Yellow
                    return $true  # Port is open, so service is likely running
                }
            }
            return $true
        } else {
            Write-Host " ❌ NOT RUNNING" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host " ❌ NOT RUNNING" -ForegroundColor Red
        return $false
    }
}

# Check Test App Backend (Port 3000)
$backendRunning = Test-Service -ServiceName "Test App Backend" -Port 3000 -Url "http://localhost:3000"
if (-not $backendRunning) { $allRunning = $false }

# Check Test App Frontend (Port 4200)
$frontendRunning = Test-Service -ServiceName "Test App Frontend" -Port 4200 -Url "http://localhost:4200"
if (-not $frontendRunning) { $allRunning = $false }

# Check BugBot Runner (Port 3001)
$runnerRunning = Test-Service -ServiceName "BugBot Runner" -Port 3001 -Url "http://localhost:3001/health"
if (-not $runnerRunning) { $allRunning = $false }

# Check Webhook Server (Port 3002)
$webhookRunning = Test-Service -ServiceName "Webhook Server" -Port 3002 -Url "http://localhost:3002/health"
if (-not $webhookRunning) { $allRunning = $false }

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($allRunning) {
    Write-Host "✅ All services are running!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📍 Service URLs:" -ForegroundColor Cyan
    Write-Host "   Test App Backend:  http://localhost:3000" -ForegroundColor White
    Write-Host "   Test App Frontend: http://localhost:4200" -ForegroundColor White
    Write-Host "   BugBot Runner:     http://localhost:3001" -ForegroundColor White
    Write-Host "   Webhook Server:    http://localhost:3002" -ForegroundColor White
    Write-Host ""
    Write-Host "🧪 Test BugBot:" -ForegroundColor Cyan
    Write-Host "   npm run bugbot:dev -- `"Test the cart functionality`" --url http://localhost:4200" -ForegroundColor Gray
} else {
    Write-Host "❌ Some services are not running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "📋 To start services:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "1. Test App:" -ForegroundColor White
    Write-Host "   cd test-app" -ForegroundColor Gray
    Write-Host "   ./start.sh" -ForegroundColor Gray
    Write-Host "   # Or manually:" -ForegroundColor Gray
    Write-Host "   # Terminal 1: cd test-app/backend && npm start" -ForegroundColor Gray
    Write-Host "   # Terminal 2: cd test-app/frontend && npm start" -ForegroundColor Gray
    Write-Host ""
    Write-Host "2. BugBot Runner:" -ForegroundColor White
    Write-Host "   cd packages/runner" -ForegroundColor Gray
    Write-Host "   npm run dev" -ForegroundColor Gray
    Write-Host ""
    Write-Host "3. Webhook Server:" -ForegroundColor White
    Write-Host "   npm run webhook" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan

