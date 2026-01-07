/**
 * BC Test Runner - PowerShell Execution Bridge
 *
 * Provides TypeScript interface for executing PowerShell module functions
 * with JSON-based communication, progress reporting, and cancellation support.
 */

import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

/**
 * Result from PowerShell execution
 */
export interface PowerShellResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorDetails?: PowerShellError;
  duration: number;
  cancelled: boolean;
}

/**
 * Structured error from PowerShell
 */
export interface PowerShellError {
  message: string;
  type: string;
  scriptStackTrace?: string;
  targetObject?: string;
  fullyQualifiedErrorId?: string;
}

/**
 * Options for PowerShell execution
 */
export interface ExecutionOptions {
  /** Working directory for the command */
  workingDirectory?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Cancellation token */
  cancellationToken?: vscode.CancellationToken;
  /** Output callback for raw output */
  onOutput?: (output: string) => void;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Input data to pass via stdin as JSON */
  stdinData?: unknown;
}

/**
 * PowerShell execution bridge for BC Test Runner
 */
export class PowerShellRunner {
  private outputChannel: vscode.OutputChannel;
  private modulePath: string;
  private powershellPath: string;
  private runningProcess: ChildProcess | null = null;

  constructor(
    private extensionPath: string,
    outputChannel?: vscode.OutputChannel
  ) {
    this.outputChannel =
      outputChannel ?? vscode.window.createOutputChannel("BC Test Runner");
    this.modulePath = path.join(
      extensionPath,
      "resources",
      "powershell",
      "BCTestRunner.psm1"
    );
    this.powershellPath = vscode.workspace
      .getConfiguration("bcTestRunner")
      .get("powershellPath", "pwsh");
  }

