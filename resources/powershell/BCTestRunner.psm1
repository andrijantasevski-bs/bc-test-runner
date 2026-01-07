#Requires -Version 5.1
<#
.SYNOPSIS
    BCTestRunner - PowerShell module for Business Central AL app testing automation.

.DESCRIPTION
    This module provides functions to compile, publish, and test Business Central AL apps
    with AI-friendly JSON output for automated analysis and iteration.
    
    Supports both interactive use and programmatic invocation via JSON input for
    integration with VSCode extension and AI Agent tools.

.NOTES
    Prerequisites:
    - BcContainerHelper module (Install-Module BcContainerHelper -Force)
    - Docker Desktop (for local container testing)
    - AL Language extension for VS Code
#>

# Module variables
$script:ModuleRoot = $PSScriptRoot
$script:ConfigFileName = 'bctest.config.json'

# Disable all color/ANSI output to prevent parsing issues
$PSStyle.OutputRendering = 'PlainText'
# Note: $Host.UI.SupportsVirtualTerminal is read-only, cannot set it

#region Helper Functions

function Write-JsonResult {
    <#
    .SYNOPSIS
        Writes result to JSON file if BC_RESULT_FILE environment variable is set.
        Otherwise returns the object for stdout serialization.
    
    .PARAMETER Result
        The result object to write.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSObject]$Result
    )
    
    $resultFile = $env:BC_RESULT_FILE
    
    if ($resultFile) {
        # Write to file
        $wrapper = @{
            Success = $true
            Data = $Result
        }
        
        try {
            $wrapper | ConvertTo-Json -Depth 20 -Compress | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
            Write-Host "##RESULT_WRITTEN##"
        }
        catch {
            $errorWrapper = @{
                Success = $false
                Error = $_.Exception.Message
                Type = $_.Exception.GetType().FullName
                StackTrace = $_.ScriptStackTrace
            }
            $errorWrapper | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
            Write-Host "##RESULT_WRITTEN##"
        }
    }
    else {
        # Return for stdout
        return $Result
    }
}

function Get-BCTestRunnerConfig {
    <#
    .SYNOPSIS
        Loads the BCTestRunner configuration from bctest.config.json.
    
    .PARAMETER ConfigPath
        Path to the config file. Defaults to bctest.config.json in the module folder.
    
    .PARAMETER EnvironmentName
        Name of the environment configuration to use.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$ConfigPath,
        
        [Parameter()]
        [string]$EnvironmentName
    )
    
    if (-not $ConfigPath) {
        $ConfigPath = Join-Path $script:ModuleRoot $script:ConfigFileName
    }
    
    if (-not (Test-Path $ConfigPath)) {
        throw "Configuration file not found: $ConfigPath"
    }
    
    # Resolve to absolute path
    $ConfigPath = (Resolve-Path $ConfigPath).Path
    $configDir = Split-Path $ConfigPath -Parent
    
    $config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    
    # Resolve workspacePath relative to config file location
    if ($config.workspacePath) {
        $workspacePath = Join-Path $configDir $config.workspacePath
        $workspacePath = (Resolve-Path $workspacePath).Path
        $config.workspacePath = $workspacePath
    }
    
    if ($EnvironmentName) {
        $envConfig = $config.environments | Where-Object { $_.name -eq $EnvironmentName }
        if (-not $envConfig) {
            $availableEnvs = ($config.environments | ForEach-Object { $_.name }) -join ', '
            throw "Environment '$EnvironmentName' not found. Available: $availableEnvs"
        }
        $config | Add-Member -NotePropertyName 'selectedEnvironment' -NotePropertyValue $envConfig -Force
    }
    elseif ($config.defaultEnvironment) {
        $envConfig = $config.environments | Where-Object { $_.name -eq $config.defaultEnvironment }
        $config | Add-Member -NotePropertyName 'selectedEnvironment' -NotePropertyValue $envConfig -Force
    }
    
    return $config
}

function Test-BcContainerHelperInstalled {
    <#
    .SYNOPSIS
        Checks if BcContainerHelper module is installed.
    #>
    $module = Get-Module -ListAvailable -Name BcContainerHelper
    if (-not $module) {
        throw @"
BcContainerHelper module is not installed.
Please install it by running:
    Install-Module BcContainerHelper -Force

For more information, see: https://github.com/microsoft/navcontainerhelper
"@
    }
    return $true
}

