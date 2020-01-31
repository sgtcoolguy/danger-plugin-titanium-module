// Provides dev-time type structures for  `danger` - doesn't affect runtime.
import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
import { diff } from "semver"
import * as fs from "fs-extra"
import * as path from "path"
declare var danger: DangerDSLType
export declare function message(message: string): void
export declare function warn(message: string): void
export declare function fail(message: string): void
export declare function markdown(message: string): void

// TODO: What do we want to check?
// - checks that the module id matches package name?
// - verify that Jenkinsfile and test/unit/karma.unit.config use an SDK > minSDK of both modules!
// - flags when multiple platforms have differing versions?
// - if has js files under assets, the manifest has a "commonjs: true" entry
// - js file name under assets matches the module id?
// - module id matches across platforms?
// - module guid matches across platforms?
// - platform matches across folder name, manifest, package.json?
// - "respackage" value for Android?
interface Manifest {
  name?: string,
	version?: string,
  moduleid?: string,
  description?: string,
  copyright?: string,
  license?: string,
  platform?: string,
  minsdk?: string,
  architectures?: string,
  apiversion?: string,
  guid?: string,
}

function parseManifest(contents: string): Manifest {
	const re: RegExp = /^(\S+)\s*:\s*(.*)$/;
	const manifest: Manifest = {};
	contents.split(/\r?\n/).forEach(line => {
		const match = line.match(re);
		if (match) {
			manifest[match[1].trim()] = match[2].trim();
    }
    // TODO: Also include the line number so we can do inline comments?
	});

	return manifest;
}
enum VersionChange {None, Major, Minor, Patch}

function versionChange(before: string, after: string): VersionChange {
  const result: string = diff(before, after);
  if (result === "major") {
    return VersionChange.Major;
  }
  if (result === "minor") {
    return VersionChange.Minor;
  }
  if (result === "patch") {
    return VersionChange.Patch;
  }
  return VersionChange.None;
}

async function checkManifest(allFiles: string[], relativePath: string, platform: string, packageJsonBumped: VersionChange, rootDir: string): Promise<Manifest | null> {
  let currentManifest;
  if (allFiles.includes(relativePath)) {
    // manifest has changed
    const diff = await danger.git.diffForFile(relativePath);
    currentManifest = parseManifest(diff.after);
    const before = parseManifest(diff.before);
    const manifestVersionChangeType = versionChange(before.version, currentManifest.version);
    if (manifestVersionChangeType !== VersionChange.None) { // version changed in the android manifest!
      if (manifestVersionChangeType !== packageJsonBumped) {
        fail(`version bump was ${VersionChange[manifestVersionChangeType]} in ${relativePath} but ${VersionChange[packageJsonBumped]} in package.json`);
      }
    }

    // if minsdk changed, better be a major version bump!
    if (currentManifest.minsdk !== before.minsdk && manifestVersionChangeType !== VersionChange.Major) {      
      fail(`version bump was ${VersionChange[manifestVersionChangeType]} in ${relativePath} but should be Major, due to updated minsdk`);
    }

    // if apiversion changed, better be a major version bump!
    if (currentManifest.apiversion !== before.apiversion && manifestVersionChangeType !== VersionChange.Major) {
      fail(`version bump was ${VersionChange[manifestVersionChangeType]} in ${relativePath} but should be Major, due to updated apiversion`);
    }
  } else {
    // manifest wasn't edited, just check for sanity below
    try {
      currentManifest = parseManifest(await fs.readFile(path.join(rootDir, relativePath), 'utf8'));
    } catch (e) {
      fail(`${relativePath} does not exist`);
      return null;
    }
  }

  // general manifest sanity check
  if (currentManifest.platform !== platform) {
    fail(`platform value was ${currentManifest.platform} in ${relativePath} but should be ${platform}`);
  }
  return currentManifest;
}

async function getPackageJSONVersionChange(allFiles: string[]): Promise<VersionChange> {
  if (!allFiles.includes("package.json")) {
    return VersionChange.None;
  }
  const packageDiff = await danger.git.JSONDiffForFile("package.json");
  if (packageDiff.version) {
    return versionChange(packageDiff.version.before, packageDiff.version.after);
  }
  return VersionChange.None;
}

async function exists(relativePath: string, allFiles: string[], rootDir: string): Promise<boolean> {
  if (allFiles.includes(relativePath)) {
    return true;
  }
  return await fs.pathExists(path.join(rootDir, relativePath));
}

interface LintOptions {
  /**
   * The path to module root
   */
  moduleRoot?: string
}

export default async function lint(options?: LintOptions) {
  const moduleRoot: string =
    (options !== undefined && options.moduleRoot !== undefined) ? options.moduleRoot! : process.cwd()
  const allFiles = danger.git.modified_files;
  const packageJsonBumped = await getPackageJSONVersionChange(allFiles);

  const androidManifest = await checkManifest(allFiles, 'android/manifest', 'android', packageJsonBumped, moduleRoot);

  let iosManifestPath = 'iphone/manifest';
  if (!(await exists('iphone/manifest', allFiles, moduleRoot))) {
    iosManifestPath = 'ios/manifest';
  }
  const iosManifest = await checkManifest(allFiles, iosManifestPath, 'iphone', packageJsonBumped, moduleRoot);

  // check consistency across platforms
  if (iosManifest && androidManifest) {
    // Verify the moduleid match across platforms
    if (androidManifest.moduleid !== iosManifest.moduleid) {
      fail(`moduleid is inconsistent across platforms. It is ${androidManifest.moduleid} in android/manifest and ${iosManifest.moduleid} in ${iosManifestPath}`);
    }
    // Verify the guid match across platforms
    if (androidManifest.guid !== iosManifest.guid) {
      fail(`guid is inconsistent across platforms. It is ${androidManifest.guid} in android/manifest and ${iosManifest.guid} in ${iosManifestPath}`);
    }
    // TODO: warn if versions don't match?
  }

  // TODO: Check that (ios|iphone)/module.xcconfig TITANIUM_SDK_VERSION = 8.1.1.GA values is > minsdk in manifest!
}
