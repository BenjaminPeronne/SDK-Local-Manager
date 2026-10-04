const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  AppUpdater,
  LINUX_SCRIPT,
  MAC_SCRIPT,
  UpdateError,
  isNewer,
  macBundle,
  parseManifest,
  selectInstaller,
} = require("../updater.cjs");

const BASE = "https://gitlab.example/api/v4/projects/1/packages/generic/sdk-local-manager";
const TAG = "app-v0.14.0-build2";
const DMG = "SDK-Local-Manager-0.14.0-mac-arm64.dmg";
const EXE = "SDK-Local-Manager-0.14.0-win-x64.exe";
const APPIMAGE = "SDK-Local-Manager-0.14.0-linux-x86_64.AppImage";
const DEB = "SDK-Local-Manager-0.14.0-linux-amd64.deb";

function sha512(data) {
  return crypto.createHash("sha512").update(data).digest("hex");
}

/**
 * Exécutable d'une application macOS écrit comme sur un Mac, quel que soit le système qui lance
 * les tests : sous Windows, path.join produirait des « \\ » qu'aucun chemin macOS ne contient.
 */
function macExecutablePath(bundle) {
  return [...bundle.split(path.sep), "Contents", "MacOS", "SDK Local Manager"].join("/");
}

function temporaryDirectory(t, prefix = "sdk-update-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Registre de paquets simulé : `files` associe un nom de fichier à son contenu. */
function registry(files, { manifest, status = {}, redirect = {} } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const name = decodeURIComponent(url.slice(`${BASE}/${TAG}/`.length));
    const response =
      status[name] !== undefined
        ? new Response("", { status: status[name] })
        : name === "update-manifest.json"
          ? new Response(JSON.stringify(manifest ?? manifestOf(files)), { status: 200 })
          : files[name] !== undefined
            ? new Response(files[name], { status: 200, headers: { "content-length": String(files[name].length) } })
            : new Response("", { status: 404 });
    if (redirect[name]) Object.defineProperty(response, "url", { value: redirect[name] });
    return response;
  };
  return { fetch, calls };
}

function manifestOf(files, version = "0.14.0") {
  return {
    version,
    files: Object.entries(files).map(([name, data]) => ({ name, sha512: sha512(data), size: data.length })),
  };
}

function updater(t, overrides = {}) {
  const workDir = path.join(temporaryDirectory(t), "work");
  return new AppUpdater({
    currentVersion: "0.13.1",
    workDir,
    baseUrl: BASE,
    platform: "win32",
    arch: "x64",
    execPath: "C:\\Users\\me\\AppData\\Local\\Programs\\sdk\\SDK Local Manager.exe",
    env: { SystemRoot: "C:\\Windows" },
    pid: 4242,
    openPath: async () => "",
    ...overrides,
  });
}

test("versions compare as numbers, and only a newer one is an update", () => {
  assert.equal(isNewer("0.10.0", "0.9.9"), true);
  assert.equal(isNewer("0.13.1", "0.13.1"), false);
  assert.equal(isNewer("0.13.0", "0.13.1"), false);
  assert.equal(isNewer("1.0.0", "0.99.0"), true);
});

test("the manifest keeps only well-formed installers of the announced version", () => {
  const good = { name: DMG, sha512: "a".repeat(128), size: 10 };
  const installers = parseManifest(
    JSON.stringify({
      version: "0.14.0",
      files: [
        good,
        { ...good, name: "../SDK-Local-Manager-0.14.0-mac-arm64.dmg" },
        { ...good, name: "SDK-Local-Manager-0.13.0-mac-arm64.dmg" },
        { ...good, name: EXE, sha512: "not-a-hash" },
        { ...good, name: DEB, size: 0 },
        { ...good, name: APPIMAGE, size: 10 * 1024 ** 3 },
      ],
    }),
    "0.14.0",
  );
  assert.deepEqual(
    installers.map((item) => [item.name, item.system, item.arch, item.kind]),
    [[DMG, "mac", "arm64", "dmg"]],
  );
  assert.throws(() => parseManifest(JSON.stringify({ version: "0.15.0", files: [] }), "0.14.0"), UpdateError);
  assert.throws(() => parseManifest("{not json", "0.14.0"), UpdateError);
});

