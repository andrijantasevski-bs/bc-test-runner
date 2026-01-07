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
    this._setupItem();
  }

  private _setupItem(): void {
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

  private _results: AITestResults | null = null;

  constructor(
    private _configManager: ConfigManager,
    private _runner: PowerShellRunner
  ) {
    this._loadResults();
  }

  refresh(): void {
    this._loadResults();
    this._onDidChangeTreeData.fire();
  }

  private async _loadResults(): Promise<void> {
    try {
      const configPath = await this._configManager.findConfigFile();
      if (!configPath) {
        this._results = null;
        return;
      }

      const config = await this._configManager.loadConfig(configPath);
      const resultsFolder = this._configManager.getResultsFolder(config);

      const result = await this._runner.getLatestResults(resultsFolder);
      if (result.success && result.data) {
        this._results = result.data;
      } else {
        this._results = null;
      }
    } catch {
      this._results = null;
    }
  }

  getTreeItem(element: TestResultTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TestResultTreeItem): Thenable<TestResultTreeItem[]> {
    if (!this._results) {
      return Promise.resolve([
        new TestResultTreeItem(
          "No test results available",
          vscode.TreeItemCollapsibleState.None
        ),
      ]);
    }

    if (!element) {
      // Root level - show summary and categories
      return Promise.resolve(this._getRootItems());
    }

    // Child items based on category
    if (element.category === "failed") {
      return Promise.resolve(this._getFailedTests());
    }
    if (element.category === "passed") {
      return Promise.resolve(this._getPassedTests());
    }
    if (element.category === "skipped") {
      return Promise.resolve(this._getSkippedTests());
    }

    return Promise.resolve([]);
  }

  private _getRootItems(): TestResultTreeItem[] {
    const items: TestResultTreeItem[] = [];
    const summary = this._results!.tests.summary;

    // Summary header
    const summaryText = this._results!.tests.success
      ? `✓ All ${summary.total} tests passed`
      : `${summary.passed}/${summary.total} passed, ${summary.failed} failed`;

    const summaryItem = new TestResultTreeItem(
      summaryText,
      vscode.TreeItemCollapsibleState.None,
      undefined,
      "summary"
    );
    summaryItem.iconPath = this._results!.tests.success
      ? new vscode.ThemeIcon(
          "testing-passed-icon",
          new vscode.ThemeColor("testing.iconPassed")
        )
      : new vscode.ThemeIcon(
          "testing-failed-icon",
          new vscode.ThemeColor("testing.iconFailed")
        );
    summaryItem.description = `Duration: ${this._results!.tests.duration}`;
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

  private _getFailedTests(): TestResultTreeItem[] {
    if (!this._results) {
      return [];
    }

    return this._results.tests.failures.map((failure) => {
      const label = `${failure.codeunit}.${failure.method}`;
      const item = new TestResultTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        failure
      );
      return item;
    });
  }

  private _getPassedTests(): TestResultTreeItem[] {
    if (!this._results) {
      return [];
    }

    return this._results.tests.allTests
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

  private _getSkippedTests(): TestResultTreeItem[] {
    if (!this._results) {
      return [];
    }

    return this._results.tests.allTests
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
