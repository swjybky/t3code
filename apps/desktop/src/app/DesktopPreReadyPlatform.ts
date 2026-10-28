// @effect-diagnostics nodeBuiltinImport:off - pre-ready Electron setup reads settings, prepares the Linux desktop entry, and asks Hyprland for its version synchronously before app services are available.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopEarlyElectronStartup from "./DesktopEarlyElectronStartup.ts";
import { resolveDesktopAppBranding } from "./DesktopEnvironment.ts";
import {
  developmentProtocolLaunch,
  renderUrlHandlerDesktopEntry,
} from "./DesktopLinuxUrlHandler.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";

export interface DesktopPreReadyCommandLineReader {
  readonly hasSwitch: (switchName: string) => boolean;
  readonly getSwitchValue: (switchName: string) => string;
}

function resolveLinuxUrlHandlerExec(isDevelopment: boolean): {
  readonly execTarget: string;
  readonly execArguments?: readonly string[];
} {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
  if (isDevelopment && devServerUrl) {
    try {
      // This write happens before the single-instance lock. A callback process
      // must leave the same source launch in place, or the next return is lost.
      const launch = developmentProtocolLaunch({
        devServerUrl: new URL(devServerUrl).origin,
        execPath: process.execPath,
        cwd: process.cwd(),
        argv: process.argv,
        environment: process.env,
        resolvePath: (cwd, target) => NodePath.resolve(cwd, target),
      });
      return { execTarget: launch.execTarget, execArguments: launch.execArguments };
    } catch {
      // An unreadable dev server URL keeps the plain executable.
    }
  }
  return {
    execTarget:
      process.env.T3CODE_DESKTOP_LAUNCHER_PATH?.trim() ||
      process.env.APPIMAGE?.trim() ||
      process.execPath,
  };
}

const DEVELOPMENT_LINUX_ICON_NAME = "black-universal-1024.png";

// Electron's binary icon is a gear. The dev dock reads this entry before any window exists.
export function resolveDevelopmentLinuxIconSource(input: {
  readonly argv: readonly string[];
  readonly cwd: string;
}): string | undefined {
  const devRootPrefix = "--t3code-dev-root=";
  const devRoot = input.argv
    .find((arg) => arg.startsWith(devRootPrefix))
    ?.slice(devRootPrefix.length)
    .trim();
  if (devRoot) {
    return NodePath.resolve(devRoot, "..", "..", "assets", "prod", DEVELOPMENT_LINUX_ICON_NAME);
  }

  const mainEntry = input.argv.find(
    (arg) => arg.endsWith("dist-electron/main.cjs") || arg.endsWith("dist-electron\\main.cjs"),
  );
  if (!mainEntry) return undefined;
  return NodePath.resolve(
    input.cwd,
    mainEntry,
    "..",
    "..",
    "..",
    "..",
    "assets",
    "prod",
    DEVELOPMENT_LINUX_ICON_NAME,
  );
}

function resolveLinuxDesktopIconSource(isDevelopment: boolean): string | undefined {
  if (isDevelopment) {
    const developmentSource = resolveDevelopmentLinuxIconSource({
      argv: process.argv,
      cwd: process.cwd(),
    });
    if (developmentSource !== undefined && NodeFS.existsSync(developmentSource)) {
      return developmentSource;
    }
  }
  if (!Electron.app.isPackaged) return undefined;
  return NodePath.posix.join(Electron.app.getAppPath(), "apps/desktop/prod-resources/icon.png");
}

function readCommandLineSwitchValue(
  commandLine: DesktopPreReadyCommandLineReader,
  switchName: string,
): string | null {
  if (!commandLine.hasSwitch(switchName)) {
    return null;
  }

  const value = commandLine.getSwitchValue(switchName).trim();
  return value.length > 0 ? value : null;
}

export const resolveEarlyLinuxElectronOptionsFromProcess = (
  homeDirectory: string,
): DesktopEarlyElectronStartup.EarlyLinuxElectronOptions =>
  DesktopEarlyElectronStartup.resolveEarlyLinuxElectronOptions({
    env: process.env,
    homeDirectory,
    joinPath: NodePath.posix.join,
    readFileString: (path) => NodeFS.readFileSync(path, "utf8"),
  });

export class DesktopPreReadyElectronOptions extends Context.Service<
  DesktopPreReadyElectronOptions,
  {
    readonly linux: DesktopEarlyElectronStartup.EarlyLinuxElectronOptions | null;
    readonly linuxPasswordStoreCommandLine: string | null;
  }
>()("@t3tools/desktop/app/DesktopPreReadyPlatform/DesktopPreReadyElectronOptions") {}