function Initialize-TestResultsFolder {
    <#
    .SYNOPSIS
        Creates the test results folder if it doesn't exist.
    
    .PARAMETER WorkspacePath
        Path to the workspace root.
    
    .PARAMETER ResultsFolder
        Relative path to the results folder from workspace root.
    
    .PARAMETER CustomDirectory
        Absolute path to custom output directory (overrides ResultsFolder).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$WorkspacePath,
        
        [Parameter()]
        [string]$ResultsFolder = '.testresults',
        
        [Parameter()]
        [string]$CustomDirectory
    )
    
    # Use custom directory if specified
    if ($CustomDirectory) {
        $resultsPath = $CustomDirectory
    }
    else {
        $resultsPath = Join-Path $WorkspacePath $ResultsFolder
    }
    
    if (-not (Test-Path $resultsPath)) {
        New-Item -ItemType Directory -Path $resultsPath -Force | Out-Null
    }
    # Return absolute path
    return (Resolve-Path $resultsPath).Path
}

function ConvertTo-PSCredentialFromJson {
    <#
    .SYNOPSIS
        Converts credential object from JSON input to PSCredential.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [PSObject]$CredentialInfo
    )
    
    if (-not $CredentialInfo) {
        return $null
    }
    
    if (-not $CredentialInfo.username -or -not $CredentialInfo.password) {
        return $null
    }
    
    $securePassword = ConvertTo-SecureString $CredentialInfo.password -AsPlainText -Force
    return New-Object PSCredential($CredentialInfo.username, $securePassword)
}

function Get-ParsedStackTrace {
    <#
    .SYNOPSIS
        Parses AL stack trace to extract file and line information.
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$StackTraceText,
        
        [Parameter()]
        [string]$WorkspacePath
    )
    
    if (-not $StackTraceText) {
        return $null
    }
    
    # Pattern for AL stack traces: CodeunitName(CodeunitId).MethodName line XX
    $pattern = '(?<codeunit>[^(]+)\((?<id>\d+)\)\.(?<method>\w+)\s+line\s+(?<line>\d+)'
    
    $regexMatch = [regex]::Match($StackTraceText, $pattern)
    
    if ($regexMatch.Success) {
        $codeunitName = $regexMatch.Groups['codeunit'].Value.Trim()
        $codeunitId = $regexMatch.Groups['id'].Value
        $methodName = $regexMatch.Groups['method'].Value
        $lineNumber = [int]$regexMatch.Groups['line'].Value
        
        # Try to find the actual file
        $possibleFileName = "$codeunitName.Codeunit.al"
        $foundFile = $null
        
        if ($WorkspacePath) {
            $foundFiles = Get-ChildItem -Path $WorkspacePath -Filter $possibleFileName -Recurse -ErrorAction SilentlyContinue
            if ($foundFiles) {
                $foundFile = $foundFiles[0].FullName
            }
        }
        
        return @{
            codeunit = $codeunitName
            codeunitId = [int]$codeunitId
            method = $methodName
            lineNumber = $lineNumber
            filePath = $foundFile
        }
    }
    
    return $null
}

#endregion

#region Core Functions

