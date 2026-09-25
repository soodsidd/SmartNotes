import { isNativeFolderPickerAvailable } from "@/server/fs/native-folder-picker";

describe("native folder picker", () => {
  it("reports availability based on the host platform", () => {
    expect(isNativeFolderPickerAvailable()).toBe(process.platform === "win32");
  });
});
