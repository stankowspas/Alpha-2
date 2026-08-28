import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const HOST = "127.0.0.10";
const WEB_PORT = 5173;
const SEARCH_PORT = 5174;
const FETCH_PORT = 5175;

const configuredSecret = process.env.ALPHA_SOURCE_TOKEN_SECRET?.trim();
const sharedSecret = configuredSecret || randomBytes(32).toString("hex");
if (sharedSecret.length < 24) {
  throw new Error("ALPHA_SOURCE_TOKEN_SECRET трябва да е поне 24 символа.");
}

const env = {
  ...process.env,
  ALPHA_SOURCE_TOKEN_SECRET: sharedSecret,
  ALPHA_ALLOWED_ORIGIN: `http://${HOST}:${WEB_PORT}`,
  SEARCH_HOST: HOST,
  SEARCH_PORT: String(SEARCH_PORT),
  FETCH_HOST: HOST,
  FETCH_PORT: String(FETCH_PORT),
  VITE_SEARCH_ENDPOINT: `http://${HOST}:${SEARCH_PORT}/api/search`,
  VITE_FETCH_ENDPOINT: `http://${HOST}:${FETCH_PORT}/api/fetch-extract`
};

const processes = [
  { name: "search", args: ["run", "dev:search"] },
  { name: "fetch", args: ["run", "dev:fetch"] },
  { name: "web", args: ["run", "dev:web"] }];

const children = new Set();
let shuttingDown = false;

function stopAll(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = exitCode;
}

function spawnNpm(processSpec) {
  const options = {
    cwd: process.cwd(),
    env,
    stdio: "inherit"
  };

  if (process.platform === "win32") {
    const commandProcessor = process.env.ComSpec?.trim() || "cmd.exe";
    return spawn(commandProcessor, ["/d", "/s", "/c", `npm ${processSpec.args.join(" ")}`], options);
  }

  return spawn("npm", processSpec.args, options);
}

for (const processSpec of processes) {  const child = spawnNpm(processSpec);
  children.add(child);

  child.on("error", (error) => {
    console.error(`[Alpha Chat] ${processSpec.name} не можа да стартира: ${error.message}`);
    stopAll(1);
  });

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[Alpha Chat] ${processSpec.name} приключи неочаквано (${reason}).`);
    stopAll(code === 0 ? 1 : (code ?? 1));
  });
}

process.once("SIGINT", () => stopAll(0));
process.once("SIGTERM", () => stopAll(0));