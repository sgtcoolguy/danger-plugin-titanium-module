// Provides dev-time type structures for  `danger` - doesn't affect runtime.
import * as fs from "fs-extra"
import * as path from "path"
import { diff, gte, prerelease } from "semver"
import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
declare var danger: DangerDSLType
export declare function message(message: string): void
export declare function warn(message: string): void
export declare function fail(message: string): void
export declare function markdown(message: string): void

interface Manifest {
  name?: string
  version?: string
  moduleid?: string
  description?: string
  copyright?: string
  license?: string
  platform?: string
  minsdk?: string
  architectures?: string
  apiversion?: string
  guid?: string
  commonjs?: string
  rawminsdk?: string // the original value before we massaged it to be semver
  versionChange?: VersionChange // we set this if we know it changed!
}

function parseManifest(contents: string): Manifest {
  const re: RegExp = /^(\S+)\s*:\s*(.*)$/
  const manifest: Manifest = {}
  contents.split(/\r?\n/).forEach(line => {
    const match = line.match(re)
    if (match) {
      manifest[match[1].trim()] = match[2].trim()
    }
    // TODO: Also include the line number so we can do inline comments?
  })

  // Force a semver-compatible version string for minsdk
  // (some modules use values like "6.2.2.GA", while most use "9.0.0" style)
  if (manifest.minsdk) {
    manifest.rawminsdk = manifest.minsdk
    manifest.minsdk = prepSDKVersion(manifest.minsdk)
  }

  return manifest
}
enum VersionChange {
  None,
  Patch,
  Minor,
  Major,
}

function versionChange(before: string, after: string): VersionChange {
  const result: string = diff(before, after)
  if (result === "major") {
    return VersionChange.Major
  }
  if (result === "minor") {
    return VersionChange.Minor
  }
  if (result === "patch") {
    return VersionChange.Patch
  }
  return VersionChange.None
}

async function checkManifest(relativePath: string, platform: string, rootDir: string): Promise<Manifest | null> {
  let currentManifest
  if (danger.git.modified_files.includes(relativePath)) {
    // manifest has changed
    const manifestDiff = await danger.git.diffForFile(relativePath)
    currentManifest = parseManifest(manifestDiff.after)
    const before = parseManifest(manifestDiff.before)
    const manifestVersionChangeType = versionChange(before.version, currentManifest.version)
    currentManifest.versionChange = manifestVersionChangeType
    // if minsdk changed, better be a major version bump!
    if (currentManifest.minsdk !== before.minsdk && manifestVersionChangeType !== VersionChange.Major) {
      fail(
        `version bump was ${VersionChange[manifestVersionChangeType]} in ${relativePath} but should be Major, due to updated minsdk`,
      )
    }

    // if apiversion changed, better be a major version bump!
    if (currentManifest.apiversion !== before.apiversion && manifestVersionChangeType !== VersionChange.Major) {
      fail(
        `version bump was ${VersionChange[manifestVersionChangeType]} in ${relativePath} but should be Major, due to updated apiversion`,
      )
    }
  } else {
    // manifest wasn't edited, just check for sanity below
    try {
      currentManifest = parseManifest(await fs.readFile(path.join(rootDir, relativePath), "utf8"))
      currentManifest.versionChange = VersionChange.None
    } catch (e) {
      fail(`${relativePath} does not exist`)
      return null
    }
  }

  // general manifest sanity check
  if (currentManifest.platform !== platform) {
    fail(`platform value was ${currentManifest.platform} in ${relativePath} but should be ${platform}`)
  }
  // failf or non-GA minsdk versions
  if (prerelease(currentManifest.minsdk)) {
    fail(`minsdk value was ${currentManifest.rawminsdk} in ${relativePath}, which is a non-GA release`)
  }
  return currentManifest
}

async function getPackageJSONVersionChange(): Promise<VersionChange> {
  // Consider creation of package.json to be "major"
  if (danger.git.created_files.includes("package.json")) {
    return VersionChange.Major
  }
  // if not created or modified, then assume no version bump
  if (!danger.git.modified_files.includes("package.json")) {
    return VersionChange.None
  }
  const packageDiff = await danger.git.JSONDiffForFile("package.json")
  if (packageDiff.version) {
    return versionChange(packageDiff.version.before, packageDiff.version.after)
  }
  return VersionChange.None
}

async function fileExists(relativePath: string, rootDir: string): Promise<boolean> {
  if (danger.git.modified_files.includes(relativePath) || danger.git.created_files.includes(relativePath)) {
    return true
  }
  return fs.pathExists(path.join(rootDir, relativePath))
}

