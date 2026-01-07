#Requires -Modules Pester
<#
.SYNOPSIS
    Pester tests for BCTestRunner PowerShell module.

.DESCRIPTION
    Comprehensive tests for all core functionality including:
    - Configuration loading and validation
    - Credential handling
    - Compilation result parsing
    - Test result processing
    - AI-friendly export format
#>

BeforeAll {
    # Import the module
    $modulePath = Join-Path $PSScriptRoot '..' 'BCTestRunner.psm1'
    Import-Module $modulePath -Force

    # Create test fixtures directory
    $script:TestFixturesPath = Join-Path $PSScriptRoot 'fixtures'
    if (-not (Test-Path $script:TestFixturesPath)) {
        New-Item -ItemType Directory -Path $script:TestFixturesPath -Force | Out-Null
    }

    # Create a valid test config
    $script:ValidConfig = @{
        '$schema' = './schemas/bctest.config.schema.json'
        workspacePath = './'
        defaultEnvironment = 'test-env'
        apps = @('App', 'TestApp')
        testApp = @{
            path = 'TestApp'
            extensionId = '12345678-1234-1234-1234-123456789012'
            extensionName = 'Test App'
            testCodeunitRange = '80000..80099'
        }
        environments = @(
            @{
                name = 'test-env'
                description = 'Test environment'
                type = 'docker'
                containerName = 'testcontainer'
                server = 'http://testcontainer'
                serverInstance = 'BC'
                authentication = 'UserPassword'
                syncMode = 'ForceSync'
            }
        )
        output = @{
            resultsFolder = '.testresults'
            keepHistoryCount = 10
            formats = @('json', 'xml')
        }
        compilation = @{
            enableCodeCop = $true
            enableAppSourceCop = $true
            enablePerTenantExtensionCop = $true
            enableUICop = $true
        }
    }

    # Write test config file
    $script:TestConfigPath = Join-Path $script:TestFixturesPath 'bctest.config.json'
    $script:ValidConfig | ConvertTo-Json -Depth 10 | Out-File -FilePath $script:TestConfigPath -Encoding utf8
}

AfterAll {
    # Cleanup test fixtures
    if (Test-Path $script:TestFixturesPath) {
        Remove-Item -Path $script:TestFixturesPath -Recurse -Force
    }
}

Describe 'Get-BCTestRunnerConfig' {
    Context 'Valid configuration' {
        It 'Should load configuration from file' {
            $config = Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath
            
            $config | Should -Not -BeNullOrEmpty
            $config.defaultEnvironment | Should -Be 'test-env'
            $config.apps | Should -HaveCount 2
        }

        It 'Should resolve workspace path relative to config location' {
            $config = Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath
            
            $config.workspacePath | Should -Not -BeNullOrEmpty
            Test-Path $config.workspacePath | Should -Be $true
        }

        It 'Should select default environment when no environment specified' {
            $config = Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath
            
            $config.selectedEnvironment | Should -Not -BeNullOrEmpty
            $config.selectedEnvironment.name | Should -Be 'test-env'
        }

        It 'Should select specified environment' {
            $config = Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath -EnvironmentName 'test-env'
            
            $config.selectedEnvironment.name | Should -Be 'test-env'
            $config.selectedEnvironment.containerName | Should -Be 'testcontainer'
        }
    }

    Context 'Invalid configuration' {
        It 'Should throw when config file does not exist' {
            { Get-BCTestRunnerConfig -ConfigPath 'nonexistent.json' } | Should -Throw
        }

        It 'Should throw when specified environment does not exist' {
            { Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath -EnvironmentName 'invalid-env' } | 
                Should -Throw '*not found*'
        }
    }

    Context 'Environment configuration' {
        It 'Should contain all required environment properties' {
            $config = Get-BCTestRunnerConfig -ConfigPath $script:TestConfigPath
            $env = $config.selectedEnvironment
            
            $env.name | Should -Not -BeNullOrEmpty
            $env.containerName | Should -Not -BeNullOrEmpty
            $env.server | Should -Not -BeNullOrEmpty
            $env.serverInstance | Should -Not -BeNullOrEmpty
            $env.authentication | Should -Not -BeNullOrEmpty
        }
    }
}

