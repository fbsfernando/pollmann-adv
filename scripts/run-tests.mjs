#!/usr/bin/env node
import { spawnSync } from "node:child_process"

const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== "--runInBand")

const result = spawnSync("npx", ["vitest", "run", ...passthroughArgs], {
  stdio: "inherit",
  shell: process.platform === "win32",
})

process.exit(result.status ?? 1)
