const fs = require("fs");
const path = require("path");

function tryRequireLicenseChecker() {
  try {
    return require("license-checker");
  } catch (err) {
    throw new Error(
      "Missing dev dependency 'license-checker'. Run `npm install` first.\n" +
        (err && err.message ? err.message : String(err)),
    );
  }
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function findLicenseFile(moduleDir) {
  const candidates = [
    "LICENSE",
    "LICENSE.txt",
    "LICENSE.md",
    "LICENCE",
    "LICENCE.txt",
    "COPYING",
    "COPYING.txt",
    "NOTICE",
    "NOTICE.txt",
  ];

  for (const name of candidates) {
    const p = path.join(moduleDir, name);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }

  return null;
}

function normalizeLicenseLabel(licenses) {
  if (!licenses) return "UNKNOWN";
  if (Array.isArray(licenses)) return licenses.join(", ");
  return String(licenses);
}

function assertCompleteLicenseEntry(entry) {
  const license = String(entry.license || "").trim();
  if (!license || /^(UNKNOWN|UNLICENSED)$/i.test(license)) {
    throw new Error(`Missing production license information for ${entry.displayName || entry.name}.`);
  }
  if (!entry.licenseText || !String(entry.licenseText).trim()) {
    throw new Error(`Missing readable production license text for ${entry.displayName || entry.name}.`);
  }
}

function generateNoticesText({ packages, extraEntries }) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const lines = [];
  lines.push("Soapy Panels — Third-Party Notices");
  lines.push(`Generated: ${dateStr}`);
  lines.push("");
  lines.push(
    "This application bundles third-party software. The following notices are provided for compliance.",
  );
  lines.push("");

  const all = [...(extraEntries || []), ...packages];

  all.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  for (const entry of all) {
    lines.push("================================================================================");
    lines.push(entry.displayName || entry.name);
    if (entry.license) lines.push(`License: ${entry.license}`);
    if (entry.repository) lines.push(`Repository: ${entry.repository}`);
    if (entry.homepage) lines.push(`Homepage: ${entry.homepage}`);
    lines.push("");
    if (entry.licenseText) {
      lines.push(entry.licenseText.trimEnd());
      lines.push("");
    } else {
      lines.push("License text not found.");
      lines.push("");
    }
  }

  return lines.join("\n");
}

function collectLicenseCheckerData(startDir) {
  const licenseChecker = tryRequireLicenseChecker();

  return new Promise((resolve, reject) => {
    licenseChecker.init(
      {
        start: startDir,
        production: true,
        excludePrivatePackages: true,
        json: true,
      },
      (err, packages) => {
        if (err) reject(err);
        else resolve(packages || {});
      },
    );
  });
}

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const packagingDir = path.join(root, "packaging");
  const outPath = path.join(packagingDir, "THIRD_PARTY_NOTICES.txt");

  if (!fs.existsSync(packagingDir)) fs.mkdirSync(packagingDir, { recursive: true });

  const data = await collectLicenseCheckerData(root);

  const packages = Object.keys(data).map((key) => {
    const info = data[key] || {};
    const moduleDir = info.path || null;

    let licenseFile = info.licenseFile || null;
    if (!licenseFile && moduleDir) licenseFile = findLicenseFile(moduleDir);

    const licenseText = licenseFile ? readTextIfExists(licenseFile) : null;

    return {
      name: key,
      displayName: key,
      license: normalizeLicenseLabel(info.licenses),
      repository: info.repository || "",
      homepage: info.homepage || "",
      licenseText,
    };
  });

  // Electron runtime is bundled, but it’s typically a devDependency.
  const extraEntries = [];
  const electronLicensePath = path.join(root, "node_modules", "electron", "LICENSE");
  const electronLicenseText = readTextIfExists(electronLicensePath);
  if (electronLicenseText) {
    extraEntries.push({
      name: "electron",
      displayName: "electron",
      license: "MIT",
      repository: "https://github.com/electron/electron",
      homepage: "https://www.electronjs.org/",
      licenseText: electronLicenseText,
    });
  }

  const omggifNoticePath = path.join(root, "app", "renderer", "vendor", "omggif", "README");
  const omggifNoticeText = readTextIfExists(omggifNoticePath);
  if (omggifNoticeText) {
    extraEntries.push({
      name: "omggif",
      displayName: "omggif",
      license: "MIT",
      repository: "https://github.com/deanm/omggif",
      homepage: "",
      licenseText: omggifNoticeText,
    });
  }

  const gifencLicensePath = path.join(
    root,
    "app",
    "renderer",
    "vendor",
    "gifenc",
    "LICENSE.md",
  );
  const gifencLicenseText = readTextIfExists(gifencLicensePath);
  if (gifencLicenseText) {
    extraEntries.push({
      name: "gifenc",
      displayName: "gifenc",
      license: "MIT",
      repository: "https://github.com/mattdesl/gifenc",
      homepage: "",
      licenseText: gifencLicenseText,
    });
  }

  const text = generateNoticesText({ packages, extraEntries });
  [...packages, ...extraEntries].forEach(assertCompleteLicenseEntry);
  fs.writeFileSync(outPath, text, "utf8");

  const projectFiles = ["LICENSE", "NOTICE", "ASSET_LICENSES.md", "TRADEMARKS.md"];
  const openSourceNotices = projectFiles
    .map((file) => `${"=".repeat(80)}\n${file}\n\n${fs.readFileSync(path.join(root, file), "utf8").trimEnd()}`)
    .concat(`${"=".repeat(80)}\nTHIRD_PARTY_NOTICES.txt\n\n${text.trimEnd()}`)
    .join("\n\n");
  fs.writeFileSync(
    path.join(packagingDir, "OPEN_SOURCE_NOTICES.txt"),
    `${openSourceNotices}\n`,
    "utf8",
  );

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