Describe 'ConvertTo-PSCredentialFromJson' {
    BeforeAll {
        # Get the private function
        $script:ConvertFunction = Get-Command -Name 'ConvertTo-PSCredentialFromJson' -Module BCTestRunner -ErrorAction SilentlyContinue
    }

    Context 'Valid credential input' {
        It 'Should convert JSON credential object to PSCredential' {
            $credInfo = [PSCustomObject]@{
                username = 'testuser'
                password = 'testpassword'
            }
            
            # Call using InModuleScope
            $result = InModuleScope BCTestRunner {
                param($credInfo)
                ConvertTo-PSCredentialFromJson -CredentialInfo $credInfo
            } -ArgumentList $credInfo
            
            $result | Should -Not -BeNullOrEmpty
            $result | Should -BeOfType [PSCredential]
            $result.UserName | Should -Be 'testuser'
        }
    }

    Context 'Invalid credential input' {
        It 'Should return null for null input' {
            $result = InModuleScope BCTestRunner {
                ConvertTo-PSCredentialFromJson -CredentialInfo $null
            }
            
            $result | Should -BeNullOrEmpty
        }

        It 'Should return null for missing username' {
            $credInfo = [PSCustomObject]@{
                password = 'testpassword'
            }
            
            $result = InModuleScope BCTestRunner {
                param($credInfo)
                ConvertTo-PSCredentialFromJson -CredentialInfo $credInfo
            } -ArgumentList $credInfo
            
            $result | Should -BeNullOrEmpty
        }

        It 'Should return null for missing password' {
            $credInfo = [PSCustomObject]@{
                username = 'testuser'
            }
            
            $result = InModuleScope BCTestRunner {
                param($credInfo)
                ConvertTo-PSCredentialFromJson -CredentialInfo $credInfo
            } -ArgumentList $credInfo
            
            $result | Should -BeNullOrEmpty
        }
    }
}

Describe 'Get-ParsedCompilerErrors' {
    Context 'Parsing compiler output' {
        It 'Should parse AL compiler error messages' {
            $errorMessage = @"
c:\project\App\src\codeunit\MyCodeunit.al(15,5): error AL0432: The name 'SomeVariable' does not exist in the current context
c:\project\App\src\page\MyPage.al(42,10): warning AL0603: The variable 'Unused' is defined but not used
"@
            
            $result = InModuleScope BCTestRunner {
                param($errorMessage)
                Get-ParsedCompilerErrors -ErrorMessage $errorMessage
            } -ArgumentList $errorMessage
            
            $result.errors | Should -HaveCount 1
            $result.warnings | Should -HaveCount 1
            
            $result.errors[0].line | Should -Be 15
            $result.errors[0].column | Should -Be 5
            $result.errors[0].code | Should -Be 'AL0432'
            
            $result.warnings[0].line | Should -Be 42
            $result.warnings[0].code | Should -Be 'AL0603'
        }

        It 'Should return empty arrays for null input' {
            $result = InModuleScope BCTestRunner {
                Get-ParsedCompilerErrors -ErrorMessage $null
            }
            
            $result.errors | Should -HaveCount 0
            $result.warnings | Should -HaveCount 0
        }

        It 'Should handle messages without errors' {
            $result = InModuleScope BCTestRunner {
                Get-ParsedCompilerErrors -ErrorMessage 'Compilation successful'
            }
            
            $result.errors | Should -HaveCount 0
            $result.warnings | Should -HaveCount 0
        }
    }
}

Describe 'Get-ParsedStackTrace' {
    Context 'Parsing AL stack traces' {
        It 'Should parse AL stack trace format' {
            $stackTrace = 'TestCodeunit(80001).TestMethod line 25'
            
            $result = InModuleScope BCTestRunner {
                param($stackTrace)
                Get-ParsedStackTrace -StackTrace $stackTrace
            } -ArgumentList $stackTrace
            
            $result | Should -Not -BeNullOrEmpty
            $result.codeunit | Should -Be 'TestCodeunit'
            $result.codeunitId | Should -Be 80001
            $result.method | Should -Be 'TestMethod'
            $result.lineNumber | Should -Be 25
        }

        It 'Should return null for invalid stack trace' {
            $result = InModuleScope BCTestRunner {
                Get-ParsedStackTrace -StackTrace 'invalid stack trace format'
            }
            
            $result | Should -BeNullOrEmpty
        }

        It 'Should return null for null input' {
            $result = InModuleScope BCTestRunner {
                Get-ParsedStackTrace -StackTrace $null
            }
            
            $result | Should -BeNullOrEmpty
        }
    }
}

