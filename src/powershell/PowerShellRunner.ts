/**
 * BC Test Runner - PowerShell Execution Bridge
 *
 * Provides TypeScript interface for executing PowerShell module functions
 * with JSON-based communication, progress reporting, and cancellation support.
 */

import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";

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
 * Progress update from PowerShell
 */
export interface ProgressUpdate {
  activity: string;
  status: string;
  percentComplete: number;
  currentOperation?: string;
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
  /** Progress callback */
  onProgress?: (progress: ProgressUpdate) => void;
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
   * Execute the full test pipeline
   */
  async runTests(
    configPath: string,
    environmentName?: string,
    options?: ExecutionOptions & {
      skipCompile?: boolean;
      skipPublish?: boolean;
      credential?: { username: string; password: string };
    }
  ): Promise<PowerShellResult<TestRunResult>> {
    const stdinData = {
      configPath,
      environmentName,
      skipCompile: options?.skipCompile ?? false,
      skipPublish: options?.skipPublish ?? false,
      credential: options?.credential,
    };

    const script = this.buildInvokeScript("Invoke-BCTestRunnerFromJson");
    return this.executeWithProgress<TestRunResult>(script, {
      ...options,
      stdinData,
    });
  }

  /**
   * Compile AL apps
   */
  async compileApps(
    configPath: string,
    environmentName?: string,
    apps?: string[],
    options?: ExecutionOptions & {
      credential?: { username: string; password: string };
    }
  ): Promise<PowerShellResult<CompilationResult>> {
    const stdinData = {
      configPath,
      environmentName,
      apps,
      credential: options?.credential,
      operation: "compile",
    };

    const script = this.buildInvokeScript("Invoke-BCCompileFromJson");
    return this.executeWithProgress<CompilationResult>(script, {
      ...options,
      stdinData,
    });
  }

  /**
   * Publish apps to container
   */
  async publishApps(
    configPath: string,
    environmentName?: string,
    options?: ExecutionOptions & {
      credential?: { username: string; password: string };
    }
  ): Promise<PowerShellResult<PublishResult>> {
    const stdinData = {
      configPath,
      environmentName,
      credential: options?.credential,
      operation: "publish",
    };

    const script = this.buildInvokeScript("Invoke-BCPublishFromJson");
    return this.executeWithProgress<PublishResult>(script, {
      ...options,
      stdinData,
    });
  }

