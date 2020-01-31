// Provides dev-time type structures for  `danger` - doesn't affect runtime.
import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
import { diff, gte } from "semver"
import * as fs from "fs-extra"
import * as path from "path"
declare var danger: DangerDSLType
export declare function message(message: string): void
export declare function warn(message: string): void
export declare function fail(message: string): void
export declare function markdown(message: string): void

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
  commonjs?: string
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

function prepSDKVersion(sdkVersion: string): string {
  if (sdkVersion) {
    // strip .GA suffix
    if (sdkVersion.endsWith('.GA')) {
      return sdkVersion.slice(0, sdkVersion.length - 3);
    }
    // convert .RC suffix to 9.0.0-rc.#
    if (sdkVersion.endsWith('.RC')) {
      return sdkVersion.slice(0, sdkVersion.length - 3) + '-rc.1';
    }
    // convert .Beta suffix to 9.0.0-beta.1
    if (sdkVersion.endsWith('.Beta')) {
      return sdkVersion.slice(0, sdkVersion.length - 5) + '-beta.1';
    }
    // handle CI builds with .vTIMESTAMP suffixes!
    if (sdkVersion.includes('.v')) {
      return sdkVersion.replace('.v', '-alpha.')
    }
  }
  return sdkVersion
}

async function checkJenkinsfile(minSDK: string, winningManifest: string, allFiles: string[], rootDir: string): Promise<string | null> {
  // Check that Jenkinsfile sdkVersion value is > minsdk in manifest!
  let contents: string;
  if (allFiles.includes('Jenkinsfile')) {
    // manifest has changed
    const diff = await danger.git.diffForFile('Jenkinsfile');
    contents = diff.after;
  } else {
    contents = await fs.readFile(path.join(rootDir, 'Jenkinsfile'), 'utf8');
  }
  const matches = contents.match(/sdkVersion\s*=\s*['"]([^'"]+)['"]/);
  if (matches) {
    const origSDKVersion = matches[1];
    const semverCompatVersion = prepSDKVersion(origSDKVersion)
    if (!gte(semverCompatVersion, `${minSDK}-alpha.0`)) {
      //  uh-oh, we're trying to build against an sdk that is not >= the stated minSDK
      fail(`SDK version used to build on Jenkins (${origSDKVersion}) is not >= minSDK of ${minSDK} declared in ${winningManifest}`);
    }
    return origSDKVersion;
  }

  warn(`Was unable to determine SDK version used to build on Jenkins. Consider adding sdkVersion = '${minSDK}' (or greater)`);
  return null;
}

async function checkTitaniumXCConfig(relativePath: string, minSDK: string, winningManifest: string, allFiles: string[], rootDir: string): Promise<string | null> {
  // Check that titanium.xcconfig TITANIUM_SDK_VERSION value is > minsdk in manifest!
  let contents: string;
  if (allFiles.includes(relativePath)) {
    // manifest has changed
    const diff = await danger.git.diffForFile(relativePath);
    contents = diff.after;
  } else {
    contents = await fs.readFile(path.join(rootDir, relativePath), 'utf8');
  }

  const matches = contents.match(/TITANIUM_SDK_VERSION\s*=\s*([^\s]+)/);
  if (matches) {
    const origSDKVersion = matches[1];
    const semverCompatVersion = prepSDKVersion(origSDKVersion)
    if (!gte(semverCompatVersion, `${minSDK}-alpha.0`)) {
      //  uh-oh, we're trying to build against an sdk that is not >= the stated minSDK
      fail(`SDK version used to build in XCode (${origSDKVersion} in ${relativePath}) is not >= minSDK of ${minSDK} declared in ${winningManifest}`);
    }
    return origSDKVersion;
  }

  warn(`Was unable to determine SDK version referenced in ${relativePath}. Consider adding TITANIUM_SDK_VERSION = ${minSDK} (or greater)`);
  return null;
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
      warn(`guid is inconsistent across platforms. It is ${androidManifest.guid} in android/manifest and ${iosManifest.guid} in ${iosManifestPath}`);
    }
    // TODO: warn if versions don't match?
  }

  // Between the platforms, which has the higher minSDK value?
  // Note that we expect minSDk values to be vanilla x.y.z version strings
  const androidMinSDK = androidManifest && androidManifest.minsdk;
  const iosMinSDK = iosManifest && iosManifest.minsdk;
  let winningManifest = 'android/manifest'
  let maxMinSDK = androidMinSDK;
  if (iosMinSDK) {
    if (maxMinSDK === undefined || gte(iosMinSDK, maxMinSDK)) {
      maxMinSDK = iosMinSDK;
      winningManifest = iosManifestPath;
    }
  }

  if (maxMinSDK) {
    // Verify build/test/ci SDK version is > minSDK and aligns across files!
    let jenkinsSDKVersion
    if (await exists('Jenkinsfile', allFiles, moduleRoot)) {
      jenkinsSDKVersion = await checkJenkinsfile(maxMinSDK, winningManifest, allFiles, moduleRoot);
    }

    let titaniumXCConfigSDKVersion;
    if (await exists('ios/titanium.xcconfig', allFiles, moduleRoot)) {
      titaniumXCConfigSDKVersion = await checkTitaniumXCConfig('ios/titanium.xcconfig', maxMinSDK, winningManifest, allFiles, moduleRoot);
    } else if (await exists('iphone/titanium.xcconfig', allFiles, moduleRoot)) {
      titaniumXCConfigSDKVersion = await checkTitaniumXCConfig('iphone/titanium.xcconfig', maxMinSDK, winningManifest, allFiles, moduleRoot);
    }
    // TODO: Check that test/unit/karma.unit.config sdkVersion: config.sdkVersion || '9.0.0.v20200130075800' value is > minsdk in manifest!

    // TODO: Check that they all align!
    if (jenkinsSDKVersion && titaniumXCConfigSDKVersion && jenkinsSDKVersion !== titaniumXCConfigSDKVersion) {
      warn(`SDK version declared in Jenkinsfile (${jenkinsSDKVersion}) does not match iOS' titanium.xcconfig value (${titaniumXCConfigSDKVersion})`);
    }
  }

  // TODO: What do we want to check?
  // - checks that the module id matches package name?
  // - if has js files under assets, the manifest has a "commonjs: true" entry
  // - js file name under assets matches the module id?
  // - platform matches across folder name, manifest, package.json?
  // - "respackage" value for Android?
}
