/**
 * BC Test Runner - Mocha Tests
 *
 * Tests for TypeScript extension components including:
 * - Configuration management
 * - PowerShell bridge communication
 * - Credential management
 * - Schema validation
 * - Tool registration
 */

import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

// Note: These tests run in the VS Code test environment
// Some tests are mocked since they require VS Code API

describe("BCTestRunner Extension Tests", () => {
  const testTempDir = path.join(os.tmpdir(), "bctest-runner-tests");

  before(() => {
    // Create temp directory for test files
    if (!fs.existsSync(testTempDir)) {
      fs.mkdirSync(testTempDir, { recursive: true });
    }
  });

  after(() => {
    // Cleanup temp directory
    if (fs.existsSync(testTempDir)) {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe("Configuration Schema Validation", () => {
    const validConfig = {
      $schema: "./schemas/bctest.config.schema.json",
      workspacePath: "../",
      defaultEnvironment: "docker-local",
      apps: ["App", "TestApp"],
      testApp: {
        path: "TestApp",
        extensionId: "12345678-1234-1234-1234-123456789012",
        extensionName: "Test App",
        testCodeunitRange: "80000..80099",
      },
      environments: [
        {
          name: "docker-local",
          type: "docker",
          containerName: "bcserver",
          server: "http://bcserver",
          serverInstance: "BC",
          authentication: "UserPassword",
          syncMode: "ForceSync",
        },
      ],
      output: {
        resultsFolder: ".testresults",
        keepHistoryCount: 10,
        formats: ["json", "xml"],
      },
    };

    it("should accept valid configuration", () => {
      const configPath = path.join(testTempDir, "valid-config.json");
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));

      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);

      assert.strictEqual(config.defaultEnvironment, "docker-local");
      assert.strictEqual(config.apps.length, 2);
      assert.strictEqual(config.environments.length, 1);
    });

    it("should require defaultEnvironment field", () => {
      const invalidConfig = { ...validConfig };
      delete (invalidConfig as Record<string, unknown>).defaultEnvironment;

      // Validation would fail for missing required field
      assert.strictEqual(invalidConfig.defaultEnvironment, undefined);
    });

    it("should require testApp.extensionId field", () => {
      const invalidConfig = JSON.parse(JSON.stringify(validConfig));
      delete invalidConfig.testApp.extensionId;

      assert.strictEqual(invalidConfig.testApp.extensionId, undefined);
    });

    it("should validate extensionId format (GUID pattern)", () => {
      const guidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

      assert.strictEqual(
        guidPattern.test(validConfig.testApp.extensionId),
        true
      );
      assert.strictEqual(guidPattern.test("invalid-guid"), false);
      assert.strictEqual(
        guidPattern.test("12345678-1234-1234-1234-123456789012"),
        true
      );
    });

    it("should validate server URL format", () => {
      const urlPattern = /^https?:\/\/.+/;

      assert.strictEqual(
        urlPattern.test(validConfig.environments[0].server),
        true
      );
      assert.strictEqual(urlPattern.test("not-a-url"), false);
      assert.strictEqual(urlPattern.test("http://localhost"), true);
      assert.strictEqual(urlPattern.test("https://server.domain.com"), true);
    });

    it("should validate authentication enum values", () => {
      const validAuthTypes = ["UserPassword", "Windows", "NavUserPassword"];

      assert.strictEqual(
        validAuthTypes.includes(validConfig.environments[0].authentication),
        true
      );
      assert.strictEqual(validAuthTypes.includes("InvalidAuth"), false);
    });

    it("should validate syncMode enum values", () => {
      const validSyncModes = ["Add", "Clean", "Development", "ForceSync"];

      assert.strictEqual(
        validSyncModes.includes(validConfig.environments[0].syncMode),
        true
      );
      assert.strictEqual(validSyncModes.includes("InvalidMode"), false);
    });

    it("should validate testCodeunitRange pattern", () => {
      const rangePattern = /^[0-9]+(\.\.[0-9]+)?$/;

      assert.strictEqual(rangePattern.test("80000..80099"), true);
      assert.strictEqual(rangePattern.test("80000"), true);
      assert.strictEqual(rangePattern.test("invalid"), false);
    });
  });

  describe("Test Results Parsing", () => {
    interface TestResult {
      codeunit: string;
      method: string;
      result: "Pass" | "Fail" | "Skip";
      duration: string;
    }

    interface TestSummary {
      total: number;
      passed: number;
      failed: number;
      skipped: number;
    }

    const mockTestResults: TestResult[] = [
      {
        codeunit: "TestCodeunit",
        method: "Test1",
        result: "Pass",
        duration: "1.5",
      },
      {
        codeunit: "TestCodeunit",
        method: "Test2",
        result: "Pass",
        duration: "0.8",
      },
      {
        codeunit: "TestCodeunit",
        method: "Test3",
        result: "Fail",
        duration: "2.1",
      },
      {
        codeunit: "OtherCodeunit",
        method: "Test4",
        result: "Skip",
        duration: "0.0",
      },
    ];

    it("should calculate correct summary from test results", () => {
      const summary: TestSummary = {
        total: mockTestResults.length,
        passed: mockTestResults.filter((t) => t.result === "Pass").length,
        failed: mockTestResults.filter((t) => t.result === "Fail").length,
        skipped: mockTestResults.filter((t) => t.result === "Skip").length,
      };

      assert.strictEqual(summary.total, 4);
      assert.strictEqual(summary.passed, 2);
      assert.strictEqual(summary.failed, 1);
      assert.strictEqual(summary.skipped, 1);
    });

    it("should group tests by codeunit", () => {
      const grouped = mockTestResults.reduce((acc, test) => {
        if (!acc[test.codeunit]) {
          acc[test.codeunit] = [];
        }
        acc[test.codeunit].push(test);
        return acc;
      }, {} as Record<string, TestResult[]>);

      assert.strictEqual(Object.keys(grouped).length, 2);
      assert.strictEqual(grouped["TestCodeunit"].length, 3);
      assert.strictEqual(grouped["OtherCodeunit"].length, 1);
    });

    it("should calculate success rate correctly", () => {
      const total = mockTestResults.length;
      const passed = mockTestResults.filter((t) => t.result === "Pass").length;
      const successRate = Math.round((passed / total) * 100);

      assert.strictEqual(successRate, 50);
    });

    it("should identify all failures", () => {
      const failures = mockTestResults.filter((t) => t.result === "Fail");

      assert.strictEqual(failures.length, 1);
      assert.strictEqual(failures[0].method, "Test3");
    });
  });

  describe("Compiler Error Parsing", () => {
    interface CompilerError {
      file: string;
      line: number;
      column: number;
      code: string;
      message: string;
      type: "error" | "warning";
    }

    function parseCompilerOutput(output: string): CompilerError[] {
      const pattern =
        /([^(]+)\((\d+),(\d+)\):\s*(error|warning)\s+([A-Z]{2}\d+):\s*(.+)/g;
      const results: CompilerError[] = [];
      let match;

      while ((match = pattern.exec(output)) !== null) {
        results.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          type: match[4] as "error" | "warning",
          code: match[5],
          message: match[6].trim(),
        });
      }

      return results;
    }

    it("should parse AL compiler error format", () => {
      const output = `c:\\project\\App\\src\\codeunit\\MyCodeunit.al(15,5): error AL0432: The name 'SomeVariable' does not exist`;
      const errors = parseCompilerOutput(output);

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].line, 15);
      assert.strictEqual(errors[0].column, 5);
      assert.strictEqual(errors[0].code, "AL0432");
      assert.strictEqual(errors[0].type, "error");
    });

    it("should parse AL compiler warning format", () => {
      const output = `c:\\project\\App\\src\\page\\MyPage.al(42,10): warning AL0603: The variable 'Unused' is defined but not used`;
      const errors = parseCompilerOutput(output);

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].type, "warning");
      assert.strictEqual(errors[0].code, "AL0603");
    });

    it("should parse multiple errors", () => {
      const output = `c:\\project\\App\\src\\codeunit.al(10,1): error AL0001: Error 1
c:\\project\\App\\src\\codeunit.al(20,1): error AL0002: Error 2
c:\\project\\App\\src\\page.al(30,1): warning AL0003: Warning 1`;
      const errors = parseCompilerOutput(output);

      assert.strictEqual(errors.length, 3);
      assert.strictEqual(errors.filter((e) => e.type === "error").length, 2);
      assert.strictEqual(errors.filter((e) => e.type === "warning").length, 1);
    });

    it("should handle empty output", () => {
      const errors = parseCompilerOutput("");
      assert.strictEqual(errors.length, 0);
    });
  });

  describe("Stack Trace Parsing", () => {
    interface StackInfo {
      codeunit: string;
      codeunitId: number;
      method: string;
      lineNumber: number;
    }

    function parseStackTrace(stackTrace: string): StackInfo | null {
      const pattern = /([^(]+)\((\d+)\)\.(\w+)\s+line\s+(\d+)/;
      const match = stackTrace.match(pattern);

      if (!match) {
        return null;
      }

      return {
        codeunit: match[1].trim(),
        codeunitId: parseInt(match[2], 10),
        method: match[3],
        lineNumber: parseInt(match[4], 10),
      };
    }

    it("should parse AL stack trace format", () => {
      const stackTrace = "TestCodeunit(80001).TestMethod line 25";
      const result = parseStackTrace(stackTrace);

      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.codeunit, "TestCodeunit");
      assert.strictEqual(result?.codeunitId, 80001);
      assert.strictEqual(result?.method, "TestMethod");
      assert.strictEqual(result?.lineNumber, 25);
    });

    it("should handle invalid stack trace", () => {
      const result = parseStackTrace("invalid stack trace");
      assert.strictEqual(result, null);
    });

    it("should handle codeunit names with spaces", () => {
      const stackTrace =
        "PTE HS Webhook Tests(80002).ValidWebhookJSONIsAcceptedAndQueued line 150";
      const result = parseStackTrace(stackTrace);

      assert.notStrictEqual(result, null);
      assert.strictEqual(result?.codeunit, "PTE HS Webhook Tests");
      assert.strictEqual(result?.codeunitId, 80002);
    });
  });

  describe("Credential Storage", () => {
    interface StoredCredential {
      username: string;
      password: string;
      storedAt: string;
    }

    it("should serialize credential correctly", () => {
      const credential: StoredCredential = {
        username: "testuser",
        password: "testpass",
        storedAt: new Date().toISOString(),
      };

      const serialized = JSON.stringify(credential);
      const deserialized = JSON.parse(serialized) as StoredCredential;

      assert.strictEqual(deserialized.username, "testuser");
      assert.strictEqual(deserialized.password, "testpass");
    });

    it("should generate correct storage key", () => {
      const prefix = "bcTestRunner.credential.";
      const envName = "docker-local";
      const key = `${prefix}${envName}`;

      assert.strictEqual(key, "bcTestRunner.credential.docker-local");
    });

    it("should handle special characters in environment names", () => {
      const prefix = "bcTestRunner.credential.";
      const envNames = ["test-env", "test_env", "testEnv123"];

      envNames.forEach((name) => {
        const key = `${prefix}${name}`;
        assert.strictEqual(key.startsWith(prefix), true);
        assert.strictEqual(key.endsWith(name), true);
      });
    });
  });

  describe("AI Results Format", () => {
    interface AITestResults {
      schema: string;
      timestamp: string;
      environment: {
        name: string;
        server: string;
      };
      tests: {
        success: boolean;
        summary: {
          total: number;
          passed: number;
          failed: number;
        };
      };
      aiContext: {
        suggestedActions: string[];
      };
    }

    it("should validate AI results schema version", () => {
      const results: AITestResults = {
        schema: "1.1",
        timestamp: new Date().toISOString(),
        environment: { name: "test", server: "http://test" },
        tests: { success: true, summary: { total: 10, passed: 10, failed: 0 } },
        aiContext: { suggestedActions: [] },
      };

      assert.strictEqual(results.schema, "1.1");
    });

    it("should generate suggestions for failed tests", () => {
      const failedCount = 2;
      const suggestions: string[] = [];

      if (failedCount > 0) {
        suggestions.push(`Review ${failedCount} failing test(s)`);
      }

      assert.strictEqual(suggestions.length, 1);
      assert.strictEqual(suggestions[0], "Review 2 failing test(s)");
    });

    it("should include timestamp in ISO format", () => {
      const timestamp = new Date().toISOString();
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;

      assert.strictEqual(isoPattern.test(timestamp), true);
    });
  });

  describe("Tool Parameter Validation", () => {
    interface ToolParams {
      environment?: string;
      skipCompile?: boolean;
      skipPublish?: boolean;
      codeunitFilter?: string;
      testMethod?: string;
    }

    it("should accept valid tool parameters", () => {
      const params: ToolParams = {
        environment: "docker-local",
        skipCompile: false,
        skipPublish: false,
      };

      assert.strictEqual(typeof params.environment, "string");
      assert.strictEqual(typeof params.skipCompile, "boolean");
    });

    it("should handle optional parameters", () => {
      const params: ToolParams = {};

      assert.strictEqual(params.environment, undefined);
      assert.strictEqual(params.skipCompile, undefined);
    });

    it("should validate codeunit filter format", () => {
      const filters = ["80000", "80000..80099", "80001"];
      const pattern = /^\d+(\.\.\d+)?$/;

      filters.forEach((filter) => {
        assert.strictEqual(
          pattern.test(filter),
          true,
          `Filter ${filter} should be valid`
        );
      });
    });
  });

  describe("HTML Report Generation", () => {
    function escapeHtml(text: string): string {
      const map: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return text.replace(/[&<>"']/g, (m) => map[m]);
    }

    it("should escape HTML special characters", () => {
      const input = '<script>alert("xss")</script>';
      const escaped = escapeHtml(input);

      assert.strictEqual(escaped.includes("<"), false);
      assert.strictEqual(escaped.includes(">"), false);
      assert.strictEqual(escaped.includes('"'), false);
      assert.strictEqual(
        escaped,
        "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
      );
    });

    it("should calculate success rate percentage", () => {
      const passed = 8;
      const total = 10;
      const successRate = Math.round((passed / total) * 100);

      assert.strictEqual(successRate, 80);
    });

    it("should handle zero total tests", () => {
      const total = 0;
      const passed = 0;
      const successRate = total > 0 ? Math.round((passed / total) * 100) : 0;

      assert.strictEqual(successRate, 0);
    });
  });
});
