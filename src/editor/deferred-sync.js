// Keep full Markdown serialization off the keystroke path. Continuous typing
// still receives periodic snapshots, and explicit saves synchronously flush.
export function deferredSync(sync,{delay=300,maxWait=1500}={}){
 let idle=null,maximum=null;
 const cancel=()=>{clearTimeout(idle);clearTimeout(maximum);idle=maximum=null};
 const flush=()=>{cancel();sync()};
 return {schedule(){clearTimeout(idle);idle=setTimeout(flush,delay);if(maximum===null)maximum=setTimeout(flush,maxWait)},flush,cancel};
}
