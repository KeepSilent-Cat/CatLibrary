import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLibraryIndex } from "@/lib/library-source";
import { invoke } from "@tauri-apps/api/core";
import ViewerBackgroundControl from "./ViewerBackgroundControl";
vi.mock("@/lib/library-source",()=>({loadLibraryIndex:vi.fn()}));
vi.mock("@/store/useAppStore",()=>({useAppStore:(select:(s:{resourceRoot:string;ratingFilter:number})=>unknown)=>select({resourceRoot:"test-library",ratingFilter:0})}));
vi.mock("@tauri-apps/api/core",()=>({invoke:vi.fn(),convertFileSrc:(path:string)=>"asset:"+path}));
afterEach(cleanup);
beforeEach(()=>{
 vi.mocked(loadLibraryIndex).mockResolvedValue({images:[{id:"group",title:"山景",category:"images",relativePath:"images/group",summary:"",coverType:"image",coverImage:"cover",previewImages:[],sourceEntries:[],sourceCount:2,modifiedAt:0,rating:0,tags:[]},{id:"hidden",title:"隐藏分级",category:"images",relativePath:"images/hidden",summary:"",coverType:"fallback",previewImages:[],sourceEntries:[],sourceCount:1,modifiedAt:0,rating:2,tags:[]}],videos:[],games:[],comics:[],screenshots:[],music:[],live2d:[],novels:[]});
 vi.mocked(invoke).mockResolvedValue({chapters:[{images:["first.png","second.png"]}]});
});
describe("model backgrounds",()=>{
 it("selects an actual image within a collection and respects the rating filter",async()=>{
  const change=vi.fn();render(<ViewerBackgroundControl value="" onChange={change}/>);
  fireEvent.click(screen.getByRole("button",{name:"背景 · 透明"}));
  const group=await screen.findByRole("button",{name:"山景"});expect(screen.queryByText("隐藏分级")).toBeNull();fireEvent.click(group);
  fireEvent.click(await screen.findByRole("button",{name:"选择背景图片 2"}));
  expect(invoke).toHaveBeenCalledWith("scan_image_pages",{resourceRoot:"test-library",category:"images",groupId:"group"});
  expect(change).toHaveBeenCalledWith("asset:second.png");expect(screen.queryByRole("dialog")).toBeNull();
 });
 it("can restore transparency without changing the library",()=>{
  const change=vi.fn();render(<ViewerBackgroundControl value="asset:old.png" onChange={change}/>);
  fireEvent.click(screen.getByRole("button",{name:"背景 · 图片"}));fireEvent.click(screen.getByRole("button",{name:"恢复透明背景"}));expect(change).toHaveBeenCalledWith("");
 });
 it("shows a readable error when the library cannot load",async()=>{
  vi.mocked(loadLibraryIndex).mockRejectedValueOnce(new Error("library missing"));render(<ViewerBackgroundControl value="" onChange={()=>{}}/>);fireEvent.click(screen.getByRole("button",{name:"背景 · 透明"}));expect((await screen.findByRole("alert")).textContent).toContain("library missing");
 });
});
