/**
 * BC Test Runner - HTML Report Generator
 *
 * Generates styled HTML reports from test results for comprehensive overview.
 */

import * as path from "path";
import * as fs from "fs";
import { AITestResults, TestFailure } from "../powershell/PowerShellRunner";

/**
 * HTML Report Generator for test results
 */
export class ReportGenerator {
  /**
   * Generate HTML report file
   */
  async generateReport(
    results: AITestResults,
    outputFolder: string
  ): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .substring(0, 19);
    const outputPath = path.join(outputFolder, `TestReport_${timestamp}.html`);

    const html = this._generateHtml(results);
    fs.writeFileSync(outputPath, html, "utf-8");

    return outputPath;
  }

  /**
   * Generate HTML for webview display
   */
  generateWebviewHtml(results: AITestResults): string {
    return this._generateHtml(results, true);
  }

  /**
   * Generate the full HTML document
   */
  private _generateHtml(
    results: AITestResults,
    isWebview: boolean = false
  ): string {
    const summary = results.tests.summary;
    const successRate =
      summary.total > 0
        ? Math.round((summary.passed / summary.total) * 100)
        : 0;

    const statusColor = results.tests.success ? "#28a745" : "#dc3545";
    const statusText = results.tests.success ? "PASSED" : "FAILED";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BC Test Results - ${new Date(
      results.timestamp
    ).toLocaleString()}</title>
    <style>
        ${this._getStyles()}
    </style>
</head>
<body${isWebview ? ' class="vscode-body"' : ""}>
    <div class="container">
        <header class="header">
            <h1>BC Test Results</h1>
            <div class="meta">
                <span class="timestamp">${new Date(
                  results.timestamp
                ).toLocaleString()}</span>
                <span class="environment">${results.environment.name}</span>
            </div>
        </header>

        <section class="summary-section">
            <div class="status-badge" style="background-color: ${statusColor}">
                ${statusText}
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${summary.total}</div>
                    <div class="stat-label">Total Tests</div>
                </div>
                <div class="stat-card passed">
                    <div class="stat-value">${summary.passed}</div>
                    <div class="stat-label">Passed</div>
                </div>
                <div class="stat-card failed">
                    <div class="stat-value">${summary.failed}</div>
                    <div class="stat-label">Failed</div>
                </div>
                <div class="stat-card skipped">
                    <div class="stat-value">${summary.skipped}</div>
                    <div class="stat-label">Skipped</div>
                </div>
            </div>

            <div class="progress-bar">
                <div class="progress-passed" style="width: ${successRate}%"></div>
                <div class="progress-failed" style="width: ${
                  100 - successRate
                }%"></div>
            </div>
            <div class="progress-label">${successRate}% Success Rate • Duration: ${
      results.tests.duration
    }</div>
        </section>

        ${this._generateCompilationSection(results)}
        ${this._generateFailuresSection(results)}
        ${this._generateAllTestsSection(results)}
        ${this._generateAIContextSection(results)}
        ${this._generateEnvironmentSection(results)}
    </div>

    <script>
        ${this._getScripts()}
    </script>
