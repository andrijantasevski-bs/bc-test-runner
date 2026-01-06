/**
 * BC Test Runner - Mocha Test Suite Index
 *
 * This file sets up the Mocha test runner and discovers all test files.
 */

import * as path from "path";
import Mocha from "mocha";
import * as fs from "fs";

export async function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
    timeout: 60000, // 60 second timeout for tests
  });

  const testsRoot = path.resolve(__dirname, "..");

  // Find all test files manually
  const testFiles = findTestFiles(testsRoot);

  // Add files to the test suite
  for (const file of testFiles) {
    mocha.addFile(file);
  }

  // Run the mocha test
  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
      } else {
        resolve();
      }
    });
  });
}

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results.push(...findTestFiles(filePath));
    } else if (file.endsWith(".test.js")) {
      results.push(filePath);
    }
  }

  return results;
}
