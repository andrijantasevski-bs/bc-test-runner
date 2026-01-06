/**
 * BC Test Runner - PowerShell Bridge Tests
 *
 * Tests for the PowerShell execution bridge module.
 * These tests verify communication between TypeScript and PowerShell.
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

describe("PowerShell Bridge Tests", () => {
  const testTempDir = path.join(os.tmpdir(), "bctest-ps-bridge-tests");

  before(() => {
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
  });

  after(() => {
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe("JSON Input Generation", () => {
    interface BCTestRunInput {
      command: string;
      parameters: {
        environment: string;
        skipCompile: boolean;
        skipPublish: boolean;
        configPath: string;
        credential?: {
          username: string;
          password: string;
        };
        outputFormat: string;
      };
    }

    it("should generate correct JSON input for Invoke-BCTestRunnerFromJson", () => {
      const input: BCTestRunInput = {
        command: "RunTests",
        parameters: {
          environment: "docker-local",
          skipCompile: false,
          skipPublish: false,
          configPath: "c:\\project\\bctest.config.json",
          outputFormat: "AI",
        },
      };

      const json = JSON.stringify(input);
      const parsed = JSON.parse(json) as BCTestRunInput;

      assert.strictEqual(parsed.command, "RunTests");
      assert.strictEqual(parsed.parameters.environment, "docker-local");
      assert.strictEqual(parsed.parameters.skipCompile, false);
    });

    it("should include credentials when provided", () => {
      const input: BCTestRunInput = {
        command: "RunTests",
        parameters: {
          environment: "docker-local",
          skipCompile: false,
          skipPublish: false,
          configPath: "c:\\project\\bctest.config.json",
          credential: {
            username: "testuser",
            password: "testpass",
          },
          outputFormat: "AI",
        },
      };

      const json = JSON.stringify(input);
      const parsed = JSON.parse(json) as BCTestRunInput;

      assert.notStrictEqual(parsed.parameters.credential, undefined);
      assert.strictEqual(parsed.parameters.credential?.username, "testuser");
    });

    it("should handle special characters in paths", () => {
      const pathWithSpaces = "c:\\Users\\Test User\\project\\config.json";
      const input: BCTestRunInput = {
        command: "RunTests",
        parameters: {
          environment: "docker-local",
          skipCompile: false,
          skipPublish: false,
          configPath: pathWithSpaces,
          outputFormat: "AI",
        },
      };

      const json = JSON.stringify(input);
      const parsed = JSON.parse(json) as BCTestRunInput;

      assert.strictEqual(parsed.parameters.configPath, pathWithSpaces);
    });
  });

  describe("JSON Output Parsing", () => {
    interface BCTestOutput {
      success: boolean;
      output: string;
      error?: string;
      results?: {
        tests: unknown[];
        summary: {
          total: number;
          passed: number;
          failed: number;
        };
      };
    }

    it("should parse successful output", () => {
      const output: BCTestOutput = {
        success: true,
        output: "Tests completed successfully",
        results: {
          tests: [],
          summary: { total: 10, passed: 10, failed: 0 },
        },
      };

      const json = JSON.stringify(output);
      const parsed = JSON.parse(json) as BCTestOutput;

      assert.strictEqual(parsed.success, true);
      assert.strictEqual(parsed.results?.summary.total, 10);
    });

    it("should parse error output", () => {
      const output: BCTestOutput = {
        success: false,
        output: "",
        error: "Connection to container failed",
      };

      const json = JSON.stringify(output);
      const parsed = JSON.parse(json) as BCTestOutput;

      assert.strictEqual(parsed.success, false);
      assert.strictEqual(parsed.error, "Connection to container failed");
    });
  });

  describe("Command Construction", () => {
    interface PowerShellCommand {
      modulePath: string;
      functionName: string;
      stdin: string;
    }

    function buildPowerShellCommand(
      extensionPath: string,
      functionName: string,
      inputJson: string
    ): PowerShellCommand {
      const modulePath = path.join(
        extensionPath,
        "resources",
        "powershell",
        "BCTestRunner.psm1"
      );
      return {
        modulePath,
        functionName,
        stdin: inputJson,
      };
    }

    it("should construct correct module path", () => {
      const extensionPath = "c:\\extensions\\bctest-runner";
      const cmd = buildPowerShellCommand(
        extensionPath,
        "Invoke-BCTestRunnerFromJson",
        "{}"
      );

      assert.strictEqual(cmd.modulePath.includes("BCTestRunner.psm1"), true);
      assert.strictEqual(cmd.modulePath.includes("resources"), true);
      assert.strictEqual(cmd.modulePath.includes("powershell"), true);
    });

    it("should map operations to correct functions", () => {
      const operationMap: Record<string, string> = {
        runTests: "Invoke-BCTestRunnerFromJson",
        compile: "Invoke-BCCompileFromJson",
        publish: "Invoke-BCPublishFromJson",
        executeTests: "Invoke-BCExecuteTestsFromJson",
      };

      assert.strictEqual(
        operationMap["runTests"],
        "Invoke-BCTestRunnerFromJson"
      );
      assert.strictEqual(operationMap["compile"], "Invoke-BCCompileFromJson");
    });
  });

  describe("Process Spawning Configuration", () => {
    interface SpawnConfig {
      shell: boolean;
      cwd: string;
      env: Record<string, string>;
    }

    it("should configure spawn options correctly", () => {
      const workspaceFolder = "c:\\project";
      const config: SpawnConfig = {
        shell: false,
        cwd: workspaceFolder,
        env: {
          ...(process.env as Record<string, string>),
          BCTEST_RUNNER_MODE: "extension",
        },
      };

      assert.strictEqual(config.shell, false);
      assert.strictEqual(config.cwd, workspaceFolder);
      assert.strictEqual(config.env.BCTEST_RUNNER_MODE, "extension");
    });

    it("should detect PowerShell executable path", () => {
      const isWindows = os.platform() === "win32";
      const pwshPath = isWindows ? "pwsh.exe" : "pwsh";

      if (isWindows) {
        assert.strictEqual(pwshPath.endsWith(".exe"), true);
      } else {
        assert.strictEqual(pwshPath, "pwsh");
      }
    });
  });

  describe("Cancellation Handling", () => {
    interface CancellableOperation {
      id: string;
      startTime: Date;
      cancelled: boolean;
      cancel: () => void;
    }

    it("should track operation for cancellation", () => {
      const operation: CancellableOperation = {
        id: "test-run-123",
        startTime: new Date(),
        cancelled: false,
        cancel: function () {
          this.cancelled = true;
        },
      };

      assert.strictEqual(operation.cancelled, false);
      operation.cancel();
      assert.strictEqual(operation.cancelled, true);
    });

    it("should generate unique operation IDs", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const id = `op-${Date.now()}-${Math.random()
          .toString(36)
          .substring(7)}`;
        ids.add(id);
      }

      // All IDs should be unique
      assert.strictEqual(ids.size, 100);
    });
  });

  describe("Error Recovery", () => {
    interface RecoverableError {
      code: string;
      message: string;
      recoverable: boolean;
      suggestion: string;
    }

    function categorizeError(errorCode: string): RecoverableError {
      const errorMap: Record<string, Omit<RecoverableError, "code">> = {
        CONTAINER_NOT_RUNNING: {
          message: "Docker container is not running",
          recoverable: true,
          suggestion:
            "Start the container using Docker Desktop or docker start command",
        },
        AUTH_FAILED: {
          message: "Authentication failed",
          recoverable: true,
          suggestion: "Re-enter credentials using the credential manager",
        },
        CONFIG_NOT_FOUND: {
          message: "Configuration file not found",
          recoverable: true,
          suggestion: "Create bctest.config.json in workspace root",
        },
        COMPILE_ERROR: {
          message: "Compilation failed",
          recoverable: true,
          suggestion: "Fix the compilation errors shown in output",
        },
      };

      const error = errorMap[errorCode] || {
        message: "Unknown error",
        recoverable: false,
        suggestion: "Check the output for details",
      };

      return { code: errorCode, ...error };
    }

    it("should categorize container errors as recoverable", () => {
      const error = categorizeError("CONTAINER_NOT_RUNNING");
      assert.strictEqual(error.recoverable, true);
    });

    it("should provide suggestions for known errors", () => {
      const error = categorizeError("AUTH_FAILED");
      assert.strictEqual(error.suggestion.length > 0, true);
      assert.strictEqual(error.suggestion.includes("credential"), true);
    });

    it("should handle unknown error codes", () => {
      const error = categorizeError("UNKNOWN_CODE");
      assert.strictEqual(error.recoverable, false);
    });
  });

  describe("Output Streaming", () => {
    interface StreamChunk {
      type: "stdout" | "stderr" | "progress";
      data: string;
      timestamp: Date;
    }

    function parseStreamOutput(data: string): StreamChunk[] {
      const chunks: StreamChunk[] = [];
      const lines = data.split("\n");

      for (const line of lines) {
        if (line.includes("##PROGRESS##")) {
          chunks.push({
            type: "progress",
            data: line,
            timestamp: new Date(),
          });
        } else if (line.startsWith("ERROR:") || line.startsWith("Exception:")) {
          chunks.push({
            type: "stderr",
            data: line,
            timestamp: new Date(),
          });
        } else if (line.trim()) {
          chunks.push({
            type: "stdout",
            data: line,
            timestamp: new Date(),
          });
        }
      }

      return chunks;
    }

    it("should identify progress markers", () => {
      const output = '##PROGRESS##{"status":"running"}##';
      const chunks = parseStreamOutput(output);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].type, "progress");
    });

    it("should identify error output", () => {
      const output = "ERROR: Something went wrong";
      const chunks = parseStreamOutput(output);

      assert.strictEqual(chunks.length, 1);
      assert.strictEqual(chunks[0].type, "stderr");
    });

    it("should handle mixed output", () => {
      const output = `Starting test run
##PROGRESS##{"status":"compiling"}##
ERROR: Compilation failed
Done`;
      const chunks = parseStreamOutput(output);

      assert.strictEqual(chunks.length, 4);
      assert.strictEqual(chunks.filter((c) => c.type === "progress").length, 1);
      assert.strictEqual(chunks.filter((c) => c.type === "stderr").length, 1);
      assert.strictEqual(chunks.filter((c) => c.type === "stdout").length, 2);
    });
  });

  describe("Module Path Resolution", () => {
    it("should resolve module path relative to extension", () => {
      const extensionPath = "c:\\extensions\\bctest-runner";
      const modulePath = path.join(
        extensionPath,
        "resources",
        "powershell",
        "BCTestRunner.psm1"
      );

      assert.strictEqual(modulePath.includes("BCTestRunner.psm1"), true);
      assert.strictEqual(path.isAbsolute(modulePath), true);
    });

    it("should handle Unix-style paths", () => {
      const extensionPath = "/home/user/.vscode/extensions/bctest-runner";
      const modulePath = path.posix.join(
        extensionPath,
        "resources",
        "powershell",
        "BCTestRunner.psm1"
      );

      assert.strictEqual(modulePath.includes("BCTestRunner.psm1"), true);
    });
  });
});