async function dirExists(relativePath: string, rootDir: string): Promise<boolean> {
  // check if any of them have the prefix of the expected dir!
  if (danger.git.created_files.find(f => f.startsWith(relativePath + "/"))) {
    return true
  }
  if (danger.git.modified_files.find(f => f.startsWith(relativePath + "/"))) {
    return true
  }
  return fs.pathExists(path.join(rootDir, relativePath))
}

function prepSDKVersion(sdkVersion: string): string {
  if (sdkVersion) {
    // strip .GA suffix
    if (sdkVersion.endsWith(".GA")) {
      return sdkVersion.slice(0, sdkVersion.length - 3)
    }
    // convert .RC suffix to 9.0.0-rc.#
    if (sdkVersion.endsWith(".RC")) {
      return sdkVersion.slice(0, sdkVersion.length - 3) + "-rc.1"
    }
    // convert .Beta suffix to 9.0.0-beta.1
    if (sdkVersion.endsWith(".Beta")) {
      return sdkVersion.slice(0, sdkVersion.length - 5) + "-beta.1"
    }
    // handle CI builds with .vTIMESTAMP suffixes!
    if (sdkVersion.includes(".v")) {
      return sdkVersion.replace(".v", "-alpha.")
    }
  }
  return sdkVersion
}

async function checkJenkinsfile(minSDK: string, winningManifest: string, rootDir: string): Promise<string | null> {
  // Check that Jenkinsfile sdkVersion value is > minsdk in manifest!
  let contents: string
  if (danger.git.modified_files.includes("Jenkinsfile")) {
    // manifest has changed
    const jenkinsfileDiff = await danger.git.diffForFile("Jenkinsfile")
    contents = jenkinsfileDiff.after
  } else {
    contents = await fs.readFile(path.join(rootDir, "Jenkinsfile"), "utf8")
  }
  const matches = contents.match(/sdkVersion\s*=\s*['"]([^'"]+)['"]/)
  if (matches) {
    const origSDKVersion = matches[1]
    const semverCompatVersion = prepSDKVersion(origSDKVersion)
    if (!gte(semverCompatVersion, `${minSDK}-alpha.0`)) {
      //  uh-oh, we're trying to build against an sdk that is not >= the stated minSDK
      fail(
        `SDK version used to build on Jenkins (${origSDKVersion}) is not >= minSDK of ${minSDK} declared in ${winningManifest}`,
      )
    }
    return origSDKVersion
  }

  warn(
    `Was unable to determine SDK version used to build on Jenkins. Consider adding sdkVersion = '${minSDK}' (or greater)`,
  )
  return null
}

async function checkTitaniumXCConfig(
  relativePath: string,
  minSDK: string,
  winningManifest: string,
  rootDir: string,
): Promise<string | null> {
  // Check that titanium.xcconfig TITANIUM_SDK_VERSION value is > minsdk in manifest!
  let contents: string
  if (danger.git.modified_files.includes(relativePath)) {
    // manifest has changed
    const xcconfigDiff = await danger.git.diffForFile(relativePath)
    contents = xcconfigDiff.after
  } else {
    contents = await fs.readFile(path.join(rootDir, relativePath), "utf8")
  }

  const matches = contents.match(/TITANIUM_SDK_VERSION\s*=\s*([^\s]+)/)
  if (matches) {
    const origSDKVersion = matches[1]
    const semverCompatVersion = prepSDKVersion(origSDKVersion)
    if (!gte(semverCompatVersion, `${minSDK}-alpha.0`)) {
      //  uh-oh, we're trying to build against an sdk that is not >= the stated minSDK
      fail(
        `SDK version used to build in XCode (${origSDKVersion} in ${relativePath}) is not >= minSDK of ${minSDK} declared in ${winningManifest}`,
      )
    }
    return origSDKVersion
  }

  warn(
    `Was unable to determine SDK version referenced in ${relativePath}. Consider adding TITANIUM_SDK_VERSION = ${minSDK} (or greater)`,
  )
  return null
}

interface LintOptions {
  /**
   * The path to module root
   */
  moduleRoot?: string
}

