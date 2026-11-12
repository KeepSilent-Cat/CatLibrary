import {describe,it,expect} from 'vitest';import {remapMediaPath} from './media-paths';
describe('portable media references',()=>{
 it('rebases encoded old-drive assets after restoring on another drive',()=>{expect(remapMediaPath('http://asset.localhost/D%3A%5CCatLibrary%5Clibrary%5Creports%5Ca%5Cassets%5Cx.png','E:/CatLibrary/library',['D:/CatLibrary/library'],{})).toBe('E:/CatLibrary/library/reports/a/assets/x.png');});
 it('follows an image move before applying drive migration',()=>{expect(remapMediaPath('http://asset.localhost/D%3A%5CLib%5Cimages%5Ca%5Csource%5Cx.png','E:/Lib',['D:/Lib'],{'D:/Lib/images/a/source/x.png':'D:/Lib/images/b/source/x.png'})).toBe('E:/Lib/images/b/source/x.png');});
 it('does not rewrite external media or traversal paths',()=>{expect(remapMediaPath('https://example.com/picture.png','E:/Lib',['D:/Lib'],{})).toBe('https://example.com/picture.png');expect(remapMediaPath('C:/External/a.png','E:/Lib',['D:/Lib'],{})).toBe('C:/External/a.png');expect(remapMediaPath('D:/Lib/../External/a.png','E:/Lib',['D:/Lib'],{})).toBe('D:/Lib/../External/a.png');});
});