test("each system receives its own installer, matched on architecture", () => {
  const installers = parseManifest(
    JSON.stringify(
      manifestOf({
        [DMG]: Buffer.from("m"),
        [EXE]: Buffer.from("w"),
        [APPIMAGE]: Buffer.from("a"),
        [DEB]: Buffer.from("d"),
      }),
    ),
    "0.14.0",
  );
  const pick = (platform, arch, env = {}) => selectInstaller(installers, { platform, arch, env })?.name || null;
  assert.equal(pick("darwin", "arm64"), DMG);
  assert.equal(pick("darwin", "x64"), null);
  assert.equal(pick("win32", "x64"), EXE);
  assert.equal(pick("linux", "x64", { APPIMAGE: "/home/me/sdk.AppImage" }), APPIMAGE);
  assert.equal(pick("linux", "x64"), DEB);
});

test("the running bundle is found from the executable path", () => {
  assert.equal(
    macBundle("/Applications/SDK Local Manager.app/Contents/MacOS/SDK Local Manager"),
    "/Applications/SDK Local Manager.app",
  );
  assert.equal(macBundle("/usr/bin/electron"), "");
});

test("each installation says how it can be updated", (t) => {
  const applications = temporaryDirectory(t);
  const bundle = path.join(applications, "SDK Local Manager.app");
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  const macExecutable = macExecutablePath(bundle);

  assert.equal(updater(t, { packaged: false }).support().mode, "none");
  assert.equal(updater(t, { platform: "darwin", execPath: macExecutable }).support().mode, "restart");
  const translocated =
    "/private/var/folders/x/AppTranslocation/1234/d/SDK Local Manager.app/Contents/MacOS/SDK Local Manager";
  assert.equal(updater(t, { platform: "darwin", execPath: translocated }).support().mode, "installer");
  assert.equal(updater(t).support().mode, "restart");
  assert.equal(updater(t, { platform: "linux", env: {} }).support().mode, "installer");
  const appImage = path.join(applications, "sdk.AppImage");
  fs.writeFileSync(appImage, "old");
  assert.equal(updater(t, { platform: "linux", env: { APPIMAGE: appImage } }).support().mode, "restart");
});

test("only a valid tag of a newer version is downloaded", async (t) => {
  const update = updater(t, registry({}));
  await assert.rejects(update.download("../../etc/passwd"), /invalide/);
  await assert.rejects(update.download("app-v0.13.1-build9"), /pas plus récente/);
  await assert.rejects(update.download("app-v0.9.0-build1"), /pas plus récente/);
});

test("the installer is downloaded, checked against the manifest and reported as it arrives", async (t) => {
  const installer = crypto.randomBytes(300 * 1024);
  const { fetch, calls } = registry({ [EXE]: installer, [DMG]: Buffer.from("other") });
  const progress = [];
  const update = updater(t, { fetch, onProgress: (step) => progress.push(step) });

  const result = await update.download(TAG);

  assert.deepEqual(result, { version: "0.14.0", mode: "restart", hint: "" });
  assert.deepEqual(
    calls.map((call) => call.url),
    [`${BASE}/${TAG}/update-manifest.json`, `${BASE}/${TAG}/${EXE}`],
  );
  assert.equal(calls[1].init.redirect, "follow");
  assert.deepEqual(fs.readFileSync(update.prepared.file), installer);
  assert.deepEqual(progress.at(-1), { received: installer.length, total: installer.length });
  // Une seconde demande ne retélécharge pas.
  assert.deepEqual(await update.download(TAG), result);
  assert.equal(calls.length, 2);
});

test("a corrupted download is refused and leaves nothing behind", async (t) => {
  const installer = Buffer.from("genuine installer");
  const { fetch } = registry(
    { [EXE]: Buffer.from("tampered installer!") },
    { manifest: manifestOf({ [EXE]: installer }) },
  );
  const update = updater(t, { fetch });

  await assert.rejects(update.download(TAG), /incomplet ou altéré/);
  assert.equal(update.prepared, null);
  assert.deepEqual(fs.readdirSync(update.workDir), []);
});

