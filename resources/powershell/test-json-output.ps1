# Test script to verify Write-JsonResult produces valid JSON

Import-Module .\BCTestRunner.psm1 -Force

$outputFile = Join-Path $PSScriptRoot 'test-output.json'
$env:BC_RESULT_FILE = $outputFile

Write-Host "Testing Write-JsonResult with BC_RESULT_FILE set to: $outputFile"

# Create test data
$testData = [PSCustomObject]@{
    Success = $true
    Message = "Test message"
    Count = 42
    Items = @('item1', 'item2', 'item3')
}

# Call the internal function using InModuleScope
InModuleScope BCTestRunner {
    param($data, $file)
    $env:BC_RESULT_FILE = $file
    Write-JsonResult -Result $data
} -ArgumentList $testData, $outputFile

Write-Host "`nChecking if file was created..."
if (Test-Path $outputFile) {
    Write-Host "✓ File created successfully"
    
    Write-Host "`nFile contents:"
    $content = Get-Content $outputFile -Raw
    Write-Host $content
    
    Write-Host "`nValidating JSON..."
    try {
        $parsed = $content | ConvertFrom-Json
        Write-Host "✓ Valid JSON"
        
        Write-Host "`nParsed structure:"
        Write-Host "  Success: $($parsed.Success)"
        Write-Host "  Data type: $($parsed.Data.GetType().Name)"
        Write-Host "  Data.Message: $($parsed.Data.Message)"
        Write-Host "  Data.Count: $($parsed.Data.Count)"
        Write-Host "  Data.Items: $($parsed.Data.Items -join ', ')"
    }
    catch {
        Write-Host "✗ Invalid JSON: $_"
    }
    
    # Clean up
    Remove-Item $outputFile
    Write-Host "`nCleanup complete"
}
else {
    Write-Host "✗ File was not created"
}