function Invoke-BCTests {
    <#
    .SYNOPSIS
        Runs tests in a BC container.
    
    .PARAMETER ContainerName
        Name of the BC container.
    
    .PARAMETER TestCodeunitRange
        Filter for test codeunit IDs (e.g., "80000..80099").
    
    .PARAMETER ExtensionId
        ID of the extension containing tests.
    
    .PARAMETER TestMethod
        Specific test method to run.
    
    .PARAMETER Credential
        Credentials for container authentication.
    
    .PARAMETER TestResultsFile
        Path where test results XML will be saved.
    
    .PARAMETER WorkspacePath
        Workspace path for resolving file locations in stack traces.
    
    .OUTPUTS
        PSObject with test results.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ContainerName,
        
        [Parameter()]
        [string]$TestCodeunitRange,
        
        [Parameter()]
        [string]$ExtensionId,
        
        [Parameter()]
        [string]$TestMethod,
        
        [Parameter()]
        [PSCredential]$Credential,
        
        [Parameter()]
        [string]$TestResultsFile,
        
        [Parameter()]
        [string]$WorkspacePath
    )
    
    Test-BcContainerHelperInstalled | Out-Null
    Import-Module BcContainerHelper -DisableNameChecking
    
    $result = [PSCustomObject]@{
        TotalTests   = 0
        PassedTests  = 0
        FailedTests  = 0
        SkippedTests = 0
        TestResults  = @()
        Failures     = @()
        Success      = $false
        ErrorMessage = $null
        Duration     = $null
        ResultsFile  = $null
    }
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        Write-Host "Running tests in container: $ContainerName"
        
        $runTestsParams = @{
            containerName         = $ContainerName
            detailed              = $true
            returnTrueIfAllPassed = $false
        }
        
        if ($TestCodeunitRange) {
            $runTestsParams['testCodeunitRange'] = $TestCodeunitRange
        }
        
        if ($ExtensionId) {
            $runTestsParams['extensionId'] = $ExtensionId
        }
        
        if ($TestMethod) {
            $runTestsParams['testFunction'] = $TestMethod
        }
        
        if ($Credential) {
            $runTestsParams['credential'] = $Credential
        }
        
        # Use BcContainerHelper shared folder for test results (container-accessible)
        $tempResultsFile = $null
        if ($TestResultsFile) {
            $sharedFolder = "C:\ProgramData\BcContainerHelper"
            $tempResultsFile = Join-Path $sharedFolder "TestResults_$([Guid]::NewGuid().ToString('N')).xml"
            $runTestsParams['XUnitResultFileName'] = $tempResultsFile
            $result.ResultsFile = $TestResultsFile
        }
        
        
        $testResults = Run-TestsInBcContainer @runTestsParams
        
        # Copy results from shared folder to target location and parse
        if ($tempResultsFile -and (Test-Path $tempResultsFile)) {
            # Copy to final destination
            Copy-Item -Path $tempResultsFile -Destination $TestResultsFile -Force
            Remove-Item -Path $tempResultsFile -Force -ErrorAction SilentlyContinue
            
            
            [xml]$xunitResults = Get-Content $TestResultsFile
            
            # Handle multiple assemblies - sum up totals
            $assemblies = @($xunitResults.assemblies.assembly)
            foreach ($assembly in $assemblies) {
                $result.TotalTests += [int]$assembly.total
                $result.PassedTests += [int]$assembly.passed
                $result.FailedTests += [int]$assembly.failed
                $result.SkippedTests += [int]$assembly.skipped
                
                # Extract test results from each assembly's collection
                $tests = @($assembly.collection.test)
                foreach ($test in $tests) {
                    $testInfo = [PSCustomObject]@{
                        Codeunit   = $assembly.name
                        CodeunitId = 0  # Will try to extract from name
                        Method     = $test.method
                        Name       = $test.name
                        Result     = $test.result
                        Duration   = $test.time
                    }
                    
                    # Try to extract codeunit ID from name
                    if ($assembly.name -match '\((\d+)\)') {
                        $testInfo.CodeunitId = [int]$matches[1]
                    }
                    
                    $result.TestResults += $testInfo
                    
                    # Track failures with enhanced context
                    if ($test.result -eq 'Fail') {
                        $failureInfo = [PSCustomObject]@{
                            Codeunit   = $assembly.name
                            CodeunitId = $testInfo.CodeunitId
                            Method     = $test.method
                            Name       = $test.name
                            Error      = $test.failure.message
                            StackTrace = $test.failure.'stack-trace'
                            Duration   = $test.time
                            FilePath   = $null
                            LineNumber = $null
                        }
                        
                        # Parse stack trace for file/line info
                        $stackInfo = Get-ParsedStackTrace -StackTraceText $test.failure.'stack-trace' -WorkspacePath $WorkspacePath
                        if ($stackInfo) {
                            $failureInfo.FilePath = $stackInfo.filePath
                            $failureInfo.LineNumber = $stackInfo.lineNumber
                        }
                        
                        $result.Failures += $failureInfo
                    }
                }
            }
        }
        
        $result.Success = ($result.FailedTests -eq 0) -and ($result.TotalTests -gt 0)
        
        
        if ($result.Success) {
            Write-Host "All tests passed! ($($result.PassedTests)/$($result.TotalTests))"
        }
        else {
            Write-Host "Tests completed with failures: $($result.FailedTests) failed, $($result.PassedTests) passed"
        }
    }
    catch {
        $result.ErrorMessage = $_.Exception.Message
        Write-Host "Test execution failed: $($_.Exception.Message)"
    }
    finally {
        $stopwatch.Stop()
        $result.Duration = $stopwatch.Elapsed
    }
    
    return $result
}

