/**
 * BC Test Runner - MCP Agent Tools
 *
 * Implements VSCode Language Model Tools for AI agent integration.
 * These tools allow AI to execute BC test operations and iterate on results.
 */

import * as vscode from "vscode";
import { PowerShellRunner } from "../powershell/PowerShellRunner";
import { CredentialManager } from "../credentials/CredentialManager";
import { ConfigManager } from "../config/ConfigManager";

/**
 * Base class for BC Test Runner tools
 */
abstract class BCTestRunnerTool implements vscode.LanguageModelTool<unknown> {
  protected runner: PowerShellRunner;
  protected credentialManager: CredentialManager;
  protected configManager: ConfigManager;
  protected outputChannel: vscode.OutputChannel;

  constructor(
    runner: PowerShellRunner,
    credentialManager: CredentialManager,
    configManager: ConfigManager,
    outputChannel: vscode.OutputChannel
  ) {
    this.runner = runner;
    this.credentialManager = credentialManager;
    this.configManager = configManager;
    this.outputChannel = outputChannel;
  }

  /**
   * Get credentials for an environment
   */
  protected async getCredentials(
    environmentName: string,
    authentication: string
  ): Promise<{ username: string; password: string } | undefined> {
    if (
      authentication !== "UserPassword" &&
      authentication !== "NavUserPassword"
    ) {
      return undefined;
    }

    const stored = await this.credentialManager.getCredential(environmentName);
    if (stored) {
      return { username: stored.username, password: stored.password };
    }

    // For AI tool invocations, we can't prompt interactively
    // Return undefined and let the PowerShell handle it or fail gracefully
    return undefined;
  }

  abstract invoke(
    options: vscode.LanguageModelToolInvocationOptions<unknown>,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.LanguageModelToolResult>;
}

/**
 * Parameters for bc-test-run tool
 */
interface TestRunParams {
  environment?: string;
  skipCompile?: boolean;
  skipPublish?: boolean;
}

/**
 * BC Test Run Tool - Full test pipeline
 */
export class BCTestRunTool extends BCTestRunnerTool {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<TestRunParams>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input as TestRunParams;

    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);
      const envName = params.environment || config.defaultEnvironment;
      const env = config.environments.find((e) => e.name === envName);

      if (!env) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: `Environment '${envName}' not found`,
                availableEnvironments: config.environments.map((e) => e.name),
              },
              null,
              2
            )
          ),
        ]);
      }

      const credential = await this.getCredentials(envName, env.authentication);

      this.outputChannel.appendLine(
        `[Tool] bc-test-run: Starting full test pipeline for environment '${envName}'`
      );
      this.outputChannel.show();

      const result = await this.runner.runTests(configPath, envName, {
        skipCompile: params.skipCompile,
        skipPublish: params.skipPublish,
        credential,
        cancellationToken: token,
        onProgress: (update) => {
          this.outputChannel.appendLine(
            `[${update.activity}] ${update.percentComplete}% - ${update.status}`
          );
        },
      });

      if (result.cancelled) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                cancelled: true,
                message: "Test run was cancelled",
              },
              null,
              2
            )
          ),
        ]);
      }

      // Read the AI results file for detailed output
      if (result.success && result.data?.aiResultsFile) {
        const aiResults = await this.runner.getLatestResults(
          this.configManager.getResultsFolder(config),
          result.data.aiResultsFile
        );

        if (aiResults.success && aiResults.data) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              JSON.stringify(aiResults.data, null, 2)
            ),
          ]);
        }
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: result.success,
              data: result.data,
              error: result.error,
              duration: result.duration,
            },
            null,
            2
          )
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * Parameters for bc-test-compile tool
 */
interface CompileParams {
  environment?: string;
  apps?: string[];
}

/**
 * BC Test Compile Tool - Compile apps only
 */
export class BCTestCompileTool extends BCTestRunnerTool {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CompileParams>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input as CompileParams;

    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);
      const envName = params.environment || config.defaultEnvironment;
      const env = config.environments.find((e) => e.name === envName);

      if (!env) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: `Environment '${envName}' not found`,
              },
              null,
              2
            )
          ),
        ]);
      }

      const credential = await this.getCredentials(envName, env.authentication);

      this.outputChannel.appendLine(
        `[Tool] bc-test-compile: Compiling apps for environment '${envName}'`
      );
      this.outputChannel.show();

      const result = await this.runner.compileApps(
        configPath,
        envName,
        params.apps,
        {
          credential,
          cancellationToken: token,
          onProgress: (update) => {
            this.outputChannel.appendLine(
              `[${update.activity}] ${update.percentComplete}% - ${update.status}`
            );
          },
        }
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: result.success,
              data: result.data,
              error: result.error,
              errorDetails: result.errorDetails,
              duration: result.duration,
            },
            null,
            2
          )
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * Parameters for bc-test-publish tool
 */
interface PublishParams {
  environment?: string;
}

/**
 * BC Test Publish Tool - Publish apps only
 */