  /**
   * Check if PowerShell is available
   */
  async checkPowerShell(): Promise<boolean> {
    try {
      const result = await this.executeRaw(
        "$PSVersionTable.PSVersion.ToString()",
        {
          timeout: 10000,
        }
      );
      if (result.success && result.data) {
        this.outputChannel.appendLine(`PowerShell version: ${result.data}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if BcContainerHelper module is available
   */
  async checkBcContainerHelper(): Promise<boolean> {
    const script = `
            $WarningPreference = 'SilentlyContinue'
            $ProgressPreference = 'SilentlyContinue'
            if (Get-Module -ListAvailable -Name BcContainerHelper) {
                $version = (Get-Module -ListAvailable -Name BcContainerHelper | Select-Object -First 1).Version.ToString()
                @{ Available = $true; Version = $version } | ConvertTo-Json
            } else {
                @{ Available = $false } | ConvertTo-Json
            }
        `;

    const result = await this.executeRaw(script, { timeout: 30000 });
    if (result.success && result.data) {
      try {
        const parsed = JSON.parse(result.data as string);
        if (parsed.Available) {
          this.outputChannel.appendLine(
            `BcContainerHelper version: ${parsed.Version}`
          );
          return true;
        }
      } catch {
        // Parse error
      }
    }
    return false;
  }

  /**
   * Import the BCTestRunner module
   */
  async importModule(): Promise<PowerShellResult<void>> {
    const script = `
            $WarningPreference = 'SilentlyContinue'
            $ProgressPreference = 'SilentlyContinue'
            $global:WarningPreference = 'SilentlyContinue'
            try {
                Import-Module "${this.modulePath.replace(
                  /\\/g,
                  "\\\\"
                )}" -Force -ErrorAction Stop -WarningAction SilentlyContinue -DisableNameChecking 3>$null
                @{ Success = $true } | ConvertTo-Json
            } catch {
                @{ 
                    Success = $false
                    Error = $_.Exception.Message
                    Type = $_.Exception.GetType().Name
                } | ConvertTo-Json
            }
        `;

    const result = await this.executeRaw(script, { timeout: 30000 });
    if (result.success && result.data) {
      try {
        const parsed = JSON.parse(result.data as string);
        return {
          success: parsed.Success,
          error: parsed.Error,
          duration: result.duration,
          cancelled: false,
        };
      } catch {
        return {
          success: false,
          error: "Failed to parse module import result",
          duration: result.duration,
          cancelled: false,
        };
      }
    }
    return result as PowerShellResult<void>;
  }

  /**
   * Execute the test pipeline (assumes apps are already compiled/published)
   */
  async runTests(
    configPath: string,
    environmentName?: string,
    options?: ExecutionOptions & {
      credential?: { username: string; password: string };
    }
  ): Promise<PowerShellResult<TestRunResult>> {
    const stdinData = {
      configPath,
      environmentName,
      credential: options?.credential,
    };

    const script = this.buildInvokeScript("Invoke-BCTestRunnerFromJson");
    return this.executeWithProgress<TestRunResult>(script, {
      ...options,
      stdinData,
    });
  }

  /**
   * Execute tests only
   */
  async executeTests(
    configPath: string,
    environmentName?: string,
    options?: ExecutionOptions & {
      credential?: { username: string; password: string };
      codeunitFilter?: string;
      testMethod?: string;
    }
  ): Promise<PowerShellResult<TestExecutionResult>> {
    const stdinData = {
      configPath,
      environmentName,
      credential: options?.credential,
      codeunitFilter: options?.codeunitFilter,
      testMethod: options?.testMethod,
      operation: "test",
    };

    const script = this.buildInvokeScript("Invoke-BCExecuteTestsFromJson");
    return this.executeWithProgress<TestExecutionResult>(script, {
      ...options,
      stdinData,
    });
  }

  /**
   * Get configuration
   */
  async getConfig(configPath: string): Promise<PowerShellResult<BCTestConfig>> {
    const script = `
            $WarningPreference = 'SilentlyContinue'
            $ProgressPreference = 'SilentlyContinue'
            $global:WarningPreference = 'SilentlyContinue'
            try {
                Import-Module "${this.modulePath.replace(
                  /\\/g,
                  "\\\\"
                )}" -Force -ErrorAction Stop -WarningAction SilentlyContinue -DisableNameChecking 3>$null
                $config = Get-BCTestRunnerConfig -ConfigPath "${configPath.replace(
                  /\\/g,
                  "\\\\"
                )}"
                @{
                    Success = $true
                    Data = $config
                } | ConvertTo-Json -Depth 10
            } catch {
                @{
                    Success = $false
                    Error = $_.Exception.Message
                    Type = $_.Exception.GetType().Name
                    StackTrace = $_.ScriptStackTrace
                } | ConvertTo-Json -Depth 10
            }
        `;

    const result = await this.executeRaw(script, { timeout: 30000 });
    return this.parseJsonResult<BCTestConfig>(result);
  }

  /**
   * Get latest test results
   */
  async getLatestResults(
    resultsFolder: string,
    specificFile?: string
  ): Promise<PowerShellResult<AITestResults>> {
    const script = `
            $WarningPreference = 'SilentlyContinue'
            $ProgressPreference = 'SilentlyContinue'
            try {
                $resultsPath = "${resultsFolder.replace(/\\/g, "\\\\")}"
                ${
                  specificFile
                    ? `$resultFile = "${specificFile.replace(/\\/g, "\\\\")}"`
                    : `$resultFile = Get-ChildItem -Path $resultsPath -Filter "*_AI.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName`
                }
                
                if (-not $resultFile -or -not (Test-Path $resultFile)) {
                    @{
                        Success = $false
                        Error = "No test results found in $resultsPath"
                    } | ConvertTo-Json
                } else {
                    $content = Get-Content -Path $resultFile -Raw | ConvertFrom-Json
                    @{
                        Success = $true
                        Data = $content
                        FilePath = $resultFile
                    } | ConvertTo-Json -Depth 20
                }
            } catch {
                @{
                    Success = $false
                    Error = $_.Exception.Message
                } | ConvertTo-Json
            }
        `;

    const result = await this.executeRaw(script, { timeout: 30000 });
    return this.parseJsonResult<AITestResults>(result);
  }

  /**
   * Cancel running operation
   */
  cancel(): void {
    if (this.runningProcess) {
      this.outputChannel.appendLine("Cancelling running operation...");
      this.runningProcess.kill("SIGTERM");
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (this.runningProcess) {
          this.runningProcess.kill("SIGKILL");
          this.runningProcess = null;
        }
      }, 5000);
    }
  }

  /**
   * Check if an operation is running
   */
  isRunning(): boolean {
    return this.runningProcess !== null;
  }

  /**
   * Build script that reads JSON from stdin
   */
  private buildInvokeScript(functionName: string): string {
    return `
            $WarningPreference = 'SilentlyContinue'
            $ProgressPreference = 'SilentlyContinue'
            $VerbosePreference = 'SilentlyContinue'
            $global:WarningPreference = 'SilentlyContinue'
            try {
                Import-Module "${this.modulePath.replace(
                  /\\/g,
                  "\\\\"
                )}" -Force -ErrorAction Stop -WarningAction SilentlyContinue -DisableNameChecking 3>$null
                $inputJson = [Console]::In.ReadToEnd()
                $params = $inputJson | ConvertFrom-Json
                $result = & { ${functionName} -InputJson $inputJson } 3>$null
                $output = @{
                    Success = $true
                    Data = $result
                }
                if ($env:BC_RESULT_FILE) {
                    $output | ConvertTo-Json -Depth 100 | Out-File -FilePath $env:BC_RESULT_FILE -Encoding utf8 -Force
                    Write-Host "##RESULT_WRITTEN##"
                } else {
                    $output | ConvertTo-Json -Depth 20
                }
            } catch {
                $output = @{
                    Success = $false
                    Error = $_.Exception.Message
                    Type = $_.Exception.GetType().Name
                    StackTrace = $_.ScriptStackTrace
                    TargetObject = $_.TargetObject
                    FullyQualifiedErrorId = $_.FullyQualifiedErrorId
                }
                if ($env:BC_RESULT_FILE) {
                    $output | ConvertTo-Json -Depth 100 | Out-File -FilePath $env:BC_RESULT_FILE -Encoding utf8 -Force
                    Write-Host "##RESULT_WRITTEN##"
                } else {
                    $output | ConvertTo-Json -Depth 10
                }
            }
        `;
  }

  /**
   * Execute script with progress reporting
   */
  private async executeWithProgress<T>(
    script: string,
    options?: ExecutionOptions
  ): Promise<PowerShellResult<T>> {
    // Generate unique temp file path
    const tempFilePath = path.join(
      os.tmpdir(),
      `bctest-${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .substring(7)}.json`
    );

    // Pass temp file path via environment variable
    const envWithFile = {
      ...options?.env,
      // eslint-disable-next-line @typescript-eslint/naming-convention
      BC_RESULT_FILE: tempFilePath,
    };

    const result = await this.executeRaw(script, {
      ...options,
      env: envWithFile,
    });

    return this.parseJsonResult<T>(result, tempFilePath);
  }

  /**
   * Parse JSON result from PowerShell temp file
   */
  private parseJsonResult<T>(
    result: PowerShellResult<string>,
    tempFilePath?: string
  ): PowerShellResult<T> {
    if (result.cancelled) {
      // Clean up temp file on cancellation
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
      return {
        success: false,
        error: "Operation was cancelled",
        duration: result.duration,
        cancelled: true,
      };
    }

    if (!result.success) {
      // Clean up temp file on PowerShell execution failure
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch {
          // Ignore cleanup errors
        }
      }
      return {
        success: false,
        error: result.error ?? "PowerShell execution failed",
        duration: result.duration,
        cancelled: false,
      };
    }

    // If we have a temp file path, read from it
    if (tempFilePath) {
      try {
        if (!fs.existsSync(tempFilePath)) {
          // Check stdout for ##RESULT_WRITTEN## marker
          if (result.data?.includes("##RESULT_WRITTEN##")) {
            return {
              success: false,
              error:
                "PowerShell indicated result was written but temp file not found",
              duration: result.duration,
              cancelled: false,
            };
          }
          // Fall through to parse from stdout if no marker
        } else {
          const fileContent = fs.readFileSync(tempFilePath, "utf8");

          // Clean up temp file after reading
          try {
            fs.unlinkSync(tempFilePath);
          } catch {
            // Ignore cleanup errors
          }

          const parsed = JSON.parse(fileContent);

          if (parsed.Success === false) {
            return {
              success: false,
              error: parsed.Error,
              errorDetails: {
                message: parsed.Error,
                type: parsed.Type,
                scriptStackTrace: parsed.StackTrace,
                targetObject: parsed.TargetObject,
                fullyQualifiedErrorId: parsed.FullyQualifiedErrorId,
              },
              duration: result.duration,
              cancelled: false,
            };
          }

          return {
            success: true,
            data: parsed.Data as T,
            duration: result.duration,
            cancelled: false,
          };
        }
      } catch (e) {
        this.outputChannel.appendLine(
          `[ERROR] Failed to read/parse temp file: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
        return {
          success: false,
          error: `Failed to parse result file: ${
            e instanceof Error ? e.message : String(e)
          }`,
          duration: result.duration,
          cancelled: false,
        };
      }
    }

    // Fallback: try to parse from stdout (for backward compatibility or if file approach fails)
    if (!result.data) {
      return {
        success: false,
        error: "No data returned from PowerShell",
        duration: result.duration,
        cancelled: false,
      };
    }

    try {
      const parsed = JSON.parse(result.data);
      if (parsed.Success === false) {
        return {
          success: false,
          error: parsed.Error,
          errorDetails: {
            message: parsed.Error,
            type: parsed.Type,
            scriptStackTrace: parsed.StackTrace,
            targetObject: parsed.TargetObject,
            fullyQualifiedErrorId: parsed.FullyQualifiedErrorId,
          },
          duration: result.duration,
          cancelled: false,
        };
      }
      return {
        success: true,
        data: parsed.Data as T,
        duration: result.duration,
        cancelled: false,
      };
    } catch (e) {
      this.outputChannel.appendLine(
        `[ERROR] Failed to parse PowerShell output: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
      this.outputChannel.appendLine(
        `[DEBUG] Output (first 500 chars): ${result.data?.substring(0, 500)}`
      );
      return {
        success: false,
        error: `Failed to parse PowerShell output: ${
          e instanceof Error ? e.message : String(e)
        }`,
        duration: result.duration,
        cancelled: false,
      };
    }
  }

  /**
   * Execute raw PowerShell script
   */
  private executeRaw(
    script: string,
    options?: ExecutionOptions
  ): Promise<PowerShellResult<string>> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const timeout = options?.timeout ?? 600000; // 10 minutes default

      const args = [
        "-NoProfile",
        "-NoLogo",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$WarningPreference='SilentlyContinue'; $VerbosePreference='SilentlyContinue'; ${script} 3>$null`,
      ];

      this.outputChannel.appendLine(
        `Executing PowerShell: ${this.powershellPath}`
      );
      this.outputChannel.appendLine(
        `Working directory: ${options?.workingDirectory ?? process.cwd()}`
      );

      const proc = spawn(this.powershellPath, args, {
        cwd: options?.workingDirectory,
        env: {
          ...process.env,
          ...options?.env,
          // Disable ANSI/VT escape sequences in PowerShell output
          noColor: "1",
          term: "dumb",
        },
        shell: false,
      });

      this.runningProcess = proc;

      let stdout = "";
      let stderr = "";
      let cancelled = false;

      // Handle cancellation
      const disposable = options?.cancellationToken?.onCancellationRequested(
        () => {
          cancelled = true;
          proc.kill("SIGTERM");
        }
      );

      // Handle timeout
      const timeoutId = setTimeout(() => {
        cancelled = true;
        proc.kill("SIGTERM");
        this.outputChannel.appendLine("Operation timed out");
      }, timeout);

      // Write stdin data if provided
      if (options?.stdinData) {
        proc.stdin.write(JSON.stringify(options.stdinData));
        proc.stdin.end();
      } else {
        proc.stdin.end();
      }

      proc.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        options?.onOutput?.(text);
        this.outputChannel.append(text);
      });

      proc.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        this.outputChannel.append(`[STDERR] ${text}`);
      });

      proc.on("close", (code) => {
        this.runningProcess = null;
        clearTimeout(timeoutId);
        disposable?.dispose();

        const duration = Date.now() - startTime;

        if (cancelled) {
          resolve({
            success: false,
            error: "Operation was cancelled",
            duration,
            cancelled: true,
          });
          return;
        }

        if (code !== 0 && !stdout) {
          resolve({
            success: false,
            error: stderr || `PowerShell exited with code ${code}`,
            duration,
            cancelled: false,
          });
          return;
        }

        // Return stdout as-is for file-based or simple parsing
        resolve({
          success: true,
          data: stdout,
          duration,
          cancelled: false,
        });
      });

      proc.on("error", (err) => {
        this.runningProcess = null;
        clearTimeout(timeoutId);
        disposable?.dispose();

        resolve({
          success: false,
          error: `Failed to start PowerShell: ${err.message}`,
          duration: Date.now() - startTime,
          cancelled: false,
        });
      });
    });
  }
}

