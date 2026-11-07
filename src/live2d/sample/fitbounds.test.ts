import {describe,it,expect} from "vitest";
import {fitBounds} from "./fitbounds";
describe("fit model vertices",()=>{
 it("keeps centered-origin geometry on screen rather than translating below it",()=>{const b=[-0.256642,0.217322,-0.837407,0.86536];const f=fitBounds(...b as [number,number,number,number])!;expect((b[2]+b[3])*0.5*f.scale+f.y).toBeCloseTo(0);expect(b[2]*f.scale+f.y).toBeCloseTo(-0.89);expect(b[3]*f.scale+f.y).toBeCloseTo(0.89);});
 it("also centers positive-origin and wide meshes",()=>{const f=fitBounds(0,8,0,2)!;expect(f.scale).toBeCloseTo(0.2);expect(f.x).toBeCloseTo(-0.8);expect(f.y).toBeCloseTo(-0.2);});
 it("rejects empty or nonfinite geometry",()=>{expect(fitBounds(Infinity,-Infinity,Infinity,-Infinity)).toBeNull();expect(fitBounds(0,0,0,1)).toBeNull();});
});