/** @public */
export const make = Effect.gen(function* () {
  const platform = yield* HostProcess.Platform;
  const homeDirectory = yield* HostProcess.HomeDirectory;
  return yield* Effect.sync((): DesktopPreReadyElectronOptions["Service"] => {
    const linuxPasswordStoreCommandLine =
      platform === "linux"
        ? readCommandLineSwitchValue(Electron.app.commandLine, "password-store")
        : null;
    const linux =
      platform === "linux" ? resolveEarlyLinuxElectronOptionsFromProcess(homeDirectory) : null;

    if (linux !== null) {
      DesktopEarlyElectronStartup.restoreEarlyLinuxDeviceScaleFactor({
        env: process.env,
        homeDirectory,
        joinPath: NodePath.posix.join,
        commandLine: Electron.app.commandLine,
        readFileString: (path) => NodeFS.readFileSync(path, "utf8"),
        writeFileString: (path, value) => {
          NodeFS.mkdirSync(NodePath.posix.dirname(path), { recursive: true });
          NodeFS.writeFileSync(path, value, "utf8");
        },
      });
      // The portal also requires a valid desktop entry. An AppImage update may
      // have removed the executable referenced by the previous launch's entry.
      try {
        const applicationsDir = NodePath.posix.join(
          process.env.XDG_DATA_HOME?.trim() ||
            NodePath.posix.join(homeDirectory, ".local", "share"),
          "applications",
        );
        NodeFS.mkdirSync(applicationsDir, { recursive: true });
        const iconSource = resolveLinuxDesktopIconSource(linux.isDevelopment);
        const iconPath =
          iconSource === undefined
            ? undefined
            : NodePath.posix.join(
                applicationsDir,
                "..",
                "icons",
                `${linux.linuxDesktopEntryName}.png`,
              );
        if (iconSource !== undefined && iconPath !== undefined) {
          try {
            NodeFS.mkdirSync(NodePath.posix.dirname(iconPath), { recursive: true });
            NodeFS.copyFileSync(iconSource, iconPath);
          } catch {}
        }
        const launch = resolveLinuxUrlHandlerExec(linux.isDevelopment);
        NodeFS.writeFileSync(
          NodePath.posix.join(applicationsDir, linux.linuxDesktopEntryName),
          renderUrlHandlerDesktopEntry({
            displayName: resolveDesktopAppBranding({
              isDevelopment: linux.isDevelopment,
              appVersion: Electron.app.getVersion(),
            }).displayName,
            execTarget: launch.execTarget,
            ...(launch.execArguments === undefined ? {} : { execArguments: launch.execArguments }),
            scheme: ElectronProtocol.getDesktopScheme(linux.isDevelopment),
            ...(iconPath === undefined ? {} : { iconPath }),
            ...(linux.isDevelopment ? { visible: true, startupWmClass: linux.linuxWmClass } : {}),
          }),
          "utf8",
        );
      } catch {}
      // Chromium caches portal identity; set it before any asynchronous initialization.
      Electron.app.setDesktopName(linux.linuxDesktopEntryName);
      Electron.app.commandLine.appendSwitch("class", linux.linuxWmClass);
      if (linux.passwordStore !== null && linuxPasswordStoreCommandLine === null) {
        Electron.app.commandLine.appendSwitch("password-store", linux.passwordStore);
      }
      // Chromium keeps only the last --disable-features value, so pass the merged list.
      const disableFeatures = DesktopEarlyElectronStartup.resolveLinuxDisableFeaturesSwitch({
        env: process.env,
        ozonePlatform: readCommandLineSwitchValue(Electron.app.commandLine, "ozone-platform"),
        enableFeatures: readCommandLineSwitchValue(Electron.app.commandLine, "enable-features"),
        disableFeatures: readCommandLineSwitchValue(Electron.app.commandLine, "disable-features"),
        readHyprctlVersionJson: () =>
          NodeChildProcess.execFileSync("hyprctl", ["version", "-j"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 1000,
            maxBuffer: 64 * 1024,
          }),
      });
      if (disableFeatures !== null) {
        Electron.app.commandLine.appendSwitch("disable-features", disableFeatures);
      }
    }

    return { linux, linuxPasswordStoreCommandLine };
  });
}).pipe(Effect.withSpan("desktop.electron.configureBeforeReady"));

// Complete scheme privileges and switches before later layers can observe app readiness.
export const layer = Layer.mergeAll(
  ElectronProtocol.layerSchemePrivileges,
  Layer.effect(DesktopPreReadyElectronOptions, make),
);
