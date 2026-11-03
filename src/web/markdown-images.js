const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const imageURL=url=>/^https?:\/\//i.test(url)||/^\/api\/note-images\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(url);
export function parseImageTag(tag){
 if(!/^<img\s[^<>]*\/?\s*>$/i.test(tag))return null;
 const attrs={};for(const match of tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))attrs[match[1].toLowerCase()]=(match[2]??match[3]).replace(/&(amp|quot|#39|lt|gt);/g,(_,key)=>({amp:'&',quot:'"','#39':"'",lt:'<',gt:'>'}[key]));
 if(!imageURL(attrs.src||''))return null;
 const zoom=attrs.style?.match(/(?:^|;)\s*zoom\s*:\s*(\d+(?:\.\d+)?)%\s*(?:;|$)/i),width=/^\d{1,4}$/.test(attrs.width||'')?Math.min(4096,Number(attrs.width)):null;
 return {src:attrs.src,alt:attrs.alt||'',caption:attrs.title||'',ratio:zoom?Math.min(4,Math.max(.05,Number(zoom[1])/100)):1,width};
}
export function imageTag({src,alt='',caption='',ratio=1,width=null}){if(!imageURL(src))return '';return `<img src="${escape(src)}" alt="${escape(alt)}"${caption?` title="${escape(caption)}"`:''}${width?` width="${Math.round(width)}"`:ratio!==1?` style="zoom:${Math.round(ratio*100)}%;"`:''}>`}