test("a full disk stops the update before downloading anything", async (t) => {
  const { fetch, calls } = registry({ [EXE]: Buffer.from("installer") });
  const update = updater(t, { fetch, freeSpace: () => 1024 });

  await assert.rejects(update.download(TAG), /Espace disque insuffisant/);
  assert.deepEqual(
    calls.map((call) => call.url),
    [`${BASE}/${TAG}/update-manifest.json`],
  );
});

test("a release without automatic download falls back to the release page", async (t) => {
  for (const code of [401, 403, 404]) {
    const { fetch } = registry({}, { status: { "update-manifest.json": code } });
    await assert.rejects(updater(t, { fetch }).download(TAG), /pas encore disponible/);
  }
});

test("a redirect to a less secure address is refused", async (t) => {
  const installer = Buffer.from("installer");
  const { fetch } = registry({ [EXE]: installer }, { redirect: { [EXE]: "http://storage.example/installer.exe" } });
  await assert.rejects(updater(t, { fetch }).download(TAG), /non sécurisée/);
});

/**
 * Outils macOS simulés : montage de l'image (diskutil ou hdiutil), copie, lecture d'Info.plist.
 * `oldMacOS` imite un système sans `diskutil image` ; `identifier` l'application que contient l'image.
 */
function macTools({
  oldMacOS = false,
  identifier = "com.sudokeys.odoo-manager",
  appName = "SDK Local Manager.app",
} = {}) {
  const commands = [];
  const mount = (volume) => {
    fs.mkdirSync(path.join(volume, appName, "Contents"), { recursive: true });
    fs.mkdirSync(path.join(volume, "Applications"), { recursive: true });
  };
  const run = async (command, args) => {
    const tool = path.basename(command);
    commands.push(
      tool === "ditto"
        ? "ditto"
        : tool === "diskutil" && args[0] === "image"
          ? `diskutil image ${args[1]}`
          : `${tool} ${args[0]}`,
    );
    if (tool === "diskutil" && args[0] === "image") {
      if (oldMacOS) throw new Error('diskutil: did not recognize verb "image"');
      mount(args[args.indexOf("--mountPoint") + 1]);
    }
    if (tool === "diskutil" && args[0] === "eject" && oldMacOS) throw new Error("Volume failed to eject");
    if (tool === "hdiutil" && args[0] === "attach") mount(args[args.indexOf("-mountpoint") + 1]);
    if (tool === "ditto") fs.cpSync(args[0], args[1], { recursive: true });
    if (tool === "plutil") return args[1] === "CFBundleIdentifier" ? identifier : "0.14.0";
    return "";
  };
  return { run, commands };
}

function macUpdater(t, tools) {
  const bundle = path.join(temporaryDirectory(t), "SDK Local Manager.app");
  fs.mkdirSync(path.join(bundle, "Contents", "MacOS"), { recursive: true });
  return updater(t, {
    ...registry({ [DMG]: Buffer.from("disk image") }),
    platform: "darwin",
    arch: "arm64",
    execPath: macExecutablePath(bundle),
    run: tools.run,
  });
}

test("on macOS the downloaded image is opened, copied and checked before anything is replaced", async (t) => {
  const tools = macTools();
  const update = macUpdater(t, tools);

  await update.download(TAG);

  assert.deepEqual(tools.commands, [
    "diskutil image attach",
    "ditto",
    "diskutil eject",
    "plutil -extract",
    "plutil -extract",
    "codesign --verify",
  ]);
  assert.equal(path.basename(update.prepared.staged), "SDK Local Manager.app");
  assert.ok(fs.existsSync(update.prepared.staged));
});

test("on an older macOS without diskutil image, hdiutil opens and closes the image", async (t) => {
  const tools = macTools({ oldMacOS: true });
  const update = macUpdater(t, tools);

  await update.download(TAG);

  assert.deepEqual(tools.commands, [
    "diskutil image attach",
    "hdiutil attach",
    "ditto",
    "diskutil eject",
    "hdiutil detach",
    "plutil -extract",
    "plutil -extract",
    "codesign --verify",
  ]);
  assert.ok(fs.existsSync(update.prepared.staged));
});

