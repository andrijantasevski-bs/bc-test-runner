/**
 * BC Test Runner - VSCode Extension Entry Point
 *
 * Main extension file that initializes all components and registers
 * commands, views, and AI agent tools.
 */

import * as vscode from "vscode";
import { PowerShellRunner } from "./powershell/PowerShellRunner";
import { CredentialManager } from "./credentials/CredentialManager";
import { ConfigManager } from "./config/ConfigManager";
import { registerTools } from "./tools/BCTestTools";
import { TestResultsTreeDataProvider } from "./views/TestResultsView";
import { EnvironmentsTreeDataProvider } from "./views/EnvironmentsView";
import { ReportGenerator } from "./reports/ReportGenerator";

let outputChannel: vscode.OutputChannel;
let runner: PowerShellRunner;
let credentialManager: CredentialManager;
let configManager: ConfigManager;
let statusBarItem: vscode.StatusBarItem;
let testResultsProvider: TestResultsTreeDataProvider;
let environmentsProvider: EnvironmentsTreeDataProvider;
let reportGenerator: ReportGenerator;

/**
 * Extension activation
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  outputChannel = vscode.window.createOutputChannel("BC Test Runner");
  outputChannel.appendLine("BC Test Runner extension activating...");

  // Initialize components
  runner = new PowerShellRunner(context.extensionPath, outputChannel);
  credentialManager = new CredentialManager(context);
  configManager = new ConfigManager();
  reportGenerator = new ReportGenerator();

  // Check prerequisites
  const psAvailable = await runner.checkPowerShell();
  if (!psAvailable) {
    vscode.window.showErrorMessage(
      "PowerShell (pwsh) is not available. BC Test Runner requires PowerShell 7+ or Windows PowerShell."
    );
  }

  // Initialize status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "bcTestRunner.viewResults";
  updateStatusBar("$(testing-unset-icon) BC Tests");
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Initialize tree views
  testResultsProvider = new TestResultsTreeDataProvider(configManager, runner);
  environmentsProvider = new EnvironmentsTreeDataProvider(
    configManager,
    credentialManager
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "bcTestRunner.results",
      testResultsProvider
    ),
    vscode.window.registerTreeDataProvider(
      "bcTestRunner.environments",
      environmentsProvider
    )
  );

  // Register commands
  registerCommands(context);

  // Register AI agent tools
  registerTools(
    context,
    runner,
    credentialManager,
    configManager,
    outputChannel
  );

  // Set context for when commands are available
  vscode.commands.executeCommand("setContext", "bcTestRunner.isRunning", false);

  outputChannel.appendLine("BC Test Runner extension activated successfully");
}

/**
 * Register all extension commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
  // Run all tests
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.runTests", async () => {
      await runTests();
    })
  );

  // Execute tests only (alias for runTests - apps must be pre-compiled/published)
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.executeTests", async () => {
      await runTests();
    })
  );

  // View latest results
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.viewResults", async () => {
      await viewResults();
    })
  );

  // Open HTML report
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.openReport", async () => {
      await openReport();
    })
  );

  // Select environment
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bcTestRunner.selectEnvironment",
      async () => {
        await selectEnvironment();
      }
    )
  );

  // Set credentials
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.setCredentials", async () => {
      await setCredentials();
    })
  );

  // Clear credentials
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "bcTestRunner.clearCredentials",
      async () => {
        await clearCredentials();
      }
    )
  );

  // Cancel running tests
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.cancelRun", async () => {
      runner.cancel();
      updateStatusBar("$(testing-cancel-icon) Cancelled");
      vscode.commands.executeCommand(
        "setContext",
        "bcTestRunner.isRunning",
        false
      );
    })
  );

  // Refresh views
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.refreshResults", () => {
      testResultsProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.refreshEnvironments", () => {
      environmentsProvider.refresh();
    })
  );

  // Create config file
  context.subscriptions.push(
    vscode.commands.registerCommand("bcTestRunner.createConfig", async () => {
      await createConfig();
    })
  );
}

/**
 * Run tests (assumes apps are already compiled and published)
 */