  /**
   * Execute tests only (skip compile/publish)
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
                @{
                    Success = $true
                    Data = $result
                } | ConvertTo-Json -Depth 20
            } catch {
                @{
                    Success = $false
                    Error = $_.Exception.Message
                    Type = $_.Exception.GetType().Name
                    StackTrace = $_.ScriptStackTrace
                    TargetObject = $_.TargetObject
                    FullyQualifiedErrorId = $_.FullyQualifiedErrorId
                } | ConvertTo-Json -Depth 10
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
    const result = await this.executeRaw(script, options);
    return this.parseJsonResult<T>(result);
  }

  /**
   * Strip all ANSI escape codes and control characters from a string
   */
  private stripAnsiCodes(input: string): string {
    // Build regex patterns using String.fromCharCode to ensure proper ESC character
    const ESC = String.fromCharCode(27); // 0x1B

    let result = input;

    // CSI sequences: ESC [ ... letter (most common for colors)
    const csiPattern = new RegExp(
      ESC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\[[0-9;]*[A-Za-z]",
      "g"
    );
    result = result.replace(csiPattern, "");

    // OSC sequences: ESC ] ... BEL
    const BEL = String.fromCharCode(7);
    const oscPattern = new RegExp(
      ESC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "\\][^" +
        BEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        "]*" +
        BEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    );
    result = result.replace(oscPattern, "");

    // Remove any remaining ESC characters and following character
    result = result.replace(
      new RegExp(ESC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".", "g"),
      ""
    );

    // Remove any standalone ESC characters
    result = result.replace(
      new RegExp(ESC.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      ""
    );

    // Remove other control characters except newline (\n=10), carriage return (\r=13), tab (\t=9)
    result = result.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");

    return result;
  }

  /**
   * Extract the last valid JSON object from mixed output
   */
  private extractJson(input: string): string {
    // Clean ANSI codes first
    let cleaned = this.stripAnsiCodes(input);

    // Also remove ANSI-like sequences that might be missing the ESC character
    // This handles cases where [33;1m appears without ESC prefix
    cleaned = cleaned.replace(/\[[0-9;]*m/g, "");

    // Remove WARNING/VERBOSE/DEBUG lines that PowerShell outputs
    cleaned = cleaned.replace(/^WARNING:.*$/gm, "");
    cleaned = cleaned.replace(/^VERBOSE:.*$/gm, "");
    cleaned = cleaned.replace(/^DEBUG:.*$/gm, "");

    // Remove progress markers
    cleaned = cleaned.replace(/##PROGRESS##.*?##/g, "");

    // Find all potential JSON object starts with "Success" or "Data" key
    const patterns = [
      /\{\s*"Success"\s*:/g,
      /\{\s*"Data"\s*:/g,
      /\{\s*\r?\n\s*"Success"\s*:/g,
      /\{\s*\r?\n\s*"Data"\s*:/g,
    ];

    let lastJsonStart = -1;
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(cleaned)) !== null) {
        lastJsonStart = Math.max(lastJsonStart, match.index);
      }
    }

    if (lastJsonStart >= 0) {
      // Extract from last JSON start and find matching closing brace
      const jsonCandidate = cleaned.substring(lastJsonStart);
      let braceCount = 0;
      let inString = false;
      let escape = false;
      let jsonEnd = -1;

      for (let i = 0; i < jsonCandidate.length; i++) {
        const char = jsonCandidate[i];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === "\\" && inString) {
          escape = true;
          continue;
        }

        if (char === '"' && !escape) {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === "{") {
            braceCount++;
          } else if (char === "}") {
            braceCount--;
            if (braceCount === 0) {
              jsonEnd = i + 1;
              break;
            }
          }
        }
      }

      if (jsonEnd > 0) {
        return jsonCandidate.substring(0, jsonEnd);
      }
    }

    // Fallback: return cleaned output trimmed
    return cleaned.trim();
  }

  /**
   * Parse JSON result from PowerShell
   */
  private parseJsonResult<T>(
    result: PowerShellResult<string>
  ): PowerShellResult<T> {
    if (result.cancelled) {
      return {
        success: false,
        error: "Operation was cancelled",
        duration: result.duration,
        cancelled: true,
      };
    }

    if (!result.success || !result.data) {
      return {
        success: false,
        error: result.error ?? "No data returned from PowerShell",
        duration: result.duration,
        cancelled: false,
      };
    }

    try {
      // Extract and clean JSON from the output
      const cleanedData = this.extractJson(result.data);

      // Debug: log first bytes as hex to see if ANSI codes remain
      const firstBytes = cleanedData
        .substring(0, 50)
        .split("")
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(" ");
      this.outputChannel.appendLine(
        `[DEBUG] First 50 bytes hex: ${firstBytes}`
      );
      this.outputChannel.appendLine(
        `[DEBUG] Cleaned data starts with: ${cleanedData.substring(0, 100)}`
      );

      const parsed = JSON.parse(cleanedData);
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
      // Log the problematic output for debugging
      this.outputChannel.appendLine(
        `[DEBUG] Failed to parse output. First 500 chars: ${result.data?.substring(
          0,
          500
        )}`
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
        script,
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

        // Parse progress updates from stdout
        const progressMatch = text.match(/##PROGRESS##({.*})##/);
        if (progressMatch) {
          try {
            const progress = JSON.parse(progressMatch[1]) as ProgressUpdate;
            options?.onProgress?.(progress);
          } catch {
            // Ignore parse errors for progress
          }
        } else {
          this.outputChannel.append(text);
        }
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

        // Extract JSON from stdout (may have progress messages mixed in)
        // Also strip ANSI escape codes (color codes like [33;1m)
        // ESC character is \x1B (decimal 27)
        const ESC = String.fromCharCode(27);
        const ansiRegex = new RegExp(`${ESC}\\[[0-9;]*[a-zA-Z]`, "g");
        const oscRegex = new RegExp(
          `${ESC}\\][^${String.fromCharCode(7)}]*${String.fromCharCode(7)}`,
          "g"
        );

        let cleanedOutput = stdout
          .replace(/##PROGRESS##.*?##/g, "")
          .replace(ansiRegex, "")
          .replace(oscRegex, "")
          // Also remove any remaining escape sequences
          .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "")
          // Remove standalone escape characters
          .replace(/[\x00-\x1F]/g, (char) =>
            char === "\n" || char === "\r" || char === "\t" ? char : ""
          )
          .trim();

        // Find the LAST JSON object that contains "Success" key (our result wrapper)
        // Look for the pattern that starts our JSON response
        const jsonStartPatterns = [
          /\{\s*\r?\n\s*"Success"\s*:/g,
          /\{\s*\r?\n\s*"Data"\s*:/g,
          /\{\s*"Success"\s*:/g,
          /\{\s*"Data"\s*:/g,
        ];

        let lastJsonStart = -1;
        for (const pattern of jsonStartPatterns) {
          let match;
          while ((match = pattern.exec(cleanedOutput)) !== null) {
            lastJsonStart = Math.max(lastJsonStart, match.index);
          }
        }

        if (lastJsonStart >= 0) {
          // Extract from the last JSON start to the end and find matching braces
          const jsonCandidate = cleanedOutput.substring(lastJsonStart);
          let braceCount = 0;
          let jsonEnd = -1;

          for (let i = 0; i < jsonCandidate.length; i++) {
            if (jsonCandidate[i] === "{") {
              braceCount++;
            } else if (jsonCandidate[i] === "}") {
              braceCount--;
              if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
              }
            }
          }

          if (jsonEnd > 0) {
            cleanedOutput = jsonCandidate.substring(0, jsonEnd);
          }
        }

        resolve({
          success: true,
          data: cleanedOutput,
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
  compilationResults?: CompilationResult;
  publishResults?: PublishResult;
  testResults?: TestExecutionResult;
  aiResultsFile?: string;
  htmlReportFile?: string;
  duration: string;
}

export interface CompilationResult {
  success: boolean;
  apps: CompilationAppResult[];
  duration: string;
}

export interface CompilationAppResult {
  project: string;
  appFile?: string;
  success: boolean;
  duration: string;
  errors?: CompilationError[];
  warnings?: CompilationWarning[];
}

export interface CompilationError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface CompilationWarning {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

export interface PublishResult {
  success: boolean;
  apps: PublishAppResult[];
  duration: string;
}

export interface PublishAppResult {
  appFile: string;
  success: boolean;
  syncMode: string;
  message?: string;
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
  compilation?: {
    success: boolean;
    apps: CompilationAppResult[];
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
  compilation: {
    enableCodeCop: boolean;
    enableAppSourceCop: boolean;
    enablePerTenantExtensionCop: boolean;
    enableUICop: boolean;
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
  syncMode: "Add" | "Clean" | "Development" | "ForceSync";
  tenant?: string;
}