test("on macOS an image holding another application is refused", async (t) => {
  const update = macUpdater(t, macTools({ identifier: "com.example.other", appName: "Other.app" }));
  await assert.rejects(update.download(TAG), /ne correspond pas/);
});

test("on Windows the installer itself is launched, silently, once the backend is stopped", async (t) => {
  const events = [];
  const markerPath = path.join(temporaryDirectory(t), "update-pending.json");
  const update = updater(t, {
    ...registry({ [EXE]: Buffer.from("installer") }),
    markerPath,
    launch: async (command, args) => events.push(["launch", path.basename(command), args]),
  });
  await update.download(TAG);

  await update.install({
    beforeExit: async () => events.push(["stop backend", JSON.parse(fs.readFileSync(markerPath, "utf8")).version]),
    exit: () => events.push(["exit"]),
  });

  // Pas de script intermédiaire : powershell.exe détaché sort sans rien exécuter. L'installateur NSIS attend et relance seul.
  assert.deepEqual(events, [["stop backend", "0.14.0"], ["launch", EXE, ["--updated", "/S", "--force-run"]], ["exit"]]);
});

test("on Windows an installer that cannot start keeps the application open and forgets the attempt", async (t) => {
  const events = [];
  const markerPath = path.join(temporaryDirectory(t), "update-pending.json");
  const update = updater(t, {
    ...registry({ [EXE]: Buffer.from("installer") }),
    markerPath,
    launch: async () => {
      throw new Error("blocked");
    },
  });
  await update.download(TAG);

  await assert.rejects(
    update.install({ beforeExit: async () => events.push("stop"), exit: () => events.push("exit") }),
    /Ferme puis rouvre/,
  );
  assert.deepEqual(events, ["stop"]);
  assert.equal(fs.existsSync(markerPath), false);
});

test("on macOS and Linux a replacement that cannot start stops nothing", async (t) => {
  const folder = temporaryDirectory(t);
  const appImage = path.join(folder, "sdk.AppImage");
  fs.writeFileSync(appImage, "old version");
  const events = [];
  const update = updater(t, {
    ...registry({ [APPIMAGE]: Buffer.from("new version") }),
    platform: "linux",
    env: { APPIMAGE: appImage },
    launch: async () => {
      throw new Error("ENOENT");
    },
  });
  await update.download(TAG);

  await assert.rejects(
    update.install({ beforeExit: async () => events.push("stop"), exit: () => events.push("exit") }),
    /n'a pas pu démarrer/,
  );
  assert.deepEqual(events, []);
});

