#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import { readdirSync } from "node:fs";
import { execSync, exec } from "node:child_process";
import { promisify } from "node:util";
import { program } from "commander";
import { x } from "tar";
import * as p from "@clack/prompts";
import pkg from "../package.json" with { type: "json" };

const CANCEL_CODE = -1;
const ui = {
  package: "@scirexs/svseeds-ui",
  tar: "scirexs-svseeds-ui",
  dir: "_svseeds",
  tmp: "tmp_svseeds_",
  ext: ".svelte",
  prefix: "_",
  core: "__core.ts",
  style: "__style.ts",
};
const defaultPath = path.join("src", "lib", ui.dir);

program
  .version(pkg.version)
  .argument("[components...]", "Target component names")
  .option("-d, --dir <directory>", "Directory path of components", defaultPath)
  .option("-a, --all", "Copy all components", false)
  .option("-u, --update", "Update mode", false)
  .option("-r, --remove", "Remove mode", false)
  .option("--uninstall", "Remove all components", false)
  .option("--no-confirm", "Skip interactions")
  .option("--no-overwrite", "Does not overwrite if exists")
  .option("--no-style", "Exclude copy of __style.ts file");

export async function main() {
  p.intro("SvSeeds Collector");

  let exitCode = 0;
  let tmp = "";
  const opts = program.parse(process.argv).opts();
  opts.components = program.args;
  opts.copy = !opts.update && !opts.remove && !opts.uninstall;

  try {
    const dest = await getDestinationProcess(opts.dir, opts.confirm);
    if (!opts.copy && !await isExists(dest)) throw new Error("target directory is not exists");

    tmp = await fs.mkdtemp(ui.tmp).catch();
    if (!tmp) throw new Error("failed to create temporary directory");

    const src = await downloadProcess(tmp);
    const avails = getAvailables(src);
    const locals = opts.copy ? [] : getLocalExistingFiles(dest, avails);
    filterAvailables(avails, locals);

    const files = opts.uninstall ? [] : await getSelected(opts.components, opts.all, opts.confirm, avails);
    if (!opts.uninstall && files.length <= 0) throw new Error("no components specified");

    if (opts.update) {
      await updateProcess(src, dest, files, locals);
      p.log.success("Components successfully updated.");
    } else if (opts.remove) {
      await removeProcess(dest, files, locals);
      p.log.success("Components successfully removed.");
    } else if (opts.uninstall) {
      await uninstallProcess(dest, locals);
      p.log.success("SvSeeds successfully uninstalled.");
    } else {
      await copyProcess(src, dest, files, opts.overwrite, opts.style);
      p.log.success("Components successfully copied.");
      p.note(`import ${getNoPrefixName(files[0])} from '$lib/_svseeds/${files[0]}';`, "Usage Example");
      p.outro("Import svelte file as usual.");
    }
  } catch (e) {
    if (e instanceof Error && e.cause !== CANCEL_CODE) {
      p.log.error(`error: ${e.message}`);
      exitCode = 1;
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch();
    if (exitCode) process.exit(exitCode);
  }
}

import type { Option } from "@clack/prompts";
type NameFileSet = Map<string, string>;
type MessageSet = { start: string, success: string, fail: string };
async function waitProcess<Args extends unknown[], R>(msg: MessageSet, fn: (...args: Args) => Promise<R> | R, ...args: Args): Promise<R> {
  const wait = p.spinner();
  wait.start(msg.start);
  let result: R;
  let success = false;
  try {
    result = await fn(...args);
    success = true;
  } finally {
    const [stop, code] = success ? [msg.success, 0] : [msg.fail, 1];
    wait.stop(stop, code);
  }
  return result;
}

async function getDestinationProcess(option: string, confirm: boolean): Promise<string> {
  const project = getProjectPath();
  if (!project) return project;
  const dest = path.join(project, option);

  if (confirm && option !== defaultPath) await confirmPath(`Target directory: ${dest}`);
  return path.normalize(dest);
}
function getProjectPath(): string {
  const dir = path.dirname(execSync("npm root", { encoding: "utf8" }).trim());
  if (dir === path.parse(dir).root) throw new Error("current directory seems to be root");
  return dir;
}
async function confirmPath(message: string) {
  const ok = await p.confirm({ message });
  if (p.isCancel(ok) || !ok) {
    p.cancel("cancelled");
    throw new Error("cancelled", { cause: CANCEL_CODE });
  }
}

async function downloadProcess(tmp: string): Promise<string> {
  const msg: MessageSet = { start: "Preparing", success: "Ready.", fail: "Process failed" };
  return await waitProcess(msg, downloadPackage, tmp);
}
async function downloadPackage(tmp: string): Promise<string> {
  const execPromise = promisify(exec);
  await execPromise(`npm pack ${ui.package}`, { cwd: tmp });
  const tgz = readdirSync(tmp).find(file => file.startsWith(ui.tar) && file.endsWith("gz"));
  if (!tgz) throw new Error(`package ${ui.package} not found`);
  await x({ file: path.join(tmp, tgz), cwd: tmp });

  return path.resolve(path.join(tmp, "package", ui.dir));
}

function getAvailables(src: string): NameFileSet {
  const avails: NameFileSet = new Map();
  readdirSync(src)
    .filter(file => file.endsWith(ui.ext))
    .forEach(file => {
      const name = file.replace(ui.ext, "");
      if (file.startsWith(ui.prefix)) { avails.set(name.replace(ui.prefix, ""), file); }
      avails.set(name, file);
    });
  return avails;
}
function getNoPrefixName(file: string): string {
  return file.replace(ui.ext, "").replace(ui.prefix, "");
}

function filterAvailables(avails: NameFileSet, locals: string[]) {
  if (locals.length <= 0) return;
  for (const [name, file] of avails.entries()) {
    if (!locals.includes(file)) avails.delete(name);
  }
}

async function getSelected(components: string[], all: boolean, confirm: boolean, avails: NameFileSet): Promise<string[]> {
  if (all) {
    return [...new Set([...avails.values()])];
  } else if (components.length > 0) {
    return recognizeValidNames(components, avails).map(name => avails.get(name) ?? "");
  } else {
    if (!confirm) return [];
    return await selectComponentsProcess(avails);
  }
}
function recognizeValidNames(names: string[], avails: NameFileSet): string[] {
  const valid: { true: string[], false: string[] } = { true: [], false: [] };

  names.forEach(name => valid[`${avails.has(name)}`].push(name));
  if (valid.false.length > 0) p.log.warn(`warn: components does not exist: ${valid.false.join(", ")}`);

  return [...new Set(valid.true)];
}
async function selectComponentsProcess(avails: NameFileSet): Promise<string[]> {
  const message = `Select components.`;
  const opts = [...avails.entries()]
    .filter(([name, _]) => !name.startsWith(ui.prefix))
    .map(([name, file]) => ({ value: file, label: name }));

  return selectComponents(message, opts);
}
async function selectComponents(message: string, options: Option<string>[]): Promise<string[]> {
  const selected = await p.multiselect({ message, options, required: true });
  if (p.isCancel(selected)) {
    p.cancel("cancelled");
    throw new Error("cancelled", { cause: -1 });
  }
  return selected;
}

function getLocalExistingFiles(dest: string, avails: NameFileSet): string[] {
  const svseeds = new Set(avails.values());
  svseeds.add(ui.core).add(ui.style);
  const files = readdirSync(dest).filter(file => svseeds.has(file));
  return files;
}

async function updateProcess(src: string, dest: string, locals: string[], files: string[]) {
  const msg: MessageSet = { start: "Start to update", success: "Update done.", fail: "Update failed." };
  await waitProcess(msg, updateFiles, src, dest, files, locals);
}
function updateFiles(src: string, dest: string, locals: string[], files: string[]) {
  const target = locals.filter(file => files.includes(file));
  copyOverwrite(src, dest, target);
}

async function removeProcess(dest: string, locals: string[], files: string[]) {
  const msg: MessageSet = { start: "Start to remove", success: "Remove done.", fail: "Remove failed." };
  await waitProcess(msg, removeFiles, dest, locals, files);
}
async function removeFiles(dest: string, locals: string[], files?: string[]) {
  const target = files ? locals.filter(file => files.includes(file)) : locals;
  for (const file of target) {
    await fs.rm(path.join(dest, file));
  }
}

async function uninstallProcess(dest: string, locals: string[]) {
  const msg: MessageSet = { start: "Start to uninstall", success: "Uninstall done.", fail: "Uninstall failed." };
  await waitProcess(msg, uninstallFiles, dest, locals);
}
async function uninstallFiles(dest: string, locals: string[]) {
  await removeFiles(dest, locals);
  if (readdirSync(dest).length <= 0) await fs.rmdir(dest);
}

async function copyProcess(src: string, dest: string, files: string[], overwrite: boolean, style: boolean) {
  if (style) {
    files.push(ui.core, ui.style);
  } else {
    files.push(ui.core);
  }
  const msg: MessageSet = { start: "Start to copy files", success: "Copy done.", fail: "Copy failed." };
  await waitProcess(msg, copyFiles, src, dest, files, overwrite);
}
async function copyFiles(src: string, dest: string, files: string[], overwrite: boolean) {
  await fs.mkdir(dest, { recursive: true });
  if (overwrite) {
    await copyOverwrite(src, dest, files);
  } else {
    await copyNoOverwrite(src, dest, files);
  }
}
async function copyOverwrite(src: string, dest: string, files: string[]) {
  for (const file of files) {
    await fs.cp(path.join(src, file), path.join(dest, file));
  }
}
async function copyNoOverwrite(src: string, dest: string, files: string[]) {
  const skip: string[] = [];
  for (const file of files) {
    const d = path.join(dest, file);
    if (await isExists(d)) skip.push(file);
    await fs.cp(path.join(src, file), d, { force: false });
  }
  if (skip.length >= 0) p.log.info(`Skipped ${skip.length} files.`);
}
async function isExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch (e) {
    return false;
  }
}