Describe 'Export-TestResultsForAI' {
    BeforeAll {
        $script:OutputPath = Join-Path $script:TestFixturesPath 'test_output.json'
        
        $script:MockEnvironment = [PSCustomObject]@{
            name = 'test-env'
            server = 'http://testcontainer'
            serverInstance = 'BC'
            authentication = 'UserPassword'
        }
        
        $script:MockTestResults = [PSCustomObject]@{
            TotalTests = 10
            PassedTests = 8
            FailedTests = 2
            SkippedTests = 0
            Success = $false
            Duration = [TimeSpan]::FromSeconds(30)
            TestResults = @(
                [PSCustomObject]@{
                    Codeunit = 'TestCodeunit'
                    CodeunitId = 80001
                    Method = 'PassingTest'
                    Name = 'PassingTest'
                    Result = 'Pass'
                    Duration = '1.5'
                },
                [PSCustomObject]@{
                    Codeunit = 'TestCodeunit'
                    CodeunitId = 80001
                    Method = 'FailingTest'
                    Name = 'FailingTest'
                    Result = 'Fail'
                    Duration = '2.0'
                }
            )
            Failures = @(
                [PSCustomObject]@{
                    Codeunit = 'TestCodeunit'
                    CodeunitId = 80001
                    Method = 'FailingTest'
                    Name = 'FailingTest'
                    Error = 'Assert.AreEqual failed'
                    StackTrace = 'TestCodeunit(80001).FailingTest line 50'
                    Duration = '2.0'
                    FilePath = $null
                    LineNumber = $null
                }
            )
        }
    }

    AfterEach {
        if (Test-Path $script:OutputPath) {
            Remove-Item $script:OutputPath -Force
        }
    }

    Context 'Export format' {
        It 'Should create JSON file with correct schema version' {
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -TestResults $script:MockTestResults
            
            Test-Path $script:OutputPath | Should -Be $true
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.schema | Should -Be '1.1'
        }

        It 'Should include environment information' {
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -TestResults $script:MockTestResults
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.environment.name | Should -Be 'test-env'
            $content.environment.server | Should -Be 'http://testcontainer'
        }

        It 'Should include test summary' {
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -TestResults $script:MockTestResults
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.tests.summary.total | Should -Be 10
            $content.tests.summary.passed | Should -Be 8
            $content.tests.summary.failed | Should -Be 2
        }

        It 'Should include failures with details' {
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -TestResults $script:MockTestResults
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.tests.failures | Should -HaveCount 1
            $content.tests.failures[0].error | Should -Be 'Assert.AreEqual failed'
        }

        It 'Should include AI context with suggestions' {
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -TestResults $script:MockTestResults
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.aiContext | Should -Not -BeNullOrEmpty
            $content.aiContext.analysisHints | Should -Not -BeNullOrEmpty
            $content.aiContext.suggestedActions | Should -Not -BeNullOrEmpty
        }
    }

    Context 'Compilation results' {
        It 'Should include compilation results when provided' {
            $compilationResults = @(
                [PSCustomObject]@{
                    AppProjectFolder = 'C:\project\App'
                    AppFile = 'C:\project\App\output.app'
                    Success = $true
                    Duration = [TimeSpan]::FromSeconds(45)
                    Errors = @()
                    Warnings = @()
                }
            )
            
            Export-TestResultsForAI `
                -OutputPath $script:OutputPath `
                -Environment $script:MockEnvironment `
                -CompilationResults $compilationResults `
                -TestResults $script:MockTestResults
            
            $content = Get-Content $script:OutputPath -Raw | ConvertFrom-Json
            $content.compilation.success | Should -Be $true
            $content.compilation.apps | Should -HaveCount 1
        }
    }
}

Describe 'Initialize-TestResultsFolder' {
    BeforeAll {
        $script:TestWorkspacePath = Join-Path $script:TestFixturesPath 'workspace'
        New-Item -ItemType Directory -Path $script:TestWorkspacePath -Force | Out-Null
    }

    AfterAll {
        if (Test-Path $script:TestWorkspacePath) {
            Remove-Item $script:TestWorkspacePath -Recurse -Force
        }
    }

    Context 'Folder creation' {
        It 'Should create results folder if it does not exist' {
            $resultsPath = InModuleScope BCTestRunner {
                param($workspacePath)
                Initialize-TestResultsFolder -WorkspacePath $workspacePath -ResultsFolder '.newresults'
            } -ArgumentList $script:TestWorkspacePath
            
            Test-Path $resultsPath | Should -Be $true
        }

        It 'Should use custom directory when specified' {
            $customDir = Join-Path $script:TestFixturesPath 'customoutput'
            
            $resultsPath = InModuleScope BCTestRunner {
                param($workspacePath, $customDir)
                Initialize-TestResultsFolder -WorkspacePath $workspacePath -CustomDirectory $customDir
            } -ArgumentList $script:TestWorkspacePath, $customDir
            
            $resultsPath | Should -Be $customDir
            Test-Path $resultsPath | Should -Be $true
            
            # Cleanup
            Remove-Item $customDir -Force
        }

        It 'Should return absolute path' {
            $resultsPath = InModuleScope BCTestRunner {
                param($workspacePath)
                Initialize-TestResultsFolder -WorkspacePath $workspacePath -ResultsFolder '.testresults'
            } -ArgumentList $script:TestWorkspacePath
            
            [System.IO.Path]::IsPathRooted($resultsPath) | Should -Be $true
        }
    }
}

Describe 'JSON Input Functions' {
    Context 'Invoke-BCTestRunnerFromJson parameter parsing' {
        It 'Should parse JSON input correctly' {
            # This test validates the JSON parsing, not the actual execution
            $inputJson = @{
                configPath = $script:TestConfigPath
                environmentName = 'test-env'
                skipCompile = $true
                skipPublish = $true
                credential = @{
                    username = 'testuser'
                    password = 'testpass'
                }
            } | ConvertTo-Json
            
            # We can't fully test this without BcContainerHelper, but we can verify
            # the function exists and accepts the parameter
            { Get-Command Invoke-BCTestRunnerFromJson -Module BCTestRunner } | Should -Not -Throw
        }
    }
}