</body>
</html>`;
  }

  /**
   * Generate compilation results section
   */
  private _generateCompilationSection(results: AITestResults): string {
    if (
      !results.compilation ||
      !results.compilation.apps ||
      results.compilation.apps.length === 0
    ) {
      return "";
    }

    const apps = results.compilation.apps
      .map((app) => {
        const status = app.success ? "✓" : "✗";
        const statusClass = app.success ? "success" : "error";

        let errorsHtml = "";
        if (app.errors && app.errors.length > 0) {
          errorsHtml = `
                    <div class="compilation-errors">
                        <h5>Errors:</h5>
                        <ul>
                            ${app.errors
                              .map(
                                (e) => `
                                <li class="compilation-error">
                                    <code>${this._escapeHtml(e.file)}:${
                                  e.line
                                }:${e.column}</code>
                                    <span class="error-code">${e.code}</span>
                                    <span class="error-msg">${this._escapeHtml(
                                      e.message
                                    )}</span>
                                </li>
                            `
                              )
                              .join("")}
                        </ul>
                    </div>
                `;
        }

        return `
                <div class="app-result ${statusClass}">
                    <span class="status-icon">${status}</span>
                    <span class="app-name">${this._escapeHtml(
                      path.basename(app.project)
                    )}</span>
                    <span class="duration">${app.duration}</span>
                    ${errorsHtml}
                </div>
            `;
      })
      .join("");

    return `
            <section class="section">
                <h2 class="section-title">
                    <span class="icon">📦</span> Compilation
                    <span class="badge ${
                      results.compilation.success ? "success" : "error"
                    }">
                        ${results.compilation.success ? "Success" : "Failed"}
                    </span>
                </h2>
                <div class="apps-list">
                    ${apps}
                </div>
            </section>
        `;
  }

  /**
   * Generate failures section
   */
  private _generateFailuresSection(results: AITestResults): string {
    if (results.tests.failures.length === 0) {
      return "";
    }

    const failures = results.tests.failures
      .map((failure, index) => this._generateFailureCard(failure, index))
      .join("");

    return `
            <section class="section failures-section">
                <h2 class="section-title">
                    <span class="icon">❌</span> Failed Tests (${results.tests.failures.length})
                </h2>
                <div class="failures-list">
                    ${failures}
                </div>
            </section>
        `;
  }

  /**
   * Generate a single failure card
   */
  private _generateFailureCard(failure: TestFailure, index: number): string {
    const locationHtml = failure.filePath
      ? `<div class="failure-location">
                <span class="icon">📍</span>
                <code>${this._escapeHtml(failure.filePath)}${
          failure.lineNumber ? `:${failure.lineNumber}` : ""
        }</code>
               </div>`
      : "";

    return `
            <div class="failure-card" id="failure-${index}">
                <div class="failure-header">
                    <span class="failure-number">#${index + 1}</span>
                    <span class="failure-codeunit">${this._escapeHtml(
                      failure.codeunit
                    )}</span>
                    <span class="failure-method">${this._escapeHtml(
                      failure.method
                    )}</span>
                    <span class="failure-duration">${failure.duration}s</span>
                </div>
                <div class="failure-name">${this._escapeHtml(
                  failure.testName
                )}</div>
                ${locationHtml}
                <div class="failure-error">
                    <strong>Error:</strong>
                    <pre>${this._escapeHtml(failure.error)}</pre>
                </div>
                ${
                  failure.stackTrace
                    ? `
                    <details class="failure-stack">
                        <summary>Stack Trace</summary>
                        <pre>${this._escapeHtml(failure.stackTrace)}</pre>
                    </details>
                `
                    : ""
                }
            </div>
        `;
  }

  /**
   * Generate all tests section
   */
  private _generateAllTestsSection(results: AITestResults): string {
    const tests = results.tests.allTests;
    if (tests.length === 0) {
      return "";
    }

    // Group by codeunit
    const grouped = tests.reduce((acc, test) => {
      if (!acc[test.codeunit]) {
        acc[test.codeunit] = [];
      }
      acc[test.codeunit].push(test);
      return acc;
    }, {} as Record<string, typeof tests>);

    const codeunits = Object.entries(grouped)
      .map(([codeunit, tests]) => {
        const passed = tests.filter((t) => t.result === "Pass").length;
        const failed = tests.filter((t) => t.result === "Fail").length;

        const testRows = tests
          .map((test) => {
            const statusIcon =
              test.result === "Pass" ? "✓" : test.result === "Fail" ? "✗" : "○";
            const statusClass = test.result.toLowerCase();
            return `
                    <tr class="test-row ${statusClass}">
                        <td class="status-cell"><span class="status-icon">${statusIcon}</span></td>
                        <td class="method-cell">${this._escapeHtml(
                          test.method
                        )}</td>
                        <td class="duration-cell">${test.duration}s</td>
                    </tr>
                `;
          })
          .join("");

        return `
                <div class="codeunit-group">
                    <div class="codeunit-header" onclick="toggleCodeunit(this)">
                        <span class="expand-icon">▼</span>
                        <span class="codeunit-name">${this._escapeHtml(
                          codeunit
                        )}</span>
                        <span class="codeunit-stats">
                            <span class="passed">${passed} passed</span>
                            ${
                              failed > 0
                                ? `<span class="failed">${failed} failed</span>`
                                : ""
                            }
                        </span>
                    </div>
                    <table class="tests-table">
                        <tbody>
                            ${testRows}
                        </tbody>
                    </table>
                </div>
            `;
      })
      .join("");

    return `
            <section class="section">
                <h2 class="section-title">
                    <span class="icon">📋</span> All Tests (${tests.length})
                </h2>
                <div class="codeunits-list">
                    ${codeunits}
                </div>
            </section>
        `;
  }

  /**
   * Generate AI context section
   */
  private _generateAIContextSection(results: AITestResults): string {
    if (!results.aiContext) {
      return "";
    }

    const hints =
      results.aiContext.analysisHints
        ?.map((hint) => `<li>${this._escapeHtml(hint)}</li>`)
        .join("") || "";

    const actions =
      results.aiContext.suggestedActions
        ?.map((action) => `<li>${this._escapeHtml(action)}</li>`)
        .join("") || "";

    return `
            <section class="section ai-section">
                <h2 class="section-title">
                    <span class="icon">🤖</span> AI Analysis Context
                </h2>
                <div class="ai-content">
                    ${
                      actions
                        ? `
                        <div class="ai-block">
                            <h4>Suggested Actions</h4>
                            <ul class="actions-list">${actions}</ul>
                        </div>
                    `
                        : ""
                    }
                    ${
                      hints
                        ? `
                        <div class="ai-block">
                            <h4>Analysis Hints</h4>
                            <ul class="hints-list">${hints}</ul>
                        </div>
                    `
                        : ""
                    }
                </div>
            </section>
        `;
  }

  /**
   * Generate environment section
   */
  private _generateEnvironmentSection(results: AITestResults): string {
    return `
            <section class="section env-section">
                <h2 class="section-title">
                    <span class="icon">⚙️</span> Environment
                </h2>
                <div class="env-details">
                    <div class="env-item">
                        <span class="env-label">Name:</span>
                        <span class="env-value">${this._escapeHtml(
                          results.environment.name
                        )}</span>
                    </div>
                    <div class="env-item">
                        <span class="env-label">Server:</span>
                        <span class="env-value">${this._escapeHtml(
                          results.environment.server
                        )}</span>
                    </div>
                    <div class="env-item">
                        <span class="env-label">Instance:</span>
                        <span class="env-value">${this._escapeHtml(
                          results.environment.serverInstance
                        )}</span>
                    </div>
                    <div class="env-item">
                        <span class="env-label">Authentication:</span>
                        <span class="env-value">${this._escapeHtml(
                          results.environment.authentication
                        )}</span>
                    </div>
                </div>
            </section>
        `;
  }

  /**
   * Get CSS styles
   */
  private _getStyles(): string {
    return `
            :root {
                --bg-color: #1e1e1e;
                --card-bg: #252526;
                --text-color: #cccccc;
                --text-muted: #808080;
                --border-color: #3c3c3c;
                --success-color: #28a745;
                --error-color: #dc3545;
                --warning-color: #ffc107;
                --info-color: #17a2b8;
            }

            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background-color: var(--bg-color);
                color: var(--text-color);
                line-height: 1.6;
                padding: 20px;
            }

            .vscode-body {
                padding: 0;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
            }

            .header {
                text-align: center;
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--border-color);
            }

            .header h1 {
                font-size: 2em;
                margin-bottom: 10px;
            }

            .meta {
                color: var(--text-muted);
            }

            .meta span {
                margin: 0 10px;
            }

            .summary-section {
                text-align: center;
                margin-bottom: 30px;
            }

            .status-badge {
                display: inline-block;
                padding: 10px 30px;
                border-radius: 25px;
                font-size: 1.2em;
                font-weight: bold;
                color: white;
                margin-bottom: 20px;
            }

            .stats-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 15px;
                margin-bottom: 20px;
            }

            .stat-card {
                background: var(--card-bg);
                padding: 20px;
                border-radius: 8px;
                border: 1px solid var(--border-color);
            }

            .stat-value {
                font-size: 2em;
                font-weight: bold;
            }

            .stat-label {
                color: var(--text-muted);
                font-size: 0.9em;
            }

            .stat-card.passed .stat-value { color: var(--success-color); }
            .stat-card.failed .stat-value { color: var(--error-color); }
            .stat-card.skipped .stat-value { color: var(--warning-color); }

            .progress-bar {
                display: flex;
                height: 8px;
                border-radius: 4px;
                overflow: hidden;
                background: var(--border-color);
                margin-bottom: 10px;
            }

            .progress-passed {
                background: var(--success-color);
            }

            .progress-failed {
                background: var(--error-color);
            }

            .progress-label {
                color: var(--text-muted);
                font-size: 0.9em;
            }

            .section {
                background: var(--card-bg);
                border-radius: 8px;
                padding: 20px;
                margin-bottom: 20px;
                border: 1px solid var(--border-color);
            }

            .section-title {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 15px;
                font-size: 1.2em;
            }

            .badge {
                font-size: 0.7em;
                padding: 3px 10px;
                border-radius: 12px;
                font-weight: normal;
            }

            .badge.success { background: var(--success-color); color: white; }
            .badge.error { background: var(--error-color); color: white; }

            .failure-card {
                background: rgba(220, 53, 69, 0.1);
                border: 1px solid var(--error-color);
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 15px;
            }

            .failure-header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 10px;
            }

            .failure-number {
                background: var(--error-color);
                color: white;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 0.8em;
            }

            .failure-codeunit {
                font-weight: bold;
            }

            .failure-method {
                color: var(--info-color);
            }

            .failure-duration {
                margin-left: auto;
                color: var(--text-muted);
            }

            .failure-name {
                color: var(--text-muted);
                margin-bottom: 10px;
            }

            .failure-location {
                margin-bottom: 10px;
            }

            .failure-location code {
                background: rgba(0,0,0,0.3);
                padding: 2px 6px;
                border-radius: 4px;
            }

            .failure-error pre {
                background: rgba(0,0,0,0.3);
                padding: 10px;
                border-radius: 4px;
                overflow-x: auto;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .failure-stack summary {
                cursor: pointer;
                color: var(--info-color);
                margin-top: 10px;
            }

            .failure-stack pre {
                background: rgba(0,0,0,0.3);
                padding: 10px;
                border-radius: 4px;
                margin-top: 10px;
                font-size: 0.85em;
                overflow-x: auto;
            }

            .codeunit-group {
                margin-bottom: 10px;
            }

            .codeunit-header {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px;
                background: rgba(0,0,0,0.2);
                border-radius: 4px;
                cursor: pointer;
            }

            .codeunit-header:hover {
                background: rgba(0,0,0,0.3);
            }

            .expand-icon {
                transition: transform 0.2s;
            }

            .codeunit-header.collapsed .expand-icon {
                transform: rotate(-90deg);
            }

            .codeunit-stats {
                margin-left: auto;
                font-size: 0.85em;
            }

            .codeunit-stats .passed { color: var(--success-color); margin-right: 10px; }
            .codeunit-stats .failed { color: var(--error-color); }

            .tests-table {
                width: 100%;
                margin-top: 5px;
                border-collapse: collapse;
            }

            .test-row td {
                padding: 8px 10px;
                border-bottom: 1px solid var(--border-color);
            }

            .test-row.pass .status-icon { color: var(--success-color); }
            .test-row.fail .status-icon { color: var(--error-color); }
            .test-row.skip .status-icon { color: var(--warning-color); }

            .status-cell { width: 30px; }
            .duration-cell { width: 80px; text-align: right; color: var(--text-muted); }

            .ai-section {
                background: linear-gradient(135deg, #252526 0%, #2d2d30 100%);
            }

            .ai-content {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
            }

            .ai-block h4 {
                margin-bottom: 10px;
                color: var(--info-color);
            }

            .ai-block ul {
                list-style: none;
            }

            .ai-block li {
                padding: 5px 0;
                padding-left: 20px;
                position: relative;
            }

            .ai-block li::before {
                content: '→';
                position: absolute;
                left: 0;
                color: var(--info-color);
            }

            .env-details {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 10px;
            }

            .env-item {
                display: flex;
                gap: 10px;
            }

            .env-label {
                color: var(--text-muted);
            }

            .app-result {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 5px;
            }

            .app-result.success {
                background: rgba(40, 167, 69, 0.1);
            }

            .app-result.error {
                background: rgba(220, 53, 69, 0.1);
            }

            .app-result .status-icon {
                font-size: 1.2em;
            }

            .app-result.success .status-icon { color: var(--success-color); }
            .app-result.error .status-icon { color: var(--error-color); }

            .app-result .duration {
                margin-left: auto;
                color: var(--text-muted);
            }

            .compilation-errors {
                margin-top: 10px;
                padding-left: 30px;
            }

            .compilation-error {
                margin-bottom: 5px;
                font-size: 0.9em;
            }

            .error-code {
                background: var(--error-color);
                color: white;
                padding: 1px 5px;
                border-radius: 3px;
                font-size: 0.8em;
                margin: 0 5px;
            }

            @media (max-width: 768px) {
                .stats-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
            }
        `;
  }

  /**
   * Get JavaScript for interactivity
   */
  private _getScripts(): string {
    return `
            function toggleCodeunit(header) {
                header.classList.toggle('collapsed');
                const table = header.nextElementSibling;
                table.style.display = header.classList.contains('collapsed') ? 'none' : 'table';
            }
        `;
  }

  /**
   * Escape HTML special characters
   */
  private _escapeHtml(text: string): string {
    /* eslint-disable @typescript-eslint/naming-convention */
    const htmlEscapeMap: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    return text.replace(/[&<>"']/g, (m) => htmlEscapeMap[m]);
  }
}
