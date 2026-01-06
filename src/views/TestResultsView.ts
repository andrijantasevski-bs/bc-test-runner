/**
 * BC Test Runner - Test Results Tree View
 *
 * Displays test results in a tree view in the Activity Bar.
 */

import * as vscode from "vscode";
import { ConfigManager } from "../config/ConfigManager";
import {
  PowerShellRunner,
  AITestResults,
  TestResult,
  TestFailure,
} from "../powershell/PowerShellRunner";

/**
 * Tree item for test results
 */
export class TestResultTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly testResult?: TestResult | TestFailure,
    public readonly category?: "summary" | "passed" | "failed" | "skipped"
  ) {
    super(label, collapsibleState);
    this.setupItem();
  }

  private setupItem(): void {
    if (this.category === "summary") {
      this.contextValue = "summary";
      return;
    }

    if (this.testResult) {
      const result =
        "result" in this.testResult ? this.testResult.result : "Fail";

      switch (result) {
        case "Pass":
          this.iconPath = new vscode.ThemeIcon(
            "testing-passed-icon",
            new vscode.ThemeColor("testing.iconPassed")
          );
          this.contextValue = "passedTest";
          break;
        case "Fail":
          this.iconPath = new vscode.ThemeIcon(
            "testing-failed-icon",
            new vscode.ThemeColor("testing.iconFailed")
          );
          this.contextValue = "failedTest";
          if ("error" in this.testResult) {
            this.tooltip = new vscode.MarkdownString();
            this.tooltip.appendMarkdown(
              `**Error:** ${this.testResult.error}\n\n`
            );
            if (this.testResult.stackTrace) {
              this.tooltip.appendCodeblock(
                this.testResult.stackTrace,
                "plaintext"
              );
            }
          }
          break;
        case "Skip":
          this.iconPath = new vscode.ThemeIcon(
            "testing-skipped-icon",
            new vscode.ThemeColor("testing.iconSkipped")
          );
          this.contextValue = "skippedTest";
          break;
      }

      // Add duration to description
      if ("duration" in this.testResult && this.testResult.duration) {
        this.description = `${this.testResult.duration}s`;
      }

      // Make failed tests clickable to navigate to file
      if (
        result === "Fail" &&
        "filePath" in this.testResult &&
        this.testResult.filePath
      ) {
        this.command = {
          command: "vscode.open",
          title: "Go to test",
          arguments: [
            vscode.Uri.file(this.testResult.filePath),
            {
              selection: this.testResult.lineNumber
                ? new vscode.Range(
                    this.testResult.lineNumber - 1,
                    0,
                    this.testResult.lineNumber - 1,
                    0
                  )
                : undefined,
            },
          ],
        };
      }
    }
  }
}

/**
 * Tree data provider for test results
 */
export class TestResultsTreeDataProvider
  implements vscode.TreeDataProvider<TestResultTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TestResultTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private results: AITestResults | null = null;

  constructor(
    private configManager: ConfigManager,
    private runner: PowerShellRunner
  ) {
    this.loadResults();
  }

  refresh(): void {
    this.loadResults();
    this._onDidChangeTreeData.fire();
  }

  private async loadResults(): Promise<void> {
    try {
      const configPath = await this.configManager.findConfigFile();
      if (!configPath) {
        this.results = null;
        return;
      }

      const config = await this.configManager.loadConfig(configPath);
      const resultsFolder = this.configManager.getResultsFolder(config);

      const result = await this.runner.getLatestResults(resultsFolder);
      if (result.success && result.data) {
        this.results = result.data;
      } else {
        this.results = null;
      }
    } catch {
      this.results = null;
    }
  }

  getTreeItem(element: TestResultTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TestResultTreeItem): Thenable<TestResultTreeItem[]> {
    if (!this.results) {
      return Promise.resolve([
        new TestResultTreeItem(
          "No test results available",
          vscode.TreeItemCollapsibleState.None
        ),
      ]);
    }

    if (!element) {
      // Root level - show summary and categories
      return Promise.resolve(this.getRootItems());
    }

    // Child items based on category
    if (element.category === "failed") {
      return Promise.resolve(this.getFailedTests());
    }
    if (element.category === "passed") {
      return Promise.resolve(this.getPassedTests());
    }
    if (element.category === "skipped") {
      return Promise.resolve(this.getSkippedTests());
    }

    return Promise.resolve([]);
  }

  private getRootItems(): TestResultTreeItem[] {
    const items: TestResultTreeItem[] = [];
    const summary = this.results!.tests.summary;

    // Summary header
    const summaryText = this.results!.tests.success
      ? `✓ All ${summary.total} tests passed`
      : `${summary.passed}/${summary.total} passed, ${summary.failed} failed`;

    const summaryItem = new TestResultTreeItem(
      summaryText,
      vscode.TreeItemCollapsibleState.None,
      undefined,
      "summary"
    );
    summaryItem.iconPath = this.results!.tests.success
      ? new vscode.ThemeIcon(
          "testing-passed-icon",
          new vscode.ThemeColor("testing.iconPassed")
        )
      : new vscode.ThemeIcon(
          "testing-failed-icon",
          new vscode.ThemeColor("testing.iconFailed")
        );
    summaryItem.description = `Duration: ${this.results!.tests.duration}`;
    items.push(summaryItem);

    // Failed tests category
    if (summary.failed > 0) {
      const failedItem = new TestResultTreeItem(
        `Failed (${summary.failed})`,
        vscode.TreeItemCollapsibleState.Expanded,
        undefined,
        "failed"
      );
      failedItem.iconPath = new vscode.ThemeIcon(
        "testing-failed-icon",
        new vscode.ThemeColor("testing.iconFailed")
      );
      items.push(failedItem);
    }

    // Passed tests category
    if (summary.passed > 0) {
      const passedItem = new TestResultTreeItem(
        `Passed (${summary.passed})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        "passed"
      );
      passedItem.iconPath = new vscode.ThemeIcon(
        "testing-passed-icon",
        new vscode.ThemeColor("testing.iconPassed")
      );
      items.push(passedItem);
    }

    // Skipped tests category
    if (summary.skipped > 0) {
      const skippedItem = new TestResultTreeItem(
        `Skipped (${summary.skipped})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        "skipped"
      );
      skippedItem.iconPath = new vscode.ThemeIcon(
        "testing-skipped-icon",
        new vscode.ThemeColor("testing.iconSkipped")
      );
      items.push(skippedItem);
    }

    return items;
  }

  private getFailedTests(): TestResultTreeItem[] {
    if (!this.results) return [];

    return this.results.tests.failures.map((failure) => {
      const label = `${failure.codeunit}.${failure.method}`;
      const item = new TestResultTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        failure
      );
      return item;
    });
  }

  private getPassedTests(): TestResultTreeItem[] {
    if (!this.results) return [];

    return this.results.tests.allTests
      .filter((test) => test.result === "Pass")
      .map((test) => {
        const label = `${test.codeunit}.${test.method}`;
        const item = new TestResultTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          test
        );
        return item;
      });
  }

  private getSkippedTests(): TestResultTreeItem[] {
    if (!this.results) return [];

    return this.results.tests.allTests
      .filter((test) => test.result === "Skip")
      .map((test) => {
        const label = `${test.codeunit}.${test.method}`;
        const item = new TestResultTreeItem(
          label,
          vscode.TreeItemCollapsibleState.None,
          test
        );
        return item;
      });
  }
}