function Export-TestResultsForAI {
    <#
    .SYNOPSIS
        Exports test results in an AI-friendly JSON format.
    
    .PARAMETER OutputPath
        Path to the output JSON file.
    
    .PARAMETER Environment
        Environment configuration used.
    
    .PARAMETER CompilationResults
        Array of compilation results.
    
    .PARAMETER TestResults
        Test execution results.
    
    .PARAMETER IncludeSourceContext
        Include source code context for failures.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$OutputPath,
        
        [Parameter(Mandatory)]
        [PSObject]$Environment,
        
        [Parameter()]
        [PSObject]$TestResults,
        
        [Parameter()]
        [switch]$IncludeSourceContext
    )
    
    $output = [ordered]@{
        schema      = '1.0'
        timestamp   = (Get-Date -Format 'o')
        environment = [ordered]@{
            name           = $Environment.name
            server         = $Environment.server
            serverInstance = $Environment.serverInstance
            authentication = $Environment.authentication
        }
        tests       = [ordered]@{
            success  = $false
            summary  = [ordered]@{
                total   = 0
                passed  = 0
                failed  = 0
                skipped = 0
            }
            duration = $null
            failures = @()
            allTests = @()
        }
        aiContext   = [ordered]@{
            analysisHints    = @(
                'Check failures array for detailed error information',
                'Each failure includes codeunit, method, error message, and stack trace',
                'Use filePath and lineNumber to navigate directly to failure location',
                'Compilation errors include file, line, column, and error code',
                'Consider test isolation if multiple tests fail in the same codeunit'
            )
            suggestedActions = @()
            errorLocations   = @()
        }
    }
    
    # Process test results
    if ($TestResults) {
        $output.tests.success = $TestResults.Success
        $output.tests.summary.total = $TestResults.TotalTests
        $output.tests.summary.passed = $TestResults.PassedTests
        $output.tests.summary.failed = $TestResults.FailedTests
        $output.tests.summary.skipped = $TestResults.SkippedTests
        $output.tests.duration = $TestResults.Duration.ToString()
        
        # Process failures with enhanced context
        foreach ($failure in $TestResults.Failures) {
            $failureInfo = [ordered]@{
                codeunit   = $failure.Codeunit
                codeunitId = $failure.CodeunitId
                method     = $failure.Method
                testName   = $failure.Name
                error      = $failure.Error
                stackTrace = $failure.StackTrace
                duration   = $failure.Duration
                filePath   = $failure.FilePath
                lineNumber = $failure.LineNumber
            }
            $output.tests.failures += $failureInfo
            
            # Add to error locations
            if ($failure.FilePath -or $failure.LineNumber) {
                $output.aiContext.errorLocations += [ordered]@{
                    type       = 'test-failure'
                    file       = $failure.FilePath
                    line       = $failure.LineNumber
                    codeunit   = $failure.Codeunit
                    method     = $failure.Method
                    message    = $failure.Error
                }
            }
        }
        
        # Include all test results for complete picture
        foreach ($test in $TestResults.TestResults) {
            $output.tests.allTests += [ordered]@{
                codeunit   = $test.Codeunit
                codeunitId = $test.CodeunitId
                method     = $test.Method
                name       = $test.Name
                result     = $test.Result
                duration   = $test.Duration
            }
        }
        
        # Generate AI suggestions based on results
        if ($TestResults.FailedTests -gt 0) {
            $output.aiContext.suggestedActions += "Review $($TestResults.FailedTests) failing test(s)"
            
            # Group failures by codeunit
            $failuresByCodeunit = $TestResults.Failures | Group-Object -Property Codeunit
            foreach ($group in $failuresByCodeunit) {
                $output.aiContext.suggestedActions += "Investigate $($group.Count) failure(s) in $($group.Name)"
            }
            
            # Add specific file navigation hints
            $filesWithFailures = $TestResults.Failures | Where-Object { $_.FilePath } | Select-Object -ExpandProperty FilePath -Unique
            foreach ($file in $filesWithFailures) {
                $output.aiContext.suggestedActions += "Check file: $file"
            }
        }
        else {
            $output.aiContext.suggestedActions += 'All tests passed - consider adding more test coverage'
        }
    }
    
    # Add compilation error suggestions
    if (-not $output.compilation.success) {
        $output.aiContext.suggestedActions = @("Fix compilation errors before running tests") + $output.aiContext.suggestedActions
    }
    
    # Write output
    $output | ConvertTo-Json -Depth 20 | Out-File -FilePath $OutputPath -Encoding utf8
    
    Write-Host "Test results exported to: $OutputPath"
    
    # Convert the ordered hashtable to PSCustomObject for proper serialization
    # Then return it so it can be used directly by the calling function
    $outputObject = [PSCustomObject]$output
    return $outputObject
}

