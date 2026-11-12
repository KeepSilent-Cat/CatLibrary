import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import ContentUnlockDialog from "./ContentUnlockDialog";
import LibraryBackupCard from "./LibraryBackupCard";
import Settings from "@/pages/Settings";
vi.mock("@tauri-apps/api/core", () => ({invoke:vi.fn(),isTauri:()=>false,convertFileSrc:(p:string)=>p}));
vi.mock("@tauri-apps/plugin-dialog",()=>({open:vi.fn()}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.open=true;};});
beforeEach(()=>{vi.mocked(invoke).mockReset();vi.mocked(open).mockReset();});
afterEach(()=>{cleanup();});
describe("library preference surfaces",()=>{
  it("keeps a failed unlock in the dialog and only unlocks after successful verification",async()=>{
    const unlock=vi.fn(),close=vi.fn();vi.mocked(invoke).mockResolvedValue(false);
    render(<ContentUnlockDialog target={2} onClose={close} onUnlock={unlock}/>);
    expect(screen.getByRole("dialog",{name:"打开完整藏馆"})).toBeInTheDocument();
    const input=screen.getByLabelText("访问密码");expect(input).toHaveAttribute("type","password");
    fireEvent.change(input,{target:{value:"incorrect-fixture"}});fireEvent.click(screen.getByRole("button",{name:"解锁藏馆"}));
    expect(await screen.findByText("密码不正确，请再试一次。")).toBeInTheDocument();expect(unlock).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
    vi.mocked(invoke).mockResolvedValue(true);fireEvent.change(input,{target:{value:"fixture"}});fireEvent.click(screen.getByRole("button",{name:"解锁藏馆"}));
    await waitFor(()=>expect(unlock).toHaveBeenCalledWith(2));expect(close).toHaveBeenCalledTimes(1);
  });
  it("keeps backup in the settings side column after the path card",()=>{
    render(<Settings/>);
    const backup=screen.getByRole("heading",{name:"备份与迁移"}).closest("section")!;
    expect(backup.parentElement?.tagName).toBe("ASIDE");
    expect(backup.previousElementSibling).toContainElement(screen.getByRole("heading",{name:"路径策略"}));
    expect(screen.getByRole("heading",{name:"基础设置"})).toBeInTheDocument();
  });
  it("saves through the existing command and distinguishes a checkpoint from copying the library",async()=>{
    vi.mocked(invoke).mockResolvedValue("备份准备完成。\n请正常退出应用后，把整个资源库父文件夹复制到移动硬盘：X:/fixture\n设置快照：fixture");
    render(<LibraryBackupCard/>);fireEvent.click(screen.getByRole("button",{name:"保存备份检查点"}));
    expect(await screen.findByText("检查点已保存，素材尚未复制")).toBeInTheDocument();expect(screen.getAllByText(/请正常退出应用后/)[0]).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("prepare_portable_backup",expect.objectContaining({settingsJson:expect.any(String)}));
  });
  it("requires a themed confirmation before restoring a selected snapshot",async()=>{
    localStorage.setItem("restore-fixture","keep");vi.mocked(open).mockResolvedValue("X:/fixture/web-settings.json");vi.mocked(invoke).mockResolvedValue('{"restore-fixture":"new"}');
    render(<LibraryBackupCard/>);fireEvent.click(screen.getByRole("button",{name:"恢复设置"}));
    expect(await screen.findByRole("dialog",{name:"恢复这份设置快照？"})).toBeInTheDocument();expect(localStorage.getItem("restore-fixture")).toBe("keep");
    fireEvent.click(screen.getByRole("button",{name:"取消"}));await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(localStorage.getItem("restore-fixture")).toBe("keep");
  });
});
