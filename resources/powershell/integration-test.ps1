# Integration test for PowerShell -> TypeScript communication via temp file

Write-Host "=== Integration Test: PowerShell JSON Output ===" -ForegroundColor Cyan

Import-Module .\BCTestRunner.psm1 -Force

# Test 1: Simulate successful test run result
Write-Host "`nTest 1: Successful test run result" -ForegroundColor Yellow
$outputFile1 = Join-Path $PSScriptRoot 'integration-test-1.json'
$env:BC_RESULT_FILE = $outputFile1

$testResult = [PSCustomObject]@{
    Success = $true
    Summary = @{
        Total = 10
        Passed = 8
        Failed = 2
        Skipped = 0
    }
    Failures = @(
        @{
            Codeunit = "TestCodeunit"
            Method = "TestMethod1"
            Error = "Expected value did not match"
        }
    )
    AIResultsFile = "C:\path\to\results.json"
    Duration = "00:01:30"
}

InModuleScope BCTestRunner {
    param($data, $file)
    $env:BC_RESULT_FILE = $file
    Write-JsonResult -Result $data
} -ArgumentList $testResult, $outputFile1

if (Test-Path $outputFile1) {
    $content1 = Get-Content $outputFile1 -Raw
    Write-Host "✓ File created: $outputFile1" -ForegroundColor Green
    Write-Host "  Length: $($content1.Length) bytes"
    
    try {
        $parsed1 = $content1 | ConvertFrom-Json
        Write-Host "✓ Valid JSON" -ForegroundColor Green
        Write-Host "  Success: $($parsed1.Success)"
        Write-Host "  Has Data: $($null -ne $parsed1.Data)"
        Write-Host "  Data.Summary.Total: $($parsed1.Data.Summary.Total)"
        Write-Host "  Data.Summary.Failed: $($parsed1.Data.Summary.Failed)"
        
        # Verify no extra text before/after JSON
        if ($content1.StartsWith('{') -and $content1.EndsWith('}')) {
            Write-Host "✓ Pure JSON (no extra text)" -ForegroundColor Green
        } else {
            Write-Host "✗ JSON has extra text" -ForegroundColor Red
            Write-Host "  First 50 chars: $($content1.Substring(0, [Math]::Min(50, $content1.Length)))"
            Write-Host "  Last 50 chars: $($content1.Substring([Math]::Max(0, $content1.Length - 50)))"
        }
    }
    catch {
        Write-Host "✗ Invalid JSON: $_" -ForegroundColor Red
        Write-Host "  Content: $($content1.Substring(0, [Math]::Min(500, $content1.Length)))"
    }
    
    Remove-Item $outputFile1
} else {
    Write-Host "✗ File not created" -ForegroundColor Red
}

# Test 2: Simulate error result
Write-Host "`nTest 2: Error result" -ForegroundColor Yellow
$outputFile2 = Join-Path $PSScriptRoot 'integration-test-2.json'
$env:BC_RESULT_FILE = $outputFile2

try {
    throw "Simulated error for testing"
}
catch {
    $errorWrapper = @{
        Success = $false
        Error = $_.Exception.Message
        Type = $_.Exception.GetType().FullName
        StackTrace = $_.ScriptStackTrace
    }
    $errorWrapper | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath $outputFile2 -Encoding utf8 -NoNewline
}

if (Test-Path $outputFile2) {
    $content2 = Get-Content $outputFile2 -Raw
    Write-Host "✓ File created: $outputFile2" -ForegroundColor Green
    Write-Host "  Length: $($content2.Length) bytes"
    
    try {
        $parsed2 = $content2 | ConvertFrom-Json
        Write-Host "✓ Valid JSON" -ForegroundColor Green
        Write-Host "  Success: $($parsed2.Success)"
        Write-Host "  Error: $($parsed2.Error)"
        
        # Verify no extra text
        if ($content2.StartsWith('{') -and $content2.EndsWith('}')) {
            Write-Host "✓ Pure JSON (no extra text)" -ForegroundColor Green
        } else {
            Write-Host "✗ JSON has extra text" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "✗ Invalid JSON: $_" -ForegroundColor Red
        Write-Host "  Content: $($content2.Substring(0, [Math]::Min(500, $content2.Length)))"
    }
    
    Remove-Item $outputFile2
} else {
    Write-Host "✗ File not created" -ForegroundColor Red
}

Write-Host "`n=== Integration Test Complete ===" -ForegroundColor Cyan
