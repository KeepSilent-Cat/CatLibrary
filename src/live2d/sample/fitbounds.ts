export function fitBounds(minX:number,maxX:number,minY:number,maxY:number,width=1.6,height=1.78) {
  const w=maxX-minX,h=maxY-minY;
  if (![minX,maxX,minY,maxY,w,h].every(Number.isFinite) || w<=0 || h<=0) return null;
  const scale=Math.min(width/w,height/h);
  return {scale,x:-(minX+maxX)*0.5*scale,y:-(minY+maxY)*0.5*scale};
}
