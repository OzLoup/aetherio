// electron-builder afterPack hook: sign the app with the local "AetherIO Local"
// certificate (made in Keychain Access → Certificate Assistant). A stable
// signature lets macOS remember permissions such as Local Network, which
// it silently denies to ad-hoc signed apps (needed to find TVs for casting).
// electron-builder only uses *trusted* identities, and a self-signed one
// isn't, so we call codesign ourselves. Without the certificate the build
// keeps the ad-hoc signature.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const NAME = process.env.AETHERIO_SIGN_IDENTITY || "AetherIO Local";

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const list = execFileSync("security", ["find-identity", "-p", "codesigning"], { encoding: "utf8" });
  const line = list.split("\n").find((l) => l.includes(`"${NAME}"`));
  const hash = line?.match(/[0-9A-F]{40}/)?.[0];
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!hash) {
    console.log(`  • "${NAME}" certificate not found: keeping the ad-hoc signature`);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
    return;
  }
  console.log(`  • signing with "${NAME}" (${hash.slice(0, 8)}…)`);
  execFileSync("codesign", ["--force", "--deep", "--sign", hash, app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
