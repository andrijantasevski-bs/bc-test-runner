@{
    # Module manifest for BCTestRunner
    
    # Script module or binary module file associated with this manifest
    RootModule = 'BCTestRunner.psm1'
    
    # Version number of this module
    ModuleVersion = '1.1.0'
    
    # ID used to uniquely identify this module
    GUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    
    # Author of this module
    Author = 'Business Solutions d.o.o.'
    
    # Company or vendor of this module
    CompanyName = 'Business Solutions d.o.o.'
    
    # Description of the functionality provided by this module
    Description = 'PowerShell module for compiling, publishing, and testing Business Central AL apps with AI-friendly output. Supports both interactive use and VSCode extension integration via JSON input.'
    
    # Minimum version of the PowerShell engine required by this module
    PowerShellVersion = '5.1'
    
    # Modules that must be imported into the global environment prior to importing this module
    RequiredModules = @()
    
    # Functions to export from this module
    FunctionsToExport = @(
        'Invoke-BCTestRunner',
        'Invoke-BCTestRunnerFromJson',
        'Invoke-BCCompileFromJson',
        'Invoke-BCPublishFromJson',
        'Invoke-BCExecuteTestsFromJson',
        'Compile-ALApp',
        'Publish-BCApp',
        'Invoke-BCTests',
        'Export-TestResultsForAI',
        'Get-BCTestRunnerConfig'
    )
    
    # Cmdlets to export from this module
    CmdletsToExport = @()
    
    # Variables to export from this module
    VariablesToExport = @()
    
    # Aliases to export from this module
    AliasesToExport = @()
    
    # Private data to pass to the module specified in RootModule/ModuleToProcess
    PrivateData = @{
        PSData = @{
            Tags = @('BusinessCentral', 'AL', 'Testing', 'Docker', 'BcContainerHelper', 'VSCode', 'AI')
            LicenseUri = ''
            ProjectUri = ''
            ReleaseNotes = @'
v1.1.0
- Added JSON input functions for VSCode extension integration
- Added structured error parsing for compilation errors
- Added stack trace parsing for test failures with file/line information
- Added progress reporting for VSCode extension
- Added custom output directory support
- Enhanced AI context with error locations
'@
        }
    }
}