// Type definitions for results

export interface TestRunResult {
  success: boolean;
  testResults?: TestExecutionResult;
  aiResultsFile?: string;
  htmlReportFile?: string;
  duration: string;
}

export interface TestExecutionResult {
  success: boolean;
  summary: TestSummary;
  duration: string;
  failures: TestFailure[];
  allTests: TestResult[];
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export interface TestFailure {
  codeunit: string;
  codeunitId: number;
  method: string;
  testName: string;
  error: string;
  stackTrace?: string;
  duration: string;
  filePath?: string;
  lineNumber?: number;
}

export interface TestResult {
  codeunit: string;
  codeunitId: number;
  method: string;
  name: string;
  result: "Pass" | "Fail" | "Skip";
  duration: string;
}

export interface AITestResults {
  schema: string;
  timestamp: string;
  environment: {
    name: string;
    server: string;
    serverInstance: string;
    authentication: string;
  };
  tests: {
    success: boolean;
    summary: TestSummary;
    duration: string;
    failures: TestFailure[];
    allTests: TestResult[];
  };
  aiContext: {
    analysisHints: string[];
    suggestedActions: string[];
  };
}

export interface BCTestConfig {
  workspacePath: string;
  defaultEnvironment: string;
  apps: string[];
  testApp: {
    path: string;
    extensionId: string;
    extensionName: string;
    testCodeunitRange: string;
  };
  environments: BCTestEnvironment[];
  output: {
    resultsFolder: string;
    customDirectory?: string;
    keepHistoryCount: number;
    formats: string[];
  };
}

export interface BCTestEnvironment {
  name: string;
  description?: string;
  type: "docker" | "server";
  containerName: string;
  server: string;
  serverInstance: string;
  authentication: "UserPassword" | "Windows" | "NavUserPassword";
  tenant?: string;
}