async function checkPackageJsonVersionBump(
  androidManifest: Manifest | null,
  iosManifest: Manifest | null,
  iosManifestPath: string,
): Promise<void> {
  const packageJsonBump = await getPackageJSONVersionChange()
  let maxManifestChange = androidManifest ? androidManifest.versionChange : VersionChange.None
  let manifestPath = "android/manifest"
  if (iosManifest && iosManifest.versionChange > maxManifestChange) {
    manifestPath = iosManifestPath
    maxManifestChange = iosManifest.versionChange
  }
  if (maxManifestChange !== VersionChange.None && packageJsonBump !== maxManifestChange) {
    fail(
      `version bump was ${VersionChange[maxManifestChange]} in ${manifestPath} but ${VersionChange[packageJsonBump]} in package.json`,
    )
  }
}

export default async function lint(options?: LintOptions) {
  const moduleRoot: string =
    options !== undefined && options.moduleRoot !== undefined ? options.moduleRoot! : process.cwd()

  const androidFolderExists = await dirExists("android", moduleRoot)
  const androidManifest = androidFolderExists ? await checkManifest("android/manifest", "android", moduleRoot) : null

  const iosFolderExists = await dirExists("ios", moduleRoot)
  const iphoneFolderExists = await dirExists("iphone", moduleRoot)

  const iosManifestPath = iosFolderExists ? "ios/manifest" : "iphone/manifest"
  const iosManifest =
    iosFolderExists || iphoneFolderExists ? await checkManifest(iosManifestPath, "iphone", moduleRoot) : null

  // check consistency across platforms
  if (iosManifest && androidManifest) {
    // Verify the moduleid match across platforms
    if (androidManifest.moduleid !== iosManifest.moduleid) {
      fail(
        `moduleid is inconsistent across platforms. It is ${androidManifest.moduleid} in android/manifest and ${iosManifest.moduleid} in ${iosManifestPath}`,
      )
    }
    // Verify the guid match across platforms
    if (androidManifest.guid !== iosManifest.guid) {
      warn(
        `guid is inconsistent across platforms. It is ${androidManifest.guid} in android/manifest and ${iosManifest.guid} in ${iosManifestPath}`,
      )
    }
    // TODO: warn if versions don't match?
  }

  // Make sure that the package.json gets bumped at the same level as the higher of the two platform bumps
  if (iosManifest || androidManifest) {
    await checkPackageJsonVersionBump(androidManifest, iosManifest, iosManifestPath)
  }

  let titaniumXCConfigSDKVersion
  if (iosManifest) {
    if (await fileExists("ios/titanium.xcconfig", moduleRoot)) {
      titaniumXCConfigSDKVersion = await checkTitaniumXCConfig(
        "ios/titanium.xcconfig",
        iosManifest.minsdk,
        iosManifestPath,
        moduleRoot,
      )
    } else if (await fileExists("iphone/titanium.xcconfig", moduleRoot)) {
      titaniumXCConfigSDKVersion = await checkTitaniumXCConfig(
        "iphone/titanium.xcconfig",
        iosManifest.minsdk,
        iosManifestPath,
        moduleRoot,
      )
    }
  }

  // Between the platforms, which has the higher minSDK value?
  // Note that we expect minsdk values to be vanilla x.y.z version strings (we forced them to be!)
  const androidMinSDK = androidManifest && androidManifest.minsdk
  const iosMinSDK = iosManifest && iosManifest.minsdk
  let winningManifest = "android/manifest"
  let maxMinSDK = androidMinSDK
  if (iosMinSDK) {
    if (maxMinSDK === undefined || maxMinSDK === null || gte(iosMinSDK, maxMinSDK)) {
      maxMinSDK = iosMinSDK
      winningManifest = iosManifestPath
    }
  }

  if (maxMinSDK) {
    // Verify build/test/ci SDK version is > minSDK and aligns across files!
    let jenkinsSDKVersion
    if (await fileExists("Jenkinsfile", moduleRoot)) {
      jenkinsSDKVersion = await checkJenkinsfile(maxMinSDK, winningManifest, moduleRoot)
    }

    // TODO: Check that test/unit/karma.unit.config sdkVersion value is > minsdk in manifest!

    // Check that they all align!
    if (jenkinsSDKVersion && titaniumXCConfigSDKVersion && jenkinsSDKVersion !== titaniumXCConfigSDKVersion) {
      warn(
        `SDK version declared in Jenkinsfile (${jenkinsSDKVersion}) does not match iOS' titanium.xcconfig value (${titaniumXCConfigSDKVersion})`,
      )
    }
  }

  // TODO: What do we want to check?
  // - checks that the module id matches package name?
  // - if has js files under assets, the manifest has a "commonjs: true" entry
  // - js file name under assets matches the module id?
  // - platform matches across folder name, manifest, package.json?
  // - "respackage" value for Android?
}