export class BCTestPublishTool extends BCTestRunnerTool {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<PublishParams>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input as PublishParams;

    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);
      const envName = params.environment || config.defaultEnvironment;
      const env = config.environments.find((e) => e.name === envName);

      if (!env) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: `Environment '${envName}' not found`,
              },
              null,
              2
            )
          ),
        ]);
      }

      const credential = await this.getCredentials(envName, env.authentication);

      this.outputChannel.appendLine(
        `[Tool] bc-test-publish: Publishing apps for environment '${envName}'`
      );
      this.outputChannel.show();

      const result = await this.runner.publishApps(configPath, envName, {
        credential,
        cancellationToken: token,
        onProgress: (update) => {
          this.outputChannel.appendLine(
            `[${update.activity}] ${update.percentComplete}% - ${update.status}`
          );
        },
      });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: result.success,
              data: result.data,
              error: result.error,
              duration: result.duration,
            },
            null,
            2
          )
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * Parameters for bc-test-execute tool
 */
interface ExecuteParams {
  environment?: string;
  codeunitFilter?: string;
  testMethod?: string;
}

/**
 * BC Test Execute Tool - Execute tests only (skip compile/publish)
 */
export class BCTestExecuteTool extends BCTestRunnerTool {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ExecuteParams>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input as ExecuteParams;

    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);
      const envName = params.environment || config.defaultEnvironment;
      const env = config.environments.find((e) => e.name === envName);

      if (!env) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: `Environment '${envName}' not found`,
              },
              null,
              2
            )
          ),
        ]);
      }

      const credential = await this.getCredentials(envName, env.authentication);

      this.outputChannel.appendLine(
        `[Tool] bc-test-execute: Executing tests for environment '${envName}'`
      );
      if (params.codeunitFilter) {
        this.outputChannel.appendLine(
          `  Codeunit filter: ${params.codeunitFilter}`
        );
      }
      if (params.testMethod) {
        this.outputChannel.appendLine(`  Test method: ${params.testMethod}`);
      }
      this.outputChannel.show();

      const result = await this.runner.executeTests(configPath, envName, {
        credential,
        codeunitFilter: params.codeunitFilter,
        testMethod: params.testMethod,
        cancellationToken: token,
        onProgress: (update) => {
          this.outputChannel.appendLine(
            `[${update.activity}] ${update.percentComplete}% - ${update.status}`
          );
        },
      });

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: result.success,
              data: result.data,
              error: result.error,
              duration: result.duration,
            },
            null,
            2
          )
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * Parameters for bc-test-results tool
 */
interface ResultsParams {
  resultFile?: string;
}

/**
 * BC Test Results Tool - Get latest test results
 */
export class BCTestResultsTool extends BCTestRunnerTool {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ResultsParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const params = options.input as ResultsParams;

    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);
      const resultsFolder = this.configManager.getResultsFolder(config);

      this.outputChannel.appendLine(
        `[Tool] bc-test-results: Reading results from '${resultsFolder}'`
      );

      const result = await this.runner.getLatestResults(
        resultsFolder,
        params.resultFile
      );

      if (!result.success) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: result.error || "No test results found",
              },
              null,
              2
            )
          ),
        ]);
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result.data, null, 2)),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * BC Test Config Tool - Get configuration
 */
export class BCTestConfigTool extends BCTestRunnerTool {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            JSON.stringify(
              {
                success: false,
                error: "No bctest.config.json found in workspace",
                hint: "Create a bctest.config.json file in your workspace root or BCTestRunner folder",
              },
              null,
              2
            )
          ),
        ]);
      }

      const config = await this.configManager.loadConfig(configPath);

      this.outputChannel.appendLine(
        `[Tool] bc-test-config: Loaded configuration from '${configPath}'`
      );

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: true,
              configPath,
              config: {
                defaultEnvironment: config.defaultEnvironment,
                apps: config.apps,
                testApp: config.testApp,
                environments: config.environments.map((e) => ({
                  name: e.name,
                  description: e.description,
                  type: e.type,
                  containerName: e.containerName,
                  server: e.server,
                  authentication: e.authentication,
                })),
                output: config.output,
              },
            },
            null,
            2
          )
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          JSON.stringify(
            {
              success: false,
              error: error instanceof Error ? error.message : String(error),
            },
            null,
            2
          )
        ),
      ]);
    }
  }
}

/**
 * Register all BC Test Runner tools
 */
export function registerTools(
  context: vscode.ExtensionContext,
  runner: PowerShellRunner,
  credentialManager: CredentialManager,
  configManager: ConfigManager,
  outputChannel: vscode.OutputChannel
): void {
  // Register bc-test-run tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-run",
      new BCTestRunTool(runner, credentialManager, configManager, outputChannel)
    )
  );

  // Register bc-test-compile tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-compile",
      new BCTestCompileTool(
        runner,
        credentialManager,
        configManager,
        outputChannel
      )
    )
  );

  // Register bc-test-publish tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-publish",
      new BCTestPublishTool(
        runner,
        credentialManager,
        configManager,
        outputChannel
      )
    )
  );

  // Register bc-test-execute tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-execute",
      new BCTestExecuteTool(
        runner,
        credentialManager,
        configManager,
        outputChannel
      )
    )
  );

  // Register bc-test-results tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-results",
      new BCTestResultsTool(
        runner,
        credentialManager,
        configManager,
        outputChannel
      )
    )
  );

  // Register bc-test-config tool
  context.subscriptions.push(
    vscode.lm.registerTool(
      "bc-test-config",
      new BCTestConfigTool(
        runner,
        credentialManager,
        configManager,
        outputChannel
      )
    )
  );

  outputChannel.appendLine("BC Test Runner tools registered successfully");
}
