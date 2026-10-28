import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const {
  appendSwitchMock,
  getSwitchValueMock,
  hasSwitchMock,
  registerSchemesMock,
  setDesktopNameMock,
  mkdirSyncMock,
  writeFileSyncMock,
  copyFileSyncMock,
  existsSyncMock,
  execFileSyncMock,
  readFileSyncMock,
} = vi.hoisted(() => ({
  appendSwitchMock: vi.fn(),
  getSwitchValueMock: vi.fn(),
  hasSwitchMock: vi.fn(),
  registerSchemesMock: vi.fn(),
  setDesktopNameMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  existsSyncMock: vi.fn((_candidate: string) => false),
  execFileSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    setDesktopName: setDesktopNameMock,
    getVersion: () => "0.0.37",
    isPackaged: true,
    getAppPath: () => "/tmp/.mount_T3/resources/app.asar",
    commandLine: {
      appendSwitch: appendSwitchMock,
      getSwitchValue: getSwitchValueMock,
      hasSwitch: hasSwitchMock,
    },
  },
  protocol: {
    registerSchemesAsPrivileged: registerSchemesMock,
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
  existsSync: existsSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  copyFileSync: copyFileSyncMock,
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  it("resolves the black icon from the checkout that launched Electron", () => {
    assert.equal(
      DesktopPreReadyPlatform.resolveDevelopmentLinuxIconSource({
        argv: ["electron", "--t3code-dev-root=/repo/apps/desktop", "dist-electron/main.cjs"],
        cwd: "/somewhere",
      }),
      "/repo/assets/prod/black-universal-1024.png",
    );
    assert.equal(
      DesktopPreReadyPlatform.resolveDevelopmentLinuxIconSource({
        argv: ["electron", "dist-electron/main.cjs"],
        cwd: "/repo/apps/desktop",
      }),
      "/repo/assets/prod/black-universal-1024.png",
    );
    assert.isUndefined(
      DesktopPreReadyPlatform.resolveDevelopmentLinuxIconSource({
        argv: ["electron"],
        cwd: "/tmp",
      }),
    );
  });

  beforeEach(() => {
    appendSwitchMock.mockReset();
    getSwitchValueMock.mockReset();
    hasSwitchMock.mockReset();
    registerSchemesMock.mockReset();
    setDesktopNameMock.mockReset();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    copyFileSyncMock.mockReset();
    existsSyncMock.mockReset().mockReturnValue(false);
    execFileSyncMock.mockReset();
    readFileSyncMock.mockReset().mockReturnValue("{}");
  });

  it.effect("persists Linux scaling synchronously across relaunches and settings rewrites", () => {
    vi.stubEnv("T3CODE_HOME", "/isolated");
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    const settingsPath = "/isolated/userdata/desktop-settings.json";
    const files = new Map([[settingsPath, "{}"]]);
    const commandLine = new Map<string, string>();
    readFileSyncMock.mockImplementation((path: string) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error("ENOENT");
      return contents;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      files.set(path, contents);
    });
    hasSwitchMock.mockImplementation((name: string) => commandLine.has(name));
    getSwitchValueMock.mockImplementation((name: string) => commandLine.get(name) ?? "");
    appendSwitchMock.mockImplementation((name: string, value: string) => {
      commandLine.set(name, value);
    });
    const launch = Effect.gen(function* () {
      const startup = Promise.resolve().then(() => commandLine.get("force-device-scale-factor"));
      yield* DesktopPreReadyPlatform.make;
      return yield* Effect.promise(() => startup);
    });

    return Effect.gen(function* () {
      for (const explicitScale of ["1.75", "1"]) {
        commandLine.clear();
        commandLine.set("force-device-scale-factor", explicitScale);
        appendSwitchMock.mockClear();
        assert.equal(yield* launch, explicitScale);
        assert.isFalse(
          appendSwitchMock.mock.calls.some(([name]) => name === "force-device-scale-factor"),
        );

        // The settings service discards fields it does not own when rewriting its document.
        files.set(settingsPath, JSON.stringify({ linuxPasswordStore: "basic" }));
        commandLine.clear();
        assert.equal(yield* launch, explicitScale);
      }
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    );
  });

  it.effect.each([
    { previousEntry: undefined, label: "missing" },
    { previousEntry: 'Exec="/Applications/deleted-previous.AppImage" %U', label: "stale" },
  ])("prepares a $label Linux desktop entry before startup yields", ({ previousEntry }) => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    getSwitchValueMock.mockReturnValue("");
    let desktopName = "t3code.desktop";
    let desktopEntry = previousEntry;
    let iconInstalled = false;
    copyFileSyncMock.mockImplementation((_source: string, destination: string) => {
      iconInstalled = destination === "/xdg/icons/com.t3tools.T3Code.desktop.png";
    });
    setDesktopNameMock.mockImplementation((name: string) => {
      desktopName = name;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      if (path === "/xdg/applications/com.t3tools.T3Code.desktop") desktopEntry = contents;
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const portalIdentity = Promise.resolve().then(() => ({
          desktopName,
          desktopEntry,
          iconInstalled,
        }));
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const identity = yield* Effect.promise(() => portalIdentity);
        assert.equal(identity.desktopName, "com.t3tools.T3Code.desktop");
        assert.include(identity.desktopEntry ?? "", "Exec=/Applications/current.AppImage %U");
        assert.include(identity.desktopEntry ?? "", "Name=T3 Code (Beta)");
        assert.include(identity.desktopEntry ?? "", "MimeType=x-scheme-handler/t3code;");
        assert.include(
          identity.desktopEntry ?? "",
          "Icon=/xdg/icons/com.t3tools.T3Code.desktop.png",
        );
        assert.isTrue(identity.iconInstalled);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect("keeps the early source-launch entry pointed at this checkout", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");
    vi.stubEnv("T3CODE_PORT", "13773");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "");
    vi.stubEnv("T3CODE_DESKTOP_LAUNCHER_PATH", "");
    getSwitchValueMock.mockReturnValue("");

    return Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const entry = writeFileSyncMock.mock.calls.find(
          ([path]) => path === "/xdg/applications/com.t3tools.T3Code.Development.desktop",
        )?.[1];
        assert.include(
          entry,
          "Exec=env VITE_DEV_SERVER_URL=http://127.0.0.1:5733 T3CODE_PORT=13773 ",
        );
        assert.include(entry, `${process.execPath} `);
        assert.include(entry, "NoDisplay=false");
        assert.include(entry, "StartupWMClass=t3code-dev");
        assert.notInclude(entry, "Exec=" + process.execPath);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect("publishes the black icon on the development launcher before the dock maps it", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "http://127.0.0.1:5733");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "");
    vi.stubEnv("T3CODE_DESKTOP_LAUNCHER_PATH", "");
    getSwitchValueMock.mockReturnValue("");
    const argv = process.argv;
    process.argv = [...argv, "--t3code-dev-root=/repo/apps/desktop"];
    existsSyncMock.mockImplementation(
      (candidate: string) => candidate === "/repo/assets/prod/black-universal-1024.png",
    );

    return Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const entry = writeFileSyncMock.mock.calls.find(
          ([path]) => path === "/xdg/applications/com.t3tools.T3Code.Development.desktop",
        )?.[1];
        assert.include(entry, "Icon=/xdg/icons/com.t3tools.T3Code.Development.desktop.png");
        assert.include(entry, "StartupWMClass=t3code-dev");
        assert.deepEqual(copyFileSyncMock.mock.calls, [
          [
            "/repo/assets/prod/black-universal-1024.png",
            "/xdg/icons/com.t3tools.T3Code.Development.desktop.png",
          ],
        ]);
      }),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          process.argv = argv;
          vi.unstubAllEnvs();
        }),
      ),
    );
  });

  it.effect("points the early portal entry at a configured distribution launcher", () => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    vi.stubEnv("T3CODE_DESKTOP_LAUNCHER_PATH", " /opt/T3 Code/t3code ");
    getSwitchValueMock.mockReturnValue("");

    return Effect.scoped(
      Effect.gen(function* () {
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const entry = writeFileSyncMock.mock.calls.find(
          ([path]) => path === "/xdg/applications/com.t3tools.T3Code.desktop",
        )?.[1];
        assert.include(entry, 'Exec="/opt/T3 Code/t3code" %U');
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect(
    "acquires a synchronous pre-ready layer before an asynchronous Clerk-shaped layer",
    () =>
      Effect.gen(function* () {
        class ClerkShaped extends Context.Service<ClerkShaped, { readonly ready: true }>()(
          "@t3tools/desktop/app/DesktopPreReadyPlatform.test/ClerkShaped",
        ) {}

        const events: Array<string> = [];
        registerSchemesMock.mockImplementation(() => {
          events.push("pre-ready");
        });

        const layerPreReady = DesktopPreReadyPlatform.layer.pipe(
          Layer.provide(Layer.succeed(HostProcess.Platform, "darwin")),
        );

        const layerClerkShaped = Layer.effect(
          ClerkShaped,
          Effect.promise(() => Promise.resolve()).pipe(
            Effect.map(() => {
              events.push("clerk");
              return { ready: true as const };
            }),
          ),
        );

        const layerRuntime = layerClerkShaped.pipe(
          Layer.flatMap((clerkContext) => Layer.succeedContext(clerkContext)),
          Layer.provideMerge(layerPreReady),
        );

        const result = yield* Effect.all({
          clerk: ClerkShaped,
          preReady: DesktopPreReadyPlatform.DesktopPreReadyElectronOptions,
        }).pipe(Effect.provide(layerRuntime));

        assert.deepEqual(result, {
          clerk: { ready: true },
          preReady: {
            linux: null,
            linuxPasswordStoreCommandLine: null,
          },
        });
        assert.deepEqual(events, ["pre-ready", "clerk"]);
        assert.equal(registerSchemesMock.mock.calls.length, 1);
        assert.equal(appendSwitchMock.mock.calls.length, 0);
        assert.equal(setDesktopNameMock.mock.calls.length, 0);
      }),
  );
});