async function runTests(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    const create = await vscode.window.showWarningMessage(
      "No bctest.config.json found. Would you like to create one?",
      "Create Config",
      "Cancel"
    );
    if (create === "Create Config") {
      await createConfig();
    }
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const env = configManager.getEnvironment(config);

    if (!env) {
      vscode.window.showErrorMessage("No environment configured");
      return;
    }

    // Get credentials
    let credential: { username: string; password: string } | undefined;
    if (
      env.authentication === "UserPassword" ||
      env.authentication === "NavUserPassword"
    ) {
      credential = await credentialManager.getOrPromptCredentials(env.name);
      if (!credential) {
        vscode.window.showWarningMessage(
          "Credentials required for UserPassword authentication"
        );
        return;
      }
    }

    // Update UI state
    vscode.commands.executeCommand(
      "setContext",
      "bcTestRunner.isRunning",
      true
    );
    updateStatusBar("$(sync~spin) Running tests...");

    // Show progress
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "BC Test Runner",
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => {
          runner.cancel();
        });

        progress.report({ message: "Running tests..." });

        const result = await runner.runTests(configPath, env.name, {
          credential,
          cancellationToken: token,
        });

        if (result.cancelled) {
          updateStatusBar("$(testing-cancel-icon) Cancelled");
          return;
        }

        if (result.success && result.data) {
          // result.data now contains the AI results object directly with 'tests' property
          const tests = result.data.tests;
          if (tests) {
            const passed = tests.summary?.passed ?? 0;
            const failed = tests.summary?.failed ?? 0;
            const total = tests.summary?.total ?? 0;

            if (failed === 0) {
              updateStatusBar(
                `$(testing-passed-icon) ${passed}/${total} passed`
              );
              vscode.window.showInformationMessage(
                `All ${total} tests passed!`
              );
            } else {
              updateStatusBar(`$(testing-failed-icon) ${failed} failed`);
              vscode.window.showWarningMessage(
                `Tests completed: ${passed} passed, ${failed} failed`
              );
            }
          }

          // Generate HTML report if configured
          // result.data now has the FilePath property directly
          if (result.data.FilePath) {
            const htmlPath = await reportGenerator.generateReport(
              result.data,
              configManager.getResultsFolder(config)
            );

            if (
              vscode.workspace
                .getConfiguration("bcTestRunner")
                .get("autoOpenReport")
            ) {
              vscode.env.openExternal(vscode.Uri.file(htmlPath));
            }
          }

          // Refresh the results view
          testResultsProvider.refresh();
        } else {
          updateStatusBar("$(testing-error-icon) Error");
          vscode.window.showErrorMessage(`Test run failed: ${result.error}`);
        }
      }
    );
  } catch (error) {
    updateStatusBar("$(testing-error-icon) Error");
    vscode.window.showErrorMessage(
      `Error running tests: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    vscode.commands.executeCommand(
      "setContext",
      "bcTestRunner.isRunning",
      false
    );
  }
}

/**
 * View latest results
 */
async function viewResults(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    vscode.window.showWarningMessage("No bctest.config.json found");
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const resultsFolder = configManager.getResultsFolder(config);

    const result = await runner.getLatestResults(resultsFolder);

    if (result.success && result.data) {
      // Show in webview or output
      const panel = vscode.window.createWebviewPanel(
        "bcTestResults",
        "BC Test Results",
        vscode.ViewColumn.One,
        { enableScripts: true }
      );

      panel.webview.html = reportGenerator.generateWebviewHtml(result.data);
    } else {
      vscode.window.showWarningMessage("No test results found");
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error viewing results: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Open HTML report
 */
async function openReport(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const resultsFolder = configManager.getResultsFolder(config);

    // Find latest HTML report
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(resultsFolder, "TestReport_*.html"),
      null,
      1
    );

    if (files.length > 0) {
      vscode.env.openExternal(files[0]);
    } else {
      vscode.window.showWarningMessage("No HTML report found");
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error opening report: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Select environment
 */
async function selectEnvironment(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const selected = await configManager.selectEnvironment(config);

    if (selected) {
      vscode.window.showInformationMessage(`Selected environment: ${selected}`);
      environmentsProvider.refresh();
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error selecting environment: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Set credentials
 */
async function setCredentials(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const envNames = configManager.getEnvironmentNames(config);

    await credentialManager.showCredentialManager(envNames);
    environmentsProvider.refresh();
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error managing credentials: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Clear credentials
 */
async function clearCredentials(): Promise<void> {
  const configPath = await configManager.findConfigFile();
  if (!configPath) {
    return;
  }

  try {
    const config = await configManager.loadConfig(configPath);
    const envNames = configManager.getEnvironmentNames(config);

    const confirm = await vscode.window.showWarningMessage(
      "Are you sure you want to clear all stored credentials?",
      { modal: true },
      "Clear All"
    );

    if (confirm === "Clear All") {
      await credentialManager.deleteAllCredentials(envNames);
      vscode.window.showInformationMessage("All credentials cleared");
      environmentsProvider.refresh();
    }
  } catch (error) {
    vscode.window.showErrorMessage(
      `Error clearing credentials: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * Create configuration file
 */
async function createConfig(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  let targetFolder: string;
  if (workspaceFolders.length === 1) {
    targetFolder = workspaceFolders[0].uri.fsPath;
  } else {
    const selected = await vscode.window.showQuickPick(
      workspaceFolders.map((f) => ({
        label: f.name,
        detail: f.uri.fsPath,
      })),
      { title: "Select folder for bctest.config.json" }
    );
    if (!selected) {
      return;
    }
    targetFolder = selected.detail!;
  }

  await configManager.createDefaultConfig(targetFolder);
}

/**
 * Update status bar item
 */
function updateStatusBar(text: string): void {
  statusBarItem.text = text;
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  configManager.dispose();
  outputChannel.dispose();
}
