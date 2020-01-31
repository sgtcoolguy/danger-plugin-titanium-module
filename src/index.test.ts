import lint from "./index"
import * as path from "path"
// import { DangerDSLType } from "../node_modules/danger/distribution/dsl/DangerDSL"
import { TextDiff, JSONDiff } from "../node_modules/danger/distribution/dsl/GitDSL";

declare const global: any

const mockDiff = (before: string, after: string) => {
  const asyncContents: Promise<TextDiff | null> = new Promise((resolve, reject) => resolve({
    before,
    after,
    diff: "",
    added: "",
    removed: "",
  }))
  return async (path: string): Promise<TextDiff | null> => asyncContents
}

const mockJSONDiff = (diff: JSONDiff) => {
  const asyncContents: Promise<JSONDiff | null> = new Promise((resolve, reject) => resolve(diff))
  return async (path: string): Promise<JSONDiff | null> => asyncContents
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

  it("does not lint anything when no files in PR", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: { created_files: [], modified_files: [] },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).not.toHaveBeenCalled()
  })

  it("flags if android/manifest doesn't exist", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: {
        created_files: [],
        modified_files: ["ios/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.2\nplatform: iphone\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n# something"
        ),
      }
    }

    await lint()

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("android/manifest does not exist")
  })

  it("flags if ios/manifest doesn't exist", async () => {
    global.danger = {
      github: { pr: { title: "Test" } },
      git: {
        created_files: [],
        modified_files: ["android/manifest"],
        diffForFile: mockDiff(
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "version: 1.2.2\nplatform: android\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n# something"
        ),
      }
    }

    await lint()

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("ios/manifest does not exist")
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
            after: "1.2.3"
          }
        }),
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).not.toHaveBeenCalled()
  })

  it("flags when android/manifest version changes PATCH but package.json hasn't changed at all", async () => {
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
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was Patch in android/manifest but None in package.json")
  })

  it("flags when android/manifest version change and package.json change are not equivalent levels", async () => {
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
            after: "1.3.0"
          }
        })
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was Major in android/manifest but Minor in package.json")
  })

  it("flags when android/manifest minsdk changes and version wasn't bumped", async () => {
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
        )
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was None in android/manifest but should be Major, due to updated minsdk")
  })

  it("flags when android/manifest minsdk changes and version wasn't bumped Major", async () => {
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
            after: "1.3.0"
          }
        })
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("version bump was Minor in android/manifest but should be Major, due to updated minsdk")
  })

  it("flags when ios/manifest has incorrect platform value", async () => {
    global.danger = {
      github: {
        pr: { title: "Test" },
      },
      git: {
        created_files: [],
        modified_files: ["ios/manifest"],
        diffForFile: mockDiff(
          "platform: iphone\nversion: 1.2.2\nminsdk: 8.0.0\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
          "platform: android\nversion: 1.2.2\nminsdk: 8.0.0\nmoduleid: ti.example\nguid: c3d987a8-8bd4-42cd-a3e4-2a75952d1ea0\n",
        )
      },
    }

    await lint({
      moduleRoot: path.join(__dirname, '../fixtures/typical')
    })

    expect(global.fail).toHaveBeenCalledTimes(1)
    expect(global.fail).toHaveBeenLastCalledWith("platform value was android in ios/manifest but should be iphone")
  })
})
