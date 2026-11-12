/** 只重映射已知库内路径；外部媒体保持原样，不猜测文件位置。 */
export function remapMediaPath(value:string,root:string,previousRoots:string[],moves:Record<string,string>):string {
 let path=value;try{if(/^(https?:|asset:)/i.test(value)){const url=new URL(value);if(url.protocol!=='asset:'&&url.hostname!=='asset.localhost')return value;path=decodeURIComponent(url.pathname);}}catch{return value;}
 const normalize=(p:string)=>p.replace(/^\/(?=[a-z]:)/i,'').replace(/\\/g,'/').replace(/\/$/,'');
 path=normalize(path);
 const seen=new Set<string>();for(let i=0;i<100;i++){const pair=Object.entries(moves).find(([from])=>normalize(from).toLowerCase()===path.toLowerCase());if(!pair||seen.has(path))break;seen.add(path);path=normalize(pair[1]);}
 for(const old of previousRoots){const base=normalize(old);if(path.toLowerCase().startsWith(base.toLowerCase()+'/')){const suffix=path.slice(base.length+1);if(suffix.split('/').some(x=>x==='..'))return value;return normalize(root)+'/'+suffix;}}
 if(path!==normalize(value)&&!value.startsWith('data:'))return path;
 return value;
}
