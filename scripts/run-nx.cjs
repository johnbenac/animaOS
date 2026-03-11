const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const env = {
  ...process.env,
  NX_DAEMON: "false",
  NX_ISOLATE_PLUGINS: "false",
  NX_ADD_PLUGINS: "false",
};

const nxBin = require.resolve("nx/bin/nx.js");
const result = spawnSync(process.execPath, [nxBin, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  env,
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
