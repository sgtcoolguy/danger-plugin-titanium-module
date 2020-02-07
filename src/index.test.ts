import * as path from "path"
// import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
import { JSONDiff, TextDiff } from "../node_modules/danger/distribution/dsl/GitDSL"
import lint from "./index"

declare const global: any

interface TextDiffs {
  [filename: string]: TextDiff
}

const mockMultipleDiff = (diffs: TextDiffs) => {
  return async (relativePath: string): Promise<TextDiff | null> => {
    return diffs[relativePath]
  }
}

const mockDiff = (before: string, after: string) => {
  const asyncContents: Promise<TextDiff | null> = new Promise((resolve, reject) =>
    resolve({
      before,
      after,
      diff: "",
      added: "",
      removed: "",
    })
  )
  return async (relativePath: string): Promise<TextDiff | null> => asyncContents
}

const mockJSONDiff = (diff: JSONDiff) => {
  const asyncContents: Promise<JSONDiff | null> = new Promise((resolve, reject) => resolve(diff))
  return async (relativePath: string): Promise<JSONDiff | null> => asyncContents
}

describe("lint()", () => {
  beforeEach(() => {
    global.warn = jest.fn()
    global.message = jest.fn()
    global.fail = jest.fn()
    global.markdown = jest.fn()
  })

  afterEach(() => {
    global.warn = undefined
    global.message = undefined
    global.fail = undefined
    global.markdown = undefined
  })

  it("no warnings or errors for correct project", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: { created_files: [], modified_files: [] },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no warnings or errors for android-only module project", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: { created_files: [], modified_files: [] },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/android_only"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no warnings or errors for ios-only module project", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: { created_files: [], modified_files: [] },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/ios_only"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails if android/manifest doesn't exist", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: {
        created_files: ["android/.project"],
        modified_files: ["ios/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.2\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n# something"
        ),
      },
    }

    await lint()

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("android/manifest does not exist")
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails if ios/manifest doesn't exist", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: {
        created_files: ["ios/.project"],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n# something"
        ),
      },
    }

    await lint()

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("ios/manifest does not exist")
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no errors when android/manifest version changes and package.json has equivalent change", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest", "package.json"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.3\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: "1.2.2",
            after: "1.2.3",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when android/manifest version changes PATCH but package.json hasn't changed at all", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.3\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was Patch in android/manifest but None in package.json")
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when android/manifest version change and package.json change are not equivalent levels", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest", "package.json"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 2.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: "1.2.2",
            after: "1.3.0",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was Major in android/manifest but Minor in package.json")
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when android/manifest minsdk changes and version wasn't bumped", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "minsdk: 8.0.0\nversion: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "minsdk: 9.0.0\nversion: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "version bump was None in android/manifest but should be Major, due to updated minsdk"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when android/manifest minsdk changes and version wasn't bumped Major", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest", "package.json"],
        diffForFile: mockDiff(
          "version: 1.2.2\nminsdk: 8.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.3.0\nminsdk: 9.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: "1.2.2",
            after: "1.3.0",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "version bump was Minor in android/manifest but should be Major, due to updated minsdk"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when ios/manifest has incorrect platform value", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["ios/manifest"],
        diffForFile: mockDiff(
          "platform: iphone\nversion: 1.2.2\nminsdk: 8.0.0\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "platform: android\nversion: 1.2.2\nminsdk: 8.0.0\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("platform value was android in ios/manifest but should be iphone")
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when moduleid is different across platforms", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: [],
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/moduleid_differs"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "moduleid is inconsistent across platforms. It is ti.example.android in android/manifest and ti.example.iphone in ios/manifest"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("warns when guid is different across platforms", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: [],
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/guid_differs"),
    })

    expect(global.warn).toHaveBeenCalledTimes(1)
    expect(global.warn).toHaveBeenLastCalledWith(
      "guid is inconsistent across platforms. It is c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0 in android/manifest and c3d987a8-8bd4-42cd-a3e4-2a75952d1ea1 in ios/manifest"
    )
  })

  it("warns when no declared sdkVersion in Jenkinsfile", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["Jenkinsfile"],
        diffForFile: mockDiff(
          "library 'pipeline-library'\nbuildModule {\n}\n",
          "library 'pipeline-library'\nbuildModule {\n}\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.warn).toHaveBeenCalledTimes(1)
    expect(global.warn).toHaveBeenLastCalledWith(
      "Was unable to determine SDK version used to build on Jenkins. Consider adding sdkVersion = '9.0.0' (or greater)"
    )
    expect(global.fail).not.toHaveBeenCalled()
  })

  it("fails when declared sdkVersion in Jenkinsfile is less than minSDK", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["Jenkinsfile"],
        diffForFile: mockDiff(
          "library 'pipeline-library'\nbuildModule {\n  sdkVersion = '8.3.1.GA'\n}\n",
          "library 'pipeline-library'\nbuildModule {\n  sdkVersion = '8.3.1.GA'\n}\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "SDK version used to build on Jenkins (8.3.1.GA) is not >= minSDK of 9.0.0 declared in android/manifest"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no errors when declared sdkVersion in Jenkinsfile is >= than minSDK", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["Jenkinsfile"],
        diffForFile: mockDiff(
          "library 'pipeline-library'\nbuildModule {\n  sdkVersion = '8.3.1.GA'\n}\n",
          "library 'pipeline-library'\nbuildModule {\n  sdkVersion = '9.0.0.v20200130113429'\n}\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when declared sdkVersion in ios/titanium.xcconfig is less than ios minSDK", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["ios/titanium.xcconfig"],
        diffForFile: mockDiff("TITANIUM_SDK_VERSION = 8.1.1.GA\n", "TITANIUM_SDK_VERSION = 6.2.2.GA\n"),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "SDK version used to build in XCode (6.2.2.GA in ios/titanium.xcconfig) is not >= minSDK of 7.0.0 declared in ios/manifest"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no errors when sdkVersion in ios/titanium.xcconfig is < android minSDK but > ios minSDK", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["ios/titanium.xcconfig"],
        diffForFile: mockDiff("TITANIUM_SDK_VERSION = 8.1.1.GA\n", "TITANIUM_SDK_VERSION = 8.3.1.GA\n"),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("warns when declared sdkVersion in ios/titanium.xcconfig differs from Jenkinsfile", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["ios/titanium.xcconfig"],
        diffForFile: mockDiff("TITANIUM_SDK_VERSION = 8.1.1.GA\n", "TITANIUM_SDK_VERSION = 9.0.1.GA\n"),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/sdk_differs"),
    })

    expect(global.warn).toHaveBeenCalledTimes(1)
    expect(global.warn).toHaveBeenLastCalledWith(
      "SDK version declared in Jenkinsfile (9.0.0.v20200130075800) does not match iOS' titanium.xcconfig value (9.0.1.GA)"
    )
    expect(global.fail).not.toHaveBeenCalled()
  })

  it("no warnings or errors when manifest minsdk has .GA suffix", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: {
        created_files: [],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nminsdk: 8.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.2\nminsdk: 8.0.0.GA\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n"
        ),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("fails when android/manifest minsdk is pre-release", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["android/manifest", "package.json"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 8.0.0\n",
          "version: 2.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 9.0.0.v20200130113429"
        ),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: "1.2.2",
            after: "2.0.0",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "minsdk value was 9.0.0.v20200130113429 in android/manifest, which is a non-GA release"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no errors when android/manifest is bumped major and package.json is created", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: ["package.json"],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 8.0.0\n",
          "version: 2.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 9.0.0.v20200130113429"
        ),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: null,
            after: "2.0.0",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith(
      "minsdk value was 9.0.0.v20200130113429 in android/manifest, which is a non-GA release"
    )
    expect(global.warn).not.toHaveBeenCalled()
  })

  it("no errors when both platforms version bumps at different levels", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: ["package.json"],
        modified_files: ["android/manifest", "ios/manifest"],
        diffForFile: mockMultipleDiff({
          "android/manifest": {
            before:
              "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 8.0.0\n",
            after:
              "version: 2.0.0\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 9.0.0.GA\n",
            diff: "",
            added: "",
            removed: "",
          },
          "ios/manifest": {
            before:
              "version: 1.2.2\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 8.0.0\n",
            after:
              "version: 1.2.3\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\nminsdk: 8.0.0\n",
            diff: "",
            added: "",
            removed: "",
          },
        }),
        JSONDiffForFile: mockJSONDiff({
          version: {
            before: "1.2.2",
            after: "2.0.0",
          },
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, "../fixtures/typical"),
    })

    expect(global.fail).not.toHaveBeenCalled()
    expect(global.warn).not.toHaveBeenCalled()
  })
})