#endregion

#region JSON Input Functions (for VSCode Extension integration)

function Invoke-BCTestRunnerFromJson {
    <#
    .SYNOPSIS
        Main entry point for VSCode extension - accepts JSON input via parameter.
    
    .PARAMETER InputJson
        JSON string containing all parameters.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$InputJson
    )
    
    try {
        $params = $InputJson | ConvertFrom-Json
        
        $credential = ConvertTo-PSCredentialFromJson -CredentialInfo $params.credential
        
        $result = Invoke-BCTestRunner `
            -ConfigPath $params.configPath `
            -EnvironmentName $params.environmentName `
            -Credential $credential
        
        # Write result to file or return for stdout
        Write-JsonResult -Result $result
    }
    catch {
        # Handle errors by writing error result to file
        if ($env:BC_RESULT_FILE) {
            $errorWrapper = @{
                Success = $false
                Error = $_.Exception.Message
                Type = $_.Exception.GetType().FullName
                StackTrace = $_.ScriptStackTrace
                TargetObject = $_.TargetObject
                FullyQualifiedErrorId = $_.FullyQualifiedErrorId
            }
            $errorWrapper | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath $env:BC_RESULT_FILE -Encoding utf8 -NoNewline
            Write-Host "##RESULT_WRITTEN##"
        }
        else {
            throw
        }
    }
}

function Invoke-BCExecuteTestsFromJson {
    <#
    .SYNOPSIS
        Execute tests only - accepts JSON input via parameter.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$InputJson
    )
    
    try {
        $params = $InputJson | ConvertFrom-Json
        $config = Get-BCTestRunnerConfig -ConfigPath $params.configPath -EnvironmentName $params.environmentName
        $env = $config.selectedEnvironment
        $credential = ConvertTo-PSCredentialFromJson -CredentialInfo $params.credential
        
        # Initialize results folder
        $resultsFolder = if ($config.output.customDirectory) { 
            $config.output.customDirectory 
        } elseif ($config.output.resultsFolder) { 
            $config.output.resultsFolder 
        } else { 
            '.testresults' 
        }
        $resultsPath = Initialize-TestResultsFolder -WorkspacePath $config.workspacePath -ResultsFolder $resultsFolder -CustomDirectory $config.output.customDirectory
        
        $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
        $testResultsXml = Join-Path $resultsPath "TestResults_$timestamp.xml"
        $aiResultsJson = Join-Path $resultsPath "TestResults_${timestamp}_AI.json"
        
        # Determine codeunit range
        $codeunitRange = if ($params.codeunitFilter) { $params.codeunitFilter } else { $config.testApp.testCodeunitRange }
        
        $testResults = Invoke-BCTests `
            -ContainerName $env.containerName `
            -ExtensionId $config.testApp.extensionId `
            -TestCodeunitRange $codeunitRange `
            -TestMethod $params.testMethod `
            -Credential $credential `
            -TestResultsFile $testResultsXml `
            -WorkspacePath $config.workspacePath
        
        # Export AI-friendly results and get the data object back
        $aiResults = Export-TestResultsForAI `
            -OutputPath $aiResultsJson `
            -Environment $env `
            -TestResults $testResults
        
        # Debug: Check what we got back
        Write-Host "[DEBUG] aiResults type: $($aiResults.GetType().Name)"
        Write-Host "[DEBUG] aiResults is null: $($null -eq $aiResults)"
        if ($aiResults) {
            Write-Host "[DEBUG] aiResults has schema: $($aiResults.schema)"
        }
        
        # Write the full AI results to temp file for TypeScript consumption
        Write-JsonResult -Result $aiResults
    }
    catch {
        # Handle errors by writing error result to file
        if ($env:BC_RESULT_FILE) {
            $errorWrapper = @{
                Success = $false
                Error = $_.Exception.Message
                Type = $_.Exception.GetType().FullName
                StackTrace = $_.ScriptStackTrace
                TargetObject = $_.TargetObject
                FullyQualifiedErrorId = $_.FullyQualifiedErrorId
            }
            $errorWrapper | ConvertTo-Json -Depth 10 -Compress | Out-File -FilePath $env:BC_RESULT_FILE -Encoding utf8 -NoNewline
            Write-Host "##RESULT_WRITTEN##"
        }
        else {
            throw
        }
    }
}

#endregion

#region Main Entry Point

function Invoke-BCTestRunner {
    <#
    .SYNOPSIS
        Main entry point for the BC Test Runner.
    
    .DESCRIPTION
        Runs tests in a BC container and exports results in an AI-friendly format.
    
    .PARAMETER EnvironmentName
        Name of the environment configuration to use.
    
    .PARAMETER ConfigPath
        Path to the configuration file.
    
    .PARAMETER Credential
        Credentials for container authentication. If not provided, will prompt.
    
    .EXAMPLE
        Invoke-BCTestRunner -EnvironmentName 'docker-local'
    #>
    [CmdletBinding()]
    param(
        [Parameter()]
        [string]$EnvironmentName,
        
        [Parameter()]
        [string]$ConfigPath,
        
        [Parameter()]
        [PSCredential]$Credential
    )
    
    $overallStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    # Ensure no ANSI codes
    $PSStyle.OutputRendering = 'PlainText'
    # Note: $Host.UI.SupportsVirtualTerminal is read-only, cannot set it
    
    Write-Host "`n========================================"
    Write-Host "  BC Test Runner - Starting Execution  "
    Write-Host "========================================`n"
    
    # Load configuration
    Write-Host "Loading configuration..."
    $config = Get-BCTestRunnerConfig -ConfigPath $ConfigPath -EnvironmentName $EnvironmentName
    $env = $config.selectedEnvironment
    
    Write-Host "Environment: $($env.name)"
    Write-Host "Server: $($env.server)/$($env.serverInstance)"
    Write-Host "Authentication: $($env.authentication)`n"
    
    # Get credentials if needed
    if ($env.authentication -eq 'UserPassword' -and -not $Credential) {
        Write-Host "UserPassword authentication required. Please enter credentials:"
        $Credential = Get-Credential -Message "Enter credentials for $($env.server)"
    }
    
    # Initialize results folder (use configurable path or default)
    $resultsFolder = if ($config.output.customDirectory) { 
        $config.output.customDirectory 
    } elseif ($config.output.resultsFolder) { 
        $config.output.resultsFolder 
    } else { 
        '.testresults' 
    }
    $resultsPath = Initialize-TestResultsFolder -WorkspacePath $config.workspacePath -ResultsFolder $resultsFolder -CustomDirectory $config.output.customDirectory
    Write-Host "Results will be saved to: $resultsPath"
    
    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $testResultsXml = Join-Path $resultsPath "TestResults_$timestamp.xml"
    $aiResultsJson = Join-Path $resultsPath "TestResults_${timestamp}_AI.json"
    
    # Run tests
    Write-Host "`n--- Test Execution Phase ---`n"
    
    $testResults = Invoke-BCTests `
        -ContainerName $env.containerName `
        -ExtensionId $config.testApp.extensionId `
        -TestCodeunitRange $config.testApp.testCodeunitRange `
        -Credential $Credential `
        -TestResultsFile $testResultsXml `
        -WorkspacePath $config.workspacePath
    
    # Export results and get the AI-friendly object back
    Write-Host "`n--- Exporting Results ---`n"
    
    $aiResults = Export-TestResultsForAI `
        -OutputPath $aiResultsJson `
        -Environment $env `
        -TestResults $testResults
    
    
    $overallStopwatch.Stop()
    
    # Summary
    Write-Host "`n========================================"
    Write-Host "           Execution Summary            "
    Write-Host "========================================"
    Write-Host "Total Duration: $($overallStopwatch.Elapsed.ToString('hh\:mm\:ss'))"
    Write-Host "Tests: $($testResults.PassedTests)/$($testResults.TotalTests) passed" -ForegroundColor $(if ($testResults.Success) { 'Green' } else { 'Yellow' })
    Write-Host "AI Results: $aiResultsJson"
    Write-Host "========================================`n"
    
    # Return the full AI results object with file path
    $aiResults | Add-Member -NotePropertyName 'FilePath' -NotePropertyValue $aiResultsJson -Force
    return $aiResults
}

#endregion

# Export functions
Export-ModuleMember -Function @(
    'Invoke-BCTestRunner',
    'Invoke-BCTestRunnerFromJson',
    'Invoke-BCExecuteTestsFromJson',
    'Invoke-BCTests',
    'Export-TestResultsForAI',
    'Get-BCTestRunnerConfig'
)
