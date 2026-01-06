# BC Test Runner - VS Code Extension

A VS Code extension for running Business Central (AL) tests in Docker containers. Features both manual command execution and AI Agent Tool integration for automated test-driven development workflows.

## Features

- **🧪 Full Test Workflow**: Compile, publish, and execute tests in one command
- **🤖 AI Agent Tools**: 6 MCP tools for AI-assisted test iteration
- **🔐 Secure Credentials**: Credentials stored securely using VS Code SecretStorage
- **📊 HTML Reports**: Beautiful, detailed HTML test reports
- **📁 JSON Configuration**: Schema-validated `bctest.config.json` configuration
- **🔄 Progress Tracking**: Real-time progress updates during test execution
- **📋 Tree Views**: Visual environments and test results in the sidebar

## Requirements

- VS Code 1.95.0 or later
- PowerShell 5.1 or later (PowerShell 7+ recommended)
- [BcContainerHelper](https://github.com/microsoft/navcontainerhelper) PowerShell module
- Docker Desktop (for local development)

## Installation

This extension is distributed manually (not via VS Code Marketplace).

### Option 1: Install from VSIX

1. Download the `.vsix` file
2. In VS Code, open Command Palette (`Ctrl+Shift+P`)
3. Run "Extensions: Install from VSIX..."
4. Select the downloaded file

### Option 2: Development Mode

1. Clone the repository
2. Run `npm install` in the `vscode-extension` folder
3. Run `npm run compile`
4. Press `F5` to launch the extension in debug mode

## Configuration

Create a `bctest.config.json` file in your workspace root:

```json
{
  "$schema": "./node_modules/bc-test-runner/schemas/bctest.config.schema.json",
  "workspacePath": "./",
  "defaultEnvironment": "docker-local",
  "apps": ["App", "TestApp"],
  "testApp": {
    "path": "TestApp",
    "extensionId": "YOUR-TEST-APP-GUID",
    "extensionName": "Your Test App Name",
    "testCodeunitRange": "80000..80099"
  },
  "environments": [
    {
      "name": "docker-local",
      "type": "docker",
      "containerName": "bcserver",
      "server": "http://bcserver",
      "serverInstance": "BC",
      "authentication": "UserPassword",
      "syncMode": "ForceSync"
    }
  ],
  "output": {
    "resultsFolder": ".testresults",
    "keepHistoryCount": 10,
    "formats": ["json", "xml", "html"]
  }
}
```

## Commands

| Command                               | Description                                      |
| ------------------------------------- | ------------------------------------------------ |
| `BC Test Runner: Run Tests`           | Full test workflow (compile → publish → execute) |
| `BC Test Runner: Compile Apps`        | Compile all apps                                 |
| `BC Test Runner: Publish Apps`        | Publish apps to container                        |
| `BC Test Runner: Execute Tests`       | Execute tests (skip compile/publish)             |
| `BC Test Runner: Show Latest Results` | Display latest test results                      |
| `BC Test Runner: Manage Credentials`  | Manage stored credentials                        |
| `BC Test Runner: View HTML Report`    | Open HTML test report                            |
| `BC Test Runner: Cancel Test Run`     | Cancel running tests                             |
| `BC Test Runner: Select Environment`  | Switch target environment                        |
| `BC Test Runner: Initialize Config`   | Create bctest.config.json                        |

## AI Agent Tools

When using VS Code's AI features (Copilot, Claude, etc.), the following tools are available:

| Tool              | Description                                      |
| ----------------- | ------------------------------------------------ |
| `bc-test-run`     | Run complete test workflow with optional filters |
| `bc-test-compile` | Compile AL apps                                  |
| `bc-test-publish` | Publish apps to BC container                     |
| `bc-test-execute` | Execute tests only                               |
| `bc-test-results` | Get latest test results                          |
| `bc-test-config`  | Read/validate configuration                      |

### Example AI Workflow

```
User: Run my BC tests and show me any failures

AI: [Uses bc-test-run tool]
    → Compiles apps
    → Publishes to container
    → Executes tests
    → Returns structured results with failures

AI: I found 2 failing tests:
    1. TestCodeunit.TestMethod1 - Expected 100 but got 99
    2. TestCodeunit.TestMethod2 - Field 'Amount' not found

    Would you like me to examine the test code?
```

## Project Structure

```
vscode-extension/
├── src/
│   ├── extension.ts           # Main entry point
│   ├── config/
│   │   └── ConfigManager.ts   # Config loading and validation
│   ├── credentials/
│   │   └── CredentialManager.ts # Secure credential storage
│   ├── powershell/
│   │   └── PowerShellRunner.ts  # PS execution bridge
│   ├── reports/
│   │   └── ReportGenerator.ts   # HTML report generation
│   ├── tools/
│   │   └── BCTestTools.ts       # MCP Agent Tools
│   └── views/
│       ├── EnvironmentsView.ts  # Environments tree view
│       └── TestResultsView.ts   # Results tree view
├── resources/
│   └── powershell/
│       ├── BCTestRunner.psm1    # PowerShell module
│       ├── BCTestRunner.psd1    # Module manifest
│       └── tests/
│           └── BCTestRunner.Tests.ps1 # Pester tests
├── schemas/
│   └── bctest.config.schema.json # JSON Schema
└── test/
    ├── extension.test.ts        # Main test suite
    ├── powershell.test.ts       # PS bridge tests
    └── suite/
        └── index.ts             # Test runner setup
```

## Development

### Build

```bash
cd vscode-extension
npm install
npm run compile
```

### Watch Mode

```bash
npm run watch
```

### Run Tests

```bash
# TypeScript/Mocha tests
npm test

# PowerShell/Pester tests
cd resources/powershell/tests
Invoke-Pester -Output Detailed
```

### Package

```bash
npm run package
# Creates bc-test-runner-x.x.x.vsix
```

## Troubleshooting

### Container Connection Issues

1. Ensure Docker Desktop is running
2. Verify container name in `bctest.config.json`
3. Check container is started: `docker ps`

### Authentication Failures

1. Re-enter credentials: Command Palette → "BC Test Runner: Manage Credentials"
2. Verify authentication type matches container configuration

### Compilation Errors

The extension parses AL compiler errors and provides:

- File path and line numbers (clickable in output)
- Error codes (e.g., AL0432)
- Structured error data for AI analysis

### Missing BcContainerHelper

Install the required PowerShell module:

```powershell
Install-Module BcContainerHelper -Force
```

## License

MIT License - See LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit a pull request

## Changelog

### 1.0.0

- Initial release
- Full test workflow commands
- AI Agent Tools (MCP)
- Secure credential storage
- HTML test reports
- JSON configuration with schema validation