test("the next start tells whether the update took, once", async (t) => {
  const folder = temporaryDirectory(t);
  const markerPath = path.join(folder, "update-pending.json");

  fs.writeFileSync(markerPath, JSON.stringify({ version: "0.14.0" }));
  const failed = updater(t, { currentVersion: "0.13.1", markerPath });
  assert.deepEqual(failed.checkPreviousAttempt(), { version: "0.14.0", installed: false });
  assert.match(failed.support().failure, /ne s'est pas installée/);
  assert.equal(fs.existsSync(markerPath), false);
  assert.equal(failed.checkPreviousAttempt(), null);

  fs.writeFileSync(markerPath, JSON.stringify({ version: "0.14.0" }));
  const installed = updater(t, { currentVersion: "0.14.0", markerPath });
  assert.deepEqual(installed.checkPreviousAttempt(), { version: "0.14.0", installed: true });
  assert.equal(installed.support().failure, undefined);
});

test("a .deb package is handed to the system installer without quitting", async (t) => {
  const opened = [];
  const events = [];
  const update = updater(t, {
    ...registry({ [DEB]: Buffer.from("package") }),
    platform: "linux",
    env: {},
    openPath: async (file) => {
      opened.push(path.basename(file));
      return "";
    },
  });
  const result = await update.download(TAG);
  assert.equal(result.mode, "installer");
  assert.match(result.hint, /fenêtre qui s'ouvre/);

  await update.install({ beforeExit: async () => events.push("stop"), exit: () => events.push("exit") });

  assert.deepEqual(opened, [DEB]);
  assert.deepEqual(events, []);
});

test("an AppImage is replaced in place, then relaunched once the application has quit", async (t) => {
  const folder = temporaryDirectory(t);
  const appImage = path.join(folder, "SDK Local Manager.AppImage");
  fs.writeFileSync(appImage, "old version");
  const launches = [];
  const update = updater(t, {
    ...registry({ [APPIMAGE]: Buffer.from("new version") }),
    platform: "linux",
    env: { APPIMAGE: appImage, APPDIR: "/tmp/.mount_old", HOME: "/home/me" },
    launch: async (command, args, options) => launches.push({ command, args, env: options.env }),
  });
  await update.download(TAG);

  await update.install({ beforeExit: async () => undefined, exit: () => undefined });

  assert.equal(fs.readFileSync(appImage, "utf8"), "new version");
  // Windows n'a pas de droit d'exécution sur les fichiers : vérifié là où il existe.
  if (process.platform !== "win32") assert.equal(fs.statSync(appImage).mode & 0o111, 0o111);
  assert.deepEqual(launches[0].args.slice(2), ["sdk-update", "4242", appImage]);
  assert.equal(launches[0].env.APPIMAGE, undefined);
  assert.equal(launches[0].env.APPDIR, undefined);
  assert.equal(launches[0].env.HOME, "/home/me");
});

/** Exécute un script de remplacement comme le ferait l'application, processus déjà terminé. */
function runScript(script, args) {
  const finished = spawnSync(process.execPath, ["-e", ""]);
  assert.equal(finished.status, 0);
  return spawnSync("/bin/sh", ["-c", script, "sdk-update", String(finished.pid), ...args], { encoding: "utf8" });
}

/** Faux paquet `.app` dont l'exécutable écrit `marker` dans le fichier témoin `launched`. */
function fakeBundle(directory, marker, launched) {
  const bundle = path.join(directory, "SDK Local Manager.app");
  const executable = path.join(bundle, "Contents", "MacOS", "SDK Local Manager");
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(executable, `#!/bin/sh\necho ${marker} > "${launched}"\n`, { mode: 0o755 });
  return bundle;
}

test(
  "the macOS script swaps the bundles, cleans up and launches the new version",
  { skip: process.platform === "win32" },
  (t) => {
    const root = temporaryDirectory(t);
    const launched = path.join(root, "launched");
    const app = fakeBundle(root, "old", launched);
    const work = path.join(root, "updates", "app-v0.14.0-build2");
    const staged = fakeBundle(path.join(work, "staged"), "new", launched);
    const backup = path.join(root, ".SDK Local Manager.app.previous-1");

    const result = runScript(MAC_SCRIPT, [app, staged, backup, "Contents/MacOS/SDK Local Manager", work]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Nouvelle version en place/);
    assert.equal(fs.readFileSync(launched, "utf8").trim(), "new");
    assert.equal(fs.existsSync(backup), false);
    // Le dossier de la version et son parent, devenu vide, disparaissent.
    assert.equal(fs.existsSync(path.join(root, "updates")), false);
  },
);

test(
  "the macOS script puts the previous version back when the new one cannot be moved",
  { skip: process.platform === "win32" },
  (t) => {
    const root = temporaryDirectory(t);
    const launched = path.join(root, "launched");
    const app = fakeBundle(root, "old", launched);
    const backup = path.join(root, ".SDK Local Manager.app.previous-1");
    const missing = path.join(root, "work", "staged", "absent.app");

    const result = runScript(MAC_SCRIPT, [
      app,
      missing,
      backup,
      "Contents/MacOS/SDK Local Manager",
      path.join(root, "work"),
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /version précédente remise en place/);
    assert.equal(fs.readFileSync(launched, "utf8").trim(), "old");
    assert.equal(fs.existsSync(backup), false);
  },
);

test(
  "the Linux script relaunches the AppImage once the application has quit",
  { skip: process.platform === "win32" },
  (t) => {
    const root = temporaryDirectory(t);
    const appImage = path.join(root, "sdk.AppImage");
    fs.writeFileSync(appImage, `#!/bin/sh\necho relaunched > "${path.join(root, "launched")}"\n`, { mode: 0o755 });

    const result = runScript(LINUX_SCRIPT, [appImage]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(root, "launched"), "utf8").trim(), "relaunched");
  },
);
